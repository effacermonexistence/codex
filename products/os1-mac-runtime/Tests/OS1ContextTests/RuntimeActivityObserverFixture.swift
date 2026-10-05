import Foundation
import OS1Context

private final class ActivityCapture: @unchecked Sendable {
    let signal = DispatchSemaphore(value: 0)
    let lock = NSLock()
    var values: [(RuntimeActivity, Date)] = []
    func receive(_ activity: RuntimeActivity) {
        lock.lock(); values.append((activity, Date())); lock.unlock(); signal.signal()
    }
    func snapshot() -> [(RuntimeActivity, Date)] { lock.lock(); defer { lock.unlock() }; return values }
}

func runRuntimeActivityObserverFixtures() throws {
    func check(_ value: Bool, _ message: String) throws {
        if !value { throw NSError(domain: "ActivityRelayFixture", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    }
    let received = Date(timeIntervalSince1970: 1_700_000_000)
    let progressEvent = NativeExecutionProgress.Event(sequence: 1, kind: .toolStarted, tool: "Bash", scope: "main", observedAt: received)
    let progress = NativeExecutionProgress(sequence: 1, kind: .toolStarted, tool: "Bash", scope: "main",
        toolsRequested: 1, toolsReturned: 0, activeTools: 1, observedAt: received, events: [progressEvent])
    let typedActivity = RuntimeActivity(.executing, provider: "claude", timestamp: received,
        publicText: "PUBLIC_TEXT_UNCHANGED", tool: "Bash", progress: progress)
    let roundtrip = try JSONDecoder().decode(RuntimeActivity.self, from: JSONEncoder().encode(typedActivity))
    try check(roundtrip == typedActivity, "native metadata/public prose roundtrip changed")
    try check(roundtrip.publicTextOrigin == nil, "legacy text gained native authorship")
    for origin in [RuntimeActivity.PublicTextOrigin.nativeAssistant, .systemStatus] {
        let tagged = RuntimeActivity(.executing, provider: "claude", publicText: "PUBLIC_TEXT_UNCHANGED", publicTextOrigin: origin)
        let decoded = try JSONDecoder().decode(RuntimeActivity.self, from: JSONEncoder().encode(tagged))
        try check(decoded.publicTextOrigin == origin && decoded.publicText == tagged.publicText, "public source tag or bytes mutated")
    }
    try check(RuntimeActivity(.executing, publicTextOrigin: .nativeAssistant).publicTextOrigin == nil,
              "absent text inherited an authorship claim")
    try check(RuntimeActivity(.waitingForSource, provider: "claude", progress: progress).progress == nil,
              "pre-dispatch source wait inherited native progress")
    var malformed = try JSONSerialization.jsonObject(with: JSONEncoder().encode(typedActivity)) as! [String: Any]
    malformed["progress"] = ["kind": "untrusted_future_kind", "rawReasoning": "PRIVATE_THINKING_SENTINEL"]
    let safe = try JSONDecoder().decode(RuntimeActivity.self, from: JSONSerialization.data(withJSONObject: malformed))
    try check(safe.progress == nil && safe.publicText == "PUBLIC_TEXT_UNCHANGED", "bad optional metadata suppressed public prose")
    try check(!String(decoding: JSONEncoder().encode(safe), as: UTF8.self).contains("PRIVATE_THINKING_SENTINEL"),
              "quarantined metadata leaked private content")
    try check(RuntimeActivity(.executing, tool: "Bash").toolProgressLabel != RuntimeActivity(.executing, tool: "Read").toolProgressLabel,
              "Claude tools still collapse into one generic label")
    for delimiter in ["·", "ㆍ", ",", "/"] {
        for tail in ["금지", "없이", "하지 마", "는 하지 마세요"] {
            let list = ["파일 변경", "웹", "브라우저", "구매", "외부 전송", "서브에이전트"].joined(separator: delimiter)
            let prompt = "선택된 폴더의 result.txt를 읽고 그대로 답해. " + list + " " + tail + "."
            let scope = ScopeResolution.resolve(prompt)
            try check(scope.scope == .readOnly && scope.prohibitions.contains("do not modify files"), "negation list grants write authority")
        }
    }
    for prompt in ["app.py를 고쳐. 웹·구매·외부 전송 금지.", "app.py를 수정해. 브라우저·결제·서브에이전트 금지."] {
        try check(ScopeResolution.resolve(prompt).scope == .workspaceWrite, "prohibition list erased an authorized edit")
    }
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-relay-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let url = root.appendingPathComponent("activity.json"), capture = ActivityCapture()
    let observer = RuntimeActivityObserver(url: url, receive: { capture.receive($0) })
    try check(observer.start(), "directory event source unavailable")
    defer { observer.finish() }
    // Atomic inode replacement, including Unicode and pending-verification final.
    for i in 0..<30 {
        let activity = RuntimeActivity(i == 29 ? .verifying : .executing, provider: "codex",
            timestamp: Date(), publicText: "native-\(i) 그대로 한글 \(String(repeating: "x", count: 24000))")
        try JSONEncoder().encode(activity).write(to: url, options: .atomic)
        try check(capture.signal.wait(timeout: .now() + 0.8) == .success, "public activity waited for exit/poll timeout")
        try check(capture.snapshot().last?.0 == activity, "public text/phase changed in transport")
    }
    let samples = capture.snapshot().map { $0.1.timeIntervalSince($0.0.timestamp) * 1_000 }
    // Corruption/oversize cannot enter display; duplicate finish does not emit twice.
    try Data("not json".utf8).write(to: url, options: .atomic)
    try check(capture.signal.wait(timeout: .now() + 0.05) == .timedOut, "malformed event accepted")
    try Data(repeating: 0x20, count: 150001).write(to: url, options: .atomic)
    try check(capture.signal.wait(timeout: .now() + 0.05) == .timedOut, "oversized event accepted")
    let last = RuntimeActivity(.syncing, provider: "codex", publicText: "final pending, not adopted")
    try JSONEncoder().encode(last).write(to: url, options: .atomic)
    observer.finish()
    try check(capture.snapshot().last?.0 == last, "exit race lost latest event")
    let count = capture.snapshot().count
    observer.finish()
    try check(capture.snapshot().count == count, "finish duplicated latest event")
    // An actual child remains alive after writing: relay must not await exit.
    let childCapture = ActivityCapture(), child = Process()
    let childObserver = RuntimeActivityObserver(url: url, receive: { childCapture.receive($0) })
    try? FileManager.default.removeItem(at: url)
    try check(childObserver.start(), "child observer unavailable")
    child.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
    child.arguments = ["-c", "import json,time,os,sys; p=sys.argv[1]; json.dump({'phase':'verifying','provider':'claude','timestamp':time.time()-978307200,'publicText':'NATIVE_FINAL_PENDING'},open(p+'.tmp','w')); os.replace(p+'.tmp',p); time.sleep(1.5)", url.path]
    child.standardOutput = FileHandle.nullDevice; child.standardError = FileHandle.nullDevice
    try child.run()
    let early = childCapture.signal.wait(timeout: .now() + 0.8) == .success
    try check(early && child.isRunning, "display blocked on subprocess/remote completion")
    child.waitUntilExit(); childObserver.finish()
    try check(childCapture.snapshot().last?.0.publicText == "NATIVE_FINAL_PENDING", "Claude pending output changed")
    try check(!ReviewPass.applies(request: "코드 기준으로 실행 흐름을 설명해봐"), "ordinary explain silently starts paid reviewer")
    try check(ReviewPass.applies(request: "코드 기준으로 실행 흐름을 설명해봐. 교차 검토해."), "explicit review no longer available")
    let stream = ExecutionStream(), session = UUID().uuidString.lowercased()
    var cursor = 0
    func result(_ text: String, sessionID: String, error: Bool) throws {
        let data = try JSONSerialization.data(withJSONObject: ["type": "result", "session_id": sessionID,
            "is_error": error, "result": text])
        stream.ingestClaude(data + Data([10]))
    }
    try result("first exact final", sessionID: session, error: false)
    try check(stream.takeClaudePublicFinal(sessionID: session, after: &cursor) == "first exact final", "bound native final missing")
    try check(stream.takeClaudePublicFinal(sessionID: session, after: &cursor) == nil, "old final repeated during next turn")
    try result("private wrong-session result", sessionID: UUID().uuidString, error: false)
    try check(stream.takeClaudePublicFinal(sessionID: session, after: &cursor) == nil, "wrong-session result displayed")
    try result("error diagnostic", sessionID: session, error: true)
    try check(stream.takeClaudePublicFinal(sessionID: session, after: &cursor) == nil, "error payload displayed as final")
    try result("second exact final", sessionID: session, error: false)
    try check(stream.takeClaudePublicFinal(sessionID: session, after: &cursor) == "second exact final", "later steered final hidden")
    try check(!ReviewPass.applies(request: "코드를 설명해봐. 교차 검토하지 마."), "negated review starts reviewer")
    try check(!ReviewPass.applies(request: "코드에서 교차 검토 단계가 어떻게 도는지 설명해봐."), "review mention treated as authorization")
    try check(!ReviewPass.applies(request: "Explain why the code cross-check step is slow."), "English review mention starts reviewer")
    try check(ReviewPass.applies(request: "Explain the code path. Please cross-check it."), "explicit English review lost")

    print("OS-1 public relay: 30 atomic updates, max \(String(format: "%.2f", samples.max() ?? 0)) ms; pre-exit delivery, exact text, malformed/oversize/exit races, explicit review OK")
}
