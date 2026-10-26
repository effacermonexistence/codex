#!/usr/bin/env node
// Model-free behavioral contract. Canvas API doubles are never pixel/browser proof.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodes = new Map(), raf = [], bridge = [], checks = [], paintTrace = [], textTrace = [];
let clock = performance.now();
class Element {
  constructor(id = '') {
    Object.assign(this, { id, hidden: false, disabled: false, value: '', textContent: '', dataset: {},
      style: { setProperty() {} }, clientWidth: 1100, clientHeight: 750, width: 640, height: 480, events: {} });
    const classes = new Set();
    this.classList = { add: c => classes.add(c), remove: c => classes.delete(c),
      toggle: (c, b) => b === undefined ? classes.has(c) ? classes.delete(c) : classes.add(c) : b ? classes.add(c) : classes.delete(c) };
    const saved=[];
    const target={globalAlpha:1,getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),createPattern:()=>({}),createLinearGradient:()=>({addColorStop(){}}),save(){saved.push({globalAlpha:target.globalAlpha});},restore(){const value=saved.pop();if(value)Object.assign(target,value);},drawImage(image,...numbers){paintTrace.push({asset:image?._src||'',alpha:target.globalAlpha,numbers});},fillText(text){textTrace.push(String(text));}};
    this.ctx=new Proxy(target,{get:(t,k)=>k in t?t[k]:()=>{},set:(t,k,v)=>(t[k]=v,true)});
  }
  set innerHTML(value) {
    this.html = value;
    for (const match of value.matchAll(/<[^>]+id="([^"]+)"[^>]*>/g)) {
      const element = node(match[1]);
      element.hidden = /\shidden(?:\s|>)/.test(match[0]);
      element.disabled = /\sdisabled(?:\s|>)/.test(match[0]);
    }
  }
  get innerHTML() { return this.html || ''; }
  appendChild(e) { (this.children ??= []).push(e); }
  setAttribute(k, v) { this[k] = v; }
  addEventListener(k, fn) { this.events[k] = fn; }
  getContext() { return this.ctx; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 480 }; }
  setPointerCapture() {}
  focus() {}
  click() { if (!this.disabled) this.onclick?.({ target: this }); }
  requestSubmit() { this.onsubmit?.({ preventDefault() {} }); }
}
function node(id) { if (!nodes.has(id)) nodes.set(id, new Element(id)); return nodes.get(id); }
const document = { visibilityState: 'visible', documentElement: new Element(),
  querySelector: s => node(s.replace(/^#/, '')), createElement: () => new Element(), addEventListener() {} };
globalThis.document = document;
globalThis.Image = class { constructor() { this.width = 1224; this.height = 216; }
  set src(value) { this._src = value; const asset=fs.readFileSync(path.join(root,'SimulationGarden/public',path.basename(value))); assert.equal(asset.subarray(1,4).toString(),'PNG','fixture image must be an actual bundled PNG'); this.width=asset.readUInt32BE(16); this.height=asset.readUInt32BE(20); queueMicrotask(() => this.onload?.()); } };
globalThis.requestAnimationFrame = fn => (raf.push(fn), raf.length);
const { TerranScene } = await import(pathToFileURL(path.join(root, 'SimulationGarden/src/terran-scene.js')));
const drawTrace = [];
const originalDrawUnit = TerranScene.prototype.drawUnit;
TerranScene.prototype.drawUnit = function (canvas, worker, alpha) { drawTrace.push({mode:this.mode,id:worker.id,alpha}); return originalDrawUnit.call(this,canvas,worker,alpha); };
const fields = await import(pathToFileURL(path.join(root, 'SimulationGarden/src/field-state.js')));
const { applyAccent } = await import(pathToFileURL(path.join(root, 'SimulationGarden/src/theme.js')));
const window = { webkit: { messageHandlers: { os1Simulation: { postMessage: body => bridge.push({ ...body }) } } } };
const source = fs.readFileSync(path.join(root, 'SimulationGarden/src/main.js'), 'utf8').replace(/^import .*;$/gm, '');
const context = vm.createContext({ window, document, TerranScene, applyAccent, ...fields,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  ResizeObserver: class { constructor(fn) { this.fn = fn; } observe() { this.fn(); } },
  Map, Set, Number, String, Array, JSON, Math, setTimeout, console });
vm.runInContext(source, context, { filename: 'actual-main.js' });
await new Promise(setImmediate);
function frames(n = 1) { for (let i = 0; i < n; i++) { clock += 50; for (const fn of raf.splice(0)) fn(clock); } }
const diagnostics = () => window.os1SimulationDiagnostics();
function check(label, fn) { fn(); checks.push(label); }
const id = i => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
let snapshot = { sessions: Array.from({ length: 312 }, (_, i) => ({ id: id(i), name: `native-${i}`, engine: 'Codex',
  status: i < 12 ? 'working' : 'idle', activity: 'fixture', featured: false, hasResult: false, resultPending: false, reviewed: false })),
  selectedID: id(0), selectedOutputID: id(0), selectedResultRevision: null, selectedOutput: '', notice: '', visible: true,
  accentHex: '#EDB3CC', tokenPool: { used: null, remaining: null, capacity: null, remainingPercent: null, label: 'tokens', source: 'fixture-unknown' }, tokenPools: {} };
function publish() { window.os1SimulationUpdate(JSON.parse(JSON.stringify(snapshot))); }
publish(); frames(10);
check('12 active of 312 native fixtures admitted, not four', () => assert.equal(diagnostics().workers.length, 12));
check('unmeasured mineral banks are dim markers and explicitly labeled unknown',()=>{const banks=paintTrace.filter(d=>/mineral-[123]\.png$/.test(d.asset)&&d.numbers[6]===48&&d.numbers[7]===72).slice(-8);assert.equal(banks.length,8);assert(banks.every(d=>d.alpha===.24));assert(textTrace.some(t=>t.includes('? 미측정')));});
check('unmeasured HUD is unknown rather than a fabricated zero balance',()=>{assert(node('token-value').textContent.includes('미측정'));assert(!/^0/.test(node('token-value').textContent));});
const before = diagnostics().workers; frames(12); const after = diagnostics().workers;
check('actual renderer state advances all 12 independent workers', () => assert(after.every((u, i) => u.phase > before[i].phase && Math.hypot(u.x - before[i].x, u.y - before[i].y) > 0)));
check('roster pagination never removes active battlefield workers', () => { node('next').click(); assert.equal(diagnostics().rosterPage, 1); assert.equal(diagnostics().workers.length, 12); });
check('roster search never removes active battlefield workers', () => { node('search').value = 'no-match'; node('search').oninput({ target: node('search') }); assert.equal(diagnostics().workers.length, 12); });
check('token-only snapshot survives semantic cache', () => { snapshot.tokenPool.remainingPercent = 4; snapshot.tokenPool.source = 'fixture-quota'; publish(); assert.equal(diagnostics().tokenPool.remainingPercent, 4); assert(node('token-value').textContent.includes('4%')); });
check('provider-specific bank rendering preserves known quota versus unknown other provider',()=>{snapshot.tokenPools={codex:{remainingPercent:4,label:'fixture Codex quota',source:'fixture'},claude:{remainingPercent:null,label:'fixture unknown',source:'fixture'}};paintTrace.length=0;textTrace.length=0;publish();const banks=paintTrace.filter(d=>/mineral-[123]\.png$/.test(d.asset)&&d.numbers[6]===48&&d.numbers[7]===72).slice(-8);assert.equal(banks.length,8);assert(banks.slice(0,4).every(d=>d.alpha===1));assert(banks.slice(4).every(d=>d.alpha===.24));assert(textTrace.some(t=>t.includes('CODEX')&&t.includes('4% 한도')));assert(textTrace.some(t=>t.includes('CLAUDE')&&t.includes('? 미측정')));});
check('cosmetic mining never mints token usage', () => { frames(80); assert.equal(diagnostics().tokenPool.used, null); assert.equal(diagnostics().tokenPool.remainingPercent, 4); });
const first = snapshot.sessions[0];
Object.assign(first, { status: 'completed', hasResult: true, resultPending: true, featured: true, resultRevision: 'R1' });
snapshot.selectedResultRevision = 'R1'; snapshot.selectedOutput = 'RESULT FOR NATIVE 0'; publish(); frames();
const frozen = diagnostics().workers.find(u => u.id === id(0)), other = diagnostics().workers.find(u => u.id === id(1)); frames(30);
check('terminal freezes exact position/phase/cargo; independent worker continues', () => { const end = diagnostics().workers.find(u => u.id === id(0)); for (const key of ['x', 'y', 'phase', 'cargo', 'mode', 'cycles']) assert.equal(end[key], frozen[key]); assert(diagnostics().workers.find(u => u.id === id(1)).phase > other.phase); });
check('opening matching result dispatches inspect, never automatic review', () => { const at = bridge.length; node('view-result').click(); frames(3); assert(bridge.slice(at).some(x => x.action === 'inspect' && x.id === id(0) && x.text === 'R1'), JSON.stringify({at,bridge,hidden:node('transmission').hidden,disabled:node('view-result').disabled,diagnostics:diagnostics()})); assert(!bridge.slice(at).some(x => x.action === 'review')); assert.equal(diagnostics().canAcknowledge, true); });
check('explicit review is posted but does not optimistically retire worker', () => { node('review-result').click(); assert.equal(bridge.at(-1).action, 'review'); assert.equal(bridge.at(-1).id, id(0)); assert(diagnostics().workers.some(u => u.id === id(0))); });
Object.assign(first, { reviewed: true, resultPending: false, featured: false }); publish(); frames(12);
check('only authoritative reviewed receipt retires worker; corpus retained', () => { assert.equal(diagnostics().workers.length, 11); assert.equal(diagnostics().nativeSessionCount, 312); });
check('selecting reviewed historical result does not resurrect terminal', () => { node('tab-all').click(); node('units').onclick({ target: { closest: () => ({ dataset: { id: id(0) } }) } }); assert(!diagnostics().workers.some(u => u.id === id(0))); });
Object.assign(first, { status: 'working', hasResult: false, resultPending: false }); publish(); frames();
check('same UUID resumes once without duplicate session', () => { assert.equal(diagnostics().workers.filter(u => u.id === id(0)).length, 1); assert.equal(diagnostics().nativeSessionCount, 312); assert(diagnostics().workers.find(u => u.id === id(0)).phase > frozen.phase); });
check('hidden native view pauses paints and positions', () => { snapshot.visible = false; publish(); const old = diagnostics(); frames(25); assert.equal(diagnostics().paintCount, old.paintCount); assert.deepEqual(diagnostics().workers, old.workers); });
snapshot.visible = true; publish(); frames();
check('hidden document pauses paints and positions', () => { document.visibilityState = 'hidden'; const old = diagnostics(); frames(25); assert.equal(diagnostics().paintCount, old.paintCount); assert.deepEqual(diagnostics().workers, old.workers); document.visibilityState = 'visible'; frames(); });
check('resuming after hidden time does not teleport', () => { const old = diagnostics().workers; frames(); assert(diagnostics().workers.every((u, i) => Math.hypot(u.x - old[i].x, u.y - old[i].y) < 10)); });
check('pending selection never displays another UUID result', () => { node('units').onclick({ target: { closest: () => ({ dataset: { id: id(1) } }) } }); assert.equal(diagnostics().selectedID, id(1)); assert.equal(node('result').textContent, '선택한 세션의 결과를 수신 중…'); assert.equal(node('review-result').disabled, true); });
check('preview is separate: immediate drawUnit calls contain no native departures and bridge calls blocked', () => { const at = bridge.length; drawTrace.length = 0; node('preview-enter').click(); assert(drawTrace.every(u=>u.id.startsWith('preview-')), 'preview entry rendered native departure'); frames(10); assert.equal(diagnostics().mode, 'preview'); assert.equal(diagnostics().workers.length, 12); assert(diagnostics().workers.every(u => u.id.startsWith('preview-'))); assert.equal(diagnostics().nativeSessionCount, 312); node('new').click(); node('appearance').click(); node('open-chat').click(); node('stop').click(); node('preview-finish').click(); frames(3); node('review-result').click(); assert.equal(bridge.length, at); });
check('preview exit restores native state and drawUnit never receives synthetic departures', () => { drawTrace.length = 0; node('preview-exit').click(); assert(drawTrace.every(u=>!u.id.startsWith('preview-')), 'native mode rendered synthetic departure'); frames(); assert.equal(diagnostics().mode, 'native'); assert.equal(diagnostics().nativeSessionCount, 312); assert(diagnostics().workers.every(u => !u.id.startsWith('preview-'))); });
const output = { status: 'PASS', checks: checks.length, providerCalls: 0, nativeActions: 0, timestampUTC: new Date().toISOString(), sourceSHA256: Object.fromEntries(['main.js','field-state.js','mining-state.js','terran-scene.js','theme.js'].map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,'SimulationGarden/src',file))).digest('hex')])),
  scope: 'Actual frontend main/field/mining/renderer in isolated DOM and canvas API test harness. Canvas API stubs: not pixel, browser, native provider or real-world dispatch proof.', checksPassed: checks };
const outputArg=process.argv.indexOf('--output');
if(outputArg>=0){const outputPath=path.resolve(process.argv[outputArg+1]||'');assert(process.argv[outputArg+1],'--output needs a receipt path');fs.mkdirSync(path.dirname(outputPath),{recursive:true});fs.writeFileSync(outputPath,JSON.stringify(output,null,2)+'\n');}
console.log(JSON.stringify(output, null, 2));
