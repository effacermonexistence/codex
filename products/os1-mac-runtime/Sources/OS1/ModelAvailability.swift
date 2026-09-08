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
            !claudeRows([defaults]).contains { $0.model == "fable" || $0.model == "sonnet" },
            claudeRows([["value": "fable"]]).isEmpty,
            claudeRows([fable.merging(["supportedEffortLevels": ["ultra"]]) { _, n in n }]).isEmpty,
        ]
        guard checks.allSatisfy({ $0 }) else { throw OS1Error.message("Model availability regression failed") }
        print("OS-1 account model metadata: \(checks.count) checks OK")
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
            guard let value = row["value"] as? String, value.count <= 128,
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
                    result.append(NativeClaudeModel(model: model, invocation: value == "default" ? resolved : value, efforts: efforts))
                }
            }
        }
        return result
    }

    static func claudeModels(workspace: String) throws -> [NativeClaudeModel] {
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
        let native = try claudeModels(workspace: workspace)
        let profiles = config.executionProfiles ?? [:]
        return Set(profiles.values.filter { $0.provider == "claude" }.map(\.model)).sorted().compactMap { model in
            guard let row = native.first(where: { $0.model == model }) else { return nil }
            let mapped = Set(profiles.values.filter { $0.provider == "claude" && $0.model == model }.map(\.effort))
            let efforts = row.efforts.filter { mapped.contains($0) }
            return efforts.isEmpty ? nil : ClaudeModelCapability(model: model, supportedEfforts: efforts)
        }
    }

    static func codexCatalog(workspace: String, config: RuntimeConfig) throws -> ActiveCodexCatalog {
        let probe = try CodexAppServerClient(executable: findExecutable("codex"), workspace: workspace)
        defer { probe.close() }
        let deadline = Date().addingTimeInterval(12)
        try probe.initialize(deadline: deadline)
        var catalog = executableCodexCatalog(ActiveCodexCatalog(models: try probe.models(deadline: deadline),
            source: "native account model/list"), config: config)
        if let limits = try? probe.rateLimits(deadline: deadline) {
            let excluded = CodexQuota.excludedModels(limits, models: catalog.models.map(\.slug))
            catalog = ActiveCodexCatalog(models: catalog.models.filter { !excluded.contains($0.slug) }, source: catalog.source)
        }
        return catalog
    }
}
