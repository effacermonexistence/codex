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
        (#"claude[\s\-]?code|클로[드더즈][\s]?코드"#, .claude),
        (#"chat[\s\-]?gpt|챗[\s]?gpt|챗[\s]?지피티|채팅[\s]?gpt|채찌"#, .chatgpt),
        (#"gpt|지피티|쥐피티"#, .gptChat),
        (#"codex|코덱[스세]|코덱센트|코덱선트"#, .codex),
        (#"claude|클로[드더즈]"#, .claudeChat),
    ]
    /// The Korean dative particle that turns a name into a destination.
    static let particle = #"(?:한테|에게|께)(?:는|도|만)?"#
    /// Names listed before a destination share its particle: a Korean case
    /// particle attaches to the last name of a coordination but covers all of
    /// them ([A랑 B]한테). Owner, 2026-10-04: "GPT랑 코덱스랑 클로드랑 클로드
    /// 코드한테 1+2 이런거 해봐" reached only Claude Code, the one name the
    /// particle touched. Only a name joined straight to another name is listed;
    /// "GPT랑 비교해서 Claude한테" keeps GPT as company, not a destination.
    static let conjunction = #"(?:\s?(?:이랑|랑|하고|와|과)|\s*[,，、/·&])\s*(?:(?:및|그리고|and)\s+)?|\s+(?:및|그리고|and)\s+"#
    /// Routing as the subject of the sentence, not an instruction to route:
    /// "라우팅이 이상해", "라우팅 되게 해줘", "라우팅 잘 됐는지".
    static let routingTalk = #"라우팅\s*(?:이|가|은|는|도|만)?\s*(?:(?:잘|제대로|다|안|못)\s*)?(?:되|돼|됐|된|됨|됩)|라우팅(?:이|가|은|는)(?![가-힣])"#
    /// Routing words, not content: removed from each part before it is sent.
    static let chatter = [
        #"라우팅\s*(?:을|도)?\s*(?:시켜(?:서|봐줘|봐|줘|라|보고)?|해(?:서|봐|줘)?)?"#,
        #"(?:답변?|결과|응답)\s*(?:을|를|도)?\s*(?:받아와|받아서|받아봐|가져와|알려줘|줘)"#,
        #"시켜(?:보고|서|봐|라|줘|고)?|시키(?:라고|고|라)"#,
        #"(?:보내|넘겨|전달해)(?:서|봐|줘|고|라)?|전달하고"#,
        #"물어(?:봐줘|보고|봐서|봐|볼래)|질문해(?:줘|봐)?"#,
        #"(?:해봐|해 봐|해줘|해라|해보자|하라고|해)(?=\s|$)"#,
        #"각각|제발|\bsend\b|\bask\b"#,
    ]
    /// Short negation ("안 갔잖아", "안돼", "못 받았어") counts as well as the long form.
    static let negation = #"말고|말아|하지\s*마|시키지\s*마|지\s*마|지\s*말|진\s*마|필요\s*없|않|(?:^|\s)(?:안|못)(?=\s|$|돼|됐|되|가|갔|해|했|와|왔)|don'?t|do not|instead of|rather than|never\s*mind|취소|cancel"#
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
    static let distributive = #"(?:하나씩|한\s?개씩|한\s?문제씩)(?:만)?|(?<![A-Za-z])one\s+each(?![A-Za-z])"#
    /// A routing that already happened is a report or complaint, not an order.
    static let reportedRouting = #"보냈|넘겼|시켰|맡겼|돌렸|넘어갔|전달했|전달됐|라우팅\s*(?:이|가)?\s*(?:됐|된|안\s|못\s)|(?<![A-Za-z])(?:sent|routed)(?![A-Za-z])"#
    /// The one order a roster sentence gives: hand the parts over.
    static let rosterVerb = #"(?:라우팅\s*(?:을|도)?\s*)?(?:시켜|돌려|맡겨|넘겨|보내|물어|전달해|질문해|던져|내)(?:봐줘|봐요|봐|보자|볼래|줘요|줘|주세요|줄래|서|라|보고)?|(?:라우팅\s*)?해\s?(?:봐줘|봐|보자|줘|라)(?=\s|$)|(?<![A-Za-z])(?:ask|send|route)(?![A-Za-z])"#
    /// What may stand around the names and that order: openers, "다", counts,
    /// verb endings. No question word ("왜 클로드랑 GPT 하나씩 시켜" is a complaint).
    static let rosterWords: Set<String> = ["그럼", "자", "야", "그러면", "이번엔", "이번에", "이번에도", "이제", "다", "모두", "전부",
                                           "둘", "셋", "넷", "다섯", "여섯", "일곱", "여덟", "두", "세", "네", "개", "좀", "한번", "그냥",
                                           "일단", "바로", "지금", "같이", "따로", "봐", "줘", "봐줘", "요", "주세요", "줄래", "오케이",
                                           "음", "아", "좋아", "그래", "다시", "더", "한", "번", "순서대로", "차례로", "차례대로",
                                           "문제", "질문", "계산", "풀게", "to",
                                           "please", "ok", "okay", "all", "of", "them"]
    /// A sentence beside the parts that only says to return the answers.
    static let returnWords: Set<String> = ["답", "답변", "결과", "응답", "받아와", "받아와줘", "가져와", "가져와줘", "알려줘", "보여줘", "줘",
                                           "그리고", "각자", "빨리", "얼른"]
    /// "…, 2+2 답변 받아와": the request to return the answers, after the last part.
    static let trailingReturn = #"\s*(?:답변?|결과|응답)\s*(?:을|를|도)?\s*(?:좀\s*|다\s*|빨리\s*)*(?:받아와줘|받아와|받아서\s*보여줘|가져와줘|가져와|알려줘|보여줘)\s*$"#
    /// The owner's own test openers ("야 라우팅 잘 됐는지 일단 확인해 보자", "자 내가
    /// 하나만 요청해볼게"), allowed before the roster sentence.
    static let testPreamble = #"^(?:(?:야|자|그럼|오케이|일단|이제|한번|다시)\s*)*(?:(?:내가\s*)?(?:하나만?\s*)?요청해\s?볼게|(?:라우팅\s*(?:이|가)?\s*(?:잘\s*)?(?:되는지|됐는지)\s*)?(?:일단\s*|한번\s*)?(?:확인|테스트|시험)\s?(?:해\s?)?(?:보자|볼게|봐))$"#
    /// One arithmetic expression ("1+1", "1 plus 1", "2 곱하기 3", "1,000 × 2").
    static let expression = #"(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?(?:\s*(?:[-+*/×÷^%]|plus|minus|times|x|divided\s+by|더하기|빼기|곱하기|나누기|플러스|마이너스)\s*(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?)+"#
    /// A whole part is one expression, with at most a short question tail
    /// ("1+1은?", "2+2는 뭐야", "3+3=?"); a date or a phone number is not one.
    static let wholePart = "^\\s*" + expression + #"(?:\s*(?:은|는|이|가))?(?:\s*(?:뭐야|몇이야|얼마야|뭐지|뭐|몇|얼마))?\s*(?:=\s*)?\??\s*$"#

    public static func plan(_ prompt: String) -> RouteFanout? {
        let text = prompt.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= maximumCharacters, !text.contains("```") else { return nil }
        // A sentence that hands out one part per listed name decides the
        // request alone: paired, or kept whole.
        if let paired = pairing(text) { return paired.plan }
        var targets: [Target] = []
        var frameBefore: [String] = [], frameAfter: [String] = []
        var sawTarget = false
        for clause in clauses(text) {
            let found = mentions(in: clause)
            if found.isEmpty {
                if sawTarget { frameAfter.append(clause) } else { frameBefore.append(clause) }
                continue
            }
            // A clause without a name between two named ones: whose is it?
            if !frameAfter.isEmpty { return nil }
            sawTarget = true
            let leading = strip(String(clause[clause.startIndex..<found[0].range.lowerBound]))
            // "Codex한테 1+1, Claude한테 2+2": each part follows its name.
            let nameFirst = leading.isEmpty && found.count > 1
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
                // A stray "하나씩" is not part of the question ("GPT한테 하나씩 1+1, Codex한테 2+2").
                var payload = strip(raw.replacingOccurrences(of: distributive, with: " ", options: [.regularExpression, .caseInsensitive]))
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
                let tail = strip(String(clause[found[found.count - 1].range.upperBound...]))
                if !tail.isEmpty { frameAfter.append(tail) }
            }
        }
        guard targets.count >= 2, targets.count <= maximumTargets else { return nil }
        // A retraction or a work order beside the parts ("아니 잠깐 하지 마",
        // "그리고 이 버그 고쳐") is never framing to leave unsent.
        for clause in frameBefore + frameAfter {
            if clause.range(of: negation, options: [.regularExpression, .caseInsensitive]) != nil || containsWorkTerm(clause) { return nil }
        }
        for target in targets where !acceptable(target.payload) { return nil }
        return RouteFanout(targets: targets, frame: frameBefore + frameAfter)
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
        guard rosters.count == 1, found.value.clear else { return whole }
        let at = found.index, names = found.value.names, count = names.count
        for index in parts.indices where index != at {
            if containsName(parts[index]) { return whole }
        }
        var sources: [(clauses: [Int], items: [String])] = []
        if let inline = found.value.items { sources.append(([], inline)) }
        if at + 1 < parts.count, let list = partList(parts[at + 1], count: count) { sources.append(([at + 1], list)) }
        if at > 0, ((at + 1)..<parts.count).allSatisfy({ returnOnly(parts[$0]) }), let list = partList(parts[at - 1], count: count) {
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
        // Before the roster, the owner's own test opener is framing too.
        guard rest.allSatisfy({ returnOnly(parts[$0])
            || ($0 < at && parts[$0].range(of: testPreamble, options: .regularExpression) != nil) }) else { return whole }
        let targets = zip(names, chosen.items).map { name, item in
            Target(surface: name.surface, mention: name.text, payload: strip(item))
        }
        guard targets.allSatisfy({ acceptable($0.payload) }) else { return whole }
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
        } else {
            return unclear
        }
        // The parts may sit before the names, between them and the order, or after it.
        var found: [String]?
        for segment in [prefix, middle, tail] {
            let cleaned = segment.replacingOccurrences(of: distributive, with: " ", options: [.regularExpression, .caseInsensitive])
                .replacingOccurrences(of: #"라우팅"#, with: " ", options: .regularExpression)
                .trimmingCharacters(in: CharacterSet(charactersIn: " :：,，\t"))
            if onlyRosterWords(cleaned) { continue }
            guard found == nil, let list = partList(cleaned, count: run.names.count) else { return unclear }
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
        return value.split(whereSeparator: { $0.isWhitespace || ",.?!~:：".contains($0) })
            .allSatisfy { rosterWords.contains(String($0)) }
    }

    /// A sentence beside the parts that only asks for the answers back.
    static func returnOnly(_ clause: String) -> Bool {
        let value = strip(clause.replacingOccurrences(of: distributive, with: " ", options: [.regularExpression, .caseInsensitive])).lowercased()
        return value.split(whereSeparator: { $0.isWhitespace || ",.?!~:：".contains($0) })
            .allSatisfy { rosterWords.contains(String($0)) || returnWords.contains(String($0)) }
    }

    /// Exactly `count` parts, each a whole part, or nil. Dictation without
    /// commas ("1 plus 1 2 plus 2") counts only when the text is nothing but
    /// that many expressions.
    static func partList(_ text: String, count: Int) -> [String]? {
        var list = items(text.replacingOccurrences(of: trailingReturn, with: "", options: .regularExpression))
        if list.count == 1, let run = expressionRun(list[0]) { list = run }
        guard list.count == count, list.allSatisfy(selfContained) else { return nil }
        return list
    }

    /// The expressions of a text that is nothing but expressions, joined by
    /// spaces, "이랑", "하고" or "and"; nil otherwise.
    static func expressionRun(_ text: String) -> [String]? {
        let joiner = #"\s*(?:이랑|랑|하고|and|그리고)?\s*"#
        guard text.range(of: "^\\s*\(expression)(?:\(joiner)\(expression))+\\s*$", options: [.regularExpression, .caseInsensitive]) != nil,
              let regex = try? NSRegularExpression(pattern: expression, options: [.caseInsensitive]) else { return nil }
        return regex.matches(in: text, range: NSRange(text.startIndex..., in: text))
            .compactMap { Range($0.range, in: text).map { String(text[$0]) } }
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
        text.replacingOccurrences(of: #"\s*(?:(?<![0-9])[,，、]|[,，、](?![0-9]{3}(?![0-9])))\s*(?:(?:그리고|and)\s+)?|\s+그리고\s+|\s+and\s+(?=[0-9])"#,
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
