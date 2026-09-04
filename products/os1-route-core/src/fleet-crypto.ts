import type {
  FleetClaimRequest,
  FleetCompleteRequest,
  FleetHeartbeatRequest,
  FleetStatusRequest,
  FleetSubmitRequest,
} from "./fleet-contracts";
import { base64UrlDecode } from "./crypto";

const encoder = new TextEncoder();

function value(value: string | number | boolean | null): string {
  return value === null ? "" : String(value);
}

function lines(kind: string, deviceId: string, fields: readonly (string | number | boolean | null)[]): Uint8Array {
  return encoder.encode([kind, deviceId, ...fields.map(value)].join("\n"));
}

export function canonicalFleetHeartbeat(deviceId: string, request: Omit<FleetHeartbeatRequest, "signature">): Uint8Array {
  const node = request.node;
  return lines("os1-fleet-heartbeat-v1", deviceId, [
    request.sent_at_ms, request.nonce, node.role, node.hostname, node.zerotier_ip,
    node.cpu_logical_count, Math.round(node.load_average_1m * 1_000), node.memory_total_mib,
    node.memory_available_mib, node.queue_depth, node.has_codex, node.has_claude,
    node.exo_ready, node.exo_nodes,
  ]);
}

export function canonicalFleetSubmit(deviceId: string, request: Omit<FleetSubmitRequest, "signature">): Uint8Array {
  return lines("os1-fleet-submit-v1", deviceId, [
    request.profile, request.task, request.workspace_repository, request.workspace_revision,
    request.workspace_subpath, request.requirements.min_memory_mib, request.requirements.cpu_weight,
    request.requirements.prefer_device_id, request.submitted_at_ms, request.nonce,
  ]);
}

export function canonicalFleetClaim(deviceId: string, request: Omit<FleetClaimRequest, "signature">): Uint8Array {
  return lines("os1-fleet-claim-v1", deviceId, [request.sent_at_ms, request.nonce]);
}

export function canonicalFleetComplete(deviceId: string, request: Omit<FleetCompleteRequest, "signature">): Uint8Array {
  return lines("os1-fleet-complete-v1", deviceId, [
    request.job_id, request.outcome, request.result, request.result_hash,
    request.completed_at_ms, request.nonce,
  ]);
}

export function canonicalFleetStatus(deviceId: string, request: Omit<FleetStatusRequest, "signature">): Uint8Array {
  return lines("os1-fleet-status-v1", deviceId, [request.job_id, request.sent_at_ms, request.nonce]);
}

export async function verifyFleetSignature(
  publicJwk: JsonWebKey,
  signature: string,
  payload: Uint8Array,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "jwk",
    publicJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    base64UrlDecode(signature),
    payload,
  );
}
