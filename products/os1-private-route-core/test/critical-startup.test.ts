import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
import service from "../src/index";

const hex = (value: string) => value.repeat(64);
const executionID = "00000000-0000-4000-8000-000000000001";
const task = "Read the selected marker without changing anything.";
const objective = createHash("sha256").update(task).digest("hex");
const bundle = { schema: 4, policy_version: "critical-policy-test-v1", maximum_steps: 4,
  executor_contracts: [{ version: "executor-test-v1", sha256: hex("b") }],
  execution_profiles: { exact: { provider: "local", model: "local-deterministic", effort: "none" },
    cx_low: { provider: "codex", model: "gpt-test", effort: "low" },
    cx_medium: { provider: "codex", model: "gpt-test", effort: "medium" },
    cl_medium: { provider: "claude", model: "claude-test", effort: "medium" },
    cl_high: { provider: "claude", model: "claude-test", effort: "high" } },
  rcc: { adapter_version: "adapter-test-v1", policy_sha256: hex("c"), engine_sha256: hex("d"), authority_sha256: hex("e") } };
const bytes = new TextEncoder().encode(JSON.stringify(bundle));
const policy = createHash("sha256").update(bytes).digest("hex");
function input(required: unknown = 1) {
  return { version: 3, execution_id: executionID, required_startup_contract: required,
    principal: { subject: "fixture", device_id: "fixture-device" }, task: {
      content: task, trust: "untrusted_user_data", provider_preference: "codex", capacity_plan: { codex: 30, claude: 0 },
      executor_contract_version: "executor-test-v1", executor_contract_sha256: hex("b"),
      available_codex_models: [{ slug: "gpt-test", default_effort: "medium", supported_efforts: ["medium"], priority: 1 }],
      execution_context: { input_utf8_bytes: 1_000, source_utf8_bytes: 0, history_utf8_bytes: 0,
        available_claude_models: [], completion_feedback: { schema: 1, objective_sha256: objective, observations: [] } },
    } };
}
function fixture(capability: unknown, capStatus = 200) {
  let caps = 0, routes = 0, persisted = 0, oldLookups = 0;
  const env = { ROUTING_BUDGET_EPOCH: "fixture", MAX_ROUTE_STARTS_PER_HOUR: "10",
    ROUTES: { getByName: () => { oldLookups++; return {}; } },
    ROUTE_POOLS: { getByName: (name: string) => {
      expect(name).toBe("startup-v1");
      return { begin: async (id: string, value: any) => {
        expect(id).toBe(executionID); expect(value.required_startup_contract).toBe(1); persisted++; return "created";
      } };
    } },
    ROUTING_BUDGETS: { getByName: () => ({ consumeStart: async () => true, learningRows: async () => [], record: async () => {} }) },
    POLICY_BUNDLE_KEY: `os1/policies/${policy}.json`, POLICY_BUNDLE_SHA256: policy, MAX_POLICY_BUNDLE_BYTES: "65536",
    POLICY_BUNDLES: { get: async () => ({ size: bytes.length, arrayBuffer: async () => bytes.buffer }) },
    RCC_V26: { fetch: async (request: Request | string) => {
      if (typeof request === "string") { caps++; return Response.json(capability, { status: capStatus }); }
      routes++;
      const value = await request.json() as any;
      expect(value.policy_sha256).toBe(bundle.rcc.policy_sha256);
      expect(value.execution_context.completion_feedback.objective_sha256).toBe(objective);
      return Response.json({ provider: "codex", model: "gpt-test", effort: "medium", provider_pinned: true,
        permission_profile: "read_only", verification_profile: "executed_review", route_id: "rcc-local-" + "0".repeat(32),
        policy_sha256: bundle.rcc.policy_sha256 });
    } },
  } as unknown as Env;
  return { env, counts: () => ({ caps, routes, persisted, oldLookups }) };
}
async function call(env: Env, body: unknown) {
  return service.fetch(new Request("https://private/decide", { method: "POST", body: JSON.stringify(body) }), env);
}
describe("critical startup source-bound capability and typed pooled receipt", () => {
  it("requires actual pinned support before routing; preserves exact model and contract in the receipt", async () => {
    const f = fixture({ completion_feedback_schema: 1, model_availability_schema: 1,
      route_learning_schema: 3, policy_sha256: bundle.rcc.policy_sha256 });
    const response = await call(f.env, input());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "step", provider: "codex", action: "cx_medium", permission_profile: "read_only",
      startup_contract: { schema: 1, completion_feedback_schema: 1, model_availability_schema: 1,
        executor_contract_sha256: hex("b"), model: "gpt-test", effort: "medium", state_storage: "pool_v1" } });
    expect(f.counts()).toEqual({ caps: 1, routes: 1, persisted: 1, oldLookups: 0 });
    await call(f.env, input());
    expect(f.counts().caps).toBe(1); // Positive metadata only, actual route executes again.
    expect(f.counts().routes).toBe(2);
  });
  it.each([
    [{ completion_feedback_schema: 1, model_availability_schema: 1, policy_sha256: hex("f") }, 200],
    [{ completion_feedback_schema: true, model_availability_schema: 1, policy_sha256: bundle.rcc.policy_sha256 }, 200],
    [{ completion_feedback_schema: 1, model_availability_schema: true, policy_sha256: bundle.rcc.policy_sha256 }, 200],
    [{ completion_feedback_schema: 1, policy_sha256: bundle.rcc.policy_sha256 }, 200],
    [{ error: "unavailable" }, 404],
  ])("denies missing, malformed or unavailable support before route/persistence", async (value, status) => {
    const f = fixture(value, status as number);
    expect((await call(f.env, input())).status).toBe(400);
    expect(f.counts().routes).toBe(0); expect(f.counts().persisted).toBe(0);
  });
  it.each([true, 0, 2, "1", null])("does not treat unsupported required contract as optional", async value => {
    const f = fixture({ completion_feedback_schema: 1, model_availability_schema: 1, policy_sha256: bundle.rcc.policy_sha256 });
    expect((await call(f.env, input(value))).status).toBe(400);
    expect(f.counts()).toEqual({ caps: 0, routes: 0, persisted: 0, oldLookups: 0 });
  });
  it("does not permit empty/missing user model evidence on the critical path", async () => {
    const f = fixture({ completion_feedback_schema: 1, model_availability_schema: 1, policy_sha256: bundle.rcc.policy_sha256 });
    const body = input();
    delete (body.task.execution_context as any).available_claude_models;
    expect((await call(f.env, body)).status).toBe(400);
    expect(f.counts().routes).toBe(0);
  });
  it("rejects a routed tuple outside the user's current inventory before persisting", async () => {
    const f = fixture({ completion_feedback_schema: 1, model_availability_schema: 1, policy_sha256: bundle.rcc.policy_sha256 });
    const fetch = f.env.RCC_V26.fetch.bind(f.env.RCC_V26);
    (f.env.RCC_V26 as any).fetch = async (request: Request | string) => typeof request === "string" ? fetch(request) :
      Response.json({ provider: "codex", model: "unavailable-model", effort: "medium", provider_pinned: true,
        permission_profile: "read_only", verification_profile: "executed_review", route_id: "rcc-local-" + "0".repeat(32),
        policy_sha256: bundle.rcc.policy_sha256 });
    expect((await call(f.env, input())).status).toBe(400);
    expect(f.counts().persisted).toBe(0);
  });
  it("retries only through the persisted critical policy/profile/contract and echoes the typed startup receipt", async () => {
    const f = fixture({ completion_feedback_schema: 1, model_availability_schema: 1, route_learning_schema: 3,
      policy_sha256: bundle.rcc.policy_sha256 });
    expect((await call(f.env, input())).status).toBe(200);
    const snapshot = { provider: "codex", action: "cx_medium", permission_profile: "read_only", max_steps: 4,
      provider_pinned: true, route_id: "rcc-local-" + "0".repeat(32), verification_profile: "executed_review",
      task, provider_preference: "codex", capacity_plan: { codex: 30, claude: 0 },
      available_codex_models: input().task.available_codex_models, execution_context: input().task.execution_context,
      current_run_observations: [], attempt: 1, sequence: 1, expected_model: "gpt-test", expected_effort: "medium",
      policy_version: bundle.policy_version, policy_sha256: policy, rcc_policy_sha256: bundle.rcc.policy_sha256,
      executor_contract_version: "executor-test-v1", executor_contract_sha256: hex("b"),
      required_startup_contract: 1, learning_object: "persisted-fixture-owner" };
    let advances = 0;
    (f.env.ROUTE_POOLS as any).getByName = (name: string) => {
      expect(name).toBe("startup-v1");
      return { recordedDecision: async (id: string) => { expect(id).toBe(executionID); return null; },
        snapshot: async (id: string) => { expect(id).toBe(executionID); return snapshot; },
        advance: async (id: string, sequence: number, outcome: string, hash: string, next: any, context: any, current: any[]) => {
          expect(id).toBe(executionID); expect(sequence).toBe(1); expect(outcome).toBe("retry");
          expect(hash).toBe(hex("f")); expect(next.provider).toBe("codex");
          expect(context.completion_feedback.observations[0].outcome).toBe("quality_failure");
          expect(current).toHaveLength(1); advances++;
          return { status: "step", provider: next.provider, action: next.action, permission_profile: next.permission_profile,
            startup_contract: { schema: 1, completion_feedback_schema: 1, model_availability_schema: 1,
              executor_contract_sha256: hex("b"), model: "gpt-test", effort: "medium", state_storage: "pool_v1" } };
        }, claimLearning: async () => true };
    };
    (f.env as any).RESULT_EVALUATOR = { fetch: async (request: Request) => {
      const body = await request.json() as any;
      expect(body.policy_sha256).toBe(policy); expect(body.rcc_policy_sha256).toBe(bundle.rcc.policy_sha256);
      expect(body.executor_contract_sha256).toBe(hex("b"));
      return Response.json({ outcome: "retry", next_provider: "codex", verified_artifact_hash: hex("f") });
    } };
    (f.env.ROUTING_BUDGETS as any).getByName = () => ({ learningRows: async () => [], observe: async () => {} });
    // New deployed default is irrelevant to the source-locked in-flight row.
    f.env.POLICY_BUNDLE_SHA256 = hex("0");
    const previous = { artifact_ref: `r2://os1-private-results/${executionID}/1/${hex("f")}.json`,
      expected_artifact_hash: hex("f"), sequence: 1 };
    const result = { version: 3, execution_id: executionID, required_startup_contract: 1, previous };
    const response = await call(f.env, result);
    expect(response.status).toBe(200);
    expect((await response.json() as any).startup_contract).toEqual({ schema: 1, completion_feedback_schema: 1,
      model_availability_schema: 1, executor_contract_sha256: hex("b"), model: "gpt-test", effort: "medium", state_storage: "pool_v1" });
    expect(advances).toBe(1); expect(f.counts().caps).toBe(1); expect(f.counts().routes).toBe(2);
    delete (snapshot as any).required_startup_contract;
    expect((await call(f.env, result)).status).toBe(400);
    expect(advances).toBe(1); // A non-critical stored row cannot gain a critical receipt.
  });
});
