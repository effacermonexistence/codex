/** P7 OFFLINE statistical baseline. Reused by the qualified host loader for
 * proof recomputation only; not itself Core forecasts or admission. No
 * model calls or production capability. Source byte identity is NOT source
 * authenticity. A fitted artifact is a reproducible analysis, not a certificate.
 * Independent implementation: stratum Bernoulli MLE + a preregistered held-
 * separate calibration assessment; no third-party model/code/weights copied.
 */
import {createHash} from 'node:crypto';
import {FROZEN_ROUTE_FEATURE_SCHEMA} from './frozen-route-artifacts.mjs';
import {frozenRouteFeatureBucket} from './frozen-route-predictor.mjs';
import {evaluateFrozenRouteEvidence} from './frozen-route-evidence.mjs';
import {stableJSON} from './joint-route-selector.mjs';

export const OFFLINE_CALIBRATION_FORMAT = 'os1_offline_stratum_bernoulli_mle_v2';
export const OFFLINE_CALIBRATION_LIMITS = Object.freeze({cases: 128, cases_per_card: 32, cards: 8, sources: 8192, source_bytes: 262144,
  input_bytes: 8388608, json_nodes: 300000, json_depth: 32, array_items: 8192,
  evidence_join_nodes: 30000, evidence_join_depth: 24, evidence_join_string_bytes: 8192});
const H = /^[a-f0-9]{64}$/;
const hash = x => typeof x === 'string' && H.test(x);
const count = x => Number.isSafeInteger(x) && x >= 0;
const probability = x => Number.isFinite(x) && x >= 0 && x <= 1;
const exact = (x, keys) => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const need = (x, code) => {if (!x) throw Object.assign(new Error(code), {code});};
const sha = s => createHash('sha256').update(s).digest('hex');
const unique = xs => new Set(xs).size === xs.length;
const average = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const immutable = x => {if (x && typeof x === 'object') {Object.values(x).forEach(immutable); Object.freeze(x);} return x;};
const key = (run, id) => `${run}:${id}`;
/** Separate OFFLINE data budget; production frozenRouteData is unchanged.
 * Accessors, cycles, sparse arrays and prototype keys are not data.
 */
export function offlineCalibrationData(value) {
  let nodes = 0, bytes = 0; const active = new Set(), L = OFFLINE_CALIBRATION_LIMITS;
  const walk = (x, depth) => {
    need(++nodes <= L.json_nodes, 'oc_capacity_json_nodes'); need(depth <= L.json_depth, 'oc_capacity_json_depth');
    if (x === null || typeof x === 'boolean') return x;
    if (typeof x === 'number') {need(Number.isFinite(x), 'oc_finite_json_required'); return x;}
    if (typeof x === 'string') {const n = Buffer.byteLength(x); bytes += n;
      need(n <= L.source_bytes, 'oc_capacity_string_bytes'); need(bytes <= L.input_bytes, 'oc_capacity_input_bytes'); return x;}
    need(x && typeof x === 'object' && (Array.isArray(x) || [Object.prototype, null].includes(Object.getPrototypeOf(x))) &&
      !active.has(x), 'oc_plain_json_required'); active.add(x);
    const descriptors = Object.getOwnPropertyDescriptors(x), keys = Reflect.ownKeys(x);
    need(keys.every(k => typeof k === 'string' && Object.hasOwn(descriptors[k], 'value')) &&
      !keys.some(k => ['__proto__', 'constructor', 'prototype'].includes(k)), 'oc_accessor_or_forbidden_key');
    let out;
    if (Array.isArray(x)) {
      need(x.length <= L.array_items, 'oc_capacity_array_items');
      need(keys.length === x.length + 1 && Array.from({length:x.length},(_,i)=>Object.hasOwn(x,i)).every(Boolean), 'oc_dense_array_required');
      out = Array.from({length:x.length}, (_,i)=>walk(descriptors[i].value,depth+1));
    } else {out = Object.create(null); for (const k of keys) {bytes += Buffer.byteLength(k); out[k] = walk(descriptors[k].value,depth+1);}}
    active.delete(x); return out;
  };
  const result = walk(value,0);
  need(Buffer.byteLength(canonical(result)) <= L.input_bytes, 'oc_capacity_input_bytes');
  return immutable(result);
}
function canonical(x) {return x !== null && typeof x === 'object' ? Array.isArray(x) ?
  '['+x.map(canonical).join(',')+']' : '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}' : JSON.stringify(x);}
const digest = x => sha(canonical(x));
/** Static limits of the inherited evidence join are explicit, not enlarged. */
function evidenceCapacity(e) {
  let n=0; const L=OFFLINE_CALIBRATION_LIMITS;
  const walk=(x,d)=>{need(++n<=L.evidence_join_nodes,'oc_capacity_evidence_join_nodes');
    need(d<=L.evidence_join_depth,'oc_capacity_evidence_join_depth');
    if(typeof x==='string') need(Buffer.byteLength(x)<=L.evidence_join_string_bytes,'oc_capacity_evidence_join_string');
    if(x&&typeof x==='object') for(const v of Object.values(x))walk(v,d+1);};
  walk(e,0);
}
export function offlineCalibrationPolicyCapacity(p) {
  const required = threshold => threshold === 0 ? 0 : threshold === 1 ? null :
    Math.ceil(Math.log(2/p.familywise_alpha)/(2*(1-threshold)**2));
  const match=required(p.minimum_reference_match_lower_bound), success=required(p.minimum_task_success_lower_bound);
  const maximumCalibration=Math.max(0,OFFLINE_CALIBRATION_LIMITS.cases-p.minimum_train_per_stratum);
  return {maximum_source_cases:OFFLINE_CALIBRATION_LIMITS.cases,maximum_calibration_cases_one_stratum:maximumCalibration,
    best_case_required_calibration_cases:{match,success},assumed_strata_for_best_case:1,
    supported:maximumCalibration>=p.minimum_calibration_per_stratum && match!==null && success!==null &&
      Math.max(match,success,p.minimum_calibration_per_stratum)<=maximumCalibration,
    interpretation:'necessary_best_case_capacity_only_not_sufficient_evidence_or_acceptance'};
}
const policyKeys = ['schema', 'id', 'version', 'algorithm', 'frozen_at_ms', 'fit_at_ms', 'assessed_at_ms',
  'valid_until_ms', 'feature_schema_version', 'reference_descriptor_sha256', 'minimum_train_per_stratum',
  'minimum_calibration_per_stratum', 'minimum_reference_match_lower_bound', 'minimum_task_success_lower_bound',
  'maximum_brier_score', 'maximum_absolute_bias', 'maximum_calibration_accepted_B', 'familywise_alpha', 'uncertainty_method', 'ood_policy',
  'iid_assumption_review_sha256', 'regime_sha256'];
const bindingKeys = ['rcc_source_sha256', 'policy_sha256', 'environment_sha256', 'verifier_sha256',
  'quality_metric_id', 'metric_version', 'reference_descriptor_sha256'];
const taskKeys = ['id', 'node_id', 'request_sha256', 'source_snapshot_sha256', 'feature_sha256', 'policy_sha256',
  'plan_sha256', 'environment_sha256', 'instructions_sha256', 'verifier_sha256', 'feature_schema_version',
  'workload_class', 'scope', 'required_tools', 'allowed_tools', 'allowed_paths', 'required_capabilities', 'allowed_transports', 'context_tokens'];
const nativeKeys = ['config_sha256', 'harness_sha256', 'native_binary_sha256', 'native_instructions_sha256'];
const overheadKeys = ['routing_tokens', 'verification_tokens', 'integration_tokens', 'other_disjoint_tokens'];
function policy(p) {
  need(exact(p, policyKeys) && p.schema === 1 && typeof p.id === 'string' && p.id.length > 0 &&
    typeof p.version === 'string' && p.version.length > 0 && p.algorithm === OFFLINE_CALIBRATION_FORMAT &&
    ['frozen_at_ms', 'fit_at_ms', 'assessed_at_ms', 'valid_until_ms'].every(k => count(p[k])) &&
    p.frozen_at_ms <= p.fit_at_ms && p.fit_at_ms < p.assessed_at_ms && p.assessed_at_ms < p.valid_until_ms &&
    p.feature_schema_version === FROZEN_ROUTE_FEATURE_SCHEMA &&
    ['reference_descriptor_sha256', 'iid_assumption_review_sha256', 'regime_sha256'].every(k => hash(p[k])) &&
    ['minimum_train_per_stratum', 'minimum_calibration_per_stratum'].every(k => count(p[k]) && p[k] > 0) &&
    ['minimum_reference_match_lower_bound', 'minimum_task_success_lower_bound', 'maximum_brier_score',
      'maximum_absolute_bias', 'familywise_alpha'].every(k => probability(p[k])) &&
    p.familywise_alpha > 0 && p.familywise_alpha < 1 && p.maximum_calibration_accepted_B === 0 &&
    p.uncertainty_method === 'one_sided_hoeffding_union_bound_v1' &&
    p.ood_policy === 'abstain_outside_exact_strata_v1', 'oc_policy_missing_or_invalid');
}
function resource(x, normalized, sources) {
  need(exact(x, ['schema', 'scope', 'native_outcome_id', 'native_tokens', 'host_retry_count', 'overheads', 'source_sha256']) &&
    x.schema === 1 && x.scope === 'single_native_attempt_including_children_plus_disjoint_host_overheads_v1' &&
    x.native_outcome_id === normalized.outcome_id && x.host_retry_count === 0 &&
    count(x.native_tokens) && normalized.usage.accounting_complete === true &&
    count(normalized.usage.provider_calls_observed) && x.native_tokens === normalized.usage.total_tokens_observed &&
    exact(x.overheads, overheadKeys) && Object.values(x.overheads).every(count) &&
    hash(x.source_sha256) && sources.has(x.source_sha256), 'oc_resource_unknown_or_scope_unsupported');
  const {source_sha256, ...body} = x;
  need(sources.get(source_sha256) === stableJSON(body), 'oc_resource_source_binding_mismatch');
  // Native attempt usage already includes (or disjointly adds) native children
  // in the P3 normalizer. NEVER add those children/reasoning/cache a second time.
  const total = x.native_tokens + Object.values(x.overheads).reduce((a, b) => a + b, 0);
  need(Number.isSafeInteger(total) && total <= 1e12, 'oc_resource_overflow');
  return total;
}
/** P3 provenance.observed_at_ms is receipt capture/observation time (see
 * routing-outcome-capture.mjs), NOT generation/start/classification time.
 * Require an independent source-observed execution interval; never infer it
 * from that capture timestamp, a duration counter or the notification surface.
 */
function validateExecutionWindow(w,{sample,record,row,card,policy:p,role,now,sources}) {
  need(exact(w,['schema','kind','task_id','node_id','attempt_id','outcome_id','config_sha256','configuration_sha256',
    'execution_id','session_id','turn_id','native_record_sha256','clock_basis','started_at_ms','ended_at_ms','source_sha256']) &&
    w.schema===1 && w.kind==='offline_native_execution_window_v1' && w.clock_basis==='source_observed_unix_epoch_ms' &&
    ['task_id','node_id','attempt_id'].every(k=>w[k]===record.identity[k]) && w.outcome_id===record.outcome_id &&
    w.config_sha256===record.observed_config.config_sha256 && w.configuration_sha256===record.identity.configuration_sha256 &&
    ['execution_id','session_id','turn_id'].every(k=>w[k]===record.native[k]) &&
    w.native_record_sha256===record.native.record_sha256 && count(w.started_at_ms) && count(w.ended_at_ms) &&
    hash(w.source_sha256) && sources.has(w.source_sha256), 'oc_execution_window_missing_or_mismatched');
  const {source_sha256,...body}=w;
  need(sources.get(source_sha256)===stableJSON(body),'oc_execution_window_source_mismatch');
  const observed=record.provenance.observed_at_ms;
  need(Math.max(card.frozen_at_ms,p.frozen_at_ms,sample.captured_at_ms)<=w.started_at_ms &&
    w.started_at_ms<=w.ended_at_ms && w.ended_at_ms<=row.final_lock.locked_at_ms &&
    observed>=w.ended_at_ms && observed<=now &&
    observed<=(role==='train'?p.fit_at_ms:p.assessed_at_ms), 'oc_execution_or_observation_chronology');
  if(role==='calibration') need(p.fit_at_ms<w.started_at_ms,'oc_calibration_execution_precedes_fit_lock');
}
const authority = Object.freeze({execution_authorized: false, live_route_change_authorized: false,
  quality_certificate: false, calibration_validated: false, holdout_accepted: false,
  production_registration: null, forecasts: null, model_calls: 0,
  source_authenticity: 'not_established_by_hashes_or_this_program'});

/** Explicit inputs only; no defaults for statistical acceptance. Assignment is
 * frozen before calibration collection, retains original splits/proof labels,
 * and designates DEVELOPMENT rows as train without relabelling their history.
 * A separate fresh heldout/P8 evaluation is still mandatory for promotion.
 */
export function produceOfflineRouteCalibration(input) {
  const report = {schema: 1, kind: OFFLINE_CALIBRATION_FORMAT, status: 'insufficient_evidence',
    blockers: [], counts: {source_cases: 0, train: 0, calibration: 0, reserved_heldout: 0},
    fit: null, training_model: null, training_model_sha256: null, artifact_sha256: null, input_sha256: null, policy_sha256: null,
    source_manifest: [], joined_runs: [], capacity: null, ...authority};
  const fail = code => {report.blockers.push(code); report.blockers = [...new Set(report.blockers)].sort(); return immutable(report);};
  try {
    input = offlineCalibrationData(input); report.input_sha256 = digest(input);
    need(exact(input, ['schema', 'kind', 'data_mode', 'operation', 'now_ms', 'fit_lock', 'policy', 'assignment', 'evidence', 'samples', 'sources']) &&
      input.schema === 1 && input.kind === 'os1_offline_calibration_input_v2' &&
      ['actual_evidence', 'synthetic_fixture'].includes(input.data_mode) && ['fit', 'assess'].includes(input.operation) &&
      count(input.now_ms) && Array.isArray(input.evidence) &&
      Array.isArray(input.samples) && Array.isArray(input.sources), 'oc_input_shape');
    need(input.evidence.length<=OFFLINE_CALIBRATION_LIMITS.cards,'oc_capacity_cards');
    need(input.samples.length<=OFFLINE_CALIBRATION_LIMITS.cases,'oc_capacity_cases');
    need(input.sources.length<=OFFLINE_CALIBRATION_LIMITS.sources,'oc_capacity_sources');
    // Preflight only run-card/assignment metadata, BEFORE reading results,
    // outcomes, grades or invoking a join. Forbidden-sheet rejection is opaque.
    if (input.policy === null) return fail('oc_preregistered_policy_absent');
    policy(input.policy); const p = input.policy; report.policy_sha256 = digest(p);
    need((input.operation === 'fit' ? p.fit_at_ms : p.assessed_at_ms) <= input.now_ms && input.now_ms < p.valid_until_ms,
      'oc_policy_stale_or_future');
    const a = input.assignment;
    need(exact(a, ['schema', 'policy_sha256', 'frozen_at_ms', 'members', 'source_sha256']) && a.schema === 1 &&
      a.policy_sha256 === report.policy_sha256 && count(a.frozen_at_ms) && a.frozen_at_ms <= p.frozen_at_ms &&
      hash(a.source_sha256) && Array.isArray(a.members) &&
      unique(a.members.map(m => key(m.run_card_sha256, m.case_id))), 'oc_assignment_absent_or_invalid');
    need(a.members.length<=OFFLINE_CALIBRATION_LIMITS.cases,'oc_capacity_cases');
    for (const m of a.members) need(exact(m, ['run_card_sha256','case_id','role','original_split']) && hash(m.run_card_sha256) &&
      ['train','calibration','heldout'].includes(m.role), 'oc_member_invalid');
    need(!a.members.some(m => m.role === 'heldout' || m.original_split === 'heldout') &&
      !input.evidence.some(e => Array.isArray(e?.run_card?.case_manifest) && e.run_card.case_manifest.some(c=>c.split==='heldout')),
      'oc_heldout_labels_forbidden');
    need(input.operation !== 'fit' || a.members.every(m => m.role === 'train' && m.original_split === 'development') &&
      input.evidence.every(e => Array.isArray(e?.run_card?.case_manifest) && e.run_card.case_manifest.every(c=>c.split==='development')),
      'oc_fit_must_not_see_calibration');
    const metadata = new Map(), cards = new Map();
    for (const e of input.evidence) {
      need(e && hash(e.run_card_sha256) && e.run_card && digest(e.run_card) === e.run_card_sha256 &&
        Array.isArray(e.run_card.case_manifest), 'oc_run_card_metadata_invalid');
      need(e.run_card.case_manifest.length <= OFFLINE_CALIBRATION_LIMITS.cases_per_card, 'oc_capacity_cases_per_card');
      need(!cards.has(e.run_card_sha256), 'oc_reused_run'); cards.set(e.run_card_sha256,e.run_card);
      for (const c of e.run_card.case_manifest) {
        const k=key(e.run_card_sha256,c.case_id); need(!metadata.has(k),'oc_duplicate_case_metadata'); metadata.set(k,c);
      }
    }
    need(metadata.size <= OFFLINE_CALIBRATION_LIMITS.cases,'oc_capacity_cases');
    need(a.members.length===metadata.size,'oc_assignment_absent_or_invalid');
    for(const m of a.members) {
      const c=metadata.get(key(m.run_card_sha256,m.case_id)); need(c && c.split===m.original_split,'oc_assignment_source_mismatch');
      need(m.role==='train'?c.split==='development':c.split==='calibration','oc_split_role_relabelling');
    }
    // A source card is an indivisible original frozen evidence object. Do not
    // slice/rehash a mixed-role card to get around phase-specific label access.
    const cardRoles=new Map();
    for(const runSHA of cards.keys()) {
      const roles=new Set(a.members.filter(m=>m.run_card_sha256===runSHA).map(m=>m.role));
      need(roles.size===1,'oc_mixed_role_source_card_unsupported');cardRoles.set(runSHA,[...roles][0]);
    }
    report.capacity=offlineCalibrationPolicyCapacity(p);
    if(!report.capacity.supported) {report.status='unsupported_policy_capacity'; return fail('oc_policy_exceeds_supported_capacity');}
    // Only allowed metadata reaches source verification and the existing join.
    const sources = new Map();
    for (const s of input.sources) {
      need(exact(s, ['sha256', 'utf8']) && hash(s.sha256) && typeof s.utf8 === 'string' &&
        Buffer.byteLength(s.utf8) <= OFFLINE_CALIBRATION_LIMITS.source_bytes && sha(s.utf8) === s.sha256 &&
        !sources.has(s.sha256), 'oc_source_bytes_missing_duplicate_or_corrupt'); sources.set(s.sha256,s.utf8);
    }
    need(sources.has(p.iid_assumption_review_sha256),'oc_iid_assumption_review_missing');
    const {source_sha256:assignmentSource,...assignmentBody}=a;
    need(sources.get(assignmentSource)===stableJSON(assignmentBody),'oc_assignment_source_binding_mismatch');
    need(input.samples.length===metadata.size && unique(input.samples.map(s=>key(s.run_card_sha256,s.case_id))), 'oc_projection_set_mismatch');
    const sourceManifest = input.sources.map(s=>({sha256:s.sha256,bytes:Buffer.byteLength(s.utf8)})).sort((a,b)=>a.sha256.localeCompare(b.sha256));
    // Shape/source/temporal lock checks require no training or calibration
    // labels. Reject absent, malformed or late locks before any outcome join.
    const lock=input.fit_lock;
    if(input.operation==='fit') need(lock===null,'oc_fit_lock_not_applicable');
    else {
      need(exact(lock,['training_model_sha256','locked_at_ms','witness_sha256']) && hash(lock.training_model_sha256) &&
        count(lock.locked_at_ms) && lock.locked_at_ms===p.fit_at_ms && sources.has(lock.witness_sha256) &&
        sources.get(lock.witness_sha256)===stableJSON({kind:'offline_training_model_lock_v1',
          training_model_sha256:lock.training_model_sha256,policy_sha256:report.policy_sha256,locked_at_ms:lock.locked_at_ms}),
      'oc_training_fit_lock_absent_or_mismatched');
      need([...cards.entries()].filter(([runSHA])=>cardRoles.get(runSHA)==='calibration')
        .every(([,c])=>lock.locked_at_ms<c.frozen_at_ms),'oc_fit_lock_after_calibration_collection');
    }
    const rows = new Map(), allOutcomes = new Map(), seenOutcomes = new Set();
    const joinRole=role=>{
    for (const e of input.evidence) {
      if(cardRoles.get(e.run_card_sha256)!==role) continue;
      evidenceCapacity(e);
      const joined = evaluateFrozenRouteEvidence(e);
      need(joined.counts!==null && Array.isArray(joined.blockers),'oc_evidence_join_failed');
      const producerHandled = new Set(['calibration_unmeasured','development_proof_mode','calibration_sample_insufficient','heldout_sample_insufficient']);
      for(const blocker of joined.blockers)need(producerHandled.has(blocker),`oc_join_${blocker}`);
      report.joined_runs.push({role,run_card_sha256:e.run_card_sha256,proof_mode:e.run_card.proof_mode,
        original_counts:joined.counts,precheck_blockers:joined.blockers});
      for(const r of e.outcome_state.records) {need(!seenOutcomes.has(r.outcome_id),'oc_cross_run_outcome_reuse');
        seenOutcomes.add(r.outcome_id); allOutcomes.set(r.outcome_id,r);}
      for(const c of e.run_card.case_manifest) {
        const row=e.results.find(r=>r.case_id===c.case_id),j=joined.cases.find(r=>r.case_id===c.case_id);
        need(j,'oc_evidence_case_unjoined');rows.set(key(e.run_card_sha256,c.case_id),{c,row,j,card:e.run_card});
      }
    }
    report.counts.source_cases=rows.size;
    };
    const groups = new Map(), splitSeen = new Map(), cases = [], blockers = new Set();
    const processRole=role=>{
    for (const m of a.members) {
      if(m.role!==role) continue;
      need(exact(m, ['run_card_sha256', 'case_id', 'role', 'original_split']) && hash(m.run_card_sha256) &&
        ['train', 'calibration', 'heldout'].includes(m.role), 'oc_member_invalid');
      const r = rows.get(key(m.run_card_sha256, m.case_id)); need(r && m.original_split === r.c.split, 'oc_assignment_source_mismatch');
      const {c, row, j, card} = r;
      need(m.role === 'train' ? c.split === 'development' : c.split === m.role, 'oc_split_role_relabelling');
      report.counts[m.role === 'heldout' ? 'reserved_heldout' : m.role]++;
      for (const field of ['request_sha256', 'source_sha256', 'template_sha256', 'project_sha256']) {
        const k = `${field}:${c[field]}`, prior = splitSeen.get(k);
        need(prior === undefined || prior === m.role, 'oc_cross_role_lineage_overlap'); splitSeen.set(k, m.role);
      }
      // Do not even consume a labelled heldout sheet in this P7 producer.
      need(m.role !== 'heldout', 'oc_heldout_labels_forbidden');
      need(input.operation !== 'fit' || m.role === 'train', 'oc_fit_must_not_see_calibration');
      const s = input.samples.find(s => s.run_card_sha256 === m.run_card_sha256 && s.case_id === c.case_id);
      need(exact(s, ['run_card_sha256', 'case_id', 'projection', 'captured_at_ms', 'native_harness', 'regime',
        'actual_task_evidence_sha256', 'feature_evidence_sha256', 'review_sha256', 'resource', 'execution_windows']) &&
        count(s.captured_at_ms) && s.captured_at_ms <= card.frozen_at_ms &&
        ['actual_task_evidence_sha256', 'feature_evidence_sha256', 'review_sha256'].every(k => hash(s[k]) && sources.has(s[k])),
      'oc_actual_task_feature_or_source_review_missing');
      need(c.origin === 'actual_execution' && card.rights.status === 'cleared' && sources.has(card.rights.evidence_sha256) &&
        card.lineage_audit.status === 'disjoint_verified' && sources.has(card.lineage_audit.evidence_sha256), 'oc_rights_origin_or_lineage_unqualified');
      need(['source_sha256', 'template_sha256', 'project_sha256'].every(k => sources.has(c[k])) &&
        sources.has(row.final_lock.lock_witness_sha256) && sources.has(row.grade.evidence_sha256) &&
        row.grade.host_validated === true && [j.reference_match, j.routed_task_success, j.reference_task_success].every(v => typeof v === 'boolean'),
      'oc_source_lock_or_independent_labels_missing');
      need(exact(s.projection, ['features', 'task']) && exact(s.projection.task, taskKeys) &&
        ['request_sha256', 'source_snapshot_sha256', 'feature_sha256', 'policy_sha256', 'plan_sha256', 'environment_sha256',
          'instructions_sha256', 'verifier_sha256'].every(k => hash(s.projection.task[k])) &&
        s.projection.task.policy_sha256 === card.policy_sha256 &&
        s.projection.task.scope === 'read_only' &&
        s.projection.task.workload_class === s.projection.features.semantic_family_id && s.projection.task.request_sha256 === c.request_sha256 &&
        s.projection.task.id === c.task_id && s.projection.task.node_id === c.node_id &&
        s.projection.task.feature_schema_version === p.feature_schema_version, 'oc_projection_task_mismatch');
      need(sources.get(s.feature_evidence_sha256) === stableJSON({schema:1,kind:'offline_preoutcome_feature_capture_v1',
        captured_at_ms:s.captured_at_ms,projection:s.projection}), 'oc_feature_source_binding_mismatch');
      need(sources.get(s.actual_task_evidence_sha256) === stableJSON({kind: 'offline_preoutcome_task_binding_v1',
        case_id: c.case_id, task_id: c.task_id, node_id: c.node_id, request_sha256: c.request_sha256,
        source_fingerprint: c.source_fingerprint, projection_task_sha256: digest(s.projection.task)}), 'oc_task_source_binding_mismatch');
      const descriptorText = sources.get(p.reference_descriptor_sha256);
      need(descriptorText !== undefined, 'oc_reference_descriptor_source_missing');
      let descriptor; try {descriptor = JSON.parse(descriptorText);} catch {need(false, 'oc_reference_descriptor_source_missing');}
      need(descriptorText === stableJSON(descriptor) && descriptor.policy_sha256 === card.reference_policy_sha256 &&
        descriptor.config_sha256 === card.arms.reference.config_sha256 &&
        descriptor.harness_sha256 === s.native_harness.reference.harness_sha256 &&
        descriptor.metric_id === s.regime.quality_metric_id && descriptor.metric_version === s.regime.metric_version,
      'oc_reference_descriptor_or_metric_mismatch');
      const bucket = frozenRouteFeatureBucket(s.projection.features, s.projection.task);
      need(s.projection.task.feature_sha256 === bucket && s.projection.features.source_state !== 'unknown', 'oc_feature_unknown_or_mismatch');
      need(exact(s.regime, bindingKeys) && digest(s.regime) === p.regime_sha256 &&
        s.regime.reference_descriptor_sha256 === p.reference_descriptor_sha256 &&
        s.regime.policy_sha256 === card.policy_sha256 && s.regime.environment_sha256 === s.projection.task.environment_sha256 &&
        s.regime.verifier_sha256 === s.projection.task.verifier_sha256, 'oc_regime_or_reference_mismatch');
      need(exact(s.native_harness, ['reference', 'routed']) && exact(s.resource, ['reference', 'routed']) && exact(s.execution_windows, ['reference', 'routed']), 'oc_arm_projection_invalid');
      const costs = {};
      for (const arm of ['reference', 'routed']) {
        const h = s.native_harness[arm], expected = card.arms[arm], n = allOutcomes.get(row.attempts[arm].outcome_id);
        need(exact(h, nativeKeys) && nativeKeys.every(k => hash(h[k])) && h.config_sha256 === expected.config_sha256 &&
          h.native_instructions_sha256 === expected.instructions_sha256 && sources.has(h.harness_sha256) &&
          sources.has(n.native.record_sha256) && sources.has(n.provenance.source_sha256) && sources.has(n.usage.provenance_sha256),
        'oc_native_harness_or_raw_source_missing');
        validateExecutionWindow(s.execution_windows[arm],{sample:s,record:n,row,card,policy:p,role:m.role,now:input.now_ms,sources});
        costs[arm] = resource(s.resource[arm], n, sources);
      }
      if (m.role === 'train') need(row.grade.assessed_at_ms <= p.fit_at_ms, 'oc_train_label_after_fit');
      else need(card.proof_mode === 'candidate_goldblind' && p.fit_at_ms < card.frozen_at_ms &&
        p.frozen_at_ms < card.frozen_at_ms && row.grade.assessed_at_ms <= p.assessed_at_ms,
      'oc_calibration_not_frozen_before_collection');
      const stratum = digest({feature_bucket_sha256: bucket, reference: card.arms.reference, routed: card.arms.routed,
        native_harness: s.native_harness, regime: s.regime});
      if (!groups.has(stratum)) groups.set(stratum, {stratum_sha256: stratum, feature_bucket_sha256: bucket,
        reference: card.arms.reference, routed: card.arms.routed, native_harness: s.native_harness, regime: s.regime,
        train: [], calibration: []});
      groups.get(stratum)[m.role].push({match: Number(j.reference_match), success: Number(j.routed_task_success),
        accepted_B: j.accepted_B, both_wrong: j.both_wrong, costs});
      cases.push({case_id: c.case_id, run_card_sha256: m.run_card_sha256, role: m.role, original_split: c.split,
        proof_mode: card.proof_mode, stratum_sha256: stratum, final_lock_sha256: row.final_lock.final_lock_sha256,
        label_evidence_sha256: row.grade.evidence_sha256, used_for_fit: m.role === 'train'});
    }
    };
    // Only training labels can influence the frozen model identity.
    joinRole('train');processRole('train');
    need(groups.size > 0, 'oc_no_train_calibration_strata');
    // This model identity depends ONLY on training rows and preregistered policy,
    // never calibration labels, statistics or the full-input hash.
    const trainingModel = {schema: 1, kind: OFFLINE_CALIBRATION_FORMAT, data_mode: input.data_mode,
      policy_sha256: report.policy_sha256, training_cases: cases.filter(x => x.role === 'train'),
      cells: [...groups.values()].filter(g => g.train.length).sort((a,b) => a.stratum_sha256.localeCompare(b.stratum_sha256))
        .map(({train, calibration, ...binding}) => ({...binding, train_count: train.length,
          reference_match_mle: average(train.map(x => x.match)), task_success_mle: average(train.map(x => x.success)),
          reference_resource_mean: average(train.map(x => x.costs.reference)), routed_resource_mean: average(train.map(x => x.costs.routed))})),
      ood_policy: p.ood_policy, ...authority};
    need(trainingModel.cells.length > 0, 'oc_training_rows_absent');
    report.training_model = trainingModel; report.training_model_sha256 = digest(trainingModel);
    need(trainingModel.cells.every(c=>c.train_count>=p.minimum_train_per_stratum),'oc_train_sample_insufficient');
    if (input.operation === 'fit') {
      report.source_manifest=sourceManifest;
      report.status = input.data_mode === 'synthetic_fixture' ? 'synthetic_training_fit_not_efficacy' : 'offline_training_fit_needs_independent_calibration';
      return immutable(report);
    }
    // This comparison must precede every calibration join, not merely the
    // final return. A mismatch may expose TRAIN-only analysis, never CAL labels.
    need(lock.training_model_sha256===report.training_model_sha256,'oc_training_fit_lock_absent_or_mismatched');
    joinRole('calibration');processRole('calibration');
    report.source_manifest=sourceManifest;
    const cells = [];
    for (const g of [...groups.values()].sort((a, b) => a.stratum_sha256.localeCompare(b.stratum_sha256))) {
      const {train, calibration, ...binding} = g;
      if (train.length < p.minimum_train_per_stratum) blockers.add('oc_train_sample_insufficient');
      if (calibration.length < p.minimum_calibration_per_stratum) blockers.add('oc_calibration_sample_insufficient');
      const fitted = {}, assessment = {};
      for (const label of ['match', 'success']) {
        const estimate = average(train.map(x => x[label])), observed = average(calibration.map(x => x[label]));
        fitted[label] = estimate;
        const radius = calibration.length ? Math.sqrt(Math.log(2 * trainingModel.cells.length / p.familywise_alpha) / (2 * calibration.length)) : null;
        const lower = observed === null ? null : Math.max(0, observed - radius);
        const bias = estimate === null || observed === null ? null : observed - estimate;
        const brier = estimate === null ? null : average(calibration.map(x => (x[label] - estimate) ** 2));
        assessment[label] = {observed_fraction: observed, one_sided_lower_bound: lower, bias, brier_score: brier};
        if (lower === null || lower < p[label === 'match' ? 'minimum_reference_match_lower_bound' : 'minimum_task_success_lower_bound'])
          blockers.add(`oc_${label}_lower_bound_below_policy`);
        if (brier === null || brier > p.maximum_brier_score) blockers.add('oc_brier_exceeds_policy');
        if (bias === null || Math.abs(bias) > p.maximum_absolute_bias) blockers.add('oc_bias_exceeds_policy');
      }
      if (calibration.filter(x => x.accepted_B).length > p.maximum_calibration_accepted_B) blockers.add('oc_accepted_B_exceeds_policy');
      cells.push({...binding, train_count: train.length, calibration_count: calibration.length,
        fitted_bernoulli_mle: fitted, calibration_assessment: assessment,
        calibration_accepted_B: calibration.filter(x => x.accepted_B).length,
        calibration_both_wrong: calibration.filter(x => x.both_wrong).length,
        resource_model: {unit: 'observed_whole_supported_scope_tokens_not_quota_or_cash',
          train_reference_mean: average(train.map(x => x.costs.reference)), train_routed_mean: average(train.map(x => x.costs.routed)),
          calibration_reference_mean: average(calibration.map(x => x.costs.reference)),
          calibration_routed_mean: average(calibration.map(x => x.costs.routed)), quota: null, cash: null}});
    }
    report.blockers = [...blockers].sort();
    const fit = {schema: 1, kind: OFFLINE_CALIBRATION_FORMAT, data_mode: input.data_mode,
      algorithm: p.algorithm, policy_sha256: report.policy_sha256, assignment_sha256: digest(a),
      fit_at_ms: p.fit_at_ms, assessed_at_ms: p.assessed_at_ms, valid_until_ms: p.valid_until_ms,
      feature_schema_version: p.feature_schema_version, reference_descriptor_sha256: p.reference_descriptor_sha256,
      regime_sha256: p.regime_sha256, input_sha256: report.input_sha256,
      source_manifest_sha256: digest(report.source_manifest), training_model_sha256: report.training_model_sha256, training_cases: cases.filter(x => x.role === 'train'),
      calibration_cases: cases.filter(x => x.role === 'calibration'), reserved_heldout_cases: cases.filter(x => x.role === 'heldout'),
      cells, assessment: blockers.size ? 'fails_preregistered_statistical_policy' : 'meets_preregistered_statistical_policy',
      holdout_status: 'not_evaluated_by_producer', evidence_authenticity: 'external_review_required',
      ood_policy: p.ood_policy, ...authority};
    report.fit = fit; report.artifact_sha256 = digest(fit);
    report.status = blockers.size ? 'insufficient_evidence' : input.data_mode === 'synthetic_fixture' ?
      'synthetic_fit_assessed_not_efficacy' : 'offline_fit_assessed_external_review_required';
    return immutable(report);
  } catch (error) {return fail(/^oc_[a-z_]+$/.test(error?.code ?? '') ? error.code : 'oc_input_or_source_invalid');}
}

/** Offline loader/verifier recomputes from original evidence, never accepts a
 * caller flag or an artifact's own claim of qualification. Not a runtime loader.
 */
export function verifyOfflineRouteCalibrationArtifact(artifact, input) {
  const r = produceOfflineRouteCalibration(input);
  try {need(r.fit !== null && digest(offlineCalibrationData(artifact)) === r.artifact_sha256, 'oc_artifact_recompute_mismatch');
    return immutable({schema: 1, status: 'recomputed_exact_offline_artifact', artifact_sha256: r.artifact_sha256,
      assessment: r.fit.assessment, input_sha256: r.input_sha256, ...authority});
  } catch {return immutable({schema: 1, status: 'quarantined', reason: 'oc_artifact_recompute_mismatch', ...authority});}
}
export const offlineCalibrationCanonicalJSON = value => canonical(offlineCalibrationData(value));
