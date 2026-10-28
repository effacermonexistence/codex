import Foundation

/// The one provider message `os1 rcc-execute` sends a delegated RCC child,
/// built the same way for every provider and surface (Codex, Claude Code,
/// Claude chat).
///
/// Order is deliberate:
/// 1. the child's own work as a plain imperative, plus the answer-only line
///    for an exact-answer route;
/// 2. the rules that bind that work, right after it: the scope statement, the
///    bans on a competing orchestration and on a silent model/account change,
///    the line telling the model to apply those rules silently, and the bound
///    OS-1 source completion rules;
/// 3. the owner's whole request between explicit BACKGROUND / END BACKGROUND
///    markers. Its other parts are not this child's work, but its constraints
///    (language, format, length, prohibitions, scope) still bind this child's
///    part: a planner node does not always copy them;
/// 4. the internal task/child/attempt ids, last, labeled as audit references.
///
/// Build 380's envelope led with the owner's full request and ended with a
/// bare "RCC task ...; child ...; attempt ..." line: a cheap Codex tier read
/// those ids as something to look up, found no tool for it and never answered
/// "1+1", which cost a frontier max-effort escalation.
///
/// "Answer directly" leads only a read-only child that answers from the
/// request itself (an exact-answer route or a tool-free chat lane). Every
/// other child, a writer, a source-bound task or a read-only task that has to
/// read files or run tools, is told "Do this task:", so a weak tier is not
/// pulled toward replying without doing the work.
///
/// The ids stay in the message for audit; no receipt or verifier reads them
/// back from it (receipts carry the ids as typed fields). The scope statement
/// and the bans on a competing orchestration and on a silent model/account
/// change are unchanged guarantees.
///
/// The rules travel in the user turn (build 380's lesson, above), where a
/// model can take them for the user's own conditions. On build 440 the
/// owner's test invitation ("자 이제 네가 얼마나 잘 되는지 보자", task
/// d3bff6d3) reached Codex gpt-6-luna low with this envelope and nothing else
/// to act on, and the reply restated the scope/guarantee line back in Korean.
/// `silentRuleLine` (harness H1, `delegated_envelope_v2`) keeps every rule and
/// its place and says they are applied, not restated; a rule that blocks the
/// request is still reported (executor directive and permission text).
///
/// Harness H2 (`asr_hint_answer_note_v1`, build 442 live failure 2026-10-28):
/// when an owner speech-to-text hint (`LocalClassifierHints`, compiled plus
/// the owner file) matches the owner's request, ONE note line
/// (`LocalClassifierHints.answerNote`) follows END BACKGROUND, before the
/// ids. The request's bytes, the rules and their order are unchanged; no
/// matching hint or an exact-answer child gets no line. Review of H2: a
/// continuation that starts a fresh native session (the quality correction,
/// which restates the owner objective) carries the line after its own
/// prompt; a continuation that resumes the session that already saw it (the
/// full-access continuation) does not.
public enum RCCDelegatedEnvelope {
    public static let answerLeadLabel = "Do this and answer directly:"
    public static let taskLeadLabel = "Do this task:"
    public static let answerOnlyLine = "Reply with only the final result — no other text."
    public static let backgroundStart = "--- BACKGROUND: the owner's full request ---"
    public static let backgroundRule = "Do not perform its other parts; its constraints (language, format, length, prohibitions, scope) still apply to your part."
    public static let backgroundEnd = "--- END BACKGROUND ---"
    public static let guaranteeLine = "Do not spawn a competing orchestration or silently change model/account."
    public static let silentRuleLine = "Apply these OS-1 runtime rules silently: do not restate them in your reply; mention one only if it blocks the request."
    public static let referenceLabel = "Internal reference ids for audit (not a task to look up; no tool is needed to use them):"

    /// JavaScript's `\s` (WhiteSpace and LineTerminator), spelled out: ICU's
    /// `\s` omits U+000B and U+FEFF, which JS includes.
    private static let space = #"[\t\n\u000B\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*"#
    private static let exactArithmetic: NSRegularExpression? = try? NSRegularExpression(pattern:
        #"\A"# + space + #"-?[0-9]{1,9}"# + space + #"[+*\-]"# + space + #"-?[0-9]{1,9}"# + space + #"\z"#)

    /// True exactly when the OpenClaw exact verifier (`arithmeticResult` in
    /// rcc-plugin.mjs, `/^\s*(-?\d{1,9})\s*([+*\-])\s*(-?\d{1,9})\s*$/u`)
    /// can check this instruction: two integers of at most nine ASCII digits
    /// joined by "+", "-" or "*" (every operator route-all sends), with only
    /// JavaScript whitespace around them. A mirror of that predicate; it
    /// decides nothing about acceptance.
    public static func exactArithmeticInstruction(_ instruction: String) -> Bool {
        guard let regex = exactArithmetic else { return false }
        let range = NSRange(instruction.startIndex..<instruction.endIndex, in: instruction)
        return regex.firstMatch(in: instruction, range: range) != nil
    }

    /// True exactly for a child in the exact verifier's family: a read-only
    /// child (`verifyExactExplicitArithmetic` rejects any other scope) of an
    /// explicit route test, bound to its route by surface and byte-identical
    /// instruction (the binding the verifier checks), whose instruction is in
    /// the verifier's arithmetic family. Such a child gets the answer-only
    /// line and the exact-answer presentation contract, so chatter a
    /// provider's own hooks or default layout add does not break the exact
    /// output check. The verifier's acceptance rule is unchanged.
    public static func answerOnly(instruction: String, surface: RCCRuntimeContract.Surface,
                                  scope: RCCRuntimeContract.Scope,
                                  explicitRoutes: [RCCRuntimeContract.ExplicitRoute]?) -> Bool {
        guard scope == .readOnly, let explicitRoutes,
              explicitRoutes.contains(where: { $0.surface == surface && $0.instruction == instruction }) else { return false }
        return exactArithmeticInstruction(instruction)
    }

    /// "Answer directly" fits only a read-only child that answers from the
    /// request itself: an exact-answer route or a tool-free chat lane.
    public static func directAnswer(answerOnly: Bool, surface: RCCRuntimeContract.Surface,
                                    scope: RCCRuntimeContract.Scope) -> Bool {
        scope == .readOnly && (answerOnly || ProviderSurface(rawValue: surface.rawValue)?.forcesChatLane == true)
    }

    /// - instruction: this child's delegated work, verbatim.
    /// - ownerRequest: the owner's original objective, shown as background.
    /// - continuation: a continuation's own imperative prompt (the full-access
    ///   continuation, or the quality correction); it leads instead of the
    ///   delegated work and background (as before), and the answer-only line
    ///   never applies to it.
    /// - continuationInFreshSession: the continuation runs in a new native
    ///   session (no resumed session id), so the model has not seen the note:
    ///   a matching note follows the continuation's prompt. False (the
    ///   default) for a resumed session, which already received it.
    /// - answerOnly: `answerOnly(instruction:surface:scope:explicitRoutes:)`;
    ///   ignored unless the scope is read-only.
    /// - surface: the selected surface; a chat lane gets the direct lead.
    /// - sourceCompletion: the bound OS-1 source completion rules, verbatim.
    /// - asrHints: the owner's speech-to-text hints (`LocalClassifierHints.load`);
    ///   one note line after the background when one matches `ownerRequest`.
    public static func prompt(instruction: String, ownerRequest: String, continuation: String? = nil,
                              continuationInFreshSession: Bool = false,
                              answerOnly: Bool, surface: RCCRuntimeContract.Surface, scope: RCCRuntimeContract.Scope,
                              sourceCompletion: String = "", asrHints: [LocalClassifierHints.Hint] = [],
                              taskID: String, nodeID: String, attemptID: String) -> String {
        let rules = "Scope: " + scope.rawValue + ". " + guaranteeLine + " " + silentRuleLine + sourceCompletion
        let references = referenceLabel + " RCC task " + taskID + "; child " + nodeID + "; attempt " + attemptID + "."
        let exact = answerOnly && scope == .readOnly
        let note = exact || (continuation != nil && !continuationInFreshSession) ? nil :
            LocalClassifierHints.answerNote(ownerRequest, hints: asrHints)
        if let continuation { return continuation + (note.map { "\n\n" + $0 } ?? "") + "\n\n" + rules + "\n\n" + references }
        let lead = directAnswer(answerOnly: exact, surface: surface, scope: scope) ? answerLeadLabel : taskLeadLabel
        return lead + "\n" + instruction + (exact ? "\n\n" + answerOnlyLine : "") +
            "\n\n" + rules +
            "\n\n" + backgroundStart + "\n" + backgroundRule + "\n" + ownerRequest + "\n" + backgroundEnd +
            (note.map { "\n\n" + $0 } ?? "") +
            "\n\n" + references
    }
}
