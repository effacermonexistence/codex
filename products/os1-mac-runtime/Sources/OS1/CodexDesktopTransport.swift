import Foundation
import Darwin

/// Versioned, local Desktop IPC. Desktop owns the writer; OS1 never fabricates
/// a running thread from a rollout file or starts a parallel CLI turn.
final class CodexDesktopTransport {
    /// Desktop renders the optimistic request before app-server normalization.
    /// Its untrusted-input decoder requires the text_elements array even when empty.
    static func textInput(_ text: String) -> [String: Any] {
        ["type": "text", "text": text, "text_elements": [[String: Any]]()]
    }

    private var fd: Int32 = -1
    private var clientID = "pending"
    private var responseOwner: String?
    private var owners: [String: String] = [:]
    private var snapshots: [String: (revision: Int, sequence: Int, state: [String: Any])] = [:]
    private var sequence = 0

    private func receive(deadline: Date) throws -> [String: Any] {
        let header = try exact(4, deadline: deadline)
        let size = header.enumerated().reduce(UInt32(0)) { $0 | (UInt32($1.element) << (8 * $1.offset)) }
        guard size > 0, size <= 32 * 1024 * 1024 else { throw failure("invalid frame") }
        guard let message = try JSONSerialization.jsonObject(with: exact(Int(size), deadline: deadline)) as? [String: Any] else { throw failure("invalid response") }
        if message["type"] as? String == "client-discovery-request", let requestID = message["requestId"] {
            try send(["type": "client-discovery-response", "requestId": requestID, "sourceClientId": clientID, "response": ["canHandle": false]])
        }
        // This is the Desktop writer's state, not a second app-server's stale view.
        if message["type"] as? String == "broadcast",
           message["method"] as? String == "thread-stream-state-changed",
           message["version"] as? Int == 11,
           let params = message["params"] as? [String: Any],
           params["hostId"] as? String == "local",
           let thread = params["conversationId"] as? String,
           let owner = owners[thread], message["sourceClientId"] as? String == owner,
           let targets = message["targetClientIds"] as? [String], targets.contains(clientID),
           let change = params["change"] as? [String: Any], change["type"] as? String == "snapshot",
           let revision = change["revision"] as? Int,
           let state = change["conversationState"] as? [String: Any],
           state["id"] as? String == thread, state["hostId"] as? String == "local",
           revision >= (snapshots[thread]?.revision ?? -1) {
            sequence += 1
            snapshots[thread] = (revision, sequence, state)
        }
        return message
    }

    func follow(threadID: String, following: Bool) throws {
        guard owners[threadID] != nil else { throw failure("unacknowledged owner") }
        try send(["type": "broadcast", "method": "thread-stream-following-changed", "version": 1,
                  "sourceClientId": clientID,
                  "params": ["conversationId": threadID, "hostId": "local", "following": following]])
    }

    private func observeTurns(threadID: String, deadline: Date) throws -> [[String: Any]] {
        let before = snapshots[threadID]?.sequence ?? -1
        try follow(threadID: threadID, following: true)
        let until = min(deadline, Date().addingTimeInterval(10))
        while (snapshots[threadID]?.sequence ?? -1) <= before {
            _ = try receive(deadline: until)
        }
        guard let state = snapshots[threadID]?.state,
              let history = state["turnHistory"] as? [String: Any], history["kind"] as? String == "canonical",
              let canonical = history["history"] as? [String: Any],
              let entities = canonical["entitiesByKey"] as? [String: Any] else {
            throw failure("unsupported Desktop history; execution preserved")
        }
        return entities.values.compactMap { $0 as? [String: Any] }
    }

    func observeTurn(threadID: String, turnID: String, deadline: Date) throws -> [String: Any]? {
        // A missing turn is not an interrupted turn. Never substitute the last turn.
        try observeTurns(threadID: threadID, deadline: deadline).first { $0["turnId"] as? String == turnID }
    }

    /// A Desktop presentation/workspace callback can fail AFTER turn/start was
    /// accepted. Reconcile that acknowledgement, never send a second start.
    func startTurn(threadID: String, request original: [String: Any], context: [String: Any], deadline: Date) throws -> String {
        let messageID = UUID().uuidString
        var request = original
        request["clientUserMessageId"] = messageID
        do {
            let response = try self.request("thread-follower-start-turn", version: 2, params: [
                "conversationId": threadID, "turnStart": ["request": request, "context": context]])
            if let result = response["result"] as? [String: Any], let turn = result["turn"] as? [String: Any],
               let id = turn["id"] as? String, !id.isEmpty { return id }
            throw failure("missing start acknowledgement")
        } catch {
            let originalError = error
            let until = min(deadline, Date().addingTimeInterval(10))
            while Date() < until {
                let turns: [[String: Any]]
                do { turns = try observeTurns(threadID: threadID, deadline: until) }
                catch { throw originalError }
                let matches = turns.filter {
                    ($0["params"] as? [String: Any])?["clientUserMessageId"] as? String == messageID
                }
                if matches.count > 1 { throw failure("ambiguous start reconciliation; execution preserved") }
                if let matched = matches.first, let id = matched["turnId"] as? String, !id.isEmpty {
                    return id
                }
                Thread.sleep(forTimeInterval: 0.1)
            }
            throw originalError
        }
    }
    init(socketPath: String = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex/ipc/ipc.sock").path) throws {
        fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw failure("socket") }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(socketPath.utf8) + [0]
        guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { Darwin.close(fd); fd = -1; throw failure("socket path") }
        withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: bytes) }
        let connected = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard connected == 0 else { Darwin.close(fd); fd = -1; throw failure("Desktop is not connected") }
        var noSignal: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size))
        var sendTimeout = timeval(tv_sec: 5, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &sendTimeout, socklen_t(MemoryLayout<timeval>.size))
        do {
            let result = try request("initialize", version: 0, params: ["clientType": "os1"])
            guard let id = result["clientId"] as? String else { throw failure("initialize acknowledgement") }
            clientID = id
        } catch { Darwin.close(fd); fd = -1; throw error }
    }
    deinit { if fd >= 0 { Darwin.close(fd) } }
    private func failure(_ detail: String) -> NSError {
        NSError(domain: "OS1.CodexDesktop", code: 1, userInfo: [NSLocalizedDescriptionKey: "Codex Desktop handoff: \(detail)"])
    }
    private func exact(_ count: Int, deadline: Date) throws -> Data {
        var result = Data()
        while result.count < count {
            let remaining = deadline.timeIntervalSinceNow
            guard remaining > 0 else { throw failure("response timed out; dispatch state must not be replayed") }
            var descriptor = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
            let ready = Darwin.poll(&descriptor, 1, Int32(min(remaining * 1000, 1000)))
            if ready < 0 { if errno == EINTR { continue }; throw failure("poll") }
            if ready == 0 { continue }
            var chunk = [UInt8](repeating: 0, count: min(count - result.count, 65536))
            let n = Darwin.read(fd, &chunk, chunk.count)
            guard n > 0 else { throw failure("connection closed") }
            result.append(contentsOf: chunk.prefix(n))
        }
        return result
    }
    private func send(_ object: [String: Any]) throws {
        let body = try JSONSerialization.data(withJSONObject: object)
        guard body.count <= 32 * 1024 * 1024 else { throw failure("oversized frame") }
        var length = UInt32(body.count).littleEndian
        var frame = withUnsafeBytes(of: &length) { Data($0) }; frame.append(body)
        try frame.withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let n = Darwin.write(fd, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if n < 0 && errno == EINTR { continue }
                guard n > 0 else { throw failure("write failed; dispatch state must not be replayed") }
                offset += n
            }
        }
    }
    func request(_ method: String, version: Int, params: [String: Any], timeout: TimeInterval = 15) throws -> [String: Any] {
        let id = UUID().uuidString
        try send(["type": "request", "requestId": id, "sourceClientId": clientID,
                  "version": version, "method": method, "params": params, "timeoutMs": Int(timeout * 1000)])
        let deadline = Date().addingTimeInterval(timeout + 1)
        while true {
            let message = try receive(deadline: deadline)
            guard message["type"] as? String == "response", message["requestId"] as? String == id else { continue }
            if let error = message["error"] { throw failure(String(describing: error)) }
            guard let result = message["result"] as? [String: Any] else { throw failure("missing result") }
            responseOwner = message["handledByClientId"] as? String
            return result
        }
    }
    func discover(threadID: String) throws {
        _ = try request("thread-owner-discovery", version: 1, params: ["hostId": "local", "conversationId": threadID], timeout: 3)
        guard let owner = responseOwner, !owner.isEmpty else { throw failure("owner identity missing") }
        owners[threadID] = owner
    }
    static let desktopBundleID = "com.openai.codex"

    /// Ensure the Desktop owner is available without opening a thread or
    /// activating the app. Automatic backend routing must not steal focus;
    /// explicit user reveal remains in `revealInCodexDesktop`.
    ///
    /// `launch` is the caller's `BackendWindowFocus.desktopLaunch` decision, so
    /// the focus policy lives in one place. It is false whenever Desktop is
    /// already running: `open -b <bundle id>` would then deliver a reopen Apple
    /// Event, and Desktop answers that by showing and focusing its window —
    /// which is how every automatic route used to jump in front of the app the
    /// owner was actually using. A running owner serves the turn through its
    /// IPC socket; its window is not involved and must not be touched.
    static func ensureRunning(threadID: String, launch: Bool) throws {
        guard UUID(uuidString: threadID) != nil else { throw NSError(domain: "OS1.CodexDesktop", code: 3) }
        guard launch else { return }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        // Cold launch only. `-g` keeps a launch out of the foreground, and a
        // launch — unlike a reopen — carries no activation request of its own.
        process.arguments = ["-g", "-b", desktopBundleID]
        try process.run(); process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw NSError(domain: "OS1.CodexDesktop", code: 2) }
    }
}
