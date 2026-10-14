import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, chmod, lstat, mkdir, mkdtemp, readdir, rm, stat, unlink, writeFile, readFile, symlink, link } from 'node:fs/promises';
import fs, { realpathSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { canonicalHostContext, cheaperRouteAdmission, createRCCRuntime, dispatchable, effectiveExplicitRoutes,
  hostContextFingerprint, LADDER_MIN_VERIFIED_PASSES, lockIndivisibleInstruction, openRoutingLedger, resolveRoutePlan,
  routeFamily } from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';

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
  // GPT is no longer an explicit route (2026-10-13); two Codex routes keep
  // four independent nodes for the pool-concurrency check.
  const rows = [candidate('codex-2', 'codex', 'openai_codex'),
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
  assert.deepEqual(result.children.map(child => child.requested_surface), requested.map(route => route.surface));
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

test('full configuration hash and wrong-scope candidate remain rejected without aliasing; exact ID executes', async t => {
  const dir = await fixture(t);
  const id = 'cfg-87ac163f12496ea04747bad4bc19a621';
  const configuration = '87ac163f12496ea04747bad4bc19a621a7df16ae1917aba2dcf53b7a742987d9';
  const row = {...candidate(id), configuration_sha256: configuration};
  const writer = candidate('writer', 'codex', 'openai_codex',
    {scope: 'workspace_write', allowedPaths: ['**']});
  for (const [name, candidateID, shouldExecute] of [
    ['full-hash', 'cfg-' + configuration, false],
    ['wrong-scope', writer.id, false],
    ['exact-id', id, true]]) {
    const request = task(dir, 'Return the result of one exact approved candidate');
    let executions = 0;
    const runtime = await createRCCRuntime({stateDir: join(dir, name),
      catalog: async value => catalog(value, [row, writer]),
      plan: async () => plan(request, [node('one', candidateID)]),
      execute: async ticket => {
        executions++;
        assert.equal(ticket.candidate_id, id);
        assert.equal(ticket.configuration_sha256, configuration);
        return execution(ticket);
      }, verifyTask: taskVerdict});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request);
    const result = await wait(runtime, request);
    assert.equal(result.state, shouldExecute ? 'completed' : 'held', name);
    assert.equal(result.error, shouldExecute ? null : 'plan_node_invalid', name);
    assert.equal(executions, shouldExecute ? 1 : 0, name);
    assert.equal(result.children.length, shouldExecute ? 1 : 0, name);
  }
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
  // GPT surfaces are no longer routed (2026-10-13): an auto catalog holding
  // only GPT rows holds before planning instead of dispatching them.
  const scenarios = [
    ['codex', 'codex', 'openai_codex', codexSession],
    ['claude', 'claude', 'anthropic_shared', claudeSession],
    ['claude-chat', 'claude-chat', 'anthropic_shared', null]];
  for (const [name, surface, pool] of [['gpt-chat', 'gpt-chat', 'openai_codex'], ['chatgpt', 'chatgpt', 'openai_chat']]) {
    const request = task(dir, `Continue one native ${surface} request`, 'auto', {codexSession, claudeSession});
    let calls = 0;
    const runtime = await createRCCRuntime({stateDir: join(dir, name),
      catalog: async value => catalog(value, [candidate(name, surface, pool)]),
      plan: async () => { calls++; return plan(request, [node('one', name)]); },
      execute: async () => { calls++; throw Error('a GPT surface must not dispatch'); }});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request);
    const held = await wait(runtime, request);
    assert.equal(held.state, 'held', name);
    assert.equal(held.error, 'no_dispatchable_candidate:no_candidate_in_scope', name);
    assert.equal(calls, 0, name);
  }
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

test('explicit GPT route is dropped, never substituted; other named routes run; all-GPT holds visibly', async t => {
  const dir = await fixture(t);
  const routes = [
    {surface: 'chatgpt', instruction: '1+1'},
    {surface: 'codex', instruction: '2+2'},
    {surface: 'claude', instruction: '3+3'},
    {surface: 'claude-chat', instruction: '4+4'}];
  const native = routes.slice(1);
  const request = task(dir, 'Send four independent arithmetic probes to four named surfaces',
    'explicit_routing_test', {explicitRoutes: routes});
  // An older catalog may still carry a Codex-funded gpt-chat row. It must
  // never stand in for the dropped ordinary ChatGPT route.
  const rows = [candidate('gpt-code', 'gpt-chat'), candidate('codex', 'codex'),
    candidate('claude-code', 'claude', 'anthropic_shared'),
    candidate('claude-chat', 'claude-chat', 'anthropic_shared', {account: 'other-account'})];
  let executed = 0, plannerRoutes = null;
  const good = await createRCCRuntime({stateDir: join(dir, 'gpt-dropped'),
    catalog: async value => catalog(value, rows),
    plan: async ({task: planned}) => { plannerRoutes = planned.host_context.explicit_routes;
      return plan(request, native.map((route, index) =>
        node(`route-${index + 1}`, ['codex', 'claude-code', 'claude-chat'][index], {instruction: route.instruction}))); },
    execute: async ticket => { executed++; return execution(ticket); },
    verifyTask: taskVerdict});
  t.after(async () => { await good.close(); });
  await good.submit(request);
  const result = await wait(good, request);
  assert.equal(result.state, 'completed'); assert.equal(result.children.length, 3);
  assert.deepEqual(result.children.map(child => child.selected_config.surface), ['codex', 'claude', 'claude-chat']);
  assert.deepEqual(result.children.map(child => child.requested_surface), native.map(route => route.surface));
  assert.ok(result.children.every(child => child.selected_config.surface !== 'gpt-chat'));
  assert.deepEqual(plannerRoutes, routes, 'the immutable host contract still records what the owner named');
  assert.equal(executed, 3);

  // A plan that keeps the GPT route by substituting gpt-chat is rejected.
  executed = 0;
  const substituted = await createRCCRuntime({stateDir: join(dir, 'gpt-substituted'),
    catalog: async value => catalog(value, rows),
    plan: async () => plan(request, routes.map((route, index) =>
      node(`route-${index + 1}`, ['gpt-code', 'codex', 'claude-code', 'claude-chat'][index],
        {instruction: route.instruction}))),
    execute: async () => { executed++; throw Error('must not execute'); }});
  t.after(async () => { await substituted.close(); });
  await substituted.submit(request);
  const rejected = await wait(substituted, request);
  assert.equal(rejected.state, 'held'); assert.equal(rejected.error, 'explicit_route_count_mismatch');
  assert.deepEqual(rejected.children.map(child => child.requested_surface), native.map(route => route.surface));
  assert.equal(executed, 0);

  // Every route named GPT: hold before any catalog probe or planner call.
  const gptOnly = [{surface: 'chatgpt', instruction: '1+1'}, {surface: 'gpt-chat', instruction: '2+2'}];
  const onlyRequest = task(dir, 'Send two arithmetic probes to GPT', 'explicit_routing_test', {explicitRoutes: gptOnly});
  let probed = 0, planned = 0;
  const missing = await createRCCRuntime({stateDir: join(dir, 'gpt-only'),
    catalog: async value => { probed++; return catalog(value, rows); },
    plan: async () => { planned++; throw Error('must hold before model plan'); },
    execute: async () => { executed++; throw Error('must not execute'); }});
  t.after(async () => { await missing.close(); });
  await missing.submit(onlyRequest);
  const held = await wait(missing, onlyRequest);
  assert.equal(held.state, 'held');
  assert.equal(held.error, 'explicit_route_surface_dropped:chatgpt,gpt-chat');
  assert.deepEqual(held.children.map(child => child.instruction), gptOnly.map(route => route.instruction));
  assert.deepEqual(held.children.map(child => child.requested_surface), gptOnly.map(route => route.surface));
  assert.ok(held.children.every(child => child.selected_config === null && child.native_receipt === null &&
    child.candidate_id === null && child.attempt_id === null && child.state === 'held'));
  assert.equal(probed, 0); assert.equal(planned, 0); assert.equal(executed, 0);
  await missing.close();
  // A pre-field durable snapshot still has the immutable original route
  // contract. Exercise migration in this private fixture database only.
  const legacyDB = new DatabaseSync(join(dir, 'gpt-only', 'rcc-runtime.sqlite'));
  const legacy = JSON.parse(legacyDB.prepare('SELECT snapshot FROM tasks WHERE task_id=?').get(onlyRequest.task_id).snapshot);
  for (const child of legacy.children) delete child.requested_surface;
  legacyDB.prepare('UPDATE tasks SET snapshot=? WHERE task_id=?').run(JSON.stringify(legacy), onlyRequest.task_id);
  legacyDB.close();
  const recovered = await createRCCRuntime({stateDir: join(dir, 'gpt-only')});
  t.after(async () => { await recovered.close(); });
  const recoveredHeld = recovered.status({schema: 1, task_id: onlyRequest.task_id});
  assert.deepEqual(recoveredHeld.children.map(child => child.requested_surface), gptOnly.map(route => route.surface));
  assert.ok(recoveredHeld.children.every(child => child.selected_config === null && child.native_receipt === null));
});

test('explicit-route planner cannot drop, alias, mutate payload or serialize parallel probes', async t => {
  const dir = await fixture(t);
  // Three native surfaces: GPT is no longer an explicit route (2026-10-13).
  const routes = [{surface: 'codex', instruction: '1+1'}, {surface: 'claude', instruction: '2+2'},
    {surface: 'claude-chat', instruction: '3+3'}];
  const rows = [candidate('a', 'codex'), candidate('b', 'claude', 'anthropic_shared'),
    candidate('c', 'claude-chat', 'anthropic_shared', {account: 'other-account'})];
  const variants = [
    {name: 'drop', nodes: [node('a', 'a', {instruction: '1+1'})], reason: 'explicit_route_count_mismatch'},
    {name: 'alias', nodes: [node('a', 'b', {instruction: '1+1'}), node('b', 'a', {instruction: '2+2'}),
      node('c', 'c', {instruction: '3+3'})],
     reason: 'explicit_route_binding_mismatch'},
    {name: 'payload', nodes: [node('a', 'a', {instruction: '9+9'}), node('b', 'b', {instruction: '2+2'}),
      node('c', 'c', {instruction: '3+3'})],
     reason: 'explicit_route_binding_mismatch'},
    {name: 'serialized', nodes: [node('a', 'a', {instruction: '1+1'}),
      node('b', 'b', {instruction: '2+2', dependencies: ['a']}),
      node('c', 'c', {instruction: '3+3'})],
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
    assert.equal(result.children.length, 3, variant.name);
    assert.deepEqual(result.children.map(child => child.requested_surface), routes.map(route => route.surface), variant.name);
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
    // A one-node plan runs the owner's request (lockIndivisibleInstruction),
    // so a planner fragment survives only beyond the node instruction bound:
    // there it still never authorizes a stage.
    const request = mode === 'partial-instruction' ?
      task(root, `repair ${mode} ` + 'x'.repeat(12_001), 'auto', {write: true, objective: `repair ${mode}`}) :
      task(root, `repair ${mode}`, 'auto', {write: mode !== 'read-only'});
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

// Shared with Tests/OS1ContextTests/RCCNativeCatalogBuilderFixture.swift: the
// Swift encoder must produce these exact bytes for the same host.
const CAPACITY_HOST_CANONICAL = '{"capacity_plan":{"claude":100,"codex":30},"claude_session_id":null,' +
  '"codex_session_id":null,"context":null,"explicit_routes":null,"owner_policy":null,' +
  '"provider_preference":"auto","require_read_only":true,"workspace":"/tmp/rcc-fixture"}';

test('optional host capacity_plan is validated, fingerprinted like Swift, and absent keeps old bytes', async t => {
  const dir = await fixture(t);
  const host = {workspace: '/tmp/rcc-fixture', context: null, provider_preference: 'auto',
    codex_session_id: null, claude_session_id: null, require_read_only: true, owner_policy: null,
    explicit_routes: null, capacity_plan: {codex: 30, claude: 100}};
  assert.equal(canonicalHostContext(host), CAPACITY_HOST_CANONICAL);
  assert.equal(hostContextFingerprint(host), sha(CAPACITY_HOST_CANONICAL));
  const legacy = {...host}; delete legacy.capacity_plan;
  assert.equal(canonicalHostContext(legacy).includes('capacity_plan'), false,
    'an absent plan is omitted, so older host fingerprints are unchanged');
  let catalogCalls = 0;
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => { catalogCalls++; return catalog(value, [candidate('a')]); },
    plan: async ({task: planned}) => plan(planned, [node('one', 'a')]),
    execute: async ticket => execution(ticket), verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  for (const plan of [{codex: 0, claude: 100}, {codex: 30, claude: 100}, {codex: 100, claude: 0}]) {
    const request = task(dir, 'Answer one bounded question ' + plan.codex);
    request.host_context.capacity_plan = plan;
    request.source_fingerprint = hostContextFingerprint(request.host_context);
    await runtime.submit(request);
    assert.equal((await wait(runtime, request)).state, 'completed');
  }
  const admittedCalls = catalogCalls;
  assert.ok(admittedCalls >= 3);
  for (const bad of [{codex: 0, claude: 0}, {codex: 101, claude: 0}, {codex: -1, claude: 50},
    {codex: 1.5, claude: 50}, {codex: 50}, {codex: 50, claude: 50, chatgpt: 10}, [50, 50], 'all']) {
    const request = task(dir, 'Answer one bounded question with an invalid plan');
    request.host_context.capacity_plan = bad;
    request.source_fingerprint = hostContextFingerprint(request.host_context);
    await assert.rejects(runtime.submit(request), /host_context_invalid/);
  }
  assert.equal(catalogCalls, admittedCalls, 'an invalid plan never reaches the catalog');
});

test('an empty catalog with exclusions holds with its reasons; without them it is an invalid binding', async t => {
  const dir = await fixture(t);
  const exclusions = [{provider: 'claude', reason: 'signed_out', count: 15},
    {provider: 'codex', reason: 'capacity_zero', count: 62}, {provider: 'codex', reason: 'signed_out', count: 1}];
  const cases = [
    {name: 'explained', catalog: value => ({...catalog(value, []), exclusions}),
     error: 'no_routable_candidate:capacity_zero,signed_out'},
    {name: 'opaque', catalog: value => catalog(value, []), error: 'catalog_binding_invalid'},
    {name: 'empty-list', catalog: value => ({...catalog(value, []), exclusions: []}), error: 'catalog_binding_invalid'},
    {name: 'unknown-reason', catalog: value => ({...catalog(value, []),
      exclusions: [{provider: 'codex', reason: 'cheaper_elsewhere', count: 1}]}), error: 'catalog_binding_invalid'},
    {name: 'gpt-provider', catalog: value => ({...catalog(value, []),
      exclusions: [{provider: 'chatgpt', reason: 'gpt_dropped', count: 1}]}), error: 'catalog_binding_invalid'},
    {name: 'zero-count', catalog: value => ({...catalog(value, []),
      exclusions: [{provider: 'codex', reason: 'quota_zero', count: 0}]}), error: 'catalog_binding_invalid'},
    {name: 'duplicate', catalog: value => ({...catalog(value, []),
      exclusions: [{provider: 'codex', reason: 'quota_zero', count: 1}, {provider: 'codex', reason: 'quota_zero', count: 2}]}),
     error: 'catalog_binding_invalid'},
    {name: 'extra-field', catalog: value => ({...catalog(value, []),
      exclusions: [{provider: 'codex', reason: 'quota_zero', count: 1, model: 'x'}]}), error: 'catalog_binding_invalid'}];
  for (const item of cases) {
    const request = task(dir, 'Answer one bounded question: ' + item.name);
    let planned = 0, executed = 0;
    const runtime = await createRCCRuntime({stateDir: join(dir, item.name),
      catalog: async value => item.catalog(value),
      plan: async () => { planned++; throw Error('must not plan'); },
      execute: async () => { executed++; throw Error('must not execute'); }});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request);
    const held = await wait(runtime, request);
    assert.equal(held.state, 'held', item.name); assert.equal(held.error, item.error, item.name);
    assert.equal(planned, 0, item.name); assert.equal(executed, 0, item.name);
  }
  // Exclusions beside routable candidates are evidence only; routing proceeds.
  const request = task(dir, 'Answer one bounded question with partial exclusions');
  const runtime = await createRCCRuntime({stateDir: join(dir, 'partial'),
    catalog: async value => ({...catalog(value, [candidate('a')]), exclusions}),
    plan: async ({task: planned, catalog: bound}) => {
      assert.deepEqual(bound.exclusions, exclusions);
      return plan(planned, [node('one', 'a')]); },
    execute: async ticket => execution(ticket), verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  assert.equal((await wait(runtime, request)).state, 'completed');
  // An explicit-route task with nothing routable keeps its requested routes visible.
  const routes = [{surface: 'codex', instruction: '1+1'}, {surface: 'claude', instruction: '2+2'}];
  const explicit = task(dir, 'Route two probes', 'explicit_routing_test', {explicitRoutes: routes});
  const empty = await createRCCRuntime({stateDir: join(dir, 'explicit-empty'),
    catalog: async value => ({...catalog(value, []), exclusions}),
    plan: async () => { throw Error('must not plan'); }, execute: async () => { throw Error('must not execute'); }});
  t.after(async () => { await empty.close(); });
  await empty.submit(explicit);
  const heldExplicit = await wait(empty, explicit);
  assert.equal(heldExplicit.state, 'held');
  assert.equal(heldExplicit.error, 'no_routable_candidate:capacity_zero,signed_out');
  assert.deepEqual(heldExplicit.children.map(child => child.requested_surface), ['codex', 'claude']);
});

test('effective explicit routes drop only GPT surfaces and keep order', () => {
  const routes = [{surface: 'gpt-chat', instruction: '0+0'}, {surface: 'codex', instruction: '1+1'},
    {surface: 'chatgpt', instruction: '2+2'}, {surface: 'claude-chat', instruction: '3+3'},
    {surface: 'claude', instruction: '4+4'}];
  assert.deepEqual(effectiveExplicitRoutes({host_context: {explicit_routes: routes}}),
    [routes[1], routes[3], routes[4]]);
  assert.equal(effectiveExplicitRoutes({host_context: {explicit_routes: null}}), null);
  assert.deepEqual(effectiveExplicitRoutes({host_context: {explicit_routes: [routes[0], routes[2]]}}), []);
});

// ---- Deterministic host routing (2026-10-13): the planner grades, the host binds.
const graded = (id, routeClass, options = {}) => ({id, instruction: options.instruction ?? 'Do one bounded task',
  dependencies: options.dependencies ?? [], kind: options.kind ?? 'agent', route_class: routeClass,
  scope: options.scope ?? 'read_only', owned_paths: options.ownedPaths ?? [], context_refs: []});
const row = (id, pool, model, effort, options = {}) => candidate(id,
  options.surface ?? (pool === 'openai_codex' ? 'codex' : 'claude'), pool, {model, effort, ...options});
// Catalog order as the native builder emits it: pools by quota score, then
// native model preference, then surface/effort/scope.
function routingCatalog() {
  return [
    row('codex-sol-low', 'openai_codex', 'gpt-5.7-sol', 'low'),
    row('codex-sol-medium', 'openai_codex', 'gpt-5.7-sol', 'medium'),
    row('codex-sol-high', 'openai_codex', 'gpt-5.7-sol', 'high'),
    row('codex-sol-xhigh', 'openai_codex', 'gpt-5.7-sol', 'xhigh'),
    row('codex-sol-write-medium', 'openai_codex', 'gpt-5.7-sol', 'medium',
      {scope: 'workspace_write', allowedPaths: ['**']}),
    row('codex-luna-low', 'openai_codex', 'gpt-5.7-luna', 'low'),
    row('claude-opus-medium', 'anthropic_shared', 'claude-opus-5-5', 'medium'),
    row('claude-opus-xhigh', 'anthropic_shared', 'claude-opus-5-5', 'xhigh'),
  ];
}

test('resolver is deterministic: same input, same exact tuple and decision', () => {
  const request = task('/tmp', 'Explain one function', 'auto');
  const rows = catalog(request, routingCatalog());
  const proposed = plan(request, [graded('a', 'standard'), graded('b', 'deep', {dependencies: ['a']})]);
  const now = Date.now();
  const first = resolveRoutePlan(structuredClone(proposed), request, rows, now);
  const second = resolveRoutePlan(structuredClone(proposed), request, rows, now);
  assert.deepEqual(first, second);
  // route_class is a family label only: both classes get the pool reference.
  assert.deepEqual(first.plan.nodes.map(n => n.candidate_id), ['codex-sol-xhigh', 'codex-sol-xhigh']);
  assert.ok(first.plan.nodes.every(n => !Object.hasOwn(n, 'route_class')));
  assert.deepEqual(first.decisions.a, {route_class: 'standard', resolved_candidate_id: 'codex-sol-xhigh',
    surface: 'codex', model: 'gpt-5.7-sol', effort: 'xhigh', quota_pool: 'openai_codex',
    reason: 'resolver;route_reference;pool_rank_0;effort_xhigh;agent_surface', quota_remaining_fraction: 0.7});
  assert.deepEqual(first.routes.a, {kind: 'reference', reference_effort: 'xhigh', ladder: null});
  // Catalog row order, not the object's key order or a model name, decides.
  const reordered = catalog(request, routingCatalog().map(value =>
    Object.fromEntries(Object.entries(value).reverse())));
  assert.deepEqual(resolveRoutePlan(structuredClone(proposed), request, reordered, now).plan, first.plan);
  // A graded exact-arithmetic node binds the local row; an agent node never does.
  const local = candidate('local-exact', 'local', 'none', {model: 'local-deterministic', effort: 'none'});
  const mixed = resolveRoutePlan(plan(request, [graded('d', 'trivial', {kind: 'deterministic', instruction: '2+3'}),
    graded('a', 'trivial')]), request, catalog(request, [local, ...routingCatalog()]), now,
  {verifierRegistry: new Map([['trivial:read_only:local', async () => ({passed: true})]]),
    ledgerStats: () => ({verified_passes: 99, verifier_failures: 0})});
  assert.equal(mixed.decisions.d.resolved_candidate_id, 'local-exact');
  assert.equal(mixed.decisions.d.reason, 'resolver;route_reference;pool_rank_0;effort_none;local_exact');
  assert.equal(mixed.decisions.a.resolved_candidate_id, 'codex-sol-xhigh');
});

test('every route_class binds the pool reference: top model at its highest effort up to max', () => {
  // Owner objective (2026-10-13): reference quality = the newest top model at
  // max reasoning. route_class never lowers the model or the effort.
  const request = task('/tmp', 'Grade effort', 'auto');
  const rows = routingCatalog();
  rows.splice(4, 0, row('codex-sol-max', 'openai_codex', 'gpt-5.7-sol', 'max'),
    row('codex-sol-ultra', 'openai_codex', 'gpt-5.7-sol', 'ultra'));
  rows.push(row('claude-opus-max', 'anthropic_shared', 'claude-opus-5-5', 'max'));
  const now = Date.now();
  const resolve = (routeClass, value = rows, intent) => resolveRoutePlan(plan(request, [graded('n', routeClass)]), request,
    {...catalog(request, value), ...(intent ? {routing_intent: intent} : {})}, now).decisions.n;
  // Codex reference: gpt-5.7-sol (first in catalog order) at max, whatever the class.
  for (const routeClass of ['trivial', 'standard', 'deep']) {
    const decision = resolve(routeClass);
    assert.equal(decision.resolved_candidate_id, 'codex-sol-max', routeClass);
    assert.equal(decision.reason, 'resolver;route_reference;pool_rank_0;effort_max;agent_surface', routeClass);
  }
  // Claude reference: claude-opus-5-5 at max, also for every class.
  const claude = rows.filter(value => value.quota_pool === 'anthropic_shared');
  assert.deepEqual(['trivial', 'standard', 'deep'].map(routeClass => resolve(routeClass, claude).resolved_candidate_id),
    ['claude-opus-max', 'claude-opus-max', 'claude-opus-max']);
  // Without a max row the reference is the highest offered effort, never a
  // lower model that happens to offer more.
  assert.equal(resolve('trivial', routingCatalog()).resolved_candidate_id, 'codex-sol-xhigh');
  // ultra is never the default reference: an ultra-only model offers no
  // reference without the owner's explicit ultra request.
  const ultraOnly = [row('codex-sol-ultra', 'openai_codex', 'gpt-5.7-sol', 'ultra')];
  assert.throws(() => resolve('deep', ultraOnly), /no_dispatchable_candidate:read_only/);
  const ultra = resolve('trivial', ultraOnly, {effort: 'ultra', model_family: null});
  assert.equal(ultra.resolved_candidate_id, 'codex-sol-ultra');
  assert.equal(ultra.reason, 'resolver;route_explicit;intent_effort_ultra;pool_rank_0;effort_ultra;agent_surface');
  // An explicit effort is a hard constraint: the owner's "low" runs at low.
  const lowRows = rows.filter(value => value.effort === 'low');
  const low = resolve('deep', lowRows, {effort: 'low', model_family: null});
  assert.equal(low.resolved_candidate_id, 'codex-sol-low');
  assert.match(low.reason, /^resolver;route_explicit;intent_effort_low;pool_rank_0;effort_low;/);
  // An explicit model family runs that family at its reference effort.
  const opusRows = rows.filter(value => value.model === 'claude-opus-5-5');
  const opus = resolve('trivial', opusRows, {effort: null, model_family: 'opus'});
  assert.equal(opus.resolved_candidate_id, 'claude-opus-max');
  assert.match(opus.reason, /^resolver;route_explicit;intent_family_opus;pool_rank_0;effort_max;/);
  // Both an effort and a family: exactly that tuple.
  const opusXhigh = resolve('deep', opusRows.filter(value => value.effort === 'xhigh'),
    {effort: 'xhigh', model_family: 'opus'});
  assert.equal(opusXhigh.resolved_candidate_id, 'claude-opus-xhigh');
});

test('catalog routing_intent is optional and strictly shaped; a malformed one holds before planning', async t => {
  const dir = await fixture(t);
  const cases = [[{effort: 'max', model_family: 'opus'}, 'completed'], [undefined, 'completed'],
    [{effort: 'none', model_family: null}, 'held'], [{effort: null, model_family: null}, 'held'],
    [{effort: 'max', model_family: 'Opus!'}, 'held'], [{effort: 'max'}, 'held'],
    [{effort: 'max', model_family: null, extra: 1}, 'held']];
  for (const [index, [intent, state]] of cases.entries()) {
    const request = task(dir, 'Explain one function ' + index);
    let planned = 0;
    const runtime = await createRCCRuntime({stateDir: join(dir, 'intent-' + index),
      catalog: async value => ({...catalog(value, routingCatalog()), ...(intent ? {routing_intent: intent} : {})}),
      plan: async () => { planned++; return plan(request, [graded('n', 'deep')]); },
      execute: async ticket => execution(ticket), verifyTask: taskVerdict});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request);
    const done = await wait(runtime, request);
    assert.equal(done.state, state, `${JSON.stringify(intent)}: ${done.error}`);
    if (state === 'held') { assert.equal(done.error, 'catalog_binding_invalid'); assert.equal(planned, 0); }
  }
});

test('inside the Anthropic pool read-only work takes the chat row of the SAME model and effort', () => {
  const request = task('/tmp', 'Answer briefly', 'auto', {write: true});
  const now = Date.now();
  const anthropicFirst = [
    row('claude-chat-opus-xhigh', 'anthropic_shared', 'claude-opus-5-5', 'xhigh', {surface: 'claude-chat'}),
    row('claude-chat-opus-medium', 'anthropic_shared', 'claude-opus-5-5', 'medium', {surface: 'claude-chat'}),
    row('claude-opus-medium', 'anthropic_shared', 'claude-opus-5-5', 'medium'),
    row('claude-opus-xhigh', 'anthropic_shared', 'claude-opus-5-5', 'xhigh'),
    row('claude-opus-write-xhigh', 'anthropic_shared', 'claude-opus-5-5', 'xhigh',
      {scope: 'workspace_write', allowedPaths: ['**']}),
    ...routingCatalog().filter(value => value.quota_pool === 'openai_codex')];
  const resolve = rows => resolveRoutePlan(plan(request, [graded('read', 'standard'),
    graded('write', 'standard', {scope: 'workspace_write', ownedPaths: ['**']})]), request, catalog(request, rows), now);
  const resolved = resolve(anthropicFirst);
  assert.equal(resolved.decisions.read.resolved_candidate_id, 'claude-chat-opus-xhigh');
  assert.equal(resolved.decisions.read.reason, 'resolver;route_reference;pool_rank_0;effort_xhigh;chat_lane_same_route');
  // Writes never take the chat lane: the agent row of the same reference.
  assert.equal(resolved.decisions.write.resolved_candidate_id, 'claude-opus-write-xhigh');
  assert.match(resolved.decisions.write.reason, /;agent_surface$/);
  // A chat row only at a LOWER effort is not the same route: the agent row
  // at the reference effort is used instead.
  const lowerChat = anthropicFirst.filter(value => value.id !== 'claude-chat-opus-xhigh');
  const fallback = resolve(lowerChat).decisions.read;
  assert.equal(fallback.resolved_candidate_id, 'claude-opus-xhigh');
  assert.equal(fallback.effort, 'xhigh');
  assert.match(fallback.reason, /;agent_surface$/);
  // An undispatchable chat row also falls back to the agent row, same route.
  const staleChat = anthropicFirst.map(value => value.id === 'claude-chat-opus-xhigh' ?
    {...value, availability: 'unavailable'} : value);
  assert.equal(resolve(staleChat).decisions.read.resolved_candidate_id, 'claude-opus-xhigh');
  // The chat lane never moves work across pools: Codex first means Codex.
  const codexFirst = [...routingCatalog().filter(value => value.quota_pool === 'openai_codex'),
    row('claude-chat-opus-xhigh', 'anthropic_shared', 'claude-opus-5-5', 'xhigh', {surface: 'claude-chat'})];
  const ordinary = resolveRoutePlan(plan(request, [graded('read', 'standard')]), request,
    catalog(request, codexFirst), now);
  assert.equal(ordinary.decisions.read.resolved_candidate_id, 'codex-sol-xhigh');
  assert.equal(ordinary.decisions.read.quota_pool, 'openai_codex');
});

test('pool order is respected and the second pool is chosen when the first cannot dispatch', () => {
  const request = task('/tmp', 'Explain one function', 'auto');
  const now = Date.now();
  const node = [graded('n', 'standard')];
  for (const [name, change] of [['unknown', {quota: null}], ['exhausted', {quota: 0}],
    ['unavailable', {availability: 'unavailable'}]]) {
    const rows = routingCatalog().map(value => value.quota_pool === 'openai_codex' ?
      row(value.id, value.quota_pool, value.model, value.effort,
        {scope: value.scope, allowedPaths: value.allowed_paths, ...change}) : value);
    assert.equal(rows.some(value => dispatchable(value, request, now) && value.quota_pool === 'openai_codex'), false, name);
    const decision = resolveRoutePlan(plan(request, node), request, catalog(request, rows), now).decisions.n;
    assert.equal(decision.quota_pool, 'anthropic_shared', name);
    assert.equal(decision.resolved_candidate_id, 'claude-opus-xhigh', name);
    assert.equal(decision.reason,
      'resolver;route_reference;pool_rank_1;skipped_pool_rank_0_reference_undispatchable;effort_xhigh;agent_surface', name);
  }
  // Both references can dispatch: the catalog's pool order decides whose
  // quota is spent (equal-quality references), here Anthropic listed first.
  const anthropicFirst = [...routingCatalog().filter(value => value.quota_pool === 'anthropic_shared'),
    ...routingCatalog().filter(value => value.quota_pool === 'openai_codex')];
  const first = resolveRoutePlan(plan(request, node), request, catalog(request, anthropicFirst), now).decisions.n;
  assert.equal(first.resolved_candidate_id, 'claude-opus-xhigh');
  assert.match(first.reason, /;pool_rank_0;effort_xhigh;/);
  assert.equal(resolveRoutePlan(plan(request, node), request, catalog(request, routingCatalog()), now)
    .decisions.n.resolved_candidate_id, 'codex-sol-xhigh');
  // An undispatchable top model is never replaced by a lower model of its
  // pool (gpt-5.7-luna stays fresh): the other pool's reference runs.
  const solDown = routingCatalog().map(value => value.model === 'gpt-5.7-sol' ? {...value, availability: 'unavailable'} : value);
  assert.ok(solDown.some(value => value.model === 'gpt-5.7-luna' && dispatchable(value, request, now)));
  assert.equal(resolveRoutePlan(plan(request, node), request, catalog(request, solDown), now)
    .decisions.n.resolved_candidate_id, 'claude-opus-xhigh');
  // Only the reference effort counts: a fresh lower effort of the same model
  // does not stand in for a stale reference row.
  const xhighDown = routingCatalog().map(value => value.id === 'codex-sol-xhigh' ? {...value, quota_remaining_fraction: null} : value);
  assert.equal(resolveRoutePlan(plan(request, node), request, catalog(request, xhighDown), now)
    .decisions.n.resolved_candidate_id, 'claude-opus-xhigh');
  // A dropped GPT row is never chosen even when it is first and fresh.
  const gpt = [row('gpt-row', 'openai_codex', 'gpt-5.7-sol', 'xhigh', {surface: 'gpt-chat'}), ...routingCatalog()];
  assert.equal(resolveRoutePlan(plan(request, node), request, catalog(request, gpt), now)
    .decisions.n.resolved_candidate_id, 'codex-sol-xhigh');
});

test('nothing dispatchable holds before planning with per-pool reasons', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Explain one function');
  let planned = 0, executed = 0;
  const rows = [row('codex-a', 'openai_codex', 'gpt-5.7-sol', 'medium', {quota: null}),
    row('codex-b', 'openai_codex', 'gpt-5.7-sol', 'high', {availability: 'unavailable'}),
    row('claude-a', 'anthropic_shared', 'claude-opus-5-5', 'medium', {quota: 0})];
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, rows),
    plan: async () => { planned++; return plan(request, [graded('n', 'standard')]); },
    execute: async () => { executed++; throw Error('must not dispatch'); }});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const held = await wait(runtime, request);
  assert.equal(held.state, 'held');
  // Per pool, the reason of its REFERENCE rows (Codex: gpt-5.7-sol at high).
  assert.equal(held.error, 'no_dispatchable_candidate:anthropic_shared=quota_unknown_or_exhausted,' +
    'openai_codex=unavailable');
  assert.equal(planned, 0); assert.equal(executed, 0);
  // A lower model that could run does not count: nothing below the
  // reference is ever bound, so the hold comes before any planner call.
  const lowerOnly = task(dir, 'Explain another function');
  let lowerPlanned = 0;
  const lower = await createRCCRuntime({stateDir: join(dir, 'lower'),
    catalog: async value => catalog(value, [row('codex-top', 'openai_codex', 'gpt-5.7-sol', 'max', {quota: null}),
      row('codex-next', 'openai_codex', 'gpt-5.7-luna', 'max')]),
    plan: async () => { lowerPlanned++; return plan(lowerOnly, [graded('n', 'standard')]); },
    execute: async () => { executed++; throw Error('must not dispatch'); }});
  t.after(async () => { await lower.close(); });
  await lower.submit(lowerOnly);
  const lowerHeld = await wait(lower, lowerOnly);
  assert.equal(lowerHeld.error, 'no_dispatchable_candidate:openai_codex=quota_unknown_or_exhausted');
  assert.equal(lowerPlanned, 0); assert.equal(executed, 0);
  // A graded node in a scope with no dispatchable row holds with that scope.
  const write = task(dir, 'Change one file', 'auto', {write: true});
  const scoped = await createRCCRuntime({stateDir: join(dir, 'scoped'),
    catalog: async value => catalog(value, routingCatalog().filter(value => value.scope === 'read_only')),
    plan: async () => plan(write, [graded('n', 'standard', {scope: 'workspace_write', ownedPaths: ['**']})]),
    execute: async () => { executed++; throw Error('must not dispatch'); }});
  t.after(async () => { await scoped.close(); });
  await scoped.submit(write);
  const scopeHeld = await wait(scoped, write);
  assert.equal(scopeHeld.error, 'no_dispatchable_candidate:workspace_write'); assert.equal(executed, 0);
});

test('graded plan is resolved by the host and its routing decision is public', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Explain one function');
  const tickets = [];
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, routingCatalog()),
    plan: async () => plan(request, [graded('n', 'deep')]),
    execute: async ticket => { tickets.push(ticket); return execution(ticket); }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed');
  assert.equal(tickets[0].candidate_id, 'codex-sol-xhigh');
  assert.equal(tickets[0].selected_config.effort, 'xhigh');
  assert.equal(done.children[0].routing_decision.route_class, 'deep');
  assert.equal(done.children[0].routing_decision.resolved_candidate_id, 'codex-sol-xhigh');
  assert.deepEqual(Object.keys(done.children[0].routing_decision).sort(), ['effort', 'model', 'quota_pool',
    'quota_remaining_fraction', 'reason', 'resolved_candidate_id', 'route_class', 'surface']);
});

test('pre-dispatch failure re-resolves to another pool, at most twice, never for explicit or bound nodes', async t => {
  const dir = await fixture(t);
  // Refresh N makes every row before index N-2 unavailable: each chosen row
  // vanishes once, so the bound of two re-resolutions is what stops the node.
  // Only reference routes are candidates: Codex's top model m (a1), and
  // Anthropic's top model m as its chat row (b1) and agent row (b2). The
  // lower models a2/a3 are never bound.
  const rows = [row('a1', 'openai_codex', 'm', 'medium'),
    row('b1', 'anthropic_shared', 'm', 'medium', {surface: 'claude-chat'}), row('b2', 'anthropic_shared', 'm', 'medium'),
    row('a2', 'openai_codex', 'm2', 'medium'), row('a3', 'openai_codex', 'm3', 'medium')];
  const progressive = calls => rows.map((value, index) => index < calls - 1 ?
    {...value, availability: 'unavailable'} : value);
  const request = task(dir, 'Explain one function');
  let calls = 0, executed = 0;
  const runtime = await createRCCRuntime({stateDir: join(dir, 'bounded'),
    catalog: async value => { calls++; return catalog(value, progressive(calls)); },
    plan: async () => plan(request, [graded('n', 'standard')]),
    execute: async () => { executed++; throw Error('must not dispatch'); }});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const held = await wait(runtime, request);
  assert.equal(held.state, 'held'); assert.equal(held.error, 'candidate_unavailable');
  assert.equal(executed, 0);
  const events = runtime.events({schema: 1, task_id: request.task_id});
  const resolved = events.filter(x => x.kind === 'candidate_re_resolved');
  assert.equal(resolved.length, 2);
  assert.deepEqual(resolved.map(x => x.snapshot.children[0].candidate_id), ['b1', 'b2']);
  assert.equal(resolved[0].snapshot.children[0].routing_decision.reason,
    're_resolved_after:candidate_unavailable;other_pool;route_reference;pool_rank_1;effort_medium;chat_lane_same_route');
  assert.equal(resolved[1].snapshot.children[0].routing_decision.reason,
    're_resolved_after:candidate_unavailable;same_pool_only;route_reference;pool_rank_1;' +
    'skipped_pool_rank_0_reference_undispatchable;effort_medium;agent_surface');

  // One re-resolution that succeeds: exhausted Codex quota moves to Claude.
  const moved = task(dir, 'Explain another function');
  let moveCalls = 0; const dispatched = [];
  const mover = await createRCCRuntime({stateDir: join(dir, 'moved'),
    catalog: async value => { moveCalls++; return catalog(value, routingCatalog().map(value =>
      moveCalls > 1 && value.quota_pool === 'openai_codex' ? {...value, quota_remaining_fraction: 0} : value)); },
    plan: async () => plan(moved, [graded('n', 'standard')]),
    execute: async ticket => { dispatched.push(ticket.candidate_id); return execution(ticket); }, verifyTask: taskVerdict});
  t.after(async () => { await mover.close(); });
  await mover.submit(moved);
  const done = await wait(mover, moved);
  assert.equal(done.state, 'completed'); assert.deepEqual(dispatched, ['claude-opus-xhigh']);
  assert.match(done.children[0].routing_decision.reason, /^re_resolved_after:candidate_quota_unknown_or_exhausted;other_pool/);

  // Explicit route tests and adapter-bound nodes keep the old fail-closed hold.
  const explicit = task(dir, 'Route one probe', 'explicit_routing_test',
    {explicitRoutes: [{surface: 'codex', instruction: 'probe'}]});
  const explicitRows = [candidate('codex-x', 'codex'), candidate('codex-y', 'codex')];
  let explicitCalls = 0, explicitExecuted = 0;
  const fixed = await createRCCRuntime({stateDir: join(dir, 'explicit'),
    catalog: async value => { explicitCalls++; return catalog(value, explicitCalls > 1 ?
      [{...explicitRows[0], availability: 'unavailable'}, explicitRows[1]] : explicitRows); },
    plan: async () => plan(explicit, [node('n', 'codex-x', {instruction: 'probe'})]),
    execute: async () => { explicitExecuted++; throw Error('must not dispatch'); }});
  t.after(async () => { await fixed.close(); });
  await fixed.submit(explicit);
  const explicitHeld = await wait(fixed, explicit);
  assert.equal(explicitHeld.error, 'candidate_unavailable'); assert.equal(explicitExecuted, 0);
  assert.equal(fixed.events({schema: 1, task_id: explicit.task_id}).some(x => x.kind === 'candidate_re_resolved'), false);
  const bound = task(dir, 'Bound adapter node');
  let boundCalls = 0;
  const adapter = await createRCCRuntime({stateDir: join(dir, 'bound'),
    catalog: async value => { boundCalls++; return catalog(value, boundCalls > 1 ?
      [{...explicitRows[0], availability: 'unavailable'}, explicitRows[1]] : explicitRows); },
    plan: async () => plan(bound, [node('n', 'codex-x')]),
    execute: async () => { throw Error('must not dispatch'); }});
  t.after(async () => { await adapter.close(); });
  await adapter.submit(bound);
  assert.equal((await wait(adapter, bound)).error, 'candidate_unavailable');
});

test('verified not-dispatched quota rejection re-resolves to the other pool without the planner', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Explain one function');
  const rows = [row('claude-opus-medium', 'anthropic_shared', 'claude-opus-5-5', 'medium'),
    row('codex-sol-medium', 'openai_codex', 'gpt-5.7-sol', 'medium')];
  let planned = 0; const dispatched = [];
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, rows),
    plan: async () => { planned++; return plan(request, [graded('n', 'standard')]); },
    execute: async ticket => {
      dispatched.push(ticket.candidate_id);
      if (ticket.selected_config.quota_pool === 'anthropic_shared') return execution(ticket, {status: 'failed',
        dispatch_stage: 'not_dispatched', side_effects: 'none', output: null,
        execution_verified: false, task_verified: false, task_quality: 'failed',
        error: 'provider_quota_rejected_before_execution',
        native_receipt: '/private/fixture/no-effect-' + ticket.attempt_id,
        acknowledged_config: null, observed_config: null});
      return execution(ticket);
    }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed');
  assert.deepEqual(dispatched, ['claude-opus-medium', 'codex-sol-medium']);
  assert.equal(planned, 1, 'the planner never re-chooses a host-resolved row');
  assert.match(done.children[0].routing_decision.reason,
    /^re_resolved_after:provider_quota_rejected_before_execution;other_pool/);
});

// S7: the Swift adapter reports a Claude quota rejection its own stream places
// before any work, on a read-only attempt with an unchanged workspace, as
// not_dispatched/none with this typed reason, and leaves a cooldown so the
// next catalog has no Claude row. A write keeps the effects-uncertain report.
const quotaRejected = ticket => execution(ticket, {status: 'failed', dispatch_stage: 'not_dispatched',
  side_effects: 'none', output: "You've hit your weekly limit", execution_verified: false, task_verified: false,
  task_quality: 'failed', error: 'provider_quota_rejected_before_execution',
  native_receipt: '/private/fixture/quota-' + ticket.attempt_id,
  acknowledged_config: ticket.selected_config, observed_config: null});

test('pre-execution quota rejection: read-only moves to the other pool, a dispatched write stays effects_uncertain', async t => {
  const dir = await fixture(t);
  const read = task(dir, 'Explain one function');
  const readRows = [row('claude-opus-medium', 'anthropic_shared', 'claude-opus-5-5', 'medium'),
    row('codex-sol-medium', 'openai_codex', 'gpt-5.7-sol', 'medium')];
  let cooled = false, planned = 0; const dispatched = [];
  const reader = await createRCCRuntime({stateDir: join(dir, 'read'),
    // After the rejection the host's cooldown removes Claude and says why.
    catalog: async value => cooled ? {...catalog(value, readRows.filter(r => r.quota_pool === 'openai_codex')),
      exclusions: [{provider: 'claude', reason: 'quota_backoff', count: 1}]} : catalog(value, readRows),
    plan: async () => { planned++; return plan(read, [graded('n', 'standard')]); },
    execute: async ticket => {
      dispatched.push(ticket.candidate_id);
      if (ticket.selected_config.quota_pool !== 'anthropic_shared') return execution(ticket);
      cooled = true; return quotaRejected(ticket);
    }, verifyTask: taskVerdict});
  t.after(async () => { await reader.close(); });
  await reader.submit(read);
  const done = await wait(reader, read);
  assert.equal(done.state, 'completed');
  assert.deepEqual(dispatched, ['claude-opus-medium', 'codex-sol-medium']);
  assert.equal(planned, 1, 'the planner never re-chooses a host-resolved row');
  assert.equal(done.children[0].routing_decision.quota_pool, 'openai_codex');
  assert.equal(done.children[0].routing_decision.reason,
    're_resolved_after:provider_quota_rejected_before_execution;other_pool;route_reference;pool_rank_0;effort_medium;agent_surface');
  const events = reader.events({schema: 1, task_id: read.task_id});
  assert.equal(events.filter(x => x.kind === 'candidate_re_resolved').length, 1);
  assert.equal(events.some(x => x.kind === 'child_effects_uncertain' || x.kind === 'dispatch_effects_uncertain'), false);

  // A model-scoped cooldown removes only the rejected family. Its row is gone
  // from the refreshed catalog, yet the node still moves to the OTHER pool
  // rather than to the next Anthropic model that still ranks first.
  const scoped = task(dir, 'Explain another function');
  const scopedRows = [row('claude-opus-medium', 'anthropic_shared', 'claude-opus-5-5', 'medium'),
    row('claude-sonnet-medium', 'anthropic_shared', 'claude-sonnet-5', 'medium'),
    row('codex-sol-medium', 'openai_codex', 'gpt-5.7-sol', 'medium')];
  let familyCooled = false; const scopedDispatched = [];
  const familyRuntime = await createRCCRuntime({stateDir: join(dir, 'family'),
    catalog: async value => familyCooled ? {...catalog(value, scopedRows.slice(1)),
      exclusions: [{provider: 'claude', reason: 'quota_backoff', count: 1}]} : catalog(value, scopedRows),
    plan: async () => plan(scoped, [graded('n', 'standard')]),
    execute: async ticket => {
      scopedDispatched.push(ticket.candidate_id);
      if (ticket.candidate_id !== 'claude-opus-medium') return execution(ticket);
      familyCooled = true; return quotaRejected(ticket);
    }, verifyTask: taskVerdict});
  t.after(async () => { await familyRuntime.close(); });
  await familyRuntime.submit(scoped);
  const familyDone = await wait(familyRuntime, scoped);
  assert.equal(familyDone.state, 'completed');
  assert.deepEqual(scopedDispatched, ['claude-opus-medium', 'codex-sol-medium']);
  assert.equal(familyDone.children[0].routing_decision.reason,
    're_resolved_after:provider_quota_rejected_before_execution;other_pool;route_reference;pool_rank_1;effort_medium;agent_surface');

  // A dispatched write that hit the quota keeps today's report: effects are
  // uncertain, nothing is re-dispatched and no other pool is tried.
  const write = task(dir, 'Change one file', 'auto', {write: true});
  const writeRows = [row('claude-opus-write', 'anthropic_shared', 'claude-opus-5-5', 'medium',
    {scope: 'workspace_write', allowedPaths: ['**']}),
  row('codex-sol-write', 'openai_codex', 'gpt-5.7-sol', 'medium', {scope: 'workspace_write', allowedPaths: ['**']})];
  let writes = 0;
  const writer = await createRCCRuntime({stateDir: join(dir, 'write'),
    catalog: async value => catalog(value, writeRows),
    plan: async () => plan(write, [graded('n', 'standard', {scope: 'workspace_write', ownedPaths: ['**']})]),
    execute: async ticket => { writes++; return execution(ticket, {status: 'effects_uncertain',
      dispatch_stage: 'dispatched', side_effects: 'possible', output: "You've hit your weekly limit",
      execution_verified: false, task_verified: false, task_quality: 'failed',
      error: 'native_outcome_uncertain_preserved', native_receipt: '/private/fixture/write-' + ticket.attempt_id,
      acknowledged_config: ticket.selected_config, observed_config: null}); }});
  t.after(async () => { await writer.close(); });
  await writer.submit(write);
  const uncertain = await wait(writer, write);
  assert.equal(uncertain.state, 'effects_uncertain');
  assert.equal(uncertain.error, 'dispatched_failure_no_replay');
  assert.equal(writes, 1);
  assert.equal(writer.events({schema: 1, task_id: write.task_id}).some(x => x.kind === 'candidate_re_resolved'), false);

  // The reason never launders a write: a write-scope report that claims it is
  // refused as an invalid receipt and stays effects_uncertain, never replayed.
  const forged = task(dir, 'Change another file', 'auto', {write: true});
  let forgedRuns = 0;
  const strict = await createRCCRuntime({stateDir: join(dir, 'forged'),
    catalog: async value => catalog(value, writeRows),
    plan: async () => plan(forged, [graded('n', 'standard', {scope: 'workspace_write', ownedPaths: ['**']})]),
    execute: async ticket => { forgedRuns++; return quotaRejected(ticket); }});
  t.after(async () => { await strict.close(); });
  await strict.submit(forged);
  const refused = await wait(strict, forged);
  assert.equal(refused.state, 'effects_uncertain');
  assert.equal(refused.error, 'execution_receipt_invalid');
  assert.equal(forgedRuns, 1);
  assert.equal(strict.events({schema: 1, task_id: forged.task_id}).some(x => x.kind === 'candidate_re_resolved'), false);
});

test('quota_backoff is an accepted exclusion reason; an all-cooled catalog holds with it', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Explain one function', 'auto', {provider: 'claude'});
  let executed = 0;
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => ({...catalog(value, []), exclusions: [{provider: 'claude', reason: 'quota_backoff', count: 5}]}),
    plan: async () => { throw Error('must not plan'); },
    execute: async () => { executed++; throw Error('must not dispatch'); }});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const held = await wait(runtime, request);
  assert.equal(held.state, 'held');
  assert.equal(held.error, 'no_routable_candidate:quota_backoff');
  assert.equal(executed, 0);
});

test('adapter-bound subset repair validates against the refreshed catalog', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Read current project status');
  let calls = 0, executions = 0;
  const runtime = await createRCCRuntime({stateDir: dir,
    // The alternate appears only in the refresh made by the subset repair.
    catalog: async value => { calls++; return catalog(value, calls >= 3 ?
      [candidate('a'), candidate('b')] : [candidate('a')]); },
    plan: async ({repair}) => plan(request, [node('only', repair ? 'b' : 'a')]),
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
  assert.equal(result.state, 'completed', result.error);
  assert.equal(result.children[0].candidate_id, 'b'); assert.equal(executions, 2);
  assert.equal(result.children[0].routing_decision.resolved_candidate_id, 'b');
});

test('graded nodes on one pool never overlap; waiting nodes do not re-probe the catalog', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Inspect three independent files');
  let catalogCalls = 0, active = 0, peak = 0, executed = 0;
  // One admitted pool only: the second pool's spreading (below) cannot apply.
  const codexOnly = routingCatalog().filter(value => value.quota_pool === 'openai_codex');
  const runtime = await createRCCRuntime({stateDir: dir, maximumWorkers: 4,
    catalog: async value => { catalogCalls++; return catalog(value, codexOnly); },
    plan: async () => plan(request, [graded('a', 'standard'), graded('b', 'standard'), graded('c', 'trivial')]),
    execute: async ticket => {
      executed++; active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 150)); active--;
      return execution(ticket);
    }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed'); assert.equal(executed, 3); assert.equal(peak, 1);
  assert.ok(done.children.every(child => child.selected_config.quota_pool === 'openai_codex'));
  // One initial read and one refresh per dispatch; none while the pool is busy.
  assert.ok(catalogCalls <= 4, `catalog calls ${catalogCalls}`);
});

test('independent graded nodes spread to the idle second pool, one lease per pool, no extra probe', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Inspect three independent files');
  let catalogCalls = 0, executed = 0;
  const running = new Map(); let overlap = 0, peak = 0;
  const runtime = await createRCCRuntime({stateDir: dir, maximumWorkers: 4,
    catalog: async value => { catalogCalls++; return catalog(value, routingCatalog()); },
    plan: async () => plan(request, [graded('a', 'standard'), graded('b', 'standard'), graded('c', 'trivial')]),
    execute: async ticket => {
      executed++;
      const pool = ticket.selected_config.quota_pool;
      if (running.get(pool)) overlap++;
      running.set(pool, (running.get(pool) ?? 0) + 1);
      peak = Math.max(peak, [...running.values()].reduce((a, b) => a + b, 0));
      await new Promise(resolve => setTimeout(resolve, 150));
      running.set(pool, running.get(pool) - 1);
      return execution(ticket);
    }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed'); assert.equal(executed, 3);
  assert.equal(overlap, 0, 'never two attempts on one pool at once');
  assert.equal(peak, 2, 'the idle Anthropic pool took one independent node');
  const byID = Object.fromEntries(done.children.map(child => [child.id, child]));
  assert.equal(byID.a.selected_config.quota_pool, 'openai_codex');
  assert.equal(byID.b.selected_config.quota_pool, 'anthropic_shared');
  assert.match(byID.b.routing_decision.reason, /^spread_for_parallelism;other_pool;/);
  assert.ok(catalogCalls <= 4, `catalog calls ${catalogCalls}`);
  const events = runtime.events({schema: 1, task_id: request.task_id});
  assert.ok(events.filter(x => x.kind === 'candidate_spread_across_pools').length >= 1);
  assert.equal(events.some(x => x.kind === 'candidate_re_resolved'), false, 'spreading is not a failure re-resolution');
});

test('a failed native catalog probe before dispatch is retried, and bounded', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Explain one function');
  let calls = 0;
  const runtime = await createRCCRuntime({stateDir: join(dir, 'transient'),
    catalog: async value => { calls++; if (calls === 2) throw Error('native_operation_failed');
      return catalog(value, routingCatalog()); },
    plan: async () => plan(request, [graded('n', 'standard')]),
    execute: async ticket => execution(ticket), verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  assert.equal((await wait(runtime, request)).state, 'completed');
  const failing = task(dir, 'Explain another function');
  let failingCalls = 0, executed = 0;
  const stuck = await createRCCRuntime({stateDir: join(dir, 'persistent'),
    catalog: async value => { failingCalls++; if (failingCalls > 1) throw Error('native_operation_failed');
      return catalog(value, routingCatalog()); },
    plan: async () => plan(failing, [graded('n', 'standard')]),
    execute: async () => { executed++; throw Error('must not dispatch'); }});
  t.after(async () => { await stuck.close(); });
  await stuck.submit(failing);
  const held = await wait(stuck, failing);
  assert.equal(held.error, 'catalog_refresh_failed'); assert.equal(executed, 0);
  assert.equal(failingCalls, 4);
});

// ---- Review fixes (2026-10-13) ------------------------------------------
const shortLived = (value, ms) => ({...value, availability_valid_until_ms: Date.now() + ms,
  quota_valid_until_ms: value.quota_valid_until_ms === null ? null : Date.now() + ms});

test('a slow planner never changes the pool or holds: rows are ranked at the catalog bind time', async t => {
  const dir = await fixture(t);
  const rows = () => [row('claude-opus-medium', 'anthropic_shared', 'claude-opus-5-5', 'medium'),
    row('codex-sol-medium', 'openai_codex', 'gpt-5.7-sol', 'medium')];
  for (const [name, shorten] of [
    // A cached Claude quota leaves the first-ranked pool a short window.
    ['first pool short', value => value.quota_pool === 'anthropic_shared'],
    // Every row's window lapses while the local planner is still running.
    ['every row short', () => true]]) {
    const request = task(dir, 'Explain one function ' + name);
    let calls = 0; const dispatched = [];
    const runtime = await createRCCRuntime({stateDir: join(dir, name.replace(/ /g, '-')),
      catalog: async value => { calls++; return catalog(value, calls === 1 ?
        rows().map(item => shorten(item) ? shortLived(item, 250) : item) : rows()); },
      plan: async () => { await new Promise(resolve => setTimeout(resolve, 500));
        return plan(request, [graded('n', 'standard')]); },
      execute: async ticket => { dispatched.push(ticket.candidate_id); return execution(ticket); },
      verifyTask: taskVerdict});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request);
    const done = await wait(runtime, request);
    assert.equal(done.state, 'completed', `${name}: ${done.error}`);
    assert.deepEqual(dispatched, ['claude-opus-medium'], name);
    // The single node's planner text is replaced by the owner's request.
    assert.equal(done.children[0].routing_decision.reason,
      'resolver;route_reference;pool_rank_0;effort_medium;agent_surface;instruction_host_locked', name);
    assert.ok(calls >= 2, 'the dispatch-time refresh still re-checks freshness');
  }
});

test('legacy explicit snapshots recover requested_surface from the original GPT-including route list', async t => {
  const dir = await fixture(t);
  for (const [name, routes] of [
    ['mixed', [{surface: 'chatgpt', instruction: '1+1'}, {surface: 'codex', instruction: '2+2'},
      {surface: 'claude', instruction: '3+3'}, {surface: 'claude-chat', instruction: '4+4'}]],
    // A repeated instruction must not shift a later ordinal onto the GPT route.
    ['repeated', [{surface: 'chatgpt', instruction: '2+2'}, {surface: 'codex', instruction: '2+2'}]]]) {
    const request = task(dir, 'Route probes ' + name, 'explicit_routing_test', {explicitRoutes: routes});
    const stateDir = join(dir, name);
    const first = await createRCCRuntime({stateDir,
      catalog: async () => { throw Error('catalog offline'); }});
    await first.submit(request);
    const held = await wait(first, request);
    assert.equal(held.state, 'held');
    // A new hold shows only the routes that would still run, labelled.
    assert.deepEqual(held.children.map(child => child.requested_surface),
      routes.filter(route => route.surface !== 'chatgpt').map(route => route.surface));
    await first.close();
    // The pre-field shape: one child per ORIGINAL route, no display field.
    const db = new DatabaseSync(join(stateDir, 'rcc-runtime.sqlite'));
    const legacy = JSON.parse(db.prepare('SELECT snapshot FROM tasks WHERE task_id=?').get(request.task_id).snapshot);
    const template = legacy.children[0];
    legacy.children = routes.map((route, index) => {
      const child = {...template, id: `requested-${index + 1}`, instruction: route.instruction};
      delete child.requested_surface;
      return child;
    });
    db.prepare('UPDATE tasks SET snapshot=? WHERE task_id=?').run(JSON.stringify(legacy), request.task_id);
    db.close();
    const reopened = await createRCCRuntime({stateDir});
    t.after(async () => { await reopened.close(); });
    const status = reopened.status({schema: 1, task_id: request.task_id});
    assert.deepEqual(status.children.map(child => child.requested_surface), routes.map(route => route.surface), name);
  }
});

test('a graded writer that names concrete paths binds the whole-workspace native row; overlapping writers serialize', async t => {
  const dir = await fixture(t);
  const writeRow = (id, pool, model) => row(id, pool, model, 'medium', {scope: 'workspace_write', allowedPaths: ['**']});
  const rows = [writeRow('codex-write', 'openai_codex', 'gpt-5.7-sol'),
    writeRow('claude-write', 'anthropic_shared', 'claude-opus-5-5'),
    row('codex-read', 'openai_codex', 'gpt-5.7-sol', 'medium')];
  const request = task(dir, 'Fix the bug in Sources/OS1/main.swift', 'auto', {write: true});
  // Pure resolution: the concrete path widens to the row's real authority.
  const pure = resolveRoutePlan(plan(request, [graded('w', 'standard',
    {scope: 'workspace_write', ownedPaths: ['Sources/OS1/main.swift']})]), request, catalog(request, rows), Date.now());
  assert.deepEqual(pure.plan.nodes[0].owned_paths, ['**']);
  assert.equal(pure.plan.nodes[0].candidate_id, 'codex-write');
  assert.match(pure.decisions.w.reason, /owned_paths_workspace/);
  assert.throws(() => resolveRoutePlan(plan(request, [graded('w', 'standard',
    {scope: 'workspace_write', ownedPaths: ['.']})]), request, catalog(request, rows), Date.now()), /plan_node_invalid/);

  const tickets = [];
  let active = 0, peak = 0;
  const runtime = await createRCCRuntime({stateDir: join(dir, 'writers'),
    catalog: async value => catalog(value, rows),
    plan: async () => plan(request, [
      graded('first', 'standard', {scope: 'workspace_write', ownedPaths: ['Sources/OS1/main.swift']}),
      graded('second', 'standard', {scope: 'workspace_write', ownedPaths: ['Sources/OS1App/OS1App.swift']})]),
    execute: async ticket => {
      tickets.push(ticket); active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 60)); active--;
      return execution(ticket);
    }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed', done.error);
  assert.equal(tickets.length, 2); assert.equal(peak, 1);
  assert.ok(tickets.every(ticket => JSON.stringify(ticket.owned_paths) === '["**"]'));
  const second = done.children.find(child => child.id === 'second');
  assert.deepEqual(second.dependencies, ['first']);
  assert.match(second.routing_decision.reason, /workspace_writer_serialized/);
});

test('a repaired node validates against fresh rows while siblings keep the rows they were admitted with', async t => {
  const dir = await fixture(t);
  // Drain: a completes on Codex and exhausts it; b (after a) moves to Claude.
  const drainRows = [row('codex-a', 'openai_codex', 'gpt-5.7-sol', 'medium'),
    row('claude-b', 'anthropic_shared', 'claude-opus-5-5', 'medium')];
  const drained = task(dir, 'Explain two dependent functions');
  let codexSpent = false; const drainDispatched = [];
  const drain = await createRCCRuntime({stateDir: join(dir, 'drain'),
    catalog: async value => catalog(value, codexSpent ? drainRows.slice(1) : drainRows),
    plan: async () => plan(drained, [graded('a', 'standard'), graded('b', 'standard', {dependencies: ['a']})]),
    execute: async ticket => { drainDispatched.push(ticket.candidate_id); codexSpent = true; return execution(ticket); },
    verifyTask: taskVerdict});
  t.after(async () => { await drain.close(); });
  await drain.submit(drained);
  const drainDone = await wait(drain, drained);
  assert.equal(drainDone.state, 'completed', drainDone.error);
  assert.deepEqual(drainDispatched, ['codex-a', 'claude-b']);

  // A pre-execution quota rejection cools the Claude row both nodes share.
  const rows = [row('claude-opus-medium', 'anthropic_shared', 'claude-opus-5-5', 'medium'),
    row('codex-sol-medium', 'openai_codex', 'gpt-5.7-sol', 'medium')];
  const request = task(dir, 'Explain another two functions');
  let cooled = false; const dispatched = [];
  const runtime = await createRCCRuntime({stateDir: join(dir, 'cooled'),
    catalog: async value => cooled ? {...catalog(value, rows.slice(1)),
      exclusions: [{provider: 'claude', reason: 'quota_backoff', count: 1}]} : catalog(value, rows),
    plan: async () => plan(request, [graded('a', 'standard'), graded('b', 'standard', {dependencies: ['a']})]),
    execute: async ticket => {
      dispatched.push(ticket.candidate_id);
      if (ticket.selected_config.quota_pool !== 'anthropic_shared') return execution(ticket);
      cooled = true; return quotaRejected(ticket);
    }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed', done.error);
  assert.deepEqual(dispatched, ['claude-opus-medium', 'codex-sol-medium', 'codex-sol-medium']);
  assert.ok(done.children.every(child => child.selected_config.quota_pool === 'openai_codex'));
});

test('pre-execution quota rejections are not charged to the attempt budget, and stay bounded', async t => {
  const dir = await fixture(t);
  // Three reference routes: Anthropic's top model as its chat row and its
  // agent row (same model and effort), and Codex's top model.
  const rows = [row('claude-opus-chat', 'anthropic_shared', 'claude-opus-5-5', 'medium', {surface: 'claude-chat'}),
    row('claude-opus-medium', 'anthropic_shared', 'claude-opus-5-5', 'medium'),
    row('codex-sol-medium', 'openai_codex', 'gpt-5.7-sol', 'medium')];
  for (const [name, rejections, state, error, count] of [
    ['two then success', 2, 'completed', null, 3],
    ['always rejected', 9, 'failed', 'verified_not_dispatched_re_resolution_exhausted', 3]]) {
    const request = task(dir, 'Explain one function ' + name);
    const dispatched = [];
    const runtime = await createRCCRuntime({stateDir: join(dir, name.replace(/ /g, '-')),
      catalog: async value => catalog(value, rows),
      plan: async () => plan(request, [graded('n', 'standard')]),
      execute: async ticket => { dispatched.push(ticket.candidate_id);
        return dispatched.length <= rejections ? quotaRejected(ticket) : execution(ticket); },
      verifyTask: taskVerdict});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request);
    const done = await wait(runtime, request);
    assert.equal(done.state, state, `${name}: ${done.error}`);
    assert.equal(done.error, error, name);
    assert.equal(dispatched.length, count, name);
    assert.equal(new Set(dispatched).size, dispatched.length, `${name}: never the same row twice`);
  }
  // An adapter-bound node gets one free quota attempt, like the legacy runner.
  const bound = task(dir, 'Bound node quota');
  const boundRows = [candidate('a'), candidate('b'), candidate('c')];
  const boundDispatched = [];
  const adapter = await createRCCRuntime({stateDir: join(dir, 'bound'),
    catalog: async value => catalog(value, boundRows),
    plan: async ({repair}) => plan(bound, [node('only', !repair ? 'a' :
      boundDispatched.length === 1 ? 'b' : 'c')]),
    execute: async ticket => { boundDispatched.push(ticket.candidate_id); return quotaRejected(ticket); }});
  t.after(async () => { await adapter.close(); });
  await adapter.submit(bound);
  const boundDone = await wait(adapter, bound);
  assert.equal(boundDone.state, 'failed'); assert.equal(boundDone.error, 'verified_not_dispatched_retry_exhausted');
  assert.deepEqual(boundDispatched, ['a', 'b', 'c'], 'budget 2 charged attempts plus one free quota rejection');
  // When both pools' references were rejected, a lower model is never the
  // fallback: the node holds visibly instead of running below the reference.
  const lowerRows = [row('claude-opus-medium', 'anthropic_shared', 'claude-opus-5-5', 'medium'),
    row('claude-sonnet-medium', 'anthropic_shared', 'claude-sonnet-5', 'medium'),
    row('codex-sol-medium', 'openai_codex', 'gpt-5.7-sol', 'medium')];
  const noLower = task(dir, 'Explain one function without a lower model');
  const lowerDispatched = [];
  const lowerRuntime = await createRCCRuntime({stateDir: join(dir, 'no-lower'),
    catalog: async value => catalog(value, lowerRows),
    plan: async () => plan(noLower, [graded('n', 'deep')]),
    execute: async ticket => { lowerDispatched.push(ticket.candidate_id); return quotaRejected(ticket); }});
  t.after(async () => { await lowerRuntime.close(); });
  await lowerRuntime.submit(noLower);
  const lowerHeld = await wait(lowerRuntime, noLower);
  assert.equal(lowerHeld.state, 'held'); assert.equal(lowerHeld.error, 'no_dispatchable_candidate:read_only');
  assert.deepEqual(lowerDispatched, ['claude-opus-medium', 'codex-sol-medium']);
});

test('an explicit route held as unavailable names the catalog exclusions for that provider', async t => {
  const dir = await fixture(t);
  const routes = [{surface: 'codex', instruction: '1+1'}, {surface: 'claude', instruction: '2+2'}];
  const request = task(dir, 'Route two probes', 'explicit_routing_test', {explicitRoutes: routes});
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => ({...catalog(value, [candidate('claude-code', 'claude', 'anthropic_shared')]),
      exclusions: [{provider: 'codex', reason: 'capacity_zero', count: 2},
        {provider: 'codex', reason: 'signed_out', count: 1}]}),
    plan: async () => { throw Error('must hold before planning'); }});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const held = await wait(runtime, request);
  assert.equal(held.state, 'held');
  assert.equal(held.error, 'explicit_route_surface_unavailable:codex:capacity_zero+signed_out');
});

// ---- Review fixes, second round (2026-10-13) -------------------------------
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('the pool reference is its first model in catalog order, for alias and full-ID names alike', () => {
  const request = task('/tmp', 'Reference per native model', 'auto');
  const now = Date.now();
  const pick = (rows, routeClass) => {
    const decision = resolveRoutePlan(plan(request, [graded('n', routeClass)]), request,
      catalog(request, rows), now).decisions.n;
    return `${decision.model}/${decision.effort}`;
  };
  const classes = ['trivial', 'standard', 'deep'];
  // Production Claude profiles: the alias and the resolved ID of one native
  // model carry different effort sets. The native builder lists the names of
  // one native row together, the name with the highest reference effort
  // first, so that name carries the native row's reference.
  const sonnet = [row('s-full-low', 'anthropic_shared', 'claude-sonnet-5-5', 'low'),
    row('s-full-xhigh', 'anthropic_shared', 'claude-sonnet-5-5', 'xhigh'),
    row('s-alias-medium', 'anthropic_shared', 'sonnet', 'medium')];
  assert.deepEqual(classes.map(value => pick(sonnet, value)),
    ['claude-sonnet-5-5/xhigh', 'claude-sonnet-5-5/xhigh', 'claude-sonnet-5-5/xhigh']);
  const opus = [row('o-alias-max', 'anthropic_shared', 'opus', 'max'),
    row('o-full-low', 'anthropic_shared', 'claude-opus-5-5', 'low'),
    row('o-full-xhigh', 'anthropic_shared', 'claude-opus-5-5', 'xhigh')];
  assert.deepEqual(classes.map(value => pick(opus, value)), ['opus/max', 'opus/max', 'opus/max']);
  // Different models: the most-preferred model, never a lower model because
  // it offers some other effort.
  const mixed = [row('sonnet-medium', 'anthropic_shared', 'sonnet', 'medium'),
    row('fable-low', 'anthropic_shared', 'fable', 'low'), row('fable-xhigh', 'anthropic_shared', 'fable', 'xhigh'),
    row('opus-xhigh', 'anthropic_shared', 'claude-opus-5-5', 'xhigh')];
  assert.deepEqual(classes.map(value => pick(mixed, value)), ['sonnet/medium', 'sonnet/medium', 'sonnet/medium']);
  // Pool order decides between pools; each pool brings only its reference.
  const pools = [row('codex-low', 'openai_codex', 'gpt-5.7-sol', 'low'),
    row('codex-max', 'openai_codex', 'gpt-5.7-sol', 'max'),
    row('claude-xhigh', 'anthropic_shared', 'claude-opus-5-5', 'xhigh')];
  assert.deepEqual(classes.map(value => pick(pools, value)), ['gpt-5.7-sol/max', 'gpt-5.7-sol/max', 'gpt-5.7-sol/max']);
});

test('a row that left the catalog re-resolves at once instead of waiting behind another task on its old pool', async t => {
  const dir = await fixture(t);
  const holder = task(dir, 'Hold the Claude pool');
  const request = task(dir, 'Change one file and explain another', 'auto', {write: true});
  const claudeRead = row('claude-read', 'anthropic_shared', 'claude-opus-5-5', 'medium');
  const codexRead = row('codex-read', 'openai_codex', 'gpt-5.7-sol', 'medium');
  const codexWrite = row('codex-write', 'openai_codex', 'gpt-5.7-sol', 'medium',
    {scope: 'workspace_write', allowedPaths: ['**']});
  let calls = 0, holderRunning = false, t0 = 0;
  const started = {};
  let releaseHolder; const holderGate = new Promise(resolve => { releaseHolder = resolve; });
  const runtime = await createRCCRuntime({stateDir: join(dir, 'state'), maximumWorkers: 4,
    catalog: async value => {
      if (value.task_id === holder.task_id) return catalog(value, [claudeRead]);
      calls++;
      // After the bind read the host drops the Claude row (quota_backoff).
      return catalog(value, calls === 1 ? [claudeRead, codexRead, codexWrite] : [codexRead, codexWrite]);
    },
    plan: async ({task: value}) => value.task_id === holder.task_id ? plan(holder, [graded('h', 'standard')]) :
      plan(request, [graded('w', 'standard', {scope: 'workspace_write', ownedPaths: ['**']}), graded('r', 'standard')]),
    execute: async ticket => {
      if (ticket.task_id === holder.task_id) { holderRunning = true; await holderGate; return execution(ticket); }
      started[ticket.node_id] = {at: Date.now() - t0, pool: ticket.selected_config.quota_pool};
      await sleep(50);
      return execution(ticket);
    }, verifyTask: taskVerdict});
  t.after(async () => { releaseHolder(); await runtime.close(); });
  await runtime.submit(holder);
  for (let i = 0; i < 200 && !holderRunning; i++) await sleep(10);
  assert.ok(holderRunning, 'the other task holds the Claude pool');
  t0 = Date.now();
  setTimeout(releaseHolder, 2_500);
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed', done.error);
  assert.equal(started.r.pool, 'openai_codex');
  assert.ok(started.r.at < 1_500, `r waited ${started.r.at} ms behind the other task's lease on the pool it left`);
  const r = done.children.find(child => child.id === 'r');
  assert.match(r.routing_decision.reason, /^re_resolved_after:candidate_missing;other_pool;/);
});

test('a node that spread moves on when another task takes its new pool, instead of waiting for that task', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Inspect two independent files');
  const other = task(dir, 'Inspect one more file');
  const claudeRows = routingCatalog().filter(value => value.quota_pool === 'anthropic_shared');
  let calls = 0, t0 = Date.now();
  const started = {};
  let releaseOther; const otherGate = new Promise(resolve => { releaseOther = resolve; });
  const runtime = await createRCCRuntime({stateDir: join(dir, 'state'), maximumWorkers: 4,
    catalog: async value => {
      if (value.task_id === other.task_id) return catalog(value, claudeRows);
      // A slow native refresh: the window in which another task can take
      // the pool this node just moved to.
      if (++calls > 1) await sleep(500);
      return catalog(value, routingCatalog());
    },
    plan: async ({task: value}) => {
      if (value.task_id !== other.task_id) return plan(request, [graded('a', 'standard'), graded('b', 'standard')]);
      await sleep(750);
      return plan(other, [graded('z', 'standard')]);
    },
    execute: async ticket => {
      const id = ticket.task_id === other.task_id ? 'z' : ticket.node_id;
      started[id] = {at: Date.now() - t0, pool: ticket.selected_config.quota_pool};
      if (id === 'z') { await otherGate; return execution(ticket); }
      await sleep(500);
      return execution(ticket);
    }, verifyTask: taskVerdict});
  t.after(async () => { releaseOther(); await runtime.close(); });
  t0 = Date.now();
  await runtime.submit(request);
  await runtime.submit(other);
  setTimeout(releaseOther, 4_000);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed', done.error);
  assert.equal(started.z.pool, 'anthropic_shared');
  assert.ok(started.z.at < started.b.at, 'the other task took the pool b had moved to');
  assert.equal(started.a.pool, 'openai_codex');
  assert.equal(started.b.pool, 'openai_codex', 'b moved back to the pool that became free');
  assert.ok(started.b.at < 3_000, `b waited ${started.b.at} ms for the other task`);
  const b = done.children.find(child => child.id === 'b');
  assert.match(b.routing_decision.reason, /^spread_for_parallelism;other_pool;/);
  const events = runtime.events({schema: 1, task_id: request.task_id});
  assert.equal(events.filter(x => x.kind === 'candidate_spread_across_pools').length, 2);
  assert.equal(events.some(x => x.kind === 'candidate_re_resolved'), false);
});

test('spreading still works after the bound rows outlive their validity window: one refresh, not one per wait', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Inspect three files, one after another');
  let calls = 0, t0 = Date.now();
  const started = {};
  const runtime = await createRCCRuntime({stateDir: dir, maximumWorkers: 4,
    // Every native read is valid for 400 ms only.
    catalog: async value => { calls++; return catalog(value, routingCatalog().map(item => shortLived(item, 400))); },
    plan: async () => plan(request, [graded('a', 'standard'), graded('x', 'standard'),
      graded('c', 'standard', {dependencies: ['x']})]),
    execute: async ticket => {
      started[ticket.node_id] = {at: Date.now() - t0, pool: ticket.selected_config.quota_pool};
      await sleep(ticket.node_id === 'a' ? 2_500 : 700);
      return execution(ticket);
    }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  t0 = Date.now();
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed', done.error);
  assert.equal(started.a.pool, 'openai_codex');
  assert.equal(started.x.pool, 'anthropic_shared');
  // c became ready when x finished, long after the last refresh's rows
  // expired, while a still held Codex and the Anthropic pool was idle.
  assert.equal(started.c.pool, 'anthropic_shared');
  assert.ok(started.c.at < 2_000, `c started at ${started.c.at} ms, behind a`);
  // Bind, a, x, the one spread re-check for c, and c's dispatch.
  assert.ok(calls <= 5, `catalog calls ${calls}`);
});

// ---- REVAS ladder gate and routing ledger (2026-10-13) ---------------------
// A cheaper effort is admitted only with a registered task verifier for the
// family and ledger parity. Production registers no verifier, so every node
// runs its reference route; these fixtures use a fake registry and fake stats.
const parity = (passes, failures = 0) => () => ({verified_passes: passes, verifier_failures: failures});
const registry = (...families) => new Map(families.map(family => [family, async () => ({passed: true, reason: 'fake'})]));

test('cheaperRouteAdmission never admits without a verifier, without 20 passes, or with any failure', () => {
  const family = routeFamily('standard', 'read_only', 'claude-chat');
  assert.equal(family, 'standard:read_only:chat');
  assert.equal(routeFamily(null, 'workspace_write', 'codex'), 'unclassified:workspace_write:agent');
  assert.equal(LADDER_MIN_VERIFIED_PASSES, 20);
  const base = {family, scope: 'read_only', model: 'claude-opus-5-5', referenceEffort: 'max',
    cheaperEfforts: ['low', 'medium', 'max', 'ultra'], verifierRegistry: registry(family), ledgerStats: parity(20)};
  assert.deepEqual(cheaperRouteAdmission(base),
    {route: 'ladder', cheap_effort: 'low', reference_effort: 'max', reason: 'ladder_parity_evidence'});
  const refused = [
    [{verifierRegistry: null}, 'ladder_no_registered_verifier'],
    [{verifierRegistry: new Map()}, 'ladder_no_registered_verifier'],
    [{verifierRegistry: registry('deep:read_only:chat')}, 'ladder_no_registered_verifier'],
    [{verifierRegistry: new Map([[family, 'not a function']])}, 'ladder_no_registered_verifier'],
    [{scope: 'workspace_write'}, 'ladder_write_scope'],
    [{ledgerStats: parity(19)}, 'ladder_insufficient_parity_evidence'],
    [{ledgerStats: parity(1_000, 1)}, 'ladder_insufficient_parity_evidence'],
    [{ledgerStats: () => { throw Error('ledger offline'); }}, 'ladder_insufficient_parity_evidence'],
    [{ledgerStats: () => ({verified_passes: '25', verifier_failures: 0})}, 'ladder_insufficient_parity_evidence'],
    [{ledgerStats: () => null}, 'ladder_insufficient_parity_evidence'],
    [{ledgerStats: null}, 'ladder_no_ledger_evidence'],
    [{cheaperEfforts: ['max', 'ultra']}, 'ladder_no_cheaper_route'],
    [{referenceEffort: 'unknown'}, 'ladder_no_cheaper_route']];
  for (const [change, reason] of refused)
    assert.deepEqual(cheaperRouteAdmission({...base, ...change}), {route: 'reference', reason}, JSON.stringify(change));
  // The cheapest effort with parity wins; one without parity is skipped.
  const stats = (asked, model, effort) => asked === family && model === 'claude-opus-5-5' ?
    {verified_passes: effort === 'medium' ? 25 : 3, verifier_failures: 0} : null;
  assert.equal(cheaperRouteAdmission({...base, ledgerStats: stats}).cheap_effort, 'medium');
});

test('the resolver admits a ladder only with registry plus parity; writes and explicit intents stay reference', () => {
  const request = task('/tmp', 'Explain one function', 'auto', {write: true});
  const now = Date.now();
  const rows = [row('chat-low', 'anthropic_shared', 'claude-opus-5-5', 'low', {surface: 'claude-chat'}),
    row('chat-max', 'anthropic_shared', 'claude-opus-5-5', 'max', {surface: 'claude-chat'}),
    row('claude-low', 'anthropic_shared', 'claude-opus-5-5', 'low'),
    row('claude-max', 'anthropic_shared', 'claude-opus-5-5', 'max'),
    row('claude-write-low', 'anthropic_shared', 'claude-opus-5-5', 'low', {scope: 'workspace_write', allowedPaths: ['**']}),
    row('claude-write-max', 'anthropic_shared', 'claude-opus-5-5', 'max', {scope: 'workspace_write', allowedPaths: ['**']})];
  const families = ['standard:read_only:chat', 'standard:workspace_write:agent'];
  const resolve = (options, value = catalog(request, rows)) => resolveRoutePlan(plan(request, [graded('read', 'standard'),
    graded('write', 'standard', {scope: 'workspace_write', ownedPaths: ['**']})]), request, value, now, options);
  const admitted = resolve({verifierRegistry: registry(...families), ledgerStats: parity(20)});
  assert.equal(admitted.decisions.read.resolved_candidate_id, 'chat-low');
  assert.deepEqual(admitted.decisions.read.ladder, {cheap_effort: 'low', reference_effort: 'max'});
  assert.equal(admitted.decisions.read.reason,
    'resolver;route_ladder;pool_rank_0;effort_low;ladder_reference_effort_max;chat_lane_same_route');
  assert.deepEqual(admitted.routes.read, {kind: 'ladder', reference_effort: 'max',
    ladder: {cheap_effort: 'low', reference_effort: 'max', reference_candidate_id: 'chat-max'}});
  // Writes are always reference, whatever the registry and ledger say.
  assert.equal(admitted.decisions.write.resolved_candidate_id, 'claude-write-max');
  assert.equal(Object.hasOwn(admitted.decisions.write, 'ladder'), false);
  assert.equal(admitted.routes.write.kind, 'reference');
  for (const [name, options] of [['no registry', {}], ['empty registry', {verifierRegistry: new Map(), ledgerStats: parity(99)}],
    ['19 passes', {verifierRegistry: registry(...families), ledgerStats: parity(19)}],
    ['one failure', {verifierRegistry: registry(...families), ledgerStats: parity(50, 1)}],
    ['other family', {verifierRegistry: registry('deep:read_only:chat'), ledgerStats: parity(50)}]]) {
    const decision = resolve(options).decisions.read;
    assert.equal(decision.resolved_candidate_id, 'chat-max', name);
    assert.equal(Object.hasOwn(decision, 'ladder'), false, name);
    assert.match(decision.reason, /^resolver;route_reference;/, name);
  }
  assert.match(resolve({verifierRegistry: registry(...families), ledgerStats: parity(19)}).decisions.read.reason,
    /;ladder_insufficient_parity_evidence;/);
  // An explicit owner constraint fixes the route: no ladder below it.
  const explicit = resolve({verifierRegistry: registry(...families), ledgerStats: parity(99)},
    {...catalog(request, rows), routing_intent: {effort: null, model_family: 'opus'}});
  assert.equal(explicit.decisions.read.resolved_candidate_id, 'chat-max');
  assert.match(explicit.decisions.read.reason, /^resolver;route_explicit;intent_family_opus;/);
});

async function ladderRuntime(t, dir, name, {verify, stats = parity(20), rows, write = false, budget = 1}) {
  const request = task(dir, 'Explain one function: ' + name, 'auto', {write});
  request.budget.max_attempts = budget;
  const dispatched = [], verified = [];
  const runtime = await createRCCRuntime({stateDir: join(dir, name.replace(/\W+/g, '-')),
    verifierRegistry: new Map([[write ? 'standard:workspace_write:agent' : 'standard:read_only:agent',
      async input => { verified.push(input.selected_config.effort); return verify(input); }]]),
    ledgerStats: stats,
    catalog: async value => catalog(value, rows),
    plan: async () => plan(request, [graded('n', 'standard', write ? {scope: 'workspace_write', ownedPaths: ['**']} : {})]),
    execute: async ticket => { dispatched.push(ticket.selected_config.effort);
      return execution(ticket, {output: `answer at ${ticket.selected_config.effort}`, task_verified: false,
        task_quality: 'execution_only'}); },
    verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  return {request, runtime, dispatched, verified, done: await wait(runtime, request)};
}
const ladderRows = [row('codex-low', 'openai_codex', 'gpt-5.7-sol', 'low'),
  row('codex-max', 'openai_codex', 'gpt-5.7-sol', 'max'),
  row('codex-write-low', 'openai_codex', 'gpt-5.7-sol', 'low', {scope: 'workspace_write', allowedPaths: ['**']}),
  row('codex-write-max', 'openai_codex', 'gpt-5.7-sol', 'max', {scope: 'workspace_write', allowedPaths: ['**']})];
const ledgerRecords = async stateDir => {
  const text = await readFile(join(stateDir, 'routing-ledger', 'routing-ledger.jsonl'), 'utf8');
  return text.trim().split('\n').map(line => JSON.parse(line));
};

test('a verified ladder output is adopted; a failed one re-dispatches once at the reference, uncharged', async t => {
  const dir = await fixture(t);
  // Pass: the cheaper route is adopted after its verifier passes.
  const pass = await ladderRuntime(t, dir, 'pass', {verify: async () => ({passed: true, reason: 'fake pass'}),
    rows: ladderRows});
  assert.equal(pass.done.state, 'completed', pass.done.error);
  assert.deepEqual(pass.dispatched, ['low']); assert.deepEqual(pass.verified, ['low']);
  assert.equal(pass.done.result.output, 'answer at low');
  assert.deepEqual(pass.done.children[0].routing_decision.ladder, {cheap_effort: 'low', reference_effort: 'max'});
  const passLedger = await ledgerRecords(join(dir, 'pass'));
  assert.deepEqual(passLedger.map(record => [record.effort, record.route_kind, record.verifier_outcome]),
    [['low', 'ladder', 'pass']]);
  // Fail: the cheaper output is discarded and the node runs once at the
  // reference route (same model, same pool), even with max_attempts 1.
  const fail = await ladderRuntime(t, dir, 'fail once', {rows: ladderRows,
    verify: async input => ({passed: input.selected_config.effort === 'max', reason: 'fake'})});
  assert.equal(fail.done.state, 'completed', fail.done.error);
  assert.deepEqual(fail.dispatched, ['low', 'max']); assert.deepEqual(fail.verified, ['low', 'max']);
  assert.equal(fail.done.result.output, 'answer at max', 'the failed cheaper output is never adopted');
  const decision = fail.done.children[0].routing_decision;
  assert.equal(decision.effort, 'max'); assert.equal(decision.resolved_candidate_id, 'codex-max');
  assert.equal(decision.reason, 'ladder_escalated_after_verifier_failure;route_reference;effort_max;agent_surface');
  assert.deepEqual(decision.ladder, {cheap_effort: 'low', reference_effort: 'max'});
  const events = fail.runtime.events({schema: 1, task_id: fail.request.task_id});
  assert.equal(events.filter(event => event.kind === 'ladder_escalated_to_reference').length, 1);
  assert.equal(events.some(event => event.kind === 'candidate_re_resolved'), false);
  assert.deepEqual((await ledgerRecords(join(dir, 'fail-once'))).map(record =>
    [record.effort, record.route_kind, record.verifier_outcome, record.reference_effort]),
  [['low', 'ladder', 'fail', 'max'], ['max', 'reference', 'pass', 'max']]);
  // Bounded once: a reference route that also fails its verifier is not
  // escalated again (there is nothing above the reference).
  const always = await ladderRuntime(t, dir, 'always fail', {rows: ladderRows,
    verify: async () => ({passed: false, reason: 'fake fail'})});
  assert.deepEqual(always.dispatched, ['low', 'max']);
  assert.equal(always.done.result?.output, 'answer at max');
  assert.equal(always.runtime.events({schema: 1, task_id: always.request.task_id})
    .filter(event => event.kind === 'ladder_escalated_to_reference').length, 1);
  // A throwing or malformed verifier counts as a failure, never as a pass.
  const broken = await ladderRuntime(t, dir, 'broken verifier', {rows: ladderRows,
    verify: async input => { if (input.selected_config.effort === 'low') throw Error('verifier crashed');
      return {passed: 'yes'}; }});
  assert.deepEqual(broken.dispatched, ['low', 'max']);
  assert.equal(broken.done.result?.output, 'answer at max');
  // No parity evidence: the reference runs first and only once.
  const noParity = await ladderRuntime(t, dir, 'no parity', {rows: ladderRows, stats: parity(19),
    verify: async () => ({passed: true, reason: 'fake pass'})});
  assert.deepEqual(noParity.dispatched, ['max']);
  assert.equal(Object.hasOwn(noParity.done.children[0].routing_decision, 'ladder'), false);
});

test('a write node is never laddered or escalated, whatever the registry and ledger say', async t => {
  const dir = await fixture(t);
  const write = await ladderRuntime(t, dir, 'write', {write: true, rows: ladderRows, stats: parity(500),
    verify: async () => ({passed: false, reason: 'fake fail'})});
  assert.equal(write.done.state, 'completed', write.done.error);
  assert.deepEqual(write.dispatched, ['max']);
  assert.deepEqual(write.verified, [], 'no node verifier runs for a write');
  assert.equal(write.done.children[0].routing_decision.reason,
    'resolver;route_reference;pool_rank_0;effort_max;agent_surface;instruction_host_locked');
  assert.equal(write.runtime.events({schema: 1, task_id: write.request.task_id})
    .some(event => event.kind === 'ladder_escalated_to_reference'), false);
});

test('a ladder whose reference row cannot be restored holds instead of adopting the failed output', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Explain one function with a vanished reference');
  const dispatched = [];
  const runtime = await createRCCRuntime({stateDir: dir,
    verifierRegistry: new Map([['standard:read_only:agent', async () => ({passed: false, reason: 'fake fail'})]]),
    ledgerStats: parity(20), catalog: async value => catalog(value, ladderRows),
    plan: async () => plan(request, [graded('n', 'standard')]),
    execute: async ticket => { dispatched.push(ticket.candidate_id); return execution(ticket); },
    verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  // Corrupt the internal reference pointer before the verifier answers.
  const original = runtime._escalateLadder.bind(runtime);
  runtime._escalateLadder = (taskID, nodeID, attemptID) => {
    runtime._update(taskID, 'fixture_reference_pointer_removed', state => {
      state.children[0].ladder.reference_candidate_id = 'missing-row'; });
    return original(taskID, nodeID, attemptID);
  };
  await runtime.submit(request);
  const held = await wait(runtime, request);
  assert.equal(held.state, 'held'); assert.equal(held.error, 'ladder_reference_unavailable');
  assert.deepEqual(dispatched, ['codex-low']);
  assert.equal(held.result, null, 'the failed cheaper output is not returned as a result');
});

test('routing ledger: one private record per settled attempt, ids and routing facts only', async t => {
  const dir = await fixture(t);
  const secret = 'Explain the function named PRIVATE-REQUEST-TEXT';
  const request = task(dir, secret);
  const rows = [row('claude-quota', 'anthropic_shared', 'claude-opus-5-5', 'max'),
    row('codex-max', 'openai_codex', 'gpt-5.7-sol', 'max', {quota: 0.42})];
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, rows),
    plan: async () => plan(request, [graded('n', 'deep')]),
    execute: async ticket => ticket.selected_config.quota_pool === 'anthropic_shared' ? quotaRejected(ticket) :
      execution(ticket, {output: 'PRIVATE-OUTPUT-TEXT', usage: {input_tokens: 11, output_tokens: 7, reasoning_tokens: 3}}),
    verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed', done.error);
  const directory = join(dir, 'routing-ledger'), file = join(directory, 'routing-ledger.jsonl');
  assert.equal((await lstat(directory)).mode & 0o777, 0o700);
  assert.equal((await lstat(file)).mode & 0o777, 0o600);
  const text = await readFile(file, 'utf8');
  for (const forbidden of ['PRIVATE-REQUEST-TEXT', 'PRIVATE-OUTPUT-TEXT', dir, '/private/fixture', 'Do one bounded task'])
    assert.equal(text.includes(forbidden), false, forbidden);
  const records = await ledgerRecords(dir);
  assert.equal(records.length, 2, 'one record per attempt: the quota rejection and the success');
  assert.deepEqual(Object.keys(records[1]).sort(), ['attempt_id', 'attempt_state', 'cost_gate', 'dispatched_at_ms',
    'dispatched_failure', 'effort', 'escalated', 'escalation_outcome', 'execution_verified', 'family',
    'host_route_kind', 'ladder', 'model', 'node_id', 'quota_pool', 'quota_remaining_fraction',
    'reference_effort', 'route_class', 'route_kind', 'schema', 'scope', 'settled_at_ms', 'surface', 'surface_kind',
    'task_id', 'task_quality', 'tier', 'usage', 'verifier_outcome']);
  // An older catalog (no model_tiers) records no tier, no escalation and no
  // cost gate (the gate only exists for a guarded tier route).
  assert.equal(records[1].tier, null); assert.equal(records[1].escalated, false);
  assert.equal(records[1].cost_gate, null);
  // Not a named route, and no failure after dispatch: both optional facts null.
  assert.equal(records[1].host_route_kind, null); assert.equal(records[1].dispatched_failure, null);
  assert.equal(records[1].escalation_outcome, null);
  assert.deepEqual(records.map(record => [record.quota_pool, record.attempt_state, record.execution_verified]),
    [['anthropic_shared', 'verified_not_dispatched', false], ['openai_codex', 'completed', true]]);
  const [, success] = records;
  assert.equal(success.task_id, request.task_id); assert.equal(success.node_id, 'n');
  assert.equal(success.attempt_id, done.children[0].attempt_id);
  assert.equal(success.family, 'deep:read_only:agent'); assert.equal(success.route_class, 'deep');
  assert.equal(success.model, 'gpt-5.7-sol'); assert.equal(success.effort, 'max');
  assert.equal(success.reference_effort, 'max'); assert.equal(success.route_kind, 'reference');
  assert.equal(success.ladder, null); assert.equal(success.quota_remaining_fraction, 0.42);
  assert.deepEqual(success.usage, {input_tokens: 11, output_tokens: 7, reasoning_tokens: 3});
  assert.equal(success.task_quality, 'task_verified'); assert.equal(success.verifier_outcome, 'not_registered');
  assert.ok(success.settled_at_ms >= success.dispatched_at_ms);
});

test('a routing ledger write failure is logged and never fails or holds the task', async t => {
  const dir = await fixture(t);
  for (const [name, sabotage] of [
    // The ledger directory path is occupied by a regular file.
    ['file', async stateDir => writeFile(join(stateDir, 'routing-ledger'), 'not a directory', {mode: 0o600})],
    // The ledger file is a symlink to a file it must never write through.
    ['symlink', async stateDir => {
      await mkdir(join(stateDir, 'routing-ledger'), {mode: 0o700});
      await writeFile(join(stateDir, 'decoy.txt'), 'decoy', {mode: 0o600});
      await symlink(join(stateDir, 'decoy.txt'), join(stateDir, 'routing-ledger', 'routing-ledger.jsonl'));
    }],
    // A world-readable ledger directory is not private.
    ['public', async stateDir => mkdir(join(stateDir, 'routing-ledger'), {mode: 0o755}).then(() =>
      chmod(join(stateDir, 'routing-ledger'), 0o755))]]) {
    const stateDir = join(dir, name);
    await mkdir(stateDir, {mode: 0o700});
    await sabotage(stateDir);
    const request = task(dir, 'Explain one function ' + name);
    const logged = [];
    const runtime = await createRCCRuntime({stateDir, ledgerLog: code => logged.push(code),
      catalog: async value => catalog(value, routingCatalog()),
      plan: async () => plan(request, [graded('n', 'standard')]),
      execute: async ticket => execution(ticket), verifyTask: taskVerdict});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request);
    const done = await wait(runtime, request);
    assert.equal(done.state, 'completed', `${name}: ${done.error}`);
    assert.ok(logged.length >= 1, `${name}: the failure was logged`);
    assert.ok(logged.every(code => /^[A-Za-z0-9_]{1,64}$/.test(code)), `${name}: ${logged}`);
  }
  assert.equal(await readFile(join(dir, 'symlink', 'decoy.txt'), 'utf8'), 'decoy', 'never written through a link');
});

test('routing ledger stats count one family at one model/effort and rotate within a bound', async t => {
  const dir = await fixture(t);
  const ledger = openRoutingLedger(dir, {maxBytes: 8_192});
  const record = (family, effort, outcome, verified = true) => ({schema: 1, task_id: 'task-x', node_id: 'n',
    attempt_id: randomUUID(), family, model: 'claude-opus-5-5', effort, verifier_outcome: outcome,
    execution_verified: verified});
  assert.deepEqual(ledger.stats('standard:read_only:chat', 'claude-opus-5-5', 'low'),
    {verified_passes: 0, verifier_failures: 0}, 'no ledger yet is no evidence');
  for (let i = 0; i < 120; i++) ledger.append(record('standard:read_only:chat', 'low', 'pass'));
  ledger.append(record('standard:read_only:chat', 'low', 'fail'));
  ledger.append(record('standard:read_only:chat', 'low', 'pass', false));
  ledger.append(record('deep:read_only:chat', 'low', 'fail'));
  ledger.append(record('standard:read_only:chat', 'medium', 'fail'));
  ledger.append(record('standard:read_only:chat', 'low', 'not_registered'));
  const files = (await readdir(join(dir, 'routing-ledger'))).sort();
  assert.deepEqual(files, ['routing-ledger-failures.json', 'routing-ledger.1.jsonl', 'routing-ledger.jsonl'],
    'rotated to one previous generation, beside the never-rotated failure index');
  for (const name of files) {
    const info = await stat(join(dir, 'routing-ledger', name));
    assert.ok(info.size <= 8_192, `${name} ${info.size} bytes`); assert.equal(info.mode & 0o777, 0o600);
  }
  const counted = ledger.stats('standard:read_only:chat', 'claude-opus-5-5', 'low');
  assert.equal(counted.verifier_failures, 1);
  assert.ok(counted.verified_passes > 0 && counted.verified_passes < 120, 'the oldest generation was dropped');
  assert.deepEqual(ledger.stats('deep:read_only:chat', 'claude-opus-5-5', 'low'), {verified_passes: 0, verifier_failures: 1});
  // An unsafe ledger reads as no evidence, so the ladder stays closed.
  await chmod(join(dir, 'routing-ledger'), 0o755);
  assert.deepEqual(ledger.stats('standard:read_only:chat', 'claude-opus-5-5', 'low'), {verified_passes: 0, verifier_failures: 0});
  assert.throws(() => ledger.append(record('standard:read_only:chat', 'low', 'pass')), /routing_ledger_directory_not_private/);
  await chmod(join(dir, 'routing-ledger'), 0o700);
  assert.throws(() => ledger.append({schema: 1, padding: 'x'.repeat(9_000)}), /routing_ledger_record_oversize/);
});

// ---- Review round 3: reference identity, ladder settlement and ledger custody ----
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
const coreDB = stateDir => new DatabaseSync(join(stateDir, 'rcc-runtime.sqlite'));

test('a cooled top Claude family under a Claude preference holds; a lower Claude model never runs', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Explain one function', 'auto', {provider: 'claude'});
  const rows = [row('claude-opus-max', 'anthropic_shared', 'claude-opus-5-5', 'max'),
    row('claude-sonnet-max', 'anthropic_shared', 'claude-sonnet-5-5', 'max')];
  let cooled = false; const dispatched = [];
  const runtime = await createRCCRuntime({stateDir: dir,
    // What the native builder emits after the top family's rejection: the
    // pool's reference is unusable, so its lower model is withheld too.
    catalog: async value => cooled ? {...catalog(value, []), exclusions: [
      {provider: 'claude', reason: 'quota_backoff', count: 1}, {provider: 'claude', reason: 'reference_unavailable', count: 1}]} :
      catalog(value, rows),
    plan: async () => plan(request, [graded('n', 'standard')]),
    execute: async ticket => { dispatched.push(ticket.candidate_id); cooled = true; return quotaRejected(ticket); },
    verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const held = await wait(runtime, request);
  assert.equal(held.state, 'held');
  assert.equal(held.error, 'no_routable_candidate:quota_backoff,reference_unavailable');
  assert.deepEqual(dispatched, ['claude-opus-max'], 'sonnet never stands in for the reference');
});

async function ladderPair(t, dir, name, {verify, execute, catalogRows, cancelGraceMs = 30_000, nodes = ['a', 'b']}) {
  const request = task(dir, 'Explain two functions: ' + name);
  const stateDir = join(dir, name.replace(/\W+/g, '-'));
  const runtime = await createRCCRuntime({stateDir, cancelGraceMs,
    verifierRegistry: new Map([['standard:read_only:agent', verify]]), ledgerStats: parity(20),
    catalog: async value => catalog(value, catalogRows()),
    plan: async () => plan(request, nodes.map(id => graded(id, 'standard'))),
    execute, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  return {request, runtime, stateDir};
}
const pairRows = [row('codex-low', 'openai_codex', 'gpt-5.7-sol', 'low'),
  row('codex-max', 'openai_codex', 'gpt-5.7-sol', 'max'),
  row('claude-max', 'anthropic_shared', 'claude-opus-5-5', 'max')];

test('a failed ladder verifier never settles the task over a running sibling (cancel and unavailable reference)', async t => {
  const dir = await fixture(t);
  // Cancel while the sibling runs: the ladder child is cancelled, the sibling
  // still reconciles, and no child stays running with its lease.
  const aVerifier = gate(), bRelease = gate(), aStarted = gate(), bStarted = gate();
  const cancelled = await ladderPair(t, dir, 'cancel', {catalogRows: () => pairRows,
    verify: async input => { if (input.node_id === 'a') { aStarted.resolve(); await aVerifier.promise;
      return {passed: false, reason: 'fake fail'}; } return {passed: true, reason: 'ok'}; },
    execute: async ticket => { if (ticket.node_id === 'b') { bStarted.resolve(); await bRelease.promise; }
      return execution(ticket, {task_verified: false, task_quality: 'execution_only'}); }});
  await aStarted.promise; await bStarted.promise;
  assert.equal(cancelled.runtime.cancel({schema: 1, task_id: cancelled.request.task_id}).state, 'cancelling');
  aVerifier.resolve(); await sleep(150);
  let status = cancelled.runtime.status({schema: 1, task_id: cancelled.request.task_id});
  assert.equal(status.state, 'cancelling', 'the ladder failure does not overwrite the cancel');
  assert.deepEqual(status.children.map(child => [child.id, child.state]), [['a', 'cancelled'], ['b', 'running']]);
  assert.equal(status.children[0].output_summary, null, 'the failed cheaper output is discarded');
  bRelease.resolve();
  status = await wait(cancelled.runtime, cancelled.request);
  assert.equal(status.state, 'effects_uncertain'); assert.equal(status.error, 'cancel_effects_uncertain');
  assert.deepEqual(status.children.map(child => [child.id, child.state]), [['a', 'cancelled'], ['b', 'effects_uncertain']]);
  const db = coreDB(cancelled.stateDir);
  t.after(() => db.close());
  // The uncertain sibling's adapter RETURNED a read-only record with no side
  // effects: its process exited, so it holds no pool either (the ladder child
  // released codex). Its uncertainty is remote billing, not a running process.
  assert.deepEqual(db.prepare('SELECT pool_key FROM quota_leases').all().map(item => item.pool_key), [],
    'a settled read-only sibling keeps no pool lease');
  assert.ok(cancelled.runtime.events({schema: 1, task_id: cancelled.request.task_id})
    .some(event => event.kind === 'quota_lease_released_settled_read_only'), 'the release names why');

  // The reference cannot be restored while the sibling runs: only the ladder
  // child holds; the sibling finishes and the task holds with the typed reason.
  const bGate = gate(), bRunning = gate();
  const unavailable = await ladderPair(t, dir, 'unavailable', {catalogRows: () => pairRows,
    verify: async input => ({passed: input.node_id !== 'a', reason: 'fake'}),
    execute: async ticket => { if (ticket.node_id === 'b') { bRunning.resolve(); await bGate.promise; }
      return execution(ticket, {task_verified: false, task_quality: 'execution_only', output: `${ticket.node_id} answer`}); }});
  const original = unavailable.runtime._escalateLadder.bind(unavailable.runtime);
  unavailable.runtime._escalateLadder = () => { throw Object.assign(new Error('x'), {code: 'ladder_reference_unavailable',
    name: 'RCCRuntimeError'}); };
  t.after(() => { unavailable.runtime._escalateLadder = original; });
  await bRunning.promise; await sleep(150);
  status = unavailable.runtime.status({schema: 1, task_id: unavailable.request.task_id});
  assert.equal(status.state, 'running', 'the task does not settle while b runs');
  assert.deepEqual(status.children.map(child => [child.id, child.state]), [['a', 'held'], ['b', 'running']]);
  bGate.resolve();
  status = await wait(unavailable.runtime, unavailable.request);
  assert.equal(status.state, 'returned_unverified');
  assert.equal(status.error, 'ladder_reference_unavailable');
  assert.equal(status.result.output, 'b: b answer', 'only the sibling output is returned; the failed cheap one never');
  const leases = coreDB(unavailable.stateDir);
  t.after(() => leases.close());
  assert.deepEqual(leases.prepare('SELECT pool_key FROM quota_leases').all(), [], 'every lease is released');
});

test('a ladder escalates to its reference after a sibling refresh dropped that row, then re-resolves', async t => {
  const dir = await fixture(t);
  let codexExhausted = false; const dispatched = [];
  const aVerifier = gate(), aStarted = gate();
  const pair = await ladderPair(t, dir, 'vanish', {
    // Once the cheap run spends the last Codex quota, the builder offers no
    // Codex row; b's dispatch refresh stores that catalog before a's verdict.
    catalogRows: () => codexExhausted ? pairRows.filter(c => c.quota_pool !== 'openai_codex') : pairRows,
    verify: async input => { if (input.node_id === 'a' && input.selected_config.effort === 'low') {
      await aVerifier.promise; return {passed: false, reason: 'fake fail'}; } return {passed: true, reason: 'ok'}; },
    execute: async ticket => { dispatched.push([ticket.node_id, ticket.candidate_id]);
      if (ticket.node_id === 'a') { codexExhausted = true; aStarted.resolve(); }
      return execution(ticket, {task_verified: false, task_quality: 'execution_only'}); }});
  await aStarted.promise; await sleep(300);
  aVerifier.resolve();
  const done = await wait(pair.runtime, pair.request);
  assert.equal(done.state, 'completed', done.error);
  assert.deepEqual(dispatched.filter(([id]) => id === 'a').map(([, candidate]) => candidate), ['codex-low', 'claude-max']);
  assert.match(done.children[0].routing_decision.reason,
    /^re_resolved_after:candidate_missing;other_pool;route_reference;/);
});

test('a cheaper ladder result that is not deliverable escalates and counts against parity', async t => {
  const dir = await fixture(t);
  for (const [name, override] of [['quality failed', {task_quality: 'failed'}],
    ['execution unverified', {execution_verified: false, acknowledged_config: null}], ['empty', {output: ''}]]) {
    const request = task(dir, 'Explain one function: undeliverable ' + name);
    const stateDir = join(dir, 'undeliverable-' + name.replace(/\W+/g, '-'));
    const dispatched = [], verified = [];
    const runtime = await createRCCRuntime({stateDir,
      verifierRegistry: new Map([['standard:read_only:agent', async input => { verified.push(input.selected_config.effort);
        return {passed: true, reason: 'ok'}; }]]), ledgerStats: parity(20),
      catalog: async value => catalog(value, ladderRows),
      plan: async () => plan(request, [graded('n', 'standard')]),
      execute: async ticket => { dispatched.push(ticket.selected_config.effort);
        return ticket.selected_config.effort === 'low' ? execution(ticket, {output: 'poor cheap answer',
          task_verified: false, task_quality: 'execution_only', ...override}) :
          execution(ticket, {output: 'reference answer', task_verified: false, task_quality: 'execution_only'}); },
      verifyTask: taskVerdict});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request);
    const done = await wait(runtime, request);
    assert.equal(done.state, 'completed', `${name}: ${done.error}`);
    assert.deepEqual(dispatched, ['low', 'max'], name); assert.deepEqual(verified, ['max'], name);
    assert.equal(done.result.output, 'reference answer', name);
    assert.equal(done.children[0].routing_decision.reason,
      'ladder_escalated_after_undeliverable_result;route_reference;effort_max;agent_surface', name);
    const records = await ledgerRecords(stateDir);
    assert.deepEqual(records.map(record => [record.effort, record.route_kind, record.verifier_outcome, record.attempt_state]),
      [['low', 'ladder', 'not_returned', 'ladder_not_returned'], ['max', 'reference', 'pass', 'completed']], name);
    assert.deepEqual(openRoutingLedger(stateDir).stats('standard:read_only:agent', 'gpt-5.7-sol', 'low'),
      {verified_passes: 0, verifier_failures: 1}, `${name}: the undeliverable cheap route counts as a failure`);
  }
});

test('a ladder escalation never replays an attempt that reported effects', async t => {
  const dir = await fixture(t);
  for (const [name, override] of [['confirmed', {side_effects: 'confirmed'}], ['possible', {side_effects: 'possible'}]]) {
    const request = task(dir, 'Explain one function: effects ' + name);
    const dispatched = [];
    const runtime = await createRCCRuntime({stateDir: join(dir, name),
      verifierRegistry: new Map([['standard:read_only:agent', async input =>
        ({passed: input.selected_config.effort === 'max', reason: 'fake'})]]), ledgerStats: parity(20),
      catalog: async value => catalog(value, ladderRows),
      plan: async () => plan(request, [graded('n', 'standard')]),
      execute: async ticket => { dispatched.push(ticket.selected_config.effort);
        return execution(ticket, {task_verified: false, task_quality: 'execution_only', ...override}); },
      verifyTask: taskVerdict});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request);
    const held = await wait(runtime, request);
    assert.equal(held.state, 'held', name); assert.equal(held.error, 'ladder_escalation_effects_reported', name);
    assert.deepEqual(dispatched, ['low'], name); assert.equal(held.result, null, `${name}: the cheap output is never adopted`);
  }
});

test('the failed ladder attempt is not charged to the cost or duration budget', async t => {
  const dir = await fixture(t);
  // Cost: one unit per row and a one-unit budget. Reference-only completes;
  // so must a ladder whose cheap attempt failed its verifier.
  for (const ladder of [false, true]) {
    const request = task(dir, 'Explain one function: cost ' + ladder);
    request.budget.max_cost_units = 1;
    const dispatched = [];
    const runtime = await createRCCRuntime({stateDir: join(dir, 'cost-' + ladder),
      verifierRegistry: new Map([['standard:read_only:agent', async input =>
        ({passed: input.selected_config.effort === 'max', reason: 'fake'})]]), ledgerStats: parity(ladder ? 20 : 0),
      catalog: async value => catalog(value, ladderRows),
      plan: async () => plan(request, [graded('n', 'standard')]),
      execute: async ticket => { dispatched.push(ticket.selected_config.effort);
        return execution(ticket, {task_verified: false, task_quality: 'execution_only'}); }, verifyTask: taskVerdict});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request);
    const done = await wait(runtime, request);
    assert.equal(done.state, 'completed', `${ladder}: ${done.error}`);
    assert.deepEqual(dispatched, ladder ? ['low', 'max'] : ['max']);
  }
  // Duration: the cheap attempt plus its slow verifier outlast the 1 s budget;
  // the reference would have dispatched at once, so it still dispatches.
  const request = task(dir, 'Explain one function: duration');
  request.budget.max_duration_ms = 1_000;
  const dispatched = [];
  const runtime = await createRCCRuntime({stateDir: join(dir, 'duration'),
    verifierRegistry: new Map([['standard:read_only:agent', async input => {
      if (input.selected_config.effort === 'low') { await sleep(1_100); return {passed: false, reason: 'slow fail'}; }
      return {passed: true, reason: 'ok'}; }]]), ledgerStats: parity(20),
    catalog: async value => catalog(value, ladderRows),
    plan: async () => plan(request, [graded('n', 'standard')]),
    execute: async ticket => { dispatched.push(ticket.selected_config.effort);
      return execution(ticket, {task_verified: false, task_quality: 'execution_only'}); }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed', done.error);
  assert.deepEqual(dispatched, ['low', 'max']);
});

test('stop during a node verifier holds the returned child, named as verifier-pending, across restart', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Explain one function: stop during verifier');
  const started = gate(), release = gate();
  const options = {catalog: async value => catalog(value, ladderRows),
    plan: async () => plan(request, [graded('n', 'standard')]),
    execute: async ticket => execution(ticket, {task_verified: false, task_quality: 'execution_only',
      usage: {input_tokens: 40, output_tokens: 10}}), verifyTask: taskVerdict};
  const runtime = await createRCCRuntime({stateDir: dir, ...options,
    verifierRegistry: new Map([['standard:read_only:agent', async () => { started.resolve(); await release.promise;
      return {passed: true, reason: 'ok'}; }]]), ledgerStats: parity(20)});
  await runtime.submit(request);
  await started.promise;
  await runtime.close({timeoutMs: 100});
  // The verifier is never answered before the restart (the process stopped).
  const restarted = await createRCCRuntime({stateDir: dir, ...options});
  t.after(async () => { await restarted.close(); release.resolve(); });
  const status = restarted.status({schema: 1, task_id: request.task_id});
  assert.equal(status.state, 'held'); assert.equal(status.error, 'owner_stopped_node_verifier_pending');
  assert.deepEqual(status.children.map(child => [child.id, child.state]), [['n', 'held']]);
  assert.ok(status.children[0].output_summary, 'the native attempt did run and return');
  // The restart recorded the interrupted attempt once, with its real usage;
  // an interruption counts against the cheaper route's parity.
  const records = await ledgerRecords(dir);
  assert.deepEqual(records.map(record => [record.effort, record.verifier_outcome, record.attempt_state, record.usage]),
    [['low', 'interrupted', 'interrupted', {input_tokens: 40, output_tokens: 10}]]);
  assert.equal(openRoutingLedger(dir).stats('standard:read_only:agent', 'gpt-5.7-sol', 'low').verifier_failures, 1);
});

test('routing ledger: attempts settled after stop or by restart are recorded exactly once', async t => {
  const dir = await fixture(t);
  // An attempt still draining at stop records itself, with its real usage,
  // when it settles; a restart then finds it and does not add another.
  const drained = task(dir, 'Explain one function: drains after stop');
  const dispatched = gate();
  const runtime = await createRCCRuntime({stateDir: join(dir, 'drain'),
    catalog: async value => catalog(value, routingCatalog()),
    plan: async () => plan(drained, [graded('n', 'standard')]),
    execute: async (ticket, signal) => { dispatched.resolve();
      await new Promise(resolve => signal.addEventListener('abort', () => setTimeout(resolve, 300), {once: true}));
      return execution(ticket, {status: 'failed', side_effects: 'possible', execution_verified: false,
        task_verified: false, task_quality: 'failed', usage: {input_tokens: 900, output_tokens: 300}}); },
    verifyTask: taskVerdict});
  await runtime.submit(drained);
  await dispatched.promise;
  await runtime.close({timeoutMs: 50});
  await sleep(500);
  let records = await ledgerRecords(join(dir, 'drain'));
  assert.deepEqual(records.map(record => [record.attempt_state, record.usage]),
    [['settled_after_stop', {input_tokens: 900, output_tokens: 300}]]);
  const reopened = await createRCCRuntime({stateDir: join(dir, 'drain'), catalog: async value => catalog(value, routingCatalog())});
  t.after(async () => { await reopened.close(); });
  assert.equal((await ledgerRecords(join(dir, 'drain'))).length, 1, 'no second record at restart');
  const pending = coreDB(join(dir, 'drain'));
  t.after(() => pending.close());
  assert.deepEqual(pending.prepare('SELECT attempt_id FROM ledger_pending').all(), []);

  // An attempt that never settles (the process stopped with it) is recorded
  // once by the next owner, as interrupted with its settled state.
  const lost = task(dir, 'Explain one function: never settles');
  const started = gate();
  const first = await createRCCRuntime({stateDir: join(dir, 'lost'),
    catalog: async value => catalog(value, routingCatalog()),
    plan: async () => plan(lost, [graded('n', 'standard')]),
    execute: async () => { started.resolve(); return new Promise(() => {}); }, verifyTask: taskVerdict});
  await first.submit(lost);
  await started.promise;
  await first.close({timeoutMs: 50});
  const second = await createRCCRuntime({stateDir: join(dir, 'lost'), catalog: async value => catalog(value, routingCatalog())});
  t.after(async () => { await second.close(); });
  records = await ledgerRecords(join(dir, 'lost'));
  assert.deepEqual(records.map(record => [record.task_id, record.attempt_state, record.verifier_outcome, record.usage]),
    [[lost.task_id, 'effects_uncertain', 'not_registered', null]]);
  const third = await (async () => { await second.close(); return createRCCRuntime({stateDir: join(dir, 'lost')}); })();
  t.after(async () => { await third.close(); });
  assert.equal((await ledgerRecords(join(dir, 'lost'))).length, 1, 'recorded exactly once across restarts');
});

test('routing ledger: a handback and a thrown execution are recorded when they settle, with settled states', async t => {
  const dir = await fixture(t);
  let quota = 0.7;
  const writer = () => candidate('claude-write', 'claude', 'anthropic_shared', {scope: 'workspace_write',
    allowedPaths: ['**'], model: 'claude-opus-5-5', effort: 'max', quota});
  const request = task(dir, 'Continue one blocked workspace operation', 'auto', {write: true});
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async value => catalog(value, [writer()]),
    plan: async () => plan(request, [graded('one', 'deep', {scope: 'workspace_write', ownedPaths: ['**']})]),
    execute: async ticket => { const result = await handbackExecution(dir, ticket); quota = 0.3; return result; },
    executeContinuation: async ticket => { await sleep(200); return continuationExecution(dir, ticket); }});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'returned_unverified', done.error);
  const records = await ledgerRecords(dir);
  assert.deepEqual(records.map(record => [record.attempt_state, record.quota_remaining_fraction]),
    [['handback_returned', 0.7], ['continuation_returned', 0.3]],
    'the initial attempt is recorded first, and the continuation with its own dispatch quota');
  assert.ok(records[0].settled_at_ms <= records[1].dispatched_at_ms);
  const history = runtime._load(request.task_id).children[0].attempt_history.map(entry => entry.state);
  assert.deepEqual(history, ['handback_returned', 'continuation_returned']);

  const thrown = task(dir, 'Explain one function: executor throws');
  const throwing = await createRCCRuntime({stateDir: join(dir, 'throws'),
    catalog: async value => catalog(value, routingCatalog()),
    plan: async () => plan(thrown, [graded('n', 'standard')]),
    execute: async () => { throw new Error('transport lost'); }, verifyTask: taskVerdict});
  t.after(async () => { await throwing.close(); });
  await throwing.submit(thrown);
  assert.equal((await wait(throwing, thrown)).state, 'effects_uncertain');
  assert.deepEqual((await ledgerRecords(join(dir, 'throws'))).map(record => record.attempt_state), ['effects_uncertain']);
  assert.equal(throwing._load(thrown.task_id).children[0].attempt_history[0].state, 'effects_uncertain');
});

test('routing ledger: failures survive rotation; torn, foreign or unindexed ledgers read as no evidence', async t => {
  const dir = await fixture(t);
  const record = (outcome, family = 'standard:read_only:agent') => ({schema: 1, task_id: 'task-x', node_id: 'n',
    attempt_id: randomUUID(), family, model: 'm', effort: 'low', verifier_outcome: outcome, execution_verified: true});
  // Rotation: the failure's raw record is long gone, the index keeps it.
  const rotated = openRoutingLedger(join(dir, 'rotated'), {maxBytes: 8_192});
  await mkdir(join(dir, 'rotated'), {mode: 0o700});
  rotated.append(record('fail'));
  for (let i = 0; i < 75; i++) rotated.append(record('pass', 'other:read_only:agent'));
  for (let i = 0; i < 60; i++) rotated.append(record('pass'));
  const evicted = rotated.stats('standard:read_only:agent', 'm', 'low');
  assert.ok(evicted.verified_passes >= LADDER_MIN_VERIFIED_PASSES, JSON.stringify(evicted));
  assert.equal(evicted.verifier_failures, 1, 'the evicted failure still counts');
  assert.equal(cheaperRouteAdmission({family: 'standard:read_only:agent', scope: 'read_only', model: 'm',
    referenceEffort: 'max', cheaperEfforts: ['low'], verifierRegistry: registry('standard:read_only:agent'),
    ledgerStats: rotated.stats}).route, 'reference');
  for (const outcome of ['not_returned', 'interrupted']) {
    const other = openRoutingLedger(join(dir, outcome));
    await mkdir(join(dir, outcome), {mode: 0o700});
    other.append(record(outcome));
    assert.equal(other.stats('standard:read_only:agent', 'm', 'low').verifier_failures, 1, outcome);
  }
  // A torn earlier write never swallows the next record, and reads as no
  // evidence (fail closed) instead of being skipped.
  const torn = openRoutingLedger(join(dir, 'torn'));
  await mkdir(join(dir, 'torn'), {mode: 0o700});
  for (let i = 0; i < 25; i++) torn.append(record('pass'));
  await appendFile(torn.path, '{"attempt_id":"abc","eff');
  torn.append(record('fail'));
  assert.deepEqual(torn.stats('standard:read_only:agent', 'm', 'low'), {verified_passes: 0, verifier_failures: 0});
  const tornLines = (await readFile(torn.path, 'utf8')).split('\n');
  assert.equal(JSON.parse(tornLines.at(-2)).verifier_outcome, 'fail', 'the failure is on its own line');
  // A foreign line, or a missing or invalid failure index, is no evidence.
  const clean = openRoutingLedger(join(dir, 'clean'));
  await mkdir(join(dir, 'clean'), {mode: 0o700});
  for (let i = 0; i < 25; i++) clean.append(record('pass'));
  assert.equal(clean.stats('standard:read_only:agent', 'm', 'low').verified_passes, 25);
  await unlink(clean.failureIndexPath);
  assert.deepEqual(clean.stats('standard:read_only:agent', 'm', 'low'), {verified_passes: 0, verifier_failures: 0});
  await writeFile(clean.failureIndexPath, '{"schema":1}', {mode: 0o600});
  assert.deepEqual(clean.stats('standard:read_only:agent', 'm', 'low'), {verified_passes: 0, verifier_failures: 0});
  await writeFile(clean.failureIndexPath, '{"failures":{},"overflow":true,"schema":1}', {mode: 0o600});
  assert.deepEqual(clean.stats('standard:read_only:agent', 'm', 'low'), {verified_passes: 0, verifier_failures: 0});
  await writeFile(clean.failureIndexPath, '{"failures":{},"overflow":false,"schema":1}', {mode: 0o600});
  assert.equal(clean.stats('standard:read_only:agent', 'm', 'low').verified_passes, 25);
  await appendFile(clean.path, JSON.stringify({schema: 2, family: 'x'}) + '\n');
  assert.deepEqual(clean.stats('standard:read_only:agent', 'm', 'low'), {verified_passes: 0, verifier_failures: 0});
  assert.equal((await stat(clean.failureIndexPath)).mode & 0o777, 0o600);
});

test('routing ledger: a FIFO at a ledger path never blocks the Core event loop', async t => {
  const dir = await fixture(t);
  for (const name of ['routing-ledger.jsonl', 'routing-ledger-failures.json']) {
    const stateDir = join(dir, name);
    await mkdir(join(stateDir, 'routing-ledger'), {recursive: true, mode: 0o700});
    await chmod(stateDir, 0o700);
    execFileSync('mkfifo', ['-m', '600', join(stateDir, 'routing-ledger', name)]);
    const ledger = openRoutingLedger(stateDir);
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 5);
    const startedAt = Date.now();
    assert.throws(() => ledger.append({schema: 1, verifier_outcome: 'fail', family: 'f', model: 'm', effort: 'low'}));
    assert.deepEqual(ledger.stats('f', 'm', 'low'), {verified_passes: 0, verifier_failures: 0});
    assert.ok(Date.now() - startedAt < 1_000, name);
    await sleep(30);
    clearInterval(timer);
    assert.ok(ticks > 0, `${name}: the event loop kept running`);
  }
});

// ---- Review round 4: ladder session isolation, failed cheap attempts, task-wide
// exemption, early pool release and fail-closed ledger custody ---------------
const ladderVerifier = (passAt = 'max') => new Map([['standard:read_only:agent', async input =>
  ({passed: input.selected_config.effort === passAt, reason: 'fake'})]]);
const claudeLadderRows = [row('claude-low', 'anthropic_shared', 'claude-opus-5-5', 'low'),
  row('claude-max', 'anthropic_shared', 'claude-opus-5-5', 'max')];
const indexRenameFails = ledgerIndex => {
  const original = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === ledgerIndex) throw Object.assign(new Error('injected no space'), {code: 'ENOSPC'});
    return original(from, to);
  };
  syncBuiltinESMExports();
  return () => { fs.renameSync = original; syncBuiltinESMExports(); };
};

test('a cheap ladder attempt runs in a fresh native session; the escalated reference resumes the owner session', async t => {
  const dir = await fixture(t);
  for (const [surface, extras, rows] of [['codex', {codexSession: 'owner-codex-thread'}, ladderRows],
    ['claude', {claudeSession: 'owner-claude-thread'}, claudeLadderRows]]) {
    const request = task(dir, 'Explain one function: session ' + surface, 'auto', extras);
    const tickets = [];
    const runtime = await createRCCRuntime({stateDir: join(dir, 'session-' + surface),
      verifierRegistry: ladderVerifier(), ledgerStats: parity(20), catalog: async value => catalog(value, rows),
      plan: async () => plan(request, [graded('n', 'standard')]),
      execute: async ticket => { tickets.push([ticket.selected_config.effort, ticket.native_resume_session_id]);
        return execution(ticket, {output: `answer at ${ticket.selected_config.effort}`, task_verified: false,
          task_quality: 'execution_only'}); },
      verifyTask: taskVerdict});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request);
    const done = await wait(runtime, request);
    assert.equal(done.state, 'completed', `${surface}: ${done.error}`);
    assert.deepEqual(tickets, [['low', null], ['max', extras.codexSession ?? extras.claudeSession]], surface);
    assert.equal(done.result.output, 'answer at max', surface);
  }
});

test('a cheap ladder attempt that failed after dispatch without effects escalates; effects or unknown dispatch stay uncertain', async t => {
  const dir = await fixture(t);
  for (const [name, failure, expected] of [
    ['no effects', {side_effects: 'none', dispatch_stage: 'dispatched'}, 'completed'],
    ['possible effects', {side_effects: 'possible', dispatch_stage: 'dispatched'}, 'effects_uncertain'],
    ['unknown dispatch', {side_effects: 'none', dispatch_stage: 'unknown'}, 'effects_uncertain']]) {
    const stateDir = join(dir, 'failed-' + name.replace(/\W+/g, '-'));
    const dispatched = [];
    const options = {stateDir, verifierRegistry: ladderVerifier(), ledgerStats: parity(20),
      catalog: async value => catalog(value, ladderRows),
      plan: async ({task: value}) => plan(value, [graded('n', 'standard')]),
      execute: async ticket => { dispatched.push([ticket.task_id, ticket.selected_config.effort]);
        return ticket.selected_config.effort === 'low' && dispatched.length === 1 ?
          execution(ticket, {status: 'failed', output: null, execution_verified: false, task_verified: false,
            task_quality: 'failed', native_summary: null, ...failure}) :
          execution(ticket, {output: `answer at ${ticket.selected_config.effort}`, task_verified: false,
            task_quality: 'execution_only'}); },
      verifyTask: taskVerdict};
    const runtime = await createRCCRuntime(options);
    t.after(async () => { await runtime.close(); });
    const request = task(dir, 'Explain one function: failed ladder ' + name);
    await runtime.submit(request);
    const done = await wait(runtime, request);
    assert.equal(done.state, expected, `${name}: ${done.error}`);
    if (expected === 'completed') {
      assert.deepEqual(dispatched.map(([, effort]) => effort), ['low', 'max'], name);
      assert.equal(done.result.output, 'answer at max', name);
      assert.equal(done.children[0].routing_decision.reason,
        'ladder_escalated_after_undeliverable_result;route_reference;effort_max;agent_surface', name);
      assert.deepEqual((await ledgerRecords(stateDir)).map(record =>
        [record.effort, record.route_kind, record.verifier_outcome, record.attempt_state]),
      [['low', 'ladder', 'not_returned', 'ladder_not_returned'], ['max', 'reference', 'pass', 'completed']], name);
      // The pool is not poisoned: the next task on it dispatches.
      const next = task(dir, 'Explain one function: after failed ladder ' + name);
      await runtime.submit(next);
      assert.equal((await wait(runtime, next)).state, 'completed', `${name}: next task`);
    } else {
      assert.deepEqual(dispatched.map(([, effort]) => effort), ['low'], name);
      assert.equal(done.error, 'dispatched_failure_no_replay', name);
    }
  }
});

test('the failed ladder time is exempt task-wide: a dependent node behind an escalated ladder still runs', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Explain two dependent functions: duration');
  request.budget.max_duration_ms = 1_000;
  const dispatched = [];
  const runtime = await createRCCRuntime({stateDir: dir,
    verifierRegistry: new Map([['standard:read_only:agent', async input => {
      if (input.node_id === 'a' && input.selected_config.effort === 'low') {
        await sleep(1_100); return {passed: false, reason: 'slow fail'}; }
      return {passed: true, reason: 'ok'}; }]]), ledgerStats: parity(20),
    catalog: async value => catalog(value, ladderRows),
    plan: async () => plan(request, [graded('a', 'standard'), graded('b', 'standard', {dependencies: ['a']})]),
    execute: async ticket => { dispatched.push([ticket.node_id, ticket.selected_config.effort]);
      return execution(ticket, {task_verified: false, task_quality: 'execution_only'}); }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed', done.error);
  assert.deepEqual(dispatched, [['a', 'low'], ['a', 'max'], ['b', 'low']]);
});

test('a node verifier never holds the pool: after a cancel another task dispatches on it at once', async t => {
  const dir = await fixture(t);
  const started = gate(), release = gate();
  const first = task(dir, 'Explain one function: verifier holds the pool');
  const second = task(dir, 'Explain one function: next on the pool');
  const dispatchedAt = new Map();
  const runtime = await createRCCRuntime({stateDir: dir,
    verifierRegistry: new Map([['standard:read_only:agent', async input => {
      if (input.task_id === first.task_id) { started.resolve(); await release.promise; }
      return {passed: true, reason: 'ok'}; }]]),
    // No parity evidence: a reference route, whose verifier still runs.
    ledgerStats: parity(0), catalog: async value => catalog(value, ladderRows),
    plan: async ({task: value}) => plan(value, [graded('n', 'standard')]),
    execute: async ticket => { dispatchedAt.set(ticket.task_id, Date.now());
      return execution(ticket, {task_verified: false, task_quality: 'execution_only'}); },
    verifyTask: taskVerdict});
  t.after(async () => { release.resolve(); await runtime.close(); });
  await runtime.submit(first);
  await started.promise;
  const cancelledAt = Date.now();
  runtime.cancel({schema: 1, task_id: first.task_id});
  await runtime.submit(second);
  const done = await wait(runtime, second);
  assert.equal(done.state, 'completed', done.error);
  assert.ok(dispatchedAt.get(second.task_id) - cancelledAt < 2_000,
    `the second task waited ${dispatchedAt.get(second.task_id) - cancelledAt} ms behind a verifier`);
  release.resolve();
});

test('routing ledger index fails closed: a failed index write appends nothing; a missing index is seeded', async t => {
  const dir = await fixture(t);
  const family = 'standard:read_only:agent';
  const record = outcome => ({schema: 1, task_id: 'task-x', node_id: 'n', attempt_id: randomUUID(), family,
    model: 'm', effort: 'low', verifier_outcome: outcome, execution_verified: true});
  const admission = ledger => cheaperRouteAdmission({family, scope: 'read_only', model: 'm', referenceEffort: 'max',
    cheaperEfforts: ['low'], verifierRegistry: registry(family), ledgerStats: ledger.stats}).route;
  const raw = async ledger => {
    const lines = [];
    for (const path of [ledger.rotatedPath, ledger.path]) {
      try { lines.push(...(await readFile(path, 'utf8')).trim().split('\n').filter(Boolean)); } catch { /* absent */ }
    }
    return lines.map(line => JSON.parse(line));
  };
  // (A) The index write of a failure fails: nothing is appended (the caller
  // keeps the attempt pending and retries), so rotation cannot lose it later.
  const injected = openRoutingLedger(join(dir, 'injected'), {maxBytes: 8_192});
  await mkdir(join(dir, 'injected'), {mode: 0o700});
  for (let i = 0; i < 3; i++) injected.append(record('pass'));
  const restore = indexRenameFails(injected.failureIndexPath);
  try { assert.throws(() => injected.append(record('fail')), /injected no space/); } finally { restore(); }
  assert.equal((await raw(injected)).some(item => item.verifier_outcome === 'fail'), false, 'no raw failure without its index');
  assert.deepEqual((await readdir(join(dir, 'injected', 'routing-ledger'))).filter(name => name.endsWith('.tmp')), []);
  injected.append(record('fail'));
  for (let i = 0; i < 120; i++) injected.append(record('pass'));
  assert.ok(injected.stats(family, 'm', 'low').verified_passes >= LADDER_MIN_VERIFIED_PASSES);
  assert.equal(injected.stats(family, 'm', 'low').verifier_failures, 1);
  assert.equal(admission(injected), 'reference');
  // (B) A missing index is seeded from the raw generations, never recreated
  // empty, so the failure survives the rotation that drops its raw line.
  const missing = openRoutingLedger(join(dir, 'missing'), {maxBytes: 8_192});
  await mkdir(join(dir, 'missing'), {mode: 0o700});
  missing.append(record('fail'));
  await unlink(missing.failureIndexPath);
  missing.append(record('pass'));
  for (let i = 0; i < 120; i++) missing.append(record('pass'));
  assert.equal((await raw(missing)).some(item => item.verifier_outcome === 'fail'), false, 'the raw failure rotated away');
  assert.equal(missing.stats(family, 'm', 'low').verifier_failures, 1);
  assert.equal(admission(missing), 'reference');
  // A missing index beside an unreadable raw line is seeded overflowed.
  const torn = openRoutingLedger(join(dir, 'torn-seed'));
  await mkdir(join(dir, 'torn-seed'), {mode: 0o700});
  for (let i = 0; i < 25; i++) torn.append(record('pass'));
  await appendFile(torn.path, '{"verifier_outcome":"fa');
  await unlink(torn.failureIndexPath);
  torn.append(record('pass'));
  assert.equal(JSON.parse(await readFile(torn.failureIndexPath, 'utf8')).overflow, true);
  // (C) Rotation never discards a generation whose failures the index lacks.
  const lost = openRoutingLedger(join(dir, 'lost-entry'), {maxBytes: 8_192});
  await mkdir(join(dir, 'lost-entry'), {mode: 0o700});
  lost.append(record('fail'));
  await writeFile(lost.failureIndexPath, '{"failures":{},"overflow":false,"schema":1}', {mode: 0o600});
  for (let i = 0; i < 120; i++) lost.append(record('pass'));
  assert.equal(JSON.parse(await readFile(lost.failureIndexPath, 'utf8')).overflow, true);
  assert.deepEqual(lost.stats(family, 'm', 'low'), {verified_passes: 0, verifier_failures: 0});
  assert.equal(admission(lost), 'reference');
});

test('a parity failure whose ledger write fails closes every ladder in the process until it is written', async t => {
  const dir = await fixture(t);
  const seed = openRoutingLedger(dir);
  for (let i = 0; i < 20; i++) seed.append({schema: 1, task_id: 'seed', node_id: 'n', attempt_id: randomUUID(),
    family: 'standard:read_only:agent', model: 'gpt-5.7-sol', effort: 'low', verifier_outcome: 'pass',
    execution_verified: true});
  const dispatched = [], logged = [];
  const runtime = await createRCCRuntime({stateDir: dir, ledgerLog: code => logged.push(code),
    verifierRegistry: ladderVerifier(), catalog: async value => catalog(value, ladderRows),
    plan: async ({task: value}) => plan(value, [graded('n', 'standard')]),
    execute: async ticket => { dispatched.push([ticket.task_id, ticket.selected_config.effort]);
      return execution(ticket, {task_verified: false, task_quality: 'execution_only'}); }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  const efforts = id => dispatched.filter(([taskID]) => taskID === id).map(([, effort]) => effort);
  const restore = indexRenameFails(seed.failureIndexPath);
  let restored = false;
  t.after(() => { if (!restored) restore(); });
  const first = task(dir, 'Explain one function: failure write fails');
  await runtime.submit(first);
  assert.equal((await wait(runtime, first)).state, 'completed');
  assert.deepEqual(efforts(first.task_id), ['low', 'max'], 'the ledger had parity: the ladder ran and failed');
  assert.ok(logged.includes('ENOSPC'), JSON.stringify(logged));
  const second = task(dir, 'Explain one function: while the failure is unwritten');
  await runtime.submit(second);
  assert.equal((await wait(runtime, second)).state, 'completed');
  assert.deepEqual(efforts(second.task_id), ['max'], 'no ladder while a parity failure is unwritten');
  restore(); restored = true;
  const third = task(dir, 'Explain one function: after the failure is written');
  await runtime.submit(third);
  assert.equal((await wait(runtime, third)).state, 'completed');
  assert.deepEqual(efforts(third.task_id), ['max'], 'the written failure keeps the ladder closed');
  assert.deepEqual(seed.stats('standard:read_only:agent', 'gpt-5.7-sol', 'low').verifier_failures, 1);
  const pending = coreDB(dir);
  t.after(() => pending.close());
  assert.deepEqual(pending.prepare('SELECT attempt_id FROM ledger_pending').all(), []);
});

test('restart records a settled verdict as it was, never as interrupted', async t => {
  const dir = await fixture(t);
  // A verified ladder pass whose live append failed (transient ledger fault).
  const passDir = join(dir, 'pass');
  const request = task(dir, 'Explain one function: transient ledger fault');
  const logged = [];
  const options = {verifierRegistry: ladderVerifier('low'), ledgerStats: parity(20),
    catalog: async value => catalog(value, ladderRows),
    plan: async () => plan(request, [graded('n', 'standard')]), verifyTask: taskVerdict};
  const runtime = await createRCCRuntime({stateDir: passDir, ...options, ledgerLog: code => logged.push(code),
    execute: async ticket => {
      await mkdir(join(passDir, 'routing-ledger'), {recursive: true, mode: 0o700});
      await chmod(join(passDir, 'routing-ledger'), 0o755);
      return execution(ticket, {task_verified: false, task_quality: 'execution_only'}); }});
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed', done.error);
  assert.ok(logged.includes('routing_ledger_directory_not_private'), JSON.stringify(logged));
  assert.deepEqual(runtime._load(request.task_id).children[0].attempt_history.map(entry =>
    [entry.state, entry.verifier, entry.effort ?? entry.ledger.effort]), [['completed', 'pass', 'low']]);
  await runtime.close();
  await chmod(join(passDir, 'routing-ledger'), 0o700);
  const reopened = await createRCCRuntime({stateDir: passDir, ...options, execute: async ticket => execution(ticket)});
  t.after(async () => { await reopened.close(); });
  assert.deepEqual((await ledgerRecords(passDir)).map(record => [record.effort, record.attempt_state, record.verifier_outcome]),
    [['low', 'completed', 'pass']]);
  assert.deepEqual(openRoutingLedger(passDir).stats('standard:read_only:agent', 'gpt-5.7-sol', 'low'),
    {verified_passes: 1, verifier_failures: 0});

  // A verified pre-execution quota rejection is 'not_dispatched', not a failure.
  const quotaDir = join(dir, 'quota');
  const quota = task(dir, 'Explain one function: quota rejection under a ledger fault');
  const rows = [row('claude-quota', 'anthropic_shared', 'claude-opus-5-5', 'max'),
    row('codex-max', 'openai_codex', 'gpt-5.7-sol', 'max')];
  const quotaOptions = {verifierRegistry: ladderVerifier(), ledgerStats: parity(0),
    catalog: async value => catalog(value, rows), plan: async () => plan(quota, [graded('n', 'standard')]),
    verifyTask: taskVerdict};
  const quotaRuntime = await createRCCRuntime({stateDir: quotaDir, ...quotaOptions, ledgerLog: () => {},
    execute: async ticket => {
      if (ticket.selected_config.quota_pool === 'anthropic_shared') {
        await mkdir(join(quotaDir, 'routing-ledger'), {recursive: true, mode: 0o700});
        await chmod(join(quotaDir, 'routing-ledger'), 0o755);
        return quotaRejected(ticket);
      }
      await chmod(join(quotaDir, 'routing-ledger'), 0o700);
      return execution(ticket, {task_verified: false, task_quality: 'execution_only'}); }});
  await quotaRuntime.submit(quota);
  assert.equal((await wait(quotaRuntime, quota)).state, 'completed');
  await quotaRuntime.close();
  const quotaReopened = await createRCCRuntime({stateDir: quotaDir, ...quotaOptions, execute: async ticket => execution(ticket)});
  t.after(async () => { await quotaReopened.close(); });
  const quotaRecords = (await ledgerRecords(quotaDir)).map(record => [record.quota_pool, record.attempt_state, record.verifier_outcome]);
  assert.deepEqual(quotaRecords.sort(), [['anthropic_shared', 'verified_not_dispatched', 'not_dispatched'],
    ['openai_codex', 'completed', 'pass']]);
  assert.equal(openRoutingLedger(quotaDir).stats('standard:read_only:agent', 'claude-opus-5-5', 'max').verifier_failures, 0);
});

// ---- Quota-pool leases of settled read-only attempts (2026-10-14) ----------
// A quota-pool lease protects a RUNNING attempt (shared pool peak 1), or an
// effects-uncertain one whose process may still run or whose effects may
// exist. A read-only attempt whose adapter RETURNED a record with no side
// effects has exited and changed nothing: its uncertainty is remote billing,
// so its pool is released. Build 378 kept that lease across reinstalls and
// held the owner's next task with quota_pool_effects_uncertain.
const leasePools = runtime => runtime.db.prepare('SELECT pool_key FROM quota_leases ORDER BY pool_key').all()
  .map(item => item.pool_key);
const failedAfterDispatch = ticket => execution(ticket, {status: 'failed', dispatch_stage: 'dispatched',
  side_effects: 'none', output: null, execution_verified: false, task_verified: false, task_quality: 'failed',
  usage: null, error: 'native_outcome_uncertain_preserved'});

test('a settled read-only attempt releases its pool even when effects-uncertain; the next task on that pool runs', async t => {
  const dir = await fixture(t);
  const reader = candidate('reader', 'codex', 'openai_codex');
  const first = task(dir, 'Explain the failing check');
  let calls = 0;
  const runtime = await createRCCRuntime({stateDir: join(dir, 'state'),
    catalog: async value => catalog(value, [reader]),
    plan: async ({task: value}) => plan(value, [node('only', 'reader')]),
    execute: async ticket => { calls++; return calls === 1 ? failedAfterDispatch(ticket) : execution(ticket); },
    verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(first);
  const done = await wait(runtime, first);
  assert.equal(done.state, 'effects_uncertain', 'the failed attempt is still never replayed');
  assert.equal(done.error, 'dispatched_failure_no_replay');
  assert.deepEqual(leasePools(runtime), [], 'its read-only pool is free');
  assert.ok(runtime.events({schema: 1, task_id: first.task_id})
    .some(event => event.kind === 'quota_lease_released_settled_read_only'), 'the release names why');
  const next = task(dir, 'Answer the next question');
  await runtime.submit(next);
  const second = await wait(runtime, next);
  assert.equal(second.state, 'completed', `not ${second.error}`);
  assert.equal(calls, 2);
});

test('a write with uncertain effects keeps its pool lease, across a restart too', async t => {
  const dir = await fixture(t);
  const writer = candidate('writer', 'codex', 'openai_codex', {scope: 'workspace_write', allowedPaths: ['**']});
  const stateDir = join(dir, 'state');
  const write = task(dir, 'Change a registered file', 'auto', {write: true});
  let calls = 0;
  const options = {catalog: async value => catalog(value, [writer]),
    plan: async ({task: value}) => plan(value, [node('write', 'writer', {scope: 'workspace_write', ownedPaths: ['**']})]),
    verifyTask: taskVerdict};
  const runtime = await createRCCRuntime({stateDir, ...options,
    execute: async ticket => { calls++; return execution(ticket, {status: 'effects_uncertain', dispatch_stage: 'dispatched',
      side_effects: 'possible', output: null, execution_verified: false, task_verified: false, task_quality: 'failed',
      error: 'native_outcome_uncertain_preserved'}); }});
  await runtime.submit(write);
  assert.equal((await wait(runtime, write)).state, 'effects_uncertain');
  assert.deepEqual(leasePools(runtime), ['openai_codex:account-1'], 'a write keeps its pool');
  const other = join(dir, 'other'); await mkdir(other, {mode: 0o700});
  const blocked = task(other, 'Change a file in another checkout', 'auto', {write: true});
  await runtime.submit(blocked);
  assert.equal((await wait(runtime, blocked)).error, 'quota_pool_effects_uncertain');
  await runtime.close();
  const reopened = await createRCCRuntime({stateDir, ...options, execute: async () => { calls++; throw Error('must not run'); }});
  t.after(async () => { await reopened.close(); });
  assert.deepEqual(leasePools(reopened), ['openai_codex:account-1'], 'an owner start keeps a write lease');
  const again = task(other, 'Change another file in another checkout', 'auto', {write: true});
  await reopened.submit(again);
  assert.equal((await wait(reopened, again)).error, 'quota_pool_effects_uncertain');
  assert.equal(calls, 1, 'nothing ran on the uncertain pool');
});

test('an owner start releases stale leases (settled read-only, terminal, vanished task) and keeps an unsettled one', async t => {
  const dir = await fixture(t);
  const stateDir = join(dir, 'state');
  const rows = [candidate('codex-reader', 'codex', 'openai_codex'),
    candidate('claude-reader', 'claude', 'anthropic_shared'),
    candidate('codex-two', 'codex', 'openai_codex', {account: 'account-2'})];
  const settled = task(dir, 'The incident question: settled read-only');
  const unsettled = task(dir, 'A read-only attempt whose executor never returned');
  const finished = task(dir, 'A completed task');
  const byTask = new Map([[settled.task_id, 'codex-reader'], [unsettled.task_id, 'claude-reader'],
    [finished.task_id, 'codex-two']]);
  const options = {catalog: async value => catalog(value, rows),
    plan: async ({task: value}) => plan(value, [node('node-1', byTask.get(value.task_id) ?? 'codex-reader')]),
    verifyTask: taskVerdict};
  const first = await createRCCRuntime({stateDir, ...options, execute: async ticket => {
    if (ticket.task_id === settled.task_id) return failedAfterDispatch(ticket);
    if (ticket.task_id === unsettled.task_id) throw Error('transport dropped after dispatch');
    return execution(ticket);
  }});
  for (const value of [settled, unsettled, finished]) { await first.submit(value); await wait(first, value); }
  assert.deepEqual(leasePools(first), ['anthropic_shared:account-1'], 'only the unsettled attempt holds a pool');
  await first.close();
  // Recreate what build 378 left on disk: the settled read-only attempt's
  // lease and snapshot without the settled_side_effects marker (its attempt
  // carries only dispatched_failure 'no_effects', exactly as the incident's
  // did), a stale lease of a completed task, and one of a task row that does
  // not exist.
  const db = coreDB(stateDir);
  const row = db.prepare('SELECT snapshot FROM tasks WHERE task_id=?').get(settled.task_id);
  const snapshot = JSON.parse(row.snapshot);
  for (const child of snapshot.children) for (const entry of child.attempt_history) delete entry.settled_side_effects;
  assert.equal(snapshot.children[0].attempt_history.at(-1).dispatched_failure, 'no_effects');
  db.prepare('UPDATE tasks SET snapshot=? WHERE task_id=?').run(JSON.stringify(snapshot), settled.task_id);
  const insert = db.prepare('INSERT INTO quota_leases(pool_key,task_id,acquired_ms) VALUES(?,?,?)');
  insert.run('openai_codex:account-1', settled.task_id, Date.now());
  insert.run('openai_codex:account-2', finished.task_id, Date.now());
  insert.run('openai_chat:account-1', 'task-vanished', Date.now());
  db.close();
  let ran = 0;
  const reopened = await createRCCRuntime({stateDir, ...options, execute: async ticket => { ran++; return execution(ticket); }});
  t.after(async () => { await reopened.close(); });
  assert.deepEqual(leasePools(reopened), ['anthropic_shared:account-1'],
    'stale leases are released at owner start; the attempt that never returned keeps its pool');
  const kinds = value => reopened.events({schema: 1, task_id: value.task_id}).map(event => event.kind);
  assert.ok(kinds(settled).includes('quota_lease_released_settled_read_only'));
  assert.ok(kinds(finished).includes('quota_lease_released_task_terminal'));
  assert.ok(!kinds(unsettled).some(kind => kind.startsWith('quota_lease_released')));
  assert.equal(reopened.status({schema: 1, task_id: settled.task_id}).state, 'effects_uncertain',
    'the uncertain attempt itself is preserved, never replayed');
  // The owner's next question on the freed pool runs (the incident's held task).
  const next = task(dir, '너 라우팅 할 수 있는 쪽으로 최대한 다 라우팅 해봐. 엄청 간단한 알제브라 계산 있잖아.');
  await reopened.submit(next);
  const done = await wait(reopened, next);
  assert.equal(done.state, 'completed', `not ${done.error}`);
  assert.equal(ran, 1);
  // The unsettled pool still surfaces as the existing hold.
  const claudeOnly = task(dir, 'A question for the uncertain pool');
  byTask.set(claudeOnly.task_id, 'claude-reader');
  await reopened.submit(claudeOnly);
  assert.equal((await wait(reopened, claudeOnly)).error, 'quota_pool_effects_uncertain');
});

test('lease acquisition releases a stale foreign lease instead of holding or waiting on it', async t => {
  const dir = await fixture(t);
  const stateDir = join(dir, 'state');
  const reader = candidate('reader', 'codex', 'openai_codex');
  const options = {catalog: async value => catalog(value, [reader]),
    plan: async ({task: value}) => plan(value, [node('only', 'reader')]), verifyTask: taskVerdict};
  const runtime = await createRCCRuntime({stateDir, ...options, execute: async ticket => failedAfterDispatch(ticket)});
  t.after(async () => { await runtime.close(); });
  const first = task(dir, 'First question');
  await runtime.submit(first);
  assert.equal((await wait(runtime, first)).state, 'effects_uncertain');
  // A lease written while this owner ran (an older runtime's rule, or a
  // crash between settle and release) is reconciled where it is acquired.
  runtime.db.prepare('INSERT INTO quota_leases(pool_key,task_id,acquired_ms) VALUES(?,?,?)')
    .run('openai_codex:account-1', first.task_id, Date.now());
  runtime.execute = async ticket => execution(ticket);
  const next = task(dir, 'Second question');
  await runtime.submit(next);
  const done = await wait(runtime, next);
  assert.equal(done.state, 'completed', `not ${done.error}`);
  assert.ok(runtime.events({schema: 1, task_id: first.task_id})
    .some(event => event.kind === 'quota_lease_released_settled_read_only'));
  assert.deepEqual(leasePools(runtime), []);
});

// ---- One indivisible task runs the owner's own words (2026-10-14) ----------
test('lockIndivisibleInstruction: one agent node runs the request; decompositions, routes and exact nodes keep theirs', () => {
  const request = task('/tmp', '야 원플러스원 해봐.');
  const rewrite = "Execute '원플러스원' (OnePlus One) command.";
  const one = plan(request, [node('n', 'a', {instruction: rewrite})]);
  const locked = lockIndivisibleInstruction(one, request);
  assert.equal(locked.changed, true);
  assert.equal(locked.plan.nodes[0].instruction, '야 원플러스원 해봐.');
  assert.equal(one.nodes[0].instruction, rewrite, 'pure: the input plan is not mutated');
  assert.deepEqual({...locked.plan.nodes[0], instruction: rewrite}, one.nodes[0], 'only the instruction changes');
  assert.equal(lockIndivisibleInstruction(locked.plan, request).changed, false, 'already the request: unchanged');
  assert.equal(lockIndivisibleInstruction({...one, final_node_id: 'n'}, request).changed, true,
    'a single node named final integrates nothing');
  for (const [label, value, owner] of [
    ['two nodes', plan(request, [node('a', 'a', {instruction: 'part one'}), node('b', 'a', {instruction: 'part two'})]), request],
    ['a final integration node', {...plan(request, [node('a', 'a', {instruction: 'part one'}),
      node('b', 'a', {instruction: 'integrate', dependencies: ['a']})]), final_node_id: 'b'}, request],
    ['an explicit route test', one, {...request, mode: 'explicit_routing_test'}],
    ['a deterministic node', plan(request, [node('n', 'local', {kind: 'deterministic', instruction: '1+1'})]), request],
    ['a request over the node instruction bound', one, {...request, request: 'x'.repeat(12_001)}],
    ['no plan', null, request]]) {
    const result = lockIndivisibleInstruction(value, owner);
    assert.equal(result.changed, false, label);
    assert.equal(result.plan, value, `${label}: the same plan object`);
  }
});

test('a one-node plan dispatches the request; a decomposition keeps the planner text; a repair stays locked', async t => {
  const dir = await fixture(t);
  const rows = [candidate('a'), candidate('b')];
  const rewrite = "Execute '원플러스원' (OnePlus One) command.";
  // One node, adapter-bound: the planner's paraphrase never reaches the backend.
  const single = task(dir, '야 원플러스원 해봐.');
  const tickets = [];
  const runtime = await createRCCRuntime({stateDir: join(dir, 'single'), catalog: async value => catalog(value, rows),
    plan: async ({task: value, repair}) => plan(value, [node('only', repair ? 'b' : 'a',
      {instruction: repair ? 'Repair paraphrase' : rewrite})]),
    execute: async ticket => {
      tickets.push(ticket);
      // The first row verifiably did not dispatch: a planner repair binds b.
      if (ticket.candidate_id === 'a') return execution(ticket, {status: 'failed', dispatch_stage: 'not_dispatched',
        side_effects: 'none', output: null, execution_verified: false, task_verified: false, task_quality: 'failed',
        acknowledged_config: null});
      return execution(ticket);
    }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(single);
  const done = await wait(runtime, single);
  assert.equal(done.state, 'completed', done.error);
  assert.deepEqual(tickets.map(ticket => [ticket.candidate_id, ticket.instruction, ticket.objective]),
    [['a', single.request, single.request], ['b', single.request, single.request]],
    'the original and the repaired dispatch both run the owner request');
  assert.equal(done.children[0].instruction, single.request);
  const admitted = runtime.events({schema: 1, task_id: single.task_id}).find(event => event.kind === 'plan_admitted');
  assert.equal(admitted.snapshot.children[0].routing_decision.reason, 'adapter_bound;instruction_host_locked');
  assert.ok(runtime.events({schema: 1, task_id: single.task_id}).some(event => event.kind === 'safe_subset_replanned'));
  // Two independent parts: each node keeps the planner's own instruction.
  const split = task(dir, 'Explain the parser and the lexer');
  const splitTickets = [];
  const splitRuntime = await createRCCRuntime({stateDir: join(dir, 'split'), catalog: async value => catalog(value, rows),
    plan: async ({task: value}) => plan(value, [node('parser', 'a', {instruction: 'Explain the parser'}),
      node('lexer', 'b', {instruction: 'Explain the lexer'})]),
    execute: async ticket => { splitTickets.push(ticket); return execution(ticket); }, verifyTask: taskVerdict});
  t.after(async () => { await splitRuntime.close(); });
  await splitRuntime.submit(split);
  assert.equal((await wait(splitRuntime, split)).state, 'completed');
  assert.deepEqual(splitTickets.map(ticket => ticket.instruction).sort(), ['Explain the lexer', 'Explain the parser']);
  assert.ok(!splitRuntime.events({schema: 1, task_id: split.task_id}).find(event => event.kind === 'plan_admitted')
    .snapshot.children.some(child => child.routing_decision?.reason.includes('instruction_host_locked')));
});
