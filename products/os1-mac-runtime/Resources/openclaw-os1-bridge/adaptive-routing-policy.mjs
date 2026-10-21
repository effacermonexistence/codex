// Typed feature policy. This module does not load artifacts, invoke a model,
// certify quality, reserve a pool, or authorize a native execution.
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/;
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
const fail = code => { throw Object.assign(new Error(code), {code}); };
const need = (ok, code) => { if (!ok) fail(code); };
const exact = (x, keys) => plain(x) && Object.keys(x).length === keys.length &&
  keys.every(k => Object.hasOwn(x, k));
const hash = x => typeof x === 'string' && HASH.test(x);
const id = x => typeof x === 'string' && ID.test(x);
const int = (x, lo, hi) => Number.isSafeInteger(x) && x >= lo && x <= hi;
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const ACTIVE_KEYS = ['schema', 'mode', 'policy_id', 'version', 'rcc_source_sha256',
  'projection_sha256', 'reference_policy_sha256', 'allowed_workload_classes',
  'max_nodes', 'max_parallel', 'max_plan_revisions', 'max_planner_calls',
  'planner_input_bytes', 'planner_output_tokens', 'requires_live_reference_fallback',
  'adoption_manifest_sha256'];

/** Missing policy is OFF. Enabling a mode is not a quality/admission grant. */
export function decodeAdaptiveRoutingPolicy(raw) {
  if (raw === undefined || raw === null) return freeze({schema: 1, mode: 'off'});
  need(plain(raw) && raw.schema === 1, 'adaptive_policy_schema');
  if (raw.mode === 'off') {
    need(exact(raw, ['schema', 'mode']), 'adaptive_off_policy_keys');
    return freeze({schema: 1, mode: 'off'});
  }
  need(exact(raw, ACTIVE_KEYS) && ['shadow', 'covered_live'].includes(raw.mode),
    'adaptive_active_policy_keys');
  need(id(raw.policy_id) && typeof raw.version === 'string' &&
    raw.version.length > 0 && raw.version.length <= 64 && !raw.version.includes('\0'),
    'adaptive_policy_identity');
  need(['rcc_source_sha256', 'projection_sha256'].every(k => hash(raw[k])) &&
    (hash(raw.reference_policy_sha256) || raw.mode === 'shadow' && raw.reference_policy_sha256 === null),
    'adaptive_policy_source_hash');
  need(Array.isArray(raw.allowed_workload_classes) && raw.allowed_workload_classes.length <= 128 &&
    Array.from({length: raw.allowed_workload_classes.length}, (_, i) =>
      Object.hasOwn(raw.allowed_workload_classes, i)).every(Boolean) &&
    raw.allowed_workload_classes.every(id) &&
    new Set(raw.allowed_workload_classes).size === raw.allowed_workload_classes.length,
    'adaptive_policy_workloads');
  need(int(raw.max_nodes, 1, 8) && int(raw.max_parallel, 1, 4) &&
    raw.max_parallel <= raw.max_nodes && int(raw.max_plan_revisions, 0, 1) &&
    int(raw.max_planner_calls, 1, 2) && raw.max_planner_calls <= 1 + raw.max_plan_revisions &&
    int(raw.planner_input_bytes, 1, 240_000) && int(raw.planner_output_tokens, 256, 4096),
    'adaptive_policy_bounds');
  // Version one deliberately retains the existing live-reference requirement.
  // A future read-only exception requires a separately reviewed policy version.
  need(raw.requires_live_reference_fallback === true, 'adaptive_live_reference_required');
  need(raw.adoption_manifest_sha256 === null || hash(raw.adoption_manifest_sha256),
    'adaptive_adoption_manifest_hash');
  need(raw.mode !== 'covered_live' || (hash(raw.adoption_manifest_sha256) &&
    raw.allowed_workload_classes.length > 0), 'adaptive_live_adoption_descriptor_missing');
  return freeze({...raw, allowed_workload_classes: [...raw.allowed_workload_classes]});
}

/** Host observation only. Even covered_live needs actual artifact validation,
 * existing per-node admission and native authorization at the executed path. */
export function adaptivePolicyDisposition(raw, host) {
  const policy = decodeAdaptiveRoutingPolicy(raw);
  const result = {schema: 1, mode: policy.mode, plan_proposals_enabled: false,
    live_route_changes_enabled: false, execution_authorized: false,
    quality_certificate: false, predictor_measured: false, reason: 'adaptive_policy_off'};
  if (policy.mode === 'off') return freeze(result);
  need(plain(host) && hash(host.rcc_source_sha256) && hash(host.projection_sha256) &&
    (hash(host.reference_policy_sha256) || policy.mode === 'shadow' && host.reference_policy_sha256 === null) &&
    id(host.workload_class), 'adaptive_host_binding');
  if (policy.rcc_source_sha256 !== host.rcc_source_sha256 ||
      policy.projection_sha256 !== host.projection_sha256 ||
      policy.reference_policy_sha256 !== host.reference_policy_sha256)
    return freeze({...result, reason: 'adaptive_source_or_reference_mismatch'});
  if (!policy.allowed_workload_classes.includes(host.workload_class))
    return freeze({...result, reason: 'adaptive_workload_not_covered'});
  if (policy.mode === 'shadow') return freeze({...result,
    plan_proposals_enabled: true, reason: 'shadow_observation_only'});
  // A hash-shaped model assertion is not an artifact read/validation receipt.
  // This pure contract intentionally cannot activate covered_live by itself.
  return freeze({...result, reason: 'host_artifact_and_existing_admission_required'});
}
