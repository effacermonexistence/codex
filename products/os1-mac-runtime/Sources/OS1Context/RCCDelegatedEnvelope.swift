import Foundation

/// The one provider message `os1 rcc-execute` sends a delegated RCC child,
/// identical for every provider and surface (Codex, Claude Code, Claude chat).
///
/// Order is deliberate. The child's own work leads as a plain imperative; the
/// owner's whole request follows, labeled as background only; the internal
/// task/child/attempt ids come last, labeled as audit references. Build 380's
/// envelope led with the owner's full request and ended with a bare
/// "RCC task ...; child ...; attempt ..." line: a cheap Codex tier read those
/// ids as something to look up, found no tool for it and never answered
/// "1+1", which cost a frontier max-effort escalation.
///
/// The ids stay in the message for audit; no receipt or verifier reads them
/// back from it (receipts carry the ids as typed fields). The scope statement
/// and the bans on a competing orchestration and on a silent model/account
/// change are unchanged guarantees.
public enum RCCDelegatedEnvelope {
    public static let leadLabel = "Do this and answer directly:"
    public static let answerOnlyLine = "Reply with only the final result — no other text."
    public static let backgroundLabel = "Background context only — the owner's full request, given so you understand the work above. Do not act on any other part of it:"
    public static let guaranteeLine = "Do not spawn a competing orchestration or silently change model/account."
    public static let referenceLabel = "Internal reference ids for audit (not a task to look up; no tool is needed to use them):"

    /// JavaScript's `\s` (WhiteSpace and LineTerminator), spelled out: ICU's
    /// `\s` omits U+000B and U+FEFF, which JS includes.
    private static let space = #"[\t\n\u000B\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*"#
    private static let exactArithmetic: NSRegularExpression? = try? NSRegularExpression(pattern:
        #"\A"# + space + #"-?[0-9]{1,9}"# + space + #"\+"# + space + #"-?[0-9]{1,9}"# + space + #"\z"#)

    /// True exactly when the OpenClaw exact verifier (`arithmeticSum` in
    /// rcc-plugin.mjs, `/^\s*(-?\d{1,9})\s*\+\s*(-?\d{1,9})\s*$/u`) can
    /// check this instruction: two integers of at most nine ASCII digits
    /// joined by "+", with only JavaScript whitespace around them. A mirror
    /// of that predicate; it decides nothing about acceptance.
    public static func exactArithmeticInstruction(_ instruction: String) -> Bool {
        guard let regex = exactArithmetic else { return false }
        let range = NSRange(instruction.startIndex..<instruction.endIndex, in: instruction)
        return regex.firstMatch(in: instruction, range: range) != nil
    }

    /// The answer-only line is added for an explicit route test's child (a
    /// host-parsed route bound by surface and byte-identical instruction, the
    /// binding the verifier checks) whose instruction is in the verifier's
    /// arithmetic family. Its exact-output check then is not broken by
    /// chatter a provider's own hooks add; the verifier's rule is unchanged.
    public static func answerOnly(instruction: String, surface: RCCRuntimeContract.Surface,
                                  explicitRoutes: [RCCRuntimeContract.ExplicitRoute]?) -> Bool {
        guard let explicitRoutes,
              explicitRoutes.contains(where: { $0.surface == surface && $0.instruction == instruction }) else { return false }
        return exactArithmeticInstruction(instruction)
    }

    /// - instruction: this child's delegated work, verbatim.
    /// - ownerRequest: the owner's original objective, shown as background.
    /// - continuation: a full-access continuation's own imperative prompt; it
    ///   leads instead of the delegated work and background (as before), and
    ///   the answer-only line never applies to it.
    /// - sourceCompletion: the bound OS-1 source completion rules, verbatim.
    public static func prompt(instruction: String, ownerRequest: String, continuation: String? = nil,
                              answerOnly: Bool, scope: RCCRuntimeContract.Scope, sourceCompletion: String = "",
                              taskID: String, nodeID: String, attemptID: String) -> String {
        let lead: String
        if let continuation {
            lead = continuation
        } else {
            lead = leadLabel + "\n" + instruction + (answerOnly ? "\n\n" + answerOnlyLine : "") +
                "\n\n" + backgroundLabel + "\n" + ownerRequest
        }
        return lead + "\n\nScope: " + scope.rawValue + ". " + guaranteeLine + sourceCompletion +
            "\n\n" + referenceLabel + " RCC task " + taskID + "; child " + nodeID + "; attempt " + attemptID + "."
    }
}
