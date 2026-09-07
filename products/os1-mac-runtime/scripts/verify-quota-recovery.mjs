// Opt-in live test for an account currently reporting Claude session quota.
// One explicit denied attempt, then one Auto request. No billing/auth changes.
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const [runtime,root]=process.argv.slice(2);assert(runtime&&root);
fs.mkdirSync(root,{recursive:true,mode:0o700});
const run=promisify(execFile),results=[];
for(const provider of ['claude','auto']){
 const prefix=root+'/'+provider,started=Date.now();
 fs.writeFileSync(prefix+'.events.jsonl','',{mode:0o600,flag:'wx'});
 const env={...process.env,OS1_EVENT_JOURNAL:prefix+'.events.jsonl',OS1_ACTIVITY_FILE:prefix+'.activity.json',
  OS1_FAILURE_FILE:prefix+'.failure.json',OS1_SUBMISSION_ID:randomUUID().toUpperCase()};
 const args=['run','--workspace',os.homedir(),'--provider',provider,'--prompt',
  '읽기 전용: 캐시 무효화가 필요한 이유를 두 문장으로 설명하고 마지막에 EXECUTION_OK를 적어줘. 파일이나 도구를 사용하지 마.',
  '--output-format','json','--desktop-reveal','never'];
 let result;try{result={code:0,...await run(runtime,args,{env,timeout:180000,maxBuffer:2_000_000})};}
 catch(e){result={code:e.code,stdout:e.stdout||'',stderr:e.stderr||''};}
 fs.writeFileSync(prefix+'.result.json',JSON.stringify(result),{mode:0o600});
 const events=fs.readFileSync(prefix+'.events.jsonl','utf8').trim().split('\n').map(JSON.parse);
 const sessions=[...new Map(events.filter(e=>e.phase==='executing'&&e.nativeSessionID).map(e=>[e.nativeSessionID,{provider:e.provider,session:e.nativeSessionID}])).values()];
 const claudeCount=sessions.filter(s=>s.provider==='claude').length;
 if(provider==='claude'){
  assert.equal(result.code,1);const notice=JSON.parse(fs.readFileSync(prefix+'.failure.json'));
  assert.equal(notice.blocker,'quota_exhausted');assert.equal(claudeCount,1);
  assert.equal(sessions.length,1,'Explicit pin never silently changes provider');
  results.push({requested:provider,expectedOutcome:'single quota rejection',backendStarts:sessions,elapsedMS:Date.now()-started});
 }else{
  assert.equal(result.code,0,result.stderr);const s=JSON.parse(result.stdout);
  assert.equal(s.status,'complete');assert(s.steps.at(-1).output.includes('EXECUTION_OK'));
  assert.equal(s.steps.at(-1).provider,'codex');assert(claudeCount<=1);
  assert.equal(sessions.filter(s=>s.provider==='codex').length,1);
  assert(!fs.existsSync(prefix+'.failure.json'),'Success clears previous quota failure');
  results.push({requested:provider,expectedOutcome:'Codex completed in OS1',backendStarts:sessions,
   actualClaudeToCodex:claudeCount===1,elapsedMS:Date.now()-started,nativeRecord:s.steps.at(-1).native_record.persistence});
 }
 console.log(JSON.stringify(results.at(-1)));
}
fs.writeFileSync(root+'/quota-recovery-audit.json',JSON.stringify({status:'PASS',at:new Date().toISOString(),results,
 limitation:'Claude account quota is still active; no successful Claude inference is claimed.'},null,2),{mode:0o600});
