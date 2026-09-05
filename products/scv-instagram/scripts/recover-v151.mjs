#!/usr/bin/env node
// Read-only R2 acquisition and offline source/state restoration. NEVER deploys,
// resets, sends messages, executes restored code, or reads secret values.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const POINT = 'scv-instagram-20260904T222549Z-v151-clean-current';
const BUCKET = 'omar-private-archive';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const ROOTS = [
  { key: 'scv-instagram-automation/recovery-points/20260904T222549Z/SCV_RECOVERY_POINT.json', bytes: 5725, sha256: '75440f5063fb7deab879df404ea8fa7011fece7c3da1f7af93c042ee9a337a5a' },
  { key: 'scv-instagram-automation/recovery-extensions/20260904T234500Z-v151/SCV_RECOVERY_EXTENSION.json', bytes: 6273, sha256: '204e5791a376b3506667dc0cc66510012e95f985a3ee72a676ba037c26ccaef7' },
  { key: 'scv-instagram-automation/recovery-extensions/20260905T003000Z-v151-deployed/SCV_DEPLOYED_RECOVERY_EXTENSION.json', bytes: 11256, sha256: '16729e0f0a749ca3c70828329d9f1251953a4f9a7178c5a3f36202bb7b9d8a32' }
];
export function check(ok, reason) { if (!ok) throw new Error(reason); }
export function safeRelative(value) {
  check(typeof value === 'string' && /^[A-Za-z0-9_./-]+$/.test(value) &&
    !value.startsWith('/') && !value.split('/').some(p => p === '' || p === '.' || p === '..'), 'unsafe_relative_path');
  return value;
}
export function reference(ref) {
  safeRelative(ref?.key);
  check(ref.key.startsWith('scv-instagram-automation/'), 'unexpected_r2_prefix');
  check(/^[a-f0-9]{64}$/.test(ref.sha256) && Number.isSafeInteger(ref.bytes) &&
    ref.bytes > 0 && ref.bytes <= 300_000_000, 'invalid_artifact_pin');
  return { key: ref.key, bytes: ref.bytes, sha256: ref.sha256 };
}
export function mergeReferences(refs) {
  const map = new Map();
  for (const input of refs) {
    const ref = reference(input), old = map.get(ref.key);
    check(!old || JSON.stringify(old) === JSON.stringify(ref), 'conflicting_artifact_pin');
    map.set(ref.key, ref);
  }
  return [...map.values()];
}
export function digest(file) {
  const st = fs.lstatSync(file);
  check(st.isFile() && st.nlink === 1 && fs.realpathSync(file) === path.resolve(file), 'artifact_not_regular_or_linked');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const hash = crypto.createHash('sha256'), block = Buffer.alloc(1024 * 1024);
  try {
    const opened = fs.fstatSync(fd);
    check(opened.ino === st.ino && opened.dev === st.dev, 'artifact_changed_before_read');
    let n; while ((n = fs.readSync(fd, block, 0, block.length, null))) hash.update(block.subarray(0, n));
    const after = fs.fstatSync(fd);
    const linked = fs.lstatSync(file);
    check(after.size === st.size && after.mtimeMs === st.mtimeMs && after.ctimeMs === st.ctimeMs &&
      after.nlink === 1 && linked.isFile() && linked.ino === after.ino && linked.dev === after.dev &&
      linked.size === after.size && linked.mtimeMs === after.mtimeMs && linked.ctimeMs === after.ctimeMs &&
      fs.realpathSync(file) === path.resolve(file), 'artifact_changed_during_read');
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
export function verify(file, ref) {
  check(fs.lstatSync(file).size === ref.bytes && digest(file) === ref.sha256, 'artifact_pin_mismatch:' + ref.key);
}
export function verifyFinalArtifacts(objects, refs) {
  // A successful earlier download is not evidence that the file is still intact
  // when the restore receipt is written. Recheck OS, environment and proof files
  // too, not only the source/state archives consumed by stage().
  for (const ref of mergeReferences(refs)) verify(path.join(objects, ref.key), ref);
  return refs.length;
}
export function newDirectory(target) {
  const resolved = path.resolve(target), parent = path.dirname(resolved);
  check(!fs.existsSync(resolved), 'target_already_exists');
  check(fs.realpathSync(parent) === parent && fs.statSync(parent).isDirectory(), 'target_parent_not_canonical');
  // Private production-derived downloads must never be staged in this public Git repository.
  check(resolved !== REPO && !resolved.startsWith(REPO + path.sep), 'private_target_inside_public_repository');
  fs.mkdirSync(resolved, { mode: 0o700 });
  return resolved;
}
function run(command, args) {
  const r = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  check(r.status === 0, 'offline_command_failed:' + path.basename(command));
  return r.stdout;
}
export function validateArchive(file) {
  const names = run('tar', ['-tzf', file]).split('\n').filter(Boolean);
  check(names.length > 0, 'empty_archive');
  for (const name of names) safeRelative(name.endsWith('/') ? name.slice(0, -1) : name);
  const types = run('tar', ['-tvzf', file]).split('\n').filter(Boolean);
  check(types.length === names.length && types.every(s => s[0] === '-' || s[0] === 'd'), 'archive_link_or_special_file');
}
function files(root) {
  const out = [];
  function walk(dir, rel = '') {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name), r = rel ? rel + '/' + name : name, st = fs.lstatSync(p);
      if (st.isDirectory()) walk(p, r);
      else { check(st.isFile() && st.nlink === 1, 'restored_link_or_special_file'); out.push(r); }
    }
  }
  walk(root); return out.sort();
}
export function verifyCanonical(root, descriptor) {
  check(Array.isArray(descriptor.files), 'invalid_descriptor');
  const expected = ['SCV_SINGLE_RELEASE.json'];
  for (const entry of descriptor.files) {
    expected.push(safeRelative(entry.path));
    verify(path.join(root, entry.path), { ...entry, key: entry.path });
  }
  check(new Set(expected).size === expected.length, 'duplicate_runtime_path');
  check(JSON.stringify(files(root)) === JSON.stringify(expected.sort()), 'unexpected_runtime_inventory');
}
export function stateTree(root) {
  const lines = [];
  function walk(dir, rel = '') {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name), r = rel ? rel + '/' + name : name;
      if (r === 'logs/supervisor-status.json') continue;
      const st = fs.lstatSync(p);
      if (st.isDirectory()) { lines.push('D\0' + r); walk(p, r); }
      else { check(st.isFile(), 'state_special_file'); lines.push('F\0' + r + '\0' + st.size + '\0' + digest(p)); }
    }
  }
  walk(root);
  return { entries: lines.length, sha256: crypto.createHash('sha256').update(lines.join('\n')).digest('hex') };
}
export function stage(root, point) {
  const component = name => point.components.find(x => x.name === name);
  for (const name of ['runtime', 'production_state']) {
    const ref = reference(component(name)), archive = path.join(root, 'objects', ref.key);
    verify(archive, ref); validateArchive(archive);
  }
  const target = path.join(root, 'staged'); fs.mkdirSync(target, { mode: 0o700 });
  for (const [name, dir] of [['runtime', 'runtime'], ['production_state', 'production-state']]) {
    const to = path.join(target, dir); fs.mkdirSync(to, { mode: 0o700 });
    run('tar', ['--exclude=._*', '-xzf', path.join(root, 'objects', component(name).key), '-C', to]);
  }
  const runtime = path.join(target, 'runtime'), descriptorPath = path.join(runtime, 'SCV_SINGLE_RELEASE.json');
  check(digest(descriptorPath) === point.release.release_manifest_sha256, 'descriptor_pin_mismatch');
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath));
  check(descriptor.release_id === point.release.release_id, 'release_id_mismatch');
  check(crypto.createHash('sha256').update(JSON.stringify(descriptor.files)).digest('hex') === point.release.content_fingerprint_sha256, 'fingerprint_mismatch');
  verifyCanonical(runtime, descriptor);
  check(JSON.stringify(fs.readdirSync(path.join(target, 'production-state'))) === JSON.stringify(['prod']), 'unexpected_state_namespace');
  const state = stateTree(path.join(target, 'production-state/prod')), expected = component('production_state');
  check(state.entries === expected.namespace_entry_count && state.sha256 === expected.namespace_tree_sha256, 'state_tree_mismatch');
  return { canonical_files: descriptor.files.length, state, application_code_executed: false };
}
function downloadWithWrangler(wrangler, object, to) {
  return new Promise((resolve, reject) => {
    // No shell, no auth-cache reads, no login attempt, no stdout containing object bytes.
    const child = spawn(wrangler, ['r2', 'object', 'get', BUCKET + '/' + object.key, '--remote', '--file', to],
      { cwd: REPO, stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' } });
    const timer = setTimeout(() => child.kill('SIGTERM'), 300_000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('wrangler_start_failed')); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('r2_download_failed:' + object.key)); });
  });
}
export async function recover({ point, target, offlineRoot, progress = () => {} }) {
  check(point === POINT, 'exact_recovery_point_required');
  const root = newDirectory(target), objects = path.join(root, 'objects'); fs.mkdirSync(objects, { mode: 0o700 });
  const wrangler = path.join(REPO, 'node_modules/.bin/wrangler');
  if (!offlineRoot) {
    const packageInfo = JSON.parse(fs.readFileSync(path.join(REPO, 'node_modules/wrangler/package.json')));
    check(packageInfo.version === '4.127.1', 'pinned_wrangler_required');
  }
  const verified = new Map();
  async function acquire(ref) {
    reference(ref);
    if (verified.has(ref.key)) { check(JSON.stringify(verified.get(ref.key)) === JSON.stringify(reference(ref)), 'conflicting_artifact_pin'); return; }
    const to = path.join(objects, ref.key); fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
    if (offlineRoot) {
      const source = path.join(path.resolve(offlineRoot), ref.key); verify(source, ref);
      fs.copyFileSync(source, to, fs.constants.COPYFILE_EXCL);
    } else await downloadWithWrangler(wrangler, ref, to);
    fs.chmodSync(to, 0o600); verify(to, ref); verified.set(ref.key, reference(ref));
    progress({ verified_objects: verified.size, key: ref.key });
  }
  for (const ref of ROOTS) await acquire(ref);
  const [base, closure, deployed] = ROOTS.map(ref => JSON.parse(fs.readFileSync(path.join(objects, ref.key))));
  check(base.recovery_point_id === POINT && closure.base_recovery_point.id === POINT && deployed.base_recovery_point.id === POINT, 'manifest_point_mismatch');
  for (const manifest of [closure, deployed]) check(manifest.base_recovery_point.sha256 === ROOTS[0].sha256 && manifest.base_recovery_point.key === ROOTS[0].key, 'base_link_mismatch');
  check(deployed.prior_extension.sha256 === ROOTS[1].sha256 && deployed.prior_extension.key === ROOTS[1].key, 'extension_link_mismatch');
  const refs = mergeReferences([...ROOTS, ...base.components, ...closure.components, ...deployed.components, closure.os_closure, deployed.os_xz]);
  // Bounded pairwise parallel reads. On failure, let both settle before returning.
  for (let i = 0; i < refs.length; i += 2) {
    const results = await Promise.allSettled(refs.slice(i, i + 2).map(acquire));
    const failed = results.find(r => r.status === 'rejected'); if (failed) throw failed.reason;
  }
  const restored = stage(root, base);
  const finalArtifactCount = verifyFinalArtifacts(objects, [...verified.values()]);
  const receipt = {
    schema: 'scv-v151-portable-acquisition-and-offline-restore-v1', at_utc: new Date().toISOString(),
    recovery_point_id: POINT, source: offlineRoot ? 'offline_byte_verified_mirror' : 'fresh_authenticated_r2_get',
    artifact_acquisition_verified: true, artifacts: [...verified.values()], ...restored,
    final_artifacts_reverified_before_receipt: finalArtifactCount,
    production_mutated: false, remote_writes: false, secret_values_recovered_in_this_run: false,
    os_archives_byte_verified_not_booted_in_this_run: true,
    full_manychat_configuration_restored: false, instagram_visible_roundtrip_verified: false,
    full_system_restore_verified: false,
    remaining: ['Recover frozen secret values using a NEW ephemeral job, never an archived expired session.',
      'Resolve authentic target deployment identity and apply verified isolation/cutover gates; old staging operators are evidence, not replayable commands.',
      'Restore full ManyChat settings and observe a real Instagram round trip under fresh exact-target reset gates.']
  };
  fs.writeFileSync(path.join(root, 'ACQUISITION-AND-RESTORE-RECEIPT.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return { ...receipt, artifacts: receipt.artifacts.length, target: root };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i += 2) {
      check(['--point', '--target', '--offline-root'].includes(args[i]) && args[i + 1] && !Object.hasOwn(options, args[i]), 'usage: --point EXACT_ID --target NEW_PRIVATE_DIRECTORY [--offline-root OBJECT_MIRROR]');
      options[args[i]] = args[i + 1];
    }
    check(options['--target'], 'new_private_target_required');
    const result = await recover({ point: options['--point'], target: options['--target'], offlineRoot: options['--offline-root'], progress: p => process.stderr.write(JSON.stringify(p) + '\n') });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(JSON.stringify({ ok: false, reason: error.message, full_system_restore_verified: false })); process.exitCode = 1; }
}
