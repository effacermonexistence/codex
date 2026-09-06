#!/usr/bin/env node
// Two small read-only backend calls; recovery must reuse the same signed result.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
const [runtimeArg, outputArg, providerArg, coldStartArg] = process.argv.slice(2);
assert(runtimeArg && outputArg);
const runtime = path.resolve(runtimeArg), output = path.resolve(outputArg);
fs.mkdirSync(output, {recursive:true,mode:0o700});
const workspace = path.join(output, 'workspace');
fs.mkdirSync(workspace, {recursive:true,mode:0o700});
const hash = data => createHash('sha256').update(data).digest('hex');
async function run(args, env) {
  const started = Date.now();
  return await new Promise((resolve, reject) => {
    const child = spawn(runtime,args,{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data', data => stdout+=data);
    child.stderr.on('data', data => stderr+=data);
    const timer=setTimeout(()=>child.kill('SIGTERM'),180000);
    child.on('error',reject);
    child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr,started,ended:Date.now()});});
  });
}
const results=[];
for(const provider of providerArg ? [providerArg] : ['codex','claude']) {
  assert(['codex','claude','auto'].includes(provider));
  const submission=randomUUID().toUpperCase();
  const activity=path.join(output,provider+'.activity.json');
  const journal=path.join(output,provider+'.events.jsonl');
  fs.writeFileSync(journal,'',{mode:0o600});
  const env={OS1_ACTIVITY_FILE:activity,OS1_EVENT_JOURNAL:journal,OS1_SUBMISSION_ID:submission,
    OS1_FAILURE_FILE:path.join(output,provider+'.failure.json')};
  let prompt=provider==='auto'
    ? 'Read-only execution check: run the shell command pwd in the selected workspace, report its exact output, then write EXECUTION_OK. Do not modify files, log in, deploy, or run any other command.'
    : 'Read-only check: Explain in two short Korean sentences why cache invalidation matters. Do not inspect files or use tools. End with EXECUTION_OK.';
  // Distinct objective for a cold-start control; never erase existing successful
  // feedback just to make a lower-priced route win a benchmark.
  if(coldStartArg==='cold-start') prompt += ' Then stop.';
  const result=await run(['run','--workspace',workspace,'--provider',provider,'--prompt',
    prompt,
    '--output-format','json','--desktop-reveal','never'],env);
  fs.writeFileSync(path.join(output,provider+'.result.json'),JSON.stringify(result,null,2),{mode:0o600});
  assert.equal(result.code,0,`${provider}: ${result.stderr}`);
  const summary=JSON.parse(result.stdout);
  assert.equal(summary.status,'complete');
  assert.equal(summary.steps.length,1);
  const step=summary.steps[0];
  assert.equal(step.sequence,1,'One final step must not hide earlier failed model attempts');
  assert.equal(step.provider,provider==='auto'?'codex':provider); assert.equal(step.revas_disposition,'adopted');
  assert.equal(step.native_record.persistence,'verified');
  assert(step.output.includes('EXECUTION_OK'));
  assert(step.permission_profile==='read_only');
  // Feasibility comes from the current catalog/quota observations, not a
  // historical hard-coded model ban in an acceptance test.
  if(provider==='auto') assert(step.output.includes(workspace),'Actual shell working directory missing');
  if(provider==='auto' && coldStartArg==='cold-start') {
    assert.equal(step.model,'gpt-5.6-luna');
    assert.equal(step.effort,'low');
  }
  const events=fs.readFileSync(journal,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const publicEvents=events.filter(e=>e.phase==='executing' && e.publicText?.length);
  assert(publicEvents.length>0,`${provider} public progress never reached OS1`);
  assert(events.some(e=>e.phase==='executing' && e.provider===step.provider && e.nativeSessionID===step.session_id),
    'Live backend identity must match the adopted native session before completion');
  assert((publicEvents[0].timestamp+978307200)*1000<result.ended);
  const box=path.join(os.homedir(),'Library/Application Support/OS-1/execution-outbox');
  const id=fs.readFileSync(path.join(box,'submission-'+submission+'.ref'),'utf8');
  const record=JSON.parse(fs.readFileSync(path.join(box,id+'.json'),'utf8'));
  assert.equal(record.submissionID,submission);
  const nativePath=step.native_record.record_path;
  assert(nativePath && fs.existsSync(nativePath));
  const nativeHash=hash(fs.readFileSync(nativePath));
  for(let n=0;n<2;n++) {
    const replay=await run(['resume-delivery',id],env);
    assert.equal(replay.code,0,replay.stderr);
    const replaySummary=JSON.parse(replay.stdout);
    assert.equal(replaySummary.steps[0].output,step.output);
    assert.equal(replaySummary.steps[0].session_id,step.session_id);
    assert.equal(hash(fs.readFileSync(nativePath)),nativeHash,'Delivery replay changed native model transcript');
  }
  results.push({provider,model:step.model,effort:step.effort,sessionID:step.session_id,deliveryID:id,
    elapsedMS:result.ended-result.started,publicEvents:publicEvents.length,
    firstPublicMS:(publicEvents[0].timestamp+978307200)*1000-result.started,
    outputSHA256:hash(step.output),replays:2,nativeRecordUnchanged:true,liveNativeIdentityMatched:true});
  console.log(JSON.stringify(results.at(-1)));
}
fs.writeFileSync(path.join(output,'live-execution-audit.json'),JSON.stringify({timestamp:new Date().toISOString(),
  status:'PASS',results,modelCalls:results.length,additionalModelCallsForReplay:0},null,2),{mode:0o600});
