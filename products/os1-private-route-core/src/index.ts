import { DurableObject } from "cloudflare:workers";
import { appendCompletionObservation, completionFeedbackMatchesTask, validCompletionFeedback, validExecutionContext,
  type CompletionObservation, type ExecutionContext } from "./execution-context";
import { supportsCompletionFeedback } from "./capabilities";
import {
  executionProfileFor, loadPolicyBundle, parseExecutionProfiles,
  type ExecutionProfiles, type ExecutionProvider, type PolicyBundle,
} from "./bundle";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTE_ID = /^rcc-local-[0-9a-f]{32}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ARTIFACT_REF = /^r2:\/\/os1-private-results\/[0-9a-f-]{36}\/[1-9][0-9]{0,5}\/[0-9a-f]{64}\.json$/i;
const EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max", "ultra"]);
const VERIFICATION_PROFILES = new Set(["deterministic_exact", "executed_change", "executed_review", "source_review", "native_record"]);

type BackendProvider = "codex" | "claude";
type ProviderPreference = "auto" | BackendProvider;
type PermissionProfile = "read_only" | "workspace_write";
type CapacityPlan = { codex: number; claude: number };
type CodexModel = { slug: string; default_effort: string; supported_efforts: string[]; priority: number };
type RoutedStep = {
  provider: ExecutionProvider;
  action: string;
  permission_profile: PermissionProfile;
  max_steps: number;
  provider_pinned: boolean;
  route_id: string;
  verification_profile: string;
};
type RouteContext = {
  task: string;
  provider_preference: ProviderPreference;
  capacity_plan: CapacityPlan;
  available_codex_models: CodexModel[];
  execution_context?: ExecutionContext;
  current_run_observations?: CompletionObservation[];
  attempt: number;
};
type RouteSnapshot = RoutedStep & RouteContext & {
  expected_model: string;
  expected_effort: string;
  policy_version: string;
  policy_sha256: string;
  rcc_policy_sha256: string;
  executor_contract_version: string;
  executor_contract_sha256: string;
  sequence: number;
};

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validCatalog(value: unknown, allowEmpty = false): value is CodexModel[] {
  return Array.isArray(value) && value.length >= (allowEmpty ? 0 : 1) && value.length <= 32 &&
    new Set(value.map((item) => record(item) ? item.slug : undefined)).size === value.length &&
    value.every((item) => record(item) && exact(item, ["default_effort", "priority", "slug", "supported_efforts"]) &&
      typeof item.slug === "string" && MODEL.test(item.slug) && typeof item.default_effort === "string" &&
      EFFORTS.has(item.default_effort) && item.default_effort !== "none" &&
      Array.isArray(item.supported_efforts) && item.supported_efforts.length >= 1 && item.supported_efforts.length <= 6 &&
      new Set(item.supported_efforts).size === item.supported_efforts.length &&
      item.supported_efforts.every((effort) => typeof effort === "string" && EFFORTS.has(effort) && effort !== "none") &&
      item.supported_efforts.includes(item.default_effort) && Number.isSafeInteger(item.priority) &&
      (item.priority as number) >= 0 && (item.priority as number) <= 10_000);
}

async function boundedBindingJson(binding: Fetcher, path: string, body: unknown): Promise<unknown> {
  const response = await binding.fetch(new Request(`https://internal/${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  const bytes = await response.arrayBuffer();
  if (!response.ok || bytes.byteLength < 2 || bytes.byteLength > 32_768) throw new Error("private service denied");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown;
}

function profileAction(profiles: ExecutionProfiles, provider: ExecutionProvider, model: string, effort: string): string {
  const matches = Object.entries(profiles).filter(([, profile]) =>
    profile.provider === provider && profile.model === model && profile.effort === effort);
  if (matches.length !== 1) throw new Error("execution profile unavailable");
  return matches[0]![0];
}

async function routeWithRcc(env: Env, bundle: PolicyBundle, context: RouteContext, retryProvider = ""): Promise<RoutedStep | undefined> {
  const value = await boundedBindingJson(env.RCC_V26, "route", {
    prompt: context.task,
    policy_sha256: bundle.rcc.policy_sha256,
    provider_preference: context.provider_preference,
    codex_capacity: context.capacity_plan.codex,
    claude_capacity: context.capacity_plan.claude,
    attempt: context.attempt,
    retry_provider: retryProvider,
    available_codex_models: context.available_codex_models,
    ...(context.execution_context ? { execution_context: context.execution_context } : {}),
    ...(context.execution_context?.completion_feedback ? { current_run_observations: context.current_run_observations ?? [] } : {}),
  });
  if (context.execution_context?.completion_feedback && record(value) && exact(value, ["status", "policy_sha256"]) &&
    value.status === "no_eligible" && value.policy_sha256 === bundle.rcc.policy_sha256) return undefined;
  if (!record(value) || !exact(value, ["provider", "provider_pinned", "permission_profile", "model", "effort", "verification_profile", "route_id", "policy_sha256"]) ||
    !["local", "codex", "claude"].includes(String(value.provider)) || typeof value.provider_pinned !== "boolean" ||
    !["read_only", "workspace_write"].includes(String(value.permission_profile)) ||
    typeof value.model !== "string" || !MODEL.test(value.model) || typeof value.effort !== "string" || !EFFORTS.has(value.effort) ||
    typeof value.verification_profile !== "string" || !VERIFICATION_PROFILES.has(value.verification_profile) ||
    typeof value.route_id !== "string" || !ROUTE_ID.test(value.route_id) || value.policy_sha256 !== bundle.rcc.policy_sha256) {
    throw new Error("private route denied");
  }
  const provider = value.provider as ExecutionProvider;
  return {
    provider,
    action: profileAction(bundle.execution_profiles, provider, value.model, value.effort),
    permission_profile: value.permission_profile as PermissionProfile,
    max_steps: bundle.maximum_steps,
    provider_pinned: value.provider_pinned,
    route_id: value.route_id,
    verification_profile: value.verification_profile,
  };
}

export class RouteState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS route (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), provider TEXT NOT NULL, action TEXT NOT NULL,
        permission_profile TEXT NOT NULL, max_steps INTEGER NOT NULL, provider_pinned INTEGER NOT NULL,
        route_id TEXT NOT NULL, verification_profile TEXT NOT NULL, task TEXT NOT NULL,
        provider_preference TEXT NOT NULL, codex_capacity INTEGER NOT NULL, claude_capacity INTEGER NOT NULL,
        codex_catalog_json TEXT NOT NULL, attempt INTEGER NOT NULL, sequence INTEGER NOT NULL,
        complete INTEGER NOT NULL DEFAULT 0, policy_version TEXT NOT NULL, policy_sha256 TEXT NOT NULL,
        rcc_policy_sha256 TEXT NOT NULL, executor_contract_version TEXT NOT NULL,
        executor_contract_sha256 TEXT NOT NULL, execution_profiles_json TEXT NOT NULL,
        verified_artifact_hash TEXT)`);
      const columns = this.ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(route)").toArray();
      if (!columns.some(column => column.name === "execution_context_json")) {
        this.ctx.storage.sql.exec("ALTER TABLE route ADD COLUMN execution_context_json TEXT");
      }
      if (!columns.some(column => column.name === "current_run_observations_json")) {
        this.ctx.storage.sql.exec("ALTER TABLE route ADD COLUMN current_run_observations_json TEXT");
      }
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS decisions (sequence INTEGER PRIMARY KEY, artifact_hash TEXT NOT NULL, response_json TEXT NOT NULL)");
    });
  }

  begin(input: RoutedStep & RouteContext & { policy_version: string; policy_sha256: string; rcc_policy_sha256: string;
    executor_contract_version: string; executor_contract_sha256: string; execution_profiles: ExecutionProfiles }): "created" | "exists" {
    return this.ctx.storage.transactionSync(() => {
      if (this.ctx.storage.sql.exec<{ present: number }>("SELECT 1 AS present FROM route WHERE singleton=1").toArray()[0]) return "exists";
      this.ctx.storage.sql.exec(
        `INSERT INTO route(singleton,provider,action,permission_profile,max_steps,provider_pinned,route_id,verification_profile,
         task,provider_preference,codex_capacity,claude_capacity,codex_catalog_json,attempt,sequence,complete,
         policy_version,policy_sha256,rcc_policy_sha256,executor_contract_version,executor_contract_sha256,execution_profiles_json)
         VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,?,?,?,?,?,?)`,
        input.provider, input.action, input.permission_profile, input.max_steps, input.provider_pinned ? 1 : 0,
        input.route_id, input.verification_profile, input.task, input.provider_preference,
        input.capacity_plan.codex, input.capacity_plan.claude, JSON.stringify(input.available_codex_models), input.attempt,
        input.policy_version, input.policy_sha256, input.rcc_policy_sha256,
        input.executor_contract_version, input.executor_contract_sha256, JSON.stringify(input.execution_profiles),
      );
      if (input.execution_context) this.ctx.storage.sql.exec(
        "UPDATE route SET execution_context_json=? WHERE singleton=1", JSON.stringify(input.execution_context));
      return "created";
    });
  }

  recordedDecision(sequence: number, hash: string): unknown | null {
    const row = this.ctx.storage.sql.exec<{ artifact_hash: string; response_json: string }>(
      "SELECT * FROM decisions WHERE sequence=?", sequence).toArray()[0];
    if (!row) return null;
    if (row.artifact_hash !== hash) throw new Error("result binding mismatch");
    return JSON.parse(row.response_json);
  }

  snapshot(sequence: number): RouteSnapshot {
    const row = this.ctx.storage.sql.exec<Record<string, string | number>>("SELECT * FROM route WHERE singleton=1").toArray()[0];
    if (!row || row.complete === 1 || row.sequence !== sequence) throw new Error("invalid route state");
    const provider = String(row.provider) as ExecutionProvider;
    const action = String(row.action);
    const profiles = parseExecutionProfiles(JSON.parse(String(row.execution_profiles_json)) as unknown);
    const expected = executionProfileFor(profiles, provider, action);
    const catalog = JSON.parse(String(row.codex_catalog_json)) as unknown;
    const executionContext: unknown = row.execution_context_json ? JSON.parse(String(row.execution_context_json)) : undefined;
    if (executionContext !== undefined && !validExecutionContext(executionContext)) throw new Error("invalid route context");
    if (!validCatalog(catalog, Boolean((executionContext as ExecutionContext | undefined)?.completion_feedback))) throw new Error("invalid route state");
    const currentRun: unknown = row.current_run_observations_json ? JSON.parse(String(row.current_run_observations_json)) : [];
    if (!Array.isArray(currentRun) || currentRun.length > 4 || !validCompletionFeedback({ schema: 1,
      objective_sha256: "0".repeat(64), observations: currentRun })) throw new Error("invalid current run observations");
    return {
      provider, action, permission_profile: String(row.permission_profile) as PermissionProfile,
      max_steps: Number(row.max_steps), provider_pinned: Number(row.provider_pinned) === 1,
      route_id: String(row.route_id), verification_profile: String(row.verification_profile),
      task: String(row.task), provider_preference: String(row.provider_preference) as ProviderPreference,
      capacity_plan: { codex: Number(row.codex_capacity), claude: Number(row.claude_capacity) },
      available_codex_models: catalog, attempt: Number(row.attempt), sequence: Number(row.sequence),
      ...(executionContext ? { execution_context: executionContext as ExecutionContext } : {}),
      current_run_observations: currentRun as CompletionObservation[],
      expected_model: expected.model, expected_effort: expected.effort,
      policy_version: String(row.policy_version), policy_sha256: String(row.policy_sha256),
      rcc_policy_sha256: String(row.rcc_policy_sha256),
      executor_contract_version: String(row.executor_contract_version),
      executor_contract_sha256: String(row.executor_contract_sha256),
    };
  }

  advance(sequence: number, outcome: "pass" | "fail" | "retry", verifiedHash: string, next?: RoutedStep,
    executionContext?: ExecutionContext, currentRun?: CompletionObservation[]):
    | { status: "complete" } | { status: "failed" }
    | { status: "step"; provider: ExecutionProvider; action: string; permission_profile: PermissionProfile } {
    return this.ctx.storage.transactionSync(() => {
      const recorded = this.recordedDecision(sequence, verifiedHash);
      if (recorded) return recorded as ReturnType<RouteState["advance"]>;
      const persist = <T>(value: T): T => {
        this.ctx.storage.sql.exec("INSERT INTO decisions VALUES(?,?,?)", sequence, verifiedHash, JSON.stringify(value));
        return value;
      };
      const row = this.ctx.storage.sql.exec<{ max_steps: number; sequence: number; complete: number }>(
        "SELECT max_steps,sequence,complete FROM route WHERE singleton=1",
      ).toArray()[0];
      if (!row || row.complete === 1 || row.sequence !== sequence) throw new Error("invalid route state");
      if (executionContext) this.ctx.storage.sql.exec(
        "UPDATE route SET execution_context_json=? WHERE singleton=1", JSON.stringify(executionContext));
      if (currentRun) this.ctx.storage.sql.exec(
        "UPDATE route SET current_run_observations_json=? WHERE singleton=1", JSON.stringify(currentRun));
      if (outcome === "pass") {
        this.ctx.storage.sql.exec("UPDATE route SET complete=1,verified_artifact_hash=? WHERE singleton=1", verifiedHash);
        return persist({ status: "complete" as const });
      }
      if (outcome === "fail" || sequence >= row.max_steps || !next) {
        this.ctx.storage.sql.exec("UPDATE route SET complete=1,verified_artifact_hash=? WHERE singleton=1", verifiedHash);
        return persist({ status: "failed" as const });
      }
      this.ctx.storage.sql.exec(
        `UPDATE route SET provider=?,action=?,permission_profile=?,provider_pinned=?,route_id=?,verification_profile=?,
         attempt=?,sequence=?,verified_artifact_hash=? WHERE singleton=1`,
        next.provider, next.action, next.permission_profile, next.provider_pinned ? 1 : 0, next.route_id,
        next.verification_profile, sequence + 1, sequence + 1, verifiedHash,
      );
      return persist({ status: "step" as const, provider: next.provider, action: next.action, permission_profile: next.permission_profile });
    });
  }
}

export class RoutingBudgetState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS start_budget (window INTEGER PRIMARY KEY, starts INTEGER NOT NULL)");
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS usage (singleton INTEGER PRIMARY KEY CHECK(singleton=1), week INTEGER NOT NULL, codex INTEGER NOT NULL, claude INTEGER NOT NULL)");
    });
  }
  consumeStart(limit: number): boolean {
    return this.ctx.storage.transactionSync(() => {
      const window = Math.floor(Date.now() / 3_600_000);
      this.ctx.storage.sql.exec("DELETE FROM start_budget WHERE window < ?", window - 1);
      const row = this.ctx.storage.sql.exec<{ starts: number }>("SELECT starts FROM start_budget WHERE window=?", window).toArray()[0];
      if ((row?.starts ?? 0) >= limit) return false;
      this.ctx.storage.sql.exec("INSERT INTO start_budget(window,starts) VALUES(?,1) ON CONFLICT(window) DO UPDATE SET starts=starts+1", window);
      return true;
    });
  }
  record(provider: BackendProvider): void {
    this.ctx.storage.transactionSync(() => {
      const week = Math.floor(Date.now() / 604_800_000);
      const row = this.ctx.storage.sql.exec<{ week: number }>("SELECT week FROM usage WHERE singleton=1").toArray()[0];
      if (!row || row.week !== week) this.ctx.storage.sql.exec("INSERT OR REPLACE INTO usage(singleton,week,codex,claude) VALUES(1,?,0,0)", week);
      this.ctx.storage.sql.exec(`UPDATE usage SET ${provider}=${provider}+1 WHERE singleton=1`);
    });
  }
}

async function subjectKey(subject: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subject));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function budgetObjectName(env: Env, subject: string): Promise<string> {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(env.ROUTING_BUDGET_EPOCH)) {
    throw new Error("invalid private configuration");
  }
  return `${env.ROUTING_BUDGET_EPOCH}:${await subjectKey(subject)}`;
}
function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("invalid private configuration");
  return parsed;
}
function stepResponse(step: Pick<RoutedStep, "provider" | "action" | "permission_profile">): Response {
  return Response.json({ status: "step", provider: step.provider, action: step.action, permission_profile: step.permission_profile });
}
async function evaluate(env: Env, body: unknown): Promise<{ outcome: "pass" | "fail" | "retry"; verified_artifact_hash: string; next_provider: ExecutionProvider }> {
  const value = await boundedBindingJson(env.RESULT_EVALUATOR, "evaluate", body);
  if (!record(value) || !exact(value, ["outcome", "verified_artifact_hash", "next_provider"]) ||
    !["pass", "fail", "retry"].includes(String(value.outcome)) || typeof value.verified_artifact_hash !== "string" ||
    !SHA256.test(value.verified_artifact_hash) || !["local", "codex", "claude"].includes(String(value.next_provider))) {
    throw new Error("evaluation denied");
  }
  return value as { outcome: "pass" | "fail" | "retry"; verified_artifact_hash: string; next_provider: ExecutionProvider };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const stage = { current: "request" };
    try {
      if (request.method === "GET" && new URL(request.url).pathname === "/capabilities") {
        const bundle = await loadPolicyBundle(env);
        const supported = await supportsCompletionFeedback(env.RCC_V26, bundle.rcc.policy_sha256);
        return Response.json({ completion_feedback_schema: supported ? 1 : null }, {
          headers: { "cache-control": "no-store" },
        });
      }
      if (request.method !== "POST" || new URL(request.url).pathname !== "/decide") throw new Error("denied");
      stage.current = "parse";
      const body = await request.json<unknown>();
      if (!record(body) || !exact(body, body.task === undefined ? ["execution_id", "previous", "version"] : ["execution_id", "principal", "task", "version"]) ||
        body.version !== 3 || typeof body.execution_id !== "string" || !UUID.test(body.execution_id)) throw new Error("denied");
      const state = env.ROUTES.getByName(body.execution_id);
      if (record(body.task)) {
        stage.current = "validate_start";
        const task = body.task;
        if (!exact(task, ["available_codex_models", "capacity_plan", "content", "executor_contract_sha256", "executor_contract_version", "provider_preference", "trust",
          ...(task.execution_context !== undefined ? ["execution_context"] : [])]) ||
          task.trust !== "untrusted_user_data" || typeof task.content !== "string" || task.content.length < 1 || task.content.length > 48_000 ||
          !["auto", "codex", "claude"].includes(String(task.provider_preference)) || typeof task.executor_contract_version !== "string" ||
          typeof task.executor_contract_sha256 !== "string" || !SHA256.test(task.executor_contract_sha256) ||
          !record(task.capacity_plan) || !exact(task.capacity_plan, ["claude", "codex"]) ||
          !Number.isSafeInteger(task.capacity_plan.codex) || !Number.isSafeInteger(task.capacity_plan.claude) ||
          !validCatalog(task.available_codex_models, validExecutionContext(task.execution_context) && Boolean(task.execution_context.completion_feedback)) ||
          (task.execution_context !== undefined && !validExecutionContext(task.execution_context))) throw new Error("denied");
        const plan = task.capacity_plan as CapacityPlan;
        if (plan.codex < 0 || plan.codex > 100 || plan.claude < 0 || plan.claude > 100 || plan.codex + plan.claude === 0) throw new Error("denied");
        if (!record(body.principal) || !exact(body.principal, ["device_id", "subject"]) ||
          typeof body.principal.subject !== "string" || body.principal.subject.length < 1 || typeof body.principal.device_id !== "string") throw new Error("denied");
        if (!(await completionFeedbackMatchesTask(task.execution_context as ExecutionContext | undefined, task.content))) throw new Error("denied");
        stage.current = "budget";
        const budget = env.ROUTING_BUDGETS.getByName(await budgetObjectName(env, body.principal.subject));
        if (!(await budget.consumeStart(positiveInteger(env.MAX_ROUTE_STARTS_PER_HOUR)))) throw new Error("denied");
        stage.current = "policy";
        const bundle = await loadPolicyBundle(env);
        const executorContract = bundle.executor_contracts.find((contract) => contract.version === task.executor_contract_version && contract.sha256 === task.executor_contract_sha256);
        if (!executorContract) throw new Error("denied");
        const context: RouteContext = {
          task: task.content, provider_preference: task.provider_preference as ProviderPreference,
          capacity_plan: plan, available_codex_models: task.available_codex_models, attempt: 1,
          ...(task.execution_context ? { execution_context: task.execution_context as ExecutionContext } : {}),
        };
        stage.current = "route";
        const selected = await routeWithRcc(env, bundle, context);
        if (!selected) return Response.json({ status: "failed" });
        stage.current = "usage";
        if (selected.provider !== "local") await budget.record(selected.provider);
        stage.current = "persist";
        if ((await state.begin({ ...selected, ...context, policy_version: bundle.policy_version,
          policy_sha256: env.POLICY_BUNDLE_SHA256, rcc_policy_sha256: bundle.rcc.policy_sha256,
          executor_contract_version: executorContract.version, executor_contract_sha256: executorContract.sha256,
          execution_profiles: bundle.execution_profiles })) !== "created") throw new Error("denied");
        return stepResponse(selected);
      }
      stage.current = "validate_result";
      if (!record(body.previous) || !exact(body.previous, ["artifact_ref", "expected_artifact_hash", "sequence"]) ||
        !Number.isSafeInteger(body.previous.sequence) || typeof body.previous.artifact_ref !== "string" || !ARTIFACT_REF.test(body.previous.artifact_ref) ||
        typeof body.previous.expected_artifact_hash !== "string" || !SHA256.test(body.previous.expected_artifact_hash)) throw new Error("denied");
      const sequence = body.previous.sequence as number;
      const recorded = await state.recordedDecision(sequence, body.previous.expected_artifact_hash);
      if (recorded) return Response.json(recorded);
      const snapshot = await state.snapshot(sequence);
      const evaluated = await evaluate(env, {
        execution_id: body.execution_id, sequence, task: snapshot.task,
        expected_provider: snapshot.provider, expected_action: snapshot.action,
        expected_permission_profile: snapshot.permission_profile,
        expected_model: snapshot.expected_model, expected_effort: snapshot.expected_effort,
        policy_version: snapshot.policy_version, policy_sha256: snapshot.policy_sha256,
        rcc_policy_sha256: snapshot.rcc_policy_sha256, route_id: snapshot.route_id,
        verification_profile: snapshot.verification_profile, provider_pinned: snapshot.provider_pinned,
        executor_contract_version: snapshot.executor_contract_version,
        executor_contract_sha256: snapshot.executor_contract_sha256,
        artifact_ref: body.previous.artifact_ref, expected_artifact_hash: body.previous.expected_artifact_hash,
      });
      if (evaluated.verified_artifact_hash !== body.previous.expected_artifact_hash) throw new Error("denied");
      const observation: CompletionObservation | undefined = snapshot.provider === "local" ? undefined : {
          provider: snapshot.provider, model: snapshot.expected_model, effort: snapshot.expected_effort,
          outcome: evaluated.outcome === "pass" ? "adopted" : "quality_failure",
          input_tokens: null, output_tokens: null, duration_ms: null,
        };
      const executionContext = observation ? appendCompletionObservation(snapshot.execution_context, observation) : snapshot.execution_context;
      // This separate server-owned list avoids confusing historical provider
      // failures with current-run steps after a local deterministic execution.
      const currentRun = executionContext?.completion_feedback && observation ?
        [...(snapshot.current_run_observations ?? []), observation].slice(-4) : snapshot.current_run_observations;
      let next: RoutedStep | undefined;
      if (evaluated.outcome === "retry" && sequence < snapshot.max_steps) {
        // Continue the policy already locked in trusted persisted state, not a
        // newer deployment's policy. The immutable bundle loader rechecks SHA.
        const bundle = await loadPolicyBundle(env, snapshot.policy_sha256);
        if (bundle.rcc.policy_sha256 !== snapshot.rcc_policy_sha256) throw new Error("policy changed during execution");
        const context: RouteContext = { task: snapshot.task, provider_preference: snapshot.provider_preference,
          capacity_plan: snapshot.capacity_plan, available_codex_models: snapshot.available_codex_models,
          execution_context: executionContext, current_run_observations: currentRun, attempt: sequence + 1 };
        const retryProvider = evaluated.next_provider === "local" ? "" : evaluated.next_provider;
        next = await routeWithRcc(env, bundle, context, retryProvider);
      }
      const decision = await state.advance(sequence, evaluated.outcome, evaluated.verified_artifact_hash, next, executionContext, currentRun);
      return decision.status === "step" ? stepResponse(decision) : Response.json(decision);
    } catch {
      console.error(JSON.stringify({ event: "private_route_denied", stage: stage.current }));
      return Response.json({ error: "denied" }, { status: 400 });
    }
  },
} satisfies ExportedHandler<Env>;
