import Foundation
import OS1Context

func runGovernanceRuntimeFixtures() throws {
    func check(_ value: Bool, _ message: String) { precondition(value, message) }
    let now = Date()
    let text = """
    100 1 2.5 100 /Applications/OS-1 CLODEX.app/Contents/MacOS/OS1App
    101 100 110.0 200 /usr/local/bin/codex
    102 101 3.0 300 /bin/node
    200 1 99.0 400 /usr/bin/unrelated
    """
    let a = GovernanceRuntime.parse(text, roots: [100], at: now)
    check(a.cpuPercent == 115.5, "root and descendants, multicore not capped")
    check(a.residentBytes == 600 * 1024 && a.processes == 3, "RSS and process scope")
    check(a.id == now, "observation time preserved")
    let stale = GovernanceRuntime.parse(text, roots: [200])
    check(stale.processes == 0 && stale.cpuPercent == 0, "stale PID cannot import unrelated process")
    let invalid = GovernanceRuntime.parse("broken\n100 1 nan 20 os1", roots: [100])
    check(invalid.cpuPercent == nil && invalid.residentBytes == nil, "unavailable is not fabricated zero")
    check(GovernanceRuntime.parse("100 1 0 0 /bin/os1", roots: [100]).cpuPercent == 0, "measured zero remains zero")
    for input in ["RCC Governance 그래프 고쳐", "RCC 거버넌스 실시간 그래프 고쳐", "RCC 가보면서 실시간으로 안되잖아 그래프 고쳐"] {
        check(PreparationIntent.detect(input)?.projectID == "os1-clodex", "native panel target: \(input)")
    }
    check(PreparationIntent.detect("RCC benchmark 결과 설명해")?.projectID != "os1-clodex", "bare RCC must not hijack benchmark")
    let start = Date()
    let live = GovernanceRuntime.sample(roots: [])
    check(Date().timeIntervalSince(start) < 2, "sampler deadline")
    check(live.processes == 0, "live ps receipt parses without collecting arguments")
    print("Governance runtime fixtures: 12 checks passed")
}
