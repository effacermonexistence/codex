import { DurableObject } from "cloudflare:workers";
import { loadPolicyBundle, type RevasPolicy } from "./bundle";
import {
  select, type PermissionProfile, type Provider, type ProviderPreference,
  type CapacityPlan, type Step, type Action, chooseCapacityAware, selectAction,
} from "./policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const ARTIFACT_REF = /^r2:\/\/os1-private-results\/[0-9a-f-]{36}\/[1-9][0-9]{0,5}\/[0-9a-f]{64}\.json$/i;
type RoutedStep = Step & { action: Action; fallback_action: Action };
type RouteSnapshot = {
  task: string; provider: Provider; action: Action; permission_profile: PermissionProfile;
  policy_version: string; policy_sha256: string; executor_contract_version: string;
  executor_contract_sha256: string; revas: RevasPolicy;
};

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class RouteState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS route (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), provider TEXT NOT NULL,
        fallback_provider TEXT NOT NULL, permission_profile TEXT NOT NULL,
        action TEXT NOT NULL DEFAULT 'agent_run', fallback_action TEXT NOT NULL DEFAULT 'agent_run',
        max_steps INTEGER NOT NULL, sequence INTEGER NOT NULL, complete INTEGER NOT NULL DEFAULT 0,
        task TEXT NOT NULL DEFAULT '', policy_version TEXT NOT NULL DEFAULT '',
        policy_sha256 TEXT NOT NULL DEFAULT '', executor_contract_version TEXT NOT NULL DEFAULT '',
        executor_contract_sha256 TEXT NOT NULL DEFAULT '', revas_json TEXT NOT NULL DEFAULT '{}',
        verified_artifact_hash TEXT)`);
      const columns = new Set(this.ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(route)").toArray().map((column) => column.name));
      const additions: Record<string, string> = {
        action: "TEXT NOT NULL DEFAULT 'agent_run'", fallback_action: "TEXT NOT NULL DEFAULT 'agent_run'",
        task: "TEXT NOT NULL DEFAULT ''", policy_version: "TEXT NOT NULL DEFAULT ''",
        policy_sha256: "TEXT NOT NULL DEFAULT ''", executor_contract_version: "TEXT NOT NULL DEFAULT ''",
        executor_contract_sha256: "TEXT NOT NULL DEFAULT ''", revas_json: "TEXT NOT NULL DEFAULT '{}'",
        verified_artifact_hash: "TEXT",
      };
      for (const [name, definition] of Object.entries(additions)) {
        if (!columns.has(name)) this.ctx.storage.sql.exec(`ALTER TABLE route ADD COLUMN ${name} ${definition}`);
      }
    });
  }

  begin(input: RoutedStep & { task: string; policy_version: string; policy_sha256: string;
    executor_contract_version: string; executor_contract_sha256: string; revas: RevasPolicy }): "created" | "exists" {
    return this.ctx.storage.transactionSync(() => {
      if (this.ctx.storage.sql.exec<{ present: number }>("SELECT 1 AS present FROM route WHERE singleton=1").toArray()[0]) return "exists";
      this.ctx.storage.sql.exec(
        `INSERT INTO route(singleton,provider,fallback_provider,permission_profile,action,fallback_action,max_steps,sequence,complete,task,policy_version,policy_sha256,executor_contract_version,executor_contract_sha256,revas_json)
         VALUES(1,?,?,?,?,?,?,1,0,?,?,?,?,?,?)`,
        input.provider, input.fallback_provider, input.permission_profile, input.action,
        input.fallback_action, input.max_steps, input.task, input.policy_version, input.policy_sha256,
        input.executor_contract_version, input.executor_contract_sha256, JSON.stringify(input.revas),
      );
      return "created";
    });
  }

  snapshot(sequence: number): RouteSnapshot {
    const row = this.ctx.storage.sql.exec<{
      task: string; provider: Provider; action: Action; permission_profile: PermissionProfile;
      policy_version: string; policy_sha256: string; executor_contract_version: string;
      executor_contract_sha256: string; revas_json: string; sequence: number; complete: number;
    }>(`SELECT task,provider,action,permission_profile,policy_version,policy_sha256,
      executor_contract_version,executor_contract_sha256,revas_json,sequence,complete FROM route WHERE singleton=1`).toArray()[0];
    if (!row || row.complete === 1 || row.sequence !== sequence) throw new Error("invalid route state");
    return { ...row, revas: JSON.parse(row.revas_json) as RevasPolicy };
  }

  advance(sequence: number, outcome: "pass" | "fail" | "retry", verifiedHash: string):
    | { status: "complete" }
    | { status: "failed" }
    | { status: "step"; provider: Provider; action: Action; permission_profile: PermissionProfile } {
    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql.exec<{
        provider: Provider; fallback_provider: Provider; permission_profile: PermissionProfile;
        action: Action; fallback_action: Action; max_steps: number; sequence: number; complete: number;
      }>("SELECT provider,fallback_provider,permission_profile,action,fallback_action,max_steps,sequence,complete FROM route WHERE singleton=1").toArray()[0];
      if (!row || row.complete === 1 || row.sequence !== sequence) throw new Error("invalid route state");
      if (outcome === "pass") {
        this.ctx.storage.sql.exec("UPDATE route SET complete=1,verified_artifact_hash=? WHERE singleton=1", verifiedHash);
        return { status: "complete" };
      }
      if (sequence >= row.max_steps) {
        this.ctx.storage.sql.exec("UPDATE route SET complete=1,verified_artifact_hash=? WHERE singleton=1", verifiedHash);
        return { status: "failed" };
      }
      const provider = row.fallback_provider;
      const action = outcome === "retry" ? row.action : row.fallback_action;
      const nextFallback = outcome === "retry" ? row.fallback_action : row.action;
      this.ctx.storage.sql.exec(
        "UPDATE route SET provider=?,fallback_provider=?,action=?,fallback_action=?,sequence=?,verified_artifact_hash=? WHERE singleton=1",
        provider, row.provider, action, nextFallback, sequence + 1, verifiedHash,
      );
      return { status: "step", provider, action, permission_profile: row.permission_profile };
    });
  }
}

export class RoutingBudgetState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS usage (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), week INTEGER NOT NULL,
        codex INTEGER NOT NULL, claude INTEGER NOT NULL)`);
    });
  }
  chooseAndRecord(step: Step, capacity: CapacityPlan): Provider {
    return this.ctx.storage.transactionSync(() => {
      const week = Math.floor(Date.now() / 604_800_000);
      let row = this.ctx.storage.sql.exec<{ week: number; codex: number; claude: number }>("SELECT week,codex,claude FROM usage WHERE singleton=1").toArray()[0];
      if (!row || row.week !== week) {
        this.ctx.storage.sql.exec("INSERT OR REPLACE INTO usage(singleton,week,codex,claude) VALUES(1,?,0,0)", week);
        row = { week, codex: 0, claude: 0 };
      }
      const provider = chooseCapacityAware(step, capacity, row);
      this.ctx.storage.sql.exec(`UPDATE usage SET ${provider}=${provider}+1 WHERE singleton=1`);
      return provider;
    });
  }
  record(provider: Provider): void {
    this.chooseAndRecord({ provider, fallback_provider: provider === "codex" ? "claude" : "codex",
      permission_profile: "workspace_write", max_steps: 1, budget_protected: true },
    provider === "codex" ? { codex: 100, claude: 0 } : { codex: 0, claude: 100 });
  }
}

async function subjectKey(subject: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subject));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function stepResponse(step: Pick<RoutedStep, "provider" | "action" | "permission_profile">): Response {
  return Response.json({ status: "step", provider: step.provider, action: step.action, permission_profile: step.permission_profile });
}
async function evaluate(env: Env, body: unknown): Promise<{ outcome: "pass" | "fail" | "retry"; verified_artifact_hash: string }> {
  const response = await env.RESULT_EVALUATOR.fetch(new Request("https://internal/evaluate", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  const bytes = await response.arrayBuffer();
  if (!response.ok || bytes.byteLength > 32_768) throw new Error("evaluation denied");
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown;
  if (!record(value) || !exact(value, ["outcome", "verified_artifact_hash"]) ||
    !["pass", "fail", "retry"].includes(String(value.outcome)) || typeof value.verified_artifact_hash !== "string" ||
    !SHA256.test(value.verified_artifact_hash)) throw new Error("evaluation denied");
  return value as { outcome: "pass" | "fail" | "retry"; verified_artifact_hash: string };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/decide") throw new Error("denied");
      const body = await request.json<unknown>();
      if (!record(body) || !exact(body, body.task === undefined ? ["execution_id", "previous", "version"] : ["execution_id", "principal", "task", "version"]) ||
        body.version !== 2 || typeof body.execution_id !== "string" || !UUID.test(body.execution_id)) throw new Error("denied");
      const state = env.ROUTES.getByName(body.execution_id);
      if (record(body.task)) {
        const task = body.task;
        if (!exact(task, ["capacity_plan", "content", "executor_contract_sha256", "executor_contract_version", "provider_preference", "trust"]) ||
          task.trust !== "untrusted_user_data" || typeof task.content !== "string" || task.content.length < 1 || task.content.length > 48_000 ||
          !["auto", "codex", "claude"].includes(String(task.provider_preference)) || typeof task.executor_contract_version !== "string" ||
          typeof task.executor_contract_sha256 !== "string" || !SHA256.test(task.executor_contract_sha256) ||
          !record(task.capacity_plan) || !exact(task.capacity_plan, ["claude", "codex"]) ||
          !Number.isSafeInteger(task.capacity_plan.codex) || !Number.isSafeInteger(task.capacity_plan.claude)) throw new Error("denied");
        const plan = task.capacity_plan as CapacityPlan;
        if (plan.codex < 0 || plan.codex > 100 || plan.claude < 0 || plan.claude > 100 || plan.codex + plan.claude === 0) throw new Error("denied");
        if (!record(body.principal) || !exact(body.principal, ["device_id", "subject"]) ||
          typeof body.principal.subject !== "string" || body.principal.subject.length < 1 || typeof body.principal.device_id !== "string") throw new Error("denied");
        const bundle = await loadPolicyBundle(env);
        if (task.executor_contract_version !== bundle.executor_contract.version || task.executor_contract_sha256 !== bundle.executor_contract.sha256) throw new Error("denied");
        const preference = task.provider_preference as ProviderPreference;
        const base = select(bundle.routing, task.content, preference);
        const budget = env.ROUTING_BUDGETS.getByName(await subjectKey(body.principal.subject));
        const provider = preference === "auto" ? await budget.chooseAndRecord(base, plan) : preference;
        if (preference !== "auto") await budget.record(provider);
        const selected: RoutedStep = { ...base, provider, fallback_provider: provider === "codex" ? "claude" : "codex",
          action: selectAction(base, provider, preference),
          fallback_action: preference === "auto" && base.budget_protected ? "agent_run_deep" : "agent_run" };
        if ((await state.begin({ ...selected, task: task.content, policy_version: bundle.policy_version,
          policy_sha256: env.POLICY_BUNDLE_SHA256, executor_contract_version: bundle.executor_contract.version,
          executor_contract_sha256: bundle.executor_contract.sha256, revas: bundle.revas })) !== "created") throw new Error("denied");
        return stepResponse(selected);
      }
      if (!record(body.previous) || !exact(body.previous, ["artifact_ref", "expected_artifact_hash", "sequence"]) ||
        !Number.isSafeInteger(body.previous.sequence) || typeof body.previous.artifact_ref !== "string" || !ARTIFACT_REF.test(body.previous.artifact_ref) ||
        typeof body.previous.expected_artifact_hash !== "string" || !SHA256.test(body.previous.expected_artifact_hash)) throw new Error("denied");
      const sequence = body.previous.sequence as number;
      const snapshot = await state.snapshot(sequence);
      const evaluated = await evaluate(env, {
        execution_id: body.execution_id, sequence, task: snapshot.task,
        expected_provider: snapshot.provider, expected_action: snapshot.action,
        expected_permission_profile: snapshot.permission_profile,
        policy_version: snapshot.policy_version, policy_sha256: snapshot.policy_sha256,
        executor_contract_version: snapshot.executor_contract_version,
        executor_contract_sha256: snapshot.executor_contract_sha256, revas: snapshot.revas,
        artifact_ref: body.previous.artifact_ref, expected_artifact_hash: body.previous.expected_artifact_hash,
      });
      if (evaluated.verified_artifact_hash !== body.previous.expected_artifact_hash) throw new Error("denied");
      const decision = await state.advance(sequence, evaluated.outcome, evaluated.verified_artifact_hash);
      return decision.status === "step" ? stepResponse(decision) : Response.json(decision);
    } catch {
      return Response.json({ error: "denied" }, { status: 400 });
    }
  },
} satisfies ExportedHandler<Env>;
