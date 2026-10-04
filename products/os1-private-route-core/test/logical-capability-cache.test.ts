import { describe, expect, it, vi } from "vitest";
import { capabilityCacheScope, completionCapabilityState, routeLearningSchema } from "../src/capabilities";

const policy = "a".repeat(64);
const version = "11000000-0000-4000-8000-000000000001";
const service = "os1-rcc-v26-private-v30";
const scope = (id = version, target = service, pin = policy) =>
  capabilityCacheScope({ WORKER_VERSION: { id }, RCC_SERVICE_ID: target }, pin)!;
function fixture(pin = policy, value?: unknown, status = 200) {
  const fetch = vi.fn(async () => Response.json(value ?? { completion_feedback_schema: 1, model_availability_schema: 1,
    route_learning_schema: 3, policy_sha256: pin }, { status }));
  return { binding: { fetch } as unknown as Fetcher, fetch };
}
describe("plain capability metadata scoped to actual deployment version, service and policy", () => {
  it("reuses a positive receipt across different current Fetcher wrappers, seeding only learning metadata", async () => {
    const a = fixture(), b = fixture(); const key = scope();
    await completionCapabilityState(a.binding, policy, 1_000, true, key);
    expect(await completionCapabilityState(b.binding, policy, 2_000, true, key)).toEqual({ feedback: true, modelAvailability: true });
    expect(await routeLearningSchema(b.binding, policy, 2_001)).toBe(3);
    expect(a.fetch).toHaveBeenCalledTimes(1); expect(b.fetch).not.toHaveBeenCalled();
  });
  it("isolates new Worker version, actual service target and policy identities", async () => {
    const variants = [scope("12000000-0000-4000-8000-000000000001"), scope(version, "different-private-service"),
      scope(version, service, "b".repeat(64))];
    for (const [i, key] of variants.entries()) {
      const pin = i === 2 ? "b".repeat(64) : policy, f = fixture(pin);
      await completionCapabilityState(f.binding, pin, 2_000, true, key);
      expect(f.fetch).toHaveBeenCalledTimes(1);
    }
  });
  it.each([
    {}, { WORKER_VERSION: { id: "not-a-version" }, RCC_SERVICE_ID: service },
    { WORKER_VERSION: { id: version }, RCC_SERVICE_ID: "service|alias" },
    { WORKER_VERSION: null, RCC_SERVICE_ID: service },
    { WORKER_VERSION: { id: "AA000000-0000-4000-8000-000000000001" }, RCC_SERVICE_ID: service },
  ])("does not alias absent or invalid runtime metadata into a global namespace", async env => {
    const key = capabilityCacheScope(env, policy); expect(key).toBeUndefined();
    const a = fixture(), b = fixture();
    await completionCapabilityState(a.binding, policy, 2_000, true, key);
    await completionCapabilityState(b.binding, policy, 2_001, true, key);
    expect(a.fetch).toHaveBeenCalledTimes(1); expect(b.fetch).toHaveBeenCalledTimes(1);
  });
  it("does not inherit a logical scope built for another expected policy argument", async () => {
    const f = fixture("b".repeat(64));
    await completionCapabilityState(f.binding, "b".repeat(64), 2_000, true, scope());
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it("does not slide expiry on hits; backwards time requires a new probe", async () => {
    const key = scope("13000000-0000-4000-8000-000000000001");
    const a = fixture(), hit = fixture(), expired = fixture(), backwards = fixture();
    await completionCapabilityState(a.binding, policy, 1_000, true, key);
    await completionCapabilityState(hit.binding, policy, 60_999, true, key);
    expect(hit.fetch).not.toHaveBeenCalled();
    await completionCapabilityState(expired.binding, policy, 61_000, true, key);
    expect(expired.fetch).toHaveBeenCalledTimes(1);
    await completionCapabilityState(backwards.binding, policy, 60_000, true, key);
    expect(backwards.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    [{ error: "unavailable" }, 404],
    [{ completion_feedback_schema: 1, model_availability_schema: 1, policy_sha256: "f".repeat(64) }, 200],
    [{ completion_feedback_schema: true, model_availability_schema: 1, policy_sha256: policy }, 200],
    [{ completion_feedback_schema: 1, model_availability_schema: 1, route_learning_schema: 99, policy_sha256: policy }, 200],
    [{ completion_feedback_schema: 1, model_availability_schema: 1, policy_sha256: policy, extra: true }, 200],
  ])("fresh public failure evicts a prior positive and is never cached", async (value, status) => {
    const key = scope("14000000-0000-4000-8000-" + String(status).padStart(12, "0"));
    const a = fixture(), bad = fixture(policy, value, status as number), next = fixture();
    await completionCapabilityState(a.binding, policy, 1_000, true, key);
    const rejected = await completionCapabilityState(bad.binding, policy, 2_000, false, key);
    expect(rejected.feedback && rejected.modelAvailability).toBe(false);
    await completionCapabilityState(next.binding, policy, 2_001, true, key);
    expect(next.fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps public GET fresh even with a positive logical receipt", async () => {
    const key = scope("15000000-0000-4000-8000-000000000001");
    const a = fixture(), fresh = fixture();
    await completionCapabilityState(a.binding, policy, 1_000, true, key);
    await completionCapabilityState(fresh.binding, policy, 2_000, false, key);
    expect(fresh.fetch).toHaveBeenCalledTimes(1);
  });
  it("bounds completed plain receipts to64 entries", async () => {
    const keys = Array.from({ length: 65 }, (_, i) => scope("16000000-0000-4000-8000-" + i.toString(16).padStart(12, "0")));
    for (const key of keys) await completionCapabilityState(fixture().binding, policy, 1_000, true, key);
    const f = fixture(); await completionCapabilityState(f.binding, policy, 2_000, true, keys[0]);
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
});
