import { describe, expect, it } from "vitest";
import { completionCapabilities } from "../src/capabilities";

describe("bounded public protocol capabilities", () => {
  it("advertises support without disclosing private identity or rules", async () => {
    const binding = { fetch: async (url: string, init: RequestInit) => {
      expect(url).toBe("https://service.internal/capabilities");
      expect(init.method).toBe("GET");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ completion_feedback_schema: 1 });
    } } as unknown as Fetcher;
    const response = await completionCapabilities(binding);
    expect(await response.json()).toEqual({ completion_feedback_schema: 1, execution_protocol: 1, fleet_receipt_protocol: 1 });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  for (const value of [null, {}, { completion_feedback_schema: null }, { completion_feedback_schema: 2 },
    { completion_feedback_schema: true }, { completion_feedback_schema: 1, policy_sha256: "a".repeat(64) },
    { completion_feedback_schema: 1, padding: "x".repeat(300) }]) {
    it(`does not advertise an incompatible or expanded reply ${JSON.stringify(value)}`, async () => {
      const binding = { fetch: async () => Response.json(value) } as unknown as Fetcher;
      expect(await (await completionCapabilities(binding)).json()).toEqual({ completion_feedback_schema: null, execution_protocol: 1, fleet_receipt_protocol: 1 });
    });
  }
  it("fails closed for old or unavailable private bindings", async () => {
    for (const fetch of [async () => new Response("denied", { status: 400 }), async () => { throw Error("offline"); }]) {
      expect(await (await completionCapabilities({ fetch } as unknown as Fetcher)).json()).toEqual({ completion_feedback_schema: null, execution_protocol: 1, fleet_receipt_protocol: 1 });
    }
  });
});
