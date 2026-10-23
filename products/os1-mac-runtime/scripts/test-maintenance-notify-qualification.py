#!/usr/bin/env python3
"""Exact proposed notify allowlist + unchanged file custody; no vendor execution."""
from pathlib import Path
import hashlib,json,subprocess,tempfile
ROOT=Path(__file__).resolve().parents[1]
p=ROOT/'Sources/OS1/TaskQualityRuntime.swift';s=p.read_text()
old='4861d29eb73f6f71a5a82dc94fc7c696d34e8cd6493f1932f6ba7b51f6448cf5';new='2f8ac721dcadb98745c545b6fd0d37f38d48e892d929a7a3b41476838d6a66d5'
rows=s[s.index('    static func rowsEmpty('):s.index('    func bindFile(',s.index('    static func rowsEmpty('))]
binder=s[s.index('    func bindFile('):s.index('    /// Exact audited commands',s.index('    func bindFile('))]
notify=s[s.index('    static let maintenanceNotifyHashes:'):s.index('    func recordVerified(',s.index('    static let maintenanceNotifyHashes:'))]
assert notify.count(old)==1 and notify.count(new)==1
assert 'values.count == 2, values[1] == "turn-ended"' in notify
assert 'values[0].hasSuffix("/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient")' in notify
assert 'try bindFile(values[0], expectedAny: Self.maintenanceNotifyHashes)' in notify
assert all(t in binder for t in ['url.path == path','url.resolvingSymlinksInPath() == url','O_RDONLY | O_NOFOLLOW | O_CLOEXEC','before.st_size < 256_000_000','fstat(fd, &after)','before.st_ino == named.st_ino','expectedAny.map({ $0.contains(hash) })','sourceHashes[path].map({ $0 == hash })'])
program='''import Foundation
import CryptoKit
import Darwin
enum RCCOperationalQuality { enum Failure:Error {case custody,unavailable} }
enum TaskQualityEvidence {static func digest(_ b:Data)->String{SHA256.hash(data:b).map{String(format:"%02x",$0)}.joined()}}
final class SourceVerifier {
 var observedHash = ""
 var calls:[String]=[]
 func bindFile(_ path:String,expectedAny:Set<String>)throws{calls.append(path);guard expectedAny.contains(observedHash)else{throw RCCOperationalQuality.Failure.custody}}
'''+rows+notify+'''}
final class ActualBinder {
 var sourceHashes:[String:String]=[:]
'''+binder+'''}
'''
program+=r'''
@main enum Fixture {
 static func main()throws{
  var n=0
  func check(_ b:Bool)throws{guard b else{throw RCCOperationalQuality.Failure.custody};n+=1}
  func reject(_ action:()throws->Void)throws{do{try action()}catch{n+=1;return};throw RCCOperationalQuality.Failure.custody}
  let v=SourceVerifier(),path="/synthetic/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient"
  try check(SourceVerifier.maintenanceNotifyHashes.count==2)
  for hash in SourceVerifier.maintenanceNotifyHashes{v.observedHash=hash;try v.verifyMaintenanceNotify(["notify":[path,"turn-ended"]]);n+=1}
  v.observedHash=String(repeating:"f",count:64)
  try reject{try v.verifyMaintenanceNotify(["notify":[path,"turn-ended"]])}
  for bad:Any in [false,"",[path],[path,"turn-ended","extra"],[path,"turn-started"],[path,"TURN-ENDED"],[path,"turn-ended "],[path,1],[path+"/extra","turn-ended"],["/other/program","turn-ended"]] {
   let before=v.calls.count;try reject{try v.verifyMaintenanceNotify(["notify":bad])};try check(v.calls.count==before)
  }
  for empty:Any in [NSNull(),[],[:]]{let before=v.calls.count;try v.verifyMaintenanceNotify(["notify":empty]);try check(v.calls.count==before)}
  let before=v.calls.count;try v.verifyMaintenanceNotify([:]);try check(v.calls.count==before)
  let root=FileManager.default.temporaryDirectory.appendingPathComponent("os1-notify-custody-"+UUID().uuidString).resolvingSymlinksInPath()
  try FileManager.default.createDirectory(at:root,withIntermediateDirectories:false)
  defer{try? FileManager.default.removeItem(at:root)}
  let f=root.appendingPathComponent("fixture-only-not-vendor"),data=Data("FAKE_FILE_CUSTODY".utf8),b=ActualBinder()
  try data.write(to:f);let digest=TaskQualityEvidence.digest(data)
  try b.bindFile(f.path,expectedAny:[digest]);try check(b.sourceHashes[f.path]==digest)
  try reject{try ActualBinder().bindFile(f.path,expectedAny:[String(repeating:"0",count:64)])}
  let alias=root.appendingPathComponent("alias");try FileManager.default.createSymbolicLink(at:alias,withDestinationURL:f)
  try reject{try ActualBinder().bindFile(alias.path,expectedAny:[digest])}
  try reject{try ActualBinder().bindFile(root.path,expectedAny:[digest])}
  try reject{try ActualBinder().bindFile(root.path+"/./fixture-only-not-vendor",expectedAny:[digest])}
  let empty=root.appendingPathComponent("empty");try Data().write(to:empty)
  try reject{try ActualBinder().bindFile(empty.path,expectedAny:[digest])}
  let large=root.appendingPathComponent("oversize");FileManager.default.createFile(atPath:large.path,contents:Data())
  let handle=try FileHandle(forWritingTo:large);try handle.truncate(atOffset:256_000_000);try handle.close()
  try reject{try ActualBinder().bindFile(large.path,expectedAny:[digest])}
  let changed=Data("CHANGED_FAKE_FILE".utf8);try changed.write(to:f)
  try reject{try b.bindFile(f.path,expectedAny:[TaskQualityEvidence.digest(changed)])}
  print("MAINTENANCE_NOTIFY_COMPONENT_PASS checks=\(n) vendor_executions=0 SDK=0 model=0")
 }
}
'''
with tempfile.TemporaryDirectory(prefix='os1-notify-component-')as d:
 t=Path(d);f=t/'Fixture.swift';exe=t/'fixture';f.write_text(program)
 subprocess.run(['swiftc','-parse-as-library',str(f),'-o',str(exe)],check=True,capture_output=True,text=True,timeout=60)
 result=subprocess.run([str(exe)],check=True,capture_output=True,text=True,timeout=15);print(result.stdout.strip())
print(json.dumps({'status':'PROPOSED_COMPONENT_ONLY_PENDING_VENDOR_AND_ACTUAL_METADATA_REVIEW','source_sha256':hashlib.sha256(s.encode()).hexdigest(),'actual_bind_file_sha256':hashlib.sha256(binder.encode()).hexdigest(),'vendor_binary_executed':False,'SDK_calls':0,'model_calls':0},sort_keys=True))
