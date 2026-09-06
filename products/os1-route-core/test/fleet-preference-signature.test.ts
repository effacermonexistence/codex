import { expect, it } from "vitest";
import { canonicalFleetSubmit, verifyFleetSignature } from "../src/fleet-crypto";
import { parseFleetSubmit, type FleetSubmitRequest } from "../src/fleet-contracts";

it("binds preferred device and profile to the original submitting identity", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const request: Omit<FleetSubmitRequest, "signature"> = {
    profile: "codex", task: "Read-only fixture", workspace_repository: "owner/repo",
    workspace_revision: "a".repeat(40), workspace_subpath: "",
    requirements: { min_memory_mib: 2_048, cpu_weight: 50, prefer_device_id: "device:air" },
    submitted_at_ms: 2_000_000, nonce: "fixture-nonce".repeat(4),
  };
  const signature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey,
    canonicalFleetSubmit("device:submitter", request))).toString("base64url");
  await expect(verifyFleetSignature(publicKey, signature, canonicalFleetSubmit("device:submitter", request))).resolves.toBe(true);
  for (const changed of [
    { ...request, requirements: { ...request.requirements, prefer_device_id: "device:pro" } },
    { ...request, profile: "claude" as const },
  ]) await expect(verifyFleetSignature(publicKey, signature, canonicalFleetSubmit("device:submitter", changed))).resolves.toBe(false);
  await expect(verifyFleetSignature(publicKey, signature, canonicalFleetSubmit("device:other-owner", request))).resolves.toBe(false);
});

it("does not accept credentials smuggled into the placement requirements", () => {
  const request = {
    profile: "codex", task: "Fixture", workspace_repository: "owner/repo", workspace_revision: "a".repeat(40),
    workspace_subpath: "", requirements: { min_memory_mib: 2_048, cpu_weight: 50, prefer_device_id: null },
    submitted_at_ms: 2_000_000, nonce: "n".repeat(32), signature: "s".repeat(86),
  };
  expect(parseFleetSubmit(request).requirements).toEqual(request.requirements);
  expect(() => parseFleetSubmit({ ...request, requirements: { ...request.requirements, authorization: "fixture-secret" } })).toThrow();
});
