import { describe, expect, it } from "vitest";
import { completionFeedbackMatchesTask, validCompletionFeedback, validExecutionContext } from "../src/execution-context";
import { parseStartRequest } from "../src/contracts";
import { createHash } from "node:crypto";

const observation = { provider: "claude", model: "sonnet", effort: "medium", outcome: "adopted",
  input_tokens: 250, output_tokens: 30, duration_ms: 1000 };
const feedback = { schema: 1, objective_sha256: "a".repeat(64), observations: [observation] };
const context = { input_utf8_bytes: 1000, source_utf8_bytes: 600, history_utf8_bytes: 200 };
const request = { task: "An exact scoped objective", provider_preference: "auto",
  capacity_plan: { codex: 30, claude: 100 }, executor_contract_version: "executor-test-v1",
  executor_contract_sha256: "b".repeat(64), available_codex_models: [{ slug: "gpt-test",
    default_effort: "medium", supported_efforts: ["medium"], priority: 1 }] };

describe("content-free completion feedback", () => {
  it("binds to exact UTF-8 task bytes, including Unicode and source/context markers", async () => {
    const task = "자료 설명\nsource_sha256=a\nhistory_sha256=b";
    const supplied = { ...context, completion_feedback: { ...feedback,
      objective_sha256: createHash("sha256").update(task).digest("hex") } };
    expect(await completionFeedbackMatchesTask(supplied, task)).toBe(true);
    expect(await completionFeedbackMatchesTask(supplied, task + " ")).toBe(false);
    expect(await completionFeedbackMatchesTask(supplied, task.replace("history_sha256=b", "history_sha256=c"))).toBe(false);
    expect(await completionFeedbackMatchesTask(context, task)).toBe(true);
  });
  it("preserves old starts and carries exact-objective metadata only when supplied", () => {
    expect(parseStartRequest({ ...request, execution_context: context }).execution_context).toEqual(context);
    const supplied = { ...context, completion_feedback: feedback };
    expect(parseStartRequest({ ...request, execution_context: supplied }).execution_context).toEqual(supplied);
    expect(validCompletionFeedback({ ...feedback, observations: [] })).toBe(true);
    expect(parseStartRequest({ ...request, available_codex_models: [], execution_context: supplied }).available_codex_models).toEqual([]);
    expect(() => parseStartRequest({ ...request, available_codex_models: [], execution_context: context })).toThrow();
  });
  it("keeps unknown usage and unavailable server timing null, including every supported outcome", () => {
    for (const outcome of ["adopted", "quality_failure", "timeout", "capability_failure"]) {
      expect(validCompletionFeedback({ ...feedback, observations: [{ ...observation, outcome,
        input_tokens: null, output_tokens: null, duration_ms: null }] })).toBe(true);
    }
  });
  for (const bad of [null, {}, { ...feedback, schema: 2 }, { ...feedback, schema: true },
    { ...feedback, objective_sha256: "A".repeat(64) }, { ...feedback, objective_sha256: "a".repeat(63) },
    { ...feedback, prompt: "content is prohibited" }, { ...feedback, observations: Array(17).fill(observation) },
    ...[{ provider: ["claude"] }, { effort: ["medium"] }, { outcome: ["adopted"] }, { provider: "local" },
      { model: "../escape" }, { model: "x".repeat(129) }, { effort: "none" }, { outcome: "probably_good" },
      { input_tokens: -1 }, { output_tokens: 1.1 }, { input_tokens: true }, { duration_ms: Number.MAX_SAFE_INTEGER + 1 },
      { output_tokens: "30" }, { answer: "content is prohibited" }].map(change =>
      ({ ...feedback, observations: [{ ...observation, ...change }] }))]) {
    it(`rejects malformed/expanded metadata ${JSON.stringify(bad)}`, () => {
      expect(validCompletionFeedback(bad)).toBe(false);
      expect(validExecutionContext({ ...context, completion_feedback: bad })).toBe(false);
      expect(() => parseStartRequest({ ...request, execution_context: { ...context, completion_feedback: bad } })).toThrow();
    });
  }
});
