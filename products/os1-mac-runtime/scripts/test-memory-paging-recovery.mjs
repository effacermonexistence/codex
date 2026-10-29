#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {backupPagingState, verifyPagingRecoveryTree, binaryRollbackPermitted, copyPagingTree, cloneIntoDirectory,
  cloneFileExclusive} from './install-local-verified.mjs';
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'os1-paging-recovery-fixture-')));
fs.chmodSync(root, 0o700);
let checks=0;
const check=(f)=>{f();checks++;};
try {
 const source=path.join(root,'source'), recovery=path.join(root,'recovery');
 fs.mkdirSync(source,{mode:0o700}); fs.mkdirSync(recovery,{mode:0o700});
 for(const name of ['episodic-memory','memory-paging','source-snapshots']){
  fs.mkdirSync(path.join(source,name),{mode:0o700});
  fs.writeFileSync(path.join(source,name,'fixture.json'),JSON.stringify({exact:'92/128 -> 60/128',name}),{mode:0o600});
 }
 fs.writeFileSync(path.join(source,'context-budget.json'),'{}',{mode:0o600});
 const {manifest, receipt}=backupPagingState({supportRoot:source,recoveryRoot:recovery});
 check(()=>assert.equal(receipt.restoreDrill.status,'PASS'));
 check(()=>assert.equal(receipt.restoreDrill.liveActivated,false));
 check(()=>assert.equal(receipt.restoreDrill.readOnly,true));
 check(()=>assert.equal(receipt.preservedFiles,4));
 check(()=>assert.equal(manifest.liveRestoreAuthorized,false));
 check(()=>assert.equal(verifyPagingRecoveryTree(receipt.backup,manifest,{privateCopy:true}).preservedFiles,4));
 check(()=>assert.equal(verifyPagingRecoveryTree(receipt.restoreDrill.path,manifest,{privateCopy:true}).preservedFiles,4));
 check(()=>assert.equal(fs.statSync(path.join(receipt.restoreDrill.path,'context-budget.json')).mode & 0o777,0o400));
 fs.writeFileSync(path.join(source,'memory-paging','newer.json'),'newer work',{mode:0o600});
 check(()=>assert.throws(()=>verifyPagingRecoveryTree(source,manifest)));
 check(()=>assert.equal(verifyPagingRecoveryTree(source,manifest,{allowAdditional:true}).additionalEntries,1));
 fs.writeFileSync(path.join(source,'context-budget.json'),'changed',{mode:0o600});
 check(()=>assert.throws(()=>verifyPagingRecoveryTree(source,manifest,{allowAdditional:true})));
 check(()=>assert.equal(fs.readFileSync(path.join(source,'context-budget.json'),'utf8'),'changed'));
 check(()=>assert.equal(fs.readFileSync(path.join(receipt.backup,'context-budget.json'),'utf8'),'{}'));
 check(()=>assert.equal(binaryRollbackPermitted({appStopped:true,pagingQuiesced:true,rccQuiesced:true,anyBinaryMoved:true}),true));
 for(const key of ['appStopped','pagingQuiesced','rccQuiesced','anyBinaryMoved'])
  check(()=>assert.equal(binaryRollbackPermitted({...{appStopped:true,pagingQuiesced:true,rccQuiesced:true,anyBinaryMoved:true},[key]:false}),false));
 check(()=>assert.equal(binaryRollbackPermitted({appStopped:true,pagingQuiesced:true,anyBinaryMoved:true}),false));
 const unsafe=path.join(root,'unsafe'), unsafeRecovery=path.join(root,'unsafe-recovery');
 fs.mkdirSync(unsafe,{mode:0o700});fs.mkdirSync(unsafeRecovery,{mode:0o700});
 fs.symlinkSync(source,path.join(unsafe,'episodic-memory'));
 check(()=>assert.throws(()=>backupPagingState({supportRoot:unsafe,recoveryRoot:unsafeRecovery})));
 check(()=>assert.throws(()=>verifyPagingRecoveryTree(receipt.backup,{...manifest,roots:[{name:'../outside',present:true}]})));
 // Build 446 (DESIGN-5 §C): new recovery copies are APFS clones (`cp -c`)
 // when the volume can clone, the byte copy when the cloner cannot run; the
 // receipt keys, manifest checks and private modes are unchanged either way.
 check(()=>assert.deepEqual(Object.keys(receipt).sort(),['additionalEntries','backup','bytes','format','manifestFile',
   'preservedBytes','preservedFiles','restoreDrill','roots','sha256'].sort()));
 const clean=path.join(root,'clean');fs.mkdirSync(clean,{mode:0o700});
 for(const name of ['episodic-memory','memory-paging','source-snapshots']){
  fs.mkdirSync(path.join(clean,name),{mode:0o700});
  for(let i=0;i<3;i++)fs.writeFileSync(path.join(clean,name,`f${i}.json`),JSON.stringify({i,name}),{mode:0o644});
 }
 fs.writeFileSync(path.join(clean,'context-budget.json'),'{"b":1}',{mode:0o600});
 const {manifest:cleanManifest}=backupPagingState({supportRoot:clean,recoveryRoot:fs.mkdtempSync(path.join(root,'r-'))});
 const batches=[];
 const recording=(sources,directory)=>{batches.push(sources.length);return cloneIntoDirectory(sources,directory);};
 const cloned=path.join(root,'cloned-copy');
 copyPagingTree(clean,cloned,cleanManifest,{cloner:recording});
 check(()=>assert.deepEqual(batches,[3,3,1,3]));
 check(()=>assert.equal(verifyPagingRecoveryTree(cloned,cleanManifest,{privateCopy:true}).preservedFiles,10));
 check(()=>assert.equal(fs.statSync(path.join(cloned,'memory-paging','f1.json')).mode & 0o777,0o600));
 check(()=>assert.notEqual(fs.statSync(path.join(cloned,'memory-paging','f1.json')).ino,fs.statSync(path.join(clean,'memory-paging','f1.json')).ino));
 check(()=>assert.equal(fs.statSync(path.join(clean,'memory-paging','f1.json')).mode & 0o777,0o644));
 const fallback=path.join(root,'byte-copy');
 copyPagingTree(clean,fallback,cleanManifest,{cloner:()=>false});
 check(()=>assert.equal(verifyPagingRecoveryTree(fallback,cleanManifest,{privateCopy:true}).preservedFiles,10));
 check(()=>assert.equal(cloneIntoDirectory([path.join(clean,'context-budget.json')],path.join(root,'r-missing'),{cp:path.join(root,'no-cp')}),false));
 check(()=>assert.equal(cloneFileExclusive(path.join(clean,'context-budget.json'),path.join(root,'one.json')),'clone'));
 check(()=>assert.equal(cloneFileExclusive(path.join(clean,'context-budget.json'),path.join(root,'two.json'),{cp:path.join(root,'no-cp')}),'copy'));
 check(()=>assert.throws(()=>cloneFileExclusive(path.join(clean,'context-budget.json'),path.join(root,'one.json'))));
 check(()=>assert.equal(fs.readFileSync(path.join(root,'one.json'),'utf8'),'{"b":1}'));
 console.log(`OS1 private paging recovery: ${checks} checks PASS; temporary fixtures only, no installation/live/provider access`);
} finally {
 // Read-only drill must be released only inside this private synthetic root.
 const drills=fs.readdirSync(root).filter(name=>name.startsWith('r-')).map(name=>name+'/paging-state-restore-drill');
 for(const dir of ['recovery/paging-state-restore-drill',...drills]) {
  const full=path.join(root,dir);if(fs.existsSync(full)){
   const walk=p=>{fs.chmodSync(p,0o700);for(const e of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isDirectory())walk(f);else fs.chmodSync(f,0o600)}};walk(full);
  }
 }
 fs.rmSync(root,{recursive:true,force:true});
}
