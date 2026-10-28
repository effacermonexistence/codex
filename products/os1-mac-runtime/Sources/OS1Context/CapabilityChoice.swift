import Foundation

/// Build 442, DESIGN-4 (lead decision 2026-10-28): which capability rows the
/// catalog offers a request, robust to a misread domain.
///
/// The local 9B model misread the domain on 6 of 30 deep requests (442 run).
/// A row that qualifies in one category only (Sonnet 5.5 @max for math, Opus
/// 5.5 @medium for coding) is unsafe under such a misread. So, with Q(row) the
/// categories a row qualifies in:
///
/// - BROAD rows qualify in every non-writing category (knowledge, science,
///   math, coding, tool use; `ModelCapabilityTable.broad`). They are safe under
///   any non-writing misread and bind on the domain reading alone.
/// - NARROW rows (a domain's other rows) bind only when the domain is
///   CORROBORATED: (a) a deterministic marker of that domain is in the request
///   (`markers`, small reviewed lists) or (b) the request is deep coding work
///   with a code-material rail (a code block, programming words, material,
///   a named path). Otherwise the broad rows.
/// - WRITING rows bind only for a write task, or a request whose product is a
///   document (`documentPattern`), with the writing reading; any other writing
///   reading takes the broad rows, under the `broad` category (a broad row is
///   not qualified for writing, so its basis never claims it).
/// - An UNKNOWN domain (a keyword profile, a `general` reading, or a model not
///   qualified to read the domain, DESIGN-4 §4): an explanation or chat is not
///   a writing deliverable, so it takes the broad rows; a design, write or
///   other task keeps the reference (no routes). A keyword profile offers them
///   only to a standard answer (its deep work keeps the reference, DESIGN-3).
///
/// Markers are evidence for a reading, never a reading: they never name a
/// domain the local model did not read and never route on their own.
/// Deterministic for the same profile, request and table; host facts only.
public enum CapabilityChoice {
    struct Marker: Sendable {
        let id: String
        let pattern: String
    }
    /// Korean forms as regular expressions over the lower-cased request,
    /// ASCII words as whole words (`(?<![a-z0-9])…(?![a-z0-9])`).
    static func word(_ alternatives: String) -> String { #"(?<![a-z0-9])(?:"# + alternatives + #")(?![a-z0-9])"# }
    /// Small, reviewed marker lists per non-writing domain (DESIGN-4 §2 (a)).
    /// Only a domain whose list in the table has a narrow row needs them today
    /// (math and coding); the others are listed so a recompiled table with a
    /// narrow row there needs no code change.
    static let markers: [RequestProfile.Domain: [Marker]] = [
        .math: [
            .init(id: "math_proof", pattern: #"증명(?!서|사진)|"# + word("prove|proves|proving|proof|proofs")),
            .init(id: "math_theorem", pattern: #"정리(?!\s*(?:해|하|했|할|함|좀|된|되|돼|한|를\s*(?:좀\s*)?(?:해|하)|부탁|정돈|요약))|"# +
                word("theorem|theorems|lemma|corollary")),
            .init(id: "math_calculus", pattern: #"적분|미분|도함수|극한값|"# + word("integral|integrals|derivative|derivatives|calculus|differentiate")),
            .init(id: "math_equation", pattern: #"방정식\s*(?:을|를)?\s*(?:좀\s*)?풀|"# +
                #"(?<![a-z0-9])solve\s+(?:the\s+|this\s+|an?\s+)?(?:equation|equations|system\s+of\s+equations)(?![a-z0-9])"#),
            .init(id: "math_probability", pattern: #"확률\s*(?:을|를)?\s*(?:좀\s*)?(?:계산|구해|구하|구할)|"# + word("probability")),
            .init(id: "math_linear_algebra", pattern: #"고유값|고유벡터|행렬식|"# + word("eigenvalue|eigenvalues|eigenvector|eigenvectors|determinant")),
        ],
        .coding: [
            .init(id: "coding_code", pattern: #"코드|코딩|"# + word("code|coding|source code")),
            .init(id: "coding_function", pattern: #"함수|메서드|메소드|"# + word("function|functions|method|methods")),
            .init(id: "coding_bug", pattern: #"버그|디버그|디버깅|"# + word("bug|bugs|debug|debugging")),
            .init(id: "coding_refactor", pattern: #"리팩터|리팩토링|"# + word("refactor|refactoring")),
            .init(id: "coding_implement", pattern: #"구현|"# + word("implement|implementation")),
            .init(id: "coding_algorithm", pattern: #"알고리즘|자료구조|"# + word("algorithm|algorithms|data structure")),
            .init(id: "coding_language", pattern: #"파이썬|자바스크립트|타입스크립트|러스트|스위프트|코틀린|고랭|"# +
                word("python|javascript|typescript|rust|golang|kotlin|sql|c\\+\\+")),
            .init(id: "coding_compile", pattern: #"컴파일|"# + word("compile|compiler|compiles")),
        ],
        .science: [
            .init(id: "science_physics", pattern: #"물리|양자|상대성|역학|전자기|열역학|슈뢰딩거|뉴턴|"# +
                word("physics|quantum|relativity|thermodynamics|schrodinger|schrödinger|newton")),
            .init(id: "science_chemistry", pattern: #"화학|분자|원자|화합물|"# + word("chemistry|molecule|molecules|atom|atoms")),
            .init(id: "science_biology", pattern: #"생물|세포|유전|진화|단백질|"# + word("biology|cell|cells|gene|genes|evolution|protein")),
        ],
        .knowledge: [
            .init(id: "knowledge_history", pattern: #"역사|전쟁|왕조|제국|"# + word("history|war|empire")),
            .init(id: "knowledge_health", pattern: #"건강|영양|비타민|질병|"# + word("health|nutrition|vitamin|disease")),
            .init(id: "knowledge_language", pattern: #"문법|어원|맞춤법|"# + word("grammar|etymology")),
        ],
        .toolUse: [
            .init(id: "tool_use_web", pattern: #"웹에서|인터넷에서|검색해서|"# + word("browse|web search")),
            .init(id: "tool_use_automation", pattern: #"자동화|매크로|"# + word("automate|automation|macro")),
        ],
    ]
    /// A document or deliverable asked for as the product (DESIGN-4 §2
    /// "Writing"): an essay, report, letter, e-mail, article, speech, proposal,
    /// copy, script and the like, AND a composing verb (write, draft, compose,
    /// make): "에세이 써줘" asks for one, "에세이 구조를 설명해줘" does not.
    static let documentPattern = #"에세이|보고서|리포트|레포트|이메일|메일|편지|자소서|자기소개서|논문|칼럼|연설문|제안서|기획서|문서|공지문|보도자료|기사|블로그\s*글|소개글|카피|원고|대본|시나리오|소설|"# +
        word("essay|essays|report|letter|email|e-mail|article|speech|proposal|document|memo|blog post|press release|cover letter|script|copy|story")
    static let composingPattern = #"써\s*(?:줘|봐|주세요|줄래|라)|쓰(?:고|자|기)|작성|초안|작문|만들어|짜\s*(?:줘|봐)|"# +
        word("write|draft|compose|create|prepare|produce")
    /// Keyword signals that are code material: (b) for deep coding work.
    static let codeMaterialSignals: Set<String> = ["code_block", "machine_material", "material", "named_path"]

    /// The first marker of `domain` the request carries, or nil.
    public static func marker(_ domain: RequestProfile.Domain, in request: String) -> String? {
        let lower = request.precomposedStringWithCanonicalMapping.lowercased()
        return markers[domain]?.first { lower.range(of: $0.pattern, options: .regularExpression) != nil }?.id
    }
    /// Whether the request asks for a document or deliverable as its product.
    public static func asksForDocument(_ request: String) -> Bool {
        let lower = request.precomposedStringWithCanonicalMapping.lowercased()
        return lower.range(of: documentPattern, options: .regularExpression) != nil &&
            lower.range(of: composingPattern, options: .regularExpression) != nil
    }
    /// DESIGN-4 §2: the corroboration of a narrow row's domain, or nil.
    public static func corroboration(_ domain: RequestProfile.Domain, profile: RequestProfile, request: String) -> String? {
        if let id = marker(domain, in: request) { return id }
        let deep = profile.difficulty == .deep || profile.taskType == .design || profile.taskType == .write
        if domain == .coding && deep && !codeMaterialSignals.isDisjoint(with: profile.signals) { return "coding_code_material" }
        return nil
    }

    /// The capability routes the catalog carries for this profile and
    /// request, or nil (the reference binds). `priceBasis`: the table's price
    /// table with the active and the compiled one (DESIGN-4 §8).
    public static func routes(profile: RequestProfile, request: String, table: ModelCapabilityTable,
                              priceBasis: RCCRuntimeContract.CapabilityRoutes.PriceBasis) -> RCCRuntimeContract.CapabilityRoutes? {
        guard let task = profile.taskType, profile.classifier != nil, profile.answerKind != .work else { return nil }
        let broad = table.broadRows, references = table.references
        func make(_ category: String, _ choice: RCCRuntimeContract.CapabilityRoutes.Choice, _ marker: String?,
                  _ pools: [String: [RCCRuntimeContract.CapabilityRoutes.Entry]]) -> RCCRuntimeContract.CapabilityRoutes? {
            let routes = RCCRuntimeContract.CapabilityRoutes(tableSHA256: ModelCapabilityTable.compiledSHA256, category: category,
                                                           choice: choice, marker: marker, pools: pools, broad: broad,
                                                           references: references, priceBasis: priceBasis)
            return routes.valid ? routes : nil
        }
        guard let domain = profile.domain else {
            // Unknown domain: an explanation or chat takes the broad rows.
            guard task == .explain || task == .chat else { return nil }
            guard profile.locallyClassified || profile.difficulty == .standard else { return nil }
            return make(RCCRuntimeContract.CapabilityRoutes.broadCategory, .broad, nil, broad)
        }
        if domain == .writing {
            if task == .write || asksForDocument(request) { return make(domain.rawValue, .writingDeliverable, nil, table.rows(for: .writing)) }
            // Not a deliverable: the broad rows, under the `broad` category (a
            // broad row is not qualified for writing, so the basis never says so).
            return make(RCCRuntimeContract.CapabilityRoutes.broadCategory, .broad, nil, broad)
        }
        let rows = table.rows(for: domain)
        let narrow = rows.contains { pool, entries in entries.contains { !(broad[pool] ?? []).contains($0) } }
        if narrow, let id = corroboration(domain, profile: profile, request: request) {
            return make(domain.rawValue, .narrowCorroborated, id, rows)
        }
        return make(domain.rawValue, .broad, nil, broad)
    }
}
