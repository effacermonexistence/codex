/** P7 finite DEVELOPMENT table lookup, not a trained/calibrated live router.
 * Pure after explicit host loading. Missing metadata is a result, not a probe.
 * A branded inference receipt proves this function ran, NOT scientific validity.
 */
import {isFrozenRouteArtifacts, frozenRouteData, FROZEN_ROUTE_FORMAT,
  FROZEN_ROUTE_FEATURE_SCHEMA, FROZEN_ROUTE_LIMITS} from './frozen-route-artifacts.mjs';
import {digest, exactConfigFingerprint, candidatePoolFingerprint, RESOURCE_COMPONENTS,
  selectJointRoute} from './joint-route-selector.mjs';
const executions = new WeakSet(), predictors = new WeakSet(), HASH = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const hash = v => typeof v === 'string' && HASH.test(v);
const count = v => Number.isSafeInteger(v) && v >= 0;
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => plain(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const need = (v, code) => {if (!v) throw Object.assign(new Error(code), {code});};
const freeze = x => {if (x && typeof x === 'object') {for (const v of Object.values(x)) freeze(v); Object.freeze(x);} return x;};
const BASE_BINDINGS = ['rcc_source_sha256', 'harness_sha256', 'native_binary_sha256',
  'native_instructions_sha256', 'coverage_discriminator_sha256'];
const INPUT_KEYS = ['schema', 'now_ms', 'task', 'candidates', 'selection_policy', 'quality_reference',
  'execution_fallback', 'calibration', 'forecasts', 'host_evidence'];
const TASK_KEYS = ['id', 'node_id', 'request_sha256', 'source_snapshot_sha256', 'feature_sha256', 'policy_sha256',
  'plan_sha256', 'environment_sha256', 'instructions_sha256', 'verifier_sha256', 'feature_schema_version',
  'workload_class', 'scope', 'required_tools', 'allowed_tools', 'allowed_paths', 'required_capabilities', 'allowed_transports', 'context_tokens'];
const known = (x, required, optional = []) => plain(x) && required.every(k => Object.hasOwn(x, k)) &&
  Object.keys(x).every(k => [...required, ...optional].includes(k));

/** The host must supply this projection; this module never reads source bodies
 * or invents semantic family/capability/context/quota evidence from a class name.
 * Constraints are recomputed from the CURRENT selector task, not artifact text.
 */
export function frozenRouteFeatureBucket(features, task) {
  features = frozenRouteData(features); task = frozenRouteData(task);
  need(exact(features, ['schema', 'version', 'semantic_family_id', 'context_tokens', 'material_count',
    'requirement_count', 'dependency_count', 'source_state', 'constraints_sha256']) && features.schema === 1 &&
    features.version === FROZEN_ROUTE_FEATURE_SCHEMA && ID.test(features.semantic_family_id ?? '') &&
    ['context_tokens', 'material_count', 'requirement_count', 'dependency_count'].every(k => count(features[k]) && features[k] <= 1e7) &&
    ['none', 'provided', 'unknown'].includes(features.source_state) && hash(features.constraints_sha256), 'fr_feature_projection_invalid');
  const constraints = {scope: task.scope, required_tools: task.required_tools, allowed_tools: task.allowed_tools,
    allowed_paths: task.allowed_paths, required_capabilities: task.required_capabilities,
    allowed_transports: task.allowed_transports, owner_constraints: task.owner_constraints ?? null};
  need(features.context_tokens === task.context_tokens && features.constraints_sha256 === digest(constraints), 'fr_feature_constraints_changed');
  return digest(features);
}

export function isFrozenRouteInference(value) {return executions.has(value);}
export function isFrozenRoutePredictor(value) {return predictors.has(value);}

/** API:
 * infer({selector_input: <trusted COMPLETE current selector input>,
 *        current_bindings: <five exact current host hashes>, features}).
 * Native catalog ctx alone is NOT complete selector evidence. Missing capacity,
 * harness or features returns unmeasured without I/O, inference or defaults.
 */
export function createFrozenRoutePredictor(options = {}) {
  const descriptor = plain(options) ? Object.getOwnPropertyDescriptor(options, 'artifacts') : null;
  const artifacts = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
  const registered = isFrozenRouteArtifacts(artifacts);
  const infer = function (request = {}) {
    let performed = false, input = null, bucket = null, selector = null;
    const finish = (status, reason, predictions = []) => {
      const base = {schema: 1, status, reason, artifact_loaded: registered,
        artifact_manifest_sha256: registered ? artifacts.manifest_sha256 : null,
        proof_mode: registered ? artifacts.manifest.proof_mode : null,
        predictor_inference_observed: performed, selector_predictor_executed: false,
        calibration: null, forecasts: null, host_evidence: null, predictions,
        selector_result: selector, execution_authorized: false, live_route_change_authorized: false,
        quality_certificate: false, calibration_validated: false, holdout_accepted: false,
        rights_independently_verified: false, split_disjoint_verified: false,
        decision: 'preserve_original_host_route', model_calls: 0, cpu_duration_ms: null,
        resource_measurement: 'CPU_NOT_MEASURED_NOT_ZERO', inference_receipt: null};
      if (performed) {
        const m = artifacts.manifest;
        const receipt = {schema: 1, algorithm: FROZEN_ROUTE_FORMAT, inference_observed: true,
          manifest_sha256: artifacts.manifest_sha256, predictor_module_sha256: m.runtime.predictor_sha256,
          declared_dataset_manifest_sha256: artifacts.lineage.dataset_sha256, task_sha256: digest(input.task),
          task_id: input.task.id, node_id: input.task.node_id, request_sha256: input.task.request_sha256,
          source_snapshot_sha256: input.task.source_snapshot_sha256, feature_sha256: input.task.feature_sha256,
          feature_bucket_sha256: bucket, policy_sha256: input.task.policy_sha256, plan_sha256: input.task.plan_sha256,
          environment_sha256: input.task.environment_sha256, projection_instructions_sha256: input.task.instructions_sha256,
          verifier_sha256: input.task.verifier_sha256, native_harness_sha256: m.bindings.harness_sha256,
          native_binary_sha256: m.bindings.native_binary_sha256, native_instructions_sha256: m.bindings.native_instructions_sha256,
          reference_descriptor_sha256: digest(input.quality_reference), candidate_pool_sha256: candidatePoolFingerprint(input.candidates),
          predictions_sha256: digest(predictions), observed_at_ms: input.now_ms, artifact_valid_until_ms: m.valid_until_ms,
          proof_mode: m.proof_mode, declared_rights_status: m.rights.status,
          source_records_independently_verified: false,
          calibration_validated: false, holdout_accepted: false, model_calls: 0};
        base.inference_receipt = {...receipt, receipt_sha256: digest(receipt)};
      }
      const result = freeze(base); if (performed) executions.add(result); return result;
    };
    if (!registered) return finish('not_registered', 'host_artifacts_not_registered');
    try {
      request = frozenRouteData(request);
      need(exact(request, ['selector_input', 'current_bindings', 'features']), 'fr_host_request_shape');
      input = request.selector_input;
      const current_bindings = request.current_bindings, features = request.features;
      need(exact(input, INPUT_KEYS) && input.schema === 1 && count(input.now_ms) &&
        input.calibration === null && input.forecasts === null && input.host_evidence === null,
        'fr_prepared_selector_input_missing_or_not_development');
      need(known(input.task, TASK_KEYS, ['owner_constraints', 'samples']), 'fr_preoutcome_task_shape');
      need(exact(current_bindings, BASE_BINDINGS) && BASE_BINDINGS.every(k => hash(current_bindings[k])), 'fr_current_host_bindings_missing');
      const m = artifacts.manifest, b = m.bindings;
      need(m.issued_at_ms <= input.now_ms && input.now_ms < m.valid_until_ms, 'fr_artifact_stale_or_future');
      need(BASE_BINDINGS.every(k => current_bindings[k] === b[k]) &&
        input.task?.policy_sha256 === b.policy_sha256 && input.task.environment_sha256 === b.environment_sha256 &&
        input.task.verifier_sha256 === b.verifier_sha256 && input.task.scope === b.scope &&
        input.task.feature_schema_version === m.feature_schema_version && b.workload_classes.includes(input.task.workload_class),
        'fr_current_regime_changed');
      need(Array.isArray(input.candidates) && input.candidates.length > 0 && input.candidates.length <= FROZEN_ROUTE_LIMITS.configurations,
        'fr_candidate_bound');
      for (const c of input.candidates) {
        need(known(c, ['id', 'config'], ['capabilities', 'availability', 'quota']), 'fr_preoutcome_candidate_shape');
        for (const [key, fields] of [['capabilities', ['supported', 'config_sha256', 'features', 'max_context_tokens', 'observed_at_ms', 'valid_until_ms']],
          ['availability', ['state', 'account_id', 'config_sha256', 'observation_sha256', 'observed_at_ms', 'valid_until_ms']],
          ['quota', ['state', 'account_id', 'quota_pool', 'observation_sha256', 'observed_at_ms', 'valid_until_ms']]])
          need(c[key] == null || exact(c[key], fields), 'fr_preoutcome_observation_shape');
      }
      // One binary/full-instruction witness cannot cover two providers/accounts.
      // Future cross-provider tables require per-config native harness maps.
      need(new Set(input.candidates.map(c => digest(Object.fromEntries(
        ['surface', 'transport', 'account_id', 'quota_pool'].map(k => [k, c.config?.[k]]))))).size === 1,
        'fr_multiple_native_cohorts_unsupported');
      const configHashes = input.candidates.map(c => exactConfigFingerprint(c.config)).sort();
      need(digest(configHashes) === digest([...b.config_sha256s].sort()) &&
        candidatePoolFingerprint(input.candidates) === b.candidate_pool_sha256 &&
        digest(input.quality_reference) === b.reference_descriptor_sha256 &&
        input.quality_reference.harness_sha256 === b.harness_sha256, 'fr_current_config_reference_or_harness_changed');
      // Reuse existing hard eligibility rules; NEVER fill its absent native
      // capacity/availability/quota observations with invented values.
      selector = selectJointRoute(input);
      need(selector.decision === 'preserve_reference' && selector.reason === 'calibration_missing_or_unmeasured', 'fr_host_selector_preconditions_missing');
      bucket = frozenRouteFeatureBucket(features, input.task);
      need(input.task.feature_sha256 === bucket, 'fr_current_feature_hash_changed');
      if (!artifacts.table.cells.length) return finish('unmeasured', 'frozen_table_empty');
      performed = true;
      const rejected = new Map(selector.rejected.map(x => [x.candidate_id, x.reasons]));
      const rows = input.candidates.map(candidate => {
        const configSHA = exactConfigFingerprint(candidate.config), cell = artifacts.table.cells.find(c =>
          c.feature_bucket_sha256 === bucket && c.config_sha256 === configSHA);
        const row = {candidate_id: candidate.id, config_sha256: configSHA, status: 'uncovered', reason: null,
          observations: 0, reference_match_fraction: null, task_success_fraction: null, predicted_lower_bound: null,
          coverage: 'NOT_SCIENTIFICALLY_VALIDATED', resource_mean_components: null, resource_mean_total: null,
          resource_unit: 'development_same_harness_observed_tokens_not_quota_or_dollars', origins: [],
          calibration_validated: false, execution_authorized: false};
        if (rejected.has(candidate.id)) return {...row, reason: 'current_candidate_ineligible'};
        if (features.source_state === 'unknown') return {...row, reason: 'source_state_unknown'};
        if (!cell) return {...row, reason: 'feature_or_config_out_of_table'};
        const samples = cell.sample_ids.map(id => artifacts.lineage.samples.find(s => s.id === id));
        row.observations = samples.length; row.origins = [...new Set(samples.map(s => s.origin))].sort();
        if (m.rights.status !== 'cleared') return {...row, reason: 'declared_rights_not_cleared'};
        if (samples.length < m.minimum_samples) return {...row, reason: 'development_sample_count_insufficient'};
        if (samples.some(s => s.origin === 'unknown')) return {...row, reason: 'sample_origin_unknown'};
        if (samples.some(s => s.reference_match === null || s.task_success === null)) return {...row, reason: 'development_labels_incomplete'};
        // These are empirical fractions over DECLARED development rows, not
        // calibrated probabilities/confidence/holdout acceptance. Both wrong
        // can have reference_match1 and task_success0; never merge the labels.
        row.reference_match_fraction = samples.filter(s => s.reference_match).length / samples.length;
        row.task_success_fraction = samples.filter(s => s.task_success).length / samples.length;
        if (samples.some(s => s.resource === null || RESOURCE_COMPONENTS.some(k => s.resource.components[k] === null)))
          return {...row, reason: 'development_resource_components_unknown'};
        row.resource_mean_components = Object.fromEntries(RESOURCE_COMPONENTS.map(k =>
          [k, samples.reduce((sum, s) => sum + s.resource.components[k], 0) / samples.length]));
        row.resource_mean_total = Object.values(row.resource_mean_components).reduce((a, b) => a + b, 0);
        return {...row, status: 'development_observation', reason: 'finite_development_table_lookup_not_calibration'};
      });
      return finish(rows.some(r => r.status === 'development_observation') ? 'development_prediction' : 'uncovered',
        'development_only_original_route_preserved', rows);
    } catch (error) {
      // Never translate optional evidence failure into task failure or an
      // alternate backend. An invalid input cannot obtain an inference receipt.
      performed = false; selector = null;
      return finish('unmeasured', /^fr_[a-z0-9_]+$/.test(error?.code ?? '') ? error.code : 'fr_host_input_invalid');
    }
  };
  predictors.add(infer); return Object.freeze(infer);
}
