import { describe, expect, it } from "vitest";
import { chooseCapacityAware, parsePolicy, select } from "../src/policy";

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
      budget_protected: false,
    });
  });

  it("starts with the selected engine and preserves the governed permission", () => {
    expect(select(policy, "analyze the repository", "codex")).toEqual({
      provider: "codex",
      fallback_provider: "claude",
      permission_profile: "workspace_write",
      max_steps: 2,
      budget_protected: true,
    });
    expect(select(policy, "fix the repository", "claude")).toEqual({
      provider: "claude",
      fallback_provider: "codex",
      permission_profile: "workspace_write",
      max_steps: 2,
      budget_protected: true,
    });
  });

  it("spends scarce Codex capacity only at its configured weekly share", () => {
    const flexible = select(policy, "build the repository", "auto");
    expect(chooseCapacityAware(flexible, { codex: 25, claude: 100 }, { codex: 0, claude: 0 })).toBe("claude");
    expect(chooseCapacityAware(flexible, { codex: 25, claude: 100 }, { codex: 0, claude: 2 })).toBe("codex");
  });
});
