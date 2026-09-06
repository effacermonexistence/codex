#!/usr/bin/env node
// Explicitly synthetic route-only fixtures. No provider calls, real usage claims,
// credential files, conversation-store writes or private-policy disclosure.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const config = JSON.parse(readFileSync(new URL('../../os1-mac-runtime/Config/production.json', import.meta.url)));
const gateway = config.api_url;
const auth = spawnSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf8' });
assert.equal(auth.status, 0, 'existing authenticated GitHub CLI required');
assert(auth.stdout.trim().length > 20);
const headers = { authorization: `Bearer ${auth.stdout.trim()}`, 'content-type': 'application/json',
  'x-os1-device-id': `completion-smoke:${randomUUID()}` };
const checks = [], routes = [];
const task = 'Explain this supplied note briefly: a cache stores reusable results; invalidation removes stale entries.';
const hash = text => createHash('sha256').update(text).digest('hex');
const catalog = ['gpt-5.6-luna', 'gpt-5.6-terra'].map((slug, priority) => ({
  slug, priority, default_effort: 'medium', supported_efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
}));
const contract = { executor_contract_version: config.executor_contract.version,
  executor_contract_sha256: config.executor_contract.sha256 };
const context = observations => ({ input_utf8_bytes: Buffer.byteLength(task), source_utf8_bytes: 0,
  history_utf8_bytes: 0, completion_feedback: { schema: 1, objective_sha256: hash(task), observations } });
const observation = (profile, outcome = 'adopted', tokens = 100) => ({ ...profile, outcome,
  input_tokens: tokens, output_tokens: tokens === null ? null : 0, duration_ms: 10 });
async function post(overrides = {}, rows = []) {
  const response = await fetch(`${gateway}/v1/executions`, { method: 'POST', headers,
    signal: AbortSignal.timeout(45000), body: JSON.stringify({ task, provider_preference: 'codex',
      capacity_plan: { codex: 30, claude: 100 }, available_codex_models: catalog,
      ...contract, execution_context: context(rows), ...overrides }) });
  return { status: response.status, data: await response.json() };
}
async function route(overrides = {}, rows = []) {
  const result = await post(overrides, rows);
  assert.equal(result.status, 200, 'route start HTTP status');
  assert.deepEqual(Object.keys(result.data).sort(), ['action','execution_id','expires_at','nonce',
    'permission_profile','provider','sequence','signature'].sort(), 'strict ticket egress');
  const profile = config.execution_profiles[result.data.action];
  assert(profile && profile.provider === result.data.provider);
  assert.equal(result.data.permission_profile, 'read_only');
  routes.push({ execution_id: result.data.execution_id, ...profile });
  return profile;
}
const cap = await fetch(`${gateway}/v1/capabilities`, { signal: AbortSignal.timeout(45000) });
const capabilityText = await cap.text();
if (cap.status !== 200) {
  const blocked = { timestamp: new Date().toISOString(), status: 'BLOCKED', stage: 'capability',
    httpStatus: cap.status, cloudflareError: /^error code: (\d+)\s*$/.exec(capabilityText)?.[1] ?? null,
    modelCalls: 0, routeStarts: 0, completedChecks: 0,
    limitation: 'Service unavailable; routing fixtures were not reached and are not passing checks.' };
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(blocked, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(blocked));
  process.exit(2);
}
assert.deepEqual(JSON.parse(capabilityText), { completion_feedback_schema: 1, execution_protocol: 1 });
checks.push('Three-service capability negotiation and minimal egress');
const base = await route();
assert.equal(base.provider, 'codex');
checks.push('Explicit provider authority retained');
const alt = await route({ available_codex_models: catalog.filter(c => c.slug !== base.model) });
assert.notEqual(alt.model, base.model);
for (const outcome of ['quality_failure', 'timeout', 'capability_failure']) {
  const selected = await route({}, [observation(base, outcome)]);
  assert.notDeepEqual(selected, base);
  checks.push(`Historical ${outcome} tuple avoided while alternatives exist`);
}
assert.deepEqual(await route({}, [observation(alt, 'adopted', null)]), alt);
checks.push('Supported alternative model not hidden by prior preference');
assert.deepEqual(await route({}, [observation(base, 'adopted', 100),
  observation(alt, 'quality_failure', 200), observation(alt, 'adopted', 20)]), base);
checks.push('Retry-inclusive 220-token path loses to 100-token path, despite 20-token final call');
assert.deepEqual(await route({}, [observation(base, 'adopted', 100), observation(alt, 'adopted', 20)]), alt);
checks.push('Comparable completed paths use observed total token volume');
assert.deepEqual(await route({}, [
  { ...observation(base, 'adopted', 100), duration_ms: 300 },
  { ...observation(alt, 'timeout', 80), duration_ms: 150 },
  { ...observation(alt, 'adopted', 20), duration_ms: 50 },
]), alt);
checks.push('Equal-token completed paths use retry-inclusive measured latency');
const boundedTask = 'Explain cache invalidation in two short sentences.';
const boundedRoute = text => route({ task: text, provider_preference: 'auto', execution_context: {
  input_utf8_bytes: Buffer.byteLength(text), source_utf8_bytes: 0, history_utf8_bytes: 0,
  completion_feedback: { schema: 1, objective_sha256: hash(text), observations: [] },
} });
assert.deepEqual(await boundedRoute(boundedTask + ' Do not deploy or modify files.'), await boundedRoute(boundedTask));
checks.push('Standalone prohibition does not escalate bounded explanation');
const readinessTask = 'Assess backup and recovery readiness of the attached source: source integrity and claim boundary audit. Distinguish historical snapshot coverage, current-state coverage and recovery verification. Identify evidence gaps and a concrete validation plan. Read-only assessment.';
const readinessRoute = await boundedRoute(readinessTask);
assert.notEqual(readinessRoute.effort, 'low', 'Recovery-evidence audit must retain its review floor');
checks.push('Recovery-readiness audit intent retains source-review floor, not bounded-explanation shortcut');
const liveCatalog = JSON.parse(readFileSync(join(homedir(), '.codex/models_cache.json'))).models
  .filter(model => model.visibility === 'list').map(model => ({ slug: model.slug, priority: model.priority,
    default_effort: model.default_reasoning_level,
    supported_efforts: model.supported_reasoning_levels.map(level => level.effort).filter(effort => effort !== 'none') }));
for (const model of liveCatalog) {
  for (const effort of model.supported_efforts) {
    const profile = { provider: 'codex', model: model.slug, effort };
    assert.deepEqual(await route({ available_codex_models: liveCatalog }, [observation(profile)]), profile);
    checks.push(`Current executable tuple eligible: ${model.slug}/${effort}`);
  }
}
const empty = await route({ provider_preference: 'auto', available_codex_models: [] });
assert.equal(empty.provider, 'claude');
checks.push('Unavailable Codex catalog never creates a phantom capability');
const mismatch = context([]);
mismatch.completion_feedback.objective_sha256 = 'a'.repeat(64);
assert.equal((await post({ execution_context: mismatch })).status, 400);
checks.push('Cross-objective observations rejected');
const old = await route({ execution_context: undefined });
assert.equal(old.provider, 'codex');
checks.push('Old-client request remains accepted');
const deterministicTask = '32+32';
const deterministic = await route({ task: deterministicTask, provider_preference: 'auto',
  execution_context: { input_utf8_bytes: Buffer.byteLength(deterministicTask), source_utf8_bytes: 0,
    history_utf8_bytes: 0, completion_feedback: { schema: 1, objective_sha256: hash(deterministicTask), observations: [] } } });
assert.equal(deterministic.provider, 'local');
checks.push('Exact arithmetic retains the no-model lane');
const report = { timestamp: new Date().toISOString(), status: 'PASS', syntheticObservations: true,
  modelCalls: 0, routeStarts: routes.length, checks, routes,
  limitation: 'Controlled routing fixtures, not measured production savings or a guarantee for unseen objectives.' };
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ status: report.status, passed: checks.length, routeStarts: routes.length, modelCalls: 0 }));
