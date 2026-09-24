import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  exportLearningRows, LEARNING_HALF_LIFE_MS, routeSeed, updateLearning, validLearningObservation, validStepUsage,
  weightedTokens, type LearningObservation,
} from "../src/route-learning";
import { routeLearningSchema, supportsCompletionFeedback, supportsRouteLearning } from "../src/capabilities";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
import service from "../src/index";

const adopted: LearningObservation = { provider: "codex", model: "gpt-6-sol", effort: "medium",
  task_class: "executed_change", adopted: true, duration_ms: 40_000, tokens: null };

describe("route learning ledger", () => {
  it("accepts only bounded, content-free outcomes of learnable task classes", () => {
    expect(validLearningObservation(adopted)).toBe(true);
    for (const bad of [{ ...adopted, task_class: "deterministic_exact" }, { ...adopted, provider: "local" },
      { ...adopted, effort: "none" }, { ...adopted, model: "../x" }, { ...adopted, duration_ms: -1 },
      { ...adopted, duration_ms: 1.5 }, { ...adopted, prompt: "secret" }, { ...adopted, adopted: 1 },
      { ...adopted, tokens: -1 }, { ...adopted, tokens: "many" }, { ...adopted, tokens: Number.NaN },
      (({ tokens, ...rest }) => rest)(adopted)]) {
      expect(validLearningObservation(bad)).toBe(false);
    }
  });
  it("adds outcomes and halves old evidence every half-life", () => {
    const first = updateLearning(undefined, adopted, 0);
    expect(first).toMatchObject({ n: 1, s: 1, dn: 1 });
    const failed = updateLearning(first, { ...adopted, adopted: false, duration_ms: 5_000 }, LEARNING_HALF_LIFE_MS);
    expect(failed.n).toBeCloseTo(1.5);
    expect(failed.s).toBeCloseTo(0.5);
    expect(failed.dn).toBeCloseTo(0.5);
    const [row] = exportLearningRows([failed], 2 * LEARNING_HALF_LIFE_MS);
    expect(row).toEqual({ provider: "codex", model: "gpt-6-sol", effort: "medium", class: "executed_change",
      n: 0.75, s: 0.25, d: 40, dn: 0.25 });
  });
  it("keeps the policy's exact wire rules: s <= n, dn <= s, d only with adopted durations", () => {
    const failure = updateLearning(undefined, { ...adopted, adopted: false }, 0);
    expect(exportLearningRows([failure], 0)).toEqual([{ provider: "codex", model: "gpt-6-sol", effort: "medium",
      class: "executed_change", n: 1, s: 0, d: null, dn: 0 }]);
    const unmeasured = updateLearning(undefined, { ...adopted, duration_ms: null }, 0);
    expect(exportLearningRows([unmeasured], 0)[0]).toMatchObject({ s: 1, d: null, dn: 0 });
    // Stale and foreign rows are dropped instead of failing the whole payload.
    const stale = updateLearning(undefined, adopted, 0);
    expect(exportLearningRows([stale, { ...stale, task_class: "deterministic_exact" }, { ...stale, effort: "minimal" }],
      20 * LEARNING_HALF_LIFE_MS)).toEqual([]);
    const many = Array.from({ length: 300 }, (_, index) => ({ ...stale, model: `m-${index}` }));
    expect(exportLearningRows(many, 0)).toHaveLength(256);
  });
  it("weights tokens by what they cost: cache reads a tenth, output five times", () => {
    expect(weightedTokens({ input_tokens: 1_000_000, cache_tokens: 990_000, output_tokens: 2_000 })).toBe(10_000 + 99_000 + 10_000);
    expect(weightedTokens({ input_tokens: 5_000, cache_tokens: null, output_tokens: 100 })).toBe(5_500);
    // Unknown input or output is unmeasured, never zero.
    expect(weightedTokens({ input_tokens: null, cache_tokens: null, output_tokens: 100 })).toBeNull();
    expect(weightedTokens(undefined)).toBeNull();
    expect(validStepUsage({ input_tokens: 10, cache_tokens: 20, output_tokens: 1 })).toBe(false);
    expect(validStepUsage({ input_tokens: 10, cache_tokens: 5, output_tokens: 1, prompt: "x" })).toBe(false);
    expect(validStepUsage({ input_tokens: -1, cache_tokens: null, output_tokens: 1 })).toBe(false);
    expect(validStepUsage({ input_tokens: 1.5, cache_tokens: null, output_tokens: 1 })).toBe(false);
    expect(validStepUsage({ input_tokens: null, cache_tokens: null, output_tokens: null })).toBe(true);
  });
  it("charges every attempt's tokens to its route and exports them only in schema 2", () => {
    const first = updateLearning(undefined, { ...adopted, tokens: 100_000 }, 0);
    const failed = updateLearning(first, { ...adopted, adopted: false, tokens: 400_000 }, 0);
    const unmeasured = updateLearning(failed, { ...adopted, tokens: null }, 0);
    expect(unmeasured).toMatchObject({ n: 3, s: 2, kn: 2 });
    const [v38] = exportLearningRows([unmeasured], 0, 2);
    // Geometric mean of the two measured attempts, the failure included.
    expect(v38.k).toBe(200_000);
    expect(v38.kn).toBe(2);
    const [v37] = exportLearningRows([unmeasured], 0, 1);
    expect(Object.keys(v37).sort()).toEqual(["class", "d", "dn", "effort", "model", "n", "provider", "s"]);
    // A row written before tokens existed exports as unmeasured, not as zero.
    const legacy = { ...first, klog: null, kn: null };
    expect(exportLearningRows([legacy], 0, 2)[0]).toMatchObject({ k: null, kn: 0 });
    const [decayed] = exportLearningRows([unmeasured], LEARNING_HALF_LIFE_MS, 2);
    expect(decayed.kn).toBe(1);
    expect(decayed.k).toBe(200_000);
  });
  it("derives a per-decision seed from the execution and attempt", async () => {
    const seed = await routeSeed("00000000-0000-4000-8000-000000000001", 2);
    expect(seed).toBe(createHash("sha256").update("00000000-0000-4000-8000-000000000001:2").digest("hex"));
    expect(await routeSeed("00000000-0000-4000-8000-000000000001", 3)).not.toBe(seed);
  });
});

describe("route learning capability", () => {
  const policy = "a".repeat(64);
  const binding = (value: unknown, calls: string[] = []) => ({ fetch: async (url: string) => {
    calls.push(url); return Response.json(value);
  } }) as unknown as Fetcher;
  it("is offered only by the adapter pinned for this policy", async () => {
    const v37 = { completion_feedback_schema: 1, model_availability_schema: 1, policy_sha256: policy, route_learning_schema: 1 };
    expect(await supportsRouteLearning(binding(v37), policy, 0)).toBe(true);
    expect(await supportsCompletionFeedback(binding(v37), policy, true)).toBe(true);
    expect(await supportsRouteLearning(binding({ ...v37, policy_sha256: "b".repeat(64) }), policy, 0)).toBe(false);
    expect(await routeLearningSchema(binding({ ...v37, route_learning_schema: 2 }), policy, 0)).toBe(2);
    expect(await routeLearningSchema(binding(v37), policy, 0)).toBe(1);
    expect(await routeLearningSchema(binding({ ...v37, route_learning_schema: 3 }), policy, 0)).toBe(0);
    expect(await supportsRouteLearning(binding({ completion_feedback_schema: 1, model_availability_schema: 1, policy_sha256: policy }), policy, 0)).toBe(false);
    expect(await supportsRouteLearning(binding({ ...v37, extra: 1 }), policy, 0)).toBe(false);
  });
  it("asks once a minute per binding and never keeps a failed probe", async () => {
    const calls: string[] = [];
    const v37 = binding({ completion_feedback_schema: 1, model_availability_schema: 1, policy_sha256: policy, route_learning_schema: 1 }, calls);
    expect(await supportsRouteLearning(v37, policy, 1_000)).toBe(true);
    expect(await supportsRouteLearning(v37, policy, 30_000)).toBe(true);
    expect(calls).toEqual([`https://internal/capabilities?policy=${policy}`]);
    expect(await supportsRouteLearning(v37, policy, 70_000)).toBe(true);
    expect(calls).toHaveLength(2);
    let failing = true;
    const flaky = { fetch: async () => failing ? new Response("down", { status: 503 }) :
      Response.json({ completion_feedback_schema: 1, model_availability_schema: 1, policy_sha256: policy, route_learning_schema: 1 }) } as unknown as Fetcher;
    expect(await supportsRouteLearning(flaky, policy, 0)).toBe(false);
    failing = false;
    expect(await supportsRouteLearning(flaky, policy, 1)).toBe(true);
  });
});

describe("route learning end to end", () => {
  const task = "Exact task with source_sha256=a and history_sha256=b";
  const objective = createHash("sha256").update(task).digest("hex");
  const bundle = { schema: 4, policy_version: "policy-test-v1", maximum_steps: 4,
    executor_contracts: [{ version: "executor-test-v1", sha256: "b".repeat(64) }],
    execution_profiles: { exact: { provider: "local", model: "local-deterministic", effort: "none" },
      cx_low: { provider: "codex", model: "gpt-test", effort: "low" },
      cx_medium: { provider: "codex", model: "gpt-test", effort: "medium" },
      cl_medium: { provider: "claude", model: "sonnet", effort: "medium" },
      cl_high: { provider: "claude", model: "opus", effort: "xhigh" } },
    rcc: { adapter_version: "adapter-test-v1", policy_sha256: "c".repeat(64), engine_sha256: "d".repeat(64), authority_sha256: "e".repeat(64) } };
  const bytes = new TextEncoder().encode(JSON.stringify(bundle));
  const policy = createHash("sha256").update(bytes).digest("hex");
  const executionId = "00000000-0000-4000-8000-000000000009";
  const ledgerRow = { provider: "codex", model: "gpt-test", effort: "medium", class: "executed_review", n: 3, s: 2, d: 30, dn: 2 };

  it("routes with this owner's ledger and records each verified step exactly once", async () => {
    let persisted: any, claims = 0;
    const observed: LearningObservation[] = [], routeBodies: any[] = [], budgetNames: string[] = [];
    const budget = { consumeStart: async () => true, record: async () => {}, learningRows: async () => [ledgerRow],
      observe: async (value: LearningObservation) => { observed.push(value); } };
    const env = {
      ROUTES: { getByName: () => ({
        begin: async (value: any) => { persisted = { ...value, step_started_ms: Date.now() - 42_000 }; return "created"; },
        recordedDecision: async () => null,
        snapshot: async () => ({ ...persisted, expected_model: "gpt-test", expected_effort: "medium" }),
        advance: async () => ({ status: "complete" }),
        claimLearning: async () => ++claims === 1,
      }) },
      RESULT_EVALUATOR: { fetch: async () => Response.json({ outcome: "pass", verified_artifact_hash: "f".repeat(64), next_provider: "codex" }) },
      ROUTING_BUDGET_EPOCH: "fixture", MAX_ROUTE_STARTS_PER_HOUR: "10",
      ROUTING_BUDGETS: { getByName: (name: string) => { budgetNames.push(name); return budget; } },
      POLICY_BUNDLE_KEY: `os1/policies/${policy}.json`, POLICY_BUNDLE_SHA256: policy, MAX_POLICY_BUNDLE_BYTES: "65536",
      POLICY_BUNDLES: { get: async () => ({ size: bytes.length, arrayBuffer: async () => bytes.buffer }) },
      RCC_V26: { fetch: async (request: Request | string) => {
        if (typeof request === "string") return Response.json({ completion_feedback_schema: 1, model_availability_schema: 1,
          policy_sha256: bundle.rcc.policy_sha256, route_learning_schema: 1 });
        const body: any = await request.json();
        routeBodies.push(body);
        return Response.json({ provider: "codex", provider_pinned: false, permission_profile: "read_only",
          model: "gpt-test", effort: "medium", verification_profile: "executed_review",
          route_id: "rcc-local-" + "0".repeat(32), policy_sha256: bundle.rcc.policy_sha256 });
      } },
    } as unknown as Env;
    const start = new Request("https://private/decide", { method: "POST", body: JSON.stringify({ version: 3,
      execution_id: executionId, principal: { subject: "fixture", device_id: "fixture-device" },
      task: { content: task, trust: "untrusted_user_data", provider_preference: "auto", capacity_plan: { codex: 30, claude: 100 },
        executor_contract_version: "executor-test-v1", executor_contract_sha256: "b".repeat(64),
        available_codex_models: [{ slug: "gpt-test", default_effort: "medium", supported_efforts: ["medium"], priority: 1 }],
        execution_context: { input_utf8_bytes: 1000, source_utf8_bytes: 600, history_utf8_bytes: 200,
          completion_feedback: { schema: 1, objective_sha256: objective, observations: [] } } } }) });
    const started = await service.fetch(start, env);
    expect(started.status).toBe(200);
    // Server-owned ledger and a per-run seed reach the policy; the client wire is unchanged.
    expect(routeBodies[0].route_learning).toEqual({ schema: 1, rows: [ledgerRow] });
    expect(routeBodies[0].route_seed).toBe(await routeSeed(executionId, 1));
    expect(persisted.learning_object).toMatch(/^fixture:[0-9a-f]{64}$/);
    expect(await started.json()).toEqual({ status: "step", provider: "codex", action: "cx_medium", permission_profile: "read_only" });

    const result = () => new Request("https://private/decide", { method: "POST", body: JSON.stringify({ version: 3,
      execution_id: executionId, previous: { sequence: 1,
        artifact_ref: `r2://os1-private-results/${executionId}/1/${"f".repeat(64)}.json`, expected_artifact_hash: "f".repeat(64) } }) });
    expect(await (await service.fetch(result(), env)).json()).toEqual({ status: "complete" });
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ provider: "codex", model: "gpt-test", effort: "medium",
      task_class: "executed_review", adopted: true });
    expect(observed[0].duration_ms).toBeGreaterThanOrEqual(42_000);
    expect(budgetNames.at(-1)).toBe(persisted.learning_object);
    // A re-delivered result is not learned twice.
    await service.fetch(result(), env);
    expect(observed).toHaveLength(1);
  });

  it("carries the step's signed usage into the ledger and sends tokens only to a schema-2 policy", async () => {
    let persisted: any;
    const observed: LearningObservation[] = [], routeBodies: any[] = [];
    const tokenRow = { ...ledgerRow, k: 150_000, kn: 2 };
    const budget = { consumeStart: async () => true, record: async () => {},
      learningRows: async (schema?: number) => schema === 2 ? [tokenRow] : [ledgerRow],
      observe: async (value: LearningObservation) => { observed.push(value); } };
    const env = {
      ROUTES: { getByName: () => ({
        begin: async (value: any) => { persisted = { ...value, step_started_ms: Date.now() - 1_000 }; return "created"; },
        recordedDecision: async () => null,
        snapshot: async () => ({ ...persisted, expected_model: "gpt-test", expected_effort: "medium" }),
        advance: async () => ({ status: "complete" }), claimLearning: async () => true,
      }) },
      RESULT_EVALUATOR: { fetch: async () => Response.json({ outcome: "pass", verified_artifact_hash: "f".repeat(64), next_provider: "codex" }) },
      ROUTING_BUDGET_EPOCH: "fixture", MAX_ROUTE_STARTS_PER_HOUR: "10", ROUTING_BUDGETS: { getByName: () => budget },
      POLICY_BUNDLE_KEY: `os1/policies/${policy}.json`, POLICY_BUNDLE_SHA256: policy, MAX_POLICY_BUNDLE_BYTES: "65536",
      POLICY_BUNDLES: { get: async () => ({ size: bytes.length, arrayBuffer: async () => bytes.buffer }) },
      RCC_V26: { fetch: async (request: Request | string) => {
        if (typeof request === "string") return Response.json({ completion_feedback_schema: 1, model_availability_schema: 1,
          policy_sha256: bundle.rcc.policy_sha256, route_learning_schema: 2 });
        routeBodies.push(await request.json());
        return Response.json({ provider: "codex", provider_pinned: false, permission_profile: "read_only",
          model: "gpt-test", effort: "medium", verification_profile: "executed_review",
          route_id: "rcc-local-" + "0".repeat(32), policy_sha256: bundle.rcc.policy_sha256 });
      } },
    } as unknown as Env;
    const start = new Request("https://private/decide", { method: "POST", body: JSON.stringify({ version: 3,
      execution_id: executionId, principal: { subject: "fixture", device_id: "fixture-device" },
      task: { content: task, trust: "untrusted_user_data", provider_preference: "auto", capacity_plan: { codex: 30, claude: 100 },
        executor_contract_version: "executor-test-v1", executor_contract_sha256: "b".repeat(64),
        available_codex_models: [{ slug: "gpt-test", default_effort: "medium", supported_efforts: ["medium"], priority: 1 }],
        execution_context: { input_utf8_bytes: 1000, source_utf8_bytes: 600, history_utf8_bytes: 200,
          completion_feedback: { schema: 1, objective_sha256: objective, observations: [] } } } }) });
    expect((await service.fetch(start, env)).status).toBe(200);
    expect(routeBodies[0].route_learning).toEqual({ schema: 2, rows: [tokenRow] });
    const result = (usage: unknown) => new Request("https://private/decide", { method: "POST", body: JSON.stringify({ version: 3,
      execution_id: executionId, previous: { sequence: 1,
        artifact_ref: `r2://os1-private-results/${executionId}/1/${"f".repeat(64)}.json`, expected_artifact_hash: "f".repeat(64),
        ...(usage === undefined ? {} : { usage }) } }) });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Malformed usage is refused like any other malformed result.
      expect((await service.fetch(result({ input_tokens: 10, cache_tokens: 99, output_tokens: 1 }), env)).status).toBe(400);
      expect((await service.fetch(result({ input_tokens: 10, output_tokens: 1 }), env)).status).toBe(400);
    } finally { error.mockRestore(); }
    expect(observed).toHaveLength(0);
    expect(await (await service.fetch(result({ input_tokens: 800_000, cache_tokens: 790_000, output_tokens: 3_000 }), env)).json())
      .toEqual({ status: "complete" });
    expect(observed).toHaveLength(1);
    expect(observed[0].tokens).toBe(10_000 + 79_000 + 15_000);
    // A result without usage (older client) still records the outcome, as unmeasured.
    await service.fetch(result(undefined), env);
    expect(observed[1].tokens).toBeNull();
  });

  it("never lets an unreadable ledger or an unrecordable outcome break routing", async () => {
    let persisted: any;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const budget = { consumeStart: async () => true, record: async () => {},
      learningRows: async () => { throw new Error("storage"); }, observe: async () => { throw new Error("storage"); } };
    const env = {
      ROUTES: { getByName: () => ({
        begin: async (value: any) => { persisted = value; return "created"; },
        recordedDecision: async () => null,
        snapshot: async () => ({ ...persisted, expected_model: "gpt-test", expected_effort: "medium" }),
        advance: async () => ({ status: "complete" }), claimLearning: async () => true,
      }) },
      RESULT_EVALUATOR: { fetch: async () => Response.json({ outcome: "pass", verified_artifact_hash: "f".repeat(64), next_provider: "codex" }) },
      ROUTING_BUDGET_EPOCH: "fixture", MAX_ROUTE_STARTS_PER_HOUR: "10", ROUTING_BUDGETS: { getByName: () => budget },
      POLICY_BUNDLE_KEY: `os1/policies/${policy}.json`, POLICY_BUNDLE_SHA256: policy, MAX_POLICY_BUNDLE_BYTES: "65536",
      POLICY_BUNDLES: { get: async () => ({ size: bytes.length, arrayBuffer: async () => bytes.buffer }) },
      RCC_V26: { fetch: async (request: Request | string) => {
        if (typeof request === "string") return Response.json({ completion_feedback_schema: 1, model_availability_schema: 1,
          policy_sha256: bundle.rcc.policy_sha256, route_learning_schema: 1 });
        const body: any = await request.json();
        expect(body.route_learning).toBeUndefined();
        expect(body.route_seed).toBeUndefined();
        return Response.json({ provider: "codex", provider_pinned: false, permission_profile: "read_only",
          model: "gpt-test", effort: "medium", verification_profile: "executed_review",
          route_id: "rcc-local-" + "0".repeat(32), policy_sha256: bundle.rcc.policy_sha256 });
      } },
    } as unknown as Env;
    try {
      const start = new Request("https://private/decide", { method: "POST", body: JSON.stringify({ version: 3,
        execution_id: executionId, principal: { subject: "fixture", device_id: "fixture-device" },
        task: { content: task, trust: "untrusted_user_data", provider_preference: "auto", capacity_plan: { codex: 30, claude: 100 },
          executor_contract_version: "executor-test-v1", executor_contract_sha256: "b".repeat(64),
          available_codex_models: [{ slug: "gpt-test", default_effort: "medium", supported_efforts: ["medium"], priority: 1 }],
          execution_context: { input_utf8_bytes: 1000, source_utf8_bytes: 600, history_utf8_bytes: 200,
            completion_feedback: { schema: 1, objective_sha256: objective, observations: [] } } } }) });
      expect((await service.fetch(start, env)).status).toBe(200);
      const result = new Request("https://private/decide", { method: "POST", body: JSON.stringify({ version: 3,
        execution_id: executionId, previous: { sequence: 1,
          artifact_ref: `r2://os1-private-results/${executionId}/1/${"f".repeat(64)}.json`, expected_artifact_hash: "f".repeat(64) } }) });
      expect(await (await service.fetch(result, env)).json()).toEqual({ status: "complete" });
      expect(error.mock.calls.map((call) => String(call[0]))).toEqual([
        JSON.stringify({ event: "route_learning_unavailable" }), JSON.stringify({ event: "route_learning_unrecorded" })]);
    } finally { error.mockRestore(); }
  });
});
