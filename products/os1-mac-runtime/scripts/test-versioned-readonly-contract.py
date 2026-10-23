#!/usr/bin/env python3
"""Source-extracted owner-envelope selection. Synthetic private files only.

The production selector, Envelope, TaskQualityEvidence, duplicate-key scanner
and checkedObject are compiled from this checkout. The Scope stub and unused
PythonRegressionSnapshot Codable stub provide no runtime behavior. A separate
fault-injected build inserts callbacks immediately before production read /
re-read checks; it is explicitly not a different shipping implementation.
No HOME registry, native SDK, RPC, model, answer, or live account is accessed.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
s = (ROOT / 'Sources/OS1/TaskQualityRuntime.swift').read_text()
q = (ROOT / 'Sources/OS1Context/TaskQuality.swift').read_text()
r = (ROOT / 'Sources/OS1Context/RCCRuntimeContract.swift').read_text()

def part(text, start, end):
    a = text.index(start)
    return text[a:text.index(end, a)]

selector = part(s, 'enum TaskQualityContractSource {', '/// The existing execution flow')
envelope = part(s, '    struct Envelope: Codable {', '    let envelope: Envelope\n')
scanner = part(r, '    private struct DuplicateKeyScanner {', '    public static func decodeRequest(')
checked = part(r, '    public static func checkedObject(', '    /// Canonical UTF-8')
prepare = part(s, '    static func prepare(objective:', '\n    func evaluate(')
boundary = part(s, '    private static func originalLocalEffectsBoundary(', '\n    static func localEffectsBoundary(ticket:')
isolation_type = part(s, '    struct LocalEffectsBoundary {', '    /// The original owner\'s local-effect restriction')
isolation = part(s, '    static func supportsLocalEffects(', '    /// Admission closure for the same owner boundary')
assert prepare.count('TaskQualityContractSource.acquire(') == 1
assert boundary.count('TaskQualityContractSource.acquire(') == 1
assert 'let data = acquired.bytes, envelope = acquired.envelope' in boundary
assert 'envelopeSHA256: C.digest(data)' in boundary
assert 'boundary.envelopeSHA256 == envelopeSHA256' in s
assert 'read(upToCount: maximum + 1)' in selector and 'readToEnd()' not in selector
assert selector.count('privateFile(pointer,') == 1  # plus the explicit re-read loop
assert '[(pointer, selected), (legacy, old), (versionPath, version)]' in selector
for prohibited in ['Process(', 'commandOutput(', 'environment', 'createDirectory(', 'write(to:', 'rccNativeAdapter(']:
    assert prohibited not in selector, prohibited

prefix = '''import Foundation
import CryptoKit
import CoreFoundation
import Darwin
public enum TaskContext { public enum Scope: String, Codable, Sendable {case readOnly="read_only",workspaceWrite="workspace_write",fullAccess="full_access"} }
struct PythonRegressionSnapshot: Codable {}
'''
prefix += q.replace('import CryptoKit', '').replace('import Foundation', '')
prefix += '\nenum RCCRuntimeContract { static let maximumWireBytes = 8_388_608; enum Rejection:Error {case invalidInput,unsupportedField,oversized}; enum Surface {case codex,claude};enum Transport {case codexAppServer,claudeCLI};struct ExactConfig {var surface:Surface;var transport:Transport}\n' + scanner + checked + '}\n'
prefix += 'struct PreparedTaskQuality {\n' + envelope + '}\n'
prefix += 'enum Isolation {typealias C=RCCRuntimeContract;enum Failure:Error {case localEffectsCapabilityUnavailable}\n' + isolation_type + isolation + '}\n'

tests = r'''
@main enum Fixture {
 static func main()throws {
  let fm=FileManager.default
  let base=fm.temporaryDirectory.appendingPathComponent("os1-versioned-contract-"+UUID().uuidString).resolvingSymlinksInPath()
  try fm.createDirectory(at:base,withIntermediateDirectories:false,attributes:[.posixPermissions:0o700]);defer{try?fm.removeItem(at:base)}
  var checks=0
  func check(_ value:Bool,_ label:String)throws {guard value else{fatalError("FAIL "+label)};checks+=1}
  func reject(_ label:String,_ body:()throws->Void)throws {do{try body()}catch{checks+=1;return};fatalError("ACCEPTED "+label)}
  func encoded<T:Encodable>(_ value:T)throws->Data {let e=JSONEncoder();e.outputFormatting=[.sortedKeys,.withoutEscapingSlashes];e.dateEncodingStrategy = .millisecondsSince1970;return try e.encode(value)}
  func data(_ value:[String:Any])throws->Data {try JSONSerialization.data(withJSONObject:value,options:[.sortedKeys,.withoutEscapingSlashes])}
  func put(_ bytes:Data,_ path:URL)throws {try bytes.write(to:path);try fm.setAttributes([.posixPermissions:0o600],ofItemAtPath:path.path)}
  let H=String(repeating:"a",count:64),objective=TaskQualityEvidence.digest(Data("SYNTHETIC FRESH UNISSUED TASK".utf8)),now=Date(timeIntervalSince1970:20_000)
  let c=TaskQualityEvidence.Contract(basis:.declaredTrustedContract,objectiveSHA256:objective,contextSHA256:H,sourceSHA256:nil,startTreeSHA256:H,scope:.readOnly,verifierCodeSHA256:H,referencePolicySHA256:H,requiredCheckIDs:["synthetic.exact"],fullCoverage:true,referenceProfiles:[],reference:nil,issuedAt:Date(timeIntervalSince1970:1_000),validUntil:Date(timeIntervalSince1970:10_000))
  let old=PreparedTaskQuality.Envelope(contract:c,checkerSHA256:H,timeoutSeconds:10,workspacePaths:[],localEffectsOnly:true)
  let oldBytes=try encoded(old),oldSHA=TaskQualityEvidence.digest(oldBytes)
  var freshContract=c;freshContract.issuedAt=Date(timeIntervalSince1970:15_000);freshContract.validUntil=Date(timeIntervalSince1970:25_000)
  let fresh=PreparedTaskQuality.Envelope(contract:freshContract,checkerSHA256:H,timeoutSeconds:10,workspacePaths:[],localEffectsOnly:true)
  let freshBytes=try encoded(fresh)
  func object(_ b:Data)throws->[String:Any] {try JSONSerialization.jsonObject(with:b) as! [String:Any]}
  struct Files {let root:URL;let contracts:URL;let current:URL;let versions:URL;let directory:URL;let legacy:URL;let pointer:URL;let version:URL}
  func fixture(_ name:String,_ candidate:Data?=nil,_ predecessor:Data?=nil,_ publish:Bool=true)throws->Files {
   let root=base.appendingPathComponent(name),contracts=root.appendingPathComponent("contracts"),current=contracts.appendingPathComponent("current"),versions=contracts.appendingPathComponent("versions"),directory=versions.appendingPathComponent(objective)
   for p in [root,contracts,current,versions,directory] {try fm.createDirectory(at:p,withIntermediateDirectories:false,attributes:[.posixPermissions:0o700])}
   let legacy=contracts.appendingPathComponent(objective+".json"),pointer=current.appendingPathComponent(objective+".json"),bytes=candidate ?? freshBytes,version=directory.appendingPathComponent(TaskQualityEvidence.digest(bytes)+".json")
   try put(predecessor ?? oldBytes,legacy);try put(bytes,version)
   if publish {try put(data(["schema":1,"objective_sha256":objective,"envelope_sha256":TaskQualityEvidence.digest(bytes),"predecessor_envelope_sha256":TaskQualityEvidence.digest(predecessor ?? oldBytes)]),pointer)}
   return Files(root:root,contracts:contracts,current:current,versions:versions,directory:directory,legacy:legacy,pointer:pointer,version:version)
  }
  func load(_ f:Files)throws->TaskQualityContractSource.Acquired? {try TaskQualityContractSource.acquire(objectiveSHA256:objective,rootURL:f.root,now:now)}
  let absent=base.appendingPathComponent("absent")
  try check(try TaskQualityContractSource.acquire(objectiveSHA256:objective,rootURL:absent,now:now)==nil,"absent legacy stays absent")
  let legacy=try fixture("legacy",nil,nil,false)
  try check(try load(legacy)!.bytes==oldBytes,"no pointer exact legacy expired bytes, not renewal")
  try fm.setAttributes([.posixPermissions:0o644],ofItemAtPath:legacy.legacy.path)
  try check(try load(legacy)!.bytes==oldBytes,"legacy0644 behavior retained")
  var partial=try object(oldBytes);var pc=partial["contract"] as! [String:Any];pc["fullCoverage"]=false;partial["contract"]=pc;try put(data(partial),legacy.legacy)
  try check(try load(legacy)!.envelope.contract.fullCoverage==false,"no pointer does not narrow legacy categories")
  let good=try fixture("valid")
  let selected=try load(good)!
  try check(selected.bytes==freshBytes && selected.envelope.contract==freshContract,"valid full readonly successor exact selected bytes")
  try check(try Data(contentsOf:good.legacy)==oldBytes,"legacy predecessor never modified")
  try check(TaskQualityEvidence.digest(selected.bytes) != oldSHA,"executionIsolation must bind new envelope SHA")
  try check(TaskQualityEvidence.digest(selected.bytes)==TaskQualityEvidence.digest(try Data(contentsOf:good.version)),"selected SHA equals new immutable bytes")
  let isolation=Isolation.LocalEffectsBoundary(envelopeSHA256:TaskQualityEvidence.digest(selected.bytes),originalObjectiveSHA256:objective,scope:.readOnly)
  let config=RCCRuntimeContract.ExactConfig(surface:.codex,transport:.codexAppServer)
  try Isolation.enforceRequiredExecutionIsolation(required:"codex_fresh_local_effects_v1",envelopeSHA256:TaskQualityEvidence.digest(selected.bytes),boundary:isolation,config:config,sourceBound:false,nativeResume:false,permissionContinuation:false);checks+=1
  try reject("OLD ISSUED ticket isolation cannot inherit current successor"){try Isolation.enforceRequiredExecutionIsolation(required:"codex_fresh_local_effects_v1",envelopeSHA256:oldSHA,boundary:isolation,config:config,sourceBound:false,nativeResume:false,permissionContinuation:false)}
  for field in ["objective_sha256","envelope_sha256","predecessor_envelope_sha256"] {
   let f=try fixture("pointer-"+field);var p=try object(Data(contentsOf:f.pointer));p[field]=String(repeating:"b",count:64);try put(data(p),f.pointer);try reject(field){_ = try load(f)}
  }
  for value:Any in [true,false,0,2,"1",NSNull()] {let f=try fixture("schema-"+String(checks));var p=try object(Data(contentsOf:f.pointer));p["schema"]=value;try put(data(p),f.pointer);try reject("typed schema"){_ = try load(f)}}
  for key in ["schema","objective_sha256","envelope_sha256","predecessor_envelope_sha256"] {let f=try fixture("missing-"+key);var p=try object(Data(contentsOf:f.pointer));p.removeValue(forKey:key);try put(data(p),f.pointer);try reject("missing field"){_ = try load(f)}}
  let extra=try fixture("extra");var ep=try object(Data(contentsOf:extra.pointer));ep["path"]="/arbitrary";try put(data(ep),extra.pointer);try reject("caller path extra"){_ = try load(extra)}
  let duplicate=try fixture("duplicate");var dup=String(decoding:try Data(contentsOf:duplicate.pointer),as:UTF8.self);dup=dup.replacingOccurrences(of:"{",with:"{\"schema\":1,",range:dup.range(of:"{"));try put(Data(dup.utf8),duplicate.pointer);try reject("duplicate pointer keys"){_ = try load(duplicate)}
  for text in ["not-json","[]","{}",""] {let f=try fixture("malformed-"+String(checks));try put(Data(text.utf8),f.pointer);try reject("present malformed pointer cannot fall back"){_ = try load(f)}}
  let missing=try fixture("missing-legacy");try fm.removeItem(at:missing.legacy);try reject("pointer requires legacy"){_ = try load(missing)}
  let noVersion=try fixture("missing-version");try fm.removeItem(at:noVersion.version);try reject("pointer requires version"){_ = try load(noVersion)}
  let mutated=try fixture("mutated");try put(freshBytes+Data([10]),mutated.version);try reject("version filename digest"){_ = try load(mutated)}
  let oldMutated=try fixture("old-mutated");try put(oldBytes+Data([10]),oldMutated.legacy);try reject("predecessor raw bytes"){_ = try load(oldMutated)}
  let future=try fixture("future");try reject("new issued after now"){_ = try TaskQualityContractSource.acquire(objectiveSHA256:objective,rootURL:future.root,now:Date(timeIntervalSince1970:14_999))}
  try reject("new expired"){_ = try TaskQualityContractSource.acquire(objectiveSHA256:objective,rootURL:future.root,now:Date(timeIntervalSince1970:25_000))}
  let changes:[(String,Any)] = [("scope","workspace_write"),("fullCoverage",false),("verifierCodeSHA256",String(repeating:"b",count:64)),("requiredCheckIDs",["synthetic.other"]),("contextSHA256",String(repeating:"b",count:64)),("sourceSHA256",H),("startTreeSHA256",String(repeating:"b",count:64)),("referencePolicySHA256",String(repeating:"b",count:64)),("objectiveSHA256",String(repeating:"b",count:64)),("schema",2),("issuedAt",9_999_000),("validUntil",15_000_000),("issuedAt",true)]
  for (key,value) in changes {var o=try object(freshBytes),cc=o["contract"] as! [String:Any];cc[key]=value;o["contract"]=cc;let f=try fixture("contract-"+key+String(checks),data(o));try reject("changed "+key){_ = try load(f)}}
  for (key,value):(String,Any) in [("localEffectsOnly",false),("checkerSHA256",String(repeating:"b",count:64)),("timeoutSeconds",11),("workspacePaths",["different.txt"]),("ownerCollection",["schema":1,"kind":"independent_readonly_json_v1","obligations":[]]),("publicRegressionSnapshot",[:]),("stagedWriterBaseSHA256",H),("unknown",true)] {var o=try object(freshBytes);o[key]=value;let f=try fixture("envelope-"+key,data(o));try reject("changed envelope "+key){_ = try load(f)}}
  // A matching successor is still ineligible when BOTH envelopes carry an
  // excluded authority class. Equality alone must never admit a writer/ref.
  let profile:[String:Any]=["provider":"fixture","model":"fixture","effort":"low","instructionsSHA256":H]
  for (key,value):(String,Any) in [("scope","workspace_write"),("fullCoverage",false),("referenceProfiles",[profile])] {var a=try object(oldBytes),b=try object(freshBytes),ca=a["contract"] as! [String:Any],cb=b["contract"] as! [String:Any];ca[key]=value;cb[key]=value;a["contract"]=ca;b["contract"]=cb;let f=try fixture("both-"+key,data(b),data(a));try reject("excluded both "+key){_ = try load(f)}}
  for (key,value):(String,Any) in [("localEffectsOnly",false),("ownerCollection",["schema":1,"kind":"independent_readonly_json_v1","obligations":[]])] {var a=try object(oldBytes),b=try object(freshBytes);a[key]=value;b[key]=value;let f=try fixture("both-"+key,data(b),data(a));try reject("excluded both "+key){_ = try load(f)}}
  let reference:[String:Any]=["profile":profile,"objectiveSHA256":objective,"contextSHA256":H,"startTreeSHA256":H,"verifierCodeSHA256":H,"referencePolicySHA256":H,"artifactSHA256s":[H],"scores":[["checkID":"synthetic.exact","value":1]],"measuredAt":1_000_000,"validUntil":30_000_000,"proofMode":"dev"]
  var ra=try object(oldBytes),rb=try object(freshBytes),rac=ra["contract"] as! [String:Any],rbc=rb["contract"] as! [String:Any];rac["reference"]=reference;rbc["reference"]=reference;ra["contract"]=rac;rb["contract"]=rbc
  let refs=try fixture("both-reference",data(rb),data(ra));try reject("reference artifact cannot be renewed"){_ = try load(refs)}
  var ua=try object(oldBytes),ub=try object(freshBytes);ua["unknown"]=true;ub["unknown"]=1
  let rawTypes=try fixture("unknown-bool-number",data(ub),data(ua));try reject("unknown field bool not numeric equality"){_ = try load(rawTypes)}
  for target in ["pointer","legacy","version"] {
   let f=try fixture("symlink-"+target),p=target=="pointer" ? f.pointer:target=="legacy" ? f.legacy:f.version,outside=base.appendingPathComponent("outside-"+target)
   try fm.moveItem(at:p,to:outside);try fm.createSymbolicLink(at:p,withDestinationURL:outside);try reject("symlink "+target){_ = try load(f)}
   let k=try fixture("hardlink-"+target),p2=target=="pointer" ? k.pointer:target=="legacy" ? k.legacy:k.version
   try fm.linkItem(at:p2,to:base.appendingPathComponent("hard-"+target));try reject("hardlink "+target){_ = try load(k)}
   let m=try fixture("mode-"+target),p3=target=="pointer" ? m.pointer:target=="legacy" ? m.legacy:m.version
   try fm.setAttributes([.posixPermissions:0o644],ofItemAtPath:p3.path);try reject("nonprivate "+target){_ = try load(m)}
  }
  for target in ["root","contracts","current","versions","directory"] {let f=try fixture("parent-mode-"+target),p=target=="root" ? f.root:target=="contracts" ? f.contracts:target=="current" ? f.current:target=="versions" ? f.versions:f.directory;try fm.setAttributes([.posixPermissions:0o755],ofItemAtPath:p.path);try reject("parent mode "+target){_ = try load(f)}}
  let symDir=try fixture("parent-symlink"),outside=base.appendingPathComponent("outside-directory");try fm.moveItem(at:symDir.directory,to:outside);try fm.createSymbolicLink(at:symDir.directory,withDestinationURL:outside);try reject("symlink parent"){_ = try load(symDir)}
  let dangling=try fixture("dangling-pointer");try fm.removeItem(at:dangling.pointer);try fm.createSymbolicLink(atPath:dangling.pointer.path,withDestinationPath:base.appendingPathComponent("absent-target").path);try reject("dangling pointer not absence"){_ = try load(dangling)}
  let over=try fixture("oversized-pointer");try put(Data(repeating:32,count:4_097),over.pointer);try reject("oversize pointer"){_ = try load(over)}
  let large=try fixture("oversized-version");try put(Data(repeating:32,count:128_001),large.version);try reject("oversize envelope"){_ = try load(large)}
  for bad in ["../escape","",String(repeating:"A",count:64),String(repeating:"a",count:63)] {try reject("objective hash path"){_ = try TaskQualityContractSource.acquire(objectiveSHA256:bad,rootURL:good.root,now:now)}}
  // Optional, separately compiled fault injection: production checks below
  // are unchanged; callbacks expose changes BETWEEN their real observations.
  /* FAULT_TESTS */
  print("VERSIONED_READONLY_CONTRACT_PASS checks=\(checks) model=0 SDK=0 RPC=0 live_registry_writes=0")
 }
}
'''

fault_support = r'''
enum Fault {
 static var action: ((String,URL)throws->Void)?
 static func fire(_ stage:String,_ url:URL)throws {try action?(stage,url)}
}
'''
fault_tests = r'''
  let racePointer=try fixture("race-pointer")
  Fault.action={stage,url in if stage=="reread" && url==racePointer.pointer {Fault.action=nil;let b=try Data(contentsOf:url);try fm.removeItem(at:url);try put(b,url)}}
  try reject("pointer same bytes replaced inode before reread"){_ = try load(racePointer)};Fault.action=nil
  let raceVersion=try fixture("race-version")
  Fault.action={stage,url in if stage=="reread" && url==raceVersion.version {Fault.action=nil;try put(freshBytes+Data([10]),url)}}
  try reject("version changed before reread"){_ = try load(raceVersion)};Fault.action=nil
  let raceParent=try fixture("race-parent")
  Fault.action={stage,url in if stage=="parent" && url.path==raceParent.current.path {Fault.action=nil;try fm.setAttributes([.posixPermissions:0o755],ofItemAtPath:url.path)}}
  try reject("parent changed before recheck"){_ = try load(raceParent)};Fault.action=nil
  let growing=try fixture("growing-after-stat")
  Fault.action={stage,url in if stage=="read" && url==growing.version {Fault.action=nil;let h=try FileHandle(forWritingTo:url);try h.seekToEnd();try h.write(contentsOf:Data(repeating:32,count:256_000));try h.close()}}
  try reject("concurrent append bounded at maximum+1"){_ = try load(growing)};Fault.action=nil
'''

with tempfile.TemporaryDirectory(prefix='os1-versioned-contract-test-') as temp:
    t = Path(temp)
    for mode in ['exact_source', 'separate_fault_injection']:
        body = selector
        support = ''
        inserted = ''
        if mode == 'separate_fault_injection':
            support = fault_support
            inserted = fault_tests
            body = body.replace('        let bytes = try FileHandle(fileDescriptor:', '        try Fault.fire("read", url)\n        let bytes = try FileHandle(fileDescriptor:')
            body = body.replace('            let again = try privateFile(url,', '            try Fault.fire("reread", url)\n            let again = try privateFile(url,')
            body = body.replace('        for (index, url) in parents.enumerated() {', '        for (index, url) in parents.enumerated() {\n            try Fault.fire("parent", url)')
        source = t / (mode + '.swift')
        source.write_text(prefix + support + body + tests.replace('/* FAULT_TESTS */', inserted))
        exe = t / mode
        subprocess.run(['swiftc', '-parse-as-library', str(source), '-o', str(exe)], check=True)
        subprocess.run([str(exe)], check=True)
        print(json.dumps({'mode': mode, 'selector_sha256': hashlib.sha256(selector.encode()).hexdigest(),
                          'test_program_sha256': hashlib.sha256(source.read_bytes()).hexdigest()}))
print('VERSIONED_READONLY_CONTRACT_SOURCE_WIRING_PASS prepare=1 original_boundary=1 exact_selected_isolation_hash=1')
