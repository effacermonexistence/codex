#!/usr/bin/env node
// Read-only replay of an existing retrieval through the production AppKit
// renderer. No R2 requests, model calls, session writes or clipboard mutation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
for (const name of ['--app', '--baseline-app', '--session', '--output-dir']) {
  assert(args.includes(name) && option(name), `Missing ${name}`);
}
const app = path.resolve(option('--app'));
const baseline = path.resolve(option('--baseline-app'));
const sessionID = option('--session');
const output = path.resolve(option('--output-dir'));
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const root = path.join(os.homedir(), 'Library/Application Support/OS-1');
const sessionsPath = path.join(root, 'sessions.json');
const bytesBefore = fs.readFileSync(sessionsPath);
const session = JSON.parse(bytesBefore).sessions.find(s => s.id === sessionID);
assert(session, 'Exact incident must still exist');
const digest = data => createHash('sha256').update(data).digest('hex');
const run = (exe, argv) => execFileSync(exe, argv, { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
const beforeContext = JSON.parse(run(baseline, ['--export-session-context', sessionID]));
const checks = [];
function check(name, fn) { fn(); checks.push({ name, status: 'PASS' }); }
const normal = path.join(output, 'default.png');
const expanded = path.join(output, 'expanded.png');
run(app, ['--self-test']);
run(app, ['--render-session-transcript', sessionID, normal]);
run(app, ['--render-session-transcript', sessionID, expanded, '--expanded']);
const text = fs.readFileSync(normal + '.txt', 'utf8');
const details = fs.readFileSync(expanded + '.txt', 'utf8');
const copy = fs.readFileSync(normal + '.copy.txt', 'utf8');
const newContext = JSON.parse(fs.readFileSync(normal + '.context.json', 'utf8'));
const answer = session.messages.find(m => m.role === 'assistant' && m.provider === 'local' && m.text.startsWith('R2에서 실제 QMGR objective v1'));
assert(answer, 'This incident verifier expects the actual QMGR v1 retrieval');
check('Korean outcome and explicit limited claim first', () => {
  assert(text.includes('QM·GR 통합 연구 자료(v1)를 가져왔습니다.'));
  assert(text.includes('전체 QM·GR 통합이 검증됐다는 뜻은 아닙니다.'));
});
check('No transport/hash wall or raw TeX by default', () => {
  assert(!/[a-f0-9]{64}|manifest\.json|J_exec|\\mathcal|result_sha256/.test(text));
});
check('Original document and verification have separate controls', () => {
  assert(text.includes('자료 원문 · 펼쳐보기'));
  assert(text.includes('출처·검증 정보 · 펼쳐보기'));
  assert(!text.includes('The live objective is'));
});
check('Expanded original reaches the end of the source', () => {
  assert(details.includes('The live objective is'));
  assert(details.includes('explicitly unsupported.'));
});
check('Expanded verification retains exact evidence digest', () => {
  const hashes = answer.text.match(/[a-f0-9]{64}/g);
  assert(hashes?.length > 0 && hashes.every(h => details.includes(h)));
});
check('Complete-copy returns each original message in order', () => {
  let cursor = 0;
  for (const message of session.messages) {
    const at = copy.indexOf(message.text, cursor);
    assert(at >= cursor, `Missing original ${message.id}`);
    cursor = at + message.text.length;
  }
  assert.equal(copy, fs.readFileSync(expanded + '.copy.txt', 'utf8'));
});
check('Receipt does not claim scientific correctness', () => {
  assert(!text.includes('VERIFIED'));
  assert(details.includes('답변의 정확성이나 과제 완수를 보증하지 않습니다.'));
});
check('Backend handoff unchanged from installed previous build', () => assert.deepEqual(newContext, beforeContext));
check('Expanded rendering does not alter handoff', () => assert.deepEqual(newContext, JSON.parse(fs.readFileSync(expanded + '.context.json', 'utf8'))));
check('Original source snapshot still matches recorded digest', () => {
  assert.deepEqual(newContext.source, session.sourceContext);
  const dir = newContext.source.kind === 'snapshot' ? 'source-snapshots' : 'control-receipts';
  const sourceBytes = fs.readFileSync(path.join(root, dir, newContext.source.id.toLowerCase() + '.json'));
  assert.equal(digest(sourceBytes), newContext.source.sha256);
});
check('All conversation storage bytes unchanged', () => assert.deepEqual(fs.readFileSync(sessionsPath), bytesBefore));
const report = { timestamp: new Date().toISOString(), sessionID, app, appSHA256: digest(fs.readFileSync(app)),
  sessionStoreSHA256: digest(bytesBefore), checks, modelCalls: 0, r2Writes: 0,
  images: [normal, expanded], limitation: 'Visual proof is a native AppKit transcript render, not foreground window automation.' };
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ passed: checks.length, failed: 0, modelCalls: 0, report: path.join(output, 'report.json') }));
