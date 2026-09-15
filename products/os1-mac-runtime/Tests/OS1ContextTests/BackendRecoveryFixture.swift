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
        ("This request was blocked by our safety systems. Reason: Potentially unintended activity.", .safetyBlocked),
        ("BLOCKED BY OUR SAFETY SYSTEMS; 401 Unauthorized; permission denied", .safetyBlocked),
        ("Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.", .contextOverflow),
        ("Prompt is too long", .contextOverflow),
    ] { check(BackendBlocker.reported(in: text) == expected, text) }
    check(BackendBlocker.reported(in: "Completed the requested task") == nil, "normal result")
    check(BackendBlocker.reported(in: "Please approve this command") == nil, "approval request is not evidence of denial")
    check(BackendBlocker.reported(in: "Potentially unintended activity") == nil, "isolated reason is not sufficient enforcement evidence")
    check(!BackendBlocker.policyDenied.message.contains("승인이 필요"), "denial must not assert a user approval can remove it")
    check(BackendBlocker.safetyBlocked.message.contains("사용자 승인 대기가 아니므로"), "accurate non-actionable boundary")
    for failed in ["claude", "codex"] {
        let other = failed == "claude" ? "codex" : "claude"
        for blocker in [BackendBlocker.capabilityUnavailable, .timeout, .contextOverflow] {
            check(BackendRecovery.alternate(requested: "auto", failed: failed, permission: "read_only",
                blocker: blocker, codexAvailable: true, claudeAvailable: true,
                alreadySwitched: false, remainingAttempts: 1) == other, "eligible alternate")
        }
        for blocker in [BackendBlocker.policyDenied, .safetyBlocked, .authenticationRequired, .effectsUncertain, .unclassified] {
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
        check(BackendRecovery.alternate(requested: "auto", failed: failed, permission: "workspace_write",
            blocker: .contextOverflow, codexAvailable: true, claudeAvailable: true,
            alreadySwitched: false, remainingAttempts: 3) == other, "context overflow ran nothing; a write may move backend")
        check(BackendRecovery.classifiedBlocker(.contextOverflow, permission: "workspace_write",
            stage: .dispatched, workspaceChanged: false) == .contextOverflow, "untouched workspace keeps the overflow cause")
        check(BackendRecovery.classifiedBlocker(.contextOverflow, permission: "workspace_write",
            stage: .dispatched, workspaceChanged: true) == .effectsUncertain, "mutated workspace still reconciles")
        check(BackendRecovery.alternate(requested: "auto", failed: failed, permission: "read_only",
            blocker: .timeout, codexAvailable: true, claudeAvailable: true,
            alreadySwitched: true, remainingAttempts: 3) == nil, "no ping-pong")
        check(BackendRecovery.alternate(requested: "auto", failed: failed, permission: "read_only",
            blocker: .timeout, codexAvailable: true, claudeAvailable: true,
            alreadySwitched: false, remainingAttempts: 0) == nil, "global attempt budget")
        check(BackendRecovery.alternate(requested: "auto", failed: failed, permission: "read_only",
            blocker: .timeout, codexAvailable: failed == "codex", claudeAvailable: failed == "claude",
            alreadySwitched: false, remainingAttempts: 3) == nil, "missing alternate")
        for blocker in [BackendBlocker.capabilityUnavailable, .timeout, .contextOverflow] {
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
    check(activity.label.contains("OS1") && activity.label.contains("이어가는 중") && activity.provider == "codex", "OS1 owns progress; backend remains auditable")
    for stage in [BackendDispatchStage.notDispatched, .dispatched] {
        for permission in ["read_only", "workspace_write"] {
            let blocker = BackendRecovery.classifiedBlocker(.capabilityUnavailable, permission: permission,
                stage: stage, workspaceChanged: false)
            check(blocker == (permission == "workspace_write" && stage == .dispatched ? .effectsUncertain : .capabilityUnavailable), "dispatch boundary")
            check(BackendRecovery.classifiedBlocker(.timeout, permission: permission,
                stage: stage, workspaceChanged: true) == .effectsUncertain, "workspace mutation must always reconcile")
            for denial in [BackendBlocker.policyDenied, .safetyBlocked, .authenticationRequired] {
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
    for blocker in [BackendBlocker.policyDenied, .safetyBlocked, .authenticationRequired] {
        check(BackendFailureNotice(provider: "claude", sessionID: nativeID, blocker: blocker,
            dispatchStage: .dispatched, permissionProfile: "workspace_write").requiresReadback,
            "a later denied operation does not undo earlier writes")
        check(!BackendFailureNotice(provider: "claude", sessionID: nativeID, blocker: blocker,
            dispatchStage: .notDispatched, permissionProfile: "workspace_write").requiresReadback,
            "before dispatch must not fabricate prior writes")
    }
    let safetyNotice = BackendFailureNotice(provider: "codex", sessionID: nativeID, blocker: .safetyBlocked,
        dispatchStage: .dispatched, permissionProfile: "workspace_write", publicProgress: "Previously received progress")
    let savedSafety = try JSONDecoder().decode(BackendFailureNotice.self, from: JSONEncoder().encode(safetyNotice))
    check(savedSafety == safetyNotice, "safety denial and progress survive failure transport")
    check(UnifiedExecution.permissionInstructions.contains("without asking for the same consent again") &&
        UnifiedExecution.permissionInstructions.contains("reviewed automatically") &&
        UnifiedExecution.permissionInstructions.contains("existing reviewed repository operator scripts") &&
        UnifiedExecution.permissionInstructions.contains("not blanket approval") &&
        UnifiedExecution.permissionInstructions.contains("must not be bypassed"), "bounded non-redundant consent instruction")
    check(UnifiedExecution.codexApprovalPolicy == "on-request" &&
        UnifiedExecution.codexApprovalsReviewer == "auto_review", "automatic reviewer must have an interactive approval policy")
    check(BackendFailureNotice(provider: "claude", sessionID: "../escape", blocker: .timeout, dispatchStage: .dispatched).sessionID == nil, "reject invalid native IDs")
    // A lane OS-1 signed read-only had no mutation authority: there is nothing
    // to read back, so it must not sit under an uncertain-effect hold.
    check(!BackendFailureNotice(provider: "claude", sessionID: nil, blocker: .effectsUncertain,
        dispatchStage: .dispatched, permissionProfile: "read_only").requiresReadback,
        "a read-only lane cannot have uncertain write effects")
    check(BackendFailureNotice(provider: "claude", sessionID: nil, blocker: .effectsUncertain,
        dispatchStage: .dispatched, permissionProfile: "workspace_write").requiresReadback,
        "an uncertain write still reconciles")
    check(BackendFailureNotice(provider: "claude", sessionID: nil, blocker: .effectsUncertain,
        dispatchStage: .dispatched).requiresReadback,
        "an unknown permission profile stays conservative")
    check(BackendRecovery.readbackPrompt(objective: "deploy v152").contains("deploy v152") &&
        BackendRecovery.readbackPrompt(objective: "deploy v152").contains("지금 실행할 명령이 아닙니다"), "readback retains objective but not replay authority")
    // The readback verdict: exactly one word on its own line; the last such
    // line wins; anything appended voids it; a quoted example inside prose
    // does not count as a verdict line once real verdicts follow.
    check(BackendRecovery.readbackPrompt(objective: "x").contains("OS1_EFFECTS: none"), "readback demands the machine-checkable verdict")
    check(BackendRecovery.effectsVerdict(in: "확인 결과...\nOS1_EFFECTS: none") == .nothingApplied, "verdict none parses")
    check(BackendRecovery.effectsVerdict(in: "a\nos1_effects:  Applied \n") == .applied, "verdict is case/space tolerant")
    check(BackendRecovery.effectsVerdict(in: "OS1_EFFECTS: none\n추가 확인 후\nOS1_EFFECTS: partial") == .partial, "the last verdict line wins")
    check(BackendRecovery.effectsVerdict(in: "OS1_EFFECTS: none 그런데 일부는 모름") == nil, "an explained verdict is void")
    check(BackendRecovery.effectsVerdict(in: "이 작업은 변경이 없었습니다") == nil, "prose without the marker is no verdict")
    // OS-1-authored prompts must never be re-ingested as the owner's message.
    check(NativeIngestion.isOS1ControlPrompt(BackendRecovery.readbackPrompt(objective: "코덱스 고쳐")), "readback prompt is recognized as OS-1's own")
    check(!NativeIngestion.isOS1ControlPrompt("야 왼쪽에 있는 코덱스가 왜 사라져버렸어 고쳐"), "the owner's words are not flagged")
    let phantom = NativeRecord(id: "n1", ordinal: 1, role: "user",
        text: BackendRecovery.readbackPrompt(objective: "코덱스 고쳐"), complete: true)
    let owner = NativeRecord(id: "n2", ordinal: 2, role: "user", text: "코덱스 살려", complete: true)
    let filtered = NativeIngestion.newRecords([phantom, owner], after: nil, sentByOS1: [], seen: []).records
    check(filtered.map(\.id) == ["n2"], "ingestion drops OS-1's own prompt but keeps the owner's turn")
    check(BackendRecovery.serviceFailure(status: 429, body: Data("error code: 1027\n".utf8)).contains("429/1027"), "exact platform cause")
    check(!BackendRecovery.serviceFailure(status: 429, body: Data("upstream-secret: 1027".utf8)).contains("1027"), "not every 429 is Cloudflare daily quota")
    for status in [401, 403, 500] {
        let message = BackendRecovery.serviceFailure(status: status, body: Data("private-service-secret".utf8))
        check(message.contains(String(status)) && !message.contains("private-service-secret"), "safe status without raw service body")
    }
    print("OS1 backend recovery: \(count) deterministic checks passed")
    try runUnifiedExecutionFixtures()
}
