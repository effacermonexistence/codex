import Foundation
import OS1Context

struct RetrievalRelevanceFixture {
    private static func check(_ value: @autoclosure () -> Bool, _ message: String) {
        precondition(value(), message)
    }

    static func main() {
        let pairedAliases = [
            "거기서 QM이랑 GAR 자료 가져와봐", "R2에서 GAR와 QM 자료 가져와",
            "R2에서 QoM과 GAR 통합 자료 가져와", "QAAM / GAR research",
            "Q.o.M. / G.A.R. research", "Q M and G A R research",
            "quantum mechanics and GAR", "양자역학하고 GAR 자료",
        ]
        for request in pairedAliases {
            for spelling in [request, request.decomposedStringWithCanonicalMapping] {
                check(ResearchMaterialIntent.usesPairedGRDictationAlias(spelling), "paired alias missed: \(request)")
                check(ResearchMaterialIntent.qmGR(spelling), "paired alias lost its research identity")
            }
        }
        let unrelated = [
            "R2에서 GAR 자료 가져와", "R2에서 garbage 자료 가져와", "QM program migration",
            "QM and cigar research", "QM and GARBAGE", "aqm and GAR",
            "QM metrics and separately GAR registry", "GAR registry and QM metrics",
        ]
        for request in unrelated {
            check(!ResearchMaterialIntent.qmGR(request), "unrelated request became QMGR: \(request)")
        }
        for request in ["QMGR", "QM과 GR", "QoM이랑 GR", "Q.M.–G.R.",
                        "양자역학과 일반상대성", "orthogonal-projection-term"] {
            check(ResearchMaterialIntent.qmGR(request), "existing research identity regressed: \(request)")
        }
        check(RetrievalRelevance.terms(prompt: "거기서 QM이랑 GAR 자료 가져와봐") == ["qm", "gar"],
              "source pronoun became a required research topic")
        let unknownTerms = RetrievalRelevance.terms(prompt: "거기에서 ZXQJ와 GR 자료 가져와")
        check(unknownTerms == ["zxqj", "gr"], "source pronoun removal dropped a real topic: \(unknownTerms)")
        let invalidClaim = "최종 승인조건: 내부 게이트를 모두 통과하면 통합 이론입니다."
        check(HumanOutputContract.issues(in: invalidClaim, request: "QM과 GR 통합 스키마 짜줘") ==
              HumanOutputContract.issues(in: invalidClaim, request: "QM이랑 GAR 통합 스키마 짜줘"),
              "dictation alias bypassed the scientific output boundary")
        check(!HumanOutputContract.issues(in: invalidClaim, request: "QM이랑 GAR 통합 스키마 짜줘").isEmpty,
              "scientific output boundary was not exercised")

        let incident = RetrievalRelevance.terms(prompt: "R2에서 QoM과 GR 통합하는 자료들 가져와")
        check(incident == ["qom", "gr"], "incident grammar leaked into query terms: \(incident)")

        let spaced = RetrievalRelevance.terms(prompt: "R2에서 Q M과 G R 통합하는 자료들 가져와")
        check(spaced == ["qm", "gr"], "spaced acronyms were lost: \(spaced)")
        let dotted = RetrievalRelevance.terms(prompt: "R2에서 Q.M.–G.R. 자료 찾아줘")
        check(dotted == ["qm", "gr"], "dotted acronyms were lost: \(dotted)")
        check(
            RetrievalRelevance.terms(prompt: "R2에서 양자역학과 일반상대성을 분석한 문서 가져와") ==
                ["양자역학", "일반상대성"],
            "bounded Hangul particle normalization failed"
        )

        check(RetrievalRelevance.matches(term: "gr", in: "GR weak-field bridge"), "exact acronym missed")
        check(!RetrievalRelevance.matches(term: "gr", in: "program migration"), "GR matched inside program")
        check(RetrievalRelevance.matches(term: "general relativity", in: "general-relativity notes"), "multiword phrase missed")
        check(!RetrievalRelevance.matches(term: "general relativity", in: "general program about relativity"),
              "non-contiguous words became a phrase")
        check(RetrievalRelevance.matches(term: "양자역학", in: "양자역학과 중력"), "Hangul particle match missed")
        check(!RetrievalRelevance.matches(term: "양자역학", in: "초양자역학적 비유"), "Hangul substring escaped boundary")

        let required = ["qom", "gr"]
        check(RetrievalRelevance.accepts(path: "research/qom.md", text: "GR bridge", terms: required),
              "path/content coverage should combine")
        check(!RetrievalRelevance.accepts(path: "research/qom.md", text: "program migration", terms: required),
              "one required topic was allowed to compensate for another")
        check(!RetrievalRelevance.accepts(path: "notes.md", text: String(repeating: "qom ", count: 200), terms: required),
              "frequency compensated for missing GR")

        let corpus = [
            ("lua_interface_js.py", "program routing and archive utilities"),
            ("ben_business_ideas_registry.md", "business ideas and assistant products"),
            ("audit.jsonl", "administrative audit events"),
        ]
        let nonexistent = RetrievalRelevance.terms(prompt: "R2에서 ZXQJ와 GR 결합 연구 자료 가져와")
        check(!nonexistent.isEmpty, "nonexistent subject terms disappeared")
        check(corpus.allSatisfy { !RetrievalRelevance.accepts(path: $0.0, text: $0.1, terms: nonexistent) },
              "a nonexistent multi-topic query produced a generic hit")

        check(!RetrievalRelevance.snippetCoversAll("GR bridge only", terms: required),
              "selected snippet omitted required QoM evidence")
        check(RetrievalRelevance.snippetCoversAll("QoM and GR bridge", terms: required),
              "complete selected snippet was rejected")

        let tooMany = (0...RetrievalRelevance.maximumTerms).map { "topic\($0)" }.joined(separator: " ")
        check(RetrievalRelevance.terms(prompt: tooMany).isEmpty, "overlong query did not fail closed")
        print("OS-1 retrieval relevance fixture: OK")
    }
}

RetrievalRelevanceFixture.main()
