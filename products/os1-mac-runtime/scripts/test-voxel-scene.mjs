#!/usr/bin/env node
// ACTUAL VoxelScene/world/Three CPU geometry contracts. Only the WebGL driver
// and DOM raster surfaces are doubled. No pixels, real FPS, GPU cost, provider
// execution or native runtime adoption are claimed by this test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),front=path.join(root,'SimulationGarden');
const pkg=JSON.parse(fs.readFileSync(path.join(front,'package.json'),'utf8'));
assert.equal(pkg.dependencies.three,'0.180.0');
const actualPackage=JSON.parse(fs.readFileSync(path.join(front,'node_modules/three/package.json'),'utf8'));
assert.equal(actualPackage.version,'0.180.0');
const THREE=await import(pathToFileURL(path.join(front,'node_modules/three/build/three.module.js')));
assert.equal(THREE.REVISION,'180');
assert.deepEqual(fs.readFileSync(path.join(front,'node_modules/three/LICENSE')),fs.readFileSync(path.join(front,'public/THREE-LICENSE.txt')));
let clock=0,denyDriver=false,imageRequests=0,networkRequests=0;
const queue=[],rendered=[],checks=[];
const context2D=()=>new Proxy({createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}})}, {get:(t,k)=>k in t?t[k]:()=>{},set:(t,k,v)=>(t[k]=v,true)});
class Element{
 constructor(tag='div'){Object.assign(this,{tagName:tag.toUpperCase(),style:{},dataset:{},attributes:{},events:{},children:[],clientWidth:1400,clientHeight:800,width:0,height:0});this.context=context2D();}
 appendChild(child){child.parent=this;this.children.push(child);return child;}setAttribute(k,v){this.attributes[k]=String(v);}removeAttribute(k){delete this.attributes[k];if(k==='data-error')delete this.dataset.error;}getContext(kind){assert.equal(kind,'2d','test never creates a GPU context');return this.context;}addEventListener(name,fn){this.events[name]=fn;}getBoundingClientRect(){return{left:0,top:0,width:this.clientWidth,height:this.clientHeight};}setPointerCapture(){}remove(){if(this.parent)this.parent.children=this.parent.children.filter(v=>v!==this);}
}
const document={visibilityState:'visible',createElement:tag=>new Element(tag)};
globalThis.document=document;globalThis.Image=class{constructor(){imageRequests++;throw Error('asset images are forbidden in procedural scene');}};globalThis.fetch=()=>{networkRequests++;throw Error('network forbidden in voxel contract');};
class DriverDouble{
 constructor(options){if(denyDriver)throw Error('SYNTHETIC_WEBGL_UNAVAILABLE');this.options=options;this.domElement=new Element('canvas');this.shadowMap={};this.info={render:{calls:0,triangles:0}};this.renderCount=0;this.disposed=false;}
 setPixelRatio(v){this.pixelRatio=v;}setSize(w,h){this.width=w;this.height=h;this.domElement.clientWidth=w;this.domElement.clientHeight=h;}render(scene,camera){this.renderCount++;scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);const ids=new Set();scene.traverse(o=>{if(o.isInstancedMesh&&o.count>0&&o.userData.workerIDs)for(const id of o.userData.workerIDs.slice(0,o.count))ids.add(id);});rendered.push([...ids]);}dispose(){this.disposed=true;}
}
const motion=await import(pathToFileURL(path.join(front,'src/mining-state.js'))),fields=await import(pathToFileURL(path.join(front,'src/field-state.js'))),theme=await import(pathToFileURL(path.join(front,'src/theme.js'))),world=await import(pathToFileURL(path.join(front,'src/voxel-world.js')));
const original=fs.readFileSync(path.join(front,'src/voxel-scene.js'),'utf8');
assert(!/classic-reference\.png|classic-terrain\.png|scv-body\.png|probe-body\.png|new\s+(?:THREE\.)?(?:TextureLoader|ImageLoader)/.test(original));
const code=original.replace(/^import .*;$/gm,'').replace('export class VoxelScene','class VoxelScene')+'\nglobalThis.VoxelSceneUnderTest=VoxelScene;\n';
const context=vm.createContext({THREE:{...THREE,WebGLRenderer:DriverDouble},...motion,...fields,...theme,...world,document,performance:{now:()=>clock},devicePixelRatio:3,requestAnimationFrame:fn=>queue.push(fn),ResizeObserver:class{constructor(fn){this.fn=fn;}observe(){}disconnect(){this.disconnected=true;}},console});
vm.runInContext(code,context,{filename:'actual-voxel-scene.js'});const Scene=context.VoxelSceneUnderTest;
function frames(n=1,ms=1000/60){for(let i=0;i<n;i++){clock+=ms;for(const f of queue.splice(0))f(clock);}}
function check(name,fn){fn();checks.push(name);}
const id=i=>`voxel-native-${i}`;
const rows=(n,status='working')=>Array.from({length:n},(_,i)=>({id:id(i),name:`Native miner ${i}`,engine:i%3===0?'Codex':i%3===1?'Claude':'Auto',status,featured:true,hasResult:false,resultPending:false,reviewed:false}));
const selected=[];const container=new Element(),scene=new Scene(container,value=>selected.push(value));await scene.ready;
check('actual scene builds real Three CPU block meshes and bounded high quality configuration',()=>{assert.equal(scene.renderer.options.antialias,true);assert(scene.pixelRatio<=1.5);assert(scene.sun.shadow.mapSize.x<=2048);assert(scene.world.blockCount>1000&&scene.world.blockCount<20000);assert(scene.world.group.children.some(o=>o.isInstancedMesh&&o.count>1000));assert.equal(imageRequests,0);assert.equal(networkRequests,0);});
let sessions=rows(12);scene.sync(sessions,id(0),true,{used:null},{});frames(30);
check('all12 actual scene workers advance with independently posed voxel rigs',()=>{const values=scene.states();assert.equal(values.length,12);assert(values.every(u=>u.phase>0));assert(values.some(u=>Math.abs(u.pose.walk)>.1));assert(values.every(u=>u.pose&&Number.isFinite(u.pose.yaw)));});
check('unknown ore is neutral, explicitly labeled and not represented as a full balance',()=>{const d=scene.world.diagnostics();assert(d.oreBanks.every(b=>b.unknown&&b.ratio===null&&b.visibleChunks<12));assert(scene.world.labels.every(l=>l.sprite.userData.text.includes('? 미측정')));assert(scene.world.oreBanks.every(b=>b.material.emissiveIntensity<.1));});
check('separate supplier observations determine only their own ore ratios, never absolute tokens',()=>{scene.sync(sessions,id(0),true,{used:123,remaining:null,capacity:null},{codex:{remainingPercent:25},claude:{remainingPercent:null}});const banks=scene.world.diagnostics().oreBanks;assert(banks.slice(0,4).every(b=>b.ratio===.25&&!b.unknown));assert(banks.slice(4).every(b=>b.ratio===null&&b.unknown));assert(scene.world.labels[0].sprite.userData.text.includes('25%'));assert(scene.world.labels[1].sprite.userData.text.includes('미측정'));assert.equal(scene.pool.remaining,null);});
check('a supplied zero quota removes ore rather than masquerading as unknown',()=>{scene.sync(sessions,id(0),true,null,{codex:{remainingPercent:0},claude:{remainingPercent:100}});const b=scene.world.diagnostics().oreBanks;assert(b.slice(0,4).every(v=>v.ratio===0&&v.visibleChunks===0&&!v.unknown));assert(b.slice(4).every(v=>v.ratio===1&&v.visibleChunks===12));});
check('partial ore never renders as empty/full and formatting never rounds a partial quota to an endpoint',()=>{
 assert.equal(world.oreChunkCount(null),4);assert.equal(world.oreChunkCount(0),0);assert.equal(world.oreChunkCount(1),12);
 let prior=0;for(let i=1;i<1000;i++){const count=world.oreChunkCount(i/1000);assert(count>=1&&count<=11);assert(count>=prior);prior=count;}
 for(const[value,label]of[[0,'0'],[.000001,'<0.1'],[.09,'<0.1'],[.1,'0.1'],[25.123456,'25.1'],[99.9,'99.9'],[99.95,'>99.9'],[99.999999,'>99.9'],[100,'100']])assert.equal(world.quotaPercentLabel(value),label);
});
check('actual resource meshes retain unrounded tiny/near-full quota with distinct partial counts',()=>{
 scene.sync(sessions,id(0),true,null,{codex:{remainingPercent:.000001},claude:{remainingPercent:99.999999}});
 const banks=scene.world.diagnostics().oreBanks;assert(banks.slice(0,4).every(b=>b.ratio===.000001/100&&b.visibleChunks===1));assert(banks.slice(4).every(b=>b.ratio===99.999999/100&&b.visibleChunks===11));
 assert(scene.world.labels[0].sprite.userData.text.includes('<0.1%'));assert(scene.world.labels[1].sprite.userData.text.includes('>99.9%'));
});
const stopped=sessions[0];stopped.status='completed';stopped.resultPending=true;stopped.hasResult=true;scene.sync(sessions,id(0),true,null,{});const frozen=scene.states()[0],moving=scene.states()[1].phase;frames(30);
check('terminal freezes exact geometry pose as well as phase, position and cargo',()=>{const value=scene.states()[0];for(const k of['x','y','phase','cargo','mode','cycles'])assert.equal(value[k],frozen[k]);assert.deepEqual(value.pose,frozen.pose);assert.equal(value.moving,false);assert.equal(value.mining,false);assert(scene.states()[1].phase>moving);});
check('terminal result marker is independent of success/adoption and worker pose',()=>{const rig=scene.workforce.rigs.get(id(0));assert.equal(rig.parts.marker.scale.x,1);stopped.reviewed=true;scene.sync(sessions,id(0),true,null,{});assert.equal(rig.parts.marker.scale.x,0);assert.deepEqual(scene.states()[0].pose,frozen.pose);});
stopped.status='working';stopped.reviewed=false;stopped.resultPending=false;scene.sync(sessions,id(0),true,null,{});frames();
check('same native UUID resumes its retained phase without a teleport or duplicate instance',()=>{const u=scene.states()[0];assert(u.phase>frozen.phase);assert(Math.hypot(u.x-frozen.x,u.y-frozen.y)<10);assert.equal(scene.states().filter(v=>v.id===id(0)).length,1);});
check('theme recolors shared materials without changing identities, native status or current pose',()=>{const before=JSON.stringify(scene.states());scene.setAccent('#72B7FF');assert.equal(scene.workforce.hatMaterial.color.getHexString(),'72b7ff');assert.equal(scene.world.materials.accent.color.getHexString(),'72b7ff');assert.equal(JSON.stringify(scene.states()),before);});
check('hidden native view suspends actual scene GPU-driver calls and movement',()=>{scene.sync(sessions,id(0),false,null,{});const before=JSON.stringify(scene.states()),calls=scene.renderer.renderCount;frames(50);assert.equal(JSON.stringify(scene.states()),before);assert.equal(scene.renderer.renderCount,calls);});
scene.sync(sessions,id(0),true,null,{});frames();
check('hidden document suspends actual scene GPU-driver calls and movement',()=>{document.visibilityState='hidden';const before=JSON.stringify(scene.states()),calls=scene.renderer.renderCount;frames(50);assert.equal(JSON.stringify(scene.states()),before);assert.equal(scene.renderer.renderCount,calls);document.visibilityState='visible';frames();});
check('actual scene resumes without accumulating hidden wall time',()=>{const before=scene.states();frames();assert(scene.states().every((u,i)=>Math.hypot(u.x-before[i].x,u.y-before[i].y)<10));});
check('mode changes immediately clear drawn instance cohorts, preserving native states for return',()=>{const before=scene.states();scene.setMode('preview');scene.sync([{...sessions[0],id:'preview-1'}],'preview-1',true,null,null);assert.deepEqual(rendered.at(-1),['preview-1']);scene.setMode('native');scene.sync(sessions,id(0),true,null,{});assert(rendered.at(-1).every(v=>!v.startsWith('preview-')));assert.deepEqual(scene.states(),before);});
frames(160,40);
check('sustained slow synthetic frame scheduling reduces resolution and shadow budget',()=>{assert.equal(scene.quality,'balanced');assert(scene.pixelRatio<=1);assert(scene.sun.shadow.mapSize.x<=1024);});
const previousMeshes=[...scene.workforce.groups.values()].flatMap(g=>Object.values(g.meshes));let disposedInstances=0;for(const m of previousMeshes)m.addEventListener('dispose',()=>disposedInstances++);
sessions=rows(300);scene.sync(sessions,id(0),true,null,{});frames();
check('300 parallel IDs are represented with at most30 instanced part batches, not a renderer cap',()=>{const groups=[...scene.workforce.groups.values()];assert.equal(scene.states().length,300);assert.equal(groups.reduce((n,g)=>n+g.meshes.torso.count,0),300);assert(groups.flatMap(g=>Object.values(g.meshes)).length<=30);assert(groups.flatMap(g=>Object.values(g.meshes)).every(m=>m.isInstancedMesh&&m.castShadow===false));assert.equal(new Set(groups.flatMap(g=>g.meshes.torso.userData.workerIDs)).size,300);assert(disposedInstances>0,'capacity growth must dispose old instance buffers');});
check('actual current matrices stay finite and preserve UUID picking provenance',()=>{for(const g of scene.workforce.groups.values()){const m=g.meshes.torso;assert.equal(m.count,m.userData.workerIDs.length);for(let i=0;i<m.count;i++){const matrix=new THREE.Matrix4();m.getMatrixAt(i,matrix);assert(matrix.elements.every(Number.isFinite));}assert.equal(m.boundingSphere,null);}});
sessions=rows(1,'idle');scene.sync(sessions,id(0),true,null,{});scene.fit();frames(180);const idleCalls=scene.renderer.renderCount;frames(60);
check('an idle settled world does not submit perpetual GPU-driver frames',()=>assert.equal(scene.renderer.renderCount,idleCalls));
check('camera focus remains smoothly animated while idle',()=>{const before=scene.orbit.radius,calls=scene.renderer.renderCount;scene.focus(id(0));frames();assert(scene.orbit.radius<before&&scene.orbit.radius>scene.orbitGoal.radius);assert(scene.renderer.renderCount>calls);});
check('selection raycast can return only an actually drawn current UUID',()=>{scene.applyCamera(1);scene.renderer.render(scene.scene,scene.camera);const u=scene.units.get(id(0)),p=world.toVoxel(u.x,u.y);p.y=2.43;const projected=p.project(scene.camera),e={clientX:(projected.x+1)/2*scene.width,clientY:(1-projected.y)/2*scene.height,button:0,pointerId:1};scene.canvas.events.pointerdown(e);scene.canvas.events.pointerup(e);assert.deepEqual(selected,[id(0)]);});
const renderer=scene.renderer;scene.dispose();const renderCount=renderer.renderCount;frames(20);
check('disposing releases scene/instance driver resources and stops future render work',()=>{assert(renderer.disposed);assert.equal(renderer.renderCount,renderCount);assert(scene.disposed);});
denyDriver=true;const failureContainer=new Element(),failure=new Scene(failureContainer,()=>{});await assert.rejects(failure.ready,/SYNTHETIC_WEBGL_UNAVAILABLE/);
check('WebGL failure is visible and never silently replaced with a classic or synthetic surface',()=>{assert.equal(failureContainer.dataset.renderer,'webgl-unavailable');assert(failureContainer.children.some(e=>e.attributes.role==='alert'&&e.textContent.includes('WebGL')));assert.equal(imageRequests,0);assert.equal(networkRequests,0);});failure.dispose();
console.log(JSON.stringify({status:'PASS',checks:checks.length,checksPassed:checks,scope:'Actual VoxelScene/world and pinned Three CPU geometry/state, DOM surfaces and WebGLRenderer driver doubled. Not actual GPU pixels/FPS/cost, browser/native UI or provider proof.',providerCalls:0,networkRequests,imageRequests,threeVersion:actualPackage.version,sourceSHA256:Object.fromEntries(['voxel-scene.js','voxel-world.js'].map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(front,'src',f))).digest('hex')]))},null,2));
