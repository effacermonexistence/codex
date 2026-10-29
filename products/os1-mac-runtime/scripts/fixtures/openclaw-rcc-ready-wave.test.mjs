// Same-parent, one-ready-wave catalog admission. Actual SQLite and barriers;
// fake catalog/native callbacks only. No HOME, account, provider or model calls.
import './local-model-fixture.mjs';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {chmod, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createRCCRuntime, hostContextFingerprint} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function gate() { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; }
async function until(predicate) {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) { if (predicate()) return; await sleep(5); }
  throw Error('fixture condition timeout');
}
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'os1-ready-wave-')); await chmod(path, 0o700);
  t.after(() => rm(path, {recursive: true, force: true})); return path;
}
function task(workspace, extra = {}) {
  const request = 'Read the independent source checks';
  const host = {workspace, context: null, provider_preference: 'codex', codex_session_id: extra.resume ?? null,
    claude_session_id: null, require_read_only: !extra.write, owner_policy: null};
  return {schema: 1, task_id: randomUUID(), request, objective: request, request_sha256: hash(request),
    source_fingerprint: hostContextFingerprint(host), policy_sha256: hash('fixture-policy'), mode: 'auto',
    material_refs: [], host_context: host,
    policy: {source_sha256: hash('fixture-source'), projection_sha256: hash('fixture-policy'), text: 'fixture-policy'},
    budget: {max_parallel: extra.parallel ?? 4, max_attempts: 1, max_cost_units: null, max_duration_ms: 20_000}};
}
function row(id = 'read', write = false, now = Date.now()) {
  return {id, surface: 'codex', transport: 'codex_app_server', account_id: 'fixture', model: 'fixture', effort: 'low',
    tools: [], scope: write ? 'workspace_write' : 'read_only', permission_profile: write ? 'workspace_write' : 'read_only',
    quota_pool: 'openai_codex', allowed_paths: write ? ['one.txt'] : [], configuration_sha256: hash(id),
    availability: 'available', availability_observed_at_ms: now - 1, availability_valid_until_ms: now + 30_000,
    quota_remaining_fraction: 0.8, quota_observed_at_ms: now - 1, quota_valid_until_ms: now + 30_000,
    quality_state: 'policy_admitted', estimated_cost_units: 1};
}
const node = (id, candidate, dependencies = []) => ({id, instruction: 'Read source for ' + id, dependencies,
  kind: 'agent', candidate_id: candidate.id, scope: candidate.scope, owned_paths: candidate.allowed_paths, context_refs: []});
// Fixture contract: every planned node is a separately requested independent output.
const plan = (q, nodes) => {assert(nodes.every(n => n.dependencies.length === 0));
  return {schema: 1, task_id: q.task_id, request_sha256: q.request_sha256, nodes, final_node_id: null};};
const catalog = (q, candidates = [row(), row('write', true)]) => ({schema: 1, task_id: q.task_id,
  request_sha256: q.request_sha256, candidates});
const result = (ticket, extra = {}) => ({schema: 1, task_id: ticket.task_id, node_id: ticket.node_id,
  attempt_id: ticket.attempt_id, candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
  selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
  status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', output: ticket.node_id + ' ok',
  execution_verified: true, task_verified: true, task_quality: 'task_verified', parity_state: 'unverified',
  native_receipt: '/private/fixture/' + ticket.attempt_id, native_summary: '{"fixture":true}', native_turn_terminated: true, ...extra});
const verify = ({task: q, children}) => ({schema: 1, task_id: q.task_id, task_verified: true,
  output: children.map(c => c.output).join('\n'), parity_state: 'unverified', reason: 'fixture_only'});
async function runtime(t, path, options = {}) {
  const rt = await createRCCRuntime({stateDir: path, maximumWorkers: 4, maximumReadWorkersPerPool: 4,
    catalog: async q => catalog(q), plan: async ({task: q}) => plan(q, [node('a', row()), node('b', row())]),
    execute: async ticket => result(ticket), verifyTask: verify, ...options});
  t.after(() => rt.close()); return rt;
}

// The legacy control cannot hang: its third catalog call deliberately lets A
// finish before B is admitted. The new path must avoid that third call and
// start B while A is pending. No wall-time speed assertion substitutes for it.
for (const legacy of [true, false]) test(legacy ?
  'control: per-child catalog refresh serializes these otherwise parallel readers' :
  'one fresh ready-wave catalog admits both readers while the first is pending', async t => {
  const path = await directory(t), q = task(path), a = gate(), b = gate(), aFinished = gate();
  let reads = 0, active = 0, peak = 0; const trace = [], tickets = [];
  const rt = await runtime(t, path, {
    catalog: async current => {
      reads++; trace.push('catalog:' + reads);
      if (reads === 3) { a.resolve(); await aFinished.promise; }
      return catalog(current);
    },
    execute: async ticket => {
      tickets.push(ticket); trace.push(ticket.node_id + ':start'); active++; peak = Math.max(peak, active);
      assert.equal(ticket.native_resume_session_id, null);
      if (ticket.node_id === 'a') { await a.promise; active--; trace.push('a:finish'); aFinished.resolve(); }
      else { a.resolve(); await b.promise; active--; trace.push('b:finish'); }
      return result(ticket);
    }
  });
  t.after(() => { a.resolve(); b.resolve(); aFinished.resolve(); });
  if (legacy) rt._readyWaveEligible = () => false; // test-only old admission control
  await rt.submit(q); await until(() => tickets.length === 2);
  assert.equal(peak, legacy ? 1 : 2); assert.equal(reads, legacy ? 3 : 2);
  if (legacy) assert.ok(trace.indexOf('a:finish') < trace.indexOf('b:start'));
  else assert.ok(trace.indexOf('b:start') < trace.indexOf('a:finish'));
  assert.equal(rt.db.prepare('select * from quota_leases').all().length, 1);
  assert.ok(tickets.every(x => x.task_id === q.task_id && x.source_fingerprint === q.source_fingerprint &&
    x.policy_sha256 === q.policy_sha256 && x.selected_config.model === 'fixture' && x.selected_config.effort === 'low'));
  b.resolve(); assert.equal((await rt.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 5_000})).state, 'completed');
  await until(() => rt.activeWorkers === 0);
  assert.equal(rt.db.prepare('select * from quota_leases').all().length, 0);
});

test('wave binding covers parent, source, policy, context, scope, plan, exact catalog and bind time', async t => {
  const path = await directory(t), q = task(path), hold = gate();
  const rt = await runtime(t, path, {execute: async ticket => { await hold.promise; return result(ticket); }});
  t.after(hold.resolve); await rt.submit(q); await until(() => rt.activeWorkers === 2);
  const original = rt._load(q.task_id), before = JSON.stringify(original), binding = rt._readyWaveBinding(original);
  const changes = [
    x => { x.task.task_id = randomUUID(); }, x => { x.task.source_fingerprint = hash('other-source'); },
    x => { x.task.policy_sha256 = hash('other-policy'); }, x => { x.task.policy.text = 'other-policy'; },
    x => { x.task.host_context.context = 'other-context'; }, x => { x.task.host_context.workspace += '/other'; },
    x => { x.task.host_context.provider_preference = 'auto'; }, x => { x.task.host_context.require_read_only = false; },
    x => { x.plan.nodes[0].instruction = 'other'; }, x => { x.catalog.candidates[0].account_id = 'other'; },
    x => { x.catalog.candidates[0].configuration_sha256 = hash('other-configuration'); },
    x => { x.catalog_bound_at_ms++; }, x => { x.bound_rows = {other: row('other')}; }
  ];
  for (const change of changes) { const copy = structuredClone(original); change(copy);
    assert.notEqual(rt._readyWaveBinding(copy), binding); }
  assert.equal(JSON.stringify(original), before, 'binding inspection never mutates the authority snapshot');
  hold.resolve(); await rt.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 5_000});
});

test('eligibility rejects retries, refusals, repairs, continuations, staging, dependencies and resumed legacy threads', async t => {
  const path = await directory(t), q = task(path), c = row(), hold = gate();
  const rt = await runtime(t, path, {maximumReadWorkersPerPool: 2,
    plan: async ({task: current}) => plan(current, [node('a', c), node('b', c), node('c', c)]),
    execute: async ticket => { await hold.promise; return result(ticket); }});
  t.after(hold.resolve); await rt.submit(q); await until(() => rt.activeWorkers === 2);
  const original = rt._load(q.task_id), pending = original.plan.nodes.find(n => n.id === 'c');
  assert.equal(rt._readyWaveEligible(original, pending, original.catalog.candidates[0]), true);
  const cases = [
    x => { x.cancel_requested = true; }, x => { x.state = 'held'; },
    x => { x.children[2].attempts = 1; }, x => { x.children[2].repair_needed = true; },
    x => { x.children[0].continuation = {state: 'pending'}; }, x => { x.children[0].stage = {state: 'pending'}; },
    x => { x.children[2].re_resolutions = 1; }, x => { x.children[2].spreads = 1; },
    x => { x.children[2].spread = true; }, x => { x.children[0].state = 'failed'; },
    x => { x.children[0].state = 'effects_uncertain'; },
    x => { x.children[0].attempt_history[0].state = 'verified_not_dispatched'; },
    x => { x.plan.nodes[2].dependencies = ['a']; },
    x => { x.plan.nodes[0].scope = 'workspace_write'; x.plan.nodes[0].owned_paths = ['one.txt']; },
    x => { x.task.native_sessions = {codex: randomUUID()}; },
    x => { x.task.budget.max_parallel = 1; }
  ];
  for (const mutate of cases) { const copy = structuredClone(original); mutate(copy);
    assert.equal(rt._readyWaveEligible(copy, copy.plan.nodes.find(n => n.id === 'c'), copy.catalog.candidates[0]), false); }
  const atomic = structuredClone(original); atomic.plan.nodes = [pending];
  atomic.task.host_context.codex_session_id = randomUUID();
  assert.equal(rt._readyWaveEligible(atomic, pending, atomic.catalog.candidates[0]), false);
  hold.resolve(); assert.equal((await rt.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 5_000})).state, 'completed');
});

test('expired availability/quota observation cannot be reused for a later sibling', async t => {
  const realNow = Date.now; let offset = 0; Date.now = () => realNow() + offset;
  t.after(() => { Date.now = realNow; });
  const path = await directory(t), q = task(path), hold = gate(); let reads = 0;
  const rt = await runtime(t, path, {catalog: async current => {
    reads++; const c = row(); c.availability_valid_until_ms = Date.now() + 100;
    c.quota_valid_until_ms = Date.now() + 100; return catalog(current, [c]);
  }, execute: async ticket => { if (ticket.node_id === 'a') offset += 1_000; await hold.promise; return result(ticket); }});
  t.after(hold.resolve); await rt.submit(q); await until(() => rt.activeWorkers === 2);
  assert.equal(reads, 3, 'second sibling receives a fresh observation after the first expires');
  hold.resolve(); assert.equal((await rt.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 5_000})).state, 'completed');
});

test('cancel during the shared refresh produces no late native dispatch', async t => {
  const path = await directory(t), q = task(path), refresh = gate(); let reads = 0, executions = 0;
  const rt = await runtime(t, path, {catalog: async current => {
    reads++; if (reads === 2) await refresh.promise; return catalog(current);
  }, execute: async ticket => { executions++; return result(ticket); }});
  t.after(refresh.resolve); await rt.submit(q); await until(() => reads === 2);
  await rt.cancel({schema: 1, task_id: q.task_id}); refresh.resolve();
  assert.equal((await rt.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 5_000})).state, 'cancelled');
  await until(() => rt.runningTasks.size === 0); assert.equal(executions, 0);
});

test('an immediately returned opaque authorization failure prevents a stale-wave sibling dispatch', async t => {
  const path = await directory(t), q = task(path); let reads = 0; const sent = [];
  const rt = await runtime(t, path, {catalog: async current => { reads++; return catalog(current); },
    execute: async ticket => { sent.push(ticket.node_id); return result(ticket, {status: 'failed', output: null,
      acknowledged_config: null, execution_verified: false, task_verified: false, task_quality: 'unverified',
      dispatch_stage: 'not_dispatched', error: 'native_pre_dispatch_failed'}); }});
  await rt.submit(q); const done = await rt.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 5_000});
  assert.equal(done.state, 'held'); assert.equal(done.error, 'native_pre_dispatch_failed');
  assert.deepEqual(sent, ['a']); assert.equal(reads, 2);
  assert.equal(rt._load(q.task_id).children[1].attempts, 0);
});

test('a catalog refresh with a changed exact configuration is still rejected', async t => {
  const path = await directory(t), q = task(path); let reads = 0, executions = 0;
  const rt = await runtime(t, path, {catalog: async current => {
    const c = row(); if (++reads > 1) { c.effort = 'medium'; c.configuration_sha256 = hash('changed'); }
    return catalog(current, [c]);
  }, execute: async ticket => { executions++; return result(ticket); }});
  await rt.submit(q); const done = await rt.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 5_000});
  assert.equal(done.state, 'held'); assert.equal(done.error, 'candidate_configuration_changed'); assert.equal(executions, 0);
});

test('another parent and a later wave each require their own catalog refresh', async t => {
  const path = await directory(t), first = task(path), second = task(path), hold = gate();
  const reads = new Map(), started = [];
  const rt = await runtime(t, path, {maximumReadWorkersPerPool: 2,
    catalog: async current => { reads.set(current.task_id, (reads.get(current.task_id) ?? 0) + 1); return catalog(current); },
    plan: async ({task: current}) => plan(current, [node('a', row()), node('b', row()), node('c', row())]),
    execute: async ticket => { started.push(ticket); if (ticket.task_id === first.task_id) await hold.promise; return result(ticket); }});
  t.after(hold.resolve); await rt.submit(first); await until(() => started.length === 2);
  await rt.submit(second); await until(() => (reads.get(second.task_id) ?? 0) >= 1); await sleep(40);
  assert.ok(started.every(x => x.task_id === first.task_id));
  assert.equal(reads.get(first.task_id), 2); hold.resolve();
  assert.equal((await rt.wait({schema: 1, task_id: first.task_id}, {timeoutMs: 5_000})).state, 'completed');
  assert.equal((await rt.wait({schema: 1, task_id: second.task_id}, {timeoutMs: 5_000})).state, 'completed');
  assert.ok(reads.get(first.task_id) >= 3, 'third node enters a new ready wave, not a previous-loop cache');
  assert.ok(reads.get(second.task_id) >= 3, 'foreign parent never borrows the first task catalog');
});
