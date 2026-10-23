#!/usr/bin/env python3
"""Actual request-bound admission functions + real Context validation; no SDK/model.
The fixture uses an isolated temporary registry. Its unused regression-snapshot
field is a Codable shell; the admission, envelope, policy/scope/ID functions are
extracted verbatim. Full CLI self-test remains a separate integration gate.
"""
from pathlib import Path
import hashlib,json,os,subprocess,tempfile
ROOT=Path(__file__).resolve().parents[1]
p=ROOT/'Sources/OS1/TaskQualityRuntime.swift';source=p.read_text();main=(ROOT/'Sources/OS1/main.swift').read_text()
start=source.index('    static func constrainCatalogData(');end=source.index('    static func prepare(ticket:',start)
body=source[start:end]
def wire(s,m):
    a=s[s.index('    static func constrainCatalogData('):s.index('    static func prepare(ticket:',s.index('    static func constrainCatalogData('))]
    assert 'var catalog = try C.decodeCatalog(data, request: request)' in a
    assert 'try C.validate(catalog, request: request)' in a
    marker='let admitted = try RCCOperationalQuality.constrainCatalogData(data, request: request,'
    caller=m[m.index(marker):m.index('    return admitted',m.index(marker))]
    assert '_ = try RCCRuntimeContract.decodeCatalog(admitted, request: request)' in caller
wire(source,main)
for a,b in [(source.replace('C.decodeCatalog(data, request: request)','C.decodeCatalog(data)',1),main),(source,main.replace('RCCRuntimeContract.decodeCatalog(admitted, request: request)','RCCRuntimeContract.decodeCatalog(admitted)',1))]:
    try:wire(a,b)
    except AssertionError:pass
    else:raise AssertionError('request-loss caller mutant accepted')

def between(a,b):return source[source.index(a):source.index(b,source.index(a))]
envelope=between('    struct Envelope: Codable {','    let envelope: Envelope')
encoder=between('    static func encoded<T: Encodable>','    private static func directory(')
boundary=between('    struct LocalEffectsBoundary {','    /// The original owner')
original=between('    private static func originalLocalEffectsBoundary(','    static func localEffectsBoundary(ticket:')
request_boundary=between('    static func localEffectsBoundary(request:','    /// Capability predicate only:')
support=between('    static func supportsLocalEffects(','    static func enforceLocalEffectsAdmission(')
header='''import Foundation
import Darwin
import OS1Context
struct PythonRegressionSnapshot: Codable {} // Unused nil fixture field only.
struct PreparedTaskQuality {
 static var root: URL { URL(fileURLWithPath: "/unused-fixture-root") }
'''+envelope+'}\nenum Q {\n typealias C=RCCRuntimeContract\n enum Failure: Error { case custody,binding,unavailable,localEffectsCapabilityUnavailable }\n'+encoder+boundary+original+request_boundary+support
program=r'''
@main enum Fixture {
 static func main() throws {
  typealias C=RCCRuntimeContract
  let fm=FileManager.default,base=fm.temporaryDirectory.appendingPathComponent("os1-r10-request-"+UUID().uuidString).resolvingSymlinksInPath()
  try fm.createDirectory(at:base.appendingPathComponent("contracts"),withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
  defer { try? fm.removeItem(at:base) }
  let hash=C.digest(Data("fixture-policy".utf8)),text="Read only the fixed synthetic task."
  let host=C.HostContext(workspace:base.path,context:nil,providerPreference:"auto",codexSessionID:nil,claudeSessionID:nil,requireReadOnly:false,ownerPolicy:nil)
  let legacy=C.Request(taskID:"fixture-task",request:text,requestSHA256:C.digest(Data(text.utf8)),objective:text,policySHA256:hash,sourceFingerprint:C.digest(try C.encode(host)),mode:.auto,materialRefs:[],budget:.init(maxAttempts:2,maxParallel:2,maxCostUnits:nil,maxDurationMS:20000),hostContext:host)
  var request=legacy;request.routingIntentPolicyVersion=C.RoutingIntentV2.version
  let now=Int64(Date().timeIntervalSince1970*1000)
  func row(_ id:String,_ surface:C.Surface,_ scope:C.Scope = .readOnly)->C.Candidate {
   let codex=surface == .codex
   let config=C.ExactConfig(surface:surface,transport:codex ? .codexAppServer:.claudeCLI,accountID:"fixture",model:id,effort:.low,tools:[],scope:scope,permissionProfile:scope,quotaPool:codex ? .openAICodex:.anthropicShared,allowedPaths:scope == .readOnly ? []:["**"],configurationSHA256:C.digest(Data(id.utf8)))
   return .init(id:id,config:config,quotaRemainingFraction:0.5,quotaObservedAtMS:now-1,quotaValidUntilMS:now+60000,qualityState:.policyAdmitted,estimatedCostUnits:nil,availability:.available,availabilityObservedAtMS:now-1,availabilityValidUntilMS:now+60000)
  }
  let cheap=row("cheap",.codex),frontier=row("frontier",.codex),claude=row("claude",.claude),writer=row("writer",.codex,.workspaceWrite)
  let legacyCatalog=C.Catalog(taskID:request.taskID,requestSHA256:request.requestSHA256,candidates:[cheap,frontier,claude,writer],modelTiers:["cheap":"fast","frontier":"frontier","claude":"frontier","writer":"fast"],nativeReferenceEfforts:["codex":["cheap":"max","frontier":"ultra","writer":"max"],"claude":["claude":"max"]])
  var catalog=legacyCatalog;catalog.routingIntentV2=C.RoutingIntentV2()
  let path=base.appendingPathComponent("contracts/"+request.requestSHA256+".json")
  var count=0
  func check(_ yes:Bool)throws {guard yes else {throw Q.Failure.binding};count+=1}
  func reject(_ action:()throws->Void)throws {do{try action()}catch{count+=1;return};throw Q.Failure.binding}
  func save(_ scope:TaskContext.Scope)throws {
   let c=TaskQualityEvidence.Contract(basis:.declaredTrustedContract,objectiveSHA256:request.requestSHA256,contextSHA256:C.digest(Data()),sourceSHA256:nil,startTreeSHA256:hash,scope:scope,verifierCodeSHA256:hash,referencePolicySHA256:hash,requiredCheckIDs:["shape"],fullCoverage:false,referenceProfiles:[],reference:nil,issuedAt:Date(),validUntil:Date().addingTimeInterval(60))
   let e=PreparedTaskQuality.Envelope(contract:c,checkerSHA256:hash,timeoutSeconds:1,workspacePaths:[],localEffectsOnly:true)
   try Q.encoded(e).write(to:path);try fm.setAttributes([.posixPermissions:0o600],ofItemAtPath:path.path)
  }
  func admit(_ c:C.Catalog,_ r:C.Request)throws->C.Catalog {
   let validated=try C.decodeRequest(C.encode(r))
   let data=try Q.constrainCatalogData(C.encode(c),request:validated,sourceBound:false,rootURL:base)
   return try C.decodeCatalog(data,request:validated)
  }
  try save(.readOnly)
  let r=try admit(catalog,request)
  try check(r.candidates == [cheap,frontier] && r.routingIntentV2 == catalog.routingIntentV2)
  try check(r.exclusions == [.init(provider:"codex",reason:"explicit_constraint_unavailable",count:1),.init(provider:"claude",reason:"explicit_constraint_unavailable",count:1)] || r.exclusions == [.init(provider:"claude",reason:"explicit_constraint_unavailable",count:1),.init(provider:"codex",reason:"explicit_constraint_unavailable",count:1)])
  try save(.workspaceWrite);try check(try admit(catalog,request).candidates == [cheap,frontier,writer])
  try reject {_ = try C.decodeCatalog(C.encode(catalog))}
  try reject {_ = try admit(catalog,legacy)}
  try reject {_ = try admit(legacyCatalog,request)}
  var wrong=request;wrong.taskID="foreign-task";try reject {_ = try admit(catalog,wrong)}
  wrong=request;wrong.requestSHA256=hash;try reject {_ = try admit(catalog,wrong)}
  wrong=request;wrong.policySHA256=C.digest(Data("foreign-policy".utf8));try reject {_ = try admit(catalog,wrong)}
  wrong=request;wrong.routingIntentPolicyVersion="unreviewed-v99";try reject {_ = try admit(catalog,wrong)}
  var bad=catalog;bad.requestSHA256=hash;try reject {_ = try admit(bad,request)}
  bad=catalog;bad.candidates.append(cheap);try reject {_ = try admit(bad,request)}
  bad=catalog;bad.candidates[0].permissionProfile = .workspaceWrite;try reject {_ = try admit(bad,request)}
  bad=catalog;bad.routingIntentV2?.state="unresolved";try reject {_ = try admit(bad,request)}
  try check(try admit(legacyCatalog,legacy).candidates == [cheap,frontier,writer])
  try fm.removeItem(at:path)
  let raw=try C.encode(legacyCatalog)
  try check(try Q.constrainCatalogData(raw,request:legacy,sourceBound:false,rootURL:base) == raw)
  print("R10_REQUEST_ADMISSION_PASS checks=\(count) native=0 model=0 temporary_registry_only=true")
 }
}
'''
build=Path(os.environ.get('OS1_CONTEXT_TEST_BUILD_ROOT',str(ROOT/'.build/debug'))).resolve()
objects=sorted((build/'OS1Context.build').glob('*.o'))+sorted((build/'OS1System.build').glob('*.o'))
assert objects,'Build ContextTests or explicitly select exact completed Context objects; no preinstalled library substitution'
inputs=[*objects,build/'Modules/OS1Context.swiftmodule',build/'OS1System.build/module.modulemap']
pins={str(p):hashlib.sha256(p.read_bytes()).hexdigest()for p in inputs}
with tempfile.TemporaryDirectory(prefix='os1-r10-admission-')as tmp:
 t=Path(tmp)
 for label,actual in [('current',body),('request-loss-mutant',body.replace('C.decodeCatalog(data, request: request)','C.decodeCatalog(data)',1))]:
  f=t/(label+'.swift');binary=t/label;f.write_text(header+actual+'}\n'+program)
  subprocess.run(['swiftc','-parse-as-library',str(f),'-I',str(build/'Modules'),'-Xcc','-fmodule-map-file='+str(build/'OS1System.build/module.modulemap'),'-Xcc','-I'+str(ROOT/'Sources/OS1System/include'),*[str(o)for o in objects],'-o',str(binary)],check=True,capture_output=True,text=True,timeout=60)
  r=subprocess.run([str(binary)],capture_output=True,text=True,timeout=20)
  if label=='current':assert r.returncode==0,r.stderr;print(r.stdout.strip())
  else:assert r.returncode!=0,'dropped-request mutant did not catch original regression';print('REQUEST_LOSS_MUTANT_REJECTED')
assert pins=={str(p):hashlib.sha256(p.read_bytes()).hexdigest()for p in inputs},'dependency changed during test'
print(json.dumps({'status':'PASS','scope':'actual admission/envelope/boundary functions + real Context; nil-unused snapshot shell; not full CLI execution','source_sha256':hashlib.sha256(source.encode()).hexdigest(),'main_sha256':hashlib.sha256(main.encode()).hexdigest(),'context_input_hashes':pins,'provider_calls':0,'model_calls':0},sort_keys=True))
