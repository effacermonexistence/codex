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
        #"라우팅\s*(?:을|도)?\s*(?:시켜서|시켜|해서|해봐|해줘|해)?"#,
        #"(?:답변?|결과|응답)\s*(?:을|를|도)?\s*(?:받아와|받아서|받아봐|가져와|알려줘|줘)"#,
        #"시켜(?:보고|서|봐|라|줘|고)?|시키(?:라고|고|라)"#,
        #"(?:보내|넘겨|전달해)(?:서|봐|줘|고|라)?|전달하고"#,
        #"물어(?:봐줘|보고|봐서|봐|볼래)|질문해(?:줘|봐)?"#,
        #"(?:해봐|해 봐|해줘|해라|해보자|하라고|해)(?=\s|$)"#,
        #"각각|제발|\bsend\b|\bask\b"#,
    ]
    /// Short negation ("안 갔잖아", "안돼", "못 받았어") counts as well as the long form.
    static let negation = #"말고|말아|하지\s*마|시키지\s*마|않|(?:^|\s)(?:안|못)(?=\s|$|돼|됐|되|가|갔|해|했|와|왔)|don'?t|do not|instead of|rather than"#
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

    public static func plan(_ prompt: String) -> RouteFanout? {
        let text = prompt.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= maximumCharacters, !text.contains("```") else { return nil }
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
                var payload = strip(raw)
                if payload.range(of: repeatPrevious, options: [.regularExpression, .caseInsensitive]) != nil {
                    guard let previous = targets.last?.payload else { return nil }
                    payload = previous
                }
                // A listed name is asked the same part as the name carrying the particle.
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
        for target in targets {
            let payload = target.payload
            guard !payload.isEmpty, payload.count <= maximumPayloadCharacters,
                  payload.unicodeScalars.contains(where: { CharacterSet.alphanumerics.contains($0) }),
                  payload.range(of: negation, options: [.regularExpression, .caseInsensitive]) == nil,
                  !ClaudeChatLane.needsWorkspaceMaterial(payload),
                  !containsWorkTerm(payload), answerable(payload) else { return nil }
        }
        return RouteFanout(targets: targets, frame: frameBefore + frameAfter)
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
