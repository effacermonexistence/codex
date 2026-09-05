import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { POINT, ROOTS, safeRelative, reference, mergeReferences, digest, verify,
  newDirectory, validateArchive, verifyCanonical, stateTree, recover, verifyFinalArtifacts } from './recover-v151.mjs';

// Generated synthetic fixtures only. Never production files or user directories.
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'scv-recovery-test-')));
  t.after(() => fs.rmSync(root, { recursive: true })); return root;
}
function write(root, name, contents) {
  const file = path.join(root, name); fs.writeFileSync(file, contents, { mode: 0o600, flag: 'wx' }); return file;
}
for (const value of ['', '../x', '/tmp/x', 'x/../y', 'x//y', 'x/./y', 'x\\y', 'x\ny', 'x;cmd', 'x/']) {
  test('reject path ' + JSON.stringify(value), () => assert.throws(() => safeRelative(value), /unsafe/));
}
test('ordinary relative paths and hidden files accepted', () => {
  assert.equal(safeRelative('directory/.dockerignore'), 'directory/.dockerignore');
});
test('references are pinned, scoped and deduplicated without conflict', () => {
  assert.equal(mergeReferences([ROOTS[0], ROOTS[0]]).length, 1);
  assert.throws(() => mergeReferences([ROOTS[0], { ...ROOTS[0], bytes: 2 }]), /conflict/);
  assert.throws(() => reference({ ...ROOTS[0], sha256: 'bad' }), /invalid/);
  assert.throws(() => reference({ ...ROOTS[0], bytes: 0 }), /invalid/);
  assert.throws(() => reference({ ...ROOTS[0], key: 'unrelated/data.json' }), /prefix/);
});
test('byte corruption fails verification', t => {
  const root = fixture(t), file = write(root, 'data', 'saved');
  const pin = { key: 'data', bytes: 5, sha256: digest(file) }; verify(file, pin);
  fs.writeFileSync(file, 'wrong'); assert.throws(() => verify(file, pin), /mismatch/);
});
for (const mutation of ['corrupt', 'missing', 'symlink']) {
  test('final audit catches ' + mutation + ' after initial artifact verification', t => {
    const root = fixture(t), key = 'scv-instagram-automation/fixture/data';
    fs.mkdirSync(path.dirname(path.join(root, key)), { recursive: true });
    const file = write(root, key, 'saved');
    const ref = { key, bytes: 5, sha256: digest(file) };
    verify(file, ref); assert.equal(verifyFinalArtifacts(root, [ref]), 1);
    if (mutation === 'corrupt') fs.writeFileSync(file, 'wrong');
    else { fs.unlinkSync(file); if (mutation === 'symlink') fs.symlinkSync(write(root, 'substitute', 'saved'), file); }
    assert.throws(() => verifyFinalArtifacts(root, [ref]));
  });
}
test('links cannot substitute for recovery artifacts', t => {
  const root = fixture(t), file = write(root, 'data', 'saved');
  fs.symlinkSync(file, path.join(root, 'symlink'));
  assert.throws(() => digest(path.join(root, 'symlink')), /linked/);
  fs.linkSync(file, path.join(root, 'hardlink'));
  assert.throws(() => digest(file), /linked/);
});
test('symlink parent cannot substitute for the download directory', t => {
  const root = fixture(t), real = path.join(root, 'real'); fs.mkdirSync(real);
  write(real, 'data', 'saved'); fs.symlinkSync(real, path.join(root, 'alias'));
  assert.throws(() => digest(path.join(root, 'alias/data')), /linked/);
  assert.throws(() => newDirectory(path.join(root, 'alias/target')), /canonical/);
});
test('existing destination preserved, fresh destination private', t => {
  const root = fixture(t), preserved = write(root, 'preserved', 'do not replace');
  assert.throws(() => newDirectory(preserved), /exists/);
  assert.equal(fs.readFileSync(preserved, 'utf8'), 'do not replace');
  const target = newDirectory(path.join(root, 'new')); assert.equal(fs.statSync(target).mode & 0o777, 0o700);
});
test('wrong point is rejected before creating any directory', async t => {
  const root = fixture(t), target = path.join(root, 'new');
  await assert.rejects(recover({ point: 'latest', target }), /exact_recovery_point/);
  assert.equal(fs.existsSync(target), false);
});
test('offline manifest tampering never yields a restore success receipt', async t => {
  const root = fixture(t), mirror = path.join(root, 'mirror'), file = path.join(mirror, ROOTS[0].key);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{}');
  const target = path.join(root, 'new');
  await assert.rejects(recover({ point: POINT, target, offlineRoot: mirror }), /mismatch/);
  assert.equal(fs.existsSync(path.join(target, 'ACQUISITION-AND-RESTORE-RECEIPT.json')), false);
  assert.equal(fs.readFileSync(file, 'utf8'), '{}');
});
test('canonical inventory rejects extra, missing and duplicate files', t => {
  const root = fixture(t), file = write(root, 'main.js', 'not executed');
  write(root, 'SCV_SINGLE_RELEASE.json', '{}');
  const descriptor = { files: [{ path: 'main.js', bytes: 12, sha256: digest(file) }] };
  verifyCanonical(root, descriptor);
  assert.throws(() => verifyCanonical(root, { files: [...descriptor.files, ...descriptor.files] }), /duplicate/);
  write(root, 'unexpected.js', 'bad'); assert.throws(() => verifyCanonical(root, descriptor), /inventory/);
  fs.unlinkSync(file); assert.throws(() => verifyCanonical(root, descriptor));
});
test('state inventory ignores only the documented volatile supervisor file', t => {
  const root = fixture(t); fs.mkdirSync(path.join(root, 'logs')); write(root, 'state.json', '{}');
  const before = stateTree(root); write(path.join(root, 'logs'), 'supervisor-status.json', 'volatile');
  assert.deepEqual(stateTree(root), before);
  write(root, 'new-state.json', '{}'); assert.notDeepEqual(stateTree(root), before);
});
test('source archives reject symlinks and hardlinks before extraction', t => {
  const root = fixture(t), data = path.join(root, 'input'); fs.mkdirSync(data); write(data, 'file', 'saved');
  function tar(name, members) {
    const dest = path.join(root, name);
    assert.equal(spawnSync('tar', ['-czf', dest, '-C', data, ...members], { env: { ...process.env, COPYFILE_DISABLE: '1' } }).status, 0);
    return dest;
  }
  validateArchive(tar('safe.tar.gz', ['file']));
  fs.symlinkSync('file', path.join(data, 'symlink'));
  assert.throws(() => validateArchive(tar('symlink.tar.gz', ['file', 'symlink'])), /link_or_special/);
  fs.linkSync(path.join(data, 'file'), path.join(data, 'hardlink'));
  assert.throws(() => validateArchive(tar('hardlink.tar.gz', ['file', 'hardlink'])), /link_or_special/);
});
