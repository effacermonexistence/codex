import Foundation

/// Build 441 (owner order, 2026-10-27): what the owner's request needs, read
/// deterministically from the request text and host facts only. No model
/// output enters it (R0): the same text and facts always give the same
/// profile. It is a routing fact for Core's graded admission
/// (`admittedRoute`, `host_profile`), never a quality claim and never a
/// certificate: a graded route stays "predicted route, quality unverified".
///
/// Three separate axes plus the evidence tokens that set them:
///
/// - `answer_kind`: `answer_only` when the request asks for an answer (a
///   communicative stem such as 설명/뭐야/차이/왜/explain/what is, or a
///   conversational question) and nothing else: no write scope, no shell
///   need, no named path, image, source or material, no machine-material,
///   project or external-system term, no external-action order and no
///   failure complaint. `work` for an edit, a run, an external action or a
///   write order. `unknown` for everything else, including a bare pro-verb
///   with no content stem ("그럼 실제로 해봐" is work) and a text operation
///   (quality-bearing text generation keeps its own class).
/// - `tool_need`: `write`, `shell`, `workspace` (machine material, a deictic
///   reference to earlier artifacts or the workspace, a status check-in),
///   `current_facts` (latest, today, prices, news, search), else `none`.
/// - `difficulty`, from the shape of the task only, never its topic
///   ("science" or "Python" alone never raises it): `deep` for a proof,
///   derivation, design, debugging, optimization or review marker, a request
///   over 280 characters, three or more parts, a list or a code block;
///   `light` for a definitional question of at most 40 characters ("X 뜻",
///   "X가 뭐야"); `standard` for any other answer; `unknown` when the request
///   is not answer-only.
///
/// The imperative or polite ending never matters: 설명해봐, 설명해줘, 설명해 주세요,
/// 설명해줄래?, 설명해, 설명 좀 and a trailing "?" give the same profile.
public struct RequestProfile: Codable, Equatable, Sendable {
    public enum AnswerKind: String, Codable, Sendable, CaseIterable {
        case answerOnly = "answer_only", work, unknown
    }
    public enum ToolNeed: String, Codable, Sendable, CaseIterable {
        case currentFacts = "current_facts", workspace, shell, write, none
    }
    public enum Difficulty: String, Codable, Sendable, CaseIterable {
        case light, standard, deep, unknown
    }
    public static let currentSchema = 1
    public static let currentPolicy = "host_profile_v1"
    /// Wire bound on the evidence tokens (Core checks the same).
    public static let maximumSignals = 32

    public var schema: Int
    public var policy: String
    public var answerKind: AnswerKind
    public var toolNeed: ToolNeed
    public var difficulty: Difficulty
    /// Sorted, unique evidence tokens (`^[a-z][a-z0-9_]{0,63}$`). Diagnostic:
    /// Core validates them and never routes on them.
    public var signals: [String]

    public init(answerKind: AnswerKind, toolNeed: ToolNeed, difficulty: Difficulty, signals: [String],
                schema: Int = RequestProfile.currentSchema, policy: String = RequestProfile.currentPolicy) {
        self.schema = schema; self.policy = policy; self.answerKind = answerKind; self.toolNeed = toolNeed
        self.difficulty = difficulty; self.signals = signals
    }
    enum CodingKeys: String, CodingKey {
        case schema, policy, signals, answerKind = "answer_kind", toolNeed = "tool_need", difficulty
    }

    /// An answer that needs nothing from this machine or the outside world:
    /// the request the RCC catalog offers the tool-free chat lane.
    public var answersWithoutTools: Bool { answerKind == .answerOnly && toolNeed == .none }
    /// The profile Core's graded admission may lower (light or standard).
    public var gradable: Bool { answersWithoutTools && (difficulty == .light || difficulty == .standard) }
    /// The structural rules both sides enforce on the wire.
    public var valid: Bool {
        schema == RequestProfile.currentSchema && policy == RequestProfile.currentPolicy &&
            signals.count <= RequestProfile.maximumSignals && signals == Array(Set(signals)).sorted() &&
            signals.allSatisfy { $0.range(of: #"^[a-z][a-z0-9_]{0,63}$"#, options: .regularExpression) != nil } &&
            (answerKind == .answerOnly) == (difficulty != .unknown)
    }

    // MARK: Vocabulary

    /// Stems that ask for an answer. Matched as substrings (Korean) or whole
    /// words (ASCII).
    static let answerStems = ["설명", "알려", "가르쳐", "말해", "뭐야", "뭔지", "무슨", "뜻", "의미", "차이", "비교", "왜",
                              "어떻게", "원리", "개념", "정의", "뭐지", "뭐냐", "뭐임", "무엇", "증명", "유도",
                              "explain", "describe", "what is", "what's", "what are", "why", "how does", "how do",
                              "tell me", "difference", "meaning", "define", "prove", "derive"]
    /// Of those, the stems that only ask what something is.
    static let definitionalStems = ["뜻", "의미", "뭐야", "뭔지", "뭐지", "뭐냐", "뭐임", "무엇", "정의",
                                    "what is", "what's", "what are", "meaning", "define"]
    /// And the stems that ask for an explanation, a reason or a comparison.
    static let explanationStems = ["설명", "가르쳐", "차이", "비교", "왜", "어떻게", "원리",
                                   "explain", "describe", "why", "how does", "how do", "difference"]
    /// Task-shape markers of deep work (never a topic).
    static let deepMarkers = ["증명", "유도", "설계", "아키텍처", "디버그", "디버깅", "원인", "최적화", "리뷰", "검토", "레드팀",
                              "심층", "깊게", "깊이", "엄밀", "단계별", "prove", "proof", "derive", "derivation", "design",
                              "architect", "architecture", "debug", "root cause", "optimize", "optimise", "review",
                              "red team", "red-team", "rigorous", "rigorously", "in depth", "in-depth",
                              "step by step", "step-by-step"]
    /// Words that need the world as it is now.
    static let currentFactTerms = ["최신", "오늘", "현재", "지금", "가격", "환율", "시세", "주가", "뉴스", "날씨", "검색",
                                   "찾아봐", "찾아줘", "최근", "요즘", "어제", "내일", "올해", "실시간", "주식",
                                   "latest", "today", "price", "prices", "news", "search", "recent", "weather",
                                   "stock price", "yesterday", "tomorrow", "right now", "this year"]
    /// A reference to an earlier artifact, the conversation or the workspace.
    static let deicticTerms = ["이거", "이것", "이게", "이건", "이걸", "그거", "그것", "그게", "그건", "그걸",
                               "저거", "저것", "저게", "저건", "저걸", "여기", "거기", "저기", "위에", "위의", "아래",
                               "아까", "방금", "앞에서", "앞서", "지난번", "저번", "이전에"]
    static let deicticWords = ["this", "these", "those", "above", "earlier", "previous", "attached"]
    /// External actions (the writing-an-answer verbs of `orderTerms` are not).
    static let externalActions = ["날려", "가져와", "가져 와", "가져가", "보라고", "하라고", "해라고", "라니까", "사자", "사줘",
                                  "구매", "결제", "주문", "보내", "띄워", "옮겨", "찾아와", "알아와", "뽑아", "예약", "취소"]
    /// An English order in request position ("Please fix …", "Run the job").
    static let englishOrder = #"(?:^|[.!?;\n]\s*|\b(?:please|and|then|now|also|first)\s+)(?:continue|resume|proceed|fix|make|build|create|write|add|remove|delete|change|run|start|finish|deploy|install|commit|push)\b"#

    // MARK: Classification

    /// The profile of `request` with the host's own facts: whether it needs a
    /// shell (`promptRequiresShellCapability`) and whether material is
    /// attached. Named paths and images are read from the text here.
    public static func classify(_ request: String, shellNeed: Bool, hasMaterial: Bool) -> RequestProfile {
        let value = request.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = value.lowercased()
        func mentions(_ terms: [String]) -> Bool {
            terms.contains { term in
                term.unicodeScalars.allSatisfy(\.isASCII)
                    ? lower.range(of: "(?<![A-Za-z0-9])" + NSRegularExpression.escapedPattern(for: term) + "(?![A-Za-z0-9])",
                                  options: .regularExpression) != nil
                    : lower.contains(term)
            }
        }
        var signals = Set<String>()
        // What the request reaches beyond the answer.
        let write = ScopeResolution.resolve(value).scope == .workspaceWrite
        if write { signals.insert("write_scope") }
        if shellNeed { signals.insert("shell") }
        if hasMaterial { signals.insert("material") }
        if !RequestNamedPaths.extract(value).isEmpty { signals.insert("named_path") }
        if !PromptAttachments.imagePaths(in: value).isEmpty { signals.insert("image") }
        // The chat lane's machine-material terms, ASCII terms as whole words
        // ("difference" is not "diff", "logic" is not "log"), plus a path, a
        // URL, a file name or a dotted name before a Korean particle.
        if mentions(ClaudeChatLane.projectTerms) || mentions(ClaudeChatLane.workspaceTerms) ||
            mentions(ClaudeChatLane.localWorkTerms) ||
            lower.range(of: ClaudeChatLane.machinePathPattern, options: .regularExpression) != nil ||
            lower.range(of: #"[A-Za-z0-9_\-]\.[A-Za-z]{1,6}(?![A-Za-z])"#, options: .regularExpression) != nil {
            signals.insert("machine_material")
        }
        if mentions(ClaudeChatLane.externalSystems) { signals.insert("external_system") }
        if deicticTerms.contains(where: lower.contains) || mentions(deicticWords) ||
            lower.range(of: #"(?:^|[\s,.!?~])(?:이|그|저)\s+[가-힣A-Za-z]"#, options: .regularExpression) != nil {
            signals.insert("deictic")
        }
        if StatusCheckIn.answersFromCard(value) { signals.insert("status_check_in") }
        if ClaudeChatLane.statusQuestions.contains(where: lower.contains) { signals.insert("status_question") }
        if ClaudeChatLane.failureComplaints.contains(where: lower.contains) { signals.insert("failure_complaint") }
        if mentions(currentFactTerms) { signals.insert("current_facts") }
        // Orders.
        let externalAction = externalActions.contains(where: lower.contains)
        if externalAction { signals.insert("external_action") }
        let order = ClaudeChatLane.asksForWork(value) ||
            lower.range(of: englishOrder, options: .regularExpression) != nil
        if order { signals.insert("work_order") }
        let textOperation = ClaudeChatLane.selfContainedTextOperation(value)
        if textOperation { signals.insert("text_operation") }
        // The ask itself.
        // A question asked in words also asks for an answer. Not a signal:
        // "?" or none never changes the profile of a request with a stem.
        let conversational = ClaudeChatLane.conversationalQuestion(value)
        let stem = mentions(answerStems)
        if stem { signals.insert("answer_stem") }
        let definitional = mentions(definitionalStems), explanation = mentions(explanationStems)
        if definitional { signals.insert("definitional_stem") }
        if explanation { signals.insert("explanation_stem") }

        let tool: ToolNeed
        if write { tool = .write }
        else if shellNeed { tool = .shell }
        else if !signals.isDisjoint(with: ["material", "named_path", "image", "machine_material", "external_system",
                                           "deictic", "status_check_in", "status_question", "failure_complaint",
                                           "external_action"]) { tool = .workspace }
        else if signals.contains("current_facts") { tool = .currentFacts }
        else { tool = .none }

        let blocked = write || shellNeed || order || externalAction || textOperation ||
            !signals.isDisjoint(with: ["material", "named_path", "image", "machine_material", "external_system",
                                       "failure_complaint", "status_check_in", "status_question"])
        let kind: AnswerKind = (stem || conversational) && !blocked ? .answerOnly
            : (write || shellNeed || order || externalAction) ? .work : .unknown

        var difficulty = Difficulty.unknown
        if kind == .answerOnly {
            if mentions(deepMarkers) { signals.insert("deep_marker") }
            if value.count > 280 { signals.insert("long_request") }
            if value.contains("```") { signals.insert("code_block") }
            if value.range(of: #"(?m)^\s*(?:[0-9]{1,2}[.)]|[①-⑳]|[-*•])\s+\S"#, options: .regularExpression) != nil {
                signals.insert("list")
            }
            let parts = value.components(separatedBy: CharacterSet(charactersIn: "?？;\n"))
                .flatMap { $0.components(separatedBy: ". ") }
                .filter { part in part.unicodeScalars.contains { CharacterSet.letters.contains($0) } }
            if parts.count >= 3 { signals.insert("multi_part") }
            if !signals.isDisjoint(with: ["deep_marker", "long_request", "code_block", "list", "multi_part"]) {
                difficulty = .deep
            } else if value.count <= 40 && definitional && !explanation {
                signals.insert("short_definition"); difficulty = .light
            } else {
                difficulty = .standard
            }
        }
        return RequestProfile(answerKind: kind, toolNeed: tool, difficulty: difficulty, signals: signals.sorted())
    }
}
