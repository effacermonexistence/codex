import { describe, expect, it } from "vitest";
import type { Ticket } from "../src/contracts";
import { assertTicketDeliveryHygiene, opaqueError, publicJson } from "../src/egress";

const ticket: Ticket = {
  execution_id: "3f7c2a82-3b21-4f39-9e3a-8dd9af83c79c",
  sequence: 1,
  provider: "claude",
  action: "agent_run",
  permission_profile: "read_only",
  expires_at: "2026-09-01T00:00:00.000Z",
  nonce: "Q2hhbmdlTWVOb3RBbmRUaGVuQ2hhbmdlTWVBZ2Fpbg",
  signature: "A".repeat(86),
};

describe("public egress", () => {
  it("emits only the eight ticket fields", async () => {
    const response = publicJson(ticket);
    expect(Object.keys(await response.json()).sort()).toEqual(
      Object.keys(ticket).sort(),
    );
  });

  it("emits an opaque terminal verification failure", async () => {
    expect(await publicJson({ status: "failed" }).json()).toEqual({ status: "failed" });
  });

  it("uses one opaque, fixed-shape error body", async () => {
    const first = await opaqueError().text();
    const second = await opaqueError().text();
    expect(first).toBe(second);
    expect(JSON.parse(first)).toEqual({
      error: "request_rejected",
      pad: "0".repeat(160),
    });
  });

  it("fails closed when a protected delivery canary collides", () => {
    expect(() => assertTicketDeliveryHygiene(ticket, '["claude-canary"]')).not.toThrow();
    expect(() =>
      assertTicketDeliveryHygiene(ticket, '["claude\\nagent"]'),
    ).toThrow();
  });
});
