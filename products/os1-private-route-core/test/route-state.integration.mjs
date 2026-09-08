import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(here);
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler"));
const { Miniflare, convertV4MiniflareOptions } = await import(
  pathToFileURL(wranglerRequire.resolve("miniflare")).href
);
const esbuild = await import(pathToFileURL(wranglerRequire.resolve("esbuild")).href);

const workerName = "os1-route-state-integration";
const uniqueKey = "os1-route-state-integration-v1";
const hex = (character) => character.repeat(64);
const routeId = (value) => `rcc-local-${value.toString(16).padStart(32, "0")}`;
const verifiedHash = hex("f");

const executionProfiles = {
  local_exact: { provider: "local", model: "local-deterministic", effort: "none" },
  codex_medium: { provider: "codex", model: "gpt-test", effort: "medium" },
  codex_high: { provider: "codex", model: "gpt-test", effort: "high" },
  claude_medium: { provider: "claude", model: "claude-test", effort: "medium" },
  claude_high: { provider: "claude", model: "claude-test", effort: "high" },
};
const catalog = [{ slug: "gpt-test", default_effort: "medium", supported_efforts: ["medium", "high"], priority: 1 }];
const observation = (provider, outcome, tokens) => ({
  provider,
  model: provider === "codex" ? "gpt-test" : "claude-test",
  effort: "medium",
  outcome,
  input_tokens: tokens,
  output_tokens: tokens === null ? null : Math.max(1, Math.floor(tokens / 10)),
  duration_ms: tokens === null ? null : tokens * 2,
});
const historical = observation("claude", "adopted", 100);
const firstFailure = observation("codex", "quality_failure", 200);
const secondFailure = observation("claude", "timeout", null);
const context = (observations = []) => ({
  input_utf8_bytes: 1_000,
  source_utf8_bytes: 600,
  history_utf8_bytes: 200,
  completion_feedback: { schema: 1, objective_sha256: hex("a"), observations },
});
const step = (provider, action, id) => ({
  provider,
  action,
  permission_profile: "read_only",
  max_steps: 4,
  provider_pinned: true,
  route_id: routeId(id),
  verification_profile: "source_review",
});
const beginInput = (task, id, executionContext) => ({
  ...step("codex", "codex_medium", id),
  task,
  provider_preference: "auto",
  capacity_plan: { codex: 100, claude: 100 },
  available_codex_models: catalog,
  attempt: 1,
  ...(executionContext ? { execution_context: executionContext } : {}),
  policy_version: "policy-test-v1",
  policy_sha256: hex("b"),
  rcc_policy_sha256: hex("c"),
  executor_contract_version: "executor-test-v1",
  executor_contract_sha256: hex("d"),
  execution_profiles: executionProfiles,
});

const legacyWorker = `
import { DurableObject } from "cloudflare:workers";
export class RouteState extends DurableObject {
  seed(input) {
    return this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(\`CREATE TABLE route (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), provider TEXT NOT NULL, action TEXT NOT NULL,
        permission_profile TEXT NOT NULL, max_steps INTEGER NOT NULL, provider_pinned INTEGER NOT NULL,
        route_id TEXT NOT NULL, verification_profile TEXT NOT NULL, task TEXT NOT NULL,
        provider_preference TEXT NOT NULL, codex_capacity INTEGER NOT NULL, claude_capacity INTEGER NOT NULL,
        codex_catalog_json TEXT NOT NULL, attempt INTEGER NOT NULL, sequence INTEGER NOT NULL,
        complete INTEGER NOT NULL DEFAULT 0, policy_version TEXT NOT NULL, policy_sha256 TEXT NOT NULL,
        rcc_policy_sha256 TEXT NOT NULL, executor_contract_version TEXT NOT NULL,
        executor_contract_sha256 TEXT NOT NULL, execution_profiles_json TEXT NOT NULL,
        verified_artifact_hash TEXT)\`);
      this.ctx.storage.sql.exec(
        \`INSERT INTO route VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,?,?,?,?,?,?,NULL)\`,
        input.provider, input.action, input.permission_profile, input.max_steps, input.provider_pinned ? 1 : 0,
        input.route_id, input.verification_profile, input.task, input.provider_preference,
        input.capacity_plan.codex, input.capacity_plan.claude, JSON.stringify(input.available_codex_models), input.attempt,
        input.policy_version, input.policy_sha256, input.rcc_policy_sha256,
        input.executor_contract_version, input.executor_contract_sha256, JSON.stringify(input.execution_profiles));
      return this.inspect();
    });
  }
  inspect() {
    return {
      columns: this.ctx.storage.sql.exec("PRAGMA table_info(route)").toArray().map((row) => row.name),
      row: this.ctx.storage.sql.exec("SELECT * FROM route WHERE singleton=1").toArray()[0] ?? null,
    };
  }
}
export default {
  async fetch(request, env) {
    const body = await request.json();
    try {
      const state = env.ROUTES.getByName(body.name);
      const value = body.op === "seed" ? await state.seed(body.input) : await state.inspect();
      return Response.json({ ok: true, value });
    } catch { return Response.json({ ok: false }, { status: 409 }); }
  },
};`;

const currentWorkerSource = `
import { RouteState as ProductionRouteState } from "./src/index.ts";
export class RouteState extends ProductionRouteState {
  testBegin(input) { return this.begin(input); }
  testSnapshot(sequence) { return this.snapshot(sequence); }
  testAdvance(sequence, outcome, hash, next, executionContext, currentRun) {
    return this.advance(sequence, outcome, hash, next, executionContext, currentRun);
  }
  inspect() {
    return {
      columns: this.ctx.storage.sql.exec("PRAGMA table_info(route)").toArray().map((row) => row.name),
      row: this.ctx.storage.sql.exec("SELECT * FROM route WHERE singleton=1").toArray()[0] ?? null,
    };
  }
}
export default {
  async fetch(request, env) {
    const body = await request.json();
    try {
      const state = env.ROUTES.getByName(body.name);
      let value;
      if (body.op === "begin") value = await state.testBegin(body.input);
      else if (body.op === "snapshot") value = await state.testSnapshot(body.sequence);
      else if (body.op === "advance") value = await state.testAdvance(
        body.sequence, body.outcome, body.hash, body.next, body.executionContext, body.currentRun);
      else if (body.op === "inspect") value = await state.inspect();
      else throw new Error("unknown operation");
      return Response.json({ ok: true, value });
    } catch { return Response.json({ ok: false }, { status: 409 }); }
  },
};`;

const bundled = await esbuild.build({
  stdin: { contents: currentWorkerSource, loader: "ts", resolveDir: packageRoot, sourcefile: "route-state.integration.worker.ts" },
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["cloudflare:workers"],
  logLevel: "silent",
});
assert.equal(bundled.outputFiles.length, 1);

function options(source, persistencePath) {
  return convertV4MiniflareOptions({
    name: workerName,
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    modules: [{ type: "ESModule", path: "index.mjs", contents: source }],
    durableObjects: { ROUTES: { className: "RouteState", useSQLite: true, unsafeUniqueKey: uniqueKey } },
    resourcePersistencePath: persistencePath,
    logRequests: false,
    telemetry: { enabled: false },
  });
}

async function call(miniflare, body, expectedStatus = 200) {
  const response = await miniflare.dispatchFetch("http://localhost/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, expectedStatus);
  return response.json();
}

const persistencePath = await mkdtemp(join(tmpdir(), "os1-route-state-integration-"));
let miniflare;
const watchdog = setTimeout(() => {
  console.error("route-state integration timed out");
  process.exit(124);
}, 30_000);

try {
  miniflare = new Miniflare(options(legacyWorker, persistencePath));
  const legacyInput = beginInput("legacy task", 1);
  const seeded = await call(miniflare, { op: "seed", name: "legacy", input: legacyInput });
  assert.equal(seeded.ok, true);
  assert.equal(seeded.value.row.task, "legacy task");
  assert.equal(seeded.value.columns.includes("execution_context_json"), false);
  assert.equal(seeded.value.columns.includes("current_run_observations_json"), false);
  await miniflare.dispose();
  miniflare = undefined;

  miniflare = new Miniflare(options(bundled.outputFiles[0].text, persistencePath));

  // A persisted pre-column object is migrated before its first current RPC.
  const migrated = await call(miniflare, { op: "snapshot", name: "legacy", sequence: 1 });
  assert.equal(migrated.ok, true);
  assert.equal(migrated.value.task, "legacy task");
  assert.equal("execution_context" in migrated.value, false);
  assert.deepEqual(migrated.value.current_run_observations, []);
  const migratedRaw = (await call(miniflare, { op: "inspect", name: "legacy" })).value;
  assert.equal(migratedRaw.columns.includes("execution_context_json"), true);
  assert.equal(migratedRaw.columns.includes("current_run_observations_json"), true);
  assert.equal(migratedRaw.row.execution_context_json, null);
  assert.equal(migratedRaw.row.current_run_observations_json, null);

  // The old no-feedback state continues through the old-form advance call.
  const legacyNext = step("claude", "claude_medium", 2);
  assert.deepEqual((await call(miniflare, { op: "advance", name: "legacy", sequence: 1,
    outcome: "retry", hash: verifiedHash, next: legacyNext })).value,
  { status: "step", provider: "claude", action: "claude_medium", permission_profile: "read_only" });
  const legacySecond = (await call(miniflare, { op: "snapshot", name: "legacy", sequence: 2 })).value;
  assert.equal("execution_context" in legacySecond, false);
  assert.deepEqual(legacySecond.current_run_observations, []);

  // Current-run observations accumulate independently of historical feedback.
  const initialContext = context([historical]);
  assert.equal((await call(miniflare, { op: "begin", name: "alpha", input: beginInput("alpha task", 3, initialContext) })).value, "created");
  assert.equal((await call(miniflare, { op: "begin", name: "beta", input: beginInput("beta task", 4, initialContext) })).value, "created");
  const alphaInitial = (await call(miniflare, { op: "snapshot", name: "alpha", sequence: 1 })).value;
  assert.deepEqual(alphaInitial.execution_context.completion_feedback.observations, [historical]);
  assert.deepEqual(alphaInitial.current_run_observations, []);

  const firstContext = context([historical, firstFailure]);
  await call(miniflare, { op: "advance", name: "alpha", sequence: 1, outcome: "retry", hash: verifiedHash,
    next: step("claude", "claude_medium", 5), executionContext: firstContext, currentRun: [firstFailure] });
  const alphaSecond = (await call(miniflare, { op: "snapshot", name: "alpha", sequence: 2 })).value;
  assert.deepEqual(alphaSecond.execution_context, firstContext);
  assert.deepEqual(alphaSecond.current_run_observations, [firstFailure]);
  const betaStillInitial = (await call(miniflare, { op: "snapshot", name: "beta", sequence: 1 })).value;
  assert.equal(betaStillInitial.task, "beta task");
  assert.deepEqual(betaStillInitial.execution_context, initialContext);
  assert.deepEqual(betaStillInitial.current_run_observations, []);

  const secondContext = context([historical, firstFailure, secondFailure]);
  await call(miniflare, { op: "advance", name: "alpha", sequence: 2, outcome: "retry", hash: hex("e"),
    next: step("codex", "codex_high", 6), executionContext: secondContext,
    currentRun: [firstFailure, secondFailure] });
  const alphaThird = (await call(miniflare, { op: "snapshot", name: "alpha", sequence: 3 })).value;
  assert.deepEqual(alphaThird.execution_context, secondContext);
  assert.deepEqual(alphaThird.current_run_observations, [firstFailure, secondFailure]);
  await call(miniflare, { op: "advance", name: "alpha", sequence: 3, outcome: "pass", hash: verifiedHash,
    executionContext: secondContext, currentRun: [firstFailure, secondFailure] });
  // Delivery retry after a lost HTTP response must reuse the saved decision,
  // even after route state has advanced/completed. Changed artifacts fail closed.
  assert.deepEqual((await call(miniflare, { op: "advance", name: "alpha", sequence: 3,
    outcome: "pass", hash: verifiedHash })).value, { status: "complete" });
  await call(miniflare, { op: "advance", name: "alpha", sequence: 3,
    outcome: "pass", hash: hex("0") }, 409);
  await call(miniflare, { op: "snapshot", name: "alpha", sequence: 3 }, 409);
  const terminalRaw = (await call(miniflare, { op: "inspect", name: "alpha" })).value.row;
  assert.equal(terminalRaw.complete, 1);
  assert.deepEqual(JSON.parse(terminalRaw.current_run_observations_json), [firstFailure, secondFailure]);

  // A late NOT NULL violation rolls back the context/current-run writes too.
  assert.equal((await call(miniflare, { op: "begin", name: "atomic", input: beginInput("atomic task", 7, initialContext) })).value, "created");
  const brokenNext = { ...step("claude", "claude_medium", 8), action: null };
  await call(miniflare, { op: "advance", name: "atomic", sequence: 1, outcome: "retry", hash: verifiedHash,
    next: brokenNext, executionContext: firstContext, currentRun: [firstFailure] }, 409);
  const rolledBack = (await call(miniflare, { op: "inspect", name: "atomic" })).value.row;
  assert.equal(rolledBack.sequence, 1);
  assert.equal(rolledBack.provider, "codex");
  assert.equal(rolledBack.action, "codex_medium");
  assert.deepEqual(JSON.parse(rolledBack.execution_context_json), initialContext);
  assert.equal(rolledBack.current_run_observations_json, null);
  assert.equal(rolledBack.verified_artifact_hash, null);
  await call(miniflare, { op: "advance", name: "atomic", sequence: 1, outcome: "retry", hash: verifiedHash,
    next: step("claude", "claude_medium", 9), executionContext: firstContext, currentRun: [firstFailure] });
  assert.deepEqual((await call(miniflare, { op: "snapshot", name: "atomic", sequence: 2 })).value.current_run_observations,
    [firstFailure]);

  console.log("route-state workerd integration: 4/4 checks passed");
} finally {
  clearTimeout(watchdog);
  if (miniflare) await miniflare.dispose();
  await rm(persistencePath, { recursive: true, force: true });
}
