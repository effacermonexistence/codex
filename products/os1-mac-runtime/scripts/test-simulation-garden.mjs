#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
// This source/resource contract complements executed model-free control-flow
// tests. It is never a native UI, pixel-equivalence or provider-run receipt.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const app=read('Sources/OS1App/OS1App.swift'),view=read('Sources/OS1App/SimulationGardenView.swift');
const js=read('SimulationGarden/src/main.js'),scene=read('SimulationGarden/src/voxel-scene.js'),field=read('SimulationGarden/src/field-state.js');
const telemetry=read('Sources/OS1App/SimulationTelemetry.swift'),presentation=read('Sources/OS1Context/SimulationPresentation.swift');
const reports=[];function check(name,fn){fn();reports.push(name);}
// Match one actual Swift function/branch, including its balanced nested
// closures. Ignore string/comment braces without changing source offsets.
function swiftBody(text,signature){
 const start=text.indexOf(signature);assert(start>=0,'missing scoped Swift section '+signature);
 const masked=text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,token=>' '.repeat(token.length));
 const open=masked.indexOf('{',start);assert(open>=0);let depth=0;
 for(let i=open;i<masked.length;i++){if(masked[i]==='{')depth++;if(masked[i]==='}'&&--depth===0)return text.slice(open+1,i);}
 assert.fail('unbalanced scoped Swift section '+signature);
}
function verifyOutcomeBoundaries(body){
 const user=body.indexOf('messages.lastIndex(where: { $0.role == .user })');
 const later=body.indexOf('messages.suffix(from: userIndex + 1)');
 const roles=body.indexOf('later.filter { $0.role == .assistant || $0.role == .system || $0.role == .receipt }');
 const join=body.indexOf('text = outcomes.map(\\.text).joined(separator: "\\n\\n")');
 assert(user>=0&&user<later&&later<roles&&roles<join,'current request must retain assistant/status/receipt in source order');
 assert(!/outcomes\.filter\s*\{\s*\$0\.role\s*==\s*\.assistant\s*\}/.test(body),'assistant-only fallback drops native partial/error boundary');
}
function verifyReviewDoesNotSelect(body){
 const inspectStart=body.indexOf('if action == "inspect" {'),reviewStart=body.indexOf('if action == "review" {');
 const select=body.indexOf('store.select(id)');
 assert(inspectStart>=0&&reviewStart>inspectStart&&select>reviewStart,'inspect/review branches must precede selection');
 assert.equal(body.match(/store\.select\(id\)/g)?.length,1,'unexpected extra selection side effect');
 for(const name of ['inspect','review']){
  const branch=swiftBody(body,`if action == "${name}" {`);
  assert(branch.includes('guard let text'),'malformed inspection must return rather than fall through');
  assert(/\breturn\s*$/.test(branch.trim()),'presentation action must return before native selection');
  assert(!/store\.(select|send|createSession|cancelSelectedRun|deploySimulationSession)\(/.test(branch),'inspection/review may not enter native selection/task path');
 }
}
function verifyQuotaPublicationScope(body){
 const awaitRead=body.indexOf('await simulationTelemetryCache.quotas(');
 for(const captured of ['let codex = activeAccount(for: .codex)?.id ?? ""','let claude = activeAccount(for: .claude)?.id ?? ""','let codexEnabled = appSettings.showCodex'])
  assert(body.indexOf(captured)>=0&&body.indexOf(captured)<awaitRead,'capture account/provider scope before suspension');
 const guardAt=body.indexOf('guard codex ==',awaitRead),publish=body.indexOf('simulationQuotaPools = result');
 assert(awaitRead>=0&&guardAt>awaitRead&&publish>guardAt,'scope revalidation must precede quota publication');
 const guarded=body.slice(guardAt,body.indexOf('else { return }',guardAt));
 for(const condition of ['codex == (activeAccount(for: .codex)?.id ?? "")','claude == (activeAccount(for: .claude)?.id ?? "")','codexEnabled == appSettings.showCodex'])assert(guarded.includes(condition),'missing post-await scope check '+condition);
 assert(body.slice(awaitRead,guardAt).includes('codexEnabled: codexEnabled'),'async read must use the captured enable flag');
 assert(!/\bawait\b/.test(body.slice(guardAt,publish)),'no new suspension between scope guard and publication');
 const scopeAt=body.indexOf('simulationQuotaScope = (codex: codex, claude: claude, codexEnabled: codexEnabled)');
 assert(scopeAt>guardAt&&scopeAt<publish,'stored quota scope must be the successfully revalidated capture');
}
function verifyPublishedQuotaScope(text){
 const filtered=swiftBody(text,'fileprivate var currentSimulationQuotaPools:');
 const returned=filtered.indexOf('return simulationQuotaPools');
 const fallback=filtered.indexOf('else { return [:] }');
 assert(fallback>=0&&returned>fallback,'stale published scope must project no current balance');
 for(const condition of ['scope.codex == (activeAccount(for: .codex)?.id ?? "")','scope.claude == (activeAccount(for: .claude)?.id ?? "")','scope.codexEnabled == appSettings.showCodex'])
  assert(filtered.slice(0,fallback).includes(condition),'missing current scope projection check '+condition);
 const snapshot=swiftBody(text,'private var gardenSnapshot:');
 assert(snapshot.includes('let quota = store.currentSimulationQuotaPools[provider]'));
 assert(snapshot.includes('tokenPools: store.currentSimulationQuotaPools'));
 assert(!/store\.simulationQuotaPools\b/.test(snapshot),'snapshot must not bypass the current-scope filter');
 assert(!/activeAccount\(|simulationQuotaScope/.test(snapshot),'account identifiers must not be serialized into snapshot');
}
check('native UUID/name/run projection retained',()=>{
 assert(app.includes('.accessibilityIdentifier("os1.rail.simulation")'));
 assert(app.includes('name: session.title')&&app.includes('id: session.id.uuidString'));
 assert(app.includes('let running = isSessionRunning(session.id)'));
});
check('existing native new/send/stop and draft preservation retained',()=>{
 assert(app.includes('store.composer = text\n            store.send()'));
 assert(app.includes('store.cancelSelectedRun()')&&app.includes('store.createSession()'));
 assert(app.includes('store.composer.trimmingCharacters'));
});
check('exact bundled main frame dispatch and nonpersistent credential isolation',()=>{
 assert(view.includes('message.frameInfo.isMainFrame')&&view.includes('webView?.url?.standardizedFileURL == entry'));
 assert(view.includes('.nonPersistent()')&&view.includes('url.isFileURL'));
 assert(view.includes('UUID(uuidString: id)')&&view.includes('snapshot.sessions.contains'));
 assert(!view.includes('allowUniversalAccessFromFileURLs')&&!view.includes('allowFileAccessFromFileURLs'));
});
check('inspection/review require visible selected exact native result',()=>{
 assert(view.includes('guard snapshot.visible, let id, snapshot.selectedID == id'));
 assert(view.includes('?.resultRevision == text'));
 const start=app.indexOf('private func gardenAction('),action=app.slice(start,app.indexOf('var body: some View {',start));
 const guardPosition=action.indexOf('guard simulationVisible, store.selectedSessionID == id');
 assert(guardPosition>=0&&guardPosition<action.indexOf('store.select(id)'),'stale inspect may not silently select target');
 assert(app.includes('outcome.hasResult, outcome.revision == revision')&&app.includes('inspectedRevision: inspected'));
});
check('current-request results retain native partial/error/status/receipt boundaries',()=>{
 const body=swiftBody(app,'private func simulationOutcome(');verifyOutcomeBoundaries(body);
 assert.throws(()=>verifyOutcomeBoundaries(body.replace(' || $0.role == .system || $0.role == .receipt','')),'regression must reject assistant-only output');
});
check('inspection/review cannot fall through into draft-saving native selection',()=>{
 const body=swiftBody(app,'private func gardenAction(');verifyReviewDoesNotSelect(body);
 const reverted=body.replace('store.select(id)','').replace('if action == "inspect" {','store.select(id)\n        if action == "inspect" {');
 assert.throws(()=>verifyReviewDoesNotSelect(reverted),'regression must reject selecting before inspection');
});
check('quota publication revalidates exact captured accounts/provider state after await',()=>{
 const body=swiftBody(app,'func refreshSimulationTelemetry() async');verifyQuotaPublicationScope(body);
 assert.throws(()=>verifyQuotaPublicationScope(body.replace('claude == (activeAccount(for: .claude)?.id ?? "")','true')),'regression must reject cross-account async publication');
});
check('already-published quota is filtered against current scope without exporting account IDs',()=>{
 verifyPublishedQuotaScope(app);
 assert.throws(()=>verifyPublishedQuotaScope(app.replace('scope.claude == (activeAccount(for: .claude)?.id ?? "")','true')),'regression must reject stale published account balance');
 assert.throws(()=>verifyPublishedQuotaScope(app.replace('tokenPools: store.currentSimulationQuotaPools','tokenPools: store.simulationQuotaPools')),'regression must reject direct stale snapshot publication');
 for(const dto of ['struct OS1GardenTokenPool:','struct OS1GardenQuotaObservation:']){
  const body=swiftBody(telemetry,dto);
  assert(!/\b(?:let|var)\s+(?:accountID|codexAccountID|claudeAccountID|codexID|claudeID)\s*:/.test(body),'account ID in WebKit telemetry DTO');
 }
});
check('presentation retirement has no native storage/task authorization side effects',()=>{
 assert(presentation.includes('simulation-presentation.json'));
 assert(presentation.includes('O_NOFOLLOW')&&presentation.includes('maximumBytes = 256 * 1_024'));
 assert(!/Process\(|\.send\(|\.cancelSelectedRun\(|\.archive\(/.test(presentation));
 assert(app.includes('store.deploySimulationSession(id, reassign: true)'));
});
check('no second engine, external fetch, credential store or synthetic native dispatch',()=>{
 assert(!view.includes('Process()')&&!js.includes('fetch(')&&!js.includes('localStorage'));
 assert(js.includes('if(preview)return false;'));
 assert(js.includes("scene.setMode('preview')")&&js.includes("scene.setMode('native')"));
});
check('actual worker field is independent from roster page/search',()=>{
 assert(js.includes('battlefieldSessions(data.sessions,deployedIDs)'));
 assert(js.includes('scene?.sync(workers,currentID(),data.visible'));
 assert(!/sync\(visibleRoster\(/.test(js));assert(field.includes("s.status === 'queued'"));
});
check('style-only renderer preserves Terran objects, original HUD authority and source viewport',()=>{
 assert(/import\s*\{\s*VoxelScene\s*\}\s*from\s*['"]\.\/voxel-scene\.js['"]/.test(js));
 assert(!/from\s*['"]\.\/(?:terran-scene|scene)\.js['"]/.test(js));
 assert(/export\s+class\s+VoxelScene/.test(scene));
 assert(scene.includes('advanceColony')&&scene.includes('visibilityState'));
 assert(scene.includes("loadImage('./classic-reference.png')"),'original HUD source is required, not arbitrary replacement art');
 assert(scene.includes('drawImage(this.hudImage,0,316,640,164,0,316,640,164)'),'draw only the original bottom HUD band, never source screenshot terrain');
 assert(!/classic-terrain\.png|scv-body\.png|probe-body\.png|new\s+(?:THREE\.)?(?:TextureLoader|ImageLoader)|\bfetch\s*\(/.test(scene));
});
check('token telemetry preserves usage versus account quota scope',()=>{
 assert(telemetry.includes('RuntimeResourcePresentation.resources(usage)')&&telemetry.includes('RuntimeResourcePresentation.quota('));
 assert(telemetry.includes('remaining: nil, capacity: nil'));
 assert(telemetry.includes('value.basis == .unknown ? nil : value.generalRemainingEstimate'));
 assert(app.includes('receipt.userMessageID'));
 assert(js.includes('d.tokenPool,d.tokenPools'),'token-only observations must bypass semantic cache');
});
const dest=path.join(root,'Resources/SimulationGarden'),manifest=JSON.parse(fs.readFileSync(path.join(dest,'manifest.json'),'utf8'));
const allowed=/^(index\.html|THREE-LICENSE\.txt|classic-reference\.png|reference\.json|classic-sprites\.json|classic-terrain\.(png|json)|scv-(body|team|spark)\.png|probe-(body|team)\.png|mineral-[123]\.png|assets\/index-[a-zA-Z0-9_-]+\.(js|css))$/;
const required=['index.html','THREE-LICENSE.txt','classic-reference.png','reference.json','classic-sprites.json','classic-terrain.png','classic-terrain.json','scv-body.png','scv-team.png','scv-spark.png','probe-body.png','probe-team.png','mineral-1.png','mineral-2.png','mineral-3.png'];
const declared=new Set(manifest.files.map(e=>e.path));
check('exact resource manifest and required gameplay assets',()=>{
 assert.equal(manifest.schema,1);assert.equal(manifest.source,'products/os1-mac-runtime/SimulationGarden');
 assert.equal(declared.size,manifest.files.length,'duplicate manifest path');
 assert.equal(manifest.files.length,17,'voxel replacement retains the exact17 declared historical/bundle files');
 for(const file of required)assert(declared.has(file),'missing bundled gameplay asset '+file);
 assert(manifest.files.some(e=>/^assets\/index-[\w-]+\.js$/.test(e.path)));
 assert(manifest.files.some(e=>/^assets\/index-[\w-]+\.css$/.test(e.path)));
 for(const entry of manifest.files){
  assert(allowed.test(entry.path),'asset outside exact contract: '+entry.path);
  const file=path.join(dest,entry.path),info=fs.lstatSync(file);assert(info.isFile()&&!info.isSymbolicLink());
  const bytes=fs.readFileSync(file);assert.equal(bytes.length,entry.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
 }
 const actual=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){assert(!e.isSymbolicLink());const file=path.join(dir,e.name);if(e.isDirectory())walk(file);else if(path.relative(dest,file)!=='manifest.json')actual.push(path.relative(dest,file));}}
 walk(dest);assert.deepEqual(actual.sort(),[...declared].sort(),'undeclared/stale bundled file');
});
check('original HUD and unloaded historical sprite assets retain frozen identity',()=>{
 for(const file of required.filter(f=>f!=='index.html'))assert.deepEqual(fs.readFileSync(path.join(root,'SimulationGarden/public',file)),fs.readFileSync(path.join(dest,file)),'stale bundled source asset '+file);
 const reference=JSON.parse(fs.readFileSync(path.join(dest,'reference.json'),'utf8'));
 assert.equal(createHash('sha256').update(fs.readFileSync(path.join(dest,'classic-reference.png'))).digest('hex'),reference.assetSHA256);
 const atlas=JSON.parse(fs.readFileSync(path.join(dest,'classic-sprites.json'),'utf8'));assert.equal(atlas.format,'os1-classic-animation-atlas-v1');
 for(const spec of[atlas.scvBody,atlas.scvTeam,atlas.probeBody,atlas.probeTeam,atlas.spark,...atlas.minerals]){
  assert(allowed.test(spec.image));const bytes=fs.readFileSync(path.join(dest,spec.image));assert.equal(createHash('sha256').update(bytes).digest('hex'),spec.sha256);
  assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),spec.columns*spec.frameWidth);assert.equal(bytes.readUInt32BE(20),Math.ceil(spec.frames/spec.columns)*spec.frameHeight);
 }
 assert.equal(atlas.scvBody.frames,51);assert.equal(atlas.scvAnimation.directions,17);
});
check('unused historical terrain atlas is retained but cannot replace the 3D field',()=>{
 const terrain=JSON.parse(fs.readFileSync(path.join(dest,'classic-terrain.json'),'utf8'));
 assert.equal(terrain.format,'sc1-megatile-atlas-v1');assert.equal(terrain.image,'classic-terrain.png');
 assert.deepEqual(terrain.groupIDs,[8,9]);assert.equal(terrain.frames,23);assert.equal(new Set(terrain.tileIDs).size,23);
 assert.equal(terrain.tileIDs.length,terrain.frames);assert.equal(terrain.tileSize,32);
 const bytes=fs.readFileSync(path.join(dest,terrain.image));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),terrain.imageSHA256);
 assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),terrain.columns*terrain.tileSize);
 assert.equal(bytes.readUInt32BE(20),Math.ceil(terrain.frames/terrain.columns)*terrain.tileSize);
 assert(!scene.includes('classic-terrain.png'),'historical terrain must not be loaded by the active voxel renderer');
});
check('strict local CSP and local self-contained voxel executable scripts',()=>{
 const html=fs.readFileSync(path.join(dest,'index.html'),'utf8');assert(!html.includes('type="module"'));
 assert(html.includes("connect-src 'none'")&&html.includes("frame-src 'none'"));assert(!/https?:\/\//.test(html));
 for(const[,file]of html.matchAll(/(?:src|href)="\.\/([^"?#]+)"/g))assert(declared.has(file),'missing entry resource '+file);
 for(const file of[...declared].filter(f=>f.endsWith('.js'))){const code=fs.readFileSync(path.join(dest,file),'utf8');new vm.Script(code,{filename:file});assert(code.includes('classic-reference.png'),'bundled entry lost the original source HUD');assert(!/classic-terrain\.png|scv-body\.png|probe-body\.png/.test(code),'bundled field must use mechanical geometry, not sprite/terrain fallback');}
});
const behavior=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/test-gameplay-contract.mjs')],{encoding:'utf8',maxBuffer:1_000_000}));
assert.equal(behavior.status,'PASS');
const voxel=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/test-voxel-scene.mjs')],{encoding:'utf8',maxBuffer:2_000_000}));
assert.equal(voxel.status,'PASS');
console.log(JSON.stringify({status:'PASS',sourceChecks:reports.length,sourceChecksPassed:reports,behaviorChecks:behavior.checks,voxelChecks:voxel.checks,voxelScope:voxel.scope,assetFiles:manifest.files.length,sourceSHA256:behavior.sourceSHA256,manifestSHA256:createHash('sha256').update(fs.readFileSync(path.join(dest,'manifest.json'))).digest('hex'),basis:'deterministic source/resource integrity and isolated actual frontend control flow; not native screen/provider proof'},null,2));
