import Foundation
import OS1Context

/// Derived from the observed inspection failure; no provider call, live log,
/// credential, source file or owner state is consumed by this fixture.
func runClaudeInspectionNetworkDenialFixtures() throws {
    var checks = 0
    func check(_ condition: Bool, _ label: String) { precondition(condition, label); checks += 1 }
    let session = UUID().uuidString.lowercased(), other = UUID().uuidString.lowercased()
    let diagnostic = "Exit code 1\nGet https://api.github.com/user: Forbidden\n<sandbox_violations>\ndeny network-outbound api.github.com:443 (user denied)\ndeny network-outbound api.github.com:443 (user denied)\n</sandbox_violations>"
    func request(_ id: String, name: String = "Bash", sessionID: String? = session,
                 parent: String? = nil, command: String = "gh auth status") -> [String: Any] {
        var row: [String: Any] = ["type": "assistant", "message": ["id": "message-" + id,
            "content": [["type": "tool_use", "id": id, "name": name,
                         "input": ["command": command, "description": "Inspect account status"]]]]]
        if let sessionID { row["session_id"] = sessionID }
        if let parent { row["parent_tool_use_id"] = parent }
        return row
    }
    func response(_ id: String, content: Any = diagnostic, failure: Any = true,
                  sessionID: String? = session, parent: String? = nil) -> [String: Any] {
        var row: [String: Any] = ["type": "user", "message": ["content": [
            ["type": "tool_result", "tool_use_id": id, "is_error": failure, "content": content]]]]
        if let sessionID { row["session_id"] = sessionID }
        if let parent { row["parent_tool_use_id"] = parent }
        return row
    }
    func feed(_ stream: ExecutionStream, _ row: [String: Any], chunked: Bool = false, newline: Bool = true) throws {
        var bytes = try JSONSerialization.data(withJSONObject: row)
        if newline { bytes.append(10) }
        if chunked { for byte in bytes { stream.ingestClaude(Data([byte])) } }
        else { stream.ingestClaude(bytes) }
    }
    func negative(_ label: String, setup: (ExecutionStream) throws -> Void) throws {
        let stream = ExecutionStream(claudeSessionID: session)
        try setup(stream)
        check(stream.claudeInspectionNetworkDenials.isEmpty, label)
    }

    let observed = ExecutionStream(claudeSessionID: session)
    try feed(observed, request("inspection-gh"))
    try feed(observed, response("inspection-gh"), chunked: true)
    check(observed.claudeInspectionNetworkDenials.count == 1, "duplicate native denial lines become one bounded record")
    check(observed.claudeInspectionNetworkDenials.first?.host == "api.github.com", "approved host retained")
    check(observed.claudeInspectionNetworkDenials.first?.toolUseID == "inspection-gh", "owned Bash ID retained")
    check(observed.text.isEmpty, "raw result/URL/body is not assistant text")
    check(observed.progress?.steps?.first?.label == "Inspect account status", "progress retains only original redacted label")
    try feed(observed, response("inspection-gh"))
    check(observed.claudeInspectionNetworkDenials.count == 1, "duplicate returned tool does not reclassify or grow metadata")
    try feed(observed, ["type": "result", "session_id": session, "is_error": false, "result": "Inspection was blocked.", "permission_denials": []])
    check(observed.claudeInspectionNetworkDenials.count == 1, "empty final permission_denials does not erase observed tool diagnostic")

    let wrappedR2 = ExecutionStream(claudeSessionID: session)
    try feed(wrappedR2, request("wrapped-r2", command: "os1 connection-status"))
    let wrappedDiagnostic = "bytes=128 json=parse-failed\n<sandbox_violations>\ndeny network-outbound api.cloudflare.com:443 (user denied)\ndeny network-outbound api.cloudflare.com:443 (user denied)\ndeny network-outbound api.cloudflare.com:443 (user denied)\n</sandbox_violations>"
    try feed(wrappedR2, response("wrapped-r2", content: wrappedDiagnostic, failure: false))
    try feed(wrappedR2, ["type": "result", "session_id": session, "is_error": false,
                        "result": "Local check complete.", "permission_denials": []])
    check(wrappedR2.claudeInspectionNetworkDenials.first?.host == "api.cloudflare.com", "success-shaped wrapped R2 result preserves actual native network denial")
    check(wrappedR2.claudeInspectionNetworkDenials.count == 1, "three R2 diagnostic lines deduplicate despite empty final denial list")
    check(wrappedR2.progress?.steps?.first?.state == .returned && wrappedR2.text.isEmpty,
          "native boolean false lifecycle remains returned; no raw diagnostic becomes answer text")
    try negative("missing error flag is not verified native diagnostic metadata") {
        try feed($0, request("missing-flag"))
        var row = response("missing-flag")
        var message = row["message"] as! [String: Any]
        var content = message["content"] as! [[String: Any]]
        content[0].removeValue(forKey: "is_error"); message["content"] = content; row["message"] = message
        try feed($0, row)
    }
    try negative("numeric flag is not a native boolean error") {
        try feed($0, request("number")); try feed($0, response("number", failure: 1))
    }
    try negative("unknown tool result cannot bind its own request") { try feed($0, response("unknown")) }
    try negative("explicit foreign request/result cannot affect current stream") {
        try feed($0, request("foreign", sessionID: other)); try feed($0, response("foreign", sessionID: other))
    }
    try negative("foreign result cannot use a current request") {
        try feed($0, request("owned")); try feed($0, response("owned", sessionID: other))
    }
    try negative("missing session identities do not create inspection attestation") {
        try feed($0, request("missing", sessionID: nil)); try feed($0, response("missing", sessionID: nil))
    }
    try negative("subagent failure remains subagent-scoped") {
        try feed($0, request("parent", name: "Agent"))
        try feed($0, request("child", sessionID: other, parent: "parent"))
        try feed($0, response("child", sessionID: other, parent: "parent"))
    }
    try negative("Read tool data cannot pretend to be Bash sandbox enforcement") {
        try feed($0, request("file", name: "Read")); try feed($0, response("file"))
    }
    try negative("ordinary assistant or user quotations do not produce execution metadata") {
        try feed($0, ["type": "assistant", "session_id": session, "message": ["id": "quoted", "content": [["type": "text", "text": diagnostic]]]])
        try feed($0, ["type": "user", "session_id": session, "message": ["content": [["type": "text", "text": diagnostic]]]])
    }
    try negative("marker in command input cannot create a tool-result denial") {
        try feed($0, request("command", command: diagnostic)); try feed($0, response("command", content: "ordinary command failure"))
    }
    try negative("unapproved host is not an inspection capability failure") {
        try feed($0, request("unknown-host")); try feed($0, response("unknown-host", content: diagnostic.replacingOccurrences(of: "api.github.com", with: "unapproved.example")))
    }
    try negative("lookalike host does not inherit approved-host authority") {
        try feed($0, request("lookalike")); try feed($0, response("lookalike", content: diagnostic.replacingOccurrences(of: "api.github.com", with: "api.github.com.evil.example")))
    }
    try negative("bare denied wording without native diagnostic block is not enforcement proof") {
        try feed($0, request("plain")); try feed($0, response("plain", content: "deny network-outbound api.github.com:443 (user denied)"))
    }
    try negative("unclosed diagnostic block is not adopted") {
        try feed($0, request("truncated")); try feed($0, response("truncated", content: diagnostic.replacingOccurrences(of: "</sandbox_violations>", with: "")))
    }
    try negative("a completed successful ID cannot be replayed as a later denial") {
        try feed($0, request("completed")); try feed($0, response("completed", content: "ok", failure: false))
        try feed($0, response("completed"))
    }
    let unbound = ExecutionStream()
    try feed(unbound, request("unbound")); try feed(unbound, response("unbound"))
    check(unbound.claudeInspectionNetworkDenials.isEmpty, "unbound stream does not certify session-scoped enforcement")
    let nextRun = ExecutionStream(claudeSessionID: session)
    try feed(nextRun, response("inspection-gh"))
    check(nextRun.claudeInspectionNetworkDenials.isEmpty, "new stream clears metadata and rejects stale request identity")

    let framed = ExecutionStream(claudeSessionID: session)
    try feed(framed, ["type": "stream_event", "session_id": session, "event": ["type": "content_block_start",
        "content_block": ["type": "tool_use", "id": "partial", "name": "Bash", "input": [:]]]], chunked: true)
    try feed(framed, response("partial", content: [["type": "text", "text": diagnostic.replacingOccurrences(of: "api.github.com", with: "api.cloudflare.com")]]), chunked: true, newline: false)
    framed.finishClaude()
    check(framed.claudeInspectionNetworkDenials.first?.host == "api.cloudflare.com", "chunked partial tool start and final unterminated frame bind correctly")
    let capped = ExecutionStream(claudeSessionID: session)
    for n in 0..<12 { try feed(capped, request("cap-\(n)")); try feed(capped, response("cap-\(n)")) }
    check(capped.claudeInspectionNetworkDenials.count == 8, "bounded metadata never grows past eight host/tool pairs")

    let since = Date(timeIntervalSince1970: 1_791_374_400) // 2026-10-07T12:00:00Z
    let nativeDate = ISO8601DateFormatter().string(from: since.addingTimeInterval(10))
    func native(_ id: String, stamp: String = nativeDate, sessionID: String = session,
                sidechain: Any = false, type: String = "user", parent: String? = nil) -> [String: Any] {
        var row = response(id, content: wrappedDiagnostic, failure: false)
        row.removeValue(forKey: "session_id")
        row["sessionId"] = sessionID; row["isSidechain"] = sidechain
        row["timestamp"] = stamp; row["type"] = type
        if let parent { row["parent_tool_use_id"] = parent }
        return row
    }
    func nativeData(_ row: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: row) + Data([10]) }
    func nativeNegative(_ label: String, row: [String: Any]) throws {
        let stream = ExecutionStream(claudeSessionID: session)
        try feed(stream, request("native-owned"))
        stream.inspectClaudeNativeResults(try nativeData(row), since: since)
        check(stream.claudeInspectionNetworkDenials.isEmpty, label)
    }
    let nativeFallback = ExecutionStream(claudeSessionID: session)
    try feed(nativeFallback, request("native-owned"))
    // stdout may already report a return, while its exact transcript retains
    // the sandbox block missing from that stdout event.
    try feed(nativeFallback, response("native-owned", content: "wrapper returned", failure: false))
    nativeFallback.inspectClaudeNativeResults(try nativeData(native("native-owned")), since: since)
    check(nativeFallback.claudeInspectionNetworkDenials.first?.host == "api.cloudflare.com", "camelCase native current-run result recovers omitted stdout diagnostic")
    let eventsBeforeReplay = nativeFallback.eventCount
    nativeFallback.inspectClaudeNativeResults(try nativeData(native("native-owned", stamp: nativeDate.replacingOccurrences(of: "Z", with: ".123Z"))), since: since)
    check(nativeFallback.claudeInspectionNetworkDenials.count == 1 && nativeFallback.eventCount == eventsBeforeReplay,
          "fractional timestamp fallback deduplicates without tool/UI lifecycle replay")
    check(nativeFallback.text.isEmpty, "native transcript results never become public assistant text")
    try nativeNegative("native record before current execution is excluded", row: native("native-owned", stamp: ISO8601DateFormatter().string(from: since.addingTimeInterval(-1))))
    try nativeNegative("native foreign session excluded", row: native("native-owned", sessionID: other))
    try nativeNegative("native sidechain excluded", row: native("native-owned", sidechain: true))
    try nativeNegative("native numeric sidechain is unverified", row: native("native-owned", sidechain: 0))
    try nativeNegative("native unknown tool ID cannot bind itself", row: native("native-unknown"))
    try nativeNegative("native assistant/source content is never scanned", row: native("native-owned", type: "assistant"))
    try nativeNegative("native child parent linkage cannot become main-scope proof", row: native("native-owned", parent: "parent"))
    try nativeNegative("native invalid timestamp is unverified", row: native("native-owned", stamp: "not-a-date"))
    let staleNative = ExecutionStream(claudeSessionID: session)
    staleNative.inspectClaudeNativeResults(try nativeData(native("native-owned")), since: since)
    check(staleNative.claudeInspectionNetworkDenials.isEmpty, "native file does not mint stale requests absent from current transport")
    let boundedNative = ExecutionStream(claudeSessionID: session)
    try feed(boundedNative, request("native-owned"))
    var crowded = try nativeData(native("native-owned"))
    let inert = try nativeData(native("unbound-filler", type: "assistant"))
    for _ in 0..<1_001 { crowded.append(inert) }
    boundedNative.inspectClaudeNativeResults(crowded, since: since)
    check(boundedNative.claudeInspectionNetworkDenials.isEmpty, "native fallback inspects at most latest thousand records")

    func helperJSON(github: String = "available", r2: String = "available") throws -> String {
        let rows: [[String: String]] = [
            ["service": "github", "state": github, "check": "GET /user", "detail": "Authenticated read-only identity check."],
            ["service": "r2", "state": r2, "check": "bucket metadata", "detail": "Authenticated read-only bucket metadata check."],
        ]
        return String(decoding: try JSONSerialization.data(withJSONObject: rows), as: UTF8.self)
    }
    let healthy = try helperJSON()
    let recovered = ExecutionStream(claudeSessionID: session)
    try feed(recovered, request("denied-before-helper")); try feed(recovered, response("denied-before-helper"))
    try feed(recovered, request("trusted-helper", command: "os1 connection-status --json"))
    try feed(recovered, response("trusted-helper", content: healthy, failure: false))
    check(recovered.claudeInspectionNetworkDenials.isEmpty, "later exact trusted helper resolves earlier successful-service diagnostic")
    let beforeReplay = recovered.eventCount
    var oldNative = native("denied-before-helper")
    oldNative["message"] = response("denied-before-helper")["message"]
    var helperNative = native("trusted-helper")
    helperNative["message"] = response("trusted-helper", content: healthy, failure: false)["message"]
    let recoveredTranscript = try nativeData(oldNative) + nativeData(helperNative)
    recovered.inspectClaudeNativeResults(recoveredTranscript, since: since)
    recovered.inspectClaudeNativeResults(recoveredTranscript, since: since)
    check(recovered.claudeInspectionNetworkDenials.isEmpty && recovered.eventCount == beforeReplay,
          "chronological native readback never re-adds denial IDs resolved by later helper")
    try feed(recovered, request("denied-after-helper")); try feed(recovered, response("denied-after-helper"))
    check(recovered.claudeInspectionNetworkDenials.first?.toolUseID == "denied-after-helper", "a new denial after helper remains unresolved")
    let partialRecovery = ExecutionStream(claudeSessionID: session)
    try feed(partialRecovery, request("partial-gh")); try feed(partialRecovery, response("partial-gh"))
    try feed(partialRecovery, request("partial-r2")); try feed(partialRecovery, response("partial-r2", content: wrappedDiagnostic, failure: false))
    try feed(partialRecovery, request("partial-helper", command: "os1 connection-status --json"))
    try feed(partialRecovery, response("partial-helper", content: try helperJSON(r2: "network_unverified"), failure: false))
    check(partialRecovery.claudeInspectionNetworkDenials.map(\.host) == ["api.cloudflare.com"], "helper success resolves only its available service, not unverified service")
    for (label, command, failure) in [
        ("echo cannot impersonate trusted helper", "echo fake-helper-json", false),
        ("pipe cannot impersonate exact trusted helper", "os1 connection-status --json | cat", false),
        ("failed trusted helper cannot resolve enforcement", "os1 connection-status --json", true),
    ] {
        let notRecovered = ExecutionStream(claudeSessionID: session)
        try feed(notRecovered, request("still-denied")); try feed(notRecovered, response("still-denied"))
        try feed(notRecovered, request("not-proof", command: command))
        try feed(notRecovered, response("not-proof", content: healthy, failure: failure))
        check(notRecovered.claudeInspectionNetworkDenials.count == 1, label)
    }
    let claimedRecovery = ExecutionStream(claudeSessionID: session)
    try feed(claimedRecovery, request("claim-denied")); try feed(claimedRecovery, response("claim-denied"))
    try feed(claimedRecovery, ["type": "assistant", "session_id": session, "message": ["id": "claim", "content": [["type": "text", "text": healthy]]]])
    check(claimedRecovery.claudeInspectionNetworkDenials.count == 1, "assistant available claim cannot clear native diagnostics")
    let nativeRecovered = ExecutionStream(claudeSessionID: session)
    try feed(nativeRecovered, request("native-denial"))
    try feed(nativeRecovered, request("native-helper", command: "os1 connection-status --json"))
    var nativeRecoveryRow = native("native-helper")
    nativeRecoveryRow["message"] = response("native-helper", content: healthy, failure: false)["message"]
    nativeRecovered.inspectClaudeNativeResults(try nativeData(native("native-denial")) + nativeData(nativeRecoveryRow), since: since)
    check(nativeRecovered.claudeInspectionNetworkDenials.isEmpty, "owned helper native fallback resolves earlier native omitted stdout diagnostic")
    try feed(capped, request("after-overflow-helper", command: "os1 connection-status --json"))
    try feed(capped, response("after-overflow-helper", content: healthy, failure: false))
    check(capped.claudeInspectionNetworkDenials.count == 8, "truncated diagnostic history stays conservatively unresolved")
    print("Claude inspection network denial: \(checks) deterministic checks passed")
}
