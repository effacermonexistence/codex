import Foundation
import CoreFoundation

/// Context size is a per-request quantity. Lifetime token spend is deliberately
/// not accepted by this policy. Published API prices do not describe included
/// subscription usage, and an OS-1 budget is not a provider price claim.
public enum ContextBudgetProvider: String, Codable, Sendable {
    case openAI = "openai"
    case anthropic

    public init?(rawProvider: String) {
        switch rawProvider.lowercased() {
        case "openai", "codex": self = .openAI
        case "anthropic", "claude": self = .anthropic
        default: return nil
        }
    }
}

public enum ContextBillingScope: String, Codable, Sendable {
    case api, subscription, unknown
}

public enum ContextThresholdComparison: String, Codable, Sendable {
    case greaterThan = ">"
    case greaterThanOrEqual = ">="

    public func crossed(_ count: Int, threshold: Int) -> Bool {
        switch self {
        case .greaterThan: return count > threshold
        case .greaterThanOrEqual: return count >= threshold
        }
    }
}

public enum ContextPricingVerification: String, Codable, Sendable {
    case officialSource = "official_source"
    case configurationOverride = "configuration_override"
}

public enum ContextPricingChargingScope: String, Codable, Sendable {
    case request
    /// Older OpenAI pages literally say "full session". This records the
    /// wording; it does not invent retroactive or permanently sticky billing.
    case sessionDocumentation = "session_documentation"
}

public struct ContextPricingRule: Codable, Equatable, Sendable {
    public var provider: ContextBudgetProvider
    public var model: String
    public var aliases: [String]
    public var maximumInputTokens: Int?
    public var pricingThresholdTokens: Int?
    public var comparison: ContextThresholdComparison
    public var inputMultiplier: Double
    public var cachedInputMultiplier: Double
    public var cacheWriteMultiplier: Double
    public var outputMultiplier: Double
    public var chargingScope: ContextPricingChargingScope
    public var verifiedAt: String
    public var sourceURLs: [String]
    public var verification: ContextPricingVerification
    public var note: String

    public init(provider: ContextBudgetProvider, model: String, aliases: [String] = [],
                maximumInputTokens: Int? = nil, pricingThresholdTokens: Int? = nil,
                comparison: ContextThresholdComparison = .greaterThan,
                inputMultiplier: Double = 1, cachedInputMultiplier: Double = 1,
                cacheWriteMultiplier: Double = 1, outputMultiplier: Double = 1,
                chargingScope: ContextPricingChargingScope = .request,
                verifiedAt: String, sourceURLs: [String],
                verification: ContextPricingVerification = .officialSource, note: String = "") {
        self.provider = provider; self.model = model; self.aliases = aliases
        self.maximumInputTokens = maximumInputTokens; self.pricingThresholdTokens = pricingThresholdTokens
        self.comparison = comparison; self.inputMultiplier = inputMultiplier
        self.cachedInputMultiplier = cachedInputMultiplier; self.cacheWriteMultiplier = cacheWriteMultiplier
        self.outputMultiplier = outputMultiplier; self.chargingScope = chargingScope
        self.verifiedAt = verifiedAt; self.sourceURLs = sourceURLs
        self.verification = verification; self.note = note
    }
}

/// Explicit IDs only: neither vendor, future model names, nor arbitrary dated
/// suffixes inherit a known model's threshold. Owner configuration can supply
/// another explicit mapping; it is labeled configuration, not official proof.
public enum ContextPricingRegistry {
    public static let verifiedAt = "2026-10-04"
    public static let officialDefaults: [ContextPricingRule] = {
        var rules: [ContextPricingRule] = []
        let openAI: [(String, [String], ContextPricingChargingScope)] = [
            ("gpt-5.4", ["gpt-5.4-2026-03-05"], .sessionDocumentation),
            ("gpt-5.4-pro", ["gpt-5.4-pro-2026-03-05"], .sessionDocumentation),
            ("gpt-5.5", ["gpt-5.5-2026-04-23"], .sessionDocumentation),
            ("gpt-5.6-sol", ["gpt-5.6"], .request),
            ("gpt-5.6-terra", [], .request), ("gpt-5.6-luna", [], .request),
            ("gpt-6-sol", [], .request), ("gpt-6-luna", [], .request),
            ("gpt-6-astra", [], .request), ("gpt-6.1-sol", [], .request)
        ]
        for (model, aliases, scope) in openAI {
            rules.append(ContextPricingRule(provider: .openAI, model: model, aliases: aliases,
                maximumInputTokens: model.hasPrefix("gpt-6") || model.hasPrefix("gpt-5.6") ? 922_000 : nil,
                pricingThresholdTokens: 272_000, inputMultiplier: 2, cachedInputMultiplier: 2,
                cacheWriteMultiplier: 2, outputMultiplier: 1.5, chargingScope: scope,
                verifiedAt: verifiedAt,
                sourceURLs: ["https://developers.openai.com/api/docs/models/\(model)",
                             "https://developers.openai.com/api/docs/pricing"],
                note: "API only. The input threshold includes cached input. The premium applies to the full priced request, not just excess tokens. Older full-session wording is preserved without assuming sticky billing."))
        }
        rules.append(ContextPricingRule(provider: .openAI, model: "gpt-5.3-codex",
            maximumInputTokens: 272_000, verifiedAt: verifiedAt,
            sourceURLs: ["https://developers.openai.com/api/docs/models/gpt-5.3-codex"],
            note: "272K is this model's maximum input, not a documented surcharge threshold."))
        for model in ["claude-fable-5-1", "claude-fable-5", "claude-opus-5-5", "claude-opus-5",
                      "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6",
                      "claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6"] {
            rules.append(ContextPricingRule(provider: .anthropic, model: model,
                verifiedAt: verifiedAt,
                sourceURLs: ["https://platform.claude.com/docs/en/about-claude/pricing#long-context-pricing",
                             "https://platform.claude.com/docs/en/models/overview"],
                note: "No long-context premium on the first-party API. Actual input capacity depends on the reserved output and execution surface; use runtime limits."))
        }
        rules.append(ContextPricingRule(provider: .anthropic, model: "claude-haiku-4-5-20251001",
            aliases: ["claude-haiku-4-5"], verifiedAt: verifiedAt,
            sourceURLs: ["https://platform.claude.com/docs/en/models/haiku-4-5/overview"],
            note: "200K total context, not a long-context price tier. Reserve output using runtime limits."))
        return rules
    }()

    public static func rule(provider: ContextBudgetProvider, model: String,
                            configuration: ContextBudgetConfiguration = .default) -> ContextPricingRule? {
        var result = officialDefaults.first { $0.provider == provider && ($0.model == model || $0.aliases.contains(model)) }
        if let override = configuration.providerThresholds.last(where: {
            $0.provider == provider && ($0.model == model || $0.aliases.contains(model))
        }) {
            if result == nil {
                result = ContextPricingRule(provider: provider, model: override.model,
                    verifiedAt: "UNVERIFIED", sourceURLs: [], verification: .configurationOverride)
            }
            let existingAliases = result?.aliases ?? []
            result?.aliases = override.aliases.isEmpty ? existingAliases : override.aliases
            if let limit = override.maximumInputTokens { result?.maximumInputTokens = limit }
            if override.disablePricingThreshold { result?.pricingThresholdTokens = nil }
            else if let threshold = override.pricingThresholdTokens { result?.pricingThresholdTokens = threshold }
            if let comparison = override.comparison { result?.comparison = comparison }
            result?.verification = .configurationOverride
            result?.note = "OS-1 configuration override; a configured threshold is not independent verification of vendor billing."
        }
        return result
    }
}

public struct ContextPricingRuleOverride: Codable, Equatable, Sendable {
    public var provider: ContextBudgetProvider
    public var model: String
    public var aliases: [String]
    public var maximumInputTokens: Int?
    public var pricingThresholdTokens: Int?
    public var comparison: ContextThresholdComparison?
    public var disablePricingThreshold: Bool

    public init(provider: ContextBudgetProvider, model: String, aliases: [String] = [],
                maximumInputTokens: Int? = nil, pricingThresholdTokens: Int? = nil,
                comparison: ContextThresholdComparison? = nil, disablePricingThreshold: Bool = false) {
        self.provider = provider; self.model = model; self.aliases = aliases
        self.maximumInputTokens = maximumInputTokens; self.pricingThresholdTokens = pricingThresholdTokens
        self.comparison = comparison; self.disablePricingThreshold = disablePricingThreshold
    }

    private enum CodingKeys: String, CodingKey {
        case provider, model, aliases, comparison
        case maximumInputTokens = "maximum_input_tokens"
        case pricingThresholdTokens = "pricing_threshold_tokens"
        case disablePricingThreshold = "disable_pricing_threshold"
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        provider = try c.decode(ContextBudgetProvider.self, forKey: .provider)
        model = try c.decode(String.self, forKey: .model)
        aliases = try c.decodeIfPresent([String].self, forKey: .aliases) ?? []
        maximumInputTokens = try c.decodeIfPresent(Int.self, forKey: .maximumInputTokens)
        pricingThresholdTokens = try c.decodeIfPresent(Int.self, forKey: .pricingThresholdTokens)
        comparison = try c.decodeIfPresent(ContextThresholdComparison.self, forKey: .comparison)
        disablePricingThreshold = try c.decodeIfPresent(Bool.self, forKey: .disablePricingThreshold) ?? false
    }
}

public enum ContextBudgetConfigurationError: Error, Equatable {
    case invalidLimits, invalidProviderThreshold
}

public struct ContextBudgetConfiguration: Codable, Equatable, Sendable {
    public var softContextLimitTokens: Int
    public var hardContextLimitTokens: Int
    public var retrievalBudgetTokens: Int
    public var activeStateBudgetTokens: Int
    public var safetyMarginTokens: Int
    public var minimumHandoffSavingsTokens: Int
    public var providerThresholds: [ContextPricingRuleOverride]
    public static let `default` = ContextBudgetConfiguration()

    /// These are editable OS-1 footprint budgets, not universal vendor limits.
    public init(softContextLimitTokens: Int = 240_000, hardContextLimitTokens: Int = 272_000,
                retrievalBudgetTokens: Int = 24_000, activeStateBudgetTokens: Int = 8_000,
                safetyMarginTokens: Int = 8_000, minimumHandoffSavingsTokens: Int = 8_000,
                providerThresholds: [ContextPricingRuleOverride] = []) {
        self.softContextLimitTokens = softContextLimitTokens; self.hardContextLimitTokens = hardContextLimitTokens
        self.retrievalBudgetTokens = retrievalBudgetTokens; self.activeStateBudgetTokens = activeStateBudgetTokens
        self.safetyMarginTokens = safetyMarginTokens; self.minimumHandoffSavingsTokens = minimumHandoffSavingsTokens
        self.providerThresholds = providerThresholds
    }

    private enum CodingKeys: String, CodingKey {
        case softContextLimitTokens = "soft_context_limit_tokens"
        case hardContextLimitTokens = "hard_context_limit_tokens"
        case retrievalBudgetTokens = "retrieval_budget_tokens"
        case activeStateBudgetTokens = "active_state_budget_tokens"
        case safetyMarginTokens = "safety_margin_tokens"
        case minimumHandoffSavingsTokens = "minimum_handoff_savings_tokens"
        case providerThresholds = "provider_thresholds"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = Self.default
        softContextLimitTokens = try c.decodeIfPresent(Int.self, forKey: .softContextLimitTokens) ?? d.softContextLimitTokens
        hardContextLimitTokens = try c.decodeIfPresent(Int.self, forKey: .hardContextLimitTokens) ?? d.hardContextLimitTokens
        retrievalBudgetTokens = try c.decodeIfPresent(Int.self, forKey: .retrievalBudgetTokens) ?? d.retrievalBudgetTokens
        activeStateBudgetTokens = try c.decodeIfPresent(Int.self, forKey: .activeStateBudgetTokens) ?? d.activeStateBudgetTokens
        safetyMarginTokens = try c.decodeIfPresent(Int.self, forKey: .safetyMarginTokens) ?? d.safetyMarginTokens
        minimumHandoffSavingsTokens = try c.decodeIfPresent(Int.self, forKey: .minimumHandoffSavingsTokens) ?? d.minimumHandoffSavingsTokens
        providerThresholds = try c.decodeIfPresent([ContextPricingRuleOverride].self, forKey: .providerThresholds) ?? []
        try validate()
    }

    public func validate() throws {
        guard softContextLimitTokens > 0, hardContextLimitTokens >= softContextLimitTokens,
              retrievalBudgetTokens > 0, activeStateBudgetTokens > 0,
              safetyMarginTokens >= 0, safetyMarginTokens < hardContextLimitTokens,
              minimumHandoffSavingsTokens >= 0,
              retrievalBudgetTokens <= hardContextLimitTokens - activeStateBudgetTokens,
              activeStateBudgetTokens <= hardContextLimitTokens else { throw ContextBudgetConfigurationError.invalidLimits }
        for rule in providerThresholds {
            guard !rule.model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  rule.maximumInputTokens.map({ $0 > 0 }) ?? true,
                  rule.pricingThresholdTokens.map({ $0 > 0 }) ?? true,
                  rule.aliases.allSatisfy({ !$0.isEmpty }) else { throw ContextBudgetConfigurationError.invalidProviderThreshold }
        }
    }

    /// Accepts a standalone policy or the context_budget section of OS-1's
    /// ordinary JSON config. Malformed explicit configuration is never ignored.
    public static func decode(_ data: Data) throws -> Self {
        if let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
           let nested = object["context_budget"] {
            return try JSONDecoder().decode(Self.self, from: JSONSerialization.data(withJSONObject: nested))
        }
        return try JSONDecoder().decode(Self.self, from: data)
    }

    public static func load(from url: URL) throws -> Self { try decode(Data(contentsOf: url)) }
}

public struct ContextInputUsage: Codable, Equatable, Sendable {
    public var provider: ContextBudgetProvider
    public var model: String?
    public var inputTokens: Int
    public var cachedInputTokens: Int?
    public var cacheWriteInputTokens: Int?
    public var outputTokens: Int?
    public var contextWindowTokens: Int?
    public var responseID: String?
    public var turnID: String?
    public var observedAt: String?
    public var source: String
    public let evidenceClass: String = "measured_request_input"

    private enum CodingKeys: String, CodingKey {
        case provider, model, inputTokens, cachedInputTokens, cacheWriteInputTokens, outputTokens
        case contextWindowTokens, responseID, turnID, observedAt, source, evidenceClass
    }

    public init(provider: ContextBudgetProvider, model: String? = nil, inputTokens: Int,
                cachedInputTokens: Int? = nil, cacheWriteInputTokens: Int? = nil,
                outputTokens: Int? = nil, contextWindowTokens: Int? = nil,
                responseID: String? = nil, turnID: String? = nil, observedAt: String? = nil, source: String) {
        self.provider = provider; self.model = model; self.inputTokens = inputTokens
        self.cachedInputTokens = cachedInputTokens; self.cacheWriteInputTokens = cacheWriteInputTokens
        self.outputTokens = outputTokens; self.contextWindowTokens = contextWindowTokens
        self.responseID = responseID; self.turnID = turnID; self.observedAt = observedAt; self.source = source
    }
}

public enum ContextInputUsageParser {
    /// Last actual request, never total_token_usage or turn_token_usage.
    /// turn_token_usage is cumulative even when the record has a response ID.
    public static func parseCodexJSONL(_ data: Data, turnID: String? = nil) -> ContextInputUsage? {
        var last: ContextInputUsage?
        var activeTurn: String?
        var activeModel: String?
        for line in data.split(separator: 0x0A) {
            guard let o = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                  let type = o["type"] as? String else { continue }
            let p = o["payload"] as? [String: Any] ?? [:]
            if type == "turn_context" { activeModel = p["model"] as? String }
            if type == "event_msg", p["type"] as? String == "task_started" { activeTurn = p["turn_id"] as? String }
            let recordTurn = p["turn_id"] as? String ?? activeTurn
            if let turnID, recordTurn != turnID { continue }
            let usage: [String: Any]
            let source: String
            var window: Int?
            if type == "event_msg", p["type"] as? String == "token_count",
               let info = p["info"] as? [String: Any], let perRequest = info["last_token_usage"] as? [String: Any] {
                usage = perRequest; source = "codex.event_msg.token_count.info.last_token_usage"
                window = integer(info["model_context_window"])
            } else if type == "token_usage_record", let response = p["response_id"] as? String, !response.isEmpty,
                      let perRequest = (p["response_token_usage"] ?? p["usage"]) as? [String: Any] {
                usage = perRequest; source = "codex.token_usage_record.response_usage"
                window = integer(p["model_context_window"])
            } else { continue }
            guard let input = integer(usage["input_tokens"]) else { continue }
            let cached = integer(usage["cached_input_tokens"])
            let written = integer(usage["cache_write_input_tokens"])
            guard cached.map({ $0 <= input }) ?? true,
                  written.map({ $0 <= input - (cached ?? 0) }) ?? true else { continue }
            last = ContextInputUsage(provider: .openAI, model: p["model"] as? String ?? activeModel,
                inputTokens: input, cachedInputTokens: cached, cacheWriteInputTokens: written,
                outputTokens: integer(usage["output_tokens"]), contextWindowTokens: window,
                responseID: p["response_id"] as? String, turnID: recordTurn,
                observedAt: o["timestamp"] as? String, source: source)
        }
        return last
    }

    /// Claude's input_tokens excludes cache creation/reads. All three fields
    /// must be present to establish the actual request size. Result/modelUsage
    /// records are cumulative spend and cannot establish current context.
    public static func parseClaudeJSONL(_ data: Data) -> ContextInputUsage? {
        var last: ContextInputUsage?
        for line in data.split(separator: 0x0A) {
            guard let o = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                  o["type"] as? String == "assistant",
                  let m = o["message"] as? [String: Any], m["model"] as? String != "<synthetic>",
                  let identity = m["id"] as? String ?? o["uuid"] as? String,
                  let u = m["usage"] as? [String: Any],
                  let ordinary = integer(u["input_tokens"]), let written = integer(u["cache_creation_input_tokens"]),
                  let cached = integer(u["cache_read_input_tokens"]),
                  ordinary <= Int.max - written, ordinary + written <= Int.max - cached else { continue }
            last = ContextInputUsage(provider: .anthropic, model: m["model"] as? String,
                inputTokens: ordinary + written + cached, cachedInputTokens: cached,
                cacheWriteInputTokens: written, outputTokens: integer(u["output_tokens"]),
                responseID: identity, observedAt: o["timestamp"] as? String,
                source: "claude.assistant.message.usage")
        }
        return last
    }

    private static func integer(_ value: Any?) -> Int? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(),
              let count = Int(n.stringValue), count >= 0 else { return nil }
        return count
    }
}

public struct ContextTokenEstimate: Codable, Equatable, Sendable {
    public var inputTokens: Int
    public var utf8Bytes: Int
    public var structuralOverheadTokens: Int
    public var hasUncountedMultimodalInput: Bool
    public var method: String
    public let evidenceClass: String = "heuristic_estimate_not_provider_count"

    private enum CodingKeys: String, CodingKey {
        case inputTokens, utf8Bytes, structuralOverheadTokens, hasUncountedMultimodalInput, method, evidenceClass
    }

    public init(inputTokens: Int, utf8Bytes: Int, structuralOverheadTokens: Int,
                hasUncountedMultimodalInput: Bool = false, method: String = "utf8_byte_conservative_heuristic") {
        self.inputTokens = inputTokens; self.utf8Bytes = utf8Bytes
        self.structuralOverheadTokens = structuralOverheadTokens
        self.hasUncountedMultimodalInput = hasUncountedMultimodalInput; self.method = method
    }

    /// One token per UTF-8 byte is intentionally conservative for text. It is
    /// still a heuristic, NOT exact tokenization or a proof of provider bounds.
    /// Unknown media cost remains marked unknown instead of bytes/4 fiction.
    public static func utf8(texts: [String], structuralOverheadTokens: Int = 2_048,
                            hasUncountedMultimodalInput: Bool = false) -> Self {
        let bytes = texts.reduce(0) { total, text in
            let count = text.utf8.count
            return total > Int.max - count ? Int.max : total + count
        }
        let overhead = max(0, structuralOverheadTokens)
        let count = bytes > Int.max - overhead ? Int.max : bytes + overhead
        return Self(inputTokens: count, utf8Bytes: bytes, structuralOverheadTokens: overhead,
                    hasUncountedMultimodalInput: hasUncountedMultimodalInput)
    }
}

public enum ContextBudgetAction: String, Codable, Sendable {
    case continueSession = "continue"
    case continueWithWarning = "continue_with_warning"
    case rotateSession = "rotate_session"
    case holdRequest = "hold_request"
}

public enum ContextPremiumStatus: String, Codable, Sendable {
    case unknownModel = "unknown_model"
    case unknownBillingScope = "unknown_billing_scope"
    case subscriptionNotEstablished = "subscription_pricing_not_established"
    case noPremiumDocumented = "no_premium_documented"
    case belowOrAtThreshold = "below_or_at_threshold"
    case crossedMeasured = "crossed_measured"
    case crossedEstimated = "crossed_estimated"
    case configuredThreshold = "configured_threshold_not_verified_billing"
}

public struct ContextBudgetReceipt: Codable, Equatable, Sendable {
    public var provider: ContextBudgetProvider
    public var model: String
    public var billingScope: ContextBillingScope
    public var measured: ContextInputUsage?
    public var preflightEstimate: ContextTokenEstimate?
    public var pricingRule: ContextPricingRule?
    public var premiumStatus: ContextPremiumStatus
    public var softLimitTokens: Int
    public var hardLimitTokens: Int
    public var evaluatedInputTokens: Int?
    public var freshSessionEstimateTokens: Int?
    public var action: ContextBudgetAction
    public var reason: String
    public var alreadyFresh: Bool
    public var resumable: Bool
    /// Policy instruction only; downstream durable storage supplies its own
    /// preservation receipt. This evaluator does not claim to write history.
    public let preserveRawHistory = true
    public let truncateRequest = false

    private enum CodingKeys: String, CodingKey {
        case provider, model, billingScope, measured, preflightEstimate, pricingRule, premiumStatus
        case softLimitTokens, hardLimitTokens, evaluatedInputTokens, freshSessionEstimateTokens
        case action, reason, alreadyFresh, resumable, preserveRawHistory, truncateRequest
    }
}

public enum ContextBudgetPolicy {
    /// Estimates must cover the complete provider payload, including reusable
    /// base instructions and reloaded policy/tools, not merely the OS-1 carry
    /// note. `freshSessionEstimateTokens` is likewise the total fresh input.
    /// This pure policy proposes rotation; the executor must verify lineage,
    /// durable preservation and downstream adoption before calling it done.
    public static func evaluate(provider: ContextBudgetProvider, model: String,
                                billingScope: ContextBillingScope = .unknown,
                                measured: ContextInputUsage? = nil, estimate: ContextTokenEstimate? = nil,
                                freshSessionEstimateTokens: Int? = nil, resumable: Bool,
                                alreadyFresh: Bool = false,
                                configuration: ContextBudgetConfiguration = .default,
                                runtimeMaximumInputTokens: Int? = nil) -> ContextBudgetReceipt {
        let configurationValid = (try? configuration.validate()) != nil
        // Validate before arithmetic, including callers using the public
        // initializer rather than the checked JSON decoder.
        let limits = configurationValid ? configuration : .default
        let rule = ContextPricingRegistry.rule(provider: provider, model: model, configuration: limits)
        let validMeasurement = measured.flatMap { $0.provider == provider && $0.inputTokens >= 0 &&
            ($0.model == nil || $0.model == model || rule?.aliases.contains($0.model ?? "") == true ||
             rule?.model == $0.model) ? $0 : nil }
        let validEstimate = estimate.flatMap { $0.inputTokens >= 0 ? $0 : nil }
        // Estimate is the proposed next payload; measured is retained separately
        // as last-response evidence. A compacted/new payload may be smaller.
        let count = validEstimate?.inputTokens ?? validMeasurement?.inputTokens
        let capacity = [limits.hardContextLimitTokens, rule?.maximumInputTokens,
                        runtimeMaximumInputTokens.flatMap { $0 > 0 ? $0 : nil }].compactMap { $0 }.min() ?? limits.hardContextLimitTokens
        var soft = min(limits.softContextLimitTokens, capacity)
        if billingScope == .api, let threshold = rule?.pricingThresholdTokens {
            soft = min(soft, max(1, threshold - limits.safetyMarginTokens))
        }
        var premium: ContextPremiumStatus
        if rule == nil { premium = .unknownModel }
        else if billingScope == .subscription { premium = .subscriptionNotEstablished }
        else if billingScope == .unknown { premium = .unknownBillingScope }
        else if rule?.verification == .configurationOverride { premium = .configuredThreshold }
        else if let threshold = rule?.pricingThresholdTokens, let count {
            premium = rule!.comparison.crossed(count, threshold: threshold)
                ? (validEstimate == nil ? .crossedMeasured : .crossedEstimated) : .belowOrAtThreshold
        } else { premium = .noPremiumDocumented }
        var action: ContextBudgetAction = .continueSession
        var reason = "Within the configured working-context budget."
        if !configurationValid {
            action = .holdRequest; reason = "Invalid explicit context-budget configuration; request preserved."
        } else if validEstimate?.hasUncountedMultimodalInput == true {
            action = .continueWithWarning
            reason = "Text-only preflight estimate cannot establish multimodal input size; exact provider count or measured evidence is required."
        }
        if action != .holdRequest, let count, count >= soft {
            let freshFits = freshSessionEstimateTokens.map { $0 >= 0 && $0 <= soft } ?? false
            let improves = freshSessionEstimateTokens.map { $0 >= 0 && $0 < count && count - $0 >= limits.minimumHandoffSavingsTokens } ?? false
            let mediaUncounted = validEstimate?.hasUncountedMultimodalInput == true
            if resumable && !alreadyFresh && freshFits && improves && !mediaUncounted {
                action = .rotateSession
                reason = "Resumable fresh-session carry is estimated to fit the soft budget and reduce active context; raw history remains retrievable."
            } else if count > capacity {
                action = .holdRequest
                reason = "The request exceeds the effective hard input budget and no verified bounded handoff is available; do not truncate or repeat a fresh-session rotation."
            } else {
                action = .continueWithWarning
                reason = alreadyFresh ? "Already fresh; repeated rotation cannot repair the irreducible payload. Request is preserved."
                    : "Soft budget reached, but resumability and a smaller bounded carry have not both been established."
            }
        } else if count == nil && action != .holdRequest {
            action = .continueWithWarning; reason = "Current request context is unknown; cumulative spend is not a substitute."
        }
        return ContextBudgetReceipt(provider: provider, model: model, billingScope: billingScope,
            measured: validMeasurement, preflightEstimate: validEstimate, pricingRule: rule, premiumStatus: premium,
            softLimitTokens: soft, hardLimitTokens: capacity, evaluatedInputTokens: count,
            freshSessionEstimateTokens: freshSessionEstimateTokens, action: action, reason: reason,
            alreadyFresh: alreadyFresh, resumable: resumable)
    }
}
