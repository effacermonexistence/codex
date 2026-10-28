#!/usr/bin/env node
// Private temporary files + pure comparison only. No HOME/live installation,
// provider, process signalling, credentials or model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { captureInstalledPredecessor, verifyExpectedPredecessor, readExpectedPredecessor } from './install-local-verified.mjs';

let checks = 0;
const check = fn => { fn(); checks++; };
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'os1-predecessor-fixture-'));
try {
  fs.chmodSync(root, 0o700);
  const app = path.join(root, 'OS-1 CLODEX.app'), cli = path.join(root, 'bin/os1'), cliConfig = path.join(root, 'bin/config.json');
  const targets = { app, cli, cliConfig };
  const files = [path.join(app, 'Contents/Info.plist'), path.join(app, 'Contents/MacOS/OS1App'),
    path.join(app, 'Contents/Resources/os1'), path.join(app, 'Contents/Resources/config.json'), cli, cliConfig];
  for (const [i, file] of files.entries()) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `fixture bytes ${i}\n`, { mode: 0o600 });
  }
  const metadata = { CFBundleVersion: '442', CFBundleShortVersionString: '0.9.376', OS1SourceCommit: 'a'.repeat(40) };
  const capture = changes => captureInstalledPredecessor({ ...targets, readInfo: () => ({ ...metadata, ...changes }) });
  const expected = capture();
  check(() => assert.deepEqual(verifyExpectedPredecessor(expected, capture()), {
    format: 'os1-install-predecessor-v1', matched: true, build: '442', sourceCommit: 'a'.repeat(40),
  }));
  for (const file of files) {
    check(() => {
      const before = fs.readFileSync(file);
      fs.appendFileSync(file, 'newer release');
      const changed = capture();
      const snapshot = files.map(value => createHash('sha256').update(fs.readFileSync(value)).digest('hex'));
      assert.throws(() => verifyExpectedPredecessor(expected, changed), /installed predecessor changed/);
      // The rejection is not an installer invocation. It must not mutate even
      // the fixture binary/configuration bytes used by the comparison.
      assert.deepEqual(files.map(value => createHash('sha256').update(fs.readFileSync(value)).digest('hex')), snapshot);
      fs.writeFileSync(file, before);
    });
  }
  for (const changes of [{ CFBundleVersion: '443' }, { CFBundleShortVersionString: '0.9.377' }, { OS1SourceCommit: 'b'.repeat(40) }]) {
    check(() => assert.throws(() => verifyExpectedPredecessor(expected, capture(changes)), /installed predecessor changed/));
  }
  check(() => assert.throws(() => verifyExpectedPredecessor(expected, { ...expected, cli: path.join(root, 'other/os1') }), /installed predecessor changed/));
  check(() => assert.throws(() => verifyExpectedPredecessor({ ...expected, token: 'must never be accepted' }, expected), /unexpected predecessor fields/));
  check(() => assert.throws(() => verifyExpectedPredecessor({ ...expected, appExecutableSHA256: 'not-a-fingerprint' }, expected), /invalid predecessor fingerprint/));
  check(() => assert.throws(() => verifyExpectedPredecessor({ ...expected, sourceCommit: 'unknown fabricated checkpoint' }, expected), /invalid predecessor source identity/));
  check(() => assert.throws(() => verifyExpectedPredecessor({ ...expected, build: 442 }, expected), /invalid predecessor build/));
  check(() => {
    fs.unlinkSync(cliConfig);
    const absent = capture();
    assert.equal(absent.cliConfigSHA256, null);
    assert.throws(() => verifyExpectedPredecessor(expected, absent), /installed predecessor changed/);
    assert.equal(verifyExpectedPredecessor(absent, capture()).matched, true);
    fs.writeFileSync(cliConfig, 'fixture bytes 5\n', { mode: 0o600 });
  });
  const receipt = path.join(root, 'predecessor.json');
  fs.writeFileSync(receipt, JSON.stringify(expected), { mode: 0o600 });
  check(() => assert.deepEqual(readExpectedPredecessor(receipt), expected));
  check(() => {
    fs.chmodSync(receipt, 0o644);
    assert.throws(() => readExpectedPredecessor(receipt), /private owned regular file/);
    fs.chmodSync(receipt, 0o600);
  });
  check(() => {
    const linked = path.join(root, 'linked.json');
    fs.symlinkSync(receipt, linked);
    assert.throws(() => readExpectedPredecessor(linked), /symlink/);
    fs.unlinkSync(linked);
  });
  check(() => {
    const linked = path.join(root, 'hardlinked.json');
    fs.linkSync(receipt, linked);
    assert.throws(() => readExpectedPredecessor(linked), /private owned regular file/);
    fs.unlinkSync(linked);
  });
  check(() => {
    fs.writeFileSync(receipt, '{"secret-do-not-echo": BROKEN');
    assert.throws(() => readExpectedPredecessor(receipt), error =>
      error.message === 'expected predecessor is not valid JSON' && !error.message.includes('secret'));
    fs.writeFileSync(receipt, JSON.stringify(expected));
  });
  check(() => assert.throws(() => readExpectedPredecessor('relative.json'), /exact absolute path/));
  check(() => {
    assert.throws(() => captureInstalledPredecessor({ ...targets, readInfo: file => {
      fs.appendFileSync(file, 'metadata mutated while read'); return metadata;
    } }), /metadata changed during capture/);
  });
  check(() => {
    const source = fs.readFileSync(fileURLToPath(new URL('./install-local-verified.mjs', import.meta.url)), 'utf8');
    const lease = source.indexOf("fs.writeFileSync(maintenanceLease, String(process.pid)");
    const afterLease = source.indexOf('receipt.predecessorAfterLease = checkExpectedPredecessor()');
    const stage = source.indexOf("run('/usr/bin/ditto', [source, stageApp])");
    const beforeSwap = source.indexOf('receipt.predecessorBeforeSwap = checkExpectedPredecessor()');
    const swap = source.indexOf('fs.renameSync(app, backupApp)');
    assert(lease > 0 && lease < afterLease && afterLease < stage && stage < beforeSwap && beforeSwap < swap);
    assert(source.includes('if (predecessorGuardFailed) {'));
    assert(source.includes('assert(!appMoved && !cliMoved && !configMoved && !configInstalled)'));
    assert(source.includes('receipt.predecessorRejected = true'));
    assert(source.includes("? readExpectedPredecessor(predecessorOptions[0].slice('--expected-predecessor='.length)) : null"));
  });
  console.log(`OS1 expected-predecessor guard: ${checks} checks PASS; private temporary fixtures only; installations/process/provider/model calls 0`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
