import Foundation

/// An owner order to send work to every route OS-1 can run, without naming
/// one: "너 라우팅 할 수 있는 쪽으로 최대한 다 라우팅 해봐. 엄청 간단한 알제브라 계산
/// 있잖아.\n뭐 원플러스원 투플러스투 이런 거 있잖아." (owner, build 381, task
/// ac5a5fd6). `RouteFanout` only splits parts that NAME a surface, so this
/// sentence ran on Auto as ONE task: the whole order reached a cheap Codex tier,
/// which answered 2 and 4, said it had no OS-1 routing tool, and was escalated
/// to gpt-6-astra/max, which again did not route. No worker model can route;
/// the host does.
///
/// A route-all order becomes an explicit route test (`explicit_routing_test`)
/// on every execution surface that can run now, in a fixed order: the local
/// model OpenClaw already runs, Codex, Claude Code, then Claude chat. Each
/// route is one exact arithmetic expression, so the existing exact verifier
/// checks every answer and no worker is ever asked to "do routing". The
/// expressions are the owner's own ("원플러스원" → "1+1"), handed out round
/// robin over the routes; with none written, "1+1", "2+2", "3+3", "4+4" in
/// route order. Variants of the same order: "GPT 빼고 다 라우팅 해봐" (every
/// route except the named ones), "로컬이랑 클로드 코드랑 코덱스 이렇게 세 개로 라우팅
/// 해봐" (exactly the named routes, the local model included), and parts that
/// name the local model one by one ("3+3 로컬한테", `namedParts`).
///
/// Recognition is decided by the order sentence itself, never by the rest of
/// the request: the imperative order (its verb ending, the word right after it
/// and the two words right before it: a question word, a quote, a report or a
/// negation there make it no order) and the object it governs. An order whose
/// object is something else to route (요청을, 트래픽을, "the requests") or that
/// stands among infrastructure words (nginx, gateway, webhook, 설정, 코드) is
/// ordinary work, never a route-all order. Everything around a recognised
/// order is either framing (openers, a description of the arithmetic, a
/// return condition, a remark on the previous routing) and the arithmetic to
/// send, or the order is held (`Hold`): the host shows why instead of sending
/// the routing order to one worker.
public enum RouteAllIntent {
    public typealias Surface = RCCRuntimeContract.Surface

    /// The execution surfaces a route-all order uses, in route order. GPT is
    /// no longer routed (2026-10-13).
    public static let surfaceOrder: [Surface] = [.local, .codex, .claude, .claudeChat]
    /// Used in route order when the owner wrote no expression.
    public static let defaultExpressions = ["1+1", "2+2", "3+3", "4+4"]

    /// Why a recognised order is held before Core instead of being sent.
    public enum Hold: String, Equatable, Sendable {
        /// Something besides the order, its framing and the arithmetic: a
        /// question in words, a work order, a constraint, more than eight
        /// expressions, or a provider named outside the order.
        case notArithmetic = "not_arithmetic"
        /// The order routes "this"/"that" ("이거 모든 모델로 보내봐") and no
        /// expression is written: what it refers to cannot be sent.
        case referencedContent = "referenced_content"
    }

    /// A recognised order.
    public struct Order: Equatable, Sendable {
        /// The surfaces the order covers, in `surfaceOrder`: every surface, or
        /// the named ones, less the excluded ones.
        public let surfaces: [Surface]
        /// The owner listed the routes ("로컬이랑 클로드 코드랑 코덱스").
        public let named: Bool
        /// GPT names in the order, listed or excluded, as written: GPT is no
        /// longer routed, so they never run.
        public let gptNames: [String]
        /// Routes the owner excluded ("Codex 빼고"), as written, GPT excluded.
        public let excluded: [String]
        /// The owner's expressions, canonical and in order; empty: none written.
        public let expressions: [String]
        /// Non-nil: recognised, but held before Core.
        public let hold: Hold?
    }

    public struct Plan: Equatable, Sendable {
        /// One route per available covered surface, in `surfaceOrder`.
        public let routes: [RCCRuntimeContract.ExplicitRoute]
        /// The owner's own expressions as written, made canonical ("1+1");
        /// empty when the defaults were used.
        public let expressions: [String]
        /// The owner's expressions that no route received (more expressions
        /// than routes): shown, never dropped silently.
        public let unsent: [String]
        public var defaulted: Bool { expressions.isEmpty }
    }

    // MARK: Names

    enum NameKind: Equatable, Sendable { case surface(Surface), gpt }
    struct Name: Equatable { let range: NSRange; let text: String; let kind: NameKind }

    /// The local model OpenClaw runs, as the owner names it.
    static let localName = #"로컬(?:\s?모델)?|올라마|큐웬|local(?:\s+model)?|ollama|qwen"#
    /// Longest names first, as `RouteFanout.names`, then the local model.
    static let nameTable: [(pattern: String, kind: @Sendable (String) -> NameKind)] = [
        // "Codex chat" names Codex (the chat lane went with GPT); "gpt-chat" names GPT.
        (ProviderNameAliases.gptChat, { $0.range(of: #"codex|코덱스"#, options: [.regularExpression, .caseInsensitive]) != nil
            ? .surface(.codex) : .gpt }),
        (ProviderNameAliases.claudeCode, { _ in .surface(.claude) }),
        (ProviderNameAliases.chatGPT, { _ in .gpt }),
        (ProviderNameAliases.gpt, { _ in .gpt }),
        (ProviderNameAliases.codex, { _ in .surface(.codex) }),
        (ProviderNameAliases.claude, { _ in .surface(.claudeChat) }),
        (localName, { _ in .surface(.local) }),
    ]
    static let nameAlternatives = "(?:" + nameTable.map { "(?:\($0.pattern))" }.joined(separator: "|") + ")"
    static let nameBoundary = #"(?<![A-Za-z0-9가-힣\-])"#
    static let nameRegex: NSRegularExpression? = try? NSRegularExpression(pattern:
        nameBoundary + "(?:" + nameTable.map { "(\($0.pattern))" }.joined(separator: "|") + ")(?![A-Za-z0-9])",
        options: [.caseInsensitive])

    /// Every route named in `text`, in order (the longer name at one start).
    static func names(in text: String) -> [Name] {
        guard let regex = nameRegex else { return [] }
        let value = text as NSString
        return regex.matches(in: text, range: NSRange(location: 0, length: value.length)).compactMap { match in
            guard let group = (1...nameTable.count).first(where: { match.range(at: $0).location != NSNotFound }) else { return nil }
            let written = value.substring(with: match.range)
            return Name(range: match.range, text: written, kind: nameTable[group - 1].kind(written))
        }
    }
    /// The request names the local model ("로컬", "local", "올라마").
    public static func mentionsLocal(_ prompt: String) -> Bool {
        names(in: prompt.precomposedStringWithCanonicalMapping).contains { $0.kind == .surface(.local) }
    }

    /// "GPT 빼고", "Codex랑 GPT는 말고", "except GPT": routes the owner left out.
    static let nameList = nameAlternatives + #"(?:\s*(?:이랑|랑|하고|하구|와|과|[,，、/·&]|및|그리고|and|or)?\s*"# + nameAlternatives + ")*"
    static let exclusion: NSRegularExpression? = try? NSRegularExpression(pattern:
        nameBoundary + nameList + #"\s*(?:은|는|을|를|이|가|도)?\s*(?:빼고|빼놓고|빼곤|빼서|말고|제외하고|제외(?![가-힣]))|(?<![A-Za-z])(?:except|excluding|but\s+not|other\s+than|without)\s+"# +
        nameList, options: [.caseInsensitive])

    /// "로컬도 포함해서", "로컬까지", "코덱스도": a route the owner includes in
    /// "every route" (they all are), not a named list or a destination.
    static let inclusion: NSRegularExpression? = try? NSRegularExpression(pattern:
        nameBoundary + nameList + #"\s*(?:(?:도|까지|을|를)\s*(?:포함(?:해서|하고|해)|넣어서|넣고)|(?:도|까지)(?![가-힣]))|(?<![A-Za-z])including\s+"# +
        nameList, options: [.caseInsensitive])

    /// The text with every exclusion phrase blanked, and the names it excluded;
    /// inclusion phrases are blanked too (every route is already covered).
    static func removingExclusions(_ text: String) -> (text: String, excluded: [Name]) {
        var excluded: [Name] = [], result = text
        for (regex, excludes) in [(exclusion, true), (inclusion, false)] {
            guard let regex else { continue }
            let value = result as NSString
            let matches = regex.matches(in: result, range: NSRange(location: 0, length: value.length))
            if excludes { for match in matches { excluded += names(in: value.substring(with: match.range)) } }
            for match in matches.reversed() {
                if let range = Range(match.range, in: result) { result.replaceSubrange(range, with: " ") }
            }
        }
        return (result, excluded)
    }

    // MARK: Recognition

    static let target = #"(?:쪽|곳|경로|백엔드|모델|서피스|엔진|라우트)(?:들)?"#
    /// Targets an order to SEND (no routing word) may name: never a path ("전체 경로").
    static let surfaceTarget = #"(?:쪽|백엔드|모델|서피스|엔진|라우트)(?:들)?"#
    static let toward = #"(?:으로|로|에다가|에다|에게|한테|에)?"#
    static let towardRequired = #"(?:으로|로|에다가|에다|에게|한테|에)"#
    static let all = #"(?<![가-힣])(?:다|전부|모두|전체|싹\s?다)"#
    /// What can be routed, said as the place: "할 수 있는 거", "되는 데로".
    static let routableWhat = #"(?:거|것|건|데|데로|대로|곳|만큼)"#
    /// The imperative ending: "해", "해봐", "시켜봐", "보내줘". Never "해서",
    /// "해야", "했어", "하라고" (the next letter must not be Hangul).
    static let ending = #"\s?(?:봐줘|봐요|봐라|봐봐|봐바|봐|보자|볼래|줘봐|줘요|줘|주세요|라)?(?![가-힣A-Za-z])"#
    static let routeVerb = #"라우팅\s*(?:을\s*)?(?:해|시켜|돌려)"# + ending
    static let sendVerb = #"(?:시켜|돌려|보내|던져|뿌려)"# + ending
    /// Sending without a routing word never "runs" ("전체 모델 돌려봐" runs a benchmark).
    static let sendOnlyVerb = #"(?:시켜|보내|던져|뿌려)"# + ending
    static let plainVerb = #"해"# + ending
    static let canRoute = #"(?:(?:할|하는|될|되는)\s*수\s*있는|가능한)"#
    static let orders: [String] = [
        // "라우팅 할 수 있는 쪽으로 최대한 다 라우팅 해봐", "라우팅 가능한 경로로 다 해봐"
        #"라우팅\s*"# + canRoute + #"\s*"# + target + #"\s*"# + toward +
            #"\s*(?:최대한\s*)?"# + all + #"\s*(?:"# + routeVerb + "|" + sendVerb + "|" + plainVerb + ")",
        // The owner's idiom: "라우팅 할 수 있는데 다 시켜", "라우팅 되는 데 다 시켜봐"
        #"라우팅\s*(?:"# + canRoute + "|되는|하는)" + #"\s*"# + routableWhat + #"\s*(?:으로|로|에)?\s*(?:최대한\s*)?"# + all +
            #"\s*(?:"# + routeVerb + "|" + sendVerb + "|" + plainVerb + ")",
        // "할 수 있는 거 다 라우팅 해봐", "할 수 있는 데로 다 라우팅 해봐"
        #"(?<![가-힣])"# + canRoute + #"\s*"# + routableWhat + #"\s*(?:으로|로|에)?\s*(?:최대한\s*)?"# + all + #"\s*"# + routeVerb,
        // "할 수 있는 쪽으로 다 보내봐", "가능한 백엔드로 전부 라우팅해"
        #"(?<![가-힣])"# + canRoute + #"\s*"# + target + #"\s*"# + toward +
            #"\s*(?:최대한\s*)?"# + all + #"\s*(?:"# + routeVerb + "|" + sendVerb + ")",
        // "최대한 다 라우팅 해봐", "전부 라우팅해", "다 라우팅 시켜봐"
        #"(?:(?<![가-힣])(?:최대한|가능한\s?한)\s*)?"# + all + #"\s*"# + routeVerb,
        // "라우팅 다 해봐", "라우팅 최대한 전부 시켜"
        #"(?<![가-힣])라우팅\s*(?:을\s*)?(?:최대한\s*)?"# + all + #"\s*(?:해|시켜|돌려)"# + ending,
        // "최대한 라우팅 해봐", "최대한 많은 쪽으로 라우팅해"
        #"(?<![가-힣])최대한\s*(?:많이\s*|많은\s*"# + target + #"\s*"# + toward + #"\s*)?"# + routeVerb,
        // "모든 경로로 라우팅해", "전부 쪽으로 라우팅해": a routing word, any target.
        #"(?<![가-힣])(?:모든|전체|전부)\s*(?:의\s*)?"# + target + #"\s*"# + toward + #"\s*(?:다\s*)?"# + routeVerb,
        // "모든 모델로 보내봐", "모든 쪽으로 보내봐": a surface target with its particle.
        #"(?<![가-힣])(?:모든|전체|전부)\s*(?:의\s*)?"# + surfaceTarget + #"\s*"# + towardRequired + #"\s*(?:다\s*)?"# + sendOnlyVerb,
        // After an exclusion: "GPT 빼고 나머지 모델로 다 라우팅 해봐", "나머지 쪽으로 다 보내봐".
        #"(?<![가-힣])(?:나머지|남은)\s*(?:"# + target + #"\s*"# + toward + #"\s*(?:다|전부|모두)?\s*"# + routeVerb + "|" +
            surfaceTarget + #"\s*"# + towardRequired + #"\s*(?:다|전부|모두)?\s*"# + sendOnlyVerb + ")",
        // English: "route to all backends", "send this to every available model".
        #"(?<![A-Za-z])(?:route|send|dispatch|fan\s*-?\s*out)\s+(?:(?:it|this|that|them|these|those)\s+)?(?:to|through|across|on|over)\s+(?:all|every|each)\s+(?:(?:of\s+)?the\s+)?(?:available\s+|possible\s+|routable\s+)?(?:routes?|backends?|surfaces?|models?|providers?|lanes?|engines?)(?![A-Za-z])"#,
        // "route it to as many backends as possible"
        #"(?<![A-Za-z])(?:route|send|dispatch)\s+(?:(?:it|this|that|them|these|those)\s+)?(?:to|through|across|on)\s+as\s+many\s+(?:routes|backends|surfaces|models|providers|lanes)\s+as\s+(?:possible|you\s+can)(?![A-Za-z])"#,
        // "route it everywhere"
        #"(?<![A-Za-z])route\s+(?:(?:it|this|that|them|these|those)\s+)?everywhere(?:\s+(?:possible|you\s+can))?(?![A-Za-z])"#,
    ]
    /// An order that lists the routes: "로컬이랑 클로드 코드랑 코덱스 이렇게 세 개로
    /// 라우팅 해봐", "클로드랑 코덱스 다 라우팅 해봐", "로컬이랑 코덱스한테 보내봐".
    static let namedOrder = nameBoundary + "(" + nameList + ")" +
        #"\s*(?:(?:이렇게|요렇게)\s*)?(?:((?:두|세|네|[2-4])\s?개|둘|셋|넷)\s*)?(?:(?:다|모두|전부|각각)\s*)?(?:(?:한테|에게|께|으로|로|에)\s*)?(?:(?:다|모두|전부|각각)\s*)?(?:"# +
        routeVerb + "|" + sendVerb + ")"
    /// The word right after the order that makes it a report, a quote or a
    /// question, not an order: "모든 백엔드로 보내 버렸어", "다 라우팅 해봐 했더니 안
    /// 되더라", "다 라우팅 해 말아".
    static let continuation = #"^(?:했|됐|봤|버리|버린|버렸|놨|뒀|라고|하고|하더|하라|말아|말고|마(?![가-힣])|마라|말까|말자|싶|줄래|줄까|볼까|라는|이라는|하면|하자|그랬|드릴|드려|할게|할께|was|were|already|yesterday)"#
    /// A word right before the order that makes it a question, a negation or
    /// a hypothetical: "왜 다 라우팅 해", "why didn't you route it to all backends".
    static let governingRejection = #"^(?:왜|어떻게|뭐가|무슨|언제|어디|어디로|누가|몇|if|whether|why|how|when|would|could|should|can|cannot|can't|cant|did|didn't|didnt|don't|dont|do|does|not|never|was|were|has|have|had|won't|wont)$"#
    static let quotes = CharacterSet(charactersIn: "\"“”‘’'「」『』")
    /// Words of work on something other than OS-1's own routes. An order
    /// among them routes requests, traffic or code, not an answer to OS-1's
    /// surfaces ("nginx 설정에서 /api 트래픽을 모든 백엔드로 라우팅해", "Update the
    /// Envoy config and route the requests to all backends").
    static let foreignTerms = ["트래픽", "패킷", "쿼리", "웹훅", "엔드포인트", "서버", "프록시", "게이트웨이", "로드밸런서",
        "로드 밸런서", "엔진엑스", "설정", "코드", "파일", "함수", "클래스", "스크린샷", "사진", "이미지", "문서", "로그",
        "데이터베이스", "디비", "브랜치", "커밋", "빌드", "배포", "벤치마크", "클러스터", "레포", "저장소", "이슈", "티켓",
        "스크립트", "워크플로", "파이프라인", "라우터", "도메인", "포트", "큐", "웹소켓", "요청들", "작업들"]
    static let foreignEnglish = #"(?<![A-Za-z])(?:nginx|envoy|gateway|proxy|load\s*balancer|server|servers|webhooks?|endpoints?|apis?|config|configuration|code|files?|functions?|traffic|packets?|quer(?:y|ies)|jobs?|queues?|issues?|tickets?|prs?|repo|repository|branch|commit|build|deploy|benchmarks?|cluster|pods?|services?|dns|domains?|ports?|router|scripts?|pipelines?|workflows?|database|db|screenshots?|images?|documents?|logs?|k8s|kubernetes)(?![A-Za-z])"#
    /// "이거", "그거", "this": the order routes something already given.
    static let demonstratives: Set<String> = ["이거", "그거", "저거", "이걸", "그걸", "저걸", "이것", "그것", "저것", "이건",
        "그건", "이것들", "그것들", "이거를", "그거를", "이것을", "그것을", "얘", "걔", "요거", "this", "that", "these", "those", "it", "them"]
    /// "이 질문", "방금 거": a referenced noun after a pointing word.
    static let referencedNouns: Set<String> = ["질문", "요청", "문제", "내용", "메시지", "문장", "거", "것", "작업", "답", "답변"]
    static let pointers: Set<String> = ["이", "그", "저", "방금", "위", "위에", "아까", "위의", "이번"]

    /// The owner's order to route to every route (or to the listed ones), as
    /// a sentence of its own. Grants no dispatch authority: `plan` decides
    /// what runs, and a recognised order may be held (`Order.hold`).
    public static func recognizes(_ prompt: String) -> Bool { order(prompt) != nil }

    struct Found {
        let index: Int
        let clause: String
        let order: NSRange
        /// Names listed in the order ("로컬이랑 클로드 코드랑 코덱스").
        let named: [Name]
        /// The order governs "이거"/"this": it routes something already given.
        let referenced: Bool
    }

    static func canonical(_ prompt: String) -> String {
        prompt.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The order sentence in `text` (exclusion phrases already blanked), or
    /// nil: no order, an order that is not one (question, quote, report,
    /// negation) or an order to route something other than OS-1's answers.
    static func find(_ text: String) -> Found? {
        let named = try? NSRegularExpression(pattern: namedOrder, options: [.caseInsensitive])
        for (index, clause) in RouteFanout.clauses(text).enumerated() {
            let value = clause as NSString
            // The arithmetic may stand inside the order ("모든 모델로 원플러스원
            // 보내봐", "코덱스랑 로컬로 1+1 보내봐"): the order is matched with each
            // expression blanked, positions unchanged.
            let probe = masked(clause)
            var candidate: (range: NSRange, named: [Name])?
            if let named, let match = named.firstMatch(in: probe, range: NSRange(location: 0, length: value.length)) {
                let listed = names(in: value.substring(with: match.range(at: 1)))
                // A list names at least two routes, or the local model alone.
                if listed.count >= 2 || listed.contains(where: { $0.kind == .surface(.local) }) {
                    // "세 개로": the owner's count matches the names listed.
                    let count = match.range(at: 2).location == NSNotFound ? nil : routeCount(value.substring(with: match.range(at: 2)))
                    if count.map({ $0 == listed.count }) ?? true { candidate = (match.range, listed) }
                    else { return nil }
                }
            }
            // The order that starts first, the longest at one start: "모든 백엔드로
            // 다 라우팅 해" is one order, not "다 라우팅 해" after a stray "모든 백엔드로".
            if candidate == nil, let found = orders.compactMap({ probe.range(of: $0, options: [.regularExpression, .caseInsensitive]) })
                .map({ NSRange($0, in: probe) })
                .min(by: { $0.location != $1.location ? $0.location < $1.location : $0.length > $1.length }) {
                candidate = (found, [])
            }
            guard let (order, listed) = candidate else { continue }
            let head = value.substring(to: order.location), tail = value.substring(from: NSMaxRange(order))
            let span = value.substring(with: order)
            // A quoted order is an example, not an order.
            if head.unicodeScalars.last.map(quotes.contains) == true || tail.unicodeScalars.first.map(quotes.contains) == true
            { continue }
            // The word right after the order: a report, a quote or a question.
            let after = tail.trimmingCharacters(in: .whitespaces)
            if tail.first?.isWhitespace == true || tail.isEmpty,
               let word = after.split(whereSeparator: { $0.isWhitespace }).first,
               String(word).range(of: continuation, options: [.regularExpression, .caseInsensitive]) != nil { continue }
            // "다 라우팅 해?": the order itself ends with a question mark.
            if after.trimmingCharacters(in: CharacterSet(charactersIn: "?？ ")).isEmpty,
               RouteFanout.endsWithQuestionMark(clause, in: text) { continue }
            // The words right before the order, within its part of the clause.
            let segment = head.components(separatedBy: CharacterSet(charactersIn: ",，;:：")).last ?? head
            let before = segment.lowercased().split(whereSeparator: { $0.isWhitespace }).map(String.init)
            if before.suffix(2).contains(where: { $0.range(of: governingRejection, options: .regularExpression) != nil }) { continue }
            // Names left in the order's clause beside the order: a destination
            // ("다 라우팅 해봐 코덱스한테") makes it a directed request, not a
            // route-all order.
            let rest = value.replacingCharacters(in: order, with: " ")
            if listed.isEmpty, names(in: rest).contains(where: { name in
                let following = (rest as NSString).substring(from: NSMaxRange(name.range))
                return following.range(of: #"^\s?(?:한테|에게|께|으로|로)"#, options: .regularExpression) != nil
            }) { return nil }
            // Something other than OS-1's answers to route: ordinary work.
            let scanned = (segment + " " + span + (span.unicodeScalars.first.map { CharacterSet.letters.contains($0) && $0.isASCII } == true
                ? " " + (tail.components(separatedBy: CharacterSet(charactersIn: ",，;:：")).first ?? tail) : ""))
            if foreign(scanned) { return nil }
            var referenced = span.range(of: #"^(?:route|send|dispatch|fan\s*-?\s*out)\s+(?:it|this|that|them|these|those)\s"#,
                                        options: [.regularExpression, .caseInsensitive]) != nil
            for (position, word) in before.enumerated().reversed() {
                let bare = word.trimmingCharacters(in: CharacterSet(charactersIn: ",.!~"))
                if demonstratives.contains(bare) { referenced = true; break }
                if referencedNouns.contains(stem(bare)), position > 0, pointers.contains(before[position - 1]) { referenced = true; break }
                if allowed(bare) { continue }
                if foreignObject(bare) { return nil }
                break
            }
            return Found(index: index, clause: clause, order: order, named: listed, referenced: referenced)
        }
        return nil
    }

    static func routeCount(_ written: String) -> Int? {
        let value = written.replacingOccurrences(of: #"\s|개"#, with: "", options: .regularExpression)
        return ["두": 2, "둘": 2, "2": 2, "세": 3, "셋": 3, "3": 3, "네": 4, "넷": 4, "4": 4][value]
    }

    /// Infrastructure or code words, OS-1's own route names aside.
    static func foreign(_ text: String) -> Bool {
        var value = text.lowercased()
        for name in names(in: value).reversed() {
            if let range = Range(name.range, in: value) { value.replaceSubrange(range, with: " ") }
        }
        if foreignTerms.contains(where: value.contains) { return true }
        if value.range(of: foreignEnglish, options: .regularExpression) != nil { return true }
        // A path or a file: "/api", "/v1", "server.ts".
        return value.range(of: #"(?:^|\s)/[A-Za-z0-9]|[A-Za-z]\.[A-Za-z]{1,5}(?![A-Za-z])"#, options: .regularExpression) != nil &&
            !value.contains("e.g")
    }
    /// The object the order governs, when it is something else to route:
    /// "요청을", "트래픽을" (accusative), "요청들" (a plural), "로드밸런서에서" (a place).
    static func foreignObject(_ word: String) -> Bool {
        guard word.unicodeScalars.contains(where: { (0xAC00...0xD7A3).contains($0.value) }), word.count >= 2 else {
            return word.range(of: foreignEnglish, options: .regularExpression) != nil
        }
        if demonstratives.contains(word) { return false }
        return word.hasSuffix("을") || word.hasSuffix("를") || word.hasSuffix("에서") ||
            word.range(of: #"들(?:을|를|은|는|도)?$"#, options: .regularExpression) != nil || foreign(word)
    }

    static func remainder(_ clause: String, removing order: NSRange) -> String {
        (clause as NSString).replacingCharacters(in: order, with: " ")
    }

    // MARK: Expressions

    /// Spoken and written numbers, longest spelling first: English
    /// transliterations (원, 투, 쓰리 ... 텐), Sino-Korean (일, 이, 삼 ... 십),
    /// native Korean (하나 ... 열), English words and digits.
    public static let numberWords: [(word: String, value: Int)] = [
        ("에이트", 8), ("에잇", 8), ("파이브", 5), ("세븐", 7), ("나인", 9), ("식스", 6), ("쓰리", 3), ("스리", 3),
        ("제로", 0), ("투", 2), ("원", 1), ("포", 4), ("텐", 10),
        ("다섯", 5), ("여섯", 6), ("일곱", 7), ("여덟", 8), ("아홉", 9), ("하나", 1), ("둘", 2), ("셋", 3), ("넷", 4), ("열", 10),
        ("일", 1), ("이", 2), ("삼", 3), ("사", 4), ("오", 5), ("육", 6), ("륙", 6), ("칠", 7), ("팔", 8), ("구", 9), ("십", 10), ("영", 0),
        ("zero", 0), ("one", 1), ("two", 2), ("three", 3), ("four", 4), ("five", 5), ("six", 6), ("seven", 7),
        ("eight", 8), ("nine", 9), ("ten", 10),
    ]
    /// Operators as written, and the canonical one each means. Every one is
    /// in the exact verifier's family ("+", "-", "*").
    public static let operatorWords: [(word: String, symbol: String)] = [
        ("플러스", "+"), ("더하기", "+"), ("plus", "+"), ("+", "+"),
        ("마이너스", "-"), ("빼기", "-"), ("minus", "-"), ("-", "-"),
        ("곱하기", "*"), ("times", "*"), ("×", "*"), ("*", "*"),
    ]
    static let number = "(?:[0-9]{1,9}|" + numberWords.map { NSRegularExpression.escapedPattern(for: $0.word) }.joined(separator: "|") + ")"
    static let operation = "(?:" + operatorWords.map { NSRegularExpression.escapedPattern(for: $0.word) }.joined(separator: "|") + ")"
    /// A particle or a joining word right after an expression ("원플러스원이랑",
    /// "원 플러스 원 이랑", "원플러스원은?"): blanked with it. A one-letter
    /// particle attaches to the expression; a longer one may stand apart.
    static let trailingParticle = #"(?:\s*(?:이랑|하고|하구|이나)|(?:랑|과|와|나|은|는|이|가|을|를|도|요))(?![가-힣])"#
    /// Particles and joining words that may stand alone between expressions.
    static let particleWords: Set<String> = ["이랑", "랑", "하고", "하구", "과", "와", "이나", "나", "은", "는", "이", "가",
                                             "을", "를", "도", "요", "그리고", "또", "and", "or", "또는"]
    /// One expression at the current position: "원플러스원", "1 + 1", "two x two".
    /// It ends where no letter, digit or operator follows, after a particle
    /// ("원플러스원이랑"), or right before the next expression ("원플러스원투플러스투").
    static let expressionAtPosition: NSRegularExpression? = try? NSRegularExpression(pattern:
        "(" + number + ")(?:\\s*(" + operation + ")\\s*|\\s+([xX])\\s+)(" + number + ")(?:" + trailingParticle + ")?" +
        "(?=$|[^A-Za-z0-9가-힣+*×\\-]|" + number + "\\s*" + operation + ")",
        options: [.caseInsensitive])

    static func value(_ written: String) -> Int? {
        if let digits = Int(written), written.allSatisfy(\.isASCII) { return digits }
        let lowered = written.lowercased()
        return numberWords.first { $0.word == lowered }?.value
    }

    /// Every expression written in `text`, canonical and in order, and the
    /// text with each one (and its particle) blanked out.
    static func extract(_ text: String) -> (expressions: [String], rest: String) {
        let found = expressionRanges(text)
        var rest = text
        for item in found.reversed() {
            if let range = Range(item.range, in: rest) { rest.replaceSubrange(range, with: " ") }
        }
        return (found.map(\.canonical), rest)
    }
    /// `text` with every expression replaced by spaces of the same UTF-16
    /// length: positions in it are positions in `text`.
    static func masked(_ text: String) -> String {
        let value = NSMutableString(string: text)
        for item in expressionRanges(text) {
            value.replaceCharacters(in: item.range, with: String(repeating: " ", count: item.range.length))
        }
        return value as String
    }
    static func expressionRanges(_ text: String) -> [(range: NSRange, canonical: String)] {
        guard let regex = expressionAtPosition else { return [] }
        let value16 = text as NSString, length = value16.length
        func wordCharacter(_ unit: unichar) -> Bool {
            (unit >= 48 && unit <= 57) || (unit >= 65 && unit <= 90) || (unit >= 97 && unit <= 122) || (unit >= 0xAC00 && unit <= 0xD7A3)
        }
        var found: [(range: NSRange, canonical: String)] = []
        var position = 0, lastEnd = -1
        while position < length {
            let atBoundary = position == 0 || position == lastEnd || !wordCharacter(value16.character(at: position - 1))
            if atBoundary, let match = regex.firstMatch(in: text, options: [.anchored], range: NSRange(location: position, length: length - position)),
               match.range.length > 0 {
                let left = value16.substring(with: match.range(at: 1)), right = value16.substring(with: match.range(at: 4))
                let symbolRange = match.range(at: 2).location != NSNotFound ? match.range(at: 2) : match.range(at: 3)
                let written = value16.substring(with: symbolRange).lowercased()
                let symbol = written == "x" ? "*" : operatorWords.first { $0.word == written }?.symbol
                if let a = value(left), let b = value(right), let symbol {
                    found.append((match.range, "\(a)\(symbol)\(b)"))
                    position = NSMaxRange(match.range); lastEnd = position
                    continue
                }
            }
            position += 1
        }
        return found
    }

    // MARK: Framing

    /// Words that may stand beside the order and the arithmetic: openers and
    /// a description of the simple calculation to send.
    static let allowedWords: Set<String> = [
        "너", "니", "네", "니가", "네가", "야", "자", "음", "아", "어", "그", "그럼", "그러면", "그니까", "그러니까", "일단", "한번",
        "한", "번", "좀", "지금", "바로", "이번엔", "이번에", "이번에는", "이번", "다시", "그냥", "오케이", "빨리", "얼른", "같이",
        "알았어", "알겠어", "좋아", "그래", "이제", "우선", "먼저", "제발", "부탁해", "또", "한번만", "자자", "그리고",
        "엄청", "아주", "진짜", "완전", "되게", "매우", "정말", "간단한", "간단하게", "간단히", "쉬운", "쉽게", "단순한", "작은",
        "짧은", "기본적인", "알제브라", "알지브라", "대수", "산수", "덧셈", "뺄셈", "곱셈", "계산", "수학", "문제", "연산",
        "예를", "들면", "들어", "예를들면", "예를들어", "예시", "예컨대", "가령", "뭐", "이런", "그런", "저런", "요런", "이렇게",
        "같은", "거", "것", "걸", "정도", "수준", "있잖아", "있잖아요", "말이야", "처럼", "식으로", "식", "그거", "이거", "테스트",
        "please", "now", "ok", "okay", "hey", "just", "quickly", "let's", "lets", "so", "then", "go", "ahead", "simple", "easy", "basic", "arithmetic", "algebra",
        "math", "maths", "sum", "sums", "like", "eg", "e.g", "for", "example", "something", "some", "test", "a", "an",
        "the", "such", "as", "very", "really", "small", "quick", "with",
    ]
    static let particleSuffix = #"(?:으로요|으로|이랑|처럼|은|는|이|가|을|를|도|만|로|에|요|야|랑)$"#
    static func stem(_ word: String) -> String {
        word.replacingOccurrences(of: particleSuffix, with: "", options: .regularExpression)
    }
    static func allowed(_ word: String) -> Bool {
        if allowedWords.contains(word) || particleWords.contains(word) { return true }
        let stem = stem(word)
        return stem != word && !stem.isEmpty && allowedWords.contains(stem)
    }
    /// Nothing but allowed words, once the expressions are taken out.
    static func onlyAllowed(_ text: String) -> Bool {
        text.lowercased().split(whereSeparator: { $0.isWhitespace || ",.?!~:;·…()[]".contains($0) })
            .allSatisfy { allowed(String($0)) }
    }
    /// A remark on the previous routing beside the order, which carries no
    /// instruction: "아까는 하나로만 갔잖아", "방금 아스트라로 갔어".
    static let previousRouting = #"^(?:아까(?:는|도)?|방금(?:은|도)?|좀\s?전에(?:는)?|이전엔|전엔|저번엔|지난번엔)\s+(?:\S+\s+){0,4}?\S*(?:갔|됐|넘어갔|돌았|나왔|보냈|넘겼)(?:잖아요?|어요?|었어|네|더라|다)$"#
    /// One piece of the request beside the order: allowed words around the
    /// arithmetic, or a whole frame sentence (`RouteFanout`'s side sentences,
    /// a previous-routing remark) once the arithmetic is taken out.
    static func framing(_ piece: String, in text: String, leading: Bool) -> (ok: Bool, expressions: [String]) {
        let extracted = extract(piece)
        if onlyAllowed(extracted.rest) { return (true, extracted.expressions) }
        let rest = extracted.rest.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: " ,.!?~"))
        // Openers at the edges ("…갔잖아 이번엔") are not the sentence.
        var words = rest.split(separator: " ").map(String.init)
        while let last = words.last, allowed(last.lowercased()) { words.removeLast() }
        while let first = words.first, allowed(first.lowercased()) { words.removeFirst() }
        for sentence in [rest, words.joined(separator: " ")] where sentence.isEmpty ||
            RouteFanout.sideSentence(sentence, in: text, leading: leading) ||
            sentence.range(of: previousRouting, options: .regularExpression) != nil { return (true, extracted.expressions) }
        return (false, [])
    }

    /// The recognised order in `prompt`, or nil when it is none.
    public static func order(_ prompt: String) -> Order? {
        let text = canonical(prompt)
        guard !text.isEmpty, text.count <= RouteFanout.maximumCharacters, !text.contains("```") else { return nil }
        let (stripped, excludedNames) = removingExclusions(text)
        guard let found = find(stripped) else { return nil }
        var gptNames = excludedNames.filter { $0.kind == .gpt }.map(\.text)
        var covered = Set(surfaceOrder)
        if !found.named.isEmpty {
            covered = Set(found.named.compactMap { if case .surface(let surface) = $0.kind { return surface } else { return nil } })
            gptNames += found.named.filter { $0.kind == .gpt }.map(\.text)
        }
        var excluded: [String] = []
        for name in excludedNames {
            guard case .surface(let surface) = name.kind else { continue }
            excluded.append(name.text)
            covered.remove(surface)
            // "클로드 빼고": both Claude surfaces are left out.
            if surface == .claudeChat { covered.remove(.claude) }
        }
        var expressions: [String] = [], held = false
        let clauses = RouteFanout.clauses(stripped)
        for (index, clause) in clauses.enumerated() {
            var pieces: [(String, Bool)] = []
            if index == found.index {
                let value = clause as NSString
                for piece in value.substring(to: found.order.location).components(separatedBy: CharacterSet(charactersIn: ",，;:：")) {
                    pieces.append((piece, true))
                }
                // The arithmetic written inside the order itself.
                pieces.append((extract(value.substring(with: found.order)).expressions.joined(separator: " "), true))
                for piece in value.substring(from: NSMaxRange(found.order)).components(separatedBy: CharacterSet(charactersIn: ",，;:：")) {
                    pieces.append((piece, false))
                }
            } else {
                for piece in clause.components(separatedBy: CharacterSet(charactersIn: ",，;:：")) { pieces.append((piece, index < found.index)) }
            }
            for (piece, leading) in pieces {
                let result = framing(piece, in: stripped, leading: leading)
                if result.ok { expressions += result.expressions } else { held = true }
            }
        }
        // A route named outside the order ("1+1 Codex한테. 다 라우팅 해봐"): held.
        let outside = names(in: remainder(clauses.indices.contains(found.index) ? clauses[found.index] : "", removing: found.order)).count +
            clauses.enumerated().filter { $0.offset != found.index }.reduce(0) { $0 + names(in: $1.element).count }
        if outside > 0 || expressions.count > RouteFanout.maximumTargets { held = true }
        var seen = Set<String>()
        expressions = expressions.filter { seen.insert($0).inserted }
        let hold: Hold? = held ? .notArithmetic : found.referenced && expressions.isEmpty ? .referencedContent : nil
        return Order(surfaces: surfaceOrder.filter(covered.contains), named: !found.named.isEmpty, gptNames: gptNames,
                     excluded: excluded, expressions: hold == nil ? expressions : [], hold: hold)
    }

    /// The owner's expressions, or nil when the request is no order or the
    /// order is held. Empty: none written.
    public static func expressions(_ prompt: String) -> [String]? {
        guard let order = order(prompt), order.hold == nil else { return nil }
        return order.expressions
    }

    /// The explicit routes of a supported order on the `available` surfaces
    /// (kept in `surfaceOrder`). Routes may be empty: nothing can run now.
    public static func plan(_ order: Order, available: [Surface]) -> Plan? {
        guard order.hold == nil else { return nil }
        let surfaces = order.surfaces.filter(available.contains)
        let pool = order.expressions.isEmpty ? defaultExpressions : order.expressions
        let routes = surfaces.enumerated().map { index, surface in
            RCCRuntimeContract.ExplicitRoute(surface: surface, instruction: pool[index % pool.count])
        }
        let unsent = surfaces.count < order.expressions.count ? Array(order.expressions[surfaces.count...]) : []
        return Plan(routes: routes, expressions: order.expressions, unsent: unsent)
    }
    /// `plan` for a request; nil when it is no order, or a held one.
    public static func plan(_ prompt: String, available: [Surface]) -> Plan? {
        order(prompt).flatMap { plan($0, available: available) }
    }

    /// The request routes to the local model by name (named parts, or an
    /// order that lists it). `RouteFanout` knows no local name: such a request
    /// is planned here, never by `RouteFanout` without its local route.
    public static func namesLocalRoute(_ prompt: String) -> Bool {
        namedParts(prompt) != nil || order(prompt).map { $0.named && $0.surfaces.contains(.local) } == true
    }

    // MARK: Named parts with the local model

    /// Parts that each name their route, the local model among them: "1+1
    /// Codex한테. 2+2 Claude Code한테. 3+3 로컬한테." `RouteFanout` knows no local
    /// name, so such a request would run whole on Auto. Every sentence must be
    /// a part or framing; GPT-named parts are dropped, visibly.
    public struct NamedParts: Equatable, Sendable {
        public let routes: [RCCRuntimeContract.ExplicitRoute]
        /// GPT-named parts as written ("GPT한테: 1+1"): never run.
        public let gptParts: [String]
    }
    static let dative = #"\s?(?:한테|에게|께|으로|로)(?:는|도|만)?"#

    public static func namedParts(_ prompt: String) -> NamedParts? {
        let text = canonical(prompt)
        guard !text.isEmpty, text.count <= RouteFanout.maximumCharacters, !text.contains("```"), mentionsLocal(text) else { return nil }
        var routes: [RCCRuntimeContract.ExplicitRoute] = [], gpt: [String] = [], local = false
        // "코덱스한테 1+1 보내고 로컬한테 2+2 보내": one part per handover.
        let joined = text.replacingOccurrences(of: #"(?<=(?:보내|시키|넘기|맡기|던지|물어보|돌리)고)\s+|\s+그리고\s+"#,
                                               with: ", ", options: .regularExpression)
        for clause in RouteFanout.clauses(joined) {
            for piece in clause.components(separatedBy: CharacterSet(charactersIn: ",，;")) {
                let value = piece.trimmingCharacters(in: .whitespaces)
                if value.isEmpty { continue }
                if let part = namedPart(value) {
                    switch part.kind {
                    case .gpt: gpt.append(part.mention + ": " + part.expression)
                    case .surface(let surface):
                        let route = RCCRuntimeContract.ExplicitRoute(surface: surface, instruction: part.expression)
                        if !routes.contains(route) { routes.append(route) }
                        if surface == .local { local = true }
                    }
                    continue
                }
                guard names(in: value).isEmpty, extract(value).expressions.isEmpty,
                      RouteFanout.sideSentence(value, in: joined, leading: routes.isEmpty && gpt.isEmpty) || onlyAllowed(value) else { return nil }
            }
        }
        guard local, routes.count + gpt.count <= RouteFanout.maximumTargets else { return nil }
        return NamedParts(routes: routes, gptParts: gpt)
    }
    /// "3+3 로컬한테", "로컬한테 3+3 보내": one name with its particle and one
    /// expression; the routing words around them are left out.
    static func namedPart(_ piece: String) -> (kind: NameKind, mention: String, expression: String)? {
        let found = names(in: piece)
        guard found.count == 1, let name = found.first else { return nil }
        let value = piece as NSString
        let after = value.substring(from: NSMaxRange(name.range))
        guard let particle = after.range(of: "^" + dative, options: .regularExpression) else { return nil }
        let mention = name.text + after[particle]
        let rest = value.substring(to: name.range.location) + " " + after[particle.upperBound...]
        let extracted = extract(RouteFanout.strip(rest))
        guard extracted.expressions.count == 1, onlyAllowed(RouteFanout.strip(extracted.rest)) else { return nil }
        return (name.kind, mention, extracted.expressions[0])
    }

    // MARK: Self-test

    public static func selfTest() throws {
        var failed: [String] = []
        func check(_ value: Bool, _ name: String) { if !value { failed.append(name) } }
        let all = surfaceOrder
        func routes(_ prompt: String, _ available: [Surface] = surfaceOrder) -> [String]? {
            plan(prompt, available: available)?.routes.map { $0.surface.rawValue + ":" + $0.instruction }
        }
        let incident = "너 라우팅 할 수 있는 쪽으로 최대한 다 라우팅 해봐. 엄청 간단한 알제브라 계산 있잖아.\n뭐 원플러스원 투플러스투 이런 거 있잖아."
        check(recognizes(incident), "the build 381 incident is a route-all order")
        check(expressions(incident) == ["1+1", "2+2"], "원플러스원 투플러스투 → 1+1, 2+2")
        check(routes(incident) == ["local:1+1", "codex:2+2", "claude:1+1", "claude-chat:2+2"],
              "the incident reaches local, Codex, Claude Code and Claude chat, round robin")
        check(routes(incident, [.codex, .claude]) == ["codex:1+1", "claude:2+2"], "only the available surfaces, in route order")
        check(plan(incident, available: [])?.routes == [], "recognised with nothing available: no route, never a single task")
        check(plan(incident, available: all)?.defaulted == false, "the owner's expressions are used")
        // Defaults when none is written.
        check(routes("최대한 다 라우팅 해봐") == ["local:1+1", "codex:2+2", "claude:3+3", "claude-chat:4+4"],
              "no expression: 1+1, 2+2, 3+3, 4+4 in route order")
        check(plan("최대한 다 라우팅 해봐", available: all)?.defaulted == true, "defaulted is reported")
        for prompt in ["다 라우팅 해봐", "전부 라우팅해", "다 라우팅 시켜봐", "라우팅 할 수 있는 쪽으로 다 해봐",
                       "할 수 있는 쪽으로 다 보내봐", "가능한 백엔드로 전부 라우팅해", "모든 백엔드로 라우팅해",
                       "모든 모델로 보내봐", "전부 쪽으로 라우팅해", "모든 쪽으로 라우팅 해줘", "최대한 라우팅 해봐",
                       "라우팅 가능한 경로로 다 해봐", "자 이번엔 라우팅 할 수 있는 거 다 해봐", "모든 경로로 라우팅해",
                       "Route to all backends", "route to every available model", "fan out to all backends",
                       "ok let's route to all backends", "다 라우팅 해봐. 원 플러스 원, 투 플러스 투",
                       "라우팅 테스트야. 다 라우팅 해봐. 답변 받아와.", "알았어 그럼 다 라우팅 해봐",
                       "다 라우팅 해봐. 안 되면 말해.",
                       // A return condition or a remark on the previous routing joined
                       // by a comma, or not punctuated at all (voice input).
                       "다 라우팅 해봐, 안 되면 말해", "다 라우팅 해봐 안 되면 말해",
                       "최대한 다 라우팅 해봐 아까는 하나로만 갔잖아", "최대한 다 라우팅 해봐. 아까는 하나로만 갔잖아",
                       "아까 하나로만 갔잖아 이번엔 다 라우팅 해봐",
                       // The owner's own idiom and the order worded around "할 수 있는".
                       "라우팅 할 수 있는데 다 시켜봐. 원플러스원 투플러스투", "라우팅 할 수 있는데 다 시켜", "라우팅 되는 데 다 시켜봐",
                       "할 수 있는 거 다 라우팅 해봐", "할 수 있는 데로 다 라우팅 해봐",
                       // A particle joining the expressions.
                       "다 라우팅 해봐. 원플러스원이랑 투플러스투", "다 라우팅 해봐. 1+1이랑 2+2", "다 라우팅 해봐. 원플러스원하고 투플러스투",
                       "다 라우팅 해봐. 원 플러스 원 이랑 투 플러스 투", "다 라우팅 해봐. 원플러스원은?",
                       // "this"/"이거" with the expressions written: they are what it refers to.
                       "이거 다 라우팅 해봐. 원플러스원 투플러스투", "route these to all backends: 1+1, 2+2",
                       // GPT is never routed: excluding it leaves every route.
                       "GPT 빼고 다 라우팅 해봐", "GPT 말고 할 수 있는 쪽으로 다 라우팅 해봐. 원플러스원",
                       "GPT 빼고 나머지 모델로 다 라우팅 해봐", "GPT는 빼고 나머지 쪽으로 다 보내봐. 1+1",
                       "라우팅 다 해봐", "모든 모델로 원플러스원 보내봐",
                       // Naming a route to include it in "every route".
                       "로컬도 포함해서 다 라우팅 해봐", "로컬까지 다 라우팅 해봐", "다 라우팅 해봐 로컬도"] {
            check(recognizes(prompt) && plan(prompt, available: all)?.routes.count == 4, "route-all: " + prompt)
        }
        check(routes("다 라우팅 해봐, 안 되면 말해. 원플러스원 투플러스투") == ["local:1+1", "codex:2+2", "claude:1+1", "claude-chat:2+2"],
              "a comma-joined return condition is framing")
        check(order("GPT 빼고 다 라우팅 해봐")?.gptNames == ["GPT"], "an excluded GPT is named for the notice")
        check(routes("Codex 빼고 다 라우팅 해봐. 1+1") == ["local:1+1", "claude:1+1", "claude-chat:1+1"], "an excluded route is left out")
        check(routes("클로드 빼고 다 라우팅 해봐") == ["local:1+1", "codex:2+2"], "excluding Claude leaves out both Claude surfaces")
        // Named routes: exactly the listed ones, the local model included.
        check(routes("로컬이랑 클로드 코드랑 코덱스 이렇게 세 개로 라우팅 해봐. 원플러스원 투플러스투") == ["local:1+1", "codex:2+2", "claude:1+1"],
              "the owner's three named routes, local included")
        check(routes("클로드랑 코덱스 다 라우팅 해봐") == ["codex:1+1", "claude-chat:2+2"], "a named pair with the default arithmetic")
        check(routes("코덱스랑 로컬로 원플러스원 보내봐") == ["local:1+1", "codex:1+1"], "the arithmetic inside a named order")
        check(routes("로컬로 라우팅 해봐. 원플러스원") == ["local:1+1"], "the local model alone")
        check(order("GPT랑 코덱스 다 라우팅 해봐")?.gptNames == ["GPT"] && routes("GPT랑 코덱스 다 라우팅 해봐") == ["codex:1+1"],
              "a listed GPT never runs and is named")
        check(!recognizes("로컬이랑 코덱스 네 개로 라우팅 해봐"), "a count that does not match the names is no order")
        // Named parts with the local model.
        check(namedParts("1+1 Codex한테. 2+2 Claude Code한테. 3+3 로컬한테.")?.routes.map { $0.surface.rawValue + ":" + $0.instruction }
              == ["codex:1+1", "claude:2+2", "local:3+3"], "parts naming the local model one by one")
        check(namedParts("로컬한테 원플러스원, 코덱스한테 투플러스투 보내")?.routes.count == 2, "comma-separated named parts")
        check(namedParts("코덱스한테 1+1 보내고 로컬한테 2+2 보내")?.routes.map { $0.surface.rawValue + ":" + $0.instruction }
              == ["codex:1+1", "local:2+2"], "parts joined by a handover")
        check(namedParts("1+1 GPT한테. 2+2 로컬한테.")?.gptParts == ["GPT한테: 1+1"], "a GPT part is dropped, visibly")
        check(namedParts("1+1 Codex한테. 2+2 Claude Code한테.") == nil, "without the local model RouteFanout owns the parts")
        check(namedParts("로컬에서 빌드하고 1+1 Codex한테") == nil, "a part that is work keeps the request whole")
        // The Korean number table and operators.
        for (spoken, canonical) in [("원플러스원", "1+1"), ("투플러스투", "2+2"), ("쓰리 플러스 쓰리", "3+3"), ("포더하기포", "4+4"),
                                    ("파이브 마이너스 원", "5-1"), ("식스곱하기투", "6*2"), ("세븐 플러스 에잇", "7+8"),
                                    ("나인빼기텐", "9-10"), ("일 더하기 일", "1+1"), ("이 더하기 이", "2+2"),
                                    ("삼곱하기사", "3*4"), ("오 플러스 육", "5+6"), ("칠 플러스 팔", "7+8"), ("구 빼기 십", "9-10"),
                                    ("two x two", "2*2"), ("one plus one", "1+1"), ("1 + 1", "1+1"), ("12*3", "12*3"),
                                    ("하나 더하기 둘", "1+2"), ("에이트 플러스 제로", "8+0")] {
            check(extract(spoken).expressions == [canonical], "number table: \(spoken) → \(canonical)")
        }
        check(extract("원플러스원투플러스투").expressions == ["1+1", "2+2"], "unspaced chained expressions")
        check(extract("원플러스원이랑 투플러스투는").expressions == ["1+1", "2+2"], "particles after an expression")
        check(onlyAllowed(extract("원플러스원이랑 투플러스투는").rest), "a particle goes with its expression")
        check(extract("원래 하나씩 만 원").expressions.isEmpty, "number words outside an expression stay words")
        check(routes("다 라우팅 해봐. 1+1, 2+2, 3+3") == ["local:1+1", "codex:2+2", "claude:3+3", "claude-chat:1+1"],
              "three expressions round robin over four routes")
        check(routes("다 라우팅 해봐. 파이브 마이너스 원, 식스곱하기투") == ["local:5-1", "codex:6*2", "claude:5-1", "claude-chat:6*2"],
              "minus and times are sent as written")
        check(plan("다 라우팅 해봐. 1+1, 2+2, 3+3", available: [.codex, .claude])?.unsent == ["3+3"],
              "an expression no route receives is reported, not dropped")
        // Not an order to route everywhere.
        for prompt in ["다 라우팅이 안 돼", "라우팅 다 됐어?", "왜 다 라우팅 안 했어", "다 라우팅하면 비용이 얼마야",
                       "다 라우팅 하지 마", "모든 백엔드로 라우팅되는 거 맞아?", "모든 모델로 라우팅하는 로직 고쳐",
                       "또 내가 이렇게 시켰잖아? 라우팅 할 수 있는데 다 시켜라고?", "다 라우팅 했잖아",
                       "모든 백엔드로 보내 버렸어", "다 라우팅 해보겠습니다", "라우팅 로직 좀 봐줘", "라우팅이 이상해",
                       "다 라우팅 해야지", "다 라우팅 하라고 했잖아", "\"다 라우팅 해봐\"라고 쓰면 돼",
                       "if you route it to all backends what happens", "why didn't you route it to all backends",
                       "다 라우팅 해봐 코덱스한테", "코덱스한테 다 라우팅 해봐", "1+1 계산해", "원플러스원 해봐",
                       "다 돌려봐", "모든 테스트 돌려", "이거 다 해봐", "다 라우팅 해봐 했더니 안 되더라", "왜 다 라우팅 해",
                       "다 라우팅 해?",
                       // "전체 경로" is a full path; running every model is a benchmark.
                       "전체 경로 보내줘", "그거 전체 경로 보내줘", "이거 전체 경로 보내줘", "전체 경로로 보내줘", "모든 경로 보내줘",
                       "그 스크린샷 전체 경로 보내줘", "전체 모델 돌려봐", "벤치마크 전체 모델 돌려봐", "벤치마크 전체 모델로 보내봐",
                       // Work orders that route requests, traffic or code.
                       "nginx 설정 바꿔서 요청을 모든 백엔드로 보내", "Update the nginx config to route the requests to all backends",
                       "nginx 설정에서 /api 트래픽을 모든 백엔드로 라우팅해", "API 게이트웨이에서 /v1 요청을 전부 라우팅해",
                       "로드밸런서에서 요청을 다 라우팅 해줘", "이 PR 요청들 전부 라우팅해",
                       "Update the Envoy config and route the requests to all backends.",
                       "dispatch these to all providers in the webhook fan-out code"] {
            check(!recognizes(prompt), "not route-all: " + prompt)
        }
        // Recognised, but carrying something besides arithmetic, or routing
        // "this" with nothing written: never a single task, never sent.
        for prompt in ["다 라우팅 해봐. 수도가 어디야", "모든 모델로 보내봐, 그리고 코드 리뷰 받아",
                       "다 라우팅 해봐. 그리고 커밋해", "최대한 다 라우팅 해봐 README 요약해서",
                       "다 라우팅 해봐 원플러스원 투플러스투 아까처럼 아스트라로 가지 말고",
                       "1+1 Codex한테. 다 라우팅 해봐", "이 질문 다 라우팅 해봐"] {
            check(recognizes(prompt) && order(prompt)?.hold == .notArithmetic && plan(prompt, available: all) == nil,
                  "recognised but unsupported: " + prompt)
        }
        for prompt in ["이거 모든 모델로 보내봐", "그거 다 라우팅 해봐", "이거 할 수 있는 쪽으로 다 보내봐",
                       "send this to every available model", "Route it to all backends", "route it everywhere",
                       "route this to as many backends as possible"] {
            check(recognizes(prompt) && order(prompt)?.hold == .referencedContent && plan(prompt, available: all) == nil,
                  "routes what was referenced, nothing written: held, never the defaults: " + prompt)
        }
        guard failed.isEmpty else { throw RouteAllIntentError.selfTest(failed) }
    }
}

public enum RouteAllIntentError: Error, CustomStringConvertible {
    case selfTest([String])
    public var description: String {
        switch self { case .selfTest(let failed): return "Route-all self-test failed: " + failed.joined(separator: "; ") }
    }
}
