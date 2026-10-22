// Synthetic source-contract tests only. None is a provider call, calibration,
// raw receipt review, held-out proof, or permission to enable covered_live.
import test from 'node:test';
import assert from 'node:assert/strict';
import {digest} from '../../Resources/openclaw-os1-bridge/joint-route-selector.mjs';
import {normalizeRoutingOutcome} from '../../Resources/openclaw-os1-bridge/routing-outcome.mjs';
import {evaluateFrozenRouteEvidence as evaluate} from '../../Resources/openclaw-os1-bridge/frozen-route-evidence.mjs';

const H = x => digest(`SYNTHETIC:${x}`);
const UUID = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const policy = H('policy'), contract = H('contract');
function config(model, effort) {
  return {surface: 'codex', transport: 'codex_app_server', account_id: 'synthetic-account',
    model, effort, tools: ['read_file'], scope: 'read_only', permission_profile: 'read_only',
    quota_pool: 'openai_codex', allowed_paths: ['/synthetic-owned'],
    configuration_sha256: H(`${model}:${effort}:config`)};
}
const referenceConfig = config('SYNTHETIC-reference', 'ultra');
const routedConfig = config('SYNTHETIC-routed', 'low');
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
function outcome(c, rawConfig, n, total) {
  const attempt = UUID(n);
  const source = {schema: 1, origin: 'actual_execution', identity: {task_id: c.task_id, node_id: c.node_id,
    attempt_id: attempt, candidate_id: rawConfig.model, request_sha256: c.request_sha256,
    source_fingerprint: c.source_fingerprint, policy_sha256: policy,
    configuration_sha256: rawConfig.configuration_sha256, quality_contract_sha256: contract},
  provenance: {source_kind: 'core_settled_attempt', source_sha256: H(`receipt:${n}`), host_validated: true,
    observed_at_ms: c.split === 'heldout' ? 1550 : 1050},
  configs: {selected: rawConfig, acknowledged: structuredClone(rawConfig), observed: structuredClone(rawConfig)},
  native: {provider: 'openai', execution_id: `execution-${n}`, session_id: UUID(n+100), turn_id: UUID(n+200),
    record_sha256: H(`native:${n}`), turn_terminated: true},
  result: {status: 'succeeded', attempt_state: 'completed', dispatch_stage: 'dispatched', side_effects: 'none',
    execution_verified: true, task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
    output_sha256: H(`output:${n}`), artifact_sha256: H(`artifact:${n}`), error_code: null,
    failure_category: null, http_status: null},
  adoption: {state: 'unknown', scope: 'task', final_for_scope: null}, checker: null, usage: usage(n, total)};
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
  calibrated = true, origin = 'actual_execution'} = {}) {
  const case_manifest = specs.map((s, i) => ({case_id: `case-${i}`, split: s.split, origin,
    task_id: `task-${i}`, node_id: `node-${i}`, request_sha256: H(`request-${i}`),
    source_fingerprint: H(`source-fingerprint-${i}`), source_sha256: H(`source-${i}`),
    template_sha256: H(`template-${i}`), project_sha256: H(`project-${i}`)}));
  const card = {schema: 1, id: 'SYNTHETIC-run', source_commit: 'a'.repeat(40), frozen_at_ms: 1000,
    proof_mode: proofMode, policy_sha256: policy, quality_contract_sha256: contract,
    reference_policy_sha256: H('reference-policy'), candidate_pool_sha256: H('candidate-pool'),
    feature_schema_version: 'host_preoutcome_counts_v1', arms: {reference: arm(referenceConfig), routed: arm(routedConfig)},
    case_manifest, calibration: calibrated ? {status: 'externally_verified', artifact_sha256: H('calibration-artifact'), frozen_at_ms: 1500} :
      {status: 'unmeasured', artifact_sha256: null, frozen_at_ms: null},
    thresholds: {minimum_calibration_cases: 2, minimum_heldout_cases: 2, maximum_accepted_B: 0,
      maximum_task_failures: 0, require_complete_token_accounting: true},
    rights: {status: rights, evidence_sha256: rights === 'cleared' ? H('rights') : null},
    lineage_audit: {status: lineage, evidence_sha256: lineage === 'disjoint_verified' ? H('lineage') : null},
    gold_visible_before_final_lock: false, scorer_visible_before_final_lock: false};
  const records = [], results = [], cardHash = digest(card);
  for (let i = 0; i < specs.length; i++) {
    const c = case_manifest[i], s = specs[i], ref = outcome(c, referenceConfig, i*2+1, s.refTokens ?? 0),
      routed = outcome(c, routedConfig, i*2+2, s.routeTokens ?? 0);
    records.push(ref, routed);
    const choice = s.choice ?? 'routed', chosen = choice === 'reference' ? ref : routed,
      finalSuccess = choice === 'reference' ? s.ref : s.route, lockTime = s.split === 'heldout' ? 1600 : 1100;
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
const strong = () => build([
  {split: 'calibration', ref: true, route: true}, {split: 'calibration', ref: true, route: true},
  {split: 'heldout', ref: false, route: true, match: false},
  {split: 'heldout', ref: true, route: false, match: false, choice: 'reference'},
]);
const run = x => evaluate(x);
const rehash = x => {x.run_card_sha256 = digest(x.run_card); x.results.forEach((_, i) => relock(x, i)); return x;};
function relock(x, n) {
  const l = x.results[n].final_lock, r = x.outcome_state.records.find(r => r.outcome_id === l.chosen_outcome_id);
  l.chosen_artifact_sha256 = r.result.artifact_sha256;
  l.final_lock_sha256 = digest({run_card_sha256: x.run_card_sha256, case_id: x.results[n].case_id,
    choice: l.choice, adoption_reason: l.adoption_reason, chosen_outcome_id: l.chosen_outcome_id,
    chosen_artifact_sha256: l.chosen_artifact_sha256, locked_at_ms: l.locked_at_ms});
  x.results[n].grade.final_lock_sha256 = l.final_lock_sha256;
}

test('n2 synthetic DEV observations cannot become calibration, confidence, proof or live authority', () => {
  const x = build([{split: 'development', ref: false, route: false, match: true},
    {split: 'development', ref: true, route: true}],
  {proofMode: 'internal_dev', rights: 'review_required', lineage: 'not_performed', calibrated: false,
    origin: 'synthetic_fixture'});
  const r = run(x);
  assert.equal(r.status, 'ineligible'); assert.equal(r.counts.development.cases, 2);
  assert.equal(r.cases[0].reference_match, true); assert.equal(r.cases[0].both_wrong, true);
  assert(r.blockers.includes('nonactual_case_origin')); assert(r.blockers.includes('development_proof_mode'));
  assert(r.blockers.includes('calibration_unmeasured')); assert(r.blockers.includes('heldout_sample_insufficient'));
  assert.equal(r.confidence_lower_bound, null); assert.equal(r.covered_live_authorized, false);
  assert.equal(r.quality_certificate, false); assert.equal(r.model_calls, 0);
});
test('empty registry remains ineligible even if a caller labels its calibration externally verified', () => {
  const x = build([]); const r = run(x);
  assert.equal(r.status, 'ineligible'); assert.equal(r.counts.calibration.cases, 0);
  assert.equal(r.counts.heldout.cases, 0); assert.equal(r.confidence_lower_bound, null);
  assert.equal(r.promotion_review_eligible, false); assert.equal(r.covered_live_authorized, false);
});
test('exact independent join counts accepted_C, fallback and zero accepted_B; review is not promotion', () => {
  const r = run(strong()); assert.equal(r.status, 'eligible_for_external_review');
  assert.equal(r.counts.heldout.accepted_C, 1); assert.equal(r.counts.heldout.accepted_B, 0);
  assert.equal(r.counts.heldout.fallback_count, 1); assert.equal(r.cases[3].routed_task_success, false);
  assert.equal(r.cases[3].final_task_success, true); assert.equal(r.cases[2].reference_match, false);
  assert.equal(r.cases[0].reference_tokens_observed, 0); assert.equal(r.cases[0].routed_tokens_observed, 0);
  assert.equal(r.promotion_review_eligible, true); assert.equal(r.calibration_validated, false);
  assert.equal(r.holdout_accepted, false); assert.equal(r.covered_live_authorized, false);
  assert.equal(r.quality_certificate, false); assert.equal(r.confidence_lower_bound, null);
});
test('accepted_B and independent task failure block promotion review even when reference_match is false', () => {
  const x = strong(); x.results[3].final_lock.choice = 'routed';
  x.results[3].final_lock.adoption_reason = 'routed_accepted';
  x.results[3].final_lock.chosen_outcome_id = x.results[3].attempts.routed.outcome_id;
  x.results[3].grade.final_task_success = false; relock(x, 3);
  const r = run(x); assert.equal(r.counts.heldout.accepted_B, 1);
  assert(r.blockers.includes('accepted_B_exceeds_floor')); assert(r.blockers.includes('heldout_task_failures'));
});
test('exact attempt, tuple, tools, instructions, source and run-card pin cannot be substituted', () => {
  for (const change of [
    x => {x.results[0].attempts.routed.attempt_id = UUID(999);},
    x => {x.results[0].attempts.routed.config_sha256 = H('wrong-config');},
    x => {x.results[0].attempts.routed.instructions_sha256 = H('wrong-instructions');},
    x => {x.results[0].attempts.routed.tools_sha256 = H('wrong-tools');},
    x => {x.results[0].attempts.routed.source_fingerprint = H('wrong-source');},
    x => {x.results[0].attempts.routed.execution_witness_sha256 = H('wrong-witness');},
    x => {x.run_card.arms.routed.model = 'SYNTHETIC-other'; rehash(x);},
    x => {x.run_card.arms.routed.effort = 'medium'; rehash(x);},
  ]) {const x = strong(); change(x); assert.equal(run(x).status, 'ineligible');}
  const x = strong(); x.run_card.policy_sha256 = H('tampered');
  assert.equal(run(x).reason, 'evidence_run_card_hash_mismatch');
});
test('wrong final lock order, selected arm or early scorer access never passes', () => {
  for (const change of [
    x => {x.results[2].final_lock.locked_at_ms = 1700;},
    x => {x.results[2].final_lock.chosen_outcome_id = x.results[2].attempts.reference.outcome_id;},
    x => {x.results[2].final_lock.scorer_visible_before_lock = true;},
    x => {x.run_card.gold_visible_before_final_lock = true; rehash(x);},
    x => {x.run_card.calibration.frozen_at_ms = 1700; rehash(x);},
  ]) {const x = strong(); change(x); assert.equal(run(x).status, 'ineligible');}
});
test('resource null remains unknown rather than zero, and rights/lineage overlap block review', () => {
  const unknown = strong(); unknown.outcome_state.records[0] = outcome(unknown.run_card.case_manifest[0], referenceConfig, 1, null);
  unknown.results[0].attempts.reference.normalized_sha256 = unknown.outcome_state.records[0].normalized_sha256;
  assert(run(unknown).blockers.includes('resource_accounting_incomplete'));
  const rights = strong(); rights.run_card.rights = {status: 'unknown', evidence_sha256: null}; rehash(rights);
  assert(run(rights).blockers.includes('rights_not_cleared'));
  const overlap = strong(); overlap.run_card.case_manifest[2].template_sha256 = overlap.run_card.case_manifest[0].template_sha256;
  rehash(overlap); assert(run(overlap).blockers.includes('cross_split_lineage_overlap'));
  const lineage = strong(); lineage.run_card.lineage_audit = {status: 'not_performed', evidence_sha256: null}; rehash(lineage);
  assert(run(lineage).blockers.includes('lineage_not_disjoint_verified'));
});
test('unverified labels, both-wrong false parity, and quarantined outcomes remain ineligible', () => {
  const unknown = strong(); unknown.results[2].grade.reference_task_success = null;
  unknown.results[2].grade.reference_match = null;
  assert(run(unknown).blockers.includes('labels_unknown'));
  const q = strong(); q.outcome_state.quarantined = [{outcome_id: H('conflict'), reason: 'contradictory_same_identity',
    variant_sha256s: [H('one'), H('two')]}];
  assert.equal(run(q).reason, 'evidence_outcome_state_invalid_or_quarantined');
  const both = build([{split: 'development', ref: false, route: false, match: true}],
    {proofMode: 'internal_dev', calibrated: false});
  const r = run(both); assert.equal(r.cases[0].both_wrong, true); assert.equal(r.cases[0].reference_match, true);
  assert.equal(r.cases[0].final_task_success, false);
});
test('unfrozen extra outcome, duplicate case identity and incompatible independent labels cannot wash into counts', () => {
  const extra = strong(), unrelated = {...extra.run_card.case_manifest[0], task_id: 'unrelated-task', node_id: 'unrelated-node'};
  extra.outcome_state.records.push(outcome(unrelated, referenceConfig, 999, 0));
  assert.equal(run(extra).reason, 'evidence_unassigned_outcome_record');
  const duplicate = strong(); duplicate.run_card.case_manifest[1].task_id = duplicate.run_card.case_manifest[0].task_id;
  duplicate.run_card.case_manifest[1].node_id = duplicate.run_card.case_manifest[0].node_id;
  duplicate.run_card.case_manifest[1].request_sha256 = duplicate.run_card.case_manifest[0].request_sha256;
  rehash(duplicate); assert.equal(run(duplicate).reason, 'evidence_manifest_invalid');
  const mismatch = strong(); mismatch.results[0].grade.reference_match = true;
  mismatch.results[0].grade.routed_task_success = false;
  mismatch.results[0].grade.final_task_success = false;
  assert(run(mismatch).blockers.includes('reference_match_conflicts_with_task_success'));
});
