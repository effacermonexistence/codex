import { describe, it, expect } from "vitest";
import { validExecutionContext, validClaudeCatalog, availableModelTuple, backendEffort } from "../src/execution-context";
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
  it("admits a Claude model with no effort control only as exactly [\"none\"], beside normal rows", () => {
    // 2026-10-15: CLI 2.1.290 lists haiku with no supportsEffort/supportedEffortLevels.
    const mixed = [{ model: "claude-haiku-4-5-20251001", supported_efforts: ["none"] },
      { model: "claude-sonnet-5-5", supported_efforts: ["low", "medium", "high", "xhigh", "max"] },
      { model: "claude-opus-5-5", supported_efforts: ["xhigh", "max"] }];
    expect(validClaudeCatalog(mixed)).toBe(true);
    const supplied = { ...context, available_claude_models: mixed };
    expect(validExecutionContext(supplied)).toBe(true);
    for (const invalid of [[{ model: "haiku", supported_efforts: ["none", "low"] }],
      [{ model: "haiku", supported_efforts: ["low", "none"] }], [{ model: "haiku", supported_efforts: ["none", "none"] }],
      [{ model: "haiku", supported_efforts: ["minimal"] }], [{ model: "haiku", supported_efforts: "none" }]]) {
      expect(validClaudeCatalog(invalid)).toBe(false);
    }
    expect(availableModelTuple(supplied, [], "claude", "claude-haiku-4-5-20251001", "none")).toBe(true);
    expect(availableModelTuple(supplied, [], "claude", "claude-haiku-4-5-20251001", "low")).toBe(false);
    expect(availableModelTuple(supplied, [], "claude", "claude-sonnet-5-5", "none")).toBe(false);
    expect(availableModelTuple(supplied, [{ slug: "gpt-6-luna", supported_efforts: ["low"] }], "codex", "gpt-6-luna", "none")).toBe(false);
    expect(backendEffort("claude", "none")).toBe(true);
    for (const [provider, effort] of [["codex", "none"], ["local", "none"], ["claude", "minimal"], ["claude", undefined]]) {
      expect(backendEffort(provider, effort)).toBe(false);
    }
    for (const effort of ["low", "medium", "high", "xhigh", "max", "ultra"]) {
      expect(backendEffort("codex", effort) && backendEffort("claude", effort)).toBe(true);
    }
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
