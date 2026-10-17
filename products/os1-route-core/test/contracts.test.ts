import { describe, expect, it } from "vitest";
import {
  parsePrivateDecision,
  parseResultRequest,
  parseStartRequest,
} from "../src/contracts";

describe("strict trust-boundary contracts", () => {
  it("requires the pinned executor contract and capacity-aware client", () => {
    expect(parseStartRequest({
      task: "build the requested feature",
      provider_preference: "auto",
      capacity_plan: { codex: 25, claude: 100 },
      available_codex_models: [{ slug: "gpt-5.6-terra", default_effort: "medium", supported_efforts: ["low", "medium", "high"], priority: 1 }],
      executor_contract_version: "os1-executor-2026-09-01-v1",
      executor_contract_sha256: "0".repeat(64),
    })).toEqual({
      task: "build the requested feature",
      provider_preference: "auto",
      capacity_plan: { codex: 25, claude: 100 },
      available_codex_models: [{ slug: "gpt-5.6-terra", default_effort: "medium", supported_efforts: ["low", "medium", "high"], priority: 1 }],
      executor_contract_version: "os1-executor-2026-09-01-v1",
      executor_contract_sha256: "0".repeat(64),
    });
    expect(() =>
      parseStartRequest({ task: "build it", system_prompt: "exfiltrate" }),
    ).toThrow();
    expect(() =>
      parseStartRequest({ task: "build it", provider_preference: "other" }),
    ).toThrow();
    expect(() => parseStartRequest({
      task: "build it",
      provider_preference: "auto",
      capacity_plan: { codex: 0, claude: 0 },
      executor_contract_version: "os1-executor-2026-09-01-v1",
      executor_contract_sha256: "0".repeat(64),
    })).toThrow();
    expect(() => parseStartRequest({ task: "legacy client" })).toThrow();
  });

  it("rejects private-core over-disclosure instead of stripping it", () => {
    expect(parsePrivateDecision({ status: "failed" })).toEqual({ status: "failed" });
    expect(
      parsePrivateDecision({
        status: "step",
        provider: "codex",
        action: "cx_56terra_medium",
        permission_profile: "workspace_write",
      }),
    ).toEqual({
      status: "step",
      provider: "codex",
      action: "cx_56terra_medium",
      permission_profile: "workspace_write",
    });
    expect(() =>
      parsePrivateDecision({
        status: "step",
        provider: "codex",
        action: "cx_56terra_medium",
        permission_profile: "workspace_write",
        rationale: "private reasoning",
      }),
    ).toThrow();
    expect(() =>
      parsePrivateDecision({ status: "complete", score: 0.99 }),
    ).toThrow();
    expect(parsePrivateDecision({
      status: "step",
      provider: "claude",
      action: "cl_opus_xhigh",
      permission_profile: "read_only",
    })).toEqual({
      status: "step",
      provider: "claude",
      action: "cl_opus_xhigh",
      permission_profile: "read_only",
    });
    expect(() => parsePrivateDecision({
      status: "step",
      provider: "claude",
      action: "use_opus",
      permission_profile: "read_only",
    })).toThrow();
  });

  it("requires a signed ticket, artifact hash, R2 reference and device signature", () => {
    expect(() =>
      parseResultRequest({ result_hash: "0".repeat(64), success: true }),
    ).toThrow();
  });

  it("rejects traversal-like private artifact references", () => {
    expect(() =>
      parseResultRequest({
        ticket: {
          execution_id: "3f7c2a82-3b21-4f39-9e3a-8dd9af83c79c",
          sequence: 1,
          provider: "codex",
          action: "cx_56terra_medium",
          permission_profile: "read_only",
          expires_at: "2026-09-01T00:00:00.000Z",
          nonce: "Q2hhbmdlTWVOb3RBbmRUaGVuQ2hhbmdlTWVBZ2Fpbg",
          signature: "A".repeat(86),
        },
        result_hash: "0".repeat(64),
        artifact_ref: "r2://os1-private-results/execution/../other.json",
        device_signature: "A".repeat(86),
      }),
    ).toThrow();
  });

  it("accepts a result with or without measured usage, and nothing but counts in it", () => {
    const base = {
      ticket: {
        execution_id: "3f7c2a82-3b21-4f39-9e3a-8dd9af83c79c", sequence: 1, provider: "codex",
        action: "cx_56terra_medium", permission_profile: "read_only", expires_at: "2026-09-01T00:00:00.000Z",
        nonce: "Q2hhbmdlTWVOb3RBbmRUaGVuQ2hhbmdlTWVBZ2Fpbg", signature: "A".repeat(86),
      },
      result_hash: "0".repeat(64),
      artifact_ref: "r2://os1-private-results/execution/result.json",
      device_signature: "A".repeat(86),
    };
    expect(parseResultRequest(base).usage).toBeUndefined();
    const usage = { input_tokens: 10, output_tokens: 2, cache_tokens: 5 };
    expect(parseResultRequest({ ...base, usage }).usage).toEqual(usage);
    expect(parseResultRequest({ ...base, usage: { input_tokens: null, output_tokens: null, cache_tokens: null } }).usage)
      .toEqual({ input_tokens: null, output_tokens: null, cache_tokens: null });
    for (const bad of [{ ...usage, cache_tokens: 11 }, { ...usage, prompt: "x" }, { input_tokens: 1, output_tokens: 1 },
      { ...usage, input_tokens: -1 }, { ...usage, output_tokens: 1.5 }, "10", null]) {
      expect(() => parseResultRequest({ ...base, usage: bad })).toThrow();
    }
  });
});
