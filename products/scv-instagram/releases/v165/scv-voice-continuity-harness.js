#!/usr/bin/env node
'use strict'
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const source=path.resolve(process.argv[2]||__dirname),root=fs.mkdtempSync(path.join(os.tmpdir(),'scv-voice-continuity-'));
process.env.SCV_ROOT=root;process.env.SCV_PAUSE_ALL='0';process.env.SCV_PAUSE_NON_TEST='0';process.env.SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE='0';
const r=require(path.join(source,'codex-dm-runner.js')),cp=require(path.join(source,'scv-single-control-plane.js'));
const ct=require(path.join(source,'scv-closed-transition-contract.js')),contract=require(path.join(source,'scv-contract-harness.js'));
const recovery=require(path.join(source,'scv-deterministic-recovery.js'));
let checked=0;const failures=[];
function check(name,fn){checked++;try{fn()}catch(e){failures.push({name,error:e.message.slice(0,600)})}}
const history=[{role:'assistant',text:'my highlights have some flashes you can use as inspo and custom ideas are totally open too what kind of piece or vibe were you thinking?'}];
const context={recent_history:history};
for(const [a,b] of [['Do you also do black and grey?','Do you also do black and gray?'],['Can you do colour?','Can you do color?']]) {
  check('orthography consensus: '+a,()=>{const v=r.applyAsrCandidateAdjudication([{model:'primary',text:a},{model:'secondary',text:b}],context);assert.equal(v.ok,true);assert.equal(v.method,'dual_consensus');assert.equal(v.text,a)});
}
for(const [a,b] of [['Do you do black and gray?','Do you not do black and gray?'],['Can we do 3pm?','Can we do 2pm?'],['Is it 150?','Is it 100?'],['Black and gray.','Back in the grade.'],['Send the form','Do not send the form']]) {
  check('semantic disagreement stays gated: '+a,()=>assert.equal(r.applyAsrCandidateAdjudication([{model:'primary',text:a},{model:'secondary',text:b}],context).needs_adjudication,true));
}
check('single survivor still gated',()=>assert.equal(r.applyAsrCandidateAdjudication([{text:'Do you also do black and gray?',model:'primary'}],context).needs_adjudication,true));
for(const prefix of ['', 'sent a voice note saying: ']) {
  const input={message:prefix+'Do you also do black and gray?',live_message:prefix+'Do you also do black and gray?',recent_history:history,structured_state:{tattoo_intent_active:true,booking_stage_hint:'design_intake',...(prefix?{live_turn_is_voice_note:true}: {})}};
  check('style question not design: '+prefix,()=>{assert.equal(contract.liveHasConcreteDesignDirection(input),false);const p=ct.deriveClosedTransitionPlan(input);assert(!['send_form','offer_form'].includes(p.action),JSON.stringify(p));assert.equal(contract.evaluateScvContractHarness(input,{bubbles:[{text:'yeah i do black and gray'},{text:'what are you thinking of getting?'}]}).valid,true)});
}
for(const [index,persisted] of [{tattoo_intent_active:true,booking_stage_hint:'design_intake'},{form_offer_asked:true,known_model_rate_disclosed:true,tattoo_intent_active:true}].entries()) {
  check('authenticated failed voice final recovery commits without state jump '+index,()=>{
    const id='voice-regression-'+index,msg={contact_id:id,thread_id:id,instagram_username:'voice.regression',message_id:'voice-message-'+index,text:'sent a reference post',text_source:'reference_post.message_text',media_urls:['https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=synthetic'],received_at:new Date().toISOString(),...{
      control_force_route_aware_visible_recovery:true,control_route_aware_visible_recovery_version:recovery.ROUTE_AWARE_VISIBLE_RECOVERY_VERSION,control_route_aware_visible_recovery_after_attempts:1,control_route_aware_visible_recovery_reason:'persistent_failure_exhausted',last_error_kind:'persistent_internal_control',control_final_recovery_phase:'precommit_final_recovery',control_final_recovery_version:'scv-inbox-monotonic-final-recovery-2026-08-30-v2'
    }};
    cp.ensureControlDirs(root);fs.writeFileSync(cp.statePath(root,id),JSON.stringify({contact_id:id,thread_id:id,...persisted}));
    cp.recordIngressEvent(root,msg);assert.equal(cp.enrichControlHistoryUserEvent(root,msg,'sent a voice note that could not be understood'),true);
    assert(cp.sourceAuthenticatedEnrichedInboundTurn(root,msg));const out=cp.executeSingleControlTurn(msg,{root});
    assert.match(out.packet.reply_text,/couldn.?t hear.*send it again or type it/i);assert.equal(out.packet.next_action_reflected,'resolve_context');
    assert(!/image|reference|form|\$|deposit/i.test(out.packet.reply_text));assert.notEqual(out.structured_state.form_link_sent,true);assert.notEqual(out.structured_state.deposit_requested,true);
    const receipt=cp.replayCommittedDecision(root,msg);assert(receipt);assert.equal(receipt.packet.reply_text,out.packet.reply_text);
    if(persisted.known_model_rate_disclosed)assert.equal(out.structured_state.known_model_rate_disclosed,true);
  });
}
console.log(JSON.stringify({ok:failures.length===0,checked,passed:checked-failures.length,failures},null,2));
// Only generated isolated test state is removed. No live namespace is used.
fs.rmSync(root,{recursive:true,force:true});if(failures.length)process.exitCode=1;
