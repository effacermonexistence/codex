#!/usr/bin/env node
// Opt-in installed-build QoM regression. R2 reads and provider turns are
// bounded; OS-1 conversations are never edited and model thinking is not copied.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [runtimeArg, configArg, appArg, mode, artifactArg] = process.argv.slice(2);
assert(runtimeArg && configArg && appArg && ['--retrieval-only', '--live', '--check-fixture', '--recheck-existing'].includes(mode),
  'runtime config app [--retrieval-only|--live|--check-fixture|--recheck-existing artifact-dir]');
assert(mode !== '--recheck-existing' || artifactArg, '--recheck-existing requires the immutable live artifact directory');
const runtime = path.resolve(runtimeArg), config = path.resolve(configArg);
const appInput = path.resolve(appArg);
const app = fs.statSync(appInput).isDirectory() ? path.join(appInput, 'Contents/MacOS/OS1App') : appInput;
const baseline = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/os1-qom-baseline-2026-09-05.md');
for (const file of [runtime, config, app, baseline]) assert(fs.statSync(file).isFile(), `missing ${file}`);

const exact = 'R2에서 QoM과 GR 통합하는 자료들 가져와';
const followup = '설명 좀 해봐 어디까지 진행되는데';
const rendererFixture = 'R2에서 QM·GR과 Orthogonal Projection Term 원본을 가져와.';
const incident = { session: '0E7F83E5-9BBE-48E3-BA7D-76927AE20139',
  prior: 'D591C84D-5860-4041-BA85-C55950F6FD30', followup: '05A4450E-A88A-418F-B9FE-A20046D92559',
  badAnswer: '1DAF2FF6-D048-480B-9B68-5D9CCD84D831',
  receipt: 'afa88e66-6a64-47b9-9f09-b9fe789da723', source: 'E3BED3A0-325F-456B-AC3F-327BC3B1BD5F',
  sourceSHA: '7d743104443317fac2383b9b61832f10b0a5847e6fa99fb19f31b1b72f6d6995',
  claude: 'bae5987c-3fd1-4d08-a85c-6d9c18d41e86' };
const existingReplay = {
  auditSHA256: '907a76d677736cac4b32106e7f82b689ca0e3c4234f44b524511842e8f13721c',
  freshSummarySHA256: '93a9f4fbb0f0d1f7ed4132b906c68c760556cd86514c5a0574a6ead25e860f7e',
  legacySummarySHA256: 'db9e2ec21b89d4138ee4f009b90bc841e27fbe7bedd72c0c6719fc35598119e1',
  freshOutputSHA256: 'ed89b1fb6971bc8e894f319046e28bedbfbd1c599f8db421c9ed95fa7b9e3743',
  legacyOutputSHA256: 'bef66732248663c208563c55be3fe587be35972c44f10103936c4dfe633e9cbf',
  freshContextSHA256: '1128de2fb2f1a191d572772fa361fb39aef1bf9b7a17a1a9ddfa0a4a62446ea2',
  legacyContextSHA256: '24d86df648de0ba7c071fd0c7c0333999270e4a316d426a8bbee7d8c77936768',
  freshSession: 'cf9d283f-b92a-42de-a6ef-d8c97b4044cd', legacySession: '17db0272-fc3c-402b-9f09-2cda62056a9a',
};
const originalPaths = ['README.md', 'docs/CONCEPTUAL_ORIGIN.md', 'docs/OPERATOR.md', 'docs/EQUATION_INSERTIONS.md',
  'docs/CLAIM_BOUNDARIES.md', 'docs/EXPERIMENT_REGISTRY.md', 'results/aggregate_specificity_audit.json',
  'src/orthogonal_projection_term/operators.py'];
const supplementPaths = ['docs/QMGR_OBJECTIVE.md', 'configs/qmgr_objective_v1.json',
  'results/qmgr_weak_field_compatibility.json', 'schemas/qm-gr-objective-contract-v1.schema.json',
  'schemas/qm-gr-weak-field-compatibility-result-v1.schema.json', 'src/orthogonal_projection_term/qmgr.py',
  'scripts/run_qmgr_objective.py', 'tests/test_qmgr.py'];
const wrongPaths = ['lua_interface_js.py', 'ben_business_ideas_registry.md', 'luaSystemPrompt.py',
  'NEW_ACCOUNT_EMERGENCY_TAKEOVER_2026-06-18.md', '.bkit/audit/2026-06-25.jsonl', 'thread-history/1884176720.json'];

const root = path.join(os.homedir(), 'Library/Application Support/OS-1');
const sessionsFile = path.join(root, 'sessions.json'), diagnosticsDir = path.join(root, 'diagnostics');
const receiptsDir = path.join(root, 'control-receipts'), snapshotsDir = path.join(root, 'source-snapshots');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'os1-qom-continuity-')); fs.chmodSync(out, 0o700);
const hash = value => createHash('sha256').update(value).digest('hex');
const save = (name, value) => { const file = path.join(out, name); fs.writeFileSync(file,
  typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); return file; };
const beforeSessions = fs.readFileSync(sessionsFile), beforeBaseline = fs.readFileSync(baseline);
const incidentSession = JSON.parse(beforeSessions).sessions.find(x => x.id === incident.session);
const persistedExact = incidentSession?.messages.find(x => x.id === incident.prior)?.text;
assert.equal(persistedExact?.normalize('NFC'), exact, 'persisted incident request differs from the exact user prompt');
const wireExact = persistedExact.normalize('NFD');
const incidentReceiptBytes = fs.readFileSync(path.join(receiptsDir, incident.receipt.toLowerCase() + '.json'));
const incidentReceipt = JSON.parse(incidentReceiptBytes);
assert.equal(hash(wireExact), incidentReceipt.request_sha256, 'NFD replay does not match the incident wire receipt');
save('baseline-before-replay.md', beforeBaseline);
const checks = [], audit = { schema: 'os1-qom-source-continuity-audit-v1', mode, out,
  beganAt: new Date().toISOString(), runtimeSHA256: hash(fs.readFileSync(runtime)), appSHA256: hash(fs.readFileSync(app)),
  configSHA256: hash(fs.readFileSync(config)), baselineSHA256: hash(beforeBaseline), incident, checks, runs: [],
  modelCalls: 0,
  accounting: 'All byte counts and hashes are exact. Token counts come only from adopted native usage when exposed; rejected-candidate token usage is unavailable.' };
const failures = [];
function check(name, fn) {
  try { fn(); checks.push({ name, status: 'PASS' }); }
  catch (error) { failures.push(name); checks.push({ name, status: 'FAIL', error: String(error && error.message || error) }); }
}
function directoryManifest(directory) {
  return hash(JSON.stringify(fs.readdirSync(directory).sort().map(name => {
    const stat = fs.statSync(path.join(directory, name)); return [name, stat.size, stat.mtimeMs, stat.mode & 0o777];
  })));
}

async function command(name, executable, args, env = process.env) {
  const began = Date.now(), child = spawn(executable, args,
    { cwd: os.homedir(), env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = [], stderr = []; let bytes = 0, timedOut = false, killTimer;
  const collect = target => chunk => { bytes += chunk.length; if (bytes > 8_000_000) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    killTimer ??= setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5_000); return; } target.push(chunk); };
  child.stdout.on('data', collect(stdout)); child.stderr.on('data', collect(stderr));
  const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 5_000); }, 300_000);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  clearTimeout(timer); if (killTimer) clearTimeout(killTimer);
  const output = Buffer.concat(stdout), error = Buffer.concat(stderr);
  save(`${name}-stderr.json`, { bytes: error.length, sha256: hash(error) }); // no stderr/secrets copied
  assert(!timedOut && bytes <= 8_000_000, `${name} exceeded its bounded execution`);
  assert.equal(code, 0, `${name} failed; stderr sha256=${hash(error)}`);
  return { output, wallMS: Date.now() - began };
}

function diagNames() { return new Set(fs.existsSync(diagnosticsDir) ? fs.readdirSync(diagnosticsDir) : []); }
function diagnosticsSince(before, sourceSHA) {
  const result = { routingBytes: [], failedAttempts: [] };
  for (const name of fs.readdirSync(diagnosticsDir).filter(item => !before.has(item))) {
    let data; try { data = JSON.parse(fs.readFileSync(path.join(diagnosticsDir, name))); } catch { continue; }
    if (data.source_sha256 !== sourceSHA) continue;
    if (name.startsWith('routing-input-')) result.routingBytes.push({ inputUTF8Bytes: data.input_utf8_bytes,
      sourceUTF8Bytes: data.source_utf8_bytes, historyUTF8Bytes: data.history_utf8_bytes });
    if (name.startsWith('execution-')) result.failedAttempts.push({ executionID: data.execution_id,
      sequence: data.sequence, provider: data.provider, model: data.model, effort: data.effort,
      reasonSHA256: hash(String(data.reason ?? '')) });
  }
  return result;
}

async function run(name, prompt, contextFile, extra = []) {
  const before = diagNames(), args = ['run', '--workspace', os.homedir(), '--prompt', prompt, '--provider', 'auto',
    '--codex-capacity', '30', '--claude-capacity', '100', '--desktop-reveal', 'background', '--output-format', 'json'];
  if (contextFile) args.push('--context-file', contextFile); args.push(...extra);
  const process = await command(name, runtime, args, { ...processEnv, OS1_CONFIG: config });
  const summary = JSON.parse(process.output); save(`${name}-summary.json`, { ...summary,
    steps: summary.steps.map(step => ({ ...step, stderr: step.stderr ? `[omitted:${hash(step.stderr)}]` : '' })) });
  return { summary, process, diagnostics: diagnosticsSince(before, summary.sourceContext?.sha256) };
}
const processEnv = process.env;

function source(reference) {
  assert.equal(reference.kind, 'snapshot');
  const file = path.join(snapshotsDir, reference.id.toLowerCase() + '.json'), bytes = fs.readFileSync(file);
  assert.equal(hash(bytes), reference.sha256); assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const data = JSON.parse(bytes), originals = data.sources.filter(x => x.repository === 'effacermonexistence/orthogonal-projection-term-benchmarks');
  const supplements = data.sources.filter(x => x.repository === 'private-r2/qmgr-objective-v1');
  assert.equal(data.verificationMode, 'live-r2-opt-research-map+separate-qmgr-v1');
  assert.equal(data.sourceCount, 16); assert.equal(data.sources.length, 16); assert.equal(hash(data.modelPayload), data.evidenceSHA256);
  assert.deepEqual(new Set(originals.map(x => x.source_path)), new Set(originalPaths));
  assert.deepEqual(new Set(supplements.map(x => x.source_path)), new Set(supplementPaths));
  const hex = (value, length = 64) => new RegExp(`^[a-f0-9]{${length}}$`).test(value ?? '');
  assert(originals.every(x => hex(x.repository_sha, 40) && hex(x.bundle_sha256) && hex(x.source_content_sha256) &&
    Number(x.object_size) > 0 && Number(x.source_size) > 0 && x.object_key.includes(x.repository_sha)));
  assert(supplements.every(x => x.base_repository === 'effacermonexistence/orthogonal-projection-term-benchmarks' &&
    hex(x.base_repository_sha, 40) && hex(x.base_bundle_sha256) && hex(x.retrieved_content_sha256) && hex(x.transport_sha256) &&
    Number(x.object_size) > 0 && x.object_key.endsWith('/' + x.source_path) && x.transport_object_key.includes('/qmgr-objective/v1/')));
  assert(wrongPaths.every(wrong => !data.sources.some(x => x.source_path.includes(wrong))));
  return { data, bytes: bytes.length, payloadBytes: Buffer.byteLength(data.modelPayload), outputBytes: Buffer.byteLength(data.userOutput) };
}

function native(step) {
  const bytes = fs.readFileSync(step.native_record.record_path), records = bytes.toString().split('\n').filter(Boolean).map(JSON.parse);
  let identical = false, usage = null, nativeTurns = 0;
  if (step.provider === 'claude') {
    identical = records.some(r => r.message?.role === 'assistant' && r.message.content?.some(c => c.type === 'text' && c.text === step.output));
    const seen = new Map(); for (const r of records) if (r.message?.id && r.message?.usage) seen.set(r.message.id, r.message.usage);
    nativeTurns = new Set(records.filter(r => r.message?.role === 'assistant' && r.message.id).map(r => r.message.id)).size;
    if (seen.size) usage = [...seen.values()].reduce((n, u) => ({ inputTokens: n.inputTokens + (u.input_tokens || 0),
      outputTokens: n.outputTokens + (u.output_tokens || 0), cacheCreationInputTokens: n.cacheCreationInputTokens + (u.cache_creation_input_tokens || 0),
      cacheReadInputTokens: n.cacheReadInputTokens + (u.cache_read_input_tokens || 0) }),
    { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
  } else {
    identical = records.some(r => r.type === 'response_item' && r.payload?.role === 'assistant' &&
      r.payload.content?.some(c => c.type === 'output_text' && c.text === step.output));
    nativeTurns = records.filter(r => r.type === 'turn_context').length;
    const event = records.filter(r => r.type === 'event_msg' && r.payload?.type === 'token_count').at(-1);
    usage = event?.payload?.info?.total_token_usage ?? null;
  }
  assert(identical, 'native answer differs from OS-1 output');
  assert(nativeTurns > 0); return { path: step.native_record.record_path, bytes: bytes.length, sha256: hash(bytes),
    identical, nativeTurns, nativeUsage: usage };
}

function progress(text) {
  assert(/[가-힣]/.test(text)); assert(/Orthogonal Projection|직교.{0,10}투영|\bOPT\b/i.test(text));
  assert(/재분배|redistribut/i.test(text)); assert(/벤치마크|benchmark|SPARC|X-COP|specificity/i.test(text));
  assert(/CPTP|양자.{0,8}채널|quantum.{0,8}channel/i.test(text)); assert(/뉴턴|Newtonian|Poisson|약장|weak[- ]field/i.test(text));
  assert(/미해결|아직|unresolved|남아|검증되지|한계|제한/i.test(text));
  assert(/전체|완전|full/i.test(text) && /통합|QM.?GR|theory|이론/i.test(text) && /아니|않|못|false|not|미해결|제한/i.test(text));
  for (const line of text.split('\n')) {
    const bad = /(R2|아카이브|버킷).{0,80}(QoM|QM.?GR|자료).{0,50}(없|존재하지)|진행된 것이 없습니다|진행된 게 없습니다/i.test(line);
    assert(!bad || correctsPriorFailure(line), 'uncorrected archive-absence/no-progress claim');
  }
}

function correctsPriorFailure(text) {
  const correctionSignal = [
    /(?:이전|앞(?:선)?|직전|기존|방금|아까).{0,80}(?:답변|설명|판단|결론|주장).{0,80}(?:오류|잘못|틀렸|부정확|정정|아니었)/is,
    /(?:먼저|우선)?.{0,20}(?:잘못된|틀린|부정확한).{0,30}(?:답변|설명|판단|부분|주장).{0,40}(?:정정|바로잡)/is,
    /(?:정정|바로잡)[^\n.]{0,80}(?:R2|자료|진행|답변|설명)/is,
    /(?:previous|prior|earlier).{0,80}(?:answer|response|claim|statement).{0,80}(?:wrong|incorrect|error|mistaken|correct)/is,
  ].some(pattern => pattern.test(text));
  const factualReversal = [
    /(?:R2|자료).{0,100}(?:없|존재하지).{0,100}(?:말|주장|답변).{0,100}(?:어긋|잘못|오류|틀렸|사실이 아니|부정확)/is,
    /(?:자료가?\s*(?:없|존재하지)|진행된 것이\s*없).{0,120}(?:어긋|잘못|오류|틀렸|사실이 아니|부정확)/is,
    /(?:이전|앞(?:선)?|직전|기존).{0,80}(?:답변|설명|판단|주장).{0,80}(?:어긋|잘못|오류|틀렸|부정확).{0,160}(?:R2|자료).{0,80}(?:있|존재|회수|확인|진행)/is,
    /(?:no|without).{0,50}(?:R2\s*)?(?:material|source|progress).{0,100}(?:was|is).{0,20}(?:wrong|incorrect|false|mistaken)/is,
  ].some(pattern => pattern.test(text));
  return correctionSignal && factualReversal;
}

// Claude Desktop may append a UI mode record after a completed turn. Bind the
// entire original byte prefix, not a newly accepted hash; reject any additional
// message, tool event, different session, or modification of original evidence.
function verifyNativeEvidenceBytes(bytes, original, sessionID) {
  assert(Number.isSafeInteger(original.bytes) && original.bytes > 0 && bytes.length >= original.bytes);
  assert.equal(hash(bytes.subarray(0, original.bytes)), original.sha256);
  assert.equal(bytes[original.bytes - 1], 10, 'original record must end at a JSONL boundary');
  const appended = bytes.subarray(original.bytes).toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  for (const row of appended) {
    assert.deepEqual(Object.keys(row).sort(), ['mode', 'sessionId', 'type']);
    assert.equal(row.type, 'mode'); assert.equal(row.sessionId, sessionID);
    assert(typeof row.mode === 'string' && /^[A-Za-z][A-Za-z_-]{0,63}$/.test(row.mode));
  }
  return { originalSHA256: original.sha256, originalBytes: original.bytes,
    currentSHA256: hash(bytes), currentBytes: bytes.length, appendedUIModeRecords: appended.length };
}

function verifyNativeEvidencePrefix(record, original, sessionID) {
  return verifyNativeEvidenceBytes(fs.readFileSync(record.path), original, sessionID);
}

function modelResult(name, result, expectedSource, contextFile) {
  const step = result.summary.steps[0]; assert.equal(result.summary.steps.length, 1); assert.deepEqual(result.summary.sourceContext, expectedSource);
  assert(['claude', 'codex'].includes(step.provider)); assert.equal(step.permission_profile, 'read_only');
  assert.equal(step.revas_disposition, 'adopted'); assert.equal(step.exit_code, 0); assert.equal(step.native_record.persistence, 'verified');
  assert(step.sequence <= 2); assert.equal(step.native_record.desktop_visibility, 'native_record_only');
  const nativeRecord = native(step), attempts = new Set(result.diagnostics.failedAttempts.map(x => `${x.executionID}:${x.sequence}`)).size + nativeRecord.nativeTurns;
  assert(attempts <= 2);
  assert(result.diagnostics.routingBytes.length && result.diagnostics.routingBytes.every(x => x.inputUTF8Bytes >= x.sourceUTF8Bytes + x.historyUTF8Bytes));
  const context = fs.readFileSync(contextFile), metrics = { name, provider: step.provider, model: step.model, effort: step.effort,
    sequence: step.sequence, attempts, durationMS: step.duration_ms, wallMS: result.process.wallMS, sessionID: step.session_id,
    desktopVisibility: step.native_record.desktop_visibility, inputBytes: result.diagnostics.routingBytes,
    contextBytes: context.length, contextSHA256: hash(context), outputBytes: Buffer.byteLength(step.output), outputSHA256: hash(step.output), native: nativeRecord };
  audit.runs.push(metrics); audit.modelCalls += attempts; progress(step.output); return metrics;
}

async function contract(name, reference, output) {
  const contextFile = save(`${name}-contract-context.json`, { format: 'os1-session-handoff-v2', transcript: '', source: reference });
  const outputFile = save(`${name}-contract-output.txt`, output);
  const checked = await command(`${name}-contract`, runtime, ['check-source-output', contextFile, outputFile, followup],
    { ...processEnv, OS1_CONFIG: config });
  const value = JSON.parse(checked.output); assert.equal(value.source_contract, true); assert.equal(value.capability_failure, false);
  assert.equal(value.control_chatter, false); return value;
}

let failure;
try {
  check('baseline frozen before replay', () => { assert(beforeBaseline.includes(Buffer.from(exact)));
    assert(beforeBaseline.includes(Buffer.from('"frozen_before_new_product_replay": true'))); });
  if (mode === '--recheck-existing') {
    const artifact = path.resolve(artifactArg), names = ['audit.json', 'fresh-followup-summary.json',
      'legacy-followup-summary.json', 'fresh-context.json', 'legacy-context.json'];
    assert(fs.statSync(artifact).isDirectory());
    const files = Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(artifact, name))]));
    const immutableHashes = Object.fromEntries(names.map(name => [name, hash(files[name])]));
    const liveAudit = JSON.parse(files['audit.json']);
    const fresh = JSON.parse(files['fresh-followup-summary.json']), legacy = JSON.parse(files['legacy-followup-summary.json']);
    const freshContext = JSON.parse(files['fresh-context.json']), legacyContext = JSON.parse(files['legacy-context.json']);
    check('immutable final live replay is exactly bound', () => {
      assert.equal(immutableHashes['audit.json'], existingReplay.auditSHA256);
      assert.equal(immutableHashes['fresh-followup-summary.json'], existingReplay.freshSummarySHA256);
      assert.equal(immutableHashes['legacy-followup-summary.json'], existingReplay.legacySummarySHA256);
      assert.equal(immutableHashes['fresh-context.json'], existingReplay.freshContextSHA256);
      assert.equal(immutableHashes['legacy-context.json'], existingReplay.legacyContextSHA256);
      assert.equal(liveAudit.mode, '--live'); assert.equal(liveAudit.modelCalls, 2);
      assert.equal(hash(beforeBaseline), '456b31e79f1c10062bd0d4f7da5e581eed304d1e495306ab2010bdd19ffbf6b8');
    });
    check('incident NFD wire receipt remains exact', () => {
      assert.equal(hash(incidentReceiptBytes), '582b49233636fd17463157cb40719ac27e2b8485c6986a3b719cba97c3a1b668');
      assert.equal(incidentReceipt.operation, 'r2_retrieval'); assert.equal(incidentReceipt.request_sha256, hash(wireExact));
    });
    const freshStep = fresh.steps[0], legacyStep = legacy.steps[0];
    const receiptManifest = directoryManifest(receiptsDir), snapshotManifest = directoryManifest(snapshotsDir);
    const nativeDirectory = path.dirname(freshStep.native_record.record_path), nativeManifest = directoryManifest(nativeDirectory);
    const nativeBefore = [freshStep, legacyStep].map(step => hash(fs.readFileSync(step.native_record.record_path)));
    const freshSource = source(fresh.sourceContext), legacySource = source(legacy.sourceContext);
    check('fresh and repaired legacy source identities are the exact verified 16', () => {
      assert.equal(fresh.status, 'complete'); assert.equal(legacy.status, 'complete');
      assert.equal(fresh.steps.length, 1); assert.equal(legacy.steps.length, 1);
      assert.deepEqual(fresh.sourceContext, freshContext.source);
      assert.equal(legacyContext.source.id.toUpperCase(), incident.source); assert.equal(legacyContext.source.sha256, incident.sourceSHA);
      assert.notDeepEqual(legacy.sourceContext, legacyContext.source); assert.notDeepEqual(legacy.sourceContext, fresh.sourceContext);
      const identities = snapshot => snapshot.data.sources.map(item => ({ repository: item.repository, path: item.source_path,
        content: item.source_content_sha256 ?? item.retrieved_content_sha256,
        repositorySHA: item.repository_sha ?? item.base_repository_sha,
        bundleSHA256: item.bundle_sha256 ?? item.base_bundle_sha256, transportSHA256: item.transport_sha256 ?? null,
      })).sort((a, b) => a.repository.localeCompare(b.repository) || a.path.localeCompare(b.path));
      assert.deepEqual(identities(freshSource), identities(legacySource));
    });
    check('actual replay output hashes and session repair are exact', () => {
      assert.equal(hash(freshStep.output), existingReplay.freshOutputSHA256);
      assert.equal(hash(legacyStep.output), existingReplay.legacyOutputSHA256);
      assert.equal(freshStep.session_id, existingReplay.freshSession); assert.equal(legacyStep.session_id, existingReplay.legacySession);
      assert.notEqual(legacyStep.session_id, incident.claude); assert.notEqual(legacyStep.session_id, freshStep.session_id);
      for (const step of [freshStep, legacyStep]) { assert.equal(step.revas_disposition, 'adopted');
        assert.equal(step.permission_profile, 'read_only'); assert.equal(step.native_record.persistence, 'verified');
        assert(['native_record_only', step.provider === 'claude' ? 'claude_registered_in_background' : 'registered_in_background'].includes(step.native_record.desktop_visibility)); }
    });
    const freshNative = native(freshStep), legacyNative = native(legacyStep);
    const recordedFresh = liveAudit.runs.find(run => run.name === 'fresh-followup');
    const recordedLegacy = liveAudit.runs.find(run => run.name === 'legacy-followup');
    check('native replay permits only byte-bound UI metadata, never changed evidence', () => {
      const prefix = Buffer.from('{"type":"assistant","text":"fixture"}\n');
      const original = { bytes: prefix.length, sha256: hash(prefix) };
      const append = row => Buffer.concat([prefix, Buffer.from(JSON.stringify(row) + '\n')]);
      assert.equal(verifyNativeEvidenceBytes(append({ type: 'mode', mode: 'default', sessionId: 'fixture' }), original, 'fixture').appendedUIModeRecords, 1);
      assert.throws(() => verifyNativeEvidenceBytes(Buffer.from(prefix.toString().replace('fixture', 'changed')), original, 'fixture'));
      for (const row of [ { type: 'assistant', text: 'replacement' },
        { type: 'mode', mode: 'default', sessionId: 'different' },
        { type: 'mode', mode: 'default', sessionId: 'fixture', text: 'injected' } ]) {
        assert.throws(() => verifyNativeEvidenceBytes(append(row), original, 'fixture'));
      }
    });
    check('native records equal both actual outputs', () => {
      assert(freshNative.identical && legacyNative.identical);
      audit.nativeEvidence = [
        verifyNativeEvidencePrefix(freshNative, recordedFresh.native, freshStep.session_id),
        verifyNativeEvidencePrefix(legacyNative, recordedLegacy.native, legacyStep.session_id),
      ];
    });
    check('actual outputs satisfy full progress and correction semantics', () => {
      progress(freshStep.output); progress(legacyStep.output); assert(!correctsPriorFailure(freshStep.output));
      assert(correctsPriorFailure(legacyStep.output));
    });
    const freshContract = await contract('recheck-fresh', fresh.sourceContext, freshStep.output);
    const legacyContract = await contract('recheck-legacy', legacy.sourceContext, legacyStep.output);
    check('final installed output gates accept both actual answers', () => {
      for (const contract of [freshContract, legacyContract]) {
        assert.equal(contract.capability_failure, false);
        assert.equal(contract.control_chatter, false);
        assert.equal(contract.source_contract, true);
        assert.equal(contract.presentation_contract, true);
        assert.equal(contract.deferred_deliverable, false);
      }
    });
    check('recheck creates no model turn or R2 retrieval', () => {
      assert.equal(directoryManifest(receiptsDir), receiptManifest); assert.equal(directoryManifest(snapshotsDir), snapshotManifest);
      assert.equal(directoryManifest(nativeDirectory), nativeManifest);
      assert.deepEqual([freshStep, legacyStep].map(step => hash(fs.readFileSync(step.native_record.record_path))), nativeBefore);
      for (const name of names) assert.equal(hash(fs.readFileSync(path.join(artifact, name))), immutableHashes[name]);
    });
    audit.r2Fetches = 0;
    audit.recheck = { artifact, originalAuditSHA256: immutableHashes['audit.json'], modelCalls: 0, r2Fetches: 0,
      newModelRun: false, newR2Fetch: false, commands: ['check-source-output:fresh', 'check-source-output:legacy'],
      freshContract, legacyContract };
    audit.replayEvidence = { modelCalls: liveAudit.modelCalls, newModelCalls: false,
      originalAuditPassed: liveAudit.passed, originalFailure: liveAudit.failure,
      runs: [[freshStep, freshNative], [legacyStep, legacyNative]].map(([step, record]) => ({
        provider: step.provider, model: step.model, effort: step.effort, sequence: step.sequence,
        durationMS: step.duration_ms, sessionID: step.session_id, outputBytes: Buffer.byteLength(step.output),
        outputSHA256: hash(step.output), nativeRecord: record,
      })) };
  } else if (mode === '--check-fixture') {
    const fixture = await command('fixture', runtime, ['self-test'], { ...processEnv, OS1_CONFIG: config });
    check('installed runtime fixture', () => assert.match(fixture.output.toString(), /self-test: OK/i));
    check('prior-failure correction matcher fixtures', () => {
      const exactLegacyOpening = '먼저 앞 답변을 정정합니다. 직전에 "R2에 그 주제 자료가 없다"고 말한 건 회수 자체가 어긋난 결과였습니다.';
      const exactFinalOpening = '앞 답변에서 "R2 아카이브에 QM–GR 관련 자료가 없다"고 한 건 틀렸습니다. 그때 붙어온 문서들이 요청과 무관한 것이었을 뿐, 자료 자체는 존재합니다.';
      const freshNonCorrection = '현재 원본 OPT 재분배 벤치마크와 별도 QMGR v1 호환성까지 진행됐습니다.';
      const contradictoryAbsence = '먼저 앞 답변을 정정합니다. R2 아카이브에는 QoM과 GR 통합 자료가 실제로 없습니다.';
      assert(correctsPriorFailure(exactLegacyOpening)); assert(correctsPriorFailure(exactFinalOpening)); assert(!correctsPriorFailure(freshNonCorrection));
      assert(!correctsPriorFailure(contradictoryAbsence));
    });
  } else {
    const retrieval = await run('fresh-retrieval', wireExact), snap = source(retrieval.summary.sourceContext), step = retrieval.summary.steps[0];
    const receiptBytes = fs.readFileSync(step.native_record.record_path), receipt = JSON.parse(receiptBytes);
    check('exact QoM retrieval is the 16-source local control', () => { assert.equal(step.provider, 'local'); assert.equal(step.action, 'r2_retrieval');
      assert.equal(step.model, 'os1-evidence-resolver'); assert.equal(step.effort, 'none'); assert.equal(step.permission_profile, 'local_control');
      assert.equal(step.revas_disposition, 'control_verified'); assert.equal(step.native_record.persistence, 'verified');
      assert.equal(step.native_record.desktop_visibility, 'control_only'); assert.equal(step.output, snap.data.userOutput);
      assert.equal(receipt.operation, 'r2_retrieval'); assert.equal(receipt.source_count, 16);
      assert.equal(receipt.verification_mode, snap.data.verificationMode); assert.equal(receipt.r2_verified, true);
      assert.equal(receipt.evidence_sha256, snap.data.evidenceSHA256); assert.equal(receipt.request_sha256, hash(wireExact));
      assert.equal(receipt.result_sha256, hash(step.output)); assert.equal(receipt.model_invoked, false); });
    const image = path.join(out, 'retrieval.png'); await command('native-presentation', app, ['--render-run-summary', path.join(out, 'fresh-retrieval-summary.json'), image]);
    const display = fs.readFileSync(image + '.txt', 'utf8'), copy = fs.readFileSync(image + '.copy.txt', 'utf8'),
      layout = JSON.parse(fs.readFileSync(image + '.layout.json')),
      renderedContext = JSON.parse(fs.readFileSync(image + '.context.json'));
    check('native human presentation accepts receipt and reference', () => { assert(/[가-힣]/.test(display)); assert(!/[a-f0-9]{64}/.test(display));
      assert(copy.includes(step.output)); assert(layout.pairs.every(pair => !pair.intersects));
      assert.deepEqual(renderedContext.source, retrieval.summary.sourceContext); });
    audit.runs.push({ name: 'fresh-retrieval', modelCalls: 0, wallMS: retrieval.process.wallMS, outputBytes: Buffer.byteLength(step.output),
      outputSHA256: hash(step.output), promptBytes: Buffer.byteLength(wireExact), promptSHA256: hash(wireExact),
      source: { ...retrieval.summary.sourceContext, snapshotBytes: snap.bytes,
        modelPayloadBytes: snap.payloadBytes, userOutputBytes: snap.outputBytes, sourceCount: 16 },
      receipt: { path: step.native_record.record_path, bytes: receiptBytes.length, sha256: hash(receiptBytes) }, image,
      presentationScope: 'App --render-run-summary fixed QMGR preview; receipt/source/copy renderer proof, not a foreground rendering of the original user session.' });
    if (mode === '--live') {
      const receiptNames = new Set(fs.readdirSync(receiptsDir));
      const fixtureBlock = `USER:\n${rendererFixture}`, exactBlock = `USER:\n${wireExact}`;
      assert.equal(renderedContext.format, 'os1-session-handoff-v2'); assert(renderedContext.transcript.startsWith(fixtureBlock));
      assert.equal(renderedContext.transcript.indexOf(fixtureBlock, fixtureBlock.length), -1);
      assert(renderedContext.transcript.includes('- 기반 저장소: `effacermonexistence/orthogonal-projection-term-benchmarks`'));
      assert(renderedContext.transcript.includes('### README.md'));
      assert(renderedContext.transcript.includes('# Orthogonal Projection Term — Cosmology Residual Benchmarks'));
      assert(renderedContext.transcript.length < step.output.length);
      const renderedTail = renderedContext.transcript.slice(fixtureBlock.length);
      const freshDocument = { ...renderedContext, transcript: renderedContext.transcript.replace(fixtureBlock, exactBlock) };
      assert.equal(freshDocument.transcript.slice(exactBlock.length), renderedTail);
      assert.deepEqual(freshDocument.source, retrieval.summary.sourceContext);
      const freshContext = save('fresh-context.json', freshDocument);
      const fresh = await run('fresh-followup', followup, freshContext); const freshAudit = modelResult('fresh-followup', fresh, retrieval.summary.sourceContext, freshContext);
      freshAudit.contextScope = 'Native renderer sessionHandoff with only its fixture USER first block replaced by the exact controlled QoM input; bounded assistant transcript and source reference preserved.';
      freshAudit.contract = await contract('fresh-followup', fresh.summary.sourceContext, fresh.summary.steps[0].output);

      const session = incidentSession;
      assert.equal(session.messages.find(x => x.id === incident.prior).text.normalize('NFC'), exact);
      assert.equal(session.messages.find(x => x.id === incident.followup).text.normalize('NFC'), followup); assert.equal(session.claudeSessionID, incident.claude);
      const badAnswer = session.messages.find(x => x.id === incident.badAnswer);
      assert.equal(badAnswer?.role, 'assistant'); assert.equal(badAnswer?.provider, 'claude');
      assert(/첨부된 R2 스냅샷에는.{0,100}자료가 실제로 없습니다|진행된 것이 없습니다/i.test(badAnswer.text));
      const exported = await command('legacy-export', app, ['--export-session-context', incident.session]);
      const oldContext = JSON.parse(exported.output); assert.equal(oldContext.source.id.toUpperCase(), incident.source); assert.equal(oldContext.source.sha256, incident.sourceSHA);
      assert(oldContext.transcript.includes(`USER:\n${followup}`)); assert(oldContext.transcript.includes(badAnswer.text));
      const oldBytes = fs.readFileSync(path.join(snapshotsDir, oldContext.source.id.toLowerCase() + '.json')),
        oldSource = JSON.parse(oldBytes); assert.equal(hash(oldBytes), incident.sourceSHA); assert.equal(oldSource.sourceCount, 6);
      assert(wrongPaths.every(wrong => oldSource.sources.some(x => x.source_path.includes(wrong))));
      const legacyContext = save('legacy-context.json', exported.output), legacy = await run('legacy-followup', followup, legacyContext,
        ['--claude-session-id', incident.claude]); const repaired = source(legacy.summary.sourceContext);
      assert.notEqual(legacy.summary.sourceContext.sha256, incident.sourceSHA); const legacyAudit = modelResult('legacy-followup', legacy, legacy.summary.sourceContext, legacyContext);
      assert(correctsPriorFailure(legacy.summary.steps[0].output), 'legacy answer did not explicitly correct the persisted false absence claim');
      assert.notEqual(legacyAudit.sessionID, incident.claude); legacyAudit.contract = await contract('legacy-followup', legacy.summary.sourceContext, legacy.summary.steps[0].output);
      legacyAudit.contextScope = 'Full current failed session, including the persisted native bad-absence answer, exported read-only; the same follow-up is repeated without appending to history.';
      legacyAudit.repairedSource = { ...legacy.summary.sourceContext, sourceCount: repaired.data.sourceCount };
      const totalModelCalls = freshAudit.attempts + legacyAudit.attempts; assert.equal(audit.modelCalls, totalModelCalls);
      check('fresh and legacy continuations are grounded and bounded', () => { assert(freshAudit.native.identical && legacyAudit.native.identical);
        assert(totalModelCalls <= 2); });
      const newRetrievalReceipts = fs.readdirSync(receiptsDir).filter(x => !receiptNames.has(x)).filter(x => {
        try { return JSON.parse(fs.readFileSync(path.join(receiptsDir, x))).operation === 'r2_retrieval'; } catch { return false; } });
      check('follow-ups do not issue retrieval control receipts', () => assert.deepEqual(newRetrievalReceipts, []));
    }
  }
} catch (error) { failure = error; }
const afterSessions = fs.readFileSync(sessionsFile), afterBaseline = fs.readFileSync(baseline);
try { check('sessions unchanged byte-for-byte', () => assert(afterSessions.equals(beforeSessions)));
  check('baseline unchanged byte-for-byte', () => assert(afterBaseline.equals(beforeBaseline))); } catch (error) { failure ??= error; }
audit.endedAt = new Date().toISOString(); audit.sessionsSHA256 = hash(afterSessions); audit.passed = !failure;
if (failure) audit.failure = String(failure.message || failure).slice(0, 500);
const auditFile = save('audit.json', audit);
console.log(JSON.stringify({ passed: audit.passed, checks: checks.length, audit: auditFile }));
if (failure) process.exitCode = 1;
process.exit(failures.length === 0 ? 0 : 1);
