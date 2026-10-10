import CryptoKit
import Darwin
import Foundation
import OS1Context

/// Bounded transport for a *candidate-only* local OpenClaw Gateway turn.
/// The OS-1 host must supply hashes from its verified installed resource
/// manifest and must perform the separate signed route/permission/REVAS gates.
/// This runner never dispatches native agents or adopts task quality.
enum LocalOpenClawGatewayRunner {
    struct InstalledIdentity: Sendable {
        let nodePath: String
        let nodeSHA256: String
        let entryPath: String
        let entrySHA256: String
        let pluginDirectory: String
        let pluginIndexSHA256: String
        let pluginManifestSHA256: String
        let pluginPackageSHA256: String
    }

    struct Terminal: Sendable {
        let runDirectory: String
        let gatewayPID: Int32
        let clientPID: Int32
        let port: Int
        let gateReceipt: Data
        let gateObservedBeforeTerminal: Bool
        let gatewayEnvelope: Data
        let exitCode: Int32
        let gateReceiptSHA256: String
        let gatewayEnvelopeSHA256: String
        /// Transport proof only. Feed these bytes to
        /// OpenClawAgentController.proposeGateway before possible adoption.
        let qualityClaim = "unverified"
    }

    enum Failure: String, Error, Sendable {
        case identityMismatch = "installed_identity_mismatch"
        case invalidRunPath = "invalid_run_path"
        case privateFileFailure = "private_file_failure"
        case portUnavailable = "loopback_port_unavailable"
        case gatewayStartFailed = "gateway_start_failed"
        case gatewayNotReady = "gateway_not_ready"
        case clientStartFailed = "gateway_client_start_failed"
        case clientTimeout = "gateway_client_timeout"
        case clientFailed = "gateway_client_failed"
        case missingGate = "pre_model_gate_missing"
        case envelopeInvalid = "terminal_envelope_invalid"
        case cancelled = "cancelled"
    }

    private final class CancellationFlag: @unchecked Sendable {
        private let lock = NSLock()
        private var value = false
        func cancel() { lock.lock(); value = true; lock.unlock() }
        var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return value }
    }

    private struct Paths {
        let run: URL
        let home: URL
        let workspace: URL
        let config: URL
        let contract: URL
        let message: URL
        let gate: URL
        let gatewayOut: URL
        let gatewayErr: URL
        let clientOut: URL
        let clientErr: URL
    }

    private struct Command {
        let executable: String
        let arguments: [String]
        let workingDirectory: String
        init(_ value: OpenClawAgentController.LaunchCommand) {
            executable = value.executable
            arguments = value.arguments
            workingDirectory = value.workingDirectory
        }
        init(executable: String, arguments: [String], workingDirectory: String) {
            self.executable = executable
            self.arguments = arguments
            self.workingDirectory = workingDirectory
        }
    }

    /// Never call this with a source-checkout hash or a model-produced hash.
    /// `turn` must already have passed OS-1's request and owner-policy lock.
    static func run(turn: OpenClawAgentController.PreparedTurn,
                    installed: InstalledIdentity) async throws -> Terminal {
        let cancellation = CancellationFlag()
        return try await withTaskCancellationHandler {
            try await Task.detached(priority: .utility) {
                try runBlocking(turn: turn, installed: installed, cancellation: cancellation)
            }.value
        } onCancel: {
            cancellation.cancel()
        }
    }

    // The blocking core is injectable only for an offline fake-binary fixture.
    // Production always calls the async wrapper above.
    static func runForOfflineFixture(turn: OpenClawAgentController.PreparedTurn,
                                     installed: InstalledIdentity,
                                     cancelled: @escaping () -> Bool = { false },
                                     clientTimeoutSeconds: TimeInterval = 45) throws -> Terminal {
        guard clientTimeoutSeconds > 0, clientTimeoutSeconds <= 45 else { throw Failure.clientTimeout }
        return try runBlocking(turn: turn, installed: installed, cancellation: nil,
                               extraCancelled: cancelled, clientTimeoutSeconds: clientTimeoutSeconds)
    }

    private static func runBlocking(turn: OpenClawAgentController.PreparedTurn,
                                    installed: InstalledIdentity,
                                    cancellation: CancellationFlag?,
                                    extraCancelled: () -> Bool = { false },
                                    clientTimeoutSeconds: TimeInterval = 45) throws -> Terminal {
        func checkCancel() throws {
            if cancellation?.isCancelled == true || extraCancelled() { throw Failure.cancelled }
        }
        try checkCancel()
        try verifyInstalled(installed)
        let paths = try privatePaths(runID: turn.contract.runID)
        try verifyPreparedTurn(turn, paths: paths, installed: installed)
        let port = try reserveFreeLoopbackPort()
        let prepared = try OpenClawAgentController.prepareGateway(turn: turn, port: port)
        let commands = try OpenClawAgentController.gatewayCommands(
            prepared: prepared, privateHome: paths.home.path,
            nodePath: installed.nodePath, entryPath: installed.entryPath,
            configPath: paths.config.path, contractPath: paths.contract.path,
            messagePath: paths.message.path, workspace: paths.workspace.path)

        try createPrivateRun(paths)
        var gateway: Process?
        var client: Process?
        defer {
            // No global Gateway, browser or unrelated process is touched.
            if let client { stopOwned(client) }
            if let gateway { stopOwned(gateway) }
            // The only secret-bearing file is the Gateway config. Delete it
            // after both children are terminal; preserve nonsecret evidence.
            try? FileManager.default.removeItem(at: paths.config)
        }
        do {
            try writePrivate(prepared.configBytes, to: paths.config)
            try writePrivate(turn.contractBytes, to: paths.contract)
            try writePrivate(Data(turn.request.utf8), to: paths.message)
            try checkCancel()
            try verifyInstalled(installed)
            gateway = try launch(Command(commands.gateway), stdout: paths.gatewayOut, stderr: paths.gatewayErr)
            try writePID(gateway!.processIdentifier, to: paths.run.appendingPathComponent("gateway-owned-pid.json"))
        } catch {
            if error is Failure { throw error }
            throw Failure.gatewayStartFailed
        }
        guard let gateway else { throw Failure.gatewayStartFailed }

        // `health` can exit 0 with {status:"starting"}; only top-level ok:true
        // from the exact config/port, while our Gateway child remains alive,
        // permits a client request. A connection check rejects false health.
        let readinessDeadline = Date().addingTimeInterval(15)
        var ready = false
        var healthAttempt = 0
        while Date() < readinessDeadline {
            try checkCancel()
            guard gateway.isRunning else { throw Failure.gatewayStartFailed }
            healthAttempt += 1
            let out = paths.run.appendingPathComponent("health-\(healthAttempt).json")
            let err = paths.run.appendingPathComponent("health-\(healthAttempt).err")
            let healthCommand = health(installed: installed, paths: paths)
            if let h = try? launch(healthCommand, stdout: out, stderr: err) {
                let finished = waitOwned(h, until: Date().addingTimeInterval(3), cancelled: { cancellation?.isCancelled == true || extraCancelled() })
                if finished, h.terminationStatus == 0,
                   let data = try? readBounded(out, maxBytes: 4_096, requirePrivate: true),
                   healthReady(data), gateway.isRunning, loopbackConnects(port: port) {
                    ready = true
                }
                stopOwned(h)
            }
            try? FileManager.default.removeItem(at: out)
            try? FileManager.default.removeItem(at: err)
            if ready { break }
            Thread.sleep(forTimeInterval: 0.10)
        }
        try checkCancel()
        guard ready else { throw Failure.gatewayNotReady }
        // Fresh run directory: receipt must be absent before client dispatch.
        guard !FileManager.default.fileExists(atPath: paths.gate.path) else { throw Failure.missingGate }
        do {
            try verifyInstalled(installed)
            client = try launch(Command(commands.requestAndWait), stdout: paths.clientOut, stderr: paths.clientErr)
            try writePID(client!.processIdentifier, to: paths.run.appendingPathComponent("client-owned-pid.json"))
        } catch {
            if error is Failure { throw error }
            throw Failure.clientStartFailed
        }
        guard let client else { throw Failure.clientStartFailed }
        let clientDeadline = Date().addingTimeInterval(clientTimeoutSeconds)
        var gateObservedBeforeTerminal = false
        while client.isRunning && Date() < clientDeadline {
            try checkCancel()
            if FileManager.default.fileExists(atPath: paths.gate.path), client.isRunning,
               let outputSize = try? paths.clientOut.resourceValues(forKeys: [.fileSizeKey]).fileSize,
               outputSize == 0 {
                gateObservedBeforeTerminal = true
            }
            Thread.sleep(forTimeInterval: 0.05)
        }
        try checkCancel()
        guard !client.isRunning else { throw Failure.clientTimeout }
        guard client.terminationReason == .exit, client.terminationStatus == 0 else { throw Failure.clientFailed }
        guard gateObservedBeforeTerminal else { throw Failure.missingGate }
        let gate = try readBounded(paths.gate, maxBytes: 2_048, requirePrivate: true)
        let envelope = try readBounded(paths.clientOut, maxBytes: OpenClawAgentController.maximumEnvelopeBytes,
                                       requirePrivate: true)
        guard let outer = try? JSONSerialization.jsonObject(with: envelope) as? [String: Any],
              outer["status"] as? String == "ok", outer["runId"] as? String != nil,
              outer["result"] is [String: Any] else { throw Failure.envelopeInvalid }
        // Keep the raw terminal data for replay; caller must apply the exact
        // Gateway parser and REVAS. `exit 0` alone is never quality proof.
        let gatewayPID = gateway.processIdentifier
        let clientPID = client.processIdentifier
        guard stopOwned(client), stopOwned(gateway) else { throw Failure.gatewayStartFailed }
        return Terminal(runDirectory: paths.run.path, gatewayPID: gatewayPID,
                        clientPID: clientPID, port: port,
                        gateReceipt: gate, gateObservedBeforeTerminal: gateObservedBeforeTerminal,
                        gatewayEnvelope: envelope, exitCode: client.terminationStatus,
                        gateReceiptSHA256: sha256(gate), gatewayEnvelopeSHA256: sha256(envelope))
    }

    private static func healthReady(_ bytes: Data) -> Bool {
        guard let json = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { return false }
        return json["ok"] as? Bool == true
    }

    private static func health(installed: InstalledIdentity, paths: Paths) -> Command {
        let env = ["HOME=\(paths.home.path)", "OPENCLAW_HOME=\(paths.home.path)",
                   "OPENCLAW_STATE_DIR=\(paths.home.appendingPathComponent("state").path)",
                   "OPENCLAW_CONFIG_PATH=\(paths.config.path)",
                   "PATH=\(URL(fileURLWithPath: installed.nodePath).deletingLastPathComponent().path):/usr/bin:/bin"]
        return Command(executable: "/usr/bin/env", arguments: ["-i"] + env + [installed.nodePath,
                installed.entryPath, "health", "--json", "--timeout", "1200"],
                     workingDirectory: paths.workspace.path)
    }

    private static func verifyPreparedTurn(_ turn: OpenClawAgentController.PreparedTurn,
                                           paths: Paths, installed: InstalledIdentity) throws {
        guard turn.contract.schema == 1,
              turn.contract.requestSHA256 == sha256(Data(turn.request.utf8)),
              turn.contractSHA256 == sha256(turn.contractBytes),
              turn.contract.state.qualityClaim == "unverified" else { throw Failure.identityMismatch }
        guard let config = try? JSONSerialization.jsonObject(with: turn.configBytes) as? [String: Any],
              let agents = config["agents"] as? [String: Any],
              let defaults = agents["defaults"] as? [String: Any],
              defaults["workspace"] as? String == paths.workspace.path,
              let plugins = config["plugins"] as? [String: Any],
              let load = plugins["load"] as? [String: Any],
              load["paths"] as? [String] == [installed.pluginDirectory] else {
            throw Failure.identityMismatch
        }
    }

    private static func verifyInstalled(_ identity: InstalledIdentity) throws {
        let rows: [(String, String)] = [
            (identity.nodePath, identity.nodeSHA256), (identity.entryPath, identity.entrySHA256),
            (identity.pluginDirectory + "/index.mjs", identity.pluginIndexSHA256),
            (identity.pluginDirectory + "/openclaw.plugin.json", identity.pluginManifestSHA256),
            (identity.pluginDirectory + "/package.json", identity.pluginPackageSHA256)]
        for (path, expected) in rows {
            guard path.hasPrefix("/"), !path.contains("/../"), expected.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                  let actual = try? fileSHA256(URL(fileURLWithPath: path)), actual == expected else {
                throw Failure.identityMismatch
            }
        }
        guard access(identity.nodePath, X_OK) == 0 else { throw Failure.identityMismatch }
    }

    private static func privatePaths(runID: String) throws -> Paths {
        guard runID.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil else {
            throw Failure.invalidRunPath
        }
        let base = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".os1/openclaw-controller", isDirectory: true)
        let run = base.appendingPathComponent(runID, isDirectory: true)
        return Paths(run: run, home: run.appendingPathComponent("home", isDirectory: true),
                     workspace: run.appendingPathComponent("workspace", isDirectory: true),
                     config: run.appendingPathComponent("config.json"),
                     contract: run.appendingPathComponent("contract.json"),
                     message: run.appendingPathComponent("request.txt"),
                     gate: run.appendingPathComponent("gate-receipt.json"),
                     gatewayOut: run.appendingPathComponent("gateway.stdout"),
                     gatewayErr: run.appendingPathComponent("gateway.stderr"),
                     clientOut: run.appendingPathComponent("client.stdout"),
                     clientErr: run.appendingPathComponent("client.stderr"))
    }

    private static func createPrivateRun(_ paths: Paths) throws {
        let fm = FileManager.default
        let parent = paths.run.deletingLastPathComponent()
        let os1 = parent.deletingLastPathComponent()
        for path in [os1, parent] {
            if mkdir(path.path, 0o700) != 0 && errno != EEXIST { throw Failure.privateFileFailure }
            guard privateDirectory(path) else { throw Failure.privateFileFailure }
        }
        guard mkdir(paths.run.path, 0o700) == 0 else { throw Failure.invalidRunPath }
        for path in [paths.home, paths.home.appendingPathComponent("state"), paths.workspace] {
            guard mkdir(path.path, 0o700) == 0, privateDirectory(path) else { throw Failure.privateFileFailure }
        }
        guard privateDirectory(paths.run), fm.fileExists(atPath: paths.workspace.path) else {
            throw Failure.privateFileFailure
        }
    }

    private static func privateDirectory(_ url: URL) -> Bool {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              attrs[.type] as? FileAttributeType == .typeDirectory,
              let permissions = (attrs[.posixPermissions] as? NSNumber)?.intValue,
              (permissions & 0o077) == 0,
              (attrs[.ownerAccountID] as? NSNumber)?.int32Value == Int32(getuid()),
              let rv = try? url.resourceValues(forKeys: [.isSymbolicLinkKey]), rv.isSymbolicLink != true else {
            return false
        }
        return true
    }

    private static func writePrivate(_ data: Data, to url: URL) throws {
        let fd = open(url.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw Failure.privateFileFailure }
        defer { _ = close(fd) }
        let wrote = data.withUnsafeBytes { raw -> Bool in
            guard let base = raw.baseAddress else { return data.isEmpty }
            var offset = 0
            while offset < raw.count {
                let n = Darwin.write(fd, base.advanced(by: offset), raw.count - offset)
                if n <= 0 { return false }
                offset += n
            }
            return true
        }
        guard wrote, fsync(fd) == 0 else { throw Failure.privateFileFailure }
    }

    private static func writePID(_ pid: Int32, to url: URL) throws {
        guard pid > 0 else { throw Failure.privateFileFailure }
        let value: [String: Any] = ["schema": 1, "pid": Int(pid), "observed_at": ISO8601DateFormatter().string(from: Date()),
                                    "note": "forensic_only_pid_reuse_requires_fresh_identity_check"]
        try writePrivate(JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), to: url)
    }

    private static func launch(_ command: Command,
                               stdout: URL, stderr: URL) throws -> Process {
        let out = open(stdout.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard out >= 0 else { throw Failure.privateFileFailure }
        let err = open(stderr.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard err >= 0 else { _ = close(out); throw Failure.privateFileFailure }
        let outHandle = FileHandle(fileDescriptor: out, closeOnDealloc: true)
        let errHandle = FileHandle(fileDescriptor: err, closeOnDealloc: true)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: command.executable)
        process.arguments = command.arguments
        process.currentDirectoryURL = URL(fileURLWithPath: command.workingDirectory)
        process.standardOutput = outHandle
        process.standardError = errHandle
        process.standardInput = FileHandle.nullDevice
        try process.run()
        try? outHandle.close(); try? errHandle.close()
        return process
    }

    private static func waitOwned(_ process: Process, until deadline: Date,
                                  cancelled: () -> Bool) -> Bool {
        while process.isRunning && Date() < deadline && !cancelled() {
            Thread.sleep(forTimeInterval: 0.05)
        }
        return !process.isRunning && !cancelled()
    }

    @discardableResult
    private static func stopOwned(_ process: Process) -> Bool {
        guard process.isRunning else { return true }
        process.terminate()
        let deadline = Date().addingTimeInterval(1)
        while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.02) }
        if process.isRunning {
            // Exact child PID only; never a process group, wildcard, port PID,
            // user service, foreign Gateway, or Handy process.
            _ = Darwin.kill(process.processIdentifier, SIGKILL)
            let finalDeadline = Date().addingTimeInterval(2)
            while process.isRunning && Date() < finalDeadline { Thread.sleep(forTimeInterval: 0.02) }
        }
        return !process.isRunning
    }

    private static func readBounded(_ url: URL, maxBytes: Int, requirePrivate: Bool) throws -> Data {
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else { throw Failure.privateFileFailure }
        defer { _ = close(fd) }
        var state = stat()
        guard fstat(fd, &state) == 0, (state.st_mode & S_IFMT) == S_IFREG,
              state.st_size > 0, state.st_size <= maxBytes,
              !requirePrivate || (state.st_mode & 0o077) == 0 else {
            throw Failure.privateFileFailure
        }
        var bytes = Data(count: Int(state.st_size))
        let filled = bytes.withUnsafeMutableBytes { raw -> Bool in
            guard let base = raw.baseAddress else { return false }
            var offset = 0
            while offset < raw.count {
                let n = Darwin.read(fd, base.advanced(by: offset), raw.count - offset)
                if n <= 0 { return false }
                offset += n
            }
            return true
        }
        guard filled else { throw Failure.privateFileFailure }
        return bytes
    }

    private static func fileSHA256(_ url: URL) throws -> String {
        let rv = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard rv.isRegularFile == true && rv.isSymbolicLink != true else { throw Failure.identityMismatch }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty { hasher.update(data: chunk) }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func reserveFreeLoopbackPort() throws -> Int {
        for _ in 0..<24 {
            let fd = socket(AF_INET, SOCK_STREAM, 0)
            guard fd >= 0 else { throw Failure.portUnavailable }
            var addr = sockaddr_in()
            addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
            addr.sin_family = sa_family_t(AF_INET)
            addr.sin_port = in_port_t(UInt16.random(in: 49_152...65_535).bigEndian)
            addr.sin_addr = in_addr(s_addr: in_addr_t(0x7f000001).bigEndian)
            let value = withUnsafePointer(to: &addr) { ptr in
                ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
            }
            _ = close(fd)
            if value == 0 { return Int(UInt16(bigEndian: addr.sin_port)) }
        }
        throw Failure.portUnavailable
    }

    private static func loopbackConnects(port: Int) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { _ = close(fd) }
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = in_port_t(UInt16(port).bigEndian)
        addr.sin_addr = in_addr(s_addr: in_addr_t(0x7f000001).bigEndian)
        return withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
            }
        }
    }
}
