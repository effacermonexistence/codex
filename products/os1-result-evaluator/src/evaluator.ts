export type Artifact = {
  provider: "local" | "codex" | "claude"; action: string;
  permission_profile: "read_only" | "workspace_write"; model: string; effort: string;
  executor_contract_version: string; executor_contract_sha256: string;
  exit_code: number; output: string; stderr: string;
  workspace_before_hash: string; workspace_after_hash: string;
  native_record: { turn_id: string | null; record_path: string | null; persistence: string; desktop_visibility: string };
};
export type ExpectedExecution = Pick<Artifact,
  "provider" | "action" | "permission_profile" | "model" | "effort" |
  "executor_contract_version" | "executor_contract_sha256"
>;

/**
 * Bind result verification to the immutable RCC adapter that issued the
 * route. During a rolling deployment, using the evaluator's current default
 * adapter can reject a valid in-flight result at the policy-identity gate.
 */
export function verificationRequestForIssuedPolicy<T extends Record<string, unknown>>(
  rccPolicySha256: string,
  request: T,
): T & { policy_sha256: string } {
  return { policy_sha256: rccPolicySha256, ...request };
}

export function executionBindingMatches(artifact: Artifact, expected: ExpectedExecution): boolean {
  return artifact.provider === expected.provider &&
    artifact.action === expected.action &&
    artifact.permission_profile === expected.permission_profile &&
    artifact.model === expected.model &&
    artifact.effort === expected.effort &&
    artifact.executor_contract_version === expected.executor_contract_version &&
    artifact.executor_contract_sha256 === expected.executor_contract_sha256;
}
