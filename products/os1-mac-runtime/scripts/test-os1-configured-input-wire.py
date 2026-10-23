#!/usr/bin/env python3
"""Actual native-preparation helper + real Context objects; fake file, no SDK/model.
Requires the OS1ContextTests product to have been built in this worktree. The
main.swift check is source wiring, not proof a provider consumed its channels.
"""
from pathlib import Path
import subprocess, tempfile, json, hashlib
ROOT=Path(__file__).resolve().parents[1]
main=(ROOT/'Sources/OS1/main.swift').read_text()
helper=ROOT/'Sources/OS1/RCCNativeConfiguredInput.swift'
body=helper.read_text()
assert '_NSGetExecutablePath' in body and 'currentOS1Executable()' not in body and 'Bundle.main' not in body
assert 'O_RDONLY | O_NOFOLLOW | O_CLOEXEC' in body
assert 'maximumExecutableBytes: Int64 = 512 * 1024 * 1024' in body
assert body.index('before.st_size <= maximumExecutableBytes') < body.index('while true {')
assert 'onConfiguredInput: ((RCCNativeConfiguredInput) -> Void)? = nil' in main
codex=main[main.index('            if appServer.ownsThreadWriter {\n                executedDesktopVisibility'):main.index('        } catch {\n            // No alternate turn',main.index('            if appServer.ownsThreadWriter {\n                executedDesktopVisibility'))]
assert codex.index('onConfiguredInput?') < codex.index('turn = try appServer.runTurn(')
assert codex.index('onConfiguredInput?') < codex.index('            } else {')
assert codex.count('onConfiguredInput?') == 1  # no Desktop/foreign-writer capture
claude=main[main.index('        let launch = try fullAccessPaths.isEmpty ?'):main.index('            onLaunch: {',main.index('        let launch = try fullAccessPaths.isEmpty ?'))]
assert claude.index('onConfiguredInput?') < claude.index('do { raw = try commandOutput(')
assert 'instructions: configuredSystemInstructions' in claude
assert main.index('let configuredSystemInstructions = arguments[systemIndex + 1]') < main.index('if projectlessRead && !sourceOnly && !chatLane { arguments.insert("--safe-mode", at: 1) }')
adapter=main[main.index('private func rccNativeAdapter('):]
assert adapter.index('let delegated = RCCDelegatedEnvelope.prompt(') < adapter.index('let nativePrompt = try providerPrompt(') < adapter.index('onConfiguredInput: { prepared in')
assert 'record.configuredInputObservation = try? prepared.observation(ticket: t, delegated: delegated,' in adapter
assert 'catalog: configuredInventory, catalogObservedAtMS: configuredInventoryAtMS' in adapter
assert 'if let configuredInventory {' in adapter
assert 'executionConfiguration: try? RCCRuntimeContract.encode(codexConfigOverrides)' in codex
assert 'executionConfiguration: try? RCCRuntimeContract.encode(arguments)' in claude
build=ROOT/'.build/debug'
objects=list((build/'OS1Context.build').glob('*.o'))+list((build/'OS1System.build').glob('*.o'))
assert objects, 'Build OS1ContextTests first; do not substitute preinstalled module objects'
program=r'''
import Foundation
import OS1Context
@main enum Fixture {
 static func main() throws {
  func check(_ condition:Bool,_ message:String) { precondition(condition,message) }
  let root=FileManager.default.temporaryDirectory.appendingPathComponent("os1-configured-helper-"+UUID().uuidString)
  try FileManager.default.createDirectory(at:root,withIntermediateDirectories:false,attributes:[.posixPermissions:0o700])
  defer { try? FileManager.default.removeItem(at:root) }
  let native=root.appendingPathComponent("fake-native-not-executed"), bytes=Data("NATIVE_FIXTURE_BYTES_ONLY".utf8)
  try bytes.write(to:native)
  let hash=String(repeating:"a",count:64), request="A synthetic translation request."
  let cfg=RCCRuntimeContract.ExactConfig(surface:.codex,transport:.codexAppServer,accountID:"fixture",model:"fixture",effort:.low,
    tools:[],scope:.readOnly,permissionProfile:.readOnly,quotaPool:.openAICodex,allowedPaths:[],configurationSHA256:hash)
  let ticket=RCCRuntimeContract.ExecutionTicket(taskID:UUID().uuidString.lowercased(),nodeID:"node-0",attemptID:UUID().uuidString.lowercased(),candidateID:"fixture",
    requestSHA256:RCCRuntimeContract.digest(Data(request.utf8)),policySHA256:hash,policySourceSHA256:hash,sourceFingerprint:hash,
    configurationSHA256:hash,selectedConfig:cfg,objective:request,instruction:request,contextRefs:[],ownedPaths:[],originalRequest:request)
  let prepared=RCCNativeConfiguredInput(channel:"codex_developer",prompt:"원문🙂",instructions:"DEV_FIXTURE_ONLY",baseInstructions:nil,
    nativeExecutable:native.path,sessionState:"new",executionConfiguration:Data("[]".utf8))
  let result=try prepared.observation(ticket:ticket,delegated:"DELEGATED",catalog:Data("typed native inventory".utf8),catalogObservedAtMS:0)
  check(result.providerInput.utf8Bytes=="원문🙂".utf8.count,"UTF8 byte count is exact, not character/token count")
  check(result.providerInput.sha256==RCCRuntimeContract.digest(Data("원문🙂".utf8)),"actual provider input digest")
  check(result.launchEntrySHA256==RCCRuntimeContract.digest(bytes),"selected fake launch bytes read, not backend image")
  check(result.harnessSHA256==RCCRuntimeContract.digest(try Data(contentsOf:Bundle.main.executableURL!)),"actual current helper harness, not stable installed os1")
  check(result.baseInstructions==nil && !result.backendInclusionVerified && !result.qualityCertified && !result.executionAuthorized,"no hidden-state upgrades")
  let unavailable=RCCNativeConfiguredInput(channel:"codex_developer",prompt:"fixture",instructions:"fixture",baseInstructions:nil,
    nativeExecutable:native.path,sessionState:"new",executionConfiguration:nil)
  do { _=try unavailable.observation(ticket:ticket,delegated:"DELEGATED",catalog:Data("catalog".utf8),catalogObservedAtMS:0); fatalError("unknown config became observed") } catch {}
  for path in [root.path, root.appendingPathComponent("missing").path] {
    do { _=try RCCNativeConfiguredInput.executableSHA256(path); fatalError("non-file accepted") } catch {}
  }
  let empty=root.appendingPathComponent("empty"); try Data().write(to:empty)
  do { _=try RCCNativeConfiguredInput.executableSHA256(empty.path); fatalError("empty file accepted") } catch {}
  let large=root.appendingPathComponent("sparse-256MiB"), maxPlus=root.appendingPathComponent("sparse-over512MiB")
  FileManager.default.createFile(atPath:large.path,contents:Data())
  var file=try FileHandle(forWritingTo:large); try file.truncate(atOffset:268435456); try file.close()
  check(try RCCNativeConfiguredInput.executableSHA256(large.path)=="SPARSE256SHA","current >200MB native launch entries fit bounded512MiB read")
  FileManager.default.createFile(atPath:maxPlus.path,contents:Data())
  file=try FileHandle(forWritingTo:maxPlus); try file.truncate(atOffset:UInt64(RCCNativeConfiguredInput.maximumExecutableBytes)+1); try file.close()
  do { _=try RCCNativeConfiguredInput.executableSHA256(maxPlus.path); fatalError("over512MiB accepted") } catch {}
  print("ACTUAL_NATIVE_CONFIGURED_INPUT_HELPER_PASS: 11 checks; native/model calls 0; no provider channel-consumption claim")
 }
}
'''
zeros=hashlib.sha256()
for _ in range(256): zeros.update(bytes(1024*1024))
program=program.replace('SPARSE256SHA',zeros.hexdigest())
with tempfile.TemporaryDirectory(prefix='os1-input-helper-wire-') as d:
 p=Path(d);source=p/'Fixture.swift';source.write_text(program);binary=p/'fixture'
 subprocess.run(['swiftc','-parse-as-library',str(helper),str(source),'-I',str(build/'Modules'),'-Xcc','-fmodule-map-file='+str(build/'OS1System.build/module.modulemap'),'-Xcc','-I'+str(ROOT/'Sources/OS1System/include'),*[str(o) for o in objects],'-o',str(binary)],check=True)
 subprocess.run([str(binary)],check=True)
print(json.dumps({'status':'PASS','scope':'actual helper + source hook checks, not native SDK execution','main_sha256':hashlib.sha256(main.encode()).hexdigest(),'helper_sha256':hashlib.sha256(body.encode()).hexdigest(),'provider_calls':0,'model_calls':0}))
