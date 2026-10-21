import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPlannerHostProjection, compileFreshPlannerProposal} from '../../Resources/openclaw-os1-bridge/adaptive-plan-host.mjs';
const H = x => createHash('sha256').update(x).digest('hex');
const request = 'Read the original document and preserve every condition.';
function input() {
  return {task: {task_id: 't_1', mode: 'auto', request, objective: request,
    request_sha256: H(request), source_fingerprint: H('source'), policy_sha256: H('policy'),
    material_refs: [`os1-source:snapshot:12345678-1234-1234-1234-123456789abc:${H('source')}`]},
    catalog: {task_id: 't_1', request_sha256: H(request), candidates: [{id: 'cfg_reference'}]},
    scope: 'read_only', nonce: 'host_nonce'};
}
function raw() {
  return JSON.stringify({schema: 2, kind: 'untrusted_local_plan_proposal', nodes: [{
    proposal_node_id: 'n', instruction: 'Read the source and return its conditional result.',
    requirement_refs: ['owner_objective'], dependencies: [], material_refs: ['material_0'],
    proposed_candidate_id: 'cfg_reference', proposed_scope: 'read_only', proposed_owned_paths: [],
    required_output: 'Source-grounded answer', check_refs: [], reason_code: 'read_source',
  }], final_output_proposal: {mode: 'direct_child', node_ids: ['n']}});
}
test('host projects exact owner and source aliases without pretending source data was read', () => {
  const x = input(), p = createPlannerHostProjection(x);
  assert.equal(p.hostProjection.request, request);
  assert.equal(p.hostProjection.material_aliases.material_0, x.task.material_refs[0]);
  assert.equal(p.projection.materials[0].read_status, 'not_read');
  assert.equal(p.projection.requirements[0].status, 'interpreted');
  assert.equal(p.execution_authorized, false); assert(Object.isFrozen(p.hostProjection));
});
test('fresh compilation is unbound and routes no provider by itself', () => {
  const p = createPlannerHostProjection(input()), c = compileFreshPlannerProposal(raw(), p, p, {max_nodes: 1});
  assert.equal(c.plan.final_node_id, 'node_0');
  assert.equal(Object.hasOwn(c.plan.nodes[0], 'candidate_id'), false);
  assert.equal(c.execution_authorized, false);
});
for (const key of ['policy_sha256', 'source_fingerprint', 'request_sha256']) test(`stale ${key} cannot inherit support`, () => {
  const a = input(), p = createPlannerHostProjection(a), b = input(); b.task[key] = H('changed');
  if (key === 'request_sha256') assert.throws(() => createPlannerHostProjection(b));
  else assert.throws(() => compileFreshPlannerProposal(raw(), p, createPlannerHostProjection(b), {max_nodes: 8}));
});
test('catalog changes, nonce changes and objective changes invalidate awaited proposal', () => {
  const p = createPlannerHostProjection(input());
  for (const change of [x => x.catalog.candidates.push({id: 'cfg_other'}),
    x => x.nonce = 'different_nonce', x => x.task.objective = 'Different objective']) {
    const x = input(); change(x);
    assert.throws(() => compileFreshPlannerProposal(raw(), p, createPlannerHostProjection(x), {max_nodes: 8}));
  }
});
test('new planner does not widen writer scope or reinterpret explicit routing tests', () => {
  for (const change of [x => x.scope = 'workspace_write', x => x.task.mode = 'explicit_routing_test',
    x => x.task.material_refs.push(x.task.material_refs[0]), x => x.catalog.task_id = 'foreign']) {
    const x = input(); change(x); assert.throws(() => createPlannerHostProjection(x));
  }
});
test('a model cannot smuggle trusted binding through an extra field', () => {
  const p = createPlannerHostProjection(input()), x = JSON.parse(raw()); x.nodes[0].candidate_id = 'cfg_reference';
  assert.throws(() => compileFreshPlannerProposal(JSON.stringify(x), p, p, {max_nodes: 8}));
});
