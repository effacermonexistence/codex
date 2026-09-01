import { describe, expect, it } from "vitest";
import { parsePolicyBundle } from "../src/bundle";

const bundle = {
  schema: 1,
  policy_version: "policy-test-v1",
  executor_contract: { version: "executor-test-v1", sha256: "0".repeat(64) },
  routing: { version: 1, default_provider: "codex", default_permission_profile: "workspace_write", max_steps: 2, rules: [] },
  revas: {
    version: 1, minimum_output_chars: 10, pass_score: 85, retry_score: 55,
    transient_patterns: [], failure_patterns: [], incomplete_patterns: [],
    mutation_terms: [], exact_reply_terms: [], evidence_terms: [], stop_words: [],
  },
};

describe("private policy bundle", () => {
  it("accepts the exact version-pinned policy schema", () => {
    expect(parsePolicyBundle(JSON.stringify(bundle)).policy_version).toBe("policy-test-v1");
  });
  it("rejects unknown fields and invalid contract hashes", () => {
    expect(() => parsePolicyBundle(JSON.stringify({ ...bundle, rationale: "leak" }))).toThrow();
    expect(() => parsePolicyBundle(JSON.stringify({ ...bundle, executor_contract: { version: "executor-test-v1", sha256: "bad" } }))).toThrow();
  });
});
