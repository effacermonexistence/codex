// Opt-in live route-only checks. No backend turn, tool action or model inference.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

const [inventoryPath, outputPath] = process.argv.slice(2);
assert(inventoryPath && outputPath, 'native inventory JSON and private receipt path required');
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
const config = JSON.parse(fs.readFileSync(new URL('../../os1-mac-runtime/Config/production.json', import.meta.url)));
const auth = spawnSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf8' });
assert.equal(auth.status, 0, 'existing authenticated GitHub CLI required');
const headers = { authorization: `Bearer ${auth.stdout.trim()}`, 'content-type': 'application/json',
  'x-os1-device-id': `model-eligibility:${randomUUID()}` };
const capabilities = await (await fetch(config.api_url + '/v1/capabilities')).json();
assert.equal(capabilities.model_availability_schema, 1);
const codex = inventory.codex, claude = inventory.claude;
assert(codex.length && claude.length, 'this matrix requires a host with both native inventories');
const daybreak = codex.filter(row => row.slug === 'gpt-daybreak-blue-latest');
const cases = [
  ['both', codex, claude, 'auto', true],
  ['codex-without-daybreak', codex.filter(row => !row.slug.includes('daybreak')), [], 'codex', true],
  ...(daybreak.length ? [['daybreak-only', daybreak, [], 'codex', true]] : []),
  ['claude-without-fable', [], claude.filter(row => row.model !== 'fable'), 'claude', true],
  ['codex-only', codex, [], 'auto', true],
  ['claude-only', [], claude, 'auto', true],
  ['neither', [], [], 'auto', false],
  ['unmapped-effort', [], [{ model: 'sonnet', supported_efforts: ['low'] }], 'claude', false],
];
const results = [];
for (const [label, cx, cl, preference, eligible] of cases) {
  const task = 'Reply with exactly MODEL_INVENTORY_OK. Do not use tools or modify any files.';
  const started = performance.now();
  const response = await fetch(config.api_url + '/v1/executions', { method: 'POST', headers,
    body: JSON.stringify({ task, provider_preference: preference, capacity_plan: { codex: 30, claude: 100 },
      executor_contract_version: config.executor_contract.version, executor_contract_sha256: config.executor_contract.sha256,
      available_codex_models: cx, execution_context: { input_utf8_bytes: 2000, source_utf8_bytes: 0, history_utf8_bytes: 0,
        available_claude_models: cl, completion_feedback: { schema: 1,
          objective_sha256: createHash('sha256').update(task).digest('hex'), observations: [] } } }) });
  assert.equal(response.status, 200, label);
  const reply = await response.json();
  if (!eligible) {
    assert.equal(reply.status, 'failed', label);
    results.push({ label, status: 'PASS', result: 'no eligible tuple; no inference', milliseconds: Math.round(performance.now() - started) });
    continue;
  }
  const profile = config.execution_profiles[reply.action];
  assert(profile, label);
  assert.equal(reply.provider, profile.provider);
  if (preference !== 'auto') assert.equal(reply.provider, preference);
  const permitted = profile.provider === 'codex'
    ? cx.some(row => row.slug === profile.model && row.supported_efforts.includes(profile.effort))
    : cl.some(row => row.model === profile.model && row.supported_efforts.includes(profile.effort));
  assert(permitted, label + ': selected tuple was absent from current inventory');
  results.push({ label, status: 'PASS', provider: profile.provider, model: profile.model, effort: profile.effort,
    milliseconds: Math.round(performance.now() - started) });
}
const report = { at: new Date().toISOString(), capabilities, modelCalls: 0, routeOnly: true,
  accountScope: 'Current host; restricted-inventory fixtures are not separate paid test accounts', results };
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(report));
