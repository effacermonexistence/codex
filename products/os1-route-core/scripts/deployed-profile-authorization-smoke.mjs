#!/usr/bin/env node
// Opt-in live check before a client that adds signed execution profiles is
// published or installed (build 383, 2026-10-15: 78 -> 85 profiles). The
// deployed gateway and the private core's pinned policy bundle must authorize
// the newest tuples, or every such tuple is refused before dispatch and the
// client walks to an older profile (native_authorization_refused). Route-only:
// each check asks for one read-only ticket and never dispatches it, so no
// backend turn, tool action or model inference runs. The ticket expires
// unused, as one whose source custody fails before dispatch does.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

const [outputPath] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(new URL('../../os1-mac-runtime/Config/production.json', import.meta.url)));
const auth = spawnSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf8' });
assert.equal(auth.status, 0, 'existing authenticated GitHub CLI required');
const headers = { authorization: `Bearer ${auth.stdout.trim()}`, 'content-type': 'application/json',
  'x-os1-device-id': `profile-authorization:${randomUUID()}` };
// One profile of each new shape: a Claude effort below the reference and a
// Claude model with no effort control.
const actions = ['cl_opus55_medium', 'cl_haiku45_none'];
const task = 'Reply with exactly PROFILE_AUTHORIZATION_OK. Do not use tools or modify any files.';
const results = [];
for (const action of actions) {
  const profile = config.execution_profiles[action];
  assert(profile && profile.provider === 'claude', `${action} is not a signed Claude profile in this checkout`);
  const selected = { provider: 'claude', model: profile.model, effort: profile.effort, permission_profile: 'read_only' };
  const started = performance.now();
  const response = await fetch(config.api_url + '/v1/execution-authorizations', { method: 'POST', headers,
    signal: AbortSignal.timeout(45_000), body: JSON.stringify({ schema: 1, selected, request: { task,
      provider_preference: 'claude', capacity_plan: { codex: 0, claude: 100 },
      executor_contract_version: config.executor_contract.version, executor_contract_sha256: config.executor_contract.sha256,
      available_codex_models: [], required_startup_contract: 1,
      execution_context: { input_utf8_bytes: Buffer.byteLength(task), source_utf8_bytes: 0, history_utf8_bytes: 0,
        execution_permission_profile: 'read_only',
        available_claude_models: [{ model: profile.model, supported_efforts: [profile.effort] }],
        completion_feedback: { schema: 1, objective_sha256: createHash('sha256').update(task).digest('hex'),
          observations: [] } } } }) });
  const reply = await response.json().catch(() => null);
  const pass = response.status === 200 && reply?.action === action && reply?.provider === 'claude' &&
    reply?.startup_contract?.model === profile.model && reply?.startup_contract?.effort === profile.effort;
  results.push({ action, status: pass ? 'PASS' : 'FAIL', httpStatus: response.status,
    milliseconds: Math.round(performance.now() - started) });
}
const failed = results.filter(result => result.status !== 'PASS');
const report = { at: new Date().toISOString(), modelCalls: 0, routeOnly: true, results,
  ...(failed.length ? { limitation: 'The deployed gateway or its pinned policy bundle does not authorize these ' +
    'profiles yet: deploy the private core, then the gateway, roll over and re-pin the policy bundle, then rerun ' +
    'before publishing or installing the client.' } : {}) };
if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(report));
process.exit(failed.length ? 1 : 0);
