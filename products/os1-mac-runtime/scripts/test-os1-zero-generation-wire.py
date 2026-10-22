#!/usr/bin/env python3
"""Compile the ACTUAL Budget source in isolation; inspect ordinary CLI wiring.
No native/SDK or model execution. This does not claim full main.swift typecheck
or installed CLI execution. The broader existing source checks remain separate.
"""
from pathlib import Path
import subprocess, tempfile, json, hashlib
ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'Sources/OS1Context/RCCRuntimeContract.swift').read_text()
main=(ROOT/'Sources/OS1/main.swift').read_text()
a=source.index('    public struct Budget:');b=source.index('    public struct Policy:',a)
budget=source[a:b]
assert 'forbidModelGeneration = "forbid_model_generation"' in budget
assert '? try c.decode(Bool.self, forKey: .forbidModelGeneration) : nil' in budget
assert '"forbid_model_generation"' in source[source.index('private static let budgetShape'):source.index('private static let policyShape')]
run_start=main.index('            case "run":')
run_end=main.index('\n            default:',run_start)
run=main[run_start:run_end]
assert 'case "--forbid-model-generation" where !forbidModelGeneration:' in run
assert run.index('guard !forbidModelGeneration || (!parallelAgentChild && !parallelFanoutChild)') < run.index('try ParallelAgentRuntime.prepareChild()')
assert 'forbidModelGeneration: forbidModelGeneration,' in run
fn=main[main.index('func runOpenClawRCCTask('):]
assert 'forbidModelGeneration: Bool = false' in fn
assert 'forbidModelGeneration: forbidModelGeneration ? true : nil' in fn
assert fn.index('forbidModelGeneration: forbidModelGeneration ? true : nil') < fn.index('let data = try RCCRuntimeContract.encode(request)')
program='import Foundation\nenum RCCRuntimeContract {\n'+budget+'}\n'+r'''
func require(_ x: Bool, _ label: String) { if !x { fatalError(label) } }
let prefix = "{\"max_attempts\":2,\"max_parallel\":4,\"max_cost_units\":null,\"max_duration_ms\":10000"
for (suffix, expected) in [("}", nil), (",\"forbid_model_generation\":true}", true), (",\"forbid_model_generation\":false}", false)] as [(String, Bool?)] {
 let b = try JSONDecoder().decode(RCCRuntimeContract.Budget.self, from: Data((prefix+suffix).utf8))
 require(b.forbidModelGeneration == expected, "typed roundtrip")
 let obj = try JSONSerialization.jsonObject(with: JSONEncoder().encode(b)) as! [String:Any]
 require((obj["forbid_model_generation"] == nil) == (expected == nil), "absent legacy field unchanged")
}
for raw in ["null", "0", "1", "\"true\"", "{}", "[]"] {
 do { _ = try JSONDecoder().decode(RCCRuntimeContract.Budget.self, from: Data((prefix+",\"forbid_model_generation\":"+raw+"}").utf8)); fatalError("malformed flag accepted") } catch {}
}
let old=RCCRuntimeContract.Budget(maxAttempts:2,maxParallel:4,maxCostUnits:nil,maxDurationMS:10000)
let zero=RCCRuntimeContract.Budget(maxAttempts:2,maxParallel:4,maxCostUnits:nil,maxDurationMS:10000,forbidModelGeneration:true)
require(old.forbidModelGeneration == nil && zero.forbidModelGeneration == true, "ordinary default preserved")
print("ACTUAL_BUDGET_SOURCE_ROUNDTRIP_PASS: absent/false/true; malformed rejected")
'''
with tempfile.TemporaryDirectory(prefix='os1-hard-zero-wire-') as d:
 p=Path(d);(p/'Budget.swift').write_text(program)
 subprocess.run(['swiftc',str(p/'Budget.swift'),'-o',str(p/'budget-test')],check=True)
 subprocess.run([str(p/'budget-test')],check=True)
subprocess.run(['swiftc','-frontend','-parse',str(ROOT/'Sources/OS1/main.swift')],check=True)
print(json.dumps({'status':'PASS','actual_budget_source_sha256':hashlib.sha256(budget.encode()).hexdigest(),'cli':'source-wiring + Swift syntax parse only; no installed execution','sdk_calls':0,'model_calls':0}))
