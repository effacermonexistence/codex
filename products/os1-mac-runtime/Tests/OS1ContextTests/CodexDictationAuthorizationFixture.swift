import Foundation
import OS1Context

private enum DictationAuthFixtureError: Error { case failed(String), deadline }
private final class DictationAuthFixtureBox<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value
    init(_ value: Value) { self.value = value }
    func get() -> Value { lock.withLock { value } }
    func set(_ value: Value) { lock.withLock { self.value = value } }
}

/// Called before the ordinary runner. This is an artificial CLI process, not
/// Codex; no auth file, account credential, microphone, network, or model call.
func codexDictationAuthorizationChildIfRequested() {
    let arguments = CommandLine.arguments
    guard arguments.count >= 4, arguments[1] == "--codex-dictation-auth-child" else { return }
    let mode = arguments[2], trace = URL(fileURLWithPath: arguments[3])
    func record(_ value: String) {
        let data = Data((value + "\n").utf8)
        if let handle = try? FileHandle(forWritingTo: trace) {
            _ = try? handle.seekToEnd(); try? handle.write(contentsOf: data); try? handle.close()
        }
    }
    func emit(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { exit(81) }
        try? FileHandle.standardOutput.write(contentsOf: data + Data([0x0a]))
    }
    func receive() -> [String: Any]? {
        guard let line = readLine(), let data = line.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        if let method = value["method"] as? String { record(method) }
        return value
    }
    guard Array(arguments.dropFirst(4)) == ["-c", "mcp_servers={}", "app-server"],
          ProcessInfo.processInfo.environment["RUST_LOG"] == "off",
          ProcessInfo.processInfo.environment["OPENAI_API_KEY"] == nil,
          ProcessInfo.processInfo.environment["ANTHROPIC_API_KEY"] == nil else { exit(82) }
    record("environment-safe")
    record("pid=" + String(getpid()))
    if let home = ProcessInfo.processInfo.environment["CODEX_HOME"] { record("home=" + home) }
    guard let initial = receive(), initial["method"] as? String == "initialize",
          initial["id"] as? Int == 1 else { exit(83) }
    if mode == "timeout" { Thread.sleep(forTimeInterval: 30); exit(84) }
    if mode == "exit" { exit(85) }
    emit(["jsonrpc": "2.0", "id": 1, "result": ["userAgent": "fixture-only"]])
    guard let notification = receive(), notification["method"] as? String == "initialized",
          notification["id"] == nil else { exit(86) }
    guard let request = receive(), request["method"] as? String == "getAuthStatus",
          request["id"] as? Int == 2, let params = request["params"] as? [String: Bool],
          params == ["includeToken": true, "refreshToken": false] else { exit(87) }
    if mode == "cancel" { Thread.sleep(forTimeInterval: 30); exit(88) }
    let fakeSecret = "os1-auth-fixture-SECRET-NEVER-A-REAL-CREDENTIAL"
    switch mode {
    case "success": emit(["id": 2, "result": ["authMethod": "chatgpt", "authToken": fakeSecret]])
    case "apikey": emit(["id": 2, "result": ["authMethod": "apikey", "authToken": fakeSecret]])
    case "signed-out": emit(["id": 2, "result": ["authMethod": NSNull(), "authToken": NSNull()]])
    case "missing": emit(["id": 2, "result": ["authMethod": "chatgpt"]])
    case "invalid-token": emit(["id": 2, "result": ["authMethod": "chatgpt", "authToken": fakeSecret + "\n"]])
    case "long-token": emit(["id": 2, "result": ["authMethod": "chatgpt", "authToken": String(repeating: "x", count: 16_385)]])
    case "malformed": try? FileHandle.standardOutput.write(contentsOf: Data(("bad-json-" + fakeSecret + "\n").utf8))
    case "large": try? FileHandle.standardOutput.write(contentsOf: Data(repeating: 0x78, count: 100_000))
    case "wrong-id": emit(["id": 7, "result": ["authMethod": "chatgpt", "authToken": fakeSecret]])
    case "error":
        try? FileHandle.standardError.write(contentsOf: Data(fakeSecret.utf8))
        emit(["id": 2, "error": ["code": -1, "message": fakeSecret]])
    case "notification-budget":
        for _ in 0..<100 { emit(["method": "fixture/notification", "params": ["padding": String(repeating: "x", count: 1_000)]]) }
        emit(["id": 2, "result": ["authMethod": "chatgpt", "authToken": fakeSecret]])
    default: exit(89)
    }
    // Keep ownership/cancellation observable; the parent must close/terminate
    // this artificial child even when it has already produced a final response.
    Thread.sleep(forTimeInterval: 30)
    exit(0)
}

func runCodexDictationAuthorizationFixtures() throws {
    let result = DictationAuthFixtureBox<Result<Void, any Error>?>(nil)
    let semaphore = DispatchSemaphore(value: 0)
    let worker = Task.detached {
        do { try await dictationAuthorizationFixtureChecks(); result.set(.success(())) }
        catch { result.set(.failure(error)) }
        semaphore.signal()
    }
    guard semaphore.wait(timeout: .now() + 20) == .success else {
        worker.cancel(); throw DictationAuthFixtureError.deadline
    }
    guard let value = result.get() else { throw DictationAuthFixtureError.deadline }
    try value.get()
}

private func dictationAuthorizationFixtureChecks() async throws {
    let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("os1-dictation-auth-fixture-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true,
                                           attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: temporary) }
    let runner = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.path
    var checks = 0
    func check(_ condition: Bool, _ message: String) throws {
        guard condition else { throw DictationAuthFixtureError.failed(message) }
        checks += 1
    }
    func quote(_ value: String) -> String { "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'" }
    func fake(_ mode: String) throws -> (URL, URL) {
        let command = temporary.appendingPathComponent("fake-codex-" + mode)
        let trace = temporary.appendingPathComponent(mode + ".trace")
        try Data().write(to: trace)
        let script = "#!/bin/sh\nexec " + quote(runner) + " --codex-dictation-auth-child " + quote(mode) + " " + quote(trace.path) + " \"$@\"\n"
        try Data(script.utf8).write(to: command)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: command.path)
        return (command, trace)
    }
    func verifyRedacted(_ error: CodexDictationError) throws {
        let text = String(describing: error) + (error.errorDescription ?? "")
        try check(!text.contains("SECRET") && !text.contains("NEVER-A-REAL"), "public error leaked fixture credential")
    }
    func childRetired(_ trace: URL) async throws {
        let lines = try String(contentsOf: trace, encoding: .utf8).split(separator: "\n")
        guard let line = lines.first(where: { $0.hasPrefix("pid=") }), let pid = Int32(line.dropFirst(4)), pid > 0 else {
            throw DictationAuthFixtureError.failed("fake CLI must identify its owned child")
        }
        let deadline = ProcessInfo.processInfo.systemUptime + 2
        while kill(pid, 0) == 0 {
            guard ProcessInfo.processInfo.systemUptime < deadline else { throw DictationAuthFixtureError.failed("owned fixture child was not retired") }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        try check(errno == ESRCH, "owned fixture child must exit on terminal IPC")
    }
    func rejection(_ mode: String, _ expected: CodexDictationError, timeout: TimeInterval = 2) async throws {
        let (command, trace) = try fake(mode)
        let credential = CodexDictationAuthorization.credential(accountBook: { .init() }, executable: { command }, timeout: timeout)
        do { _ = try await credential() }
        catch let error as CodexDictationError {
            try check(error == expected, "wrong redacted authorization error for " + mode)
            try verifyRedacted(error)
            try await childRetired(trace)
            return
        }
        throw DictationAuthFixtureError.failed("fixture unexpectedly authorized: " + mode)
    }

    let (command, trace) = try fake("success")
    let bookCalls = DictationAuthFixtureBox(0), executableCalls = DictationAuthFixtureBox(0)
    let id = UUID().uuidString
    let selectedHome = BackendAccounts.accountsRoot().appendingPathComponent("codex").appendingPathComponent(id).path
    let book = BackendAccountBook(accounts: [.init(id: id, provider: "codex", label: "fixture-only", homePath: selectedHome)],
                                  active: ["codex": id])
    let credential = CodexDictationAuthorization.credential(
        accountBook: { bookCalls.set(bookCalls.get() + 1); return book },
        executable: { executableCalls.set(executableCalls.get() + 1); return command }, timeout: 2)
    try check(bookCalls.get() == 0 && executableCalls.get() == 0, "credential creation must not resolve auth or launch CLI")
    try check((try String(contentsOf: trace, encoding: .utf8)).isEmpty, "construction must be inert")
    let token = try await credential()
    try check(token == "os1-auth-fixture-SECRET-NEVER-A-REAL-CREDENTIAL", "successful CLI IPC must return only the fixture token")
    try check(bookCalls.get() == 1 && executableCalls.get() == 1, "lazy invocation resolves selected account once")
    let lines = try String(contentsOf: trace, encoding: .utf8).split(separator: "\n").map(String.init).filter { !$0.hasPrefix("pid=") }
    try check(lines == ["environment-safe", "home=" + selectedHome, "initialize", "initialized", "getAuthStatus"],
              "selected account and narrow IPC whitelist must match; no thread/model work")
    try await childRetired(trace)

    for (mode, expected) in [("apikey", CodexDictationError.credentialUnavailable), ("signed-out", .credentialUnavailable),
        ("missing", .invalidCredential), ("invalid-token", .invalidCredential), ("long-token", .invalidCredential),
        ("malformed", .invalidResponse), ("large", .messageTooLarge), ("wrong-id", .invalidResponse),
        ("error", .credentialUnavailable), ("notification-budget", .messageTooLarge), ("exit", .credentialUnavailable)] {
        try await rejection(mode, expected)
    }
    try await rejection("timeout", .timedOut, timeout: 0.15)

    let (cancelCommand, cancelTrace) = try fake("cancel")
    let cancellation = CodexDictationAuthorization.credential(accountBook: { .init() }, executable: { cancelCommand }, timeout: 2)
    let task = Task { try await cancellation() }
    let deadline = ProcessInfo.processInfo.systemUptime + 2
    while !(try String(contentsOf: cancelTrace, encoding: .utf8)).contains("getAuthStatus") {
        guard ProcessInfo.processInfo.systemUptime < deadline else { task.cancel(); throw DictationAuthFixtureError.deadline }
        try await Task.sleep(nanoseconds: 1_000_000)
    }
    task.cancel()
    do { _ = try await task.value; throw DictationAuthFixtureError.failed("cancelled IPC must not authorize") }
    catch let error as CodexDictationError { try check(error == .cancelled, "cancellation maps to fixed enum"); try verifyRedacted(error) }
    try await childRetired(cancelTrace)

    let preCancelled = Task {
        withUnsafeCurrentTask { $0?.cancel() }
        return try await credential()
    }
    do { _ = try await preCancelled.value; throw DictationAuthFixtureError.failed("pre-cancelled lookup must not launch") }
    catch let error as CodexDictationError { try check(error == .cancelled, "pre-cancelled task stops before resolving") }
    try check(bookCalls.get() == 1 && executableCalls.get() == 1, "pre-cancellation must not touch account metadata")

    let missing = CodexDictationAuthorization.credential(accountBook: { .init() }, executable: { nil })
    do { _ = try await missing(); throw DictationAuthFixtureError.failed("absent CLI must reject") }
    catch let error as CodexDictationError { try check(error == .credentialUnavailable, "absent CLI uses fixed redacted error") }

    let blockedApp = temporary.appendingPathComponent("Handy.app/fake-codex")
    let blockedCommand = CodexDictationAuthorization.credential(accountBook: { .init() }, executable: { blockedApp })
    do { _ = try await blockedCommand(); throw DictationAuthFixtureError.failed("Handy trust domain cannot supply Codex authorization") }
    catch let error as CodexDictationError { try check(error == .credentialUnavailable, "Handy executable is rejected from path metadata") }
    let blockedHome = BackendAccounts.accountsRoot().appendingPathComponent("codex/Handy/" + id).path
    let blockedBook = BackendAccountBook(accounts: [.init(id: id, provider: "codex", label: "fixture-only", homePath: blockedHome)], active: ["codex": id])
    let blockedAccount = CodexDictationAuthorization.credential(accountBook: { blockedBook }, executable: { command })
    do { _ = try await blockedAccount(); throw DictationAuthFixtureError.failed("Handy account home cannot supply Codex authorization") }
    catch let error as CodexDictationError { try check(error == .credentialUnavailable, "Handy home is rejected from metadata") }

    let invalidTimeout = CodexDictationAuthorization.credential(accountBook: { .init() }, executable: { command }, timeout: .infinity)
    do { _ = try await invalidTimeout(); throw DictationAuthFixtureError.failed("unbounded timeout must reject") }
    catch let error as CodexDictationError { try check(error == .invalidRequest, "infinite timeout is rejected before CLI access") }
    print("Codex dictation authorization fixtures passed (\(checks) checks; fake CLI only).")
}
