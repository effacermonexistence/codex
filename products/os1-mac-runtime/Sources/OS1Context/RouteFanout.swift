import Foundation

/// One owner request that names a route for each of its parts:
/// "1+1 GPT한테. 2+2 Codex한테. 3+3 Claude한테. 4+4 Claudecode한테. 라우팅 시켜서
/// 답변 받아와." Until build 295 OS-1 took at most one provider per request
/// (the last one named, Korean spellings only), so this whole sentence reached
/// the router as arithmetic and came back as one local "8" (owner, 2026-10-02).
///
/// The plan runs each part on the surface it names and returns each answer
/// with its own receipt. It only covers parts that are answers from the request
/// itself (questions, arithmetic, short text): anything that touches this
/// machine or asks for work keeps the existing single-route path, so a split
/// never sends file changes to several agents at once.
///
/// Names map to the surfaces OS-1 actually has: GPT → `gpt-chat` (GPT on the
/// Codex account, chat lane), ChatGPT → `chatgpt` (a handoff: OS-1 cannot read
/// ChatGPT's answer), Codex → `codex`, Claude → `claude-chat`, Claude Code →
/// `claude`.
public struct RouteFanout: Equatable, Sendable {
    public struct Target: Equatable, Sendable {
        public let surface: ProviderSurface
        /// The name as written, with its particle ("Codex한테", or "GPT랑" in
        /// a list that shares the last name's particle).
        public let mention: String
        /// What this route is asked, with the routing words removed.
        public let payload: String
    }

    public let targets: [Target]
    /// Clauses before the first and after the last named part ("자 내가 하나만
    /// 요청해볼게", "라우팅 시켜서 답변 받아와"). Shown, never sent.
    public let frame: [String]

    public static let maximumTargets = 8
    public static let maximumCharacters = 600
    public static let maximumPayloadCharacters = 300

    /// Longest names first, so "Claude Code" never reads as "Claude" + "Code"
    /// and "ChatGPT" never as "GPT". Voice-dictation spellings included.
    static let names: [(pattern: String, surface: ProviderSurface)] = [
        (#"claude[\s\-]?code|(?:클로[드더즈]|클라우드)[\s]?코드"#, .claude),
        (#"chat[\s\-]?gpt|챗[\s]?gpt|챗[\s]?지피티|채팅[\s]?gpt|채찌"#, .chatgpt),
        (#"gpt|지피티|쥐피티"#, .gptChat),
        (#"codex|코[덱댁][스세]|코덱센트|코덱선트"#, .codex),
        (#"claude|클로[드더즈]|클라우드(?!플레어)"#, .claudeChat),
    ]
    /// The Korean dative particle that turns a name into a destination.
    static let particle = #"(?:한테|에게|께)(?:는|도|만)?"#
    /// Names listed before a destination share its particle: a Korean case
    /// particle attaches to the last name of a coordination but covers all of
    /// them ([A랑 B]한테). Owner, 2026-10-04: "GPT랑 코덱스랑 클로드랑 클로드
    /// 코드한테 1+2 이런거 해봐" reached only Claude Code, the one name the
    /// particle touched. Only a name joined straight to another name is listed;
    /// "GPT랑 비교해서 Claude한테" keeps GPT as company, not a destination.
    static let conjunction = #"(?:\s?(?:이랑|랑|하고|하구|와|과)|\s*[,，、/·&])\s*(?:(?:및|그리고|and)\s+)?|\s+(?:및|그리고|and)\s+"#
    /// Routing as the subject of the sentence, not an instruction to route:
    /// "라우팅이 이상해", "라우팅 되게 해줘", "라우팅 잘 됐는지".
    static let routingTalk = #"라우팅\s*(?:이|가|은|는|도|만)?\s*(?:(?:잘|제대로|다|안|못)\s*)?(?:되|돼|됐|된|됨|됩)|라우팅(?:이|가|은|는)(?![가-힣])"#
    /// Routing words, not content: removed from each part before it is sent.
    static let chatter = [
        #"라우팅\s*(?:을|도)?\s*(?:시켜(?:서|봐줘|봐|줘|라|보고)?|해(?:서|봐|줘)?)?"#,
        #"(?:답변?|결과|응답)\s*(?:을|를|도|은|는|이|가)?\s*(?:좀\s*|다\s*|빨리\s*|각각\s*)*(?:받아와줘|받아와|받아서|받아봐|가져와줘|가져와|알려줘|보여줘|줘)"#,
        #"시켜(?:봐봐|봐바|보고|서|봐|라|줘|고)?|시키(?:라고|고|라)|돌려(?:봐|줘|서|라)?"#,
        #"(?:보내|넘겨|전달해)(?:서|봐|줘|고|라)?|전달하고"#,
        #"물어(?:봐줘|보고|봐서|봐|볼래)|질문해(?:줘|봐)?"#,
        #"(?:해봐봐|해봐|해 봐|해줘|해라|해보자|해보고|하라고|해)(?=\s|$)"#,
        #"각각|제발|\bsend\b|\bask\b"#,
    ]
    /// Short negation ("안 갔잖아", "안돼", "못 받았어") counts as well as the long form.
    static let negation = #"말고|말아|하지\s*마|시키지\s*마|지\s*마(?![가-힣A-Za-z])|지\s*마라|지\s*말(?:고|아|라|자|래|게)|진\s*마(?![가-힣A-Za-z])|필요\s*없|않|(?:^|\s)(?:안|못)(?=\s|$|돼|됐|되|가|갔|해|했|와|왔)|don'?t|do not|instead of|rather than|never\s*mind|취소|cancel"#
    /// A handover verb left in a part means its name is an argument, not a
    /// destination: "클로드한테도 넘기게 해 왜 코덱스한테만 넘기냐?" (owner,
    /// 2026-09-23) is a complaint about routing, not two questions. Past and
    /// relative forms ("보냈어?", "넘어간 거") report a routing, never ask one.
    static let routingVerbs = #"넘기|넘겨|넘긴|넘겼|넘어가|넘어갔|넘어간|보내|보낸|보냈|시키|시켜|시킨|시켰|맡기|맡겨|맡긴|맡겼|라우팅|돌리|돌려|돌린|돌렸|전달(?:한|했|된|됐|되)|물어|\broute\b|\bsend\b|\bforward\b|\bhand\s+(?:off|over)\b"#
    /// Words that carry no question of their own.
    static let fillers: Set<String> = ["그리고", "근데", "그런데", "그럼", "그래서", "또", "자", "아", "야", "왜", "뭐",
                                       "어떻게", "이런", "그런", "저런", "이런거", "그런거", "저런거", "거", "것", "이것",
                                       "그것", "저거", "저것", "좀", "일", "작업", "다시", "한번", "빨리", "얼른", "바로",
                                       "지금", "그냥", "일단", "먼저", "같이", "동시에", "다", "둘", "모두", "전부", "각자",
                                       "따로", "제대로", "랑", "이랑", "하고", "와", "과",
                                       "and", "but", "so", "then", "why", "what", "how"]
    /// "같은 질문 Claude한테도": the part is the previous part again.
    static let repeatPrevious = #"^(?:같은\s*(?:질문|거|것|문제)|똑같(?:이|은\s*(?:질문|거|것))|동일한\s*(?:질문|거|것)|(?:the\s+)?same(?:\s+(?:question|thing))?)(?:도|을|를|으로|로)?$"#
    /// Work on this machine or in a codebase: such a part keeps the normal path.
    static let workTerms = ["함수", "클래스", "버그", "구현", "작성", "추가", "리팩토링", "리팩터링", "빌드", "배포",
                            "커밋", "푸시", "설치", "테스트", "refactor", "implement", "build", "deploy", "commit",
                            "push", "install", "fix", "bug", "function", "class", "test"]
    /// "하나씩": each listed name gets the next part, in order (owner,
    /// 2026-10-06: "클로드랑 클로드 코드 GPT 코덱스 다 라우팅 하나씩 시켜봐. 1 plus 1,
    /// 2 plus 2, 3 plus 3, 4 plus 4." reached Claude Code alone: no name carried
    /// a particle, so nothing was a destination). 각각/각자/차례로 are left out:
    /// "각각 물어봐" asks every name the same thing.
    static let distributive = #"(?:하나\s?씩|한\s?개\s?씩|1\s?개\s?씩|한\s?문제\s?씩)(?:만)?|(?<![A-Za-z])one\s+each(?![A-Za-z])"#
    /// A routing that already happened is a report or complaint, not an order.
    static let reportedRouting = #"보냈|넘겼|시켰|맡겼|돌렸|넘어갔|전달했|전달됐|라우팅\s*(?:이|가)?\s*(?:됐|된|안\s|못\s)|(?<![A-Za-z])(?:sent|routed)(?![A-Za-z])"#
    /// The one order a roster sentence gives: hand the parts over.
    static let rosterVerb = #"(?:라우팅\s*(?:을|도)?\s*)?(?:시켜|돌려|맡겨|넘겨|보내|물어|전달해|질문해|던져|뿌려|내)\s?(?:봐줘|봐요|봐라|봐봐|봐바|봐|보자|볼래|보세요|줘봐|줘요|줘|주세요|줄래|서|라|보고)?|(?:라우팅\s*)?해\s?(?:봐줘|봐봐|봐|보자|줘|라|주세요)(?=\s|$)|(?<![가-힣])(?:줘\s?봐|부탁해)|(?<![A-Za-z])(?:ask|send|route)(?![A-Za-z])"#
    /// What may stand around the names and that order: openers, "다", counts,
    /// verb endings. No question word ("왜 클로드랑 GPT 하나씩 시켜" is a complaint).
    static let rosterWords: Set<String> = ["그럼", "자", "야", "너", "그러면", "이번엔", "이번에", "이번에도", "이제", "다", "모두", "전부",
                                           "둘", "셋", "넷", "다섯", "여섯", "일곱", "여덟", "두", "세", "네", "개", "좀", "한번", "그냥",
                                           "일단", "바로", "지금", "같이", "따로", "봐", "줘", "봐줘", "요", "주세요", "줄래", "오케이",
                                           "음", "아", "좋아", "그래", "다시", "한", "번", "순서대로", "차례로", "차례대로",
                                           "문제", "질문", "계산", "풀게", "to", "각각", "어", "그", "근데", "이번에는", "한번만",
                                           "나눠서", "산수", "덧셈", "주실래요", "봐봐", "봐바", "그니까", "그러니까", "랑", "이랑", "하고",
                                           "빨리", "얼른", "가자",
                                           "please", "ok", "okay", "all", "of", "them"]
    /// "…, 2+2 답변 받아와": the request to return the answers, after the last part.
    static let trailingReturn = #"\s*(?:답변?|결과|응답)\s*(?:을|를|도)?\s*(?:좀\s*|다\s*|빨리\s*)*(?:받아와(?:줘|요)?|받아줘|받아서\s*보여줘|가져와(?:줘|요)?|알려줘(?:요)?|보여줘(?:요)?)\s*$"#
    static let opener = #"(?:자|야|음|아|그럼|오케이|좋아|그래|그니까|이번엔|이번에|이제|일단|hey|ok|okay)"#
    static let tryVerb = #"해\s?(?:보자|볼게|봐|볼까)"#
    /// The sentences that may stand beside the parts, each matched whole. A
    /// side sentence is never sent, so anything else (a complaint, a question,
    /// a correction, a deferral, a follow-up order) keeps the request whole.
    /// Whole sentences, not allowed words: words that are each harmless make
    /// "그냥 내가 해", "빌드 336 끝나면 시켜", "그리고 테스트 다 돌려" (second
    /// hunt of build 334); a deny list lost "라우팅 테스트야" and "답이 뭔지 말해줘"
    /// (first hunt).
    /// Only before the parts: "자 내가 하나만 요청해볼게", "추가로 하나 더" (after
    /// them, "하나 더" asks for more).
    static let leadingFrameTemplates: [String] = [
        "^(?:\(opener)[\\s,]*)*(?:내가\\s*)?(?:하나만?\\s*)?요청(?:해\\s?볼게|할게)$",
        #"^(?:추가로\s*)?하나\s*더$"#,
    ]
    static let frameTemplates: [String] = [
        // An opener alone: "음", "Hey,", "오케이".
        "^(?:\(opener)[\\s,]*)+$",
        // A test announcement: "자 테스트 해보자", "라우팅 테스트야", "음 라우팅 테스트 간다",
        // "야 라우팅 잘 됐는지 일단 확인해 보자", "라우팅 확인", "라우팅 잘 되는지 보자".
        "^(?:\(opener)[\\s,]*)*(?:라우팅\\s*(?:이|가)?\\s*)?(?:잘\\s*)?(?:(?:되는지|됐는지)\\s*)?(?:일단\\s*|한번\\s*)?(?:(?:테스트|확인|시험)(?:\\s*(?:야|다|중|간다|가자)|\\s*(?:한번\\s*)?\(tryVerb))?|보자)$",
        #"^(?:(?:hey|ok|okay)[\s,]*)*(?:quick\s+)?(?:routing\s+)?test(?:ing)?$"#,
        // A build announcement: "빌드 332 들어갔으니까 확인해보자", "빌드 335 테스트야", "OS-1 새로 설치했어".
        "^(?:\(opener)[\\s,]*)*(?:(?:빌드|build)\\s*[0-9]+\\s*(?:테스트(?:야|다)?|(?:들어갔|깔렸|설치됐|설치했)(?:으니까|어))|(?:os-?1\\s*)?(?:새로\\s*)?(?:설치|업데이트)(?:했|됐)(?:어|으니까))(?:\\s*(?:라우팅\\s*)?(?:확인|테스트)\\s*\(tryVerb))?$",
        // The owner's own openers: "자 내가 하나만 요청해볼게", "추가로 하나 더", "간단한 거".
        #"^간단한\s*(?:거|걸로)$"#,
        // The order to route alone: "보내", "시켜봐", "라우팅 해봐".
        "^(?:\(opener)[\\s,]*)*(?:라우팅\\s*(?:을\\s*)?)?(?:시켜|보내|물어|돌려|던져|맡겨|해)\\s?(?:봐줘|봐|줘|라|보자)?$",
        // The request to return the answers: "라우팅 시켜서 답변 받아와", "답이 뭔지 말해줘",
        // "헷갈리지 않게 따로 받아와", "답변 작성되면 알려줘", "그리고 결과 맞는지 말해".
        #"^(?:(?:그리고|각각|각자|둘\s*다|다|빨리|얼른|따로|헷갈리지\s*않게)\s*)*(?:라우팅\s*(?:을\s*)?(?:시켜서|해서)\s*)?(?:(?:답변?|결과|응답)(?:이|가|을|를|도|은|는)?\s*)?(?:(?:좀|다|빨리|얼른|각각|따로)\s*)*(?:(?:작성되면|나오면|오면|끝나면|도착하면)\s*(?:바로\s*)?)?(?:받아와(?:줘|요)?|받아줘|받아서\s*보여줘|가져와(?:줘|요)?|알려줘(?:요)?|보여줘(?:요)?|(?:뭔지\s*|맞는지\s*)?말해(?:줘)?)$"#,
        #"^(?:다\s*)?(?:끝나면|나오면|오면)\s*(?:답변?|결과)(?:을|를|도)?\s*(?:(?:좀|다)\s*)*(?:알려줘|보여줘|말해줘?|받아와)$"#,
        // A return condition: "안 되면 말해", "하나라도 못 받으면 알려줘".
        #"^(?:하나라도\s*)?(?:안|못)\s*(?:되면|받으면|오면|나오면)\s*(?:바로\s*)?(?:말해(?:줘)?|알려줘(?:요)?)$"#,
    ]
    /// One arithmetic expression ("1+1", "1 plus 1", "2 곱하기 3", "1,000 × 2").
    static let expression = #"(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?(?:\s*(?:[-+*/×÷^%]|plus|minus|times|x|divided\s+by|더하기|빼기|곱하기|나누기|플러스|마이너스)\s*(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?)+"#
    /// A whole part is one expression, with at most a short question tail
    /// ("1+1은?", "2+2는 뭐야", "3+3=?"); a date or a phone number is not one.
    static let wholePart = "^\\s*" + expression + #"(?:\s*(?:은|는|이|가|을|를))?(?:\s*(?:뭐야|몇이야|얼마야|뭐지|뭐|몇|얼마))?\s*(?:=\s*)?\??\s*$"#

    public static func plan(_ prompt: String) -> RouteFanout? {
        let text = prompt.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= maximumCharacters, !text.contains("```") else { return nil }
        if let broadcast = parallelBroadcast(text) { return broadcast }
        // A sentence that hands out one part per listed name decides the
        // request alone (paired, or kept whole) unless the parts carry their
        // own names ("GPT랑 코덱스 하나씩 시켜봐. 1+1은 GPT한테, 2+2는 코덱스한테.").
        if let paired = pairing(text) { return paired.plan }
        var targets: [Target] = []
        var frameBefore: [String] = [], frameAfter: [String] = [], sideSentences: [(text: String, leading: Bool)] = []
        var sawTarget = false
        for clause in clauses(text) {
            let found = mentions(in: clause)
            if found.isEmpty {
                if sawTarget { frameAfter.append(clause) } else { frameBefore.append(clause) }
                sideSentences.append((clause, !sawTarget))
                continue
            }
            // A clause without a name between two named ones: whose is it?
            if !frameAfter.isEmpty { return nil }
            sawTarget = true
            let opener = String(clause[clause.startIndex..<found[0].range.lowerBound]).trimmingCharacters(in: .whitespaces)
            // "Codex한테 1+1, Claude한테 2+2": each part follows its name; an
            // opener before the first name ("음", "라우팅 확인", "Hey,") is framing,
            // never the first part (hunt of build 334: "음 GPT한테 1+1, 코덱스한테
            // 2+2" sent GPT "음" and shifted every part one route down).
            let openerIsFrame = !strip(opener).isEmpty && benignFrame(opener)
            let nameFirst = (strip(opener).isEmpty || openerIsFrame) && found.count > 1
            if nameFirst, openerIsFrame { frameBefore.append(opener); sideSentences.append((opener, targets.isEmpty)) }
            for (index, mention) in found.enumerated() {
                let raw: String
                if found.count == 1 {
                    raw = String(clause[clause.startIndex..<mention.range.lowerBound]) + " "
                        + String(clause[mention.range.upperBound...])
                } else if nameFirst {
                    let end = index + 1 < found.count ? found[index + 1].range.lowerBound : clause.endIndex
                    raw = String(clause[mention.range.upperBound..<end])
                } else {
                    let start = index == 0 ? clause.startIndex : found[index - 1].range.upperBound
                    raw = String(clause[start..<mention.range.lowerBound])
                }
                if raw.range(of: routingTalk, options: .regularExpression) != nil { return nil }
                // In a sentence that ends with "?", only a bare part may stand
                // ("2+2는?"); anything more asks about it ("2+2 이런 거 라우팅 해?").
                if endsWithQuestionMark(clause, in: text), !selfContained(raw.trimmingCharacters(in: CharacterSet(charactersIn: " ,，"))) { return nil }
                var payload = part(raw)
                if payload.range(of: repeatPrevious, options: [.regularExpression, .caseInsensitive]) != nil {
                    guard let previous = targets.last?.payload else { return nil }
                    payload = previous
                }
                // A listed name is asked the same part as the name carrying the
                // particle; handing out one part each is `pairing`'s.
                for destination in mention.destinations {
                    targets.append(Target(surface: destination.surface, mention: destination.text, payload: payload))
                }
            }
            if found.count > 1, !nameFirst {
                let tail = String(clause[found[found.count - 1].range.upperBound...])
                if !strip(tail).isEmpty { sideSentences.append((tail, false)); frameAfter.append(strip(tail)) }
            }
        }
        guard targets.count >= 2, targets.count <= maximumTargets else { return nil }
        // Every side sentence is known to be harmless; a roster naming exactly
        // these routes is one too.
        let surfaces = targets.map(\.surface)
        for sentence in sideSentences where !sideSentence(sentence.text, in: text, roster: surfaces, leading: sentence.leading) { return nil }
        for target in targets where !acceptable(target.payload) || !arithmetic(target.payload) { return nil }
        if ambiguousNumbers(targets.map(\.payload)) { return nil }
        return RouteFanout(targets: targets, frame: frameBefore + frameAfter)
    }

    /// A positive request for several provider surfaces, even if its payload is
    /// too ambiguous to split. It must not be recast as a project/research DAG.
    /// This detector grants no dispatch authority: `plan` still validates every
    /// exact self-contained part before making a fan-out plan.
    public static func requestsProviderFanout(_ prompt: String) -> Bool {
        let value = prompt.precomposedStringWithCanonicalMapping.lowercased()
        guard value.count <= 24_000,
              value.range(of: negation, options: [.regularExpression, .caseInsensitive]) == nil,
              value.range(of: #"병렬|parallel|동시에|하나\s*씩|각각"#, options: [.regularExpression, .caseInsensitive]) != nil,
              value.range(of: rosterVerb, options: [.regularExpression, .caseInsensitive]) != nil else { return false }
        return Set(providerNames(in: value).map(\.surface)).count >= 2
    }

    /// The child CLI accepts exactly the same bounded self-contained grammar
    /// as this parser, not arbitrary text selected by a parent process.
    public static func isSafeFanoutPayload(_ payload: String) -> Bool {
        acceptable(payload) && arithmetic(payload) && !ambiguousNumbers([payload])
    }

    private static func providerNames(in text: String) -> [(range: Range<String.Index>, surface: ProviderSurface, text: String)] {
        let alternatives = names.map { "(\($0.pattern))" }.joined(separator: "|")
        let boundary = #"(?=$|\s|[,，、/·&:：.!?]|이랑|랑|하고|와|과|한테|에게|께)"#
        guard let regex = try? NSRegularExpression(pattern: "(?<![A-Za-z0-9가-힣\\-])(?:\(alternatives))\(boundary)", options: [.caseInsensitive]) else { return [] }
        return regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap { match in
            guard let group = (1...names.count).first(where: { match.range(at: $0).location != NSNotFound }),
                  let range = Range(match.range, in: text) else { return nil }
            return (range, names[group - 1].surface, String(text[range]))
        }
    }

    /// Explicit parallel smoke requests broadcast their arithmetic parts. The
    /// whole remainder is checked, so an extra filesystem/research instruction
    /// cannot disappear when expressions are extracted. Speech-number repair
    /// is confined to this validated arithmetic-only grammar.
    private static func parallelBroadcast(_ original: String) -> RouteFanout? {
        guard requestsProviderFanout(original),
              original.range(of: distributive, options: [.regularExpression, .caseInsensitive]) == nil,
              !containsWorkTerm(original),
              original.range(of: reportedRouting, options: [.regularExpression, .caseInsensitive]) == nil else { return nil }
        var text = original
        for (word, number) in [("제로", "0"), ("원", "1"), ("투", "2"), ("쓰리", "3"), ("포", "4"),
                               ("파이브", "5"), ("식스", "6"), ("세븐", "7"), ("에이트", "8"), ("나인", "9")] {
            text = text.replacingOccurrences(of: "(?<![가-힣A-Za-z0-9])\(word)(?![가-힣A-Za-z0-9])", with: number,
                                             options: [.regularExpression, .caseInsensitive])
        }
        let rosters = clauses(text).compactMap { clause -> [(surface: ProviderSurface, text: String)]? in
            guard let run = nameRun(in: clause) else { return nil }; return run.names
        }
        guard let selected = rosters.last, (2...maximumTargets).contains(selected.count),
              Set(selected.map(\.surface)).count == selected.count,
              rosters.allSatisfy({ Set($0.map(\.surface)).isSubset(of: Set(selected.map(\.surface))) }),
              let expressionRegex = try? NSRegularExpression(pattern: expression, options: [.caseInsensitive]) else { return nil }
        let matches = expressionRegex.matches(in: text, range: NSRange(text.startIndex..., in: text))
        let expressions = matches.compactMap { match -> String? in
            guard let range = Range(match.range, in: text) else { return nil }
            var result = String(text[range])
            result = result.replacingOccurrences(of: #"\s*(?:plus|플러스|더하기)\s*"#, with: "+", options: [.regularExpression, .caseInsensitive])
            return result
        }
        guard !expressions.isEmpty, expressions.count <= maximumTargets,
              expressions.allSatisfy(selfContained), !ambiguousNumbers(expressions) else { return nil }
        var remainder = text
        for match in matches.reversed() { if let range = Range(match.range, in: remainder) { remainder.removeSubrange(range) } }
        for name in providerNames(in: remainder).reversed() { remainder.removeSubrange(name.range) }
        remainder = strip(remainder)
        remainder = remainder.replacingOccurrences(of: #"병렬로|병렬|parallel|동시에|간단한\s*(?:거|것|걸)|이런\s*(?:거|것|걸)|이\s?거|아니|(?<![가-힣A-Za-z])뭐(?![가-힣A-Za-z])|각각|네\s*개|[2-8]\s*개|[.。!?]"#,
                                                    with: " ", options: [.regularExpression, .caseInsensitive])
        guard onlyRosterWords(remainder) else { return nil }
        let payload = expressions.joined(separator: ", ")
        guard acceptable(payload), arithmetic(payload) else { return nil }
        return RouteFanout(targets: selected.map { Target(surface: $0.surface, mention: $0.text, payload: payload) }, frame: [])
    }

    /// The text before or after a name, made into the part it carries: the
    /// routing words, an edge "하나씩", an opener ("그럼", "야") and a joining
    /// word ("그리고", "주고") removed. Only the edges: "세 명이 한 개씩 가져가면"
    /// keeps its "한 개씩" (hunt of build 334).
    static func part(_ raw: String) -> String {
        var value = strip(raw)
        let edges = [
            "^(?:\(distributive))\\s*|\\s*(?:\(distributive))$",
            #"^(?:(?:야|자|그럼|음|오케이|그리고|그 다음에|그다음|and|then|주고|묻고|던지고|던져서)\s+)+"#,
            #"\s+(?:그리고|하고|and|then|주고|묻고|던지고|좀|빨리|얼른)$"#,
        ]
        for _ in 0..<2 {
            for pattern in edges {
                value = value.replacingOccurrences(of: pattern, with: "", options: [.regularExpression, .caseInsensitive])
            }
            value = strip(value)
        }
        return value
    }

    /// A part sent alone is arithmetic: one whole expression, or a list of them
    /// that every listed route is asked ("GPT랑 클로드한테 각각 1+1, 2+2").
    /// A question in words reads the same as a complaint, a question about
    /// routing or a premise (review rounds of 305792a, f51b1bc and the hunt of
    /// build 334: "2+2 이렇게 쓰면 순서는 어떻게 돼", "1+2 하면 같은 답 나오겠지"),
    /// so such a request stays whole.
    static func arithmetic(_ payload: String) -> Bool {
        if selfContained(payload) { return true }
        let list = items(payload)
        return list.count >= 2 && list.allSatisfy(selfContained)
    }

    /// Parts that are all "a-b", "a/b" or "AxB" may be ranges, shards, dates or
    /// sizes handed out ("맡겨 1-10, 11-20", "1/2, 2/2", "10/7, 10/8",
    /// "1920x1080, 1280x720"), not sums to answer.
    static func ambiguousNumbers(_ payloads: [String]) -> Bool {
        let operators = #"[-+*/×÷^%]|plus|minus|times|(?<![A-Za-z])x(?![A-Za-z])|divided\s+by|더하기|빼기|곱하기|나누기|플러스|마이너스"#
        guard let regex = try? NSRegularExpression(pattern: operators, options: [.caseInsensitive]) else { return false }
        let found = payloads.flatMap { payload in
            regex.matches(in: payload, range: NSRange(payload.startIndex..., in: payload)).compactMap { match -> String? in
                guard let range = Range(match.range, in: payload) else { return nil }
                let value = payload[range].lowercased()
                // "1920x1080", "4x4": an unspaced x between digits is a size.
                if value == "x", range.lowerBound > payload.startIndex, range.upperBound < payload.endIndex,
                   payload[payload.index(before: range.lowerBound)].isNumber, payload[range.upperBound].isNumber { return "size" }
                return value
            }
        }
        return !found.isEmpty && found.allSatisfy { ["-", "/", "size"].contains($0) }
    }

    /// A sentence beside the parts that matches one of `frameTemplates` whole.
    /// With `roster`, a sentence listing exactly those routes with "하나씩"
    /// counts as one ("GPT랑 코덱스 하나씩 시켜봐" before named parts).
    static func benignFrame(_ sentence: String, roster: [ProviderSurface] = [], leading: Bool = false) -> Bool {
        let value = sentence.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: " \t.,!。"))
        if !roster.isEmpty, value.range(of: distributive, options: [.regularExpression, .caseInsensitive]) != nil,
           let run = nameRun(in: value), Set(run.names.map(\.surface)) == Set(roster) {
            var rest = value
            rest.removeSubrange(run.range)
            return onlyRosterWords(rest.replacingOccurrences(of: distributive, with: " ", options: [.regularExpression, .caseInsensitive]))
        }
        if containsName(value) { return false }
        return (leading ? frameTemplates + leadingFrameTemplates : frameTemplates)
            .contains { value.range(of: $0, options: [.regularExpression, .caseInsensitive]) != nil }
    }

    /// A side sentence the owner ended with a question mark asks something;
    /// it is never framing ("…1+1, 2+2. 근데 배포 했어?").
    static func sideSentence(_ sentence: String, in text: String, roster: [ProviderSurface] = [], leading: Bool = false) -> Bool {
        !endsWithQuestionMark(sentence.trimmingCharacters(in: .whitespaces), in: text) && benignFrame(sentence, roster: roster, leading: leading)
    }

    /// The checks every part must pass before it is sent alone.
    static func acceptable(_ payload: String) -> Bool {
        !payload.isEmpty && payload.count <= maximumPayloadCharacters
            && payload.unicodeScalars.contains(where: { CharacterSet.alphanumerics.contains($0) })
            && payload.range(of: negation, options: [.regularExpression, .caseInsensitive]) == nil
            && payload.range(of: routingTalk, options: .regularExpression) == nil
            && !ClaudeChatLane.needsWorkspaceMaterial(payload) && !containsWorkTerm(payload) && answerable(payload)
    }

    /// A part that is something to answer, not a fragment of a sentence about
    /// routing: no handover verb left, more than filler words, and not a bare
    /// topic whose material never arrived ("번역은 GPT한테").
    static func answerable(_ payload: String) -> Bool {
        if payload.range(of: routingVerbs, options: [.regularExpression, .caseInsensitive]) != nil { return false }
        let words = payload.lowercased()
            .split(whereSeparator: { $0.isWhitespace || ",.?!~".contains($0) }).map(String.init)
        // "이것도", "다시는": a particle does not turn a filler into a question.
        let filler = { (word: String) in
            fillers.contains(word) || (word.count > 1 && fillers.contains(
                word.replacingOccurrences(of: #"(?:도|만|은|는|을|를)$"#, with: "", options: .regularExpression)))
        }
        if words.isEmpty || words.allSatisfy(filler) { return false }
        if words.count == 1, words[0].range(of: #"[가-힣](?:은|는|을|를)$"#, options: .regularExpression) != nil { return false }
        return true
    }

    /// The outcome of a sentence that hands out one part per listed name: a
    /// plan, or none (the request stays whole).
    struct Pairing { let plan: RouteFanout? }

    /// One sentence lists the routes and hands out one part each ("클로드랑
    /// 클로드 코드 GPT 코덱스 다 라우팅 하나씩 시켜봐"), with or without a particle on
    /// the last name. Such a request is decided here (nil: no such sentence, the
    /// ordinary path decides). It splits only on positive evidence:
    /// - the parts come from exactly one place: inside that sentence, the comma
    ///   list right after it, the comma list right before it (when nothing but
    ///   "답변 받아와" follows), or one per following sentence;
    /// - there are exactly as many parts as names, each answers itself
    ///   (arithmetic or a question), and the n-th name gets the n-th part;
    /// - every other sentence only asks for the answers back, and none names a route.
    /// A complaint, report or question about routing, a retraction, a quote, a
    /// work order or a bare topic ("장점, 단점") keeps the request whole (review
    /// of 305792a: 78 of 87 such sentences split before these rules).
    static func pairing(_ text: String) -> Pairing? {
        // "1. 1+1": a list marker is not a sentence end.
        let listed = text.replacingOccurrences(of: #"(?m)^[ \t]*(?:[0-9]{1,2}[.)]|[-*•·])[ \t]+"#, with: "", options: .regularExpression)
        let parts = clauses(listed)
        let rosters = parts.indices.compactMap { index in roster(parts[index], in: listed).map { (index: index, value: $0) } }
        guard let found = rosters.first else { return nil }
        let whole = Pairing(plan: nil)
        // Parts that carry their own names ("GPT랑 코덱스 하나씩 시켜봐. 1+1은
        // GPT한테, 2+2는 코덱스한테.") are the ordinary path's to decide.
        if rosters.count == 1, parts.indices.contains(where: { $0 != found.index && !mentions(in: parts[$0]).isEmpty }) { return nil }
        guard rosters.count == 1, found.value.clear else { return whole }
        let at = found.index, names = found.value.names, count = names.count
        for index in parts.indices where index != at {
            if containsName(parts[index]) { return whole }
        }
        var sources: [(clauses: [Int], items: [String])] = []
        if let inline = found.value.items { sources.append(([], inline)) }
        if at + 1 < parts.count, let list = partList(parts[at + 1], count: count) { sources.append(([at + 1], list)) }
        if at > 0, ((at + 1)..<parts.count).allSatisfy({ sideSentence(parts[$0], in: listed) }), let list = partList(parts[at - 1], count: count) {
            sources.append(([at - 1], list))
        }
        if at + count < parts.count {
            let following = Array((at + 1)...(at + count))
            if following.allSatisfy({ items(parts[$0]).count == 1 && selfContained(parts[$0]) }) {
                sources.append((following, following.map { parts[$0] }))
            }
        }
        guard sources.count == 1, let chosen = sources.first else { return whole }
        let rest = parts.indices.filter { $0 != at && !chosen.clauses.contains($0) }
        guard rest.allSatisfy({ sideSentence(parts[$0], in: listed, leading: $0 < at) }) else { return whole }
        let targets = zip(names, chosen.items).map { name, item in
            Target(surface: name.surface, mention: name.text, payload: strip(item))
        }
        guard targets.allSatisfy({ acceptable($0.payload) }), !ambiguousNumbers(targets.map(\.payload)) else { return whole }
        return Pairing(plan: RouteFanout(targets: targets, frame: rest.map { parts[$0] }))
    }

    struct Roster {
        let names: [(surface: ProviderSurface, text: String)]
        /// Parts written inside the roster sentence itself.
        let items: [String]?
        /// Names, "하나씩", the order to route and nothing else.
        let clear: Bool
    }

    /// A sentence with "하나씩" and a run of two or more names is a hand-out
    /// sentence (nil otherwise); it is clear only when it is nothing more than
    /// those, an opener, the order to route, and possibly the parts. A report,
    /// a complaint, a question, a refusal or any other word makes it unclear.
    static func roster(_ clause: String, in text: String) -> Roster? {
        guard clause.range(of: distributive, options: [.regularExpression, .caseInsensitive]) != nil,
              let run = nameRun(in: clause), run.names.count >= 2 else { return nil }
        let unclear = Roster(names: run.names, items: nil, clear: false)
        guard run.names.count <= maximumTargets,
              clause.range(of: reportedRouting, options: [.regularExpression, .caseInsensitive]) == nil,
              clause.range(of: routingTalk, options: .regularExpression) == nil,
              clause.range(of: negation, options: [.regularExpression, .caseInsensitive]) == nil,
              !endsWithQuestionMark(clause, in: text) else { return unclear }
        var prefix = String(clause[clause.startIndex..<run.range.lowerBound])
        let after = String(clause[run.range.upperBound...])
        var middle = after, tail = ""
        if let verb = after.range(of: rosterVerb, options: [.regularExpression, .caseInsensitive]) {
            middle = String(after[after.startIndex..<verb.lowerBound])
            tail = String(after[verb.upperBound...])
        } else if let verb = prefix.range(of: rosterVerb, options: [.regularExpression, .caseInsensitive]) {
            prefix.removeSubrange(verb) // "Ask Claude and GPT one each"
        }
        // No verb ("자 이번엔 GPT랑 클로드 하나씩.", "ok claude and gpt one each
        // 1+1 2+2"): the sentence still says nothing else, or it is unclear.
        // The parts may sit before the names, between them and the order, or after it.
        var found: [String]?
        for (index, segment) in [prefix, middle, tail].enumerated() {
            let cleaned = segment.replacingOccurrences(of: distributive, with: " ", options: [.regularExpression, .caseInsensitive])
                .replacingOccurrences(of: #"라우팅"#, with: " ", options: .regularExpression)
                .trimmingCharacters(in: CharacterSet(charactersIn: " :：,，\t"))
            // Before the names, the owner's test opener may stand too
            // ("자 테스트 한번 해보자 클로드랑 GPT 하나씩 시켜봐 1+1 2+2").
            if onlyRosterWords(cleaned) || (index == 0 && benignFrame(cleaned)) { continue }
            // "줘 1+1 2+2", "음 1+1이랑 2+2", "1+1 2+2 빨리": openers and verb
            // endings around the parts are the sentence's, not a part's.
            guard found == nil, let list = partList(trimmingRosterWords(cleaned), count: run.names.count) else { return unclear }
            found = list
        }
        return Roster(names: run.names, items: found, clear: true)
    }

    /// The first run of two or more names joined only by "랑", "하고", ",",
    /// "and" or a space, the last one optionally carrying its particle.
    static func nameRun(in clause: String) -> (range: Range<String.Index>, names: [(surface: ProviderSurface, text: String)])? {
        let alternatives = names.map { "(\($0.pattern))" }.joined(separator: "|")
        let boundary = #"(?=$|\s|[,，、/·&:：]|이랑|랑|하고|와|과|한테|에게|께)"#
        guard let start = try? NSRegularExpression(pattern: "(?<![A-Za-z0-9가-힣\\-])(?:\(alternatives))\(boundary)", options: [.caseInsensitive]),
              let next = try? NSRegularExpression(pattern: "^(?:\(alternatives))\(boundary)", options: [.caseInsensitive]),
              let joiner = try? NSRegularExpression(pattern: "^(?:\(conjunction)|\\s+)", options: [.caseInsensitive]),
              let dative = try? NSRegularExpression(pattern: "^\\s?\(particle)", options: [])
        else { return nil }
        func surface(_ match: NSTextCheckingResult) -> ProviderSurface? {
            (1...names.count).first { match.range(at: $0).location != NSNotFound }.map { names[$0 - 1].surface }
        }
        func anchored(_ regex: NSRegularExpression, at index: String.Index) -> (NSTextCheckingResult, Range<String.Index>)? {
            guard index <= clause.endIndex, let match = regex.firstMatch(in: clause, options: [.anchored], range: NSRange(index..., in: clause)),
                  let range = Range(match.range, in: clause), range.lowerBound == index else { return nil }
            return (match, range)
        }
        var searchFrom = clause.startIndex
        while let first = start.firstMatch(in: clause, range: NSRange(searchFrom..., in: clause)),
              let firstRange = Range(first.range, in: clause) {
            var run: [(surface: ProviderSurface, text: String)] = []
            var current: (NSTextCheckingResult, Range<String.Index>)? = (first, firstRange)
            var end = firstRange.upperBound
            while let name = current, let kind = surface(name.0) {
                var written = String(clause[name.1])
                end = name.1.upperBound
                if let particle = anchored(dative, at: end) {
                    written += String(clause[particle.1]).trimmingCharacters(in: .whitespaces)
                    end = particle.1.upperBound
                }
                current = nil
                if let join = anchored(joiner, at: end) {
                    let joined = String(clause[join.1]).trimmingCharacters(in: .whitespaces)
                    if let following = anchored(next, at: join.1.upperBound) {
                        // "클로드랑" keeps its Korean joining word as written; ", " and "and" do not.
                        if ["이랑", "랑", "하고", "와", "과"].contains(joined) { written += joined }
                        current = following
                    }
                }
                run.append((kind, written))
            }
            if run.count >= 2 { return (firstRange.lowerBound..<end, run) }
            searchFrom = end
        }
        return nil
    }

    /// Nothing but openers, "다", counts and verb endings.
    static func onlyRosterWords(_ text: String) -> Bool {
        let value = strip(text).lowercased()
            .replacingOccurrences(of: #"[0-9]+\s?개"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"한\s?번만?\s*더|다시\s*한\s?번"#, with: " ", options: .regularExpression)
        return value.split(whereSeparator: { $0.isWhitespace || ",.?!~:：".contains($0) }).allSatisfy { rosterWord(String($0)) }
    }

    /// An opener, a count or a verb ending, with its particle ("둘한테", "문제를").
    static func rosterWord(_ word: String) -> Bool {
        if rosterWords.contains(word) { return true }
        let stem = word.replacingOccurrences(of: #"(?:한테|에게|이|가|은|는|을|를|도|만|요)$"#, with: "", options: .regularExpression)
        return stem != word && (rosterWords.contains(stem) || stem.range(of: #"^[0-9]+\s?개$"#, options: .regularExpression) != nil)
    }

    /// Words that may follow the parts inside the roster sentence ("1+1 2+2 빨리").
    static let trailingRosterWords: Set<String> = ["그리고", "빨리", "얼른", "각각", "좀", "다", "줘", "봐", "요", "please"]

    /// The parts with the openers before them and the endings after them removed.
    static func trimmingRosterWords(_ text: String) -> String {
        var words = text.split(whereSeparator: \.isWhitespace).map(String.init)
        func word(_ value: String) -> String { value.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ",.:：")) }
        while let first = words.first, rosterWord(word(first)) { words.removeFirst() }
        while let last = words.last, trailingRosterWords.contains(word(last)) { words.removeLast() }
        return words.joined(separator: " ")
    }

    /// Exactly `count` parts, each a whole part, or nil. Dictation without
    /// commas ("1 plus 1 2 plus 2") counts only when the text is nothing but
    /// that many expressions.
    static func partList(_ text: String, count: Int) -> [String]? {
        let value = text.replacingOccurrences(of: trailingReturn, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+(?:그리고|and)\s*$"#, with: "", options: [.regularExpression, .caseInsensitive])
        // "1+1 2+2 그리고 3+3": each item may itself be a run of expressions.
        var list = items(value).flatMap { item in selfContained(item) ? [item] : (expressionRun(item) ?? [item]) }
        guard list.count == count, list.allSatisfy(selfContained) else { return nil }
        // "5+5,100+100,7+7": a comma before three digits may part two items as
        // well as group thousands; when both readings are parts, it is unclear.
        let commas = value.components(separatedBy: CharacterSet(charactersIn: ",，、"))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        if commas != list, commas.allSatisfy(selfContained) { return nil }
        return list
    }

    /// The expressions of a text that is nothing but expressions, joined by
    /// spaces, "이랑", "하고" or "and"; nil otherwise.
    static func expressionRun(_ text: String) -> [String]? {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let part = try? NSRegularExpression(pattern: expression, options: [.caseInsensitive]),
              let separator = try? NSRegularExpression(pattern: #"(?:\s+(?:(?:이랑|랑|하고|and|그리고)\s*)?|\s*(?:이랑|랑|하고|and|그리고)\s*)"#,
                                                      options: [.caseInsensitive]) else { return nil }
        let length = value.utf16.count
        var cursor = 0, result: [String] = []
        // Consume one expression and a nonempty separator at a time. A full
        // nested regex with an empty joiner can repartition digits forever
        // when a long arithmetic chain ends in a non-expression question.
        while cursor < length {
            guard let match = part.firstMatch(in: value, options: [.anchored], range: NSRange(location: cursor, length: length - cursor)),
                  match.range.location == cursor, match.range.length > 0,
                  let range = Range(match.range, in: value) else { return nil }
            result.append(String(value[range]))
            guard result.count <= maximumTargets else { return nil }
            cursor = NSMaxRange(match.range)
            if cursor == length { break }
            guard let gap = separator.firstMatch(in: value, options: [.anchored], range: NSRange(location: cursor, length: length - cursor)),
                  gap.range.location == cursor, gap.range.length > 0 else { return nil }
            cursor = NSMaxRange(gap.range)
            guard cursor < length else { return nil }
        }
        return result.count >= 2 ? result : nil
    }

    /// A part sent alone must be one whole arithmetic expression (with at most
    /// a short "은?"/"뭐야" tail). Questions in words are not split: a run
    /// question ("누가 더 빨라?"), a tag ("알겠지?"), a premise ("2+2가 4면") or
    /// a question about this Mac reads the same as a part (review rounds of
    /// 305792a and f51b1bc), so such a request stays whole.
    static func selfContained(_ item: String) -> Bool {
        let value = item.trimmingCharacters(in: .whitespacesAndNewlines)
        // A date or a phone number is not arithmetic.
        guard value.range(of: #"^[0-9]{4}-[0-9]{1,2}(?:-[0-9]{1,2})?$|^[0-9]{2,3}-[0-9]{3,4}-[0-9]{4}$"#, options: .regularExpression) == nil
        else { return false }
        return value.range(of: wholePart, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// The sentence ended with a question mark in the owner's text.
    static func endsWithQuestionMark(_ clause: String, in text: String) -> Bool {
        text.range(of: NSRegularExpression.escapedPattern(for: clause) + #"\s*[?？]"#, options: .regularExpression) != nil
    }

    /// A route named anywhere, with or without a particle.
    static func containsName(_ text: String) -> Bool {
        names.contains { name in
            text.range(of: "(?<![A-Za-z0-9가-힣\\-])(?:\(name.pattern))(?![A-Za-z0-9])",
                       options: [.regularExpression, .caseInsensitive]) != nil
        }
    }

    /// A list's items ("1 plus 1, 2 plus 2", "…, 3 plus 3 그리고 4 plus 4"). A
    /// thousands separator ("1,000") is not a comma between items.
    static func items(_ text: String) -> [String] {
        text.replacingOccurrences(of: #"\s*(?:(?<![0-9])[,，、]|[,，、](?![0-9]{3}(?![0-9])))\s*(?:(?:그리고|and)\s+)?|\s+그리고\s+|\s+and\s+(?=[0-9])|(?<=[0-9])\s*(?:이랑|랑|하고)\s+(?=[0-9])"#,
                                  with: "\u{1}", options: [.regularExpression, .caseInsensitive])
            .components(separatedBy: "\u{1}")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    struct Mention {
        let range: Range<String.Index>
        /// Every destination named here, in the owner's order: one name, or a
        /// list sharing the last name's particle.
        let destinations: [(surface: ProviderSurface, text: String)]
        /// Named with a Korean particle, not English "to": names listed before
        /// it share the particle.
        let hasParticle: Bool
    }

    static func mentions(in text: String) -> [Mention] {
        var found: [Mention] = []
        for (pattern, surface) in names {
            // A name followed by its particle ("GPT한테"), or English "to GPT".
            // A name inside a longer word or version ("GPT-5한테") is not one.
            let full = "(?<![A-Za-z0-9가-힣\\-])((?:\(pattern)))(?=\\s?\(particle))|(?<![A-Za-z0-9가-힣])to\\s+(?:\(pattern))(?![A-Za-z0-9가-힣\\-])"
            guard let regex = try? NSRegularExpression(pattern: full, options: [.caseInsensitive]) else { continue }
            for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
                guard let range = Range(match.range, in: text) else { continue }
                var end = range.upperBound
                if let particleRegex = try? NSRegularExpression(pattern: "\\s?\(particle)"),
                   let particleMatch = particleRegex.firstMatch(in: text, options: [.anchored], range: NSRange(end..., in: text)),
                   let particleRange = Range(particleMatch.range, in: text) {
                    end = particleRange.upperBound
                }
                found.append(Mention(range: range.lowerBound..<end,
                                     destinations: [(surface, String(text[range.lowerBound..<end]))],
                                     hasParticle: match.range(at: 1).location != NSNotFound))
            }
        }
        // Same start: the longer name wins ("Claude Code" over "Claude").
        found.sort { $0.range.lowerBound != $1.range.lowerBound
            ? $0.range.lowerBound < $1.range.lowerBound : $0.range.upperBound > $1.range.upperBound }
        var kept: [Mention] = []
        for mention in found {
            if let last = kept.last, mention.range.lowerBound < last.range.upperBound { continue }
            kept.append(mention)
        }
        return kept.indices.map { index in
            guard kept[index].hasParticle else { return kept[index] }
            return listed(kept[index], after: index == 0 ? text.startIndex : kept[index - 1].range.upperBound, in: text)
        }
    }

    /// The mention widened over the names listed right before it ("GPT랑
    /// Codex, Claude한테"), one name and conjunction at a time, never reaching
    /// back into the previous mention.
    static func listed(_ mention: Mention, after floor: String.Index, in text: String) -> Mention {
        // Anchored at the list so far; of the names that fit, the earliest start is the longest.
        let members = names.compactMap { pattern, surface in
            (try? NSRegularExpression(pattern: "(?<![A-Za-z0-9가-힣\\-])(?:\(pattern))(?:\(conjunction))$",
                                      options: [.caseInsensitive])).map { ($0, surface) }
        }
        var start = mention.range.lowerBound
        var destinations = mention.destinations
        while destinations.count < maximumTargets {
            var member: (range: Range<String.Index>, surface: ProviderSurface)?
            for (regex, surface) in members {
                guard let match = regex.firstMatch(in: text, options: [.withTransparentBounds],
                                                   range: NSRange(floor..<start, in: text)),
                      let range = Range(match.range, in: text) else { continue }
                if member.map({ range.lowerBound < $0.range.lowerBound }) ?? true { member = (range, surface) }
            }
            guard let member else { break }
            destinations.insert((member.surface, String(text[member.range]).trimmingCharacters(in: .whitespaces)), at: 0)
            start = member.range.lowerBound
        }
        return Mention(range: start..<mention.range.upperBound, destinations: destinations, hasParticle: true)
    }

    /// Sentence ends only: ". " "。" "!" "?" a newline or ";". The dot in "3.14" is not one.
    static func clauses(_ text: String) -> [String] {
        text.replacingOccurrences(of: #"(?<=[.。!?])(?=\s|$)|[\n;]"#, with: "\u{1}", options: .regularExpression)
            .components(separatedBy: "\u{1}")
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: ".。!? \t\r\n")) }
            .filter { !$0.isEmpty }
    }

    static func strip(_ value: String) -> String {
        var text = value
        for pattern in chatter {
            text = text.replacingOccurrences(of: pattern, with: " ", options: [.regularExpression, .caseInsensitive])
        }
        text = text.replacingOccurrences(of: #"^[\s,，、:：;·\-]+|[\s,，、:：;·\-]+$"#, with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        // "1+2 이런거 해봐": the hedge after the part is the owner's, not the part's.
        text = text.replacingOccurrences(of: #"(?<=\S)\s+(?:이런|요런|그런|저런|같은)\s?(?:거|것|걸)(?:로|으로)?$"#, with: "",
                                         options: .regularExpression)
        // "1+1은 지피티한테": the topic particle belongs to the sentence, not the part.
        text = text.replacingOccurrences(of: #"(?<=[0-9A-Za-z)\]])(?:은|는|을|를|이|가)$"#, with: "", options: .regularExpression)
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func containsWorkTerm(_ payload: String) -> Bool {
        let value = payload.lowercased()
        return workTerms.contains { term in
            term.unicodeScalars.allSatisfy({ $0.isASCII })
                ? value.range(of: "\\b\(term)\\b", options: .regularExpression) != nil
                : value.contains(term)
        }
    }

    /// The order parts run in: executors in the owner's order, a ChatGPT
    /// handoff last so the app it brings forward stays in front.
    public var executionOrder: [Int] {
        let indices = Array(targets.indices)
        return indices.filter { targets[$0].surface != .chatgpt } + indices.filter { targets[$0].surface == .chatgpt }
    }

    public static func selfTest() throws {
        func surfaces(_ prompt: String) -> [String]? { plan(prompt)?.targets.map { "\($0.surface.rawValue):\($0.payload)" } }
        var checks: [(String, Bool)] = []
        let owner = "자 내가 하나만 요청해볼게. 1+1 GPT한테. 2+2 Codex한테. 3+3 Claude한테. 4+4 Claudecode한테. 라우팅 시켜서 답변 받아와."
        checks.append(("owner sentence", surfaces(owner) == ["gpt-chat:1+1", "codex:2+2", "claude-chat:3+3", "claude:4+4"]))
        checks.append(("owner frame kept out of the parts", plan(owner)?.frame == ["자 내가 하나만 요청해볼게", "라우팅 시켜서 답변 받아와"]))
        checks.append(("name first", surfaces("GPT한테 1+1, Codex한테 2+2, Claude한테 3+3, Claude Code한테 4+4 물어봐")
            == ["gpt-chat:1+1", "codex:2+2", "claude-chat:3+3", "claude:4+4"]))
        checks.append(("one line", surfaces("1+1 GPT한테 2+2 Codex한테 3+3 Claude한테 4+4 Claudecode한테 라우팅 시켜서 답변 받아와")
            == ["gpt-chat:1+1", "codex:2+2", "claude-chat:3+3", "claude:4+4"]))
        checks.append(("korean names", surfaces("1+1 지피티한테. 2+2 코덱스한테. 3+3 클로드한테. 4+4 클로드 코드한테.")
            == ["gpt-chat:1+1", "codex:2+2", "claude-chat:3+3", "claude:4+4"]))
        checks.append(("chatgpt is the handoff", surfaces("1+1 ChatGPT한테. 2+2 Codex한테.") == ["chatgpt:1+1", "codex:2+2"]))
        checks.append(("handoff runs last", plan("1+1 ChatGPT한테. 2+2 Codex한테. 3+3 클로드한테.")?.executionOrder == [1, 2, 0]))
        checks.append(("english to", surfaces("send 1+1 to GPT. 2+2 to Codex") == ["gpt-chat:1+1", "codex:2+2"]))
        checks.append(("topic particle", surfaces("1+1은 지피티한테, 2+2는 코덱스한테") == ["gpt-chat:1+1", "codex:2+2"]))
        checks.append(("decimals stay", surfaces("3.14*2 GPT한테. 2.5+2.5 Codex한테.") == ["gpt-chat:3.14*2", "codex:2.5+2.5"]))
        checks.append(("voice spellings", surfaces("1+1 코덱세한테. 2+2 클로더 코드한테.") == ["codex:1+1", "claude:2+2"]))
        checks.append(("handover endings", surfaces("1+1 GPT한테 보내고 2+2 Codex한테 보내") == ["gpt-chat:1+1", "codex:2+2"]))
        checks.append(("same question again", surfaces("1+1 GPT한테. 같은 질문 Claude한테도.") == ["gpt-chat:1+1", "claude-chat:1+1"]))
        let listed = "야 라우팅 잘 됐는지 일단 확인해 보자. GPT랑 코덱스랑 클로드랑 클로드 코드한테 1+2 이런거 해봐. 간단한 거."
        checks.append(("listed names", surfaces(listed) == ["gpt-chat:1+2", "codex:1+2", "claude-chat:1+2", "claude:1+2"]))
        checks.append(("listed frame kept out of the parts", plan(listed)?.frame == ["야 라우팅 잘 됐는지 일단 확인해 보자", "간단한 거"]))
        checks.append(("comma list", surfaces("GPT, Codex, Claude한테 2+2") == ["gpt-chat:2+2", "codex:2+2", "claude-chat:2+2"]))
        checks.append(("list beside a name", surfaces("GPT하고 Codex한테 1+1, Claude Code한테 2+2")
            == ["gpt-chat:1+1", "codex:1+1", "claude:2+2"]))
        checks.append(("part before a list", surfaces("1+2 지피티와 클로드 코드한테.") == ["gpt-chat:1+2", "claude:1+2"]))
        // One each, in order (owner, 2026-10-06): no particle anywhere, the
        // parts in the next sentence.
        let oneEach = "그럼 클로드랑 클로드 코드 GPT 코덱스 다 라우팅 하나씩 시켜봐. 1 plus 1, 2 plus 2, 3 plus 3, 4 plus 4."
        checks.append(("one each, in order", surfaces(oneEach) == ["claude-chat:1 plus 1", "claude:2 plus 2", "gpt-chat:3 plus 3", "codex:4 plus 4"]))
        checks.append(("one each names as written", plan(oneEach)?.targets.map(\.mention) == ["클로드랑", "클로드 코드", "GPT", "코덱스"]))
        checks.append(("one each has no frame", plan(oneEach)?.frame == []))
        checks.append(("comma roster", surfaces("GPT, 코덱스, 클로드 하나씩 물어봐. 1+1, 2+2, 3+3")
            == ["gpt-chat:1+1", "codex:2+2", "claude-chat:3+3"]))
        checks.append(("parts before the roster", surfaces("1+1, 2+2. 클로드랑 GPT 하나씩 시켜봐.") == ["claude-chat:1+1", "gpt-chat:2+2"]))
        checks.append(("one part per sentence", surfaces("클로드랑 코덱스 하나씩 시켜봐. 1+1. 2+2.") == ["claude-chat:1+1", "codex:2+2"]))
        checks.append(("english one each", surfaces("Ask Claude Code and GPT one each. 1+1, 2+2.") == ["claude:1+1", "gpt-chat:2+2"]))
        checks.append(("thousands stay whole", surfaces("클로드랑 GPT 하나씩 시켜봐. 1,000+1, 2,500*2") == ["claude-chat:1,000+1", "gpt-chat:2,500*2"]))
        let framed = "자 이번엔 클로드랑 GPT 하나씩 시켜봐줘. 1+1, 2+2. 답변 받아와."
        checks.append(("one each keeps its frame", surfaces(framed) == ["claude-chat:1+1", "gpt-chat:2+2"]
            && plan(framed)?.frame == ["답변 받아와"]))
        checks.append(("listed names one each", surfaces("GPT랑 클로드한테 하나씩 1+1, 2+2 물어봐") == ["gpt-chat:1+1", "claude-chat:2+2"]))
        checks.append(("particle roster, parts after", surfaces("그럼 클로드랑 클로드 코드랑 GPT랑 코덱스한테 다 하나씩 시켜봐. 1 plus 1, 2 plus 2, 3 plus 3, 4 plus 4.")
            == ["claude-chat:1 plus 1", "claude:2 plus 2", "gpt-chat:3 plus 3", "codex:4 plus 4"]))
        checks.append(("space roster with a particle", surfaces("그럼 클로드랑 클로드 코드 GPT 코덱스한테 다 하나씩 시켜봐. 1 plus 1, 2 plus 2, 3 plus 3, 4 plus 4.")
            == ["claude-chat:1 plus 1", "claude:2 plus 2", "gpt-chat:3 plus 3", "codex:4 plus 4"]))
        checks.append(("parts without a period", surfaces("클로드랑 GPT 하나씩 시켜봐 1 plus 1, 2 plus 2") == ["claude-chat:1 plus 1", "gpt-chat:2 plus 2"]))
        checks.append(("numbered parts", surfaces("클로드랑 클로드 코드 GPT 코덱스 하나씩 시켜봐.\n1. 1+1\n2. 2+2\n3. 3+3\n4. 4+4")
            == ["claude-chat:1+1", "claude:2+2", "gpt-chat:3+3", "codex:4+4"]))
        checks.append(("last part after 그리고", surfaces("클로드랑 GPT랑 코덱스 하나씩 돌려봐. 1+1, 2+2 그리고 3+3")
            == ["claude-chat:1+1", "gpt-chat:2+2", "codex:3+3"]))
        checks.append(("dictated plus", surfaces("그럼 클로드랑 클로드 코드 GPT 코덱스 다 라우팅 하나씩 시켜봐. 1 플러스 1, 2 플러스 2, 3 플러스 3, 4 플러스 4.")
            == ["claude-chat:1 플러스 1", "claude:2 플러스 2", "gpt-chat:3 플러스 3", "codex:4 플러스 4"]))
        checks.append(("parts without commas", surfaces("그럼 클로드랑 클로드 코드 GPT 코덱스 다 라우팅 하나씩 시켜봐 1 plus 1 2 plus 2 3 plus 3 4 plus 4")
            == ["claude-chat:1 plus 1", "claude:2 plus 2", "gpt-chat:3 plus 3", "codex:4 plus 4"]))
        checks.append(("voice openers", surfaces("음 클로드랑 GPT 하나씩 시켜봐. 1+1, 2+2") == ["claude-chat:1+1", "gpt-chat:2+2"]
            && surfaces("다시 클로드랑 GPT 하나씩 시켜보자. 1+1은?, 2+2는 뭐야") == ["claude-chat:1+1은?", "gpt-chat:2+2는 뭐야"]))
        checks.append(("the owner's test opener", surfaces("야 라우팅 잘 되는지 확인해보자. 클로드랑 GPT 하나씩 시켜봐. 1+1, 2+2. 답변 다 받아와줘.")
            == ["claude-chat:1+1", "gpt-chat:2+2"]))
        checks.append(("counted roster", surfaces("클로드, 클로드 코드, GPT, 코덱스 넷 다 하나씩 시켜봐. 1+1, 2+2, 3+3, 4+4")
            == ["claude-chat:1+1", "claude:2+2", "gpt-chat:3+3", "codex:4+4"]))
        checks.append(("english names keep their spelling", plan("Ask Claude Code and GPT one each. 1+1, 2+2.")?.targets.map(\.mention) == ["Claude Code", "GPT"]))
        checks.append(("각각 shares one part", surfaces("GPT랑 클로드한테 각각 1+1 물어봐") == ["gpt-chat:1+1", "claude-chat:1+1"]))
        // Hunt of build 334: a side sentence may announce a test or ask for the
        // answers back; an opener or a joining word is never a part.
        for (prompt, expected) in [
            ("자 테스트 해보자. 1+1 GPT한테. 2+2 Codex한테.", ["gpt-chat:1+1", "codex:2+2"]),
            ("라우팅 테스트야. 1+1 GPT한테. 2+2 코덱스한테. 답변 받아와.", ["gpt-chat:1+1", "codex:2+2"]),
            ("빌드 332 들어갔으니까 확인해보자. 1+1 GPT한테. 2+2 코덱스한테.", ["gpt-chat:1+1", "codex:2+2"]),
            ("GPT랑 클로드한테 1+1 물어봐. 빌드 335 테스트야.", ["gpt-chat:1+1", "claude-chat:1+1"]),
            ("Quick test. 1+1 to GPT. 2+2 to Codex.", ["gpt-chat:1+1", "codex:2+2"]),
            ("1+1 GPT한테. 2+2 코덱스한테. 답이 뭔지 말해줘.", ["gpt-chat:1+1", "codex:2+2"]),
            ("1+1 GPT한테. 2+2 코덱스한테. 안 되면 말해.", ["gpt-chat:1+1", "codex:2+2"]),
            ("1+1 GPT한테. 2+2 코덱스한테. 헷갈리지 않게 따로 받아와.", ["gpt-chat:1+1", "codex:2+2"]),
            ("음 GPT한테 1+1, 코덱스한테 2+2", ["gpt-chat:1+1", "codex:2+2"]),
            ("Hey, to GPT 1+1, to Codex 2+2", ["gpt-chat:1+1", "codex:2+2"]),
            ("GPT한테 3+3 그리고 코덱스한테 4+4", ["gpt-chat:3+3", "codex:4+4"]),
            ("1+1은 GPT한테 주고 2+2는 코덱스한테", ["gpt-chat:1+1", "codex:2+2"]),
            ("GPT한테 1+1, 코덱스한테 2+2 답 좀 알려줘", ["gpt-chat:1+1", "codex:2+2"]),
            ("그럼 GPT랑 코덱스한테 1+1 물어봐", ["gpt-chat:1+1", "codex:1+1"]),
            ("GPT랑 코덱스 하나씩 시켜봐. 1+1은 GPT한테, 2+2는 코덱스한테.", ["gpt-chat:1+1", "codex:2+2"]),
            ("자 이번엔 GPT랑 클로드 하나씩. 1+1 GPT한테, 2+2 클로드한테.", ["gpt-chat:1+1", "claude-chat:2+2"]),
            // Second hunt: the owner's dictation, an opener only before the parts, a spaced "x".
            ("그럼 클로드랑 클로드 코드 GPT 코덱스 다 라우팅 하나씩 시켜 봐 1 plus 1 2 plus 2 3 plus 3 4 plus 4",
             ["claude-chat:1 plus 1", "claude:2 plus 2", "gpt-chat:3 plus 3", "codex:4 plus 4"]),
            ("추가로 하나 더. 3+3 GPT한테. 4+4 클로드한테.", ["gpt-chat:3+3", "claude-chat:4+4"]),
            ("코덱스랑 클로드 코드 하나씩 시켜봐. 10 - 3, 7 x 8", ["codex:10 - 3", "claude:7 x 8"]),
            ("GPT한테 1+1, 코덱스한테 2+2 좀 해봐", ["gpt-chat:1+1", "codex:2+2"]),
        ] {
            checks.append(("framed split: \(prompt)", surfaces(prompt) == expected))
        }
        // Hunt of build 334: a complaint, report, correction, hypothetical,
        // follow-up order, word question or handed-out range around named
        // parts keeps the request whole; it was split and the rest dropped.
        for prompt in ["1+1 GPT한테. 2+2 코덱스한테. 이렇게 보냈는데 왜 하나만 와?", "1+1 지피티한테, 2+2 코덱세한테 했는데 둘 다 클로드 코드로 갔어",
                       "GPT한테 1+1 코덱스한테 2+2 이렇게 쳤는데 결과가 8 하나만 나왔잖아", "1+1 GPT한테, 아 아니다 코덱스한테",
                       "1+1 코덱스한테 2+2 GPT한테 아니 반대로", "1+1 GPT한테 2+2 코덱스한테 아 잠깐 반대로", "GPT한테 1+1 코덱스한테 2+2 아니 3+3",
                       "1+1 GPT한테, 2+2 코덱스한테. 아 잠깐 스톱 그거 보류", "1+1 GPT한테. 2+2 코덱스한테. 됐다 됐어 나중에 하자",
                       "1+1 GPT한테, 2+2 코덱스한테. 그 다음에 로그 파일 지워", "GPT한테 1+1, 코덱스한테 2+2 결과를 노션에 정리해줘",
                       "1+1 GPT한테. 2+2 클로드한테. 끝나면 맥 재부팅해", "1+1 GPT한테 2+2 코덱스한테 그리고 결과 메일로 미라한테 보내줘",
                       "만약에 1+1 GPT한테, 2+2 코덱스한테 보내면 어떻게 돼?", "what happens if I send 1+1 to GPT and 2+2 to Codex?",
                       "send 1+1 to GPT and 2+2 to Codex later, not now", "어제 밤에 1+1 지피티한테 2+2 코덱스한테 했었거든",
                       "1+1은 GPT한테 갔고 2+2는 코덱스한테 갔네", "클로드한테 10/7, 코덱스한테 10/8 미팅 잡혔어", "GPT한테 $20, 클로드한테 $100 내고 있어",
                       "코덱스한테 3개, 클로드 코드한테 2개 남았대", "클로드랑 GPT 하나씩 맡겨. 1-10, 11-20.", "클로드랑 GPT 하나씩 맡겨 1/2, 2/2",
                       "클로드랑 GPT 하나씩 맡겨. 10/7, 10/8.", "클로드랑 GPT 하나씩 시켜봐 5+5,100+100,7+7", "1+1 GPT한테 2+2 코덱스한테 3+3",
                       "클로드한테 1+1, 코덱스한테 2+2, GPT 3+3", "GPT랑 클로드한테 1+1 해봐 라는 말이 무슨 뜻이야", "GPT랑 코덱스한테 1+2 하면 같은 답 나오겠지",
                       "GPT한테 라우팅 시켜봐 원리가 뭔지, Codex한테 2+2", "GPT한테 1+1, 클로드한테 2+2 이런 식으로 앞으로 자동으로 나눠줘",
                       // Second hunt: each word harmless, the sentence a retraction, deferral, order or question.
                       "클로드랑 GPT 하나씩 시켜봐. 1+1, 2+2. 그냥 내가 해.", "클로드랑 GPT 하나씩 시켜봐. 1+1, 2+2. 아 일단 하나만 해.",
                       "클로드랑 GPT 하나씩 시켜봐. 1+1, 2+2. 빌드 336 끝나면 시켜.", "테스트 끝나면 클로드랑 GPT 하나씩 1+1, 2+2",
                       "클로드랑 GPT 하나씩 시켜봐. 1+1, 2+2. 그리고 테스트 다 돌려.", "클로드랑 GPT 하나씩 시켜봐. 1+1, 2+2. 근데 배포 했어?",
                       "1+1 GPT한테. 2+2 코덱스한테. 아 그냥 하나로 보내.", "1+1 GPT한테. 2+2 코덱스한테. 이런 거 세 개 더 시켜.",
                       "GPT한테 1+1 코덱스한테 2+2 이런 거 라우팅 해?", "클로드랑 GPT 하나씩 시켜봐. 1+1, 2+2. 하나 더.",
                       "클로드 코드랑 코덱스 하나씩 맡겨. 1920x1080, 1280x720.", "근데 클로드랑 GPT 하나씩 1+1이랑 2+2 이거 뭐냐"] {
            checks.append(("no framed split: \(prompt)", plan(prompt) == nil))
        }
        checks.append(("각각 shares the whole list", surfaces("GPT랑 클로드한테 각각 1+1, 2+2, 3+3 물어봐")
            == ["gpt-chat:1+1, 2+2, 3+3", "claude-chat:1+1, 2+2, 3+3"]))
        for prompt in ["클로드랑 GPT 하나씩 시켜봐. 1+1, 2+2, 3+3", "클로드랑 GPT 시켜봐. 1+1, 2+2",
                       "클로드랑 GPT 비교해서 하나씩 시켜봐. 1+1, 2+2", "클로드랑 GPT 하나씩 보냈어? 1+1, 2+2",
                       "클로드랑 GPT 하나씩 라우팅이 안 돼. 1+1, 2+2", "클로드랑 GPT 하나씩 시키지 마. 1+1, 2+2",
                       "클로드랑 코덱스 하나씩 시켜봐. 버그 고쳐, 테스트 작성해", "클로드랑 GPT 하나씩 시켜봐. 1+1, 코덱스 버전",
                       "클로드 하나씩 시켜봐. 1+1", "클로드랑 GPT 하나씩 시켜봐. 코덱스랑 클로드 하나씩 시켜봐. 1+1, 2+2",
                       "클로드랑 GPT 하나씩 시켜볼까? 1+1, 2+2", "클로드랑 GPT 하나씩 시켜줄래?",
                       "클로드랑 GPT 하나씩 라우팅 시켜봐", "클로드 코드랑 코덱스 각각 써봤는데 어때. 장점, 단점",
                       // Review of 305792a: the parts quoted inside a complaint, a question, a retraction, a work order.
                       "그럼 클로드랑 클로드 코드 GPT 코덱스 다 라우팅 하나씩 시켜봐. 1 plus 1, 2 plus 2, 3 plus 3, 4 plus 4. 이렇게 했는데 왜 라우팅이 안 되는데?",
                       "클로드랑 GPT 하나씩 시켜봐. 1+1, 2+2. 이게 왜 안 돼?", "내가 이렇게 말했잖아. 클로드랑 GPT 하나씩 시켜봐. 1+1, 2+2. 근데 하나만 갔어.",
                       "미라가 이렇게 쓰래. 클로드랑 GPT 하나씩 시켜봐. 1+1, 2+2", "클로드랑 GPT 하나씩 시켜봐. 1+1, 2+2. 아 아니다 취소",
                       "클로드랑 GPT 하나씩 시켜봐. 1+1, 2+2. 아니 잠깐 하지 마", "Ask Claude and GPT one each. 1+1, 2+2. never mind",
                       "클로드 코드랑 코덱스 하나씩 시켜봐. 1+1, 2+2. 그리고 결과를 파일로 저장해.", "클로드랑 GPT 하나씩 시켜봐. 1+1, 2+2. 이걸 셀프테스트에 추가해",
                       "왜 클로드랑 GPT 하나씩 시켜. 1+1, 2+2", "why ask Claude and GPT one each. 1+1, 2+2",
                       "클로드랑 코덱스 하나씩 시켜봐. 끝나면 알려줘. 나 밥 먹고 올게.", "클로드랑 GPT 하나씩 시켜봐. 고마워. 잘 부탁해.",
                       "코덱스랑 클로드 코드 하나씩 시켜. 프론트, 백엔드", "클로드 코드랑 코덱스 하나씩 시켜봐. 리뷰, 린트",
                       "클로드랑 GPT 하나씩 시켜봐. 짧게, 간단하게", "클로드랑 GPT 하나씩 물어봐. 장점, 단점",
                       "클로드랑 GPT 하나씩 시켜봐. 아무거나, 간단한 걸로.", "오케이, 다음. 클로드랑 GPT 하나씩 시켜봐. 1+1. 2+2.",
                       "1+1, 2+2. 클로드랑 GPT 하나씩 시켜봐. 3+3, 4+4.", "클로드랑 GPT 하나씩 시켜봐. 1+1. 2+2. 3+3.",
                       "음, 그래. 클로드랑 GPT 하나씩 시켜봐. 1+1.", "클로드랑 GPT 하나씩 시켜봐. 짜장면, 짬뽕 중에 뭐가 나아?",
                       "GPT랑 클로드한테 하나씩 짜장면, 짬뽕 중에 뭐가 나은지 물어봐", "클로드랑 GPT 하나씩 시켜봐. 1+1, 같은 거",
                       "클로드랑 GPT한테 하나씩 시켜봐. 1+1, 2+2. 이렇게 하면 라우팅이 안 돼",
                       // Review round of f51b1bc: dictation without punctuation glues
                       // refusals, deferrals, conditions and follow-ups onto a part;
                       // questions in words read the same as a part.
                       "클로드랑 GPT 하나씩 보내지 마 1+1, 2+2", "클로드랑 GPT 하나씩 물어보지마 1+1이 뭐야, 2+2가 뭐야",
                       "클로드랑 GPT 하나씩 시켜봐 1+1, 2+2 아 근데 잠깐만", "클로드랑 GPT 하나씩 시켜봐 1+1, 2+2 취소",
                       "클로드랑 GPT 하나씩 시켜봐 나중에 1+1, 2+2", "클로드랑 GPT 하나씩 시켜봐 1+1, 2+2 내가 오케이 하면",
                       "클로드랑 GPT 하나씩 시켜봐 1+1, 2+2 순서 반대로", "클로드랑 GPT 하나씩 시켜봐 1+1, 2+2 아 GPT는 빼고",
                       "클로드랑 GPT 하나씩 시켜봐 1+1, 2+2 3+3", "클로드랑 GPT 코덱스 하나씩 시켜봐 1+1, 2+2 3+3, 4+4",
                       "클로드랑 GPT 하나씩 시켜봐 1+1, 2+2 했을 때 결과가 하나밖에 없더라", "클로드랑 GPT 하나씩 시켜봐 1+1, 2+2 근데 왜 하나로 합쳐져",
                       "클로드랑 GPT 하나씩 시켜봐 1+1, 2+2 서로 채점하게", "클로드랑 GPT 하나씩 시켜봐 1+1, 2+2 누가 더 빠른지 보자",
                       "클로드랑 GPT 하나씩 시켜봐. 알겠지? 할 수 있지?", "GPT랑 클로드 하나씩 시켜봐. 둘 중에 누가 더 빨라? 누가 더 싸?",
                       "클로드랑 GPT 하나씩 물어봐. 내 맥북 디스크 몇 기가 남았어? 와이파이 비번 뭐야?",
                       "클로드랑 GPT 하나씩 물어봐 2+2가 4면, 4+4는 몇이야", "클로드랑 GPT 하나씩 시켜봐 10/7 회의, 10/8 회의",
                       "클로드랑 GPT 하나씩 시켜봐 010-1234-5678, 010-9876-5432", "지피티랑 코덱스 하나씩 시켜봐 2026-10-07, 2026-10-08",
                       "1+1, 2+2 이건 예시고. 클로드랑 GPT 하나씩 시켜봐.", "클로드랑 GPT 하나씩 시켜봐. 1 plus 1 2 plus 2. 누가 더 빨라?",
                       "클로드랑 GPT 하나씩 시켜봐. 1+1이랑 2+2. 결과 뭐야?", "클로드랑 GPT 하나씩 시켜봐. 1+1. 누가 더 빨라?",
                       "클로드랑 GPT 하나씩 물어봐. 하늘은 왜 파래? 바다는 짜?", "클로드랑 GPT 하나씩 시켜봐 1+1, 2+2 둘 다 영어로 답하라고"] {
            checks.append(("no one-each split: \(prompt)", plan(prompt) == nil))
        }
        for prompt in ["GPT랑 비교해서 클로드한테 1+1 물어봐", "GPT랑 코덱스랑 클로드한테는 안 갔잖아", "코덱스랑 클로드한테 라우팅이 이상해",
                       "GPT랑 클로드한테 라우팅 되게 해줘", "GPT랑 클로드한테 1+2 보냈어?", "코덱스랑 클로드한테 이 함수 만들어줘",
                       "GPT랑 클로드한테 이런 거 해봐", "코덱스랑 클로드한테 시키지 말고 GPT한테 시켜", "코덱스랑 클로드한테 일 좀 시켜",
                       "GPT랑 클로드한테 라우팅 다시 해줘", "GPT랑 클로드한테 이것도 해봐", "GPT랑 클로드한테 둘 다 보내"] {
            checks.append(("no list split: \(prompt)", plan(prompt) == nil))
        }
        for prompt in ["코덱스 사용량과 클로드 사용량을 비교해줘", "Codex and Claude are both backends", "이 버그를 고치고 테스트해",
                       "그리고 클로드한테도 넘기게 해 왜 코덱스한테만 넘기냐? 항상 전체적으로 토큰 다 감시해야 돼",
                       "번역은 GPT한테, 요약은 Claude한테 해줘", "같은 질문 GPT한테. 1+1 Claude한테.",
                       "코덱스한테 시키지 말고 클로드한테 시켜", "GPT한테도 물어보고 Claude한테도 물어봐", "1+1 GPT한테",
                       "GPT-5한테 1+1. Codex한테 2+2.", "Codex한테 이 함수 만들고 Claude Code한테 테스트 작성해",
                       "README.md 요약 GPT한테. 2+2 Codex한테.", "1+1 GPT한테. 그리고. 2+2 Codex한테.",
                       "1+1 GPT한테. 2+2 Codex한테. ```code```"] {
            checks.append(("no split: \(prompt)", plan(prompt) == nil))
        }
        let failed = checks.filter { !$0.1 }.map(\.0)
        guard failed.isEmpty else { throw RouteFanoutError.selfTest(failed) }
    }
}

public enum RouteFanoutError: Error, CustomStringConvertible {
    case selfTest([String])
    public var description: String {
        switch self {
        case .selfTest(let failed): return "Route fan-out self-test failed: " + failed.joined(separator: "; ")
        }
    }
}
