import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authorizeExecution } from "../src/gateway";
import { parseStartRequest, parseTicket } from "../src/contracts";
import { verifyTicket } from "../src/crypto";
import config from "../../os1-mac-runtime/Config/production.json";

const task = "Return one short answer without touching any files.";
const taskSHA = createHash("sha256").update(task).digest("hex");
const selected = { provider: "codex", model: "gpt-6.1-sol", effort: "low", permission_profile: "read_only" };
const claudeSelected = { provider: "claude", model: "claude-fable-5-1", effort: "max", permission_profile: "read_only" };
function body(choice = selected) {
  return { schema: 1, selected: choice, request: { task, provider_preference: choice.provider,
    capacity_plan: { codex: 100, claude: 100 }, executor_contract_version: config.executor_contract.version,
    executor_contract_sha256: config.executor_contract.sha256,
    available_codex_models: choice.provider === "codex" ? [{ slug: selected.model, default_effort: "low", supported_efforts: ["low"], priority: 0 }] : [],
    execution_context: { input_utf8_bytes: 100, source_utf8_bytes: 0, history_utf8_bytes: 0,
      execution_permission_profile: "read_only", available_claude_models: [{ model: claudeSelected.model, supported_efforts: ["max"] }],
      completion_feedback: { schema: 1, objective_sha256: taskSHA, observations: [] } }, required_startup_contract: 1,
  } };
}
const request = (payload: unknown, headers = true) => new Request("https://fixture/v1/execution-authorizations", {
  method: "POST", headers: headers ? { authorization: "Bearer fixture-not-real", "x-os1-device-id": "fixture-device" } : {},
  body: JSON.stringify(payload),
});
function pem(label: string, data: ArrayBuffer) { return `-----BEGIN ${label}-----\n${Buffer.from(data).toString("base64")}\n-----END ${label}-----`; }
async function fixture() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const publicPEM = pem("PUBLIC KEY", await crypto.subtle.exportKey("spki", pair.publicKey));
  const privatePEM = pem("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let auth = 0, privateCalls = 0, begins = 0, legacy = 0; let privatePayload: any;
  let authResult: any = { subject: "fixture-owner", device_id: "fixture-device" };
  let authStatus = 200;
  let responseOverride: any;
  const env = { MAX_REQUEST_BYTES: "65536", SERVICE_RESPONSE_BYTES: "32768", TICKET_TTL_SECONDS: "300",
    DELIVERY_DENYLIST_JSON: "[]", TICKET_SIGNING_KEY_PKCS8: privatePEM, TICKET_VERIFYING_KEY_SPKI: publicPEM,
    AUTH_SERVICE: { fetch: async () => { auth++; return Response.json(authResult, { status: authStatus }); } },
    PRIVATE_ROUTE_CORE: { fetch: async (url: string, options: RequestInit) => {
      privateCalls++; expect(url.endsWith("/authorize-profile")).toBe(true);
      privatePayload = JSON.parse(String(options.body));
      const selected = privatePayload.selected;
      return Response.json(responseOverride ?? { status: "step", provider: selected.provider,
        action: selected.provider === "codex" ? "cx_61sol_low" : "cl_fable51_max",
        permission_profile: selected.permission_profile, startup_contract: { schema: 1,
          completion_feedback_schema: 1, model_availability_schema: 1,
          executor_contract_sha256: config.executor_contract.sha256, model: selected.model,
          effort: selected.effort, state_storage: "pool_v1" } });
    } },
    EXECUTIONS: { getByName: () => { legacy++; throw Error("no second legacy execution owner"); } },
    EXECUTION_POOLS: { getByName: (name: string) => { expect(name).toBe("startup-v1"); return {
      ready: async () => true,
      begin: async (command: any) => { begins++; expect(command.subject_hash).toHaveLength(64);
        expect(command.device_id).toBe("fixture-device"); expect(command.phase).toBe("active"); return "created"; },
    }; } },
  } as unknown as Env;
  return { env, publicPEM, counts: () => ({ auth, privateCalls, begins, legacy }),
    privatePayload: () => privatePayload,
    override: (value: unknown) => { responseOverride = value; },
    failAuth: () => { authStatus = 403; authResult = { error: "denied" }; },
  };
}

describe("one exact config authorization, not a routing or result-evaluation loop", () => {
  it.each([selected, claudeSelected])("signs the exact selected config with one existing owner ledger", async selection => {
    const f = await fixture(); const result = await authorizeExecution(request(body(selection)), f.env);
    const ticket = parseTicket(await result.json());
    expect(ticket.provider).toBe(selection.provider); expect(ticket.permission_profile).toBe("read_only");
    expect(ticket.startup_contract).toMatchObject({ model: selection.model, effort: selection.effort,
      executor_contract_sha256: config.executor_contract.sha256 });
    expect(await verifyTicket(ticket, f.publicPEM)).toBe(true);
    expect(f.counts()).toEqual({ auth: 1, privateCalls: 1, begins: 1, legacy: 0 });
    expect(f.privatePayload().selected).toEqual(selection);
    expect(f.privatePayload().task.content).toBe(task);
    if (selection.provider === "claude") expect(f.privatePayload().task.available_codex_models).toEqual([]);
  });
  it.each(["permission", "model", "effort", "contract", "missing-startup"])("denies a changed %s acknowledgement before ledger creation", async defect => {
    const f = await fixture(); const response: any = { status: "step", provider: "codex", action: "cx_61sol_low",
      permission_profile: "read_only", startup_contract: { schema: 1, completion_feedback_schema: 1,
        model_availability_schema: 1, executor_contract_sha256: config.executor_contract.sha256,
        model: selected.model, effort: "low", state_storage: "pool_v1" } };
    if (defect === "permission") response.permission_profile = "workspace_write";
    if (defect === "model") response.startup_contract.model = "gpt-other";
    if (defect === "effort") response.startup_contract.effort = "max";
    if (defect === "contract") response.startup_contract.executor_contract_sha256 = "f".repeat(64);
    if (defect === "missing-startup") delete response.startup_contract;
    f.override(response); await expect(authorizeExecution(request(body()), f.env)).rejects.toThrow();
    expect(f.counts().begins).toBe(0);
  });
  it.each(["undefined-selection", "read-upgrade", "unsupported-tuple", "pinned-provider", "disabled-provider", "wrong-task-hash"])("rejects %s before private authorization", async defect => {
    const f = await fixture(), payload: any = body();
    if (defect === "undefined-selection") delete payload.selected;
    if (defect === "read-upgrade") payload.selected.permission_profile = "workspace_write";
    if (defect === "unsupported-tuple") payload.selected.model = "unlisted-model";
    if (defect === "pinned-provider") payload.request.provider_preference = "claude";
    if (defect === "disabled-provider") payload.request.capacity_plan.codex = 0;
    if (defect === "wrong-task-hash") payload.request.task = "different task";
    await expect(authorizeExecution(request(payload), f.env)).rejects.toThrow();
    expect(f.counts().privateCalls).toBe(0); expect(f.counts().begins).toBe(0);
  });
  it("requires existing authentication; no login/account/billing fallback", async () => {
    const f = await fixture(); await expect(authorizeExecution(request(body(), false), f.env)).rejects.toThrow();
    expect(f.counts()).toEqual({ auth: 0, privateCalls: 0, begins: 0, legacy: 0 });
    f.failAuth(); await expect(authorizeExecution(request(body()), f.env)).rejects.toThrow();
    expect(f.counts().privateCalls).toBe(0); expect(f.counts().begins).toBe(0);
  });
  it("does not weaken the legacy empty-Codex parser", () => {
    const payload: any = body(claudeSelected).request;
    delete payload.required_startup_contract;
    delete payload.execution_context.available_claude_models;
    delete payload.execution_context.completion_feedback;
    expect(() => parseStartRequest(payload)).toThrow();
    expect(parseStartRequest(payload, { allowEmptyCodexCatalog: true }).available_codex_models).toEqual([]);
  });
});
