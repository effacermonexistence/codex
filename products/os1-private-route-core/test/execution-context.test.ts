import { describe, expect, it } from "vitest";
import { validExecutionContext } from "../src/execution-context";

describe("private boundary uses the same resource contract", () => {
  it("accepts source plus history only within the full assembled input", () => {
    expect(validExecutionContext({ input_utf8_bytes: 140000, source_utf8_bytes: 79401, history_utf8_bytes: 40000 })).toBe(true);
    expect(validExecutionContext({ input_utf8_bytes: 24, source_utf8_bytes: 79401, history_utf8_bytes: 40000 })).toBe(false);
    expect(validExecutionContext({ input_utf8_bytes: 140000, source_utf8_bytes: 79401, history_utf8_bytes: 40000, allow: true })).toBe(false);
  });
});

it("accepts only bounded capability envelopes, not arbitrary authority", () => {
  const base = { input_utf8_bytes: 100, source_utf8_bytes: 0, history_utf8_bytes: 0 };
  for (const value of ["read_only", "workspace_write"]) expect(validExecutionContext({ ...base, execution_permission_profile: value })).toBe(true);
  for (const value of ["full_access", "bypass", true, null, {}]) expect(validExecutionContext({ ...base, execution_permission_profile: value })).toBe(false);
});
