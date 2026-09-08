import CryptoKit
import Darwin
import Foundation
import OS1Context

// This is local executable-health evidence, never a task-adoption receipt.
// Native success cannot promote a rejected Fleet result to completed.
struct FleetProviderEvidence: Codable {
    let schema: Int
    let provider: String
    let executable: String
    let executableSHA256: String
    let runtimeSHA256: String
    let observedAt: TimeInterval
    let ready: Bool
    let sessionID: String?
    let outputSHA256: String?
    let failureCategory: String?

    func valid(provider expected: String, executable path: String, executableSHA256 binary: String,
               runtimeSHA256 runtime: String, now: TimeInterval) -> Bool {
        schema == 1 && provider == expected && executable == path && executableSHA256 == binary &&
            runtimeSHA256 == runtime && ready && now >= observedAt && now - observedAt < 86_400 &&
            sessionID.flatMap(UUID.init(uuidString:)) != nil && outputSHA256?.count == 64 && failureCategory == nil
    }
}

/// One signed attempt's native execution health, independent of task adoption.
/// Only a real provider candidate can populate this value; synthetic unavailable
/// artifacts and a previous attempt/provider must never refresh readiness.
struct FleetProviderAttemptHealth {
    let provider: String
    private(set) var execution: ProviderExecution?
    private(set) var failureCategory: String?
    private(set) var observed = false

    var verified: Bool {
        guard let execution, execution.artifact.provider == provider else { return false }
        return execution.artifact.exitCode == 0 &&
            !execution.artifact.output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            execution.nativeRecord.persistence == "verified" &&
            execution.artifact.nativeRecord.persistence == "verified" &&
            execution.nativeRecord.recordPath?.isEmpty == false &&
            execution.nativeRecord.recordPath == execution.artifact.nativeRecord.recordPath &&
            UUID(uuidString: execution.sessionID) != nil
    }

    var ready: Bool { verified && failureCategory == nil }

    mutating func observeNative(_ candidate: ProviderExecution) {
        // A synthetic rejection artifact has no process/session evidence. It
        // may be delivered for audit, but cannot replace this attempt's cause.
        guard candidate.nativeRecord.persistence != "unverified: executor unavailable",
              !observed else { return }
        observed = true
        guard candidate.artifact.provider == provider else {
            execution = nil
            failureCategory = "native_provider_identity_mismatch"
            return
        }
        execution = candidate
        failureCategory = verified ? nil : "native_execution_unverified"
    }

    mutating func failed(_ blocker: BackendBlocker) {
        observed = true
        // A presentation/source/task-specific capability rejection does not
        // invalidate an independently persisted native turn. Real account,
        // permission and transport failures remain fail-closed.
        if verified && ![.authenticationRequired, .quotaExhausted, .policyDenied, .timeout].contains(blocker) {
            return
        }
        failureCategory = blocker.rawValue
    }

    mutating func failed(_ error: Error, dispatchStage: BackendDispatchStage) {
        // Only the explicit pre-dispatch task/lane guard is a non-observation.
        // Missing executables, authentication and startup failures can also
        // occur before dispatch and must still invalidate native readiness.
        if !observed, dispatchStage == .notDispatched,
           error is ProviderTaskCapabilityMismatch { return }
        failed(backendBlocker(error) ?? .unclassified)
    }
}

private func readinessURL(_ provider: String) throws -> URL {
    guard ["codex", "claude"].contains(provider) else { throw OS1Error.message("Invalid readiness provider") }
    return FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".os1/fleet/provider-evidence-v1", isDirectory: true)
        .appendingPathComponent(provider + ".json")
}

private func readinessFileHash(_ path: String) throws -> String {
    let reader = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
    defer { try? reader.close() }
    var hash = SHA256()
    while let bytes = try reader.read(upToCount: 1_048_576), !bytes.isEmpty { hash.update(data: bytes) }
    return hash.finalize().map { String(format: "%02x", $0) }.joined()
}

private func readinessIdentity(_ provider: String) throws -> (String, String, String) {
    let path = URL(fileURLWithPath: try findExecutable(provider)).resolvingSymlinksInPath().path
    // Bundled and user CLIs have different signing identifiers, but are built
    // from one release. Bind evidence to that build epoch, not its install path.
    return (path, try readinessFileHash(path), sha256Hex(Data(OS1RuntimeBuild.identity.utf8)))
}

func recordFleetProviderEvidence(_ health: FleetProviderAttemptHealth) {
    let provider = health.provider
    guard ["codex", "claude"].contains(provider), health.observed else { return }
    do {
        let identity = try readinessIdentity(provider)
        let record = FleetProviderEvidence(schema: 1, provider: provider, executable: identity.0,
            executableSHA256: identity.1, runtimeSHA256: identity.2, observedAt: Date().timeIntervalSince1970,
            ready: health.ready, sessionID: health.ready ? health.execution?.sessionID : nil,
            outputSHA256: health.ready ? health.execution.map { sha256Hex(Data($0.artifact.output.utf8)) } : nil,
            failureCategory: health.ready ? nil : (health.failureCategory ?? "native_execution_unverified"))
        let url = try readinessURL(provider)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(record).write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    } catch {
        // If persistence fails, no prior successful evidence may survive as ready.
        if let url = try? readinessURL(provider) { try? FileManager.default.removeItem(at: url) }
        fputs("OS1 provider readiness evidence unavailable\n", stderr)
    }
}

func fleetProviderReady(_ provider: String) -> Bool {
    do {
        let url = try readinessURL(provider)
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
              (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600,
              (attributes[.size] as? NSNumber)?.intValue ?? Int.max < 16_384 else { return false }
        let record = try JSONDecoder().decode(FleetProviderEvidence.self, from: Data(contentsOf: url))
        let identity = try readinessIdentity(provider)
        guard record.valid(provider: provider, executable: identity.0, executableSHA256: identity.1,
                           runtimeSHA256: identity.2, now: Date().timeIntervalSince1970) else { return false }
        // Official local auth status only. Never read or mirror provider credentials.
        let auth = try commandOutput(identity.0, provider == "codex" ? ["login", "status"] : ["auth", "status"],
                                     timeout: 4, isProvider: true)
        guard auth.0 == 0 else { return false }
        if provider == "claude" {
            let json = try JSONSerialization.jsonObject(with: auth.1) as? [String: Any]
            return json?["loggedIn"] as? Bool == true
        }
        return true
    } catch { return false }
}

func providerReadinessSelfTest() throws {
    let id = UUID().uuidString, hash = String(repeating: "a", count: 64)
    let good = FleetProviderEvidence(schema: 1, provider: "codex", executable: "/fixture/codex",
        executableSHA256: hash, runtimeSHA256: hash, observedAt: 1_000, ready: true,
        sessionID: id, outputSHA256: hash, failureCategory: nil)
    func accepts(_ record: FleetProviderEvidence, now: Double = 1_001, binary: String? = nil, runtime: String? = nil) -> Bool {
        record.valid(provider: "codex", executable: "/fixture/codex", executableSHA256: binary ?? hash,
                     runtimeSHA256: runtime ?? hash, now: now)
    }
    let failed = FleetProviderEvidence(schema: 1, provider: "codex", executable: "/fixture/codex",
        executableSHA256: hash, runtimeSHA256: hash, observedAt: 1_000, ready: false,
        sessionID: nil, outputSHA256: nil, failureCategory: "quota_exhausted")
    guard accepts(good), !accepts(good, now: 999), !accepts(good, now: 87_400),
          !accepts(good, binary: "changed"), !accepts(good, runtime: "changed"), !accepts(failed) else {
        throw OS1Error.message("Provider readiness regression failed")
    }
    guard BackendBlocker.reported(in: "You've hit your session limit · resets 7pm") == .quotaExhausted,
          BackendBlocker.reported(in: "You’ve hit your usage limit") == .quotaExhausted,
          BackendBlocker.reported(in: "Read-only verification") == nil else {
        throw OS1Error.message("Native quota classification regression failed")
    }
    var checks = 9
    func check(_ condition: @autoclosure () -> Bool, _ label: String) throws {
        guard condition() else { throw OS1Error.message("Provider health/adoption regression failed: " + label) }
        checks += 1
    }
    func candidate(provider: String = "codex", exit: Int32 = 0,
                   persistence: String = "verified", output: String = "The result is available.") -> ProviderExecution {
        let native = NativeRecordEvidence(turnID: id, recordPath: "/fixture/native-record",
            persistence: persistence, desktopVisibility: "not_revealed")
        return ProviderExecution(artifact: Artifact(provider: provider, action: "fixture",
            permissionProfile: "read_only", model: "fixture", effort: "low",
            executorContractVersion: "fixture", executorContractSHA256: hash,
            exitCode: exit, output: output, stderr: "", durationMS: 1,
            workspaceBeforeHash: hash, workspaceAfterHash: hash, nativeRecord: native),
            sessionID: id, nativeRecord: native)
    }
    let real = candidate()
    var health = FleetProviderAttemptHealth(provider: "codex")
    var nativeObservations = 0
    var rejected: RejectedProviderExecution?
    do {
        _ = try validateProviderCandidate(real, onNativeExecution: {
            nativeObservations += 1
            health.observeNative($0)
        }) {
            let issues = HumanOutputContract.issues(in: real.artifact.output,
                request: "한국어로 결과를 설명해 주세요.")
            guard issues.isEmpty else { throw OS1Error.message("presentation_rejected") }
        }
    } catch let failure as RejectedProviderExecution {
        rejected = failure
        health.failed(backendBlocker(failure) ?? .unclassified)
    }
    try check(nativeObservations == 1 && rejected != nil, "real presentation guard still rejects")
    try check(health.ready, "presentation rejection preserves verified native health")
    try check(rejected?.execution.artifact.output == real.artifact.output &&
              rejected?.execution.nativeRecord.recordPath == real.nativeRecord.recordPath,
              "actual rejected candidate retained")
    try check(!completionLocallyAdoptable(failure: "presentation_rejected", exitCode: 0,
              output: real.artifact.output, persistence: "verified"), "health cannot adopt rejected task")
    health.failed(.capabilityUnavailable)
    try check(health.ready, "task-specific capability failure is not process failure")
    var preflightHealth = FleetProviderAttemptHealth(provider: "claude")
    var preflightRejected = false
    do {
        try validateProviderTaskCapability(provider: "claude", permissionProfile: "read_only",
            hasPreloadedEvidence: false, prompt: "Run swift build to inspect the build result.")
    } catch {
        preflightRejected = error is ProviderTaskCapabilityMismatch
        preflightHealth.failed(error, dispatchStage: .notDispatched)
        try check(backendBlocker(error) == .capabilityUnavailable,
                  "task preflight retains capability classification")
    }
    try check(preflightRejected && !preflightHealth.observed,
              "original Claude shell-lane preflight cannot overwrite readiness cache")
    for blocker in [BackendBlocker.authenticationRequired, .capabilityUnavailable, .policyDenied, .timeout] {
        var startupFailure = FleetProviderAttemptHealth(provider: "claude")
        startupFailure.failed(OS1Error.backendBlocked(blocker), dispatchStage: .notDispatched)
        try check(startupFailure.observed && !startupFailure.ready &&
                  startupFailure.failureCategory == blocker.rawValue,
                  "real auth/executable/startup failures invalidate readiness before dispatch")
    }
    var dispatchedMismatch = FleetProviderAttemptHealth(provider: "claude")
    dispatchedMismatch.failed(ProviderTaskCapabilityMismatch(), dispatchStage: .dispatched)
    try check(dispatchedMismatch.observed && !dispatchedMismatch.ready,
              "typed guard cannot hide a dispatched failure")
    for (provider, permission, hasSource) in [("codex", "read_only", false),
                                             ("claude", "workspace_write", false),
                                             ("claude", "read_only", true)] {
        try validateProviderTaskCapability(provider: provider, permissionProfile: permission,
            hasPreloadedEvidence: hasSource, prompt: "Run swift build to inspect the build result.")
        checks += 1
    }
    for blocker in [BackendBlocker.authenticationRequired, .quotaExhausted, .policyDenied, .timeout] {
        var failedHealth = FleetProviderAttemptHealth(provider: "codex")
        failedHealth.observeNative(real)
        failedHealth.failed(blocker)
        try check(!failedHealth.ready && failedHealth.failureCategory == blocker.rawValue,
                  "real account/permission/transport failure remains closed")
        failedHealth.observeNative(candidate(exit: 69, persistence: "unverified: executor unavailable", output: ""))
        try check(failedHealth.failureCategory == blocker.rawValue,
                  "synthetic artifact cannot erase specific failure")
        let wrapped = RejectedProviderExecution(execution: real, cause: OS1Error.backendBlocked(blocker))
        try check(backendBlocker(wrapped) == blocker, "candidate custody preserves classified blocker")
        if [.authenticationRequired, .policyDenied].contains(blocker) {
            try check((providerUnderlyingError(wrapped) as? OS1Error)?.isTerminalBackendFailure == true,
                      "wrapped auth/policy failures remain terminal")
        }
    }
    for invalid in [candidate(exit: 1), candidate(persistence: "unverified"), candidate(output: "")] {
        var invalidHealth = FleetProviderAttemptHealth(provider: "codex")
        invalidHealth.observeNative(invalid)
        try check(!invalidHealth.ready, "native completion requires all health evidence")
    }
    let nextAttempt = FleetProviderAttemptHealth(provider: "codex")
    try check(!nextAttempt.observed && !nextAttempt.ready, "new attempt cannot inherit readiness")
    var wrongProvider = FleetProviderAttemptHealth(provider: "claude")
    wrongProvider.observeNative(real)
    try check(!wrongProvider.ready && wrongProvider.failureCategory == "native_provider_identity_mismatch",
              "provider identity is isolated")
    for permission in ["read_only", "workspace_write"] {
        for stage in [BackendDispatchStage.notDispatched, .dispatched] {
            try check(providerAttemptMayReplay(permission: permission, stage: stage) ==
                      (permission == "read_only" || stage == .notDispatched),
                      "quota and verifier cannot replay a dispatched writer")
        }
    }
    try check(!providerAttemptMayReplay(permission: "unknown", stage: .notDispatched),
              "unknown permission never grants replay")
    print("OS1 provider readiness/custody: \(checks) checks PASS; native health is not task adoption")
}
