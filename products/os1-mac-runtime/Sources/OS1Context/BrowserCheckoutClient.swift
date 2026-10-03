import CryptoKit
import Foundation

/// Talks to the OS-1 Checkout helper over its user-only socket. The MCP server
/// a backend uses and the run that collects receipts both go through here;
/// neither can press a purchase button, only ask the helper to.
public enum CheckoutBrokerClient {
    /// The helper as shipped, nested in the installed OS-1 app.
    public static func helperURL(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        SelfUpdate.installedAppURL(home: home).appendingPathComponent("Contents/Helpers/\(BrowserCheckout.helperBundleName)")
    }

    /// The copy that runs. macOS attributes an app nested in another app's
    /// bundle to the outer app (tccd, 2026-10-02: "Policy disallows prompt for
    /// com.omaragi.os1" for the nested helper), which would put the browser
    /// permission on OS-1 itself — and so on every backend it starts. Outside
    /// the bundle the helper is its own TCC identity.
    public static func runningHelperURL(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        BrowserCheckout.directory(home: home).appendingPathComponent(BrowserCheckout.helperBundleName)
    }

    /// Copies the signed helper out of the installed app when the copy is
    /// missing or differs (a new build), signature intact.
    public static func prepareRunningHelper(home: URL = FileManager.default.homeDirectoryForCurrentUser) throws -> URL {
        let source = helperURL(home: home)
        let target = runningHelperURL(home: home)
        let executable = "Contents/MacOS/OS1Checkout"
        guard let shipped = digest(source.appendingPathComponent(executable)) else {
            throw BrowserCheckout.BrokerError(code: "helper_not_installed",
                                              message: "OS-1 Checkout is not installed in \(source.path).")
        }
        let shippedInfo = try? Data(contentsOf: source.appendingPathComponent("Contents/Info.plist"))
        let runningInfo = try? Data(contentsOf: target.appendingPathComponent("Contents/Info.plist"))
        if digest(target.appendingPathComponent(executable)) == shipped && shippedInfo == runningInfo { return target }
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        if FileManager.default.fileExists(atPath: target.path) { try FileManager.default.removeItem(at: target) }
        let copy = Process()
        copy.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        copy.arguments = [source.path, target.path]
        copy.standardOutput = FileHandle.nullDevice
        copy.standardError = FileHandle.nullDevice
        try copy.run()
        copy.waitUntilExit()
        guard copy.terminationStatus == 0, digest(target.appendingPathComponent(executable)) == shipped else {
            throw BrowserCheckout.BrokerError(code: "helper_copy_failed", message: "OS-1 Checkout could not be prepared in \(target.path).")
        }
        return target
    }

    static func digest(_ file: URL) -> String? {
        guard let data = try? Data(contentsOf: file, options: .mappedIfSafe) else { return nil }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// One request, one response line. With `launch`, a missing helper is
    /// started through LaunchServices (its own responsible process) first.
    public static func send(_ request: BrowserCheckout.BrokerRequest, timeout: TimeInterval = 60,
                            launch: Bool = true) throws -> BrowserCheckout.BrokerResponse {
        let path = BrowserCheckout.socketURL().path
        var fd = connectSocket(path)
        if fd == nil && launch {
            try launchHelper()
            let deadline = Date().addingTimeInterval(15)
            while fd == nil && Date() < deadline {
                Thread.sleep(forTimeInterval: 0.25)
                fd = connectSocket(path)
            }
        }
        guard let socketFD = fd else {
            throw BrowserCheckout.BrokerError(code: "helper_unavailable",
                                              message: "OS-1 Checkout is not running and could not be started.")
        }
        defer { close(socketFD) }
        var interval = timeval(tv_sec: Int(timeout), tv_usec: 0)
        setsockopt(socketFD, SOL_SOCKET, SO_RCVTIMEO, &interval, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(socketFD, SOL_SOCKET, SO_SNDTIMEO, &interval, socklen_t(MemoryLayout<timeval>.size))
        var payload = try JSONEncoder().encode(request)
        payload.append(0x0A)
        let sent = payload.withUnsafeBytes { raw -> Bool in
            guard let base = raw.baseAddress else { return false }
            var offset = 0
            while offset < raw.count {
                let written = write(socketFD, base + offset, raw.count - offset)
                if written <= 0 { return false }
                offset += written
            }
            return true
        }
        guard sent else { throw BrowserCheckout.BrokerError(code: "helper_io", message: "Could not send to OS-1 Checkout.") }
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 65_536)
        while !buffer.contains(0x0A) {
            let count = read(socketFD, &chunk, chunk.count)
            if count <= 0 { break }
            buffer.append(contentsOf: chunk[0..<count])
        }
        guard let newline = buffer.firstIndex(of: 0x0A),
              let response = try? JSONDecoder().decode(BrowserCheckout.BrokerResponse.self, from: Data(buffer[buffer.startIndex..<newline])) else {
            throw BrowserCheckout.BrokerError(code: "helper_timeout", message: "OS-1 Checkout did not answer in time.")
        }
        return response
    }

    /// Receipts of purchases the owner approved during one execution. Never
    /// starts the helper: no helper, no purchase, no receipt.
    public static func receipts(executionID: String) -> [BrowserCheckout.Receipt] {
        guard let response = try? send(BrowserCheckout.BrokerRequest(op: "receipts", executionID: executionID),
                                       timeout: 5, launch: false),
              response.ok, let result = response.result,
              let receipts = try? JSONDecoder().decode([BrowserCheckout.Receipt].self, from: Data(result.utf8)) else { return [] }
        return receipts.filter { $0.executionID == executionID }
    }

    static func connectSocket(_ path: String) -> Int32? {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return nil }
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8.prefix(MemoryLayout.size(ofValue: address.sun_path) - 1))
        withUnsafeMutableBytes(of: &address.sun_path) { raw in
            raw.copyBytes(from: bytes)
            raw[bytes.count] = 0
        }
        let connected = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        if connected == 0 { return fd }
        close(fd)
        return nil
    }

    static func launchHelper() throws {
        let helper = try prepareRunningHelper()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        // -g: do not bring it forward; -j: launch hidden. LaunchServices makes
        // it its own responsible process, so the Apple Events permission the
        // owner grants it is not inherited by backends.
        process.arguments = ["-g", "-j", helper.path]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw BrowserCheckout.BrokerError(code: "helper_launch_failed", message: "open exited \(process.terminationStatus).")
        }
    }
}

/// Whether this run's backend gets the checkout tools: set while the run's
/// context is assembled, read when the backend is launched and when the
/// candidate is built.
public enum CheckoutTurn {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var value = false

    public static var enabled: Bool {
        get { lock.withLock { value } }
        set { lock.withLock { value = newValue } }
    }

    /// Claude: `--mcp-config` with the checkout server, keyed to this execution.
    public static func claudeMCPArguments(os1Executable: String, executionID: String) -> [String] {
        let config: [String: Any] = ["mcpServers": [BrowserCheckout.mcpServerName: [
            "command": os1Executable, "args": ["browser-mcp"], "env": ["OS1_CHECKOUT_EXECUTION_ID": executionID],
        ]]]
        let data = (try? JSONSerialization.data(withJSONObject: config, options: [.sortedKeys])) ?? Data("{}".utf8)
        return ["--mcp-config", String(decoding: data, as: UTF8.self)]
    }

    /// Codex app-server `-c` overrides for the same server. The approval waits
    /// for the owner (up to 3 minutes), so the tool timeout is longer.
    public static func codexConfigOverrides(os1Executable: String, executionID: String) -> [String] {
        func toml(_ value: String) -> String {
            "\"" + value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
        }
        let name = BrowserCheckout.mcpServerName
        return [
            "mcp_servers.\(name).command=\(toml(os1Executable))",
            "mcp_servers.\(name).args=[\(toml("browser-mcp"))]",
            "mcp_servers.\(name).env.OS1_CHECKOUT_EXECUTION_ID=\(toml(executionID))",
            "mcp_servers.\(name).tool_timeout_sec=300",
            "mcp_servers.\(name).startup_timeout_sec=20",
        ]
    }
}
