#!/usr/bin/env node
// Explicit live read-only test. Acquires source objects; never restores state,
// launches a model, deploys SCV, edits chats or changes authentication.
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
const binary = path.join(app, 'Contents/MacOS/OS1App');
const runtime = path.join(app, 'Contents/Resources/os1');
const support = path.join(os.homedir(), 'Library/Application Support/OS-1');
const sessionFile = path.join(support, 'sessions.json');
const before = fs.readFileSync(sessionFile);
const sha = value => createHash('sha256').update(value).digest('hex');
const run = (exe, args, timeout = 60000) => execFileSync(exe, args, {
  encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});
const save = (name, value) => {
  const target = path.join(output, name);
  fs.writeFileSync(target, value, { mode: 0o600 }); return target;
};
const requests = [
  ['acquire-NFC', '인스타그램은 오토매이션 수정 좀 보자 데이트 다 가져와 봐'],
  ['prepare-NFC', '야 인스타그램 수정 좀 하자 준비해'],
  ['prepare-NFD', '야 인스타그램 수정 좀 하자 준비해'.normalize('NFD')],
];
const checks = [], records = [];
const failures = [];
function check(name, callback) {
  try { callback(); checks.push({ name: name, status: 'PASS' }); }
  catch (error) { failures.push(name); checks.push({ name: name, status: 'FAIL', error: String(error && error.message || error) }); }
}
for (const [normalization, request] of requests) {
  const raw = run(runtime, ['run', '--workspace', os.homedir(), '--prompt', request,
    '--provider', 'auto', '--desktop-reveal', 'never', '--output-format', 'json'], 180000);
  const file = save(`run-${normalization}.json`, raw), summary = JSON.parse(raw);
  check(`${normalization}: source acquisition, not agent execution`, () => {
    assert.equal(summary.status, 'complete'); assert.equal(summary.steps.length, 1);
    assert.equal(summary.steps[0].provider, 'local'); assert.equal(summary.steps[0].action, 'r2_retrieval');
    assert.equal(summary.steps[0].model, 'os1-evidence-resolver'); assert.equal(summary.steps[0].effort, 'none');
  });
  const step = summary.steps[0], receipt = JSON.parse(fs.readFileSync(step.native_record.record_path));
  check(`${normalization}: truthful receipt with pinned source provenance`, () => {
    assert.equal(receipt.model_invoked, false); assert.equal(receipt.verification_mode, 'live-r2-project-source-package-v1');
    assert.equal(receipt.relevance_check, 'pinned-project-source-package');
    assert.equal(receipt.result_sha256, sha(step.output)); assert.equal(receipt.source_count, 5);
    assert(receipt.sources.every(s => s.repository === 'effacermonexistence/codex'));
    assert(receipt.sources.every(s => s.object_key.startsWith('scv-instagram-automation/release-ready/')));
  });
  const ref = summary.sourceContext;
  const bytes = fs.readFileSync(path.join(support, 'source-snapshots', ref.id.toLowerCase() + '.json'));
  const snapshot = JSON.parse(bytes);
  check(`${normalization}: immutable context and genuine originals`, () => {
    assert.equal(ref.kind, 'snapshot'); assert.equal(sha(bytes), ref.sha256);
    assert.equal(sha(snapshot.modelPayload), snapshot.evidenceSHA256);
    assert(snapshot.modelPayload.includes('SCV DESIGN INTENT LOCK'));
    assert(snapshot.modelPayload.includes('scv-structured-state-schema.js'));
    assert(snapshot.modelPayload.includes('verify --version'));
    assert(snapshot.modelPayload.includes('not a restoration or a live production check'));
    assert(step.output.includes('운영 서버의 현재 배포 버전은 아직 조회하지 않았습니다'));
  });
  const archive = step.output.match(/\[소스 파일 열기\]\(<([^>]+)>\)/)?.[1];
  assert(archive);
  const directory = path.dirname(archive), descriptor = JSON.parse(fs.readFileSync(path.join(directory, 'SCV_RECOVERY_POINT.json')));
  check(`${normalization}: runtime source bytes verified, customer-state files excluded`, () => {
    const runtimeComponent = summary.taskContext.project.operatingRecord;
    assert(runtimeComponent && runtimeComponent.id !== descriptor.release.release_id,
      'fixture expects a newer operating release than the preserved recovery baseline');
    const sourceBytes = fs.readFileSync(archive);
    assert.equal(sourceBytes.length, runtimeComponent.bytes); assert.equal(sha(sourceBytes), runtimeComponent.sha256);
    const embedded = JSON.parse(run('/usr/bin/tar', ['-xOf', archive, 'SCV_SINGLE_RELEASE.json']));
    assert.equal(embedded.release_id, runtimeComponent.id);
    assert.equal(receipt.sources[0].object_key, runtimeComponent.key);
    assert.equal(snapshot.projectBaseline.recoveryBaseline.sha256, descriptor.components.find(c => c.name === 'runtime').sha256);
    assert.equal(snapshot.projectBaseline.liveVerified, undefined);
    assert.deepEqual(fs.readdirSync(directory).sort(), [path.basename(archive), 'LATEST.json', 'SCV_RECOVERY_POINT.json', 'SCV_SINGLE_RELEASE.json'].sort());
    assert.equal(fs.statSync(archive).mode & 0o777, 0o600);
  });
  const image = path.join(output, `preview-${normalization}.png`);
  run(binary, ['--render-run-summary', file, image, '--request', request, '--width', '1100', '--receipt-open', '--reflow-check']);
  check(`${normalization}: native receipt accepted, readable projection, no overlap`, () => {
    const layout = JSON.parse(fs.readFileSync(image + '.layout.json'));
    assert(layout.pairs.every(pair => !pair.intersects));
    const text = fs.readFileSync(image + '.txt', 'utf8');
    assert(text.includes('실제 소스 압축파일')); assert(!text.includes('FROM node:'));
    assert(!text.includes('git diff 비어')); assert(!text.includes('wrong_node'));
    const context = JSON.parse(fs.readFileSync(image + '.context.json', 'utf8'));
    assert.deepEqual(context.source, ref);
    assert.equal(context.taskContext.conversationID, summary.taskContext.conversationID);
  });
  const answer = save(`answer-${normalization}.txt`, '가져온 SCV Instagram 자료는 운영 릴리스 기록에 지정된 소스입니다. 별도로 보존한 과거 복구 기준과 구분해야 합니다. 운영 서버의 실제 배포 버전은 아직 확인하지 않았습니다. Dockerfile과 상태 스키마를 기준으로 설명할 수 있습니다.');
  const validation = JSON.parse(run(runtime, ['check-source-output', image + '.context.json', answer, '가져온 인스타그램 자료를 설명해줘']));
  check(`${normalization}: next-turn loader retains source`, () => {
    assert.equal(validation.source_contract, true); assert.equal(validation.capability_failure, false);
  });
  records.push({ normalization, durationMS: step.duration_ms, receipt: step.native_record.record_path,
    source: ref, archive, archiveSHA256: sha(fs.readFileSync(archive)), modelCalls: 0 });
  if (normalization === 'prepare-NFC') {
    const repeated = JSON.parse(run(runtime, ['run', '--workspace', os.homedir(), '--prompt', '그 프로젝트 이어서 하자',
      '--context-file', image + '.context.json', '--provider', 'auto', '--desktop-reveal', 'never', '--output-format', 'json'], 180000));
    save('prepare-reused.json', JSON.stringify(repeated));
    check('Preparation reuses exactly the attached operating source without model execution', () => {
      assert.equal(repeated.steps.length, 1); assert.equal(repeated.steps[0].provider, 'local');
      assert(repeated.steps[0].output.includes('새로 내려받지 않았고'));
      assert.deepEqual(repeated.sourceContext, ref);
      assert.equal(repeated.taskContext.conversationID, summary.taskContext.conversationID);
    });
  }
}
check('Existing conversations unchanged', () => assert(fs.readFileSync(sessionFile).equals(before)));
save('project-materials-audit.json', JSON.stringify({ timestamp: new Date().toISOString(), app,
  runtimeSHA256: sha(fs.readFileSync(runtime)), checks, records, productionChanged: false }, null, 2) + '\n');
console.log(JSON.stringify({ passed: checks.length - failures.length, failed: failures.length, modelCalls: 0, output }));
process.exit(failures.length === 0 ? 0 : 1);
