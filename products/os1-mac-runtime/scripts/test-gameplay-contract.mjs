#!/usr/bin/env node
// DOM/bridge contract only. VoxelScene is an explicit renderer test double;
// actual shared field/motion modules are used, but no WebGL rendering is claimed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,webcrypto} from 'node:crypto';
import {SessionControls,sessionPresentation} from '../SimulationGarden/src/control-state.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const nodes=new Map(),raf=[],bridge=[],checks=[],cohortTrace=[];let clock=performance.now();
class Element{
 constructor(id=''){Object.assign(this,{id,hidden:false,disabled:false,value:'',textContent:'',dataset:{},style:{setProperty(){}},clientWidth:1100,clientHeight:750,width:640,height:480,events:{}});const classes=new Set();this.classList={add:c=>classes.add(c),remove:c=>classes.delete(c),toggle:(c,b)=>b===undefined?classes.has(c)?classes.delete(c):classes.add(c):b?classes.add(c):classes.delete(c)};}
 set innerHTML(value){this.html=value;for(const match of value.matchAll(/<[^>]+id="([^"]+)"[^>]*>/g)){const element=node(match[1]);element.hidden=/\shidden(?:\s|>)/.test(match[0]);element.disabled=/\sdisabled(?:\s|>)/.test(match[0]);}}
 get innerHTML(){return this.html||'';}appendChild(e){(this.children??=[]).push(e);}setAttribute(k,v){this[k]=v;}addEventListener(k,fn){this.events[k]=fn;}getBoundingClientRect(){return{left:0,top:0,width:1100,height:750};}setPointerCapture(){}focus(){}click(){if(!this.disabled)this.onclick?.({target:this});}requestSubmit(){this.onsubmit?.({preventDefault(){}});}
}
function node(id){if(!nodes.has(id))nodes.set(id,new Element(id));return nodes.get(id);}
const document={visibilityState:'visible',documentElement:new Element(),querySelector:s=>node(s.replace(/^#/,'')),createElement:()=>new Element(),addEventListener(){}};
globalThis.document=document;globalThis.requestAnimationFrame=fn=>(raf.push(fn),raf.length);
const fields=await import(pathToFileURL(path.join(root,'SimulationGarden/src/field-state.js')));
const motion=await import(pathToFileURL(path.join(root,'SimulationGarden/src/mining-state.js')));
const {applyAccent,normalizeAccent}=await import(pathToFileURL(path.join(root,'SimulationGarden/src/theme.js')));
// The facade is deliberately not imported from voxel-scene.js. This keeps
// DOM/bridge assertions executable without pretending a mock tests GPU pixels.
class RendererContractDouble{
 constructor(container,onSelect){Object.assign(this,{container,onSelect,units:new Map(),sessions:[],selected:null,enabled:false,mode:'native',paintCount:0,accent:'#EDB3CC',pool:fields.tokenState(null),pools:null,last:performance.now()});this.ready=Promise.resolve();requestAnimationFrame(this.animate.bind(this));}
 setAccent(value){this.accent=normalizeAccent(value);}setMode(mode){if(mode!==this.mode)this.sessions=[];this.mode=mode;}focus(){}fit(){}resize(){}
 sync(sessions,selected,visible,pool,pools){Object.assign(this,{sessions,selected,enabled:visible,pool:fields.tokenState(pool),pools:pools??null});for(const s of sessions){if(!this.units.has(s.id))this.units.set(s.id,motion.createWorker(s.id,this.units.size));this.units.get(s.id).session=s;}if(!visible)for(const u of this.units.values()){u.moving=false;u.mining=false;}this.paint();}
 animate(now){requestAnimationFrame(this.animate.bind(this));const dt=Math.min(Math.max((now-this.last)/1000,0),.05);this.last=now;if(!this.enabled||document.visibilityState==='hidden')return;motion.advanceColony(this.sessions.map(s=>this.units.get(s.id)),dt,new Set(this.sessions.filter(s=>s.status==='working').map(s=>s.id)));this.paint();}
 paint(){if(!this.enabled||document.visibilityState==='hidden')return;this.paintCount++;for(const s of this.sessions)cohortTrace.push({mode:this.mode,id:s.id});}
 states(){return this.sessions.map(s=>{const u=this.units.get(s.id);return{id:s.id,name:s.name,status:s.status,x:+u.x.toFixed(3),y:+u.y.toFixed(3),phase:+u.phase.toFixed(3),moving:u.moving,mining:u.mining,cargo:u.cargo,mode:u.mode,cycles:u.cycles,race:fields.workerRace(s),awaitingReview:fields.isAwaitingReview(s)};});}
 diagnostics(){return{mode:this.mode,visible:this.enabled,workers:this.states(),moving:this.states().filter(s=>s.moving).length,mining:this.states().filter(s=>s.mining).length,paintCount:this.paintCount,tokenPool:this.pool,tokenPools:this.pools,renderer:'EXPLICIT_TEST_DOUBLE',fps:0,drawCalls:0,pixelRatio:1,quality:'test-double-no-gpu',sourceSprites:'not used; procedural voxel facade',camera:{x:0,y:0,zoom:1}};}
}
const window={webkit:{messageHandlers:{os1Simulation:{postMessage:body=>bridge.push({...body})}}}};
const sourcePath=path.join(root,'SimulationGarden/src/main.js'),raw=fs.readFileSync(sourcePath,'utf8');
assert(/import\s*\{\s*VoxelScene\s*\}\s*from\s*['"]\.\/voxel-scene\.js['"]/.test(raw),'actual entry must select VoxelScene');
const source=raw.replace(/^import .*;$/gm,'');
const context=vm.createContext({window,document,VoxelScene:RendererContractDouble,applyAccent,...fields,SessionControls,sessionPresentation,crypto:webcrypto,requestAnimationFrame:globalThis.requestAnimationFrame,ResizeObserver:class{constructor(fn){this.fn=fn;}observe(){this.fn();}},Map,Set,Number,String,Array,JSON,Math,setTimeout,console});
vm.runInContext(source,context,{filename:'actual-main.js'});await new Promise(setImmediate);
function frames(n=1){for(let i=0;i<n;i++){clock+=50;for(const fn of raf.splice(0))fn(clock);}}
const diagnostics=()=>window.os1SimulationDiagnostics();function check(name,fn){fn();checks.push(name);}const id=i=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`;
let snapshot={sessions:Array.from({length:312},(_,i)=>({id:id(i),name:`native-${i}`,engine:'Codex',status:i<12?'working':'idle',activity:'fixture',featured:false,hasResult:false,resultPending:false,reviewed:false})),selectedID:id(0),selectedOutputID:id(0),selectedResultRevision:null,selectedOutput:'',notice:'',visible:true,accentHex:'#EDB3CC',tokenPool:{used:null,remaining:null,capacity:null,remainingPercent:null,label:'tokens',source:'fixture-unknown'},tokenPools:{}};
function publish(){window.os1SimulationUpdate(JSON.parse(JSON.stringify(snapshot)));}publish();frames(10);
check('12 active of312 native fixtures are forwarded without a four-worker cap',()=>assert.equal(diagnostics().workers.length,12));
check('unmeasured mineral state remains unknown at the renderer boundary',()=>{const d=diagnostics();assert.equal(d.tokenPool.used,null);assert.equal(d.tokenPool.remaining,null);assert.equal(d.tokenPool.ratio,null);assert.deepEqual(d.tokenPools,{});});
check('unmeasured HUD is unknown rather than a fabricated zero balance',()=>{assert(node('token-value').textContent.includes('미측정'));assert(!/^0/.test(node('token-value').textContent));});
const before=diagnostics().workers;frames(12);const after=diagnostics().workers;
check('actual shared motion state advances all12 independently under active snapshots',()=>assert(after.every((u,i)=>u.phase>before[i].phase&&Math.hypot(u.x-before[i].x,u.y-before[i].y)>0)));
check('roster pagination never removes active battlefield workers',()=>{node('next').click();assert.equal(diagnostics().rosterPage,1);assert.equal(diagnostics().workers.length,12);});
check('roster search never removes active battlefield workers',()=>{node('search').value='no-match';node('search').oninput({target:node('search')});assert.equal(diagnostics().workers.length,12);});
check('token-only snapshot survives semantic cache',()=>{snapshot.tokenPool.remainingPercent=4;snapshot.tokenPool.source='fixture-quota';publish();assert.equal(diagnostics().tokenPool.remainingPercent,4);assert(node('token-value').textContent.includes('4%'));});
check('main quota display preserves zero/full endpoints and raw precision at partial boundaries',()=>{
 for(const[value,label]of[[0,'0%'],[.000001,'<0.1%'],[.09,'<0.1%'],[.1,'0.1%'],[25.123456,'25.1%'],[99.9,'99.9%'],[99.95,'>99.9%'],[99.999999,'>99.9%'],[100,'100%']]){
  snapshot.tokenPool.remainingPercent=value;publish();assert.equal(diagnostics().tokenPool.remainingPercent,value);assert(node('token-value').textContent.includes(label),`${value}: ${node('token-value').textContent}`);
 }
 for(const value of[-1,101,Infinity]){snapshot.tokenPool.remainingPercent=value;publish();assert.equal(diagnostics().tokenPool.remainingPercent,null);assert(node('token-value').textContent.includes('미측정'));}
 snapshot.tokenPool.remainingPercent=4;publish();
});
check('provider-specific quota versus unknown is forwarded separately without absolute balances',()=>{snapshot.tokenPools={codex:{remainingPercent:4,label:'fixture Codex quota',source:'fixture'},claude:{remainingPercent:null,label:'fixture unknown',source:'fixture'}};publish();const p=diagnostics().tokenPools;assert.equal(p.codex.remainingPercent,4);assert.equal(p.claude.remainingPercent,null);assert.equal(p.codex.remaining,undefined);assert.equal(p.claude.remaining,undefined);});
check('cosmetic mining never mints token usage',()=>{frames(80);assert.equal(diagnostics().tokenPool.used,null);assert.equal(diagnostics().tokenPool.remainingPercent,4);});
const first=snapshot.sessions[0];Object.assign(first,{status:'completed',hasResult:true,resultPending:true,featured:true,resultRevision:'R1'});snapshot.selectedResultRevision='R1';snapshot.selectedOutput='RESULT FOR NATIVE0';publish();frames();
const frozen=diagnostics().workers.find(u=>u.id===id(0)),other=diagnostics().workers.find(u=>u.id===id(1));frames(30);
check('terminal freezes exact position/phase/cargo while another worker continues',()=>{const end=diagnostics().workers.find(u=>u.id===id(0));for(const key of['x','y','phase','cargo','mode','cycles'])assert.equal(end[key],frozen[key]);assert(diagnostics().workers.find(u=>u.id===id(1)).phase>other.phase);});
check('opening matching result dispatches inspect, never automatic review',()=>{const at=bridge.length;node('view-result').click();frames(3);assert(bridge.slice(at).some(x=>x.action==='inspect'&&x.id===id(0)&&x.text==='R1'));assert(!bridge.slice(at).some(x=>x.action==='review'));assert.equal(diagnostics().canAcknowledge,true);});
check('explicit review dispatch does not optimistically retire worker',()=>{node('review-result').click();assert.equal(bridge.at(-1).action,'review');assert.equal(bridge.at(-1).id,id(0));assert(diagnostics().workers.some(u=>u.id===id(0)));});
Object.assign(first,{reviewed:true,resultPending:false,featured:false});publish();frames(12);
check('only authoritative reviewed receipt retires the unit while corpus is retained',()=>{assert.equal(diagnostics().workers.length,11);assert.equal(diagnostics().nativeSessionCount,312);});
check('selecting reviewed history does not resurrect its terminal worker',()=>{node('tab-all').click();node('units').onclick({target:{closest:()=>({dataset:{id:id(0)}})}});assert(!diagnostics().workers.some(u=>u.id===id(0)));});
Object.assign(first,{status:'working',hasResult:false,resultPending:false});publish();frames();
check('same native UUID resumes once without creating another session',()=>{assert.equal(diagnostics().workers.filter(u=>u.id===id(0)).length,1);assert.equal(diagnostics().nativeSessionCount,312);assert(diagnostics().workers.find(u=>u.id===id(0)).phase>frozen.phase);});
check('hidden native surface suspends the renderer facade and motion',()=>{snapshot.visible=false;publish();const old=diagnostics();frames(25);assert.equal(diagnostics().paintCount,old.paintCount);assert.deepEqual(diagnostics().workers,old.workers);});
snapshot.visible=true;publish();frames();
check('hidden document suspends the renderer facade and motion',()=>{document.visibilityState='hidden';const old=diagnostics();frames(25);assert.equal(diagnostics().paintCount,old.paintCount);assert.deepEqual(diagnostics().workers,old.workers);document.visibilityState='visible';frames();});
check('resuming after hidden time cannot produce a shared-motion teleport',()=>{const old=diagnostics().workers;frames();assert(diagnostics().workers.every((u,i)=>Math.hypot(u.x-old[i].x,u.y-old[i].y)<10));});
check('pending selection never shows another UUID result or enables its acknowledgement',()=>{node('units').onclick({target:{closest:()=>({dataset:{id:id(1)}})}});assert.equal(diagnostics().selectedID,id(1));assert(!node('result').textContent.includes('RESULT FOR NATIVE0'));assert.equal(node('review-result').disabled,true);});
check('preview is a separate12-worker facade cohort and blocks every native bridge dispatch',()=>{const at=bridge.length;cohortTrace.length=0;node('preview-enter').click();assert(cohortTrace.every(u=>u.id.startsWith('preview-')));frames(10);assert.equal(diagnostics().mode,'preview');assert.equal(diagnostics().workers.length,12);assert(diagnostics().workers.every(u=>u.id.startsWith('preview-')));assert.equal(diagnostics().nativeSessionCount,312);node('new').click();node('appearance').click();node('open-chat').click();node('stop').click();node('preview-finish').click();frames(3);node('review-result').click();assert.equal(bridge.length,at);});
check('preview exit restores native state without merging synthetic session IDs',()=>{cohortTrace.length=0;node('preview-exit').click();assert(cohortTrace.every(u=>!u.id.startsWith('preview-')));frames();assert.equal(diagnostics().mode,'native');assert.equal(diagnostics().nativeSessionCount,312);assert(diagnostics().workers.every(u=>!u.id.startsWith('preview-')));});
const files=['main.js','control-state.js','field-state.js','mining-state.js','voxel-scene.js','theme.js'];
const output={status:'PASS',checks:checks.length,providerCalls:0,realNativeActions:0,timestampUTC:new Date().toISOString(),sourceSHA256:Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,'SimulationGarden/src',file))).digest('hex')])),scope:'Actual main/field/motion control flow with an EXPLICIT VoxelScene renderer test double. Not actual VoxelScene/WebGL/pixel/browser/native-provider proof; separate voxel tests cover renderer source/CPU contracts.',checksPassed:checks};
const outputArg=process.argv.indexOf('--output');if(outputArg>=0){assert(process.argv[outputArg+1],'--output requires receipt path');const out=path.resolve(process.argv[outputArg+1]);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(output,null,2)+'\n');}console.log(JSON.stringify(output,null,2));
