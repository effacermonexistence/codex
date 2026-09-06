#!/usr/bin/env node
// Opt-in native incident replay; --live performs one real governed task.
// Never changes user messages or source evidence and never deploys.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

const [app, baseline, runtime, mode] = process.argv.slice(2);
assert(app && baseline && runtime && [undefined, '--live'].includes(mode));
const provider = process.env.OS1_REPLAY_PROVIDER || 'auto';
assert(['auto', 'codex', 'claude'].includes(provider));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'os1-clodex-polish-'));
const sessionID = '52BA8205-7ECA-401A-9B1D-D5595BCB450A';
const messageID = '6870F878-9309-45B9-AE60-E38D7E2F9C6D';
const root = path.join(os.homedir(), 'Library/Application Support/OS-1');
const sessionsFile = path.join(root, 'sessions.json');
const original = JSON.parse(fs.readFileSync(sessionsFile)).sessions.find(s => s.id === sessionID);
assert(original);
const hash = b => createHash('sha256').update(b).digest('hex');
const save = (name, value) => {
  const file = path.join(out, name);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2), {mode:0o600});
  return file;
};
const run = (exe, args, options = {}) => execFileSync(exe, args, {
  encoding:'utf8', timeout:45000, maxBuffer:8_000_000, ...options
});
const checks = [];
function check(name, fn) { fn(); checks.push(name); }
const context = JSON.parse(run(baseline, ['--export-session-context', sessionID]));
for (const width of [660, 900, 1100]) {
  const image = path.join(out, `incident-${width}.png`);
  run(app, ['--render-session-transcript', sessionID, image, '--width', String(width), '--receipt-open', '--reflow-check']);
  const layout = JSON.parse(fs.readFileSync(image + '.layout.json'));
  const text = fs.readFileSync(image + '.txt', 'utf8');
  const copy = fs.readFileSync(image + '.copy.txt', 'utf8');
  check(`${width}: no overlapping messages or horizontal overflow`, () => {
    for (const p of layout.pairs) assert(!p.intersects && p.gapPoints >= 12, JSON.stringify(p));
    for (const {paint} of layout.frames) assert(paint.x >= 0 && paint.x + paint.width <= width + 1);
  });
  check(`${width}: dense schema preserved as readable records`, () => {
    for (const stage of ['V2_COVARIANT_STRESS', 'V3_CURVED_CONSERVATION', 'V4_CAUSAL_DYNAMICS',
      'V5_DIFFEOMORPHISM', 'V6_BACKREACTION', 'V7_PHYSICAL_DERIVATION']) assert(text.includes(stage), stage);
    assert(!layout.tableCells.some(c => c.column >= 3), 'four-column schema remains');
    for (const m of original.messages) assert(copy.includes(m.text));
    assert.deepEqual(JSON.parse(fs.readFileSync(image + '.context.json')), context);
  });
  check(`${width}: real resize/disclosure delegate remains separated`, () => {
    const samples = JSON.parse(fs.readFileSync(image + '.reflow.json'));
    assert(samples.length > 0);
    for (const s of samples) { assert.equal(s.intersections, 0); assert(s.minimumGap >= 12); }
  });
}
let live;
if (mode === '--live') {
  const handoff = JSON.parse(run(app, ['--export-session-context', sessionID, messageID]));
  const contextFile = save('source-context.json', handoff);
  const diagnostics = path.join(root, 'diagnostics');
  const previousAccounting = new Set(fs.readdirSync(diagnostics));
  const started = Date.now();
  const args = ['-p', `(version 1) (allow default) (deny file-read* (subpath "${os.homedir()}/Documents"))`,
    runtime, 'run', '--workspace', os.homedir(), '--prompt', original.messages.find(m => m.id === messageID).text,
    '--context-file', contextFile, '--provider', provider, '--desktop-reveal', 'background', '--output-format', 'json'];
  let raw;
  try { raw = run('/usr/bin/sandbox-exec', args, {cwd:os.homedir(), timeout:600000}); }
  catch (e) { save('live-failure.json', {stdout:String(e.stdout || ''), stderr:String(e.stderr || ''), status:e.status}); throw e; }
  const summary = JSON.parse(raw); save('live-summary.json', summary);
  const step = summary.steps.at(-1);
  check('live: real governed task completes with Documents reads denied', () => {
    assert.equal(summary.status, 'complete'); assert.equal(step.exit_code, 0);
    assert.equal(step.native_record.persistence, 'verified');
    assert.equal(summary.sourceContext.sha256, original.sourceContext.sha256);
    assert(['claude', 'codex'].includes(step.provider));
    assert(step.output.length > 200);
    if (provider !== 'auto') assert.equal(step.provider, provider, 'explicit backend pin changed');
  });
  const accountingRecords = fs.readdirSync(diagnostics)
    .filter(name => name.startsWith('routing-input-') && !previousAccounting.has(name))
    .map(name => JSON.parse(fs.readFileSync(path.join(diagnostics, name))))
    .filter(item => item.source_sha256 === summary.sourceContext.sha256);
  const accounting = accountingRecords.find(item => item.provider === step.provider);
  check('live: full source/history input was supplied for routing', () => {
    assert(accounting);
    assert(accounting.input_utf8_bytes >= accounting.source_utf8_bytes + accounting.history_utf8_bytes);
    assert(accounting.source_utf8_bytes >= 79000);
    assert(accounting.caller_visible_input_tokens_estimate > 20000);
  });
  const nativeBytes = fs.readFileSync(step.native_record.record_path, 'utf8');
  const records = nativeBytes.split('\n').filter(Boolean).map(JSON.parse);
  const usage = new Map();
  if (step.provider === 'claude') {
    check('live: isolated workspace and actual native reply, background sync', () => {
      assert.equal(step.native_record.desktop_visibility, 'native_record_only');
      assert(records.some(r => r.cwd === path.join(root, 'source-answer-workspace')));
      assert(records.some(r => r.message?.content?.some?.(c => c.type === 'text' && c.text === step.output)));
    });
    for (const r of records) if (r.message?.id && r.message?.usage) usage.set(r.message.id, r.message.usage);
  } else {
    check('live: Codex native reply, model/effort and background sync match', () => {
      assert.equal(step.native_record.desktop_visibility, 'native_record_only');
      assert(records.some(r => r.type === 'turn_context' && r.payload.model === step.model && r.payload.effort === step.effort));
      assert(records.some(r => r.type === 'response_item' && r.payload.role === 'assistant' &&
        r.payload.content?.some(c => c.type === 'output_text' && c.text === step.output)));
    });
    const tokenEvent = records.filter(r => r.type === 'event_msg' && r.payload?.type === 'token_count' && r.payload.info).at(-1);
    if (tokenEvent) usage.set('codex-session-total', tokenEvent.payload.info.total_token_usage);
  }
  live = {providerPreference:provider, provider:step.provider, model:step.model, effort:step.effort, sequence:step.sequence,
    ms:Date.now()-started, session:step.session_id, record:step.native_record,
    source:summary.sourceContext, routingInput:accounting, adoptedSessionUsage:[...usage.values()],
    scope:'One governed task. Usage above covers the adopted session; earlier retries, if any, are separate.'};
  run(app, ['--render-run-summary', path.join(out, 'live-summary.json'), path.join(out, 'live-answer.png')]);
}
check('existing incident messages/source remain byte-for-byte equivalent', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(sessionsFile)).sessions.find(s => s.id === sessionID), original);
});
const report = {timestamp:new Date().toISOString(), app, appSHA256:hash(fs.readFileSync(app)), out, checks, live,
  limitation:'Native replay and bounded source-only sandbox regression, not proof of physical mouse behavior or globally optimal routing.'};
save('report.json', report);
console.log(JSON.stringify({passed:checks.length, out, live}));
