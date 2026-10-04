import { describe, expect, it } from "vitest";
import { RouteStageTiming } from "../src/stage-timing";

describe("bounded timing-only route diagnostics", () => {
  it("records independent fixed stages and total time without request state", () => {
    let now = 100;
    const timing = new RouteStageTiming("capabilities", () => now);
    now = 105; timing.current = "policy";
    now = 112; timing.current = "capabilities_probe";
    now = 947;
    expect(timing.finish()).toEqual({ event: "private_route_latency", operation: "capabilities",
      total_ms: 847, stages: { request: 5, policy: 7, capabilities_probe: 835 } });
    expect(Object.keys(timing.finish()).sort()).toEqual(["event", "operation", "stages", "total_ms"]);
  });
  it("sums repeated stages and freezes completion without exposing mutable state", () => {
    let now = 0;
    const timing = new RouteStageTiming("route", () => now);
    now = 2; timing.current = "route";
    now = 10; timing.current = "persist";
    now = 13; timing.current = "route";
    now = 20;
    const first = timing.finish();
    expect(first.stages).toEqual({ request: 2, route: 15, persist: 3 });
    first.stages.route = 999;
    now = 50; timing.current = "usage";
    expect(timing.finish()).toEqual({ event: "private_route_latency", operation: "route", total_ms: 20,
      stages: { request: 2, route: 15, persist: 3 } });
  });
  it("clamps backwards or extreme clock intervals to bounded nonnegative integers", () => {
    let now = 100;
    const timing = new RouteStageTiming("other", () => now);
    now = 90; timing.current = "parse";
    now = 200_000_000;
    const result = timing.finish();
    expect(result.total_ms).toBe(86_400_000);
    expect(result.stages).toEqual({ request: 0, parse: 86_400_000 });
  });
  it("records concurrent gate spans separately instead of adding them as serial cost", async () => {
    let now = 0;
    const timing = new RouteStageTiming("route", () => now);
    timing.current = "startup_parallel";
    let releaseA!: () => void, releaseB!: () => void;
    const a = timing.measureParallel("budget", () => new Promise<void>(resolve => { releaseA = resolve; }));
    const b = timing.measureParallel("pool_ready", () => new Promise<void>(resolve => { releaseB = resolve; }));
    now = 100; releaseA(); await a;
    now = 150; releaseB(); await b;
    const result = timing.finish();
    expect(result.total_ms).toBe(150);
    expect(result.stages.startup_parallel).toBe(150);
    expect(result.parallel_spans).toEqual({ budget: 100, pool_ready: 150 });
  });
});
