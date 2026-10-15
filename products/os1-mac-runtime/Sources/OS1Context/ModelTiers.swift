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
/// when the owner explicitly names its model family (`RoutingIntent`).
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

    /// The tier of an exact model name. A native context-window suffix
    /// ("claude-fable-5-1[1m]") names the same model; nothing else is guessed:
    /// an unknown, older or specialized model has no tier.
    public static func tier(of model: String) -> ModelTier? {
        if let exact = table[model] { return exact }
        guard model.hasSuffix("]"), let bracket = model.firstIndex(of: "["), bracket > model.startIndex else { return nil }
        return table[String(model[..<bracket])]
    }

    /// Strongest first: frontier 0 ... fast 3; a model with no tier sorts last.
    public static func rank(_ model: String) -> Int {
        tier(of: model).flatMap { ModelTier.allCases.firstIndex(of: $0) } ?? ModelTier.allCases.count
    }
}
