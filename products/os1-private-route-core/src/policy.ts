export type Provider = "codex" | "claude";
export type ProviderPreference = "auto" | Provider;
export type PermissionProfile = "read_only" | "workspace_write" | "full_access";
export type Step = {
  provider: Provider;
  fallback_provider: Provider;
  permission_profile: PermissionProfile;
  max_steps: number;
};
type Rule = Step & { terms: string[] };
export type Policy = {
  version: 1;
  default_provider: Provider;
  default_permission_profile: PermissionProfile;
  max_steps: number;
  rules: Rule[];
};

const providers = new Set<Provider>(["codex", "claude"]);
const permissions = new Set<PermissionProfile>([
  "read_only",
  "workspace_write",
  "full_access",
]);

function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && providers.has(value as Provider);
}

function isPermission(value: unknown): value is PermissionProfile {
  return typeof value === "string" && permissions.has(value as PermissionProfile);
}

export function parsePolicy(serialized: string): Policy {
  const value = JSON.parse(serialized) as Record<string, unknown>;
  if (
    value.version !== 1 ||
    !isProvider(value.default_provider) ||
    !isPermission(value.default_permission_profile) ||
    !Number.isSafeInteger(value.max_steps) ||
    (value.max_steps as number) < 1 ||
    (value.max_steps as number) > 4 ||
    !Array.isArray(value.rules) ||
    value.rules.length > 64
  ) {
    throw new Error("invalid policy");
  }
  const rules: Rule[] = value.rules.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new Error("invalid policy");
    }
    const rule = candidate as Record<string, unknown>;
    if (
      !isProvider(rule.provider) ||
      !isProvider(rule.fallback_provider) ||
      !isPermission(rule.permission_profile) ||
      !Number.isSafeInteger(rule.max_steps) ||
      (rule.max_steps as number) < 1 ||
      (rule.max_steps as number) > 4 ||
      !Array.isArray(rule.terms) ||
      rule.terms.length === 0 ||
      rule.terms.length > 64 ||
      rule.terms.some((term) => typeof term !== "string" || term.length < 2 || term.length > 128)
    ) {
      throw new Error("invalid policy");
    }
    return {
      provider: rule.provider,
      fallback_provider: rule.fallback_provider,
      permission_profile: rule.permission_profile,
      max_steps: rule.max_steps as number,
      terms: rule.terms as string[],
    };
  });
  return {
    version: 1,
    default_provider: value.default_provider,
    default_permission_profile: value.default_permission_profile,
    max_steps: value.max_steps as number,
    rules,
  };
}

export function select(
  policy: Policy,
  task: string,
  preference: ProviderPreference = "auto",
): Step {
  if (preference !== "auto") {
    return {
      provider: preference,
      fallback_provider: preference === "codex" ? "claude" : "codex",
      permission_profile: policy.default_permission_profile,
      max_steps: policy.max_steps,
    };
  }
  const folded = task.toLocaleLowerCase("und");
  const rule = policy.rules.find((candidate) =>
    candidate.terms.some((term) => folded.includes(term.toLocaleLowerCase("und"))),
  );
  if (rule) {
    return {
      provider: rule.provider,
      fallback_provider: rule.fallback_provider,
      permission_profile: rule.permission_profile,
      max_steps: rule.max_steps,
    };
  }
  return {
    provider: policy.default_provider,
    fallback_provider: policy.default_provider === "codex" ? "claude" : "codex",
    permission_profile: policy.default_permission_profile,
    max_steps: policy.max_steps,
  };
}
