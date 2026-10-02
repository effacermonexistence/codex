import Foundation

/// The default RCC capacity mix: how much of each subscription OS-1 may use
/// when it routes automatically. A conversation starts with Codex 30 % and
/// Claude 100 % (the app default since 0.9.21, editable per conversation in
/// the composer's capacity menus). The private route core reads it as the
/// owner's provider choice: a clearly larger share names the provider that
/// automatic routing uses, and only that provider's measured failure moves
/// work off it; a closer mix prices each provider's quota (policy v54; v43
/// priced it, and v50-v53 let an evaluation record override it, so every
/// mix routed alike). The default favors Claude and keeps Codex for the work
/// the owner names it for or Claude measurably fails.
public enum CapacityMix {
    public static let defaultCodex = 30
    public static let defaultClaude = 100
}
