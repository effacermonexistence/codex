#!/usr/bin/env node
// Opt-in integration test: two objectives, synthetic drift explicitly labeled,
// no production/customer changes and no paid reflection calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';

const [runtime, fixture, configFile, outputArg, mode] = process.argv.slice(2);
assert(runtime && fixture && configFile && outputArg, 'runtime fixture-binary config-file fresh-output-directory');
const output = path.resolve(outputArg);
assert(mode === undefined || mode === '--resume-verification');
assert(!fs.existsSync(output) || mode === '--resume-verification', 'fresh private output directory required');
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const sha = data => createHash('sha256').update(data).digest('hex');
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
const config = JSON.parse(fs.readFileSync(configFile));
const contract = config.executor_contract.sha256;
const prompt = '한국어 두 문장으로 캐시가 무엇인지 설명해 주세요.';
const stateRoot = path.join(os.homedir(), 'Library/Application Support/OS-1');
const run = (args, overrides = {}) => new Promise((resolve, reject) => {
  const child = spawn(runtime, args, { env: { ...process.env, OS1_CONFIG: configFile, ...overrides }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
  const timer = setTimeout(() => child.kill('SIGTERM'), 180_000);
  child.on('error', reject); child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
});
const results = [];
let newlySubmittedObjectives = 0;
try {
  assert(execFileSync(runtime, ['version'], { encoding: 'utf8' }).includes('build105'));
  for (const provider of ['codex', 'claude']) {
    const seedFile = path.join(output, provider + '-synthetic-seed.json');
    const savedSeed = mode === '--resume-verification' && fs.existsSync(seedFile) ? JSON.parse(fs.readFileSync(seedFile)) : null;
    const workspace = savedSeed?.workspace ?? fs.mkdtempSync('/tmp/os1-drift-native.');
    let scopeID = savedSeed?.scopeID;
    if (!savedSeed) {
      fs.chmodSync(workspace, 0o700);
      const seeded = execFileSync(fixture, ['--seed-drift-native-fixture', workspace, contract], { encoding: 'utf8', timeout: 10_000 });
      scopeID = seeded.match(/seeded: ([a-f0-9]{64})\./)?.[1];
    }
    assert(scopeID && /^[a-f0-9]{64}$/.test(scopeID));
    assert(path.basename(workspace).startsWith('os1-drift-native.') && ['/tmp', '/private/tmp'].includes(path.dirname(workspace)));
    const ledgerFile = path.join(stateRoot, 'drift-policy', scopeID + '.json');
    const archivedFile = path.join(output, provider + '-verified-ledger.json');
    const before = savedSeed?.ledger ?? JSON.parse(fs.readFileSync(ledgerFile));
    assert.equal(before.rules.length, 1); assert.equal(before.rules[0].state, 'candidate');
    assert.equal(before.scope.contractSHA256, contract);
    if (!savedSeed) save(provider + '-synthetic-seed.json', { synthetic: true, workspace, scopeID, ledger: before });
    const submissionID = randomUUID().toUpperCase();
    const events = path.join(output, provider + '-events.jsonl');
    const resultFile = path.join(output, provider + '-native-result.json');
    let result;
    if (mode === '--resume-verification' && fs.existsSync(resultFile)) {
      result = JSON.parse(fs.readFileSync(resultFile)); // never re-execute paid work to repair its audit
    } else {
      fs.writeFileSync(events, '', { mode: 0o600 });
      newlySubmittedObjectives++;
      result = await run(['run', '--workspace', workspace, '--provider', provider, '--prompt', prompt,
      '--desktop-reveal', 'never', '--output-format', 'json'], { OS1_SUBMISSION_ID: submissionID,
      OS1_EVENT_JOURNAL: events, OS1_ACTIVITY_FILE: path.join(output, provider + '-activity.json'),
      OS1_FAILURE_FILE: path.join(output, provider + '-failure.json') });
      save(provider + '-native-result.json', result);
    }
    assert.equal(result.code, 0, result.stderr);
    const summary = JSON.parse(result.stdout), step = summary.steps.at(-1);
    assert.equal(summary.status, 'complete'); assert.equal(summary.steps.length, 1);
    assert.equal(step.provider, provider); assert.equal(step.revas_disposition, 'adopted');
    assert.equal(step.native_record.persistence, 'verified'); assert.equal(step.permission_profile, 'read_only');
    assert(['native_record_only', 'not_revealed'].includes(step.native_record.desktop_visibility));
    assert(step.output.includes('캐시')); assert(!step.output.includes('OS1 scoped correction checks'));
    if (fs.existsSync(workspace)) assert.deepEqual(fs.readdirSync(workspace), [], 'a read-only answer must not modify the test workspace');
    const alreadyArchived = fs.existsSync(archivedFile);
    const ledger = JSON.parse(fs.readFileSync(alreadyArchived ? archivedFile : ledgerFile));
    assert.equal(ledger.rules[0].state, 'active'); assert.equal(ledger.rules[0].recoveries, 1);
    const boxRoot = path.join(stateRoot, 'execution-outbox');
    const candidates = fs.readdirSync(boxRoot).filter(name => /^[0-9a-fA-F-]{36}-\d+\.json$/.test(name))
      .map(name => path.join(boxRoot, name)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    let custody;
    for (const candidate of candidates) {
      const record = JSON.parse(fs.readFileSync(candidate));
      if (record.output === step.output && JSON.parse(Buffer.from(record.step, 'base64')).session_id === step.session_id) {
        custody = record; break;
      }
    }
    assert(custody?.driftApplication, 'exact native result custody required');
    const applied = ledger.events.find(event => event.action === 'applied' && event.id === custody.driftApplication.eventID);
    const adopted = ledger.events.find(event => event.action === 'adopted' && event.id === sha('adopt:' + applied?.id));
    assert(applied && adopted && applied.revision === adopted.revision);
    assert.equal(adopted.outputSHA256, sha(step.output));
    const deliveryID = custody.id;
    assert.equal(custody.driftApplication.eventID, applied.id); assert.equal(custody.driftSteered, false);
    const nativeBefore = sha(fs.readFileSync(step.native_record.record_path));
    const replay = await run(['resume-delivery', deliveryID]);
    assert.equal(replay.code, 0, replay.stderr); assert.equal(JSON.parse(replay.stdout).steps.at(-1).output, step.output);
    assert.equal(sha(fs.readFileSync(step.native_record.record_path)), nativeBefore, 'delivery recovery must not call the model');
    assert.equal(JSON.parse(fs.readFileSync(alreadyArchived ? archivedFile : ledgerFile)).rules[0].recoveries, 1, 'replay must not double-count learning');
    if (!alreadyArchived) {
      const disabled = await run(['drift-policy-disable', scopeID]); assert.equal(disabled.code, 0);
      const archived = JSON.parse(fs.readFileSync(ledgerFile)); assert.equal(archived.enabled, false);
    // Preserve exact fixture evidence away from live learning, not user state.
      fs.renameSync(ledgerFile, archivedFile);
    }
    if (fs.existsSync(workspace)) fs.rmdirSync(workspace);
    results.push({ provider, model: step.model, effort: step.effort, nativeSessionID: step.session_id,
      nativePersistence: 'verified', serverAdopted: true, correctionRevision: applied.revision,
      syntheticSeed: true, realNativeRecovery: true, promotionCount: 1, deliveryReplayCalls: 0,
      governedAttempts: ledger.events.filter(event => event.action === 'applied').length,
      outputSHA256: sha(step.output), durationMS: step.duration_ms, fixtureArchived: true });
    console.log(JSON.stringify(results.at(-1)));
  }
  save(mode ? 'audit-resumed.json' : 'audit.json', { status: 'PASS', capturedAt: new Date().toISOString(),
    verifiedNativeTurns: 2, governedAttempts: results.reduce((n, result) => n + result.governedAttempts, 0),
    newlySubmittedObjectives, additionalReflectionCalls: 0, results,
    scope: 'synthetic presentation drift -> real native execution -> local/native/REVAS acceptance -> active correction; not a quality-uplift benchmark' });
} catch (error) {
  save(mode ? 'audit-resumed.json' : 'audit.json', { status: 'FAIL', capturedAt: new Date().toISOString(), results, error: String(error.stack ?? error) });
  throw error;
}
