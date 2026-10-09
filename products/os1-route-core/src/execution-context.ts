/** Resource/outcome metadata only. It never grants authority or claims billing. */
export type CompletionObservation = {
  provider: "codex" | "claude";
  model: string;
  effort: string;
  outcome: "adopted" | "quality_failure" | "timeout" | "capability_failure";
  input_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number | null;
};
export type CompletionFeedback = {
  schema: 1;
  objective_sha256: string;
  observations: CompletionObservation[];
};
export type ExecutionContext = {
  execution_permission_profile?: "read_only" | "workspace_write";
  input_utf8_bytes: number;
  source_utf8_bytes: number;
  history_utf8_bytes: number;
  completion_feedback?: CompletionFeedback;
  available_claude_models?: ClaudeModelCapability[];
  governed_delegation?: GovernedDelegation;
};

export type GovernedDelegation = {
  role: "planner" | "worker";
  scope: "read_only" | "isolated_workspace_write";
  parent_task: string;
  parent_objective_sha256: string;
  requires_parent_verification: true;
};
export function validGovernedDelegation(value: unknown): value is GovernedDelegation {
  return exactRecord(value, ["role", "scope", "parent_task", "parent_objective_sha256", "requires_parent_verification"]) &&
    typeof value.role === "string" && ["planner", "worker"].includes(value.role) &&
    typeof value.scope === "string" && ["read_only", "isolated_workspace_write"].includes(value.scope) &&
    (value.role !== "planner" || value.scope === "read_only") && value.requires_parent_verification === true &&
    typeof value.parent_task === "string" && value.parent_task.trim().length > 0 &&
    new TextEncoder().encode(value.parent_task).byteLength <= 24_000 &&
    typeof value.parent_objective_sha256 === "string" && /^[0-9a-f]{64}$/.test(value.parent_objective_sha256);
}

export type ClaudeModelCapability = { model: string; supported_efforts: string[] };
export function validClaudeCatalog(value: unknown): value is ClaudeModelCapability[] {
  return Array.isArray(value) && value.length <= 32 &&
    value.every(row => exactRecord(row, ["model", "supported_efforts"]) &&
      typeof row.model === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.model) &&
      Array.isArray(row.supported_efforts) && row.supported_efforts.length > 0 && row.supported_efforts.length <= 5 &&
      new Set(row.supported_efforts).size === row.supported_efforts.length &&
      row.supported_efforts.every(e => ["low", "medium", "high", "xhigh", "max"].includes(e))) &&
    new Set(value.map(row => row.model)).size === value.length;
}

/** Independent ticket-boundary check; inventories can exclude, never grant. */
export function availableModelTuple(context: ExecutionContext | undefined, codex: { slug: string; supported_efforts: string[] }[],
  provider: string, model: string, effort: string): boolean {
  if (provider === "local") return true;
  if (provider === "codex") return codex.some(row => row.slug === model && row.supported_efforts.includes(effort));
  return provider === "claude" && (context?.available_claude_models === undefined ||
    context.available_claude_models.some(row => row.model === model && row.supported_efforts.includes(effort)));
}

function exactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).sort().join() === keys.sort().join();
}

function measuredInteger(value: unknown): boolean {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

export function validCompletionFeedback(value: unknown): value is CompletionFeedback {
  return exactRecord(value, ["schema", "objective_sha256", "observations"]) &&
    value.schema === 1 && typeof value.objective_sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(value.objective_sha256) && Array.isArray(value.observations) &&
    value.observations.length <= 16 && value.observations.every(observation =>
      exactRecord(observation, ["provider", "model", "effort", "outcome", "input_tokens", "output_tokens", "duration_ms"]) &&
      typeof observation.provider === "string" && ["codex", "claude"].includes(observation.provider) &&
      typeof observation.model === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(observation.model) &&
      typeof observation.effort === "string" && ["low", "medium", "high", "xhigh", "max", "ultra"].includes(observation.effort) &&
      typeof observation.outcome === "string" && ["adopted", "quality_failure", "timeout", "capability_failure"].includes(observation.outcome) &&
      measuredInteger(observation.input_tokens) && measuredInteger(observation.output_tokens) &&
      measuredInteger(observation.duration_ms));
}

export function validExecutionContext(value: unknown): value is ExecutionContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = ["history_utf8_bytes", "input_utf8_bytes", "source_utf8_bytes"];
  const expected = [...keys, ...(v.execution_permission_profile !== undefined ? ["execution_permission_profile"] : []), ...(v.completion_feedback !== undefined ? ["completion_feedback"] : []),
    ...(v.available_claude_models !== undefined ? ["available_claude_models"] : []),
    ...(v.governed_delegation !== undefined ? ["governed_delegation"] : [])].sort();
  if (Object.keys(v).sort().join() !== expected.join() ||
      keys.some(key => !Number.isSafeInteger(v[key]) || (v[key] as number) < 0 || (v[key] as number) > 4_000_000)) return false;
  return (v.execution_permission_profile === undefined || v.execution_permission_profile === "read_only" || v.execution_permission_profile === "workspace_write") &&
    (v.input_utf8_bytes as number) > 0 &&
    (v.source_utf8_bytes as number) + (v.history_utf8_bytes as number) <= (v.input_utf8_bytes as number) &&
    (v.completion_feedback === undefined || validCompletionFeedback(v.completion_feedback)) &&
    (v.available_claude_models === undefined || (validClaudeCatalog(v.available_claude_models) && validCompletionFeedback(v.completion_feedback))) &&
    (v.governed_delegation === undefined || validGovernedDelegation(v.governed_delegation));
}

/** Bind observations to the exact transmitted UTF-8 routing task, not a label. */
export async function completionFeedbackMatchesTask(context: ExecutionContext | undefined, task: string): Promise<boolean> {
  if (context?.governed_delegation) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(context.governed_delegation.parent_task));
    const digest = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
    if (context.governed_delegation.parent_objective_sha256 !== digest) return false;
  }
  if (!context?.completion_feedback) return true;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(task));
  const digest = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
  return context.completion_feedback.objective_sha256 === digest;
}
