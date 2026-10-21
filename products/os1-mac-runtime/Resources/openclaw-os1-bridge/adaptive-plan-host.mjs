import {createHash} from 'node:crypto';
import {stableJSON} from './joint-route-selector.mjs';
import {compileLocalPlanProposal} from './local-plan-proposal.mjs';

// Pure host-side projection/compiler seam. No source discovery, model, native
// execution, scheduling, reservation or filesystem grant happens here.
const hash = s => createHash('sha256').update(s, 'utf8').digest('hex');
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const need = (ok, code) => { if (!ok) throw Object.assign(new Error(code), {code}); };
const isHash = x => typeof x === 'string' && HASH.test(x);
const freeze = x => {
  if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); }
  return x;
};

/** Requirements here are deliberately interpreted owner-objective units,
 * not a new complete checker or model-authored semantic coverage certificate.
 * Initial shadow rollout admits only host-observed read-only tasks. */
export function createPlannerHostProjection({task, catalog, scope, nonce}) {
  need(task?.mode === 'auto' && scope === 'read_only', 'adaptive_readonly_auto_required');
  need(typeof task.task_id === 'string' && ID.test(task.task_id) && typeof nonce === 'string' && ID.test(nonce),
    'adaptive_task_nonce_invalid');
  need(typeof task.request === 'string' && hash(task.request) === task.request_sha256 &&
    typeof task.objective === 'string' && task.objective.length > 0 &&
    isHash(task.source_fingerprint) && isHash(task.policy_sha256), 'adaptive_original_binding_invalid');
  need(catalog?.task_id === task.task_id && catalog?.request_sha256 === task.request_sha256 &&
    Array.isArray(catalog.candidates) && catalog.candidates.length <= 4096 &&
    catalog.candidates.every(c => typeof c.id === 'string' && ID.test(c.id)) &&
    new Set(catalog.candidates.map(c => c.id)).size === catalog.candidates.length,
    'adaptive_catalog_binding_invalid');
  need(Array.isArray(task.material_refs) && task.material_refs.length <= 128 &&
    task.material_refs.every(x => typeof x === 'string' && x.length > 0 &&
      !x.includes('\0') && Buffer.byteLength(x, 'utf8') <= 1024) &&
    new Set(task.material_refs).size === task.material_refs.length, 'adaptive_material_binding_invalid');
  const materialAliases = Object.fromEntries(task.material_refs.map((ref, i) => [`material_${i}`, ref]));
  const binding = {task_id: task.task_id, request_sha256: task.request_sha256,
    source_fingerprint: task.source_fingerprint, policy_sha256: task.policy_sha256,
    catalog_sha256: hash(stableJSON(catalog)), nonce};
  return freeze({hostProjection: {binding, request: task.request, objective: task.objective,
    scope, allowed_owned_paths: [], requirement_ids: ['owner_objective'], material_aliases: materialAliases,
    candidate_ids: catalog.candidates.map(c => c.id), check_ids: []},
    expectedBinding: {...binding},
    projection: {
      requirements: [{id: 'owner_objective', text: task.objective, status: 'interpreted'}],
      // The classifier sees opaque metadata only. Source bodies stay on the
      // existing executor path; neither an alias nor a label is a read receipt.
      materials: Object.keys(materialAliases).map(id => ({id, kind: 'host_material_ref',
        read_status: 'not_read', label: id, authority_scope: 'task_data', required: 'unknown'})),
    },
    semantic_coverage_verified: false, quality_certificate: false, execution_authorized: false});
}

/** Parse and compare AGAIN with current host facts after the awaited model
 * response. The saved prompt-side projection alone is never fresh authority. */
export function compileFreshPlannerProposal(raw, prepared, current, limits) {
  need(prepared && current && limits && Number.isSafeInteger(limits.max_nodes) &&
    limits.max_nodes >= 1 && limits.max_nodes <= 8, 'adaptive_compile_context_invalid');
  const previous = prepared.expectedBinding, latest = current.expectedBinding;
  need(stableJSON(previous) === stableJSON(latest), 'adaptive_host_state_changed_during_proposal');
  need(prepared.hostProjection.request === current.hostProjection.request &&
    prepared.hostProjection.objective === current.hostProjection.objective &&
    stableJSON(prepared.hostProjection) === stableJSON(current.hostProjection),
    'adaptive_host_projection_changed');
  const compiled = compileLocalPlanProposal(raw, current.hostProjection, latest);
  need(compiled.plan.nodes.length <= limits.max_nodes, 'adaptive_policy_node_budget');
  // Defense in depth at the eventual resolver call-site: raw local preferences
  // can never use its legacy candidate_id => adapter_bound shortcut.
  need(compiled.plan.nodes.every(n => n.kind === 'agent' && n.scope === 'read_only' &&
    n.owned_paths.length === 0 && !Object.hasOwn(n, 'candidate_id') &&
    !Object.hasOwn(n, 'route_class') && !Object.hasOwn(n, 'selected_config')),
    'adaptive_proposal_not_host_unbound');
  return compiled;
}
