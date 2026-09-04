export const FLEET_OBJECTIVE_VERSION = "os1-fleet-objective-v1";
export const FLEET_NODE_STALE_AFTER_MS = 30_000;

export const FLEET_PROFILES = [
  "codex",
  "claude",
  "os1",
  "build",
  "test",
  "exo",
] as const;

export type FleetProfile = (typeof FLEET_PROFILES)[number];
export type FleetRole = "pro" | "air";

export type FleetNode = {
  device_id: string;
  role: FleetRole;
  hostname: string;
  zerotier_ip: string;
  cpu_logical_count: number;
  load_average_1m: number;
  memory_total_mib: number;
  memory_available_mib: number;
  queue_depth: number;
  has_codex: boolean;
  has_claude: boolean;
  exo_ready: boolean;
  exo_nodes: number;
  last_seen_ms: number;
};

export type FleetRequirements = {
  min_memory_mib: number;
  cpu_weight: number;
  prefer_device_id: string | null;
};

export type FleetPlacement = {
  objective_version: typeof FLEET_OBJECTIVE_VERSION;
  execution_mode: "single_node" | "distributed_exo";
  executor_device_id: string;
  score: number;
};

function supports(node: FleetNode, profile: FleetProfile): boolean {
  if (profile === "claude") return node.has_claude;
  if (profile === "exo") return node.exo_ready && node.exo_nodes >= 2;
  return node.has_codex;
}

function score(node: FleetNode, requirements: FleetRequirements): number {
  const cpuPressure = Math.min(node.load_average_1m / node.cpu_logical_count, 2);
  const memoryPressure = 1 - node.memory_available_mib / node.memory_total_mib;
  const queuePressure = Math.min(node.queue_depth / 4, 2);
  const affinity = requirements.prefer_device_id === node.device_id ? -25 : 0;
  const cpuWeight = requirements.cpu_weight / 100;
  return Math.round(
    (cpuPressure * (300 + 200 * cpuWeight) +
      memoryPressure * (450 - 100 * cpuWeight) +
      queuePressure * 250 +
      affinity) * 1_000,
  ) / 1_000;
}

export function placeFleetJob(
  nodes: readonly FleetNode[],
  profile: FleetProfile,
  requirements: FleetRequirements,
  nowMs: number,
): FleetPlacement | null {
  const eligible = nodes
    .filter((node) => nowMs - node.last_seen_ms <= FLEET_NODE_STALE_AFTER_MS)
    .filter((node) => node.memory_available_mib >= requirements.min_memory_mib)
    .filter((node) => supports(node, profile))
    .map((node) => ({ node, score: score(node, requirements) }))
    .sort((left, right) => left.score - right.score ||
      left.node.device_id.localeCompare(right.node.device_id));
  const selected = eligible[0];
  if (!selected) return null;
  return {
    objective_version: FLEET_OBJECTIVE_VERSION,
    execution_mode: profile === "exo" ? "distributed_exo" : "single_node",
    executor_device_id: selected.node.device_id,
    score: selected.score,
  };
}
