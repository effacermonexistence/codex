import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile, readFile, symlink, link } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { createRCCRuntime, hostContextFingerprint } from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-rcc-runtime-fixture-'));
  await chmod(dir, 0o700);
  t.after(async () => { await rm(dir, {recursive: true, force: true}); });
  return dir;
}
function task(dir, request, mode = 'auto', extras = {}) {
  const policyText = 'RCC fixture policy: candidates do not grant authority.';
  const host = {workspace: dir, context: null, provider_preference: 'auto',
    codex_session_id: extras.codexSession ?? null, claude_session_id: extras.claudeSession ?? null,
    require_read_only: extras.write !== true, owner_policy: null};
  host.provider_preference = extras.provider ?? 'auto';
  if (extras.explicitRoutes !== undefined) host.explicit_routes = extras.explicitRoutes;
  if (extras.conversationID !== undefined) host.conversation_id = extras.conversationID;
  if (extras.submissionID !== undefined) host.submission_id = extras.submissionID;
  return {schema: 1, task_id: 'task-' + randomUUID(), request, request_sha256: sha(request),
    objective: extras.objective ?? request, policy_sha256: sha(policyText),
    source_fingerprint: hostContextFingerprint(host), mode, material_refs: extras.materialRefs ?? [],
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 60_000},
    host_context: host,
    policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policyText), text: policyText}};
}
function candidate(id, surface = 'codex', pool = 'openai_codex', options = {}) {
  const now = Date.now();
  const transport = options.transport ?? ({chatgpt: 'chatgpt_service', 'gpt-chat': 'codex_app_server',
    codex: 'codex_app_server', 'claude-chat': 'claude_cli', claude: 'claude_cli', local: 'local'}[surface]);
  const scope = options.scope ?? 'read_only';
  return {id, surface, transport, account_id: options.account ?? 'account-1',
    model: options.model ?? 'fixture-model', effort: options.effort ?? 'medium',
    tools: options.tools ?? [], scope, permission_profile: scope, quota_pool: pool,
    allowed_paths: options.allowedPaths ?? [], configuration_sha256: sha('config:' + id),
    availability: options.availability ?? 'available',
    availability_observed_at_ms: now - 100, availability_valid_until_ms: now + 30_000,
    quota_remaining_fraction: pool === 'none' ? null :
      (options.quota === undefined ? 0.7 : options.quota),
    quota_observed_at_ms: pool === 'none' ? null : now - 100,
    quota_valid_until_ms: pool === 'none' ? null : now + 30_000,
    quality_state: 'policy_admitted', estimated_cost_units: 1};
}
const catalog = (task, candidates) => ({schema: 1, task_id: task.task_id,
  request_sha256: task.request_sha256, candidates});
const node = (id, candidateID, options = {}) => ({id, instruction: options.instruction ?? 'Do one bounded task',
  dependencies: options.dependencies ?? [], kind: options.kind ?? 'agent', candidate_id: candidateID,
  scope: options.scope ?? 'read_only', owned_paths: options.ownedPaths ?? [], context_refs: []});
const plan = (task, nodes) => ({schema: 1, task_id: task.task_id,
  request_sha256: task.request_sha256, nodes});
function execution(ticket, overrides = {}) {
  return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id,
    attempt_id: ticket.attempt_id, candidate_id: ticket.candidate_id,
    configuration_sha256: ticket.configuration_sha256,
    selected_config: ticket.selected_config,
    acknowledged_config: ticket.selected_config,
    observed_config: null, status: 'succeeded', dispatch_stage: 'dispatched',
    side_effects: 'none', output: `${ticket.node_id} returned`,
    execution_verified: true, task_verified: true, task_quality: 'task_verified',
    parity_state: 'unverified', native_receipt: '/private/fixture/receipt-' + ticket.attempt_id,
    usage: {input_tokens: 4, output_tokens: 2},
    native_summary: JSON.stringify({node: ticket.node_id, provider: ticket.selected_config.surface}),
    ...overrides};
}
async function handbackExecution(stateDir, ticket, {kind = 'full_access_required',
  adoption = 'returned', output = 'Initial bounded work finished; one step remains',
  nativeSessionID = randomUUID(), sourceRoot = realpathSync(stateDir),
  sourceHead = 'a'.repeat(40), protectedSHA = 'b'.repeat(64),
  tamperReceipt = false} = {}) {
  const directory = join(stateDir, 'native-receipts');
  await mkdir(directory, {recursive: true, mode: 0o700});
  await chmod(directory, 0o700);
  const path = join(directory, randomUUID() + '.json');
  const record = execution(ticket, {task_verified: false, task_quality: 'execution_only',
    output, native_receipt: path, native_summary: JSON.stringify({native: 'verified', output}),
    side_effects: 'none', handback: {kind, native_session_id: nativeSessionID,
      protected_root: sourceRoot, source_head: sourceHead,
      protected_source_sha256: protectedSHA, source_fingerprint: ticket.source_fingerprint,
      request_sha256: ticket.request_sha256, parent_attempt_id: ticket.attempt_id,
      exit_code: 0, cancelled: false, adoption}});
  await writeFile(path, JSON.stringify(tamperReceipt ? {...record, output: 'tampered'} : record),
    {flag: 'wx', mode: 0o600});
  return record;
}
async function continuationExecution(stateDir, ticket, overrides = {}) {
  const directory = join(stateDir, 'native-receipts');
  await mkdir(directory, {recursive: true, mode: 0o700});
  await chmod(directory, 0o700);
  const path = join(directory, randomUUID() + '.json');
  const record = execution(ticket, {task_verified: false, task_quality: 'execution_only',
    output: 'The blocked step returned', native_receipt: path,
    native_summary: JSON.stringify({native: 'continuation', attempt: ticket.attempt_id}),
    ...overrides});
  await writeFile(path, JSON.stringify(record), {flag: 'wx', mode: 0o600});
  return record;
}
async function repairExecution(stateDir, ticket, overrides = {}) {
  return continuationExecution(stateDir, ticket, {side_effects: 'confirmed', output: 'Verified native source repair',
    repair_source: {source_root: realpathSync(ticket.host_context.workspace), source_head: 'c'.repeat(40),
      source_before_head: ticket.continuation?.source_head ?? 'a'.repeat(40),
      source_before_sha256: ticket.continuation?.protected_source_sha256 ?? 'b'.repeat(64),
      protected_source_sha256: 'd'.repeat(64), source_before_clean: true,
      changed_paths: ['products/os1-mac-runtime/Sources/OS1App/OS1App.swift']}, ...overrides});
}
function installHandoff(request, stage, overrides = {}) {
  const source = stage.source ?? {source_root: realpathSync(request.host_context.workspace),
    source_head: 'c'.repeat(40), protected_source_sha256: 'd'.repeat(64)};
  return {schema: 1, task_id: request.task_id, request_sha256: request.request_sha256,
    node_id: stage.ticket.node_id, parent_attempt_id: stage.ticket.attempt_id,
    source_fingerprint: request.source_fingerprint, source_root: source.source_root,
    source_head: source.source_head, protected_source_sha256: source.protected_source_sha256,
    staged_intent_id: 'stage-' + randomUUID(), staged_receipt_sha256: 'e'.repeat(64),
    state: 'staged', installed_receipt: null, ...overrides};
}
const taskVerdict = ({task, children}) => ({schema: 1, task_id: task.task_id,
  task_verified: children.every(c => c.state === 'completed'),
  output: children.map(c => c.output).join('\n'), parity_state: 'unverified',
  reason: 'fixture_deterministic_coverage'});
const wait = (runtime, task) => runtime.wait({schema: 1, task_id: task.task_id}, {timeoutMs: 10_000});

test('trusted same-owner full-access handback preserves initial rejected output and only returns unverified', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Continue one blocked workspace operation', 'auto', {write: true});
  const row = candidate('claude-write', 'claude', 'anthropic_shared',
    {scope: 'workspace_write', allowedPaths: ['**']});
  let initialAttempt = null; let continuationCalls = 0;
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, [row]),
    plan: async () => plan(request, [node('one', row.id,
      {scope: 'workspace_write', ownedPaths: ['**']})]),
    execute: async ticket => { initialAttempt = ticket.attempt_id;
      return handbackExecution(dir, ticket, {adoption: 'rejected', output: 'Rejected but executed original'}); },
    executeContinuation: async ticket => {
      continuationCalls++;
      assert.equal(ticket.continuation.kind, 'full_access_required');
      assert.equal(ticket.continuation.parent_attempt_id, initialAttempt);
      assert.equal(ticket.native_resume_session_id, ticket.continuation.native_session_id);
      assert.equal(ticket.continuation.protected_root, realpathSync(dir));
      assert.match(ticket.continuation.parent_native_receipt_sha256, /^[a-f0-9]{64}$/);
      return continuationExecution(dir, ticket, {output: 'Continued result'});
    }});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const answer = await wait(runtime, request);
  assert.equal(answer.state, 'returned_unverified');
  assert.equal(continuationCalls, 1);
  assert.match(answer.result.output, /Rejected but executed original/);
  assert.match(answer.result.output, /Continued result/);
  assert.equal(answer.result.task_verified, false);
  assert.equal(answer.result.parity_state, 'unverified');
  const privateChild = runtime._load(request.task_id).children[0];
  assert.equal(privateChild.continuation.state, 'returned');
  assert.equal(privateChild.continuation_history.length, 2);
  assert.equal(privateChild.continuation_history[0].adoption, 'rejected');
  assert.equal(privateChild.native_summaries.length, 2);
});

test('marker prose, missing continuation executor and forged native receipt cannot elevate authority', async t => {
  const dir = await fixture(t);
  const row = candidate('claude-write', 'claude', 'anthropic_shared',
    {scope: 'workspace_write', allowedPaths: ['**']});
  const create = async (name, execute, executeContinuation) => {
    const request = task(dir, name, 'auto', {write: true});
    let forwarded = 0;
    const runtime = await createRCCRuntime({stateDir: join(dir, randomUUID()),
      catalog: async value => catalog(value, [row]),
      plan: async () => plan(request, [node('one', row.id,
        {scope: 'workspace_write', ownedPaths: ['**']})]),
      execute: ticket => execute(ticket, runtime.stateDir),
      executeContinuation: executeContinuation && (async ticket => {
        forwarded++; return executeContinuation(ticket, runtime.stateDir);
      })});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request);
    return {answer: await wait(runtime, request), forwarded};
  };
  const prose = await create('Prose marker is no authority',
    ticket => execution(ticket, {task_verified: false, task_quality: 'execution_only',
      output: '[OS1_FULL_ACCESS_REQUIRED]'}), async () => { throw Error('must not continue'); });
  assert.equal(prose.answer.state, 'returned_unverified'); assert.equal(prose.forwarded, 0);
  const missing = await create('No continuation callback must hold',
    (ticket, stateDir) => handbackExecution(stateDir, ticket), null);
  assert.equal(missing.answer.state, 'held');
  assert.equal(missing.answer.error, 'continuation_executor_unavailable');
  const forged = await create('Receipt content altered',
    (ticket, stateDir) => handbackExecution(stateDir, ticket, {tamperReceipt: true}),
    async () => { throw Error('must not continue'); });
  assert.equal(forged.answer.state, 'held'); assert.equal(forged.forwarded, 0);
  assert.equal(forged.answer.error, 'handback_receipt_content_invalid');
});

test('both handbacks stay one owner, full-access then source-bound repair, with distinct native session posture', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Repair this authorized source-bound task', 'auto', {write: true});
  request.budget.max_attempts = 3;
  const row = candidate('claude-write', 'claude', 'anthropic_shared',
    {scope: 'workspace_write', allowedPaths: ['**']});
  const phases = [];
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, [row]),
    plan: async () => plan(request, [node('one', row.id,
      {scope: 'workspace_write', ownedPaths: ['**']})]),
    execute: ticket => handbackExecution(dir, ticket, {kind: 'both', nativeSessionID: 'native-source-session'}),
    executeContinuation: async ticket => {
      phases.push(ticket.continuation.kind);
      if (ticket.continuation.kind === 'full_access_required') {
        assert.equal(ticket.native_resume_session_id, 'native-source-session');
        return handbackExecution(dir, ticket, {kind: 'os1_change_required',
          nativeSessionID: 'native-source-session', output: 'Full access stage returned'});
      }
      assert.equal(ticket.continuation.kind, 'os1_change_required');
      assert.equal(ticket.native_resume_session_id, null, 'repair is a fresh native session');
      assert.equal(ticket.continuation.native_session_id, 'native-source-session');
      return continuationExecution(dir, ticket, {output: 'Source-bound repair returned'});
    }});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const answer = await wait(runtime, request);
  assert.equal(answer.state, 'returned_unverified');
  assert.deepEqual(phases, ['full_access_required', 'os1_change_required']);
  assert.equal(answer.children.length, 1);
  assert.equal(answer.result.task_verified, false);
  assert.match(answer.result.output, /Source-bound repair returned/);
  assert.equal(runtime._load(request.task_id).children[0].continuation_history.length, 3);
  assert.equal(answer.result.native_summaries.length, 3);
});

test('continuation budget and source-scope gates hold before another dispatch', async t => {
  const dir = await fixture(t);
  const row = candidate('claude-write', 'claude', 'anthropic_shared',
    {scope: 'workspace_write', allowedPaths: ['**']});
  const budgetTask = task(dir, 'Two-phase repair must fit budget', 'auto', {write: true});
  let budgetCalls = 0;
  const budget = await createRCCRuntime({stateDir: join(dir, 'budget'),
    catalog: async value => catalog(value, [row]),
    plan: async () => plan(budgetTask, [node('one', row.id,
      {scope: 'workspace_write', ownedPaths: ['**']})]),
    execute: ticket => handbackExecution(join(dir, 'budget'), ticket,
      {kind: 'both', sourceRoot: realpathSync(dir)}),
    executeContinuation: async ticket => { budgetCalls++;
      return handbackExecution(join(dir, 'budget'), ticket,
        {kind: 'os1_change_required', sourceRoot: realpathSync(dir),
          nativeSessionID: ticket.continuation.native_session_id});
    }});
  t.after(async () => { await budget.close(); });
  await budget.submit(budgetTask);
  const budgetEnd = await wait(budget, budgetTask);
  assert.equal(budgetEnd.state, 'held');
  assert.equal(budgetEnd.error, 'continuation_attempt_budget_exhausted');
  assert.equal(budgetCalls, 1);

  const externalWorkspace = join(dir, 'external-workspace');
  await mkdir(externalWorkspace);
  const wrongScope = task(externalWorkspace, 'Model marker cannot grant source write', 'auto', {write: true});
  let scopeCalls = 0;
  const stateDir = join(dir, 'scope-state');
  const scope = await createRCCRuntime({stateDir,
    catalog: async value => catalog(value, [row]),
    plan: async () => plan(wrongScope, [node('one', row.id,
      {scope: 'workspace_write', ownedPaths: ['**']})]),
    execute: ticket => handbackExecution(stateDir, ticket,
      {kind: 'os1_change_required', sourceRoot: realpathSync(stateDir)}),
    executeContinuation: async () => { scopeCalls++; throw Error('must not dispatch'); }});
  t.after(async () => { await scope.close(); });
  await scope.submit(wrongScope);
  const scopeEnd = await wait(scope, wrongScope);
  assert.equal(scopeEnd.state, 'held');
  assert.equal(scopeEnd.error, 'os1_repair_original_workspace_not_authorized');
  assert.equal(scopeCalls, 0);
});

test('crash before or after continuation dispatch never replays the original native write',
  {timeout: 15_000}, async t => {
    const moduleURL = new URL('../../Resources/openclaw-os1-bridge/rcc-runtime.mjs', import.meta.url).href;
    const childScript = `
      import {randomUUID} from 'node:crypto';
      import {mkdir,writeFile} from 'node:fs/promises';
      import {realpathSync} from 'node:fs';
      import {join} from 'node:path';
      const {createRCCRuntime}=await import(process.argv[1]);
      const data=JSON.parse(process.env.RCC_FIXTURE_INPUT);
      let catalogCalls=0;
      const r=await createRCCRuntime({stateDir:process.argv[2],
        catalog:async()=>{
          catalogCalls++;
          if(data.mode==='pending' && catalogCalls===3){
            process.stdout.write('CONTINUATION_PENDING\\n'); await new Promise(()=>{});
          }
          return data.catalog;
        },
        plan:async()=>data.plan,
        execute:async ticket=>{
          const receipts=join(process.argv[2],'native-receipts');
          await mkdir(receipts,{recursive:true,mode:0o700});
          const path=join(receipts,randomUUID()+'.json');
          const result={schema:1,task_id:ticket.task_id,node_id:ticket.node_id,
            attempt_id:ticket.attempt_id,candidate_id:ticket.candidate_id,
            configuration_sha256:ticket.configuration_sha256,
            selected_config:ticket.selected_config,acknowledged_config:ticket.selected_config,
            observed_config:null,status:'succeeded',dispatch_stage:'dispatched',
            side_effects:'none',output:'Original native output',execution_verified:true,
            task_verified:false,task_quality:'execution_only',parity_state:'unverified',
            native_receipt:path,usage:null,native_summary:'{"native":"original"}',
            handback:{kind:'full_access_required',native_session_id:'native-session',
              protected_root:realpathSync(process.argv[2]),source_head:'a'.repeat(40),
              protected_source_sha256:'b'.repeat(64),source_fingerprint:ticket.source_fingerprint,
              request_sha256:ticket.request_sha256,parent_attempt_id:ticket.attempt_id,
              exit_code:0,cancelled:false,adoption:'rejected'}};
          await writeFile(path,JSON.stringify(result),{flag:'wx',mode:0o600});
          return result;
        },
        executeContinuation:async()=>{
          process.stdout.write('CONTINUATION_DISPATCHED\\n'); await new Promise(()=>{});
        }});
      await r.submit(data.task); setInterval(()=>{},1000);
    `;
    for (const mode of ['pending', 'dispatched']) {
      const dir = await fixture(t);
      const request = task(dir, 'Crash boundary ' + mode, 'auto', {write: true});
      const row = candidate('claude-write', 'claude', 'anthropic_shared',
        {scope: 'workspace_write', allowedPaths: ['**']});
      const child = spawn(process.execPath, ['--input-type=module', '-e', childScript, moduleURL, dir],
        {env: {...process.env, RCC_FIXTURE_INPUT: JSON.stringify({task: request, mode,
          catalog: catalog(request, [row]), plan: plan(request, [node('one', row.id,
            {scope: 'workspace_write', ownedPaths: ['**']})])})},
         stdio: ['ignore', 'pipe', 'pipe']});
      const expected = mode === 'pending' ? 'CONTINUATION_PENDING' : 'CONTINUATION_DISPATCHED';
      const ready = new Promise((resolve, reject) => {
        let out = ''; let err = ''; let timer;
        child.stdout.on('data', bytes => { out += bytes.toString();
          if (out.includes(expected)) { clearTimeout(timer); resolve(); } });
        child.stderr.on('data', bytes => { err += bytes.toString(); });
        child.once('exit', code => { clearTimeout(timer);
          reject(Error('child_exited_before_boundary:' + code + ':' + err.slice(-300))); });
        timer = setTimeout(() => { child.kill('SIGKILL');
          reject(Error('boundary_timeout:' + mode + ':' + out.slice(-300) + ':' + err.slice(-300))); }, 3000);
        timer.unref();
      });
      await ready; child.kill('SIGKILL'); await once(child, 'exit');
      let replay = 0;
      const restored = await createRCCRuntime({stateDir: dir,
        execute: async () => { replay++; throw Error('original must never replay'); },
        executeContinuation: async () => { replay++; throw Error('continuation must never replay'); }});
      t.after(async () => { await restored.close(); });
      const end = restored.status({schema: 1, task_id: request.task_id});
      assert.equal(end.state, mode === 'pending' ? 'held' : 'effects_uncertain');
      assert.equal(end.error, mode === 'pending' ? 'continuation_pending_recovery_required' :
        'restart_active_dispatch_no_replay');
      assert.equal(replay, 0);
      assert.match(restored._load(request.task_id).children[0].output, /Original native output/);
    }
  });

test('plain arithmetic is exact and zero-model; explicit routing test never shortcuts', async t => {
  const dir = await fixture(t);
  let calls = 0;
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async () => { calls++; throw Error('should not call'); }});
  t.after(async () => { await runtime.close(); });
  const simple = task(dir, '1+1');
  await runtime.submit(simple);
  const solved = await wait(runtime, simple);
  assert.equal(solved.state, 'completed'); assert.equal(solved.result.output, '2');
  assert.equal(solved.result.parity_state, 'unverified'); assert.equal(calls, 0);
  const explicit = task(dir, '1+1', 'explicit_routing_test');
  await runtime.submit(explicit);
  assert.equal((await wait(runtime, explicit)).state, 'held'); assert.equal(calls, 0);
  const ambiguous = task(dir, '1+1 and route it');
  await runtime.submit(ambiguous);
  assert.equal((await wait(runtime, ambiguous)).state, 'held');
  assert.equal(calls, 1);
  await assert.rejects(runtime.submit(task(dir, '너 되냐?', 'auto',
    {explicitRoutes: [{surface: 'chatgpt', instruction: '너 되냐?'}]})), /host_context_invalid/);
  const topLevelExplicit = task(dir, '1+1');
  topLevelExplicit.provider_preference = 'codex';
  await runtime.submit(topLevelExplicit);
  assert.equal((await wait(runtime, topLevelExplicit)).state, 'held');
  assert.equal(calls, 2, 'an explicit top-level provider never takes the local fast path');
});

test('exact local liveness check-in records one child; delegated/provider/attachment variants route normally', async t => {
  const dir = await fixture(t); let catalogCalls = 0, planCalls = 0, executeCalls = 0;
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async () => { catalogCalls++; throw Error('no catalog fixture'); },
    plan: async () => { planCalls++; throw Error('must not plan check-in'); },
    execute: async () => { executeCalls++; throw Error('must not execute check-in'); }});
  t.after(async () => { await runtime.close(); });
  for (const phrase of ['야 너 되냐?', '야 체크해봅시다 너 되냐?', '너 되냐?', 'are you working?', 'hello']) {
    const input = task(dir, phrase);
    await runtime.submit(input);
    const answer = await wait(runtime, input);
    assert.equal(answer.state, 'completed');
    assert.equal(answer.children.length, 1);
    assert.equal(answer.children[0].selected_config.surface, 'local');
    assert.equal(answer.result.task_verified, true);
    assert.equal(answer.result.parity_state, 'unverified');
    assert.ok(runtime.events({schema: 1, task_id: input.task_id})
      .some(x => x.kind === 'local_checkin'));
  }
  assert.equal(catalogCalls, 0); assert.equal(planCalls, 0); assert.equal(executeCalls, 0);
  for (const input of [
    task(dir, 'ChatGPT에 너 되냐 보내'),
    task(dir, '너 되냐?', 'auto', {provider: 'codex'}),
    task(dir, '너 되냐?', 'explicit_routing_test'),
    task(dir, '너 되냐?', 'auto', {materialRefs: ['attached-source.png']})]) {
    await runtime.submit(input);
    assert.equal((await wait(runtime, input)).state, 'held');
  }
  assert.equal(catalogCalls, 3); assert.equal(planCalls, 0); assert.equal(executeCalls, 0);
});

test('idempotent submit, exclusive runtime owner and durable event journal', async t => {
  const dir = await fixture(t);
  const runtime = await createRCCRuntime({stateDir: dir});
  const input = task(dir, '1+1');
  const a = await runtime.submit(input), b = await runtime.submit(input);
  assert.equal(a.task_id, b.task_id);
  assert.equal((await wait(runtime, input)).state, 'completed');
  assert.equal(runtime.events({schema: 1, task_id: input.task_id}).filter(x => x.kind === 'submitted').length, 1);
  await assert.rejects(createRCCRuntime({stateDir: dir}), /runtime_owner_active/);
  await assert.rejects(runtime.submit({...input, request: '2+2', request_sha256: sha('2+2')}), /idempotency_conflict/);
  await runtime.close();
  const reopened = await createRCCRuntime({stateDir: dir});
  t.after(async () => { await reopened.close(); });
  assert.equal(reopened.status({schema: 1, task_id: input.task_id}).result.output, '2');
});

test('four explicit route nodes execute; shared Anthropic pool never double-spends', async t => {
  const dir = await fixture(t);
  const rows = [candidate('chat', 'chatgpt', 'openai_chat'),
    candidate('codex', 'codex', 'openai_codex'),
    candidate('claude-chat', 'claude-chat', 'anthropic_shared'),
    candidate('claude-code', 'claude', 'anthropic_shared')];
  const requested = rows.map((row, i) => ({surface: row.surface, instruction: `probe-${i}`}));
  const request = task(dir, 'Route four bounded tasks to four named surfaces',
    'explicit_routing_test', {explicitRoutes: requested});
  const specs = rows.map((row, i) => node('n' + i, row.id, {instruction: `probe-${i}`}));
  let concurrent = 0, peak = 0, anthropic = 0, anthropicPeak = 0, calls = 0;
  const runtime = await createRCCRuntime({stateDir: dir, maximumWorkers: 4,
    catalog: async value => catalog(value, rows), plan: async () => plan(request, specs),
    execute: async ticket => {
      calls++; concurrent++; peak = Math.max(peak, concurrent);
      if (ticket.selected_config.quota_pool === 'anthropic_shared') {
        anthropic++; anthropicPeak = Math.max(anthropicPeak, anthropic);
      }
      await new Promise(resolve => setTimeout(resolve, 40));
      concurrent--;
      if (ticket.selected_config.quota_pool === 'anthropic_shared') anthropic--;
      return execution(ticket);
    }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const result = await wait(runtime, request);
  assert.equal(result.state, 'completed'); assert.equal(result.children.length, 4);
  assert.equal(calls, 4); assert.ok(peak >= 2); assert.equal(anthropicPeak, 1);
  assert.equal(result.result.native_summaries.length, 4);
  assert.equal((await stat(result.result.native_receipt)).isFile(), true);
  assert.ok(result.children.every(child => child.selected_config && child.native_receipt));
});

test('unknown candidate, cycle and independent write conflict hold before execution', async t => {
  const dir = await fixture(t); let executions = 0;
  const choices = [candidate('write', 'codex', 'openai_codex',
    {scope: 'workspace_write', allowedPaths: ['**']})];
  const scenarios = [
    [node('a', 'invented')],
    [node('a', 'write', {scope: 'workspace_write', ownedPaths: ['**'], dependencies: ['b']}),
     node('b', 'write', {scope: 'workspace_write', ownedPaths: ['**'], dependencies: ['a']})],
    [node('a', 'write', {scope: 'workspace_write', ownedPaths: ['**']}),
     node('b', 'write', {scope: 'workspace_write', ownedPaths: ['**']})],
  ];
  for (const specs of scenarios) {
    const request = task(dir, 'Implement a scoped change', 'auto', {write: true});
    const runtime = await createRCCRuntime({stateDir: join(dir, randomUUID()),
      catalog: async value => catalog(value, choices), plan: async () => plan(request, specs),
      execute: async () => { executions++; throw Error('must not dispatch'); }});
    await runtime.submit(request);
    assert.equal((await wait(runtime, request)).state, 'held');
    await runtime.close();
  }
  assert.equal(executions, 0);
});

test('safe not-dispatched feedback replans failed subset to another approved candidate', async t => {
  const dir = await fixture(t); const request = task(dir, 'Read current project status');
  const rows = [candidate('a'), candidate('b')];
  let plans = 0, executions = 0;
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, rows),
    plan: async ({repair}) => { plans++; return plan(request, [node('only', repair ? 'b' : 'a')]); },
    execute: async ticket => {
      executions++;
      if (ticket.candidate_id === 'a') return execution(ticket, {status: 'failed',
        dispatch_stage: 'not_dispatched', side_effects: 'none', output: null,
        execution_verified: false, task_verified: false, task_quality: 'failed',
        native_receipt: '/private/fixture/no-effect-' + ticket.attempt_id,
        acknowledged_config: null, observed_config: null});
      return execution(ticket);
    }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const result = await wait(runtime, request);
  assert.equal(result.state, 'completed'); assert.equal(result.children[0].candidate_id, 'b');
  assert.equal(plans, 2); assert.equal(executions, 2);
  assert.ok(runtime.events({schema: 1, task_id: request.task_id}).some(x => x.kind === 'safe_subset_replanned'));
});

test('dispatched exception becomes effects-uncertain with no replay; restart preserves it', async t => {
  const dir = await fixture(t); const request = task(dir, 'Change a registered file', 'auto', {write: true});
  const row = candidate('writer', 'codex', 'openai_codex', {scope: 'workspace_write', allowedPaths: ['**']});
  let calls = 0;
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, [row]),
    plan: async () => plan(request, [node('write', 'writer', {scope: 'workspace_write', ownedPaths: ['**']})]),
    execute: async () => { calls++; throw Error('transport dropped after dispatch'); },
    verifyTask: taskVerdict});
  await runtime.submit(request);
  const result = await wait(runtime, request);
  assert.equal(result.state, 'effects_uncertain'); assert.equal(calls, 1);
  await runtime.close();
  const next = task(dir, 'Change another file in the same workspace', 'auto', {write: true});
  let replayOrOtherWrite = 0;
  const reopened = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, [row]),
    plan: async ({task: value}) => plan(value, [node('write', 'writer', {scope: 'workspace_write', ownedPaths: ['**']})]),
    execute: async () => { replayOrOtherWrite++; throw Error('uncertain workspace must not run'); }});
  t.after(async () => { await reopened.close(); });
  assert.equal(reopened.status({schema: 1, task_id: request.task_id}).state, 'effects_uncertain');
  await reopened.submit(next);
  assert.equal((await wait(reopened, next)).state, 'held');
  assert.equal(replayOrOtherWrite, 0);
  const separateWorkspace = join(dir, 'other-workspace');
  await mkdir(separateWorkspace, {mode: 0o700});
  const samePool = task(separateWorkspace, 'Change a file in a different checkout', 'auto', {write: true});
  await reopened.submit(samePool);
  const poolHeld = await wait(reopened, samePool);
  assert.equal(poolHeld.state, 'held');
  assert.equal(poolHeld.error, 'quota_pool_effects_uncertain');
  assert.equal(replayOrOtherWrite, 0);
});

test('cancel before dispatch prevents execute; no task verifier returns visible unverified candidate', async t => {
  const dir = await fixture(t); const request = task(dir, 'Summarize this line');
  let release, executions = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => { await gate; return catalog(value, [candidate('a')]); },
    plan: async () => plan(request, [node('one', 'a')]),
    execute: async ticket => { executions++; return execution(ticket); }});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  runtime.cancel({schema: 1, task_id: request.task_id}); release();
  assert.equal((await wait(runtime, request)).state, 'cancelled'); assert.equal(executions, 0);
  const second = task(dir, 'Explain this supplied line');
  const completed = await createRCCRuntime({stateDir: join(dir, randomUUID()),
    catalog: async value => catalog(value, [candidate('a')]),
    plan: async () => plan(second, [node('one', 'a')]), execute: async ticket => execution(ticket)});
  t.after(async () => { await completed.close(); });
  await completed.submit(second);
  const answer = await wait(completed, second);
  assert.equal(answer.state, 'returned_unverified');
  assert.match(answer.result.output, /one returned/);
  assert.equal(answer.result.task_verified, false);
  assert.equal(answer.result.native_summaries.length, 1);
});

test('two write tasks in one canonical workspace serialize even with different quota pools', async t => {
  const dir = await fixture(t);
  const first = task(dir, 'Change registered file A', 'auto', {write: true});
  const second = task(dir, 'Change registered file B', 'auto', {write: true});
  const rows = [candidate('codex-writer', 'codex', 'openai_codex',
    {scope: 'workspace_write', allowedPaths: ['**']}),
    candidate('claude-writer', 'claude', 'anthropic_shared',
      {scope: 'workspace_write', allowedPaths: ['**']})];
  let active = 0, peak = 0;
  const runtime = await createRCCRuntime({stateDir: join(dir, 'state'), maximumWorkers: 4,
    catalog: async value => catalog(value, rows),
    plan: async ({task: value}) => plan(value,
      [node('write', value.task_id === first.task_id ? rows[0].id : rows[1].id,
        {scope: 'workspace_write', ownedPaths: ['**']})]),
    execute: async ticket => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 50)); active--;
      return execution(ticket, {side_effects: 'confirmed'});
    }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await Promise.all([runtime.submit(first), runtime.submit(second)]);
  assert.equal((await wait(runtime, first)).state, 'completed');
  assert.equal((await wait(runtime, second)).state, 'completed');
  assert.equal(peak, 1);
});

test('dependent same-path writers are admitted but never overlap in the original checkout', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Implement then validate the same registered file', 'auto', {write: true});
  const row = candidate('writer', 'codex', 'openai_codex', {scope: 'workspace_write', allowedPaths: ['**']});
  let active = 0, peak = 0, calls = 0;
  const runtime = await createRCCRuntime({stateDir: join(dir, 'state'), maximumWorkers: 4,
    catalog: async value => catalog(value, [row]),
    plan: async () => plan(request, [
      node('implement', row.id, {scope: 'workspace_write', ownedPaths: ['**']}),
      node('validate', row.id, {scope: 'workspace_write', ownedPaths: ['**'], dependencies: ['implement']})]),
    execute: async ticket => {
      active++; calls++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 35)); active--;
      return execution(ticket, {side_effects: 'confirmed'});
    }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const answer = await wait(runtime, request);
  assert.equal(answer.state, 'completed'); assert.equal(calls, 2); assert.equal(peak, 1);
});

test('unknown quota, mismatched observed configuration and active cancellation fail closed', async t => {
  const dir = await fixture(t);
  const unknown = task(dir, 'Inspect available account status');
  let dispatched = 0;
  const noQuota = candidate('quota-unknown', 'codex', 'openai_codex', {quota: null});
  const held = await createRCCRuntime({stateDir: join(dir, 'unknown'),
    catalog: async value => catalog(value, [noQuota]),
    plan: async () => plan(unknown, [node('inspect', noQuota.id)]),
    execute: async () => { dispatched++; throw Error('must not run'); }});
  await held.submit(unknown);
  assert.equal((await wait(held, unknown)).state, 'held'); assert.equal(dispatched, 0);
  await held.close();

  const mismatch = task(dir, 'Inspect a registered file');
  const route = candidate('a');
  const wrong = await createRCCRuntime({stateDir: join(dir, 'wrong-config'),
    catalog: async value => catalog(value, [route]),
    plan: async () => plan(mismatch, [node('one', route.id)]),
    execute: async ticket => execution(ticket, {observed_config: {...ticket.selected_config, model: 'unlisted-model'}}),
    verifyTask: taskVerdict});
  await wrong.submit(mismatch);
  assert.equal((await wait(wrong, mismatch)).state, 'effects_uncertain');
  await wrong.close();

  const cancelling = task(dir, 'Read a slow external status');
  let activeResolve;
  const active = new Promise(resolve => { activeResolve = resolve; });
  const runtime = await createRCCRuntime({stateDir: join(dir, 'cancel-active'),
    catalog: async value => catalog(value, [route]),
    plan: async () => plan(cancelling, [node('one', route.id)]),
    execute: async (ticket, signal) => {
      activeResolve();
      await new Promise(resolve => signal.addEventListener('abort', resolve, {once: true}));
      return execution(ticket, {status: 'failed', dispatch_stage: 'dispatched',
        side_effects: 'possible', output: null, execution_verified: false,
        task_verified: false, task_quality: 'failed', observed_config: null});
    }});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(cancelling); await active;
  assert.equal(runtime.cancel({schema: 1, task_id: cancelling.task_id}).state, 'cancelling');
  assert.equal((await wait(runtime, cancelling)).state, 'effects_uncertain');
});

test('hard crash after dispatch reconciles active attempt as effects_uncertain, never replays',
  {timeout: 10_000}, async t => {
    const dir = await fixture(t);
    const request = task(dir, 'Inspect live task state');
    const row = candidate('a');
    const moduleURL = new URL('../../Resources/openclaw-os1-bridge/rcc-runtime.mjs', import.meta.url).href;
    const childScript = `
      const {createRCCRuntime}=await import(process.argv[1]);
      const data=JSON.parse(process.env.RCC_FIXTURE_INPUT);
      const r=await createRCCRuntime({stateDir:process.argv[2],
        catalog:async()=>data.catalog, plan:async()=>data.plan,
        execute:async()=>{process.stdout.write('DISPATCHED\\n'); await new Promise(()=>{});}});
      await r.submit(data.task); setInterval(()=>{},1000);
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', childScript, moduleURL, dir],
      {env: {...process.env, RCC_FIXTURE_INPUT: JSON.stringify({task: request,
        catalog: catalog(request, [row]), plan: plan(request, [node('one', row.id)])})},
       stdio: ['ignore', 'pipe', 'pipe']});
    const ready = new Promise((resolve, reject) => {
      let out = '';
      child.stdout.on('data', bytes => { out += bytes.toString(); if (out.includes('DISPATCHED')) resolve(); });
      child.once('exit', code => reject(Error('child_exited_before_dispatch:' + code)));
    });
    await ready; child.kill('SIGKILL'); await once(child, 'exit');
    let replayCalls = 0;
    const runtime = await createRCCRuntime({stateDir: dir,
      execute: async () => { replayCalls++; throw Error('must not replay'); }});
    t.after(async () => { await runtime.close(); });
    const result = runtime.status({schema: 1, task_id: request.task_id});
    assert.equal(result.state, 'effects_uncertain'); assert.equal(replayCalls, 0);
    assert.ok(runtime.events({schema: 1, task_id: request.task_id})
      .some(x => x.kind === 'restart_reconciled'));
  });

test('refreshes 120s-style catalog TTL before dependent dispatch and rejects changed exact configuration', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Inspect two dependent pieces of source');
  let catalogReads = 0, executions = 0;
  const runtime = await createRCCRuntime({stateDir: join(dir, 'fresh'),
    catalog: async value => { catalogReads++; return catalog(value, [candidate('a')]); },
    plan: async () => plan(request, [node('first', 'a'), node('second', 'a', {dependencies: ['first']})]),
    execute: async ticket => { executions++; await new Promise(resolve => setTimeout(resolve, 55)); return execution(ticket); },
    verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  assert.equal((await wait(runtime, request)).state, 'completed');
  assert.equal(executions, 2);
  assert.ok(catalogReads >= 3, 'initial plus before both dispatches');

  const changed = task(dir, 'Inspect another dependent source');
  let calls = 0;
  const other = await createRCCRuntime({stateDir: join(dir, 'changed-config'),
    catalog: async value => {
      calls++;
      const row = candidate('a');
      if (calls >= 2) row.model = 'different-model';
      return catalog(value, [row]);
    },
    plan: async () => plan(changed, [node('one', 'a')]),
    execute: async () => { throw Error('changed config must not dispatch'); }});
  t.after(async () => { await other.close(); });
  await other.submit(changed);
  const held = await wait(other, changed);
  assert.equal(held.state, 'held'); assert.equal(held.error, 'candidate_configuration_changed');
});

test('256-candidate catalog preserves latest tail ID; 257 never reaches planner or executor', async t => {
  const dir = await fixture(t), request = task(dir, 'Use the exact latest eligible candidate');
  const rows = Array.from({length: 256}, (_, index) => candidate(`cfg-${index}`));
  let planned = 0, executed = 0;
  const runtime = await createRCCRuntime({stateDir: join(dir, 'accepted'),
    catalog: async value => catalog(value, rows),
    plan: async ({catalog: full}) => {
      planned++; assert.equal(full.candidates.length, 256);
      assert.equal(full.candidates[255].id, 'cfg-255');
      return plan(request, [node('one', 'cfg-255')]);
    },
    execute: async ticket => { executed++; assert.equal(ticket.candidate_id, 'cfg-255');
      return execution(ticket); }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  assert.equal((await wait(runtime, request)).state, 'completed');
  assert.equal(planned, 1); assert.equal(executed, 1);

  const tooMany = task(dir, 'Reject over-cap catalog without truncation');
  const rejected = await createRCCRuntime({stateDir: join(dir, 'rejected'),
    catalog: async value => catalog(value, [...rows, candidate('cfg-256')]),
    plan: async () => { throw Error('must not plan truncated rows'); },
    execute: async () => { throw Error('must not execute truncated rows'); }});
  t.after(async () => { await rejected.close(); });
  await rejected.submit(tooMany);
  const status = await wait(rejected, tooMany);
  assert.equal(status.state, 'held'); assert.equal(status.error, 'catalog_binding_invalid');
});

test('valid native summary beyond 16KiB remains a bounded visible execution-only candidate', async t => {
  const dir = await fixture(t); const request = task(dir, 'Explain supplied technical text');
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, [candidate('a')]),
    plan: async () => plan(request, [node('one', 'a')]),
    execute: async ticket => execution(ticket, {task_verified: false, task_quality: 'execution_only',
      native_summary: JSON.stringify({valid_native_run: 'x'.repeat(20_000)})})});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const output = await wait(runtime, request);
  assert.equal(output.state, 'returned_unverified');
  assert.ok(output.result.native_summary.length > 16_384);
  assert.equal(output.result.native_summaries.length, 1);
  assert.equal(output.result.task_verified, false);
});

test('actual bounded usage is private and durable across restart, never invented from one call', async t => {
  const dir = await fixture(t), request = task(dir, 'Explain one supplied source');
  const observed = {input_tokens: 307, output_tokens: 42, cache_read_tokens: 10,
    provider_calls: 1, duration_ms: 1_230};
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, [candidate('a')]),
    plan: async () => plan(request, [node('one', 'a')]),
    execute: async ticket => execution(ticket,
      {task_verified: false, task_quality: 'execution_only', usage: observed})});
  await runtime.submit(request);
  const publicResult = await wait(runtime, request);
  assert.equal(publicResult.state, 'returned_unverified');
  assert.equal(Object.hasOwn(publicResult.children[0], 'usage'), false);
  assert.equal(Object.hasOwn(publicResult.result, 'usage'), false);
  await runtime.close();
  const reopened = await createRCCRuntime({stateDir: dir});
  t.after(async () => { await reopened.close(); });
  const privateState = reopened._load(request.task_id);
  assert.deepEqual(privateState.children[0].usage, observed);
  assert.deepEqual(privateState.children[0].attempt_history[0].usage, observed);
  assert.ok(reopened.events({schema: 1, task_id: request.task_id})
    .every(event => !Object.hasOwn(event.snapshot.children[0] ?? {}, 'usage')));
});

test('only one full Codex/Claude agent node receives its exact host native resume session', async t => {
  const dir = await fixture(t);
  const codexSession = randomUUID(), claudeSession = randomUUID();
  const scenarios = [
    ['codex', 'codex', 'openai_codex', codexSession],
    ['claude', 'claude', 'anthropic_shared', claudeSession],
    ['gpt-chat', 'gpt-chat', 'openai_codex', null],
    ['claude-chat', 'claude-chat', 'anthropic_shared', null],
    ['chatgpt', 'chatgpt', 'openai_chat', null]];
  for (const [name, surface, pool, expected] of scenarios) {
    const request = task(dir, `Continue one native ${surface} request`, 'auto',
      {codexSession, claudeSession});
    let observed = 'not-called';
    const runtime = await createRCCRuntime({stateDir: join(dir, name),
      catalog: async value => catalog(value, [candidate(name, surface, pool)]),
      plan: async () => plan(request, [node('one', name)]),
      execute: async ticket => {
        observed = ticket.native_resume_session_id;
        assert.equal(ticket.host_context.codex_session_id, codexSession);
        assert.equal(ticket.host_context.claude_session_id, claudeSession);
        return execution(ticket);
      }, verifyTask: taskVerdict});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request);
    assert.equal((await wait(runtime, request)).state, 'completed', name);
    assert.equal(observed, expected, name);
  }
  const wrongProvider = task(dir, 'One Codex task without matching session', 'auto',
    {claudeSession});
  const mismatch = await createRCCRuntime({stateDir: join(dir, 'mismatch'),
    catalog: async value => catalog(value, [candidate('codex')]),
    plan: async () => plan(wrongProvider, [node('one', 'codex')]),
    execute: async ticket => {
      assert.equal(ticket.native_resume_session_id, null);
      return execution(ticket);
    }, verifyTask: taskVerdict});
  t.after(async () => { await mismatch.close(); });
  await mismatch.submit(wrongProvider);
  assert.equal((await wait(mismatch, wrongProvider)).state, 'completed');
});

test('multi-node graph and malformed host session never resume an unapproved native turn', async t => {
  const dir = await fixture(t), codexSession = randomUUID(), claudeSession = randomUUID();
  const multi = task(dir, 'Run two dependent native steps', 'auto', {codexSession, claudeSession});
  const seen = [];
  const runtime = await createRCCRuntime({stateDir: join(dir, 'multi'),
    catalog: async value => catalog(value, [candidate('codex'),
      candidate('claude', 'claude', 'anthropic_shared')]),
    plan: async () => plan(multi, [node('first', 'codex'),
      node('second', 'claude', {dependencies: ['first']})]),
    execute: async ticket => { seen.push(ticket.native_resume_session_id); return execution(ticket); },
    verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(multi);
  assert.equal((await wait(runtime, multi)).state, 'completed');
  assert.deepEqual(seen, [null, null]);

  const malformed = task(dir, 'One full Codex request', 'auto', {codexSession: 'not a valid id'});
  let dispatched = 0;
  const held = await createRCCRuntime({stateDir: join(dir, 'bad-id'),
    catalog: async value => catalog(value, [candidate('codex')]),
    plan: async () => plan(malformed, [node('one', 'codex')]),
    execute: async () => { dispatched++; throw Error('should not execute'); }});
  t.after(async () => { await held.close(); });
  await held.submit(malformed);
  const status = await wait(held, malformed);
  assert.equal(status.state, 'held');
  assert.equal(status.error, 'native_resume_session_invalid');
  assert.equal(dispatched, 0);
});

test('explicit four-surface route is exact one-to-one and unavailable ChatGPT is never gpt-chat', async t => {
  const dir = await fixture(t);
  const routes = [
    {surface: 'chatgpt', instruction: '1+1'},
    {surface: 'codex', instruction: '2+2'},
    {surface: 'claude', instruction: '3+3'},
    {surface: 'claude-chat', instruction: '4+4'}];
  const request = task(dir, 'Send four independent arithmetic probes to four named surfaces',
    'explicit_routing_test', {explicitRoutes: routes});
  const rows = [candidate('gpt-code', 'gpt-chat'), candidate('codex', 'codex'),
    candidate('claude-code', 'claude', 'anthropic_shared'),
    candidate('claude-chat', 'claude-chat', 'anthropic_shared', {account: 'other-account'})];
  let planned = 0, executed = 0;
  const missing = await createRCCRuntime({stateDir: join(dir, 'missing-chatgpt'),
    catalog: async value => catalog(value, rows),
    plan: async () => { planned++; throw Error('must hold before model plan'); },
    execute: async () => { executed++; throw Error('must not execute'); }});
  t.after(async () => { await missing.close(); });
  await missing.submit(request);
  const held = await wait(missing, request);
  assert.equal(held.state, 'held');
  assert.equal(held.error, 'explicit_route_surface_unavailable:chatgpt');
  assert.deepEqual(held.children.map(child => child.instruction), routes.map(route => route.instruction));
  assert.equal(planned, 0); assert.equal(executed, 0);

  const availableRows = [candidate('chatgpt', 'chatgpt', 'openai_chat'), ...rows];
  const good = await createRCCRuntime({stateDir: join(dir, 'all-four'),
    catalog: async value => catalog(value, availableRows),
    plan: async () => plan(request, routes.map((route, index) =>
      node(`route-${index + 1}`, ['chatgpt', 'codex', 'claude-code', 'claude-chat'][index],
        {instruction: route.instruction}))),
    execute: async ticket => { executed++; return execution(ticket); },
    verifyTask: taskVerdict});
  t.after(async () => { await good.close(); });
  await good.submit(request);
  const result = await wait(good, request);
  assert.equal(result.state, 'completed'); assert.equal(result.children.length, 4);
  assert.deepEqual(result.children.map(child => child.selected_config.surface),
    routes.map(route => route.surface));
  assert.equal(executed, 4);
});

test('explicit-route planner cannot drop, alias, mutate payload or serialize parallel probes', async t => {
  const dir = await fixture(t);
  const routes = [{surface: 'chatgpt', instruction: '1+1'}, {surface: 'codex', instruction: '2+2'},
    {surface: 'claude', instruction: '3+3'}, {surface: 'claude-chat', instruction: '4+4'}];
  const rows = [candidate('a', 'chatgpt', 'openai_chat'), candidate('b', 'codex'),
    candidate('c', 'claude', 'anthropic_shared'),
    candidate('d', 'claude-chat', 'anthropic_shared', {account: 'other-account'})];
  const variants = [
    {name: 'drop', nodes: [node('a', 'a', {instruction: '1+1'})], reason: 'explicit_route_count_mismatch'},
    {name: 'alias', nodes: [node('a', 'b', {instruction: '1+1'}), node('b', 'a', {instruction: '2+2'}),
      node('c', 'c', {instruction: '3+3'}), node('d', 'd', {instruction: '4+4'})],
     reason: 'explicit_route_binding_mismatch'},
    {name: 'payload', nodes: [node('a', 'a', {instruction: '9+9'}), node('b', 'b', {instruction: '2+2'}),
      node('c', 'c', {instruction: '3+3'}), node('d', 'd', {instruction: '4+4'})],
     reason: 'explicit_route_binding_mismatch'},
    {name: 'serialized', nodes: [node('a', 'a', {instruction: '1+1'}),
      node('b', 'b', {instruction: '2+2', dependencies: ['a']}),
      node('c', 'c', {instruction: '3+3'}), node('d', 'd', {instruction: '4+4'})],
     reason: 'explicit_route_binding_mismatch'}];
  for (const variant of variants) {
    const request = task(dir, `explicit-${variant.name}`, 'explicit_routing_test', {explicitRoutes: routes});
    let executions = 0;
    const runtime = await createRCCRuntime({stateDir: join(dir, variant.name),
      catalog: async value => catalog(value, rows),
      plan: async () => plan(request, variant.nodes),
      execute: async () => { executions++; throw Error('invalid plan must not execute'); }});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request);
    const result = await wait(runtime, request);
    assert.equal(result.state, 'held', variant.name);
    assert.equal(result.error, variant.reason, variant.name);
    assert.equal(result.children.length, 4, variant.name);
    assert.equal(executions, 0, variant.name);
  }
});

test('execution-only first child is deliverable to dependent stage without parity claim', async t => {
  const dir = await fixture(t); const request = task(dir, 'Design and then implement one bounded change');
  const row = candidate('a'); const visits = [];
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, [row]),
    plan: async () => plan(request, [node('design', 'a'),
      node('implement', 'a', {dependencies: ['design']})]),
    execute: async ticket => { visits.push(ticket.node_id); return execution(ticket,
      {task_verified: false, task_quality: 'execution_only'}); }});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const result = await wait(runtime, request);
  assert.deepEqual(visits, ['design', 'implement']);
  assert.equal(result.state, 'returned_unverified');
  assert.equal(result.result.execution_verified, true);
  assert.equal(result.result.task_verified, false);
  assert.equal(result.result.parity_state, 'unverified');
  assert.ok(result.children.every(child => child.state === 'completed'));
});

test('one native successful child preserves exact output bytes without a node prefix', async t => {
  const dir = await fixture(t); const request = task(dir, 'Reply with hello only');
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, [candidate('a')]),
    plan: async () => plan(request, [node('node-1', 'a', {instruction: request.request})]),
    execute: async ticket => execution(ticket,
      {output: 'hello', task_verified: false, task_quality: 'execution_only'})});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const result = await wait(runtime, request);
  assert.equal(result.state, 'returned_unverified');
  assert.equal(result.result.output, 'hello');
  assert.equal(result.children[0].output_summary, 'hello');
  assert.equal(result.result.execution_verified, true);
  assert.equal(result.result.task_verified, false);
});

test('cancel of non-returning dispatched child reaches effects_uncertain without replay or hang', async t => {
  const dir = await fixture(t); const request = task(dir, 'Do one bounded native step');
  let dispatched;
  const started = new Promise(resolve => { dispatched = resolve; });
  let executions = 0;
  const runtime = await createRCCRuntime({stateDir: dir, cancelGraceMs: 100,
    catalog: async value => catalog(value, [candidate('a')]),
    plan: async () => plan(request, [node('one', 'a')]),
    execute: async () => { executions++; dispatched(); return new Promise(() => {}); }});
  t.after(async () => { await runtime.close({timeoutMs: 0}); });
  await runtime.submit(request); await started;
  assert.equal(runtime.cancel({schema: 1, task_id: request.task_id}).state, 'cancelling');
  const result = await runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 2_000});
  assert.equal(result.state, 'effects_uncertain');
  assert.equal(result.error, 'cancel_no_terminal_receipt');
  assert.equal(executions, 1);
});

test('quiesce pauses new admission without cancelling a live child and reports safe drain', async t => {
  const dir = await fixture(t); const request = task(dir, 'Run one bounded native action');
  let dispatched, finish;
  const started = new Promise(resolve => { dispatched = resolve; });
  const release = new Promise(resolve => { finish = resolve; });
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, [candidate('a')]),
    plan: async () => plan(request, [node('one', 'a')]),
    execute: async ticket => { dispatched(); await release; return execution(ticket,
      {task_verified: false, task_quality: 'execution_only'}); }});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request); await started;
  const first = runtime.quiesce({schema: 1, request_id: 'upgrade-1'});
  assert.equal(first.active_dispatches, 1); assert.equal(first.safe_to_stop, false);
  assert.equal(first.accepting_submissions, false);
  await assert.rejects(runtime.submit(task(dir, 'another action')), /runtime_stopping/);
  finish();
  assert.equal((await wait(runtime, request)).state, 'returned_unverified');
  let last;
  for (let i = 0; i < 20; i++) {
    last = runtime.quiesce({schema: 1, request_id: 'upgrade-1'});
    if (last.safe_to_stop) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(last.safe_to_stop, true); assert.equal(last.active_dispatches, 0);
});

test('trusted original source repair stages once, releases slot, and reconciles same task without quality upgrade', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Repair and stage this exact original source', 'auto', {write: true,
    conversationID: randomUUID(), submissionID: randomUUID()});
  const row = candidate('write', 'codex', 'openai_codex', {scope: 'workspace_write', allowedPaths: ['**']});
  let writes = 0, stages = 0, observations = 0, selectedHandoff;
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, [row]),
    plan: async ({task: value}) => plan(value, [node('one', row.id,
      {instruction: value.request, scope: 'workspace_write', ownedPaths: ['**']})]),
    execute: async ticket => { writes++; return repairExecution(dir, ticket); },
    stageSelfUpdate: async (payload, signal) => {
      stages++; assert.equal(signal.aborted, false);
      assert.deepEqual(Object.keys(payload).sort(), ['parent_record_path', 'parent_record_sha256', 'ticket']);
      assert.equal(payload.ticket.original_request, request.request);
      assert.equal(payload.ticket.host_context.conversation_id, request.host_context.conversation_id);
      assert.equal(payload.ticket.host_context.submission_id, request.host_context.submission_id);
      assert.equal(payload.parent_record_sha256, sha(await readFile(payload.parent_record_path)));
      selectedHandoff = installHandoff(request, payload); return selectedHandoff;
    },
    reconcileInstallation: async payload => {
      observations++; assert.equal(payload.task_id, request.task_id);
      assert.deepEqual(payload.install_handoff, selectedHandoff);
      return {...selectedHandoff, state: 'installed', installed_receipt: '/private/installed/verified.json'};
    }, verifyTask: () => { throw Error('stage must not use semantic judge'); }});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const awaiting = await wait(runtime, request);
  assert.equal(awaiting.state, 'awaiting_install'); assert.equal(awaiting.result.task_verified, false);
  assert.equal(awaiting.result.parity_state, 'unverified');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(runtime.activeWorkers, 0); assert.equal(runtime.controllers.size, 0);
  assert.equal(runtime.db.prepare('SELECT count(*) AS n FROM quota_leases').get().n, 0);
  assert.equal(runtime.db.prepare('SELECT count(*) AS n FROM write_leases').get().n, 0);
  await runtime.submit(request); assert.equal(writes, 1); assert.equal(stages, 1);
  const installed = await runtime.statusWithInstallation({schema: 1, task_id: request.task_id});
  assert.equal(installed.state, 'returned_unverified'); assert.equal(installed.result.task_verified, false);
  assert.equal(installed.result.output, 'Verified native source repair'); assert.equal(observations, 1);
  assert.equal(writes, 1); assert.equal(stages, 1);
});

test('both native handbacks stage source within one task and preserve every raw parent candidate', async t => {
  const dir = await fixture(t), request = task(dir, 'Complete this source-bound original task', 'auto', {write: true});
  request.budget.max_attempts = 3;
  const row = candidate('write', 'claude', 'anthropic_shared', {scope: 'workspace_write', allowedPaths: ['**']});
  const phases = []; let stageCalls = 0;
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, [row]),
    plan: async () => plan(request, [node('one', row.id,
      {instruction: request.request, scope: 'workspace_write', ownedPaths: ['**']})]),
    execute: ticket => handbackExecution(dir, ticket, {kind: 'both', adoption: 'rejected', output: 'RAW INITIAL REJECTED'}),
    executeContinuation: async ticket => {
      phases.push(ticket.continuation.kind);
      return ticket.continuation.kind === 'full_access_required' ?
        handbackExecution(dir, ticket, {kind: 'os1_change_required', output: 'RAW FULL ACCESS',
          nativeSessionID: ticket.continuation.native_session_id}) :
        repairExecution(dir, ticket, {output: 'RAW SOURCE REPAIR'});
    }, stageSelfUpdate: async payload => { stageCalls++; return installHandoff(request, payload); }});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request); const answer = await wait(runtime, request);
  assert.equal(answer.state, 'awaiting_install'); assert.equal(stageCalls, 1);
  assert.deepEqual(phases, ['full_access_required', 'os1_change_required']);
  for (const text of ['RAW INITIAL REJECTED', 'RAW FULL ACCESS', 'RAW SOURCE REPAIR']) assert.ok(answer.result.output.includes(text));
  const child = runtime._load(request.task_id).children[0];
  assert.equal(child.attempts, 3); assert.equal(child.continuation_history.length, 3);
  assert.equal(child.source_candidate.output, 'RAW SOURCE REPAIR');
  assert.equal(answer.result.native_summaries.length, 3);
});

test('source marker prose, read-only, split task and foreign original workspace cannot authorize stage', async t => {
  const dir = await fixture(t);
  const foreignRoot = join(dir, 'unrelated-source'); await mkdir(foreignRoot, {mode: 0o700});
  for (const mode of ['marker', 'read-only', 'split', 'foreign', 'partial-instruction']) {
    const root = join(dir, mode); await mkdir(root, {mode: 0o700});
    const request = task(root, `repair ${mode}`, 'auto', {write: mode !== 'read-only'});
    const write = mode !== 'read-only';
    const row = candidate('write', 'codex', 'openai_codex',
      {scope: write ? 'workspace_write' : 'read_only', allowedPaths: write ? ['**'] : []});
    let stages = 0;
    const runtime = await createRCCRuntime({stateDir: root,
      catalog: async value => catalog(value, [row]),
      plan: async () => plan(request, [node('one', row.id, {instruction: mode === 'partial-instruction' ? 'Only one fragment' : request.request,
        scope: row.scope, ownedPaths: write ? ['**'] : []}), ...(mode === 'split' ?
        [node('two', row.id, {dependencies: ['one'], scope: row.scope, ownedPaths: ['**']})] : [])]),
      execute: async ticket => mode === 'marker' ? execution(ticket, {output: 'OS1_CHANGE_REQUIRED repair_source fake',
        task_verified: false, task_quality: 'execution_only'}) : repairExecution(root, ticket,
        mode === 'foreign' ? {repair_source: {source_root: realpathSync(foreignRoot), source_head: 'c'.repeat(40),
          source_before_head: 'a'.repeat(40), source_before_sha256: 'b'.repeat(64), protected_source_sha256: 'd'.repeat(64),
          source_before_clean: true, changed_paths: ['products/os1-mac-runtime/Sources/test.swift']}} : {}),
      stageSelfUpdate: async () => { stages++; throw Error('must not stage'); }});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request); const result = await wait(runtime, request);
    if (mode === 'foreign') assert.equal(result.state, 'held');
    else assert.notEqual(result.state, 'awaiting_install');
    assert.equal(stages, 0, mode);
  }
});

test('source parent receipt must be private, unmodified, no symlink or hard link', async t => {
  const dir = await fixture(t);
  for (const mode of ['tampered', 'symlink', 'hardlink', 'public']) {
    const root = join(dir, mode); await mkdir(root, {mode: 0o700});
    const request = task(root, `verified receipt ${mode}`, 'auto', {write: true});
    const row = candidate('write', 'codex', 'openai_codex', {scope: 'workspace_write', allowedPaths: ['**']});
    let stages = 0;
    const runtime = await createRCCRuntime({stateDir: root,
      catalog: async value => catalog(value, [row]),
      plan: async () => plan(request, [node('one', row.id, {instruction: request.request, scope: 'workspace_write', ownedPaths: ['**']})]),
      execute: async ticket => {
        const record = await repairExecution(root, ticket), path = record.native_receipt;
        if (mode === 'tampered') await writeFile(path, JSON.stringify({...record, output: 'FORGED'}));
        else if (mode === 'symlink') {
          const target = path + '.original'; await writeFile(target, await readFile(path), {mode: 0o600});
          await rm(path); await symlink(target, path);
        } else if (mode === 'hardlink') await link(path, path + '.alias');
        else await chmod(path, 0o644);
        return record;
      }, stageSelfUpdate: async () => { stages++; throw Error('must not stage'); }});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request); const result = await wait(runtime, request);
    assert.equal(result.state, 'held', mode); assert.equal(stages, 0, mode);
    assert.equal(runtime._load(request.task_id).children[0].source_candidate.output, 'Verified native source repair');
  }
});

test('typed stage preflight denies without uncertainty/retry; malformed denial and lost result stay uncertain', async t => {
  const dir = await fixture(t);
  for (const reason of ['source_authority_missing', 'source_changed_or_uncommitted', 'staging_intent_busy',
    'protected_gate_changed', 'foreign-parent', 'unknown-reason', 'lost-result']) {
    const root = join(dir, reason); await mkdir(root, {mode: 0o700});
    const request = task(root, `stage denial ${reason}`, 'auto', {write: true});
    const row = candidate('write', 'codex', 'openai_codex', {scope: 'workspace_write', allowedPaths: ['**']});
    let writes = 0, stages = 0;
    const runtime = await createRCCRuntime({stateDir: root,
      catalog: async value => catalog(value, [row]),
      plan: async () => plan(request, [node('one', row.id, {instruction: request.request, scope: 'workspace_write', ownedPaths: ['**']})]),
      execute: async ticket => { writes++; return repairExecution(root, ticket); },
      stageSelfUpdate: async payload => { stages++; if (reason === 'lost-result') throw Error('return lost');
        return {schema: 1, status: 'not_dispatched', reason,
          parent_record_sha256: reason === 'foreign-parent' ? 'f'.repeat(64) : payload.parent_record_sha256}; }});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request); const result = await wait(runtime, request);
    assert.equal(result.state, ['foreign-parent', 'unknown-reason', 'lost-result'].includes(reason) ? 'effects_uncertain' : 'held', reason);
    await runtime.submit(request); assert.equal(writes, 1); assert.equal(stages, 1);
    assert.equal(runtime._load(request.task_id).children[0].source_candidate.output, 'Verified native source repair');
  }
});

test('late stage handoff after cancellation grace is preserved and cancelled without source replay', async t => {
  const dir = await fixture(t), request = task(dir, 'repair with late cancellation', 'auto', {write: true});
  const row = candidate('write', 'codex', 'openai_codex', {scope: 'workspace_write', allowedPaths: ['**']});
  let started, release, saved, writes = 0, stages = 0, cancels = 0;
  const dispatched = new Promise(resolve => { started = resolve; });
  const waitStage = new Promise(resolve => { release = resolve; });
  const runtime = await createRCCRuntime({stateDir: dir, cancelGraceMs: 100,
    catalog: async value => catalog(value, [row]),
    plan: async () => plan(request, [node('one', row.id, {instruction: request.request, scope: 'workspace_write', ownedPaths: ['**']})]),
    execute: async ticket => { writes++; return repairExecution(dir, ticket); },
    stageSelfUpdate: async (payload, signal) => { stages++; saved = installHandoff(request, payload);
      started(); await waitStage; assert.equal(signal.aborted, true); return saved; },
    cancelInstallation: async payload => { cancels++; assert.deepEqual(payload.install_handoff, saved);
      return {...saved, state: 'cancelled'}; }});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request); await dispatched;
  assert.equal((await runtime.cancelWithInstallation({schema: 1, task_id: request.task_id})).state, 'cancelling');
  assert.equal((await wait(runtime, request)).state, 'effects_uncertain');
  release();
  for (let i = 0; i < 50 && !runtime.status({schema: 1, task_id: request.task_id}).install_handoff; i++)
    await new Promise(resolve => setTimeout(resolve, 10));
  const late = runtime.status({schema: 1, task_id: request.task_id});
  assert.equal(late.state, 'effects_uncertain'); assert.deepEqual(late.install_handoff, saved);
  const cancelled = await runtime.cancelWithInstallation({schema: 1, task_id: request.task_id});
  assert.equal(cancelled.state, 'cancelled'); assert.equal(cancels, 1);
  await runtime.submit(request); assert.equal(writes, 1); assert.equal(stages, 1);
});

test('restart reconciles awaiting, uncertain and held handoffs with no native write or restage', async t => {
  const dir = await fixture(t), request = task(dir, 'repair survives restart', 'auto', {write: true});
  const row = candidate('write', 'codex', 'openai_codex', {scope: 'workspace_write', allowedPaths: ['**']});
  let handoff;
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, [row]),
    plan: async () => plan(request, [node('one', row.id, {instruction: request.request, scope: 'workspace_write', ownedPaths: ['**']})]),
    execute: ticket => repairExecution(dir, ticket),
    stageSelfUpdate: async payload => { handoff = installHandoff(request, payload); return handoff; }});
  await runtime.submit(request); assert.equal((await wait(runtime, request)).state, 'awaiting_install');
  await runtime.close();
  let observations = 0;
  const reopened = await createRCCRuntime({stateDir: dir,
    execute: () => { throw Error('writer replay'); }, stageSelfUpdate: () => { throw Error('stage replay'); },
    reconcileInstallation: async () => { observations++; return {...handoff,
      state: observations === 1 ? 'effects_uncertain' : observations === 2 ? 'failed' : 'installed',
      installed_receipt: observations < 3 ? null : '/private/installed/verified.json'}; }});
  t.after(async () => { await reopened.close(); });
  const status = {schema: 1, task_id: request.task_id};
  assert.equal((await reopened.statusWithInstallation(status)).state, 'effects_uncertain');
  assert.equal((await reopened.statusWithInstallation(status)).state, 'held');
  const final = await reopened.statusWithInstallation(status);
  assert.equal(final.state, 'returned_unverified'); assert.equal(final.result.task_verified, false);
  assert.equal(observations, 3); await reopened.submit(request); assert.equal(observations, 3);
});

test('foreign installation receipt is rejected atomically, then valid later receipt reconciles', async t => {
  const dir = await fixture(t), request = task(dir, 'reject foreign install receipt', 'auto', {write: true});
  const row = candidate('write', 'codex', 'openai_codex', {scope: 'workspace_write', allowedPaths: ['**']});
  let saved, reads = 0;
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, [row]),
    plan: async () => plan(request, [node('one', row.id, {instruction: request.request, scope: 'workspace_write', ownedPaths: ['**']})]),
    execute: ticket => repairExecution(dir, ticket),
    stageSelfUpdate: async payload => { saved = installHandoff(request, payload); return saved; },
    reconcileInstallation: async () => ({...saved, task_id: ++reads === 1 ? 'foreign-task' : saved.task_id,
      state: 'installed', installed_receipt: '/private/installed/receipt.json'})});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request); await wait(runtime, request);
  const rejected = await runtime.statusWithInstallation({schema: 1, task_id: request.task_id});
  assert.equal(rejected.state, 'effects_uncertain'); assert.deepEqual(rejected.install_handoff, saved);
  assert.equal(rejected.result.output, 'Verified native source repair');
  assert.equal((await runtime.statusWithInstallation({schema: 1, task_id: request.task_id})).state, 'returned_unverified');
});

test('optional host UUIDs pass unchanged, nil omission is accepted and explicit null or malformed IDs reject', async t => {
  const dir = await fixture(t);
  for (const extras of [{}, {conversationID: randomUUID(), submissionID: randomUUID()},
    {conversationID: null}, {submissionID: 'bad-id'}]) {
    const request = task(dir, '1+1', 'auto', extras);
    const runtime = await createRCCRuntime({stateDir: join(dir, randomUUID())});
    t.after(async () => { await runtime.close(); });
    if (extras.conversationID === null || extras.submissionID === 'bad-id')
      await assert.rejects(runtime.submit(request), /host_context_invalid/);
    else { await runtime.submit(request); assert.equal((await wait(runtime, request)).state, 'completed'); }
  }
});

test('admitted installation cancel is serialized, quiescence-visible and fully awaited before owner shutdown', async t => {
  const dir = await fixture(t), request = task(dir, 'serialize installation observation', 'auto', {write: true});
  const row = candidate('write', 'codex', 'openai_codex', {scope: 'workspace_write', allowedPaths: ['**']});
  let saved, entered, release, calls = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, [row]),
    plan: async () => plan(request, [node('one', row.id, {instruction: request.request, scope: 'workspace_write', ownedPaths: ['**']})]),
    execute: ticket => repairExecution(dir, ticket),
    stageSelfUpdate: async payload => { saved = installHandoff(request, payload); return saved; },
    cancelInstallation: async () => { calls++; entered(); await pending; return {...saved, state: 'cancelled'}; },
    reconcileInstallation: async () => { throw Error('cancelled/paused task must not observe again'); }});
  await runtime.submit(request); await wait(runtime, request);
  const requestID = {schema: 1, task_id: request.task_id};
  const cancel = runtime.cancelWithInstallation(requestID); await started;
  const first = runtime.quiesce({schema: 1, request_id: 'upgrade-observation'});
  assert.equal(first.safe_to_stop, false); assert.equal(first.active_dispatches, 1);
  assert.equal((await runtime.statusWithInstallation(requestID)).state, 'awaiting_install');
  let stopped = false;
  const close = runtime.close().then(() => { stopped = true; });
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(stopped, false);
  release(); assert.equal((await cancel).state, 'cancelled'); await close;
  assert.equal(calls, 1);
  const reopened = await createRCCRuntime({stateDir: dir});
  t.after(async () => { await reopened.close(); });
  assert.equal(reopened.status(requestID).state, 'cancelled');
  assert.equal(reopened.quiesce({schema: 1, request_id: 'drained'}).safe_to_stop, true);
});

test('native stage can directly return each bound install state, and absent nullable fields remain compatible', async t => {
  const dir = await fixture(t);
  for (const state of ['staged', 'installed', 'failed', 'cancelled', 'effects_uncertain']) {
    const root = join(dir, state); await mkdir(root, {mode: 0o700});
    const request = task(root, `direct stage ${state}`, 'auto', {write: true});
    const row = candidate('write', 'codex', 'openai_codex', {scope: 'workspace_write', allowedPaths: ['**']});
    const runtime = await createRCCRuntime({stateDir: root,
      catalog: async value => catalog(value, [row]),
      plan: async () => plan(request, [node('one', row.id, {instruction: request.request, scope: 'workspace_write', ownedPaths: ['**']})]),
      execute: ticket => repairExecution(root, ticket),
      stageSelfUpdate: async payload => {
        const result = installHandoff(request, payload, {state,
          installed_receipt: state === 'installed' ? '/private/installed/verified.json' : null});
        if (state !== 'installed') delete result.installed_receipt;
        return result;
      }});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request); const result = await wait(runtime, request);
    assert.equal(result.state, {staged: 'awaiting_install', installed: 'returned_unverified', failed: 'held',
      cancelled: 'cancelled', effects_uncertain: 'effects_uncertain'}[state], state);
    assert.equal(result.install_handoff.state, state); assert.equal(result.result.task_verified, false);
    if (state !== 'installed') assert.equal(result.install_handoff.installed_receipt, null);
  }
  const request = task(dir, 'Normal native record with null optional repair source');
  const runtime = await createRCCRuntime({stateDir: join(dir, 'null-repair'),
    catalog: async value => catalog(value, [candidate('read')]),
    plan: async () => plan(request, [node('one', 'read')]),
    execute: async ticket => execution(ticket, {repair_source: null})});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request); assert.equal((await wait(runtime, request)).state, 'returned_unverified');
});
