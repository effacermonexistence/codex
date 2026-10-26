#!/usr/bin/env node
// Opt-in, finite integration test. Never changes installed hooks or services.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync, spawn} from 'node:child_process';
import {chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';

const repository = 'effacermonexistence/codex';
const objective = 'os1-fleet-objective-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
// The App's label for an unverified Core answer (RCCRuntimeProjection.returnedUnverifiedDescription).
const unverifiedLabel = 'Output returned · task quality unverified; candidate retained.';
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', {flag:'wx', mode:0o600});
const command = (bin, args, options = {}) => execFileSync(bin, args, {encoding:'utf8', timeout:30_000, maxBuffer:4_000_000, stdio:['ignore','pipe','pipe'], ...options}).trim();

function verifyReceipt({mirror, receipt, intent, marker, profile, revision, expected}) {
  assert.equal(mirror.state, 'complete', 'remote execution is not terminal success');
  assert.equal(hash(mirror.result), mirror.result_hash, 'result digest mismatch');
  assert.equal(mirror.objective_version, objective);
  assert.equal(mirror.profile, profile);
  assert.equal(receipt.job_id, mirror.job_id);
  assert.equal(receipt.executor_device_id, mirror.executor_device_id);
  assert.equal(intent.receipt.job_id, mirror.job_id);
  assert.equal(intent.request.requirements.prefer_device_id, null, 'not automatic placement');
  assert.equal(intent.request.workspace_revision, revision);
  assert.equal(intent.request.workspace_repository, repository);
  assert(intent.request.task.includes(marker));
  const result = JSON.parse(mirror.result);
  assert.equal(result.job_id, mirror.job_id);
  assert.equal(result.device_id, mirror.executor_device_id);
  assert.equal(result.profile, profile);
  assert.equal(result.repository, repository);
  assert.equal(result.revision, revision);
  assert(['pro', 'air'].includes(result.node_role));
  // Since build 438 a fleet job's answer is OpenClaw Core's own result (the
  // "core" block): completed (task_verified) or returned_unverified, with the
  // App's label. Core is the authority; its model steps are execution_only.
  const core = result.core;
  if (core) {
    assert(['completed', 'returned_unverified'].includes(core.state), 'Core result is not a delivered answer');
    const completed = core.state === 'completed';
    assert.equal(result.run.status, completed ? 'complete' : 'returned_unverified', 'run status disagrees with Core');
    assert.equal(core.task_verified, completed, 'Core verification relabelled');
    assert.equal(core.verification, completed ? 'task_verified' : 'unverified');
    if (!completed) { assert.equal(core.label, unverifiedLabel, 'unverified Core answer lost its label'); assert.equal(core.parity_state, 'unverified'); }
    assert.equal(core.task_id.toLowerCase(), mirror.job_id.toLowerCase(), 'Core task is not this job');
    assert.equal(core.partial_coverage, undefined, 'a partial result was delivered as an answer');
    assert.equal(core.output_truncated, false, 'proof answers must be complete');
    assert.equal(hash(core.output), core.output_sha256, 'Core answer digest mismatch');
    assert(!('rccRuntime' in result.run) && !('agentTask' in result.run), 'receipt carries the Core snapshot');
    // R6: Core's disclosed checks (failed check IDs, an unavailable checker)
    // ride beside the label on an unverified answer only.
    if (core.quality_disclosure !== undefined) {
      assert(!completed, 'a completed Core answer carries a quality disclosure');
      assert(typeof core.quality_disclosure.text === 'string' && core.quality_disclosure.text.length > 0, 'quality disclosure lost its text');
      assert(Array.isArray(core.quality_disclosure.failed_check_ids) && core.quality_disclosure.failed_check_ids.length <= 8, 'quality disclosure names too many checks');
    }
  } else {
    assert.equal(result.run.status, 'complete');
  }
  assert.equal(result.run.steps.length, 1, 'extra executor attempts require reconciliation');
  const step = result.run.steps[0];
  assert.equal(step.provider, profile);
  assert.equal(step.exit_code, 0);
  assert.equal(step.permission_profile, 'read_only');
  if (!core) assert.equal(step.revas_disposition, 'adopted');
  assert.equal(step.native_record.persistence, 'verified');
  assert(/^[a-f0-9-]{36}$/i.test(step.session_id));
  assert.equal(typeof expected.release_id,'string','source release_id is required');
  const answer = core ? core.output : step.output;
  for (const text of [marker, expected.release_id, expected.objective_version]) assert(answer.includes(text));
  assert(!result.result_branch && !result.result_commit, 'read-only job published changes');
  return {provider:profile, job_id:mirror.job_id, executor_device_id:mirror.executor_device_id,
    executor_role:result.node_role, automatic:true, preferred_device:null,
    permission:step.permission_profile, native_session_id:step.session_id,
    result_sha256:mirror.result_hash, executor_duration_ms:step.duration_ms, status:'PASS'};
}

function selfTest() {
  const sourceManifest=json(new URL('../../os1-exo-monitor/manifest.json',import.meta.url));
  assert.equal(typeof sourceManifest.release_id,'string');
  assert.equal(sourceManifest.objective_version,objective);
  const marker = 'FIXTURE', revision = 'a'.repeat(40), expected = {release_id:'release', objective_version:objective};
  const result = {job_id:randomUUID(), device_id:'device:test', profile:'codex', repository, revision,
    node_role:'pro', run:{status:'complete', steps:[{provider:'codex', exit_code:0, permission_profile:'read_only',
      revas_disposition:'adopted', native_record:{persistence:'verified'}, session_id:randomUUID(),
      output:`${marker} release ${objective}`, duration_ms:1}]}};
  const body = JSON.stringify(result);
  const input = {marker, profile:'codex', revision, expected,
    mirror:{state:'complete', result:body, result_hash:hash(body), job_id:result.job_id,
      profile:'codex', executor_device_id:result.device_id, objective_version:objective},
    receipt:{job_id:result.job_id, executor_device_id:result.device_id},
    intent:{receipt:{job_id:result.job_id},request:{requirements:{prefer_device_id:null},
      workspace_repository:repository, workspace_revision:revision, task:marker}}};
  verifyReceipt(input);
  const changes = [
    value => value.mirror.state = 'failed',
    value => value.mirror.result_hash = '0'.repeat(64),
    value => value.intent.request.requirements.prefer_device_id = 'device:test',
    value => value.intent.request.workspace_revision = 'b'.repeat(40),
    value => value.receipt.executor_device_id = 'device:unrelated',
    value => { delete value.expected.release_id; },
    value => { const r = JSON.parse(value.mirror.result); r.run.steps[0].permission_profile = 'workspace_write'; value.mirror.result=JSON.stringify(r);value.mirror.result_hash=hash(value.mirror.result); },
    value => { const r = JSON.parse(value.mirror.result); r.run.steps.push(r.run.steps[0]); value.mirror.result=JSON.stringify(r);value.mirror.result_hash=hash(value.mirror.result); },
  ];
  for (const change of changes) { const bad = structuredClone(input); change(bad); assert.throws(() => verifyReceipt(bad)); }
  // A Core receipt (build 438): Core's answer, labelled unverified, passes;
  // any relabelling, digest mismatch or legacy-only shape does not.
  const coreOutput = `${marker} release ${objective}`;
  const coreResult = {...structuredClone(result), run:{status:'returned_unverified', steps:[{...result.run.steps[0],
      revas_disposition:'execution_only', output:coreOutput}]},
    core:{task_id:result.job_id, request_sha256:'c'.repeat(64), state:'returned_unverified', revision:7,
      verification:'unverified', label:unverifiedLabel, error:'no_registered_exact_task_verifier', output:coreOutput,
      output_sha256:hash(coreOutput), output_bytes:Buffer.byteLength(coreOutput), output_truncated:false,
      parity_state:'unverified', task_quality:'execution_only', execution_verified:true, task_verified:false}};
  const coreBody = JSON.stringify(coreResult);
  const coreInput = {...structuredClone(input), mirror:{...input.mirror, result:coreBody, result_hash:hash(coreBody)}};
  verifyReceipt(coreInput);
  const disclosed = JSON.parse(coreBody);
  disclosed.core.quality_disclosure = {failed_check_ids:['node_verifier'], failed_check_count:1, checker_unavailable:false,
    text:'Core-reported failed checks: node_verifier'};
  const disclosedBody = JSON.stringify(disclosed);
  verifyReceipt({...structuredClone(coreInput), mirror:{...coreInput.mirror, result:disclosedBody, result_hash:hash(disclosedBody)}});
  const coreChanges = [
    r => { r.run.status = 'complete'; },
    r => { r.core.task_verified = true; },
    r => { r.core.verification = 'task_verified'; },
    r => { r.core.label = 'OpenClaw core state: completed'; },
    r => { r.core.output += ' tampered'; },
    r => { r.core.partial_coverage = 'Partial result · completed 1/2 · unresolved: node_1'; },
    r => { r.run.rccRuntime = {state:'returned_unverified'}; },
    r => { r.core.output_truncated = true; },
    r => { delete r.core; },
    r => { r.core.quality_disclosure = {failed_check_ids:[], failed_check_count:0, checker_unavailable:true, text:''}; },
    r => { r.run.status = 'complete'; r.core.state = 'completed'; r.core.task_verified = true; r.core.verification = 'task_verified';
           r.core.label = 'OpenClaw core state: completed'; r.core.quality_disclosure = {failed_check_ids:[], failed_check_count:0,
           checker_unavailable:true, text:'Checker unavailable · not itself a failed-check verdict'}; },
  ];
  for (const change of coreChanges) {
    const bad = structuredClone(coreInput), r = JSON.parse(bad.mirror.result);
    change(r); bad.mirror.result = JSON.stringify(r); bad.mirror.result_hash = hash(bad.mirror.result);
    assert.throws(() => verifyReceipt(bad));
  }
  console.log(JSON.stringify({status:'PASS', checks:changes.length+coreChanges.length+4, model_calls:0}));
}

async function run() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') return selfTest();
  if (args.length === 2 && args[0] === '--verify-existing') return verifyExisting(args[1]);
  assert(args.length === 5 && args[0] === '--run' && args[1] === '--role' && args[3] === '--revision',
    'Usage: --self-test OR --run --role pro|air --revision EXACT_PUBLISHED_SHA');
  const role = args[2], revision = args[4];
  assert(['pro','air'].includes(role)); assert(/^[0-9a-f]{40}$/.test(revision));
  const home = homedir(), os1 = join(home,'.local/bin/os1');
  // Read this one non-secret identifier; never enumerate or copy device keys.
  const deviceID = readFileSync(join(home,'Library/Application Support/OS-1/device/device-id'),'utf8').trim();
  assert(/^device:[0-9a-f-]{36}$/i.test(deviceID));
  const snapshot=JSON.parse(command(os1,['fleet-snapshot']));
  const localNode=snapshot.nodes.find(node=>node.device_id===deviceID);
  assert(localNode && localNode.role===role,'foreground role must match the registered device');
  assert(Date.now()-localNode.last_seen_ms<30_000,'foreground Fleet heartbeat is stale');
  const cache = join(home,'Library/Caches/com.omaragi.os1/fleet-hook-submissions');
  const submissions = join(home,'.os1/fleet/submissions'), mirrors = join(home,'.os1/fleet/results');
  assert(existsSync(os1) && existsSync(cache));
  const evidence = mkdtempSync(join(tmpdir(),'os1-native-fleet-proof-'));
  chmodSync(evidence, 0o700);
  const workspace = join(evidence,'repository');
  const started = Date.now();
  const report = {schema:1, objective_version:objective, foreground_role:role,
    started_at:new Date(started).toISOString(), source_revision:revision, evidence_directory:evidence,
    foreground_device_id:deviceID, foreground_ip:localNode.zerotier_ip,
    installed_os1:command(os1,['version']), installed_os1_sha256:hash(readFileSync(os1)),
    status:'NOT_MET', checks:[], runtime_or_hooks_changed:false, universal_resource_pooling:false,
    scope:'Two standalone read-only native CLI prompts on a clean published GitHub revision; not every native task or UI'};
  console.log(JSON.stringify({phase:'started',evidence,role,revision}));
  try {
    // Clone only the already-authorized non-secret source, not a session/auth cache.
    command('gh',['repo','clone',repository,workspace,'--','--filter=blob:none'],{timeout:120_000});
    command('git',['-C',workspace,'fetch','origin',revision],{timeout:120_000});
    command('git',['-C',workspace,'checkout','--detach',revision]);
    assert.equal(command('git',['-C',workspace,'status','--porcelain']),'');
    const expected = json(join(workspace,'products/os1-exo-monitor/manifest.json'));
    assert.equal(expected.objective_version,objective);
    const before = new Set(readdirSync(cache));
    const env = {...process.env};
    // Only this explicitly requested test foreground is unmarked. Its remote
    // executors retain normal recursion prevention; no installed setting changes.
    delete env.OS1_INTERNAL_PROVIDER_EXECUTION;
    const probes = await Promise.all(['codex','claude'].map(async profile => {
      const marker = `OS1_NATIVE_${role.toUpperCase()}_${profile.toUpperCase()}_${randomUUID()}`;
      const prompt = `Read products/os1-exo-monitor/manifest.json and report its release_id and objective_version fields. Do not change files, services, repository refs, or settings. Include the verification label ${marker} in the final answer.`;
      const binary = profile === 'claude' ? join(home,'.local/bin/claude') : [
        '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
        '/Applications/ChatGPT.app/Contents/Resources/codex',
        '/Applications/Codex.app/Contents/Resources/codex',
        join(home,'.local/bin/codex'),
      ].find(existsSync);
      assert(binary && existsSync(binary), `${profile} native executable missing`);
      const argv = profile === 'codex' ? ['exec','--sandbox','read-only','--json','-C',workspace,prompt] : [
        '-p',prompt,'--output-format','stream-json','--verbose','--permission-mode','dontAsk',
        '--tools','Read,Bash','--allowedTools','Read',`Bash(${os1} fleet-result *)`,`Bash('${os1}' fleet-result *)`,
      ];
      const launched = Date.now(), child = spawn(binary,argv,{cwd:workspace,env,stdio:['ignore','pipe','pipe']});
      let output='',errors='',timedOut=false;
      child.stdout.on('data', chunk => {output+=chunk;});
      child.stderr.on('data', chunk => {errors+=chunk;});
      const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},300_000);
      const termination=await new Promise(resolve=>{
        child.once('error',error=>resolve({error:String(error)}));
        child.once('close',(code,signal)=>resolve({code,signal}));
      });
      clearTimeout(timer);
      writeFileSync(join(evidence,profile+'.jsonl'),output,{flag:'wx',mode:0o600});
      writeFileSync(join(evidence,profile+'.stderr'),errors,{flag:'wx',mode:0o600});
      const events=output.split('\n').flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}});
      const final=profile==='claude'?events.findLast(e=>e.type==='result'):null;
      const passed=profile==='codex' ? events.some(e=>e.type==='turn.completed') && events.some(e=>e.item?.type==='agent_message'&&e.item.text?.includes(marker))
        : final?.is_error===false && final?.result?.includes(marker);
      const probe={profile,marker,...termination,timed_out:timedOut,native_terminal:!!passed,
        duration_ms:Date.now()-launched,events_sha256:hash(output)};
      save(join(evidence,profile+'-probe.json'),probe);
      console.log(JSON.stringify({phase:'native_terminal',provider:profile,code:probe.code,timed_out:timedOut,passed:!!passed}));
      return probe;
    }));
    const fresh=readdirSync(cache).filter(name=>name.endsWith('.json')&&!before.has(name));
    for (const probe of probes) {
      assert.equal(probe.code,0); assert.equal(probe.timed_out,false); assert.equal(probe.native_terminal,true);
      const matches=fresh.flatMap(name=>{
        if (!/^[a-f0-9]{64}\.json$/.test(name)) return [];
        const receipt=json(join(cache,name));
        if (!/^[a-f0-9-]{36}$/i.test(receipt.job_id ?? '')) return [];
        const path=join(mirrors,receipt.job_id+'.json');
        if (!existsSync(path)) return [];
        const mirror=json(path);
        return mirror.profile===probe.profile&&mirror.result?.includes(probe.marker)?[{name,receipt,mirror}]:[];
      });
      assert.equal(matches.length,1,'exactly one fresh hook result is required');
      const {name,receipt,mirror}=matches[0];
      const intent=json(join(submissions,name));
      const check=verifyReceipt({receipt,mirror,intent,marker:probe.marker,profile:probe.profile,revision,expected});
      const returned=command(os1,['fleet-result','--job',mirror.job_id,'--timeout-seconds','5']);
      assert.equal(hash(returned),mirror.result_hash);
      report.checks.push({...check,foreground_duration_ms:probe.duration_ms});
    }
    assert.equal(command('git',['-C',workspace,'status','--porcelain']),'');
    assert.equal(hash(readFileSync(os1)),report.installed_os1_sha256,'runtime changed during proof');
    report.status='PASS'; report.fixture_unchanged=true;
  } catch(error) {
    report.error=String(error).slice(0,1600);
    process.exitCode=1;
  } finally {
    report.finished_at=new Date().toISOString(); report.duration_ms=Date.now()-started;
    save(join(evidence,'acceptance.json'),report);
    // Compact non-secret result only. Native transcripts stay on their device.
    console.log(JSON.stringify(report));
  }
}

// Repairs verification-only defects without another native/model invocation.
function verifyExisting(directory) {
  assert(directory.startsWith(tmpdir()+'os1-native-fleet-proof-') || directory.startsWith(join(tmpdir(),'os1-native-fleet-proof-')));
  assert(!directory.slice(directory.indexOf('os1-native-fleet-proof-')).includes('/'));
  const original=json(join(directory,'acceptance.json'));
  assert.equal(original.objective_version,objective);
  const home=homedir(),os1=join(home,'.local/bin/os1'),cache=join(home,'Library/Caches/com.omaragi.os1/fleet-hook-submissions');
  assert.equal(hash(readFileSync(os1)),original.installed_os1_sha256);
  const deviceID=readFileSync(join(home,'Library/Application Support/OS-1/device/device-id'),'utf8').trim();
  const args=JSON.parse(command('/usr/bin/plutil',['-extract','ProgramArguments','json','-o','-',join(home,'Library/LaunchAgents/com.os1.fleet-agent.plist')]));
  assert(args.includes('--role') && args[args.indexOf('--role')+1]===original.foreground_role);
  const expected=json(join(directory,'repository/products/os1-exo-monitor/manifest.json'));
  const checks=[];
  for (const profile of ['codex','claude']) {
    const probe=json(join(directory,profile+'-probe.json'));
    assert.equal(probe.code,0);assert.equal(probe.timed_out,false);assert.equal(probe.native_terminal,true);
    const raw=readFileSync(join(directory,profile+'.jsonl'),'utf8');
    assert.equal(hash(raw),probe.events_sha256);
    const events=raw.split('\n').flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}});
    if(profile==='codex') {
      assert(events.some(e=>e.type==='turn.completed'));
      assert(events.some(e=>e.item?.type==='agent_message'&&e.item.text?.includes(probe.marker)));
    } else {
      const final=events.findLast(e=>e.type==='result');assert(final?.is_error===false&&final.result.includes(probe.marker));
    }
    const matches=readdirSync(cache).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).flatMap(name=>{
      const receipt=json(join(cache,name));
      if (!/^[a-f0-9-]{36}$/i.test(receipt.job_id ?? '')) return [];
      const path=join(home,'.os1/fleet/results',receipt.job_id+'.json');if(!existsSync(path))return[];
      const mirror=json(path);return mirror.profile===profile&&mirror.result?.includes(probe.marker)?[{name,receipt,mirror}]:[];
    });
    assert.equal(matches.length,1);
    const {name,receipt,mirror}=matches[0],intent=json(join(home,'.os1/fleet/submissions',name));
    assert.equal(intent.deviceID ?? intent.device_id,deviceID);
    assert(intent.request.submitted_at_ms>=Date.parse(original.started_at)&&intent.request.submitted_at_ms<=Date.parse(original.finished_at));
    checks.push({...verifyReceipt({receipt,mirror,intent,marker:probe.marker,profile,revision:original.source_revision,expected}),foreground_duration_ms:probe.duration_ms});
  }
  assert.equal(command('git',['-C',join(directory,'repository'),'status','--porcelain']),'');
  const report={...original,status:'PASS',error:undefined,checks,foreground_device_id:deviceID,
    fixture_unchanged:true,verification_only:true,additional_model_calls:0,
    corrected_verifier_source_sha256:hash(readFileSync(new URL(import.meta.url))),
    verified_at:new Date().toISOString(),original_acceptance_sha256:hash(readFileSync(join(directory,'acceptance.json')))};
  save(join(directory,'acceptance-reverified.json'),report);
  console.log(JSON.stringify(report));
}

await run();
