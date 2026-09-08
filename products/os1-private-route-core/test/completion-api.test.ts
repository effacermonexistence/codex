import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
import service from "../src/index";

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
function start(hash: string, emptyCatalog = false): Request {
  return new Request("https://private/decide", { method: "POST", body: JSON.stringify({ version: 3,
    execution_id: "00000000-0000-4000-8000-000000000001", principal: { subject: "fixture", device_id: "fixture-device" },
    task: { content: task, trust: "untrusted_user_data", provider_preference: "auto", capacity_plan: { codex: 30, claude: 100 },
      executor_contract_version: "executor-test-v1", executor_contract_sha256: "b".repeat(64),
      available_codex_models: emptyCatalog ? [] : [{ slug: "gpt-test", default_effort: "medium", supported_efforts: ["medium"], priority: 1 }],
      execution_context: { input_utf8_bytes: 1000, source_utf8_bytes: 600, history_utf8_bytes: 200,
        completion_feedback: { schema: 1, objective_sha256: hash, observations: [] } } } }) });
}

describe("private completion API", () => {
  it("rejects objective mismatch before consuming start budget; no-eligible is terminal rather than a transport failure", async () => {
    let budgets = 0, routes = 0;
    const env = { ROUTES: { getByName: () => ({}) }, ROUTING_BUDGET_EPOCH: "fixture", MAX_ROUTE_STARTS_PER_HOUR: "10",
      ROUTING_BUDGETS: { getByName: () => ({ consumeStart: async () => { budgets++; return true; } }) },
      POLICY_BUNDLE_KEY: `os1/policies/${policy}.json`, POLICY_BUNDLE_SHA256: policy, MAX_POLICY_BUNDLE_BYTES: "65536",
      POLICY_BUNDLES: { get: async () => ({ size: bytes.length, arrayBuffer: async () => bytes.buffer }) },
      RCC_V26: { fetch: async (request: Request) => { routes++;
        const body = await request.json() as Record<string, any>;
        expect(body.current_run_observations).toEqual([]);
        expect(body.execution_context.completion_feedback.objective_sha256).toBe(objective);
        return Response.json({ status: "no_eligible", policy_sha256: bundle.rcc.policy_sha256 });
      } } } as unknown as Env;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await service.fetch(start("a".repeat(64)), env)).status).toBe(400);
      expect(budgets).toBe(0);
      expect(routes).toBe(0);
      const response = await service.fetch(start(objective, true), env);
      expect(response.status, JSON.stringify(error.mock.calls)).toBe(200);
      expect(await response.json()).toEqual({ status: "failed" });
      expect(budgets).toBe(1);
      expect(routes).toBe(1);

      const historical = { provider: "codex", model: "gpt-test", effort: "medium", outcome: "timeout",
        input_tokens: 20, output_tokens: 0, duration_ms: 50 };
      const executionContext = { input_utf8_bytes: 1000, source_utf8_bytes: 600, history_utf8_bytes: 200,
        completion_feedback: { schema: 1, objective_sha256: objective, observations: [historical] } };
      let advances = 0;
      const retryEnv = { ...env, ROUTES: { getByName: () => ({ recordedDecision: async () => null, snapshot: async () => ({
        provider: "claude", action: "cl_medium", permission_profile: "read_only", max_steps: 4,
        provider_pinned: false, task, provider_preference: "auto", capacity_plan: { codex: 30, claude: 100 },
        available_codex_models: [], execution_context: executionContext, current_run_observations: [],
        expected_model: "sonnet", expected_effort: "medium", policy_version: bundle.policy_version,
        policy_sha256: policy, rcc_policy_sha256: bundle.rcc.policy_sha256, route_id: "rcc-local-" + "0".repeat(32),
        verification_profile: "source_review", executor_contract_version: "executor-test-v1", executor_contract_sha256: "b".repeat(64),
      }), advance: async (sequence: number, outcome: string, hash: string, next: unknown, context: Record<string, any>, current: unknown[]) => {
        advances++;
        expect([sequence, outcome, hash, next]).toEqual([1, "retry", "f".repeat(64), undefined]);
        expect(current).toHaveLength(1);
        expect(context.completion_feedback.observations).toHaveLength(2);
        expect(context.completion_feedback.observations[1].input_tokens).toBeNull();
        return { status: "failed" };
      } }) }, RESULT_EVALUATOR: { fetch: async () => Response.json({ outcome: "retry",
        verified_artifact_hash: "f".repeat(64), next_provider: "claude" }) },
      RCC_V26: { fetch: async (request: Request) => {
        const body = await request.json() as Record<string, any>;
        expect(body.current_run_observations).toHaveLength(1);
        expect(body.current_run_observations[0].provider).toBe("claude");
        expect(body.execution_context.completion_feedback.observations[0]).toEqual(historical);
        return Response.json({ status: "no_eligible", policy_sha256: bundle.rcc.policy_sha256 });
      } } } as unknown as Env;
      const retry = new Request("https://private/decide", { method: "POST", body: JSON.stringify({ version: 3,
        execution_id: "00000000-0000-4000-8000-000000000001", previous: { sequence: 1,
          artifact_ref: `r2://os1-private-results/00000000-0000-4000-8000-000000000001/1/${"f".repeat(64)}.json`,
          expected_artifact_hash: "f".repeat(64) } }) });
      expect(await (await service.fetch(retry, retryEnv)).json()).toEqual({ status: "failed" });
      expect(advances).toBe(1);
    } finally { error.mockRestore(); }
  });
});
