#!/usr/bin/env node
// One bounded read-only Codex turn. No production/customer task or UI activation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';

const [runtimeArg, outputArg] = process.argv.slice(2);
assert(runtimeArg && outputArg);
const runtime = fs.realpathSync(runtimeArg), output = path.resolve(outputArg);
assert(!fs.existsSync(output), 'use a new evidence directory');
fs.mkdirSync(output, {recursive:true, mode:0o700});
const workspace = path.join(output, 'workspace'); fs.mkdirSync(workspace, {mode:0o700});
const submission = randomUUID().toUpperCase(), inputID = randomUUID().toUpperCase();
const stateRoot = path.join(os.homedir(), 'Library/Application Support/OS-1');
const mailbox = path.join(stateRoot, 'run-steering', submission);
const activity = path.join(output, 'activity.json'), journal = path.join(output, 'events.jsonl');
const sessionBytes = fs.readFileSync(path.join(stateRoot, 'sessions.json'));
const hash = data => createHash('sha256').update(data).digest('hex');
const readJSON = file => { try { return JSON.parse(fs.readFileSync(file)); } catch { return null; } };
const original = 'Read-only check: Explain in two short Korean sentences why cache invalidation matters. Do not inspect files or use tools. End with ORIGINAL_OUTPUT.';
const correction = 'Same text-only task: keep the two-sentence Korean explanation of cache invalidation, but replace the final marker ORIGINAL_OUTPUT with STEERING_OBSERVED. Do not use tools or modify files.';
const started = Date.now();
const child = spawn(runtime, ['run', '--workspace', workspace, '--provider', 'codex', '--prompt', original,
  '--output-format', 'json', '--desktop-reveal', 'never'], {
  env:{...process.env, OS1_SUBMISSION_ID:submission, OS1_ACTIVITY_FILE:activity, OS1_EVENT_JOURNAL:journal,
    OS1_FAILURE_FILE:path.join(output,'failure.json')}, stdio:['ignore','pipe','pipe'],
});
let stdout = '', stderr = '', sent = false, lease, sentAt;
child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
const poll = setInterval(() => {
  if (sent) return;
  lease = readJSON(path.join(mailbox, 'active.json'));
  const progress = readJSON(activity);
  if (!lease || lease.submissionID !== submission || progress?.phase !== 'executing') return;
  const input = {id:inputID, submissionID:submission, text:correction, createdAt:Date.now()/1000-978307200};
  fs.writeFileSync(path.join(mailbox, inputID+'.input.json'), JSON.stringify(input), {mode:0o600,flag:'wx'});
  sent = true; sentAt = Date.now();
}, 50);
const deadline = setTimeout(() => child.kill('SIGTERM'), 180000);
const code = await new Promise((resolve,reject) => {child.on('error',reject);child.on('close',resolve);})
  .finally(() => {clearInterval(poll);clearTimeout(deadline);});
fs.writeFileSync(path.join(output,'result.json'), JSON.stringify({code,stdout,stderr},null,2), {mode:0o600});
assert.equal(code,0,stderr); assert(sent,'current turn never became steerable');
const summary = JSON.parse(stdout); assert.equal(summary.status,'complete');
assert.equal(summary.steps.length,1); const step = summary.steps[0];
assert.equal(step.sequence,1); assert.equal(step.provider,'codex'); assert.equal(step.permission_profile,'read_only');
assert(step.output.trim().endsWith('STEERING_OBSERVED')); assert(!step.output.includes('ORIGINAL_OUTPUT'));
assert.equal(step.native_record.persistence,'verified');
assert.equal(step.session_id,lease.threadID); assert.equal(step.native_record.turn_id,lease.turnID);
const receipt = readJSON(path.join(mailbox,inputID+'.receipt.json'));
assert.equal(receipt.state,'persisted'); assert.equal(receipt.turnID,lease.turnID);
const native = fs.readFileSync(step.native_record.record_path,'utf8').trim().split('\n').map(JSON.parse);
const turns = native.filter(r=>r.type==='event_msg'&&r.payload?.type==='task_started');
assert.equal(turns.length,1,'steering started or repeated a turn');
const directory = path.join(stateRoot,'managed-native-turns',hash(lease.threadID));
assert.equal(readJSON(path.join(directory,hash(lease.turnID)+'.json')).submissionID,submission);
assert.equal(fs.readdirSync(workspace).length,0,'read-only test mutated workspace');
const report = {status:'PASS',at:new Date().toISOString(),model:step.model,effort:step.effort,
  elapsedMS:Date.now()-started,steerSentMS:sentAt-started,threadID:lease.threadID,turnID:lease.turnID,
  backendTurns:turns.length,steeringReceipt:receipt.state,output:step.output.trim(),
  nativeSHA256:hash(fs.readFileSync(step.native_record.record_path)),workspaceFiles:0,
  sessionStoreUnchanged:sessionBytes.equals(fs.readFileSync(path.join(stateRoot,'sessions.json')))};
fs.writeFileSync(path.join(output,'audit.json'),JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify(report));
