import { describe, expect, it } from "vitest";
import {
  FLEET_OBJECTIVE_VERSION,
  placeFleetJob,
  type FleetNode,
} from "../src/fleet-model";

const now = 2_000_000;

function node(overrides: Partial<FleetNode>): FleetNode {
  return {
    device_id: "device:pro",
    role: "pro",
    hostname: "pro",
    zerotier_ip: "10.215.90.72",
    cpu_logical_count: 16,
    load_average_1m: 4,
    memory_total_mib: 36_864,
    memory_available_mib: 24_000,
    queue_depth: 0,
    has_codex: true,
    has_claude: true,
    exo_ready: true,
    exo_nodes: 2,
    last_seen_ms: now,
    ...overrides,
  };
}

describe("fleet objective", () => {
  it("selects the node with more usable headroom", () => {
    const placement = placeFleetJob([
      node({ device_id: "device:pro", load_average_1m: 14, queue_depth: 2 }),
      node({
        device_id: "device:air",
        role: "air",
        hostname: "air",
        zerotier_ip: "10.215.90.216",
        cpu_logical_count: 10,
        load_average_1m: 1,
        memory_total_mib: 16_384,
        memory_available_mib: 12_000,
      }),
    ], "codex", { min_memory_mib: 2_048, cpu_weight: 50, prefer_device_id: null }, now);
    expect(placement).toMatchObject({
      objective_version: FLEET_OBJECTIVE_VERSION,
      execution_mode: "single_node",
      executor_device_id: "device:air",
    });
  });

  it("rejects stale, undersized, and incapable nodes", () => {
    const placement = placeFleetJob([
      node({ device_id: "device:stale", last_seen_ms: now - 30_001 }),
      node({ device_id: "device:small", memory_available_mib: 1_000 }),
      node({ device_id: "device:no-claude", has_claude: false }),
    ], "claude", { min_memory_mib: 2_048, cpu_weight: 50, prefer_device_id: null }, now);
    expect(placement).toBeNull();
  });

  it("only labels EXO-compatible work as distributed", () => {
    expect(placeFleetJob(
      [node({})],
      "exo",
      { min_memory_mib: 1_024, cpu_weight: 80, prefer_device_id: null },
      now,
    )?.execution_mode).toBe("distributed_exo");
    expect(placeFleetJob(
      [node({})],
      "build",
      { min_memory_mib: 1_024, cpu_weight: 80, prefer_device_id: null },
      now,
    )?.execution_mode).toBe("single_node");
  });

  it("does not claim EXO distribution from a one-node topology", () => {
    expect(placeFleetJob(
      [node({ exo_nodes: 1 })],
      "exo",
      { min_memory_mib: 1_024, cpu_weight: 80, prefer_device_id: null },
      now,
    )).toBeNull();
  });

  it("requires the executor used by every single-node profile", () => {
    const requirements = { min_memory_mib: 1_024, cpu_weight: 50, prefer_device_id: null };
    expect(placeFleetJob([node({ has_codex: false })], "codex", requirements, now)).toBeNull();
    expect(placeFleetJob([node({ has_codex: false })], "os1", requirements, now)).toBeNull();
    expect(placeFleetJob([node({ has_codex: false })], "build", requirements, now)).toBeNull();
    expect(placeFleetJob([node({ has_codex: false })], "test", requirements, now)).toBeNull();
    expect(placeFleetJob([node({ has_claude: false })], "claude", requirements, now)).toBeNull();
  });
});
