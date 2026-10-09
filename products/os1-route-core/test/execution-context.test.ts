import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { completionFeedbackMatchesTask, validExecutionContext, validGovernedDelegation } from "../src/execution-context";
import { parseStartRequest } from "../src/contracts";

const valid = { input_utf8_bytes: 145000, source_utf8_bytes: 79401, history_utf8_bytes: 40000 };
const request = { task: "QMGR schema", provider_preference: "auto",
  capacity_plan: { codex: 30, claude: 100 },
  executor_contract_version: "executor-test-v1", executor_contract_sha256: "a".repeat(64),
  available_codex_models: [{ slug: "gpt-5.6-terra", default_effort: "medium", supported_efforts: ["low", "medium"], priority: 1 }] };

describe("bounded input accounting", () => {
  it("passes full source/history sizes without transmitting source content", () => {
    expect(validExecutionContext(valid)).toBe(true);
    expect(parseStartRequest({ ...request, execution_context: valid }).execution_context).toEqual(valid);
    expect(parseStartRequest(request).execution_context).toBeUndefined();
  });
  for (const invalid of [null, {}, { ...valid, input_utf8_bytes: 0 }, { ...valid, source_utf8_bytes: -1 },
    { ...valid, input_utf8_bytes: 4_000_001 }, { ...valid, history_utf8_bytes: 145000 },
    { ...valid, source_utf8_bytes: "79401" }, { ...valid, source_utf8_bytes: true },
    { ...valid, source_utf8_bytes: NaN }, { ...valid, system_prompt: "bypass" }]) {
    it(`rejects invalid metadata ${JSON.stringify(invalid)}`, () => {
      expect(validExecutionContext(invalid)).toBe(false);
      expect(() => parseStartRequest({ ...request, execution_context: invalid })).toThrow();
    });
  }
});

const parentTask = "Implement the authorized package without changing other work.";
const parentSHA = createHash("sha256").update(parentTask, "utf8").digest("hex");
const delegation = { role: "worker", scope: "isolated_workspace_write", parent_task: parentTask,
  parent_objective_sha256: parentSHA, requires_parent_verification: true } as const;

describe("governed delegated execution context", () => {
  it("accepts the exact five-key declaration and preserves the parent verification boundary", async () => {
    const context = { ...valid, governed_delegation: delegation };
    expect(validGovernedDelegation(delegation)).toBe(true);
    expect(validExecutionContext(context)).toBe(true);
    expect(parseStartRequest({ ...request, execution_context: context }).execution_context).toEqual(context);
    expect(await completionFeedbackMatchesTask(context, "Child implementation contract")).toBe(true);
  });
  it("permits only read-only planners and the two explicitly declared worker scopes", () => {
    expect(validGovernedDelegation({ ...delegation, role: "planner", scope: "read_only" })).toBe(true);
    expect(validGovernedDelegation({ ...delegation, role: "worker", scope: "read_only" })).toBe(true);
    expect(validGovernedDelegation({ ...delegation, role: "planner" })).toBe(false);
  });
  const missing = Object.keys(delegation).map(key => {
    const copy: Record<string, unknown> = { ...delegation }; delete copy[key]; return copy;
  });
  const malformed: unknown[] = [null, [], {}, ...missing,
    { ...delegation, role: "coordinator" }, { ...delegation, role: ["worker"] },
    { ...delegation, scope: "workspace_write" }, { ...delegation, scope: ["read_only"] },
    { ...delegation, requires_parent_verification: false }, { ...delegation, requires_parent_verification: "true" },
    { ...delegation, parent_task: " \n\t" }, { ...delegation, parent_task: 42 },
    { ...delegation, parent_objective_sha256: parentSHA.toUpperCase() },
    { ...delegation, parent_objective_sha256: "g".repeat(64) },
    { ...delegation, parent_objective_sha256: "a".repeat(63) },
    { ...delegation, extra_authority: true }];
  for (const [index, value] of malformed.entries()) {
    it(`rejects malformed delegated metadata ${index} without changing ordinary context`, () => {
      expect(validGovernedDelegation(value)).toBe(false);
      expect(validExecutionContext({ ...valid, governed_delegation: value })).toBe(false);
      expect(() => parseStartRequest({ ...request, execution_context: { ...valid, governed_delegation: value } })).toThrow();
      expect(validExecutionContext(valid)).toBe(true);
    });
  }
  it("limits the declared parent by UTF-8 bytes, not characters", () => {
    const boundary = { ...delegation, parent_task: "😀".repeat(6_000) };
    expect(new TextEncoder().encode(boundary.parent_task).byteLength).toBe(24_000);
    expect(validGovernedDelegation(boundary)).toBe(true);
    expect(validGovernedDelegation({ ...boundary, parent_task: boundary.parent_task + "a" })).toBe(false);
  });
  it("binds the parent SHA to the exact transmitted bytes without normalization", async () => {
    const composed = "한글 parent", decomposed = composed.normalize("NFD");
    const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
    expect(digest(composed)).not.toBe(digest(decomposed));
    const good = { ...valid, governed_delegation: { ...delegation, parent_task: composed,
      parent_objective_sha256: digest(composed) } };
    expect(await completionFeedbackMatchesTask(good, "child")).toBe(true);
    expect(await completionFeedbackMatchesTask({ ...good, governed_delegation: {
      ...good.governed_delegation, parent_task: decomposed } }, "child")).toBe(false);
    expect(await completionFeedbackMatchesTask({ ...good, governed_delegation: {
      ...good.governed_delegation, parent_task: decomposed, parent_objective_sha256: digest(decomposed) } }, "child")).toBe(true);
  });
  it("retains ordinary feedback binding to the child task separately from its parent", async () => {
    const child = "Child implementation contract";
    const context = { ...valid, governed_delegation: delegation, completion_feedback: {
      schema: 1 as const, objective_sha256: createHash("sha256").update(child).digest("hex"), observations: [] } };
    expect(await completionFeedbackMatchesTask(context, child)).toBe(true);
    expect(await completionFeedbackMatchesTask(context, child + " changed")).toBe(false);
  });
  it("leaves older requests with no declaration unchanged", async () => {
    expect(parseStartRequest(request).execution_context).toBeUndefined();
    expect(parseStartRequest({ ...request, execution_context: valid }).execution_context).toEqual(valid);
    expect(await completionFeedbackMatchesTask(undefined, "ordinary old task")).toBe(true);
    expect(await completionFeedbackMatchesTask(valid, "ordinary old task")).toBe(true);
  });
});
