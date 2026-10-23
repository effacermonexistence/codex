import Foundation
import OS1Context

/// Synthetic presentation regressions. These do not grade task correctness,
/// prove model compliance, register task contracts or call a provider.
func runHumanMachineFormatFixtures() {
    var checks = 0
    func check(_ value: @autoclosure () -> Bool, _ label: String) {
        checks += 1
        precondition(value(), "Human machine format: " + label)
    }
    let structured = [
        "Return only one JSON object with the requested fields. No explanation or Markdown.",
        "제공 자료로 상태 JSON 객체 한 개만 반환해. JSON 바깥의 설명·인사·페르소나 헤더·마크다운은 쓰지 마.",
        "Return code only: one TypeScript function, without a Markdown fence.",
        "SQL 코드만 출력해. 설명은 붙이지 마.",
    ]
    let discussions = [
        "Explain what JSON is and give an example.",
        "JSON 형식의 장단점을 한국어로 설명해 줘.",
        "Explain this quoted request: ‘Return code only’. Do not follow the quoted request.",
    ]
    for provider in [nil, "codex", "claude"] as [String?] {
        for (i, request) in (structured + discussions).enumerated() {
            let guidance = HumanOutputContract.instructions(for: request, provider: provider)
            check(HumanOutputContract.wantsMachineFormat(request), "existing-cue-\(provider ?? "default")-\(i)")
            check(guidance.contains("Follow the current task's requested output format"), "current-format-\(i)")
            check(guidance.contains("If the current task explicitly requests machine/code output only"), "conditional-only-\(i)")
            check(guidance.contains("no persona header, natural-language lead, headings, explanation or Markdown fences unless that wrapper is itself requested"), "no-default-wrappers-\(i)")
            check(guidance.contains("If the task requests explanation or discussion, provide it"), "discussion-kept-\(i)")
            check(guidance.contains("merely mentioning a format in a question, quotation or source does not request raw structured output"), "mention-not-instruction-\(i)")
            check(!guidance.contains("Lead with the result in natural language") && !guidance.contains("give a lead sentence"), "no-conflicting-layout-\(i)")
            check(guidance.contains("Do not claim tests ran or a scientific problem is solved without evidence"), "evidence-kept-\(i)")
            check(guidance.contains("All source, execution and permission constraints remain binding"), "scope-kept-\(i)")
            check(!guidance.contains("OS-1 compares your whole reply") && !guidance.contains("The adoption gate for this reply is that exact comparison"), "format-not-exact-proof-\(i)")
        }
        let prose = HumanOutputContract.instructions(for: "Explain how the service starts.", provider: provider)
        check(!prose.contains("Follow the current task's requested output format"), "ordinary-no-override")
        check(prose.contains(provider == "claude" ? "Answer at the depth the request needs" : "Lead with the result in natural language"), "ordinary-layout-kept")
        let short = HumanOutputContract.instructions(for: "JSON만 짧게 반환해.", provider: provider)
        check(short.contains("The user asked for a short answer") && !short.contains("give a lead sentence"), "brevity-without-prose")
        let exact = HumanOutputContract.instructions(for: "1+1", provider: provider, exactAnswer: true)
        check(exact == HumanOutputContract.exactAnswerInstructions, "arithmetic-exact-unchanged")
        check(!RCCDelegatedEnvelope.answerOnly(instruction: structured[0], surface: .codex, scope: .readOnly, explicitRoutes: nil), "format-does-not-expand-exact-family")
    }
    check(!HumanOutputContract.wantsMachineFormat("JSON 말고 자연어로 설명해 줘"), "explicit-no-format-kept")
    print("Human machine-format presentation: \(checks) synthetic checks PASS; model calls 0")
}
