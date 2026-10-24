#!/usr/bin/env python3
"""Exact-source native argv + existing OS guard, private canaries, zero model calls."""
from pathlib import Path
import os, re, subprocess, tempfile, sys

R = Path(__file__).resolve().parents[1]
main = (R / 'Sources/OS1/main.swift').read_text()
parallel = (R / 'Sources/OS1/ParallelAgentCoordinator.swift').read_text()

def function(source, name):
    match = re.search(r'(?:private )?(?:static )?func ' + re.escape(name) + r'\(', source)
    assert match, name
    start = match.start(); opening = source.index('{', match.end()); depth = 1; end = opening + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}'); end += 1
    return source[start:end].replace('private func ', 'func ')

roots = ([Path(os.environ['OS1_CONTEXT_TEST_BUILD_ROOT'])] if os.environ.get('OS1_CONTEXT_TEST_BUILD_ROOT') else []) + [
    R / '.build/arm64-apple-macosx/debug', R / '.build-release-arm64/arm64-apple-macosx/release']
build = next((p for p in roots if (p / 'Modules/OS1Context.swiftmodule').is_file()), None)
assert build, 'Build the current OS1Context target first (or set OS1_CONTEXT_TEST_BUILD_ROOT)'
code = '''import Foundation
import Darwin
import OS1Context
enum OS1Error: Error { case message(String) }
enum ParallelAgentRuntime {
    static let managedDelegation = false
    static let managedClaudeDeniedTools = ["Agent", "Task"]
''' + function(parallel, 'claudeDenyArguments') + '\n}\n'
for name in ['claudeDelegatedReadOnlySettings', 'claudeEmptyMCPConfiguration']:
    code += next(line for line in main.splitlines() if line.startswith('let ' + name + ' =')) + '\n'
for name in ['claudeSettingsDisablingHooks', 'claudePermissionArguments', 'claudeArguments', 'fullAccessResumeArguments']:
    code += function(main, name) + '\n'
code += r'''
var checks = 0
@MainActor func require(_ value: Bool, _ message: String) { if !value { fatalError(message) }; checks += 1 }
let root = URL(fileURLWithPath: CommandLine.arguments[1]).resolvingSymlinksInPath()
let workspace = root.appendingPathComponent("workspace space"), source = root.appendingPathComponent("protected-source"), home = root.appendingPathComponent("provider-home")
for path in [workspace, source, home] { try FileManager.default.createDirectory(at:path,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700]) }
let target = workspace.appendingPathComponent("labels.py"), sourceFile = source.appendingPathComponent("source.txt"), log = home.appendingPathComponent("native.jsonl")
try Data("UNCHANGED\n".utf8).write(to:target); try Data("SOURCE\n".utf8).write(to:sourceFile)
let protection = try OS1SourceConfinement.readOnlyProtection(workspace:workspace.path,additionalProtectedPaths:[source.path],home:home)
func canonical(_ path:String) -> String { let pointer = realpath(path,nil)!; defer { free(pointer) }; return String(cString:pointer) }
let canonicalWorkspace = canonical(workspace.path), canonicalSource = canonical(source.path)
require(protection.workspace == canonicalWorkspace && protection.protectedPaths.contains(canonicalSource), "canonical workspace/source lost")
require(protection.profile.contains("file-write-unlink") && protection.profileSHA256.count == 64, "ancestor/profile binding missing")
let dataAlias = "/System/Volumes/Data" + canonicalWorkspace
if FileManager.default.fileExists(atPath:dataAlias) {
    let reversed = try OS1SourceConfinement.readOnlyProtection(workspace:dataAlias,home:home)
    require(reversed.protectedPaths.contains(canonicalWorkspace) && reversed.protectedPaths.contains(dataAlias), "Data-volume input lost reverse firmlink alias")
}
for collision in [home.path, root.path] {
    do { _ = try OS1SourceConfinement.readOnlyProtection(workspace:collision,home:home); fatalError("provider-state collision admitted") }
    catch OS1SourceConfinement.ReadOnlyProtectionError.providerStateCollision { checks += 1 }
}
do { _ = try OS1SourceConfinement.readOnlyProtection(workspace:workspace.path,additionalProtectedPaths:[home.path],home:home); fatalError("source protection collides with provider state") }
catch OS1SourceConfinement.ReadOnlyProtectionError.providerStateCollision { checks += 1 }
if FileManager.default.fileExists(atPath:"/System/Volumes/Data" + canonical(home.path)) {
    do { _ = try OS1SourceConfinement.readOnlyProtection(workspace:"/System/Volumes/Data",home:home); fatalError("Data-root provider-state collision admitted") }
    catch OS1SourceConfinement.ReadOnlyProtectionError.providerStateCollision { checks += 1 }
}
@MainActor func args(protection p:OS1SourceConfinement.ReadOnlyProtection?=protection, sourceOnly:Bool=false, memory:String?=nil, full:[String]=[], confined:[String]=[]) throws -> [String] {
    try claudeArguments(model:"fixture",effort:"high",instructions:"fixture",sessionID:UUID().uuidString.lowercased(),startNewSession:true,title:"fixture",permissionProfile:"read_only",prompt:"fixture",sourceContextOnly:sourceOnly,memoryConfiguration:memory,confinedPaths:confined,fullAccessProtectedPaths:full,managedDelegation:true,interactiveHooksDisabled:true,readOnlyProtection:p)
}
let arguments = try args()
require(!arguments.contains("bypassPermissions") && arguments.contains("dontAsk"), "RO acquired bypass")
let si = arguments.firstIndex(of:"--settings")!, settings = try JSONSerialization.jsonObject(with:Data(arguments[si+1].utf8)) as! [String:Any]
let sandbox = settings["sandbox"] as! [String:Any], filesystem = sandbox["filesystem"] as! [String:Any]
require(sandbox["enabled"] as? Bool == false && sandbox["failIfUnavailable"] as? Bool == true && sandbox["allowUnsandboxedCommands"] as? Bool == false, "only redundant inner sandbox must be disabled under mandatory outer guard")
require(filesystem["disabled"] as? Bool == false && filesystem["denyWrite"] as? [String] == protection.protectedPaths, "workspace denyWrite lost")
require(settings["disableAllHooks"] as? Bool == true, "hook suppression lost while merging settings")
let di = arguments.firstIndex(of:"--disallowedTools")!, denies = arguments[di+1].split(separator:",").map(String.init)
require(["Write","Edit","MultiEdit","NotebookEdit","mcp__*","Agent","Task"].allSatisfy(denies.contains), "native write/delegation denies lost")
let tools = arguments[arguments.firstIndex(of:"--tools")!+1]
require(tools.contains("Read") && tools.contains("Bash"), "capability silently downgraded")
for make in [{try args(protection:nil)}, {try args(full:[source.path])}, {try args(confined:[source.path])}] {
    do { _ = try make(); fatalError("RO missing/foreign write guard admitted") } catch { checks += 1 }
}
let toolFree = try args(protection:nil,sourceOnly:true)
require(toolFree.contains("--safe-mode") && toolFree[toolFree.firstIndex(of:"--tools")!+1].isEmpty, "tool-free safe mode not closed")
let memory = "{\"mcpServers\":{\"os1_memory\":{\"command\":\"/fixture/os1\"}}}"
do { _ = try args(protection:nil,sourceOnly:true,memory:memory); fatalError("unprotected nonempty MCP mislabelled tool-free") } catch { checks += 1 }
require(try args(sourceOnly:true,memory:memory).contains(memory), "guarded explicit memory configuration was lost")
let launch = try fullAccessResumeArguments(executable:"/bin/sh",arguments:arguments,protectedPaths:protection.protectedPaths)
require(launch.0 == "/usr/bin/sandbox-exec" && Array(launch.1.suffix(arguments.count)) == arguments && !launch.1.contains("bypassPermissions"), "neutral wrapper altered permission args")
require(launch.1[0] == "-p" && launch.1[1] == protection.profile && launch.1[2] == "/bin/sh", "actual launch/profile binding mismatch")
// Current host contracts have no vendor-specific network enforcement field.
// Unsupported explicit requirements fail before dispatch, not silently vanish.
let host = RCCRuntimeContract.HostContext(workspace:workspace.path,context:nil,providerPreference:"auto",codexSessionID:nil,claudeSessionID:nil,requireReadOnly:true,ownerPolicy:nil)
let hostBytes = try RCCRuntimeContract.encode(host), text = "fixture request", ph = RCCRuntimeContract.digest(Data("fixture policy".utf8))
let request = RCCRuntimeContract.Request(taskID:"fixture-task",request:text,requestSHA256:RCCRuntimeContract.digest(Data(text.utf8)),objective:text,policySHA256:ph,sourceFingerprint:RCCRuntimeContract.digest(hostBytes),mode:.auto,materialRefs:[],budget:.init(maxAttempts:1,maxParallel:1,maxCostUnits:nil,maxDurationMS:60000),hostContext:host)
let requestBytes = try RCCRuntimeContract.encode(request)
require(try RCCRuntimeContract.decodeRequest(requestBytes) == request, "valid host contract must pass before rejection can count")
for key in ["require_vendor_network_sandbox", "network_policy"] {
    var object = try JSONSerialization.jsonObject(with:requestBytes) as! [String:Any]
    var owner = object["host_context"] as! [String:Any]; owner[key] = true; object["host_context"] = owner
    do { _ = try RCCRuntimeContract.decodeRequest(JSONSerialization.data(withJSONObject:object)); fatalError("unsupported explicit network requirement silently relaxed") }
    catch { checks += 1 }
}
// Adversarial user-wide Bash approval and excludedCommands cannot remove an
// inherited OS profile. Invoke the real shell/Python directly as if excluded.
let inheritedAllows = ["Bash", "Write"], inheritedExclusions = ["cat", "python3"]
require(inheritedAllows.contains("Bash") && inheritedExclusions.contains("python3"), "adversarial fixture missing")
@MainActor func run(_ executable:String,_ argv:[String]) throws -> (Int32,Data,Data) {
    let prepared = try fullAccessResumeArguments(executable:executable,arguments:argv,protectedPaths:protection.protectedPaths)
    let process = Process(), out = Pipe(), err = Pipe(); process.executableURL = URL(fileURLWithPath:prepared.0); process.arguments = prepared.1
    process.currentDirectoryURL = workspace; process.environment = ["PATH":"/usr/bin:/bin", "HOME":home.path, "TMPDIR":home.path+"/"]
    process.standardOutput = out; process.standardError = err; try process.run(); process.waitUntilExit()
    let stdout = out.fileHandleForReading.readDataToEndOfFile(), stderr = err.fileHandleForReading.readDataToEndOfFile()
    if !stderr.isEmpty { print("READ_ONLY_CANARY_STDERR_BEGIN\n" + String(decoding:stderr,as:UTF8.self) + "READ_ONLY_CANARY_STDERR_END") }
    return (process.terminationStatus,stdout,stderr)
}
let positive = try run("/bin/sh",["-c", #"cat "$1"; test "$((17*19))" = 323; printf provider > "$2""#, "fixture",target.path,log.path])
let nativeLogBytes = try Data(contentsOf:log)
require(positive.0 == 0 && positive.1 == Data("UNCHANGED\n".utf8) && nativeLogBytes == Data("provider".utf8), "read/compute/provider state must work before accepting a denial")
for command in [#"printf CHANGED > "$1""#, #"mkdir "$1/.claude""#, #"mv "$1" "$1-moved""#, #"ln "$1" "$2" && printf CHANGED > "$2""#] {
    let first = command.contains("mkdir") || command.contains("mv") ? workspace.path : target.path
    let raw = try run("/bin/sh",["-c", command,"fixture",first,home.appendingPathComponent("hardlink").path])
    let unchanged = try Data(contentsOf:target)
    require(raw.0 != 0 && String(decoding:raw.2,as:UTF8.self).contains("Operation not permitted") && unchanged == Data("UNCHANGED\n".utf8), "actual shell write/rename/link guard failed")
}
let python = CommandLine.arguments[2]
let py = try run(python,["-I","-B","-c","import sys;open(sys.argv[1],'w').write('CHANGED')",target.path])
require(py.0 != 0 && String(decoding:py.2,as:UTF8.self).contains("Operation not permitted"), "excluded Python escaped outer guard")
let src = try run("/bin/sh",["-c",#"printf CHANGED > "$1""#,"fixture",sourceFile.path])
let unchangedSource = try Data(contentsOf:sourceFile)
require(src.0 != 0 && unchangedSource == Data("SOURCE\n".utf8), "additional source root escaped")
print("Claude read-only enforcement: \(checks) exact-source argv/OS checks PASS; model/native provider/SDK/RPC calls0")
'''
with tempfile.TemporaryDirectory(prefix='os1-readonly-argv-os-') as directory:
    directory = Path(directory); swift = directory / 'main.swift'; swift.write_text(code); binary = directory / 'fixture'
    objects = sorted((build / 'OS1Context.build').glob('*.o')) + sorted((build / 'OS1System.build').glob('*.o'))
    subprocess.run(['swiftc', '-swift-version', '6', '-I', str(build / 'Modules'), '-Xcc',
        '-fmodule-map-file=' + str(build / 'OS1System.build/module.modulemap'), str(swift), *map(str,objects), '-lsqlite3', '-o', str(binary)], check=True)
    subprocess.run([str(binary),str(directory/'private'),sys.executable],check=True,timeout=30)

# No new filesystem scan, no runtime-owned retry, and a positive measured
# delta cannot be overwritten by the former read-only `none` normalization.
adapter = main[main.index('private func rccNativeAdapter('):main.index('/// A route-all order', main.index('private func rccNativeAdapter('))]
assert adapter.index('RCCNativeAttemptOutcome.readOnlyWorkspaceChange') < adapter.index('timing.mark(.receiptPersistStarted)')
assert 'record.executionVerified = false; record.taskVerified = false' in adapter
assert 'record.sideEffects = changed.sideEffects; record.error = changed.error' in adapter
assert 'global_no_effects_proof' in adapter and 'configured_inherited_os_workspace_source_guard_v2_outer_only' in adapter
assert '"vendor_network_sandbox_enforced": false' in adapter
assert 'onReadOnlyProtection: { readOnlyProtection = $0 }' in adapter
assert '''let protectedSourceRoot = LocalProjectWorkspace.root(containing: executionWorkspace, projectID: "os1-clodex")
                ?? OS1SourceWatch.containedRoot(workspace: executionWorkspace)''' in main
assert 'let sourcePaths = protectedSourceRoot.map { OS1SourceConfinement.protectedPaths(root: $0) } ?? []' in main
assert main.index('Immutable read-only Claude ticket cannot resume full access') < main.index('let previousSessionID = try normalizedSessionID(providerSessionID)', main.index('Immutable read-only Claude ticket cannot resume full access'))
print('PASS: RO immutable predispatch/effect-HOLD wiring retained; model calls0')
