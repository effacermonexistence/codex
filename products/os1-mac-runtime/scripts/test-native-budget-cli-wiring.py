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
print("ACTUAL_RUN_LIMIT_OPTIONS_PASS: \(checks) checks; no SDK/model/gateway calls")
'''
with tempfile.TemporaryDirectory(prefix='os1-native-budget-cli-') as d:
 p=Path(d);(p/'main.swift').write_text(program);subprocess.run(['swiftc',str(p/'main.swift'),'-o',str(p/'test')],check=True);subprocess.run([str(p/'test')],check=True)
subprocess.run(['swiftc','-frontend','-parse',str(R/'Sources/OS1/main.swift')],check=True)
print(json.dumps({'status':'PASS','helper_sha256':hashlib.sha256(helper.read_bytes()).hexdigest(),'scope':'actual pure Swift options + existing Budget/wiring/syntax, not full CLI typecheck or installed execution','model_calls':0}))
