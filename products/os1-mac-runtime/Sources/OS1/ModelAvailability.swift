import Foundation
import OS1Context

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
        ] + inventoryCacheChecks(claudeRows([sonnet]))
        guard checks.allSatisfy({ $0 }) else { throw OS1Error.message("Model availability regression failed") }
        print("OS-1 account model metadata: \(checks.count) checks OK")
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
        guard let auth = try? commandOutput(executable, ["auth", "status", "--json"], timeout: 8, currentDirectory: workspace) else {
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
        let auth = try commandOutput(executable, ["auth", "status", "--json"], timeout: 8,
            currentDirectory: workspace)
        guard auth.0 == 0, let status = try JSONSerialization.jsonObject(with: auth.1) as? [String: Any],
              status["loggedIn"] as? Bool == true else { throw OS1Error.message("Claude account is unavailable") }
        let id = UUID().uuidString
        let input = try JSONSerialization.data(withJSONObject: ["type": "control_request", "request_id": id,
            "request": ["subtype": "initialize"]]) + Data([10])
        // Native settings/availableModels remain active. No user message, no
        // tool grant, no MCP connection, no transcript and no inference call.
        let output = try commandOutput(executable, ["--print", "--input-format", "stream-json",
            "--output-format", "stream-json", "--verbose", "--strict-mcp-config", "--mcp-config",
            "{\"mcpServers\":{}}", "--tools", "", "--no-session-persistence"], input: input,
            timeout: 12, currentDirectory: workspace, isProvider: true)
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
        let probe = try CodexAppServerClient(executable: findExecutable("codex"), workspace: workspace)
        defer { probe.close() }
        let deadline = Date().addingTimeInterval(12)
        try probe.initialize(deadline: deadline)
        var catalog = executableCodexCatalog(ActiveCodexCatalog(models: try probe.models(deadline: deadline),
            source: "native account model/list"), config: config)
        // Exclusion reasons travel with the catalog so a later preflight can
        // say why no Codex model is available instead of a bare refusal.
        var notes: [String] = []
        var quotaResetsAt: Date?
        var quotaWindow: CodexQuotaWindow?
        if let limits = try? probe.rateLimits(deadline: deadline) {
            // The longest unreset window: what the burn policy and the health
            // card show as "N% used, resets at".
            quotaWindow = CodexQuota.generalWindow(limits)
            let excluded = CodexQuota.excludedModels(limits, models: catalog.models.map(\.slug))
            if !excluded.isEmpty {
                quotaResetsAt = CodexQuota.exhaustedGeneralResetDate(limits)
                let reset = CodexQuota.exhaustedGeneralResetDescription(limits).map { ", 리셋 \($0)" } ?? ""
                let remaining = catalog.models.map(\.slug).filter { !excluded.contains($0) }
                notes.append("Codex 사용량 한도 도달로 \(excluded.count)개 모델 제외\(reset)")
                RuntimeActivity.emit(.routing, publicText: "Codex 사용량 한도 도달로 \(excluded.count)개 모델을 제외했습니다\(reset). 남은 Codex 모델: \(remaining.isEmpty ? "없음" : remaining.joined(separator: ", "))")
            }
            catalog = ActiveCodexCatalog(models: catalog.models.filter { !excluded.contains($0.slug) }, source: catalog.source)
        }
        // The account's base instructions are sent with every Codex thread; a
        // model that cannot hold them rejects the turn before reading it.
        if let bytes = CodexContextBudget.configuredBaseInstructionBytes() {
            let windows = CodexContextBudget.cachedContextWindows()
            let oversized = CodexContextBudget.excluded(models: catalog.models.map { ($0.slug, windows[$0.slug]) }, baseInstructionBytes: bytes)
            if !oversized.isEmpty {
                notes.append("계정 기본 지시문(\(bytes / 1024)KB)을 담지 못하는 모델 제외: \(oversized.sorted().joined(separator: ", "))")
                RuntimeActivity.emit(.routing, publicText: "Codex 모델 \(oversized.sorted().joined(separator: ", "))은(는) 계정 기본 지시문(\(bytes / 1024)KB, 약 \(CodexContextBudget.requiredTokens(baseInstructionBytes: bytes) / 1000)K 토큰 필요)을 담기에 컨텍스트 창이 작아 제외했습니다.")
                catalog = ActiveCodexCatalog(models: catalog.models.filter { !oversized.contains($0.slug) }, source: catalog.source)
            }
        }
        let source = notes.isEmpty ? catalog.source : catalog.source + " · " + notes.joined(separator: "; ")
        return ActiveCodexCatalog(models: catalog.models, source: source, quotaResetsAt: quotaResetsAt, quotaWindow: quotaWindow)
    }
}
