import Foundation

/// Users paste OS-1's own answers back into a new conversation. Those lines
/// are quoted data: intent classifiers must not read "복구 기준점(Gold 포인터)"
/// or "작업 준비가 됐습니다" as the user's request. Only whole lines that carry
/// an OS-1 output marker are dropped; the user's own sentences stay verbatim.
public enum OS1SelfOutput {
    static let lineMarkers: [String] = [
        "작업 준비가 됐습니다", "준비된 자료", "작업 폴더:", "현재 버전:", "기준 버전 (세 가지를 구분합니다)",
        "복구 기준점(gold 포인터)", "기록된 운영 릴리스", "운영 서버 실제 상태", "확정된 결정:", "다음 단계:", "하지 않은 것:",
        "os-1 error:", "실행 기록 확인됨", "실행 기록 미확인", "세부 정보 보기", "세부 정보 접기",
        "native record", "revas adopted", "백엔드 실행 기록의 확인 여부입니다",
        // Connection-control receipts and provenance notes OS-1 itself prints.
        "claude 연결됨", "github 연결됨", "r2 연결됨", "os-1 외부 작업", "이 대화에 흡수했습니다",
    ]
    static let labelLines: Set<String> = ["os-1", "os1", "claude", "codex", "◇"]

    public static func stripQuoted(_ text: String) -> String {
        text.split(separator: "\n", omittingEmptySubsequences: false).filter { line in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            let lowered = trimmed.precomposedStringWithCanonicalMapping.lowercased()
            if labelLines.contains(lowered) { return false }
            return !lineMarkers.contains { lowered.contains($0) }
        }.joined(separator: "\n")
    }
}
