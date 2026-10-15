import type { ExecutionProfiles, PolicyBundle } from "./bundle";
import { backendEffort } from "./execution-context";

export type ExplicitProfile = {
  provider: "codex" | "claude";
  model: string;
  effort: string;
  permission_profile: "read_only" | "workspace_write";
};

/** Authorization is not routing: admit this exact configured tuple or deny it.
 * No model invocation, name ranking, quota substitution or fallback exists here. */
export function admitExplicitProfile(value: unknown, profiles: ExecutionProfiles,
  contracts: PolicyBundle["executor_contracts"], contractVersion: string, contractSHA: string,
  permission: unknown): { selected: ExplicitProfile; action: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("denied");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join("|") !== "effort|model|permission_profile|provider" ||
      typeof v.provider !== "string" || !["codex", "claude"].includes(v.provider) ||
      typeof v.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v.model) ||
      typeof v.effort !== "string" || !backendEffort(v.provider, v.effort) ||
      typeof v.permission_profile !== "string" || !["read_only", "workspace_write"].includes(v.permission_profile) ||
      v.permission_profile !== permission ||
      !/^[A-Za-z0-9._-]{8,96}$/.test(contractVersion) || !/^[a-f0-9]{64}$/.test(contractSHA) ||
      !contracts.some(c => c.version === contractVersion && c.sha256 === contractSHA)) throw Error("denied");
  const matches = Object.entries(profiles).filter(([, p]) =>
    p.provider === v.provider && p.model === v.model && p.effort === v.effort);
  if (matches.length !== 1) throw Error("denied");
  return { selected: v as ExplicitProfile, action: matches[0]![0] };
}
