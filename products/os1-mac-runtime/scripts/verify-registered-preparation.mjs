#!/usr/bin/env node
// Explicit read-only installed incident replay. No model, deployment, restore,
// authentication change or real conversation mutation. Artifacts stay private.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [appArg, outputArg] = process.argv.slice(2);
assert(appArg && outputArg, 'app-bundle private-evidence-directory');
const app = path.resolve(appArg), output = path.resolve(outputArg);
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const runtime = path.join(app, 'Contents/Resources/os1'), binary = path.join(app, 'Contents/MacOS/OS1App');
const support = path.join(os.homedir(), 'Library/Application Support/OS-1');
const sessionFile = path.join(support, 'sessions.json'), before = fs.readFileSync(sessionFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (exe, args, timeout = 60000) => execFileSync(exe, args, {
  encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});
const save = (name, data) => { const file = path.join(output, name); fs.writeFileSync(file, data, { mode: 0o600 }); return file; };
const checks = [], records = [];
function check(name, fn) {
  try { fn(); checks.push({ name, status: 'PASS' }); }
  catch (error) { checks.push({ name, status: 'FAIL', error: String(error.message).slice(0, 800) }); }
}
const exact = '야 인스타그램 오토메이션 수정해야 되니까 준비해라';
for (const [label, request] of [['NFC', exact], ['NFD', exact.normalize('NFD')]]) {
  const raw = run(runtime, ['run', '--workspace', os.homedir(), '--prompt', request,
    '--provider', 'auto', '--desktop-reveal', 'never', '--output-format', 'json']);
  const file = save(`run-${label}.json`, raw), result = JSON.parse(raw), step = result.steps[0];
  check(`${label}: exact incident prepares source without a model`, () => {
    assert.equal(result.status, 'complete'); assert.equal(result.steps.length, 1);
    assert.equal(step.provider, 'local'); assert.equal(step.action, 'registered_source_retrieval');
    assert.equal(step.effort, 'none'); assert.equal(result.taskContext.objective.kind, 'prepare');
    assert.equal(result.taskContext.objective.scope, 'read_only');
    assert.equal(result.taskContext.objective.requestText, request); assert(!result.taskContext.sourcePreparation);
  });
  // A concurrent operating release can legitimately become source_pending.
  // Preserve that failed acceptance check and its observed release; do not
  // replace the useful result with an undefined native-record exception.
  if (!step?.native_record?.record_path) {
    records.push({ label, status: result.status, action: step?.action,
      pendingRelease: result.taskContext?.sourcePreparation?.releaseID, modelCalls: 0 });
    continue;
  }
  const receipt = JSON.parse(fs.readFileSync(step.native_record.record_path));
  const source = receipt.sources[0], archive = fs.readFileSync(source.source_archive_path);
  const embedded = execFileSync('/usr/bin/tar', ['-xOf', source.source_archive_path, 'SCV_SINGLE_RELEASE.json']);
  const manifest = JSON.parse(embedded);
  check(`${label}: local provenance never claims remote publication`, () => {
    assert.equal(receipt.operation, 'registered_source_retrieval'); assert.equal(receipt.r2_verified, false);
    assert.equal(receipt.registered_source_verified, true); assert.equal(receipt.bucket, null);
    assert.equal(receipt.model_invoked, false); assert.equal(receipt.result_sha256, sha(step.output));
    assert(receipt.sources.every(s => s.transport === 'registered-local' && !s.repository_sha && !s.object_key));
    assert(step.output.includes('이번 준비에서 R2 다운로드나 GitHub 게시 상태를 확인한 것은 아닙니다.'));
    assert.equal(receipt.verification_mode, 'live-manifest-registered-source-v1');
  });
  check(`${label}: exact live manifest and full archive identity`, () => {
    assert.equal(sha(archive), source.bundle_sha256); assert.equal(archive.length, Number(source.object_size));
    assert.equal(sha(embedded), source.live_manifest_sha256);
    assert.equal(manifest.content_fingerprint_sha256, source.live_fingerprint_sha256);
    assert.equal(manifest.release_id, source.selected_release_id);
    assert.equal(result.taskContext.project.liveVerified.id, manifest.release_id);
    assert.equal(result.taskContext.project.operatingRecord.sha256, sha(archive));
    const members = run('/usr/bin/tar', ['-tf', source.source_archive_path]).trim().split('\n').sort();
    assert.deepEqual(members, [...manifest.files.map(f => f.path), 'SCV_SINGLE_RELEASE.json'].sort());
    assert.equal(fs.statSync(source.source_archive_path).mode & 0o777, 0o600);
    assert(!members.some(p => p.includes('PaxHeader') || path.basename(p).startsWith('._')));
  });
  if (label === 'NFC') {
    check('Independent tar readback verifies every manifest member', () => {
      for (const member of manifest.files) {
        const bytes = execFileSync('/usr/bin/tar', ['-xOf', source.source_archive_path, member.path], { timeout: 15000, maxBuffer: 17000000 });
        assert.equal(bytes.length, member.bytes, member.path); assert.equal(sha(bytes), member.sha256, member.path);
      }
    });
  }
  const reference = result.sourceContext;
  const snapshotBytes = fs.readFileSync(path.join(support, 'source-snapshots', reference.id.toLowerCase() + '.json'));
  const snapshot = JSON.parse(snapshotBytes);
  check(`${label}: source and provenance persist in shared task context`, () => {
    assert.equal(sha(snapshotBytes), reference.sha256); assert.equal(sha(snapshot.modelPayload), snapshot.evidenceSHA256);
    assert(snapshot.modelPayload.includes('registered local archive'));
    const bound = result.taskContext.sources.find(s => s.reference?.sha256 === reference.sha256);
    assert(bound); assert.equal(bound.role, 'source_code'); assert(!bound.provenance.bucket && !bound.provenance.commit);
    assert(snapshot.sources.some(s => s.source_path === 'SCV_DESIGN_INTENT_LOCK.md'));
  });
  const image = path.join(output, `preview-${label}.png`);
  run(binary, ['--render-run-summary', file, image, '--request', request, '--width', '1100', '--receipt-open', '--reflow-check']);
  check(`${label}: native receipt accepted and readable UI projection`, () => {
    const layout = JSON.parse(fs.readFileSync(image + '.layout.json'));
    assert(layout.pairs.every(p => !p.intersects));
    const text = fs.readFileSync(image + '.txt', 'utf8');
    assert(text.includes('실행 기록 확인됨')); assert(text.includes('이 맥에 등록된 검증 원본'));
    assert(!text.includes('FROM node:')); assert(!text.includes('원본 검증 기준:'));
    const handoff = JSON.parse(fs.readFileSync(image + '.context.json'));
    assert.deepEqual(handoff.source, reference); assert.equal(handoff.taskContext.conversationID, result.taskContext.conversationID);
  });
  const reused = JSON.parse(run(runtime, ['run', '--workspace', os.homedir(), '--prompt', '그 프로젝트 이어서 하자',
    '--context-file', image + '.context.json', '--provider', 'auto', '--desktop-reveal', 'never', '--output-format', 'json']));
  save(`reused-${label}.json`, JSON.stringify(reused, null, 2));
  check(`${label}: next turn reuses the identical source, not an old mirror`, () => {
    assert.equal(reused.status, 'complete'); assert.equal(reused.steps.length, 1); assert.equal(reused.steps[0].provider, 'local');
    assert.equal(reused.steps[0].action, 'registered_source_retrieval'); assert.deepEqual(reused.sourceContext, reference);
    assert.equal(reused.taskContext.conversationID, result.taskContext.conversationID);
    assert(reused.steps[0].output.includes('새로 내려받지 않았고'));
  });
  records.push({ label, release: manifest.release_id, files: manifest.files.length, durationMS: step.duration_ms,
    archiveSHA256: sha(archive), source: reference, modelCalls: 0, receipt: step.native_record.record_path });
}
check('Real conversations, pins and drafts were not mutated by replay', () => assert(fs.readFileSync(sessionFile).equals(before)));
const report = { timestamp: new Date().toISOString(), app, runtimeSHA256: sha(fs.readFileSync(runtime)), checks, records,
  modelCalls: 0, productionChanged: false, r2PublicationChanged: false };
save('registered-preparation-audit.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: checks.filter(c => c.status === 'PASS').length,
  failed: checks.filter(c => c.status === 'FAIL'), records, output }));
if (checks.some(c => c.status === 'FAIL')) process.exitCode = 1;
