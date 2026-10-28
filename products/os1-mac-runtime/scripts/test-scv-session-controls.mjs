#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { SessionControls, sessionPresentation } from '../SimulationGarden/src/control-state.js';
import * as fields from '../SimulationGarden/src/field-state.js';

const A = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const B = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';
const C = 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC';
let sequence = 0;
const nextID = () => `abcdef00-0000-4000-8abc-${String(++sequence).padStart(12, '0')}`;
let now = 0;
const ledger = () => new SessionControls({ idFactory: nextID, now: () => now });
const ack = (packet, accepted = true, extra = {}) => ({ commandID: packet.commandID, action: packet.action, sessionID: packet.id || C, accepted, message: accepted ? 'Host accepted; outcome not yet confirmed.' : 'Host rejected.', ...extra });
const results = [];
function check(name, run) { run(); results.push({ name, status: 'PASS' }); }

check('duplicate order is blocked before receipt; each independent SCV remains usable', () => {
  const c = ledger(); c.setDraft(A, 'FIRST');
  const first = c.begin('order', { sessionID: A, text: c.getDraft(A) });
  assert(first.commandID); assert.equal(c.begin('order', { sessionID: A, text: 'FIRST' }), null);
  assert(c.begin('order', { sessionID: B, text: 'OTHER' }));
});
check('instant accepted receipt clears exact draft without a working/queued phase', () => {
  const c = ledger(); c.setDraft(A, '1+1'); const p = c.begin('order', { sessionID: A, text: '1+1' });
  c.observe([{ id: A, status: 'completed', canStop: false, canResume: false }]);
  assert(c.isPending('order', A));
  const result = c.receive(ack(p)); assert(result.matched && result.clearedDraft);
  assert.equal(c.getDraft(A), ''); assert(!c.isPending('order', A));
});
check('working snapshot never substitutes for an accepted receipt', () => {
  const c = ledger(); c.setDraft(A, 'ORIGINAL'); c.begin('order', { sessionID: A, text: 'ORIGINAL' });
  c.observe([{ id: A, status: 'working' }]);
  assert(c.isPending('order', A)); assert.equal(c.getDraft(A), 'ORIGINAL');
});
check('selection switch and later receipt preserve the other SCV draft', () => {
  const c = ledger(); c.setDraft(A, 'A ORDER'); c.setDraft(B, 'B DRAFT');
  const p = c.begin('order', { sessionID: A, text: 'A ORDER' });
  assert(c.receive(ack(p)).clearedDraft); assert.equal(c.getDraft(B), 'B DRAFT');
});
check('new edits are not erased even if text eventually returns to the original', () => {
  const c = ledger(); c.setDraft(A, 'ORIGINAL'); const p = c.begin('order', { sessionID: A, text: 'ORIGINAL' });
  c.setDraft(A, 'NEW', { edited: true }); c.setDraft(A, 'ORIGINAL', { edited: true });
  assert(!c.receive(ack(p)).clearedDraft); assert.equal(c.getDraft(A), 'ORIGINAL');
});
check('rejected receipt preserves raw whitespace and draft while releasing retry control', () => {
  const c = ledger(), text = '  preserve\nme  '; c.setDraft(A, text);
  const p = c.begin('order', { sessionID: A, text }); assert.equal(p.text, text);
  const r = c.receive(ack(p, false)); assert(r.matched && !r.accepted && !r.clearedDraft);
  assert.equal(c.getDraft(A), text); assert(!c.isPending('order', A));
});
check('foreign, mismatched, malformed and duplicate receipts cannot settle pending work', () => {
  const c = ledger(); c.setDraft(A, 'A'); const p = c.begin('order', { sessionID: A, text: 'A' });
  for (const r of [null, {}, ack(p, true, { commandID: nextID() }), ack(p, true, { action: 'stop' }), ack(p, true, { sessionID: B }), ack(p, true, { accepted: 'true' }), ack(p, true, { submissionID: 'not-a-uuid' })]) assert.equal(c.receive(r).matched, false);
  assert(c.isPending('order', A)); assert(c.receive(ack(p)).matched); assert(!c.receive(ack(p)).matched);
});
check('Foundation uppercase command UUID and case-variant session UUID settle the same command', () => {
  const c = ledger(); c.setDraft(A, 'EXACT');
  const p = c.begin('order', { sessionID: A, text: 'EXACT' });
  assert.notEqual(p.commandID, p.commandID.toUpperCase());
  assert(c.isPending('order', A.toLowerCase()));
  const result = c.receive(ack(p, true, { commandID: p.commandID.toUpperCase(), sessionID: A.toLowerCase() }));
  assert(result.matched && result.clearedDraft);
  assert.equal(result.sessionID, A, 'retain original native snapshot spelling for the UI referent');
  assert.equal(c.getDraft(A.toLowerCase()), ''); assert(!c.isPending('order', A));
});
check('session UUID casing cannot fork drafts, revisions or accepted control latches', () => {
  const c = ledger(); c.setDraft(A, 'BEFORE');
  const p = c.begin('order', { sessionID: A, text: 'BEFORE' });
  c.setDraft(A.toLowerCase(), 'AFTER', { edited: true });
  assert(!c.receive(ack(p, true, { sessionID: A.toLowerCase() })).clearedDraft);
  assert.equal(c.getDraft(A), 'AFTER');
  const stop = c.begin('stop', { sessionID: A }); c.receive(ack(stop, true, { sessionID: A.toLowerCase() }));
  assert(c.isBlocked('stop', A.toLowerCase()));
  c.observe([{ id: A.toLowerCase(), status: 'stopping', canStop: false }]);
  assert(!c.isBlocked('stop', A));
});
check('timeout retains unknown command custody and never permits automatic retry', () => {
  now = 0; const c = ledger(); c.setDraft(A, 'KEEP'); c.begin('order', { sessionID: A, text: 'KEEP' });
  now = 10001; c.markOverdue(); assert(c.messageFor(A).includes('자동 재전송 없음'));
  assert(c.isPending('order', A)); assert.equal(c.begin('order', { sessionID: A, text: 'KEEP' }), null);
  assert.equal(c.getDraft(A), 'KEEP');
});
check('queued Stop and paused Resume follow native capabilities, not animation state', () => {
  const c = ledger();
  assert.equal(sessionPresentation({ id: A, status: 'queued', queueCount: 2, canStop: true }, c).stopDisabled, false);
  const paused = sessionPresentation({ id: A, status: 'paused', canResume: true }, c);
  assert(paused.resumeVisible && !paused.resumeDisabled); assert(paused.label.startsWith('Paused'));
});
check('Stop receipt is not stopping completion; duplicate blocked until native reflection', () => {
  const c = ledger(), p = c.begin('stop', { sessionID: A }); c.receive(ack(p));
  assert.equal(c.begin('stop', { sessionID: A }), null);
  assert(sessionPresentation({ id: A, status: 'stopping', canStop: false }, c).label.includes('실제 종료 확인 중'));
  c.observe([{ id: A, status: 'stopping', canStop: false }]);
  assert(sessionPresentation({ id: A, status: 'stopping', canStop: false }, c).stopDisabled);
  assert.equal(sessionPresentation({ id: A, status: 'working', canStop: true }, c).stopDisabled, false);
});
check('resume and order share admission lock; Stop is available for a genuinely running target', () => {
  const c = ledger(), p = c.begin('resume', { sessionID: A });
  assert.equal(c.begin('order', { sessionID: A, text: 'new' }), null);
  assert(c.begin('stop', { sessionID: A })); c.receive(ack(p));
  assert.equal(c.begin('resume', { sessionID: A }), null);
  c.observe([{ id: A, canResume: false, canStop: true }]);
  assert(!c.isBlocked('resume', A));
});
check('new session is single flight and requires a valid resulting UUID', () => {
  const c = ledger(), p = c.begin('new'); assert.equal(c.begin('new'), null);
  assert(!c.receive(ack(p, true, { sessionID: null })).matched); assert(c.isPending('new'));
  assert(c.receive(ack(p)).matched); assert(!c.isPending('new'));
});

check('unconfirmed stopping and paused queues remain on field without local deployment or old featured flags', () => {
  const sessions = [{ id:A, status:'stopping', featured:false, reviewed:true }, { id:B, status:'paused', queueCount:2, featured:false, reviewed:true }];
  assert.deepEqual(fields.battlefieldSessions(sessions).map(s=>s.id), [A,B]);
  for (const row of [{ id:A, status:'stopping', hasResult:true, resultPending:true }, { id:B, status:'paused', queueCount:2, hasResult:true, resultPending:true }]) assert(!fields.isAwaitingReview(row));
});

// Execute the actual entry module with an inert DOM/scene/host. These fixtures
// cannot invoke providers, native sessions, file writes, animation or networks.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'SimulationGarden/src/main.js'), 'utf8');
function surface() {
  const elements = new Map(), sent = [], timers = [], listeners = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { id, value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, style: {}, clientWidth: 640, clientHeight: 480,
      focus() {}, setAttribute() {}, classList: { toggle() {}, add() {}, remove() {} }, click() { if (!this.disabled) this.onclick?.(); }, requestSubmit() { this.onsubmit?.({ preventDefault() {} }); } });
    return elements.get(id);
  };
  class QuietScene { constructor() { this.ready = { then: () => ({ catch() {} }) }; } setAccent() {} sync() {} setMode() {} focus() {} fit() {} states() { return []; } diagnostics() { return { workers: [], moving: 0, mining: 0 }; } }
  const window = { webkit: { messageHandlers: { os1Simulation: { postMessage(packet) { sent.push(packet); surfaceState.onPost?.(packet); } } } } };
  const context = vm.createContext({ window, document: { querySelector: s => element(s.slice(1)), addEventListener: (type, fn) => listeners.set(type, fn) },
    VoxelScene: QuietScene, ...fields, requestAnimationFrame() {}, SessionControls: class extends SessionControls { constructor() { super({ idFactory: nextID, now: () => now }); } }, sessionPresentation,
    applyAccent: () => '#EDB3CC', ResizeObserver: class { observe() {} }, setTimeout: fn => timers.push(fn), console });
  const surfaceState = { element, sent, timers, listeners, window, onPost: null };
  new vm.Script(source.replace(/^import .*;\s*$/gm, ''), { filename: 'SimulationGarden/src/main.js' }).runInContext(context);
  return surfaceState;
}
function row(id, status = 'idle', overrides = {}) { return { id, name: id === A ? 'SCV A' : 'SCV B', engine: 'Auto', status, activity: '', queueCount: 0, queuePaused: false, canStop: false, canResume: false, ...overrides }; }
const snap = (sessions, selectedID = A) => ({ sessions, selectedID, selectedOutput: '', notice: '', visible: true, accentHex: '#EDB3CC' });
function input(s, text) { s.element('prompt').value = text; s.element('prompt').oninput(); }
const commands = s => s.sent.filter(p => ['order','stop','resume','new'].includes(p.action));

check('actual UI duplicate submit, instant host ACK, and unchanged snapshot never replay', () => {
  const s = surface(); s.window.os1SimulationUpdate(snap([row(A)])); input(s, '1+1');
  s.element('order-form').requestSubmit(); s.element('order-form').requestSubmit();
  assert.equal(commands(s).length, 1); assert(s.element('dispatch').disabled);
  s.window.os1SimulationUpdate(snap([row(A, 'completed')])); assert.equal(s.element('prompt').value, '1+1');
  s.window.os1SimulationReceipt(ack(commands(s)[0])); assert.equal(s.element('prompt').value, '');
  for (let i = 0; i < 3; i++) s.window.os1SimulationUpdate(snap([row(A, 'completed')]));
  assert.equal(commands(s).length, 1);
});
check('actual UI handles synchronous ACK while host receives order', () => {
  const s = surface(); s.window.os1SimulationUpdate(snap([row(A)])); input(s, 'instant');
  s.onPost = p => { if (p.action === 'order') s.window.os1SimulationReceipt(ack(p)); };
  s.element('order-form').requestSubmit(); assert.equal(s.element('prompt').value, '');
  assert.equal(commands(s).length, 1); assert(!s.element('dispatch').disabled);
});
check('actual UI accepts native uppercase command UUID and lower-case session UUID', () => {
  const s = surface(); s.window.os1SimulationUpdate(snap([row(A)])); input(s, 'native ACK');
  s.element('order-form').requestSubmit(); const p = commands(s)[0];
  assert.notEqual(p.commandID, p.commandID.toUpperCase());
  s.window.os1SimulationReceipt(ack(p, true, { commandID: p.commandID.toUpperCase(), sessionID: A.toLowerCase() }));
  assert.equal(s.element('prompt').value, ''); assert(!s.element('dispatch').disabled);
  assert.equal(commands(s).length, 1);
});
check('actual UI late ACK for A cannot clear selected B draft or newer A edits', () => {
  const s = surface(); s.window.os1SimulationUpdate(snap([row(A),row(B)])); input(s, 'A sent'); s.element('order-form').requestSubmit();
  input(s, 'A newer'); s.window.os1SimulationUpdate(snap([row(A),row(B)], B)); input(s, 'B draft');
  s.window.os1SimulationReceipt(ack(commands(s)[0])); assert.equal(s.element('prompt').value, 'B draft');
  s.window.os1SimulationUpdate(snap([row(A),row(B)], A)); assert.equal(s.element('prompt').value, 'A newer');
});
check('actual UI rejected/foreign ACK preserves draft; timeout does not retransmit', () => {
  now = 0; const s = surface(); s.window.os1SimulationUpdate(snap([row(A)])); input(s, 'original'); s.element('order-form').requestSubmit();
  const p = commands(s)[0]; s.window.os1SimulationReceipt(ack(p, true, { sessionID: B }));
  assert.equal(s.element('prompt').value, 'original'); assert(s.element('dispatch').disabled);
  now = 10001; s.timers.forEach(fn => fn()); assert(s.element('notice').textContent.includes('자동 재전송 없음'));
  assert.equal(commands(s).length, 1); s.window.os1SimulationReceipt(ack(p, false));
  assert.equal(s.element('prompt').value, 'original'); assert(!s.element('dispatch').disabled);
});
check('actual UI queued Stop and explicit Resume target only selected native UUID', () => {
  const s = surface(); s.window.os1SimulationUpdate(snap([row(A,'queued',{ canStop: true, queueCount: 2 }),row(B,'working',{canStop:true})]));
  s.element('stop').click(); s.element('stop').click(); assert.equal(commands(s).length, 1); assert.equal(commands(s)[0].id, A);
  s.window.os1SimulationReceipt(ack(commands(s)[0])); s.window.os1SimulationUpdate(snap([row(A,'stopping'),row(B,'working',{canStop:true})]));
  assert(s.element('status').textContent.includes('실제 종료 확인 중')); assert(s.element('resume-session').hidden);
  s.window.os1SimulationUpdate(snap([row(A,'paused',{canResume:true,queuePaused:true,queueCount:2}),row(B,'working',{canStop:true})]));
  assert(!s.element('resume-session').hidden); s.element('resume-session').click(); s.element('resume-session').click();
  assert.equal(commands(s).length, 2); assert.equal(commands(s)[1].action, 'resume'); assert.equal(commands(s)[1].id, A);
});
check('actual UI new button and N share single flight, repeat hotkeys do not dispatch', () => {
  const s = surface(); s.window.os1SimulationUpdate(snap([row(A)])); s.element('build').click(); s.element('new').click();
  const keydown = s.listeners.get('keydown');
  keydown({ key:'n', target:{tagName:'MAIN'}, repeat:false, preventDefault(){} });
  keydown({ key:'n', target:{tagName:'MAIN'}, repeat:true, preventDefault(){} });
  assert.equal(commands(s).length,1); assert.equal(commands(s)[0].action,'new');
});
check('actual UI preview cannot dispatch native commands or erase a pending native order draft', () => {
  const s = surface(); s.window.os1SimulationUpdate(snap([row(A),row(B)])); input(s, 'native pending');
  s.element('order-form').requestSubmit(); const p=commands(s)[0];
  s.element('preview-enter').click();
  for (const name of ['new','build','stop','resume-session']) s.element(name).click();
  assert.equal(commands(s).length,1);
  s.window.os1SimulationReceipt(ack(p,false)); s.element('preview-exit').click();
  assert.equal(s.element('prompt').value,'native pending');
  assert.equal(commands(s).length,1);
});
check('reloaded UI publishes ready only, no hidden replay/auto-run', () => {
  const s = surface(); assert.equal(commands(s).length,0); assert.equal(s.sent.length,1); assert.equal(s.sent[0].action,'ready');
  s.window.os1SimulationUpdate(snap([row(A,'working',{canStop:true})])); assert.equal(commands(s).length,0);
});

console.log(JSON.stringify({ status: 'PASS', scope: 'model-free command ledger and actual frontend module with inert DOM/native bridge', checks: results.length, results }, null, 2));
