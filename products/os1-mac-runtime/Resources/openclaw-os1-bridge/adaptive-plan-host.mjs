import {createHash} from 'node:crypto';
import {constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, readdirSync} from 'node:fs';
import {isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stableJSON} from './joint-route-selector.mjs';
import {compileLocalPlanProposal} from './local-plan-proposal.mjs';

// Host-side projection/compiler and private capability seam. No model, native
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

// Only the Core host may register these private bytes. This is deliberately
// distinct from P7's DEVELOPMENT predictor: no table, probability, score or
// model-authored `approved` field can become a live capability.
const liveCapabilities = new WeakMap();
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
const exact = (x, keys) => plain(x) && Reflect.ownKeys(x).length === keys.length &&
  keys.every(k => Object.hasOwn(x, k) && Object.hasOwn(Object.getOwnPropertyDescriptor(x, k), 'value'));
const LIVE_KIND = 'os1_host_exact_plan_capability_v1';
const LIVE_BYTES = 16_384;
function strictJSON(raw) {
  let at = 0, count = 0;
  const ws = () => { while (/[\t\r\n ]/.test(raw[at] ?? '!')) at++; };
  const string = () => { const start = at++; while (at < raw.length) {
    const c = raw[at++]; if (c === '\\') at++;
    else if (c === '"') return JSON.parse(raw.slice(start, at));
  } need(false, 'live_manifest_json_invalid'); };
  const value = depth => {
    need(++count <= 1024 && depth <= 12, 'live_manifest_json_bound'); ws();
    if (raw[at] === '"') return string();
    if (raw[at] === '{') { at++; ws(); const x = Object.create(null);
      if (raw[at] === '}') { at++; return x; }
      for (;;) { ws(); need(raw[at] === '"', 'live_manifest_json_invalid'); const k = string();
        need(!Object.hasOwn(x, k) && !['__proto__', 'prototype', 'constructor'].includes(k), 'live_manifest_duplicate_or_unsafe_key');
        ws(); need(raw[at++] === ':', 'live_manifest_json_invalid'); x[k] = value(depth + 1); ws();
        const end = raw[at++]; if (end === '}') return x; need(end === ',', 'live_manifest_json_invalid'); }
    }
    if (raw[at] === '[') { at++; ws(); const x = []; if (raw[at] === ']') { at++; return x; }
      for (;;) { need(x.length < 128, 'live_manifest_json_bound'); x.push(value(depth + 1)); ws();
        const end = raw[at++]; if (end === ']') return x; need(end === ',', 'live_manifest_json_invalid'); }
    }
    const token = raw.slice(at).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
    need(token, 'live_manifest_json_invalid'); at += token.length;
    const parsed = JSON.parse(token); need(typeof parsed !== 'number' || Number.isFinite(parsed), 'live_manifest_json_invalid'); return parsed;
  };
  const result = value(0); ws(); need(at === raw.length, 'live_manifest_json_invalid'); return freeze(result);
}
function privateDirectory(path) {
  need(isAbsolute(path) && resolve(path) === path && realpathSync(path) === path, 'live_manifest_directory_alias');
  const s = lstatSync(path); need(s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid() &&
    (s.mode & 0o077) === 0 && (s.mode & 0o7000) === 0, 'live_manifest_directory_custody');
  return s;
}
function privateRead(path, max, privateFile) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    need(before.isFile() && before.nlink === 1 && before.size >= 2 && before.size <= max &&
      (privateFile ? before.uid === process.getuid() && (before.mode & 0o077) === 0 :
        [0, process.getuid()].includes(before.uid) && (before.mode & 0o022) === 0) &&
      (before.mode & 0o111) === 0 && realpathSync(path) === path, 'live_manifest_file_custody');
    const bytes = Buffer.alloc(before.size); let offset = 0;
    while (offset < bytes.length) { const n = readSync(fd, bytes, offset, bytes.length - offset, offset);
      need(n > 0, 'live_manifest_short_read'); offset += n; }
    const after = fstatSync(fd), named = lstatSync(path);
    need(['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(k => before[k] === after[k] && after[k] === named[k]) &&
      realpathSync(path) === path, 'live_manifest_changed_during_read');
    return bytes;
  } finally { closeSync(fd); }
}
/** A real, closed-inventory, private host capability loader. A registration
 * hash only locates bytes; it does not itself grant live admission. The one
 * initial family is a no-external-material read-only original-request task
 * with a CURRENT R0 full native task contract. Other data/rights/calibration
 * modes are ineligible until separately implemented and evidenced. */
function readLivePlanCapability({stateDir, policy, registration, now_ms = Date.now()} = {}) {
  if (policy?.mode !== 'covered_live' || registration == null) return null;
  try {
    need(exact(registration, ['schema', 'manifest_sha256', 'manifest_bytes', 'loader_sha256', 'runtime_sha256']) &&
      registration.schema === 1 && [registration.manifest_sha256, registration.loader_sha256,
        registration.runtime_sha256].every(isHash) && Number.isSafeInteger(registration.manifest_bytes) &&
      registration.manifest_bytes >= 2 && registration.manifest_bytes <= LIVE_BYTES, 'live_registration_invalid');
    need(typeof stateDir === 'string' && isAbsolute(stateDir) && resolve(stateDir) === stateDir &&
      Number.isSafeInteger(now_ms) && now_ms >= 0, 'live_loader_input_invalid');
    const root = join(stateDir, 'live-plan-capabilities', registration.manifest_sha256);
    const parents = [stateDir, join(stateDir, 'live-plan-capabilities'), root];
    const stats = parents.map(privateDirectory);
    need(readdirSync(root).length === 1 && readdirSync(root)[0] === 'manifest.json', 'live_manifest_closed_inventory');
    const here = fileURLToPath(new URL('.', import.meta.url));
    // Build 442 (DESIGN-4): the runtime outgrew 512 KiB (531 KB); the read
    // bound is a size sanity limit, 1 MiB keeps it bounded.
    need(hash(privateRead(join(here, 'adaptive-plan-host.mjs'), 131072, false)) === registration.loader_sha256 &&
      hash(privateRead(join(here, 'rcc-runtime.mjs'), 1048576, false)) === registration.runtime_sha256,
    'live_runtime_code_mismatch');
    const bytes = privateRead(join(root, 'manifest.json'), LIVE_BYTES, true);
    need(bytes.length === registration.manifest_bytes && hash(bytes) === registration.manifest_sha256,
      'live_manifest_identity_mismatch');
    const source = bytes.toString('utf8'); need(Buffer.from(source).equals(bytes), 'live_manifest_utf8');
    const m = strictJSON(source);
    need(exact(m, ['schema', 'kind', 'policy_id', 'policy_version', 'issued_at_ms', 'valid_until_ms',
      'bindings', 'family', 'source', 'rights', 'data', 'calibration', 'reference']) &&
      m.schema === 1 && m.kind === LIVE_KIND && m.policy_id === policy.policy_id &&
      m.policy_version === policy.version && Number.isSafeInteger(m.issued_at_ms) &&
      Number.isSafeInteger(m.valid_until_ms) && m.issued_at_ms <= now_ms &&
      now_ms < m.valid_until_ms && m.issued_at_ms < m.valid_until_ms, 'live_manifest_shape_or_time');
    need(exact(m.bindings, ['rcc_source_sha256', 'projection_sha256', 'reference_policy_sha256',
      'loader_sha256', 'runtime_sha256']) &&
      m.bindings.rcc_source_sha256 === policy.rcc_source_sha256 &&
      m.bindings.projection_sha256 === policy.projection_sha256 &&
      m.bindings.reference_policy_sha256 === policy.reference_policy_sha256 &&
      m.bindings.loader_sha256 === registration.loader_sha256 &&
      m.bindings.runtime_sha256 === registration.runtime_sha256 &&
      policy.adoption_manifest_sha256 === registration.manifest_sha256, 'live_manifest_policy_mismatch');
    need(exact(m.family, ['workload_class', 'scope', 'plan_shape', 'r0_source']) &&
      policy.allowed_workload_classes.includes(m.family.workload_class) &&
      m.family.scope === 'read_only' && m.family.plan_shape === 'single_original_request' &&
      m.family.r0_source === 'full_task_contract', 'live_family_unsupported');
    need(exact(m.source, ['material_policy', 'policy_sha256']) &&
      m.source.material_policy === 'no_external_material' && m.source.policy_sha256 === policy.rcc_source_sha256 &&
      exact(m.rights, ['status']) && m.rights.status === 'not_applicable_no_external_material' &&
      exact(m.data, ['status']) && m.data.status === 'no_training_data_used' &&
      exact(m.calibration, ['status', 'basis']) &&
      m.calibration.status === 'not_applicable_deterministic' &&
      m.calibration.basis === 'r0_full_task_contract' &&
      exact(m.reference, ['policy_sha256', 'fallback']) &&
      m.reference.policy_sha256 === policy.reference_policy_sha256 &&
      m.reference.fallback === 'r0_prebound_live_reference', 'live_evidence_boundary_invalid');
    need(parents.every((p, i) => {const s = privateDirectory(p); return ['dev','ino','mode','uid','mtimeMs','ctimeMs'].every(k => s[k] === stats[i][k]);}),
      'live_manifest_directory_changed');
    return freeze({schema: 1, manifest_sha256: registration.manifest_sha256,
      valid_until_ms: m.valid_until_ms, bindings: m.bindings, family: m.family});
  } catch { return null; } // Optional registration failure preserves the host reference plan.
}
export function loadLivePlanCapability(options = {}) {
  const capability = readLivePlanCapability(options);
  if (capability !== null) {
    // Preserve only the exact host registration needed for fresh custody
    // checks. Caller mutation and a historical successful read are not live
    // authority after deletion, replacement, permission change or code drift.
    liveCapabilities.set(capability, freeze({stateDir: options.stateDir,
      policy: structuredClone(options.policy), registration: structuredClone(options.registration)}));
  }
  return capability;
}
export function isLivePlanCapability(value, now_ms = Date.now()) {
  const origin = liveCapabilities.get(value);
  if (origin === undefined) return false;
  const current = readLivePlanCapability({...origin, now_ms});
  return current !== null && stableJSON(current) === stableJSON(value);
}

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
