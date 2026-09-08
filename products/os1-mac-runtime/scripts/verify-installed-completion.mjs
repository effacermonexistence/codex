#!/usr/bin/env node
// Read-only installed-build audit. No backend launch, model request or session write.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [appArg, baselineArg, outputArg, expectedVersion, expectedBuild] = process.argv.slice(2);
assert(appArg && baselineArg && outputArg && expectedVersion && expectedBuild,
  'app-bundle baseline-app-bundle private-output-dir expected-version expected-build');
const app = path.resolve(appArg), baseline = path.resolve(baselineArg), output = path.resolve(outputArg);
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const binary = path.join(app, 'Contents/MacOS/OS1App');
const runtime = path.join(app, 'Contents/Resources/os1');
const sessionsFile = path.join(os.homedir(), 'Library/Application Support/OS-1/sessions.json');
const before = fs.readFileSync(sessionsFile);
const sessions = JSON.parse(before).sessions;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (exe, args) => execFileSync(exe, args, { encoding: 'utf8', timeout: 45000,
  maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const checks = [], records = [];
function check(name, fn) {
  try { fn(); checks.push({ name, status: 'PASS' }); }
  catch (error) { checks.push({ name, status: 'FAIL', error: String(error.message).slice(0, 700) }); }
}
check('Installed version/build', () => {
  const info = path.join(app, 'Contents/Info.plist');
  assert.equal(run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', info]).trim(), expectedVersion);
  assert.equal(run('/usr/bin/plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-', info]).trim(), expectedBuild);
});
check('Installed executable catalog covers current visible supported models and efforts', () => {
  const config = JSON.parse(fs.readFileSync(path.join(app, 'Contents/Resources/config.json'), 'utf8'));
  const catalog = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.codex/models_cache.json'), 'utf8'));
  const profiles = Object.values(config.execution_profiles).filter(p => p.provider === 'codex');
  for (const model of catalog.models.filter(m => m.visibility === 'list')) {
    for (const level of model.supported_reasoning_levels) {
      if (level.effort === 'none') continue;
      assert(profiles.some(p => p.model === model.slug && p.effort === level.effort),
        `Missing executable tuple ${model.slug}/${level.effort}`);
    }
  }
});
check('Stable signing requirement preserved', () => {
  const read = bundle => {
    const result = execFileSync('/usr/bin/codesign', ['-d', '-r-', bundle], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return result.trim();
  };
  const requirement = read(baseline);
  assert(requirement.includes('identifier "com.omaragi.os1"'));
  assert.equal(read(app), requirement);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
});
check('Both binaries are universal', () => {
  for (const executable of [binary, runtime]) {
    assert.deepEqual(run('/usr/bin/lipo', ['-archs', executable]).trim().split(/\s+/).sort(), ['arm64', 'x86_64']);
  }
});
check('Runtime preflight/feedback/replay/adoption and native regressions', () => {
  const result = run(runtime, ['self-test']);
  assert(result.includes('22 checks OK') && result.includes('self-test: OK'));
  assert(Number(result.match(/backend protocol recovery: (\d+) checks OK/)?.[1]) >= 22);
  assert(result.includes('automatic Codex/Claude open callbacks = 0; explicit session reveal preserved'));
});
check('Inspector identity/non-mutation and native UI self-test', () => {
  assert(run(binary, ['--self-test']).includes('self-test: OK'));
});
check('Parallel conversation execution regression', () => {
  const result = run(binary, ['--self-test-parallel']);
  assert(Number(result.match(/Parallel sessions: (\d+) checks passed/)?.[1]) >= 35);
});
check('Live corrections and ordinary queue separation', () => {
  const result = run(binary, ['--self-test-steering']);
  assert(Number(result.match(/Live corrections: (\d+) checks passed/)?.[1]) >= 20);
  assert(result.includes('model calls 0'));
});
for (const provider of ['claude', 'codex']) {
  const id = sessions.find(session => session[provider + 'SessionID'])?.[provider + 'SessionID'];
  check(`Actual ${provider} record uses the stored conversation ID`, () => {
    assert(id, 'No stored native session ID; cannot claim native-record coverage');
    const record = JSON.parse(run(binary, ['--audit-backend-record', provider, id]));
    assert.equal(record.requestedID, id);
    assert.equal(record.matchedID, id);
    assert.equal(record.recordAvailable, true);
    assert(record.userMessageCount > 0 && record.assistantMessageCount > 0);
    assert.match(record.lastAnswerSHA256, /^[a-f0-9]{64}$/);
    records.push(record);
  });
  check(`Missing ${provider} record never falls back to an unrelated one`, () => {
    const record = JSON.parse(run(binary, ['--audit-backend-record', provider, '00000000-0000-4000-8000-000000000099']));
    assert.equal(record.recordAvailable, false);
    assert.equal(record.matchedID, null);
    assert.equal(record.messageCount, 0);
    assert.equal(record.lastAnswerSHA256, null);
    records.push(record);
  });
}
check('Invalid backend audit identifiers rejected', () => {
  assert.throws(() => run(binary, ['--audit-backend-record', 'claude', '../not-a-session']));
});
check('All existing session-store bytes preserved', () => {
  assert(fs.readFileSync(sessionsFile).equals(before));
});
const report = {
  timestamp: new Date().toISOString(), app, appSHA256: hash(fs.readFileSync(binary)),
  runtimeSHA256: hash(fs.readFileSync(runtime)), sessionStoreSHA256: hash(before),
  sessionCount: sessions.length, modelCalls: 0, remoteDeployment: false, records, checks,
  limitation: 'Uses the actual read-only inspector reader and native fixtures; does not automate physical clicks or prove timer wakeups or remote routing activation.',
};
const destination = path.join(output, 'installed-completion-audit.json');
fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ passed: checks.filter(c => c.status === 'PASS').length,
  failed: checks.filter(c => c.status === 'FAIL'), modelCalls: 0, report: destination }));
if (checks.some(c => c.status === 'FAIL')) process.exitCode = 1;
