#!/usr/bin/env node
// Two bounded native backend calls through the installed OS1 runtime. Source
// acquisition is separate. Only a new isolated workspace note may be written.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
const [runtime, preparation, outputArg] = process.argv.slice(2);
assert(runtime && preparation && outputArg);
const output = path.resolve(outputArg);
assert(!fs.existsSync(output), 'fresh verification directory required');
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const workspace = path.join(output, 'workspace'); fs.mkdirSync(workspace, { mode: 0o700 });
const prep = JSON.parse(fs.readFileSync(preparation));
assert(prep.status === 'complete' && prep.sourceContext && prep.taskContext?.project?.liveVerified);
let context = prep.taskContext;
const reference = prep.sourceContext, release = context.project.operatingRecord.id;
const dateKeys = new Set(['createdAt','updatedAt','madeAt','startedAt','endedAt','lastProgressAt','checkedAt','retrievedAt','verifiedAt','observedAt']);
function transport(v, k) {
  if(dateKeys.has(k) && typeof v === 'number') return new Date((v+978307200)*1000).toISOString().replace(/\.\d{3}Z$/,'Z');
  if(Array.isArray(v)) return v.map(x=>transport(x));
  if(v && typeof v==='object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,transport(x,k)]));
  return v;
}
const sha = b=>createHash('sha256').update(b).digest('hex');
const save = (name, value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2),{mode:0o600});
const run = (args, env={})=>new Promise((resolve,reject)=>{
  const child=spawn(runtime,args,{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  const timer=setTimeout(()=>child.kill('SIGTERM'),240000);
  child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
});
let transcript='USER:\n인스타그램 오토메이션 수정 준비해\n\nOS1:\n'+prep.steps[0].output;
const results=[];
try {
for(const provider of ['codex','claude']) {
  const handoff=path.join(output,provider+'-context.json');
  fs.writeFileSync(handoff,JSON.stringify({format:'os1-session-handoff-v3',transcript,source:reference,taskContext:transport(context)}),{mode:0o600});
  const prompt=provider==='codex'
    ? 'OS1 격리 쓰기 검증입니다. 첨부된 검증 소스에서 현재 릴리스 ID와 Dockerfile의 Node 버전을 읽어, 현재 작업 디렉터리의 os1-smoke.txt 파일 하나만 새로 작성하세요. 내용은 세 줄: 릴리스 ID, Node 버전, OS1_TASK_LOOP_OK. 다른 파일 수정·명령·배포·네트워크·고객 데이터 접근은 하지 마세요. 끝나면 작성한 세 값을 짧게 답하세요.'
    : 'OS1 후속 맥락 검증입니다. 첨부된 소스의 현재 릴리스 ID, Dockerfile Node 버전, 직전 작업이 쓴 파일 이름과 마커를 네 줄로 답하세요. 제공된 대화와 소스만 사용하고 도구 호출·파일 변경·명령·배포·네트워크 접근은 하지 마세요. 이전 소스 자료가 연결되지 않았다고 추정하지 마세요.';
  const submission=randomUUID().toUpperCase(), events=path.join(output,provider+'-events.jsonl');
  fs.writeFileSync(events,'',{mode:0o600});
  const result=await run(['run','--workspace',workspace,'--provider',provider,'--context-file',handoff,'--prompt',prompt,
    '--desktop-reveal','never','--output-format','json'],{OS1_SUBMISSION_ID:submission,OS1_EVENT_JOURNAL:events,
      OS1_ACTIVITY_FILE:path.join(output,provider+'-activity.json'),OS1_FAILURE_FILE:path.join(output,provider+'-failure.json')});
  save(provider+'-result.json',result);
  assert.equal(result.code,0,result.stderr);
  const summary=JSON.parse(result.stdout), step=summary.steps.at(-1);
  assert.equal(summary.status,'complete'); assert.equal(summary.steps.length,1);
  assert.equal(step.sequence,1); assert.equal(step.provider,provider); assert.equal(step.native_record.persistence,'verified');
  assert(['native_record_only','not_revealed'].includes(step.native_record.desktop_visibility));
  assert.equal(summary.taskContext.conversationID,context.conversationID);
  assert.deepEqual(summary.sourceContext,reference);
  assert(step.output.includes(release) && step.output.includes('20.20.2') && step.output.includes('OS1_TASK_LOOP_OK'));
  const note=fs.readFileSync(path.join(workspace,'os1-smoke.txt'),'utf8');
  assert(note.includes(release) && note.includes('20.20.2') && note.includes('OS1_TASK_LOOP_OK'));
  assert.deepEqual(fs.readdirSync(workspace).filter(n=>n!=='.git'),['os1-smoke.txt']);
  const journal=fs.readFileSync(events,'utf8').split('\n').filter(Boolean).map(JSON.parse);
  assert(journal.some(e=>e.phase==='executing' && e.publicText),'no public progress returned to OS1');
  const box=path.join(os.homedir(),'Library/Application Support/OS-1/execution-outbox');
  const delivery=fs.readFileSync(path.join(box,'submission-'+submission+'.ref'),'utf8');
  const nativeBefore=sha(fs.readFileSync(step.native_record.record_path));
  const replay=await run(['resume-delivery',delivery]); assert.equal(replay.code,0);
  assert.equal(JSON.parse(replay.stdout).steps.at(-1).output,step.output);
  assert.equal(sha(fs.readFileSync(step.native_record.record_path)),nativeBefore,'replay executed backend again');
  results.push({provider,model:step.model,effort:step.effort,sessionID:step.session_id,deliveryID:delivery,
    sourceSHA256:reference.sha256,durationMS:step.duration_ms,permission:step.permission_profile,
    noteSHA256:sha(note),outputSHA256:sha(step.output),progressReturned:true,replayWithoutModel:true});
  context=summary.taskContext;transcript+='\n\nUSER:\n'+prompt+'\n\n'+provider+':\n'+step.output;
  save('audit.json',{status:'RUNNING',results});console.log(JSON.stringify(results.at(-1)));
}
save('audit.json',{status:'PASS',timestamp:new Date().toISOString(),modelCalls:2,release,results,
  scope:'isolated source-based file write, cross-provider context, progress and durable result replay; no deployment or customer delivery test'});
} catch(e){save('audit.json',{status:'FAIL',results,error:String(e.stack??e)});throw e;}
