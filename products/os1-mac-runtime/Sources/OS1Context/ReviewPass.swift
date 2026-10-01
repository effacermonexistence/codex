import Foundation

/// A second model checks a finished code explanation against the source and
/// returns the corrected answer.
///
/// Measured 2026-10-01 (blind pairwise judging, Codex and Claude judge
/// families, both orders): on deep code-flow questions ("…어떤 순서로 도는지,
/// 어디서 막힐 수 있는지 코드 기준으로 설명해봐") OS-1's single answer lost to
/// Claude Code Opus 5.5 max, whose reference run traced recovery paths for
/// 30-68 turns. Claude Opus 5.5 max reviewing OS-1's Codex draft against the
/// code beat both references on both such tasks (dev R3: +0.75 / +1.0;
/// held-out H6: +1.0 / +1.0) and stayed below the references' cost on the
/// held-out task. Short answers and questions that are not about code keep a
/// single execution: there the single answer already held both references.
public enum ReviewPass {
    public static func applies(request: String) -> Bool {
        guard TaskContext.ObjectiveKind.classify(request) == .explain,
              !HumanOutputContract.wantsBrevity(request) else { return false }
        let text = request.precomposedStringWithCanonicalMapping.lowercased()
        // Code itself, not words that merely contain a code word: "파동함수"
        // (wave function) is physics, "certify 함수" is code.
        if ["코드", "소스코드", "소스 코드", "구현"].contains(where: text.contains) { return true }
        if text.range(of: #"[a-z_][a-z0-9_.]*(?:\(\))?\s*함수"#, options: .regularExpression) != nil { return true }
        if text.range(of: #"\b(?:source code|code|codebase|implementation)\b"#, options: .regularExpression) != nil { return true }
        // A source path or file: products/os1-mac-runtime/Sources/OS1/main.swift, worker.py.
        return text.range(of: #"[a-z0-9_.\-]+/[a-z0-9_.\-/]+\.[a-z]{1,5}\b|\b[a-z0-9_\-]+\.(?:swift|py|ts|tsx|js|mjs|go|rs|java|kt|rb|php|cs|cpp|cc|c|h|m|mm|sh)\b"#,
                          options: .regularExpression) != nil
    }

    public static func prompt(request: String, draft: String) -> String {
        """
        아래는 사용자의 요청과, 그 요청에 대해 이미 작성된 초안 답변이다. 작업 디렉터리의 실제 코드를 직접 읽어서 초안을 검증하라.
        1. 코드와 맞지 않는 주장은 코드 기준으로 고친다.
        2. 요청이 묻는 흐름에서 빠진 분기, 복구 경로, 함정이 있으면 추가한다.
        3. 직접 확인하지 못한 주장은 단정하지 않는다. 요청 범위 밖의 내용은 넣지 않는다.
        4. 길이는 초안과 비슷하게 유지하고, 사용자가 길이를 지정했다면 그 지정을 지킨다.
        출력은 사용자에게 그대로 보낼 최종 답변 하나뿐이다. 검토 과정, 수정 내역, 초안과의 비교는 쓰지 않는다. 파일은 수정하지 않는다.

        [사용자 요청]
        <<<
        \(request)
        >>>

        [초안 답변]
        <<<
        \(draft)
        >>>
        """
    }
}
