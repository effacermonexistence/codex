import { DurableObject } from "cloudflare:workers";
import {
  parsePolicy,
  select,
  type PermissionProfile,
  type Provider,
  type ProviderPreference,
  type Step,
} from "./policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
          max_steps INTEGER NOT NULL,
          sequence INTEGER NOT NULL,
          complete INTEGER NOT NULL DEFAULT 0
        )
      `);
    });
  }

  begin(step: Step): "created" | "exists" {
    return this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql
        .exec<{ present: number }>("SELECT 1 AS present FROM route WHERE singleton=1")
        .toArray()[0];
      if (existing) return "exists";
      this.ctx.storage.sql.exec(
        "INSERT INTO route(singleton,provider,fallback_provider,permission_profile,max_steps,sequence,complete) VALUES(1,?,?,?,?,1,0)",
        step.provider,
        step.fallback_provider,
        step.permission_profile,
        step.max_steps,
      );
      return "created";
    });
  }

  advance(sequence: number, outcome: "pass" | "fail" | "retry"):
    | { status: "complete" }
    | { status: "step"; provider: Provider; permission_profile: PermissionProfile } {
    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql
        .exec<{
          provider: Provider;
          fallback_provider: Provider;
          permission_profile: PermissionProfile;
          max_steps: number;
          sequence: number;
          complete: number;
        }>("SELECT provider,fallback_provider,permission_profile,max_steps,sequence,complete FROM route WHERE singleton=1")
        .toArray()[0];
      if (!row || row.complete === 1 || row.sequence !== sequence) {
        throw new Error("invalid route state");
      }
      if (outcome === "pass" || sequence >= row.max_steps) {
        this.ctx.storage.sql.exec("UPDATE route SET complete=1 WHERE singleton=1");
        return { status: "complete" };
      }
      const provider = row.fallback_provider;
      this.ctx.storage.sql.exec(
        "UPDATE route SET provider=?,fallback_provider=?,sequence=? WHERE singleton=1",
        provider,
        row.provider,
        sequence + 1,
      );
      return { status: "step", provider, permission_profile: row.permission_profile };
    });
  }
}

function stepResponse(step: Pick<Step, "provider" | "permission_profile">): Response {
  return Response.json({
    status: "step",
    provider: step.provider,
    action: "agent_run",
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
        if (
          taskKeys.length !== 3 ||
          taskKeys[0] !== "content" ||
          taskKeys[1] !== "provider_preference" ||
          taskKeys[2] !== "trust" ||
          task.trust !== "untrusted_user_data" ||
          typeof task.content !== "string" ||
          task.content.length < 1 ||
          task.content.length > 48_000 ||
          !["auto", "codex", "claude"].includes(String(task.provider_preference))
        ) {
          throw new Error("denied");
        }
        const selected = select(
          parsePolicy(env.PRIVATE_ROUTE_POLICY_JSON),
          task.content,
          task.provider_preference as ProviderPreference,
        );
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
