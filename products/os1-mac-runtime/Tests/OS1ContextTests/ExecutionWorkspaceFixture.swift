import Foundation
import OS1Context

func runExecutionWorkspaceFixtures() throws {
    var count = 0
    func check(_ value: Bool, _ reason: String) { precondition(value, reason); count += 1 }
    for provider in ["claude", "codex", "local"] {
        for permission in ["read_only", "workspace_write", "full_access"] {
            for source in [true, false] {
                for workspace in ["/fixture/home", "/fixture/repo"] {
                    let isolated = ExecutionWorkspace.usesSourceIsolation(provider: provider, permission: permission,
                        hasSource: source, workspace: workspace, home: "/fixture/home")
                    check(isolated == (provider == "claude" && permission == "read_only" &&
                        (source || workspace == "/fixture/home")), "execution scope contract mismatch")
                }
            }
        }
    }
    // Even inside an isolated reader workspace, an observed mutation is not
    // excused. A write-capable dispatched operation still requires readback.
    check(BackendRecovery.classifiedBlocker(.unclassified, permission: "read_only", stage: .dispatched,
        workspaceChanged: true) == .effectsUncertain, "real mutation must block")
    check(BackendRecovery.classifiedBlocker(.unclassified, permission: "read_only", stage: .dispatched,
        workspaceChanged: false) == .unclassified, "style rejection is not evidence of mutation")
    check(BackendRecovery.classifiedBlocker(.unclassified, permission: "workspace_write", stage: .dispatched,
        workspaceChanged: false) == .effectsUncertain, "write uncertainty must remain")
    let checkpoint = BackendRecoveryCheckpoint(executionID: UUID().uuidString, sequence: 1,
        provider: "claude", permissionProfile: "read_only", objectiveSHA256: "a", sourceSHA256: "b",
        assembledInputSHA256: "c", workspaceBeforeSHA256: "d", workspaceAfterSHA256: "d",
        blocker: .unclassified, nextProvider: nil, observedWorkspace: "/fixture/isolated")
    let raw = try JSONEncoder().encode(checkpoint)
    check(try JSONDecoder().decode(BackendRecoveryCheckpoint.self, from: raw).observedWorkspace == "/fixture/isolated", "scope receipt")
    var legacy = try JSONSerialization.jsonObject(with: raw) as! [String: Any]
    legacy.removeValue(forKey: "observedWorkspace"); legacy["schema"] = 2
    check(try JSONDecoder().decode(BackendRecoveryCheckpoint.self, from: JSONSerialization.data(withJSONObject: legacy)).observedWorkspace == nil, "legacy compatibility")
    print("Execution workspace fixtures: \(count) PASS")
}
