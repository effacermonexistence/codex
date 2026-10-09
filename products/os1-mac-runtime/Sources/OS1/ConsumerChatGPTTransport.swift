import Foundation
import OS1Context

/// Ordinary ChatGPT through an explicitly authorized, existing Chrome session.
/// This is neither the Codex app-server nor an API-key/OAuth inference route.
/// The helper uses public UI only; owner intent never substitutes for Chrome's
/// own connection approval, a verified Chat mode, or a completed response.
enum ConsumerChatGPTTransport {
    enum State: String, Codable, Sendable {
        case approvalRequired = "approval_required"
        case ready
        case returned
        case blocked
    }

    struct Result: Codable, Sendable {
        let state: State
        let error: String?
        let response: String?
        let conversationURL: String?
        let receiptPath: String?

        enum CodingKeys: String, CodingKey {
            case state, error, response
            case conversationURL = "conversation_url"
            case receiptPath = "receipt_path"
        }

        init(state: State, error: String? = nil, response: String? = nil,
             conversationURL: String? = nil, receiptPath: String? = nil) {
            self.state = state; self.error = error; self.response = response
            self.conversationURL = conversationURL; self.receiptPath = receiptPath
        }

        // UI classification is not a provider usage API reading. In particular,
        // no result claims zero cost, zero Chat usage, or native JSONL evidence.
        var surface: String { "chatgpt" }
        var transport: String { "approved_existing_chrome_session" }
        var usageAccountingVerified: Bool { false }
        var nativeRecordVerified: Bool { false }
        var taskQuality: String { "execution_only" }
    }

    private struct Configuration: Decodable {
        let enabled: Bool
        let controlIntent: Bool
        enum CodingKeys: String, CodingKey { case enabled, controlIntent }
        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            enabled = try values.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
            controlIntent = try values.decodeIfPresent(Bool.self, forKey: .controlIntent) ?? false
        }
    }

    private static let root = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".os1/browser-transport", isDirectory: true)
    private static let node = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".local/share/node-v24.20.0/bin/node")
    private static let helperName = "consumer-chatgpt-driver.mjs"
    private static let outputKeys: Set<String> = ["state", "error", "response", "conversation_url", "receipt_path"]
    private static let maximumPromptBytes = 40_000
    private static let maximumProjectionBytes = 24_000
    private static let maximumResponseBytes = 96_000

    static func status() async -> Result {
        await invoke(action: "status", prompt: "", policyProjection: "")
    }

    static func run(prompt: String, policyProjection: String) async -> Result {
        guard !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              prompt.utf8.count <= maximumPromptBytes,
              policyProjection.utf8.count <= maximumProjectionBytes else {
            return Result(state: .blocked, error: "ChatGPT input exceeds the bounded browser transport contract.")
        }
        return await invoke(action: "run", prompt: prompt, policyProjection: policyProjection)
    }

    /// Parent fan-out rechecks the child's actual browser receipt, rather than
    /// inheriting trust from a returned JSON status or a correctly shaped step.
    static func verifyReturned(_ result: Result, prompt: String) throws -> Result {
        guard result.state == .returned else { throw OS1Error.message("No completed browser response.") }
        return try checkedOutput(JSONEncoder().encode(result), action: "run",
                                 requestSHA256: sha256Hex(Data(prompt.utf8)))
    }

    private static func boundedFile(_ url: URL, limit: Int) throws -> Data {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              (values.fileSize ?? Int.max) <= limit else {
            throw OS1Error.message("Browser transport artifact is not a bounded regular file.")
        }
        return try Data(contentsOf: url)
    }

    private static func permission() -> Configuration? {
        guard let data = try? boundedFile(root.appendingPathComponent("config.json"), limit: 16_384),
              let configuration = try? JSONDecoder().decode(Configuration.self, from: data) else { return nil }
        return configuration
    }

    private static func helper() throws -> URL {
        var candidates: [URL] = []
        if let resources = Bundle.main.resourceURL {
            candidates.append(resources.appendingPathComponent(helperName))
        }
        let executable = (Bundle.main.executableURL ?? URL(fileURLWithPath: CommandLine.arguments[0]))
            .resolvingSymlinksInPath()
        // Installed standalone CLI and app-embedded CLI both use their own
        // resource sibling. Never search HOME or an unrelated legacy checkout.
        candidates.append(executable.deletingLastPathComponent().appendingPathComponent(helperName))
        if executable.path.contains(".app/Contents/") {
            let parts = executable.path.components(separatedBy: ".app/Contents/")
            if parts.count == 2 {
                candidates.append(URL(fileURLWithPath: parts[0] + ".app/Contents/Resources")
                    .appendingPathComponent(helperName))
            }
        }
        // The rollback-capable installer copies the app-embedded CLI to the
        // stable ~/.local/bin/os1. Use that app's signed resources only when
        // BOTH binary identities match exactly; an old CLI cannot borrow a
        // helper from a newer installed app during replacement/recovery.
        let stableCLI = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".local/bin/os1").resolvingSymlinksInPath()
        if executable.path == stableCLI.path {
            let appResources = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Applications/OS-1 CLODEX.app/Contents/Resources")
            if let actual = try? boundedFile(executable, limit: 100_000_000),
               let bundled = try? boundedFile(appResources.appendingPathComponent("os1"), limit: 100_000_000),
               sha256Hex(actual) == sha256Hex(bundled) {
                candidates.append(appResources.appendingPathComponent(helperName))
            }
        }
        let sourceRuntime = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        if executable.path.hasPrefix(sourceRuntime.appendingPathComponent(".build").path + "/"),
           FileManager.default.fileExists(atPath: sourceRuntime.appendingPathComponent("Package.swift").path) {
            candidates.append(sourceRuntime.appendingPathComponent("Resources").appendingPathComponent(helperName))
        }
        for candidate in candidates {
            if (try? boundedFile(candidate, limit: 262_144)) != nil { return candidate }
        }
        throw OS1Error.message("The browser helper is not packaged in this runtime; no external app was opened.")
    }

    private static func ordinaryConversationURL(_ text: String) -> Bool {
        guard let value = URLComponents(string: text), value.scheme == "https", value.host == "chatgpt.com",
              value.user == nil, value.password == nil, value.port == nil || value.port == 443 else { return false }
        return value.path == "/" || value.path.range(of: #"^/c/[A-Za-z0-9_-]+/?$"#,
                                                    options: .regularExpression) != nil
    }

    private static func checkedOutput(_ data: Data, action: String, requestSHA256: String,
                                      policyProjectionSHA256: String? = nil) throws -> Result {
        guard data.count <= 131_072,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys).isSubset(of: outputKeys), object["state"] as? String != nil else {
            throw OS1Error.message("The browser helper returned an invalid result envelope.")
        }
        let result = try JSONDecoder().decode(Result.self, from: data)
        if result.state == .returned {
            guard action == "run", let answer = result.response,
                  !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  answer.utf8.count <= maximumResponseBytes,
                  let conversation = result.conversationURL, ordinaryConversationURL(conversation),
                  let path = result.receiptPath, path.hasPrefix("/") else {
                throw OS1Error.message("A ChatGPT reply lacks matching bounded browser evidence.")
            }
            let receipt = URL(fileURLWithPath: path)
            guard receipt.resolvingSymlinksInPath().path.hasPrefix(root.appendingPathComponent("receipts").resolvingSymlinksInPath().path + "/"),
                  receipt.pathExtension == "json",
                  let record = try JSONSerialization.jsonObject(with: boundedFile(receipt, limit: 262_144)) as? [String: Any],
                  record["request_sha256"] as? String == requestSHA256,
                  record["response_sha256"] as? String == sha256Hex(Data(answer.utf8)),
                  record["state"] as? String == "returned",
                  record["transport"] as? String == "approved_existing_chrome_session",
                  record["mode"] as? String == "chat",
                  record["conversation_url"] as? String == conversation,
                  policyProjectionSHA256 == nil || record["policy_projection_sha256"] as? String == policyProjectionSHA256 else {
                throw OS1Error.message("ChatGPT browser receipt identity does not match this request and response.")
            }
        } else if result.response != nil {
            throw OS1Error.message("An unfinished browser operation cannot return an adopted answer.")
        }
        return result
    }

    private static func invoke(action: String, prompt: String, policyProjection: String) async -> Result {
        // Loading a configuration does not prove connection. Until a future
        // explicit owner action enables both fields, even status cannot start
        // Chrome MCP, present an attach prompt, or inspect a browser session.
        guard let configuration = permission(), configuration.enabled, configuration.controlIntent else {
            return Result(state: .approvalRequired,
                          error: "ChatGPT browser control is not enabled. No browser was attached or opened.")
        }
        guard !Task.isCancelled, !ExecutionCancellation.isCancelled else {
            return Result(state: .blocked, error: "Browser request cancelled before dispatch.")
        }
        do {
            guard FileManager.default.isExecutableFile(atPath: node.path) else {
                return Result(state: .blocked, error: "Pinned Node 24.20.0 is unavailable.")
            }
            let driver = try helper()
            let requestSHA256 = sha256Hex(Data(prompt.utf8))
            let request = try JSONSerialization.data(withJSONObject: [
                "action": action, "prompt": prompt, "request_sha256": requestSHA256,
                "policy_projection": policyProjection
            ], options: [.sortedKeys])
            let privateHome = root.appendingPathComponent("home", isDirectory: true)
            try FileManager.default.createDirectory(at: privateHome, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
            let environment = ["HOME=\(FileManager.default.homeDirectoryForCurrentUser.path)", "PATH=\(node.deletingLastPathComponent().path):/usr/bin:/bin",
                               "OS1_BROWSER_TRANSPORT_ROOT=\(root.path)",
                               "OS1_BROWSER_USER_HOME=\(FileManager.default.homeDirectoryForCurrentUser.path)",
                               "CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS=1", "CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS=1"]
            let process = try await Task.detached {
                try commandOutput("/usr/bin/env", ["-i"] + environment + [node.path, driver.path],
                                  input: request, timeout: action == "status" ? 15 : 180,
                                  currentDirectory: root.path, captureDirectory: privateHome)
            }.value
            guard !Task.isCancelled, !ExecutionCancellation.isCancelled else {
                return Result(state: .blocked, error: "Browser operation interrupted; do not replay without its receipt.")
            }
            let result = try checkedOutput(process.1, action: action, requestSHA256: requestSHA256,
                                           policyProjectionSHA256: sha256Hex(Data(policyProjection.utf8)))
            if process.0 != 0 && (result.state == .returned || result.state == .ready) {
                return Result(state: .blocked, error: "Browser helper did not finish successfully; request outcome is not adopted.")
            }
            return result
        } catch {
            // No stderr, shell arguments, page data, or credentials enter a
            // generic error surface. A failure is not permission to use Codex.
            return Result(state: .blocked,
                          error: "ChatGPT browser transport could not verify its result. No fallback was executed; inspect its private receipt before retrying.")
        }
    }
}
