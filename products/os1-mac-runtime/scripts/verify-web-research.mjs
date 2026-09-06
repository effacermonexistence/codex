#!/usr/bin/env node
// Opt-in live read-only regression. Does not edit user conversations, buy a
// product, loosen global policies or manufacture a matching Amazon item.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const [runtime, config, mode = 'incident'] = process.argv.slice(2);
assert(runtime && config && ['incident', 'canary'].includes(mode), 'runtime config [incident|canary]');
const root = path.join(os.homedir(), 'Library/Application Support/OS-1');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'os1-web-replay-'));
fs.chmodSync(out, 0o700);
const sessionsPath = path.join(root, 'sessions.json');
const sessionsBefore = fs.readFileSync(sessionsPath);
const session = JSON.parse(sessionsBefore).sessions.find(s => s.id === '7D178A00-371A-402B-B261-B7BA39E089B2');
const prompt = mode === 'incident'
  ? session?.messages.find(m => m.id === 'EA4E37C7-F405-46D8-8EF3-3200BF4EE441')?.text
  : '읽기 전용 웹 검색 기능 테스트입니다. WebFetch로 https://example.com 의 페이지 제목을 확인하고, WebSearch로 Amazon Cartier rimless glasses 를 검색해서 검색된 링크 한 개만 출처와 함께 알려주세요. 도구를 각각 한 번 사용하고 파일이나 계정은 변경하지 마세요. 원본 상품을 확인한 것이 아니므로 동일 제품을 찾았다고 주장하지 마세요.';
assert(prompt);
const began = Date.now();
const diagnostics = path.join(root, 'diagnostics');
const oldDiagnostics = new Set(fs.readdirSync(diagnostics));
console.log(JSON.stringify({ out, mode, began: new Date(began).toISOString(), runtime }));
const child = spawn(path.resolve(runtime), ['run', '--workspace', os.homedir(), '--prompt', prompt,
  '--provider', mode === 'incident' ? session.provider : 'claude', '--desktop-reveal', 'background', '--output-format', 'json'],
  { cwd: os.homedir(), env: { ...process.env, OS1_CONFIG: path.resolve(config) }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '', timedOut = false;
child.stdout.on('data', b => { stdout += b; });
child.stderr.on('data', b => { stderr += b; });
const timer = setTimeout(() => {
  timedOut = true;
  // Only this diagnostic's process group, not other OS-1/backend sessions.
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
}, 300_000);
const code = await new Promise((resolve, reject) => {
  child.once('error', reject); child.once('close', resolve);
});
clearTimeout(timer);
fs.writeFileSync(path.join(out, 'stdout.json'), stdout, { mode: 0o600 });
fs.writeFileSync(path.join(out, 'stderr.txt'), stderr, { mode: 0o600 });
const newDiagnostics = fs.readdirSync(diagnostics).filter(f => !oldDiagnostics.has(f))
  .map(f => { try { return { file: f, data: JSON.parse(fs.readFileSync(path.join(diagnostics, f))) }; } catch { return null; } }).filter(Boolean);
fs.writeFileSync(path.join(out, 'diagnostics.json'), JSON.stringify(newDiagnostics, null, 2), { mode: 0o600 });
assert(!timedOut, `Bounded diagnostic timed out; evidence: ${out}`);
assert.equal(code, 0, `OS-1 replay failed: ${stderr}; evidence: ${out}`);
const summary = JSON.parse(stdout);
assert.equal(summary.status, 'complete');
assert(summary.steps.length > 0);
let fetches = 0, searches = 0, denials = 0, destinationSearches = 0;
const steps = [];
for (const step of summary.steps) {
  assert.equal(step.permission_profile, 'read_only');
  assert.equal(step.sequence, 1, 'A straightforward lookup/canary must not consume governed retries');
  assert.equal(step.exit_code, 0);
  assert.equal(step.revas_disposition, 'adopted');
  assert.equal(step.native_record?.persistence, 'verified');
  assert.equal(step.provider, 'claude', 'This regression must exercise the repaired Claude lane');
  const records = fs.readFileSync(step.native_record.record_path, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const content = records.flatMap(r => Array.isArray(r.message?.content) ? r.message.content : []);
  const uses = content.filter(c => c.type === 'tool_use');
  const results = content.filter(c => c.type === 'tool_result');
  assert(uses.every(c => ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'].includes(c.name)), 'Read-only tool surface escaped');
  fetches += uses.filter(c => c.name === 'WebFetch').length;
  searches += uses.filter(c => c.name === 'WebSearch').length;
  destinationSearches += uses.filter(c => c.name === 'WebSearch' && /amazon|아마존/i.test(c.input?.query || '')).length;
  denials += results.filter(c => /Permission to use .* (denied|not allowed)/i.test(JSON.stringify(c.content))).length;
  if (mode === 'canary') {
    for (const name of ['WebFetch', 'WebSearch']) {
      assert(uses.some(u => u.name === name && results.some(r => r.tool_use_id === u.id && !r.is_error && r.content)),
        `${name} canary requires successful tool-result evidence, not invocation alone`);
    }
  }
  assert(content.some(c => c.type === 'text' && c.text === step.output), 'OS-1 must preserve the actual native answer');
  steps.push({ provider: step.provider, model: step.model, effort: step.effort, sequence: step.sequence,
    durationMS: step.duration_ms, sessionID: step.session_id, nativeRecord: step.native_record.record_path,
    tools: uses.map(c => ({ name: c.name, id: c.id })),
    results: results.map(c => ({ toolUseID: c.tool_use_id, isError: !!c.is_error,
      text: JSON.stringify(c.content).slice(0, 2000) })) });
}
assert(fetches > 0 && searches > 0, 'Both web tools must actually be invoked');
assert(destinationSearches > 0, 'The original requested destination (Amazon) must be searched, not substituted with unrelated retailers');
assert.equal(denials, 0);
const after = JSON.parse(fs.readFileSync(sessionsPath));
for (const prior of JSON.parse(sessionsBefore).sessions) {
  const next = after.sessions.find(s => s.id === prior.id);
  assert(next && prior.messages.every(m => next.messages.some(n => n.id === m.id && n.text === m.text)), 'User conversation was lost');
}
const audit = { mode, out, elapsedMS: Date.now() - began, runtimeSHA256: createHash('sha256').update(fs.readFileSync(runtime)).digest('hex'),
  passed: true, webFetchCalls: fetches, webSearchCalls: searches, destinationSearches, permissionDenials: denials,
  existingMessagesPreserved: true, steps,
  objectiveCompletion: mode === 'incident' ? 'Human audit required: verify actual product identity; honest site-access limitation is not a completed identical-product lookup.' : 'Tool availability canary only; not product identification.',
  accounting: 'Native tool calls and latency are measured. Billed/cache tokens and monetary cost are not inferred from routing estimates.' };
fs.writeFileSync(path.join(out, 'audit.json'), JSON.stringify(audit, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ ...audit, steps: steps.map(({ results, ...s }) => s) }, null, 2));
