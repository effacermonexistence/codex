#!/usr/bin/env python3
"""Exact source-extracted temporal/lease helpers + real TaskQualityEvidence evaluator.
Synthetic source/receipt bindings only; SDK/model/RPC/live registry writes = 0.
"""
from pathlib import Path
import subprocess,tempfile,json,hashlib
R=Path(__file__).resolve().parents[1];s=(R/'Sources/OS1/RCCOwnerCollection.swift').read_text();quality=(R/'Sources/OS1Context/TaskQuality.swift').read_text()
def fragment(start,end):
 a=s.index(start);return s[a:s.index(end,a)]
parts=fragment('    struct AdoptionPermit:','    static func validateAdoptionPermit(')+fragment('    static func historicalEpoch(','    static func retainedCollectionFact(')
assert 'now: Date = Date()'in s[s.index('    static func fact('):s.index('    static func verifySources(')]
assert 'contract.issuedAt <= now, now <= contract.validUntil' in quality
assert 'now: epoch ?? Date()'in s and 'now: childEpoch ?? Date()'in s
assert 'verificationContract' in s and '"observed_at_ms": proofObservedAt' in s
assert 'try validateAdoptionPermit(permit, task: task, prepared: fresh' in s
program=r'''import Foundation
import CryptoKit
public enum TaskContext {public enum Scope:String,Codable,Sendable{case readOnly="read_only",workspaceWrite="workspace_write"}}
enum RCCRuntimeContract {
 static func isHash(_ x:String)->Bool{x.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil}
 static func digest(_ d:Data)->String{SHA256.hash(data:d).map{String(format:"%02x",$0)}.joined()}
 struct Ticket {}
 struct Input {var preparedAtMS:Int64;var valid=true;func validate(ticket:Ticket,record:ExecutionRecord)throws{if !valid{throw Host.Failure.binding}}}
 struct Quality {var witnessSHA256:String}
 struct ExecutionRecord {var configuredInputObservation:Input?;var nodeID:String;var attemptID:String;var operationalQuality:Quality?}
}
enum RCCOperationalQuality {struct StoredWitness {var ticket:RCCRuntimeContract.Ticket;var receipt:TaskQualityEvidence.Receipt?;var contract:TaskQualityEvidence.Contract;var observedArtifact:TaskQualityEvidence.ObservedArtifact}}
enum Host {typealias C=RCCRuntimeContract;enum Failure:Error{case binding,custody,checker}
'''+parts+r'''}
@main enum Test {
 static func main()throws {
 var n=0
 func check(_ v:Bool)throws{guard v else{throw Host.Failure.binding};n+=1}
 func rejects(_ f:()throws->Void)throws{do{try f()}catch{n+=1;return};throw Host.Failure.binding}
 func H(_ s:String)->String{RCCRuntimeContract.digest(Data(s.utf8))}
 let now=Date(timeIntervalSince1970:2_000_000_000),issued=now.addingTimeInterval(-3600),until=now.addingTimeInterval(-1800),observed=now.addingTimeInterval(-3400)
 let original=TaskQualityEvidence.Contract(basis:.declaredTrustedContract,objectiveSHA256:H("objective"),contextSHA256:H("context"),sourceSHA256:nil,startTreeSHA256:H("tree"),scope:.readOnly,verifierCodeSHA256:H("checker"),referencePolicySHA256:H("policy"),requiredCheckIDs:["exact"],fullCoverage:true,referenceProfiles:[],reference:nil,issuedAt:issued,validUntil:until)
 let binding=TaskQualityEvidence.Binding(objectiveSHA256:original.objectiveSHA256,contextSHA256:original.contextSHA256,sourceSHA256:nil,startTreeSHA256:original.startTreeSHA256,scope:.readOnly,executionID:"exec",turnID:"turn",outputSHA256:H("output"),workspaceAfterSHA256:H("tree"),artifactSHA256:H("artifact"))
 let artifact=TaskQualityEvidence.ObservedArtifact(binding:binding,executionVerified:true)
 let receipt=TaskQualityEvidence.Receipt(basis:.observedCheckerReceipt,contractSHA256:original.sha256,binding:binding,checkerIdentitySHA256:original.verifierCodeSHA256,observedReceiptSHA256:H("checker receipt"),checks:[.init(checkID:"exact",status:.passed,score:nil,observedReceiptSHA256:H("observed exact"))],observedAt:observed)
 let w=RCCOperationalQuality.StoredWitness(ticket:.init(),receipt:receipt,contract:original,observedArtifact:artifact)
 let r=RCCRuntimeContract.ExecutionRecord(configuredInputObservation:.init(preparedAtMS:Int64(now.addingTimeInterval(-3500).timeIntervalSince1970*1000)),nodeID:"owner_0",attemptID:"a0",operationalQuality:.init(witnessSHA256:H("witness0")))
 let history:[String:Any]=["app_path":"/private/한글 App.app/Contents/a/b","n":1,"emoji":"🦊"]
 let canonicalHistory=try JSONSerialization.data(withJSONObject:history,options:[.sortedKeys,.withoutEscapingSlashes])
 try check(String(decoding:canonicalHistory,as:UTF8.self).contains("/private/한글 App.app/Contents/a/b"))
 var raw:[String:Any] = ["schema":1,"kind":"retained_owner_collection_adoption_only","permit_id":"recover","task_id":"task","request_sha256":H("request"),"expected_revision":14,"expected_fingerprint":H("fingerprint"),"expected_snapshot_sha256":H("snapshot"),"issued_at_ms":Int64(now.addingTimeInterval(-1).timeIntervalSince1970*1000),"expires_at_ms":Int64(now.addingTimeInterval(60).timeIntervalSince1970*1000),"parent_contract_sha256":original.sha256,"parent_checker_sha256":original.verifierCodeSHA256,"context_sha256":original.contextSHA256,"start_tree_sha256":original.startTreeSHA256,"reference_policy_sha256":original.referencePolicySHA256,"source_fingerprint":H("sources"),"owner_policy_source_sha256":NSNull(),"owner_policy_projection_sha256":NSNull(),"collection_manifest_sha256":H("manifest"),"historical_runtime_sha256":H(String(decoding:canonicalHistory,as:UTF8.self)),"native_generation_calls":0,"dispatch_calls":0,"retry_calls":0,"parity_state":"unverified","children":[["id":"owner_0","attempt_id":"a0","native_receipt_sha256":H("r0"),"witness_sha256":H("witness0"),"contract_sha256":original.sha256,"verifier_sha256":original.verifierCodeSHA256],["id":"owner_1","attempt_id":"a1","native_receipt_sha256":H("r1"),"witness_sha256":H("witness1"),"contract_sha256":H("c1"),"verifier_sha256":H("v1")]]]
 let p=try Host.adoptionPermit(raw);try p.current(now);n+=1
 try check(try Host.historicalEpoch(p,record:r,witness:w,parent:original,now:now)==observed)
 // The ordinary current evaluator MUST still reject the same expired lease.
 try check(!TaskQualityEvidence.evaluate(contract:original,receipt:receipt,artifact:artifact,currentReferencePolicySHA256:H("policy"),now:now).taskCompletionVerified)
 try check(TaskQualityEvidence.evaluate(contract:original,receipt:receipt,artifact:artifact,currentReferencePolicySHA256:H("policy"),now:observed).taskCompletionVerified)
 let fresh=try Host.retrospectiveVerificationContract(original,permit:p,now:now)
 var restored=fresh;restored.issuedAt=original.issuedAt;restored.validUntil=original.validUntil
 try check(restored==original);try check(fresh.sha256 != original.sha256)
 try check(fresh.issuedAt==now.addingTimeInterval(-1));try check(fresh.validUntil==now.addingTimeInterval(60))
 var currentReceipt=receipt;currentReceipt.contractSHA256=fresh.sha256;currentReceipt.observedAt=now
 try check(TaskQualityEvidence.evaluate(contract:fresh,receipt:currentReceipt,artifact:artifact,currentReferencePolicySHA256:H("policy"),now:now).taskCompletionVerified)
 try check(!TaskQualityEvidence.evaluate(contract:original,receipt:currentReceipt,artifact:artifact,currentReferencePolicySHA256:H("policy"),now:now).taskCompletionVerified)
 try rejects{_ = try Host.historicalEpoch(p,record:r,witness:w,parent:original,now:now.addingTimeInterval(60))}
 try rejects{_ = try Host.historicalEpoch(p,record:r,witness:w,parent:original,now:now.addingTimeInterval(-2))}
 var noInput=r;noInput.configuredInputObservation=nil;try rejects{_ = try Host.historicalEpoch(p,record:noInput,witness:w,parent:original,now:now)}
 var invalidInput=r;invalidInput.configuredInputObservation?.valid=false;try rejects{_ = try Host.historicalEpoch(p,record:invalidInput,witness:w,parent:original,now:now)}
 for prepared in [issued.addingTimeInterval(-1),observed.addingTimeInterval(1),now.addingTimeInterval(1)] {
 var bad=r;bad.configuredInputObservation?.preparedAtMS=Int64(prepared.timeIntervalSince1970*1000);try rejects{_ = try Host.historicalEpoch(p,record:bad,witness:w,parent:original,now:now)}
 }
 var missingReceipt=w;missingReceipt.receipt=nil;try rejects{_ = try Host.historicalEpoch(p,record:r,witness:missingReceipt,parent:original,now:now)}
 for time in [until,until.addingTimeInterval(1),now.addingTimeInterval(1),issued.addingTimeInterval(-1)] {
 var bad=w;bad.receipt?.observedAt=time;try rejects{_ = try Host.historicalEpoch(p,record:r,witness:bad,parent:original,now:now)}
 }
 var badParent=original;badParent.issuedAt=observed.addingTimeInterval(1);try rejects{_ = try Host.historicalEpoch(p,record:r,witness:w,parent:badParent,now:now)}
 badParent=original;badParent.validUntil=observed;try rejects{_ = try Host.historicalEpoch(p,record:r,witness:w,parent:badParent,now:now)}
 var mismatch=w;mismatch.receipt?.checks[0].status = .failed;try rejects{_ = try Host.historicalEpoch(p,record:r,witness:mismatch,parent:original,now:now)}
 var wrongWitness=r;wrongWitness.operationalQuality?.witnessSHA256=H("other");try rejects{_ = try Host.historicalEpoch(p,record:wrongWitness,witness:w,parent:original,now:now)}
 for key in raw.keys {var bad=raw;bad.removeValue(forKey:key);try rejects{_ = try Host.adoptionPermit(bad)}}
 for key in ["schema","expected_revision","issued_at_ms","expires_at_ms","native_generation_calls","dispatch_calls","retry_calls"] {
 for value:Any in [true,false,NSNull(),"1",1.5] {var bad=raw;bad[key]=value;try rejects{_ = try Host.adoptionPermit(bad)}}
 }
 for (key,value) in [("kind","renew_all"),("parent_contract_sha256","invalid"),("parity_state","reference_equivalent")] {var bad=raw;bad[key]=value;try rejects{_ = try Host.adoptionPermit(bad)}}
 for (key,value) in [("native_generation_calls",1),("dispatch_calls",1),("retry_calls",1)] {var bad=raw;bad[key]=value;try rejects{_ = try Host.adoptionPermit(bad)}}
 raw["expires_at_ms"]=Int64(now.addingTimeInterval(301).timeIntervalSince1970*1000);try rejects{let bad=try Host.adoptionPermit(raw);try bad.current(now)}
 print("RETROSPECTIVE_TEMPORAL_COMPONENT_PASS checks=\(n) SDK=0 model=0 RPC=0 original_writes=0")
 // Canonical cross-language hash fixture; contains slash, spaces, Unicode.
 print("CANONICAL_HISTORY_SHA256="+RCCRuntimeContract.digest(canonicalHistory))
 }
}
'''
with tempfile.TemporaryDirectory(prefix='os1-retrospective-test-')as d:
 p=Path(d);(p/'main.swift').write_text(program);(p/'TaskQuality.swift').write_text(quality)
 subprocess.run(['swiftc','-parse-as-library',str(p/'main.swift'),str(p/'TaskQuality.swift'),'-o',str(p/'test')],check=True)
 result=subprocess.run([str(p/'test')],check=True,capture_output=True,text=True);print(result.stdout,end='')
 expected=json.dumps({'app_path':'/private/한글 App.app/Contents/a/b','n':1,'emoji':'🦊'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
 assert 'CANONICAL_HISTORY_SHA256='+hashlib.sha256(expected).hexdigest()in result.stdout
print(json.dumps({'status':'SOURCE_EXTRACTED_TEMPORAL_AND_REAL_EVALUATOR_PASS','owner_source_sha256':hashlib.sha256(s.encode()).hexdigest(),'global_evaluator_source_sha256':hashlib.sha256(quality.encode()).hexdigest(),'scope':'synthetic temporal helpers, not actual adoption or auth proof'}))
