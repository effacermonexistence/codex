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
///   code, system, OS-1, workspace-state, project or external-system term,
///   no order of any kind (an edit, writing the answer down or placing it
///   somewhere, defining a code object, delivering it to someone) and no
///   failure complaint. `work` for an edit, a run, an external action or a
///   write order. `unknown` for everything else, including a bare pro-verb
///   with no content stem ("그럼 실제로 해봐" is work) and a text operation
///   (quality-bearing text generation keeps its own class).
/// - `tool_need`: `write`, `shell`, `workspace` (machine material, a deictic
///   reference to earlier artifacts, turns or the workspace, a status
///   check-in), `current_facts` (latest, today, prices, news, search, the
///   chat lane's lookup words, a year or a versioned name), else `none`.
/// - `difficulty`, from the shape of the task only, never its topic
///   ("science" or "Python" alone never raises it): `deep` for a proof,
///   derivation, design, debugging, optimization or review marker, a
///   quality-bearing deliverable or an exact computation, the owner asking
///   for the strongest model or more thinking, a request over 280
///   characters, three or more asks, a list or code; `light` for a
///   definitional question of at most 40 characters ("X 뜻", "X가 뭐야");
///   `standard` for any other answer; `unknown` when the request is not
///   answer-only.
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
    /// Build 441 part 2: what kind of task the request is (the local
    /// classifier's enums, `LocalRequestClassifier.TaskType`, plus `unknown`
    /// for a keyword-only profile that cannot tell).
    public enum TaskType: String, Codable, Sendable, CaseIterable {
        case chat, explain, design, write, action, unknown
    }
    public static let currentSchema = 1
    public static let currentPolicy = "host_profile_v1"
    /// Wire bound on the evidence tokens (Core checks the same).
    public static let maximumSignals = 32
    /// Build 441 part 2: the classifier provenance of a combined profile.
    public static let keywordClassifier = "keyword_v1"
    public static let localClassifierPrefix = "local_llm:"
    static let classifierPattern = #"^(?:keyword_v1|local_llm:[a-z0-9][a-z0-9._:-]{0,63})$"#

    public var schema: Int
    public var policy: String
    public var answerKind: AnswerKind
    public var toolNeed: ToolNeed
    public var difficulty: Difficulty
    /// Sorted, unique evidence tokens (`^[a-z][a-z0-9_]{0,63}$`). Diagnostic:
    /// Core validates them and never routes on them.
    public var signals: [String]
    /// Build 441 part 2 (owner order 2026-10-27), both or neither: who read
    /// the request (`keyword_v1`, or `local_llm:<model>` when the local model's
    /// reading was combined under the keyword rails) and the task type. A
    /// profile without them is the keyword-only build-441 profile.
    public var classifier: String?
    public var taskType: TaskType?

    public init(answerKind: AnswerKind, toolNeed: ToolNeed, difficulty: Difficulty, signals: [String],
                schema: Int = RequestProfile.currentSchema, policy: String = RequestProfile.currentPolicy,
                classifier: String? = nil, taskType: TaskType? = nil) {
        self.schema = schema; self.policy = policy; self.answerKind = answerKind; self.toolNeed = toolNeed
        self.difficulty = difficulty; self.signals = signals; self.classifier = classifier; self.taskType = taskType
    }
    enum CodingKeys: String, CodingKey {
        case schema, policy, signals, classifier, answerKind = "answer_kind", toolNeed = "tool_need", difficulty
        case taskType = "task_type"
    }

    /// An answer that needs nothing from this machine or the outside world:
    /// the request the RCC catalog offers the tool-free chat lane.
    public var answersWithoutTools: Bool { answerKind == .answerOnly && toolNeed == .none }
    /// Build 441 part 2: an answer that changes nothing on this machine and
    /// reads at most the world as it is now (a read-only agent can look it
    /// up). The RCC catalog's owner scope for a combined profile.
    public var answersReadOnly: Bool { answerKind == .answerOnly && (toolNeed == .none || toolNeed == .currentFacts) }
    /// The profile Core's graded admission may lower (light or standard).
    public var gradable: Bool { answersWithoutTools && (difficulty == .light || difficulty == .standard) }
    /// Build 441 part 2: very easy chat the local model may answer itself:
    /// the local classifier read it as chat, light and tool-free, and no rail
    /// stood against that reading.
    public var answersLocally: Bool {
        locallyClassified && taskType == .chat && answersWithoutTools && difficulty == .light
    }
    /// The local classifier read this request (the reading was combined).
    public var locallyClassified: Bool { classifier?.hasPrefix(RequestProfile.localClassifierPrefix) == true }
    /// The structural rules both sides enforce on the wire.
    public var valid: Bool {
        schema == RequestProfile.currentSchema && policy == RequestProfile.currentPolicy &&
            signals.count <= RequestProfile.maximumSignals && signals == Array(Set(signals)).sorted() &&
            signals.allSatisfy { $0.range(of: #"^[a-z][a-z0-9_]{0,63}$"#, options: .regularExpression) != nil } &&
            (answerKind == .answerOnly) == (difficulty != .unknown) &&
            (classifier == nil) == (taskType == nil) &&
            (classifier.map { $0.range(of: RequestProfile.classifierPattern, options: .regularExpression) != nil } ?? true) &&
            // A combined answer is an answer task; the local model always names one of its five types.
            (answerKind != .answerOnly || taskType.map { [.chat, .explain, .design, .write].contains($0) } ?? true) &&
            (!locallyClassified || taskType != .unknown)
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
                              "심층", "깊게", "깊이", "엄밀", "단계별", "차근차근", "prove", "proof", "derive", "derivation",
                              "design", "architect", "architecture", "debug", "root cause", "optimize", "optimise", "review",
                              "red team", "red-team", "rigorous", "rigorously", "in depth", "in-depth",
                              "step by step", "step-by-step", "one step at a time", "stepwise", "step-wise"]
    /// A quality-bearing deliverable or an exact computation is its own task
    /// shape, whatever its stem ("…왜 중요한지 에세이 써줘", "…full
    /// implementation", "∫ x sin x dx 어떻게 풀어?"): it keeps the reference.
    static let deliverableMarkers = ["에세이", "보고서", "리포트", "레포트", "이메일", "편지", "자소서", "자기소개서", "논문",
                                     "칼럼", "연설문", "제안서", "기획서", "구현", "essay", "report", "letter", "email", "e-mail",
                                     "draft", "compose", "article", "speech", "proposal", "implement", "implementation",
                                     "solve", "calculate", "compute", "full code", "complete code"]
    static let deliverablePattern = #"풀어\s*(?:줘|봐|주세요|줄래)|어떻게\s*풀|풀이|구해\s*(?:줘|봐|주세요)|구하(?:는|시오|라)|계산\s*(?:해|하)|[0-9]+\s*(?:자|단어|글자|페이지|words|pages)(?![가-힣A-Za-z])"#
    /// The owner asking for the strongest model or more thinking ("제일
    /// 똑똑한 모델로", "think hard"): the reference, never a lower grade,
    /// whether or not the routing intent parser names a tuple for it.
    static let qualityRequestTerms = ["제일 똑똑한", "가장 똑똑한", "제일 좋은 모델", "가장 좋은 모델", "최고 모델", "최고의 모델",
                                      "최상위 모델", "제일 센 모델", "가장 센 모델", "가장 강력한 모델", "제일 강력한 모델",
                                      "최고 성능", "최고 품질", "최대 추론", "최대 리즈닝", "깊이 생각", "깊게 생각", "신중하게 생각",
                                      "곰곰이 생각", "오래 생각", "best model", "strongest model", "smartest model",
                                      "most capable", "top model", "most powerful model", "think hard", "think harder",
                                      "think deeply", "think carefully", "ultrathink", "max effort", "maximum effort",
                                      "highest effort", "high effort"]
    /// Words that need the world as it is now. `ClaudeChatLane.lookupTerms`
    /// (the chat lane's own lookup guard) counts as well, and so do a year and
    /// a versioned name ("GPT-6.1", "iPhone 17", "2026년").
    static let currentFactTerms = ["최신", "오늘", "현재", "지금", "가격", "환율", "시세", "주가", "뉴스", "날씨", "검색",
                                   "찾아봐", "찾아줘", "최근", "요즘", "요새", "어제", "내일", "올해", "실시간", "주식",
                                   "시가총액", "근황", "현직", "신제품", "신형", "새 모델", "새로 나온", "새로나온", "이번 주",
                                   "누군지", "누구야", "누구지", "누구인지", "누구예요", "누구에요",
                                   "latest", "today", "price", "prices", "news", "search", "recent", "weather",
                                   "stock price", "yesterday", "tomorrow", "right now", "this year", "this week",
                                   "this month", "newest", "new", "who is", "who's", "who are"]
    static let currentFactPattern = #"(?<![0-9])(?:19|20|21)[0-9]{2}(?![0-9])|[a-z][a-z0-9]+[ \-][0-9]+(?:\.[0-9]+)*(?![0-9])"#
    /// A reference to an earlier artifact, the conversation or the workspace.
    static let deicticTerms = ["이거", "이것", "이게", "이건", "이걸", "그거", "그것", "그게", "그건", "그걸",
                               "저거", "저것", "저게", "저건", "저걸", "여기", "거기", "저기", "위에", "위의", "아래",
                               "아까", "방금", "앞에서", "앞서", "지난번", "저번", "이전에",
                               "그런", "그렇", "이런", "이렇", "저런", "저렇"]
    static let deicticWords = ["this", "these", "those", "above", "earlier", "previous", "attached",
                               "you said", "you mentioned", "you told", "you wrote", "your answer", "your last",
                               "your previous", "last answer", "previous answer"]
    /// A reference to an earlier turn of this conversation ("네가 전에 말한 …",
    /// "너가 마지막에 한 답변", "우리가 얘기한 …", "지난 답변").
    static let priorTurnPattern = #"(?<![가-힣])(?:네|너|니|우리)가\s*(?:[가-힣A-Za-z]+\s+){0,3}?[가-힣]*(?:말|답|얘기|이야기|설명|한|했)|전에\s*(?:말|한|했|얘기|설명)|마지막(?:에)?\s*(?:한|말|답)|(?:지난|이전|직전|앞선)\s*(?:답|말|대답|설명)"#
    /// The state of this workspace's work and OS-1's own vocabulary, ASR
    /// spellings included: an explanation of these needs the agent that can
    /// read them ("변경사항 설명해줘", "오에스원 라우팅 설명해줘", "REVAS가 뭐야?").
    static let workspaceStateTerms = ["변경사항", "변경 사항", "변경점", "수정사항", "수정 사항", "작업 내용", "작업내용",
                                      "바뀐 거", "바뀐거", "바뀐 점", "풀리퀘", "풀 리퀘", "에러 메시지", "에러메시지",
                                      "pr", "pull request", "what changed", "the changes", "these changes", "your changes",
                                      "recent changes", "changes made", "changelog"]
    static let ownerProjectTerms = ["오에스원", "오에스 원", "오에스1", "알씨씨", "레바스", "오마르", "루아", "데이브레이크",
                                    "네오문디", "네오 문디", "오픈클로", "오픈 클로", "에스씨브이", "클로드 코드",
                                    "revas", "omaragi", "omar", "lua", "daybreak", "neomundi", "openclaw"]
    /// External actions (the writing-an-answer verbs of `orderTerms` are not).
    static let externalActions = ["날려", "가져와", "가져 와", "가져가", "보라고", "하라고", "해라고", "라니까", "사자", "사줘",
                                  "구매", "결제", "주문", "보내", "띄워", "옮겨", "찾아와", "알아와", "뽑아", "예약", "취소"]
    /// Delivering the answer to someone or somewhere ("팀장한테 말해줘",
    /// "메일로 설명해줘", "… and email it to X", "… save it as a note").
    static let deliveryPattern = #"(?:한테|에게|께)\s*(?:(?:(?!듯)[가-힣A-Za-z0-9])+\s+){0,2}?(?:말해|말 해|설명해|설명 해|전해|전달|알려|보고해|보고 해|공유)(?![가-힣]*듯)|(?:메일|이메일|문자|카톡|카카오톡|슬랙|디엠|dm|메시지|메세지|텔레그램)\s*(?:로|으로)\s|\b(?:send|email|e-mail|mail|post|save|share|upload|publish|forward|tweet|text|message|dm|slack)\s+(?:it|this|that|them|him|her|me|us|the|a|an|my|our|your|to|as|on|in|into|onto)\b"#
    /// Writing the answer down, putting it somewhere or writing code
    /// ("…노션에 올려줘", "…메모에 남겨줘", "주석으로 설명 달아줘", "PPT 짜줘"),
    /// beside the chat lane's own `orderTerms` (써줘, 적어, 정리해, 보내 …).
    static let placementOrders = ["올려", "남겨", "달아", "붙여", "짜줘", "짜 줘", "짜봐", "짜 봐", "공유해", "전달해", "업로드",
                                  "게시해", "포스팅", "기재해", "등록해"]
    /// Defining a code object is writing it ("User 타입 정의해줘").
    static let definitionOrder = #"(?:타입|자료형|스키마|enum|이넘|열거형|상수|인터페이스|구조체|struct|type|schema|interface|protocol|프로토콜|테이블|필드|엔드포인트|endpoint|클래스|class|함수|변수|모델|model)\s*(?:을|를)?\s*정의\s*(?:해|하)"#
    /// An English order in request position ("Please fix …", "Run the job").
    static let englishOrder = #"(?:^|[.!?;\n]\s*|\b(?:please|and|then|now|also|first)\s+)(?:continue|resume|proceed|fix|make|build|create|write|add|remove|delete|change|run|start|finish|deploy|install|commit|push|send|email|post|save|share|upload|publish|draft|compose|implement)\b"#
    /// Code written into the request without a fence ("def fib(n): return …").
    static let inlineCodePattern = #"\bdef\s+[A-Za-z_][A-Za-z0-9_]*\s*\(|\bfunction\s*[A-Za-z_]*\s*\(|\bfunc\s+[A-Za-z_]|\bfn\s+[A-Za-z_]|=>|#include|\breturn\s+\S|\b(?:let|var|const|int|auto)\s+[A-Za-z_][A-Za-z0-9_]*\s*=|\{[^{}\n]*;[^{}\n]*\}"#
    /// Words that also ask, for counting the asks of one request.
    static let askWords = ["how", "what", "who", "when", "where", "which", "어떤", "언제", "누가", "누구", "어디", "어느"]

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
        func matches(_ pattern: String, _ text: String) -> Bool { text.range(of: pattern, options: .regularExpression) != nil }
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
        // Also the chat lane's code, system and OS-1 terms (its documented
        // rule: questions about them belong to the agent that can read the
        // code and the logs), this workspace's own state ("변경사항", "PR")
        // and OS-1's vocabulary in its ASR spellings ("오에스원", "알씨씨").
        if mentions(ClaudeChatLane.projectTerms) || mentions(ClaudeChatLane.workspaceTerms) ||
            mentions(ClaudeChatLane.localWorkTerms) || mentions(ClaudeChatLane.technicalTerms) ||
            mentions(workspaceStateTerms) || mentions(ownerProjectTerms) ||
            lower.range(of: ClaudeChatLane.machinePathPattern, options: .regularExpression) != nil ||
            lower.range(of: #"[A-Za-z0-9_\-]\.[A-Za-z]{1,6}(?![A-Za-z])"#, options: .regularExpression) != nil {
            signals.insert("machine_material")
        }
        if mentions(ClaudeChatLane.externalSystems) { signals.insert("external_system") }
        if deicticTerms.contains(where: lower.contains) || mentions(deicticWords) || matches(priorTurnPattern, lower) ||
            lower.range(of: #"(?:^|[\s,.!?~])(?:이|그|저)\s+[가-힣A-Za-z]"#, options: .regularExpression) != nil {
            signals.insert("deictic")
        }
        if StatusCheckIn.answersFromCard(value) { signals.insert("status_check_in") }
        if ClaudeChatLane.statusQuestions.contains(where: lower.contains) { signals.insert("status_question") }
        if ClaudeChatLane.failureComplaints.contains(where: lower.contains) { signals.insert("failure_complaint") }
        if mentions(currentFactTerms) || mentions(ClaudeChatLane.lookupTerms) || matches(currentFactPattern, lower) {
            signals.insert("current_facts")
        }
        // Orders. An answer only: no order of any kind, including writing the
        // answer down or placing it somewhere (the chat lane's `orderTerms`,
        // `placementOrders`), defining a code object, or delivering it to
        // someone (`deliveryPattern`).
        let externalAction = externalActions.contains(where: lower.contains) || matches(deliveryPattern, lower)
        if externalAction { signals.insert("external_action") }
        let order = ClaudeChatLane.asksForWorkBeyondAnswer(value) || matches(englishOrder, lower) ||
            ClaudeChatLane.orderTerms.contains(where: lower.contains) || placementOrders.contains(where: lower.contains) ||
            matches(definitionOrder, lower)
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
            if mentions(deliverableMarkers) || matches(deliverablePattern, lower) { signals.insert("deliverable") }
            if mentions(qualityRequestTerms) { signals.insert("quality_request") }
            if value.count > 280 { signals.insert("long_request") }
            if value.contains("```") || matches(inlineCodePattern, value) { signals.insert("code_block") }
            if value.range(of: #"(?m)^\s*(?:[0-9]{1,2}[.)]|[①-⑳]|[-*•])\s+\S"#, options: .regularExpression) != nil {
                signals.insert("list")
            }
            let parts = value.components(separatedBy: CharacterSet(charactersIn: "?？;\n"))
                .flatMap { $0.components(separatedBy: ". ") }
                .filter { part in part.unicodeScalars.contains { CharacterSet.letters.contains($0) } }
            // Asks joined by commas, 그리고/and or a "…지" clause count too:
            // each clause that carries a stem or a question word and more
            // than one word ("양자역학이 뭔지, 상대성이론이 뭔지, 그리고 둘의
            // 차이를 설명해줘"). A bare "설명해줘" closing the list is not an ask.
            let clauses = lower
                .replacingOccurrences(of: #"(?<=[가-힣]지)\s+|그리고|\band\b"#, with: "\n", options: .regularExpression)
                .components(separatedBy: CharacterSet(charactersIn: ",，;?？\n"))
                .flatMap { $0.components(separatedBy: ". ") }
            let asks = clauses.filter { clause in
                let words = clause.split(whereSeparator: \.isWhitespace)
                guard words.count >= 2 else { return false }
                return (answerStems + askWords).contains { term in
                    term.unicodeScalars.allSatisfy(\.isASCII)
                        ? clause.range(of: "(?<![A-Za-z0-9])" + NSRegularExpression.escapedPattern(for: term) + "(?![A-Za-z0-9])",
                                       options: .regularExpression) != nil
                        : clause.contains(term)
                }
            }
            if parts.count >= 3 || asks.count >= 3 { signals.insert("multi_part") }
            if !signals.isDisjoint(with: ["deep_marker", "deliverable", "quality_request", "long_request", "code_block",
                                          "list", "multi_part"]) {
                difficulty = .deep
            } else if value.count <= 40 && definitional && !explanation {
                signals.insert("short_definition"); difficulty = .light
            } else {
                difficulty = .standard
            }
        }
        return RequestProfile(answerKind: kind, toolNeed: tool, difficulty: difficulty, signals: signals.sorted())
    }

    // MARK: Combination (build 441 part 2, owner order 2026-10-27)

    /// The owner asking for the strongest model or more thinking, read on any
    /// request (the keyword profile reads it on answers only). Owner words:
    /// a combined profile never lowers it.
    public static func asksForStrongest(_ request: String) -> Bool {
        let lower = request.precomposedStringWithCanonicalMapping.lowercased()
        return qualityRequestTerms.contains { term in
            term.unicodeScalars.allSatisfy(\.isASCII)
                ? lower.range(of: "(?<![A-Za-z0-9])" + NSRegularExpression.escapedPattern(for: term) + "(?![A-Za-z0-9])",
                              options: .regularExpression) != nil
                : lower.contains(term)
        }
    }

    /// Whether the keyword rails already fix this request's route, so the
    /// local classifier has nothing it may decide: work (a write, shell need,
    /// order or external action), a workspace need, a text operation (a
    /// quality-bearing text deliverable stays on policy A) or the owner asking
    /// for the strongest model. The local model can never lower these, so it
    /// is not asked (no latency, no residency) and the profile stays `keyword_v1`.
    public static func railsDecide(_ keyword: RequestProfile, request: String) -> Bool {
        keyword.answerKind == .work || keyword.toolNeed == .workspace || keyword.signals.contains("text_operation") ||
            asksForStrongest(request)
    }

    /// The profile the RCC catalog emits: the keyword profile's hard rails
    /// first, then the local classifier's reading for everything else
    /// (DESIGN-2 "Combination"). Deterministic for the same keyword profile,
    /// request and local answer.
    ///
    /// - Rails stand and are never lowered: work (write scope, shell, an order
    ///   or external action) stays work; a workspace need (material, a path,
    ///   an image, machine material, a project or external system, a deictic
    ///   reference, a status check-in or question, a failure complaint) stays
    ///   workspace; current facts stay current facts; a text operation stays a
    ///   `write` task; the owner asking for the strongest model stays deep.
    /// - The local model may raise: to current facts, to a workspace need, or
    ///   (needs_tools `execution`) to work. An `action` label with no execution
    ///   need, where no rail stands, reads as an `explain` answer.
    /// - Otherwise its task_type, difficulty and needs_tools decide.
    /// - Without a local answer: the keyword profile, except that a keyword
    ///   `unknown` with no rail becomes an answer at standard (task `explain`),
    ///   never the reference merely because the keywords could not read it.
    public static func combine(keyword k: RequestProfile, request: String,
                               local: LocalRequestClassifier.Answer?, model: String?) -> RequestProfile {
        var signals = Set(k.signals)
        let quality = asksForStrongest(request)
        if quality { signals.insert("quality_request") }
        let workRail = k.answerKind == .work, workspaceRail = k.toolNeed == .workspace
        let factsRail = k.signals.contains("current_facts"), textOperation = k.signals.contains("text_operation")
        func finish(_ kind: AnswerKind, _ tool: ToolNeed, _ difficulty: Difficulty, _ task: TaskType,
                    _ classifier: String, _ extra: [String]) -> RequestProfile {
            // Diagnostic tokens yield to the evidence under the wire bound.
            let all = signals.union(extra).count <= maximumSignals ? signals.union(extra) : signals
            return RequestProfile(answerKind: kind, toolNeed: tool, difficulty: kind == .answerOnly ? difficulty : .unknown,
                                  signals: Array(all).sorted(), classifier: classifier, taskType: task)
        }
        guard let local, let model, LocalRequestClassifier.validModelName(model) else {
            let keyword = keywordClassifier
            if workRail { return finish(.work, k.toolNeed, .unknown, textOperation ? .write : .action, keyword, []) }
            if workspaceRail {
                return finish(k.answerKind, .workspace, k.difficulty, k.answerKind == .answerOnly ? .explain : .unknown, keyword, [])
            }
            if textOperation { return finish(k.answerKind, k.toolNeed, .unknown, .write, keyword, []) }
            if k.answerKind == .answerOnly {
                return finish(.answerOnly, k.toolNeed, quality ? .deep : k.difficulty, .explain, keyword, [])
            }
            if factsRail { return finish(k.answerKind, .currentFacts, .unknown, .unknown, keyword, []) }
            return finish(.answerOnly, .none, quality ? .deep : .standard, .explain, keyword, ["keyword_unknown_default"])
        }
        let classifier = localClassifierPrefix + model
        let labelled = TaskType(rawValue: local.taskType.rawValue) ?? .unknown
        let reading = ["llm_task_" + local.taskType.rawValue, "llm_difficulty_" + local.difficulty.rawValue,
                       "llm_tools_" + local.needsTools.rawValue]
        let workTask: TaskType = [.action, .write, .design].contains(labelled) ? labelled : textOperation ? .write : .action
        if workRail {
            return finish(.work, k.toolNeed, .unknown, workTask, classifier, reading + (workTask != labelled ? ["rail_overrules_llm"] : []))
        }
        // Only the tool need raises to work (needs_tools `execution`). An
        // "action" label with no execution need, where no keyword order or
        // tool rail stands, is a request for an answer ("오늘 환율 알려줘" read
        // as action/light/current_facts on 2026-10-27): it reads as explain.
        if local.needsTools == .execution {
            let tool: ToolNeed = k.toolNeed == .none || k.toolNeed == .currentFacts ? .workspace : k.toolNeed
            return finish(.work, tool, .unknown, workTask, classifier, reading + ["llm_raised_work"])
        }
        let task: TaskType = labelled == .action ? .explain : labelled
        let unlabelled = labelled == .action ? ["llm_action_without_execution"] : []
        let difficulty: Difficulty = quality ? .deep : Difficulty(rawValue: local.difficulty.rawValue) ?? .standard
        let lowered = k.answerKind == .answerOnly && k.difficulty != difficulty ? ["llm_sets_difficulty"] : []
        if workspaceRail || local.needsTools == .workspace {
            let kind: AnswerKind = workspaceRail ? k.answerKind : .answerOnly
            return finish(kind, .workspace, difficulty, task, classifier,
                          reading + unlabelled + (workspaceRail ? [] : ["llm_raised_tools"]) + lowered)
        }
        if textOperation {
            let writeTask: TaskType = [.write, .design].contains(task) ? task : .write
            let tool: ToolNeed = factsRail || local.needsTools == .currentFacts ? .currentFacts : k.toolNeed
            return finish(k.answerKind, tool, .unknown, writeTask, classifier,
                          reading + (writeTask != labelled ? ["rail_overrules_llm"] : []))
        }
        // No rail: the local reading decides; it may only raise current facts.
        let facts = factsRail || local.needsTools == .currentFacts
        let notes = (!factsRail && local.needsTools == .currentFacts ? ["llm_raised_tools"] : []) +
            (factsRail && local.needsTools == .none ? ["rail_overrules_llm"] : [])
        return finish(.answerOnly, facts ? .currentFacts : .none, difficulty, task, classifier, reading + unlabelled + notes + lowered)
    }
}
