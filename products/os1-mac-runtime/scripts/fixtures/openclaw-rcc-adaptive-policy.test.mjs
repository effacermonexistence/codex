import './local-model-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeAdaptiveRoutingPolicy, adaptivePolicyDisposition} from '../../Resources/openclaw-os1-bridge/adaptive-routing-policy.mjs';
const H = c => c.repeat(64);
const config = (patch = {}) => ({schema: 1, mode: 'shadow', policy_id: 'policy-v1', version: '1',
  rcc_source_sha256: H('a'), projection_sha256: H('b'), reference_policy_sha256: H('c'),
  allowed_workload_classes: ['text-operation'], max_nodes: 4, max_parallel: 2,
  max_plan_revisions: 1, max_planner_calls: 2, planner_input_bytes: 64000,
  planner_output_tokens: 2048, requires_live_reference_fallback: true,
  adoption_manifest_sha256: null, ...patch});
const host = () => ({rcc_source_sha256: H('a'), projection_sha256: H('b'),
  reference_policy_sha256: H('c'), workload_class: 'text-operation'});
test('absence/null/off is inert and does not require host or invoke anything', () => {
  for (const x of [undefined, null, {schema: 1, mode: 'off'}]) {
    assert.deepEqual(decodeAdaptiveRoutingPolicy(x), {schema: 1, mode: 'off'});
    const r = adaptivePolicyDisposition(x); assert.equal(r.mode, 'off');
    assert.equal(r.plan_proposals_enabled, false); assert.equal(r.execution_authorized, false);
  }
});
test('shadow observes only, defensive copies and freezes policy arrays', () => {
  const raw = config(); const p = decodeAdaptiveRoutingPolicy(raw); raw.allowed_workload_classes.push('foreign');
  assert.deepEqual(p.allowed_workload_classes, ['text-operation']); assert(Object.isFrozen(p.allowed_workload_classes));
  const r = adaptivePolicyDisposition(p, host()); assert.equal(r.reason, 'shadow_observation_only');
  assert.equal(r.plan_proposals_enabled, true); assert.equal(r.live_route_changes_enabled, false);
  assert.equal(r.quality_certificate, false); assert.equal(r.predictor_measured, false);
});
for (const field of ['rcc_source_sha256', 'projection_sha256', 'reference_policy_sha256'])
  test(`stale or mismatched ${field} enables nothing`, () => {
    const r = adaptivePolicyDisposition(config(), {...host(), [field]: H('d')});
    assert.equal(r.plan_proposals_enabled, false); assert.equal(r.execution_authorized, false);
  });
test('uncovered family cannot silently inherit another family policy', () => {
  assert.equal(adaptivePolicyDisposition(config(), {...host(), workload_class: 'unknown-family'}).reason,
    'adaptive_workload_not_covered');
});
test('self-asserted covered_live descriptor cannot become authorization', () => {
  const r = adaptivePolicyDisposition(config({mode: 'covered_live', adoption_manifest_sha256: H('e')}), host());
  assert.equal(r.reason, 'host_artifact_and_existing_admission_required');
  assert.equal(r.live_route_changes_enabled, false); assert.equal(r.execution_authorized, false);
});
test('shadow may observe with explicitly unknown reference, never a fabricated descriptor', () => {
  const r = adaptivePolicyDisposition(config({reference_policy_sha256: null}),
    {...host(), reference_policy_sha256: null});
  assert.equal(r.plan_proposals_enabled, true);
  assert.equal(r.live_route_changes_enabled, false);
  assert.equal(r.quality_certificate, false);
  assert.throws(() => decodeAdaptiveRoutingPolicy(config({mode: 'covered_live',
    reference_policy_sha256: null, adoption_manifest_sha256: H('e')})));
});
for (const patch of [
  {schema: 2}, {mode: 'auto'}, {max_nodes: 9}, {max_parallel: 5}, {max_parallel: 4, max_nodes: 2},
  {max_plan_revisions: 2}, {max_planner_calls: 3}, {max_plan_revisions: 0, max_planner_calls: 2},
  {planner_input_bytes: 240001}, {planner_output_tokens: 255}, {planner_output_tokens: 4097},
  {requires_live_reference_fallback: false}, {requires_live_reference_fallback: null},
  {mode: 'covered_live'}, {mode: 'covered_live', allowed_workload_classes: [], adoption_manifest_sha256: H('e')},
  {allowed_workload_classes: ['text-operation', 'text-operation']}, {projection_sha256: 'unknown'},
  {adoption_manifest_sha256: '.99'}, {selected_config: {effort: 'low'}}, {quality_certificate: true},
]) test(`reject invalid policy ${JSON.stringify(patch)}`, () => assert.throws(() => decodeAdaptiveRoutingPolicy(config(patch))));
test('off is not a hiding place for extra instructions or authority fields', () => {
  assert.throws(() => decodeAdaptiveRoutingPolicy({schema: 1, mode: 'off', max_nodes: 8}));
  assert.throws(() => decodeAdaptiveRoutingPolicy({schema: 1, mode: 'off', __proto__: {granted: true}}));
});
test('sparse workload arrays do not acquire undefined authority through Array.every', () => {
  assert.throws(() => decodeAdaptiveRoutingPolicy(config({allowed_workload_classes: Array(1)})));
});
