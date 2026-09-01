const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ARTIFACT_REF = /^r2:\/\/os1-private-results\/([0-9a-f-]{36})\/([1-9][0-9]{0,5})\/([0-9a-f]{64})\.json$/i;
import { evaluateArtifact, type Artifact, type RevasPolicy } from "./evaluator";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function boundedList(value: unknown, maximum: number): value is string[] {
  return Array.isArray(value) && value.length <= maximum && value.every((item) => typeof item === "string" && item.length >= 2 && item.length <= 128);
}
function parseRevas(value: unknown): RevasPolicy {
  if (!record(value) || !exact(value, ["version", "minimum_output_chars", "pass_score", "retry_score", "transient_patterns", "failure_patterns", "incomplete_patterns", "mutation_terms", "exact_reply_terms", "evidence_terms", "stop_words"]) ||
    value.version !== 1 || !Number.isSafeInteger(value.minimum_output_chars) || !Number.isSafeInteger(value.pass_score) || !Number.isSafeInteger(value.retry_score) ||
    !boundedList(value.transient_patterns, 64) || !boundedList(value.failure_patterns, 64) || !boundedList(value.incomplete_patterns, 64) ||
    !boundedList(value.mutation_terms, 64) || !boundedList(value.exact_reply_terms, 32) || !boundedList(value.evidence_terms, 64) || !boundedList(value.stop_words, 128)) throw new Error("invalid");
  const policy = value as RevasPolicy;
  if (policy.minimum_output_chars < 1 || policy.minimum_output_chars > 8_192 || policy.pass_score < 1 || policy.pass_score > 100 || policy.retry_score < 0 || policy.retry_score >= policy.pass_score) throw new Error("invalid");
  return policy;
}
async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function parseArtifact(value: unknown): Artifact {
  if (!record(value) || !exact(value, ["schema", "provider", "action", "permission_profile", "effort", "executor_contract_version", "executor_contract_sha256", "exit_code", "output", "stderr", "duration_ms", "workspace_diff_hash"]) ||
    value.schema !== 2 || !["codex", "claude"].includes(String(value.provider)) ||
    !["agent_run", "agent_run_efficient", "agent_run_deep"].includes(String(value.action)) ||
    !["read_only", "workspace_write", "full_access"].includes(String(value.permission_profile)) ||
    typeof value.effort !== "string" || value.effort.length < 3 || value.effort.length > 16 ||
    typeof value.executor_contract_version !== "string" || value.executor_contract_version.length < 8 || value.executor_contract_version.length > 96 ||
    typeof value.executor_contract_sha256 !== "string" || !SHA256.test(value.executor_contract_sha256) ||
    !Number.isSafeInteger(value.exit_code) || typeof value.output !== "string" || value.output.length > 800_000 ||
    typeof value.stderr !== "string" || value.stderr.length > 200_000 || !Number.isSafeInteger(value.duration_ms) ||
    (value.duration_ms as number) < 0 || typeof value.workspace_diff_hash !== "string" || !SHA256.test(value.workspace_diff_hash)) throw new Error("invalid");
  return value as unknown as Artifact;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/evaluate") throw new Error("denied");
      const body = await request.json<unknown>();
      if (!record(body) || !exact(body, ["execution_id", "sequence", "task", "expected_provider", "expected_action", "expected_permission_profile", "policy_version", "policy_sha256", "executor_contract_version", "executor_contract_sha256", "revas", "artifact_ref", "expected_artifact_hash"]) ||
        typeof body.execution_id !== "string" || !UUID.test(body.execution_id) || !Number.isSafeInteger(body.sequence) ||
        typeof body.task !== "string" || body.task.length < 1 || body.task.length > 48_000 ||
        !["codex", "claude"].includes(String(body.expected_provider)) ||
        !["agent_run", "agent_run_efficient", "agent_run_deep"].includes(String(body.expected_action)) ||
        !["read_only", "workspace_write", "full_access"].includes(String(body.expected_permission_profile)) ||
        typeof body.policy_version !== "string" || body.policy_version.length < 8 || body.policy_version.length > 96 ||
        typeof body.policy_sha256 !== "string" || !SHA256.test(body.policy_sha256) ||
        typeof body.executor_contract_version !== "string" || body.executor_contract_version.length < 8 || body.executor_contract_version.length > 96 ||
        typeof body.executor_contract_sha256 !== "string" || !SHA256.test(body.executor_contract_sha256) ||
        typeof body.artifact_ref !== "string" || typeof body.expected_artifact_hash !== "string" || !SHA256.test(body.expected_artifact_hash)) throw new Error("denied");
      const match = body.artifact_ref.match(ARTIFACT_REF);
      if (!match || match[1] !== body.execution_id || Number(match[2]) !== body.sequence || match[3] !== body.expected_artifact_hash) throw new Error("denied");
      const key = body.artifact_ref.slice("r2://os1-private-results/".length);
      const object = await env.RESULTS.get(key);
      if (!object || object.size < 2 || object.size > 1_048_576 ||
        object.customMetadata?.execution_id !== body.execution_id || object.customMetadata?.sequence !== String(body.sequence) ||
        object.customMetadata?.result_hash !== body.expected_artifact_hash) throw new Error("denied");
      const bytes = await object.arrayBuffer();
      const verifiedHash = await sha256Hex(bytes);
      if (verifiedHash !== body.expected_artifact_hash) throw new Error("denied");
      const artifact = parseArtifact(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)));
      if (artifact.provider !== body.expected_provider || artifact.action !== body.expected_action ||
        artifact.permission_profile !== body.expected_permission_profile ||
        artifact.executor_contract_version !== body.executor_contract_version || artifact.executor_contract_sha256 !== body.executor_contract_sha256) throw new Error("denied");
      const evaluation = evaluateArtifact(body.task, artifact, parseRevas(body.revas));
      const executionBytes = new TextEncoder().encode(body.execution_id);
      const executionHash = await sha256Hex(executionBytes.buffer.slice(executionBytes.byteOffset, executionBytes.byteOffset + executionBytes.byteLength) as ArrayBuffer);
      console.log(JSON.stringify({ event: "revas_evaluation", execution_hash: executionHash.slice(0, 16),
        sequence: body.sequence, policy_sha256: body.policy_sha256, outcome: evaluation.outcome, score: evaluation.score, flags: evaluation.flags }));
      return Response.json({ outcome: evaluation.outcome, verified_artifact_hash: verifiedHash });
    } catch {
      return Response.json({ error: "denied" }, { status: 400 });
    }
  },
} satisfies ExportedHandler<Env>;
