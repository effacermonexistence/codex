import Foundation
import CryptoKit
import OS1Context

func runTakeoverFixtures() throws {
    var checks = 0
    func check(_ value: Bool, _ label: String) {
        precondition(value, label); checks += 1
    }
    check(ConnectionFailure.classify("token has expired") == .authentication, "expired login")
    check(ConnectionFailure.classify("HTTP 403 Forbidden") == .permission, "permission is not authentication")
    for error in ["fetch failed", "DNS resolve host", "connection timed out", "HTTP 503"] {
        check(ConnectionFailure.classify(error) == .transport, "transport never logs in")
    }
    check(ConnectionFailure.classify("unknown reply") == .unavailable, "unknown remains unknown")
    let quota: [String: Any] = ["is_error": true, "errors": ["You've hit your session limit · resets 7pm (America/Los_Angeles)"], "permission_denials": []]
    check(BackendRecovery.claudeQuotaFailure(status: 1, object: quota), "actual Claude errors array")
    check(BackendRecovery.claudeQuotaFailure(status: 0, object: quota), "error envelope despite exit zero")
    check(!BackendRecovery.claudeQuotaFailure(status: 0, object: ["is_error": false, "result": "You've hit your session limit means quota is exhausted"]), "successful quota explanation")
    var deniedQuota = quota; deniedQuota["permission_denials"] = [["tool_name": "Bash"]]
    check(!BackendRecovery.claudeQuotaFailure(status: 1, object: deniedQuota), "permission denial wins over quota")
    check(BackendRecovery.quotaRecoveryPreference(requested: "auto", failed: "claude", codexAvailable: true, claudeAvailable: true) == "codex", "Claude account quota switches backend, not effort")
    check(BackendRecovery.quotaRecoveryPreference(requested: "claude", failed: "claude", codexAvailable: true, claudeAvailable: true) == nil, "explicit pin preserved")
    check(BackendRecovery.quotaRecoveryPreference(requested: "auto", failed: "claude", codexAvailable: false, claudeAvailable: true) == nil, "no second exhausted Claude model")
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-takeover-tests-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: root) }
    var first: ConnectionLease? = try ConnectionLease(root: root, service: "r2")
    let second = try ConnectionLease(root: root, service: "r2")
    let other = try ConnectionLease(root: root, service: "github")
    check(first!.tryAcquire(), "first auth lease")
    check(!second.tryAcquire(), "duplicate auth prevented")
    check(other.tryAcquire(), "independent service lease")
    first = nil
    check(second.tryAcquire(), "auth resumes after lease release")
    do {
        _ = try ConnectionLease(root: root, service: "../../escape")
        preconditionFailure("invalid auth service accepted")
    } catch ConnectionFailure.unavailable { checks += 1 }
    for stage in [BackendDispatchStage.notDispatched, .dispatched] {
        check(BackendRecovery.permitsAutomaticReplay(permission: "read_only", stage: stage), "read-only replay eligibility")
    }
    check(!BackendRecovery.permitsAutomaticReplay(permission: "workspace_write", stage: .dispatched), "rejected write never replays")
    check(BackendRecovery.permitsAutomaticReplay(permission: "workspace_write", stage: .notDispatched), "pre-dispatch repair allowed")
    check(BackendRecovery.alternate(requested: "auto", failed: "claude", permission: "read_only", blocker: .cancelled,
        codexAvailable: true, claudeAvailable: true, alreadySwitched: false, remainingAttempts: 3) == nil, "cancel never fails over")
    let a = UUID(), b = UUID()
    check(RuntimeActivity(.executing, provider: "codex", nativeSessionID: a.uuidString).nativeSessionID == a.uuidString.lowercased(), "progress carries exact native identity")
    check(RuntimeActivity(.executing, provider: "claude", nativeSessionID: "../other").nativeSessionID == nil, "invalid progress identity rejected")
    check(ExecutionCancellation.url(submissionID: a) != ExecutionCancellation.url(submissionID: b), "cancel is session scoped")
    func merge(_ current: String, _ previous: String, _ dictated: String, _ replacement: String, _ initial: String = "draft") -> String? {
        DictationDraft.replacing(current: current, previous: previous, dictated: dictated, replacement: replacement, initial: initial)
    }
    check(merge("draft", "draft", "", "hello") == "draft hello", "first dictation")
    check(merge("typed draft", "draft", "", "hello") == "typed draft hello", "typing before first transcript")
    check(merge("edited hello", "draft hello", "hello", "hello world") == "edited hello world", "prefix typing survives")
    check(merge("draft hello typed", "draft hello", "hello", "hello world") == "draft hello world typed", "suffix typing survives")
    check(merge("draft HELLO", "draft hello", "hello", "hello world") == nil, "manual edit wins")
    check(merge("draft hello", "draft hello", "hello", "") == "draft", "cancel restores original")
    check(merge("edited hello typed", "draft hello", "hello", "") == nil, "ambiguous multiple edits preserved")
    check(merge("초안 음성 추가", "초안 음성", "음성", "음성 입력", "초안") == "초안 음성 입력 추가", "Unicode draft edits")
    let artifact = Data("paid candidate".utf8)
    let digest = SHA256.hash(data: artifact).map { String(format: "%02x", $0) }.joined()
    let record = DeliveryRecord(id: UUID().uuidString + "-1", apiURL: "https://example.test", deviceID: "test",
        resultSHA256: digest, artifact: artifact, upload: Data(), submission: Data(), step: Data(),
        source: nil, output: "paid candidate", localRejection: "source mismatch")
    let box = DeliveryOutbox(root: root.appendingPathComponent("outbox"))
    try box.save(record)
    let saved = try box.read(record.id)
    check(saved.output == "paid candidate" && saved.localRejection == "source mismatch", "rejected paid output retained")
    var legacy = try JSONSerialization.jsonObject(with: JSONEncoder().encode(record)) as! [String: Any]
    legacy.removeValue(forKey: "localRejection")
    check(try JSONDecoder().decode(DeliveryRecord.self, from: JSONSerialization.data(withJSONObject: legacy)).localRejection == nil, "old outbox backward compatibility")
    print("OS1 takeover: \(checks) checks passed")
}
