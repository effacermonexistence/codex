import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const policy = "a".repeat(64), id = "21000000-0000-4000-8000-000000000001", service = "os1-rcc-v26-private-v30";
const key = `https://os1-capability.invalid/v1/${id}/${service}/${policy}`;
const body = () => ({ format: 1, version_id: id, service_id: service, policy_sha256: policy,
  completion_feedback_schema: 1, model_availability_schema: 1, route_learning_schema: 3,
  checked_at: 1_000, expires_at: 61_000 });
let stored: Map<string, { text: string; status: number }>;
let deleted: string[], opens: number, puts: number, failPut: boolean;
const fresh = (status = 200) => {
  const fetch = vi.fn(async () => Response.json(status === 200 ? { completion_feedback_schema: 1,
    model_availability_schema: 1, route_learning_schema: 3, policy_sha256: policy } : { error: "unavailable" }, { status }));
  return { binding: { fetch } as unknown as Fetcher, fetch };
};
async function moduleAt(version = id, target = service, pin = policy) {
  vi.resetModules();
  const m = await import("../src/capabilities");
  return { m, scope: m.capabilityCacheScope({ WORKER_VERSION: { id: version }, RCC_SERVICE_ID: target }, pin)! };
}
beforeEach(() => {
  stored = new Map(); deleted = []; opens = 0; puts = 0; failPut = false;
  vi.stubGlobal("caches", { open: async (name: string) => {
    expect(name).toBe("os1-private-capability-v1"); opens++;
    // New request-owned handles/responses; the stand-in stores ONLY strings.
    return { match: async (request: Request) => {
      const value = stored.get(request.url);
      return value ? new Response(value.text, { status: value.status }) : undefined;
    }, put: async (request: Request, response: Response) => {
      if (failPut) throw new Error("cache unavailable");
      expect(request.method).toBe("GET"); expect(response.headers.get("cache-control")).toBe("max-age=60");
      puts++; stored.set(request.url, { text: await response.text(), status: response.status });
    }, delete: async (request: Request) => { deleted.push(request.url); return stored.delete(request.url); } };
  } });
});
afterEach(() => { vi.unstubAllGlobals(); });
describe("request-owned named Cache API positive capability receipts", () => {
  it("stores cold completed metadata and accepts it after module-memory reset without a backend GET", async () => {
    const a = await moduleAt(), first = fresh();
    await a.m.completionCapabilityState(first.binding, policy, 1_000, true, a.scope);
    expect(first.fetch).toHaveBeenCalledTimes(1); expect(puts).toBe(1);
    expect(JSON.parse(stored.get(key)!.text)).toEqual(body());
    const b = await moduleAt(), second = fresh();
    expect(await b.m.completionCapabilityState(second.binding, policy, 2_000, true, b.scope)).toEqual({ feedback: true, modelAvailability: true });
    expect(second.fetch).not.toHaveBeenCalled(); expect(puts).toBe(1); // No sliding publish on hit.
    expect(await b.m.routeLearningSchema(second.binding, policy, 2_001)).toBe(3);
    expect(opens).toBeGreaterThanOrEqual(3);
  });
  it.each([
    { version: "22000000-0000-4000-8000-000000000001", target: service, pin: policy },
    { version: id, target: "other-private-service", pin: policy },
    { version: id, target: service, pin: "b".repeat(64) },
  ])("does not inherit a different version/service/policy cache entry", async ({ version, target, pin }) => {
    stored.set(key, { text: JSON.stringify(body()), status: 200 });
    const x = await moduleAt(version, target, pin), f = fresh(404);
    expect(await x.m.completionCapabilityState(f.binding, pin, 2_000, true, x.scope)).toEqual({ feedback: false, modelAvailability: false });
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...body(), extra: true }, { ...body(), format: 2 }, { ...body(), version_id: "bad" },
    { ...body(), service_id: "wrong" }, { ...body(), policy_sha256: "f".repeat(64) },
    { ...body(), model_availability_schema: true }, { ...body(), completion_feedback_schema: 0 },
    { ...body(), route_learning_schema: 4 }, { ...body(), checked_at: "1000" },
    { ...body(), expires_at: 61_001 }, { ...body(), expires_at: 1_000 },
  ])("rejects malformed, mismatched or over-TTL metadata before acceptance", async value => {
    stored.set(key, { text: JSON.stringify(value), status: 200 });
    const x = await moduleAt(), f = fresh();
    await x.m.completionCapabilityState(f.binding, policy, 2_000, true, x.scope);
    expect(f.fetch).toHaveBeenCalledTimes(1); expect(deleted).toContain(key);
  });
  it.each([999, 61_000])("rejects backwards or expired time %s without sliding the old receipt", async now => {
    stored.set(key, { text: JSON.stringify(body()), status: 200 });
    const x = await moduleAt(), f = fresh();
    await x.m.completionCapabilityState(f.binding, policy, now, true, x.scope);
    expect(f.fetch).toHaveBeenCalledTimes(1); expect(deleted).toContain(key);
  });
  it("ignores oversized cached responses and never stores a failed GET", async () => {
    stored.set(key, { text: JSON.stringify({ ...body(), large: "x".repeat(2_000) }), status: 200 });
    const x = await moduleAt(), f = fresh(404);
    expect(await x.m.completionCapabilityState(f.binding, policy, 2_000, true, x.scope)).toEqual({ feedback: false, modelAvailability: false });
    expect(f.fetch).toHaveBeenCalledTimes(1); expect(puts).toBe(0); expect(stored.has(key)).toBe(false);
  });
  it("does not deny a freshly verified GET when cache put fails", async () => {
    failPut = true; const x = await moduleAt(), f = fresh();
    expect(await x.m.completionCapabilityState(f.binding, policy, 2_000, true, x.scope)).toEqual({ feedback: true, modelAvailability: true });
    expect(f.fetch).toHaveBeenCalledTimes(1); expect(stored.size).toBe(0);
  });
  it("always probes the backend on fresh public GET and invalidates known counterevidence", async () => {
    stored.set(key, { text: JSON.stringify(body()), status: 200 });
    const x = await moduleAt(), f = fresh(404);
    expect(await x.m.completionCapabilityState(f.binding, policy, 2_000, false, x.scope)).toEqual({ feedback: false, modelAvailability: false });
    expect(f.fetch).toHaveBeenCalledTimes(1); expect(stored.has(key)).toBe(false);
  });
});
