import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, timingSafeEqual } from "node:crypto";
// Node test runner lacks Workerd's constant-time extension; retain the real cryptographic comparator.
const priorTiming = Object.getOwnPropertyDescriptor(crypto.subtle, "timingSafeEqual");
beforeAll(() => Object.defineProperty(crypto.subtle, "timingSafeEqual", { configurable: true, value: (a: ArrayBufferView, b: ArrayBufferView) =>
  timingSafeEqual(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) }));
afterAll(() => { if (priorTiming) Object.defineProperty(crypto.subtle, "timingSafeEqual", priorTiming); else delete (crypto.subtle as any).timingSafeEqual; });
import { canonicalTicket, signTicket, verifyTicket, canonicalResult } from "../src/crypto";
import { parseStartRequest, parseStartupContract, parsePrivateDecision, parseTicket, type StartupContract, type TicketUnsigned } from "../src/contracts";
import { startExecution, acknowledgeAttempt, uploadArtifact, submitResult } from "../src/gateway";
import { attemptStartBytes } from "../src/attempt-contract";

const sha = "b".repeat(64), task = "Read-only startup fixture";
const startup: StartupContract = { schema: 1, completion_feedback_schema: 1, model_availability_schema: 1,
  executor_contract_sha256: sha, model: "gpt-6-sol", effort: "medium", state_storage: "pool_v1" };
const decision = { status: "step", provider: "codex", action: "cx_6sol_medium", permission_profile: "read_only" };
const body = { task, provider_preference: "codex", capacity_plan: { codex: 100, claude: 0 },
  executor_contract_version: "executor-fixture-v5", executor_contract_sha256: sha,
  available_codex_models: [{ slug: startup.model, default_effort: "medium", supported_efforts: ["medium"], priority: 1 }],
  execution_context: { input_utf8_bytes: 100, source_utf8_bytes: 0, history_utf8_bytes: 0,
    available_claude_models: [], completion_feedback: { schema: 1,
      objective_sha256: createHash("sha256").update(task).digest("hex"), observations: [] } }, required_startup_contract: 1 };
const unsigned: TicketUnsigned = { execution_id: "00000000-0000-4000-8000-000000000001", sequence: 1,
  provider: "codex", action: "cx_6sol_medium", permission_profile: "read_only",
  expires_at: "2099-10-03T00:00:00.000Z", nonce: "A".repeat(43) };
function pem(label: string, bytes: ArrayBuffer) { return `-----BEGIN ${label}-----\n${Buffer.from(bytes).toString("base64")}\n-----END ${label}-----`; }
async function keys() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
  return { privatePem: pem("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
    publicPem: pem("PUBLIC KEY", await crypto.subtle.exportKey("spki", pair.publicKey)) };
}
const request = (path: string, value: unknown) => new Request(`https://fixture${path}`, { method: "POST",
  headers: { "authorization": "Bearer fixture", "x-os1-device-id": "fixture-device" }, body: JSON.stringify(value) });

describe("critical startup contract and signed ticket mode", () => {
  it("preserves v1 bytes and binds every v2 field without a stripping downgrade", async () => {
    const k = await keys(); const old = await signTicket(unsigned, k.privatePem);
    expect(new TextDecoder().decode(canonicalTicket(unsigned))).toBe(["os1-ticket-v1", unsigned.execution_id, "1", "codex",
      unsigned.action, "read_only", unsigned.expires_at, unsigned.nonce].join("\n"));
    const v2 = await signTicket({ ...unsigned, startup_contract: startup }, k.privatePem);
    expect(new TextDecoder().decode(canonicalTicket(v2))).toBe(["os1-ticket-v2", unsigned.execution_id, "1", "codex",
      unsigned.action, "read_only", unsigned.expires_at, unsigned.nonce, "1", "1", "1", sha, startup.model, startup.effort, "pool_v1"].join("\n"));
    expect(await verifyTicket(v2, k.publicPem)).toBe(true);
    const { startup_contract, ...stripped } = v2;
    expect(await verifyTicket(stripped, k.publicPem)).toBe(false);
    expect(await verifyTicket({ ...old, startup_contract: startup }, k.publicPem)).toBe(false);
    for (const change of [{ schema: 2 }, { completion_feedback_schema: 2 }, { model_availability_schema: 2 },
      { executor_contract_sha256: "c".repeat(64) }, { model: "gpt-other" }, { effort: "high" }, { state_storage: "legacy" }]) {
      expect(await verifyTicket({ ...v2, startup_contract: { ...startup, ...change } as StartupContract }, k.publicPem)).toBe(false);
    }
  });
  it("requires full critical metadata and rejects unsupported schemas or widened acknowledgements", () => {
    expect(parseStartRequest(body).required_startup_contract).toBe(1);
    for (const mode of [0, 2, true, null]) expect(() => parseStartRequest({ ...body, required_startup_contract: mode })).toThrow();
    expect(() => parseStartRequest({ ...body, execution_context: { ...body.execution_context, available_claude_models: undefined } })).toThrow();
    expect(() => parseStartRequest({ ...body, execution_context: { ...body.execution_context, completion_feedback: undefined } })).toThrow();
    expect(parseStartupContract(startup)).toEqual(startup);
    for (const bad of [{ ...startup, schema: true }, { ...startup, model_availability_schema: 2 }, { ...startup, state_storage: "per_execution" },
      { ...startup, extra: "x" }, { ...startup, executor_contract_sha256: "z".repeat(64) }]) expect(() => parseStartupContract(bad)).toThrow();
    expect(parsePrivateDecision({ ...decision, startup_contract: startup })).toMatchObject({ startup_contract: startup });
    expect(() => parsePrivateDecision({ ...decision, startup_contract: { ...startup, model: "gpt-other" } })).toThrow();
  });
  it("rejects missing/wrong acknowledgements before creating state, preserves legacy state, and forwards the critical field", async () => {
    const k = await keys(); let response: any = { ...decision }, begins = 0, oldBegins = 0, privateInput: any;
    const env = { MAX_REQUEST_BYTES: "65536", SERVICE_RESPONSE_BYTES: "32768", TICKET_TTL_SECONDS: "300", DELIVERY_DENYLIST_JSON: "[]",
      TICKET_SIGNING_KEY_PKCS8: k.privatePem, TICKET_VERIFYING_KEY_SPKI: k.publicPem,
      AUTH_SERVICE: { fetch: async () => Response.json({ subject: "fixture", device_id: "fixture-device" }) },
      PRIVATE_ROUTE_CORE: { fetch: async (_: string, init: RequestInit) => { privateInput = JSON.parse(String(init.body)); return Response.json(response); } },
      EXECUTIONS: { getByName: () => ({ begin: async () => { oldBegins++; return "created"; } }) },
      EXECUTION_POOLS: { getByName: (name: string) => { expect(name).toBe("startup-v1"); return { ready: async () => true, begin: async (b: any) => { expect(b.execution_id).toMatch(/^[-a-f0-9]{36}$/); begins++; return "created"; } }; } },
    } as unknown as Env;
    await expect(startExecution(request("/v1/executions", body), env)).rejects.toThrow(); expect(begins).toBe(0);
    response = { ...decision, startup_contract: { ...startup, executor_contract_sha256: "c".repeat(64) } };
    await expect(startExecution(request("/v1/executions", body), env)).rejects.toThrow(); expect(begins).toBe(0);
    response = { ...decision, startup_contract: startup };
    await expect(startExecution(request("/v1/executions", { ...body, available_codex_models: [] }), env)).rejects.toThrow();
    expect(begins).toBe(0);
    await expect(startExecution(request("/v1/executions", { ...body, execution_context: { ...body.execution_context, execution_permission_profile: "workspace_write" } }), env)).rejects.toThrow();
    expect(begins).toBe(0);
    const ticket = parseTicket(await (await startExecution(request("/v1/executions", body), env)).json());
    expect(privateInput.required_startup_contract).toBe(1); expect(begins).toBe(1); expect(oldBegins).toBe(0);
    expect(ticket.startup_contract).toEqual(startup); expect(await verifyTicket(ticket, k.publicPem)).toBe(true);
    response = { ...decision }; const { required_startup_contract, ...legacyBody } = body;
    const legacy = parseTicket(await (await startExecution(request("/v1/executions", legacyBody), env)).json());
    expect(legacy.startup_contract).toBeUndefined(); expect(oldBegins).toBe(1); expect(begins).toBe(1);
    expect(privateInput.required_startup_contract).toBeUndefined();
  });
  it("overlaps read-only activation with routing, reuses that exact stub and never commits before both gates", async () => {
    const k = await keys(); let gets = 0, readyCalls = 0, privateCalls = 0, begins = 0;
    let releaseReady!: (value: true) => void, releaseDecision!: () => void;
    const readyBarrier = new Promise<true>(resolve => { releaseReady = resolve; });
    const decisionBarrier = new Promise<void>(resolve => { releaseDecision = resolve; });
    const stub = { ready: () => { readyCalls++; return readyBarrier; }, begin: async () => { begins++; return "created"; } };
    const env = { MAX_REQUEST_BYTES: "65536", SERVICE_RESPONSE_BYTES: "32768", TICKET_TTL_SECONDS: "300", DELIVERY_DENYLIST_JSON: "[]",
      TICKET_SIGNING_KEY_PKCS8: k.privatePem, TICKET_VERIFYING_KEY_SPKI: k.publicPem,
      AUTH_SERVICE: { fetch: async () => Response.json({ subject: "fixture", device_id: "fixture-device" }) },
      PRIVATE_ROUTE_CORE: { fetch: async () => { privateCalls++; await decisionBarrier; return Response.json({ ...decision, startup_contract: startup }); } },
      EXECUTION_POOLS: { getByName: () => { gets++; if (gets > 1) throw Error("second outgoing connection"); return stub; } },
    } as unknown as Env;
    let settled = false; const pending = startExecution(request("/v1/executions", body), env).then(r => { settled = true; return r; });
    for (let n = 0; n < 30 && (!readyCalls || !privateCalls); n++) await new Promise(r => setTimeout(r, 0));
    expect([gets, readyCalls, privateCalls, begins, settled]).toEqual([1,1,1,0,false]);
    releaseDecision(); await new Promise(r => setTimeout(r, 0));
    expect([begins, settled]).toEqual([0,false]);
    releaseReady(true); expect((await pending).status).toBe(200);
    expect([gets, readyCalls, begins]).toEqual([1,1,1]);
  });
  it("fails closed on activation failure and creates no execution for a denied/malformed decision", async () => {
    const k = await keys(); let begins = 0, readyCalls = 0;
    const base = { MAX_REQUEST_BYTES: "65536", SERVICE_RESPONSE_BYTES: "32768", TICKET_TTL_SECONDS: "300", DELIVERY_DENYLIST_JSON: "[]",
      TICKET_SIGNING_KEY_PKCS8: k.privatePem, TICKET_VERIFYING_KEY_SPKI: k.publicPem,
      AUTH_SERVICE: { fetch: async () => Response.json({ subject: "fixture", device_id: "fixture-device" }) },
      EXECUTION_POOLS: { getByName: () => ({ ready: async () => { readyCalls++; throw Error("activation unavailable"); },
        begin: async () => { begins++; return "created"; } }) },
    };
    for (const reply of [{ ...decision, startup_contract: startup }, { ...decision }, { status: "failed" }, { malformed: true }]) {
      const env = { ...base, PRIVATE_ROUTE_CORE: { fetch: async () => Response.json(reply) } } as unknown as Env;
      if (reply.status === "failed") expect((await startExecution(request("/v1/executions", body), env)).status).toBe(200);
      else await expect(startExecution(request("/v1/executions", body), env)).rejects.toThrow();
    }
    await new Promise(r => setTimeout(r, 0));
    expect([readyCalls, begins]).toEqual([4,0]);
  });
  it("keeps fresh identity/key proof and explicit pool ID on attempts; rejects stripped mode before ledger use", async () => {
    const k = await keys(); const device = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", device.publicKey); const ticket = await signTicket({ ...unsigned, startup_contract: startup }, k.privatePem);
    let auths = 0, lookups = 0, starts = 0;
    const env = { MAX_REQUEST_BYTES: "65536", SERVICE_RESPONSE_BYTES: "32768", TICKET_VERIFYING_KEY_SPKI: k.publicPem,
      AUTH_SERVICE: { fetch: async () => { auths++; return Response.json({ subject: "fixture", device_id: "fixture-device" }); } },
      DEVICE_REGISTRY: { fetch: async () => { lookups++; return Response.json({ subject: "fixture", device_id: "fixture-device", p256_public_jwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y } }); } },
      EXECUTION_POOLS: { getByName: (name: string) => { expect(name).toBe("startup-v1"); return { startAttempt: async (b: any) => {
        expect(b.execution_id).toBe(ticket.execution_id); expect(b.subject_hash).toHaveLength(64); starts++;
        return { execution_deadline: Date.now() + 10000, submission_deadline: Date.now() + 20000 }; } }; } },
      EXECUTIONS: { getByName: () => { throw Error("legacy must not receive v2"); } },
    } as unknown as Env;
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, device.privateKey, attemptStartBytes(ticket));
    const value = { ticket, device_signature: Buffer.from(signature).toString("base64url") };
    expect((await acknowledgeAttempt(request("/v1/attempts/start", value), env)).status).toBe(200);
    expect([auths, lookups, starts]).toEqual([1,1,1]);
    const { startup_contract, ...stripped } = ticket;
    await expect(acknowledgeAttempt(request("/v1/attempts/start", { ...value, ticket: stripped }), env)).rejects.toThrow();
    expect(starts).toBe(1);
    await expect(acknowledgeAttempt(request("/v1/attempts/start", { ...value, device_signature: "A".repeat(86) }), env)).rejects.toThrow();
    expect(starts).toBe(1);
  });
  it("binds v2 artifact fields and forwards critical mode on result/retry without downgrade", async () => {
    const k = await keys(); const device = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", device.publicKey); const ticket = await signTicket({ ...unsigned, startup_contract: startup }, k.privatePem);
    let put = 0, privateInput: any, next: any = { ...decision }, finalized = 0;
    const env = { MAX_REQUEST_BYTES: "65536", MAX_ARTIFACT_REQUEST_BYTES: "1500000", MAX_ARTIFACT_BYTES: "1048576",
      SERVICE_RESPONSE_BYTES: "32768", TICKET_TTL_SECONDS: "300", DELIVERY_DENYLIST_JSON: "[]", TICKET_SIGNING_KEY_PKCS8: k.privatePem, TICKET_VERIFYING_KEY_SPKI: k.publicPem,
      AUTH_SERVICE: { fetch: async () => Response.json({ subject: "fixture", device_id: "fixture-device" }) },
      DEVICE_REGISTRY: { fetch: async () => Response.json({ subject: "fixture", device_id: "fixture-device", p256_public_jwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y } }) },
      EXECUTION_POOLS: { getByName: () => ({ permitsArtifact: async (b: any) => { expect(b.execution_id).toBe(ticket.execution_id); return true; },
        claim: async () => ({ kind: "claimed", claim_token: "fixture" }), finalize: async (b: any) => { expect(b.execution_id).toBe(ticket.execution_id); finalized++; return { kind: "stored", response_json: b.response_json }; } }) },
      PRIVATE_ROUTE_CORE: { fetch: async (_: string, init: RequestInit) => { privateInput = JSON.parse(String(init.body)); return Response.json(next); } },
      RESULTS: { put: async () => { put++; } },
    } as unknown as Env;
    async function artifact(changes: Record<string, unknown> = {}) {
      const bytes = Buffer.from(JSON.stringify({ schema: 4, provider: ticket.provider, action: ticket.action,
        permission_profile: ticket.permission_profile, model: startup.model, effort: startup.effort, executor_contract_sha256: sha, ...changes }));
      const hash = createHash("sha256").update(bytes).digest("hex");
      const result = { ticket, result_hash: hash, artifact_ref: `r2://os1-private-results/${ticket.execution_id}/1/${hash}.json`, device_signature: "" };
      result.device_signature = Buffer.from(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, device.privateKey, canonicalResult(result))).toString("base64url");
      return { upload: { ticket, result_hash: hash, artifact_base64: bytes.toString("base64url"), device_signature: result.device_signature }, result };
    }
    for (const wrong of [{ model: "other" }, { effort: "high" }, { executor_contract_sha256: "c".repeat(64) }, { permission_profile: "workspace_write" }]) {
      await expect(uploadArtifact(request("/v1/artifacts", (await artifact(wrong)).upload), env)).rejects.toThrow();
    }
    expect(put).toBe(0); const good = await artifact();
    expect((await uploadArtifact(request("/v1/artifacts", good.upload), env)).status).toBe(200); expect(put).toBe(1);
    await expect(submitResult(request("/v1/results", good.result), env)).rejects.toThrow(); expect(finalized).toBe(0);
    expect(privateInput.required_startup_contract).toBe(1);
    next = { ...decision, startup_contract: startup };
    const retry = parseTicket(await (await submitResult(request("/v1/results", good.result), env)).json());
    expect(retry.sequence).toBe(2); expect(retry.startup_contract).toEqual(startup); expect(await verifyTicket(retry, k.publicPem)).toBe(true);
  });
});
