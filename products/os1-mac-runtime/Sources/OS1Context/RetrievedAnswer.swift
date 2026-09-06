import Foundation

/// A display projection, not a replacement for source data or a model summary.
/// The caller must bind `output` to a verified local retrieval receipt first.
public struct RetrievedAnswer: Sendable {
    public let overview: String
    public let original: String
    public let technical: String

    public static func fromEvidence(output: String, sourcePaths: [String]) -> RetrievedAnswer? {
        guard output.hasPrefix("R2에서"), output.contains("자료를 검증해 회수했습니다."), !sourcePaths.isEmpty else { return nil }
        if sourcePaths.contains("docs/CONCEPTUAL_ORIGIN.md"), sourcePaths.contains("docs/OPERATOR.md"),
           sourcePaths.contains("docs/EQUATION_INSERTIONS.md"),
           let start = output.range(of: "### README.md") {
            return RetrievedAnswer(overview: """
            **Orthogonal Projection Term 원본과 QM·GR 연결 자료를 가져왔습니다.**

            이전의 v1 실험만이 아니라, 원래 연구 구조와 실제 벤치마크를 함께 연결했습니다.

            - **개념과 구조:** 관측되는 장과 제약 구조의 차이, Einstein–Rosen에서 가져온 기하학적 모티프
            - **연산자와 방정식:** 재분배 항과 Poisson·렌즈·Jeans·SPARC·X-COP 방정식에 넣는 위치
            - **실험 결과:** 개선된 잔차, 대조군 결과, 실패·중립 결과와 주장 가능한 범위
            - **별도 QMGR v1:** 고전 연산자 → 양자 채널 → 뉴턴 소스의 호환성 실험

            구조적 유사성이나 거시적 재분배가 물리적 양자 중첩·QM–GR 통합을 입증한 것은 아닙니다. 그 유도와 검증 여부는 원문별로 구분해 설명할 수 있습니다.

            \(sourcePaths.count)개 파일을 검증했습니다. 원문과 출처는 아래에서 확인할 수 있습니다.
            """, original: String(output[start.lowerBound...]),
                technical: String(output[..<start.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines))
        }
        // This is a versioned document projection, not a classifier for all
        // QMGR research. A changed contract falls back to a source list.
        if sourcePaths.contains("docs/QMGR_OBJECTIVE.md"),
           let start = output.range(of: "# QMGR objective v1"),
           output.contains("PASS_WEAK_FIELD_COMPATIBILITY"),
           output.contains("- full QM–GR claim: `false`"),
           output.contains("- 현재 단계: `FINITE_LATTICE_QM_TO_NEWTONIAN_WEAK_FIELD_COMPATIBILITY`"),
           output.contains("Finite-lattice quantum lift"), output.contains("Newtonian") {
            return RetrievedAnswer(overview: """
            **QM·GR 통합 연구 자료(v1)를 가져왔습니다.**

            이 자료는 양자역학과 일반상대성이론의 통합을 목표로 만든 초기 검증안입니다. 원문에 기록된 현재 성과는 **양자 채널의 위치 분포를 뉴턴 중력의 약한 장 계산에 연결하는 단계**까지입니다. 전체 QM·GR 통합이 검증됐다는 뜻은 아닙니다.

            자료에는 다음 내용이 들어 있습니다.

            - **연구 설명과 수식:** 양자 채널을 구성하고 기존 계산과 일치하는지 확인하는 방법
            - **검증 조건과 결과:** 어떤 조건을 통과했고 어디까지 주장할 수 있는지
            - **앞으로 풀어야 할 문제:** 시공간의 곡률·인과성·중력의 반작용 등을 포함한 미해결 조건

            검증에 사용된 파일은 \(sourcePaths.count)개입니다. 아래에서 연구 설명 원문과 출처·검증 정보를 열어볼 수 있습니다.
            """, original: String(output[start.lowerBound...]),
                technical: String(output[..<start.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines))
        }
        let paths = Array(Set(sourcePaths)).sorted()
        let titles = paths.prefix(8).map { path in
            let filename = URL(fileURLWithPath: path).lastPathComponent
            return "- " + filename.replacingOccurrences(of: "`", with: "").replacingOccurrences(of: "\n", with: " ")
        }.joined(separator: "\n")
        let start = output.range(of: "\n### ")?.lowerBound
        return RetrievedAnswer(overview: """
        **R2에서 관련 자료 \(paths.count)개를 가져왔습니다.**

        가져온 자료:

        \(titles)

        가져온 내용은 아래에서 열어볼 수 있습니다. 요약으로 원문을 대체하지 않고, 출처와 함께 보존했습니다.
        """, original: start.map { String(output[$0...]).trimmingCharacters(in: .whitespacesAndNewlines) } ?? output,
            technical: start.map { String(output[..<$0]).trimmingCharacters(in: .whitespacesAndNewlines) } ?? "원본 전달 기록은 전체 복사에서 확인할 수 있습니다.")
    }
}
