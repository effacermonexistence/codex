import { describe, expect, it, vi } from "vitest";
import { completionCapabilityState, routeLearningSchema } from "../src/capabilities";

const policy = "a".repeat(64);
function fixture(value: unknown) {
  const fetch = vi.fn(async () => Response.json(value));
  return { binding: { fetch } as unknown as Fetcher, fetch };
}
describe("fresh unified capability probe", () => {
  it("uses one fresh response for both schemas and reuses only learning metadata", async () => {
    const { binding, fetch } = fixture({ completion_feedback_schema: 1, model_availability_schema: 1,
      route_learning_schema: 3, policy_sha256: policy });
    expect(await completionCapabilityState(binding, policy, 1_000)).toEqual({ feedback: true, modelAvailability: true });
    expect(await routeLearningSchema(binding, policy, 2_000)).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(1);
    // Every advertised-capability check remains fresh, not a cached authorization.
    await completionCapabilityState(binding, policy, 3_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await routeLearningSchema(binding, policy, 64_000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("never infers model support from an older feedback-only schema", async () => {
    const { binding } = fixture({ completion_feedback_schema: 1, policy_sha256: policy });
    expect(await completionCapabilityState(binding, policy)).toEqual({ feedback: true, modelAvailability: false });
  });
  it.each([
    { completion_feedback_schema: 1, model_availability_schema: 1, policy_sha256: "b".repeat(64) },
    { completion_feedback_schema: 0, model_availability_schema: 1, policy_sha256: policy },
    { completion_feedback_schema: 1, model_availability_schema: 1, policy_sha256: policy, unexpected: true },
  ])("rejects wrong policy, invalid or expanded responses without caching failure", async (value) => {
    const { binding, fetch } = fixture(value);
    expect(await completionCapabilityState(binding, policy)).toEqual({ feedback: false, modelAvailability: false });
    expect(await routeLearningSchema(binding, policy)).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("keeps policy and binding identities isolated", async () => {
    const a = fixture({ completion_feedback_schema: 1, model_availability_schema: 1, route_learning_schema: 3, policy_sha256: policy });
    const b = fixture({ completion_feedback_schema: 1, policy_sha256: policy });
    await completionCapabilityState(a.binding, policy, 1_000);
    expect(await routeLearningSchema(b.binding, policy, 2_000)).toBe(0);
    expect(await routeLearningSchema(a.binding, "b".repeat(64), 2_000)).toBe(0);
    expect(a.fetch).toHaveBeenCalledTimes(2);
    expect(b.fetch).toHaveBeenCalledTimes(1);
  });
  it("reuses only positive critical receipts for at most 60 seconds, never backwards in time", async () => {
    const { binding, fetch } = fixture({ completion_feedback_schema: 1, model_availability_schema: 1,
      route_learning_schema: 3, policy_sha256: policy });
    expect(await completionCapabilityState(binding, policy, 1_000, true)).toEqual({ feedback: true, modelAvailability: true });
    await completionCapabilityState(binding, policy, 60_999, true);
    expect(fetch).toHaveBeenCalledTimes(1);
    await completionCapabilityState(binding, policy, 61_000, true);
    expect(fetch).toHaveBeenCalledTimes(2);
    await completionCapabilityState(binding, policy, 60_000, true);
    expect(fetch).toHaveBeenCalledTimes(3);
    await completionCapabilityState(binding, policy, 60_001);
    expect(fetch).toHaveBeenCalledTimes(4); // Public GET semantics always fresh.
  });
  it.each([
    { completion_feedback_schema: true, model_availability_schema: 1, policy_sha256: policy },
    { completion_feedback_schema: 1, model_availability_schema: true, policy_sha256: policy },
    { completion_feedback_schema: 1, model_availability_schema: 2, policy_sha256: policy },
    { completion_feedback_schema: 1, model_availability_schema: 1, policy_sha256: "b".repeat(64) },
  ])("does not retain malformed, wrong-policy or unsupported critical receipts", async value => {
    const { binding, fetch } = fixture(value);
    const first = await completionCapabilityState(binding, policy, 1_000, true);
    expect(first.feedback && first.modelAvailability).toBe(false);
    await completionCapabilityState(binding, policy, 2_000, true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("invalidates a positive receipt after a failed fresh probe without caching the failure", async () => {
    const { binding, fetch } = fixture({ completion_feedback_schema: 1, model_availability_schema: 1, policy_sha256: policy });
    await completionCapabilityState(binding, policy, 1_000, true);
    fetch.mockImplementationOnce(async () => new Response("denied", { status: 404 }));
    expect(await completionCapabilityState(binding, policy, 2_000)).toEqual({ feedback: false, modelAvailability: false });
    await completionCapabilityState(binding, policy, 2_001, true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
