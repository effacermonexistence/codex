import { describe, expect, it } from "vitest";
import { validExecutionContext } from "../src/execution-context";

describe("private boundary uses the same resource contract", () => {
  it("accepts source plus history only within the full assembled input", () => {
    expect(validExecutionContext({ input_utf8_bytes: 140000, source_utf8_bytes: 79401, history_utf8_bytes: 40000 })).toBe(true);
    expect(validExecutionContext({ input_utf8_bytes: 24, source_utf8_bytes: 79401, history_utf8_bytes: 40000 })).toBe(false);
    expect(validExecutionContext({ input_utf8_bytes: 140000, source_utf8_bytes: 79401, history_utf8_bytes: 40000, allow: true })).toBe(false);
  });
});
