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
///    and the bound OS-1 source completion rules;
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
public enum RCCDelegatedEnvelope {
    public static let answerLeadLabel = "Do this and answer directly:"
    public static let taskLeadLabel = "Do this task:"
    public static let answerOnlyLine = "Reply with only the final result — no other text."
    public static let backgroundStart = "--- BACKGROUND: the owner's full request ---"
    public static let backgroundRule = "Do not perform its other parts; its constraints (language, format, length, prohibitions, scope) still apply to your part."
    public static let backgroundEnd = "--- END BACKGROUND ---"
    public static let guaranteeLine = "Do not spawn a competing orchestration or silently change model/account."
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
    /// - continuation: a full-access continuation's own imperative prompt; it
    ///   leads instead of the delegated work and background (as before), and
    ///   the answer-only line never applies to it.
    /// - answerOnly: `answerOnly(instruction:surface:scope:explicitRoutes:)`;
    ///   ignored unless the scope is read-only.
    /// - surface: the selected surface; a chat lane gets the direct lead.
    /// - sourceCompletion: the bound OS-1 source completion rules, verbatim.
    public static func prompt(instruction: String, ownerRequest: String, continuation: String? = nil,
                              answerOnly: Bool, surface: RCCRuntimeContract.Surface, scope: RCCRuntimeContract.Scope,
                              sourceCompletion: String = "", taskID: String, nodeID: String, attemptID: String) -> String {
        let rules = "Scope: " + scope.rawValue + ". " + guaranteeLine + sourceCompletion
        let references = referenceLabel + " RCC task " + taskID + "; child " + nodeID + "; attempt " + attemptID + "."
        if let continuation { return continuation + "\n\n" + rules + "\n\n" + references }
        let exact = answerOnly && scope == .readOnly
        let lead = directAnswer(answerOnly: exact, surface: surface, scope: scope) ? answerLeadLabel : taskLeadLabel
        return lead + "\n" + instruction + (exact ? "\n\n" + answerOnlyLine : "") +
            "\n\n" + rules +
            "\n\n" + backgroundStart + "\n" + backgroundRule + "\n" + ownerRequest + "\n" + backgroundEnd +
            "\n\n" + references
    }
}
