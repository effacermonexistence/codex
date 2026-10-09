import Foundation
import CoreFoundation
import OS1Context

/// One metadata reader owns all three reply IDs. Ordinary request() is not
/// concurrent: it may consume and discard another request's response.
struct CodexMetadataReplies {
    static let methods = ["account/read", "model/list", "account/rateLimits/read"]
    let expected: [Int: String]
    private(set) var replies: [String: [String: Any]] = [:]
    private(set) var rateLimitsObservedAt: Date?
    init(firstID: Int) {
        expected = Dictionary(uniqueKeysWithValues: Self.methods.enumerated().map { (firstID + $0.offset, $0.element) })
    }
    var complete: Bool { replies.count == expected.count }
    var requiredReceived: Bool { replies["account/read"] != nil && replies["model/list"] != nil }
    mutating func receive(_ message: [String: Any]) throws -> Bool {
        guard let number = message["id"] as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue == Double(number.intValue),
              let method = expected[number.intValue] else { return false }
        guard replies[method] == nil else { throw OS1Error.message("Duplicate native metadata response") }
        guard message["result"] != nil || message["error"] != nil else {
            throw OS1Error.message("Invalid native metadata response")
        }
        replies[method] = message
        if method == "account/rateLimits/read", message["error"] == nil, message["result"] is [String: Any] {
            rateLimitsObservedAt = Date()
        }
        return true
    }
    func required(_ method: String) throws -> [String: Any] {
        guard method == "account/read" || method == "model/list",
              let reply = replies[method], reply["error"] == nil,
              let body = reply["result"] as? [String: Any] else {
            throw OS1Error.message("Required native metadata was unavailable")
        }
        return body
    }
    func verifiedAccount() throws -> [String: Any] {
        let body = try required("account/read")
        guard let account = body["account"] as? [String: Any] else {
            throw OS1Error.message("Codex account is unavailable")
        }
        return account
    }
    var optionalRateLimits: [String: Any]? {
        guard let reply = replies["account/rateLimits/read"], reply["error"] == nil else { return nil }
        return reply["result"] as? [String: Any]
    }
}

private final class MetadataCommandResult: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<(Int32, Data, Data), Error>?
    func store(_ value: Result<(Int32, Data, Data), Error>) { lock.lock(); result = value; lock.unlock() }
    func value() throws -> (Int32, Data, Data) {
        lock.lock(); defer { lock.unlock() }
        guard let result else { throw OS1Error.message("Native metadata command did not finish") }
        return try result.get()
    }
}

/// Fixed native metadata protocol only: initialize, then get_usage. No user
/// message is ever sent. skip_behaviors prevents a seven-day transcript scan;
/// only the provider's public plan windows enter the returned snapshot.
private final class ClaudeQuotaMetadataControl: @unchecked Sendable {
    private let lock = NSLock()
    private let initializeID = UUID().uuidString
    private let usageID = UUID().uuidString
    private var writer: FileHandle?
    private var buffer = Data()
    private var requestedUsage = false
    private var closed = false
    private var received: (body: [String: Any], observedAt: Date)?
    private func send(_ id: String, _ request: [String: Any]) {
        guard let writer, let data = try? JSONSerialization.data(withJSONObject:
            ["type": "control_request", "request_id": id, "request": request]) else { closeLocked(); return }
        do { try writer.write(contentsOf: data + Data([10])) } catch { closeLocked() }
    }
    private func closeLocked() {
        closed = true; try? writer?.close(); writer = nil
    }
    func start(_ writer: FileHandle) {
        lock.lock(); defer { lock.unlock() }
        self.writer = writer
        send(initializeID, ["subtype": "initialize"])
    }
    func receive(_ bytes: Data) {
        lock.lock(); defer { lock.unlock() }
        guard !closed, buffer.count + bytes.count <= 512_000 else { closeLocked(); return }
        buffer.append(bytes)
        while let end = buffer.firstIndex(of: 10) {
            let line = Data(buffer[..<end]); buffer.removeSubrange(...end)
            guard let message = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
                  message["type"] as? String == "control_response",
                  let response = message["response"] as? [String: Any],
                  let id = response["request_id"] as? String else { continue }
            if id == initializeID, !requestedUsage {
                guard response["subtype"] as? String == "success" else { closeLocked(); return }
                requestedUsage = true
                send(usageID, ["subtype": "get_usage", "skip_behaviors": true])
                // The quota-only wait is bounded independently of startup.
                DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 3) { [self] in finish() }
            } else if id == usageID, requestedUsage {
                if response["subtype"] as? String == "success", let body = response["response"] as? [String: Any] {
                    received = (body, Date())
                }
                closeLocked(); return
            }
        }
    }
    func finish() { lock.lock(); defer { lock.unlock() }; closeLocked() }
    func snapshot(accountID: String) -> BackendHealth.QuotaSnapshot? {
        lock.lock(); defer { lock.unlock() }
        guard let received else { return nil }
        return BackendHealth.QuotaSnapshot.claudeUsage(received.body, accountID: accountID, observedAt: received.observedAt)
    }
    static func fixtureChecks() -> [Bool] {
        var checks: [Bool] = []
        let control = ClaudeQuotaMetadataControl(), pipe = Pipe()
        defer { control.finish(); try? pipe.fileHandleForReading.close() }
        func frame(_ id: String, subtype: String = "success", body: [String: Any] = [:]) -> Data {
            (try? JSONSerialization.data(withJSONObject: ["type": "control_response", "response":
                ["request_id": id, "subtype": subtype, "response": body]]))! + Data([10])
        }
        control.start(pipe.fileHandleForWriting)
        let initialize = (try? JSONSerialization.jsonObject(with: pipe.fileHandleForReading.availableData)) as? [String: Any]
        checks.append(initialize?["type"] as? String == "control_request" &&
            (initialize?["request"] as? [String: Any])?["subtype"] as? String == "initialize")
        control.receive(frame(control.initializeID))
        let usage = (try? JSONSerialization.jsonObject(with: pipe.fileHandleForReading.availableData)) as? [String: Any]
        let request = usage?["request"] as? [String: Any]
        checks.append(request?["subtype"] as? String == "get_usage" && request?["skip_behaviors"] as? Bool == true)
        control.receive(frame("wrong-response-id", body: ["rate_limits_available": true]))
        checks.append(control.snapshot(accountID: "claude.default") == nil)
        let body: [String: Any] = ["rate_limits_available": true, "rate_limits": ["limits": [
            ["kind": "weekly_all", "percent": 99, "resets_at": "2099-01-01T00:00:00Z", "scope": NSNull(),
             "severity": "critical", "is_active": true]]]]
        let result = frame(control.usageID, body: body), middle = result.count / 2
        control.receive(Data(result.prefix(middle)))
        checks.append(control.snapshot(accountID: "claude.default") == nil)
        control.receive(Data(result.dropFirst(middle)))
        checks.append(control.snapshot(accountID: "claude.default")?.effectiveRemaining(accountID: "claude.default") == 1)
        let unsupported = ClaudeQuotaMetadataControl(), other = Pipe()
        unsupported.start(other.fileHandleForWriting)
        _ = other.fileHandleForReading.availableData
        unsupported.receive(frame(unsupported.initializeID, subtype: "error"))
        checks.append(unsupported.snapshot(accountID: "claude.default") == nil)
        unsupported.finish(); try? other.fileHandleForReading.close()
        return checks
    }
}

/// Availability only. Neither model ranking nor permission authority lives here.
struct ClaudeModelCapability: Codable, Equatable {
    let model: String
    let supportedEfforts: [String]
    enum CodingKeys: String, CodingKey {
        case model
        case supportedEfforts = "supported_efforts"
    }
}

/// Process-local, short-lived: the native Claude inventory probed for this
/// run. Never persisted, never shared across runs or workspaces.
final class ClaudeInventoryCache: @unchecked Sendable {
    static let shared = ClaudeInventoryCache()
    private let lock = NSLock()
    private var entry: (workspace: String, at: Date, models: [NativeClaudeModel])?
    func models(workspace: String, maxAge: TimeInterval, now: Date = Date()) -> [NativeClaudeModel]? {
        lock.lock(); defer { lock.unlock() }
        guard let entry, entry.workspace == workspace, maxAge > 0,
              now.timeIntervalSince(entry.at) >= 0, now.timeIntervalSince(entry.at) <= maxAge else { return nil }
        return entry.models
    }
    func store(_ models: [NativeClaudeModel], workspace: String, at: Date = Date()) {
        lock.lock(); defer { lock.unlock() }
        entry = (workspace, at, models)
    }
    func clear() { lock.lock(); entry = nil; lock.unlock() }
}

struct NativeClaudeModel {
    let model: String
    let invocation: String
    let efforts: [String]
}

enum ModelAvailability {
    /// Unpaid, no-prompt plan metadata. A same-account fresh cache avoids another
    /// CLI trip. Timeout, absent rows, unsupported control and account switches
    /// all return unknown, not 0% or 100% remaining and not an auth failure.
    static func claudeQuota(workspace: String) -> BackendHealth.QuotaSnapshot? {
        let book = BackendAccounts.load()
        let accountID = BackendAccounts.active(provider: "claude", in: book).id
        if let cached = BackendHealth.load(maxAge: 60)?.claude.quota,
           cached.isFresh(accountID: accountID, maxAge: 60) { return cached }
        let environment = BackendAccounts.environment(provider: "claude", in: book)
        let control = ClaudeQuotaMetadataControl()
        defer { control.finish() }
        guard let executable = try? findExecutable("claude"),
              let output = try? commandOutput(executable, ["--safe-mode", "--print", "--input-format", "stream-json",
                "--output-format", "stream-json", "--verbose", "--strict-mcp-config", "--mcp-config",
                "{\"mcpServers\":{}}", "--tools", "", "--no-session-persistence"],
                timeout: 8, currentDirectory: workspace, isProvider: true, environmentOverrides: environment,
                onOutput: { control.receive($0) }, interactiveStdin: { control.start($0) }),
              output.0 == 0,
              BackendAccounts.active(provider: "claude", in: BackendAccounts.load()).id == accountID,
              BackendAccounts.environment(provider: "claude", in: BackendAccounts.load()) == environment else { return nil }
        return control.snapshot(accountID: accountID)
    }
    static func selfTest() throws {
        let daybreak: [String: Any] = ["model": "gpt-daybreak-blue-latest", "defaultReasoningEffort": "high",
            "supportedReasoningEfforts": [["reasoningEffort": "high"], ["reasoningEffort": "ultra"]]]
        let sol: [String: Any] = ["model": "gpt-5.6-sol", "defaultReasoningEffort": "medium",
            "supportedReasoningEfforts": [["reasoningEffort": "medium"]]]
        let fable: [String: Any] = ["value": "claude-fable-5-1[1m]", "resolvedModel": "claude-fable-5-1",
            "supportsEffort": true, "supportedEffortLevels": ["low", "high"]]
        let sonnet: [String: Any] = ["value": "sonnet", "resolvedModel": "claude-sonnet-5",
            "supportsEffort": true, "supportedEffortLevels": ["medium"]]
        let defaults: [String: Any] = ["value": "default", "resolvedModel": "claude-opus-5[1m]",
            "supportsEffort": true, "supportedEffortLevels": ["high", "max"]]
        let checks = [
            codexRows([daybreak, sol]).count == 2,
            !codexRows([sol]).contains { $0.slug.contains("daybreak") },
            codexRows([sol])[0].supportedEfforts == ["medium"],
            codexRows([]).isEmpty,
            codexRows([daybreak.merging(["hidden": true]) { _, n in n }]).isEmpty,
            codexRows([sol, sol]).count == 1,
            claudeRows([fable, sonnet]).contains { $0.model == "fable" && $0.invocation == "claude-fable-5-1[1m]" },
            !claudeRows([sonnet]).contains { $0.model == "fable" },
            claudeRows([sonnet])[0].efforts == ["medium"],
            claudeRows([]).isEmpty,
            claudeRows([defaults]).isEmpty,
            !claudeRows([defaults, sonnet]).contains { $0.model == "opus" },
            claudeRows([["value": "fable"]]).isEmpty,
            claudeRows([fable.merging(["supportedEffortLevels": ["ultra"]]) { _, n in n }]).isEmpty,
            excludingModelLimited(["fable", "opus", "sonnet", "claude-fable-5-1[1m]"].map {
                ClaudeModelCapability(model: $0, supportedEfforts: ["low"]) }, limited: ["fable"]).map(\.model) == ["opus", "sonnet"],
            excludingModelLimited([ClaudeModelCapability(model: "opus", supportedEfforts: ["xhigh"])], limited: []).count == 1,
        ] + inventoryCacheChecks(claudeRows([sonnet])) + [
            deferAlternateInventory(preference: "codex", codexReady: true, workflow: false),
            !deferAlternateInventory(preference: "auto", codexReady: true, workflow: false),
            !deferAlternateInventory(preference: "claude", codexReady: true, workflow: false),
            !deferAlternateInventory(preference: "codex", codexReady: false, workflow: false),
            !deferAlternateInventory(preference: "codex", codexReady: true, workflow: true),
        ] + metadataReplyChecks() + ClaudeQuotaMetadataControl.fixtureChecks()
        guard checks.allSatisfy({ $0 }) else { throw OS1Error.message("Model availability regression failed") }
        print("OS-1 account model metadata: \(checks.count) checks OK")
    }
    static func metadataReplyChecks() -> [Bool] {
        var checks: [Bool] = []
        func response(_ id: Int, _ body: [String: Any]) -> [String: Any] { ["id": id, "result": body] }
        var ordered = CodexMetadataReplies(firstID: 10)
        do {
            _ = try ordered.receive(response(12, ["rateLimits": [:]]))
            checks.append(ordered.rateLimitsObservedAt != nil)
            _ = try ordered.receive(response(11, ["data": []]))
            checks.append(!ordered.requiredReceived && !ordered.complete)
            _ = try ordered.receive(response(10, ["account": ["type": "chatgpt"]]))
            checks.append(ordered.requiredReceived && ordered.complete)
            checks.append((try ordered.required("account/read"))["account"] is [String: Any])
            checks.append(ordered.optionalRateLimits != nil)
            do { _ = try ordered.receive(response(10, [:])); checks.append(false) } catch { checks.append(true) }
        } catch { checks.append(false) }
        var missing = CodexMetadataReplies(firstID: 20)
        do {
            _ = try missing.receive(response(21, ["data": []]))
            checks.append(missing.rateLimitsObservedAt == nil)
            checks.append(!missing.requiredReceived && !missing.complete)
            do { _ = try missing.required("account/read"); checks.append(false) } catch { checks.append(true) }
            checks.append(try !missing.receive(response(99, [:])))
            checks.append(try !missing.receive(["method": "metadata/notice", "params": [:]]))
        } catch { checks.append(false) }
        var denied = CodexMetadataReplies(firstID: 30)
        do {
            _ = try denied.receive(["id": 30, "error": ["code": -1]])
            _ = try denied.receive(response(31, ["data": []]))
            _ = try denied.receive(["id": 32, "error": ["code": -1]])
            checks.append(denied.complete && denied.optionalRateLimits == nil)
            do { _ = try denied.required("account/read"); checks.append(false) } catch { checks.append(true) }
            do { _ = try denied.required("thread/start"); checks.append(false) } catch { checks.append(true) }
        } catch { checks.append(false) }
        var malformed = CodexMetadataReplies(firstID: 1)
        do { checks.append(try !malformed.receive(["id": true, "result": [:]])) } catch { checks.append(false) }
        do { _ = try malformed.receive(["id": 1]); checks.append(false) } catch { checks.append(true) }
        var loggedOut = CodexMetadataReplies(firstID: 40)
        do {
            _ = try loggedOut.receive(response(40, ["account": NSNull()]))
            _ = try loggedOut.receive(response(41, ["data": []]))
            do { _ = try loggedOut.verifiedAccount(); checks.append(false) } catch { checks.append(true) }
            var modelError = CodexMetadataReplies(firstID: 50)
            _ = try modelError.receive(response(50, ["account": ["type": "chatgpt"]]))
            _ = try modelError.receive(["id": 51, "error": ["code": -1]])
            do { _ = try modelError.required("model/list"); checks.append(false) } catch { checks.append(true) }
        } catch { checks.append(false) }
        return checks
    }
    /// A healthy explicitly selected Codex route does not depend on the other
    /// provider's SDK startup. Auto/workflows or an unavailable selection still
    /// require both inventories. Deferred data is unknown, never a health failure.
    static func deferAlternateInventory(preference: String, codexReady: Bool, workflow: Bool) -> Bool {
        preference == "codex" && codexReady && !workflow
    }

    /// The per-run inventory reuse: same workspace and fresh only.
    static func inventoryCacheChecks(_ rows: [NativeClaudeModel]) -> [Bool] {
        let cache = ClaudeInventoryCache()
        let t = Date(timeIntervalSince1970: 1_790_000_000)
        cache.store(rows, workspace: "/w", at: t)
        return [
            cache.models(workspace: "/w", maxAge: 60, now: t.addingTimeInterval(30))?.map(\.model) == rows.map(\.model),
            cache.models(workspace: "/w", maxAge: 60, now: t.addingTimeInterval(61)) == nil,
            cache.models(workspace: "/other", maxAge: 60, now: t.addingTimeInterval(1)) == nil,
            cache.models(workspace: "/w", maxAge: 0, now: t) == nil,
            cache.models(workspace: "/w", maxAge: 60, now: t.addingTimeInterval(-5)) == nil,
            { cache.clear(); return cache.models(workspace: "/w", maxAge: 60, now: t) == nil }(),
        ]
    }
    static func codexRows(_ rows: [[String: Any]]) -> [CodexModelCapability] {
        var seen = Set<String>()
        return rows.enumerated().compactMap { index, row in
            guard row["hidden"] as? Bool != true, let model = row["model"] as? String,
                  isSafeModelIdentifier(model), seen.insert(model).inserted,
                  let values = row["supportedReasoningEfforts"] as? [[String: Any]],
                  let defaultEffort = row["defaultReasoningEffort"] as? String else { return nil }
            let efforts = values.compactMap { $0["reasoningEffort"] as? String }.filter(isSupportedEffort)
            guard !efforts.isEmpty, Set(efforts).count == efforts.count, efforts.contains(defaultEffort) else { return nil }
            return CodexModelCapability(slug: model, defaultEffort: defaultEffort,
                supportedEfforts: efforts, priority: index)
        }
    }

    static func claudeRows(_ rows: [[String: Any]]) -> [NativeClaudeModel] {
        var result: [NativeClaudeModel] = []
        for row in rows {
            // Native Claude keeps a synthetic default row even when
            // availableModels excludes its resolved family. It is not evidence
            // that OS1 may explicitly select that family or full model ID.
            guard let value = row["value"] as? String, value != "default", value.count <= 128,
                  value.range(of: #"^[A-Za-z0-9][A-Za-z0-9._:\[\]-]*$"#, options: .regularExpression) != nil,
                  row["supportsEffort"] as? Bool == true,
                  let rawEfforts = row["supportedEffortLevels"] as? [String] else { continue }
            let efforts = rawEfforts.filter { ["low", "medium", "high", "xhigh", "max"].contains($0) }
            guard !efforts.isEmpty, Set(efforts).count == efforts.count else { continue }
            let resolved = row["resolvedModel"] as? String ?? value
            // Only map a family when the native response actually names it.
            // In particular "default" never means every available family.
            let alias = ["fable", "sonnet", "opus", "haiku"].first { family in
                value == family || value.hasPrefix(family + "[") || resolved.hasPrefix("claude-" + family + "-")
            }
            for model in Set([value, resolved] + (alias.map { [$0] } ?? [])) where isSafeModelIdentifier(model) {
                if !result.contains(where: { $0.model == model }) {
                    result.append(NativeClaudeModel(model: model, invocation: value, efforts: efforts))
                }
            }
        }
        return result
    }

    enum ClaudeAuthProbe: Equatable {
        case loggedIn(String?)
        case loggedOut
        case missing
        case failed(String)
    }

    /// Read-only login state of the local Claude Code CLI. Never issues a
    /// login; used to explain an empty catalog and to decide self-repair.
    static func claudeAuthProbe(workspace: String) -> ClaudeAuthProbe {
        guard let executable = try? findExecutable("claude") else { return .missing }
        guard let auth = try? commandOutput(executable, ["auth", "status", "--json"], timeout: 8, currentDirectory: workspace,
                                            environmentOverrides: backendAccountEnvironment("claude")) else {
            return .failed("auth status probe did not run")
        }
        guard let status = (try? JSONSerialization.jsonObject(with: auth.1)) as? [String: Any] else {
            let text = String(decoding: (auth.1 + auth.2).prefix(200), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            return .failed(text.isEmpty ? "auth status exit \(auth.0)" : text)
        }
        return parsedClaudeAuth(status)
    }

    static func parsedClaudeAuth(_ status: [String: Any]) -> ClaudeAuthProbe {
        guard let loggedIn = status["loggedIn"] as? Bool else {
            return .failed("auth status did not include a valid loggedIn field")
        }
        return loggedIn ? .loggedIn(status["email"] as? String) : .loggedOut
    }

    /// A recent inventory from this process (same workspace), else a live probe.
    static func claudeModels(workspace: String, maxAge: TimeInterval) throws -> [NativeClaudeModel] {
        if let cached = ClaudeInventoryCache.shared.models(workspace: workspace, maxAge: maxAge) { return cached }
        return try claudeModels(workspace: workspace)
    }

    /// Always a live probe; a successful one refreshes the process cache.
    static func claudeModels(workspace: String) throws -> [NativeClaudeModel] {
        let models = try probeClaudeModels(workspace: workspace)
        ClaudeInventoryCache.shared.store(models, workspace: workspace)
        return models
    }

    private static func probeClaudeModels(workspace: String) throws -> [NativeClaudeModel] {
        let executable = try findExecutable("claude")
        let id = UUID().uuidString
        let input = try JSONSerialization.data(withJSONObject: ["type": "control_request", "request_id": id,
            "request": ["subtype": "initialize"]]) + Data([10])
        let accountEnvironment = backendAccountEnvironment("claude")
        // Native settings/availableModels remain active. No user message, no
        // tool grant, no MCP connection, no transcript and no inference call.
        // Independent unpaid probes share one pinned account environment and
        // workspace. BOTH results are required before any model is returned.
        let authResult = MetadataCommandResult(), modelResult = MetadataCommandResult()
        let finished = DispatchGroup()
        finished.enter()
        DispatchQueue.global(qos: .userInitiated).async {
            defer { finished.leave() }
            authResult.store(Result { try commandOutput(executable, ["auth", "status", "--json"], timeout: 8,
                currentDirectory: workspace, environmentOverrides: accountEnvironment) })
        }
        finished.enter()
        DispatchQueue.global(qos: .userInitiated).async {
            defer { finished.leave() }
            modelResult.store(Result { try commandOutput(executable, ["--print", "--input-format", "stream-json",
                "--output-format", "stream-json", "--verbose", "--strict-mcp-config", "--mcp-config",
                "{\"mcpServers\":{}}", "--tools", "", "--no-session-persistence"], input: input,
                timeout: 12, currentDirectory: workspace, isProvider: true,
                environmentOverrides: accountEnvironment) })
        }
        finished.wait()
        guard BackendAccounts.environment(provider: "claude", in: BackendAccounts.load()) == accountEnvironment else {
            throw OS1Error.message("Claude account selection changed during inventory")
        }
        let auth = try authResult.value(), output = try modelResult.value()
        guard auth.0 == 0, let status = try JSONSerialization.jsonObject(with: auth.1) as? [String: Any],
              status["loggedIn"] as? Bool == true else { throw OS1Error.message("Claude account is unavailable") }
        guard output.0 == 0, output.1.count <= 2_000_000 else { throw OS1Error.message("Claude model metadata unavailable") }
        for line in output.1.split(separator: 10) {
            guard let message = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                  message["type"] as? String == "control_response",
                  let response = message["response"] as? [String: Any],
                  response["request_id"] as? String == id, response["subtype"] as? String == "success",
                  let body = response["response"] as? [String: Any], let rows = body["models"] as? [[String: Any]],
                  rows.count <= 128 else { continue }
            return claudeRows(rows)
        }
        throw OS1Error.message("Claude did not return a model inventory")
    }

    static func claudeCatalog(workspace: String, config: RuntimeConfig) throws -> [ClaudeModelCapability] {
        try claudeCatalogs(workspace: workspace, config: config).routable
    }

    /// `configured`: the native inventory mapped to configured profiles, before
    /// model-scoped limits. `routable` removes families with an active receipt.
    /// Only when `configured` is non-empty and `routable` empty is an empty
    /// catalog caused by model limits rather than a failed inventory probe.
    static func claudeCatalogs(workspace: String, config: RuntimeConfig) throws
        -> (configured: [ClaudeModelCapability], routable: [ClaudeModelCapability]) {
        guard ClaudeQuotaBackoff.active() == nil else { return ([], []) }
        let native = try claudeModels(workspace: workspace)
        let profiles = config.executionProfiles ?? [:]
        let configured: [ClaudeModelCapability] = Set(profiles.values.filter { $0.provider == "claude" }.map(\.model)).sorted().compactMap { model in
            guard let row = native.first(where: { $0.model == model }) else { return nil }
            let mapped = Set(profiles.values.filter { $0.provider == "claude" && $0.model == model }.map(\.effort))
            let efforts = row.efforts.filter { mapped.contains($0) }
            return efforts.isEmpty ? nil : ClaudeModelCapability(model: model, supportedEfforts: efforts)
        }
        return (configured, excludingModelLimited(configured, limited: Set(ClaudeQuotaBackoff.activeModels())))
    }

    /// A model-scoped limit removes only that family; the rest stays routable.
    static func excludingModelLimited(_ catalog: [ClaudeModelCapability], limited: Set<String>) -> [ClaudeModelCapability] {
        catalog.filter { !limited.contains(BackendRecovery.claudeModelFamily($0.model)) }
    }

    static func codexCatalog(workspace: String, config: RuntimeConfig) throws -> ActiveCodexCatalog {
        let accountBook = BackendAccounts.load()
        let accountID = BackendAccounts.active(provider: "codex", in: accountBook).id
        let accountEnvironment = BackendAccounts.environment(provider: "codex", in: accountBook)
        let probe = try CodexAppServerClient(executable: findExecutable("codex"), workspace: workspace)
        defer { probe.close() }
        let deadline = Date().addingTimeInterval(12)
        try probe.initialize(deadline: deadline)
        let metadata = try probe.catalogMetadata(deadline: deadline)
        guard BackendAccounts.active(provider: "codex", in: BackendAccounts.load()).id == accountID,
              BackendAccounts.environment(provider: "codex", in: BackendAccounts.load()) == accountEnvironment else {
            throw OS1Error.message("Codex account selection changed during inventory")
        }
        var catalog = executableCodexCatalog(ActiveCodexCatalog(models: metadata.models,
            source: "native account model/list"), config: config)
        // Exclusion reasons travel with the catalog so a later preflight can
        // say why no Codex model is available instead of a bare refusal.
        var notes: [String] = []
        var quotaResetsAt: Date?
        var quotaWindow: CodexQuotaWindow?
        var quotaSnapshot: BackendHealth.QuotaSnapshot?
        if let limits = metadata.rateLimits {
            if let observedAt = metadata.quotaObservedAt {
                quotaSnapshot = BackendHealth.QuotaSnapshot.codexRateLimits(limits, accountID: accountID,
                    models: Set(metadata.models.map(\.slug)), observedAt: observedAt)
            }
            // The longest unreset window: what the burn policy and the health
            // card show as "N% used, resets at".
            quotaWindow = CodexQuota.generalWindow(limits)
            let excluded = CodexQuota.excludedModels(limits, models: catalog.models.map(\.slug))
            if !excluded.isEmpty {
                quotaResetsAt = CodexQuota.exhaustedGeneralResetDate(limits)
                let reset = CodexQuota.exhaustedGeneralResetDescription(limits).map { ", 리셋 \($0)" } ?? ""
                let remaining = catalog.models.map(\.slug).filter { !excluded.contains($0) }
                // BackendHealth.codexBackend classifies this note in either language.
                notes.append(os1Tr("Codex 사용량 한도 도달로 \(excluded.count)개 모델 제외\(reset)",
                                   "Codex usage limit reached: excluded \(excluded.count) model(s)\(CodexQuota.exhaustedGeneralResetDescription(limits).map { ", resets \($0)" } ?? "")"))
                RuntimeActivity.emit(.routing, publicText: os1Tr("Codex 사용량 한도 도달로 \(excluded.count)개 모델을 제외했습니다\(reset). 남은 Codex 모델: \(remaining.isEmpty ? "없음" : remaining.joined(separator: ", "))",
                                                                 "Codex usage limit reached; excluded \(excluded.count) model(s)\(CodexQuota.exhaustedGeneralResetDescription(limits).map { ", resets \($0)" } ?? ""). Remaining Codex models: \(remaining.isEmpty ? "none" : remaining.joined(separator: ", "))"))
            }
            catalog = ActiveCodexCatalog(models: catalog.models.filter { !excluded.contains($0.slug) }, source: catalog.source)
        }
        // The account's base instructions are sent with every Codex thread; a
        // model that cannot hold them rejects the turn before reading it.
        if let bytes = CodexContextBudget.configuredBaseInstructionBytes() {
            let windows = CodexContextBudget.cachedContextWindows()
            let oversized = CodexContextBudget.excluded(models: catalog.models.map { ($0.slug, windows[$0.slug]) }, baseInstructionBytes: bytes)
            if !oversized.isEmpty {
                notes.append(os1Tr("계정 기본 지시문(\(bytes / 1024)KB)을 담지 못하는 모델 제외: \(oversized.sorted().joined(separator: ", "))",
                                   "Excluded models that cannot hold the account's base instructions (\(bytes / 1024)KB): \(oversized.sorted().joined(separator: ", "))"))
                RuntimeActivity.emit(.routing, publicText: os1Tr("Codex 모델 \(oversized.sorted().joined(separator: ", "))은(는) 계정 기본 지시문(\(bytes / 1024)KB, 약 \(CodexContextBudget.requiredTokens(baseInstructionBytes: bytes) / 1000)K 토큰 필요)을 담기에 컨텍스트 창이 작아 제외했습니다.",
                                                                 "Excluded Codex model(s) \(oversized.sorted().joined(separator: ", ")): the context window is too small for the account's base instructions (\(bytes / 1024)KB, about \(CodexContextBudget.requiredTokens(baseInstructionBytes: bytes) / 1000)K tokens needed)."))
                catalog = ActiveCodexCatalog(models: catalog.models.filter { !oversized.contains($0.slug) }, source: catalog.source)
            }
        }
        let source = notes.isEmpty ? catalog.source : catalog.source + " · " + notes.joined(separator: "; ")
        return ActiveCodexCatalog(models: catalog.models, source: source, quotaResetsAt: quotaResetsAt,
                                  quotaWindow: quotaWindow, quotaSnapshot: quotaSnapshot)
    }
}
