import { describe, expect, it } from "vitest";
import { validExecutionContext } from "../src/execution-context";
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
