// Pure untrusted-proposal boundary. No provider, local model, Core submission,
// native process, authority registry, workspace mutation or filesystem probe.
import './local-model-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileLocalPlanProposal as compile, decodeLocalPlanProposal as decode,
  LocalPlanProposalError, LOCAL_PLAN_PROPOSAL_LIMITS} from '../../Resources/openclaw-os1-bridge/local-plan-proposal.mjs';
const sha = s => createHash('sha256').update(s).digest('hex');
const request = 'Using only the supplied source, preserve its conditions and produce the required result.';
function host() {
  return {binding: {task_id: 'task_1', request_sha256: sha(request), source_fingerprint: sha('source'),
    policy_sha256: sha('policy'), catalog_sha256: sha('catalog'), nonce: 'host_nonce_1'},
    request, objective: request, scope: 'read_only', allowed_owned_paths: [], requirement_ids: ['r1'],
    material_aliases: {m1: `os1-source:snapshot:12345678-1234-1234-1234-123456789012:${sha('source')}`},
    candidate_ids: ['cheap_c', 'reference_c'], check_ids: ['k1']};
}
function node(id = 'n1') {
  return {proposal_node_id: id, instruction: 'Read the assigned source and preserve its conditions.',
    requirement_refs: ['r1'], dependencies: [], material_refs: ['m1'], proposed_candidate_id: 'cheap_c',
    proposed_scope: 'read_only', proposed_owned_paths: [], required_output: 'The source-grounded result.',
    check_refs: ['k1'], reason_code: 'single_read'};
}
const proposal = () => ({schema: 2, kind: 'untrusted_local_plan_proposal', nodes: [node()],
  final_output_proposal: {mode: 'direct_child', node_ids: ['n1']}});
function run(p = proposal(), h = host(), expected = structuredClone(h.binding)) {
  return compile(JSON.stringify(p), h, expected);
}
function rejects(p, h = host(), code) {
  assert.throws(() => run(p, h), e => e instanceof LocalPlanProposalError && (code === undefined || e.code === code));
}
test('direct child compiles only fresh unbound agent fields and keeps original objective', () => {
  const h = host(), p = proposal(), result = run(p, h);
  assert.equal(result.provenance, 'host_unbound_plan');
  assert.deepEqual(result.plan, {schema: 1, task_id: h.binding.task_id, request_sha256: sha(request), nodes: [{
    id: 'node_0', instruction: p.nodes[0].instruction, dependencies: [], kind: 'agent', scope: 'read_only',
    owned_paths: [], context_refs: [h.material_aliases.m1]}], final_node_id: 'node_0'});
  assert.deepEqual(result.original_objective, {request, objective: request, request_sha256: sha(request)});
  assert.deepEqual(result.candidate_preferences, [{node_id: 'node_0', proposed_candidate_id: 'cheap_c'}]);
  assert.equal(result.execution_authorized, false); assert.equal(result.quality_parity_verified, false);
  assert.equal(result.coverage.status, 'interpretation_inferred');
  assert.equal(result.coverage.semantic_coverage_verified, false);
  assert.equal(result.plan.nodes.some(n => ['candidate_id', 'adapter_bound', 'route_class', 'selected_config'].some(k => Object.hasOwn(n, k))), false);
});
test('proposal IDs with dots/colons become native Core-safe host IDs', () => {
  const p = proposal(); p.nodes[0].proposal_node_id = 'design:one.v2';
  p.final_output_proposal.node_ids = ['design:one.v2'];
  assert.equal(run(p).plan.nodes[0].id, 'node_0');
});
test('integration node depends on and owns all nodes without inventing coverage proof', () => {
  const p = proposal(); p.nodes.push({...node('n2'), dependencies: ['n1']});
  p.final_output_proposal = {mode: 'integration_node', node_ids: ['n2']};
  const r = run(p); assert.equal(r.plan.final_node_id, 'node_1');
  assert.deepEqual(r.plan.nodes[1].dependencies, ['node_0']); assert.equal(r.coverage.semantic_coverage_verified, false);
});
test('all independent nodes in proposal order compile the complete collection, null final', () => {
  const p = proposal(); p.nodes.push(node('n2')); p.final_output_proposal = {mode: 'ordered_collection', node_ids: ['n1', 'n2']};
  const r = run(p); assert.equal(r.plan.final_node_id, null); assert.equal(r.plan.nodes.length, 2);
});
test('candidate hint null leaves host selection completely unbound', () => {
  const p = proposal(); p.nodes[0].proposed_candidate_id = null; const r = run(p);
  assert.equal(r.candidate_preferences[0].proposed_candidate_id, null);
  assert.equal(Object.hasOwn(r.plan.nodes[0], 'candidate_id'), false);
});
test('long actual typed source ID uses only host alias and exact selected subset', () => {
  const h = host(); h.material_aliases.m2 = '/an/owner/authorized/image.png';
  assert.ok(h.material_aliases.m1.length > 96);
  const r = run(proposal(), h); assert.deepEqual(r.plan.nodes[0].context_refs, [h.material_aliases.m1]);
  assert.equal(r.plan.nodes[0].context_refs.includes(h.material_aliases.m2), false);
});
test('Unicode exact request is hashed as UTF-8 without normalization', () => {
  const h = host(); h.request = '문서에 있는 조건을 그대로 보존해. 🧩'; h.objective = h.request;
  h.binding.request_sha256 = sha(h.request); assert.equal(run(proposal(), h).original_objective.request, h.request);
});
test('returned data is independent of caller mutation and deeply frozen', () => {
  const h = host(), p = proposal(), r = run(p, h); p.nodes[0].instruction = 'other'; h.material_aliases.m1 = 'other';
  assert.equal(r.plan.nodes[0].instruction, node().instruction); assert.notEqual(r.plan.nodes[0].context_refs[0], 'other');
  assert.throws(() => r.plan.nodes[0].context_refs.push('x'), TypeError);
});
test('concrete host-approved write remains a hint, never filesystem authorization', () => {
  const h = host(), p = proposal(); h.scope = 'workspace_write'; h.allowed_owned_paths = ['src/a.swift'];
  p.nodes[0].proposed_scope = 'workspace_write'; p.nodes[0].proposed_owned_paths = ['src/a.swift'];
  const r = run(p, h); assert.deepEqual(r.plan.nodes[0].owned_paths, ['src/a.swift']);
  assert.equal(r.execution_authorized, false);
});
test('overlapping writers require an explicit dependency, disjoint writers do not', () => {
  const h = host(), p = proposal(); h.scope = 'workspace_write'; h.allowed_owned_paths = ['src/a.swift', 'src/b.swift'];
  p.nodes = [node('n1'), node('n2')].map(n => ({...n, proposed_scope: 'workspace_write', proposed_owned_paths: ['src/a.swift']}));
  p.final_output_proposal = {mode: 'ordered_collection', node_ids: ['n1', 'n2']};
  rejects(p, h, 'unordered_writer_overlap'); p.nodes[1].proposed_owned_paths = ['src/b.swift']; assert.equal(run(p, h).plan.nodes.length, 2);
  p.nodes[1].proposed_owned_paths = ['src/a.swift']; p.nodes[1].dependencies = ['n1'];
  p.final_output_proposal = {mode: 'integration_node', node_ids: ['n2']}; assert.equal(run(p, h).plan.final_node_id, 'node_1');
});

const bad = [
  ['bound candidate_id even when cheap candidate exists', p => p.nodes[0].candidate_id = 'cheap_c'],
  ['adapter_bound marker', p => p.nodes[0].adapter_bound = true],
  ['selected_config authority', p => p.nodes[0].selected_config = {model: 'cheap'}],
  ['model route_class grade', p => p.nodes[0].route_class = 'trivial'],
  ['model deterministic kind', p => p.nodes[0].kind = 'deterministic'],
  ['top-level approval', p => p.approved = true],
  ['nested top-level authority', p => p.authority = {trusted: true, approved: true}],
  ['nested node authority', p => p.nodes[0].authority = {approved: true}],
  ['nested final authority', p => p.final_output_proposal.signature = {trusted: true}],
  ['raw host binding copied by model', p => p.binding = host().binding],
  ['extra exact_answer', p => p.nodes[0].exact_answer = '2'],
  ['wrong schema', p => p.schema = 1], ['wrong kind', p => p.kind = 'host_unbound_plan'],
  ['missing required nullable field', p => delete p.nodes[0].proposed_candidate_id],
  ['unknown candidate hint', p => p.nodes[0].proposed_candidate_id = 'nonexistent'],
  ['candidate nested approval object', p => p.nodes[0].proposed_candidate_id = {id: 'cheap_c', approved: true}],
  ['unknown requirement', p => p.nodes[0].requirement_refs = ['unknown']],
  ['empty requirement', p => p.nodes[0].requirement_refs = []],
  ['duplicate requirement', p => p.nodes[0].requirement_refs = ['r1', 'r1']],
  ['unknown material alias', p => p.nodes[0].material_refs = ['m2']],
  ['raw long source ID injection', p => p.nodes[0].material_refs = [host().material_aliases.m1]],
  ['unknown checker', p => p.nodes[0].check_refs = ['imagined']],
  ['source alias nested object', p => p.nodes[0].material_refs = [{id: 'm1', actual: '/secret'}]],
  ['readonly scope upgrade', p => { p.nodes[0].proposed_scope = 'workspace_write'; p.nodes[0].proposed_owned_paths = ['src/a.swift']; }],
  ['readonly write paths', p => p.nodes[0].proposed_owned_paths = ['src/a.swift']],
  ['empty plan', p => p.nodes = []],
  ['nine nodes', p => p.nodes = Array.from({length: 9}, (_, i) => node('n' + i))],
  ['duplicate node', p => p.nodes.push(node())],
  ['self dependency', p => p.nodes[0].dependencies = ['n1']],
  ['foreign dependency', p => p.nodes[0].dependencies = ['foreign']],
  ['dependency cycle', p => { p.nodes[0].dependencies = ['n2']; p.nodes.push({...node('n2'), dependencies: ['n1']}); }],
  ['orphan node', p => p.nodes.push(node('n2'))],
  ['unknown final', p => p.final_output_proposal.node_ids = ['foreign']],
  ['multiple direct final nodes', p => p.final_output_proposal.node_ids = ['n1', 'n2']],
  ['dependent collection', p => { p.nodes.push({...node('n2'), dependencies: ['n1']}); p.final_output_proposal = {mode: 'ordered_collection', node_ids: ['n1', 'n2']}; }],
  ['partial collection', p => { p.nodes.push(node('n2')); p.final_output_proposal = {mode: 'ordered_collection', node_ids: ['n1']}; }],
  ['reordered collection', p => { p.nodes.push(node('n2')); p.final_output_proposal = {mode: 'ordered_collection', node_ids: ['n2', 'n1']}; }],
  ['NUL instruction', p => p.nodes[0].instruction = 'a\0b'],
  ['blank instruction', p => p.nodes[0].instruction = '   '],
  ['oversize UTF8 instruction', p => p.nodes[0].instruction = '한'.repeat(4001)],
  ['unpaired surrogate', p => p.nodes[0].instruction = '\ud800'],
];
for (const [name, mutate] of bad) test('reject ' + name, () => { const p = proposal(); mutate(p); rejects(p); });
for (const path of ['/etc/passwd', '../escape', 'src/../escape', './x', 'src//x', 'src/', '~/.config',
  'C:/Windows/x', 'src\\x', '**', 'src/*', 'src/?', 'src/[a]', 'src/{a,b}', 'a\nb']) {
  test('reject path hint ' + JSON.stringify(path), () => {
    const p = proposal(), h = host(); h.scope = 'workspace_write'; h.allowed_owned_paths = ['src/a.swift'];
    p.nodes[0].proposed_scope = 'workspace_write'; p.nodes[0].proposed_owned_paths = [path]; rejects(p, h, 'path_hint_invalid');
  });
}
test('reject write path not in exact host allowlist', () => {
  const p = proposal(), h = host(); h.scope = 'workspace_write'; h.allowed_owned_paths = ['src/a.swift'];
  p.nodes[0].proposed_scope = 'workspace_write'; p.nodes[0].proposed_owned_paths = ['src/b.swift'];
  rejects(p, h, 'owned_path_not_host_allowed');
});
test('all requirements must map but full mapping is not semantic coverage', () => {
  const h = host(); h.requirement_ids.push('r2'); rejects(proposal(), h, 'requirement_unmapped');
  const p = proposal(); p.nodes[0].requirement_refs.push('r2'); assert.equal(run(p, h).coverage.semantic_coverage_verified, false);
});
for (const field of ['task_id', 'request_sha256', 'source_fingerprint', 'policy_sha256', 'catalog_sha256', 'nonce']) {
  test('reject stale/foreign host binding ' + field, () => {
    const h = host(), expected = structuredClone(h.binding); expected[field] = field.endsWith('id') || field === 'nonce' ? 'other' : sha('other');
    assert.throws(() => run(proposal(), h, expected), {code: 'host_binding_stale_or_mismatched'});
  });
}
test('reject wrong host request hash, aliases and claimed authority fields', () => {
  const h = host(); h.request += '!'; rejects(proposal(), h, 'host_original_request_invalid');
  const alias = host(); alias.material_aliases.m2 = alias.material_aliases.m1; rejects(proposal(), alias, 'host_material_aliases_invalid');
  const authority = host(); authority.approved = true; rejects(proposal(), authority, 'host_projection_invalid');
});
test('reject JSON duplicate keys, trailing text, fences, invalid number and trailing comma', () => {
  const raw = JSON.stringify(proposal());
  for (const s of [raw.replace('"schema":2', '"schema":1,"schema":2'), raw + ' comment', '```json\n' + raw + '\n```',
    raw.replace('"schema":2', '"schema":1e999'), raw.replace('"schema":2', '"schema":2,')]) assert.throws(() => decode(s), LocalPlanProposalError);
});
test('reject excessive bytes/depth and non-JSON model objects without accepting getters', () => {
  assert.throws(() => decode(' '.repeat(LOCAL_PLAN_PROPOSAL_LIMITS.bytes + 1)), {code: 'proposal_bytes'});
  assert.throws(() => decode('['.repeat(14) + '0' + ']'.repeat(14)), {code: 'proposal_depth'});
  let read = false; const x = {get schema() { read = true; return 2; }};
  assert.throws(() => decode(x), {code: 'proposal_bytes'}); assert.equal(read, false);
});
test('raw dangerous words in instructions stay text, not extra authority fields', () => {
  const p = proposal(); p.nodes[0].instruction = 'Report the literal words candidate_id, approved, deterministic without executing.';
  const r = run(p); assert.equal(r.plan.nodes[0].kind, 'agent'); assert.equal(Object.hasOwn(r.plan.nodes[0], 'candidate_id'), false);
});
test('decode is shape-only and cannot promote a foreign known-looking alias', () => {
  const p = proposal(); p.nodes[0].material_refs = ['foreign_but_well_formed'];
  assert.equal(decode(JSON.stringify(p)).kind, 'untrusted_local_plan_proposal');
  rejects(p, host(), 'unknown_material_alias');
});

test('optional host-finalizer tuple hint remains separate untrusted data; legacy shape unchanged', () => {
  const legacy = run(); assert.equal(Object.hasOwn(legacy, 'host_finalizer_preference'), false);
  const p = proposal(); p.final_output_proposal.host_finalizer_candidate_id = 'reference_c';
  const compiled = run(p);
  assert.deepEqual(compiled.host_finalizer_preference, {proposed_candidate_id:'reference_c'});
  assert.equal(compiled.plan.nodes.length, 1); assert.equal(compiled.plan.nodes[0].scope, 'read_only');
  assert.equal(Object.hasOwn(compiled.plan.nodes[0], 'candidate_id'), false); assert.equal(compiled.execution_authorized, false);
  p.final_output_proposal.host_finalizer_candidate_id = null;
  assert.deepEqual(run(p).host_finalizer_preference, {proposed_candidate_id:null});
});
for (const hint of [false, 1, {}, [], 'with spaces', ''])
  test('reject invalid optional host-finalizer hint ' + JSON.stringify(hint), () => {
    const p = proposal(); p.final_output_proposal.host_finalizer_candidate_id = hint; rejects(p);
  });
test('finalizer ID must exist in exact host candidate set even before Core checks writer eligibility', () => {
  const p = proposal(); p.final_output_proposal.host_finalizer_candidate_id = 'unknown-writer';
  rejects(p, host(), 'unknown_host_finalizer_candidate');
});
