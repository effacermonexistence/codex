import Foundation
import Darwin
import OS1HookSupport

/// User-owned local previews outlive the backend tool's process group. No
/// provider credentials, shell startup files or account caches are persisted.
enum ManagedPreview {
    struct Receipt: Codable {
        let label: String
        let workspace: String
        let url: String
        let arguments: [String]
        let createdAt: Date
    }
    static let capabilityCard = """
    LOCAL PREVIEW DELIVERY: A website is not delivered merely because files/builds exist.
    For a local website start a durable, loopback-only preview using:
    ~/.local/bin/os1 preview-start --workspace /absolute/project --url http://127.0.0.1:PORT/ -- /absolute/server/executable arguments
    Use the project's real server and explicit loopback binding. Do not use a transient tool background process or nohup.
    The command checks service ownership and HTTP readiness; preview-status --url URL checks it again.
    Verify the actual page in a browser (layout, assets, interaction), then report the clickable URL and include OS1_PREVIEW_URL: URL.
    Never report a preview as running after only printing a launch command. A dead returned localhost URL blocks adoption.
    Do not start a preview for architecture-only plans or unrelated tasks. No external deployment is implied.
    """
    static func endpoint(_ raw: String) throws -> URL {
        guard let u = URL(string: raw), u.scheme == "http", ["127.0.0.1", "localhost", "[::1]"].contains(u.host ?? ""),
              let port = u.port, (1024...65535).contains(port), u.user == nil, u.password == nil,
              u.query == nil, u.fragment == nil else {
            throw OS1Error.message("Preview requires an explicit unprivileged loopback HTTP port (no credentials/query/fragment)")
        }
        return u
    }
    static func root() -> URL { FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/previews") }
    static func label(_ u: URL) -> String { "com.omaragi.os1.preview.\(u.port!)" }
    static func receiptURL(_ u: URL) -> URL { root().appendingPathComponent(label(u) + ".json") }
    static func plistURL(_ u: URL) -> URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/\(label(u)).plist")
    }
    static func service(_ u: URL) -> String { "gui/\(getuid())/\(label(u))" }
    static func loaded(_ u: URL) -> Bool {
        (try? commandOutput("/bin/launchctl", ["print", service(u)], timeout: 5).0) == 0
    }
    static func listening(_ u: URL) -> Bool {
        (try? commandOutput("/usr/sbin/lsof", ["-nP", "-iTCP:\(u.port!)", "-sTCP:LISTEN", "-t"], timeout: 5).0) == 0
    }
    final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
        func urlSession(_ session: URLSession, task: URLSessionTask,
            willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
            completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
    }
    static func healthy(_ u: URL) async -> Bool {
        // Ephemeral session: no cookies, credentials, cache or redirect to a
        // remote service. A redirect is not proof that this local page works.
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 2
        config.timeoutIntervalForResource = 3
        let session = URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: u, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 2)
        request.httpMethod = "GET"
        guard let (_, response) = try? await session.data(for: request),
              let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
              http.url?.host == u.host, http.url?.port == u.port else { return false }
        return true
    }
    static func read(_ u: URL) throws -> Receipt {
        let value = try JSONDecoder().decode(Receipt.self, from: Data(contentsOf: receiptURL(u)))
        guard value.label == label(u), try endpoint(value.url).port == u.port else {
            throw OS1Error.message("Preview receipt identity mismatch")
        }
        return value
    }
    static func start(workspace: String, url: URL, arguments: [String]) async throws {
        let fm = FileManager.default
        let directory = URL(fileURLWithPath: workspace).resolvingSymlinksInPath().standardizedFileURL.path
        var isDirectory: ObjCBool = false
        guard workspace.hasPrefix("/"), fm.fileExists(atPath: directory, isDirectory: &isDirectory), isDirectory.boolValue,
              let executable = arguments.first, executable.hasPrefix("/"), fm.isExecutableFile(atPath: executable) else {
            throw OS1Error.message("Preview needs an existing absolute workspace and executable")
        }
        try fm.createDirectory(at: root(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        guard let lease = try ExclusiveHookLease.tryAcquire(at: root().appendingPathComponent(label(url) + ".lock")) else {
            throw OS1Error.message("Another preview operation owns this port; no service was changed")
        }
        defer { withExtendedLifetime(lease) {} }
        guard !fm.fileExists(atPath: plistURL(url).path) || fm.fileExists(atPath: receiptURL(url).path) else {
            throw OS1Error.message("Existing launch configuration has no ownership receipt; preserved unchanged")
        }
        if fm.fileExists(atPath: receiptURL(url).path) {
            let previous = try read(url)
            guard previous.workspace == directory, previous.arguments == arguments, previous.url == url.absoluteString else {
                throw OS1Error.message("Preview port belongs to a different configuration; preserve it and select another port")
            }
            if loaded(url) {
                guard await healthy(url) else { throw OS1Error.message("Managed preview is registered but not HTTP-ready; inspect its logs, do not claim success") }
                print("OS1_PREVIEW_URL: \(url.absoluteString)\nHTTP_READY (existing managed service)")
                return
            }
        }
        guard !loaded(url), !listening(url) else {
            throw OS1Error.message("Preview port/service is already occupied; no foreign process was stopped")
        }
        try fm.createDirectory(at: root(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try fm.createDirectory(at: plistURL(url).deletingLastPathComponent(), withIntermediateDirectories: true)
        let object: [String: Any] = [
            "Label": label(url), "ProgramArguments": arguments, "WorkingDirectory": directory,
            "RunAtLoad": true, "KeepAlive": true, "ThrottleInterval": 10,
            "StandardOutPath": root().appendingPathComponent(label(url) + ".stdout.log").path,
            "StandardErrorPath": root().appendingPathComponent(label(url) + ".stderr.log").path,
            "EnvironmentVariables": ["PATH": URL(fileURLWithPath: arguments[0]).deletingLastPathComponent().path + ":/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", "HOME": fm.homeDirectoryForCurrentUser.path]
        ]
        let data = try PropertyListSerialization.data(fromPropertyList: object, format: .xml, options: 0)
        try data.write(to: plistURL(url), options: .atomic)
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: plistURL(url).path)
        let receipt = Receipt(label: label(url), workspace: directory, url: url.absoluteString, arguments: arguments, createdAt: Date())
        try JSONEncoder().encode(receipt).write(to: receiptURL(url), options: .atomic)
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: receiptURL(url).path)
        let result = try commandOutput("/bin/launchctl", ["bootstrap", "gui/\(getuid())", plistURL(url).path], timeout: 15)
        guard result.0 == 0 else { throw OS1Error.message("Preview launch registration failed; see local receipt and logs") }
        for _ in 0..<20 {
            if loaded(url), await healthy(url) {
                print("OS1_PREVIEW_URL: \(url.absoluteString)\nHTTP_READY (launchd-owned; independent of backend lifetime)")
                return
            }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
        // A failed startup must not leave an endlessly restarting job behind.
        _ = try? commandOutput("/bin/launchctl", ["bootout", service(url)], timeout: 10)
        throw OS1Error.message("Preview did not become HTTP-ready; failed service stopped, logs preserved")
    }
    static func urls(in output: String) -> [URL] {
        let regex = try! NSRegularExpression(pattern: #"http://(?:127\.0\.0\.1|localhost|\[::1\]):[0-9]+(?:/[^\s<>\)\]`\"']*)?"#)
        let range = NSRange(output.startIndex..., in: output)
        return Array(Set(regex.matches(in: output, range: range).compactMap { match in
            Range(match.range, in: output).flatMap { try? endpoint(String(output[$0])) }
        })).sorted { $0.absoluteString < $1.absoluteString }
    }
    static func shouldCheckDelivery(objective: String, output: String, workspaceWrite: Bool, architecture: Bool) -> Bool {
        guard workspaceWrite, !architecture else { return false }
        if output.contains("OS1_PREVIEW_URL:") { return true }
        return objective.range(of: #"(?i)website|web[ -]?site|웹사이트|웹[ ]?페이지|landing[ -]?page|랜딩[ ]?페이지"#, options: .regularExpression) != nil
    }
    static func deliveryFailure(output: String) async -> String? {
        for url in urls(in: output) {
            guard await healthy(url) else {
                return "로컬 주소 \(url.absoluteString)의 HTTP 응답이 확인되지 않았습니다. 파일/실행 결과는 보존했습니다. preview-start로 서버 수명을 복구한 뒤 실제 페이지를 확인해야 합니다."
            }
        }
        return nil
    }
    static func command(_ args: [String]) async throws -> Bool {
        guard let name = args.first, ["preview-start", "preview-status", "preview-stop", "preview-check-output"].contains(name) else { return false }
        if name == "preview-check-output" {
            guard args.count == 2 else { throw OS1Error.message("preview-check-output OUTPUT_TEXT_FILE") }
            if let failure = await deliveryFailure(output: try String(contentsOfFile: args[1], encoding: .utf8)) { throw OS1Error.message(failure) }
            print("Preview delivery check PASS"); return true
        }
        if name == "preview-start" {
            guard args.count >= 7, args[1] == "--workspace", args[3] == "--url", args[5] == "--" else {
                throw OS1Error.message("preview-start --workspace ABSOLUTE_PATH --url LOOPBACK_URL -- ABSOLUTE_EXECUTABLE [ARGS]")
            }
            try await start(workspace: args[2], url: endpoint(args[4]), arguments: Array(args.dropFirst(6)))
        } else {
            guard args.count == 3, args[1] == "--url" else { throw OS1Error.message("\(name) --url LOOPBACK_URL") }
            let url = try endpoint(args[2]); _ = try read(url)
            guard let lease = try ExclusiveHookLease.tryAcquire(at: root().appendingPathComponent(label(url) + ".lock")) else {
                throw OS1Error.message("Another preview operation owns this port")
            }
            defer { withExtendedLifetime(lease) {} }
            if name == "preview-stop" {
                let result = try commandOutput("/bin/launchctl", ["bootout", service(url)], timeout: 10)
                guard result.0 == 0 || !loaded(url) else { throw OS1Error.message("Preview stop unverified") }
                try? FileManager.default.removeItem(at: plistURL(url))
                print("Owned preview stopped; workspace and logs preserved")
            } else {
                guard loaded(url), await healthy(url) else { throw OS1Error.message("Preview is not HTTP-ready") }
                print("OS1_PREVIEW_URL: \(url.absoluteString)\nHTTP_READY")
            }
        }
        return true
    }
    static func selfTest() throws {
        guard shouldCheckDelivery(objective: "웹사이트 만들어", output: "", workspaceWrite: true, architecture: false),
              !shouldCheckDelivery(objective: "웹사이트 로그 분석", output: "", workspaceWrite: false, architecture: false),
              !shouldCheckDelivery(objective: "웹사이트 만들어", output: "", workspaceWrite: true, architecture: true),
              !shouldCheckDelivery(objective: "Explain this log", output: "http://localhost:4173/", workspaceWrite: true, architecture: false) else {
            throw OS1Error.message("Preview delivery scope regression")
        }
        for invalid in ["https://example.com", "http://127.0.0.1:80/", "http://127.0.0.1.evil:4173/", "http://u:p@localhost:4173/", "http://localhost:4173/?token=secret"] {
            guard (try? endpoint(invalid)) == nil else { throw OS1Error.message("Preview boundary regression") }
        }
        guard urls(in: "[Open](http://127.0.0.1:4173/) http://localhost:5180/").count == 2,
              urls(in: "https://example.com").isEmpty,
              try endpoint("http://127.0.0.1:4173/").port == 4173 else { throw OS1Error.message("Preview extraction regression") }
    }
}
