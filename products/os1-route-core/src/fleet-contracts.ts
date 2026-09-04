import { isRecord, parseDeviceId } from "./contracts";
import { reject } from "./errors";
import { FLEET_PROFILES, type FleetNode, type FleetProfile, type FleetRequirements } from "./fleet-model";

export type FleetHeartbeatRequest = {
  sent_at_ms: number;
  nonce: string;
  node: Omit<FleetNode, "device_id" | "last_seen_ms">;
  signature: string;
};

export type FleetSubmitRequest = {
  profile: FleetProfile;
  task: string;
  workspace_repository: string;
  workspace_revision: string;
  workspace_subpath: string;
  requirements: FleetRequirements;
  submitted_at_ms: number;
  nonce: string;
  signature: string;
};

export type FleetClaimRequest = {
  sent_at_ms: number;
  nonce: string;
  signature: string;
};

export type FleetCompleteRequest = {
  job_id: string;
  outcome: "complete" | "failed";
  result: string;
  result_hash: string;
  completed_at_ms: number;
  nonce: string;
  signature: string;
};

export type FleetStatusRequest = {
  job_id: string;
  sent_at_ms: number;
  nonce: string;
  signature: string;
};

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOSTNAME = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}[A-Za-z0-9]$|^[A-Za-z0-9]$/;
const ZEROTIER_IP = /^10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REVISION = /^[0-9a-f]{40}$/;
const SUBPATH = /^(?:[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)?$/;

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function bounded(value: unknown, minimum: number, maximum: number, pattern?: RegExp): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum &&
    (pattern === undefined || pattern.test(value));
}

function commonSigned(value: Record<string, unknown>): boolean {
  return integer(value.sent_at_ms ?? value.submitted_at_ms ?? value.completed_at_ms, 1, 9_007_199_254_740_991) &&
    bounded(value.nonce, 32, 128, BASE64URL) && bounded(value.signature, 64, 256, BASE64URL);
}

export function parseFleetHeartbeat(value: unknown): FleetHeartbeatRequest {
  if (!isRecord(value) || !exact(value, ["sent_at_ms", "nonce", "node", "signature"]) ||
      !commonSigned(value) || !isRecord(value.node) || !exact(value.node, [
        "role", "hostname", "zerotier_ip", "cpu_logical_count", "load_average_milli",
        "memory_total_mib", "memory_available_mib", "queue_depth", "has_codex",
        "has_claude", "exo_ready", "exo_nodes",
      ])) reject();
  const node = value.node as Record<string, unknown>;
  if ((node.role !== "pro" && node.role !== "air") || !bounded(node.hostname, 1, 253, HOSTNAME) ||
      !bounded(node.zerotier_ip, 7, 15, ZEROTIER_IP) ||
      !integer(node.cpu_logical_count, 1, 256) || !integer(node.load_average_milli, 0, 2_000_000) ||
      !integer(node.memory_total_mib, 1_024, 1_048_576) ||
      !integer(node.memory_available_mib, 0, node.memory_total_mib as number) ||
      !integer(node.queue_depth, 0, 10_000) || typeof node.has_codex !== "boolean" ||
      typeof node.has_claude !== "boolean" || typeof node.exo_ready !== "boolean" ||
      !integer(node.exo_nodes, 0, 64)) reject();
  return {
    sent_at_ms: value.sent_at_ms as number,
    nonce: value.nonce as string,
    node: {
      role: node.role,
      hostname: node.hostname,
      zerotier_ip: node.zerotier_ip,
      cpu_logical_count: node.cpu_logical_count,
      load_average_1m: (node.load_average_milli as number) / 1_000,
      memory_total_mib: node.memory_total_mib,
      memory_available_mib: node.memory_available_mib,
      queue_depth: node.queue_depth,
      has_codex: node.has_codex,
      has_claude: node.has_claude,
      exo_ready: node.exo_ready,
      exo_nodes: node.exo_nodes,
    } as Omit<FleetNode, "device_id" | "last_seen_ms">,
    signature: value.signature as string,
  };
}

function parseRequirements(value: unknown): FleetRequirements {
  if (!isRecord(value) || !exact(value, ["min_memory_mib", "cpu_weight", "prefer_device_id"]) ||
      !integer(value.min_memory_mib, 0, 1_048_576) || !integer(value.cpu_weight, 0, 100) ||
      !(value.prefer_device_id === null || (() => { try { parseDeviceId(value.prefer_device_id); return true; } catch { return false; } })())) reject();
  return {
    min_memory_mib: value.min_memory_mib as number,
    cpu_weight: value.cpu_weight as number,
    prefer_device_id: value.prefer_device_id as string | null,
  };
}

export function parseFleetSubmit(value: unknown): FleetSubmitRequest {
  if (!isRecord(value) || !exact(value, [
    "profile", "task", "workspace_repository", "workspace_revision", "workspace_subpath",
    "requirements", "submitted_at_ms", "nonce", "signature",
  ]) || !commonSigned(value) || !FLEET_PROFILES.includes(value.profile as FleetProfile) ||
      !bounded(value.task, 1, 48_000) || !bounded(value.workspace_repository, 3, 200, REPOSITORY) ||
      !bounded(value.workspace_revision, 40, 40, REVISION) ||
      !bounded(value.workspace_subpath, 0, 384, SUBPATH)) reject();
  return {
    profile: value.profile as FleetProfile,
    task: value.task as string,
    workspace_repository: value.workspace_repository as string,
    workspace_revision: value.workspace_revision as string,
    workspace_subpath: value.workspace_subpath as string,
    requirements: parseRequirements(value.requirements),
    submitted_at_ms: value.submitted_at_ms as number,
    nonce: value.nonce as string,
    signature: value.signature as string,
  };
}

export function parseFleetClaim(value: unknown): FleetClaimRequest {
  if (!isRecord(value) || !exact(value, ["sent_at_ms", "nonce", "signature"]) || !commonSigned(value)) reject();
  return value as FleetClaimRequest;
}

export function parseFleetComplete(value: unknown): FleetCompleteRequest {
  if (!isRecord(value) || !exact(value, [
    "job_id", "outcome", "result", "result_hash", "completed_at_ms", "nonce", "signature",
  ]) || !commonSigned(value) || !bounded(value.job_id, 36, 36, UUID) ||
      (value.outcome !== "complete" && value.outcome !== "failed") ||
      !bounded(value.result, 0, 65_536) || !bounded(value.result_hash, 64, 64, SHA256)) reject();
  return value as FleetCompleteRequest;
}

export function parseFleetStatus(value: unknown): FleetStatusRequest {
  if (!isRecord(value) || !exact(value, ["job_id", "sent_at_ms", "nonce", "signature"]) ||
      !commonSigned(value) || !bounded(value.job_id, 36, 36, UUID)) reject();
  return value as FleetStatusRequest;
}
