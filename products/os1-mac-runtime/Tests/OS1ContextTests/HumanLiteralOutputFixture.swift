import Foundation
import OS1Context

/// Presentation-only regressions; no source correctness or new model call.
func runHumanLiteralOutputFixtures() {
    var checks = 0
    func check(_ value: @autoclosure () -> Bool, _ id: String) {
        checks += 1
        precondition(value(), "Human literal output: " + id)
    }
    let literal = "TRACE_REF=3c514a7d-6b21-4ffd-b8e6-2f04dbce0173"
    let requests = [
        "실제 파일을 읽고, 파일에 있는 한 줄만 그대로 답하세요. 파일 수정·다른 파일 검색·웹 조회·빌드·재시도는 하지 마세요. 파일: /tmp/public/probe.txt",
        "로그의 마지막 줄만 그대로 출력해. 파일은 수정하지 마.",
        "파일의 한 줄만 그대로 답하세요. 한국어로 설명하지 마세요.",
        "파일 \"public.txt\"의 한 줄만 그대로 답하세요.",
        "응답에 있는 값만 그대로 반환하세요.",
        "파일의 문구만 그대로 보여줘.",
        "텍스트의 첫 줄만 그대로 적어주세요.",
        "Return only the exact line from the file unchanged.",
    ]
    for (i, request) in requests.enumerated() {
        check(HumanOutputContract.preservesOriginalValues(request), "copy-meaning-\(i)")
        for provider in [nil, "codex", "claude"] as [String?] {
            let guidance = HumanOutputContract.instructions(for: request, provider: provider)
            check(guidance.contains("source-copy-only reply") && !guidance.contains("Lead with"), "copy-guidance-\(i)-\(provider ?? "default")")
            check(guidance.contains("not proof of source access"), "copy-not-verification-\(i)-\(provider ?? "default")")
        }
        check(HumanOutputContract.issues(in: literal, request: request).isEmpty, "assignment-copy-\(i)")
        check(HumanOutputContract.issues(in: "Service unavailable", request: request).isEmpty, "English-source-is-data-\(i)")
    }
    let explanations = [
        "이 로그의 오류 원인을 한국어로 설명해 주세요.",
        "파일에 있는 한 줄만 그대로 답하세요. 그리고 결과를 설명해 주세요.",
        "파일의 문구만 그대로 보여줘. 해설도 추가해.",
        "파일에 있는 한 줄만 그대로 답하세요. 그대로 말고 한국어로 설명해.",
        "파일의 내용만 그대로 답하지 마세요. 이유를 설명해 주세요.",
        "파일의 문구만 그대로 보여줘. 한국어로 답하세요.",
        "예시: \"파일에 있는 한 줄만 그대로 답하세요.\" 이 문장이 무슨 뜻인지 설명해 주세요.",
        "예시: \"파일의 한 줄만 그대로 답하세요.\" 이 문장의 뜻을 알려줘.",
        "예시: `파일의 한 줄만 그대로 답하세요.` 이 문장의 뜻을 알려줘.",
        "다음 문구를 한국어로 설명해 주세요: Return only the exact line from the file unchanged.",
        "Do not return only the line unchanged. 내용을 설명해 주세요.",
    ]
    for (i, request) in explanations.enumerated() {
        check(!HumanOutputContract.preservesOriginalValues(request), "not-copy-meaning-\(i)")
        check(!HumanOutputContract.instructions(for: request).contains("source-copy-only reply"), "not-copy-guidance-\(i)")
        // English-specific translation requests intentionally choose their own
        // language in the existing contract, so use the Korean controls here.
        if HumanOutputContract.wantsKorean(request) {
            check(!HumanOutputContract.issues(in: "The service is unavailable.", request: request).isEmpty, "Korean-prose-kept-\(i)")
            check(HumanOutputContract.issues(in: "서비스를 사용할 수 없습니다.", request: request).isEmpty, "Korean-prose-valid-\(i)")
        }
    }
    let keyExplanation = "TRACE_REF 오류를 한국어로 설명해"
    check(!HumanOutputContract.preservesOriginalValues(keyExplanation), "key-mention-is-not-copy")
    check(!HumanOutputContract.issues(in: "TRACE_REF=abc", request: keyExplanation).isEmpty, "key-mention-does-not-exempt-explanation")
    check(HumanOutputContract.issues(in: "TRACE_REF 값의 형식에 오류가 있습니다.", request: keyExplanation).isEmpty, "key-explanation-Korean-valid")
    check(HumanOutputContract.instructions(for: requests[0], exactAnswer: true) == HumanOutputContract.exactAnswerInstructions, "exact-comparison-priority")
    // Existing numeric, names, ordinary prose, JSON syntax and preserved-source
    // presentation paths remain unchanged.
    check(HumanOutputContract.issues(in: "CFBundleVersion: 405", request: "CFBundleVersion 값을 알려줘").isEmpty, "numeric-field-legacy")
    check(HumanOutputContract.issues(in: "main", request: "현재 브랜치 이름만 알려줘").isEmpty, "identifier-legacy")
    check(!HumanOutputContract.issues(in: "The answer is six.", request: "곱셈 결과를 한국어로 설명해 줘").isEmpty, "prose-legacy")
    check(!HumanOutputContract.issues(in: "```json\n{ broken }\n```", request: "JSON으로 답해 줘").isEmpty, "JSON-validation-legacy")
    check(HumanOutputContract.issues(in: "```json\n{ broken }\n```", request: "원문 그대로 보여줘").isEmpty, "raw-source-legacy")
    print("Human literal output fixtures passed (\(checks) checks)")
}
