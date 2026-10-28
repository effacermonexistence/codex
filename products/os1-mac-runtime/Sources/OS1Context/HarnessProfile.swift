import Foundation

/// The versioned harness profile (routing architecture v2, §1.1 "H", K15):
/// what a model sees around the same signed tuple. The tuple (provider,
/// model, effort, permission) is the ticket's; the harness is everything
/// OS-1 wraps around it: the lean owner-policy projection, the automatic
/// chat lane, the order of the instruction channels, the delegated child's
/// envelope and launch shape.
///
/// H0 is the harness OS-1 shipped at K15, H1 the one of build 441; H2
/// (build 442) is the current one. None's quality parity with the providers'
/// own harness is measured (D4 arm ②), so all are marked `.unverified`; a
/// class certificate (K11) binds to a profile's id AND version
/// (`RCCClassMeasurement.harnessScope`, "H2@1"), never to "whatever OS-1 runs
/// today".
///
/// Any change a model can see (wording, order, a dropped line, a different
/// lane predicate) is an H change: it needs a NEW descriptor (new id or
/// version, parity unverified) and a re-pinned rendering, together. The os1
/// self-test (`harnessProfileSelfTest`) renders the current profile's
/// builders from fixed inputs and fails when that rendering's digest moves
/// without a bump.
/// Byte-stability fixes that change no model-visible content (sorting a set,
/// naming a constant) are N and keep the profile.
public enum HarnessProfile {
    public enum Parity: String, Sendable { case unverified, verified }

    public struct Descriptor: Equatable, Sendable {
        public let id: String
        public let version: Int
        public let parity: Parity
        /// What this profile fixes, by stable component name.
        public let components: [String]
        /// SHA-256 of the canonical rendering of the profile's builders on
        /// fixed inputs (paths normalised), pinned when the profile ships.
        public let renderingSHA256: String
    }

    /// The shipped harness, pinned at K15.
    /// - lean_projection_v1: Codex `model_instructions_file` = the projection
    ///   plus the projection note on a started thread; Claude with every
    ///   CLAUDE.md skipped plus the operating header (LeanBackendInstructions).
    /// - chat_lane_predicate_v1: claudeChatLane / codexChatLane /
    ///   claudeChatLaneRefusal, the host catalog chat gate, JS chatFirst.
    /// - instruction_order_v1: executor contract, owner policy, ticket lines,
    ///   then definitions, evidence, presentation, correction, bounded shell;
    ///   Claude's workspace context and confinement text last.
    /// - delegated_readonly_claude_hooks_off_empty_mcp_v1: a read-only RCC
    ///   child runs with hooks off and no MCP server.
    /// - delegated_envelope_v1: RCCDelegatedEnvelope.prompt (ids last).
    /// - managed_delegation_v1: native sub-agent tools denied (K13).
    public static let h0 = Descriptor(
        id: "H0",
        version: 1,
        parity: .unverified,
        components: [
            "lean_projection_v1",
            "chat_lane_predicate_v1",
            "instruction_order_v1",
            "delegated_readonly_claude_hooks_off_empty_mcp_v1",
            "delegated_envelope_v1",
            "managed_delegation_v1",
        ],
        renderingSHA256: "4ecd97ffe17a1185f8dc35aa780c6b4344df5dfec81d15d34242917e8cf24c8b")

    /// H1 (build 441, owner order 2026-10-27): H0 plus four changes to what
    /// the model sees or where a delegated child runs, parity unverified like
    /// H0 (no D4 measurement of either).
    /// H0's components are kept by name except the envelope, which moves to
    /// v2; the new components name what changed.
    /// - delegated_envelope_v2: RCCDelegatedEnvelope.prompt with
    ///   `silentRuleLine` right after the guarantee line (the build-440 test
    ///   invitation's reply restated the rules).
    /// - codex_developer_silent_line_v1: Codex's developer text opens with
    ///   the apply-silently line Claude's system text already carried.
    /// - rcc_status_checkin_card_v1: an RCC delegated child of a check-in the
    ///   card answers gets the install-state card as its workspace hint
    ///   (rccStatusCheckInHint), as the direct path does.
    /// - rcc_readonly_claude_home_isolation_v1: a fresh read-only Claude agent
    ///   child whose host workspace is HOME runs in the source-answer
    ///   workspace (rccIsolatesReadOnlyClaudeHome), as the native path does.
    public static let h1 = Descriptor(
        id: "H1",
        version: 1,
        parity: .unverified,
        components: [
            "lean_projection_v1",
            "chat_lane_predicate_v1",
            "instruction_order_v1",
            "delegated_readonly_claude_hooks_off_empty_mcp_v1",
            "delegated_envelope_v2",
            "managed_delegation_v1",
            "codex_developer_silent_line_v1",
            "rcc_status_checkin_card_v1",
            "rcc_readonly_claude_home_isolation_v1",
        ],
        renderingSHA256: "ec23c06b3de21d542c2998dd440523cd82d813ee40e0f322388e4aae481baf53")

    /// H2 (build 442, live failure 2026-10-28): H1 plus one model-visible
    /// line, parity unverified like H1. Every H1 component is kept by name.
    /// - asr_hint_answer_note_v1: when an owner speech-to-text hint matches
    ///   the owner's request, the delegated envelope carries one note line
    ///   after END BACKGROUND (`LocalClassifierHints.answerNote`), or after a
    ///   fresh-session quality correction's own prompt; absent otherwise, for
    ///   a resumed continuation and for an exact-answer child. Review of H2:
    ///   the local lane (rcc-plugin.mjs `asrAnswerNote`, a pinned mirror)
    ///   appends the same line to the local model's user message.
    public static let h2 = Descriptor(
        id: "H2",
        version: 1,
        parity: .unverified,
        components: [
            "lean_projection_v1",
            "chat_lane_predicate_v1",
            "instruction_order_v1",
            "delegated_readonly_claude_hooks_off_empty_mcp_v1",
            "delegated_envelope_v2",
            "managed_delegation_v1",
            "codex_developer_silent_line_v1",
            "rcc_status_checkin_card_v1",
            "rcc_readonly_claude_home_isolation_v1",
            "asr_hint_answer_note_v1",
        ],
        renderingSHA256: "37b32b0f5508340d4a0bea2aab509eb028edd0ab633fd9f1ce4ef23f3248ec87")

    /// The profile every dispatch runs under.
    public static let current = h2

    /// Append-only: every profile that ever shipped, with its pinned
    /// rendering. Re-pinning an existing entry is not a bump. H0's and H1's
    /// pins are the renderings they shipped with; today's builders render H2.
    public static let shipped: [Descriptor] = [h0, h1, h2]

    /// Prefix levers identified at K15 that change what the model sees, so
    /// they are H and NOT applied (H1 and H2 do not apply them either): shipping
    /// either needs a new descriptor (parity unverified) and a new pinned
    /// rendering. Recommended only after D4 arm ② has measured the current
    /// profile.
    /// - C4a_stable_first_reorder: put the stable operating header before the
    ///   per-objective presentation directive and the ticket's action line.
    /// - C4d_tool_free_read_original_line: drop the "Read the original at …"
    ///   pointer from the tool-free chat lane, which cannot read it.
    public static let pendingHItems = ["C4a_stable_first_reorder", "C4d_tool_free_read_original_line"]
}
