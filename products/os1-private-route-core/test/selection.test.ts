import { describe, expect, it } from "vitest";
import {
  chooseCapacityAware,
  parsePolicy,
  select,
  selectAction,
} from "../src/policy";

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
      budget_protected: true,
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

  it("uses deep tiers for protected specialist rules", () => {
    const specialist = select(policy, "analyze the repository", "auto");
    expect(selectAction(specialist, "claude", "auto")).toBe("agent_run_deep");
  });

  it("uses efficient tiers when capacity moves a flexible task", () => {
    const flexible = select(policy, "build the repository", "auto");
    expect(selectAction(flexible, "claude", "auto")).toBe("agent_run_efficient");
    expect(selectAction(flexible, "codex", "auto")).toBe("agent_run");
  });

  it("does not match ASCII routing terms inside larger identifiers", () => {
    expect(select(policy, "reply exactly OS1_REANALYZE_OK", "auto").budget_protected).toBe(false);
  });

  it("keeps explicit provider overrides on the account default model", () => {
    const manual = select(policy, "analyze the repository", "codex");
    expect(selectAction(manual, "codex", "codex")).toBe("agent_run");
  });
});
