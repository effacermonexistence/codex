import './local-model-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, chmod, rm, readdir, readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerRCCRuntime } from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';
import {hostContextFingerprint} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');

// SDK admission analogue: a background completion in a released request scope
// is refused. The actual pinned Gateway is independently smoke-tested; this
// fixture catches the service/RPC lifetime regression without any model call.
// Build 407 (R7): Auto plans are host-built, so the one local-model completion
// left on this path is intent resolution; it must run in the service scope.
test('durable local intent completion does not inherit a released submit RPC root; Auto makes no planning call', async () => {
  const root = await mkdtemp(join(tmpdir(), 'os1-rcc-plugin-lifecycle-'));
  await chmod(root, 0o700);
  const keys = ['OS1_RCC_STATE_ROOT', 'OS1_RCC_NATIVE_PATH', 'OS1_RCC_NATIVE_SHA256',
    'OS1_RCC_NATIVE_HOME', 'OS1_RCC_PUBLIC_POLICY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const native = join(root, 'native.mjs');
  const body = `#!${process.execPath}\nimport{readFileSync}from'node:fs';import{createHash}from'node:crypto';
const p=JSON.parse(readFileSync(process.argv[4],'utf8'));const sha=s=>createHash('sha256').update(s).digest('hex');
if(process.argv[2]==='rcc-intent'){const t=p.task,b={schema:1,task_id:t.task_id,request_sha256:t.request_sha256,policy_sha256:t.policy_sha256,source_fingerprint:t.source_fingerprint};console.log(JSON.stringify(p.answer===undefined?{...b,kind:'needs_model',model_prompt:'Classify the routing intent.',model_input:t.request,model_schema:{type:'object'},model_schema_json:'{"type":"object"}'}:{...b,kind:'ordinary',routes:[],best_effort:false,notices:[],reason:null}));process.exit(0);}
if(process.argv[1]&&process.argv[2]==='rcc-catalog') {await new Promise(r=>setTimeout(r,35));const n=Date.now();console.log(JSON.stringify({schema:1,task_id:p.task_id,request_sha256:p.request_sha256,candidates:[{id:'fixture',surface:'codex',transport:'codex_app_server',account_id:'fixture',model:'fixture',effort:'low',tools:[],scope:'read_only',permission_profile:'read_only',quota_pool:'openai_codex',allowed_paths:[],configuration_sha256:sha('fixture'),availability:'available',availability_observed_at_ms:n,availability_valid_until_ms:n+300000,quota_remaining_fraction:1,quota_observed_at_ms:n,quota_valid_until_ms:n+300000,quality_state:'policy_admitted',estimated_cost_units:1}]}));}
else if(process.argv[2]==='rcc-adapter')console.log(JSON.stringify({schema:1,task_id:p.task_id,node_id:p.node_id,attempt_id:p.attempt_id,candidate_id:p.candidate_id,configuration_sha256:p.configuration_sha256,selected_config:p.selected_config,acknowledged_config:p.selected_config,observed_config:null,status:'succeeded',dispatch_stage:'dispatched',side_effects:'none',output:'hello',execution_verified:true,task_verified:false,task_quality:'execution_only',parity_state:'unverified',native_receipt:'private-fixture-receipt',usage:{provider_calls:0},error:null,native_summary:null}));else process.exit(91);`;
  await writeFile(native, body, { mode: 0o700 });
  const policy = 'Synthetic bounded source policy; no quality parity assertion.';
  Object.assign(process.env, { OS1_RCC_STATE_ROOT: root, OS1_RCC_NATIVE_PATH: native,
    OS1_RCC_NATIVE_SHA256: sha(body), OS1_RCC_NATIVE_HOME: root, OS1_RCC_PUBLIC_POLICY: policy });
  const requestScope = new AsyncLocalStorage();
  const methods = new Map(); let service, modelCalls = 0;
  const api = { on() {}, registerService(value) { service = value; },
    registerGatewayMethod(name, handler) { methods.set(name, handler); },
    runtime: { llm: { async complete(params) {
      await new Promise(resolve => setImmediate(resolve));
      if (requestScope.getStore()?.released) throw Object.assign(Error('Gateway is draining'), { name: 'GatewayDrainingError' });
      assert.equal(requestScope.getStore(), undefined, 'planner still owns transient RPC scope');
      assert.equal(params.model, 'ollama/qwen3.5:4b');
      assert(params.signal instanceof AbortSignal);
      modelCalls++;
      assert.equal(params.purpose, 'os1.rcc.internal-routing-intent', 'the local model never plans Auto');
      assert.equal(params.responseFormat.type, 'object');
      assert.equal(params.messages.length, 1);
      // The candidate ID never reaches the local model.
      assert.equal(JSON.stringify([params.systemPrompt, params.messages, params.responseFormat]).includes('"fixture"'), false);
      return { provider: 'ollama', model: 'qwen3.5:4b',
        execution: { mode: 'direct-provider', owner: { kind: 'provider', id: 'ollama' } },
        stopReason: 'stop', text: '{}' };
    } } } };
  registerRCCRuntime(api);
  const call = (name, params) => new Promise((resolve, reject) => {
    Promise.resolve(methods.get('os1.rcc.' + name)({ params, respond(ok, result, error) {
      ok ? resolve(result) : reject(Error(error?.message));
    } })).catch(reject);
  });
  try {
    await service.start({ stateDir: root });
    const host = { workspace: root, context: null, provider_preference: 'auto',
      codex_session_id: null, claude_session_id: null, require_read_only: true, owner_policy: null };
    const sorted = Object.fromEntries(Object.keys(host).sort().map(key => [key, host[key]]));
    const request = 'Reply with hello only';
    const task = { schema: 1, task_id: randomUUID(), request, request_sha256: sha(request), objective: request,
      policy_sha256: sha(policy), source_fingerprint: sha(JSON.stringify(sorted)), mode: 'auto', material_refs: [],
      budget: { max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 20000 },
      host_context: host, policy: { source_sha256: sha(policy), projection_sha256: sha(policy), text: policy } };
    const rpcOwner = { released: false };
    await requestScope.run(rpcOwner, async () => { await call('submit', task); rpcOwner.released = true; });
    let snapshot; const until = Date.now() + 5000;
    do { await new Promise(resolve => setTimeout(resolve, 15)); snapshot = await call('status', { schema: 1, task_id: task.task_id }); }
    while (!['returned_unverified', 'completed', 'held', 'failed'].includes(snapshot.state) && Date.now() < until);
    assert.equal(snapshot.state, 'returned_unverified', snapshot.error);
    assert.equal(snapshot.children.length, 1);
    assert.equal(snapshot.children[0].output_summary, 'hello');
    assert.equal(snapshot.children[0].candidate_id, 'fixture');
    assert.equal(snapshot.children[0].id, 'node_0');
    assert.equal(snapshot.children[0].instruction, request);
    assert.equal(snapshot.children[0].routing_decision.route_class, 'deep');
    assert.equal(snapshot.children[0].routing_decision.resolved_candidate_id, 'fixture');
    assert.equal(snapshot.result.task_verified, false);
    assert.equal(snapshot.result.parity_state, 'unverified');
    assert.equal(modelCalls, 1, 'one intent completion; no planning completion');
    const files = await readdir(root);
    assert(files.some(name => name.startsWith('intent-output-')));
    assert.equal(files.some(name => name.startsWith('planner-output-') || name.startsWith('planner-error-')), false);
    const duplicate = await call('submit', task);
    assert.equal(duplicate.revision, snapshot.revision);
    assert.equal(modelCalls, 1);
  } finally {
    await service.stop();
    for (const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key];
    await rm(root, { recursive: true, force: true });
  }
});

// Transport-only source-stage analogue. The fake native writer creates a real
// private, digest-bound receipt, but never touches a source tree or installer.
// Zero provider/model calls: llm.complete below is a deterministic SDK stub.
async function stagedLifecycleFixture(t) {
  const created = await mkdtemp(join(tmpdir(), 'os1-rcc-stage-lifecycle-'));
  await chmod(created, 0o700);
  const root = realpathSync(created), native = join(root, 'native.mjs');
  const body = `#!${process.execPath}
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,realpathSync,existsSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
const command=process.argv[2],flag=process.argv[3],inputFile=process.argv[4];
const expectedFlag=['rcc-adapter','rcc-stage'].includes(command)?'--ticket-file':'--request-file';
if(flag!==expectedFlag)process.exit(90);
const p=JSON.parse(readFileSync(inputFile,'utf8')),root=realpathSync(process.env.HOME);
const sha=x=>createHash('sha256').update(x).digest('hex');
const log=entry=>appendFileSync(join(root,'native-calls.jsonl'),JSON.stringify({command,flag,...entry})+'\\n');
const reply=value=>process.stdout.write(JSON.stringify(value));
if(command==='rcc-intent'){const t=p.task;reply({schema:1,task_id:t.task_id,request_sha256:t.request_sha256,policy_sha256:t.policy_sha256,source_fingerprint:t.source_fingerprint,kind:'ordinary',routes:[],best_effort:false,notices:[],reason:null});process.exit(0);}
if(command==='rcc-catalog') {
  log({task_id:p.task_id,request_sha256:p.request_sha256});
  const now=Date.now();reply({schema:1,task_id:p.task_id,request_sha256:p.request_sha256,candidates:[{
    id:'fixture-write',surface:'codex',transport:'codex_app_server',account_id:'synthetic-account',
    model:'synthetic-model',effort:'low',tools:[],scope:'workspace_write',permission_profile:'workspace_write',
    quota_pool:'openai_codex',allowed_paths:['**'],configuration_sha256:sha('fixture-write'),
    availability:'available',availability_observed_at_ms:now,availability_valid_until_ms:now+300000,
    quota_remaining_fraction:1,quota_observed_at_ms:now,quota_valid_until_ms:now+300000,
    quality_state:'policy_admitted',estimated_cost_units:1}]});
} else if(command==='rcc-adapter') {
  log({task_id:p.task_id,request_sha256:p.request_sha256,attempt_id:p.attempt_id,instruction:p.instruction});
  const directory=join(root,'native-receipts');mkdirSync(directory,{recursive:true,mode:0o700});
  const receipt=join(directory,randomUUID()+'.json');
  const record={schema:1,task_id:p.task_id,node_id:p.node_id,attempt_id:p.attempt_id,candidate_id:p.candidate_id,
    configuration_sha256:p.configuration_sha256,selected_config:p.selected_config,
    acknowledged_config:p.selected_config,observed_config:null,status:'succeeded',dispatch_stage:'dispatched',
    side_effects:'confirmed',output:'Synthetic source output preserved; installation is pending.',
    execution_verified:true,task_verified:false,task_quality:'execution_only',parity_state:'unverified',
    native_receipt:receipt,usage:{provider_calls:0},error:null,native_summary:'synthetic-native-summary',
    repair_source:{source_root:root,source_head:'a'.repeat(40),source_before_head:'b'.repeat(40),
      source_before_sha256:'c'.repeat(64),protected_source_sha256:'d'.repeat(64),
      source_before_clean:true,changed_paths:['products/os1-mac-runtime/Sources/Fixture.swift']}};
  writeFileSync(receipt,JSON.stringify(record),{flag:'wx',mode:0o600});reply(record);
} else if(command==='rcc-stage') {
  if(Object.keys(p).sort().join('|')!=='parent_record_path|parent_record_sha256|ticket'||
      !process.env.OS1_CANCEL_FILE||process.env.OS1_CANCEL_FILE!==inputFile+'.cancel')process.exit(91);
  const raw=readFileSync(p.parent_record_path),record=JSON.parse(raw),ticket=p.ticket;
  if(sha(raw)!==p.parent_record_sha256||record.task_id!==ticket.task_id||
      record.attempt_id!==ticket.attempt_id||record.native_receipt!==p.parent_record_path)process.exit(92);
  log({task_id:ticket.task_id,request_sha256:ticket.request_sha256,parent_attempt_id:ticket.attempt_id,
    parent_record_path:p.parent_record_path,parent_record_sha256:p.parent_record_sha256,
    cancel_file:process.env.OS1_CANCEL_FILE,ticket});
  reply({schema:1,task_id:ticket.task_id,request_sha256:ticket.request_sha256,node_id:ticket.node_id,
    parent_attempt_id:ticket.attempt_id,source_fingerprint:ticket.source_fingerprint,
    source_root:record.repair_source.source_root,source_head:record.repair_source.source_head,
    protected_source_sha256:record.repair_source.protected_source_sha256,
    staged_intent_id:'stage-'+ticket.task_id,staged_receipt_sha256:sha(raw),state:'staged',installed_receipt:null});
} else if(['rcc-install-status','rcc-install-cancel'].includes(command)) {
  if(Object.keys(p).sort().join('|')!=='install_handoff|request_sha256|schema|task_id'||
      process.env.OS1_CANCEL_FILE)process.exit(93);
  log({task_id:p.task_id,request_sha256:p.request_sha256,install_handoff:p.install_handoff});
  // Delay makes an un-awaited RPC wrapper observable rather than accidentally synchronous.
  await new Promise(resolve=>setTimeout(resolve,35));
  const control=join(root,p.task_id+'.install-control');
  const choice=existsSync(control)?readFileSync(control,'utf8'):'staged';
  const value={...p.install_handoff};
  if(command==='rcc-install-cancel'){value.state='cancelled';value.installed_receipt=null;}
  else if(choice==='installed'){value.state='installed';value.installed_receipt=join(root,'synthetic-install-receipt.json');}
  else if(choice==='mismatch'){value.state='installed';value.task_id='unrelated-task';value.installed_receipt=join(root,'unrelated-receipt.json');}
  reply(value);
} else process.exit(94);
`;
  await writeFile(native, body, {flag: 'wx', mode: 0o700});
  const policy = 'Synthetic staging transport policy; installation does not prove task quality.';
  const keys = ['OS1_RCC_STATE_ROOT', 'OS1_RCC_NATIVE_PATH', 'OS1_RCC_NATIVE_SHA256',
    'OS1_RCC_NATIVE_HOME', 'OS1_RCC_PUBLIC_POLICY'];
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {OS1_RCC_STATE_ROOT: root, OS1_RCC_NATIVE_PATH: native,
    OS1_RCC_NATIVE_SHA256: sha(body), OS1_RCC_NATIVE_HOME: root, OS1_RCC_PUBLIC_POLICY: policy});
  const scope = new AsyncLocalStorage(), methods = new Map();
  // Build 407 (R7): the host builds the one writer node itself; any local
  // model completion on this path is a regression.
  let service, started = false, localModelInvocations = 0;
  registerRCCRuntime({on() {}, registerService(value) {service = value;},
    registerGatewayMethod(name, handler) {methods.set(name, handler);},
    runtime: {llm: {async complete() {
      localModelInvocations++;
      throw Error('a host-built plan never calls the local model');
    }}}});
  const call = (name, params) => new Promise((resolve, reject) => {
    assert(methods.has('os1.rcc.' + name));
    Promise.resolve(methods.get('os1.rcc.' + name)({params, respond(ok, result, error) {
      ok ? resolve(result) : reject(Error(error?.message));
    }})).catch(reject);
  });
  const task = () => {
    const request = 'Apply one synthetic bounded source correction; preserve its original task.';
    const host = {workspace: root, context: null, provider_preference: 'auto', codex_session_id: null,
      claude_session_id: null, require_read_only: false, owner_policy: null,
      conversation_id: randomUUID(), submission_id: randomUUID()};
    return {schema: 1, task_id: randomUUID(), request, request_sha256: sha(request), objective: request,
      policy_sha256: sha(policy), source_fingerprint: hostContextFingerprint(host), mode: 'auto', material_refs: [],
      budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 20000}, host_context: host,
      policy: {source_sha256: sha(policy), projection_sha256: sha(policy), text: policy}};
  };
  const start = async () => {await service.start({stateDir: root}); started = true;};
  const stop = async () => {await service.stop(); started = false;};
  t.after(async () => {
    if (started) await stop();
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, {recursive: true, force: true});
  });
  async function submitAndStage(value) {
    const owner = {released: false};
    await scope.run(owner, async () => {await call('submit', value); owner.released = true;});
    const until = Date.now() + 5000;
    let snapshot;
    do {
      await new Promise(resolve => setTimeout(resolve, 15));
      snapshot = await call('status', {schema: 1, task_id: value.task_id});
    } while (!['awaiting_install', 'held', 'effects_uncertain', 'failed', 'completed', 'returned_unverified']
      .includes(snapshot.state) && Date.now() < until);
    assert.equal(snapshot.state, 'awaiting_install', snapshot.error);
    return snapshot;
  }
  const calls = async () => (await readFile(join(root, 'native-calls.jsonl'), 'utf8'))
    .trim().split('\n').map(line => JSON.parse(line));
  return {root, task, call, calls, submitAndStage, start, stop,
    modelCount: () => localModelInvocations};
}

test('stage/status/cancel RPCs retain one durable owner; awaiting installation is not completion or quality proof',
  {concurrency: false, timeout: 15_000}, async t => {
    const x = await stagedLifecycleFixture(t);
    await x.start();
    const installedTask = x.task();
    const waiting = await x.submitAndStage(installedTask);
    assert.equal(waiting.install_handoff.state, 'staged');
    assert.equal(waiting.children.length, 1);
    assert.equal(waiting.children[0].state, 'completed',
      'source execution can return while the original task remains awaiting installation');
    assert.equal(waiting.result.execution_verified, true);
    assert.equal(waiting.result.task_verified, false);
    assert.equal(waiting.result.task_quality, 'execution_only');
    assert.equal(waiting.result.parity_state, 'unverified');
    assert.equal(waiting.children[0].output_summary,
      'Synthetic source output preserved; installation is pending.');
    const firstCalls = await x.calls();
    const stage = firstCalls.find(item => item.command === 'rcc-stage');
    assert(stage, 'plugin must invoke its pinned native stage callback');
    assert.equal(stage.ticket.task_id, installedTask.task_id);
    assert.equal(stage.ticket.request_sha256, installedTask.request_sha256);
    assert.equal(stage.ticket.source_fingerprint, installedTask.source_fingerprint);
    assert.equal(stage.ticket.host_context.conversation_id, installedTask.host_context.conversation_id);
    assert.equal(stage.ticket.host_context.submission_id, installedTask.host_context.submission_id);
    const parent = await readFile(stage.parent_record_path);
    assert.equal(sha(parent), stage.parent_record_sha256, 'stage binds to the exact actual private native receipt');
    assert.equal(JSON.parse(parent).attempt_id, stage.parent_attempt_id);
    assert.equal(stage.flag, '--ticket-file');
    assert.match(stage.cancel_file, /\.json\.cancel$/);

    const duplicate = await x.call('submit', installedTask);
    assert.equal(duplicate.revision, waiting.revision);
    assert.equal(x.modelCount(), 0, 'the host-built plan and a duplicate submission call no model');

    // An unrelated installed receipt must not promote the current handoff.
    await writeFile(join(x.root, installedTask.task_id + '.install-control'), 'mismatch', {mode: 0o600});
    const mismatch = await x.call('status', {schema: 1, task_id: installedTask.task_id});
    assert.equal(mismatch.state, 'effects_uncertain');
    assert.equal(mismatch.error, 'install_reconciliation_invalid');
    assert.deepEqual(mismatch.install_handoff, waiting.install_handoff);
    await writeFile(join(x.root, installedTask.task_id + '.install-control'), 'installed', {mode: 0o600});
    const installed = await x.call('status', {schema: 1, task_id: installedTask.task_id});
    assert.equal(installed.state, 'returned_unverified', 'RPC must await same-owner installation reconciliation');
    assert.equal(installed.install_handoff.state, 'installed');
    assert.equal(installed.error, 'installed_task_quality_unverified');
    assert.equal(installed.result.task_verified, false);
    assert.equal(installed.result.task_quality, 'execution_only');
    assert.equal(installed.result.parity_state, 'unverified');

    const cancelledTask = x.task();
    const cancelWaiting = await x.submitAndStage(cancelledTask);
    const callsBeforeRestart = await x.calls();
    await x.stop();
    await x.start();
    const restored = await x.call('status', {schema: 1, task_id: cancelledTask.task_id});
    assert.equal(restored.state, 'awaiting_install');
    assert.deepEqual(restored.install_handoff, cancelWaiting.install_handoff);
    const cancelled = await x.call('cancel', {schema: 1, task_id: cancelledTask.task_id});
    assert.equal(cancelled.state, 'cancelled', 'RPC must await cancellation rather than return stale stage state');
    assert.equal(cancelled.install_handoff.state, 'cancelled');
    assert.equal(cancelled.install_handoff.installed_receipt, null);
    assert.equal(cancelled.result.task_verified, false);
    assert.equal(cancelled.result.parity_state, 'unverified');
    assert.equal(x.modelCount(), 0, 'installation reconciliation and restart never invoke a model');

    const allCalls = await x.calls();
    assert.equal(allCalls.filter(item => item.command === 'rcc-catalog').length,
      callsBeforeRestart.filter(item => item.command === 'rcc-catalog').length,
      'restart/status/cancel do not refresh the executor catalogue or select another route');
    assert.equal(allCalls.filter(item => item.command === 'rcc-adapter').length, 2);
    assert.equal(allCalls.filter(item => item.command === 'rcc-stage').length, 2,
      'restart/status/cancel must not replay source execution or staging');
    const reconciliations = allCalls.filter(item => item.command === 'rcc-install-status');
    assert(reconciliations.length >= 3, 'status wrapper must invoke the native same-owner observer');
    const cancellations = allCalls.filter(item => item.command === 'rcc-install-cancel');
    assert.equal(cancellations.length, 1);
    for (const item of [...reconciliations, ...cancellations]) {
      assert.equal(item.flag, '--request-file');
      assert.equal(item.task_id, item.install_handoff.task_id);
      assert.equal(item.request_sha256, item.install_handoff.request_sha256);
      const bound = item.task_id === installedTask.task_id ? waiting : cancelWaiting;
      assert.equal(item.install_handoff.parent_attempt_id, bound.install_handoff.parent_attempt_id);
      assert.equal(item.install_handoff.staged_intent_id, bound.install_handoff.staged_intent_id);
      assert.equal(item.install_handoff.staged_receipt_sha256, bound.install_handoff.staged_receipt_sha256);
    }
    assert.equal(cancellations[0].task_id, cancelledTask.task_id);
  });
