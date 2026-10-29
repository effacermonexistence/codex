#!/usr/bin/env node
// Explicit local upgrade, never production deployment or credential migration.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Exact private OS-1 custody scope. Do not enumerate the support directory or
// copy another application's files, credentials, provider caches or models.
const pagingRoots = Object.freeze(['episodic-memory', 'memory-paging', 'context-budget.json', 'source-snapshots']);
const pagingRecoveryFormat = 'os1-private-paging-recovery-v1';
const safeRoot = root => {
  const resolved = path.resolve(root);
  assert.equal(fs.realpathSync(resolved), resolved, 'paging recovery root may not traverse a symlink');
  assert(fs.lstatSync(resolved).isDirectory(), 'paging recovery root must be a real directory');
  return resolved;
};
const allowedRelative = value => {
  assert(typeof value === 'string' && value.length && !value.includes('\\') && !value.includes('\0') &&
    value.split('/').every(part => part && part !== '.' && part !== '..') &&
    pagingRoots.includes(value.split('/')[0]), 'paging recovery path outside exact allowlist');
  return value;
};
const pagingPath = (root, relative) => path.join(root, ...allowedRelative(relative).split('/'));
const present = file => {
  try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
// Streaming SHA avoids holding whole historical transcripts in installer RAM.
// O_NOFOLLOW and descriptor/path identity checks reject link and write races.
const fileIntegrity = file => {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd);
    assert(before.isFile() && before.nlink === 1 && Number.isSafeInteger(before.size), 'paging state must be an unaliased regular file');
    const digest = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
    let bytes = 0, count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      bytes += count; digest.update(buffer.subarray(0, count));
    }
    const after = fs.fstatSync(fd), named = fs.lstatSync(file);
    assert(!named.isSymbolicLink() && before.dev === named.dev && before.ino === named.ino &&
      before.size === bytes && after.size === bytes && before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs, 'paging file changed during integrity read');
    return { bytes, sha256: digest.digest('hex') };
  } finally { fs.closeSync(fd); }
};
const pagingInventory = root => {
  safeRoot(root);
  const roots = [], entries = [];
  const walk = relative => {
    const file = pagingPath(root, relative), stat = fs.lstatSync(file);
    assert(!stat.isSymbolicLink(), 'paging snapshot never follows a symlink');
    if (stat.isDirectory()) {
      entries.push({ path: relative, kind: 'directory', bytes: 0, sha256: null });
      for (const name of fs.readdirSync(file).sort()) walk(relative + '/' + name);
    } else {
      assert(stat.isFile(), 'paging snapshot rejects special files');
      entries.push({ path: relative, kind: 'file', ...fileIntegrity(file) });
    }
  };
  for (const name of pagingRoots) {
    const exists = present(pagingPath(root, name));
    roots.push({ name, present: exists });
    if (exists) {
      const stat = fs.lstatSync(pagingPath(root, name));
      assert(name === 'context-budget.json' ? stat.isFile() : stat.isDirectory(), 'paging root has wrong type');
      walk(name);
    }
  }
  return { roots, entries };
};
const validatePagingManifest = manifest => {
  assert.equal(manifest.format, pagingRecoveryFormat, 'unknown paging recovery format');
  assert.deepEqual(manifest.roots.map(root => root.name), [...pagingRoots], 'paging manifest root scope changed');
  assert(manifest.roots.every(root => typeof root.present === 'boolean'), 'invalid root presence');
  const paths = new Set();
  for (const entry of manifest.entries) {
    allowedRelative(entry.path);
    assert(!paths.has(entry.path), 'duplicate paging manifest path'); paths.add(entry.path);
    assert(manifest.roots.find(root => root.name === entry.path.split('/')[0])?.present, 'entry under absent paging root');
    assert(['file', 'directory'].includes(entry.kind) && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0,
      'invalid paging manifest entry');
    assert(entry.kind === 'file' ? /^[a-f0-9]{64}$/.test(entry.sha256) : entry.sha256 === null && entry.bytes === 0,
      'invalid paging digest');
  }
};
export const verifyPagingRecoveryTree = (root, manifest, { allowAdditional = false, privateCopy = false } = {}) => {
  validatePagingManifest(manifest);
  const current = pagingInventory(root), byPath = new Map(current.entries.map(entry => [entry.path, entry]));
  for (const entry of manifest.entries) assert.deepEqual(byPath.get(entry.path), entry, 'archived paging state lost or changed: ' + entry.path);
  if (!allowAdditional) {
    assert.deepEqual(current.roots, manifest.roots, 'paging root presence changed');
    assert.deepEqual(current.entries, manifest.entries, 'paging inventory changed');
  }
  if (privateCopy) {
    for (const relative of ['', ...current.entries.map(entry => entry.path)]) {
      assert.equal(fs.lstatSync(relative ? pagingPath(root, relative) : root).mode & 0o077, 0, 'paging recovery must remain private');
    }
  }
  return { preservedFiles: manifest.entries.filter(entry => entry.kind === 'file').length,
    preservedBytes: manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0),
    additionalEntries: current.entries.length - manifest.entries.length };
};
// The byte copy (every build before 446, and the fallback): an exclusive
// 0600 file streamed from the O_NOFOLLOW source, fsynced.
const streamPagingFile = (sourceFile, destination) => {
  const input = fs.openSync(sourceFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let output;
  try {
    const sourceStat = fs.fstatSync(input);
    assert(sourceStat.isFile() && sourceStat.nlink === 1, 'paging copy source is not an unaliased file');
    output = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    const buffer = Buffer.alloc(64 * 1024); let count;
    while ((count = fs.readSync(input, buffer, 0, buffer.length, null)) > 0) {
      let offset = 0;
      while (offset < count) {
        const written = fs.writeSync(output, buffer, offset, count - offset, null);
        assert(written > 0, 'paging recovery write made no progress'); offset += written;
      }
    }
    fs.fsyncSync(output);
    const named = fs.lstatSync(sourceFile);
    assert(!named.isSymbolicLink() && named.dev === sourceStat.dev && named.ino === sourceStat.ino,
      'paging source identity changed during copy');
  } finally { fs.closeSync(input); if (output !== undefined) fs.closeSync(output); }
};
// Build 446 (DESIGN-5 §C, owner order 2026-10-29: "storage must stop piling
// up", never by deleting): new recovery copies are APFS CLONES. `cp -c`
// clones with clonefile(2), sharing every unchanged block, and itself falls
// back to a byte copy on a volume that cannot clone; `-n` never overwrites.
// Node's own copyFile cannot clone on macOS (COPYFILE_FICLONE_FORCE is
// ENOSYS there, measured 2026-10-29). One process per directory batch (the
// 445 snapshot held 22,017 files in 398 directories). Returns false only when
// the cloner cannot run at all (the caller then byte-copies, as before).
export const cloneIntoDirectory = (sources, directory, { cp = '/bin/cp' } = {}) => {
  const result = spawnSync(cp, ['-c', '-n', ...sources, directory + '/'],
    { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: 600000 });
  if (result.error?.code === 'ENOENT' || result.error?.code === 'EACCES') return false;
  assert.equal(result.status, 0, 'recovery clone failed: ' + String(result.stderr ?? result.error ?? '').slice(0, 200));
  return true;
};
// A single new file, cloned where the volume can (`cp -c -n`), else the
// exclusive copy it always was. Every caller verifies the bytes after.
export const cloneFileExclusive = (source, destination, { cp = '/bin/cp' } = {}) => {
  assert(!present(destination), 'clone destination already exists');
  const result = spawnSync(cp, ['-c', '-n', source, destination], { stdio: 'ignore', timeout: 600000 });
  if (result.status === 0 && present(destination)) return 'clone';
  assert(!present(destination), 'partial clone destination left behind');
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  return 'copy';
};
// Exported for the synthetic paging fixture only (temporary trees).
export const copyPagingTree = (from, to, manifest, { cloner = cloneIntoDirectory } = {}) => {
  safeRoot(from); safeRoot(path.dirname(to));
  assert(!present(to), 'paging recovery destination already exists');
  fs.mkdirSync(to, { mode: 0o700 });
  const batches = new Map();
  for (const entry of manifest.entries) {
    const destination = pagingPath(to, entry.path);
    if (entry.kind === 'directory') { fs.mkdirSync(destination, { mode: 0o700 }); continue; }
    assert.equal(fs.realpathSync(path.dirname(destination)), path.dirname(destination), 'paging destination parent changed');
    const sourceFile = pagingPath(from, entry.path);
    // The same source checks as the byte copy, before anything is copied.
    assert.deepEqual(fileIntegrity(sourceFile), { bytes: entry.bytes, sha256: entry.sha256 }, 'paging source changed before copy');
    const sourceStat = fs.lstatSync(sourceFile);
    assert(sourceStat.isFile() && !sourceStat.isSymbolicLink() && sourceStat.nlink === 1, 'paging copy source is not an unaliased file');
    const directory = path.dirname(destination);
    if (!batches.has(directory)) batches.set(directory, []);
    batches.get(directory).push({ entry, sourceFile, destination, dev: sourceStat.dev, ino: sourceStat.ino });
  }
  let cloning = true;
  for (const [directory, files] of batches) {
    for (let start = 0; start < files.length; start += 512) {
      const chunk = files.slice(start, start + 512);
      if (cloning) cloning = cloner(chunk.map(file => file.sourceFile), directory);
      for (const file of chunk) {
        if (cloning) {
          // A clone keeps the source's mode: the private copy is 0600, synced.
          const named = fs.lstatSync(file.sourceFile), cloned = fs.lstatSync(file.destination);
          assert(!named.isSymbolicLink() && named.dev === file.dev && named.ino === file.ino,
            'paging source identity changed during copy');
          assert(cloned.isFile() && !cloned.isSymbolicLink() && cloned.nlink === 1 && cloned.ino !== file.ino,
            'paging clone is not a private regular file');
          fs.chmodSync(file.destination, 0o600);
          const fd = fs.openSync(file.destination, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
          try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        } else streamPagingFile(file.sourceFile, file.destination);
        assert.deepEqual(fileIntegrity(file.destination), { bytes: file.entry.bytes, sha256: file.entry.sha256 },
          'paging copy digest/byte mismatch');
      }
    }
  }
  verifyPagingRecoveryTree(to, manifest, { privateCopy: true });
};

/// Snapshot and a staged restore drill, never activation or live data replay.
/// Exported so synthetic temporary fixtures can test this without installing.
export const backupPagingState = ({ supportRoot, recoveryRoot }) => {
  const sourceRoot = safeRoot(supportRoot), privateRecovery = safeRoot(recoveryRoot);
  assert.equal(fs.lstatSync(privateRecovery).mode & 0o077, 0, 'recovery directory must be private');
  const manifest = { format: pagingRecoveryFormat, capturedAt: new Date().toISOString(),
    sourceRoot, ...pagingInventory(sourceRoot), liveRestoreAuthorized: false };
  const backup = path.join(privateRecovery, 'paging-state');
  copyPagingTree(sourceRoot, backup, manifest);
  verifyPagingRecoveryTree(sourceRoot, manifest); // no mixed-time snapshot
  const manifestFile = path.join(privateRecovery, 'paging-state-manifest.json');
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  const manifestFD = fs.openSync(manifestFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(manifestFD, manifestBytes); fs.fsyncSync(manifestFD); } finally { fs.closeSync(manifestFD); }
  const manifestIntegrity = fileIntegrity(manifestFile);
  assert.deepEqual(manifestIntegrity, { bytes: manifestBytes.length,
    sha256: createHash('sha256').update(manifestBytes).digest('hex') }, 'written paging manifest changed');
  const restored = path.join(privateRecovery, 'paging-state-restore-drill');
  copyPagingTree(backup, restored, manifest);
  // The drill ends in a read-only private tree, not a runnable/live memory store.
  for (const entry of [...manifest.entries].reverse()) {
    fs.chmodSync(pagingPath(restored, entry.path), entry.kind === 'directory' ? 0o500 : 0o400);
  }
  fs.chmodSync(restored, 0o500);
  const preservation = verifyPagingRecoveryTree(restored, manifest, { privateCopy: true });
  verifyPagingRecoveryTree(backup, manifest, { privateCopy: true });
  verifyPagingRecoveryTree(sourceRoot, manifest);
  return { manifest, receipt: { format: pagingRecoveryFormat, manifestFile, ...manifestIntegrity,
    backup, roots: manifest.roots, ...preservation,
    restoreDrill: { path: restored, status: 'PASS', readOnly: true, completedAt: new Date().toISOString(), liveActivated: false } } };
};

// Fleet's original loaded state does not grant or remove rollback authority.
// A newly failed paging gate still permits recovery of unadopted binaries when
// fresh quiescence is established. Never replay live session/memory snapshots.
export const binaryRollbackPermitted = ({ appStopped, pagingQuiesced: quiesced, rccQuiesced, anyBinaryMoved }) =>
  appStopped === true && quiesced === true && rccQuiesced === true && anyBinaryMoved === true;

const readPrivateRCCReceipt = file => {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    assert(st.isFile() && st.nlink === 1 && st.uid === process.getuid() &&
      (st.mode & 0o077) === 0 && st.size > 0 && st.size <= 16384, 'RCC quiescence receipt custody');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
};

// Used for both directions. The executable is the currently installed CLI,
// never the staged candidate or restored predecessor. The native helper owns
// PID/start-time/source binding and refuses active/unresolved work. This helper
// neither signals a PID nor deletes the durable core database or queued tasks.
// Injectable I/O permits offline fixtures without a real CLI or HOME access.
export const quiesceRCCCoreForBinaryChange = ({ home, cli, execute,
  exists = present, readReceipt = readPrivateRCCReceipt, processRows = os1ProcessRows }) => {
  const core = path.join(home, '.os1/rcc-runtime');
  const owner = path.join(core, 'transport-owner.json');
  const starting = path.join(core, 'transport-starting.json');
  const requireNativeIdle = () => {
    const executables = [path.join(home, '.local/bin/os1'),
      path.join(home, 'Applications/OS-1 CLODEX.app/Contents/Resources/os1')];
    const active = [];
    for (const row of processRows()) {
      const match = row.trim().match(/^([1-9]\d*)\s+(.+)$/);
      assert(match, 'RCC native process inventory malformed');
      if (executables.some(exe => match[2].startsWith(exe + ' ') &&
          /^rcc-adapter(?:\s|$)/.test(match[2].slice(exe.length + 1)))) active.push(Number(match[1]));
    }
    // Only public PID identities enter the failure receipt, never private
    // ticket paths/arguments. A predecessor's native child may outlive its
    // Gateway, so absence of owner metadata alone is insufficient.
    assert.equal(active.length, 0, `RCC native executor still active (${active.join(',')}); leave installation unchanged`);
  };
  requireNativeIdle();
  if (!exists(owner) && !exists(starting)) return { schema: 1, hadGateway: false };
  assert.equal(cli, path.join(home, '.local/bin/os1'), 'RCC quiescence must use the current installed CLI');
  assert.equal(typeof execute, 'function', 'RCC quiescence executor unavailable');
  const quiet = JSON.parse(execute(cli, ['rcc-quiesce'], 180000));
  assert.equal(quiet.schema, 1, 'RCC quiescence receipt schema');
  assert.equal(quiet.hadGateway, true, 'existing RCC owner was not verified');
  assert(typeof quiet.requestID === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(quiet.requestID), 'RCC quiescence request identity');
  assert(Number.isInteger(quiet.ownerPID) && quiet.ownerPID > 1, 'RCC quiescence owner identity');
  assert(Number.isInteger(quiet.queuedTasks) && quiet.queuedTasks >= 0, 'RCC queued-task preservation count');
  assert.equal(quiet.receiptPath, path.join(core, 'upgrade-receipts', `quiescence-${quiet.requestID}.json`),
    'RCC quiescence receipt is outside private owner custody');
  const evidence = readReceipt(quiet.receiptPath);
  assert(evidence.schema === 1 && evidence.request_id === quiet.requestID &&
    evidence.owner_pid === quiet.ownerPID && evidence.active_dispatches === 0 &&
    evidence.safe_to_stop === true && evidence.queued_preserved === true &&
    evidence.queued_tasks === quiet.queuedTasks &&
    /^[a-f0-9]{64}$/.test(evidence.identity_sha256) &&
    /^[a-f0-9]{64}$/.test(evidence.configuration_sha256) &&
    /^[a-f0-9]{64}$/.test(evidence.quiescence_rpc_sha256), 'RCC quiescence evidence incomplete');
  assert(!exists(owner), 'RCC owner still active; no binary replacement');
  assert(!exists(starting), 'RCC startup intent unresolved; no binary replacement');
  requireNativeIdle();
  return quiet;
};

// Discover only OS-1 process names, then inspect only those PIDs. A local
// upgrade has no authority to read another application's process arguments.
// A failed discovery is not proof of quiescence; only pgrep's no-match status
// and the candidate-exited ps status may produce an empty inventory.
export const os1ProcessRows = (execute = spawnSync, isGone = pid => {
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}) => {
  const options = { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'] };
  // Include ancestors as well: a self-update can be launched by OS-1 itself.
  const names = execute('/usr/bin/pgrep', ['-a', '-x', '(OS1App|os1)'], options);
  assert(!names.error, 'OS-1 PID discovery failed');
  if (names.status === 1) {
    assert(!names.stdout.trim() && !names.stderr?.trim(), 'OS-1 PID discovery returned diagnostics');
    return [];
  }
  assert.equal(names.status, 0, 'OS-1 PID discovery failed');
  const ids = names.stdout.trim().split(/\s+/);
  assert(ids.length && ids.every(id => /^[1-9]\d*$/.test(id)), 'invalid OS-1 PID inventory');
  const rows = execute('/bin/ps', ['-p', [...new Set(ids)].join(','), '-o', 'pid=,args='], options);
  assert(!rows.error, 'OS-1 process inspection failed');
  if (rows.status === 1) {
    assert(!rows.stdout.trim() && !rows.stderr?.trim() && ids.every(id => isGone(Number(id))),
      'OS-1 process inspection failed without proof that candidates exited');
    return [];
  }
  assert.equal(rows.status, 0, 'OS-1 process inspection failed');
  return rows.stdout.split('\n').filter(line => line.trim());
};

const predecessorFormat = 'os1-install-predecessor-v1';
const predecessorKeys = Object.freeze(['format', 'app', 'cli', 'cliConfig', 'build', 'version',
  'sourceCommit', 'appExecutableSHA256', 'appInfoSHA256', 'appResourceCLISHA256',
  'appConfigSHA256', 'cliSHA256', 'cliConfigSHA256']);
const validatePredecessor = value => {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'invalid expected predecessor');
  assert.deepEqual(Object.keys(value).sort(), [...predecessorKeys].sort(), 'unexpected predecessor fields');
  assert.equal(value.format, predecessorFormat, 'unknown expected predecessor format');
  for (const key of ['app', 'cli', 'cliConfig']) {
    assert(typeof value[key] === 'string' && path.isAbsolute(value[key]) &&
      path.resolve(value[key]) === value[key] && !value[key].includes('\0'), 'invalid predecessor target path');
  }
  assert(/^\d+$/.test(value.build) && typeof value.build === 'string', 'invalid predecessor build');
  assert(typeof value.version === 'string' && /^\d+\.\d+\.\d+$/.test(value.version), 'invalid predecessor version');
  assert(value.sourceCommit === null || (typeof value.sourceCommit === 'string' && /^[a-f0-9]{40}$/.test(value.sourceCommit)),
    'invalid predecessor source identity');
  for (const key of predecessorKeys.filter(key => key.endsWith('SHA256'))) {
    assert((key === 'cliConfigSHA256' && value[key] === null) ||
      (typeof value[key] === 'string' && /^[a-f0-9]{64}$/.test(value[key])), 'invalid predecessor fingerprint');
  }
  return value;
};

// A hash-only installation precondition, never a source of configuration,
// credentials, or authority to bypass idle/preservation/signing checks.
// Injectable Info reads and temporary paths allow fixtures without HOME access.
export const captureInstalledPredecessor = ({ app, cli, cliConfig,
  readInfo = file => JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file],
    { encoding: 'utf8', timeout: 60000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] })) }) => {
  for (const target of [app, cli, cliConfig]) {
    assert(typeof target === 'string' && path.isAbsolute(target) && path.resolve(target) === target,
      'predecessor capture requires exact absolute paths');
  }
  assert.equal(fs.realpathSync(app), app, 'predecessor app may not traverse a symlink');
  const infoFile = path.join(app, 'Contents/Info.plist');
  const beforeInfo = fileIntegrity(infoFile).sha256;
  const info = readInfo(infoFile);
  const value = {
    format: predecessorFormat, app, cli, cliConfig,
    build: String(info.CFBundleVersion), version: String(info.CFBundleShortVersionString),
    sourceCommit: info.OS1SourceCommit ?? null,
    appExecutableSHA256: fileIntegrity(path.join(app, 'Contents/MacOS/OS1App')).sha256,
    appInfoSHA256: beforeInfo,
    appResourceCLISHA256: fileIntegrity(path.join(app, 'Contents/Resources/os1')).sha256,
    appConfigSHA256: fileIntegrity(path.join(app, 'Contents/Resources/config.json')).sha256,
    cliSHA256: fileIntegrity(cli).sha256,
    cliConfigSHA256: present(cliConfig) ? fileIntegrity(cliConfig).sha256 : null,
  };
  assert.equal(fileIntegrity(infoFile).sha256, beforeInfo, 'predecessor metadata changed during capture');
  return validatePredecessor(value);
};

// Pure comparison. Errors expose field names only, never configuration bytes.
export const verifyExpectedPredecessor = (expected, observed) => {
  validatePredecessor(expected); validatePredecessor(observed);
  for (const key of predecessorKeys) {
    assert.deepEqual(observed[key], expected[key], `installed predecessor changed (${key}); leave installation unchanged`);
  }
  return { format: predecessorFormat, matched: true, build: observed.build, sourceCommit: observed.sourceCommit };
};

export const readExpectedPredecessor = file => {
  assert(typeof file === 'string' && path.isAbsolute(file) && path.resolve(file) === file,
    'expected predecessor must be an exact absolute path');
  assert.equal(fs.realpathSync(file), file, 'expected predecessor may not traverse a symlink');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd);
    assert(before.isFile() && before.nlink === 1 && before.uid === process.getuid() &&
      (before.mode & 0o077) === 0 && before.size > 0 && before.size <= 16384,
      'expected predecessor must be a private owned regular file');
    let value;
    try { value = JSON.parse(fs.readFileSync(fd, 'utf8')); }
    catch { throw new Error('expected predecessor is not valid JSON'); }
    const after = fs.fstatSync(fd), named = fs.lstatSync(file);
    assert(!named.isSymbolicLink() && before.dev === named.dev && before.ino === named.ino &&
      before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
      'expected predecessor changed during read');
    return validatePredecessor(value);
  } finally { fs.closeSync(fd); }
};

async function install() {

const [sourceArg, recoveryArg, expectedBuild, ...options] = process.argv.slice(2);
assert(sourceArg && recoveryArg && /^\d+$/.test(expectedBuild), 'staged-app new-private-recovery-dir expected-build');
assert.equal(new Set(options).size, options.length, 'duplicate install option');
const predecessorOptions = options.filter(option => option.startsWith('--expected-predecessor='));
assert(predecessorOptions.length <= 1, 'duplicate expected predecessor option');
assert(options.every(option => ['--preserve-queue', '--allow-local-signer-rotation'].includes(option) ||
  option.startsWith('--expected-predecessor=')), 'unknown install option');
const expectedPredecessor = predecessorOptions.length
  ? readExpectedPredecessor(predecessorOptions[0].slice('--expected-predecessor='.length)) : null;
const preserveQueue = options.includes('--preserve-queue');
const allowLocalSignerRotation = options.includes('--allow-local-signer-rotation');
const source = fs.realpathSync(sourceArg), home = os.homedir();
const recovery = path.resolve(recoveryArg), app = path.join(home, 'Applications/OS-1 CLODEX.app');
const cli = path.join(home, '.local/bin/os1'), resource = path.join(source, 'Contents/Resources/os1');
// The stable CLI reads the config beside it (and the Fleet agent points
// OS1_CONFIG at it). It must be the app's config: until build 235 this file
// was never replaced, so the CLI kept a 2026-09-13 config.
const cliConfig = path.join(path.dirname(cli), 'config.json'), sourceConfig = path.join(source, 'Contents/Resources/config.json');
const store = path.join(home, 'Library/Application Support/OS-1/sessions.json');
const pagingSupportRoot = path.dirname(store);
const fleetRoot = path.join(home, '.os1/fleet');
const service = `gui/${process.getuid()}/com.os1.fleet-agent`;
const plist = path.join(home, 'Library/LaunchAgents/com.os1.fleet-agent.plist');
// Queue repair upgrades may preserve a stranded queue. They must never clear,
// reorder or execute it: OS1 reloads every saved entry under a restart hold.
const maintenanceLease = path.join(home, '.os1/self-update/install-maintenance.pid');
const originalQueue = JSON.parse(fs.readFileSync(store)).queued ?? [];
assert(recovery.startsWith(path.join(home, '.os1/recovery/') ) && !fs.existsSync(recovery));
assert(!fs.lstatSync(app).isSymbolicLink() && !fs.lstatSync(cli).isSymbolicLink());
const run = (exe, args, timeout = 60000) => execFileSync(exe, args, {
  encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});
// `open` hands its own environment to the app it launches. An install run from
// inside a Claude Code or Codex session (CLAUDECODE, CLAUDE_CODE_SESSION_ID …)
// relaunched OS-1 as that session's child and its Claude probes reported
// "signed out". Relaunch with the environment a Finder launch would have.
const guiEnvironment = () => Object.fromEntries(Object.entries({
  HOME: home, USER: process.env.USER, LOGNAME: process.env.LOGNAME, SHELL: process.env.SHELL,
  TMPDIR: process.env.TMPDIR, __CF_USER_TEXT_ENCODING: process.env.__CF_USER_TEXT_ENCODING,
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
}).filter(([, value]) => typeof value === 'string' && value.length));
const launchApp = () => execFileSync('/usr/bin/open', ['-g', app], {
  encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], env: guiEnvironment(),
});
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const appPIDs = () => os1ProcessRows().flatMap(line => {
  const match = line.trim().match(/^(\d+)\s+(.*)$/);
  return match && match[2] === path.join(app, 'Contents/MacOS/OS1App') ? [Number(match[1])] : [];
});
const requirement = file => {
  const result = spawnSync('/usr/bin/codesign', ['-d', '-r-', file], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const line = (result.stdout + result.stderr).split('\n').find(s => s.startsWith('designated => '));
  assert(line); return line;
};
const idle = () => {
  const state = JSON.parse(fs.readFileSync(store));
  assert.equal((state.inFlight ?? []).length, 0, 'active user task; leave the installation unchanged');
  if (preserveQueue) assert.deepEqual(state.queued ?? [], originalQueue, 'queue changed during installation');
  else assert.equal((state.queued ?? []).length, 0, 'queued user task; leave the installation unchanged');
  for (const name of ['main-agent-active.json', 'main-agent-claim.json']) {
    assert(!fs.existsSync(path.join(fleetRoot, name)), 'Fleet work/claim unresolved; do not interrupt it');
  }
};
// Legacy staged GUI copies can overwrite the same session store. Do not install through an unquiesced writer.
const foreignWriters = () => os1ProcessRows().filter(line => {
  const match = line.trim().match(/^(\d+)\s+(.*)$/);
  return match && match[2].endsWith('/Contents/MacOS/OS1App') && match[2] !== path.join(app, 'Contents/MacOS/OS1App');
});
// A provider-owned memory MCP child can outlive its GUI. Do not snapshot a
// store still being served, kill that child, or assume GUI idle means no writer.
const memoryWriters = () => os1ProcessRows().filter(line => {
  const match = line.trim().match(/^(\d+)\s+(.*)$/);
  return match && Number(match[1]) !== process.pid && /(?:^|\/)(?:os1|OS1App)\s+memory-mcp(?:\s|$)/.test(match[2]);
});
const pagingQuiesced = () => {
  idle();
  assert.equal(appPIDs().length, 0, 'installed GUI is a possible paging writer');
  assert.equal(foreignWriters().length, 0, 'foreign OS-1 GUI is a possible paging writer');
  assert.equal(memoryWriters().length, 0, 'memory MCP child still running; do not snapshot or interrupt it');
};
assert.equal(foreignWriters().length, 0, 'non-installed OS1 writer is running; leave installation unchanged');
const oldRequirement = requirement(app);
const sourceRequirement = requirement(source);
const signerRotation = sourceRequirement !== oldRequirement;
assert(!signerRotation || allowLocalSignerRotation,
  'signer continuity required; a verified new-device local signer rotation must be explicit');
assert.equal(run('/usr/bin/plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', path.join(source, 'Contents/Info.plist')]).trim(), expectedBuild);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', source]);
run('/usr/bin/codesign', ['--verify', '--strict', resource]);
assert(run(resource, ['version']).includes(`build${expectedBuild}`));
// Acquire the maintenance lease before draining; repeated recovery must not
// race an idle observation. The mandatory idle gate remains before quit/swap.
const wasRunning = appPIDs();
const fleetLoaded = spawnSync('/bin/launchctl', ['print', service], { stdio: 'ignore' }).status === 0;
fs.mkdirSync(recovery, { mode: 0o700 });
const stageApp = path.join(path.dirname(app), `.os1-verified-${expectedBuild}-${process.pid}.app`);
const stageCLI = path.join(path.dirname(cli), `.os1-verified-${expectedBuild}-${process.pid}`);
const stageConfig = path.join(path.dirname(cli), `.os1-verified-${expectedBuild}-${process.pid}.config.json`);
assert(!fs.existsSync(stageApp) && !fs.existsSync(stageCLI) && !fs.existsSync(stageConfig));
assert(!fs.existsSync(cliConfig) || !fs.lstatSync(cliConfig).isSymbolicLink());
const backupApp = path.join(recovery, 'OS-1 CLODEX.app'), backupCLI = path.join(recovery, 'os1');
const backupConfig = path.join(recovery, 'config.json');
let paused = false, appMoved = false, cliMoved = false, configMoved = false, configInstalled = false, activated = false;
let pagingManifest;
let predecessorGuardFailed = false;
const checkExpectedPredecessor = () => {
  try {
    return verifyExpectedPredecessor(expectedPredecessor,
      captureInstalledPredecessor({ app, cli, cliConfig }));
  } catch (error) { predecessorGuardFailed = true; throw error; }
};
const receipt = { startedAt: new Date().toISOString(), build: expectedBuild, app, recovery,
  previousAppHash: hash(path.join(app, 'Contents/MacOS/OS1App')), previousCLIHash: hash(cli),
  stagedAppHash: hash(path.join(source, 'Contents/MacOS/OS1App')), stagedCLIHash: hash(resource),
  previousCLIConfigHash: fs.existsSync(cliConfig) ? hash(cliConfig) : null, stagedCLIConfigHash: hash(sourceConfig),
  previousRequirement: oldRequirement, sourceRequirement, signerRotation,
  signerRotationAuthorized: allowLocalSignerRotation, checks: [] };
try {
  fs.mkdirSync(path.dirname(maintenanceLease), { recursive: true, mode: 0o700 });
  if (fs.existsSync(maintenanceLease)) {
    const pid = Number(fs.readFileSync(maintenanceLease, 'utf8').trim());
    let alive = false;
    if (Number.isInteger(pid) && pid > 1) { try { process.kill(pid, 0); alive = true; } catch {} }
    assert(!alive, 'another installer owns maintenance lease');
    fs.unlinkSync(maintenanceLease);
  }
  fs.writeFileSync(maintenanceLease, String(process.pid), { mode: 0o600, flag: 'wx' });
  if (expectedPredecessor) {
    receipt.predecessorAfterLease = checkExpectedPredecessor();
    receipt.checks.push('expected predecessor identity after maintenance lease: PASS');
  }
  // Build 446 (DESIGN-5 §C): staged copies are APFS clones where possible
  // (`ditto --clone`, `cp -c`); the hash, signature and drill checks below
  // are unchanged, and a clone is byte-identical.
  run('/usr/bin/ditto', ['--clone', source, stageApp]);
  cloneFileExclusive(resource, stageCLI); fs.chmodSync(stageCLI, 0o755);
  cloneFileExclusive(sourceConfig, stageConfig); fs.chmodSync(stageConfig, 0o644);
  assert.equal(hash(stageConfig), receipt.stagedCLIConfigHash);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', stageApp]);
  assert.equal(hash(stageCLI), receipt.stagedCLIHash);
  // A maintenance task may already be scheduled when the lease is acquired.
  // Drain it naturally; never cancel user work or erase its persisted receipt.
  let quietSince = Date.now();
  const drainDeadline = Date.now() + 180000;
  while (Date.now() - quietSince < 10000) {
    const state = JSON.parse(fs.readFileSync(store));
    if ((state.inFlight ?? []).length) quietSince = Date.now();
    assert(Date.now() < drainDeadline, 'active task did not drain; leave installation unchanged');
    await wait(250);
  }
  idle();
  if (fleetLoaded) { run('/bin/launchctl', ['bootout', service]); paused = true; }
  idle(); // catches a claim racing with bootout, before any binary replacement
  receipt.rccQuiescence = quiesceRCCCoreForBinaryChange({ home, cli, execute: run });
  receipt.checks.push('authoritative OpenClaw core idle/quiesced; queued tasks preserved: PASS');
  for (const pid of wasRunning) {
    run('/usr/bin/swift', ['-e', `import AppKit; guard let a = NSRunningApplication(processIdentifier: ${pid}), a.bundleURL?.path == ${JSON.stringify(app)} else { exit(1) }; if !a.terminate() { exit(2) }`]);
  }
  for (let i = 0; appPIDs().length && i < 40; i++) await wait(250);
  assert.equal(appPIDs().length, 0, 'app did not quit; no force-kill');
  pagingQuiesced();
  const before = fs.readFileSync(store); const original = JSON.parse(before);
  fs.writeFileSync(path.join(recovery, 'sessions-at-install.json'), before, { mode: 0o600, flag: 'wx' });
  receipt.sessionsAtInstall = { sha256: createHash('sha256').update(before).digest('hex'), bytes: before.length };
  const paging = backupPagingState({ supportRoot: pagingSupportRoot, recoveryRoot: recovery });
  pagingManifest = paging.manifest; receipt.pagingStateRecovery = paging.receipt;
  receipt.checks.push('private paging snapshot + SHA-256/byte manifest + read-only staged restore drill: PASS (not live activation)');
  pagingQuiesced();
  assert.deepEqual(JSON.parse(fs.readFileSync(store)), original, 'session store changed during paging backup');
  if (expectedPredecessor) {
    receipt.predecessorBeforeSwap = checkExpectedPredecessor();
    receipt.checks.push('expected predecessor identity immediately before binary replacement: PASS');
  }
  fs.renameSync(app, backupApp); appMoved = true;
  fs.renameSync(stageApp, app);
  fs.renameSync(cli, backupCLI); cliMoved = true;
  fs.renameSync(stageCLI, cli);
  if (fs.existsSync(cliConfig)) { fs.renameSync(cliConfig, backupConfig); configMoved = true; }
  fs.renameSync(stageConfig, cliConfig); configInstalled = true;
  assert.equal(hash(cliConfig), receipt.stagedCLIConfigHash);
  receipt.checks.push('cli config matches the app config: PASS');
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  assert.equal(requirement(app), sourceRequirement);
  assert.equal(hash(cli), receipt.stagedCLIHash);
  for (const [label, exe, args] of [
    ['runtime', cli, ['self-test']], ['app', path.join(app, 'Contents/MacOS/OS1App'), ['--self-test']],
    ['queue', path.join(app, 'Contents/MacOS/OS1App'), ['--self-test-sidebar-queue']],
    ['parallel', path.join(app, 'Contents/MacOS/OS1App'), ['--self-test-parallel']], ['fleet', cli, ['fleet-self-test']],
    ['queue-fork', path.join(app, 'Contents/MacOS/OS1App'), ['--self-test-queue-fork']],
    ['composer', path.join(app, 'Contents/MacOS/OS1App'), ['--self-test-composer']],
    ['steering', path.join(app, 'Contents/MacOS/OS1App'), ['--self-test-steering']],
  ]) {
    // The complete model-free CLI suite now takes ~60s on the measured Air.
    // This bound is ONLY local validation; never change provider/action deadlines.
    const validationTimeoutMS = label === 'runtime' ? 180000 : 60000;
    const validationStarted = Date.now();
    fs.writeFileSync(path.join(recovery, `${label}-test.log`), run(exe, args, validationTimeoutMS), { mode: 0o600 });
    (receipt.validationTimings ??= {})[label] = { elapsedMS: Date.now() - validationStarted, timeoutMS: validationTimeoutMS };
    receipt.checks.push(`${label}: PASS`);
  }
  // Content equality, not byte equality: a relaunched app (the user reopening
  // OS-1 mid-install) re-encodes the store with different key order. Any real
  // change — a session, message, queue or flag — still fails here, and the
  // per-session preservation checks below re-verify every message.
  assert.deepEqual(JSON.parse(fs.readFileSync(store)), original, 'verification changed the real session store');
  pagingQuiesced();
  receipt.pagingStateBeforeResume = verifyPagingRecoveryTree(pagingSupportRoot, pagingManifest);
  receipt.checks.push('paging state unchanged after binary verification, before worker resume: PASS');
  if (paused) { run('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist]); paused = false; }
  if (wasRunning.length) launchApp();
  await wait(3000);
  const after = JSON.parse(fs.readFileSync(store));
  assert.deepEqual(after.queued ?? [], originalQueue, 'installation changed or ran a queued request');
  assert.equal((after.inFlight ?? []).length, 0, 'installation started a request');
  for (const previous of original.sessions) {
    const current = after.sessions.find(s => s.id === previous.id); assert(current, 'conversation lost');
    for (const key of ['workspace', 'title', 'draft', 'pinnedAt', 'sidebarPosition', 'archived', 'codexSessionID', 'claudeSessionID']) {
      assert.deepEqual(current[key], previous[key], `session field changed: ${key}`);
    }
    for (const message of previous.messages) {
      const found = current.messages.find(m => m.id === message.id); assert(found, 'existing message lost');
      const copy = { ...found };
      if (copy.nativeManagedTurnID !== message.nativeManagedTurnID) {
        assert(typeof copy.nativeManagedTurnID === 'string' &&
          (message.nativeIngestedID || (message.role === 'receipt' &&
            ['OS-1 외부 작업, 채택 판정 아님', 'outside OS-1, not an adoption verdict'].some(marker => message.text.includes(marker)))),
          'only proven managed imports may acquire a provenance marker');
        if (message.nativeManagedTurnID === undefined) delete copy.nativeManagedTurnID;
        else copy.nativeManagedTurnID = message.nativeManagedTurnID;
      }
      if (copy.steeringDelivery !== message.steeringDelivery) {
        // A restart can only settle a steered input that was still being
        // handed over into a terminal state. The text, ID, role and time stay
        // fixed, and a delivery that was already confirmed is never rewritten.
        assert(['waiting', 'pending'].includes(message.steeringDelivery) &&
          ['delivered', 'rejected', 'undelivered'].includes(copy.steeringDelivery),
          'only an in-flight steering hand-off may change state across install');
        copy.steeringDelivery = message.steeringDelivery;
      }
      assert.deepEqual(copy, message, 'existing message bytes/role/ID/time changed');
    }
  }
  receipt.sessionCountBefore = original.sessions.length; receipt.sessionCountAfter = after.sessions.length;
  receipt.checks.push('existing conversations/messages/pins/drafts/native bindings: PASS');
  receipt.pagingStateAfterRestart = verifyPagingRecoveryTree(pagingSupportRoot, pagingManifest, { allowAdditional: true });
  receipt.checks.push('existing paging originals, state, config and capability snapshots preserved after restart: PASS');
  if (wasRunning.length) assert(appPIDs().length > 0, 'new app is not running');
  if (fleetLoaded) {
    const fleet = run('/bin/launchctl', ['print', service]);
    assert(/state = running/.test(fleet), 'Fleet did not restart');
    receipt.fleetPID = Number(fleet.match(/\bpid = (\d+)/)?.[1]);
  }
  activated = true; receipt.completedAt = new Date().toISOString();
} catch (error) {
  receipt.error = String(error.stack || error);
  // No rollback of sessions: the user may have added newer work. If a restarted
  // process is using the new image, leave both verified binary versions in
  // custody for reconciliation rather than moving a live executable.
  let rollbackQuiesced = false, rollbackCoreQuiesced = false;
  if (predecessorGuardFailed) {
    // Both optional preconditions precede every rename. Never invoke a changed
    // predecessor CLI to "repair" a rejected precondition or replay snapshots.
    assert(!appMoved && !cliMoved && !configMoved && !configInstalled);
    receipt.predecessorRejected = true;
  } else {
    try {
      pagingQuiesced(); rollbackQuiesced = true;
      // A persistent new Gateway can survive the failed GUI. Retire it through
      // the CURRENT new CLI before moving any new binary back to recovery.
      receipt.rccRollbackQuiescence = quiesceRCCCoreForBinaryChange({ home, cli, execute: run });
      rollbackCoreQuiesced = true;
    }
    catch (quiescenceError) { receipt.binaryRollbackBlocked = String(quiescenceError.message || quiescenceError); }
  }
  if (binaryRollbackPermitted({ appStopped: appPIDs().length === 0, pagingQuiesced: rollbackQuiesced,
    rccQuiesced: rollbackCoreQuiesced,
    anyBinaryMoved: appMoved || cliMoved || configMoved || configInstalled })) {
    if (cliMoved) { if (fs.existsSync(cli)) fs.renameSync(cli, path.join(recovery, 'unadopted-os1')); fs.renameSync(backupCLI, cli); }
    if (configInstalled && fs.existsSync(cliConfig)) fs.renameSync(cliConfig, path.join(recovery, 'unadopted-config.json'));
    if (configMoved) fs.renameSync(backupConfig, cliConfig);
    if (appMoved) { if (fs.existsSync(app)) fs.renameSync(app, path.join(recovery, 'unadopted-app.app')); fs.renameSync(backupApp, app); }
    receipt.binaryRollback = true;
  }
  throw error;
} finally {
  if (fs.existsSync(maintenanceLease) && fs.readFileSync(maintenanceLease, 'utf8').trim() === String(process.pid)) fs.unlinkSync(maintenanceLease);
  if (fs.existsSync(stageConfig)) fs.rmSync(stageConfig);
  // Recovery errors must not suppress the original failure receipt.
  try {
    if (paused) run('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist]);
    if ((receipt.binaryRollback || (predecessorGuardFailed && !appMoved && appPIDs().length === 0)) && wasRunning.length) launchApp();
  } catch (error) { receipt.recoveryError = String(error.stack || error); }
  fs.writeFileSync(path.join(recovery, 'install-receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(recovery, 'RECOVERY.md'),
    '# Local binary and private paging recovery\n\nPrevious app and CLI are preserved here. Stop OS1 only when idle before restoring these binaries. Never replace the current sessions.json with sessions-at-install.json: it is evidence, not permission to discard newer conversations. Authentication caches were not copied.\n\nPaging recovery covers only episodic-memory, memory-paging, context-budget.json and source-snapshots under the OS-1 support directory. See paging-state-manifest.json for every SHA-256 and byte count, and install-receipt.json for the actual drill outcome. paging-state is the private backup; paging-state-restore-drill is a separate read-only integrity-verified reconstruction. Neither is a live activation. Do not run a runtime against the read-only drill, overwrite newer live memory, replay the old session snapshot or widen the restore to another application. A live data restoration needs separate authority, exact target/quiescence (including memory MCP children), a fresh current-data backup and collision reconciliation. Binary rollback deliberately leaves current sessions and memory untouched. No Handy directories, provider authentication caches or credentials were read by paging recovery.\n', { mode: 0o600 });
}
assert(activated); console.log(JSON.stringify(receipt));
}

// Importing the recovery helpers for a fixture performs no installation and
// never reads HOME, sessions.json, credentials or another application's data.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await install();
