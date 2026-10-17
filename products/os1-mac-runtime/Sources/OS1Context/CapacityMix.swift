import Foundation

/// The default RCC capacity mix: how much of each subscription OS-1 may use
/// when it routes automatically. A conversation starts with Codex 30 % and
/// Claude 100 % (the app default since 0.9.21, editable per conversation in
/// the composer's capacity menus). The private route core prices each
/// provider's quota by this mix (policy v43), so the default favors Claude
/// and keeps Codex for the work it does clearly better.
public enum CapacityMix {
    public static let defaultCodex = 30
    public static let defaultClaude = 100
}
