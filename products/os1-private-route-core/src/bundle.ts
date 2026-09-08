const SHA256 = /^[0-9a-f]{64}$/;
const POLICY_KEY = /^os1\/policies\/([0-9a-f]{64})\.json$/;
const CONTRACT_VERSION = /^[A-Za-z0-9._-]{8,96}$/;
const MODEL_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{1,95}$/;
const EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

export type ExecutionProvider = "local" | "codex" | "claude";
export type ExecutionProfile = { provider: ExecutionProvider; model: string; effort: string };
export type ExecutionProfiles = Record<string, ExecutionProfile>;
export type RccPolicyIdentity = {
  adapter_version: string;
  policy_sha256: string;
  engine_sha256: string;
  authority_sha256: string;
};

export type PolicyBundle = {
  schema: 4;
  policy_version: string;
  executor_contracts: Array<{ version: string; sha256: string }>;
  execution_profiles: ExecutionProfiles;
  maximum_steps: number;
  rcc: RccPolicyIdentity;
};

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseExecutionProfile(value: unknown): ExecutionProfile {
  if (!record(value) || !exact(value, ["provider", "model", "effort"]) ||
    !["local", "codex", "claude"].includes(String(value.provider)) ||
    typeof value.model !== "string" || !MODEL_IDENTIFIER.test(value.model) ||
    typeof value.effort !== "string" || !EFFORTS.has(value.effort)
  ) throw new Error("invalid policy bundle");
  return { provider: value.provider as ExecutionProvider, model: value.model, effort: value.effort };
}

export function parseExecutionProfiles(value: unknown): ExecutionProfiles {
  if (!record(value)) throw new Error("invalid policy bundle");
  const entries = Object.entries(value);
  if (entries.length < 5 || entries.length > 64) throw new Error("invalid policy bundle");
  const output: ExecutionProfiles = {};
  for (const [action, candidate] of entries) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(action) || !record(candidate) ||
      !exact(candidate, ["provider", "model", "effort"]) ||
      !["local", "codex", "claude"].includes(String(candidate.provider))) {
      throw new Error("invalid policy bundle");
    }
    const profile = parseExecutionProfile(candidate);
    if ((candidate.provider === "local") !== (profile.effort === "none") ||
      (candidate.provider === "local" && profile.model !== "local-deterministic")) {
      throw new Error("invalid policy bundle");
    }
    output[action] = profile;
  }
  return output;
}

export function executionProfileFor(
  profiles: ExecutionProfiles,
  provider: ExecutionProvider,
  action: string,
): ExecutionProfile {
  const profile = profiles[action];
  if (!profile || profile.provider !== provider) throw new Error("invalid execution profile");
  return profile;
}

function parseRccIdentity(value: unknown): RccPolicyIdentity {
  if (!record(value) || !exact(value, ["adapter_version", "policy_sha256", "engine_sha256", "authority_sha256"]) ||
    typeof value.adapter_version !== "string" || !CONTRACT_VERSION.test(value.adapter_version) ||
    typeof value.policy_sha256 !== "string" || !SHA256.test(value.policy_sha256) ||
    typeof value.engine_sha256 !== "string" || !SHA256.test(value.engine_sha256) ||
    typeof value.authority_sha256 !== "string" || !SHA256.test(value.authority_sha256)) {
    throw new Error("invalid policy bundle");
  }
  return value as RccPolicyIdentity;
}

export function parsePolicyBundle(serialized: string): PolicyBundle {
  const value = JSON.parse(serialized) as unknown;
  if (!record(value) || value.schema !== 4 ||
    typeof value.policy_version !== "string" ||
    value.policy_version.length < 8 || value.policy_version.length > 96
  ) throw new Error("invalid policy bundle");
  const candidates = exact(value, [
    "schema", "policy_version", "executor_contracts", "execution_profiles", "maximum_steps", "rcc",
  ]) && Array.isArray(value.executor_contracts) ? value.executor_contracts : null;
  if (!candidates || candidates.length < 1 || candidates.length > 4 ||
    candidates.some((candidate) => !record(candidate) ||
      !exact(candidate, ["version", "sha256"]) ||
      typeof candidate.version !== "string" || !CONTRACT_VERSION.test(candidate.version) ||
      typeof candidate.sha256 !== "string" || !SHA256.test(candidate.sha256))
  ) throw new Error("invalid policy bundle");
  const executorContracts = candidates.map((candidate) => ({
    version: String((candidate as Record<string, unknown>).version),
    sha256: String((candidate as Record<string, unknown>).sha256),
  }));
  if (new Set(executorContracts.map((contract) => contract.version)).size !== executorContracts.length ||
    new Set(executorContracts.map((contract) => contract.sha256)).size !== executorContracts.length
  ) throw new Error("invalid policy bundle");
  if (!Number.isSafeInteger(value.maximum_steps) || (value.maximum_steps as number) < 1 ||
    (value.maximum_steps as number) > 4) throw new Error("invalid policy bundle");
  return {
    schema: 4,
    policy_version: value.policy_version,
    executor_contracts: executorContracts,
    execution_profiles: parseExecutionProfiles(value.execution_profiles),
    maximum_steps: value.maximum_steps as number,
    rcc: parseRccIdentity(value.rcc),
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

export async function loadPolicyBundle(env: Env, persistedSha256?: string): Promise<PolicyBundle> {
  const expectedSha256 = persistedSha256 ?? env.POLICY_BUNDLE_SHA256;
  const key = persistedSha256 === undefined ? env.POLICY_BUNDLE_KEY : `os1/policies/${persistedSha256}.json`;
  const keyMatch = key.match(POLICY_KEY);
  if (!keyMatch || keyMatch[1] !== expectedSha256 || !SHA256.test(expectedSha256)) {
    throw new Error("invalid policy configuration");
  }
  const object = await env.POLICY_BUNDLES.get(key);
  const maximum = positiveInteger(env.MAX_POLICY_BUNDLE_BYTES);
  if (!object || object.size < 2 || object.size > maximum) throw new Error("policy bundle unavailable");
  const bytes = await object.arrayBuffer();
  if (await sha256Hex(bytes) !== expectedSha256) throw new Error("policy bundle integrity failure");
  const serialized = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  return parsePolicyBundle(serialized);
}
