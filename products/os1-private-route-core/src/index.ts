import { DurableObject } from "cloudflare:workers";
import {
  parsePolicy,
  select,
  type PermissionProfile,
  type Provider,
  type ProviderPreference,
  type CapacityPlan,
  type Step,
  type Action,
  chooseCapacityAware,
  selectAction,
} from "./policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RoutedStep = Step & {
  action: Action;
  fallback_action: Action;
};

export class RouteState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS route (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1),
          provider TEXT NOT NULL,
          fallback_provider TEXT NOT NULL,
          permission_profile TEXT NOT NULL,
          action TEXT NOT NULL DEFAULT 'agent_run',
          fallback_action TEXT NOT NULL DEFAULT 'agent_run',
          max_steps INTEGER NOT NULL,
          sequence INTEGER NOT NULL,
          complete INTEGER NOT NULL DEFAULT 0
        )
      `);
      const columns = new Set(
        this.ctx.storage.sql
          .exec<{ name: string }>("PRAGMA table_info(route)")
          .toArray()
          .map((column) => column.name),
      );
      if (!columns.has("action")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE route ADD COLUMN action TEXT NOT NULL DEFAULT 'agent_run'",
        );
      }
      if (!columns.has("fallback_action")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE route ADD COLUMN fallback_action TEXT NOT NULL DEFAULT 'agent_run'",
        );
      }
    });
  }

  begin(step: RoutedStep): "created" | "exists" {
    return this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql
        .exec<{ present: number }>("SELECT 1 AS present FROM route WHERE singleton=1")
        .toArray()[0];
      if (existing) return "exists";
      this.ctx.storage.sql.exec(
        "INSERT INTO route(singleton,provider,fallback_provider,permission_profile,action,fallback_action,max_steps,sequence,complete) VALUES(1,?,?,?,?,?,?,1,0)",
        step.provider,
        step.fallback_provider,
        step.permission_profile,
        step.action,
        step.fallback_action,
        step.max_steps,
      );
      return "created";
    });
  }

  advance(sequence: number, outcome: "pass" | "fail" | "retry"):
    | { status: "complete" }
    | { status: "step"; provider: Provider; action: Action; permission_profile: PermissionProfile } {
    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql
        .exec<{
          provider: Provider;
          fallback_provider: Provider;
          permission_profile: PermissionProfile;
          action: Action;
          fallback_action: Action;
          max_steps: number;
          sequence: number;
          complete: number;
        }>("SELECT provider,fallback_provider,permission_profile,action,fallback_action,max_steps,sequence,complete FROM route WHERE singleton=1")
        .toArray()[0];
      if (!row || row.complete === 1 || row.sequence !== sequence) {
        throw new Error("invalid route state");
      }
      if (outcome === "pass" || sequence >= row.max_steps) {
        this.ctx.storage.sql.exec("UPDATE route SET complete=1 WHERE singleton=1");
        return { status: "complete" };
      }
      const provider = row.fallback_provider;
      const action = row.fallback_action;
      this.ctx.storage.sql.exec(
        "UPDATE route SET provider=?,fallback_provider=?,action=?,fallback_action=?,sequence=? WHERE singleton=1",
        provider,
        row.provider,
        action,
        row.action,
        sequence + 1,
      );
      return { status: "step", provider, action, permission_profile: row.permission_profile };
    });
  }
}

export class RoutingBudgetState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS usage (
          singleton INTEGER PRIMARY KEY CHECK(singleton=1),
          week INTEGER NOT NULL,
          codex INTEGER NOT NULL,
          claude INTEGER NOT NULL
        )
      `);
    });
  }

  chooseAndRecord(step: Step, capacity: CapacityPlan): Provider {
    return this.ctx.storage.transactionSync(() => {
      const week = Math.floor(Date.now() / 604_800_000);
      let row = this.ctx.storage.sql
        .exec<{ week: number; codex: number; claude: number }>(
          "SELECT week,codex,claude FROM usage WHERE singleton=1",
        ).toArray()[0];
      if (!row || row.week !== week) {
        this.ctx.storage.sql.exec(
          "INSERT OR REPLACE INTO usage(singleton,week,codex,claude) VALUES(1,?,0,0)",
          week,
        );
        row = { week, codex: 0, claude: 0 };
      }
      const provider = chooseCapacityAware(step, capacity, row);
      this.ctx.storage.sql.exec(
        `UPDATE usage SET ${provider}=${provider}+1 WHERE singleton=1`,
      );
      return provider;
    });
  }

  record(provider: Provider): void {
    const step: Step = {
      provider,
      fallback_provider: provider === "codex" ? "claude" : "codex",
      permission_profile: "workspace_write",
      max_steps: 1,
      budget_protected: true,
    };
    const capacity = provider === "codex"
      ? { codex: 100, claude: 0 }
      : { codex: 0, claude: 100 };
    this.chooseAndRecord(step, capacity);
  }
}

async function subjectKey(subject: string): Promise<string> {
  const bytes = new TextEncoder().encode(subject);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stepResponse(step: Pick<RoutedStep, "provider" | "action" | "permission_profile">): Response {
  return Response.json({
    status: "step",
    provider: step.provider,
    action: step.action,
    permission_profile: step.permission_profile,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/decide") {
        throw new Error("denied");
      }
      const body = await request.json<unknown>();
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("denied");
      const value = body as Record<string, unknown>;
      if (typeof value.execution_id !== "string" || !UUID.test(value.execution_id)) throw new Error("denied");
      const state = env.ROUTES.getByName(value.execution_id);

      if (typeof value.task === "object" && value.task !== null && !Array.isArray(value.task)) {
        const task = value.task as Record<string, unknown>;
        const taskKeys = Object.keys(task).sort();
        const capacity = task.capacity_plan;
        const legacyTask = taskKeys.length === 3 &&
          taskKeys[0] === "content" &&
          taskKeys[1] === "provider_preference" &&
          taskKeys[2] === "trust";
        const capacityTask = taskKeys.length === 4 &&
          taskKeys[0] === "capacity_plan" &&
          taskKeys[1] === "content" &&
          taskKeys[2] === "provider_preference" &&
          taskKeys[3] === "trust";
        if (
          (!legacyTask && !capacityTask) ||
          task.trust !== "untrusted_user_data" ||
          typeof task.content !== "string" ||
          task.content.length < 1 ||
          task.content.length > 48_000 ||
          !["auto", "codex", "claude"].includes(String(task.provider_preference)) ||
          (capacityTask && (
            typeof capacity !== "object" || capacity === null || Array.isArray(capacity) ||
            !Number.isSafeInteger((capacity as Record<string, unknown>).codex) ||
            !Number.isSafeInteger((capacity as Record<string, unknown>).claude)
          ))
        ) {
          throw new Error("denied");
        }
        const base = select(
          parsePolicy(env.PRIVATE_ROUTE_POLICY_JSON),
          task.content,
          task.provider_preference as ProviderPreference,
        );
        const principal = value.principal as Record<string, unknown> | undefined;
        if (!principal || typeof principal.subject !== "string" || principal.subject.length < 1) {
          throw new Error("denied");
        }
        const plan: CapacityPlan = capacityTask
          ? capacity as CapacityPlan
          : { codex: 50, claude: 50 };
        if (plan.codex < 0 || plan.codex > 100 || plan.claude < 0 || plan.claude > 100 || plan.codex + plan.claude === 0) {
          throw new Error("denied");
        }
        const budget = env.ROUTING_BUDGETS.getByName(await subjectKey(principal.subject));
        const provider = task.provider_preference === "auto"
          ? await budget.chooseAndRecord(base, plan)
          : task.provider_preference as Provider;
        if (task.provider_preference !== "auto") await budget.record(provider);
        const action = selectAction(
          base,
          provider,
          task.provider_preference as ProviderPreference,
        );
        const fallbackAction: Action = task.provider_preference === "auto" && base.budget_protected
          ? "agent_run_deep"
          : "agent_run";
        const selected: RoutedStep = {
          ...base,
          provider,
          fallback_provider: provider === "codex" ? "claude" : "codex",
          action,
          fallback_action: fallbackAction,
        };
        if ((await state.begin(selected)) !== "created") throw new Error("denied");
        return stepResponse(selected);
      }
      if (typeof value.previous === "object" && value.previous !== null && !Array.isArray(value.previous)) {
        const previous = value.previous as Record<string, unknown>;
        if (
          !Number.isSafeInteger(previous.sequence) ||
          !["pass", "fail", "retry"].includes(String(previous.outcome))
        ) {
          throw new Error("denied");
        }
        const decision = await state.advance(
          previous.sequence as number,
          previous.outcome as "pass" | "fail" | "retry",
        );
        return decision.status === "complete" ? Response.json(decision) : stepResponse(decision);
      }
      throw new Error("denied");
    } catch {
      return Response.json({ error: "denied" }, { status: 400 });
    }
  },
} satisfies ExportedHandler<Env>;
