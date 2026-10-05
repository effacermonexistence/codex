#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {backupPagingState, verifyPagingRecoveryTree, binaryRollbackPermitted} from './install-local-verified.mjs';
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
 check(()=>assert.equal(binaryRollbackPermitted({appStopped:true,pagingQuiesced:true,anyBinaryMoved:true}),true));
 for(const key of ['appStopped','pagingQuiesced','anyBinaryMoved'])
  check(()=>assert.equal(binaryRollbackPermitted({...{appStopped:true,pagingQuiesced:true,anyBinaryMoved:true},[key]:false}),false));
 const unsafe=path.join(root,'unsafe'), unsafeRecovery=path.join(root,'unsafe-recovery');
 fs.mkdirSync(unsafe,{mode:0o700});fs.mkdirSync(unsafeRecovery,{mode:0o700});
 fs.symlinkSync(source,path.join(unsafe,'episodic-memory'));
 check(()=>assert.throws(()=>backupPagingState({supportRoot:unsafe,recoveryRoot:unsafeRecovery})));
 check(()=>assert.throws(()=>verifyPagingRecoveryTree(receipt.backup,{...manifest,roots:[{name:'../outside',present:true}]})));
 console.log(`OS1 private paging recovery: ${checks} checks PASS; temporary fixtures only, no installation/live/provider access`);
} finally {
 // Read-only drill must be released only inside this private synthetic root.
 for(const dir of ['recovery/paging-state-restore-drill']) {
  const full=path.join(root,dir);if(fs.existsSync(full)){
   const walk=p=>{fs.chmodSync(p,0o700);for(const e of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isDirectory())walk(f);else fs.chmodSync(f,0o600)}};walk(full);
  }
 }
 fs.rmSync(root,{recursive:true,force:true});
}
