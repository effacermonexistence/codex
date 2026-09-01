import { describe, expect, it } from "vitest";
import { parsePolicy, select } from "../src/policy";

const policy = parsePolicy(JSON.stringify({
  version: 1,
  default_provider: "codex",
  default_permission_profile: "workspace_write",
  max_steps: 2,
  rules: [{
    terms: ["analyze"],
    provider: "claude",
    fallback_provider: "codex",
    permission_profile: "read_only",
    max_steps: 1,
  }],
}));

describe("explicit provider preference", () => {
  it("keeps RCC policy selection in auto mode", () => {
    expect(select(policy, "analyze the repository", "auto")).toEqual({
      provider: "claude",
      fallback_provider: "codex",
      permission_profile: "read_only",
      max_steps: 1,
    });
  });

  it("starts with the selected engine and preserves the governed permission", () => {
    expect(select(policy, "analyze the repository", "codex")).toEqual({
      provider: "codex",
      fallback_provider: "claude",
      permission_profile: "workspace_write",
      max_steps: 2,
    });
    expect(select(policy, "fix the repository", "claude")).toEqual({
      provider: "claude",
      fallback_provider: "codex",
      permission_profile: "workspace_write",
      max_steps: 2,
    });
  });
});
