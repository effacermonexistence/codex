import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import bridge, { readContract, systemFragment } from './index.mjs';

const digest = s => createHash('sha256').update(s).digest('hex');
const request = 'Delegate only the approved read-only task.';
const policy = 'RCC source-bound projection; unverified outputs remain candidates.';
const contract = () => ({
  schema: 1, run_id: 'fixture-run', session_id: 'fixture-session',
  request_sha256: digest(request), policy_source_sha256: digest('fixture-source'),
  policy_sha256: digest(policy), policy,
  state: { objective: 'read state', stage: 'plan', eligible_candidate_ids: ['codex-fixture'], quality_claim: 'unverified' }
});

async function fixture(t, value = contract()) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-openclaw-bridge-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'contract.json');
  const receipt = join(dir, 'gate-receipt.json');
  const bytes = JSON.stringify(value);
  await writeFile(file, bytes, { mode: 0o600 });
  await chmod(file, 0o600);
  return { file, receipt, hash: digest(bytes), env: { OS1_AGENT_CONTRACT_PATH: file, OS1_AGENT_CONTRACT_SHA256: digest(bytes), OS1_AGENT_GATE_RECEIPT_PATH: receipt } };
}
function registered() {
  const hooks = new Map(); const tools = [];
  bridge.register({
    on: (name, handler) => hooks.set(name, handler),
    registerTool: (tool, opts) => tools.push({ tool, opts })
  });
  return { hooks, tools };
}

test('exact host contract + system lane + read-only tool; no executor tools', async t => {
  const f = await fixture(t); Object.assign(process.env, f.env);
  const { hooks, tools } = registered();
  assert.deepEqual([...hooks.keys()], ['before_prompt_build', 'before_agent_run', 'before_tool_call']);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].tool.name, 'os1_state_read');
  assert.equal(tools[0].opts.optional, true);
  const injected = await hooks.get('before_prompt_build')();
  assert.deepEqual(injected.toolsAllow, ['os1_state_read']);
  assert.equal(injected.appendSystemContext, systemFragment(contract()));
  assert.equal((await hooks.get('before_agent_run')({ prompt: request, systemPrompt: 'base\n' + injected.appendSystemContext })).outcome, 'pass');
  const gate = JSON.parse(await readFile(f.receipt, 'utf8'));
  assert.equal(gate.gate, 'before_agent_run_passed');
  assert.equal(gate.contract_sha256, f.hash);
  assert.equal(gate.model_invoked, false);
  assert.equal((await hooks.get('before_agent_run')({ prompt: request, systemPrompt: injected.appendSystemContext })).outcome, 'pass');
  assert.equal((await hooks.get('before_agent_run')({ prompt: request, systemPrompt: 'base only' })).outcome, 'block');
  assert.equal((await hooks.get('before_agent_run')({ prompt: 'different', systemPrompt: injected.appendSystemContext })).outcome, 'block');
  assert.equal((await hooks.get('before_tool_call')({ toolName: 'exec' })).block, true);
  assert.equal(await hooks.get('before_tool_call')({ toolName: 'os1_state_read' }), undefined);
  const reply = await tools[0].tool.execute('tool-call', {}, new AbortController().signal);
  assert.deepEqual(Object.keys(reply.details).sort(),
    ['run_id', 'session_id', 'request_sha256', 'policy_sha256', 'objective', 'stage', 'eligible_candidate_ids', 'quality_claim'].sort());
  assert.equal(reply.details.quality_claim, 'unverified');
});

test('contract mutation and absent policy fail closed before a model run', async t => {
  const f = await fixture(t); Object.assign(process.env, f.env);
  const { hooks } = registered();
  assert.equal((await hooks.get('before_agent_run')({ prompt: request, systemPrompt: systemFragment(contract()) })).outcome, 'pass');
  await writeFile(f.file, JSON.stringify({ ...contract(), policy: 'changed' })); await chmod(f.file, 0o600);
  assert.rejects(readContract(f.env));
  assert.equal((await hooks.get('before_agent_run')({ prompt: request, systemPrompt: systemFragment(contract()) })).outcome, 'block');
  assert.equal((await hooks.get('before_tool_call')({ toolName: 'os1_state_read' })).block, true);
});

test('invalid, symlink, non-private, or injected state is never admitted', async t => {
  const f = await fixture(t);
  const link = join(f.file, '..', 'link.json');
  const { symlink } = await import('node:fs/promises');
  await symlink(f.file, link);
  await assert.rejects(readContract({ ...f.env, OS1_AGENT_CONTRACT_PATH: link }));
  await chmod(f.file, 0o644);
  await assert.rejects(readContract(f.env));
  await chmod(f.file, 0o600);
  const changed = { ...contract(), state: { ...contract().state, quality_claim: 'verified' } };
  await writeFile(f.file, JSON.stringify(changed)); await chmod(f.file, 0o600);
  await assert.rejects(readContract({ ...f.env, OS1_AGENT_CONTRACT_SHA256: digest(JSON.stringify(changed)) }));
});
