import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
import service from "../src/index";
import { admitExplicitProfile } from "../src/explicit-profile";

const hex = (value: string) => value.repeat(64);
const executionID = "00000000-0000-4000-8000-000000000001";
const taskText = "Inspect one selected file without changing it.";
const contract = { version: "executor-fixture-v1", sha256: hex("b") };
const profiles = {
  exact: { provider: "local", model: "local-deterministic", effort: "none" },
  cx_low: { provider: "codex", model: "gpt-fixture", effort: "low" },
  cx_high: { provider: "codex", model: "gpt-fixture", effort: "high" },
  cl_low: { provider: "claude", model: "claude-fixture", effort: "low" },
  cl_max: { provider: "claude", model: "claude-fixture", effort: "max" },
} as const;
const bundle = { schema: 4, policy_version: "exact-authorization-fixture-v1", maximum_steps: 4,
  executor_contracts: [contract], execution_profiles: profiles,
  rcc: { adapter_version: "fixture-adapter-v1", policy_sha256: hex("c"), engine_sha256: hex("d"), authority_sha256: hex("e") } };
const bytes = new TextEncoder().encode(JSON.stringify(bundle));
const policySHA = createHash("sha256").update(bytes).digest("hex");
function selected(provider = "codex", effort = "low", permission = "read_only") {
  return { provider, model: provider === "codex" ? "gpt-fixture" : "claude-fixture", effort, permission_profile: permission };
}
function input(provider = "codex") {
  return { version: 3, execution_id: executionID,
    principal: { subject: "fixture-owner", device_id: "fixture-device" }, selected: selected(provider),
    task: { content: taskText, trust: "untrusted_user_data", provider_preference: provider,
      capacity_plan: { codex: 100, claude: 100 }, executor_contract_version: contract.version,
      executor_contract_sha256: contract.sha256,
      available_codex_models: provider === "codex" ? [{ slug: "gpt-fixture", default_effort: "low", supported_efforts: ["low"], priority: 0 }] : [],
      execution_context: { input_utf8_bytes: 100, source_utf8_bytes: 0, history_utf8_bytes: 0,
        execution_permission_profile: "read_only", available_claude_models: [{ model: "claude-fixture", supported_efforts: ["low"] }],
        completion_feedback: { schema: 1, objective_sha256: createHash("sha256").update(taskText).digest("hex"), observations: [] } },
    } };
}
function fixture({ budget = true, ready = true }: { budget?: boolean; ready?: boolean } = {}) {
  let calls = 0, budgets = 0, begins = 0; let persisted: any;
  const env = { ROUTING_BUDGET_EPOCH: "fixture", MAX_ROUTE_STARTS_PER_HOUR: "10",
    POLICY_BUNDLE_KEY: `os1/policies/${policySHA}.json`, POLICY_BUNDLE_SHA256: policySHA, MAX_POLICY_BUNDLE_BYTES: "65536",
    POLICY_BUNDLES: { get: async () => ({ size: bytes.length, arrayBuffer: async () => bytes.buffer }) },
    RCC_V26: { fetch: async () => { calls++; throw Error("no routing inference allowed"); } },
    RESULT_EVALUATOR: { fetch: async () => { calls++; throw Error("no judge allowed"); } },
    ROUTES: { getByName: () => { throw Error("no legacy route owner"); } },
    ROUTING_BUDGETS: { getByName: () => ({ consumeStart: async () => { budgets++; return budget; } }) },
    ROUTE_POOLS: { getByName: (name: string) => { expect(name).toBe("startup-v1"); return {
      ready: async () => ready,
      begin: async (id: string, row: any) => { expect(id).toBe(executionID); begins++; persisted = row; return "created"; },
    }; } },
  } as unknown as Env;
  return { env, counts: () => ({ calls, budgets, begins }), persisted: () => persisted };
}
async function call(env: Env, body: unknown) {
  return service.fetch(new Request("https://private/authorize-profile", { method: "POST", body: JSON.stringify(body) }), env);
}

describe("exact tuple admission without routing or fallback", () => {
  it("returns only the exact supported signed profile, not the largest effort", () => {
    expect(admitExplicitProfile(selected(), profiles, [contract], contract.version, contract.sha256, "read_only"))
      .toEqual({ selected: selected(), action: "cx_low" });
  });
  it.each([undefined, null, {}, { ...selected(), api_key: "not-real" }, { ...selected(), effort: "ultra" },
    { ...selected(), model: "unlisted" }, { ...selected(), permission_profile: "workspace_write" },
    { ...selected(), provider: "unknown" }])("rejects unsupported/expanded selection without fallback", value => {
    expect(() => admitExplicitProfile(value, profiles, [contract], contract.version, contract.sha256, "read_only")).toThrow();
  });
  it("denies ambiguous profile and mismatched executor contract", () => {
    expect(() => admitExplicitProfile(selected(), { ...profiles, duplicate: profiles.cx_low }, [contract], contract.version, contract.sha256, "read_only")).toThrow();
    expect(() => admitExplicitProfile(selected(), profiles, [contract], contract.version, hex("f"), "read_only")).toThrow();
  });
  it.each(["codex", "claude"])("authorizes %s unchanged with one pooled ledger and zero inference/judge calls", async provider => {
    const f = fixture(); const response = await call(f.env, input(provider));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "step", provider, action: provider === "codex" ? "cx_low" : "cl_low",
      permission_profile: "read_only", startup_contract: { schema: 1, completion_feedback_schema: 1,
        model_availability_schema: 1, executor_contract_sha256: contract.sha256,
        model: selected(provider).model, effort: "low", state_storage: "pool_v1" } });
    expect(f.counts()).toEqual({ calls: 0, budgets: 1, begins: 1 });
    expect(f.persisted()).toMatchObject({ provider, max_steps: 1, provider_pinned: true,
      required_startup_contract: 1, permission_profile: "read_only", verification_profile: "native_record",
      route_id: "rcc-local-" + executionID.replaceAll("-", ""), capacity_plan: { codex: 100, claude: 100 } });
  });
  it.each(["scope", "catalog", "missing-catalog", "task-hash", "provider-preference", "capacity", "extra-field", "wrong-contract"])("rejects %s before any authorization state", async defect => {
    const f = fixture(), body: any = input("claude");
    if (defect === "scope") body.selected.permission_profile = "workspace_write";
    if (defect === "catalog") body.task.execution_context.available_claude_models = [];
    if (defect === "missing-catalog") delete body.task.execution_context.available_claude_models;
    if (defect === "task-hash") body.task.content = "different objective";
    if (defect === "provider-preference") body.task.provider_preference = "codex";
    if (defect === "capacity") body.task.capacity_plan.claude = 0;
    if (defect === "extra-field") body.task.fallback = "codex";
    if (defect === "wrong-contract") body.task.executor_contract_sha256 = hex("f");
    expect((await call(f.env, body)).status).toBe(400); expect(f.counts()).toEqual({ calls: 0, budgets: 0, begins: 0 });
  });
  it.each([{ budget: false }, { ready: false }])("preserves existing budget/readiness denial", async conditions => {
    const f = fixture(conditions); expect((await call(f.env, input())).status).toBe(400);
    expect(f.counts().calls).toBe(0); expect(f.counts().begins).toBe(0);
  });
});
