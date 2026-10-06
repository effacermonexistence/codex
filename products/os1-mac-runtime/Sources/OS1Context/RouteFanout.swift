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
    /// "하나씩", "각각": each listed name gets the next part, in order (owner,
    /// 2026-10-06: "클로드랑 클로드 코드 GPT 코덱스 다 라우팅 하나씩 시켜봐. 1 plus 1,
    /// 2 plus 2, 3 plus 3, 4 plus 4." reached Claude Code alone: no name carried
    /// a particle, so nothing was a destination).
    static let distributive = #"하나씩|한\s?개씩|한\s?문제씩|각각|각자|차례(?:대)?로|순서대로|(?<![A-Za-z])(?:one\s+each|respectively)(?![A-Za-z])"#
    /// A routing that already happened is a report or complaint, not an order.
    static let reportedRouting = #"보냈|넘겼|시켰|맡겼|돌렸|넘어갔|전달했|전달됐|라우팅\s*(?:이|가)?\s*(?:됐|된|안\s|못\s)|(?<![A-Za-z])(?:sent|routed)(?![A-Za-z])"#

    public static func plan(_ prompt: String) -> RouteFanout? {
        let text = prompt.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= maximumCharacters, !text.contains("```") else { return nil }
        guard clauses(text).contains(where: { !mentions(in: $0).isEmpty }) else { return pairedPlan(text) }
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
                // A listed name is asked the same part as the name carrying the
                // particle, unless the owner hands them out one each ("GPT랑
                // 클로드한테 각각 1+1, 2+2"): then the n-th name gets the n-th part.
                let shares = mention.destinations.count > 1 && raw.range(of: distributive, options: [.regularExpression, .caseInsensitive]) != nil
                    ? items(payload) : [payload]
                if shares.count > 1, shares.count != mention.destinations.count { return nil }
                for (position, destination) in mention.destinations.enumerated() {
                    targets.append(Target(surface: destination.surface, mention: destination.text,
                                          payload: shares.count > 1 ? shares[position] : payload))
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

    /// No name carries a particle, but one sentence lists the routes and hands
    /// out one part each ("클로드랑 클로드 코드 GPT 코덱스 다 라우팅 하나씩 시켜봐"),
    /// and the parts come as a list of exactly as many items right after it (or
    /// right before it, or one per following sentence): the n-th name gets the
    /// n-th part. Anything else stays one request: a count that does not match,
    /// a name anywhere else, a roster with other words in it.
    static func pairedPlan(_ text: String) -> RouteFanout? {
        let parts = clauses(text)
        let rosters = parts.indices.compactMap { index in roster(parts[index], in: text).map { (index: index, names: $0) } }
        guard rosters.count == 1, let found = rosters.first, found.names.count >= 2, found.names.count <= maximumTargets else { return nil }
        let at = found.index, count = found.names.count
        for index in parts.indices where index != at {
            if containsName(parts[index]) { return nil }
        }
        var candidates: [(clauses: [Int], items: [String])] = []
        if at + 1 < parts.count { candidates.append(([at + 1], items(parts[at + 1]))) }
        if at > 0 { candidates.append(([at - 1], items(parts[at - 1]))) }
        if at + count < parts.count {
            let following = Array((at + 1)...(at + count))
            if following.allSatisfy({ items(parts[$0]).count == 1 }) { candidates.append((following, following.map { parts[$0] })) }
        }
        guard let chosen = candidates.first(where: { $0.items.count == count }) else { return nil }
        let targets = zip(found.names, chosen.items).map { name, item in
            Target(surface: name.surface, mention: name.text, payload: strip(item))
        }
        for target in targets {
            let payload = target.payload
            guard !payload.isEmpty, payload.count <= maximumPayloadCharacters,
                  payload.unicodeScalars.contains(where: { CharacterSet.alphanumerics.contains($0) }),
                  payload.range(of: negation, options: [.regularExpression, .caseInsensitive]) == nil,
                  payload.range(of: routingTalk, options: .regularExpression) == nil,
                  !ClaudeChatLane.needsWorkspaceMaterial(payload),
                  !containsWorkTerm(payload), answerable(payload) else { return nil }
        }
        let frame = parts.indices.filter { $0 != at && !chosen.clauses.contains($0) }.map { parts[$0] }
        return RouteFanout(targets: targets, frame: frame)
    }

    /// The names of a roster sentence, in order, or nil when the sentence is
    /// anything more than names, "하나씩"/"각각" and routing words: an order to
    /// route (not a report, a complaint, a question or a refusal).
    static func roster(_ clause: String, in text: String) -> [(surface: ProviderSurface, text: String)]? {
        guard clause.range(of: distributive, options: [.regularExpression, .caseInsensitive]) != nil,
              clause.range(of: routingVerbs, options: [.regularExpression, .caseInsensitive]) != nil
                || clause.range(of: #"(?<![A-Za-z])ask(?![A-Za-z])"#, options: [.regularExpression, .caseInsensitive]) != nil,
              clause.range(of: reportedRouting, options: [.regularExpression, .caseInsensitive]) == nil,
              clause.range(of: routingTalk, options: .regularExpression) == nil,
              clause.range(of: negation, options: [.regularExpression, .caseInsensitive]) == nil,
              // "…하나씩 시켜볼까?": a question about routing is not an order.
              text.range(of: NSRegularExpression.escapedPattern(for: clause) + #"\s*[?？]"#, options: .regularExpression) == nil
        else { return nil }
        let nameAlternatives = names.map { "(\($0.pattern))" }.joined(separator: "|")
        let separator = #"(?:\#(conjunction)|\s+)"#
        let boundary = #"(?=$|\s|[,，、/·&]|이랑|랑|하고|와|과)"#
        guard let first = try? NSRegularExpression(pattern: "(?<![A-Za-z0-9가-힣\\-])(?:\(nameAlternatives))\(boundary)", options: [.caseInsensitive]),
              let next = try? NSRegularExpression(pattern: "^(?:\(nameAlternatives))\(boundary)", options: [.caseInsensitive]),
              let sep = try? NSRegularExpression(pattern: "^\(separator)", options: [.caseInsensitive]),
              let start = first.firstMatch(in: clause, range: NSRange(clause.startIndex..., in: clause)),
              let startRange = Range(start.range, in: clause) else { return nil }
        func surface(of match: NSTextCheckingResult) -> ProviderSurface? {
            (1...names.count).first { match.range(at: $0).location != NSNotFound }.map { names[$0 - 1].surface }
        }
        var found: [(surface: ProviderSurface, text: String)] = []
        var cursor = startRange.lowerBound
        var match: NSTextCheckingResult? = start
        while let current = match, let range = Range(current.range, in: clause), let kind = surface(of: current) {
            var end = range.upperBound
            var written = String(clause[range])
            // The joining word ("랑", ", ") stays with the name it follows, as written.
            if let joined = sep.firstMatch(in: clause, options: [.anchored], range: NSRange(end..., in: clause)),
               let joinedRange = Range(joined.range, in: clause) {
                written += String(clause[joinedRange]).trimmingCharacters(in: .whitespaces)
                end = joinedRange.upperBound
            }
            found.append((kind, written.trimmingCharacters(in: CharacterSet(charactersIn: " ,，、/·&"))))
            cursor = end
            guard found.count <= maximumTargets else { return nil }
            match = next.firstMatch(in: clause, options: [.anchored], range: NSRange(cursor..., in: clause))
                .flatMap { $0.range.location == NSRange(cursor..., in: clause).location ? $0 : nil }
            if match != nil, end == range.upperBound { return nil } // two names with nothing between them
        }
        // Around the list: nothing but filler, "하나씩"/"각각" and routing words.
        let around = String(clause[clause.startIndex..<startRange.lowerBound]) + " " + String(clause[cursor...])
        let rest = strip(around.replacingOccurrences(of: distributive, with: " ", options: [.regularExpression, .caseInsensitive]))
        let leftover = rest.lowercased().split(whereSeparator: { $0.isWhitespace || ",.?!~:".contains($0) }).map(String.init)
        // Verb endings a routing word leaves behind ("시켜봐줘" → "줘").
        let endings: Set<String> = ["봐", "줘", "봐줘", "라", "요", "주세요", "줄래", "ask", "send", "route", "please"]
        guard leftover.allSatisfy({ fillers.contains($0) || endings.contains($0) }) else { return nil }
        return found
    }

    /// A route named anywhere, with or without a particle.
    static func containsName(_ text: String) -> Bool {
        names.contains { name in
            text.range(of: "(?<![A-Za-z0-9가-힣\\-])(?:\(name.pattern))(?![A-Za-z0-9\\-])",
                       options: [.regularExpression, .caseInsensitive]) != nil
        }
    }

    /// A comma list's items ("1 plus 1, 2 plus 2"). A thousands separator
    /// ("1,000") is not a comma between items.
    static func items(_ text: String) -> [String] {
        text.replacingOccurrences(of: #"\s*(?:(?<![0-9])[,，、]|[,，、](?![0-9]{3}(?![0-9])))\s*"#, with: "\u{1}", options: .regularExpression)
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
        checks.append(("comma roster with 각각", surfaces("GPT, 코덱스, 클로드 각각 물어봐. 1+1, 2+2, 3+3")
            == ["gpt-chat:1+1", "codex:2+2", "claude-chat:3+3"]))
        checks.append(("parts before the roster", surfaces("1+1, 2+2. 클로드랑 GPT 하나씩 시켜봐.") == ["claude-chat:1+1", "gpt-chat:2+2"]))
        checks.append(("one part per sentence", surfaces("클로드랑 코덱스 하나씩 시켜봐. 1+1. 2+2.") == ["claude-chat:1+1", "codex:2+2"]))
        checks.append(("english one each", surfaces("Ask Claude Code and GPT one each. 1+1, 2+2.") == ["claude:1+1", "gpt-chat:2+2"]))
        checks.append(("thousands stay whole", surfaces("클로드랑 GPT 하나씩 시켜봐. 1,000+1, 2,500*2") == ["claude-chat:1,000+1", "gpt-chat:2,500*2"]))
        let framed = "자 이번엔 이렇게 해보자. 클로드랑 GPT 하나씩 시켜봐줘. 1+1, 2+2. 답변 받아와."
        checks.append(("one each keeps its frame", surfaces(framed) == ["claude-chat:1+1", "gpt-chat:2+2"]
            && plan(framed)?.frame == ["자 이번엔 이렇게 해보자", "답변 받아와"]))
        checks.append(("listed names one each", surfaces("GPT랑 클로드한테 각각 1+1, 2+2 물어봐") == ["gpt-chat:1+1", "claude-chat:2+2"]))
        checks.append(("listed names, one shared part", surfaces("GPT랑 클로드한테 각각 1+1 물어봐") == ["gpt-chat:1+1", "claude-chat:1+1"]))
        for prompt in ["클로드랑 GPT 하나씩 시켜봐. 1+1, 2+2, 3+3", "클로드랑 GPT 시켜봐. 1+1, 2+2",
                       "클로드랑 GPT 비교해서 하나씩 시켜봐. 1+1, 2+2", "클로드랑 GPT 하나씩 보냈어? 1+1, 2+2",
                       "클로드랑 GPT 하나씩 라우팅이 안 돼. 1+1, 2+2", "클로드랑 GPT 하나씩 시키지 마. 1+1, 2+2",
                       "클로드랑 코덱스 하나씩 시켜봐. 버그 고쳐, 테스트 작성해", "클로드랑 GPT 하나씩 시켜봐. 1+1, 코덱스 버전",
                       "클로드 하나씩 시켜봐. 1+1", "클로드랑 GPT 하나씩 시켜봐. 코덱스랑 클로드 하나씩 시켜봐. 1+1, 2+2",
                       "클로드랑 GPT 하나씩 시켜볼까? 1+1, 2+2", "클로드랑 GPT 하나씩 시켜줄래?", "GPT랑 클로드한테 각각 1+1, 2+2, 3+3 물어봐",
                       "클로드랑 GPT 하나씩 라우팅 시켜봐", "클로드 코드랑 코덱스 각각 써봤는데 어때. 장점, 단점"] {
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
