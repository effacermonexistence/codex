#!/usr/bin/env node
// Opt-in regression: reads R2; --live also makes one read-only provider turn.
// Never edits OS1 conversations, copies credentials, or publishes source text.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [runtime, config, out, mode] = process.argv.slice(2);
assert(runtime && config && out && ['--baseline', '--retrieval-only', '--live'].includes(mode),
  'runtime config NEW-private-output-directory --baseline|--retrieval-only|--live');
assert(!fs.existsSync(out), 'refusing to overwrite prior evidence');
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
const root = path.join(os.homedir(), 'Library/Application Support/OS-1');
const sessionsFile = path.join(root, 'sessions.json');
const before = fs.readFileSync(sessionsFile), sessionData = JSON.parse(before);
const hash = x => createHash('sha256').update(x).digest('hex');
const save = (name, data) => {
  const file = path.join(out, name);
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  return file;
};
const exact = '거기서 QM이랑 GAR 자료 가져와봐';
const incident = sessionData.sessions.find(s => s.id === 'AA28AC13-84ED-49F8-B482-A279FEFD1295');
const persisted = incident?.messages.find(m => m.id === 'CA2DD981-4A7E-4DE0-B29F-90F0CFD2A4DF');
if (persisted) assert.equal(persisted.text.normalize('NFC'), exact);
const context = 'USER:\n야 R2 연결시켜\n\nOS-1:\nR2 연결됨 — omar-private-archive 접근 확인';
const contextFile = save('context.txt', context);
const audit = { schema: 'os1-gar-retrieval-audit-v1', mode, beganAt: new Date().toISOString(),
  runtimeSHA256: hash(fs.readFileSync(runtime)), requestSHA256: hash(exact),
  contextSHA256: hash(context), sessionCount: sessionData.sessions.length,
  incidentRequestMatches: Boolean(persisted), checks: [], runs: [], modelCalls: 0 };
function check(name, fn) { fn(); audit.checks.push({ name, status: 'PASS' }); }
async function run(name, prompt, contextPath) {
  const began = Date.now();
  const child = spawn(runtime, ['run', '--workspace', os.homedir(), '--prompt', prompt,
    '--provider', 'auto', '--codex-capacity', '30', '--claude-capacity', '100',
    '--desktop-reveal', 'never', '--output-format', 'json', '--context-file', contextPath],
  { cwd: os.homedir(), env: { ...process.env, OS1_CONFIG: config }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = [], stderr = []; let size = 0, bounded = true, killTimer;
  function stop() {
    bounded = false; try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    killTimer ??= setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5000);
  }
  for (const [stream, buffer] of [[child.stdout, stdout], [child.stderr, stderr]]) {
    stream.on('data', x => { size += x.length; if (size > 8_000_000) stop(); else buffer.push(x); });
  }
  const timer = setTimeout(stop, 300_000);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  clearTimeout(timer); clearTimeout(killTimer);
  const output = Buffer.concat(stdout).toString(), err = Buffer.concat(stderr).toString();
  let summary; try { summary = JSON.parse(output); } catch {}
  const result = { name, code, wallMS: Date.now() - began, stdoutSHA256: hash(output), stderrSHA256: hash(err),
    stderrBytes: Buffer.byteLength(err), bounded };
  audit.runs.push(result);
  assert(bounded, `${name} exceeded bounded execution`);
  if (summary) save(`${name}-summary.json`, { ...summary,
    steps: (summary.steps || []).map(s => ({ ...s, stderr: s.stderr ? `[omitted:${hash(s.stderr)}]` : '' })) });
  return { summary, err, result };
}
const originalPaths = ['README.md', 'docs/CONCEPTUAL_ORIGIN.md', 'docs/OPERATOR.md', 'docs/EQUATION_INSERTIONS.md',
  'docs/CLAIM_BOUNDARIES.md', 'docs/EXPERIMENT_REGISTRY.md', 'results/aggregate_specificity_audit.json',
  'src/orthogonal_projection_term/operators.py'];
const supplementPaths = ['docs/QMGR_OBJECTIVE.md', 'configs/qmgr_objective_v1.json',
  'results/qmgr_weak_field_compatibility.json', 'schemas/qm-gr-objective-contract-v1.schema.json',
  'schemas/qm-gr-weak-field-compatibility-result-v1.schema.json', 'src/orthogonal_projection_term/qmgr.py',
  'scripts/run_qmgr_objective.py', 'tests/test_qmgr.py'];
function validateSource(ref) {
  assert.equal(ref.kind, 'snapshot');
  const file = path.join(root, 'source-snapshots', ref.id.toLowerCase() + '.json');
  const bytes = fs.readFileSync(file), data = JSON.parse(bytes);
  check('snapshot file and payload digests', () => {
    assert.equal(hash(bytes), ref.sha256); assert.equal(hash(data.modelPayload), data.evidenceSHA256);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });
  const originals = data.sources.filter(x => x.repository === 'effacermonexistence/orthogonal-projection-term-benchmarks');
  const supplements = data.sources.filter(x => x.repository === 'private-r2/qmgr-objective-v1');
  check('live R2 original and separately labelled supplement, not generic archive hits', () => {
    assert.equal(data.verificationMode, 'live-r2-opt-research-map+separate-qmgr-v1');
    assert.equal(data.sourceCount, 16); assert.equal(data.sources.length, 16);
    assert.deepEqual(new Set(originals.map(x => x.source_path)), new Set(originalPaths));
    assert.deepEqual(new Set(supplements.map(x => x.source_path)), new Set(supplementPaths));
    const hex = (x, n = 64) => new RegExp(`^[a-f0-9]{${n}}$`).test(x ?? '');
    assert(originals.every(x => hex(x.repository_sha, 40) && hex(x.bundle_sha256) && hex(x.source_content_sha256) &&
      Number(x.object_size) > 0 && Number(x.source_size) > 0 && x.object_key.includes(x.repository_sha)));
    assert(supplements.every(x => hex(x.base_repository_sha, 40) && hex(x.retrieved_content_sha256) && hex(x.transport_sha256) &&
      Number(x.object_size) > 0 && x.object_key.endsWith('/' + x.source_path)));
  });
  audit.source = { ...ref, file, evidenceSHA256: data.evidenceSHA256, sources: data.sources, sourceCount: data.sourceCount };
  save('retrieved-materials.md', data.userOutput);
  return data;
}
let failure;
try {
  const diagnosticRoot = path.join(root, 'diagnostics');
  const priorDiagnostics = new Set(fs.readdirSync(diagnosticRoot));
  const retrieval = await run('retrieval', exact, contextFile);
  if (mode === '--baseline') {
    check('unmodified installed runtime reproduces exact retrieval failure', () => {
      assert.notEqual(retrieval.result.code, 0);
      assert.match(retrieval.err, /이번 검색 범위에서 요청한 주제를 모두 확인할 수 있는 R2 원문을 찾지 못했습니다/);
      assert(!retrieval.summary?.sourceContext);
    });
  } else {
    assert.equal(retrieval.result.code, 0);
    const summary = retrieval.summary, step = summary.steps[0];
    check('single local verified acquisition, no provider needed', () => {
      assert.equal(summary.steps.length, 1); assert.equal(step.provider, 'local');
      assert.equal(step.model, 'os1-evidence-resolver'); assert.equal(step.exit_code, 0);
      assert.equal(step.native_record.persistence, 'verified');
    });
    validateSource(summary.sourceContext);
    const selections = fs.readdirSync(diagnosticRoot).filter(x => !priorDiagnostics.has(x) && x.startsWith('retrieval-selection-'))
      .map(x => JSON.parse(fs.readFileSync(path.join(diagnosticRoot, x)))).filter(x => x.request_sha256 === hash(exact));
    check('bounded alias plus inherited R2 is selected before acquisition', () => {
      assert.equal(selections.length, 1); const d = selections[0];
      assert.equal(d.material_kind, 'qmGR'); assert.equal(d.paired_gr_dictation_alias, true);
      assert.equal(d.inherited_source, true); assert.equal(d.requires_transformation, false);
      assert.equal(d.generic_term_count, 0); assert.equal(d.context_sha256, hash(context));
    });
    audit.selection = selections[0];
    if (mode === '--live') {
      const nextContext = save('followup-context.json', { format: 'os1-session-handoff-v2',
        transcript: `${context}\n\nUSER:\n${exact}\n\nOS-1:\n${step.output}`, source: summary.sourceContext });
      const followup = await run('followup', '그 자료 원본의 연구 목표와 별도 실험의 범위를 짧게 설명해줘', nextContext);
      assert.equal(followup.result.code, 0);
      const next = followup.summary.steps[0]; audit.modelCalls = followup.summary.steps.filter(x => ['claude', 'codex'].includes(x.provider)).length;
      check('follow-up preserves source identity and verified native answer', () => {
        assert.equal(followup.summary.steps.length, 1); assert.equal(next.sequence, 1);
        assert.equal(next.permission_profile, 'read_only'); assert.equal(next.exit_code, 0);
        assert.equal(next.revas_disposition, 'adopted'); assert.equal(next.native_record.persistence, 'verified');
        assert.deepEqual(followup.summary.sourceContext, summary.sourceContext);
        const nativeBytes = fs.readFileSync(next.native_record.record_path);
        const rows = nativeBytes.toString().split('\n').filter(Boolean).map(JSON.parse);
        const identical = next.provider === 'claude'
          ? rows.some(r => r.message?.role === 'assistant' && r.message.content?.some(c => c.type === 'text' && c.text === next.output))
          : rows.some(r => r.type === 'response_item' && r.payload?.role === 'assistant' && r.payload.content?.some(c => c.type === 'output_text' && c.text === next.output));
        assert(identical); audit.native = { path: next.native_record.record_path, sha256: hash(nativeBytes), identical };
        assert.match(next.output, /Orthogonal Projection|직교.{0,10}투영|\bOPT\b/i);
        assert.match(next.output, /CPTP|양자.{0,8}채널/); assert.match(next.output, /뉴턴|Newton|약장|weak.field/i);
        assert.match(next.output, /별도|별개|보조|supplement|separate/i);
      });
      save('followup.md', next.output);
    }
  }
} catch (error) { failure = error; }
try { check('OS1 conversations preserved byte-for-byte', () => assert(fs.readFileSync(sessionsFile).equals(before))); }
catch (error) { failure ??= error; }
audit.endedAt = new Date().toISOString(); audit.passed = !failure;
if (failure) audit.failure = String(failure.message || failure).slice(0, 800);
save('audit.json', audit);
console.log(JSON.stringify({ passed: audit.passed, checks: audit.checks.length, modelCalls: audit.modelCalls, out,
  runs: audit.runs, failure: audit.failure }));
if (failure) process.exitCode = 1;
