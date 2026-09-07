#!/usr/bin/env node
// Three bounded read-only calls on one isolated logical task. No application
// conversation, customer data, deployment or permissions are changed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
const [runtimeArg, preparationArg, outputArg, reuseArg, mode = 'cross-provider'] = process.argv.slice(2);
assert(runtimeArg && preparationArg && outputArg);
assert(['cross-provider', 'codex-resume'].includes(mode));
const runtime = path.resolve(runtimeArg), output = path.resolve(outputArg);
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
// Instrumentation must not change the workspace used to detect side effects.
const workspace = path.join(output, 'workspace');
fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
const prep = JSON.parse(fs.readFileSync(preparationArg));
let task = prep.taskContext;
assert(task?.project?.operatingRecord && prep.sourceContext);
const conversationID = task.conversationID, reference = prep.sourceContext;
const dateKeys = new Set(['createdAt', 'updatedAt', 'madeAt', 'startedAt', 'endedAt', 'lastProgressAt', 'checkedAt', 'retrievedAt', 'verifiedAt']);
function transport(value, key) {
  if (dateKeys.has(key) && typeof value === 'number') return new Date((value + 978307200) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (Array.isArray(value)) return value.map(v => transport(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, transport(v, k)]));
  return value;
}
const save = (name, value) => fs.writeFileSync(path.join(output, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2), { mode: 0o600 });
const sha = data => createHash('sha256').update(data).digest('hex');
let history = 'USER:\n야 인스타그램 수정 좀 하자 준비해\n\nOS-1:\n' + prep.steps[0].output;
const originalStore = fs.readFileSync(path.join(os.homedir(), 'Library/Application Support/OS-1/sessions.json'));
const results = []; let codexID;
const providers = mode === 'codex-resume' ? ['codex', 'codex'] : ['codex', 'claude', 'codex'];
try {
for (const [i, provider] of providers.entries()) {
  const prompt = '연결된 Instagram 자동화 자료를 설명해. 이번 소스 릴리스 ID, Dockerfile의 Node 버전, 운영 서버를 실제 조회했는지를 짧게 답해. 과거 복구 기준점과 이번 소스 버전을 구분해. 파일 변경·명령 실행·배포 없이 제공된 자료만 읽고 답해.';
  const contextFile = path.join(output, `context-${i}.json`);
  const handoff = { format: 'os1-session-handoff-v3', transcript: history, source: reference, taskContext: transport(task) };
  fs.writeFileSync(contextFile, JSON.stringify(handoff), { mode: 0o600 });
  const submission = randomUUID().toUpperCase(), journal = path.join(output, `events-${i}.jsonl`);
  fs.writeFileSync(journal, '', { mode: 0o600 });
  const args = ['run', '--workspace', workspace, '--provider', provider, '--context-file', contextFile,
    '--prompt', prompt, '--desktop-reveal', 'never', '--output-format', 'json'];
  if (provider === 'codex' && codexID) args.push('--codex-session-id', codexID);
  const start = Date.now();
  const reused = i === 0 && reuseArg === 'reuse-first';
  const result = reused ? JSON.parse(fs.readFileSync(path.join(output, 'run-0.json'))) : await new Promise((resolve, reject) => {
    const child = spawn(runtime, args, { env: { ...process.env, OS1_SUBMISSION_ID: submission,
      OS1_EVENT_JOURNAL: journal, OS1_ACTIVITY_FILE: path.join(output, `activity-${i}.json`),
      OS1_FAILURE_FILE: path.join(output, `failure-${i}.json`) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
    const timer = setTimeout(() => child.kill('SIGTERM'), 240000);
    child.on('error', reject); child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  if (!reused) save(`run-${i}.json`, result);
  assert.equal(result.code, 0, result.stderr);
  const summary = JSON.parse(result.stdout), step = summary.steps.at(-1);
  save(`summary-${i}.json`, summary);
  assert.equal(summary.status, 'complete'); assert.equal(summary.steps.length, 1); assert.equal(step.sequence, 1);
  assert.equal(step.provider, provider); assert.equal(step.permission_profile, 'read_only');
  assert.equal(step.native_record.persistence, 'verified');
  assert(['native_record_only', 'not_revealed'].includes(step.native_record.desktop_visibility));
  assert.equal(summary.taskContext.conversationID, conversationID);
  assert.deepEqual(summary.sourceContext, reference);
  assert.equal(summary.taskContext.project.operatingRecord.id, task.project.operatingRecord.id);
  assert(step.output.includes('v157') && step.output.includes('20.20.2') && step.output.includes('v151'));
  assert(/미확인|확인하지|조회하지|조회하지는|검증하지|하지 않았|안 했|안했/.test(step.output), 'must preserve live-state uncertainty');
  const events = fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
  const publicProgress = events.some(e => e.phase === 'executing' && e.publicText);
  if (!reused) assert(publicProgress, 'public progress absent');
  if (provider === 'codex') {
    if (codexID) assert.equal(step.session_id, codexID, 'Codex native continuation lost its binding');
    codexID = step.session_id;
  }
  const outbox = path.join(os.homedir(), 'Library/Application Support/OS-1/execution-outbox');
  const deliveryID = reused ? undefined : fs.readFileSync(path.join(outbox, `submission-${submission}.ref`), 'utf8');
  task = summary.taskContext;
  history += `\n\nUSER:\n${prompt}\n\n${provider.toUpperCase()}:\n${step.output}`;
  results.push({ provider, model: step.model, effort: step.effort, sessionID: step.session_id, deliveryID,
    durationMS: reused ? step.duration_ms : Date.now() - start, sourceSHA256: reference.sha256, answerSHA256: sha(step.output), publicProgress, reusedNativeEvidence: reused });
  save('audit.json', { status: 'RUNNING', mode, results });
  console.log(JSON.stringify(results.at(-1)));
}
assert(fs.readFileSync(path.join(os.homedir(), 'Library/Application Support/OS-1/sessions.json')).equals(originalStore), 'live tests changed the real conversation store');
assert([...new Set(providers)].every(p => results.some(r => r.provider === p && r.publicProgress)), 'each provider needs fresh public-progress evidence');
save('audit.json', { status: 'PASS', mode, modelCalls: results.filter(r => !r.reusedNativeEvidence).length, conversationID, results,
  assertions: ['source bytes retained', mode === 'cross-provider' ? 'Codex to Claude to Codex' : 'Codex to Codex only; Claude not exercised', 'native resume identity', 'read-only scope',
    'operating vs recovery vs live distinction', 'public progress', 'no application reveal', 'real session store unchanged'] });
} catch (error) {
  save('audit.json', { status: 'FAIL', mode, results, error: String(error.stack || error),
    realSessionStoreUnchanged: fs.readFileSync(path.join(os.homedir(), 'Library/Application Support/OS-1/sessions.json')).equals(originalStore) });
  throw error;
}
