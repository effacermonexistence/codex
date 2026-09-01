export type RevasPolicy = {
  version: 1; minimum_output_chars: number; pass_score: number; retry_score: number;
  transient_patterns: string[]; failure_patterns: string[]; incomplete_patterns: string[];
  mutation_terms: string[]; exact_reply_terms: string[]; evidence_terms: string[]; stop_words: string[];
};
export type Artifact = {
  provider: "codex" | "claude"; action: "agent_run" | "agent_run_efficient" | "agent_run_deep";
  permission_profile: "read_only" | "workspace_write" | "full_access"; effort: string;
  executor_contract_version: string; executor_contract_sha256: string;
  exit_code: number; output: string; stderr: string; workspace_diff_hash: string;
};
export type Evaluation = { outcome: "pass" | "fail" | "retry"; score: number; flags: string[] };

const EMPTY_DIFF = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
function includesAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern.toLocaleLowerCase("und")));
}

export function evaluateArtifact(task: string, artifact: Artifact, policy: RevasPolicy): Evaluation {
  const output = artifact.output.trim();
  const combined = `${artifact.output}\n${artifact.stderr}`.toLocaleLowerCase("und");
  const transient = includesAny(combined, policy.transient_patterns);
  const fatal = includesAny(combined, policy.failure_patterns);
  const incomplete = includesAny(combined, policy.incomplete_patterns);
  if (artifact.exit_code !== 0) return { outcome: transient ? "retry" : "fail", score: 0, flags: [transient ? "transient_exit" : "failed_exit"] };
  if (fatal) return { outcome: "fail", score: 0, flags: ["fatal_pattern"] };
  if (incomplete) return { outcome: "retry", score: policy.retry_score, flags: ["incomplete_pattern"] };
  if (output.length === 0) return { outcome: "retry", score: policy.retry_score, flags: ["empty_output"] };
  const foldedTask = task.toLocaleLowerCase("und");
  const exactReply = includesAny(foldedTask, policy.exact_reply_terms);
  const mutation = !exactReply && includesAny(foldedTask, policy.mutation_terms);
  const hasDiff = artifact.workspace_diff_hash !== EMPTY_DIFF;
  const hasEvidence = includesAny(combined, policy.evidence_terms);
  if (mutation && !hasDiff && !hasEvidence) return { outcome: "retry", score: policy.retry_score, flags: ["missing_change_evidence"] };
  const stop = new Set(policy.stop_words.map((word) => word.toLocaleLowerCase("und")));
  const tokens = foldedTask.match(/[\p{L}\p{N}_-]{4,}/gu) ?? [];
  const material = [...new Set(tokens.filter((token) => !stop.has(token)))].slice(0, 32);
  const aligned = exactReply || material.length === 0 || material.some((token) => combined.includes(token));
  let score = 35 + 15 + 15 + 10;
  if (exactReply || output.length >= policy.minimum_output_chars) score += 15;
  if (aligned) score += 15;
  if (mutation ? hasDiff || hasEvidence : true) score += 10;
  score = Math.min(score, 100);
  const flags = [exactReply ? "exact_reply" : "substantive", aligned ? "aligned" : "unaligned", mutation ? "mutation" : "nonmutation"];
  return { outcome: score >= policy.pass_score ? "pass" : score >= policy.retry_score ? "retry" : "fail", score, flags };
}
