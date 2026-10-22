/** P7/P8 offline evidence preflight. Pure: no store, model calls, dispatch or
 * covered_live registration. It joins independently supplied case/lock/grade
 * evidence to already-normalized Core outcome records by exact attempt and
 * native tuple. Consistency is not source authenticity or a quality certificate.
 */
import {frozenRouteData} from './frozen-route-artifacts.mjs';
import {digest} from './joint-route-selector.mjs';
import {mergeRoutingOutcomes} from './routing-outcome.mjs';

const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const hash = x => typeof x === 'string' && HASH.test(x);
const id = x => typeof x === 'string' && ID.test(x);
const time = x => Number.isSafeInteger(x) && x >= 0;
const count = x => Number.isSafeInteger(x) && x >= 0;
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => plain(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const yes = (v, code) => {if (!v) throw Object.assign(new Error(code), {code});};
const sorted = xs => [...xs].sort();
const unique = xs => new Set(xs).size === xs.length;
const reasons = xs => sorted(new Set(xs));
const RESULT_KEYS = ['case_id', 'attempts', 'final_lock', 'grade'];
const ATTEMPT_KEYS = ['outcome_id', 'normalized_sha256', 'task_id', 'node_id', 'attempt_id',
  'candidate_id', 'configuration_sha256', 'config_sha256', 'instructions_sha256', 'tools_sha256',
  'source_fingerprint', 'execution_witness_sha256'];
const CASE_KEYS = ['case_id', 'split', 'origin', 'task_id', 'node_id', 'request_sha256', 'source_fingerprint',
  'source_sha256', 'template_sha256', 'project_sha256'];
const ARM_KEYS = ['candidate_id', 'configuration_sha256', 'config_sha256', 'surface', 'transport',
  'account_id', 'model', 'effort', 'tools_sha256', 'instructions_sha256'];

function arm(x) {
  yes(exact(x, ARM_KEYS) && ['candidate_id', 'surface', 'transport', 'account_id', 'model', 'effort'].every(k => id(x[k])) &&
    ['configuration_sha256', 'config_sha256', 'tools_sha256', 'instructions_sha256'].every(k => hash(x[k])), 'evidence_arm_invalid');
}
function validateCard(card) {
  yes(exact(card, ['schema', 'id', 'source_commit', 'frozen_at_ms', 'proof_mode', 'policy_sha256',
    'quality_contract_sha256', 'reference_policy_sha256', 'candidate_pool_sha256', 'feature_schema_version',
    'arms', 'case_manifest', 'calibration', 'thresholds', 'rights', 'lineage_audit', 'gold_visible_before_final_lock',
    'scorer_visible_before_final_lock']) && card.schema === 1 && id(card.id) && COMMIT.test(card.source_commit) &&
    time(card.frozen_at_ms) && ['internal_dev', 'candidate_goldblind'].includes(card.proof_mode) &&
    ['policy_sha256', 'quality_contract_sha256', 'reference_policy_sha256', 'candidate_pool_sha256'].every(k => hash(card[k])) &&
    id(card.feature_schema_version) && card.gold_visible_before_final_lock === false &&
    card.scorer_visible_before_final_lock === false, 'evidence_run_card_invalid');
  yes(exact(card.arms, ['reference', 'routed']), 'evidence_arms_invalid');
  arm(card.arms.reference); arm(card.arms.routed);
  yes(Array.isArray(card.case_manifest) && card.case_manifest.length <= 2048 &&
    unique(card.case_manifest.map(c => c.case_id)) &&
    unique(card.case_manifest.map(c => `${c.task_id}:${c.node_id}:${c.request_sha256}`)), 'evidence_manifest_invalid');
  for (const c of card.case_manifest) yes(exact(c, CASE_KEYS) && id(c.case_id) && id(c.task_id) && id(c.node_id) &&
    ['development', 'calibration', 'heldout'].includes(c.split) &&
    ['actual_execution', 'synthetic_fixture', 'unknown'].includes(c.origin) &&
    CASE_KEYS.slice(5).every(k => hash(c[k])), 'evidence_case_invalid');
  yes(exact(card.calibration, ['status', 'artifact_sha256', 'frozen_at_ms']) &&
    ['unmeasured', 'externally_verified'].includes(card.calibration.status) &&
    (card.calibration.status === 'unmeasured' ? card.calibration.artifact_sha256 === null && card.calibration.frozen_at_ms === null :
      hash(card.calibration.artifact_sha256) && time(card.calibration.frozen_at_ms) &&
      card.calibration.frozen_at_ms >= card.frozen_at_ms), 'evidence_calibration_invalid');
  yes(exact(card.thresholds, ['minimum_calibration_cases', 'minimum_heldout_cases', 'maximum_accepted_B',
    'maximum_task_failures', 'require_complete_token_accounting']) &&
    count(card.thresholds.minimum_calibration_cases) && card.thresholds.minimum_calibration_cases >= 2 &&
    count(card.thresholds.minimum_heldout_cases) && card.thresholds.minimum_heldout_cases >= 2 &&
    card.thresholds.maximum_accepted_B === 0 && card.thresholds.maximum_task_failures === 0 &&
    typeof card.thresholds.require_complete_token_accounting === 'boolean', 'evidence_threshold_invalid');
  yes(exact(card.rights, ['status', 'evidence_sha256']) && ['cleared', 'review_required', 'unknown'].includes(card.rights.status) &&
    (card.rights.evidence_sha256 === null || hash(card.rights.evidence_sha256)) &&
    (card.rights.status !== 'cleared' || hash(card.rights.evidence_sha256)), 'evidence_rights_invalid');
  yes(exact(card.lineage_audit, ['status', 'evidence_sha256']) &&
    ['not_performed', 'overlap_found', 'disjoint_verified'].includes(card.lineage_audit.status) &&
    (card.lineage_audit.evidence_sha256 === null || hash(card.lineage_audit.evidence_sha256)) &&
    (card.lineage_audit.status !== 'disjoint_verified' || hash(card.lineage_audit.evidence_sha256)), 'evidence_lineage_invalid');
}
function validateResult(row) {
  yes(exact(row, RESULT_KEYS) && id(row.case_id) && exact(row.attempts, ['reference', 'routed']), 'evidence_result_invalid');
  for (const a of Object.values(row.attempts)) yes(exact(a, ATTEMPT_KEYS) &&
    ['outcome_id', 'normalized_sha256', 'configuration_sha256', 'config_sha256', 'instructions_sha256',
      'tools_sha256', 'source_fingerprint', 'execution_witness_sha256'].every(k => hash(a[k])) &&
    ['task_id', 'node_id', 'candidate_id'].every(k => id(a[k])) && UUID.test(a.attempt_id), 'evidence_attempt_invalid');
  const l = row.final_lock, g = row.grade;
  yes(exact(l, ['choice', 'adoption_reason', 'chosen_outcome_id', 'chosen_artifact_sha256', 'final_lock_sha256', 'lock_witness_sha256', 'locked_at_ms',
    'gold_visible_before_lock', 'scorer_visible_before_lock']) && ['reference', 'routed'].includes(l.choice) &&
    (l.choice === 'reference' ? ['routed_rejected_fallback', 'reference_preserved'].includes(l.adoption_reason) :
      l.adoption_reason === 'routed_accepted') &&
    ['chosen_outcome_id', 'chosen_artifact_sha256', 'final_lock_sha256', 'lock_witness_sha256'].every(k => hash(l[k])) &&
    time(l.locked_at_ms) && l.gold_visible_before_lock === false && l.scorer_visible_before_lock === false,
  'evidence_final_lock_invalid');
  yes(exact(g, ['source_kind', 'host_validated', 'evidence_sha256', 'final_lock_sha256', 'task_id', 'assessed_at_ms', 'reference_task_success',
    'routed_task_success', 'final_task_success', 'reference_match']) &&
    g.source_kind === 'independent_final_evaluator' && typeof g.host_validated === 'boolean' &&
    hash(g.evidence_sha256) && hash(g.final_lock_sha256) && id(g.task_id) && time(g.assessed_at_ms) &&
    ['reference_task_success', 'routed_task_success', 'final_task_success', 'reference_match']
      .every(k => [null, true, false].includes(g[k])), 'evidence_grade_invalid');
}
function joinedAttempt(binding, expected, c, card, records, used) {
  const r = records.get(binding.outcome_id);
  yes(r && r.normalized_sha256 === binding.normalized_sha256 && !used.has(r.outcome_id), 'evidence_outcome_missing_or_reused');
  used.add(r.outcome_id);
  yes(r.origin === 'actual_execution' && r.provenance.host_validated === true &&
    r.identity.task_id === c.task_id && r.identity.node_id === c.node_id &&
    r.identity.request_sha256 === c.request_sha256 && r.identity.source_fingerprint === c.source_fingerprint &&
    r.identity.policy_sha256 === card.policy_sha256 && r.identity.quality_contract_sha256 === card.quality_contract_sha256 &&
    r.identity.task_id === binding.task_id && r.identity.node_id === binding.node_id &&
    r.identity.attempt_id.toLowerCase() === binding.attempt_id.toLowerCase() &&
    r.identity.candidate_id === binding.candidate_id && r.identity.configuration_sha256 === binding.configuration_sha256 &&
    binding.source_fingerprint === c.source_fingerprint &&
    binding.candidate_id === expected.candidate_id && binding.configuration_sha256 === expected.configuration_sha256 &&
    binding.config_sha256 === expected.config_sha256 && binding.instructions_sha256 === expected.instructions_sha256 &&
    binding.tools_sha256 === expected.tools_sha256 &&
    r.selected_config?.config_sha256 === expected.config_sha256 &&
    r.acknowledged_config?.config_sha256 === expected.config_sha256 &&
    r.observed_config?.config_sha256 === expected.config_sha256, 'evidence_exact_attempt_or_config_mismatch');
  yes(['surface', 'transport', 'account_id', 'model', 'effort'].every(k =>
    r.observed_config[k] === expected[k]) && r.observed_config.tools_sha256 === expected.tools_sha256 &&
    r.observed_config.configuration_sha256 === expected.configuration_sha256 &&
    r.native.record_sha256 === binding.execution_witness_sha256 && r.native.turn_terminated === true &&
    r.result.dispatch_stage === 'dispatched' && r.result.execution_verified === true,
  'evidence_native_or_instruction_witness_missing');
  // The normalized outcome has no instructions field: the external native
  // witness MUST be separately inspected before this hash assertion is trusted.
  return r;
}

/** Pure, conservative review precheck. Caller must separately inspect original
 * native ticket, grader, rights and lineage artifacts; booleans/hashes here
 * cannot authenticate those sources or authorize a production policy. */
export function evaluateFrozenRouteEvidence(input) {
  let card = null;
  const ineligible = (reason, detail = null) => ({schema: 1, status: 'ineligible', reason,
    detail, run_card_sha256: card === null ? null : digest(card), cases: [], counts: null,
    calibration_review_eligible: false, promotion_review_eligible: false, calibration_validated: false,
    holdout_accepted: false, covered_live_authorized: false, quality_certificate: false,
    confidence_lower_bound: null, model_calls: 0, source_authenticity: 'requires_external_raw_source_review'});
  try {
    input = frozenRouteData(input);
    yes(exact(input, ['schema', 'run_card', 'run_card_sha256', 'results', 'outcome_state']) && input.schema === 1 &&
      hash(input.run_card_sha256), 'evidence_input_invalid');
    card = input.run_card; validateCard(card);
    yes(digest(card) === input.run_card_sha256, 'evidence_run_card_hash_mismatch');
    yes(Array.isArray(input.results) && input.results.length === card.case_manifest.length &&
      unique(input.results.map(r => r.case_id)), 'evidence_result_set_mismatch');
    yes(exact(input.outcome_state, ['schema', 'records', 'quarantined']) && input.outcome_state.schema === 1 &&
      Array.isArray(input.outcome_state.records) && input.outcome_state.records.length <= 4096 &&
      Array.isArray(input.outcome_state.quarantined) && input.outcome_state.quarantined.length === 0,
    'evidence_outcome_state_invalid_or_quarantined');
    let merged = null;
    for (const r of input.outcome_state.records) {
      const next = mergeRoutingOutcomes(merged, r);
      yes(next.disposition !== 'quarantined', 'evidence_outcome_conflict'); merged = next.state;
    }
    const records = new Map((merged?.records ?? []).map(r => [r.outcome_id, r]));
    const manifest = new Map(card.case_manifest.map(c => [c.case_id, c]));
    const used = new Set(), joined = [], faults = [], overlap = [];
    const splitByFingerprint = new Map();
    for (const c of card.case_manifest) for (const k of ['source_sha256', 'template_sha256', 'project_sha256']) {
      const key = `${k}:${c[k]}`, first = splitByFingerprint.get(key);
      if (first && first !== c.split) overlap.push(k); else splitByFingerprint.set(key, c.split);
    }
    for (const row of input.results) {
      validateResult(row); const c = manifest.get(row.case_id);
      yes(c, 'evidence_result_case_not_frozen');
      const ref = joinedAttempt(row.attempts.reference, card.arms.reference, c, card, records, used);
      const routed = joinedAttempt(row.attempts.routed, card.arms.routed, c, card, records, used);
      const l = row.final_lock, g = row.grade, chosen = l.choice === 'reference' ? ref : routed;
      const lockBody = {run_card_sha256: input.run_card_sha256, case_id: c.case_id, choice: l.choice,
        adoption_reason: l.adoption_reason,
        chosen_outcome_id: l.chosen_outcome_id, chosen_artifact_sha256: l.chosen_artifact_sha256,
        locked_at_ms: l.locked_at_ms};
      yes(l.chosen_outcome_id === chosen.outcome_id && l.chosen_artifact_sha256 === chosen.result.artifact_sha256 &&
        l.final_lock_sha256 === digest(lockBody) && g.final_lock_sha256 === l.final_lock_sha256 &&
        g.task_id === c.task_id && l.locked_at_ms >= card.frozen_at_ms &&
        g.assessed_at_ms > l.locked_at_ms && g.final_task_success ===
          (l.choice === 'reference' ? g.reference_task_success : g.routed_task_success),
      'evidence_goldblind_order_or_final_mismatch');
      if (card.calibration.status === 'externally_verified') {
        if (c.split === 'heldout') yes(card.calibration.frozen_at_ms < l.locked_at_ms,
          'evidence_calibration_not_frozen_before_holdout');
        if (c.split === 'calibration') yes(g.assessed_at_ms < card.calibration.frozen_at_ms,
          'evidence_calibration_trained_after_freeze');
      }
      if (c.origin !== 'actual_execution') faults.push('nonactual_case_origin');
      if (!g.host_validated || [g.reference_task_success, g.routed_task_success, g.final_task_success, g.reference_match].includes(null))
        faults.push('independent_labels_missing');
      if (g.reference_match === true && g.reference_task_success !== g.routed_task_success)
        faults.push('reference_match_conflicts_with_task_success');
      for (const r of [ref, routed]) if (r.learning.correctness_label !== null &&
        (r === ref ? g.reference_task_success : g.routed_task_success) !== null &&
        r.learning.correctness_label !== Number(r === ref ? g.reference_task_success : g.routed_task_success))
        faults.push('checker_evaluator_label_conflict');
      const usage = [ref, routed].map(r => r.usage.accounting_complete === true &&
        count(r.usage.total_tokens_observed) && count(r.usage.provider_calls_observed) ?
        r.usage.total_tokens_observed : null);
      if (usage.includes(null)) faults.push('resource_unknown');
      joined.push({case_id: c.case_id, split: c.split, reference_outcome_id: ref.outcome_id,
        routed_outcome_id: routed.outcome_id, final_outcome_id: chosen.outcome_id, final_choice: l.choice,
        reference_task_success: g.reference_task_success, routed_task_success: g.routed_task_success,
        final_task_success: g.final_task_success, reference_match: g.reference_match,
        both_wrong: g.reference_task_success === false && g.routed_task_success === false,
        accepted_B: g.reference_task_success === true && g.final_task_success === false,
        accepted_C: g.reference_task_success === false && g.final_task_success === true,
        fallback: l.adoption_reason === 'routed_rejected_fallback',
        reference_preserved: l.choice === 'reference',
        reference_tokens_observed: usage[0], routed_tokens_observed: usage[1]});
    }
    yes(used.size === records.size, 'evidence_unassigned_outcome_record');
    const sum = split => {
      const rows = joined.filter(x => x.split === split);
      return {cases: rows.length, accepted_B: rows.filter(x => x.accepted_B).length,
        accepted_C: rows.filter(x => x.accepted_C).length, both_wrong: rows.filter(x => x.both_wrong).length,
        fallback_count: rows.filter(x => x.fallback).length,
        reference_preserved_count: rows.filter(x => x.reference_preserved).length,
        final_failures: rows.filter(x => x.final_task_success === false).length,
        unknown_labels: rows.filter(x => x.final_task_success === null || x.reference_match === null).length,
        unknown_resource_rows: rows.filter(x => x.reference_tokens_observed === null || x.routed_tokens_observed === null).length};
    };
    const counts = {development: sum('development'), calibration: sum('calibration'), heldout: sum('heldout')};
    if (overlap.length) faults.push('cross_split_lineage_overlap');
    if (card.rights.status !== 'cleared') faults.push('rights_not_cleared');
    if (card.lineage_audit.status !== 'disjoint_verified') faults.push('lineage_not_disjoint_verified');
    if (card.calibration.status !== 'externally_verified') faults.push('calibration_unmeasured');
    if (card.proof_mode !== 'candidate_goldblind') faults.push('development_proof_mode');
    if (counts.calibration.cases < card.thresholds.minimum_calibration_cases) faults.push('calibration_sample_insufficient');
    if (counts.heldout.cases < card.thresholds.minimum_heldout_cases) faults.push('heldout_sample_insufficient');
    if (counts.heldout.accepted_B > card.thresholds.maximum_accepted_B) faults.push('accepted_B_exceeds_floor');
    if (counts.heldout.final_failures > card.thresholds.maximum_task_failures) faults.push('heldout_task_failures');
    if (counts.heldout.unknown_labels || counts.calibration.unknown_labels) faults.push('labels_unknown');
    if (card.thresholds.require_complete_token_accounting &&
      (counts.calibration.unknown_resource_rows || counts.heldout.unknown_resource_rows)) faults.push('resource_accounting_incomplete');
    const blockers = reasons(faults), review = blockers.length === 0;
    return {schema: 1, status: review ? 'eligible_for_external_review' : 'ineligible',
      reason: review ? 'structural_precheck_only' : blockers[0], blockers,
      run_card_sha256: input.run_card_sha256, cases: joined, counts,
      calibration_review_eligible: review, promotion_review_eligible: review,
      calibration_validated: false, holdout_accepted: false, covered_live_authorized: false,
      quality_certificate: false, confidence_lower_bound: null, model_calls: 0,
      source_authenticity: 'requires_external_raw_source_review'};
  } catch (error) {
    return ineligible(/^evidence_[a-z0-9_]+$/.test(error?.code ?? '') ? error.code : 'evidence_input_or_outcome_invalid');
  }
}
