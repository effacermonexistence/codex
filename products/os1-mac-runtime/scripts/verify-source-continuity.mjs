// Opt-in live regression. Runs provider tasks but never edits the user's
// conversation history or resumes an active provider session.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const [appArg, runtimeArg, sessionID, messageID, outputProfile] = process.argv.slice(2);
const humanFirst = outputProfile === '--human-first';
const metrics = [];
const previousUsage = new Map();
assert(appArg && runtimeArg && sessionID && messageID, 'app runtime sessionID messageID required');
const app = resolve(appArg), runtime = resolve(runtimeArg);
const out = mkdtempSync(join(tmpdir(), 'os1-continuity-live-'));
const state = JSON.parse(readFileSync(join(homedir(), 'Library/Application Support/OS-1/sessions.json')));
const session = state.sessions.find(s => s.id === sessionID);
const target = session.messages.find(m => m.id === messageID);
assert.equal(target.role, 'user');
const encoded = execFileSync(app, ['--export-session-context', sessionID, messageID], { encoding: 'utf8', timeout: 30000 });
const handoff = JSON.parse(encoded);
assert(handoff.source, 'The real application handoff must migrate the verified retrieval receipt');
assert(!handoff.transcript.includes(target.text), 'Current request must not be duplicated in history');
const initial = join(out, 'initial-context.json');
writeFileSync(initial, encoded, { mode: 0o600 });
console.log(JSON.stringify({ stage: 'real-app-handoff', out, source: handoff.source, bytes: Buffer.byteLength(encoded) }));

function run(name, prompt, context, provider = 'claude', extra = []) {
  const args = ['run', '--workspace', session.workspace, '--prompt', prompt, '--provider', provider,
    '--context-file', context, '--codex-capacity', '30', '--claude-capacity', '100',
    '--desktop-reveal', 'never', '--output-format', 'json', ...extra];
  const start = Date.now();
  const raw = execFileSync(runtime, args, { encoding: 'utf8', timeout: 360000, maxBuffer: 4_000_000 });
  writeFileSync(join(out, name + '.json'), raw, { mode: 0o600 });
  const summary = JSON.parse(raw);
  assert.equal(summary.status, 'complete');
  assert(summary.sourceContext, 'Result must retain the bound source');
  const step = summary.steps.at(-1);
  assert.equal(step.exit_code, 0);
  assert.equal(step.native_record.persistence, 'verified');
  assert(!/현재 저장소 로컬 클론을 못 찾|저장소 경로를 알려주면|R2 조회 불가/.test(step.output));
  if (humanFirst) {
    if (step.provider !== 'local') assert.match(step.output.normalize('NFC'), /[가-힣]/, 'Korean request needs Korean explanation');
    if (name !== 'explicit-json') {
      const jsonSize = [...step.output.matchAll(/```json\s*\n([\s\S]*?)\n```/g)].reduce((sum, m) => sum + m[1].length, 0);
      assert(jsonSize < 900 || jsonSize * 2 <= step.output.length, 'Default answer must not be a JSON dump');
    }
  }
  if (step.provider === 'claude') {
    const records = readFileSync(step.native_record.record_path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    const messages = new Map();
    for (const record of records) if (record.message?.id && record.message?.usage) messages.set(record.message.id, record.message.usage);
    const usage = [...messages.values()].reduce((sum, u) => ({
      input: sum.input + (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
      output: sum.output + (u.output_tokens || 0),
    }), { input: 0, output: 0 });
    const delivered = records.flatMap(r => r.message?.role === 'assistant' ? (r.message.content || []).filter(c => c.type === 'text').map(c => c.text) : []);
    assert(delivered.includes(step.output), 'Displayed final output must be the actual persisted native answer');
    const previous = previousUsage.get(step.session_id) || { input: 0, output: 0 };
    const current = { input: usage.input - previous.input, output: usage.output - previous.output };
    previousUsage.set(step.session_id, usage);
    metrics.push({ name, ...current, sessionTotal: usage, uniqueNativeMessages: messages.size });
    console.log(JSON.stringify({ stage: 'native-usage', name, ...current }));
  }
  console.log(JSON.stringify({ stage: name, ms: Date.now() - start, provider: step.provider, model: step.model,
    session: step.session_id, source: summary.sourceContext, record: step.native_record.record_path }));
  return summary;
}

const first = run('exact-incident', target.text.normalize('NFD'), initial, 'auto');
const firstStep = first.steps.at(-1);
assert.match(firstStep.output, /QM|qm/);
assert.match(firstStep.output, /GR|gr/);
const nextPath = join(out, 'next-context.json');
writeFileSync(nextPath, JSON.stringify({ format: 'os1-session-handoff-v2', source: first.sourceContext,
  transcript: `USER:\n${target.text}\n\nCLAUDE:\n${firstStep.output}` }), { mode: 0o600 });
const next = run('continued-refinement', '스키마의 활성 레인과 미해결 레인을 표로 정리해 줘. 원본의 claim ceiling을 유지해.', nextPath,
  'claude', firstStep.provider === 'claude' ? ['--claude-session-id', firstStep.session_id] : []);
assert.deepEqual(next.sourceContext, first.sourceContext);
const switched = run('codex-handoff', '같은 원본 기준으로 방금 설계의 hard gate와 미해결 blocker 구분을 짧게 검토해 줘. 파일 수정은 하지 마.',
  nextPath, 'codex');
assert.deepEqual(switched.sourceContext, first.sourceContext);
const arithmetic = run('local-arithmetic', '1 더하기 1은?', nextPath, 'auto');
assert.equal(arithmetic.steps.at(-1).provider, 'local');
assert.deepEqual(arithmetic.sourceContext, first.sourceContext);
if (humanFirst) {
  const explicit = run('explicit-json', '같은 원본 기준으로 한국어 요약 한 문장과 JSON 스키마를 작성해. JSON에는 objective.required_stage_ids와 stages 배열을 넣고 각 stage_id, depends_on, required 필드를 일관되게 맞춰. 단계는 3개로 작게. 파일 변경 없이 답변만.', nextPath, 'claude');
  assert.match(explicit.steps.at(-1).output, /```json/);
  assert.deepEqual(explicit.sourceContext, first.sourceContext);
}
writeFileSync(join(out, 'audit.json'), JSON.stringify({ passed: true, sessionID, messageID,
  cases: ['exact-incident', 'continued-refinement', 'codex-handoff', 'local-arithmetic', ...(humanFirst ? ['explicit-json'] : [])],
  source: first.sourceContext, metrics }), { mode: 0o600 });
console.log(`PASS: ${out}/audit.json`);
