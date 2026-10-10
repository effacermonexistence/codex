#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import {quiesceRCCCoreForBinaryChange, binaryRollbackPermitted} from './install-local-verified.mjs';
const home='/private/fixture/mac', cli=path.join(home,'.local/bin/os1');
const root=path.join(home,'.os1/rcc-runtime');
const owner=path.join(root,'transport-owner.json'), starting=path.join(root,'transport-starting.json');
const requestID='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const receiptPath=path.join(root,'upgrade-receipts',`quiescence-${requestID}.json`);
const quiet={schema:1,hadGateway:true,requestID,ownerPID:42,queuedTasks:2,receiptPath};
const evidence={schema:1,request_id:requestID,owner_pid:42,active_dispatches:0,
 safe_to_stop:true,queued_preserved:true,queued_tasks:2,identity_sha256:'a'.repeat(64),
 configuration_sha256:'b'.repeat(64),quiescence_rpc_sha256:'c'.repeat(64)};
let checks=0;
const check=fn=>{fn();checks++;};
function fixture({markers=[owner],response=quiet,record=evidence,remove=true,fail=false,rows=[],afterRows=null}={}) {
 const files=new Set(markers), calls=[], durableDB='QUEUED_REQUESTS_AND_RAW_RESULTS_UNCHANGED';
 let currentRows=rows;
 return {files,calls,durableDB,options:{home,cli,exists:p=>files.has(p),processRows:()=>currentRows,readReceipt:p=>{assert.equal(p,receiptPath);return record;},
 execute:(exe,args,timeout)=>{calls.push([exe,args,timeout]);assert.equal(exe,cli);assert.deepEqual(args,['rcc-quiesce']);
  if(fail)throw Error('active core or unresolved startup preserved');
  if(remove){files.delete(owner);files.delete(starting);}if(afterRows)currentRows=afterRows;return JSON.stringify(response);}}};
}
check(()=>{const f=fixture({markers:[]});assert.deepEqual(quiesceRCCCoreForBinaryChange(f.options),{schema:1,hadGateway:false});assert.equal(f.calls.length,0);});
check(()=>{const f=fixture();assert.deepEqual(quiesceRCCCoreForBinaryChange(f.options),quiet);assert.equal(f.calls.length,1);assert.equal(f.durableDB,'QUEUED_REQUESTS_AND_RAW_RESULTS_UNCHANGED');});
check(()=>{const f=fixture({markers:[starting],fail:true});assert.throws(()=>quiesceRCCCoreForBinaryChange(f.options),/unresolved/);assert(f.files.has(starting));});
check(()=>{const f=fixture({markers:[owner,starting]});assert.deepEqual(quiesceRCCCoreForBinaryChange(f.options),quiet);assert.equal(f.files.size,0);});
check(()=>{const f=fixture({fail:true});assert.throws(()=>quiesceRCCCoreForBinaryChange(f.options),/active core/);assert(f.files.has(owner));});
check(()=>{const f=fixture({remove:false});assert.throws(()=>quiesceRCCCoreForBinaryChange(f.options),/owner still active/);});
check(()=>{const f=fixture({response:{...quiet,hadGateway:false}});assert.throws(()=>quiesceRCCCoreForBinaryChange(f.options),/owner was not verified/);});
check(()=>{const f=fixture({record:{...evidence,safe_to_stop:false}});assert.throws(()=>quiesceRCCCoreForBinaryChange(f.options),/incomplete/);});
check(()=>{const f=fixture({record:{...evidence,queued_preserved:false}});assert.throws(()=>quiesceRCCCoreForBinaryChange(f.options),/incomplete/);});
check(()=>{const f=fixture({response:{...quiet,receiptPath:'/outside/quiescence.json'}});assert.throws(()=>quiesceRCCCoreForBinaryChange(f.options),/private owner custody/);});
check(()=>{const f=fixture();assert.throws(()=>quiesceRCCCoreForBinaryChange({...f.options,cli:'/staged/new/os1'}),/current installed CLI/);assert.equal(f.calls.length,0);});
check(()=>{const f=fixture({fail:true});let rccQuiesced=false;try{quiesceRCCCoreForBinaryChange(f.options);rccQuiesced=true;}catch{}
 assert.equal(binaryRollbackPermitted({appStopped:true,pagingQuiesced:true,rccQuiesced,anyBinaryMoved:true}),false);});
check(()=>{const f=fixture();quiesceRCCCoreForBinaryChange(f.options);
 assert.equal(binaryRollbackPermitted({appStopped:true,pagingQuiesced:true,rccQuiesced:true,anyBinaryMoved:true}),true);});
for(const exe of [cli,path.join(home,'Applications/OS-1 CLODEX.app/Contents/Resources/os1')])
 check(()=>{const f=fixture({markers:[],rows:[`42 ${exe} rcc-adapter --ticket-file PRIVATE_TICKET`]});
  assert.throws(()=>quiesceRCCCoreForBinaryChange(f.options),e=>e.message.includes('executor still active (42)')&&!e.message.includes('PRIVATE_TICKET'));
  assert.equal(f.calls.length,0);});
check(()=>{const f=fixture({rows:[`41 ${cli} rcc-catalog --request-file PRIVATE_REQUEST`]});assert.deepEqual(quiesceRCCCoreForBinaryChange(f.options),quiet);});
check(()=>{const f=fixture({rows:['42 /source/unrelated/.build/debug/os1 rcc-adapter --ticket-file PRIVATE_TICKET']});assert.deepEqual(quiesceRCCCoreForBinaryChange(f.options),quiet);});
check(()=>{const f=fixture({afterRows:[`43 ${cli} rcc-adapter --ticket-file PRIVATE_TICKET`]});assert.throws(()=>quiesceRCCCoreForBinaryChange(f.options),/executor still active \(43\)/);});
check(()=>{const f=fixture({markers:[],rows:['malformed process inventory']});assert.throws(()=>quiesceRCCCoreForBinaryChange(f.options),/inventory malformed/);});
console.log(`OS1 installer RCC forward/rollback quiescence: ${checks} checks PASS; mocks only, no installation/process/provider access`);
