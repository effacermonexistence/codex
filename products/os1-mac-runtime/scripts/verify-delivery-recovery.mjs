#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
const [runtime,output,...ids]=process.argv.slice(2);
assert(runtime && output && ids.length);
fs.mkdirSync(output,{recursive:true,mode:0o700});
const box=path.join(os.homedir(),'Library/Application Support/OS-1/execution-outbox');
const digest=data=>createHash('sha256').update(data).digest('hex');
const run=id=>execFileSync(runtime,['resume-delivery',id],{encoding:'utf8',timeout:90000,maxBuffer:2000000});
const reports=[];
for(const id of ids){
  assert(/^[a-f0-9-]{36}-\d+$/i.test(id));
  const original=fs.readFileSync(path.join(box,id+'.json'));
  const record=JSON.parse(original),step=JSON.parse(Buffer.from(record.step,'base64'));
  const nativePath=step.native_record.record_path,before=digest(fs.readFileSync(nativePath));
  for(let i=0;i<2;i++){
    const result=JSON.parse(run(id));
    assert.equal(result.status,'complete');
    assert.equal(result.steps[0].output,record.output);
    assert.equal(result.steps[0].session_id,step.session_id);
    assert.equal(digest(fs.readFileSync(nativePath)),before);
  }
  // A local "complete" cache must not substitute for a signed server receipt.
  const forged=JSON.parse(original), fakeID=randomUUID();
  forged.id=fakeID+'-1';
  forged.response=Buffer.from(JSON.stringify({status:'complete'})).toString('base64');
  for(const key of ['upload','submission']){
    const value=JSON.parse(Buffer.from(forged[key],'base64'));
    value.ticket.execution_id=fakeID;
    value.ticket.signature='invalid-signature';
    forged[key]=Buffer.from(JSON.stringify(value)).toString('base64');
  }
  const fixture=path.join(box,forged.id+'.json');
  fs.writeFileSync(fixture,JSON.stringify(forged),{mode:0o600,flag:'wx'});
  try {
    let rejected = false;
    try { run(forged.id); }
    catch(error) {
      assert.equal(error.status, 1, 'Negative control must exit normally as rejected, not time out or crash');
      assert.match(String(error.stderr), /HTTP (400|401|403)/,
        'An outage/unrelated error is not evidence that a forged signature was rejected');
      rejected = true;
    }
    assert(rejected, 'Forged local completion must not be adopted');
  }
  finally { fs.unlinkSync(fixture); }
  assert.equal(digest(fs.readFileSync(nativePath)),before);
  const rejectedCopy = JSON.parse(original);
  rejectedCopy.id = randomUUID() + '-1';
  rejectedCopy.localRejection = 'test: source contract rejected this paid candidate';
  const rejectedFixture = path.join(box, rejectedCopy.id + '.json');
  fs.writeFileSync(rejectedFixture, JSON.stringify(rejectedCopy), {mode:0o600,flag:'wx'});
  try {
    let blocked = false;
    try { run(rejectedCopy.id); }
    catch(error) {
      assert.equal(error.status, 1);
      assert.match(String(error.stderr), /로컬 검증을 통과하지 못했습니다/);
      blocked = true;
    }
    assert(blocked, 'Delivery must not launder a locally rejected candidate into adoption');
  } finally { fs.unlinkSync(rejectedFixture); }
  reports.push({deliveryID:id,provider:step.provider,replays:2,nativeUnchanged:true,forgedCompletionRejected:true});
}
fs.writeFileSync(path.join(output,'delivery-recovery-audit.json'),JSON.stringify({status:'PASS',
  timestamp:new Date().toISOString(),modelCalls:0,reports},null,2),{mode:0o600});
console.log(JSON.stringify({status:'PASS',records:reports.length,modelCalls:0,forgedCompletionRejected:true}));
