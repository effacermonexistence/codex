#!/usr/bin/env python3
"""Synthetic, isolated regression of the exact production delta sampler.

Run after `swift build --product OS1ContextTests`. No native model, app session,
production telemetry or network is used. This is not measured uplift evidence.
"""
import pathlib
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parent.parent
source = (root / "Sources/OS1App/GovernanceMonitorView.swift").read_text()
start = "// BEGIN GOVERNANCE MONITOR DELTA SAMPLER"
end = "// END GOVERNANCE MONITOR DELTA SAMPLER"
assert source.count(start) == source.count(end) == 1
sampler = source.split(start, 1)[1].split(end, 1)[0]
modules = list((root / ".build").glob("*/debug/Modules/OS1Context.swiftmodule"))
assert len(modules) == 1, "Build OS1ContextTests first; select one exact module"
build = modules[0].parent.parent
fixture = r'''
var checks = 0
func check(_ value: Bool, _ label: String) {
    precondition(value, label); checks += 1
}
var sampler = GovernanceMonitorDeltaSampler()
let t = Date(timeIntervalSince1970: 1000)
check(GovernanceMonitorDeltaSampler.evidence(nil) == nil, "no comparison is no evidence")
sampler.observe(context: "a", evidence: "real-cohort-1", at: t, tokenSavings: -0.2, completionDelta: 0.1)
check(sampler.history.points.count == 1, "one observation")
for i in 1...180 {
    sampler.observe(context: "a", evidence: "real-cohort-1", at: t.addingTimeInterval(Double(i)),
                    tokenSavings: -0.2, completionDelta: 0.1)
}
check(sampler.history.points.count == 1, "180 unchanged heartbeats are not 180 experiments")
check(sampler.history.points[0].tokenSavings == -0.2, "negative token change survives")
let visible = sampler.history.points.filter { $0.id >= t.addingTimeInterval(60) }
check(visible.isEmpty, "aged-out observation does not fabricate a fresh chart point")
sampler.observe(context: "a", evidence: "real-cohort-2", at: t.addingTimeInterval(181),
                tokenSavings: 0, completionDelta: -0.1)
check(sampler.history.points.count == 2, "changed evidence is recorded")
check(sampler.history.points.last?.tokenSavings == 0, "measured zero stays zero")
sampler.observe(context: "a", evidence: nil, at: t.addingTimeInterval(182), tokenSavings: nil, completionDelta: nil)
check(sampler.history.points.isEmpty, "missing comparison clears stale history")
sampler.observe(context: "a", evidence: "partial", at: t.addingTimeInterval(183), tokenSavings: nil, completionDelta: 0.1)
check(sampler.history.points.count == 1 && sampler.history.points[0].tokenSavings == nil,
      "partial measurement never prices unknown tokens as zero")
sampler.observe(context: "b", evidence: "other-cohort", at: t.addingTimeInterval(184), tokenSavings: 0.3, completionDelta: 0.2)
check(sampler.history.points.count == 1, "filter/baseline change resets cohort history")
print("Governance delta sampler: \(checks) checks passed (synthetic isolated fixtures)")
'''
with tempfile.TemporaryDirectory(prefix="os1-governance-sampler-fixture-") as directory:
    tmp = pathlib.Path(directory)
    swift = tmp / "sampler.swift"
    swift.write_text("import Foundation\nimport OS1Context\n" + sampler + fixture)
    objects = sorted((build / "OS1Context.build").glob("*.o")) + sorted((build / "OS1System.build").glob("*.o"))
    assert objects, "Exact build object files unavailable"
    executable = tmp / "sampler"
    subprocess.run(["swiftc", "-I", str(build / "Modules"), "-I", str(build / "OS1System.build"),
                    str(swift), *map(str, objects), "-o", str(executable)], check=True)
    subprocess.run([str(executable)], check=True)
