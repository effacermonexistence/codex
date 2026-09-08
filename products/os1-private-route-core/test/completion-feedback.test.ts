import { describe, expect, it } from "vitest";
import { appendCompletionObservation, validExecutionContext, type ExecutionContext, type CompletionObservation } from "../src/execution-context";
import { supportsCompletionFeedback } from "../src/capabilities";

const failure: CompletionObservation = { provider: "claude", model: "sonnet", effort: "medium",
  outcome: "quality_failure", input_tokens: null, output_tokens: null, duration_ms: null };
const context: ExecutionContext = { input_utf8_bytes: 100, source_utf8_bytes: 60, history_utf8_bytes: 20 };

describe("private route continuation feedback", () => {
  it("does not change the old client contract or create unscoped feedback", () => {
    expect(appendCompletionObservation(undefined, failure)).toBeUndefined();
    expect(appendCompletionObservation(context, failure)).toBe(context);
  });
  it("carries exact failed tuples into retry context without inventing usage or mutating prior state", () => {
    const supplied: ExecutionContext = { ...context, completion_feedback: { schema: 1,
      objective_sha256: "a".repeat(64), observations: [] } };
    const next = appendCompletionObservation(supplied, failure)!;
    expect(next.completion_feedback!.objective_sha256).toBe(supplied.completion_feedback!.objective_sha256);
    expect(next.completion_feedback!.observations).toEqual([failure]);
    expect(supplied.completion_feedback!.observations).toEqual([]);
    expect(validExecutionContext(next)).toBe(true);
    const final = appendCompletionObservation(next, { ...failure, model: "opus", effort: "xhigh", outcome: "adopted" })!;
    expect(final.completion_feedback!.observations.map(row => row.outcome)).toEqual(["quality_failure", "adopted"]);
  });
  it("bounds repeated continuation metadata to the latest 16 attempts", () => {
    let next: ExecutionContext | undefined = { ...context, completion_feedback: { schema: 1,
      objective_sha256: "a".repeat(64), observations: [] } };
    for (let index = 0; index < 20; index++) next = appendCompletionObservation(next, { ...failure, duration_ms: index });
    expect(next!.completion_feedback!.observations).toHaveLength(16);
    expect(next!.completion_feedback!.observations[0].duration_ms).toBe(4);
    expect(validExecutionContext(next)).toBe(true);
  });
});
describe("private capability source-policy lock", () => {
  const policy = "a".repeat(64);
  it("requires both the supported schema and exact active RCC policy", async () => {
    const binding = { fetch: async () => Response.json({ completion_feedback_schema: 1, policy_sha256: policy }) } as unknown as Fetcher;
    expect(await supportsCompletionFeedback(binding, policy)).toBe(true);
    expect(await supportsCompletionFeedback(binding, "b".repeat(64))).toBe(false);
  });
  it("rejects old, unbounded, malformed and unavailable RCC bindings", async () => {
    for (const value of [{}, { completion_feedback_schema: 1 },
      { completion_feedback_schema: 2, policy_sha256: policy },
      { completion_feedback_schema: 1, policy_sha256: policy, private_rule: "x" },
      { completion_feedback_schema: 1, policy_sha256: "x".repeat(400) }]) {
      expect(await supportsCompletionFeedback({ fetch: async () => Response.json(value) } as unknown as Fetcher, policy)).toBe(false);
    }
    expect(await supportsCompletionFeedback({ fetch: async () => new Response("old", { status: 400 }) } as unknown as Fetcher, policy)).toBe(false);
    expect(await supportsCompletionFeedback({ fetch: async () => { throw Error("offline"); } } as unknown as Fetcher, policy)).toBe(false);
  });
});
