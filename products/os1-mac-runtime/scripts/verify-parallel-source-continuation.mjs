// Opt-in single governed, read-only replay of the owner's actual failed
// source continuation. No Instagram backup/restore, session edit or deploy.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const [appPath, runtimePath] = process.argv.slice(2);
assert(appPath && runtimePath, 'app executable and runtime required');
const app = resolve(appPath), runtime = resolve(runtimePath);
const root = join(homedir(), 'Library/Application Support/OS-1');
const out = mkdtempSync(join(tmpdir(), 'os1-readiness-replay-'));
const sessionID = '781AE76B-D07A-4D16-BB32-420766592DA6';
const messageID = 'E56F99DA-2CC0-4494-A7D4-F34A66D3F023';
const prompt = '그럼 너 이거 지금 현재 상태 100% 복원 가능하게 할 수 있냐?언제든지 이 맥북이 죽어도 아니면 새로운 수정사항을 만들어도';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sessionsPath = join(root, 'sessions.json');
const before = readFileSync(sessionsPath);
const context = JSON.parse(execFileSync(app, ['--export-session-context', sessionID, messageID], { encoding: 'utf8' }));
assert.equal(context.source.sha256, 'c5e184326de9071ad2a828e81b3481caaf27cec98b1dab84a08def647976893d');
const sourceBytes = readFileSync(join(root, 'source-snapshots', context.source.id.toLowerCase() + '.json'));
assert.equal(hash(sourceBytes), context.source.sha256);
const contextPath = join(out, 'context.json');
writeFileSync(contextPath, JSON.stringify(context), { mode: 0o600 });
const oldReceipts = new Set(readdirSync(join(root, 'control-receipts')));
const began = Date.now();
const raw = execFileSync('/usr/bin/sandbox-exec', ['-p',
  `(version 1) (allow default) (deny file-read* file-write* (subpath "${homedir()}/Documents"))`,
  runtime, 'run', '--workspace', homedir(), '--prompt', prompt,
  '--context-file', contextPath, '--provider', 'auto', '--desktop-reveal', 'background', '--output-format', 'json'],
  { cwd: homedir(), encoding: 'utf8', timeout: 300000, maxBuffer: 8_000_000 });
const summary = JSON.parse(raw);
writeFileSync(join(out, 'summary.json'), raw, { mode: 0o600 });
assert.equal(summary.status, 'complete');
assert.deepEqual(summary.sourceContext, context.source);
assert(summary.steps.length > 0);
assert.equal(summary.steps.length, 1, 'Readiness acceptance requires one adopted backend turn');
assert.equal(summary.steps[0].sequence, 1, 'A four-attempt eventual answer is not first-pass acceptance');
const steps = [];
for (const step of summary.steps) {
  assert.equal(step.permission_profile, 'read_only');
  assert.equal(step.exit_code, 0);
  assert.equal(step.revas_disposition, 'adopted');
  assert.equal(step.native_record?.persistence, 'verified');
  assert(['claude', 'codex'].includes(step.provider));
  assert(step.output.length > 100);
  assert.doesNotMatch(step.output, /<\s*(?:invoke|function_calls|tool_call|tool_result)(?:\s|>)/i,
    'Snapshot answer must not simulate tool invocation/result markup');
  if (step.provider === 'claude') {
    const records = readFileSync(step.native_record.record_path, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    const replies = records.flatMap(r => r.message?.role === 'assistant'
      ? (r.message.content || []).filter(c => c.type === 'text').map(c => c.text) : []);
    assert(replies.includes(step.output), 'OS-1 must show the actual backend answer');
    const uses = records.flatMap(r => r.message?.content || []).filter(c => c.type === 'tool_use');
    assert.equal(uses.length, 0, 'A source-only readiness assessment must not perform production operations');
  }
  assert(/자료|출처|파일/.test(step.output));
  assert(/확인|검증|부족|보장|미확인|없/.test(step.output), 'Must explain limits of historical source evidence');
  const answerPath = join(out, 'answer.txt');
  writeFileSync(answerPath, step.output, { mode: 0o600 });
  const contract = JSON.parse(execFileSync(runtime, ['check-source-output', contextPath, answerPath, prompt], { encoding: 'utf8' }));
  assert.equal(contract.presentation_contract, true, 'Readiness must cover restore testing and non-code recovery prerequisites');
  steps.push({ provider: step.provider, model: step.model, effort: step.effort, sequence: step.sequence,
    durationMS: step.duration_ms, sessionID: step.session_id, nativeRecord: step.native_record.record_path });
}
const newRetrievalReceipts = readdirSync(join(root, 'control-receipts')).filter(name => !oldReceipts.has(name))
  .map(name => JSON.parse(readFileSync(join(root, 'control-receipts', name)))).filter(r => r.action === 'r2_retrieval');
assert.equal(newRetrievalReceipts.length, 0, 'Continuation must not launch a new retrieval');
assert.equal(hash(readFileSync(sessionsPath)), hash(before), 'Read-only diagnostic changed user conversations');
const audit = { passed: true, out, elapsedMS: Date.now() - began, sourceContext: context.source,
  documentsDenied: true, newRetrievalReceipts: 0, sessionsUnchanged: true, productionOperations: 0, steps,
  accountingScope: 'One OS-1 request. Sequence belongs to the final provider execution; earlier provider timeout/failover attempts are recorded separately in diagnostics and are not aggregate billed usage. This is not proof of global routing optimality.' };
writeFileSync(join(out, 'audit.json'), JSON.stringify(audit, null, 2), { mode: 0o600 });
console.log(JSON.stringify(audit, null, 2));
