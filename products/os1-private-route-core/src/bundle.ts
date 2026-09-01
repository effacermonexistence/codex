import { parsePolicy, type Policy } from "./policy";

const SHA256 = /^[0-9a-f]{64}$/;
const POLICY_KEY = /^os1\/policies\/([0-9a-f]{64})\.json$/;
const CONTRACT_VERSION = /^[A-Za-z0-9._-]{8,96}$/;

export type RevasPolicy = {
  version: 1;
  minimum_output_chars: number;
  pass_score: number;
  retry_score: number;
  transient_patterns: string[];
  failure_patterns: string[];
  incomplete_patterns: string[];
  mutation_terms: string[];
  exact_reply_terms: string[];
  evidence_terms: string[];
  stop_words: string[];
};

export type PolicyBundle = {
  schema: 1;
  policy_version: string;
  executor_contract: { version: string; sha256: string };
  routing: Policy;
  revas: RevasPolicy;
};

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedList(value: unknown, maximum: number): value is string[] {
  return Array.isArray(value) && value.length <= maximum && value.every(
    (entry) => typeof entry === "string" && entry.length >= 2 && entry.length <= 128,
  );
}

function parseRevas(value: unknown): RevasPolicy {
  if (!record(value) || !exact(value, [
    "version", "minimum_output_chars", "pass_score", "retry_score",
    "transient_patterns", "failure_patterns", "incomplete_patterns",
    "mutation_terms", "exact_reply_terms", "evidence_terms", "stop_words",
  ])) throw new Error("invalid policy bundle");
  if (
    value.version !== 1 ||
    !Number.isSafeInteger(value.minimum_output_chars) ||
    (value.minimum_output_chars as number) < 1 || (value.minimum_output_chars as number) > 8_192 ||
    !Number.isSafeInteger(value.pass_score) || (value.pass_score as number) < 1 || (value.pass_score as number) > 100 ||
    !Number.isSafeInteger(value.retry_score) || (value.retry_score as number) < 0 ||
    (value.retry_score as number) >= (value.pass_score as number) ||
    !boundedList(value.transient_patterns, 64) ||
    !boundedList(value.failure_patterns, 64) ||
    !boundedList(value.incomplete_patterns, 64) ||
    !boundedList(value.mutation_terms, 64) ||
    !boundedList(value.exact_reply_terms, 32) ||
    !boundedList(value.evidence_terms, 64) ||
    !boundedList(value.stop_words, 128)
  ) throw new Error("invalid policy bundle");
  return value as RevasPolicy;
}

export function parsePolicyBundle(serialized: string): PolicyBundle {
  const value = JSON.parse(serialized) as unknown;
  if (!record(value) || !exact(value, [
    "schema", "policy_version", "executor_contract", "routing", "revas",
  ]) || value.schema !== 1 || typeof value.policy_version !== "string" ||
    value.policy_version.length < 8 || value.policy_version.length > 96 ||
    !record(value.executor_contract) ||
    !exact(value.executor_contract, ["version", "sha256"]) ||
    typeof value.executor_contract.version !== "string" ||
    !CONTRACT_VERSION.test(value.executor_contract.version) ||
    typeof value.executor_contract.sha256 !== "string" ||
    !SHA256.test(value.executor_contract.sha256)
  ) throw new Error("invalid policy bundle");
  return {
    schema: 1,
    policy_version: value.policy_version,
    executor_contract: {
      version: value.executor_contract.version,
      sha256: value.executor_contract.sha256,
    },
    routing: parsePolicy(JSON.stringify(value.routing)),
    revas: parseRevas(value.revas),
  };
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("invalid policy configuration");
  return parsed;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function loadPolicyBundle(env: Env): Promise<PolicyBundle> {
  const keyMatch = env.POLICY_BUNDLE_KEY.match(POLICY_KEY);
  if (!keyMatch || keyMatch[1] !== env.POLICY_BUNDLE_SHA256 || !SHA256.test(env.POLICY_BUNDLE_SHA256)) {
    throw new Error("invalid policy configuration");
  }
  const object = await env.POLICY_BUNDLES.get(env.POLICY_BUNDLE_KEY);
  const maximum = positiveInteger(env.MAX_POLICY_BUNDLE_BYTES);
  if (!object || object.size < 2 || object.size > maximum) throw new Error("policy bundle unavailable");
  const bytes = await object.arrayBuffer();
  if (await sha256Hex(bytes) !== env.POLICY_BUNDLE_SHA256) throw new Error("policy bundle integrity failure");
  const serialized = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  return parsePolicyBundle(serialized);
}
