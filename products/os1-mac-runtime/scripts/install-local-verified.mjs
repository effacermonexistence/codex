#!/usr/bin/env node
// Explicit local upgrade, never production deployment or credential migration.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const [sourceArg, recoveryArg, expectedBuild, ...options] = process.argv.slice(2);
assert(sourceArg && recoveryArg && /^\d+$/.test(expectedBuild), 'staged-app new-private-recovery-dir expected-build');
assert.equal(new Set(options).size, options.length, 'duplicate install option');
assert(options.every(option => ['--preserve-queue', '--allow-local-signer-rotation'].includes(option)), 'unknown install option');
const preserveQueue = options.includes('--preserve-queue');
const allowLocalSignerRotation = options.includes('--allow-local-signer-rotation');
const source = fs.realpathSync(sourceArg), home = os.homedir();
const recovery = path.resolve(recoveryArg), app = path.join(home, 'Applications/OS-1 CLODEX.app');
const cli = path.join(home, '.local/bin/os1'), resource = path.join(source, 'Contents/Resources/os1');
const store = path.join(home, 'Library/Application Support/OS-1/sessions.json');
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
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const appPIDs = () => run('/bin/ps', ['-axo', 'pid=,args=']).split('\n').flatMap(line => {
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
const foreignWriters = () => run('/bin/ps', ['-axo', 'pid=,args=']).split('\n').filter(line => {
  const match = line.trim().match(/^(\d+)\s+(.*)$/);
  return match && match[2].endsWith('/Contents/MacOS/OS1App') && match[2] !== path.join(app, 'Contents/MacOS/OS1App');
});
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
assert(!fs.existsSync(stageApp) && !fs.existsSync(stageCLI));
const backupApp = path.join(recovery, 'OS-1 CLODEX.app'), backupCLI = path.join(recovery, 'os1');
let paused = false, appMoved = false, cliMoved = false, activated = false;
const receipt = { startedAt: new Date().toISOString(), build: expectedBuild, app, recovery,
  previousAppHash: hash(path.join(app, 'Contents/MacOS/OS1App')), previousCLIHash: hash(cli),
  stagedAppHash: hash(path.join(source, 'Contents/MacOS/OS1App')), stagedCLIHash: hash(resource),
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
  run('/usr/bin/ditto', [source, stageApp]);
  fs.copyFileSync(resource, stageCLI, fs.constants.COPYFILE_EXCL); fs.chmodSync(stageCLI, 0o755);
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
  for (const pid of wasRunning) {
    run('/usr/bin/swift', ['-e', `import AppKit; guard let a = NSRunningApplication(processIdentifier: ${pid}), a.bundleURL?.path == ${JSON.stringify(app)} else { exit(1) }; if !a.terminate() { exit(2) }`]);
  }
  for (let i = 0; appPIDs().length && i < 40; i++) await wait(250);
  assert.equal(appPIDs().length, 0, 'app did not quit; no force-kill');
  idle();
  const before = fs.readFileSync(store); const original = JSON.parse(before);
  fs.writeFileSync(path.join(recovery, 'sessions-at-install.json'), before, { mode: 0o600, flag: 'wx' });
  fs.renameSync(app, backupApp); appMoved = true;
  fs.renameSync(stageApp, app);
  fs.renameSync(cli, backupCLI); cliMoved = true;
  fs.renameSync(stageCLI, cli);
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
    fs.writeFileSync(path.join(recovery, `${label}-test.log`), run(exe, args), { mode: 0o600 });
    receipt.checks.push(`${label}: PASS`);
  }
  // Content equality, not byte equality: a relaunched app (the user reopening
  // OS-1 mid-install) re-encodes the store with different key order. Any real
  // change — a session, message, queue or flag — still fails here, and the
  // per-session preservation checks below re-verify every message.
  assert.deepEqual(JSON.parse(fs.readFileSync(store)), original, 'verification changed the real session store');
  if (paused) { run('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist]); paused = false; }
  if (wasRunning.length) run('/usr/bin/open', ['-g', app]);
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
          (message.nativeIngestedID || (message.role === 'receipt' && message.text.includes('OS-1 외부 작업, 채택 판정 아님'))),
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
  if (appPIDs().length === 0 && paused) {
    if (cliMoved) { if (fs.existsSync(cli)) fs.renameSync(cli, path.join(recovery, 'unadopted-os1')); fs.renameSync(backupCLI, cli); }
    if (appMoved) { if (fs.existsSync(app)) fs.renameSync(app, path.join(recovery, 'unadopted-app.app')); fs.renameSync(backupApp, app); }
    receipt.binaryRollback = true;
  }
  throw error;
} finally {
  if (fs.existsSync(maintenanceLease) && fs.readFileSync(maintenanceLease, 'utf8').trim() === String(process.pid)) fs.unlinkSync(maintenanceLease);
  // Recovery errors must not suppress the original failure receipt.
  try {
    if (paused) run('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist]);
    if (receipt.binaryRollback && wasRunning.length) run('/usr/bin/open', ['-g', app]);
  } catch (error) { receipt.recoveryError = String(error.stack || error); }
  fs.writeFileSync(path.join(recovery, 'install-receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(recovery, 'RECOVERY.md'),
    '# Local binary recovery\n\nPrevious app and CLI are preserved here. Stop OS1 only when idle before restoring these binaries. Never replace the current sessions.json with sessions-at-install.json: it is evidence, not permission to discard newer conversations. Authentication caches were not copied.\n', { mode: 0o600 });
}
assert(activated); console.log(JSON.stringify(receipt));
