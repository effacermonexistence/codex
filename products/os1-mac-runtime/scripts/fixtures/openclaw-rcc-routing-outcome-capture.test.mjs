// Actual PRIVATE synthetic files, never a provider/native invocation. Capture
// does not read the fake provider JSONL pointer or execute a checker.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync, realpathSync, symlinkSync, linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {captureRoutingOutcome as capture} from '../../Resources/openclaw-os1-bridge/routing-outcome-capture.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
function setup(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'os1-capture-fixture-')); chmodSync(root, 0o700);
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const stateDir = join(root, 'state'), dir = join(stateDir, 'native-receipts');
  mkdirSync(stateDir, {mode: 0o700}); mkdirSync(dir, {mode: 0o700});
  const config = {surface: 'codex', transport: 'codex_app_server', account_id: 'synthetic-account', model: 'gpt-fixture',
    effort: 'low', tools: ['read_file'], scope: 'read_only', permission_profile: 'read_only', quota_pool: 'openai_codex',
    allowed_paths: ['/synthetic-owned-workspace'], configuration_sha256: sha('config')};
  const identity = {task_id: 'task-fixture', node_id: 'node-fixture', attempt_id: randomUUID(), candidate_id: 'candidate-fixture',
    request_sha256: sha('request'), source_fingerprint: sha('source'), policy_sha256: sha('policy'),
    configuration_sha256: config.configuration_sha256, quality_contract_sha256: null};
  const path = join(dir, randomUUID() + '.json');
  const result = {schema: 1, task_id: identity.task_id, node_id: identity.node_id, attempt_id: identity.attempt_id,
    candidate_id: identity.candidate_id, configuration_sha256: identity.configuration_sha256,
    selected_config: config, acknowledged_config: structuredClone(config), observed_config: null,
    status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', execution_verified: true,
    task_verified: false, task_quality: 'execution_only', parity_state: 'unverified', output: 'Synthetic visible answer',
    native_receipt: path, usage: {input_tokens: 100, output_tokens: 20, cache_read_tokens: 80, metric: 'native_usage_observation'},
    native_turn_terminated: true, error: null,
    native_summary: JSON.stringify({status: 'returned_unverified', steps: [{provider: 'codex', model: config.model, effort: config.effort,
      session_id: 'explicit-session', native_record: {turn_id: 'explicit-turn', record_path: '/forbidden-must-not-read/provider.jsonl', persistence: 'verified'}}]})};
  const save = (bytes = Buffer.from(JSON.stringify(result))) => { writeFileSync(path, bytes, {mode: 0o600}); chmodSync(path, 0o600); return bytes; };
  save(); const args = {stateDir, identity, selectedConfig: config, result, attemptState: 'completed', origin: 'synthetic_fixture', now_ms: 1000};
  return {root, dir, path, config, identity, result, save, args, run: () => capture(args)};
}
test('exact synthetic adapter receipt is captured, SHA is raw adapter bytes not guessed provider JSONL', t => {
  const f = setup(t), raw = readFileSync(f.path), r = f.run();
  assert.equal(r.status, 'captured'); assert.equal(r.capture.adapter_receipt_sha256, sha(raw));
  assert.equal(r.capture.adapter_receipt_path, f.path); assert.equal(r.capture.adapter_receipt_bytes, raw.length);
  assert.equal(r.capture.record_basis, 'native_adapter_execution_record_not_provider_jsonl');
  assert.equal(r.capture.provider_native_record_read, false);
  assert.equal(r.record.native.execution_id, f.identity.attempt_id);
  assert.equal(r.capture.native_identity_basis, 'adapter_execution_envelope_attempt_id_not_provider_execution_id');
  assert.equal(r.record.native.session_id, 'explicit-session'); assert.equal(r.record.native.turn_id, 'explicit-turn');
  assert.equal(r.record.native.record_sha256, sha(raw)); assert.equal(r.record.result.output_sha256, sha(f.result.output));
  assert.equal(r.record.observed_config, null); assert.equal(r.record.attribution.actual_config, null);
  assert.equal(r.record.learning.correctness_label, null); assert.equal(r.record.learning.eligible, false);
  assert.equal(r.record.usage.total_tokens_observed, null); assert.equal(r.record.usage.quota_consumption, 'unknown');
  assert.equal(r.record.usage.cash_cost, 'unknown'); assert.equal(r.record.parity_state, 'unverified');
  assert.equal(r.task_adoption_changed, false); assert.equal(r.execution_authorized, false);
  assert.ok(Buffer.byteLength(JSON.stringify(r.record)) + 1 <= 8192);
  assert.equal(JSON.stringify(r.record).includes(f.path), false); assert.equal(JSON.stringify(r.record).includes(f.result.output), false);
  assert.notEqual(f.path, join(f.dir, f.identity.attempt_id + '.json'));
});
test('observed config is recorded ONLY when actual exact receipt supplies it', t => {
  const f = setup(t); f.result.observed_config = structuredClone(f.config); f.save(); const r = f.run();
  assert.equal(r.status, 'captured'); assert.equal(r.record.observed_config.model, f.config.model);
  assert.equal(r.record.learning.correctness_label, null);
});
test('missing ACK is never manufactured; failed unacknowledged attempt remains an observation', t => {
  const f = setup(t); delete f.result.acknowledged_config; f.result.execution_verified = false; f.result.status = 'failed';
  f.result.task_quality = 'failed'; f.save(); const r = f.run(); assert.equal(r.status, 'captured');
  assert.equal(r.record.acknowledged_config, null); assert.equal(r.record.learning.correctness_label, null);
});
test('execution-verified claim without ACK quarantines instead of restoring requested config', t => {
  const f = setup(t); delete f.result.acknowledged_config; f.save(); assert.equal(f.run().status, 'quarantined');
});
test('requested provider without ACK/observed/explicit summary remains unknown', t => {
  const f = setup(t); f.result.acknowledged_config = null; f.result.native_summary = null;
  f.result.execution_verified = false; f.result.status = 'failed'; f.result.task_quality = 'failed'; f.save();
  const r = f.run(); assert.equal(r.status, 'captured'); assert.equal(r.record.native.provider, 'unknown');
  assert.ok(r.unknown_fields.includes('actual_provider_origin_unavailable'));
});
test('partial/full adapter checker claims are not independently loaded or promoted', t => {
  const f = setup(t); f.result.operational_quality = {coverage: 'partial', witness_path: '/forbidden/checker.json'};
  f.save(); const r = f.run(); assert.equal(r.status, 'captured'); assert.equal(r.capture.reported_checker_coverage, 'partial');
  assert.equal(r.record.quality.kind, 'unknown'); assert.equal(r.record.learning.correctness_label, null);
  f.result.operational_quality.coverage = 'full'; f.result.task_verified = true; f.result.task_quality = 'task_verified'; f.save();
  assert.equal(f.run().record.learning.correctness_label, null);
});
test('default unknown origin stays unknown even with private receipt and adapter task_verified', t => {
  const f = setup(t); delete f.args.origin; f.result.task_verified = true; f.result.task_quality = 'task_verified'; f.save();
  const r = f.run(); assert.equal(r.record.origin, 'unknown'); assert.equal(r.record.learning.eligible, false);
});
test('missing or ambiguous summary IDs stay null, not path/request guesses', t => {
  const f = setup(t); f.result.native_summary = JSON.stringify({steps: [{provider: 'codex', model: 'wrong', effort: 'low', session_id: 'wrong'}]}); f.save();
  let r = f.run(); assert.equal(r.status, 'captured'); assert.equal(r.record.native.session_id, null); assert.equal(r.record.native.turn_id, null);
  f.result.native_summary = JSON.stringify({steps: [{session_id: 'one'}, {session_id: 'two'}]}); f.save();
  r = f.run(); assert.equal(r.record.native.session_id, null); assert.equal(r.record.native.turn_id, null);
  f.result.native_summary = null; delete f.result.native_turn_terminated; f.save(); assert.equal(f.run().record.native.turn_terminated, null);
});
for (const [name, mutate] of [
  ['foreign body attempt', f => { const body = {...f.result, attempt_id: randomUUID()}; f.save(Buffer.from(JSON.stringify(body))); }],
  ['foreign Core task', f => { f.args.identity = {...f.identity, task_id: 'foreign'}; }],
  ['selected config mismatch', f => { f.args.selectedConfig = {...f.config, model: 'other'}; }],
  ['ACK model mismatch', f => { f.result.acknowledged_config.model = 'other'; f.save(); }],
  ['observed effort mismatch', f => { f.result.observed_config = {...f.config, effort: 'ultra'}; f.save(); }],
  ['result differs from actual body', f => { f.result.output = 'not in receipt'; }],
  ['file mode public', f => chmodSync(f.path, 0o644)],
  ['directory mode public', f => chmodSync(f.dir, 0o755)],
  ['state root mode public', f => chmodSync(f.args.stateDir, 0o755)],
  ['hardlink receipt', f => linkSync(f.path, join(f.root, 'other-link'))],
  ['receipt directory as file', f => { rmSync(f.path); mkdirSync(f.path, {mode: 0o700}); }],
  ['empty receipt', f => f.save(Buffer.alloc(0))],
  ['oversize receipt', f => f.save(Buffer.alloc(2 * 1024 * 1024 + 1, 32))],
  ['invalid JSON', f => f.save(Buffer.from('{broken'))],
  ['invalid UTF8', f => f.save(Buffer.from([0x7b, 0xff, 0x7d]))],
  ['duplicate JSON key', f => f.save(Buffer.from(JSON.stringify(f.result).replace('"schema":1', '"schema":1,"schema":1')))],
  ['escaped duplicate JSON key', f => f.save(Buffer.from(JSON.stringify(f.result).replace('"schema":1', '"schema":1,"sch\\u0065ma":1')))],
  ['missing receipt', f => rmSync(f.path)],
]) test('quarantine capture only: ' + name, t => {
  const f = setup(t); mutate(f); const r = f.run(); assert.equal(r.status, 'quarantined'); assert.equal(r.record, null);
  assert.equal(r.task_adoption_changed, false); assert.equal(r.execution_authorized, false);
});
test('leaf symlink and parent symlink are rejected without reading their targets', t => {
  const f = setup(t), target = join(f.root, 'private-outside.json'); writeFileSync(target, JSON.stringify(f.result), {mode: 0o600});
  rmSync(f.path); symlinkSync(target, f.path); assert.equal(f.run().status, 'quarantined');
  rmSync(f.path); rmSync(f.dir, {recursive: true}); const outsideDir = join(f.root, 'outside'); mkdirSync(outsideDir, {mode: 0o700});
  symlinkSync(outsideDir, f.dir); assert.equal(f.run().status, 'quarantined'); assert.equal(readFileSync(target, 'utf8'), JSON.stringify(f.result));
});
test('outside, nested, non-UUID, relative and alias pointer cannot trigger scanning or arbitrary read', t => {
  const f = setup(t);
  for (const path of [join(f.root, 'outside.json'), join(f.dir, 'nested', randomUUID() + '.json'),
    join(f.dir, 'not-a-uuid.json'), './relative.json', `${f.dir}/../native-receipts/${f.path.split('/').at(-1)}`]) {
    const result = {...f.result, native_receipt: path}; const r = capture({...f.args, result}); assert.equal(r.status, 'quarantined');
  }
});
test('caller objects remain unchanged and capture does not mutate receipt bytes or permissions', t => {
  const f = setup(t), args = JSON.stringify(f.args), before = readFileSync(f.path); const r = f.run();
  assert.equal(r.status, 'captured'); assert.equal(JSON.stringify(f.args), args); assert.deepEqual(readFileSync(f.path), before);
  assert.ok(Object.isFrozen(r.record));
});

function configuredInput(f, provider = 'codex') {
  const h = x => sha(JSON.stringify(x));
  const bytes = text => ({sha256: sha(text), utf8_bytes: Buffer.byteLength(text)});
  // Independent synthetic preparation, not a real provider receipt or training row.
  const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) :
    Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
  return {schema: 1, kind: 'native_configured_input_observation_v1',
    ...Object.fromEntries(['task_id', 'node_id', 'attempt_id', 'candidate_id', 'request_sha256',
      'source_fingerprint', 'policy_sha256', 'configuration_sha256'].map(k => [k, f.identity[k]])),
    original_source_fingerprint: f.identity.source_fingerprint, policy_source_sha256: sha('source-policy'),
    selected_config_sha256: sha(JSON.stringify(canonical(f.config))),
    renderer_id: 'rcc_delegated_envelope_provider_prompt_native_channels_v1', harness_sha256: h('actual-harness'),
    launch_entry_sha256: h('selected-native-launch-entry'), native_binary_sha256:null, native_binary_basis:'backend_image_not_observed', catalog_sha256: h('fresh-native-typed-model-catalog'),
    catalog_observed_at_ms: 800, prepared_at_ms: 900,
    catalog_basis: 'selected_provider_inventory_before_authorization_not_core_candidate_catalog',
    channel: provider === 'codex' ? 'codex_developer' : 'claude_append_system', session_state: 'new',
    delegated_input: bytes('Synthetic owner task and delegated envelope'), provider_input: bytes('Synthetic providerPrompt body'),
    instructions: bytes('Synthetic final configured system/developer channel'), base_instructions: null,
    execution_configuration_sha256: h('final overrides/arguments'),
    execution_configuration_basis: provider === 'codex' ? 'codex_app_server_overrides_only' : 'claude_cli_final_arguments_only',
    input_coverage: 'os1_explicit_channels_only_provider_hidden_defaults_unobserved',
    capture_state: 'prepared_before_native_turn', backend_inclusion_verified: false, quality_certified: false,
    execution_authorized: false, tokenizer_id: null, input_tokens: null, context_window_tokens: null,
    family: null, capacity_upper_bound: null};
}
test('fresh configured input observation survives the existing exact receipt capture without authorizing or learning', t => {
  const f = setup(t); f.result.configured_input_observation = configuredInput(f); f.save();
  const r = f.run(); assert.equal(r.status, 'captured');
  assert.deepEqual(r.capture.configured_input_observation, f.result.configured_input_observation);
  assert.equal(r.capture.configured_input_basis, 'actual_adapter_prepared_hashes_not_provider_inclusion_or_token_measurement');
  assert.equal(r.record.learning.eligible, false); assert.equal(r.record.observed_config, null);
  assert.equal(r.record.usage.total_tokens_observed, null); assert.equal(r.record.parity_state, 'unverified');
  assert.equal(r.execution_authorized, false); assert.equal(r.task_adoption_changed, false);
  assert(!JSON.stringify(r.capture).includes('Synthetic providerPrompt body'));
  assert(r.unknown_fields.includes('provider_instruction_inclusion_not_observed'));
});
test('legacy receipt has no invented input observation', t => {
  const r = setup(t).run(); assert.equal(r.status, 'captured');
  assert.equal(r.capture.configured_input_observation, null); assert.equal(r.capture.configured_input_basis, 'not_captured');
});
for (const [name, mutate] of [
  ['foreign task', x => x.task_id = 'foreign-task'],
  ['foreign node', x => x.node_id = 'foreign-node'],
  ['foreign attempt', x => x.attempt_id = randomUUID()],
  ['foreign request', x => x.request_sha256 = sha('foreign')],
  ['foreign source', x => x.source_fingerprint = sha('foreign')],
  ['foreign config tuple', x => x.selected_config_sha256 = sha('foreign')],
  ['wrong native channel', x => x.channel = 'claude_append_system'],
  ['count invented from bytes', x => x.input_tokens = 123],
  ['window invented from name', x => x.context_window_tokens = 272000],
  ['backend image inferred from entry', x => x.native_binary_sha256 = sha('entry-is-not-loaded-image')],
  ['tokenizer invented', x => x.tokenizer_id = 'invented-tokenizer'],
  ['family invented', x => x.family = 'translation'],
  ['capacity invented', x => x.capacity_upper_bound = 42],
  ['quality upgrade', x => x.quality_certified = true],
  ['authority upgrade', x => x.execution_authorized = true],
  ['inclusion upgrade', x => x.backend_inclusion_verified = true],
  ['future preparation', x => x.prepared_at_ms = 1001],
  ['catalog after preparation', x => x.catalog_observed_at_ms = 901],
  ['empty instruction bytes', x => x.instructions.utf8_bytes = 0],
  ['overflow input bytes', x => x.provider_input.utf8_bytes = 8388609],
  ['private raw text injected', x => x.provider_input.text = 'MUST_NOT_COPY'],
  ['missing explicit unknown', x => delete x.family],
]) test('configured input capture rejects ' + name + ', not narrative completion', t => {
  const f = setup(t); f.result.configured_input_observation = configuredInput(f); mutate(f.result.configured_input_observation); f.save();
  const before = readFileSync(f.path), r = f.run(); assert.equal(r.status, 'quarantined');
  assert.equal(r.execution_authorized, false); assert.equal(r.task_adoption_changed, false); assert.equal(r.record, null);
  assert.deepEqual(readFileSync(f.path), before);
});
test('Claude prepared channel remains separate from underlying system/base defaults', t => {
  const f = setup(t); Object.assign(f.config, {surface:'claude', transport:'claude_cli', quota_pool:'anthropic_shared'});
  f.result.selected_config = f.config; f.result.acknowledged_config = structuredClone(f.config); f.result.native_summary = null;
  f.result.configured_input_observation = configuredInput(f,'claude'); f.save(); const r = f.run();
  assert.equal(r.status,'captured'); assert.equal(r.capture.configured_input_observation.base_instructions,null);
  assert.equal(r.capture.configured_input_observation.input_coverage,'os1_explicit_channels_only_provider_hidden_defaults_unobserved');
});

test('same SQLite Core preserves fresh prepared inputs in its existing settled outcome across restart', async t => {
  const {createRCCRuntime, hostContextFingerprint} = await import('../../Resources/openclaw-os1-bridge/rcc-runtime.mjs');
  const f = setup(t), policy = 'Synthetic observation: not route authority'; let dispatches = 0;
  f.config.allowed_paths = []; // Real Core admits relative scoped paths, not capture-only fake absolute paths.
  f.result.acknowledged_config = structuredClone(f.config);
  const host = {workspace: f.root, context: null, provider_preference: 'auto', codex_session_id: null, claude_session_id: null,
    require_read_only: true, owner_policy: null};
  const q = {schema:1,task_id:randomUUID(),request:'Explain the supplied fixture boundary.',objective:'Explain the supplied fixture boundary.',
    request_sha256:sha('Explain the supplied fixture boundary.'),source_fingerprint:hostContextFingerprint(host),policy_sha256:sha(policy),
    mode:'auto',material_refs:[],host_context:host,policy:{source_sha256:sha('synthetic policy source'),projection_sha256:sha(policy),text:policy},
    budget:{max_attempts:1,max_parallel:1,max_cost_units:null,max_duration_ms:10000}};
  const now = Date.now(), candidate = {id:f.identity.candidate_id,...f.config,availability:'available',
    availability_observed_at_ms:now-1,availability_valid_until_ms:now+60000,quota_remaining_fraction:.8,
    quota_observed_at_ms:now-1,quota_valid_until_ms:now+60000,estimated_cost_units:1,quality_state:'policy_admitted'};
  const adaptivePolicy = {schema:1,mode:'shadow',policy_id:'input-observation-fixture',version:'1',rcc_source_sha256:q.policy.source_sha256,
    projection_sha256:q.policy_sha256,reference_policy_sha256:null,allowed_workload_classes:['readonly_lookup'],max_nodes:1,max_parallel:1,
    max_plan_revisions:0,max_planner_calls:1,planner_input_bytes:64000,planner_output_tokens:256,
    requires_live_reference_fallback:true,adoption_manifest_sha256:null};
  let runtime = await createRCCRuntime({stateDir:f.args.stateDir,adaptiveRoutingPolicy:adaptivePolicy,proposeLocalPlan:async()=>null,
    catalog:async task=>({schema:1,task_id:task.task_id,request_sha256:task.request_sha256,candidates:[candidate]}),
    plan:async({task})=>({schema:1,task_id:task.task_id,request_sha256:task.request_sha256,nodes:[{
      id:'node-fixture',kind:'agent',candidate_id:candidate.id,instruction:task.request,dependencies:[],scope:'read_only',owned_paths:[],context_refs:[]}]}),
    execute:async ticket=>{dispatches++;
      for(const key of ['task_id','node_id','attempt_id','candidate_id','request_sha256','source_fingerprint','policy_sha256','configuration_sha256']) f.identity[key]=ticket[key];
      for(const key of ['task_id','node_id','attempt_id','candidate_id','configuration_sha256']) f.result[key]=ticket[key];
      f.result.configured_input_observation=configuredInput(f); f.result.configured_input_observation.policy_source_sha256=ticket.policy_source_sha256;
      f.save(); return structuredClone(f.result);
    }});
  t.after(async()=>runtime.close()); await runtime.submit(q);
  const out=await runtime.wait({schema:1,task_id:q.task_id},{timeoutMs:4000});
  assert.equal(out.state,'returned_unverified', JSON.stringify(out)); assert.equal(dispatches,1);
  // wait() observes terminal user state; the same Core's settled ledger finalizer can finish in the following microtask.
  for (let i=0;i<50 && !runtime._load(q.task_id).children[0].attempt_history[0].routing_outcome;i++)
    await new Promise(resolve=>setTimeout(resolve,10));
  const entry=runtime._load(q.task_id).children[0].attempt_history[0], cap=entry.routing_outcome;
  assert.equal(cap.status,'captured'); assert.deepEqual(cap.capture.configured_input_observation,f.result.configured_input_observation);
  assert.equal(cap.record.learning.eligible,false); assert.equal(cap.record.parity_state,'unverified');
  assert.equal(cap.capture.configured_input_observation.input_tokens,null);
  await runtime.close(); runtime=await createRCCRuntime({stateDir:f.args.stateDir,execute:async()=>{throw Error('MUST_NOT_REDISPATCH');}});
  assert.deepEqual(runtime._load(q.task_id).children[0].attempt_history[0].routing_outcome.capture.configured_input_observation,
    f.result.configured_input_observation); assert.equal(dispatches,1);
});
