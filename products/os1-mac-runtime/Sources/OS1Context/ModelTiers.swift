import Foundation

/// The capability tier of one provider model (build 378). OS-1 does not grade
/// models itself: every tier below is what the provider's own model metadata
/// says about that model, observed on 2026-10-14 without a model turn.
///
/// Codex, `~/.codex/models_cache.json` descriptions:
/// - `gpt-6-astra`: "Frontier intelligence for the most demanding work." (frontier)
/// - `gpt-6.1-sol`: "Latest workhorse model for coding and everyday work." (workhorse)
/// - `gpt-6-luna`: "Fast and affordable model for easier tasks." (fast)
/// - `gpt-6-sol` ("Previous generation workhorse"), every `gpt-5.x`/`gpt-5.6-*`
///   model (older generations) and `gpt-daybreak-blue-latest` (a specialized
///   cyber model, not a general tier) have NO tier.
///
/// Claude, the CLI `initialize` model inventory (value, resolved ID and family
/// alias of one native row share its tier):
/// - `claude-fable-5-1` / `fable`: "Fable 5.1 · Most capable for your hardest
///   and longest-running tasks" (frontier)
/// - `opus` / `claude-opus-5-5`: "Opus 5.5 · Best for everyday, complex tasks"
///   (workhorse; Claude's default)
/// - `sonnet` / `claude-sonnet-5-5`: "Sonnet 5.5 · Efficient for routine tasks"
///   (efficient)
/// - `haiku` / `claude-haiku-4-5-20251001`: "Haiku 4.5 · Fastest for quick
///   answers" (fast). On 2026-10-15 the Claude CLI 2.1.290 `initialize`
///   inventory (no model turn) listed value `haiku` with resolvedModel
///   `claude-haiku-4-5-20251001` and NO effort control: `supportsEffort` and
///   `supportedEffortLevels` absent. Its one fixed level is therefore effort
///   "none" (`claude -p --model haiku` with no `--effort` answered on that
///   model), and it is routable through the signed profile `cl_haiku45_none`.
///
/// A model with no tier is never chosen by tier routing. It stays usable only
/// when the owner explicitly names its model family (`RoutingIntent`). A
/// tier-less model is either KNOWN untiered (`knownUntiered`: an older
/// generation or a specialized model the provider describes without a general
/// tier) or UNCLASSIFIED (in neither table: typically a model the provider
/// released after this table was written). An unclassified model a catalog
/// offers makes the builder emit the informational exclusion
/// `unclassified_model` (K14): routing is unchanged (it stays isolated, the
/// old reference keeps running) and every model-backed delivery carries
/// `reference_review_required`. The owner clears it by adding the model to
/// `table` or `knownUntiered`.
public enum ModelTier: String, CaseIterable, Codable, Sendable {
    case frontier, workhorse, efficient, fast
}

public enum ModelTiers {
    /// Exact provider model names (every alias and observed resolved ID).
    public static let table: [String: ModelTier] = [
        "gpt-6-astra": .frontier,
        "gpt-6.1-sol": .workhorse,
        "gpt-6-luna": .fast,
        "claude-fable-5-1": .frontier, "fable": .frontier,
        "claude-opus-5-5": .workhorse, "opus": .workhorse,
        "claude-sonnet-5-5": .efficient, "sonnet": .efficient,
        "haiku": .fast, "claude-haiku-4-5-20251001": .fast,
    ]

    /// Signed models the provider describes WITHOUT a general tier (see the
    /// type comment): every previous generation and the specialized cyber
    /// model. Observed in Config/production.json execution profiles on
    /// 2026-10-24. Disjoint from `table`; nothing here is tier-routed.
    public static let knownUntiered: Set<String> = [
        "gpt-6-sol", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini",
        "gpt-5.3-codex-spark", "gpt-daybreak-blue-latest",
    ]

    /// K14: whether OS-1 knows this model at all. Same native suffix rule as
    /// `tier(of:)`; nothing else is guessed.
    public enum Classification: Equatable, Sendable {
        case tiered(ModelTier), knownUntiered, unclassified
    }

    /// The tier of an exact model name. A native context-window suffix
    /// ("claude-fable-5-1[1m]") names the same model; nothing else is guessed:
    /// an unknown, older or specialized model has no tier.
    public static func tier(of model: String) -> ModelTier? {
        if let exact = table[model] { return exact }
        guard let base = suffixBase(model) else { return nil }
        return table[base]
    }

    public static func classification(of model: String) -> Classification {
        if let tier = tier(of: model) { return .tiered(tier) }
        if knownUntiered.contains(model) || suffixBase(model).map(knownUntiered.contains) == true { return .knownUntiered }
        return .unclassified
    }

    /// "name[suffix]" -> "name"; nil for any other shape.
    private static func suffixBase(_ model: String) -> String? {
        guard model.hasSuffix("]"), let bracket = model.firstIndex(of: "["), bracket > model.startIndex else { return nil }
        return String(model[..<bracket])
    }

    /// Strongest first: frontier 0 ... fast 3; a model with no tier sorts last.
    public static func rank(_ model: String) -> Int {
        tier(of: model).flatMap { ModelTier.allCases.firstIndex(of: $0) } ?? ModelTier.allCases.count
    }
}
