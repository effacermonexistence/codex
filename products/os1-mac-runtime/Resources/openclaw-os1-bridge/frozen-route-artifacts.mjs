/** P7 DEVELOPMENT-only host data loader. No training/calibration/admission.
 * Registration is an externally pinned HOST argument, never model/task JSON.
 * Fixed inventory: routing-artifacts/<manifestSHA>/{manifest,table,lineage}.json.
 * A content hash/custody check proves bytes, not labels, rights or science.
 */
import {createHash} from 'node:crypto';
import {constants, openSync, closeSync, readSync, fstatSync, lstatSync,
  realpathSync, opendirSync} from 'node:fs';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest, RESOURCE_COMPONENTS} from './joint-route-selector.mjs';

export const FROZEN_ROUTE_FORMAT = 'os1_dev_empirical_table_v1';
export const FROZEN_ROUTE_FEATURE_SCHEMA = 'host_preoutcome_counts_v1';
export const FROZEN_ROUTE_LIMITS = Object.freeze({manifest_bytes: 32768, table_bytes: 262144,
  lineage_bytes: 1048576, cells: 256, samples: 2048, configurations: 32});
const loaded = new WeakSet(), HASH = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const hex = v => typeof v === 'string' && HASH.test(v);
const count = v => Number.isSafeInteger(v) && v >= 0;
const id = v => typeof v === 'string' && ID.test(v);
const need = (v, code) => {if (!v) throw Object.assign(new Error(code), {code});};
const sha = v => createHash('sha256').update(v).digest('hex');
const freeze = x => {if (x && typeof x === 'object') {for (const v of Object.values(x)) freeze(v); Object.freeze(x);} return x;};
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
const exact = (x, keys) => plain(x) && Reflect.ownKeys(x).length === keys.length && keys.every(k =>
  Object.hasOwn(x, k) && Object.hasOwn(Object.getOwnPropertyDescriptor(x, k), 'value'));
const hashes = x => Array.isArray(x) && x.length <= 32 && x.every(hex) && new Set(x).size === x.length;
const ids = x => Array.isArray(x) && x.length <= 32 && x.every(id) && new Set(x).size === x.length;

/** Safe plain-JSON snapshot; rejects getters BEFORE reading their values. */
export function frozenRouteData(value) {
  let nodes = 0; const active = new Set();
  const walk = (x, depth) => {
    need(++nodes <= 30000 && depth <= 24, 'fr_json_bound');
    if (x === null || typeof x === 'boolean') return x;
    if (typeof x === 'string') {need(Buffer.byteLength(x) <= 8192 && !x.includes('\0'), 'fr_string_bound'); return x;}
    if (typeof x === 'number') {need(Number.isFinite(x), 'fr_nonfinite'); return x;}
    need((plain(x) || Array.isArray(x)) && !active.has(x), 'fr_plain_json_required'); active.add(x);
    const desc = Object.getOwnPropertyDescriptors(x), keys = Reflect.ownKeys(x);
    need(keys.every(k => typeof k === 'string' && Object.hasOwn(desc[k], 'value')) &&
      !keys.some(k => ['__proto__', 'constructor', 'prototype'].includes(k)), 'fr_accessor_or_key');
    let out;
    if (Array.isArray(x)) {
      need(x.length <= 4096 && keys.length === x.length + 1 &&
        Array.from({length: x.length}, (_, i) => Object.hasOwn(x, i)).every(Boolean), 'fr_dense_array_required');
      out = Array.from({length: x.length}, (_, i) => walk(desc[i].value, depth + 1));
    } else {out = Object.create(null); for (const k of keys) out[k] = walk(desc[k].value, depth + 1);}
    active.delete(x); return out;
  };
  return freeze(walk(value, 0));
}
function parse(raw) {
  let at = 0, nodes = 0;
  const ws = () => {while (/[\t\r\n ]/.test(raw[at] ?? 'x')) at++;};
  const str = () => {const start = at++; while (at < raw.length) {const c = raw[at++]; if (c === '\\') at++;
    else if (c === '"') return JSON.parse(raw.slice(start, at));} need(false, 'fr_json_invalid');};
  const value = depth => {
    need(++nodes <= 30000 && depth <= 24, 'fr_json_bound'); ws(); const c = raw[at];
    if (c === '"') return str();
    if (c === '{') {at++; ws(); const x = Object.create(null); if (raw[at] === '}') {at++; return x;}
      for (;;) {ws(); need(raw[at] === '"', 'fr_json_invalid'); const k = str();
        need(!Object.hasOwn(x, k), 'fr_duplicate_key'); ws(); need(raw[at++] === ':', 'fr_json_invalid');
        x[k] = value(depth + 1); ws(); const end = raw[at++]; if (end === '}') return x; need(end === ',', 'fr_json_invalid');}}
    if (c === '[') {at++; ws(); const x = []; if (raw[at] === ']') {at++; return x;}
      for (;;) {need(x.length < 4096, 'fr_json_bound'); x.push(value(depth + 1)); ws(); const end = raw[at++];
        if (end === ']') return x; need(end === ',', 'fr_json_invalid');}}
    const token = raw.slice(at).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
    need(token, 'fr_json_invalid'); at += token.length; return JSON.parse(token);
  };
  const x = value(0); ws(); need(at === raw.length, 'fr_json_invalid'); return frozenRouteData(x);
}
const same = (a, b) => ['dev', 'ino', 'mode', 'uid', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].every(k => a[k] === b[k]);
/** Same pure stat predicate used with REAL fstat below; bool alone grants nothing. */
export function frozenRouteFileCustody(s, {uid, privateFile = true} = {}) {
  try {return s.isFile() && s.nlink === 1n && s.size > 1n && (s.mode & 0o7111n) === 0n &&
    (privateFile ? s.uid === BigInt(uid) && (s.mode & 0o077n) === 0n :
      [0n, BigInt(uid)].includes(s.uid) && (s.mode & 0o022n) === 0n);
  } catch {return false;}
}
function directory(path) {
  need(typeof path === 'string' && !path.includes('\0') && isAbsolute(path) && resolve(path) === path && realpathSync(path) === path,
    'fr_directory_canonical');
  const s = lstatSync(path, {bigint: true}); need(s.isDirectory() && !s.isSymbolicLink() &&
    s.uid === BigInt(process.getuid()) && (s.mode & 0o077n) === 0n && (s.mode & 0o7000n) === 0n, 'fr_directory_private'); return s;
}
function read(path, limit, privateFile, trace) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const a = fstatSync(fd, {bigint: true}); need(frozenRouteFileCustody(a, {uid: process.getuid(), privateFile}) &&
      a.size <= BigInt(limit), 'fr_file_custody');
    need(realpathSync(path) === path && same(lstatSync(path, {bigint: true}), a), 'fr_file_alias');
    const bytes = Buffer.alloc(Number(a.size)); let offset = 0;
    while (offset < bytes.length) {const n = readFileChunk(fd, bytes, offset); need(n > 0, 'fr_short_read'); offset += n;}
    const b = fstatSync(fd, {bigint: true}); need(same(a, b) && same(lstatSync(path, {bigint: true}), b) && realpathSync(path) === path,
      'fr_file_changed'); trace.file_reads++; return {bytes, sha256: sha(bytes)};
  } finally {if (fd !== undefined) closeSync(fd);}
}
// A bounded destination buffer avoids readFileSync following an endlessly growing file.
const readFileChunk = (fd, bytes, offset) => readSync(fd, bytes, offset, bytes.length - offset, offset);
function validate(manifest, table, lineage, registration, now) {
  need(exact(manifest, ['schema', 'kind', 'id', 'version', 'proof_mode', 'issued_at_ms', 'valid_until_ms', 'runtime',
    'bindings', 'feature_schema_version', 'minimum_samples', 'rights', 'split_audit', 'calibration', 'holdout', 'files']) &&
    manifest.schema === 1 && manifest.kind === FROZEN_ROUTE_FORMAT && id(manifest.id) && id(manifest.version) &&
    ['empty', 'unmeasured', 'development', 'synthetic_fixture'].includes(manifest.proof_mode), 'fr_manifest_shape');
  need(count(now) && count(manifest.issued_at_ms) && count(manifest.valid_until_ms) &&
    manifest.issued_at_ms <= now && now < manifest.valid_until_ms && manifest.issued_at_ms < manifest.valid_until_ms, 'fr_artifact_stale_or_future');
  need(exact(manifest.runtime, ['algorithm', 'node_major', 'loader_sha256', 'predictor_sha256']) &&
    manifest.runtime.algorithm === FROZEN_ROUTE_FORMAT && manifest.runtime.node_major === 24 &&
    Number(process.versions.node.split('.')[0]) === 24 &&
    manifest.runtime.loader_sha256 === registration.loader_sha256 && manifest.runtime.predictor_sha256 === registration.predictor_sha256,
    'fr_runtime_mismatch');
  const b = manifest.bindings;
  need(exact(b, ['rcc_source_sha256', 'policy_sha256', 'reference_descriptor_sha256', 'harness_sha256', 'native_binary_sha256',
    'native_instructions_sha256', 'environment_sha256', 'verifier_sha256', 'coverage_discriminator_sha256',
    'candidate_pool_sha256', 'config_sha256s', 'workload_classes', 'scope']) &&
    Object.entries(b).filter(([k]) => !['config_sha256s', 'workload_classes', 'scope'].includes(k)).every(([, v]) => hex(v)) &&
    hashes(b.config_sha256s) && b.config_sha256s.length > 0 && ids(b.workload_classes) && b.workload_classes.length > 0 &&
    b.scope === 'read_only' && manifest.feature_schema_version === FROZEN_ROUTE_FEATURE_SCHEMA &&
    Number.isSafeInteger(manifest.minimum_samples) && manifest.minimum_samples >= 1 && manifest.minimum_samples <= 2048, 'fr_bindings_invalid');
  need(exact(manifest.rights, ['status', 'evidence_sha256']) && ['cleared', 'review_required', 'unknown'].includes(manifest.rights.status) &&
    (manifest.rights.evidence_sha256 === null || hex(manifest.rights.evidence_sha256)) &&
    (manifest.rights.status !== 'cleared' || hex(manifest.rights.evidence_sha256)), 'fr_rights_invalid');
  need(exact(manifest.split_audit, ['status']) && manifest.split_audit.status === 'not_performed' &&
    exact(manifest.calibration, ['status']) && manifest.calibration.status === 'unmeasured' &&
    exact(manifest.holdout, ['status']) && manifest.holdout.status === 'not_performed', 'fr_scientific_authority_unsupported');
  need(exact(table, ['schema', 'kind', 'cells']) && table.schema === 1 && table.kind === FROZEN_ROUTE_FORMAT &&
    Array.isArray(table.cells) && table.cells.length <= FROZEN_ROUTE_LIMITS.cells, 'fr_table_invalid');
  need(exact(lineage, ['schema', 'kind', 'dataset_sha256', 'label_schema', 'samples']) && lineage.schema === 1 &&
    lineage.kind === 'development_lineage_v1' && hex(lineage.dataset_sha256) && lineage.label_schema === 'separate_reference_match_and_task_success_v1' &&
    Array.isArray(lineage.samples) && lineage.samples.length <= FROZEN_ROUTE_LIMITS.samples, 'fr_lineage_invalid');
  const seen = new Set();
  for (const s of lineage.samples) {
    need(exact(s, ['id', 'origin', 'split', 'source_sha256', 'template_sha256', 'project_sha256', 'raw_attempt_sha256',
      'final_lock_sha256', 'label_evidence_sha256', 'feature_bucket_sha256', 'config_sha256', 'outcome', 'reference_match', 'task_success', 'resource']) &&
      ['id', 'source_sha256', 'template_sha256', 'project_sha256', 'raw_attempt_sha256', 'final_lock_sha256',
        'label_evidence_sha256', 'feature_bucket_sha256', 'config_sha256'].every(k => hex(s[k])) && !seen.has(s.id) &&
      ['actual_execution', 'synthetic_fixture', 'unknown'].includes(s.origin) && s.split === 'development' &&
      b.config_sha256s.includes(s.config_sha256) && ['completed', 'failed', 'cancelled', 'auth', 'quota', 'transport', 'unknown'].includes(s.outcome) &&
      [null, true, false].includes(s.reference_match) && [null, true, false].includes(s.task_success) &&
      (s.outcome === 'completed' || (s.reference_match === null && s.task_success === null)), 'fr_sample_invalid'); seen.add(s.id);
    if (manifest.proof_mode === 'synthetic_fixture') need(s.origin === 'synthetic_fixture', 'fr_synthetic_origin_mismatch');
    if (s.resource !== null) need(exact(s.resource, ['accounting_scope', 'token_basis', 'components']) &&
      s.resource.accounting_scope === 'disjoint_remaining_node_total_v1' &&
      s.resource.token_basis === 'input_output_include_cache_reasoning_subsets' && exact(s.resource.components, RESOURCE_COMPONENTS) &&
      Object.values(s.resource.components).every(v => v === null || count(v) && v <= 1e12), 'fr_resource_invalid');
  }
  const cellIDs = new Set(), assigned = new Set();
  for (const c of table.cells) {
    need(exact(c, ['feature_bucket_sha256', 'config_sha256', 'sample_ids']) && hex(c.feature_bucket_sha256) &&
      b.config_sha256s.includes(c.config_sha256) && Array.isArray(c.sample_ids) && c.sample_ids.length <= 2048 &&
      c.sample_ids.every(hex) && new Set(c.sample_ids).size === c.sample_ids.length, 'fr_cell_invalid');
    const key = c.feature_bucket_sha256 + ':' + c.config_sha256; need(!cellIDs.has(key), 'fr_duplicate_cell'); cellIDs.add(key);
    for (const id of c.sample_ids) {const s = lineage.samples.find(s => s.id === id); need(s && !assigned.has(id) &&
      s.feature_bucket_sha256 === c.feature_bucket_sha256 && s.config_sha256 === c.config_sha256, 'fr_sample_cell_binding'); assigned.add(id);}
  }
  need(assigned.size === lineage.samples.length && (!['empty', 'unmeasured'].includes(manifest.proof_mode) ||
    table.cells.length === 0 && lineage.samples.length === 0), 'fr_unassigned_or_unmeasured_samples');
}

export function isFrozenRouteArtifacts(value) {return loaded.has(value);}
export function loadFrozenRouteArtifacts({stateDir, mode = 'off', registration = null, now_ms = Date.now()} = {}) {
  const trace = {file_reads: 0, io_performed: false};
  const result = (status, reason, artifacts = null, receipt = null) => freeze({schema: 1, status, reason, artifacts,
    source_receipt: receipt, ...trace, calibration_validated: false, holdout_accepted: false,
    execution_authorized: false, live_route_change_authorized: false});
  if (mode === 'off') return result('not_registered', 'feature_off');
  if (registration === null) return result('not_registered', 'host_registration_absent');
  try {
    need(mode === 'shadow', 'fr_shadow_only'); registration = frozenRouteData(registration);
    need(exact(registration, ['schema', 'manifest_sha256', 'manifest_bytes', 'loader_sha256', 'predictor_sha256']) &&
      registration.schema === 1 && ['manifest_sha256', 'loader_sha256', 'predictor_sha256'].every(k => hex(registration[k])) &&
      count(registration.manifest_bytes) && registration.manifest_bytes > 1 && registration.manifest_bytes <= FROZEN_ROUTE_LIMITS.manifest_bytes,
      'fr_registration_invalid');
    trace.io_performed = true;
    const parents = [stateDir, join(stateDir, 'routing-artifacts'), join(stateDir, 'routing-artifacts', registration.manifest_sha256)];
    const snapshots = parents.map(directory), root = parents[2];
    const folder = opendirSync(root), names = []; try {let e; while ((e = folder.readSync())) {names.push(e.name); need(names.length <= 3, 'fr_extra_file');}} finally {folder.closeSync();}
    need(names.sort().join('|') === 'lineage.json|manifest.json|table.json', 'fr_closed_inventory');
    const here = dirname(fileURLToPath(import.meta.url));
    for (const [name, expected] of [['frozen-route-artifacts.mjs', registration.loader_sha256], ['frozen-route-predictor.mjs', registration.predictor_sha256]])
      need(read(join(here, name), 131072, false, trace).sha256 === expected, 'fr_code_hash_mismatch');
    const mr = read(join(root, 'manifest.json'), FROZEN_ROUTE_LIMITS.manifest_bytes, true, trace);
    need(mr.sha256 === registration.manifest_sha256 && mr.bytes.length === registration.manifest_bytes, 'fr_manifest_hash_or_size');
    const manifest = parse(mr.bytes.toString('utf8')); need(Buffer.from(mr.bytes.toString('utf8')).equals(mr.bytes), 'fr_utf8');
    need(Array.isArray(manifest.files) && manifest.files.length === 2, 'fr_artifact_inventory'); const data = {};
    for (const [name, limit] of [['table.json', FROZEN_ROUTE_LIMITS.table_bytes], ['lineage.json', FROZEN_ROUTE_LIMITS.lineage_bytes]]) {
      const d = manifest.files.find(x => x.name === name); need(exact(d, ['name', 'sha256', 'bytes']) && hex(d.sha256) &&
        count(d.bytes) && d.bytes > 1 && d.bytes <= limit && manifest.files.filter(x => x.name === name).length === 1, 'fr_artifact_descriptor');
      const r = read(join(root, name), limit, true, trace); need(r.sha256 === d.sha256 && r.bytes.length === d.bytes, 'fr_artifact_hash_or_size');
      const text = r.bytes.toString('utf8'); need(Buffer.from(text).equals(r.bytes), 'fr_utf8'); data[name] = parse(text);
    }
    validate(manifest, data['table.json'], data['lineage.json'], registration, now_ms);
    need(parents.every((p, i) => same(directory(p), snapshots[i])), 'fr_directory_changed');
    const artifacts = freeze({schema: 1, manifest_sha256: mr.sha256, manifest, table: data['table.json'], lineage: data['lineage.json']}); loaded.add(artifacts);
    const receipt = {schema: 1, artifact_loaded: true, manifest_sha256: mr.sha256,
      table_bytes_sha256: manifest.files.find(x => x.name === 'table.json').sha256,
      lineage_bytes_sha256: manifest.files.find(x => x.name === 'lineage.json').sha256,
      table_object_sha256: digest(artifacts.table), lineage_object_sha256: digest(artifacts.lineage),
      loaded_at_ms: now_ms, valid_until_ms: manifest.valid_until_ms,
      evidence_basis: 'exact_host_pinned_private_json_bytes_not_scientific_validation', proof_mode: manifest.proof_mode,
      calibration_validated: false, holdout_accepted: false, rights_independently_verified: false};
    return result('loaded_development', 'frozen_development_bytes_loaded', artifacts, {...receipt, receipt_sha256: digest(receipt)});
  } catch (error) {return result('quarantined', /^fr_[a-z0-9_]+$/.test(error?.code ?? '') ? error.code : 'fr_artifact_io_or_json_invalid');}
}
