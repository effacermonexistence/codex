import Foundation
import Darwin

/// Native dictation alone may request the selected Codex CLI's authorization
/// in memory. The CLI remains the login/storage owner; there is no cache-file
/// parsing, credential persistence, login, thread creation, or model request.
/// Creating the closure is inert. Invoke it only after recording is requested.
public enum CodexDictationAuthorization {
    public static let maximumResponseBytes = 65_536

    public static func credential(
        accountBook: @escaping @Sendable () -> BackendAccountBook = { BackendAccounts.load() },
        executable: @escaping @Sendable () -> URL? = { locateExecutable() },
        timeout: TimeInterval = 10
    ) -> CodexNativeDictation.Credential {
        return {
            do { try Task.checkCancellation() }
            catch { throw CodexDictationError.cancelled }
            guard timeout.isFinite, timeout > 0, timeout <= 60 else { throw CodexDictationError.invalidRequest }
            guard let command = executable(), outsideHandyTrustDomain(command) else {
                throw CodexDictationError.credentialUnavailable
            }
            let book = accountBook()
            guard outsideHandyTrustDomain(BackendAccounts.home(provider: "codex", in: book)) else {
                throw CodexDictationError.credentialUnavailable
            }
            let accountEnvironment = BackendAccounts.environment(provider: "codex", in: book)
            let operation = DictationAuthorizationOperation(executable: command,
                accountEnvironment: accountEnvironment, timeout: timeout)
            return try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { operation.start($0) }
            } onCancel: { operation.cancel() }
        }
    }

    /// Only the known bundled Codex CLI and PATH are considered. No search of
    /// other applications, provider caches, account files, or helper ASR tools.
    public static func locateExecutable(path: String? = ProcessInfo.processInfo.environment["PATH"]) -> URL? {
        let bundled = [
            "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
            "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
            "/Applications/ChatGPT.app/Contents/Resources/codex",
            "/Applications/Codex.app/Contents/Resources/codex",
        ]
        let candidates = bundled + (path ?? "").split(separator: ":").filter { $0.hasPrefix("/") }
            .map { String($0) + "/codex" }
        for candidate in candidates {
            let url = URL(fileURLWithPath: candidate)
            guard outsideHandyTrustDomain(url), FileManager.default.isExecutableFile(atPath: candidate) else { continue }
            var directory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: candidate, isDirectory: &directory), !directory.boolValue else { continue }
            return url
        }
        return nil
    }

    /// Metadata-only confinement; never inspect a helper app's files or auth.
    private static func outsideHandyTrustDomain(_ url: URL) -> Bool {
        guard url.isFileURL else { return false }
        func denied(_ path: URL) -> Bool {
            path.pathComponents.contains(where: {
                let component = $0.lowercased()
                return ["handy", "handy.app", ".handy", "com.pais.handy"].contains(component)
            })
        }
        let lexical = url.standardizedFileURL
        guard !denied(lexical) else { return false }
        return !denied(lexical.resolvingSymlinksInPath())
    }
}

/// One bounded IPC exchange on one owned child. All errors are fixed redacted
/// enum values; server error bodies, tokens, and subprocess stderr never escape.
private final class DictationAuthorizationOperation: @unchecked Sendable {
    private struct Response: Decodable {
        let id: Int?
        let result: AuthStatus?
        let hasError: Bool
        private enum CodingKeys: String, CodingKey { case id, result, error }
        init(from decoder: any Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            id = try values.decodeIfPresent(Int.self, forKey: .id)
            hasError = values.contains(.error)
            result = hasError ? nil : try values.decodeIfPresent(AuthStatus.self, forKey: .result)
        }
    }
    private struct AuthStatus: Decodable {
        let authMethod: String?
        let authToken: String?
    }
    private enum Stage { case initialize, authorization }
    private let queue = DispatchQueue(label: "com.omaragi.os1.dictation.authorization")
    private let process = Process()
    private let input = Pipe(), output = Pipe()
    private let executable: URL, accountEnvironment: [String: String], timeout: TimeInterval
    private var readSource: (any DispatchSourceRead)?, timer: (any DispatchSourceTimer)?
    private var continuation: CheckedContinuation<String, any Error>?
    private var cancelled = false, finished = false
    private var stage = Stage.initialize
    private var buffer = Data(), totalBytes = 0

    init(executable: URL, accountEnvironment: [String: String], timeout: TimeInterval) {
        self.executable = executable; self.accountEnvironment = accountEnvironment; self.timeout = timeout
    }

    func start(_ continuation: CheckedContinuation<String, any Error>) {
        queue.async { self.begin(continuation) }
    }
    func cancel() {
        queue.async {
            self.cancelled = true
            if self.continuation != nil { self.finish(.failure(.cancelled)) }
        }
    }

    private func begin(_ continuation: CheckedContinuation<String, any Error>) {
        self.continuation = continuation
        guard !cancelled else { finish(.failure(.cancelled)); return }
        process.executableURL = executable
        // Disable configured MCP startup. No agent/thread is ever requested.
        process.arguments = ["-c", "mcp_servers={}", "app-server"]
        let inherited = ProcessInfo.processInfo.environment
        let keys = ["HOME", "PATH", "TMPDIR", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "SHELL"]
        // Never forward API keys or other credential-bearing environment values.
        var environment = Dictionary(uniqueKeysWithValues: keys.compactMap { key in inherited[key].map { (key, $0) } })
        environment["HOME"] = FileManager.default.homeDirectoryForCurrentUser.path
        if let home = accountEnvironment["CODEX_HOME"] { environment["CODEX_HOME"] = home }
        environment["RUST_LOG"] = "off"
        process.environment = environment
        process.currentDirectoryURL = URL(fileURLWithPath: "/", isDirectory: true)
        process.standardInput = input; process.standardOutput = output; process.standardError = FileHandle.nullDevice
        process.terminationHandler = { [weak self] _ in
            guard let self else { return }
            self.queue.async {
                self.drain()
                if !self.finished { self.finish(.failure(.credentialUnavailable)) }
            }
        }
        do { try process.run() }
        catch { finish(.failure(.credentialUnavailable)); return }

        let fd = output.fileHandleForReading.fileDescriptor
        let flags = fcntl(fd, F_GETFL)
        guard flags >= 0, fcntl(fd, F_SETFL, flags | O_NONBLOCK) >= 0 else {
            finish(.failure(.transportFailed)); return
        }
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        source.setEventHandler { [weak self] in self?.drain() }
        readSource = source; source.resume()
        let deadline = DispatchSource.makeTimerSource(queue: queue)
        deadline.schedule(deadline: .now() + timeout)
        deadline.setEventHandler { [weak self] in self?.finish(.failure(.timedOut)) }
        timer = deadline; deadline.resume()
        send(["jsonrpc": "2.0", "id": 1, "method": "initialize", "params": [
            "clientInfo": ["name": "os1-native-dictation", "version": "1"],
            "capabilities": ["experimentalApi": true],
        ]])
    }

    private func send(_ object: [String: Any]) {
        guard !finished else { return }
        do {
            var data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
            guard data.count <= 4_096 else { finish(.failure(.invalidRequest)); return }
            data.append(0x0a)
            try input.fileHandleForWriting.write(contentsOf: data)
        } catch { finish(.failure(.transportFailed)) }
    }

    private func drain() {
        guard !finished else { return }
        var bytes = [UInt8](repeating: 0, count: 4_096)
        while !finished {
            let count = Darwin.read(output.fileHandleForReading.fileDescriptor, &bytes, bytes.count)
            if count == 0 {
                // Process exit without a complete response is not authorization.
                finish(.failure(.credentialUnavailable)); return
            }
            if count < 0 {
                if errno == EAGAIN || errno == EWOULDBLOCK { return }
                if errno == EINTR { continue }
                finish(.failure(.transportFailed)); return
            }
            totalBytes += count
            guard totalBytes <= CodexDictationAuthorization.maximumResponseBytes else {
                finish(.failure(.messageTooLarge)); return
            }
            buffer.append(contentsOf: bytes.prefix(count))
            while !finished, let newline = buffer.firstIndex(of: 0x0a) {
                let line = Data(buffer.prefix(upTo: newline))
                buffer.removeSubrange(...newline)
                if line.isEmpty { continue }
                receive(line)
            }
        }
    }

    private func receive(_ line: Data) {
        guard let response = try? JSONDecoder().decode(Response.self, from: line) else {
            finish(.failure(.invalidResponse)); return
        }
        guard let id = response.id else { return } // bounded unsolicited notification
        let expected = stage == .initialize ? 1 : 2
        guard id == expected, !response.hasError, let status = response.result else {
            finish(.failure(response.hasError ? .credentialUnavailable : .invalidResponse)); return
        }
        switch stage {
        case .initialize:
            stage = .authorization
            send(["jsonrpc": "2.0", "method": "initialized", "params": [:] as [String: String]])
            send(["jsonrpc": "2.0", "id": 2, "method": "getAuthStatus", "params": [
                "includeToken": true, "refreshToken": false,
            ]])
        case .authorization:
            guard status.authMethod == "chatgpt" else { finish(.failure(.credentialUnavailable)); return }
            guard let token = status.authToken, !token.isEmpty, token.utf8.count <= 16_384,
                  token.unicodeScalars.allSatisfy({ (33...126).contains($0.value) }) else {
                finish(.failure(.invalidCredential)); return
            }
            finish(.success(token))
        }
    }

    private func finish(_ result: Result<String, CodexDictationError>) {
        guard !finished else { return }
        finished = true
        timer?.cancel(); timer = nil
        readSource?.cancel(); readSource = nil
        process.terminationHandler = nil
        try? input.fileHandleForWriting.close()
        try? output.fileHandleForReading.close()
        buffer.removeAll(keepingCapacity: false)
        // Only this operation's child can be terminated, never a shared CLI/app.
        if process.isRunning {
            process.terminate()
            let ownedProcess = process
            queue.asyncAfter(deadline: .now() + 0.25) {
                if ownedProcess.isRunning { kill(ownedProcess.processIdentifier, SIGKILL) }
            }
        }
        let waiter = continuation; continuation = nil
        switch result {
        case .success(let token): waiter?.resume(returning: token)
        case .failure(let error): waiter?.resume(throwing: error)
        }
    }
}
