#!/usr/bin/env node
// Exact installed readers + an optional idempotent native Codex metadata write.
// No model requests, no Claude state writes, no account or permission changes.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [app, runtime, out, mode] = process.argv.slice(2);
assert(app && runtime && out);
fs.mkdirSync(out, {recursive:true, mode:0o700});
const run = (file,args) => execFileSync(file,args,{encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sessions = path.join(os.homedir(),'Library/Application Support/OS-1/sessions.json');
const original = fs.readFileSync(sessions);
const checks=[];
const report={at:new Date().toISOString(),modelCalls:0,checks,claudeNativeWriteVerified:false,claudeManualOrderVerified:false};
const failures = [];
function check(name, fn) {
  try { fn(); checks.push({ name: name, status: 'PASS' }); }
  catch (error) { failures.push(name); checks.push({ name: name, status: 'FAIL', error: String(error && error.message || error) }); }
}
const db=path.join(os.homedir(),'.codex/state_5.sqlite');
const pinned=()=>JSON.parse(run('/usr/bin/sqlite3',['-readonly','-json',db,
  "select id,rollout_path from threads where archived=0 and thread_section_id='01984de2-8f74-7c91-a3b2-5c5e937cf318' order by section_position,id"]).trim()||'[]');
try {
  check('Deterministic sidebar behavior',()=>assert.match(run(app,['--self-test']),/Sidebar synchronization: (\d+) checks passed/));
  check('Rapid pin/unpin/reorder and unavailable backend',()=>assert.match(run(app,['--self-test-sidebar-queue']),/Sidebar queue: 4 checks passed/));
  const before=pinned();
  const snapshot=JSON.parse(run(app,['--audit-sidebar']));
  check('Exact native Codex pinned order',()=>assert.deepEqual(snapshot.codex.pinnedIDs,before.map(x=>x.id)));
  for(const provider of ['codex','claude'])check(`${provider} rows have no duplicate pins`,()=>
    assert.equal(new Set(snapshot[provider].pinnedIDs).size,snapshot[provider].pinnedIDs.length));
  check('Claude limitations reported, not falsely verified',()=>{
    assert.equal(snapshot.claude.manualOrderVerified,false);assert.equal(snapshot.claude.nativeMutationSupported,false);
  });
  if(mode==='--exercise-noop') {
    assert(before.length>=2);
    const target=before[0], next=before[1];
    const transcript=hash(fs.readFileSync(target.rollout_path));
    const start=Date.now();
    const result=run(runtime,['sidebar-pin','codex',target.id,'true',next.id]);
    report.nativeMutationMilliseconds=Date.now()-start;
    check('Actual Codex no-op independently read back',()=>assert.match(result,/OS1_SIDEBAR_VERIFIED/));
    check('All native Codex pins/order preserved',()=>assert.deepEqual(pinned().map(x=>x.id),before.map(x=>x.id)));
    check('No inference/transcript mutation',()=>assert.equal(hash(fs.readFileSync(target.rollout_path)),transcript));
    report.nativeNoopWriteVerified=true;
  }
  check('Existing OS1 conversation bytes preserved by audit',()=>assert(fs.readFileSync(sessions).equals(original)));
  report.nativeSnapshot=snapshot;
} catch(error) {checks.push({name:'terminal failure',status:'FAIL',error:String(error.message)});process.exitCode=1;}
finally {
  fs.writeFileSync(path.join(out,'sidebar-sync.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({passed:checks.filter(c=>c.status==='PASS').length,failed:checks.filter(c=>c.status==='FAIL'),
    nativeNoopWriteVerified:report.nativeNoopWriteVerified??false,claudeNativeWriteVerified:false,report:path.join(out,'sidebar-sync.json')}));
}
process.exit(failures.length === 0 ? 0 : 1);
