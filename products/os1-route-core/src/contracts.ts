import { reject } from "./errors";

export const PROVIDERS = ["codex", "claude"] as const;
export const ACTIONS = [
  "agent_run",
  "agent_run_efficient",
  "agent_run_deep",
] as const;
export const PERMISSION_PROFILES = [
  "read_only",
  "workspace_write",
  "full_access",
] as const;

export type Provider = (typeof PROVIDERS)[number];
export type Action = (typeof ACTIONS)[number];
export type PermissionProfile = (typeof PERMISSION_PROFILES)[number];
export type ProviderPreference = "auto" | Provider;
export type CapacityPlan = { codex: number; claude: number };

export type TicketUnsigned = {
  execution_id: string;
  sequence: number;
  provider: Provider;
  action: Action;
  permission_profile: PermissionProfile;
  expires_at: string;
  nonce: string;
};

export type Ticket = TicketUnsigned & { signature: string };
export type CompleteResponse = { status: "complete" };
export type RegisteredResponse = { status: "registered" };
export type ArtifactResponse = { artifact_ref: string };
export type PublicResponse =
  | Ticket
  | CompleteResponse
  | RegisteredResponse
  | ArtifactResponse;

export type AuthIdentity = {
  subject: string;
  device_id: string;
};

export type DeviceRecord = {
  subject: string;
  device_id: string;
  p256_public_jwk: JsonWebKey;
};

export type PrivateDecision =
  | { status: "complete" }
  | {
      status: "step";
      provider: Provider;
      action: Action;
      permission_profile: PermissionProfile;
    };

export type EvaluatedResult = {
  outcome: "pass" | "fail" | "retry";
  verified_artifact_hash: string;
};

export type ResultRequest = {
  ticket: Ticket;
  result_hash: string;
  artifact_ref: string;
  device_signature: string;
};

export type DeviceRegistration = {
  device_id: string;
  registered_at: number;
  nonce: string;
  p256_public_jwk: JsonWebKey;
  signature: string;
};

export type ArtifactUploadRequest = {
  ticket: Ticket;
  artifact_base64: string;
  result_hash: string;
  device_signature: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const DEVICE_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const ARTIFACT_REF = /^r2:\/\/os1-private-results\/[A-Za-z0-9._\/-]{1,384}$/;

function isArtifactRef(value: unknown): value is string {
  if (!boundedString(value, 8, 512, ARTIFACT_REF)) return false;
  const key = value.slice("r2://os1-private-results/".length);
  return !key.startsWith("/") && !key.split("/").includes("..");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseDeviceId(value: unknown): string {
  if (!boundedString(value, 8, 128, DEVICE_ID)) reject();
  return value;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function oneOf<T extends string>(
  value: unknown,
  values: readonly T[],
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function boundedString(
  value: unknown,
  min: number,
  max: number,
  pattern?: RegExp,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= min &&
    value.length <= max &&
    (pattern === undefined || pattern.test(value))
  );
}

export function parseStartRequest(value: unknown): {
  task: string;
  provider_preference: ProviderPreference;
  capacity_plan: CapacityPlan;
} {
  const legacy = isRecord(value) && hasExactKeys(value, ["task"]);
  const current = isRecord(value) && hasExactKeys(value, [
    "task",
    "provider_preference",
  ]);
  const capacityAware = isRecord(value) && hasExactKeys(value, [
    "capacity_plan",
    "provider_preference",
    "task",
  ]);
  const capacity = isRecord(value) ? value.capacity_plan : undefined;
  const validCapacity = isRecord(capacity) &&
    hasExactKeys(capacity, ["claude", "codex"]) &&
    Number.isSafeInteger(capacity.codex) &&
    Number.isSafeInteger(capacity.claude) &&
    (capacity.codex as number) >= 0 &&
    (capacity.codex as number) <= 100 &&
    (capacity.claude as number) >= 0 &&
    (capacity.claude as number) <= 100 &&
    (capacity.codex as number) + (capacity.claude as number) > 0;
  if (
    !isRecord(value) ||
    (!legacy && !current && !capacityAware) ||
    !boundedString(value.task, 1, 48_000) ||
    ((current || capacityAware) &&
      !oneOf(value.provider_preference, ["auto", ...PROVIDERS] as const)) ||
    (capacityAware && !validCapacity)
  ) {
    reject();
  }
  return {
    task: value.task,
    provider_preference: current || capacityAware
      ? value.provider_preference as ProviderPreference
      : "auto",
    capacity_plan: capacityAware
      ? {
          codex: (capacity as Record<string, unknown>).codex as number,
          claude: (capacity as Record<string, unknown>).claude as number,
        }
      : { codex: 50, claude: 50 },
  };
}

export function parseTicket(value: unknown): Ticket {
  const keys = [
    "execution_id",
    "sequence",
    "provider",
    "action",
    "permission_profile",
    "expires_at",
    "nonce",
    "signature",
  ] as const;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, keys) ||
    !boundedString(value.execution_id, 36, 36, UUID) ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1 ||
    !oneOf(value.provider, PROVIDERS) ||
    !oneOf(value.action, ACTIONS) ||
    !oneOf(value.permission_profile, PERMISSION_PROFILES) ||
    !boundedString(value.expires_at, 20, 32) ||
    !Number.isFinite(Date.parse(value.expires_at)) ||
    !boundedString(value.nonce, 32, 128, BASE64URL) ||
    !boundedString(value.signature, 64, 256, BASE64URL)
  ) {
    reject();
  }
  return {
    execution_id: value.execution_id,
    sequence: value.sequence as number,
    provider: value.provider,
    action: value.action,
    permission_profile: value.permission_profile,
    expires_at: value.expires_at,
    nonce: value.nonce,
    signature: value.signature,
  };
}

export function parseResultRequest(value: unknown): ResultRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "ticket",
      "result_hash",
      "artifact_ref",
      "device_signature",
    ]) ||
    !boundedString(value.result_hash, 64, 64, SHA256) ||
    !isArtifactRef(value.artifact_ref) ||
    !boundedString(value.device_signature, 64, 256, BASE64URL)
  ) {
    reject();
  }
  return {
    ticket: parseTicket(value.ticket),
    result_hash: value.result_hash,
    artifact_ref: value.artifact_ref,
    device_signature: value.device_signature,
  };
}

export function parseAuthIdentity(value: unknown): AuthIdentity {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["subject", "device_id"]) ||
    !boundedString(value.subject, 1, 256) ||
    !boundedString(value.device_id, 8, 128, DEVICE_ID)
  ) {
    reject();
  }
  return { subject: value.subject, device_id: value.device_id };
}

function parseP256Jwk(value: unknown): JsonWebKey {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["kty", "crv", "x", "y"]) ||
    value.kty !== "EC" ||
    value.crv !== "P-256" ||
    !boundedString(value.x, 40, 64, BASE64URL) ||
    !boundedString(value.y, 40, 64, BASE64URL)
  ) {
    reject();
  }
  return { kty: "EC", crv: "P-256", x: value.x, y: value.y };
}

export function parseDeviceRegistration(value: unknown): DeviceRegistration {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "device_id",
      "registered_at",
      "nonce",
      "p256_public_jwk",
      "signature",
    ]) ||
    !Number.isSafeInteger(value.registered_at) ||
    !boundedString(value.nonce, 32, 128, BASE64URL) ||
    !boundedString(value.signature, 64, 256, BASE64URL)
  ) {
    reject();
  }
  return {
    device_id: parseDeviceId(value.device_id),
    registered_at: value.registered_at as number,
    nonce: value.nonce,
    p256_public_jwk: parseP256Jwk(value.p256_public_jwk),
    signature: value.signature,
  };
}

export function parseArtifactUploadRequest(
  value: unknown,
): ArtifactUploadRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "ticket",
      "artifact_base64",
      "result_hash",
      "device_signature",
    ]) ||
    !boundedString(value.artifact_base64, 4, 1_500_000, BASE64URL) ||
    !boundedString(value.result_hash, 64, 64, SHA256) ||
    !boundedString(value.device_signature, 64, 256, BASE64URL)
  ) {
    reject();
  }
  return {
    ticket: parseTicket(value.ticket),
    artifact_base64: value.artifact_base64,
    result_hash: value.result_hash,
    device_signature: value.device_signature,
  };
}

export function parseDeviceRecord(value: unknown): DeviceRecord {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["subject", "device_id", "p256_public_jwk"]) ||
    !boundedString(value.subject, 1, 256) ||
    !boundedString(value.device_id, 8, 128, DEVICE_ID)
  ) {
    reject();
  }
  return {
    subject: value.subject,
    device_id: value.device_id,
    p256_public_jwk: parseP256Jwk(value.p256_public_jwk),
  };
}

export function parsePrivateDecision(value: unknown): PrivateDecision {
  if (!isRecord(value) || typeof value.status !== "string") {
    reject();
  }
  if (value.status === "complete") {
    if (!hasExactKeys(value, ["status"])) reject();
    return { status: "complete" };
  }
  if (
    value.status !== "step" ||
    !hasExactKeys(value, [
      "status",
      "provider",
      "action",
      "permission_profile",
    ]) ||
    !oneOf(value.provider, PROVIDERS) ||
    !oneOf(value.action, ACTIONS) ||
    !oneOf(value.permission_profile, PERMISSION_PROFILES)
  ) {
    reject();
  }
  return {
    status: "step",
    provider: value.provider,
    action: value.action,
    permission_profile: value.permission_profile,
  };
}

export function parseEvaluatedResult(value: unknown): EvaluatedResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["outcome", "verified_artifact_hash"]) ||
    !oneOf(value.outcome, ["pass", "fail", "retry"] as const) ||
    !boundedString(value.verified_artifact_hash, 64, 64, SHA256)
  ) {
    reject();
  }
  return {
    outcome: value.outcome,
    verified_artifact_hash: value.verified_artifact_hash,
  };
}

export function parsePublicResponse(value: unknown): PublicResponse {
  if (isRecord(value) && value.status === "complete") {
    if (!hasExactKeys(value, ["status"])) reject();
    return { status: "complete" };
  }
  if (isRecord(value) && value.status === "registered") {
    if (!hasExactKeys(value, ["status"])) reject();
    return { status: "registered" };
  }
  if (
    isRecord(value) &&
    hasExactKeys(value, ["artifact_ref"]) &&
    isArtifactRef(value.artifact_ref)
  ) {
    return { artifact_ref: value.artifact_ref };
  }
  return parseTicket(value);
}

export function resultArtifactRef(ticket: Ticket, resultHash: string): string {
  if (!SHA256.test(resultHash)) reject();
  return `r2://os1-private-results/${ticket.execution_id}/${ticket.sequence}/${resultHash}.json`;
}

export function resultArtifactKey(artifactRef: string): string {
  if (!isArtifactRef(artifactRef)) reject();
  return artifactRef.slice("r2://os1-private-results/".length);
}
