import Foundation
import OS1Context

func runBackendRecoveryFixtures() throws {
    var count = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "Backend recovery: " + message); count += 1
    }
    for (text, expected) in [
        ("Failed to upload code with status code 401 Unauthorized", BackendBlocker.authenticationRequired),
        ("Permission for this action was denied by the Claude Code auto mode classifier. Reason: Blocked by classifier.", .policyDenied),
        ("401 Unauthorized; permission denied", .policyDenied),
        ("The token has expired", .authenticationRequired),
        ("Not logged in", .authenticationRequired),
        ("403 Forbidden", .authenticationRequired),
    ] { check(BackendBlocker.reported(in: text) == expected, text) }
    check(BackendBlocker.reported(in: "Completed the requested task") == nil, "normal result")
    for failed in ["claude", "codex"] {
        let other = failed == "claude" ? "codex" : "claude"
        for blocker in [BackendBlocker.capabilityUnavailable, .timeout] {
            check(BackendRecovery.alternate(requested: "auto", failed: failed, permission: "read_only",
                blocker: blocker, codexAvailable: true, claudeAvailable: true,
                alreadySwitched: false, remainingAttempts: 1) == other, "eligible alternate")
        }
        for blocker in [BackendBlocker.policyDenied, .authenticationRequired, .effectsUncertain, .unclassified] {
            check(BackendRecovery.alternate(requested: "auto", failed: failed, permission: "read_only",
                blocker: blocker, codexAvailable: true, claudeAvailable: true,
                alreadySwitched: false, remainingAttempts: 3) == nil, "no authority bypass or fabricated capability")
        }
        check(BackendRecovery.alternate(requested: failed, failed: failed, permission: "read_only",
            blocker: .timeout, codexAvailable: true, claudeAvailable: true,
            alreadySwitched: false, remainingAttempts: 3) == nil, "explicit provider pin")
        check(BackendRecovery.alternate(requested: "auto", failed: failed, permission: "workspace_write",
            blocker: .timeout, codexAvailable: true, claudeAvailable: true,
            alreadySwitched: false, remainingAttempts: 3) == nil, "no blind write replay")
        check(BackendRecovery.alternate(requested: "auto", failed: failed, permission: "read_only",
            blocker: .timeout, codexAvailable: true, claudeAvailable: true,
            alreadySwitched: true, remainingAttempts: 3) == nil, "no ping-pong")
        check(BackendRecovery.alternate(requested: "auto", failed: failed, permission: "read_only",
            blocker: .timeout, codexAvailable: true, claudeAvailable: true,
            alreadySwitched: false, remainingAttempts: 0) == nil, "global attempt budget")
        check(BackendRecovery.alternate(requested: "auto", failed: failed, permission: "read_only",
            blocker: .timeout, codexAvailable: failed == "codex", claudeAvailable: failed == "claude",
            alreadySwitched: false, remainingAttempts: 3) == nil, "missing alternate")
        for blocker in [BackendBlocker.capabilityUnavailable, .timeout] {
            check(BackendRecovery.alternate(requested: "auto", failed: failed, permission: "read_only",
                blocker: blocker, codexAvailable: true, claudeAvailable: true,
                alreadySwitched: false, remainingAttempts: 3, unavailableProviders: [other]) == nil,
                "an earlier exhausted provider cannot re-enter through capability recovery")
        }
    }
    let checkpoint = BackendRecoveryCheckpoint(executionID: UUID().uuidString, sequence: 2,
        provider: "claude", permissionProfile: "read_only", objectiveSHA256: String(repeating: "a", count: 64),
        sourceSHA256: String(repeating: "b", count: 64), assembledInputSHA256: String(repeating: "c", count: 64),
        workspaceBeforeSHA256: String(repeating: "d", count: 64), workspaceAfterSHA256: String(repeating: "d", count: 64),
        blocker: .timeout, nextProvider: "codex")
    let encoded = try JSONEncoder().encode(checkpoint)
    let restored = try JSONDecoder().decode(BackendRecoveryCheckpoint.self, from: encoded)
    check(restored.sourceSHA256 == checkpoint.sourceSHA256, "source continuity")
    check(restored.objectiveSHA256 == checkpoint.objectiveSHA256, "objective continuity")
    check(restored.assembledInputSHA256 == checkpoint.assembledInputSHA256, "input continuity")
    check(restored.nextProvider == "codex" && restored.sequence == 2, "attempt lineage")
    let fields = try JSONSerialization.jsonObject(with: encoded) as! [String: Any]
    check(!fields.keys.contains("token") && !fields.keys.contains("prompt") && !fields.keys.contains("output"), "no raw model content or credentials")
    check(!fields.keys.contains("complete") && !fields.keys.contains("verified"), "checkpoint is not completion proof")
    let activity = RuntimeActivity(.recovering, provider: "codex")
    check(activity.label.contains("Codex") && activity.label.contains("이어가는 중"), "visible recovery")
    for stage in [BackendDispatchStage.notDispatched, .dispatched] {
        for permission in ["read_only", "workspace_write"] {
            let blocker = BackendRecovery.classifiedBlocker(.capabilityUnavailable, permission: permission,
                stage: stage, workspaceChanged: false)
            check(blocker == (permission == "workspace_write" && stage == .dispatched ? .effectsUncertain : .capabilityUnavailable), "dispatch boundary")
            check(BackendRecovery.classifiedBlocker(.timeout, permission: permission,
                stage: stage, workspaceChanged: true) == .effectsUncertain, "workspace mutation must always reconcile")
            for denial in [BackendBlocker.policyDenied, .authenticationRequired] {
                check(BackendRecovery.classifiedBlocker(denial, permission: permission,
                    stage: stage, workspaceChanged: true) == denial, "authority failures retain cause")
            }
        }
    }
    for failed in ["codex", "claude"] {
        check(BackendRecovery.alternate(requested: "auto", failed: failed, permission: "workspace_write",
            blocker: .capabilityUnavailable, codexAvailable: true, claudeAvailable: true,
            alreadySwitched: false, remainingAttempts: 1, dispatchStage: .notDispatched) == (failed == "codex" ? "claude" : "codex"), "pre-dispatch write may switch")
        check(BackendRecovery.alternate(requested: "auto", failed: failed, permission: "workspace_write",
            blocker: .policyDenied, codexAvailable: true, claudeAvailable: true,
            alreadySwitched: false, remainingAttempts: 1, dispatchStage: .notDispatched) == nil, "pre-dispatch is not permission bypass")
    }
    check(BackendRecovery.recoveryTicketMatches(provider: "codex", permission: "workspace_write",
        expectedProvider: "codex", expectedPermission: "workspace_write"), "fresh signed profile preserved")
    check(!BackendRecovery.recoveryTicketMatches(provider: "codex", permission: "workspace_write",
        expectedProvider: "codex", expectedPermission: "read_only"), "no fresh-ticket permission escalation")
    check(!BackendRecovery.recoveryTicketMatches(provider: "claude", permission: "read_only",
        expectedProvider: "codex", expectedPermission: "read_only"), "no fresh-ticket provider mismatch")
    let nativeID = UUID().uuidString
    let notice = BackendFailureNotice(provider: "claude", sessionID: nativeID, blocker: .effectsUncertain, dispatchStage: .dispatched)
    let noticeData = try JSONEncoder().encode(notice)
    check(try JSONDecoder().decode(BackendFailureNotice.self, from: noticeData) == notice, "failure transport round trip")
    check(notice.sessionID == nativeID.lowercased() && notice.requiresReadback, "preserve interrupted session without success claim")
    for blocker in [BackendBlocker.policyDenied, .authenticationRequired] {
        check(BackendFailureNotice(provider: "claude", sessionID: nativeID, blocker: blocker,
            dispatchStage: .dispatched, permissionProfile: "workspace_write").requiresReadback,
            "a later denied operation does not undo earlier writes")
        check(!BackendFailureNotice(provider: "claude", sessionID: nativeID, blocker: blocker,
            dispatchStage: .notDispatched, permissionProfile: "workspace_write").requiresReadback,
            "before dispatch must not fabricate prior writes")
    }
    check(BackendFailureNotice(provider: "claude", sessionID: "../escape", blocker: .timeout, dispatchStage: .dispatched).sessionID == nil, "reject invalid native IDs")
    check(BackendRecovery.readbackPrompt(objective: "deploy v152").contains("deploy v152") &&
        BackendRecovery.readbackPrompt(objective: "deploy v152").contains("지금 실행할 명령이 아닙니다"), "readback retains objective but not replay authority")
    check(BackendRecovery.serviceFailure(status: 429, body: Data("error code: 1027\n".utf8)).contains("429/1027"), "exact platform cause")
    check(!BackendRecovery.serviceFailure(status: 429, body: Data("upstream-secret: 1027".utf8)).contains("1027"), "not every 429 is Cloudflare daily quota")
    for status in [401, 403, 500] {
        let message = BackendRecovery.serviceFailure(status: status, body: Data("private-service-secret".utf8))
        check(message.contains(String(status)) && !message.contains("private-service-secret"), "safe status without raw service body")
    }
    print("OS1 backend recovery: \(count) deterministic checks passed")
}
