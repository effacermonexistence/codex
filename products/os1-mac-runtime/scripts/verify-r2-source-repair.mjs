// Opt-in installed-build incident regression. Two end-to-end provider tasks,
// with governed retries counted separately; no session mutation or deploy.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const [appArg, runtimeArg, mode = '--local-only', desktopMode = 'never'] = process.argv.slice(2);
assert(appArg && runtimeArg && ['--live', '--local-only'].includes(mode) && ['never', 'background'].includes(desktopMode),
  'app runtime [--live|--local-only] [never|background]');
const app = resolve(appArg), runtime = resolve(runtimeArg);
const out = mkdtempSync(join(tmpdir(), 'os1-r2-repair-test-'));
const evidenceRoot = join(homedir(), 'Library/Application Support/OS-1');
const incidentSession = '9C8C2569-F64F-4E6E-A5A9-61E937CD4475';
const incidentMessage = 'CAC9A219-D814-4F0B-951B-46AFD0FF6E13';
const exact = '그럼 QAAM이랑 GR 통합이 어디까지 진행되는데?아니, R2 자료보면...';
const audit = { out, runtime, desktopMode, cases: [], providers: [] };
const before = JSON.parse(readFileSync(join(evidenceRoot, 'sessions.json')));
const hash = data => createHash('sha256').update(data).digest('hex');
function save(name, value) {
  const file = join(out, name + '.json');
  writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 }); return file;
}
function run(name, prompt, context = null, { provider = 'auto', denyDocuments = false } = {}) {
  const args = ['run', '--workspace', homedir(), '--prompt', prompt, '--provider', provider,
    '--desktop-reveal', desktopMode, '--output-format', 'json'];
  if (context) args.push('--context-file', save(name + '-context', context));
  const started = Date.now();
  const raw = denyDocuments
    ? execFileSync('/usr/bin/sandbox-exec', ['-p', `(version 1) (allow default) (deny file-read* (subpath "${homedir()}/Documents"))`, runtime, ...args],
      { cwd: homedir(), encoding: 'utf8', timeout: 180000, maxBuffer: 4_000_000 })
    : execFileSync(runtime, args, { cwd: homedir(), encoding: 'utf8', timeout: 300000, maxBuffer: 4_000_000 });
  const summary = JSON.parse(raw); save(name, summary);
  assert.equal(summary.status, 'complete');
  const step = summary.steps.at(-1);
  assert.equal(step.exit_code, 0); assert.equal(step.native_record.persistence, 'verified');
  audit.cases.push({ name, ms: Date.now() - started, provider: step.provider, model: step.model,
    governedSequence: step.sequence, source: summary.sourceContext, record: step.native_record.record_path });
  console.log(JSON.stringify(audit.cases.at(-1)));
  if (step.provider === 'claude') {
    if (desktopMode === 'background') assert.equal(step.native_record.desktop_visibility, 'native_record_only');
    const records = readFileSync(step.native_record.record_path, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    const replies = records.flatMap(r => r.message?.role === 'assistant' ? (r.message.content || []).filter(c => c.type === 'text').map(c => c.text) : []);
    assert(replies.includes(step.output), 'OS-1 answer must match the actual native answer');
    const messages = new Map();
    for (const r of records) if (r.message?.id && r.message?.usage) messages.set(r.message.id, r.message.usage);
    const tokens = [...messages.values()].reduce((n, u) => n + (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) +
      (u.cache_read_input_tokens || 0) + (u.output_tokens || 0), 0);
    audit.providers.push({ name, session: step.session_id, adoptedTokensIncludingCacheReads: tokens,
      accountingScope: 'Adopted native session only; prior rejected candidates are not included.', governedSequence: step.sequence });
  }
  return summary;
}
const tools = execFileSync(runtime, ['r2-tool-path'], { encoding: 'utf8' }).trim();
assert(!tools.includes('/Documents/')); assert(tools.includes('/OS-1/tools/wrangler-4.127.1/'));
for (let i = 1; i <= 2; i++) {
  const connected = run('connection-' + i, 'R2 연결이 되있냐?', null, { denyDocuments: true });
  assert.equal(connected.steps[0].provider, 'local'); assert.match(connected.steps[0].output, /R2 연결됨/);
}
const protectedPrompt = '야 R2에서 그 QM이랑 아니다 그 RCC 레바스로지 가져와봐';
const guarded = run('protected-source', protectedPrompt);
const explanation = run('protected-explanation', '설명해봐', { format: 'os1-session-handoff-v2',
  transcript: `USER:\n${protectedPrompt}\n\nOS-1:\n${guarded.steps[0].output}` });
assert.equal(explanation.steps[0].action, 'protected_material_guard');
const receipt = JSON.parse(readFileSync(explanation.steps[0].native_record.record_path));
assert.equal(receipt.r2_access_attempted, false); assert.equal(receipt.model_egress_blocked, true);

const fresh = run('opt-research', 'R2에서 QM이랑 GR, Orthogonal Projection Term Benchmark 원본 자료 가져와', null, { denyDocuments: true });
assert.equal(fresh.steps[0].provider, 'local');
const ref = fresh.sourceContext;
const bytes = readFileSync(join(evidenceRoot, 'source-snapshots', ref.id.toLowerCase() + '.json'));
assert.equal(hash(bytes), ref.sha256);
const source = JSON.parse(bytes);
assert.equal(source.sourceCount, 16);
for (const file of ['docs/CONCEPTUAL_ORIGIN.md', 'docs/OPERATOR.md', 'docs/EQUATION_INSERTIONS.md', 'docs/CLAIM_BOUNDARIES.md',
  'results/aggregate_specificity_audit.json', 'docs/QMGR_OBJECTIVE.md']) assert(source.sources.some(s => s.source_path === file));
assert(!source.sources.some(s => /instagram|outbox|business_ideas/i.test(s.source_path)));
assert(source.modelPayload.includes('SEPARATE EXPERIMENTAL SUPPLEMENT'));
for (const [start, end] of [
  ['--- EXECUTABLE CONTRACT ---', '--- OBJECTIVE CONTRACT JSON SCHEMA:'],
  ['--- VERIFIED RESULT ---', '--- RESULT JSON SCHEMA:'],
]) {
  const text = source.modelPayload.split(start)[1]?.split(end)[0]?.trim();
  const parsed = JSON.parse(text);
  assert(parsed && typeof parsed === 'object', 'Full JSON source, not a character-cut excerpt');
  if (start.includes('VERIFIED RESULT')) {
    assert(JSON.stringify(parsed).includes('WF_POISSON'));
    assert(JSON.stringify(parsed).includes('F0_EXACT_RECOVERY'));
    assert(parsed.results.J_exec <= 1); assert.equal(parsed.full_qm_gr_claim_allowed, false);
  }
}
const image = join(out, 'retrieved-research.png');
execFileSync(app, ['--render-run-summary', join(out, 'opt-research.json'), image], { encoding: 'utf8', timeout: 45000 });
const displayed = readFileSync(image + '.txt', 'utf8');
assert(displayed.includes('Orthogonal Projection Term 원본'));
assert(displayed.includes('별도 QMGR v1'));
assert(!/[a-f0-9]{64}|\\mathcal|manifest\.json/.test(displayed));
assert(readFileSync(image + '.copy.txt', 'utf8').includes(fresh.steps[0].output));
const layout = JSON.parse(readFileSync(image + '.layout.json'));
assert(layout.pairs.every(p => !p.intersects && p.gapPoints >= 12));
audit.cases.push({ name: 'real-retrieval-native-presentation', source: ref, overlaps: 0, image });
const tampered = structuredClone(fresh);
tampered.steps[0].output += '\nThis line was not in the verified result.';
const tamperedPath = save('tampered-result', tampered);
assert.throws(() => execFileSync(app, ['--render-run-summary', tamperedPath, join(out, 'must-not-render.png')],
  { encoding: 'utf8', timeout: 30000, stdio: 'pipe' }), 'Tampered result must not receive a verified presentation');
audit.cases.push({ name: 'tampered-result-rejected' });
const githubSHA = execFileSync('gh', ['api', 'repos/effacermonexistence/orthogonal-projection-term-benchmarks/commits/main', '--jq', '.sha'], { encoding: 'utf8' }).trim();
assert.equal(source.sources[0].repository_sha, githubSHA);
audit.source = { sourceCount: source.sourceCount, bytes: bytes.length, modelPayloadBytes: Buffer.byteLength(source.modelPayload), githubSHA,
  bundleSHA256: source.sources[0].bundle_sha256, verifiedSnapshot: ref };

if (mode === '--live') {
  const context = JSON.parse(execFileSync(app, ['--export-session-context', incidentSession, incidentMessage], { encoding: 'utf8' }));
  assert.equal(context.source.id, '7AA75A44-F7B2-42BE-AE12-779E6AE1AB63');
  const legacy = run('exact-failed-followup', exact, context);
  assert.deepEqual(legacy.sourceContext, context.source, 'An explicit R2 continuation must not replace its source');
  assert.match(legacy.steps.at(-1).output, /뉴턴|약장|양자 채널/);
  assert(!/사업 아이디어|outbox|Instagram/i.test(legacy.steps.at(-1).output));
  const mapped = run('opt-mapping-followup', '그 자료 기준으로 Orthogonal Projection Term의 개념, 실제 벤치마크, 별도 QMGR v1의 관계와 어디까지 진행됐는지 짧게 설명해. 거시적 superposition은 원문에 유도나 검증이 있는지 구분해. 파일 변경하지 마.', {
    format: 'os1-session-handoff-v2', source: ref,
    transcript: 'USER:\nR2에서 QMGR과 Orthogonal Projection Term Benchmark 자료 가져와\n\nOS-1:\n원본 연구와 별도 v1 실험을 검증해 회수했습니다.',
  }, { provider: 'claude' });
  assert.deepEqual(mapped.sourceContext, ref);
  assert.match(mapped.steps.at(-1).output, /벤치마크|benchmark|SPARC|X-COP/i);
  assert.match(mapped.steps.at(-1).output, /중첩|superposition/i);
}
assert.deepEqual(JSON.parse(readFileSync(join(evidenceRoot, 'sessions.json'))), before, 'Diagnostics must preserve user sessions');
audit.passed = true; save('audit', audit);
console.log('PASS: ' + join(out, 'audit.json'));
