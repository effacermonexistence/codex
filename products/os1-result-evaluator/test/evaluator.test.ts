import { describe, expect, it } from "vitest";
import { executionBindingMatches, verificationRequestForIssuedPolicy, type Artifact } from "../src/evaluator";

const empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const base: Artifact = {
  provider: "codex", action: "agent_run", permission_profile: "workspace_write",
  model: "gpt-test", effort: "medium",
  executor_contract_version: "executor-test-v1", executor_contract_sha256: "0".repeat(64),
  exit_code: 0, output: "The requested repository analysis is verified.", stderr: "",
  workspace_before_hash: empty, workspace_after_hash: empty,
  native_record: { turn_id: "turn", record_path: "/tmp/record", persistence: "verified", desktop_visibility: "background" },
};

describe("source-locked REVAS evaluator boundary", () => {
  it("verifies an in-flight result with the RCC policy that issued its route", () => {
    const issuingPolicy = "a".repeat(64);
    expect(verificationRequestForIssuedPolicy(issuingPolicy, { route_id: "route", attempt: 1 })).toEqual({
      policy_sha256: issuingPolicy,
      route_id: "route",
      attempt: 1,
    });
  });

  it("rejects client-side model, effort, permission, and contract substitution", () => {
    const expected = {
      provider: base.provider,
      action: base.action,
      permission_profile: base.permission_profile,
      model: base.model,
      effort: base.effort,
      executor_contract_version: base.executor_contract_version,
      executor_contract_sha256: base.executor_contract_sha256,
    };
    expect(executionBindingMatches(base, expected)).toBe(true);
    expect(executionBindingMatches({ ...base, model: "gpt-other" }, expected)).toBe(false);
    expect(executionBindingMatches({ ...base, effort: "ultra" }, expected)).toBe(false);
    expect(executionBindingMatches({ ...base, permission_profile: "read_only" }, expected)).toBe(false);
    expect(executionBindingMatches({ ...base, executor_contract_sha256: "1".repeat(64) }, expected)).toBe(false);
  });
});
