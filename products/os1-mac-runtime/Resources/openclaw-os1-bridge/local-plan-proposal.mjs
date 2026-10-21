import {createHash} from 'node:crypto';

// P1 only: pure decoding/compilation, NOT a route, permission, quality or
// execution gate. Only Core-owned code may supply host/expectedBinding. A
// matching caller-authored hash or boolean cannot turn model output into an
// authority. Native admission must still recheck filesystem/capability facts.
export const LOCAL_PLAN_PROPOSAL_LIMITS = Object.freeze({bytes: 262144, nodes: 8, depth: 12});
const PID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/;
const CORE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const SCOPE = new Set(['read_only', 'workspace_write']);
const NODE_KEYS = ['proposal_node_id', 'instruction', 'requirement_refs', 'dependencies',
  'material_refs', 'proposed_candidate_id', 'proposed_scope', 'proposed_owned_paths',
  'required_output', 'check_refs', 'reason_code'];
const BINDING_KEYS = ['task_id', 'request_sha256', 'source_fingerprint', 'policy_sha256', 'catalog_sha256', 'nonce'];
const HOST_KEYS = ['binding', 'request', 'objective', 'scope', 'allowed_owned_paths',
  'requirement_ids', 'material_aliases', 'candidate_ids', 'check_ids'];
const own = (x, key) => Object.hasOwn(x, key);
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
const exact = (x, keys) => plain(x) && Object.keys(x).length === keys.length &&
  keys.every(k => own(x, k)) && Object.keys(x).every(k => keys.includes(k));
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const text = (x, bytes) => typeof x === 'string' && x.trim().length > 0 &&
  !/[\u0000\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(x) &&
  !x.includes('\0') && Buffer.byteLength(x, 'utf8') <= bytes;
const ids = (x, limit = 128, re = PID) => Array.isArray(x) && x.length <= limit &&
  new Set(x).size === x.length && x.every(s => typeof s === 'string' && re.test(s));
const pathHint = x => text(x, 1024) && !/[\x00-\x1f\x7f\\:*?\[\]{}]/u.test(x) &&
  !x.startsWith('/') && !x.startsWith('~') &&
  x.split('/').every(p => p !== '' && p !== '.' && p !== '..');
function need(ok, code) { if (!ok) throw new LocalPlanProposalError(code); }
export class LocalPlanProposalError extends Error {
  constructor(code) { super(code); this.name = 'LocalPlanProposalError'; this.code = code; }
}
function freeze(x) {
  if (x && typeof x === 'object') { for (const value of Object.values(x)) freeze(value); Object.freeze(x); }
  return x;
}

// A JSON-only parser with depth/duplicate-key checks. JSON.parse alone silently
// overwrites duplicate keys. Never accept fences, commentary or a JS object
// with accessors/prototypes as a model reply.
function parse(raw) {
  need(typeof raw === 'string' && raw.length > 0 && Buffer.byteLength(raw) <= LOCAL_PLAN_PROPOSAL_LIMITS.bytes,
    'proposal_bytes');
  let at = 0;
  const ws = () => { while (at < raw.length && /[\t\n\r ]/.test(raw[at])) at++; };
  function string() {
    const start = at++;
    while (at < raw.length) {
      const ch = raw[at++];
      if (ch === '\\') { at++; continue; }
      if (ch === '"') { try { return JSON.parse(raw.slice(start, at)); } catch { break; } }
    }
    throw new LocalPlanProposalError('proposal_json');
  }
  function value(depth) {
    need(depth <= LOCAL_PLAN_PROPOSAL_LIMITS.depth, 'proposal_depth'); ws();
    const ch = raw[at];
    if (ch === '"') return string();
    if (ch === '{') {
      at++; ws(); const result = Object.create(null), keys = new Set();
      if (raw[at] === '}') { at++; return result; }
      while (at < raw.length) {
        ws(); need(raw[at] === '"', 'proposal_json'); const key = string();
        need(!keys.has(key), 'proposal_duplicate_key'); keys.add(key);
        ws(); need(raw[at++] === ':', 'proposal_json'); result[key] = value(depth + 1); ws();
        const end = raw[at++]; if (end === '}') return result; need(end === ',', 'proposal_json');
      }
    } else if (ch === '[') {
      at++; ws(); const result = []; if (raw[at] === ']') { at++; return result; }
      while (at < raw.length) {
        result.push(value(depth + 1)); ws(); const end = raw[at++];
        if (end === ']') return result; need(end === ',', 'proposal_json');
      }
    } else {
      const token = raw.slice(at).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
      need(token, 'proposal_json'); at += token.length;
      const result = JSON.parse(token); need(typeof result !== 'number' || Number.isFinite(result), 'proposal_json');
      return result;
    }
    throw new LocalPlanProposalError('proposal_json');
  }
  const result = value(0); ws(); need(at === raw.length, 'proposal_json'); return result;
}

/** Decode strict v2 data. All references remain UNTRUSTED until host matching. */
export function decodeLocalPlanProposal(raw) {
  const p = parse(raw);
  need(exact(p, ['schema', 'kind', 'nodes', 'final_output_proposal']) && p.schema === 2 &&
    p.kind === 'untrusted_local_plan_proposal', 'proposal_shape');
  need(Array.isArray(p.nodes) && p.nodes.length > 0 && p.nodes.length <= LOCAL_PLAN_PROPOSAL_LIMITS.nodes, 'node_count');
  const byID = new Map();
  for (const n of p.nodes) {
    need(exact(n, NODE_KEYS), 'proposal_node_unknown_or_missing_field');
    need(typeof n.proposal_node_id === 'string' && PID.test(n.proposal_node_id) && !byID.has(n.proposal_node_id), 'node_identity');
    // Native Core limits text in UTF-8 bytes, stricter than JSON schema chars.
    need(text(n.instruction, 12000) && text(n.required_output, 4000) && text(n.reason_code, 96), 'node_text');
    need(ids(n.requirement_refs) && n.requirement_refs.length > 0, 'requirement_shape');
    need(ids(n.material_refs) && ids(n.check_refs) && ids(n.dependencies, 8), 'reference_shape');
    need(n.proposed_candidate_id === null || (typeof n.proposed_candidate_id === 'string' && PID.test(n.proposed_candidate_id)), 'candidate_shape');
    need(SCOPE.has(n.proposed_scope), 'scope_invalid');
    need(Array.isArray(n.proposed_owned_paths) && n.proposed_owned_paths.length <= 128 &&
      new Set(n.proposed_owned_paths).size === n.proposed_owned_paths.length && n.proposed_owned_paths.every(pathHint), 'path_hint_invalid');
    need(n.proposed_scope === 'read_only' ? n.proposed_owned_paths.length === 0 : n.proposed_owned_paths.length > 0, 'scope_paths');
    byID.set(n.proposal_node_id, n);
  }
  for (const n of p.nodes) need(n.dependencies.every(id => byID.has(id) && id !== n.proposal_node_id), 'dependency_ref');
  const done = new Set(), visiting = new Set();
  function visit(id) {
    if (done.has(id)) return; need(!visiting.has(id), 'plan_cycle'); visiting.add(id);
    for (const dep of byID.get(id).dependencies) visit(dep);
    visiting.delete(id); done.add(id);
  }
  for (const id of byID.keys()) visit(id);
  const f = p.final_output_proposal;
  need(exact(f, ['mode', 'node_ids']) && ['direct_child', 'ordered_collection', 'integration_node'].includes(f.mode) &&
    ids(f.node_ids, 8) && f.node_ids.length > 0 && f.node_ids.every(id => byID.has(id)), 'final_shape');
  if (f.mode === 'ordered_collection') {
    need(p.nodes.every(n => n.dependencies.length === 0) && f.node_ids.length === p.nodes.length &&
      f.node_ids.every((id, i) => id === p.nodes[i].proposal_node_id), 'collection_requires_all_independent_in_host_order');
  } else need(f.node_ids.length === 1, 'final_cardinality');
  const closure = new Set();
  function cover(id) { if (closure.has(id)) return; closure.add(id); for (const dep of byID.get(id).dependencies) cover(dep); }
  for (const id of f.node_ids) cover(id);
  need(closure.size === byID.size, 'final_uncovered_node');
  return freeze(p);
}

function validateBinding(b) {
  need(exact(b, BINDING_KEYS) && CORE_ID.test(b.task_id ?? '') && CORE_ID.test(b.nonce ?? '') &&
    BINDING_KEYS.filter(k => k !== 'task_id' && k !== 'nonce').every(k => typeof b[k] === 'string' && HASH.test(b[k])), 'host_binding_invalid');
}
function hostCopy(host, expected) {
  need(exact(host, HOST_KEYS), 'host_projection_invalid'); validateBinding(host.binding); validateBinding(expected);
  need(BINDING_KEYS.every(k => host.binding[k] === expected[k]), 'host_binding_stale_or_mismatched');
  need(text(host.request, 12000) && sha(host.request) === host.binding.request_sha256 && text(host.objective, 8192), 'host_original_request_invalid');
  need(SCOPE.has(host.scope) && ids(host.requirement_ids) && host.requirement_ids.length > 0 &&
    ids(host.check_ids) && ids(host.candidate_ids, 4096, CORE_ID), 'host_projection_ids_invalid');
  need(Array.isArray(host.allowed_owned_paths) && host.allowed_owned_paths.length <= 128 &&
    new Set(host.allowed_owned_paths).size === host.allowed_owned_paths.length && host.allowed_owned_paths.every(pathHint) &&
    (host.scope !== 'read_only' || host.allowed_owned_paths.length === 0), 'host_owned_paths_invalid');
  need(plain(host.material_aliases) && Object.keys(host.material_aliases).length <= 128 &&
    Object.entries(host.material_aliases).every(([alias, actual]) => PID.test(alias) && text(actual, 1024)) &&
    new Set(Object.values(host.material_aliases)).size === Object.keys(host.material_aliases).length, 'host_material_aliases_invalid');
  // Copy through known keys, never object-spread an untrusted proposal.
  return {binding: Object.fromEntries(BINDING_KEYS.map(k => [k, host.binding[k]])),
    request: host.request, objective: host.objective, scope: host.scope,
    paths: new Set(host.allowed_owned_paths), requirements: new Set(host.requirement_ids),
    checks: new Set(host.check_ids), candidates: new Set(host.candidate_ids),
    materials: new Map(Object.entries(host.material_aliases))};
}

/**
 * Compile new HOST UNBOUND nodes. This cannot execute and must NOT be passed
 * as an already-bound plan. Core must independently bind EVERY node through
 * current route admission, then validate the resulting plan and native ticket.
 * expectedBinding must be obtained afresh from Core-owned state, not the model.
 * Path matching is lexical exact-subset only; native filesystem resolution,
 * symlink/case/resource ownership checks are intentionally still required.
 */
export function compileLocalPlanProposal(raw, hostProjection, expectedBinding) {
  const h = hostCopy(hostProjection, expectedBinding), p = decodeLocalPlanProposal(raw);
  const nodeIDs = new Map(p.nodes.map((n, i) => [n.proposal_node_id, `node_${i}`]));
  const mappedRequirements = new Set();
  const preferences = [], obligations = [];
  const nodes = p.nodes.map(n => {
    need(n.requirement_refs.every(id => h.requirements.has(id)), 'unknown_requirement');
    need(n.material_refs.every(id => h.materials.has(id)), 'unknown_material_alias');
    need(n.check_refs.every(id => h.checks.has(id)), 'unknown_check');
    need(n.proposed_candidate_id === null || h.candidates.has(n.proposed_candidate_id), 'unknown_candidate_hint');
    need(!(h.scope === 'read_only' && n.proposed_scope === 'workspace_write'), 'scope_upgrade');
    need(n.proposed_owned_paths.every(path => h.paths.has(path)), 'owned_path_not_host_allowed');
    for (const id of n.requirement_refs) mappedRequirements.add(id);
    const id = nodeIDs.get(n.proposal_node_id);
    preferences.push({node_id: id, proposed_candidate_id: n.proposed_candidate_id});
    obligations.push({node_id: id, proposal_node_id: n.proposal_node_id,
      requirement_refs: [...n.requirement_refs], check_refs: [...n.check_refs],
      required_output: n.required_output, reason_code: n.reason_code});
    return {id, instruction: n.instruction, dependencies: n.dependencies.map(d => nodeIDs.get(d)),
      kind: 'agent', scope: n.proposed_scope, owned_paths: [...n.proposed_owned_paths],
      context_refs: n.material_refs.map(alias => h.materials.get(alias))};
  });
  need([...h.requirements].every(id => mappedRequirements.has(id)), 'requirement_unmapped');
  const byID = new Map(nodes.map(n => [n.id, n]));
  const depends = (node, id) => node.dependencies.some(d => d === id || depends(byID.get(d), id));
  const writers = nodes.filter(n => n.scope === 'workspace_write');
  for (let i = 0; i < writers.length; i++) for (let j = i + 1; j < writers.length; j++) {
    const a = writers[i], b = writers[j];
    const overlap = a.owned_paths.some(x => b.owned_paths.some(y => x === y || x.startsWith(y + '/') || y.startsWith(x + '/')));
    need(!overlap || depends(a, b.id) || depends(b, a.id), 'unordered_writer_overlap');
  }
  return freeze({
    provenance: 'host_unbound_plan', binding: h.binding,
    original_objective: {request: h.request, objective: h.objective, request_sha256: h.binding.request_sha256},
    plan: {schema: 1, task_id: h.binding.task_id, request_sha256: h.binding.request_sha256, nodes,
      final_node_id: p.final_output_proposal.mode === 'ordered_collection' ? null : nodeIDs.get(p.final_output_proposal.node_ids[0])},
    candidate_preferences: preferences, node_obligations: obligations,
    coverage: {status: 'interpretation_inferred', structurally_mapped_requirement_ids: [...h.requirements],
      semantic_coverage_verified: false},
    execution_authorized: false, quality_parity_verified: false,
  });
}
