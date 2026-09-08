import { describe, it, expect } from "vitest";
import { validExecutionContext, validClaudeCatalog, availableModelTuple } from "../src/execution-context";
import { completionCapabilities } from "../src/capabilities";
import { appendCompletionObservation } from "../../os1-private-route-core/src/execution-context";

const context = { input_utf8_bytes: 120, source_utf8_bytes: 20, history_utf8_bytes: 10,
  completion_feedback: { schema: 1 as const, objective_sha256: "a".repeat(64), observations: [] },
  available_claude_models: [{ model: "sonnet", supported_efforts: ["medium"] }] };
describe("account-scoped model eligibility", () => {
  it("requires valid, bounded metadata and keeps empty distinct from missing", () => {
    expect(validExecutionContext(context)).toBe(true);
    expect(validExecutionContext({ ...context, available_claude_models: [] })).toBe(true);
    expect(validExecutionContext({ ...context, completion_feedback: undefined })).toBe(false);
    for (const invalid of [null, {}, [{ model: "sonnet", supported_efforts: [] }],
      [{ model: "sonnet", supported_efforts: ["ultra"] }],
      [{ model: "sonnet", supported_efforts: ["medium", "medium"] }],
      [...context.available_claude_models, ...context.available_claude_models],
      [{ ...context.available_claude_models[0], account_email: "not-allowed" }],
      Array.from({ length: 33 }, (_, i) => ({ model: `m-${i}`, supported_efforts: ["low"] }))]) {
      expect(validClaudeCatalog(invalid)).toBe(false);
    }
  });
  it("excludes absent Fable/Daybreak and unsupported efforts independently", () => {
    const codex = [{ slug: "gpt-5.6-sol", supported_efforts: ["high"] }];
    expect(availableModelTuple(context, codex, "codex", "gpt-daybreak-blue-latest", "high")).toBe(false);
    expect(availableModelTuple(context, codex, "codex", "gpt-5.6-sol", "ultra")).toBe(false);
    expect(availableModelTuple(context, codex, "codex", "gpt-5.6-sol", "high")).toBe(true);
    expect(availableModelTuple(context, codex, "claude", "fable", "low")).toBe(false);
    expect(availableModelTuple(context, codex, "claude", "sonnet", "high")).toBe(false);
    expect(availableModelTuple(context, codex, "claude", "sonnet", "medium")).toBe(true);
    const empty = { ...context, available_claude_models: [] };
    expect(availableModelTuple(empty, [], "claude", "sonnet", "medium")).toBe(false);
    expect(availableModelTuple(empty, [], "local", "local-deterministic", "none")).toBe(true);
  });
  it("preserves the same inventory through result/retry context updates", () => {
    const after = appendCompletionObservation(context, { provider: "claude", model: "sonnet", effort: "medium",
      outcome: "quality_failure", input_tokens: null, output_tokens: null, duration_ms: null });
    expect(after?.available_claude_models).toEqual(context.available_claude_models);
    expect(context.completion_feedback.observations).toEqual([]);
  });
  it("advertises only protocol support, not account or policy data", async () => {
    const binding = { fetch: async () => Response.json({ completion_feedback_schema: 1, model_availability_schema: 1 }) } as unknown as Fetcher;
    expect(await (await completionCapabilities(binding)).json()).toEqual({ completion_feedback_schema: 1,
      model_availability_schema: 1, execution_protocol: 1, fleet_receipt_protocol: 1 });
  });
});
