import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chmod, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {verifyExactExplicitArithmetic} from './rcc-plugin.mjs';

async function fixture(t) {
  const stateDir = await mkdtemp(join(tmpdir(), 'os1-rcc-exact-verify-'));
  await chmod(stateDir, 0o700);
  await mkdir(join(stateDir, 'native-receipts'), {mode: 0o700});
  t.after(async () => { await rm(stateDir, {recursive: true, force: true}); });
  // GPT is no longer an explicit route (2026-10-13): four native routes.
  const routes = [
    {surface: 'codex', instruction: '1+1'},
    {surface: 'codex', instruction: '2+2'},
    {surface: 'claude-chat', instruction: '3+3'},
    {surface: 'claude', instruction: '4+4'}];
  const task = {task_id: 'task-' + randomUUID(), mode: 'explicit_routing_test',
    host_context: {explicit_routes: routes}};
  const plan = {nodes: []}, children = [];
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i], id = `route-${i + 1}`, candidate = `cfg-${i + 1}`;
    const config = {surface: route.surface,
      transport: route.surface === 'chatgpt' ? 'chatgpt_service' :
        route.surface === 'codex' ? 'codex_app_server' : 'claude_cli',
      account_id: 'account-' + i, model: 'model-' + i, effort: 'medium', tools: [],
      scope: 'read_only', permission_profile: 'read_only',
      quota_pool: route.surface === 'chatgpt' ? 'openai_chat' :
        route.surface === 'codex' ? 'openai_codex' : 'anthropic_shared',
      allowed_paths: [], configuration_sha256: 'a'.repeat(64)};
    const attempt = randomUUID();
    const receiptPath = join(stateDir, 'native-receipts', randomUUID() + '.json');
    const output = String((i + 1) * 2);
    const record = {schema: 1, task_id: task.task_id, node_id: id,
      attempt_id: attempt, candidate_id: candidate,
      configuration_sha256: config.configuration_sha256,
      selected_config: config, acknowledged_config: config, observed_config: null,
      status: 'succeeded', dispatch_stage: 'dispatched', execution_verified: true,
      task_verified: false, task_quality: 'execution_only', side_effects: 'none',
      parity_state: 'unverified', output, native_receipt: receiptPath};
    await writeFile(receiptPath, JSON.stringify(record), {flag: 'wx', mode: 0o600});
    plan.nodes.push({id, instruction: route.instruction, kind: 'agent',
      dependencies: [], candidate_id: candidate});
    children.push({id, instruction: route.instruction, state: 'completed',
      attempt_id: attempt, candidate_id: candidate, selected_config: config,
      execution_verified: true, task_quality: 'execution_only',
      output, native_receipt: receiptPath});
  }
  return {stateDir, task, plan, children};
}

test('exact four-route arithmetic accepts actual private native receipts, never parity', async t => {
  const x = await fixture(t);
  const verdict = await verifyExactExplicitArithmetic(x, {stateDir: x.stateDir});
  assert.equal(verdict.task_verified, true);
  assert.equal(verdict.parity_state, 'unverified');
  assert.equal(verdict.output, 'route-1: 2\n\nroute-2: 4\n\nroute-3: 6\n\nroute-4: 8');
  assert.equal(verdict.reason, 'exact_explicit_route_arithmetic_receipts');
});

test('general or ambiguous request is never promoted by the exact verifier', async t => {
  const x = await fixture(t);
  x.task.mode = 'auto';
  assert.equal((await verifyExactExplicitArithmetic(x, {stateDir: x.stateDir})).task_verified, false);
  x.task.mode = 'explicit_routing_test';
  x.plan.nodes[0].instruction = '1+1?';
  const verdict = await verifyExactExplicitArithmetic(x, {stateDir: x.stateDir});
  assert.equal(verdict.task_verified, false); assert.equal(verdict.output, null);
});

test('missing, substituted, altered or symlinked native evidence never verifies', async t => {
  const x = await fixture(t);
  x.children[0].output = '3';
  assert.equal((await verifyExactExplicitArithmetic(x, {stateDir: x.stateDir})).task_verified, false);
  x.children[0].output = '2';
  x.children[0].selected_config = {...x.children[0].selected_config, surface: 'gpt-chat'};
  assert.equal((await verifyExactExplicitArithmetic(x, {stateDir: x.stateDir})).task_verified, false);
  x.children[0].selected_config = {...x.children[0].selected_config, surface: 'codex'};
  const path = x.children[0].native_receipt;
  const altered = JSON.parse(await readFile(path, 'utf8'));
  altered.output = 'wrong';
  await writeFile(path, JSON.stringify(altered), {mode: 0o600});
  assert.equal((await verifyExactExplicitArithmetic(x, {stateDir: x.stateDir})).task_verified, false);
  altered.output = '2';
  await writeFile(path, JSON.stringify(altered), {mode: 0o600});
  const external = join(x.stateDir, 'external.json');
  await writeFile(external, JSON.stringify(altered), {mode: 0o600});
  await unlink(path); await symlink(external, path);
  assert.equal((await verifyExactExplicitArithmetic(x, {stateDir: x.stateDir})).task_verified, false);
});

test('plan cannot nominate one of four answers as the parent proof', async t => {
  const x = await fixture(t); x.plan.final_node_id = x.plan.nodes[0].id;
  assert.equal((await verifyExactExplicitArithmetic(x, {stateDir: x.stateDir})).task_verified, false);
});

test('a GPT route in the host contract is dropped, not required, by the exact verifier', async t => {
  const x = await fixture(t);
  x.task.host_context.explicit_routes = [{surface: 'chatgpt', instruction: '0+0'},
    ...x.task.host_context.explicit_routes];
  const verdict = await verifyExactExplicitArithmetic(x, {stateDir: x.stateDir});
  assert.equal(verdict.task_verified, true);
  assert.equal(verdict.reason, 'exact_explicit_route_arithmetic_receipts');
});
