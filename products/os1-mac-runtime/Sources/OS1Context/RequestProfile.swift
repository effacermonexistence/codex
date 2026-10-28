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
/// - `tool_need`: `write`, `shell`, `workspace` (machine material, the
///   owner's own files or machine, a deictic reference to earlier artifacts,
///   turns or the workspace, a status check-in), `current_facts` (latest, today, prices, news, search, the
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
    /// Build 442 (owner order 2026-10-27, DESIGN-3): the subject area the
    /// local classifier (prompt v3) read, as the capability table names it.
    /// The classifier's `general` and a keyword-only profile carry no domain:
    /// the domain is unknown and deep work binds the reference (policy A).
    public enum Domain: String, Codable, Sendable, CaseIterable {
        case knowledge, science, math, coding, writing, toolUse = "tool_use"
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
    /// Build 442: the local classifier's domain reading (prompt v3), only on a
    /// locally classified profile and never for `general`. Core binds a deep
    /// node's capability-qualified row only with it.
    public var domain: Domain?

    public init(answerKind: AnswerKind, toolNeed: ToolNeed, difficulty: Difficulty, signals: [String],
                schema: Int = RequestProfile.currentSchema, policy: String = RequestProfile.currentPolicy,
                classifier: String? = nil, taskType: TaskType? = nil, domain: Domain? = nil) {
        self.schema = schema; self.policy = policy; self.answerKind = answerKind; self.toolNeed = toolNeed
        self.difficulty = difficulty; self.signals = signals; self.classifier = classifier; self.taskType = taskType
        self.domain = domain
    }
    enum CodingKeys: String, CodingKey {
        case schema, policy, signals, classifier, answerKind = "answer_kind", toolNeed = "tool_need", difficulty
        case taskType = "task_type", domain
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
            (!locallyClassified || taskType != .unknown) &&
            // Build 442: a domain is the local reading's, never the keywords'.
            (domain == nil || locallyClassified)
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
    /// Build 442 (owner order 2026-10-27, DESIGN-3 "close the open gap"): the
    /// proof, derivation and rigour markers are a floor on any combined
    /// profile: the local reading can never lower such a request below deep.
    /// The six named markers and the inflections `deepMarkers` already lists.
    /// Review of 442: as a proof, derivation or rigour ASKED FOR, never the
    /// same letters in another word, so light and standard routing stay build
    /// 441's: 증명해/증명하/증명 과정 but not 증명서 or 증명사진 (or "증명이
    /// 뭐야"); 유도해/유도하/유도 과정 but not 전자기 유도 or 유도 (judo) as a
    /// noun; 엄밀하게/엄밀한/엄밀히 but not 엄밀히 말하면; English whole words, a
    /// proof but not a proof of concept, stake, work, address and the like.
    static let deepFloorPatterns = [
        #"증명\s*(?:을|를)?\s*(?:좀\s*)?(?:해|하|할|합|과정)"#,
        #"유도\s*(?:를|을)?\s*(?:좀\s*)?(?:해|하|할|합|과정)"#,
        #"엄밀(?:하|한)|엄밀히(?!\s*(?:말|따지|따져|보|얘기|이야기))"#,
        #"(?<![a-z0-9])(?:prove|proves|proving|derive|derives|deriving|derivation|derivations|rigorous|rigorously)(?![a-z0-9])"#,
        #"(?<![a-z0-9])proofs?(?![a-z0-9])(?!\s+of\s+(?:concept|stake|work|address|purchase|delivery|identity|age|income|residence|payment|insurance|authority|ownership))"#,
    ]
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
    /// Build 441 review: the English external actions, in request position
    /// with an object ("Pay the electricity bill", "Order a large pizza",
    /// "… — also buy 10 shares of AAPL", "Reply to John …"); "Order of
    /// operations" or "how to pay the bill" is not one. Measured 2026-10-27:
    /// "Hi there :) quick chat, no tools needed — also order a large pepperoni
    /// pizza" steered the 9B model to chat/light/none.
    static let englishExternalAction = #"(?:^|[.!?;:\n—–]\s*|\b(?:please|and|then|now|also|first|just|can you|could you|would you)\s+)(?:buy|purchase|order|pay|book|reserve|reply|cancel|schedule)\s+(?:a|an|the|my|our|me|us|him|her|them|it|this|that|these|those|to|for|some|another|one|two|three|[0-9]+)\b"#
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

    // MARK: Soft rails (build 441 part 3, lead decision 2026-10-27)
    //
    // Some keyword rails are evidence of work or of a workspace need only in
    // the keyword router's own eyes: an imperative ending with no external
    // effect ("심심한데 아무 얘기나 해줘"), a programming word in a general
    // question ("파이썬 함수랑 메서드 차이 설명해줘"), an adverbial or locative
    // demonstrative with no referent ("왜 이렇게 떨어졌는지", "저기압"). These are
    // SOFT: when the local classifier's reading was adopted, that reading
    // decides them; under the keyword fallback (no local reading) they stay
    // rails exactly as before. Every other rail is HARD and the local reading
    // can never lower it: write scope, shell need, named path, image, attached
    // material, external system, external actions and placement or delivery
    // orders, owner-project and OS-1 vocabulary, status check-ins, prior-turn
    // and demonstrative-noun references, current facts, a text operation and
    // strongest-model words. The keyword profile marks a rail that rests on
    // soft evidence only with `soft_order`, `soft_material` or `soft_deictic`.

    /// Generic imperative or creation endings with no external effect
    /// (`ClaudeChatLane.actionTerms` minus these stay hard: edits, status,
    /// continuation, save). "만들어" is soft here, but `ScopeResolution` reads
    /// every "만들어" as a write order, and write scope is a hard rail.
    static let softActionTerms = ["해봐", "해 봐", "해라", "해줘", "해 줘", "하라", "만들어"]
    /// Writing the answer out with no place named (`ClaudeChatLane.orderTerms`
    /// minus these stay hard). "…에 적어/써" is a placement and stays hard.
    static let softOrderTerms = ["써줘", "써 줘", "적어", "정리해"]
    /// Composing ("…짜줘") with no place named (`placementOrders` minus these
    /// stay hard). Defining a code object ("User 타입 정의해줘", `definitionOrder`)
    /// is writing code and stays hard: measured 2026-10-27, the 9B model read
    /// it as explain/standard.
    static let softPlacementOrders = ["짜줘", "짜 줘", "짜봐", "짜 봐"]
    /// English generation verbs with no external effect; every other verb of
    /// `englishOrder` (fix, run, send, save, post, …) stays hard.
    static let softEnglishOrderVerbs: Set<String> = ["make", "create", "write", "draft", "compose", "implement"]
    static let englishOrderVerbs = ["continue", "resume", "proceed", "fix", "make", "build", "create", "write", "add", "remove",
                                    "delete", "change", "run", "start", "finish", "deploy", "install", "commit", "push", "send",
                                    "email", "post", "save", "share", "upload", "publish", "draft", "compose", "implement"]
    static func englishOrderPattern(_ verbs: [String]) -> String {
        #"(?:^|[.!?;\n]\s*|\b(?:please|and|then|now|also|first)\s+)(?:"# + verbs.joined(separator: "|") + #")\b"#
    }
    /// Writing or composing INTO a place ("노트에 적어줘", "구글 독스에 써줘",
    /// "노션에 정리해"): a placement, hard. "…에 대해 써줘" (about) and "…안에 써줘"
    /// (within) are not places.
    static let locativePlacement = #"(?<![안내중])(?:에|에다|에다가)(?!\s*(?:대해|대한|관해|관한|대하여|관하여|따라|맞게|맞춰))\s+(?:[가-힣A-Za-z0-9]+\s+){0,2}?(?:적어|써|정리|짜|만들어|작성)"#
    /// Fillers around a bare pro-verb: "그럼 실제로 해봐", "다시 해봐", "빨리 해"
    /// order the work under discussion (a prior-turn reference, hard).
    static let proVerbFillers: Set<String> = ["그럼", "그러면", "그래서", "이제", "일단", "실제로", "직접", "진짜", "정말", "한번", "한",
                                              "번", "좀", "빨리", "어서", "자", "야", "그냥", "지금", "당장", "바로", "다시", "또", "제발",
                                              "얼른", "다", "전부", "모두", "하나씩", "그래", "응", "어", "음", "제대로", "똑바로", "잘",
                                              "끝까지", "마저", "please", "now", "just", "again", "it", "do", "go", "ahead"]
    static let proVerbEndings = #"해\s*봐|해\s*줘|해라|하라|해요|해"#
    /// Build 441 review: a short approval of the work under discussion ("그런
    /// 식으로 해줘", "네 그렇게 부탁해요", "ㅇㅋ 그렇게 가자", "Yes, go ahead", "Sure, go
    /// for it"): assent and manner words around a pro-verb, and nothing else. It
    /// orders the work an earlier turn proposed, a HARD order the local reading
    /// never lowers (measured 2026-10-27: the 9B model read every one of these
    /// as chat/light/none). Assent alone ("좋아", "Sounds good") orders nothing.
    static let approvalEndings = #"진행\s*(?:해\s*(?:줘|주세요|봐)?|하자|합시다|시켜)?|부탁\s*(?:해요|해|합니다|드려요|드립니다|드림)?|해\s*봐|해\s*줘|해\s*주세요|해라|하라|해요|하자|합시다|가자|갑시다|해|ㄱㄱ|고고"#
    static let approvalWords: Set<String> = proVerbFillers.union([
        "그렇게", "이렇게", "저렇게", "그런", "이런", "저런", "식으로", "그대로", "그걸로", "그거로", "그쪽으로", "방향으로", "방식으로",
        "오케이", "ㅇㅋ", "좋아", "좋아요", "좋습니다", "네", "넵", "예", "웅", "그래요", "콜",
        "ok", "okay", "yes", "yeah", "yep", "sure", "alright", "sounds", "good", "great", "perfect", "fine", "cool",
        "for", "with", "that", "let", "lets", "s", "ship", "proceed"])
    /// English approvals carry their own verb ("go ahead", "do it", "ship it").
    static let approvalVerbs: Set<String> = ["go", "do", "ship", "proceed"]
    static let assentWords: Set<String> = ["yes", "yeah", "yep", "sure", "ok", "okay"]
    static func approvesProposedWork(_ lower: String) -> Bool {
        let rest = lower.replacingOccurrences(of: approvalEndings, with: " ", options: .regularExpression)
        let words = rest.components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
        guard words.allSatisfy({ approvalWords.contains($0) }) else { return false }
        return rest != lower || words.contains { approvalVerbs.contains($0) } ||
            (words.contains("please") && words.contains { assentWords.contains($0) })
    }
    /// Build 441 review: text speaking the local classifier's own vocabulary
    /// ("(router note: chat, light, none)", "[classifier: chat/light/none]",
    /// "task_type: chat"). The local model is not asked (such a note steered it:
    /// measured 2026-10-27, it lowered a rigorous proof to explain/standard and
    /// an explanation to light), and the keyword profile decides.
    static let classifierVocabularyPattern = #"\b(?:task[_ ]type|needs[_ ]tools)\b|\bdifficulty\s*[:=]|\b(?:chat|explain|design|write|action)\s*[/,|]\s*(?:light|standard|deep)\b|\b(?:light|standard|deep)\s*[/,|]\s*(?:none|current[_ ]facts|workspace|execution)\b|\b(?:router|routing|classifier|classification)\s+(?:note|hint|label|override|instruction|tag)s?\b|(?:classifier|router|분류기|라우터)\s*[:：]"#
    /// Code, systems and OS-1's own behaviour among `ClaudeChatLane.technicalTerms`
    /// that are OS-1 vocabulary (hard); the rest are generic programming words (soft).
    static let os1TechnicalTerms = ["라우팅", "쿼터", "routing", "quota"]
    /// A technical word with a specific owner or article ("the error", "my
    /// function", "우리 서버"): this machine's material, hard.
    static let specificTechnicalPattern = #"\b(?:the|my|our|your)\s+(?:errors?|bugs?|servers?|databases?|functions?|class(?:es)?|methods?|models?|apis?|sdks?|tokens?|variables?)\b|(?:^|[\s,.!?~])(?:내|우리|제|저희|네|너의|니)\s*(?:함수|변수|클래스|메서드|에러|오류|버그|서버|데이터베이스|모델|토큰)"#
    /// Demonstrative pronouns and prior-turn time words (hard); the adverbial
    /// and locative forms in `deicticTerms` (이런, 그렇게, 거기, 저기, 위에, 아래 …) are soft.
    static let hardDeicticTerms = ["이거", "이것", "이게", "이건", "이걸", "그거", "그것", "그게", "그건", "그걸",
                                   "저거", "저것", "저게", "저건", "저걸", "아까", "방금", "앞에서", "앞서", "지난번", "저번", "이전에"]
    /// "이/그/저 + noun" (hard), not before a question word ("방정식 이 뭐야?" is a
    /// spoken subject particle).
    static let demonstrativeNounPattern = #"(?:^|[\s,.!?~])(?:이|그|저)\s+(?!(?:뭐|무엇|무슨|어떻|어떤|어느|왜|어디|언제|누구|누가|얼마|몇))[가-힣A-Za-z]"#
    /// The content above or below in this conversation ("위에 쓴 거", "아래 내용"), hard.
    static let aboveBelowReferentPattern = #"(?:위|아래)(?:에서|에|의|쪽)?\s*(?:말|쓴|적은|적힌|얘기|이야기|설명|내용|글|코드|답|대답|문단|문장|목록|리스트|표|거|것|링크|사진|이미지|파일|부분|예시|질문)"#
    /// English references that stay hard; "this/these/those" before a time
    /// noun ("this week") is a date, not a referent.
    static let hardDeicticWords = ["above", "earlier", "previous", "attached", "you said", "you mentioned", "you told",
                                   "you wrote", "your answer", "your last", "your previous", "last answer", "previous answer"]
    /// The owner's own files or machine: possessive + a file, folder,
    /// document or machine noun (hard material, beside attached material).
    static let ownerMaterialPattern = #"(?:^|[\s,.!?~])(?:내|우리|제|저희)\s*(?:데스크탑|데스크톱|바탕화면|다운로드|폴더|파일|문서|보고서|자료|사진|메모|드라이브|맥북|컴퓨터|노트북)|\b(?:my|our)\s+(?:desktop|downloads|folders?|files?|documents?|reports?|notes|photos?|drive|computer|mac|macbook|laptop)\b"#
    static let hardEnglishDemonstrative = #"\b(?:this|these|those)\b(?!\s+(?:week|weekend|year|month|morning|afternoon|evening|night|quarter|season|semester|time|spring|summer|fall|autumn|winter)\b)"#

    /// Whether `lower` (normalized, lower-cased) orders only the work under
    /// discussion: a soft ending with nothing left but fillers.
    static func bareProVerb(_ lower: String) -> Bool {
        let rest = lower.replacingOccurrences(of: proVerbEndings, with: " ", options: .regularExpression)
        let words = rest.components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
        return words.allSatisfy { proVerbFillers.contains($0) }
    }

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
        // Build 441 part 3: the owner's own files or machine ("내 데스크탑에 있는
        // 보고서", "my documents"): material on this machine, a hard rail
        // (a generic imperative ending no longer carries such a request alone).
        if matches(ownerMaterialPattern, lower) { signals.insert("owner_material") }
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
        let externalAction = externalActions.contains(where: lower.contains) || matches(deliveryPattern, lower) ||
            matches(englishExternalAction, lower)
        if externalAction { signals.insert("external_action") }
        // Build 441 review: approving the proposed work orders it (hard).
        let approval = approvesProposedWork(lower)
        if approval { signals.insert("approval") }
        if matches(classifierVocabularyPattern, lower) { signals.insert("classifier_vocabulary") }
        let order = approval || ClaudeChatLane.asksForWorkBeyondAnswer(value) || matches(englishOrder, lower) ||
            ClaudeChatLane.orderTerms.contains(where: lower.contains) || placementOrders.contains(where: lower.contains) ||
            matches(definitionOrder, lower)
        if order { signals.insert("work_order") }
        // Build 441 part 3: an order resting only on soft endings is a soft rail.
        if order {
            let residual = lower.replacingOccurrences(of: ClaudeChatLane.answerImperative, with: " ", options: .regularExpression)
            let hardOrder = approval || ClaudeChatLane.actionTerms.contains { !softActionTerms.contains($0) && residual.contains($0) } ||
                matches(englishOrderPattern(englishOrderVerbs.filter { !softEnglishOrderVerbs.contains($0) }), lower) ||
                ClaudeChatLane.orderTerms.contains { !softOrderTerms.contains($0) && lower.contains($0) } ||
                placementOrders.contains { !softPlacementOrders.contains($0) && lower.contains($0) } ||
                matches(locativePlacement, lower) || matches(definitionOrder, lower) || bareProVerb(lower)
            if !hardOrder { signals.insert("soft_order") }
        }
        // Machine material resting only on generic programming words in a general question.
        if signals.contains("machine_material") {
            let hardMaterial = mentions(ClaudeChatLane.projectTerms) || mentions(ClaudeChatLane.workspaceTerms) ||
                mentions(ClaudeChatLane.localWorkTerms) || mentions(os1TechnicalTerms) ||
                mentions(workspaceStateTerms) || mentions(ownerProjectTerms) ||
                lower.range(of: ClaudeChatLane.machinePathPattern, options: .regularExpression) != nil ||
                lower.range(of: #"[A-Za-z0-9_\-]\.[A-Za-z]{1,6}(?![A-Za-z])"#, options: .regularExpression) != nil ||
                matches(specificTechnicalPattern, lower)
            if !hardMaterial { signals.insert("soft_material") }
        }
        // A deictic resting only on adverbial or locative demonstratives.
        if signals.contains("deictic") {
            let hardDeictic = hardDeicticTerms.contains(where: lower.contains) || mentions(hardDeicticWords) ||
                matches(hardEnglishDemonstrative, lower) || matches(priorTurnPattern, lower) ||
                matches(demonstrativeNounPattern, lower) || matches(aboveBelowReferentPattern, lower)
            if !hardDeictic { signals.insert("soft_deictic") }
        }
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
                                           "owner_material", "deictic", "status_check_in", "status_question", "failure_complaint",
                                           "external_action"]) { tool = .workspace }
        else if signals.contains("current_facts") { tool = .currentFacts }
        else { tool = .none }

        let blocked = write || shellNeed || order || externalAction || textOperation ||
            !signals.isDisjoint(with: ["material", "named_path", "image", "machine_material", "external_system",
                                       "owner_material", "failure_complaint", "status_check_in", "status_question"])
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
        mentionsAny(qualityRequestTerms, in: request)
    }
    /// Review of 442 (DESIGN-3 "strongest-model or think-hard wording still
    /// forces the reference"): the same owner words in the word orders and
    /// inflections the fixed phrases miss ("추론을 최대로", "아주 깊이 있게
    /// 생각해서", "최선을 다해서 깊이 고민", "최대한 신중히 생각", "최고 수준의
    /// 모델로", "think very carefully", "your strongest reasoning"): an
    /// intensifier before a thinking verb within a few characters, a thinking
    /// noun before a maximum, or a superlative before a model, reasoning or
    /// effort noun. Read ONLY where a node could leave the reference (the
    /// catalog's capability routes, DESIGN-4: deep and standard answers): it
    /// never touches the profile, so light routing stays build 441's. A miss
    /// costs the δ = 0 promise, a false hit only the reference's price, so the
    /// forms lean wide (review of DESIGN-4: "think … hard" within five words,
    /// 심사숙고, 머리를 굴려, 온 힘을 다해, the highest reasoning level).
    static let referenceRequestPatterns = [
        #"(?:최대한|최대로|최대치로|최고로|최선을\s*다해|신중하게|신중히|깊이|깊게|깊은|깊숙이|곰곰이|곰곰히|오래|충분히|철저하게|철저히|꼼꼼하게|꼼꼼히|치밀하게|심도\s*있게|진지하게|열심히|빡세게|천천히)[^.?!\n]{0,10}?(?:생각|고민|추론|숙고|리즈닝|궁리|따져|따지|따질)"#,
        #"(?:생각|고민|추론|리즈닝|사고력)\s*(?:을|를|은|는|도|이|가)?\s*(?:최대|최고|끝까지|깊이|깊게|많이|오래|충분히|최선|극한)"#,
        #"(?:추론|리즈닝|생각|사고)\s*(?:강도|레벨|수준|노력|모드|단계|effort|level)\s*(?:을|를|은|는)?\s*(?:최대|최고|최상|max)"#,
        // Review of DESIGN-4: 심사숙고 / 숙고 alone, 머리를 (최대한) 굴려,
        // 온 힘·전력·총력을 다해, and a superlative before a reasoning noun
        // ("가장 높은 추론 단계로").
        #"숙고"#,
        #"머리\s*(?:를|좀)?[^.?!\n]{0,8}?(?:굴려|굴리|굴러|쥐어\s*짜)"#,
        #"(?:온\s*힘|전력|총력|사력|혼신의\s*힘)\s*(?:을|를)\s*(?:다\s*(?:해|하)|기울)"#,
        #"(?:가장|제일|최고|최대|최상)\s*(?:높은|강한|깊은|센)?\s*(?:의\s*)?(?:추론|리즈닝)"#,
        #"(?:가장|제일)\s*(?:높은|깊은|강한)\s*(?:사고|생각)\s*(?:단계|강도|레벨|수준|모드)"#,
        #"(?:최고|최상|최강|최상위)\s*(?:수준|성능|사양|레벨|급|품질)?\s*(?:의)?\s*(?:ai\s*)?(?:모델|엔진|두뇌)"#,
        #"(?:가장|제일)\s*(?:좋은|강한|강력한|똑똑한|뛰어난|센|높은|우수한|유능한|성능\s*좋은|성능이\s*좋은|성능\s*높은)\s*(?:ai\s*)?(?:모델|엔진)"#,
        #"최선을\s*다(?:해|하)"#,
        #"(?<![a-z0-9])(?:think|thinks|thinking|reason|reasoning)\s+(?:[a-z]+\s+){0,5}?(?:hard|harder|hardest|carefully|deeply|thoroughly|rigorously)(?![a-z0-9])"#,
        // Review of DESIGN-4: "think step by step and very hard", "be as
        // rigorous and careful as humanly possible", "spare no effort".
        #"(?<![a-z0-9])(?:think|thinks|thinking|reason|reasoning)\s+(?:it\s+)?(?:through\s+)?step[\s-]+by[\s-]+step\s*,?\s+(?:[a-z]+\s+){0,3}?(?:hard|harder|hardest|carefully|deeply|thoroughly|rigorously)(?![a-z0-9])"#,
        #"(?<![a-z0-9])as\s+(?:rigorous|rigorously|careful|carefully|thorough|thoroughly|deep|deeply|hard|precise|precisely)(?:\s*(?:,|and|&)\s*[a-z]+){0,2}\s+as\s+(?:is\s+)?(?:humanly\s+)?(?:you\s+)?(?:can|possible)(?![a-z0-9])"#,
        #"(?<![a-z0-9])spare\s+no\s+effort(?![a-z0-9])"#,
        #"(?<![a-z0-9])(?:strongest|best|deepest|maximum|max|maximal|most\s+careful|most\s+rigorous|most\s+thorough|highest|full|most\s+capable|smartest|most\s+advanced|most\s+intelligent|top|hardest)\s+(?:possible\s+|available\s+)?(?:reasoning|thinking|model|effort|brainpower)(?![a-z0-9])"#,
        #"(?<![a-z0-9])(?:carefully|rigorously|thoroughly|deeply|hard)\s+as\s+(?:you\s+)?(?:can|possible)(?![a-z0-9])"#,
        #"(?<![a-z0-9])(?:take\s+your\s+time|ultra-?think|extended\s+thinking)(?![a-z0-9])"#,
    ]
    /// The owner asking for the strongest model or more thinking, in fixed
    /// phrases (`asksForStrongest`) or the forms above. The catalog builder
    /// reads it before it lets a deep node bind a capability row.
    public static func asksForReference(_ request: String) -> Bool {
        if asksForStrongest(request) { return true }
        let lower = request.precomposedStringWithCanonicalMapping.lowercased()
        return referenceRequestPatterns.contains { lower.range(of: $0, options: .regularExpression) != nil }
    }
    /// Build 442: a proof, derivation or rigour marker (`deepFloorPatterns`),
    /// read on any request: the combined difficulty never falls below deep.
    public static func deepFloor(_ request: String) -> Bool {
        let lower = request.precomposedStringWithCanonicalMapping.lowercased()
        return deepFloorPatterns.contains { lower.range(of: $0, options: .regularExpression) != nil }
    }
    /// ASCII terms as whole words, Korean terms as substrings (the profile's rule).
    static func mentionsAny(_ terms: [String], in request: String) -> Bool {
        let lower = request.precomposedStringWithCanonicalMapping.lowercased()
        return terms.contains { term in
            term.unicodeScalars.allSatisfy(\.isASCII)
                ? lower.range(of: "(?<![A-Za-z0-9])" + NSRegularExpression.escapedPattern(for: term) + "(?![A-Za-z0-9])",
                              options: .regularExpression) != nil
                : lower.contains(term)
        }
    }

    /// Whether the keyword rails already fix this request's route, so the
    /// local classifier has nothing it may decide: HARD work (a write, shell
    /// need, external action or a hard order), a HARD workspace need, a text
    /// operation (a quality-bearing text deliverable stays on policy A) or the
    /// owner asking for the strongest model. The local model can never lower
    /// these, so it is not asked (no latency, no residency) and the profile
    /// stays `keyword_v1`. A rail resting on soft evidence only (build 441
    /// part 3) does not decide: the local reading does. Nor is it asked when
    /// the request speaks the classifier's own vocabulary (build 441 review).
    public static func railsDecide(_ keyword: RequestProfile, request: String) -> Bool {
        hardWorkRail(keyword) || hardWorkspaceRail(keyword) || keyword.signals.contains("text_operation") ||
            keyword.signals.contains("classifier_vocabulary") || asksForStrongest(request)
    }

    /// Build 441 part 3: the keyword profile is work for a reason the local
    /// reading may never lower (write scope, shell need, an external action or
    /// a hard order), not only for a soft imperative ending.
    public static func hardWorkRail(_ keyword: RequestProfile) -> Bool {
        let s = keyword.signals
        return keyword.answerKind == .work && (s.contains("write_scope") || s.contains("shell") ||
            s.contains("external_action") || (s.contains("work_order") && !s.contains("soft_order")))
    }
    /// Build 441 part 3: the keyword profile needs the workspace for a reason
    /// the local reading may never lower (material, a path, an image, an
    /// external system, a status check-in or question, a failure complaint, an
    /// external action, project or OS-1 material, a referring deictic), not
    /// only for a generic programming word or an adverbial demonstrative.
    public static func hardWorkspaceRail(_ keyword: RequestProfile) -> Bool {
        let s = Set(keyword.signals)
        return keyword.toolNeed == .workspace &&
            (!s.isDisjoint(with: ["material", "named_path", "image", "external_system", "owner_material", "status_check_in",
                                  "status_question", "failure_complaint", "external_action"]) ||
                (s.contains("machine_material") && !s.contains("soft_material")) ||
                (s.contains("deictic") && !s.contains("soft_deictic")))
    }

    /// The profile the RCC catalog emits: the keyword profile's hard rails
    /// first, then the local classifier's reading for everything else
    /// (DESIGN-2 "Combination"). Deterministic for the same keyword profile,
    /// request and local answer.
    ///
    /// - Hard rails stand and are never lowered: work (write scope, shell, a
    ///   hard order or external action) stays work; a hard workspace need
    ///   (material, a path, an image, project or OS-1 material, an external
    ///   system, a referring deictic, a status check-in or question, a failure
    ///   complaint) stays workspace; current facts stay current facts; a text
    ///   operation stays a `write` task; the owner asking for the strongest
    ///   model stays deep.
    /// - Soft rails (build 441 part 3: `soft_order`, `soft_material`,
    ///   `soft_deictic` alone) yield to an adopted local reading (signal
    ///   `llm_overrules_soft_rail`) and stay rails without one.
    /// - The local model may raise: to current facts, to a workspace need, or
    ///   (needs_tools `execution`) to work. An `action` label is work too,
    ///   unless the keywords heard an answer (an answer stem) or it reads a
    ///   current-facts lookup: then, with no execution need, it reads as an
    ///   `explain` answer (build 441 review).
    /// - A write or design reading of a request in which the keywords heard
    ///   neither an answer nor a composing order keeps the keyword `unknown`:
    ///   it may be a change or a send (build 441 review).
    /// - Otherwise its task_type, difficulty and needs_tools decide.
    /// - Without a local answer (none, or the request speaks the classifier's
    ///   own vocabulary): the keyword profile as it is. Build 441 review: a
    ///   keyword `unknown` stays `unknown` (no answer default): an answer
    ///   default gave unread work ("Pay the electricity bill", "랜딩 페이지 카피
    ///   영어로 갈아끼워") the read-only scope and the tool-free chat lane whenever
    ///   the local model was down, cold or not asked (any non-Auto preference).
    public static func combine(keyword k: RequestProfile, request: String,
                               local: LocalRequestClassifier.Answer?, model: String?) -> RequestProfile {
        var signals = Set(k.signals)
        let quality = asksForStrongest(request)
        if quality { signals.insert("quality_request") }
        let workRail = k.answerKind == .work, workspaceRail = k.toolNeed == .workspace
        let factsRail = k.signals.contains("current_facts"), textOperation = k.signals.contains("text_operation")
        // Build 442: the local reading's domain (prompt v3; `general` is none),
        // carried on every adopted reading; a keyword-only profile has none.
        var domain: Domain? = nil
        func finish(_ kind: AnswerKind, _ tool: ToolNeed, _ difficulty: Difficulty, _ task: TaskType,
                    _ classifier: String, _ extra: [String]) -> RequestProfile {
            // Diagnostic tokens yield to the evidence under the wire bound.
            let all = signals.union(extra).count <= maximumSignals ? signals.union(extra) : signals
            return RequestProfile(answerKind: kind, toolNeed: tool, difficulty: kind == .answerOnly ? difficulty : .unknown,
                                  signals: Array(all).sorted(), classifier: classifier, taskType: task,
                                  domain: classifier.hasPrefix(localClassifierPrefix) ? domain : nil)
        }
        guard let local, let model, LocalRequestClassifier.validModelName(model),
              !k.signals.contains("classifier_vocabulary") else {
            let keyword = keywordClassifier
            if workRail { return finish(.work, k.toolNeed, .unknown, textOperation ? .write : .action, keyword, []) }
            if workspaceRail {
                return finish(k.answerKind, .workspace, k.difficulty, k.answerKind == .answerOnly ? .explain : .unknown, keyword, [])
            }
            if textOperation { return finish(k.answerKind, k.toolNeed, .unknown, .write, keyword, []) }
            if k.answerKind == .answerOnly {
                return finish(.answerOnly, k.toolNeed, quality ? .deep : k.difficulty, .explain, keyword, [])
            }
            return finish(k.answerKind, factsRail ? .currentFacts : k.toolNeed, .unknown, .unknown, keyword, [])
        }
        let classifier = localClassifierPrefix + model
        // DESIGN-4 §4: only a model qualified to read the domain names one;
        // the 4B model's domain is ignored (signal `llm_domain_unqualified`).
        let domainRead = LocalRequestClassifier.readsDomain(model: model)
        domain = domainRead ? Domain(rawValue: local.domain.rawValue) : nil
        let labelled = TaskType(rawValue: local.taskType.rawValue) ?? .unknown
        // Build 441 part 3: under an adopted local reading only the HARD rails
        // stand; a soft order, generic programming word or adverbial
        // demonstrative is the local reading's to decide.
        let hardWork = workRail && hardWorkRail(k), hardWorkspace = workspaceRail && hardWorkspaceRail(k)
        let softYield = (workRail && !hardWork) || (workspaceRail && !hardWorkspace)
        // The keyword's answer kind without a soft order (an order is what made it work).
        let keywordKind: AnswerKind = k.answerKind == .work && !hardWork ? .unknown : k.answerKind
        let keywordTool: ToolNeed = k.toolNeed == .workspace && !hardWorkspace ? .none : k.toolNeed
        let reading = ["llm_task_" + local.taskType.rawValue, "llm_difficulty_" + local.difficulty.rawValue,
                       "llm_tools_" + local.needsTools.rawValue] + (softYield ? ["llm_overrules_soft_rail"] : []) +
            (domainRead ? [] : ["llm_domain_unqualified"])
        let workTask: TaskType = [.action, .write, .design].contains(labelled) ? labelled : textOperation ? .write : .action
        if hardWork {
            return finish(.work, k.toolNeed, .unknown, workTask, classifier, reading + (workTask != labelled ? ["rail_overrules_llm"] : []))
        }
        // The tool need raises to work (needs_tools `execution`), and so does
        // an "action" label (build 441 review: "다크모드 켜줘" read as
        // action/light/none), unless the keywords heard an answer ("오늘 환율
        // 알려줘", read as action/light/current_facts on 2026-10-27, carries the
        // answer stem 알려) or the reading is a current-facts lookup ("내일 날씨
        // 어때?", read the same way under prompt v2), which only a read-only
        // agent with tools answers (never a tool-free lane): both read as explain.
        let keywordAnswer = k.answerKind == .answerOnly || k.signals.contains("answer_stem")
        if local.needsTools == .execution || (labelled == .action && !keywordAnswer && local.needsTools != .currentFacts) {
            let tool: ToolNeed = keywordTool == .none || keywordTool == .currentFacts ? .workspace : keywordTool
            return finish(.work, tool, .unknown, workTask, classifier,
                          reading + [local.needsTools == .execution ? "llm_raised_work" : "llm_action_is_work"])
        }
        let task: TaskType = labelled == .action ? .explain : labelled
        let unlabelled = labelled == .action ? ["llm_action_without_execution"] : []
        // Build 442: a proof, derivation or rigour marker is a floor the local
        // reading never lowers (signal `deep_floor` when it raised the reading).
        let read = Difficulty(rawValue: local.difficulty.rawValue) ?? .standard
        let floored = deepFloor(request) && read != .deep
        let difficulty: Difficulty = quality || deepFloor(request) ? .deep : read
        let lowered = (k.answerKind == .answerOnly && k.difficulty != difficulty ? ["llm_sets_difficulty"] : []) +
            (floored ? ["deep_floor"] : [])
        if hardWorkspace || local.needsTools == .workspace {
            let kind: AnswerKind = hardWorkspace ? keywordKind : .answerOnly
            return finish(kind, .workspace, difficulty, task, classifier,
                          reading + unlabelled + (hardWorkspace ? [] : ["llm_raised_tools"]) + lowered)
        }
        if textOperation {
            let writeTask: TaskType = [.write, .design].contains(task) ? task : .write
            let tool: ToolNeed = factsRail || local.needsTools == .currentFacts ? .currentFacts : keywordTool
            return finish(keywordKind, tool, .unknown, writeTask, classifier,
                          reading + (writeTask != labelled ? ["rail_overrules_llm"] : []))
        }
        // No rail: the local reading decides; it may only raise current facts.
        let facts = factsRail || local.needsTools == .currentFacts
        // Build 441 review: a write or design reading of a request the keywords
        // heard neither an answer nor a composing order in ("랜딩 페이지 카피 영어로
        // 갈아끼워", "김 대리 앞으로 회의 연기 공지 메일 쏴줘": write/none) may be a
        // change or a send. It keeps the keyword `unknown`: policy A's reference
        // with the writer's scope, never the read-only scope or the tool-free lane.
        if (labelled == .write || labelled == .design) && !keywordAnswer && !k.signals.contains("soft_order") {
            return finish(.unknown, facts ? .currentFacts : .none, .unknown, labelled, classifier,
                          reading + ["keyword_unknown_kept"])
        }
        let notes = (!factsRail && local.needsTools == .currentFacts ? ["llm_raised_tools"] : []) +
            (factsRail && local.needsTools == .none ? ["rail_overrules_llm"] : [])
        return finish(.answerOnly, facts ? .currentFacts : .none, difficulty, task, classifier, reading + unlabelled + notes + lowered)
    }
}
