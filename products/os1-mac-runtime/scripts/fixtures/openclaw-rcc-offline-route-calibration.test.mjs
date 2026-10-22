// All positive fitting records below are labelled SYNTHETIC source-contract
// regressions, never real model performance, actual calibration or live proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,linkSync,rmSync,realpathSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {syntheticInput} from './offline-route-calibration.synthetic.mjs';
import {produceOfflineRouteCalibration as produce,verifyOfflineRouteCalibrationArtifact as verify,offlineCalibrationData,OFFLINE_CALIBRATION_LIMITS} from '../../Resources/openclaw-os1-bridge/offline-route-calibration.mjs';
import {digest,stableJSON} from '../../Resources/openclaw-os1-bridge/joint-route-selector.mjs';
import {parseOfflineJSON,readPinnedOfflineJSON,inspectOfflineCalibrationSource,main} from '../offline-route-calibration.mjs';
const off=r=>{assert.equal(r.execution_authorized,false);assert.equal(r.live_route_change_authorized,false);
  assert.equal(r.quality_certificate,false);assert.equal(r.calibration_validated,false);assert.equal(r.holdout_accepted,false);assert.equal(r.model_calls,0);};
const bad=(x,code)=>{const r=produce(x);assert.equal(r.status,'insufficient_evidence');if(code)assert(r.blockers.includes(code),JSON.stringify(r));off(r);return r;};
function hash(bytes){return createHash('sha256').update(bytes).digest('hex');}
function reassign(x){x.assignment.policy_sha256=digest(x.policy);}
function source(x,value){const utf8=stableJSON(value),sha256=hash(utf8);x.sources.push({utf8,sha256});return sha256;}
function bindAssignmentSource(x){const {source_sha256,...body}=x.assignment;x.assignment.source_sha256=source(x,body);}
function rebindRun(x,index){
  const e=x.evidence[index],old=e.run_card_sha256,next=digest(e.run_card);e.run_card_sha256=next;
  for(const row of e.results){const l=row.final_lock;l.final_lock_sha256=digest({run_card_sha256:next,case_id:row.case_id,
    choice:l.choice,adoption_reason:l.adoption_reason,chosen_outcome_id:l.chosen_outcome_id,
    chosen_artifact_sha256:l.chosen_artifact_sha256,locked_at_ms:l.locked_at_ms});row.grade.final_lock_sha256=l.final_lock_sha256;}
  for(const m of x.assignment.members)if(m.run_card_sha256===old)m.run_card_sha256=next;
  for(const p of x.samples)if(p.run_card_sha256===old)p.run_card_sha256=next;
  bindAssignmentSource(x);
}
test('synthetic MLE is actually derived; held-separate calibration returns exact statistics, never a certificate',()=>{
  const x=syntheticInput();const before=JSON.stringify(x),r=produce(x);assert.equal(r.status,'synthetic_fit_assessed_not_efficacy');
  assert.deepEqual(r.counts,{source_cases:12,train:6,calibration:6,reserved_heldout:0});assert.equal(JSON.stringify(x),before);
  assert.equal(r.fit.cells.length,1);const c=r.fit.cells[0];assert.deepEqual(c.fitted_bernoulli_mle,{match:1,success:1});
  assert.equal(c.calibration_assessment.match.brier_score,0);assert.equal(c.calibration_assessment.match.bias,0);
  const lower=1-Math.sqrt(Math.log(2/.05)/12);assert(Math.abs(c.calibration_assessment.match.one_sided_lower_bound-lower)<1e-12);
  assert.equal(c.resource_model.train_reference_mean,106);assert.equal(c.resource_model.train_routed_mean,26);
  assert.equal(c.resource_model.quota,null);assert.equal(r.fit.training_cases[0].original_split,'development');
  assert.equal(r.fit.training_cases[0].proof_mode,'internal_dev');assert.equal(r.artifact_sha256,digest(r.fit));off(r);off(r.fit);
  assert.equal(verify(r.fit,x).status,'recomputed_exact_offline_artifact');
});
test('fit stage cannot see calibration; model lock is exact and precedes calibration collection',()=>{
  const x=syntheticInput();x.operation='fit';bad(x,'oc_fit_must_not_see_calibration');
  const missing=syntheticInput();missing.fit_lock=null;bad(missing,'oc_training_fit_lock_absent_or_mismatched');
  const changed=syntheticInput();changed.fit_lock.training_model_sha256='f'.repeat(64);bad(changed,'oc_training_fit_lock_absent_or_mismatched');
});
test('changing calibration outcomes changes assessment, not frozen training MLE identity',()=>{
  const a=produce(syntheticInput()),b=produce(syntheticInput({calSuccess:false}));
  assert.equal(a.training_model_sha256,b.training_model_sha256);
  assert.equal(b.fit.cells[0].calibration_assessment.success.observed_fraction,0);
  assert.equal(b.fit.cells[0].calibration_both_wrong,6);
  assert.equal(b.fit.cells[0].calibration_assessment.match.observed_fraction,1);
});
test('strict preregistered thresholds produce negative assessment; no optimistic smoothing or hidden threshold default',()=>{
  const x=syntheticInput();x.policy.maximum_absolute_bias=.9;reassign(x);
  // Policy change also invalidates the externally frozen fitted artifact.
  bad(x,'oc_assignment_source_binding_mismatch');
  const capacity=produce(syntheticInput({policyOverrides:{minimum_task_success_lower_bound:.99}}));
  assert.equal(capacity.status,'unsupported_policy_capacity');assert(capacity.blockers.includes('oc_policy_exceeds_supported_capacity'));
  const absent=syntheticInput();absent.policy=null;bad(absent,'oc_preregistered_policy_absent');
  const missing=syntheticInput();delete missing.policy.familywise_alpha;bad(missing,'oc_policy_missing_or_invalid');
});
test('missing rights, raw sources, labels, tasks, exact tuple and corrupt source bytes fail closed',()=>{
  for(const change of [
    x=>{x.sources.pop();},x=>{x.sources[0].utf8+='corrupt';},x=>{x.samples[0].projection.task.id='other-task';},
    x=>{x.samples[0].native_harness.routed.config_sha256='f'.repeat(64);},
    x=>{x.samples[0].actual_task_evidence_sha256='f'.repeat(64);},x=>{x.evidence[0].results[0].grade.host_validated=false;},
    x=>{x.evidence[0].results[0].grade.reference_match=null;},
  ]){const x=syntheticInput();change(x);bad(x);}
});
test('unknown resources and host retries cannot become parent-only or zero-cost savings',()=>{
  const unknown=syntheticInput();unknown.samples[0].resource.routed.overheads.routing_tokens=null;bad(unknown,'oc_resource_unknown_or_scope_unsupported');
  const retry=syntheticInput();retry.samples[0].resource.routed.host_retry_count=1;bad(retry,'oc_resource_unknown_or_scope_unsupported');
  const duplicate=syntheticInput();duplicate.samples[0].resource.routed.native_tokens+=1;bad(duplicate,'oc_resource_unknown_or_scope_unsupported');
});
test('schema, getters, future/stale policies, assignment overlap and preoutcome mismatch are rejected',()=>{
  for(const change of [x=>{x.extra=true;},x=>{x.now_ms=999999;},x=>{x.assignment.members[0].role='calibration';},
    x=>{x.samples[0].projection.features.context_tokens++;},x=>{x.samples[0].captured_at_ms=999999;},
    x=>{x.samples[0].regime.environment_sha256='f'.repeat(64);},
  ]){const x=syntheticInput();change(x);bad(x);}
  const x=syntheticInput();let invoked=false;Object.defineProperty(x,'sources',{get(){invoked=true;return [];}});bad(x);assert.equal(invoked,false);
});
test('offline artifact verification recomputes sources and rejects altered fitted statistics/authorization flags',()=>{
  const x=syntheticInput(),r=produce(x),a=structuredClone(r.fit);a.cells[0].fitted_bernoulli_mle.success=.8;
  assert.equal(verify(a,x).status,'quarantined');const f=structuredClone(r.fit);f.quality_certificate=true;
  assert.equal(verify(f,x).status,'quarantined');
});
test('pinned JSON loader blocks duplicate keys, wrong hashes, executable files, symbolic/hard links',()=>{
  assert.throws(()=>parseOfflineJSON('{"a":1,"a":2}'),/duplicate/);assert.throws(()=>parseOfflineJSON('{"a":NaN}'));
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'os1-offline-calibration-')));
  try{const file=join(dir,'input.json'),raw='{"a":1}';writeFileSync(file,raw,{mode:0o600});
    assert.equal(readPinnedOfflineJSON(file,hash(raw)).value.a,1);
    assert.throws(()=>readPinnedOfflineJSON(file,'f'.repeat(64)),/hash_mismatch/);
    const alias=join(dir,'alias.json');symlinkSync(file,alias);assert.throws(()=>readPinnedOfflineJSON(alias,hash(raw)));
    const hard=join(dir,'hard.json');linkSync(file,hard);assert.throws(()=>readPinnedOfflineJSON(file,hash(raw)));rmSync(hard);
    chmodSync(file,0o700);assert.throws(()=>readPinnedOfflineJSON(file,hash(raw)));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('legacy/current DEV source inspection reports actual missing evidence and never fits, even with optimistic labels',()=>{
  const x={proof_mode:'internal_dev',rows:[{case_id:'A',learnable_reference_match_label:null},{case_id:'A',learnable_reference_match_label:null}]};
  const r=inspectOfflineCalibrationSource(x);assert.equal(r.observed_rows,2);assert.deepEqual(r.observed_unique_case_ids,['A']);
  assert.equal(r.training_executed,false);assert.equal(r.training_model,null);assert.equal(r.status,'insufficient_evidence');
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'os1-offline-cli-')));
  try{const path=join(dir,'legacy.json'),out=join(dir,'report.json'),raw=JSON.stringify(x);writeFileSync(path,raw,{mode:0o600});
    assert.equal(main(['inspect',path,hash(raw),out]),2);assert.throws(()=>main(['inspect',path,hash(raw),out]),/EEXIST/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('baseline-correct routed-wrong accepted_B is preserved and fails preregistered floor, unlike both-wrong match',()=>{
  const r=bad(syntheticInput({calSuccess:false,calReferenceSuccess:true,calMatch:false}),'oc_accepted_B_exceeds_policy');
  assert.equal(r.fit.cells[0].calibration_accepted_B,6);assert.equal(r.fit.cells[0].calibration_both_wrong,0);
});
test('calibration proof-label upgrade and labelled heldout use are not accepted by P7',()=>{
  const x=syntheticInput();x.evidence[1].run_card.proof_mode='clean_public_proof';bad(x,'oc_run_card_metadata_invalid');
  const h=syntheticInput();h.assignment.members[0].role='heldout';bad(h,'oc_heldout_labels_forbidden');
});

test('heterogeneous training labels fit the Bernoulli MLE rather than copying supplied predictions',()=>{
  const r=produce(syntheticInput({trainSuccess:[true,false,true,false,true,false]}));
  assert.deepEqual(r.fit.cells[0].fitted_bernoulli_mle,{match:.5,success:.5});
  assert.equal(r.fit.cells[0].calibration_assessment.success.bias,.5);
  assert.equal(r.fit.cells[0].calibration_assessment.success.brier_score,.25);
});

test('source-bound rights and disjoint split audit fail even after internally consistent rehashing',()=>{
  const rights=syntheticInput();rights.evidence[0].run_card.rights={status:'unknown',evidence_sha256:null};rebindRun(rights,0);
  bad(rights,'oc_join_rights_not_cleared');
  const overlap=syntheticInput();overlap.evidence[1].run_card.case_manifest[0].template_sha256=overlap.evidence[0].run_card.case_manifest[0].template_sha256;
  rebindRun(overlap,1);bad(overlap,'oc_cross_role_lineage_overlap');
  const timing=syntheticInput();timing.evidence[1].run_card.frozen_at_ms=1400;
  timing.samples.filter(s=>s.run_card_sha256===timing.evidence[1].run_card_sha256).forEach(s=>{s.captured_at_ms=1300;s.feature_evidence_sha256=source(timing,{schema:1,kind:'offline_preoutcome_feature_capture_v1',captured_at_ms:1300,projection:s.projection});});
  rebindRun(timing,1);bad(timing,'oc_fit_lock_after_calibration_collection');
});

test('independent reference-match and task-success labels cannot contradict one another',()=>{
  const x=syntheticInput();x.evidence[1].results[0].grade.routed_task_success=false;
  x.evidence[1].results[0].grade.final_task_success=false;
  bad(x,'oc_join_reference_match_conflicts_with_task_success');
});

test('malformed source JSON never echoes input snippets or private text through parser/CLI errors',()=>{
  const marker='SYNTHETIC_PRIVATE_MARKER_DO_NOT_ECHO', raw='{"x":"'+marker+'\n"}';
  assert.throws(()=>parseOfflineJSON(raw),e=>e.code==='oc_json_invalid'&&!e.message.includes(marker));
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'os1-offline-privacy-')));
  try{const input=join(dir,'input.json');writeFileSync(input,raw,{mode:0o600});
    const cli=fileURLToPath(new URL('../offline-route-calibration.mjs',import.meta.url));
    const r=spawnSync(process.execPath,[cli,'inspect',input,hash(raw),join(dir,'out.json')],{encoding:'utf8'});
    assert.equal(r.status,1);assert.equal(r.stdout,'');assert.equal(r.stderr,'oc_json_invalid\n');assert(!r.stderr.includes(marker));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

function noOraclePreview(r){
  assert.equal(r.fit,null);assert.equal(r.training_model,null);assert.equal(r.training_model_sha256,null);assert.equal(r.artifact_sha256,null);
  assert.deepEqual(r.joined_runs,[]);assert.deepEqual(r.source_manifest,[]);assert.equal(r.capacity,null);
  assert.deepEqual(r.counts,{source_cases:0,train:0,calibration:0,reserved_heldout:0});
}
function exceptInputHash(r){const {input_sha256,...rest}=r;return rest;}
test('forbidden fit/calibration sheets are rejected before label join with no outcome oracle preview',()=>{
  const x=syntheticInput();x.operation='fit';const y=structuredClone(x);
  y.evidence[1].results.forEach(row=>{row.grade.reference_task_success=false;row.grade.routed_task_success=false;
    row.grade.reference_match=false;row.grade.final_task_success=false;});
  const a=bad(x,'oc_fit_must_not_see_calibration'),b=bad(y,'oc_fit_must_not_see_calibration');
  noOraclePreview(a);noOraclePreview(b);assert.notEqual(a.input_sha256,b.input_sha256);assert.deepEqual(exceptInputHash(a),exceptInputHash(b));
});
test('forbidden heldout assignments are rejected before any label parsing or grade-derived counters',()=>{
  const x=syntheticInput();x.assignment.members[0].role='heldout';const y=structuredClone(x);
  y.evidence[0].results[0].grade='UNPARSED_FORBIDDEN_LABEL_PAYLOAD';
  const a=bad(x,'oc_heldout_labels_forbidden'),b=bad(y,'oc_heldout_labels_forbidden');
  noOraclePreview(a);noOraclePreview(b);assert.deepEqual(exceptInputHash(a),exceptInputHash(b));
});
test('calibration provenance is not model-fitting participation and remains label-independent in frozen model',()=>{
  const r=produce(syntheticInput());assert(r.fit.training_cases.every(c=>c.used_for_fit===true));
  assert(r.fit.calibration_cases.every(c=>c.used_for_fit===false));
});
test('old1050 calibration settlement before1900 capture/2000 card/2040 execution end is rejected',()=>{
  const r=bad(syntheticInput({invalidCalibrationSettlement:true}),'oc_execution_or_observation_chronology');assert.equal(r.fit,null);
  const missing=syntheticInput();delete missing.samples[0].execution_windows;bad(missing,'oc_actual_task_feature_or_source_review_missing');
});
test('source-bound native execution windows reject swapped identities and inconsistent chronology',()=>{
  for(const change of [
    x=>{x.samples[0].execution_windows.reference.attempt_id='00000000-0000-0000-0000-000000009999';},
    x=>{const w=x.samples[0].execution_windows.reference;w.started_at_ms=800;const {source_sha256,...b}=w;w.source_sha256=source(x,b);},
    x=>{const w=x.samples[0].execution_windows.reference;w.ended_at_ms=1200;const {source_sha256,...b}=w;w.source_sha256=source(x,b);},
    x=>{x.samples[0].execution_windows.reference.clock_basis='notification_timestamp';},
  ]){const x=syntheticInput();change(x);bad(x);}
});
test('coherent offline capacity supports60cases and262144byte source without changing production budgets',()=>{
  const x=syntheticInput({n:30});const text='x'.repeat(OFFLINE_CALIBRATION_LIMITS.source_bytes);
  x.sources.push({sha256:hash(text),utf8:text});const r=produce(x);assert.equal(r.status,'synthetic_fit_assessed_not_efficacy');
  assert.equal(r.counts.source_cases,60);assert.equal(r.counts.calibration,30);
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'os1-offline-capacity-')));
  try{const file=join(dir,'input.json'),raw=JSON.stringify(x),out=join(dir,'report.json');writeFileSync(file,raw,{mode:0o600});
    assert.equal(main(['produce',file,hash(raw),out]),0);
  }finally{rmSync(dir,{recursive:true,force:true});}
  assert.throws(()=>offlineCalibrationData('x'.repeat(OFFLINE_CALIBRATION_LIMITS.source_bytes+1)),e=>e.code==='oc_capacity_string_bytes');
});
test('unsupported95percent lower-bound policy returns exact capacity diagnostic without lowering bounds',()=>{
  const x=syntheticInput({policyOverrides:{minimum_task_success_lower_bound:.95}}),r=produce(x);
  assert.equal(r.status,'unsupported_policy_capacity');assert.deepEqual(r.joined_runs,[]);assert.equal(r.fit,null);
  assert.equal(r.capacity.best_case_required_calibration_cases.success,738);
  assert.equal(r.capacity.maximum_calibration_cases_one_stratum,126);assert.equal(r.policy_sha256,digest(x.policy));
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'os1-offline-policy-capacity-')));
  try{const file=join(dir,'input.json'),raw=JSON.stringify(x);writeFileSync(file,raw,{mode:0o600});
    assert.equal(main(['produce',file,hash(raw),join(dir,'report.json')]),2);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('advertised128 total case ceiling is exercised across four original bounded source cards',()=>{
  const r=produce(syntheticInput({trainCases:32,calibrationCases:96}));
  assert.equal(r.status,'synthetic_fit_assessed_not_efficacy');assert.equal(r.counts.source_cases,128);
  assert.equal(r.counts.train,32);assert.equal(r.counts.calibration,96);assert.equal(r.joined_runs.length,4);
  assert(r.fit.calibration_cases.every(c=>c.used_for_fit===false));
});

test('capacity overflows are named rather than generic bad-data verdicts',()=>{
  const card=syntheticInput({n:33,skipFitLock:true});bad(card,'oc_capacity_cases_per_card');
  const total=syntheticInput({trainCases:32,calibrationCases:97,skipFitLock:true});bad(total,'oc_capacity_cases');
  assert.throws(()=>offlineCalibrationData(Array(OFFLINE_CALIBRATION_LIMITS.array_items+1).fill(0)),e=>e.code==='oc_capacity_array_items');
  assert.throws(()=>parseOfflineJSON('['.repeat(34)+'0'+']'.repeat(34)),e=>e.code==='oc_capacity_json_depth');
});

test('capture after final lock and grade is allowed with a separately sourced earlier execution interval',()=>{
  const x=syntheticInput({calibrationCaptureOffset:120}),r=produce(x);
  assert.equal(r.status,'synthetic_fit_assessed_not_efficacy');
  assert(x.evidence[1].outcome_state.records[0].provenance.observed_at_ms>x.evidence[1].results[0].grade.assessed_at_ms);
});
test('unadopted v1 input and mutated old artifact formats cannot inherit v2 eligibility',()=>{
  const x=syntheticInput();x.kind='os1_offline_calibration_input_v1';bad(x,'oc_input_shape');
  const current=syntheticInput(),r=produce(current),old=structuredClone(r.fit);old.kind='os1_offline_stratum_bernoulli_mle_v1';
  assert.equal(verify(old,current).status,'quarantined');
});

function assertNoCalibrationPreview(r){
  assert.equal(r.fit,null);assert.equal(r.artifact_sha256,null);assert.equal(r.counts.calibration,0);
  assert.deepEqual(r.source_manifest,[]);
  assert(r.joined_runs.every(run=>run.role==='train'));
  for(const run of r.joined_runs) assert.equal(run.original_counts.calibration.cases,0);
  if(r.training_model) assert(r.training_model.training_cases.every(c=>c.role==='train'));
}
function validShapedWrongModelLock(x){
  x.fit_lock.training_model_sha256='f'.repeat(64);
  x.fit_lock.witness_sha256=source(x,{kind:'offline_training_model_lock_v1',training_model_sha256:x.fit_lock.training_model_sha256,
    policy_sha256:digest(x.policy),locked_at_ms:x.fit_lock.locked_at_ms});
}
function alterCalibrationBeforeGate(x){
  // This is deliberately not a valid grade/outcome bundle. Any premature join
  // would fail with a different reason, so equality tests actual phase routing.
  const cal=x.evidence.find(e=>e.run_card.case_manifest.some(c=>c.split==='calibration'));
  cal.results[0].grade='OPAQUE_CALIBRATION_LABEL_BEFORE_ACCEPTED_LOCK';
  cal.outcome_state.records=[];
}
test('missing fit lock rejects before any training/calibration join, independent of calibration labels',()=>{
  const x=syntheticInput({skipFitLock:true}),y=structuredClone(x);alterCalibrationBeforeGate(y);
  const a=bad(x,'oc_training_fit_lock_absent_or_mismatched'),b=bad(y,'oc_training_fit_lock_absent_or_mismatched');
  assert.equal(a.training_model,null);assert.equal(b.training_model,null);
  assert.deepEqual(a.joined_runs,[]);assert.deepEqual(b.joined_runs,[]);
  assert.deepEqual(a.counts,{source_cases:0,train:0,calibration:0,reserved_heldout:0});
  assert.deepEqual(exceptInputHash(a),exceptInputHash(b));assertNoCalibrationPreview(a);assertNoCalibrationPreview(b);
});
test('valid-shaped wrong frozen model hash permits TRAIN-only reconstruction, never calibration join or preview',()=>{
  const x=syntheticInput();validShapedWrongModelLock(x);const y=structuredClone(x);alterCalibrationBeforeGate(y);
  const a=bad(x,'oc_training_fit_lock_absent_or_mismatched'),b=bad(y,'oc_training_fit_lock_absent_or_mismatched');
  assert(a.training_model);assert.equal(a.counts.train,6);assert.equal(a.counts.source_cases,6);
  assert.equal(a.joined_runs.length,1);assert.deepEqual(exceptInputHash(a),exceptInputHash(b));
  assertNoCalibrationPreview(a);assertNoCalibrationPreview(b);
});
test('late frozen model lock rejects on card metadata before all label joins with mutation-invariant rejection',()=>{
  const x=syntheticInput();x.evidence[1].run_card.frozen_at_ms=1400;rebindRun(x,1);
  const y=structuredClone(x);alterCalibrationBeforeGate(y);
  const a=bad(x,'oc_fit_lock_after_calibration_collection'),b=bad(y,'oc_fit_lock_after_calibration_collection');
  assert.equal(a.training_model,null);assert.deepEqual(a.joined_runs,[]);assert.deepEqual(exceptInputHash(a),exceptInputHash(b));
  assertNoCalibrationPreview(a);assertNoCalibrationPreview(b);
});
test('accepted frozen model unlocks calibration only after TRAIN join and exact model identity check',()=>{
  const r=produce(syntheticInput());assert.equal(r.status,'synthetic_fit_assessed_not_efficacy');
  assert.deepEqual(r.joined_runs.map(run=>run.role),['train','calibration']);assert.equal(r.counts.calibration,6);
});

function nativeAlias(x,donorCard,targetCard,donorRow=0,targetRow=1){
  const donor=donorCard.outcome_state.records.find(n=>n.outcome_id===donorCard.results[donorRow].attempts.reference.outcome_id),
    row=targetCard.results[targetRow],n=targetCard.outcome_state.records.find(n=>n.outcome_id===row.attempts.reference.outcome_id);
  n.native=structuredClone(donor.native);n.usage=structuredClone(donor.usage);
  const {normalized_sha256,...body}=n;n.normalized_sha256=digest(body);
  row.attempts.reference.normalized_sha256=n.normalized_sha256;row.attempts.reference.execution_witness_sha256=n.native.record_sha256;
  const sample=x.samples.find(s=>s.run_card_sha256===targetCard.run_card_sha256&&s.case_id===row.case_id),w=sample.execution_windows.reference;
  for(const k of ['execution_id','session_id','turn_id'])w[k]=n.native[k];w.native_record_sha256=n.native.record_sha256;
  {const {source_sha256,...b}=w;w.source_sha256=source(x,b);}
}
test('TRAIN native aliases reject before first grade/count/model rather than inflating n',()=>{
  const x=syntheticInput();nativeAlias(x,x.evidence[0],x.evidence[0]);x.evidence[0].results[0].grade='OPAQUE_TRAIN_GRADE';
  const r=bad(x,'oc_evidence_native_observation_reused');assert.equal(r.training_model,null);assert.deepEqual(r.joined_runs,[]);assert.equal(r.counts.train,0);
});
test('CAL aliases and TRAIN-to-CAL native reuse reject after accepted model lock but before any CAL grade',()=>{
  for(const crossPhase of [false,true]){const x=syntheticInput(),cal=x.evidence[1];nativeAlias(x,crossPhase?x.evidence[0]:cal,cal);
    cal.results[0].grade='OPAQUE_CAL_GRADE';const r=bad(x,crossPhase?'oc_evidence_native_cross_phase_reuse':'oc_evidence_native_observation_reused');
    assert(r.training_model);assert.equal(r.counts.train,6);assertNoCalibrationPreview(r);}
});
test('all CAL cards native identities preflight before a grade in the first card',()=>{
  const x=syntheticInput({trainCases:2,calibrationCases:34}),first=x.evidence[1],last=x.evidence.at(-1);
  nativeAlias(x,first,last,0,0);first.results[0].grade='OPAQUE_FIRST_CAL_GRADE';
  const r=bad(x,'oc_evidence_native_observation_reused');assert.equal(r.counts.train,2);assertNoCalibrationPreview(r);
});
test('unaccepted fit lock never opens CAL native metadata preflight',()=>{
  const x=syntheticInput();nativeAlias(x,x.evidence[0],x.evidence[1]);validShapedWrongModelLock(x);
  x.evidence[1].results[0].grade='OPAQUE_CAL_GRADE';const r=bad(x,'oc_training_fit_lock_absent_or_mismatched');
  assert(r.training_model);assert.equal(r.counts.train,6);assertNoCalibrationPreview(r);
});
