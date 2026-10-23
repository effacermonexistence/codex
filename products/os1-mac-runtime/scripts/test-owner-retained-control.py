#!/usr/bin/env python3
"""Source-extracted proof-only boundaries and real private fake-file custody. No SDK/model/RPC."""
from pathlib import Path
import json,hashlib,subprocess,tempfile
R=Path(__file__).resolve().parents[1]
s=(R/'Sources/OS1/RCCOwnerCollection.swift').read_text();g=(R/'Sources/OS1/RCCRuntimeGatewayClient.swift').read_text();main=(R/'Sources/OS1/main.swift').read_text()
def fragment(text,start,end):
 a=text.index(start);return text[a:text.index(end,a)]
parts=[fragment(s,'    static func persistControlObservation(','    struct HistoricalRuntime:'),fragment(s,'    struct HistoricalRuntime:','    static func currentPolicyMatches('),fragment(s,'    static func retainedInteger(','    /// Original artifacts only.')]
transport=fragment(g,'    static func validateOwnerControlRecovery(','    /// Cancellation remains')
retained=fragment(s,'    static func retainedChildControl(','    /// Parent checker observes')
assert 'verifyNativeProfile' not in retained
for required in ['C.validate(ticket, request: task)','C.validate(record, ticket: ticket)','ticket.originalRequest == task.request','ticket.originalObjective == task.objective','ticket.contextRefs == task.materialRefs','ticket.instruction == o.instruction','q.witnessSHA256 == witnessSHA','record.selectedConfig == record.acknowledgedConfig','w.prepared.envelope.contract == w.contract','w.contract.verifierCodeSHA256 == o.verifierSHA256','TaskQualityEvidence.evaluate','currentAccountMatches(record.selectedConfig)','try currentPolicyMatches(task)']:
 assert required in retained,required
assert retained.count('try verifyHistoricalRuntime(archive, witness: w, record: record)')==2
assert retained.index('try verifyChildControl(')<retained.rindex('try verifyHistoricalRuntime(')<retained.rindex('currentPolicyMatches(task)')
parent=s[s.index('    static func verify(_ data:'):]
assert 'try observeControl(record: record, witness: w) == expectedControl' in retained
assert 'try observeControl(record: record, witness: witness) == expectedControl' in parent
assert parent.index('let result = try commandOutput')<parent.index('if let historical {\n            for (record, witness, digest, expectedControl)')<parent.index('retainedConfigs.allSatisfy(currentAccountMatches)')
assert 'rccNativeAdapter('not in retained and 'decodeTicket'not in retained # the ticket must come only from the saved witness
assert '"rcc-owner-control-retained"'in main and '"rcc-reconcile-owner-collection"'in main
assert '"os1.rcc.recoverOwnerControl"'in g
recovery=fragment(g,'    static func recoverOwnerControl(','    /// Pure closed transport schema.')
assert 'ensureGateway(' not in recovery and 'existingProofOwner(' in recovery
existing=fragment(g,'    private static func existingProofOwner(','    /// Pure closed transport schema.')
assert 'ensureGateway(' not in existing and 'launch(' not in existing and 'createPrivateDirectory(' not in existing and 'awaitReadiness(' not in existing
assert 'FileManager.default.fileExists(atPath: paths.metadata.path)' in existing and 'processMatches(' in existing and 'try health(' in existing
assert recovery.count('rpc(')==1 and 'os1.rcc.submit'not in recovery and 'cancel('not in recovery and 'runBlocking'not in recovery
program='''import Foundation
import CryptoKit
import Darwin
enum RCCRuntimeContract {static func isHash(_ x:String)->Bool{x.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil};static func digest(_ b:Data)->String{SHA256.hash(data:b).map{String(format:"%02x",$0)}.joined()}}
enum Host {typealias C=RCCRuntimeContract;enum Failure:Error{case custody,binding}
'''+''.join(parts)+'}\nenum Transport {enum Failure:Error{case invalidRequest}\n'+transport+'}\n'
program+=r'''
@main enum Test {
 static func main()throws {
  var n=0
  func check(_ value:Bool)throws{guard value else{throw Host.Failure.binding};n+=1}
  func rejects(_ body:()throws->Void)throws{do{try body()}catch{n+=1;return};throw Host.Failure.binding}
  let fm=FileManager.default,root=fm.temporaryDirectory.appendingPathComponent("retained-pure-"+UUID().uuidString).resolvingSymlinksInPath()
  try fm.createDirectory(at:root,withIntermediateDirectories:false,attributes:[.posixPermissions:0o700]);defer{try?fm.removeItem(at:root)}
  let data=Data("SYNTHETIC_ORIGINAL_CONTROL".utf8),path=root.appendingPathComponent("original")
  try data.write(to:path);try fm.setAttributes([.posixPermissions:0o600],ofItemAtPath:path.path)
  let hash=RCCRuntimeContract.digest(data)
  try check(try Host.retainedFile(path.path,parent:root,expected:hash)==data)
  try rejects{_ = try Host.retainedFile(path.path,parent:root,expected:String(repeating:"0",count:64))}
  try fm.createSymbolicLink(at:root.appendingPathComponent("sym"),withDestinationURL:path)
  try rejects{_ = try Host.retainedFile(root.appendingPathComponent("sym").path,parent:root)}
  try fm.linkItem(at:path,to:root.appendingPathComponent("hard"))
  try rejects{_ = try Host.retainedFile(path.path,parent:root)}
  try fm.removeItem(at:root.appendingPathComponent("hard"))
  try rejects{_ = try Host.retainedFile(root.path,parent:root.deletingLastPathComponent())}
  try rejects{_ = try Host.retainedFile(root.path+"/./original",parent:root)}
  try fm.setAttributes([.posixPermissions:0o644],ofItemAtPath:path.path)
  try rejects{_ = try Host.retainedFile(path.path,parent:root)}
  try check(try Host.retainedFile(path.path,parent:root,expected:hash,privateFile:false)==data)
  try fm.setAttributes([.posixPermissions:0o666],ofItemAtPath:path.path)
  try rejects{_ = try Host.retainedFile(path.path,parent:root,privateFile:false)}
  try fm.setAttributes([.posixPermissions:0o600],ofItemAtPath:path.path)
  try check(try Host.persistControlObservation(data,attemptID:"attempt-1",root:root)==data)
  try check(try Host.persistControlObservation(data,attemptID:"attempt-1",root:root)==data)
  try rejects{_ = try Host.persistControlObservation(Data("DIFFERENT".utf8),attemptID:"attempt-1",root:root)}
  try check(try Host.retainedFile(root.appendingPathComponent("attempt-1.json").path,parent:root)==data)
  for bad in ["../escape","",String(repeating:"a",count:129)]{try rejects{_ = try Host.persistControlObservation(data,attemptID:bad,root:root)}}
  // Same actual read used after child proof and after parent checker rejects a changed bit.
  try Data("MUTATED_DURING_PROOF".utf8).write(to:path)
  try rejects{_ = try Host.retainedFile(path.path,parent:root,expected:hash)}
  try fm.setAttributes([.posixPermissions:0o755],ofItemAtPath:root.path)
  try rejects{try Host.retainedPrivateDirectory(root)}
  try fm.setAttributes([.posixPermissions:0o700],ofItemAtPath:root.path)
  for bad:Any in [true,false,-1,"1",NSNull(),1.5]{try check(Host.retainedInteger(bad)==nil)}
  try check(Host.retainedInteger(0)==0);try check(Host.retainedInteger(42)==42)
  let H=String(repeating:"a",count:64)
  let history:[String:Any]=["app_path":"/private/App.app","bundle_inventory_receipt":"/private/inventory.json","bundle_inventory_receipt_sha256":H,"install_receipt":"/private/install.json","install_receipt_sha256":H,"cli_sha256":H]
  _ = try Host.historicalRuntime(history);n+=1
  for key in history.keys{var bad=history;bad.removeValue(forKey:key);try rejects{_ = try Host.historicalRuntime(bad)}}
  var badHistory=history;badHistory["extra"]=true;try rejects{_ = try Host.historicalRuntime(badHistory)}
  badHistory=history;badHistory["cli_sha256"]="future";try rejects{_ = try Host.historicalRuntime(badHistory)}
  let child:[String:Any]=["id":"owner_0","attempt_id":"a0","native_receipt":"/private/a0.json","native_receipt_sha256":H,"witness_sha256":H]
  var second=child;second["id"]="owner_1";second["attempt_id"]="a1"
  let request:[String:Any]=["schema":1,"recovery_id":"recover-1","task_id":"task-1","request_sha256":H,"expected_revision":2,"expected_fingerprint":H,"expected_snapshot_sha256":H,"children":[child,second],"historical_runtime":history]
  func encoded(_ x:[String:Any])throws->Data{try JSONSerialization.data(withJSONObject:x,options:.sortedKeys)}
  try check(try Transport.validateOwnerControlRecovery(encoded(request)).revision==2)
  for key in request.keys{var bad=request;bad.removeValue(forKey:key);try rejects{_ = try Transport.validateOwnerControlRecovery(encoded(bad))}}
  for key in ["schema","expected_revision"]{for value:Any in [true,false,NSNull(),"2",-1,0,1.5]{var bad=request;bad[key]=value;try rejects{_ = try Transport.validateOwnerControlRecovery(encoded(bad))}}}
  var bad=request;bad["children"]=[child,child];try rejects{_ = try Transport.validateOwnerControlRecovery(encoded(bad))}
  bad=request;bad["historical_runtime"]=badHistory;try rejects{_ = try Transport.validateOwnerControlRecovery(encoded(bad))}
  bad=request;bad["expected_fingerprint"]="unknown";try rejects{_ = try Transport.validateOwnerControlRecovery(encoded(bad))}
  bad=request;bad["extra"]=true;try rejects{_ = try Transport.validateOwnerControlRecovery(encoded(bad))}
  print("RETAINED_OWNER_CONTROL_COMPONENT_PASS checks=\(n) SDK=0 model=0 RPC=0 original_artifact_writes=0")
 }
}
'''
with tempfile.TemporaryDirectory(prefix='os1-retained-test-')as d:
 p=Path(d);(p/'main.swift').write_text(program);subprocess.run(['swiftc','-parse-as-library',str(p/'main.swift'),'-o',str(p/'test')],check=True);subprocess.run([str(p/'test')],check=True)
print(json.dumps({'status':'PURE_COMPONENT_AND_SOURCE_WIRING_PASS','owner_source_sha256':hashlib.sha256(s.encode()).hexdigest(),'gateway_source_sha256':hashlib.sha256(g.encode()).hexdigest(),'scope':'not full recovery execution, no actual provider/source/adoption claim'}))
