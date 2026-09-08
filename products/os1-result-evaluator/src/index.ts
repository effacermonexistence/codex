import { executionBindingMatches, verificationRequestForIssuedPolicy, type Artifact } from "./evaluator";

const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROUTE_ID = /^rcc-local-[0-9a-f]{32}$/;
const ARTIFACT_REF = /^r2:\/\/os1-private-results\/([0-9a-f-]{36})\/([1-9][0-9]{0,5})\/([0-9a-f]{64})\.json$/i;
const MODEL_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ACTION = /^[A-Za-z0-9_-]{1,64}$/;
const EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max", "ultra"]);
const VERIFICATION_PROFILES = new Set(["deterministic_exact", "executed_change", "executed_review", "source_review", "native_record"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function parseNativeRecord(value: unknown): Artifact["native_record"] {
  if (!record(value) || !exact(value, ["desktop_visibility", "persistence", "record_path", "turn_id"]) ||
    (value.turn_id !== null && typeof value.turn_id !== "string") ||
    (value.record_path !== null && typeof value.record_path !== "string") ||
    typeof value.persistence !== "string" || value.persistence.length < 1 || value.persistence.length > 512 ||
    typeof value.desktop_visibility !== "string" || value.desktop_visibility.length < 1 || value.desktop_visibility.length > 512) {
    throw new Error("invalid");
  }
  return value as Artifact["native_record"];
}
function parseArtifact(value: unknown): Artifact {
  if (!record(value) || !exact(value, ["schema", "provider", "action", "permission_profile", "model", "effort",
    "executor_contract_version", "executor_contract_sha256", "exit_code", "output", "stderr", "duration_ms",
    "workspace_before_hash", "workspace_after_hash", "native_record"]) || value.schema !== 4 ||
    !["local", "codex", "claude"].includes(String(value.provider)) || typeof value.action !== "string" || !ACTION.test(value.action) ||
    !["read_only", "workspace_write"].includes(String(value.permission_profile)) ||
    typeof value.model !== "string" || !MODEL_IDENTIFIER.test(value.model) || typeof value.effort !== "string" || !EFFORTS.has(value.effort) ||
    typeof value.executor_contract_version !== "string" || value.executor_contract_version.length < 8 || value.executor_contract_version.length > 96 ||
    typeof value.executor_contract_sha256 !== "string" || !SHA256.test(value.executor_contract_sha256) ||
    !Number.isSafeInteger(value.exit_code) || typeof value.output !== "string" || value.output.length > 800_000 ||
    typeof value.stderr !== "string" || value.stderr.length > 200_000 || !Number.isSafeInteger(value.duration_ms) ||
    (value.duration_ms as number) < 0 || typeof value.workspace_before_hash !== "string" || !SHA256.test(value.workspace_before_hash) ||
    typeof value.workspace_after_hash !== "string" || !SHA256.test(value.workspace_after_hash)) throw new Error("invalid");
  return { ...(value as unknown as Artifact), native_record: parseNativeRecord(value.native_record) };
}
async function verifyWithRcc(env: Env, body: unknown): Promise<{ outcome: "pass" | "fail" | "retry"; next_provider: Artifact["provider"]; policy_sha256: string }> {
  const response = await env.RCC_V26.fetch(new Request("https://internal/verify", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  const bytes = await response.arrayBuffer();
  if (!response.ok || bytes.byteLength < 2 || bytes.byteLength > 32_768) throw new Error("denied");
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown;
  if (!record(value) || !exact(value, ["outcome", "next_provider", "policy_sha256"]) ||
    !["pass", "fail", "retry"].includes(String(value.outcome)) || !["local", "codex", "claude"].includes(String(value.next_provider)) ||
    typeof value.policy_sha256 !== "string" || !SHA256.test(value.policy_sha256)) throw new Error("denied");
  return value as { outcome: "pass" | "fail" | "retry"; next_provider: Artifact["provider"]; policy_sha256: string };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const stage = { current: "request" };
    try {
      if (request.method !== "POST" || new URL(request.url).pathname !== "/evaluate") throw new Error("denied");
      stage.current = "parse";
      const body = await request.json<unknown>();
      const keys = ["execution_id", "sequence", "task", "expected_provider", "expected_action", "expected_permission_profile",
        "expected_model", "expected_effort", "policy_version", "policy_sha256", "rcc_policy_sha256", "route_id",
        "verification_profile", "provider_pinned", "executor_contract_version", "executor_contract_sha256",
        "artifact_ref", "expected_artifact_hash"];
      stage.current = "validate_request";
      if (!record(body) || !exact(body, keys) || typeof body.execution_id !== "string" || !UUID.test(body.execution_id) ||
        !Number.isSafeInteger(body.sequence) || (body.sequence as number) < 1 || (body.sequence as number) > 4 ||
        typeof body.task !== "string" || body.task.length < 1 || body.task.length > 48_000 ||
        !["local", "codex", "claude"].includes(String(body.expected_provider)) || typeof body.expected_action !== "string" || !ACTION.test(body.expected_action) ||
        !["read_only", "workspace_write"].includes(String(body.expected_permission_profile)) ||
        typeof body.expected_model !== "string" || !MODEL_IDENTIFIER.test(body.expected_model) ||
        typeof body.expected_effort !== "string" || !EFFORTS.has(body.expected_effort) ||
        typeof body.policy_version !== "string" || body.policy_version.length < 8 || body.policy_version.length > 96 ||
        typeof body.policy_sha256 !== "string" || !SHA256.test(body.policy_sha256) ||
        typeof body.rcc_policy_sha256 !== "string" || !SHA256.test(body.rcc_policy_sha256) ||
        typeof body.route_id !== "string" || !ROUTE_ID.test(body.route_id) ||
        typeof body.verification_profile !== "string" || !VERIFICATION_PROFILES.has(body.verification_profile) ||
        typeof body.provider_pinned !== "boolean" || typeof body.executor_contract_version !== "string" ||
        body.executor_contract_version.length < 8 || body.executor_contract_version.length > 96 ||
        typeof body.executor_contract_sha256 !== "string" || !SHA256.test(body.executor_contract_sha256) ||
        typeof body.artifact_ref !== "string" || typeof body.expected_artifact_hash !== "string" || !SHA256.test(body.expected_artifact_hash)) throw new Error("denied");
      stage.current = "validate_reference";
      const match = body.artifact_ref.match(ARTIFACT_REF);
      if (!match || match[1] !== body.execution_id || Number(match[2]) !== body.sequence || match[3] !== body.expected_artifact_hash) throw new Error("denied");
      const key = body.artifact_ref.slice("r2://os1-private-results/".length);
      stage.current = "load_artifact";
      const object = await env.RESULTS.get(key);
      if (!object || object.size < 2 || object.size > 1_048_576 || object.customMetadata?.execution_id !== body.execution_id ||
        object.customMetadata?.sequence !== String(body.sequence) || object.customMetadata?.result_hash !== body.expected_artifact_hash) throw new Error("denied");
      stage.current = "verify_artifact_hash";
      const bytes = await object.arrayBuffer();
      const verifiedHash = await sha256Hex(bytes);
      if (verifiedHash !== body.expected_artifact_hash) throw new Error("denied");
      stage.current = "parse_artifact";
      const artifact = parseArtifact(JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)));
      stage.current = "verify_execution_binding";
      if (!executionBindingMatches(artifact, {
        provider: body.expected_provider as Artifact["provider"], action: body.expected_action,
        permission_profile: body.expected_permission_profile as Artifact["permission_profile"], model: body.expected_model,
        effort: body.expected_effort, executor_contract_version: body.executor_contract_version,
        executor_contract_sha256: body.executor_contract_sha256,
      })) throw new Error("denied");
      stage.current = "verify_with_rcc";
      const verified = await verifyWithRcc(env, verificationRequestForIssuedPolicy(body.rcc_policy_sha256 as string, {
        route_id: body.route_id, prompt: body.task, output: artifact.output, stderr: artifact.stderr,
        verification_profile: body.verification_profile, native_persistence: artifact.native_record.persistence,
        exit_code: artifact.exit_code, attempt: body.sequence, before_workspace_hash: artifact.workspace_before_hash,
        after_workspace_hash: artifact.workspace_after_hash, provider_pinned: body.provider_pinned, provider: artifact.provider,
      }));
      stage.current = "verify_policy_identity";
      if (verified.policy_sha256 !== body.rcc_policy_sha256) throw new Error("denied");
      const executionHash = await sha256Hex(new TextEncoder().encode(body.execution_id).buffer as ArrayBuffer);
      console.log(JSON.stringify({ event: "revas_evaluation", execution_hash: executionHash.slice(0, 16), sequence: body.sequence, outcome: verified.outcome }));
      return Response.json({ outcome: verified.outcome, verified_artifact_hash: verifiedHash, next_provider: verified.next_provider });
    } catch {
      console.error(JSON.stringify({ event: "result_evaluation_denied", stage: stage.current }));
      return Response.json({ error: "denied" }, { status: 400 });
    }
  },
} satisfies ExportedHandler<Env>;
