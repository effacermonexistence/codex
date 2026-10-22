// Synthetic source-contract tests only. None is a provider call, calibration,
// raw receipt review, held-out proof, or permission to enable covered_live.
// SYNTHETIC ONLY. Source-shaped examples are not actual provider measurements.
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {digest} from '../../Resources/openclaw-os1-bridge/joint-route-selector.mjs';
import {normalizeRoutingOutcome} from '../../Resources/openclaw-os1-bridge/routing-outcome.mjs';
import {produceOfflineRouteCalibration as produce, OFFLINE_CALIBRATION_FORMAT} from '../../Resources/openclaw-os1-bridge/offline-route-calibration.mjs';
import {frozenRouteFeatureBucket} from '../../Resources/openclaw-os1-bridge/frozen-route-predictor.mjs';
import {stableJSON, candidatePoolFingerprint} from '../../Resources/openclaw-os1-bridge/joint-route-selector.mjs';
const blobs = new Map();
const blob = x => {const utf8 = typeof x === 'string' ? x : stableJSON(x); const sha256 = createHash('sha256').update(utf8).digest('hex'); blobs.set(sha256, {sha256, utf8}); return sha256;};

const H = x => blob(`SYNTHETIC:${x}`);
const UUID = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
let policy = H('policy'); const contract = H('contract');
function config(model, effort) {
  return {surface: 'codex', transport: 'codex_app_server', account_id: 'synthetic-account',
    model, effort, tools: [], scope: 'read_only', permission_profile: 'read_only',
    quota_pool: 'openai_codex', allowed_paths: [],
    configuration_sha256: H(`${model}:${effort}:config`)};
}
const referenceConfig = config('SYNTHETIC-reference', 'ultra');
let routedConfig = config('SYNTHETIC-routed', 'low');
let epochOffset=0,variantTag='',variantSerial=0,poolOverride=null;
function arm(c) {
  return {candidate_id: c.model, configuration_sha256: c.configuration_sha256,
    config_sha256: digest(c), surface: c.surface, transport: c.transport, account_id: c.account_id,
    model: c.model, effort: c.effort, tools_sha256: digest(c.tools), instructions_sha256: H(`${c.model}:instructions`)};
}
function usage(n, total = 0) {
  if (total === null) return null;
  return {schema: 1, metric: 'native_usage_observation', source_receipt_sha256: H(`usage:${n}`),
    parent_scope: 'includes_children', children_coverage: 'complete_disjoint',
    parent: {execution_id: `execution-${n}`, parent_execution_id: null, basis: 'attempt_total',
      input_basis: 'includes_cache', output_basis: 'includes_reasoning', source_receipt_sha256: H(`usage-parent:${n}`),
      input_tokens: total, output_tokens: 0, reasoning_tokens: 0, cache_read_tokens: 0,
      cache_write_tokens: 0, provider_calls: 1, duration_ms: 10}, children: []};
}
function outcome(c, rawConfig, n, total, observedAt) {
  const attempt = UUID(n);
  const source = {schema: 1, origin: 'actual_execution', identity: {task_id: c.task_id, node_id: c.node_id,
    attempt_id: attempt, candidate_id: rawConfig.model, request_sha256: c.request_sha256,
    source_fingerprint: c.source_fingerprint, policy_sha256: policy,
    configuration_sha256: rawConfig.configuration_sha256, quality_contract_sha256: contract},
  provenance: {source_kind: 'core_settled_attempt', source_sha256: H(`receipt:${n}`), host_validated: true,
    observed_at_ms: observedAt},
  configs: {selected: rawConfig, acknowledged: structuredClone(rawConfig), observed: structuredClone(rawConfig)},
  native: {provider: 'openai', execution_id: `execution-${n}`, session_id: UUID(n+100), turn_id: UUID(n+200),
    record_sha256: H(`native:${n}`), turn_terminated: true},
  result: {status: 'succeeded', attempt_state: 'completed', dispatch_stage: 'dispatched', side_effects: 'none',
    execution_verified: true, task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
    output_sha256: H(`output:${n}`), artifact_sha256: H(`artifact:${n}`), error_code: null,
    failure_category: null, http_status: null},
  adoption: {state: 'unknown', scope: 'task', final_for_scope: null}, checker: null, usage: usage(n, total)};
  if (source.usage) blob(source.usage);
  const r = normalizeRoutingOutcome(source); assert.equal(r.status, 'normalized', r.reason);
  return r;
}
function binding(r, a) {
  return {outcome_id: r.outcome_id, normalized_sha256: r.normalized_sha256,
    task_id: r.identity.task_id, node_id: r.identity.node_id, attempt_id: r.identity.attempt_id,
    candidate_id: r.identity.candidate_id, configuration_sha256: r.identity.configuration_sha256,
    config_sha256: r.selected_config.config_sha256, instructions_sha256: a.instructions_sha256,
    tools_sha256: a.tools_sha256, source_fingerprint: r.identity.source_fingerprint,
    execution_witness_sha256: r.native.record_sha256};
}
function build(specs, {proofMode = 'candidate_goldblind', rights = 'cleared', lineage = 'disjoint_verified',
  calibrated = false, origin = 'actual_execution', prefix = 'train', frozenAt = 1000, invalidSettlement = false, outcomeOffset = 0, settlementOffset = 50, lockOffset = 100, calibrationFreeze = null} = {}) {
  prefix=variantTag+prefix;
  const case_manifest = specs.map((s, i) => ({case_id: `${prefix}-case-${i}`, split: s.split, origin,
    task_id: `${prefix}-task-${i}`, node_id: `${prefix}-node-${i}`, request_sha256: H(`${prefix}-request-${i}`),
    source_fingerprint: H(`${prefix}-source-fingerprint-${i}`), source_sha256: H(`${prefix}-source-${i}`),
    template_sha256: H(`${prefix}-template-${i}`), project_sha256: H(`${prefix}-project-${i}`)}));
  const card = {schema: 1, id: `SYNTHETIC-${prefix}`, source_commit: 'a'.repeat(40), frozen_at_ms: frozenAt,
    proof_mode: proofMode, policy_sha256: policy, quality_contract_sha256: contract,
    reference_policy_sha256: H('reference-policy'), candidate_pool_sha256: poolOverride??candidatePoolFingerprint([{id:referenceConfig.model,config:referenceConfig},{id:routedConfig.model,config:routedConfig}]),
    feature_schema_version: 'host_preoutcome_counts_v1', arms: {reference: arm(referenceConfig), routed: arm(routedConfig)},
    case_manifest, calibration: calibrated ? {status: 'externally_verified', artifact_sha256: H('calibration-artifact'), frozen_at_ms: calibrationFreeze??(1500+epochOffset)} :
      {status: 'unmeasured', artifact_sha256: null, frozen_at_ms: null},
    thresholds: {minimum_calibration_cases: 2, minimum_heldout_cases: 2, maximum_accepted_B: 0,
      maximum_task_failures: 0, require_complete_token_accounting: true},
    rights: {status: rights, evidence_sha256: rights === 'cleared' ? H('rights') : null},
    lineage_audit: {status: lineage, evidence_sha256: lineage === 'disjoint_verified' ? H('lineage') : null},
    gold_visible_before_final_lock: false, scorer_visible_before_final_lock: false};
  const records = [], results = [], cardHash = digest(card);
  for (let i = 0; i < specs.length; i++) {
    const c = case_manifest[i], s = specs[i], ref = outcome(c, referenceConfig, (i+outcomeOffset)*2+1+(prefix.endsWith('train') ? 0 : 1000)+variantSerial*10000, s.refTokens ?? 100, invalidSettlement?1050+epochOffset:frozenAt+settlementOffset),
      routed = outcome(c, routedConfig, (i+outcomeOffset)*2+2+(prefix.endsWith('train') ? 0 : 1000)+variantSerial*10000, s.routeTokens ?? 20, invalidSettlement?1050+epochOffset:frozenAt+settlementOffset);
    records.push(ref, routed);
    const choice = s.choice ?? 'routed', chosen = choice === 'reference' ? ref : routed,
      finalSuccess = choice === 'reference' ? s.ref : s.route, lockTime = frozenAt + lockOffset;
    const adoption_reason = choice === 'reference' ? 'routed_rejected_fallback' : 'routed_accepted';
    const lockBody = {run_card_sha256: cardHash, case_id: c.case_id, choice, adoption_reason,
      chosen_outcome_id: chosen.outcome_id, chosen_artifact_sha256: chosen.result.artifact_sha256,
      locked_at_ms: lockTime};
    results.push({case_id: c.case_id, attempts: {reference: binding(ref, card.arms.reference),
      routed: binding(routed, card.arms.routed)},
      final_lock: {choice, adoption_reason, chosen_outcome_id: chosen.outcome_id, chosen_artifact_sha256: chosen.result.artifact_sha256,
        final_lock_sha256: digest(lockBody),
        lock_witness_sha256: H(`lock-witness-${i}`), locked_at_ms: lockTime,
        gold_visible_before_lock: false, scorer_visible_before_lock: false},
      grade: {source_kind: 'independent_final_evaluator', host_validated: true,
        evidence_sha256: H(`grade-${i}`), final_lock_sha256: digest(lockBody), task_id: c.task_id, assessed_at_ms: lockTime+10,
        reference_task_success: s.ref, routed_task_success: s.route,
        final_task_success: finalSuccess, reference_match: s.match ?? s.ref === s.route}});
  }
  return {schema: 1, run_card: card, run_card_sha256: cardHash, results,
    outcome_state: {schema: 1, records, quarantined: []}};
}

export function syntheticInput({n = 6, trainCases = n, calibrationCases = n, trainSuccess = true, calSuccess = true, calMatch = true, calReferenceSuccess = calSuccess, policyOverrides = {}, invalidCalibrationSettlement = false, calibrationCaptureOffset = 50, skipFitLock = false, now_ms=2300, variant='', routedModel='SYNTHETIC-routed', routedEffort='low', poolConfigs=null, routedTokens=20, policy_text=null} = {}) {
  epochOffset=now_ms-2300;variantTag=variant;variantSerial=variant?1:0;routedConfig=config(routedModel,routedEffort);poolOverride=poolConfigs?candidatePoolFingerprint(poolConfigs.map(c=>({id:c.model,config:c}))):null;
  blobs.clear();policy=policy_text===null?H('policy'):blob(policy_text);
  const train = build(Array.from({length:trainCases}, (_,i) => ({split:'development', ref:true, route:Array.isArray(trainSuccess)?trainSuccess[i]:trainSuccess,routeTokens:routedTokens})),
    {proofMode:'internal_dev', prefix:'train', frozenAt:1000+epochOffset});
  // These are original synthetic run cards, not a retrospective rehash/split
  // of an already-frozen historical source run.
  const calibrationCards=[];
  for(let offset=0;offset<calibrationCases;offset+=32) calibrationCards.push(build(
    Array.from({length:Math.min(32,calibrationCases-offset)},()=>({split:'calibration',ref:calReferenceSuccess,route:calSuccess,match:calMatch,routeTokens:routedTokens})),
    {proofMode:'candidate_goldblind',prefix:offset===0?'cal':`cal-${offset}`,frozenAt:2000+epochOffset,
      invalidSettlement:invalidCalibrationSettlement,outcomeOffset:offset,settlementOffset:calibrationCaptureOffset}));
  const reference = {schema:1,id:'SYNTHETIC-reference',version:'1',policy_sha256:train.run_card.reference_policy_sha256,
    config_sha256:train.run_card.arms.reference.config_sha256,harness_sha256:H('reference-harness'),metric_id:'synthetic-quality',metric_version:'1'};
  const referenceSHA = blob(reference);
  const regime = {rcc_source_sha256:H('rcc'),policy_sha256:policy,environment_sha256:H('environment'),
    verifier_sha256:H('verifier'),quality_metric_id:'synthetic-quality',metric_version:'1',reference_descriptor_sha256:referenceSHA};
  const p = {schema:1,id:'SYNTHETIC-statistical-policy',version:'1',algorithm:OFFLINE_CALIBRATION_FORMAT,
    frozen_at_ms:900+epochOffset,fit_at_ms:1500+epochOffset,assessed_at_ms:2200+epochOffset,valid_until_ms:5000+epochOffset,feature_schema_version:'host_preoutcome_counts_v1',
    reference_descriptor_sha256:referenceSHA,minimum_train_per_stratum:2,minimum_calibration_per_stratum:2,
    minimum_reference_match_lower_bound:0,minimum_task_success_lower_bound:0,maximum_brier_score:1,maximum_absolute_bias:1,maximum_calibration_accepted_B:0,
    familywise_alpha:0.05,uncertainty_method:'one_sided_hoeffding_union_bound_v1',ood_policy:'abstain_outside_exact_strata_v1',
    iid_assumption_review_sha256:H('iid-review'),regime_sha256:digest(regime),...policyOverrides};
  const members=[], samples=[];
  for (const e of [train,...calibrationCards]) for (const c of e.run_card.case_manifest) {
    const row=e.results.find(r=>r.case_id===c.case_id);
    const constraints={scope:'read_only',required_tools:[],allowed_tools:[],allowed_paths:[],
      required_capabilities:[],allowed_transports:['codex_app_server'],owner_constraints:null};
    const task={id:c.task_id,node_id:c.node_id,request_sha256:c.request_sha256,feature_schema_version:'host_preoutcome_counts_v1',
      source_snapshot_sha256:H(`${c.case_id}-snapshot`),policy_sha256:policy,plan_sha256:H(`${c.case_id}-plan`),
      instructions_sha256:policy,workload_class:'SYNTHETIC-family',context_tokens:10,environment_sha256:regime.environment_sha256,verifier_sha256:regime.verifier_sha256,...constraints};
    delete task.owner_constraints;
    const features={schema:1,version:'host_preoutcome_counts_v1',semantic_family_id:'SYNTHETIC-family',context_tokens:10,
      material_count:0,requirement_count:1,dependency_count:0,source_state:'none',constraints_sha256:digest(constraints)};
    task.feature_sha256=frozenRouteFeatureBucket(features,task);
    const native_harness={}, resource={}, execution_windows={};
    for(const a of ['reference','routed']) {
      const record=e.outcome_state.records.find(r=>r.outcome_id===row.attempts[a].outcome_id);
      native_harness[a]={config_sha256:e.run_card.arms[a].config_sha256,harness_sha256:H(`${a}-harness`),
        native_binary_sha256:H(`${a}-binary`),native_instructions_sha256:e.run_card.arms[a].instructions_sha256};
      resource[a]={schema:1,scope:'single_native_attempt_including_children_plus_disjoint_host_overheads_v1',
        native_outcome_id:record.outcome_id,native_tokens:record.usage.total_tokens_observed,host_retry_count:0,
        overheads:{routing_tokens:3,verification_tokens:2,integration_tokens:1,other_disjoint_tokens:0},source_sha256:null};
      const {source_sha256,...resourceBody}=resource[a]; resource[a].source_sha256=blob(resourceBody);
      const window={schema:1,kind:'offline_native_execution_window_v1',task_id:record.identity.task_id,node_id:record.identity.node_id,
        attempt_id:record.identity.attempt_id,outcome_id:record.outcome_id,config_sha256:record.observed_config.config_sha256,
        configuration_sha256:record.identity.configuration_sha256,execution_id:record.native.execution_id,session_id:record.native.session_id,
        turn_id:record.native.turn_id,native_record_sha256:record.native.record_sha256,clock_basis:'source_observed_unix_epoch_ms',
        started_at_ms:e.run_card.frozen_at_ms+20,ended_at_ms:e.run_card.frozen_at_ms+40};
      execution_windows[a]={...window,source_sha256:blob(window)};
    }
    members.push({run_card_sha256:e.run_card_sha256,case_id:c.case_id,role:c.split==='development'?'train':'calibration',original_split:c.split});
    samples.push({run_card_sha256:e.run_card_sha256,case_id:c.case_id,projection:{features,task},captured_at_ms:e.run_card.frozen_at_ms-100,
      native_harness,regime,actual_task_evidence_sha256:blob({kind:'offline_preoutcome_task_binding_v1',case_id:c.case_id,task_id:c.task_id,node_id:c.node_id,
        request_sha256:c.request_sha256,source_fingerprint:c.source_fingerprint,projection_task_sha256:digest(task)}),feature_evidence_sha256:blob({schema:1,kind:'offline_preoutcome_feature_capture_v1',captured_at_ms:e.run_card.frozen_at_ms-100,projection:{features,task}}),
      review_sha256:H(`${c.case_id}-review`),resource,execution_windows});
  }
  const input={schema:1,kind:'os1_offline_calibration_input_v2',data_mode:'synthetic_fixture',operation:'assess',now_ms,fit_lock:null,
    policy:p,assignment:{schema:1,policy_sha256:digest(p),frozen_at_ms:800,members,source_sha256:blob({schema:1,policy_sha256:digest(p),frozen_at_ms:800,members})},
    evidence:[train,...calibrationCards],samples,sources:[...blobs.values()]};
  if(skipFitLock)return input;
  const fitInput=structuredClone(input); fitInput.operation='fit'; fitInput.evidence=[train];
  fitInput.samples=fitInput.samples.filter(s=>s.run_card_sha256===train.run_card_sha256);
  fitInput.assignment.members=fitInput.assignment.members.filter(m=>m.role==='train');
  {const {source_sha256,...body}=fitInput.assignment;fitInput.assignment.source_sha256=blob(body);fitInput.sources=[...blobs.values()];}
  const r=produce(fitInput);
  if(r.status==='unsupported_policy_capacity')return input;
  assert(r.training_model_sha256,JSON.stringify(r));
  input.fit_lock={training_model_sha256:r.training_model_sha256,locked_at_ms:1500+epochOffset,witness_sha256:blob({kind:'offline_training_model_lock_v1',training_model_sha256:r.training_model_sha256,policy_sha256:digest(p),locked_at_ms:1500+epochOffset})};
  input.sources=[...blobs.values()]; return input;
}

// Private synthetic proof package writer, never bundled or a promotion utility.
import {mkdirSync,writeFileSync,readFileSync,chmodSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadHostCalibratedRouteRegistration,loadCalibratedRouteEvidence,readCalibratedRouteEvidence} from '../../Resources/openclaw-os1-bridge/calibrated-route-evidence.mjs';
import {RESOURCE_COMPONENTS} from '../../Resources/openclaw-os1-bridge/joint-route-selector.mjs';
export function writeCalibratedRouteFixture({stateDir,now_ms=Date.now(),prepareRecords=()=>[],three_configs=false,p7_options={},policy_text=null}={}) {
  mkdirSync(stateDir,{recursive:true,mode:0o700});chmodSync(stateDir,0o700);stateDir=realpathSync(stateDir);
  const pool=[referenceConfig,config('SYNTHETIC-routed','low'),...(three_configs?[config('SYNTHETIC-floor','low')]:[])];
  const x=syntheticInput({...p7_options,policy_text,now_ms,poolConfigs:pool,policyOverrides:{valid_until_ms:now_ms+3600000,...p7_options.policyOverrides}});
  let all=new Map(x.sources.map(s=>[s.sha256,s]));
  if(three_configs){const y=syntheticInput({...p7_options,policy_text,now_ms,variant:'floor-',routedModel:'SYNTHETIC-floor',routedEffort:'low',routedTokens:60,poolConfigs:pool,policyOverrides:{valid_until_ms:now_ms+3600000,...p7_options.policyOverrides}});
    x.evidence.push(...y.evidence);x.samples.push(...y.samples);x.assignment.members.push(...y.assignment.members);for(const s of y.sources)all.set(s.sha256,s);}
  const add=v=>{const utf8=typeof v==='string'?v:stableJSON(v),sha256=createHash('sha256').update(utf8).digest('hex');all.set(sha256,{utf8,sha256});return sha256;};
  const packet={schema:1,accounting_scope:'disjoint_remaining_node_total_v1',token_basis:'input_output_include_cache_reasoning_subsets',rows:[]};
  for(const s of x.samples){const e=x.evidence.find(e=>e.run_card_sha256===s.run_card_sha256),row=e.results.find(r=>r.case_id===s.case_id);
    for(const arm of ['reference','routed']){const n=e.outcome_state.records.find(n=>n.outcome_id===row.attempts[arm].outcome_id),components=Object.fromEntries(RESOURCE_COMPONENTS.map(k=>[k,0]));
      // Explicit SYNTHETIC source premise: no native children/tool/ranking/retry/
      // queue token cost. These zeros are not defaults for actual evidence.
      components.routing_tokens=s.resource[arm].overheads.routing_tokens;components.input_tokens_per_sample=s.resource[arm].native_tokens;
      components.verification_tokens_per_sample=s.resource[arm].overheads.verification_tokens;components.integration_tokens=s.resource[arm].overheads.integration_tokens;
      const body={schema:1,run_card_sha256:e.run_card_sha256,case_id:s.case_id,arm,outcome_id:n.outcome_id,config_sha256:n.observed_config.config_sha256,components};
      packet.rows.push({...body,source_sha256:add(body)});
    }
  }
  const sourceReview=add('SYNTHETIC independent source-origin inspection, not a real review'),splitReview=add('SYNTHETIC disjoint-role review'),holdoutReview=add('SYNTHETIC independent heldout review'),rightsReview=add('SYNTHETIC rights review');
  {const {source_sha256,...body}=x.assignment;x.assignment.source_sha256=add(body);}
  x.sources=[...all.values()];const training=structuredClone(x);training.operation='fit';training.fit_lock=null;training.evidence=training.evidence.filter(e=>e.run_card.case_manifest[0].split==='development');training.samples=training.samples.filter(s=>training.evidence.some(e=>e.run_card_sha256===s.run_card_sha256));training.assignment.members=training.assignment.members.filter(m=>m.role==='train');
  {const {source_sha256,...body}=training.assignment;training.assignment.source_sha256=add(body);training.sources=[...all.values()];}
  const trained=produce(training);assert(trained.training_model_sha256,JSON.stringify(trained));
  x.fit_lock={training_model_sha256:trained.training_model_sha256,locked_at_ms:x.policy.fit_at_ms,witness_sha256:add({kind:'offline_training_model_lock_v1',training_model_sha256:trained.training_model_sha256,policy_sha256:digest(x.policy),locked_at_ms:x.policy.fit_at_ms})};
  x.sources=[...all.values()];const assessed=produce(x);assert.equal(assessed.status,'synthetic_fit_assessed_not_efficacy',JSON.stringify(assessed));const fit=assessed.fit;

  // Independent source-observed complete TRAIN route histories. The first of
  // ten nonreference episodes really includes a normalized reference fallback.
  // This empirical estimate is not a zero future-fallback guarantee.
  const routeSources=new Map(x.sources.map(s=>[s.sha256,s]));
  const routeAdd=v=>{const utf8=typeof v==='string'?v:stableJSON(v),sha256=createHash('sha256').update(utf8).digest('hex');routeSources.set(sha256,{utf8,sha256});return sha256;};
  const wholePolicy={schema:1,kind:'whole_route_resource_policy_v1',scope:'single_primary_with_optional_verified_reference_fallback_plus_disjoint_host_overheads_v1',method:'empirical_mean_complete_train_route_episodes_v1',role:'train',frozen_at_ms:x.policy.frozen_at_ms,minimum_episodes_per_stratum_config:10,verifier_sha256:x.samples[0].regime.verifier_sha256,reference_descriptor_sha256:x.policy.reference_descriptor_sha256};
  packet.whole_route_policy={...wholePolicy,source_sha256:routeAdd(wholePolicy)};packet.episodes=[];
  for(let ci=0;ci<fit.cells.length;ci++){const cell=fit.cells[ci],sample=x.samples.find(s=>fit.training_cases.some(c=>c.run_card_sha256===s.run_card_sha256&&c.case_id===s.case_id&&c.stratum_sha256===cell.stratum_sha256));
   for(const arm of ['reference','routed'])for(let i=0;i<10;i++){
    const cfg=pool.find(c=>digest(c)===cell[arm].config_sha256),id=`resource-${ci}-${arm}-${i}`,c={task_id:id,node_id:'node_0',request_sha256:H(id+'-request'),source_fingerprint:H(id+'-fingerprint')},lineage={request_sha256:c.request_sha256,source_sha256:H(id+'-source'),template_sha256:H(id+'-template'),project_sha256:H(id+'-project')};
    const start=now_ms-1200+i*3,primaryTime=start+1,checkerTime=start+2,end=start+4,shouldFallback=arm==='routed'&&i===0;
    const nativeTokens=arm==='reference'?100:cfg.model==='SYNTHETIC-floor'?60:20;
    const n=outcome(c,cfg,800000+ci*10000+(arm==='reference'?0:1000)+i*2,nativeTokens,primaryTime),attempts=[n];
    if(shouldFallback)attempts.push(outcome(c,pool[0],800001+ci*10000+1000+i*2,100,end));
    const checker={schema:1,kind:'registered_full_task_checker_result_v1',verifier_sha256:wholePolicy.verifier_sha256,primary_outcome_id:n.outcome_id,verdict:shouldFallback?'rejected':'accepted',observed_at_ms:checkerTime};
    const history={schema:1,kind:'complete_native_route_history_v1',task_id:c.task_id,node_id:c.node_id,outcome_ids:attempts.map(n=>n.outcome_id),native_record_sha256s:attempts.map(n=>n.native.record_sha256),closed_at_ms:end};
    const projection=structuredClone(sample.projection);projection.task.id=c.task_id;projection.task.node_id=c.node_id;projection.task.request_sha256=c.request_sha256;projection.task.source_snapshot_sha256=H(id+'-snapshot');projection.task.plan_sha256=H(id+'-plan');projection.task.feature_sha256=frozenRouteFeatureBucket(projection.features,projection.task);
    const sourceBinding={schema:1,kind:'host_projection_source_binding_v1',basis:'explicit_projection_to_native_fingerprint_mapping_v1',task_id:c.task_id,node_id:c.node_id,request_sha256:c.request_sha256,source_snapshot_sha256:projection.task.source_snapshot_sha256,source_fingerprint:c.source_fingerprint};
    const components=Object.fromEntries(RESOURCE_COMPONENTS.map(k=>[k,0]));Object.assign(components,{routing_tokens:3,input_tokens_per_sample:nativeTokens,verification_tokens_per_sample:2,integration_tokens:1,retry_reserve_tokens:shouldFallback?100:0});
    const body={schema:1,id,role:'train',stratum_sha256:cell.stratum_sha256,config_sha256:cell[arm].config_sha256,started_at_ms:start,primary_settled_at_ms:primaryTime,fallback_started_at_ms:shouldFallback?checkerTime+1:null,ended_at_ms:end,lineage,preoutcome:{captured_at_ms:start-1,projection,native_harness:sample.native_harness,regime:sample.regime,source_binding:{...sourceBinding,source_sha256:routeAdd(sourceBinding)}},attempts,checker:{...checker,source_sha256:routeAdd(checker)},history:{...history,source_sha256:routeAdd(history)},host_overheads:{routing_tokens:3,verification_tokens_per_sample:2,ranking_tokens:0,integration_tokens:1,queue_timeout_overhead_tokens:0},components};
    packet.episodes.push({...body,source_sha256:routeAdd(body)});
   }
  }
  for(const b of blobs.values())routeSources.set(b.sha256,b);packet.sources=[...routeSources.values()];

  // Construct new original SYNTHETIC heldout cards, not relabelled real data.
  const p8={schema:1,evidence:[],execution_windows:[],case_bindings:[],sources:[]};
  for(let index=0;index<(three_configs?2:1);index++){
    variantTag=`heldout-${index}-`;variantSerial=10+index;routedConfig=pool[index+1];poolOverride=candidatePoolFingerprint(pool.map(c=>({id:c.model,config:c})));
    const e=build(Array.from({length:2},()=>({split:'heldout',ref:true,route:true})),{prefix:'case',frozenAt:now_ms-500,calibrated:true,calibrationFreeze:now_ms-80,lockOffset:460,settlementOffset:450});
    e.run_card.calibration.artifact_sha256=assessed.artifact_sha256;e.run_card_sha256=digest(e.run_card);
    for(const row of e.results){const l=row.final_lock;l.final_lock_sha256=digest({run_card_sha256:e.run_card_sha256,case_id:row.case_id,choice:l.choice,adoption_reason:l.adoption_reason,chosen_outcome_id:l.chosen_outcome_id,chosen_artifact_sha256:l.chosen_artifact_sha256,locked_at_ms:l.locked_at_ms});row.grade.final_lock_sha256=l.final_lock_sha256;
      for(const arm of ['reference','routed']){const n=e.outcome_state.records.find(n=>n.outcome_id===row.attempts[arm].outcome_id),w={schema:1,kind:'heldout_execution_window_v1',outcome_id:n.outcome_id,task_id:n.identity.task_id,node_id:n.identity.node_id,attempt_id:n.identity.attempt_id,native_record_sha256:n.native.record_sha256,started_at_ms:now_ms-70,ended_at_ms:now_ms-60};p8.execution_windows.push({...w,source_sha256:add(w)});}}
    for(const c of e.run_card.case_manifest){const sample=x.samples.find(s=>{const a=x.evidence.find(e=>e.run_card_sha256===s.run_card_sha256).run_card.arms;return stableJSON(a)===stableJSON(e.run_card.arms);}),projection=structuredClone(sample.projection);projection.task.id=c.task_id;projection.task.node_id=c.node_id;projection.task.request_sha256=c.request_sha256;projection.task.source_snapshot_sha256=H(c.case_id+'-heldout-snapshot');projection.task.plan_sha256=H(c.case_id+'-heldout-plan');projection.task.feature_sha256=frozenRouteFeatureBucket(projection.features,projection.task);const stratum_sha256=digest({feature_bucket_sha256:projection.task.feature_sha256,reference:e.run_card.arms.reference,routed:e.run_card.arms.routed,native_harness:sample.native_harness,regime:sample.regime});const b={schema:1,kind:'heldout_preoutcome_stratum_v1',run_card_sha256:e.run_card_sha256,case_id:c.case_id,captured_at_ms:now_ms-550,source_fingerprint:c.source_fingerprint,projection,native_harness:sample.native_harness,regime:sample.regime,stratum_sha256};p8.case_bindings.push({...b,source_sha256:add(b)});}
    p8.evidence.push(e);
  }
  for(const s of blobs.values())all.set(s.sha256,s);p8.sources=[...all.values()];
  const native=new Map();for(const s of x.samples)for(const h of Object.values(s.native_harness))native.set(h.config_sha256,h);
  const quality_reference=JSON.parse(all.get(x.policy.reference_descriptor_sha256).utf8),features=x.samples[0].projection.features;
  const bindings={rcc_source_sha256:x.samples[0].regime.rcc_source_sha256,policy_sha256:x.samples[0].regime.policy_sha256,environment_sha256:x.samples[0].regime.environment_sha256,verifier_sha256:x.samples[0].regime.verifier_sha256,reference_descriptor_sha256:x.policy.reference_descriptor_sha256,candidate_pool_sha256:candidatePoolFingerprint(pool.map(c=>({id:c.model,config:c}))),coverage_discriminator_sha256:H('coverage-discriminator'),projection_instructions_sha256:x.samples[0].projection.task.instructions_sha256,workload_class:features.semantic_family_id,feature_schema_version:x.policy.feature_schema_version,scope:'read_only',native_harnesses:[...native.values()].sort((a,b)=>a.config_sha256.localeCompare(b.config_sha256))};
  const projection_policy={point:'training_mle_v1',lower:'minimum_training_point_and_calibration_bound_v1',coverage_policy_sha256:H('frozen-coverage-policy'),uncertainty_policy_sha256:H('frozen-uncertainty-policy'),ood_policy_sha256:H('frozen-ood-policy')};
  const encode=v=>Buffer.from(stableJSON(v)),resourcesSHA=createHash('sha256').update(encode(packet)).digest('hex');
  const resource_partitions=[];
  for(const cell of fit.cells)for(const arm of ['reference','routed']){const rows=packet.episodes.filter(r=>r.stratum_sha256===cell.stratum_sha256&&r.config_sha256===cell[arm].config_sha256);resource_partitions.push({stratum_sha256:cell.stratum_sha256,config_sha256:cell[arm].config_sha256,components:Object.fromEntries(RESOURCE_COMPONENTS.map(k=>[k,rows.reduce((n,r)=>n+r.components[k],0)/rows.length])),basis_artifact_sha256:resourcesSHA,basis_sample_count:rows.length});}
  const records=prepareRecords(structuredClone({input:x,fit,bindings,projection_policy,quality_reference,resource_partitions,whole_route_policy:packet.whole_route_policy,features,referenceConfig:pool[0],routedConfig:pool[1],baselineConfig:three_configs?pool[2]:pool[0],now_ms,valid_until_ms:now_ms+3600000}));
  for(const s of blobs.values())all.set(s.sha256,s);p8.sources=[...all.values()];
  const files={'p7-input.json':x,'p7-fit.json':fit,'p8-evidence.json':p8,'resource-partitions.json':packet,'host-records.json':{schema:1,records}};
  const payload={data_mode:'synthetic_fixture',proof_mode:'synthetic_fixture',issued_at_ms:now_ms+2,valid_until_ms:now_ms+3600000,bindings,projection_policy,quality_reference};
  const hashes=Object.fromEntries(Object.entries(files).map(([name,v])=>[name,createHash('sha256').update(encode(v)).digest('hex')]));
  const review={schema:1,kind:'independent_route_promotion_review_v1',decision:'approve_conditional_evidence',data_mode:'synthetic_fixture',reviewer_id:'SYNTHETIC-INDEPENDENT-REVIEWER',reviewed_at_ms:now_ms+1,valid_until_ms:now_ms+3600000,payload_sha256:digest(payload),p7_input_sha256:hashes['p7-input.json'],p7_fit_sha256:hashes['p7-fit.json'],p8_evidence_sha256:hashes['p8-evidence.json'],resource_partitions_sha256:hashes['resource-partitions.json'],host_records_sha256:hashes['host-records.json'],rights_review_sha256:rightsReview,iid_review_sha256:x.policy.iid_assumption_review_sha256,source_review_sha256:sourceReview,split_audit_sha256:splitReview,holdout_review_sha256:holdoutReview};
  files['promotion-review.json']=review;
  const descriptors=Object.entries(files).map(([name,v])=>({name,sha256:createHash('sha256').update(encode(v)).digest('hex'),bytes:encode(v).length}));
  const manifest={schema:1,kind:'os1_qualified_route_evidence_v1',payload,files:descriptors},bytes=encode(manifest),manifest_sha256=createHash('sha256').update(bytes).digest('hex');
  const root=join(stateDir,'calibrated-route-evidence',manifest_sha256);mkdirSync(root,{recursive:true,mode:0o700});chmodSync(join(stateDir,'calibrated-route-evidence'),0o700);chmodSync(root,0o700);
  for(const [name,v]of Object.entries({...files,'manifest.json':manifest}))writeFileSync(join(root,name),encode(v),{mode:0o600,flag:'wx'});
  const codeRoot=dirname(fileURLToPath(new URL('../../Resources/openclaw-os1-bridge/calibrated-route-evidence.mjs',import.meta.url))),names=['calibrated-route-predictor.mjs','rcc-runtime.mjs','rcc-plugin.mjs','calibrated-route-evidence.mjs','offline-route-calibration.mjs','frozen-route-evidence.mjs','frozen-route-artifacts.mjs','frozen-route-predictor.mjs','joint-route-selector.mjs','routing-outcome.mjs'];
  const registrationData={schema:1,kind:'os1_calibrated_route_registration_v1',data_mode:'synthetic_fixture',manifest_sha256,manifest_bytes:bytes.length,review_sha256:descriptors.find(d=>d.name==='promotion-review.json').sha256,issued_at_ms:now_ms+2,valid_until_ms:now_ms+3600000,code_sha256:Object.fromEntries(names.map(name=>[name,createHash('sha256').update(readFileSync(join(codeRoot,name))).digest('hex')]))};
  writeFileSync(join(stateDir,'calibrated-route-registration.json'),encode(registrationData),{mode:0o600,flag:'wx'});
  const registration=loadHostCalibratedRouteRegistration({stateDir,now_ms:now_ms+3}),loaded=loadCalibratedRouteEvidence({stateDir,registration,now_ms:now_ms+3});assert.equal(loaded.status,'loaded_synthetic_fixture_evidence',JSON.stringify(loaded));const bundle=readCalibratedRouteEvidence(loaded.capability,{now_ms:now_ms+3});assert(bundle);
  return {stateDir,root,now_ms:now_ms+3,registration,capability:loaded.capability,bundle,referenceConfig:pool[0],routedConfig:pool[1],baselineConfig:three_configs?pool[2]:pool[0],features,input:x,fit,bindings,projection_policy,quality_reference,resource_partitions,files,manifest,registrationData};
}
