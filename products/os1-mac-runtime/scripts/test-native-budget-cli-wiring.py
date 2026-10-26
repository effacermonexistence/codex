#!/usr/bin/env python3
"""Actual public option parser + legacy Budget bytes; syntax/wiring, no SDK calls."""
from pathlib import Path
import subprocess,tempfile,hashlib,json
R=Path(__file__).resolve().parents[1]
helper=R/'Sources/OS1Context/RCCRunBudgetOptions.swift'
s=(R/'Sources/OS1/main.swift').read_text();run=s[s.index('            case "run":'):s.index('\n            default:',s.index('            case "run":'))]
for flag,field,method in [('--max-native-dispatches','maxNativeDispatches','nativeDispatches'),('--max-parallel','maxParallel','parallelism')]:
 assert f'case "{flag}" where index + 1 < arguments.count && {field} == nil:' in run
 assert f'{field} = try RCCRunBudgetOptions.{method}(arguments[index + 1])' in run
assert run.index('guard (maxNativeDispatches == nil && maxParallel == nil) || (!parallelAgentChild && !parallelFanoutChild)')<run.index('try ParallelAgentRuntime.prepareChild()')
assert 'maxNativeDispatches: maxNativeDispatches, maxParallel: maxParallel,' in run
fn=s[s.index('func runOpenClawRCCTask('):]
assert 'maxNativeDispatches: Int? = nil, maxParallel: Int? = nil' in fn
assert 'maxParallel: maxParallel ?? 4, maxCostUnits: nil' in fn
assert 'maxNativeDispatches: maxNativeDispatches, forbidModelGeneration: forbidModelGeneration ? true : nil' in fn
assert 'maxParallelism: maxParallel ?? 4, expectedRequestSHA256: request.requestSHA256' in fn
progress=fn[fn.index('RCCRuntimeGatewayClient.run(request:'):fn.index('let result = try RCCRuntimeContract.decodeSnapshot(terminal)')]
terminal=fn[fn.index('let graph = try? RCCRuntimeProjection.project(result,'):fn.index('var summary = RunSummary(status: result.state')]
for projection in [progress,terminal]:
 assert 'maxParallelism: maxParallel ?? 4, expectedRequestSHA256: request.requestSHA256' in projection
 assert 'maxParallelism: 4, expectedRequestSHA256: request.requestSHA256' not in projection
assert fn.index('maxNativeDispatches: maxNativeDispatches, forbidModelGeneration:')<fn.index('RCCRuntimeContract.encode(request)')
raw=(R/'Sources/OS1Context/RCCRuntimeContract.swift').read_text();a=raw.index('    public struct Budget:');b=raw.index('    public struct Policy:',a)
# K6: every new owner submission freezes the typed cap at creation; only an
# item an older build saved has none, because the cap is part of Core's submit
# fingerprint for a same-task-ID retry. The App's only `os1 run` argv appends
# the frozen cap outside any condition, before the resume-delivery replacement
# (which takes no budget). The run path has no default for it.
app=(R/'Sources/OS1App/OS1App.swift').read_text()
pending=app[app.index('private struct PendingSubmission:'):app.index('\n}\n',app.index('private struct PendingSubmission:'))]
assert pending.count('    var maxNativeDispatches: Int? = RCCRunBudgetOptions.appNativeDispatches\n')==1
assert app.count('maxNativeDispatches = ')==0,'no path overrides the frozen cap'
helper_fn='static func nativeDispatchArguments(_ cap: Int?) -> [String] {\n        cap.map { ["--max-native-dispatches", String($0)] } ?? []\n    }'
assert app.count(helper_fn)==1 and app.count('--max-native-dispatches')==2,'the helper writes the flag; only the App self-test repeats it'
assert app.count('        maxNativeDispatches: Int?,\n')==2 and app.count('maxNativeDispatches: Int? = nil')==0
assert app.count('maxNativeDispatches: submission.maxNativeDispatches,')==1 and app.count('maxNativeDispatches: maxNativeDispatches,')==1
blocking=app[app.index('    private static func runBlocking('):app.index('let process = Process()',app.index('    private static func runBlocking('))]
cap='arguments += nativeDispatchArguments(maxNativeDispatches)'
assert blocking.count(cap)==1
line=blocking[blocking.rindex('\n',0,blocking.index(cap))+1:blocking.index(cap)]
assert line.strip()=='' and blocking[:blocking.index(cap)].count('{')-blocking[:blocking.index(cap)].count('}')==1,'cap is top-level in runBlocking, not inside an if'
assert blocking.index('"--codex-capacity", String(codexCapacity),')<blocking.index(cap)<blocking.index('arguments = ["resume-delivery", storedID]')
# K12b: the result contract is frozen per submission the same way (it is in
# Core's submit fingerprint too): parsed once by `os1 run`, bound onto the
# Request before it is encoded, negotiated on the terminal snapshot, and
# appended by the App outside any condition from the submission's own field.
assert 'case "--result-contract-version" where index + 1 < arguments.count && resultContractVersion == nil:' in run
assert 'resultContractVersion = try RCCRunBudgetOptions.resultContractVersion(arguments[index + 1])' in run
assert 'interpreterRecord: interpreterRecord,\n                            resultContractVersion: resultContractVersion)' in run
assert fn.index('candidateRequest.resultContractVersion = resultContractVersion')<fn.index('RCCRuntimeContract.encode(request)')
assert fn.index('let result = try RCCRuntimeContract.decodeSnapshot(terminal)')<fn.index('guard RCCRuntimeContract.negotiated(result, resultContractVersion: request.resultContractVersion) else {')<fn.index('var summary = RunSummary(status: result.state')
assert pending.count('    var resultContractVersion: Int? = RCCRunBudgetOptions.appResultContractVersion\n')==1
assert app.count('submission.resultContractVersion =')==0 and app.count('retry.resultContractVersion =')==0,'no path overrides the frozen contract'
assert app.count('resultContractVersion: submission.resultContractVersion,')==1 and app.count('resultContractVersion: resultContractVersion,')==1
contract='arguments += resultContractArguments(resultContractVersion)'
assert blocking.count(contract)==1
line=blocking[blocking.rindex('\n',0,blocking.index(contract))+1:blocking.index(contract)]
assert line.strip()=='' and blocking[:blocking.index(contract)].count('{')-blocking[:blocking.index(contract)].count('}')==1,'contract is top-level in runBlocking, not inside an if'
assert blocking.index(cap)<blocking.index(contract)<blocking.index('arguments = ["resume-delivery", storedID]')
# K12b: the CLI names a partial answer's coverage before its output, outside
# any other condition of the Core summary.
summary=s[s.index('func printRunSummary(_ summary: RunSummary) {'):s.index('\n}\n',s.index('func printRunSummary(_ summary: RunSummary) {'))]
label='        if let partial = core.result?.partial { print("[" + partial.coverage.label() + "]") }\n'
assert summary.count(label)==1 and s.count('partial.coverage.label()')==1
assert summary.index('    if let core = summary.rccRuntime {\n')<summary.index(label)<summary.index('        if let result = core.result, !result.output.isEmpty { print(result.output) }')
# The value is Core's own two-per-node reserve over its largest admissible plan:
# raising the 8-node/8-obligation bound or max_attempts must raise the cap.
rt=(R/'Resources/openclaw-os1-bridge/rcc-runtime.mjs').read_text()
for anchor in ['plan.nodes.length > 0 && plan.nodes.length <= 8 &&','c.obligations.length >= 2 && c.obligations.length <= 8',
 'task.budget.max_native_dispatches >= collection.obligations.length * 2','cap - current.native_dispatches >= 2']: assert rt.count(anchor)==1,anchor
assert s.count('budget: .init(maxAttempts: 2, maxParallel: maxParallel ?? 4')==1
assert (R/'Sources/OS1/RCCOwnerCollection.swift').read_text().count('(2...8).contains(spec.obligations.count)')==1
assert raw.count('(2...8).contains(collection.obligations.count)')==1
program=helper.read_text()+'\nenum C {\n'+raw[a:b]+'}\n'+r'''
var checks=0
func check(_ value: Bool) { if !value { fatalError("budget parser regression") }; checks += 1 }
for n in [1,2,4,64] { check(try RCCRunBudgetOptions.nativeDispatches(String(n)) == n) }
for n in [1,2,4,8] { check(try RCCRunBudgetOptions.parallelism(String(n)) == n) }
for value in ["", "0", "01", "-1", "+1", " 1", "1 ", "1.0", "1e0", "true", "null", "１", "999999999999999999999999", "65"] {
 do { _ = try RCCRunBudgetOptions.nativeDispatches(value); fatalError("invalid native accepted") } catch { checks += 1 }
}
for value in ["0", "9", "64", "-1", "01", " 2", "2.5"] {
 do { _ = try RCCRunBudgetOptions.parallelism(value); fatalError("invalid parallel accepted") } catch { checks += 1 }
}
let old=C.Budget(maxAttempts:2,maxParallel:4,maxCostUnits:nil,maxDurationMS:3600000)
let encode=JSONEncoder();encode.outputFormatting=[.sortedKeys]
let original=try JSONSerialization.jsonObject(with:encode.encode(old)) as! [String:Any]
check(original["max_native_dispatches"] == nil && original["forbid_model_generation"] == nil && original["max_parallel"] as? Int == 4)
let limited=C.Budget(maxAttempts:2,maxParallel:try RCCRunBudgetOptions.parallelism("2"),maxCostUnits:nil,maxDurationMS:3600000,maxNativeDispatches:try RCCRunBudgetOptions.nativeDispatches("4"),forbidModelGeneration:true)
let round=try JSONDecoder().decode(C.Budget.self,from:encode.encode(limited))
check(round.maxNativeDispatches == 4 && round.maxParallel == 2 && round.forbidModelGeneration == true)
check(RCCRunBudgetOptions.appNativeDispatches == 2 * 8)
check(try RCCRunBudgetOptions.nativeDispatches(String(RCCRunBudgetOptions.appNativeDispatches)) == RCCRunBudgetOptions.appNativeDispatches)
for n in [1,2] { check(try RCCRunBudgetOptions.resultContractVersion(String(n)) == n) }
for value in ["", "0", "3", "02", "-1", " 2", "2.0", "v2", "true"] {
 do { _ = try RCCRunBudgetOptions.resultContractVersion(value); fatalError("invalid result contract accepted") } catch { checks += 1 }
}
check(RCCRunBudgetOptions.appResultContractVersion == 2)
print("ACTUAL_RUN_LIMIT_OPTIONS_PASS: \(checks) checks; no SDK/model/gateway calls")
'''
with tempfile.TemporaryDirectory(prefix='os1-native-budget-cli-') as d:
 p=Path(d);(p/'main.swift').write_text(program);subprocess.run(['swiftc',str(p/'main.swift'),'-o',str(p/'test')],check=True);subprocess.run([str(p/'test')],check=True)
subprocess.run(['swiftc','-frontend','-parse',str(R/'Sources/OS1/main.swift')],check=True)
print(json.dumps({'status':'PASS','helper_sha256':hashlib.sha256(helper.read_bytes()).hexdigest(),'scope':'actual pure Swift options + existing Budget/wiring/syntax, not full CLI typecheck or installed execution','model_calls':0}))
