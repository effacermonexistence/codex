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
///
/// The order is a composition, not a list of sentences (2026-10-15, build 384:
/// "야 네가 할 수 있는 거 중에 다 라우팅 시켜봐. 엄청 간단한 문제 뭐 1+1, 2+2 이런
/// 거." was held because "할 수 있는 거 중에" was neither order nor framing): what
/// can run ("할 수 있는 거 중에", "되는 모델", "갈 수 있는 데까지"), every route
/// ("다", "전부한테", "모든 모델로"), inline fillers and the arithmetic, then the
/// imperative. See `orders`.
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
        /// The order routes "this"/"that" ("이거 모든 모델로 보내봐"), points at
        /// earlier content ("다 라우팅 시켜봐 아까 거", "나머지도 다 라우팅 해봐",
        /// "send the question to all models") or presupposes it ("다 다시 라우팅
        /// 해봐", "다른 모델들한테도 전부 보내봐"), and no expression is written:
        /// what it refers to cannot be sent, and the defaults never replace it.
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
    /// Claude chat said as such ("클로드 챗", "claude chat"): only the chat
    /// surface, never Claude Code with it.
    static let claudeChatName = "(?:(?:" + ProviderNameAliases.claude + #")[\s\-]?(?:chat|챗|채팅)|클챗)"#
    /// "클코": the owner's short name for Claude Code ("클챗" for Claude chat).
    static let claudeCodeShortName = #"클코"#
    /// Longest names first, as `RouteFanout.names`, then the local model.
    static let nameTable: [(pattern: String, kind: @Sendable (String) -> NameKind)] = [
        // "Codex chat" names Codex (the chat lane went with GPT); "gpt-chat" names GPT.
        (ProviderNameAliases.gptChat, { $0.range(of: #"codex|코덱스"#, options: [.regularExpression, .caseInsensitive]) != nil
            ? .surface(.codex) : .gpt }),
        (ProviderNameAliases.claudeCode, { _ in .surface(.claude) }),
        (claudeCodeShortName, { _ in .surface(.claude) }),
        (ProviderNameAliases.chatGPT, { _ in .gpt }),
        (ProviderNameAliases.gpt, { _ in .gpt }),
        (ProviderNameAliases.codex, { _ in .surface(.codex) }),
        (claudeChatName, { _ in .surface(.claudeChat) }),
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
        nameBoundary + nameList + #"\s*(?:은|는|을|를|이|가|도|만)?\s*(?:빼고|빼놓고|빼곤|빼서|말고|제외하고|제외(?![가-힣]))|(?<![A-Za-z])(?:except|excluding|but\s+not|other\s+than|without)\s+"# +
        nameList, options: [.caseInsensitive])
    /// "안 되는 건 빼고", "연결 안 된 건 빼고": the routes that cannot run now,
    /// which `plan` leaves out anyway; the phrase excludes no named route.
    static let unavailableExclusion: NSRegularExpression? = try? NSRegularExpression(pattern:
        #"(?<![가-힣])(?:연결\s*)?안\s*(?:되는|된|돼\s*있는|되어\s*있는)\s*(?:거|건|것|데|모델|쪽|애들|애)(?:은|는|들은|들)?\s*(?:빼고|말고|제외하고)(?![가-힣])"#)

    /// "로컬도 포함해서", "로컬까지", "코덱스도": a route the owner includes in
    /// "every route" (they all are), not a named list or a destination.
    static let inclusion: NSRegularExpression? = try? NSRegularExpression(pattern:
        nameBoundary + nameList + #"\s*(?:(?:도|까지|을|를)?\s*(?:포함(?:해서|하고|해)|넣어서|넣고)|(?:도|까지)(?![가-힣]))|(?<![A-Za-z])including\s+"# +
        nameList, options: [.caseInsensitive])

    /// The text with every exclusion phrase blanked, and the names it excluded;
    /// inclusion phrases are blanked too (every route is already covered).
    static func removingExclusions(_ text: String) -> (text: String, excluded: [Name]) {
        let removed = removingExclusionPhrases(text)
        return (removed.text, removed.excluded)
    }
    /// `removingExclusions`, and whether an exclusion phrase was blanked: after
    /// one, "나머지" is the routes left, not the rest of earlier work.
    static func removingExclusionPhrases(_ text: String) -> (text: String, excluded: [Name], excludedAny: Bool) {
        var excluded: [Name] = [], result = text, excludedAny = false
        for (regex, excludes) in [(exclusion, true), (inclusion, false), (unavailableExclusion, false)] {
            guard let regex else { continue }
            let value = result as NSString
            var matches = regex.matches(in: result, range: NSRange(location: 0, length: value.length))
            // "안 되는 건 빼고" leaves out the routes that cannot run only when
            // it stands alone: "확인 안 된 거 빼고", "테스트 안 된 거 빼고" are
            // work items, never routes (the phrase is left in place and held).
            if regex === unavailableExclusion {
                matches = matches.filter { match in
                    let line = value.substring(to: match.range.location).components(separatedBy: "\n").last ?? ""
                    guard let word = line.split(whereSeparator: { $0.isWhitespace }).last.map(String.init) else { return true }
                    let bare = word.trimmingCharacters(in: CharacterSet(charactersIn: ",.!?~"))
                    if word != bare || bare.isEmpty || trimmable(bare.lowercased()) { return true }
                    let found = extract(bare)
                    return found.expressions.count == 1 && found.rest.trimmingCharacters(in: .whitespaces).isEmpty
                }
            }
            if excludes { for match in matches { excluded += names(in: value.substring(with: match.range)) } }
            if excludes || regex === unavailableExclusion { excludedAny = excludedAny || !matches.isEmpty }
            for match in matches.reversed() {
                if let range = Range(match.range, in: result) { result.replaceSubrange(range, with: " ") }
            }
        }
        return (result, excluded, excludedAny)
    }

    // MARK: Recognition
    //
    // An order is composed of parts, each optional unless said:
    //   [what can run: "할 수 있는 거 중에", "되는 모델", "라우팅 가능한 곳"]
    //   [every route: "다", "전부 다", "다한테", "모든 모델로", "every model한테"]   (required)
    //   [inline fillers: "좀", "한번", "동시에", "간단한 덧셈"; the arithmetic itself]
    //   [the imperative: "라우팅 시켜봐", "보내봐", "돌려", "물어봐", "써서 … 해봐"] (required
    //    but in a verbless `fragments` order)
    // An order carrying the routing word ("라우팅", "route", "팬아웃"), or sending
    // to a named kind of route with its particle ("모든 모델로 보내봐"), is an
    // order by itself. Any other (`weak`: "다 돌려봐", "되는 거 다 해봐", "hit
    // every route with") is one only when the arithmetic to send is written and
    // nothing but framing stands beside it: without it, "다 돌려봐" or "할 수
    // 있는 거 다 해봐" is ordinary work, never a route test.

    /// The routing word as the owner says or types it, English mixed in ("다
    /// route 해봐").
    static let routingWord = #"(?:라우팅|팬\s?아웃|(?<![A-Za-z])(?:routing|route|fan[\s\-]?out)(?![A-Za-z]))"#
    static let englishSurfaceNoun = #"(?<![A-Za-z])(?:routes?|backends?|models?|engines?)(?![A-Za-z])"#
    /// A kind of route: the receiver an order may send to without the routing word.
    static let surfaceNoun = #"(?:쪽|백엔드|모델|서피스|엔진|라우트|루트|"# + englishSurfaceNoun + #")(?:들)?"#
    static let target = #"(?:쪽|곳|데|경로|백엔드|모델|서피스|엔진|라우트|루트|"# + englishSurfaceNoun + #")(?:들)?"#
    /// Targets an order to SEND (no routing word) may name: never a path ("전체 경로").
    static let surfaceTarget = surfaceNoun
    static let toward = #"(?:으로|로|에다가|에다|에게|한테|께|에)?"#
    static let towardRequired = #"(?:으로|로|에다가|에다|에게|한테|께|에)"#
    static let allWord = #"(?:(?:싹|전부|모두|전체|몽땅)\s?다|죄다|다|전부|모두|전체|몽땅)"#
    static let all = #"(?<![가-힣])"# + allWord
    /// Right after what can run, the owner may run the words together: "할수있는거다라우팅시켜봐".
    static let allLoose = allWord
    /// "다한테", "전부에게": every route as the receiver.
    static let allTo = all + #"\s?(?:한테|에게|께|에다가|에다|에)도?"#
    static let allAny = all + #"(?:\s?(?:한테|에게|께|에다가|에다|에)도?)?"#
    /// "모든 모델", "전 라우트": every route of a kind.
    /// "전 모델" is the previous model as often as every model: only "전 라우트",
    /// "전 경로", "전 백엔드", "전 엔진", and never with "아까"/"다시" (`find`).
    static let every = #"(?<![가-힣])(?:(?:모든|전체|전부)\s*(?:의\s*)?|전\s*(?=(?:라우트|루트|경로|백엔드|엔진)))"#
    static let bareEvery = #"(?<![가-힣])전\s*(?:라우트|루트|경로|백엔드|엔진)"#
    /// What can run, said before the order: "할 수 있는 거", "갈 수 있는 데",
    /// "되는 모델", "연결된 데", "가능한 곳", "니가 가진 라우트", "다른 모델들".
    /// "다른" and a bare "있는 거" presuppose something earlier (`referential`).
    static let able = #"(?:(?:할|하는|될|되는|갈|가는|쓸|쓰는|보낼|돌릴|부를|불러올|붙을|(?:접근|연결|사용|이용|호출)\s?할)\s*수\s*있는|(?:접근|이용|사용|연결|호출)?\s*가능한|연결(?:돼|되어)\s*있는|(?:갖고|가지고)\s*있는|연결된|되는|있는|가진|아는|다른)"#
    static let what = #"(?:(?:모든\s*)?(?:거|것|건)|데|곳|쪽|만큼|대로|데로|경로|백엔드|모델|서피스|엔진|라우트|루트|애들|"# + englishSurfaceNoun + #")(?:들)?"#
    /// The receiver after what can run: a kind of route, or "애들" ("쓸 수 있는 애들한테").
    static let ableNoun = #"(?:"# + surfaceNoun + #"|애들)"#
    /// The part of what can run the order covers: "중에", "중에서", "까지", "만큼".
    static let range = #"(?:\s*(?:중에서|중에|중|까지|만큼|대로|데로|으로|로|에게|한테|께|에)(?:도|는|만)?)?"#
    /// The capability qualifier: "할 수 있는 거 중에", "라우팅 할 수 있는 데까지".
    static let qualifier = #"(?<![가-힣])(?:"# + routingWord + #"\s*)?"# + able + #"\s*"# + what + range
    static let qualifierAdjective = #"(?:(?<![가-힣])(?:"# + routingWord + #"\s*)?"# + able + #"\s*)?"#
    /// Words that may stand inside the order (as they may around it): adverbs
    /// and a description of the arithmetic. The arithmetic itself is masked.
    static let inlineWords = ["최대한", "한번만", "한번", #"한\s번"#, "좀", "쫌", "함", "동시에", "한꺼번에", "각각", "각자", "하나씩", "나눠서",
        "따로따로", "따로", "같이", "병렬로", "다시", "그냥", "바로", "지금", "진짜", "엄청", "간단한", "간단하게", "간단히", "쉬운",
        "덧셈", "뺄셈", "곱셈", "산수", "계산", "수학", "문제", "하나", "테스트로", "테스트", "정도로", "정도", "이런", "같은", "거로",
        "걸로", "몇인지", "뭔지", "얼마인지"]
    static let fill = #"(?:\s*(?:"# + inlineWords.joined(separator: "|") + #")(?![가-힣]))*\s*"#
    /// The imperative ending: "해", "해봐", "시켜봐", "보내줘", "시켜바", "해볼래".
    /// Never "해서", "해야", "했어", "하라고" (the next letter must not be Hangul).
    static let ending = #"\s?(?:봐줘|봐요|봐라|봐봐|봐바|봐줄래|봐주라|봐|바|보자|볼래요|볼래|보셈|줘봐|줘요|줘라|줘|줄래요|줄래|주라|주세요|라)?(?![가-힣A-Za-z])"#
    /// Words between the routing word and its verb: "라우팅 좀 해봐", "라우팅 한번 시켜봐".
    static let verbFill = #"(?:\s*(?:좀|쫌|한번만|한번|함|한\s번|다시|테스트)(?![가-힣]))*\s*"#
    /// The verb after the routing word: "해봐", "시켜", "태워봐", "걸어봐", "하자", "하셈",
    /// "가자", "ㄱㄱ", and the emphatic "시켜보라고", "하라니까" (`find`: an order
    /// only with the arithmetic written).
    static let routeVerbCore = #"(?:(?:해|시켜|돌려|태워|걸어)"# + ending +
        #"|(?:하|시키|돌리|태우|걸)(?:자고|자구|자|셈|라고|라니까|라구)(?![가-힣A-Za-z])"# +
        #"|(?:해|시켜|돌려|태워|걸어)\s?보(?:자고|자구|라고|라니까|라구)(?![가-힣A-Za-z])|가자(?![가-힣A-Za-z])|(?:ㄱ+|고고)(?![가-힣A-Za-z]))"#
    static let routeVerb = routingWord + #"\s*(?:을\s*)?"# + verbFill + routeVerbCore
    static let emphatic = #"(?:라고|라니까|라구)$"#
    static let sendVerb = #"(?:시켜|돌려|보내|던져|뿌려)"# + ending
    /// Sending without a routing word never "runs" ("전체 모델 돌려봐" runs a benchmark).
    static let sendOnlyVerb = #"(?:시켜|보내|던져|뿌려)"# + ending
    static let plainVerb = #"해"# + ending
    /// Verbs that send the arithmetic in a weak order: "돌려봐", "쏴봐", "넣어봐",
    /// "물어봐", "다 써봐".
    static let weakVerb = #"(?:계산\s?시켜|시켜|돌려|보내|던져|뿌려|쏴|쏘아|넣어|물어|써)"# + ending
    /// With no route word at all ("다 돌려봐 1+1") only sending verbs: "다 써봐"
    /// or "다 넣어봐" says nothing about routes.
    static let bareWeakVerb = #"(?:계산\s?시켜|시켜|돌려|보내|던져|뿌려|쏴|쏘아|물어)"# + ending
    /// A means, then the verb: "다 써서 1+1 해봐", "다 불러서 1+1 물어봐", "동원해서 1+1 해봐".
    static let meansVerb = #"(?:써서|불러서|동원해서|이용해서|사용해서|라우팅\s?해서)"# + fill + #"(?:계산\s*(?:해|시켜)|해|시켜|돌려|물어|풀어|보내|던져|뿌려)"# + ending

    // English.
    static let englishSurfaces = #"(?:routes?|backends?|surfaces?|models?|providers?|lanes?|engines?)"#
    /// "all backends", "every available model", "all the routes", "all your models".
    static let englishEvery = #"(?<![A-Za-z])(?:all|every|each)(?:\s+(?:of\s+)?(?:the|your|my))?(?:\s+(?:available|possible|routable|connected|reachable|working))?\s+"# +
        englishSurfaces + #"(?![A-Za-z])"#
    /// "… you can", "… you have", "… you've got", "… available".
    static let englishAfter = #"(?:\s+(?:available|possible|(?:that\s+)?(?:you|we)(?:\s+(?:can(?:\s+(?:reach|use|access|hit|route\s+to))?|have(?:\s+got)?|got)|['’]ve\s+got)))?(?![A-Za-z'’])"#
    /// Every route said without naming its kind: "all of them", "each one", "everything you can reach".
    static let englishAnything = "(?:" + englishEvery + englishAfter + #"|(?<![A-Za-z])(?:(?:all|each|every)\s+(?:one\s+)?of\s+(?:them|those)|each\s+one|every\s*one|everything(?:\s+(?:(?:that\s+)?you\s+can(?:\s+(?:reach|use|access|hit))?|possible|available))?)(?![A-Za-z]))"#
    /// A request put as a question: "can you route …", "could you send …".
    static let englishPolite = #"(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|please\s+)?"#
    static let englishSendVerb = #"(?:route|send|dispatch|fan\s*-?\s*out|broadcast|distribute|(?:try\s+)?(?:routing|sending|dispatching|broadcasting|distributing))"#
    static let englishObject = #"(?:\s+(?:it|this|that|them|these|those))?"#
    /// Words that may stand between the verb and its receiver: "a quick 2+2 test".
    static let englishFill = #"(?:\s*,|\s+(?:a|an|the|one|quick|quickly|simple|trivial|tiny|basic|dumb|easy|easiest|small|little|short|math|maths|arithmetic|sum|sums|problem|question|test|check|sanity|smoke|routing|possible|like|e\.g\.?|eg|and|or|real|just)(?![A-Za-z]))*"#
    static let englishTo = #"\s+(?:to|through|across|on|over)\s+"#

    /// The order patterns, `weak` as described above. An earlier start wins,
    /// then the longer match, then a strong pattern.
    static let orders: [(pattern: String, weak: Bool)] = [
        // "할 수 있는 거 중에 다 라우팅 시켜봐", "최대한 다 라우팅 해봐", "다 라우팅 ㄱㄱ"
        ("(?:" + qualifier + #"\s*(?:(?:최대한|가능한\s?한)\s*)?"# + allLoose + #"|(?:(?<![가-힣])(?:최대한|가능한\s?한)\s*)?"# + all + ")" +
            fill + routeVerb, false),
        // "라우팅 다 해봐", "너가 할 수 있는 데까지 라우팅 다 돌려봐", "라우팅 좀 다 해봐"
        ("(?:" + qualifier + #"\s*|(?<![가-힣]))"# + routingWord + #"\s*(?:을\s*)?"# + fill + all + fill +
            "(?:" + routeVerbCore + "|보내" + ending + ")", false),
        // "라우팅시켜봐 다", "라우팅 함 해봐 다"
        (#"(?<![가-힣])"# + routingWord + #"\s*(?:을\s*)?"# + verbFill + routeVerbCore + #"\s*"# + all + #"(?![가-힣])"#, false),
        // The owner's idiom: "라우팅 할 수 있는 쪽으로 최대한 다 라우팅 해봐", "라우팅 할 수
        // 있는데 다 시켜", "라우팅 되는 거 전부 다 해봐", "라우팅 할 수 있는 데 다 좀 해봐"
        (#"(?<![가-힣])"# + routingWord + #"\s*(?:"# + able + #"|하는)\s*"# + what + range + #"\s*(?:최대한\s*)?"# + allAny + fill +
            "(?:" + routeVerb + "|" + weakVerb + "|" + plainVerb + "|" + meansVerb + ")", false),
        // What can run, as a kind of route with its particle: "할 수 있는 쪽으로 다
        // 보내봐", "쓸 수 있는 모델 다한테 2+2 뿌려봐", "다른 모델들한테도 전부 보내봐"
        (#"(?<![가-힣])"# + able + #"\s*"# + ableNoun + #"\s*(?:"# + towardRequired + #"(?:도|는|만)?\s*(?:최대한\s*)?"# + allAny + "|" + allTo + ")" +
            fill + sendOnlyVerb, false),
        // A kind of route as the receiver, then every one of it: "모델들한테 다 1+1 보내봐",
        // "백엔드들한테 전부 보내봐" ("…한테도": `referential`).
        (#"(?<![가-힣])(?:백엔드|모델|서피스|엔진|라우트|루트|"# + englishSurfaceNoun + #")(?:들)?\s*"# + towardRequired + #"(?:도|는)?\s*"# + all +
            fill + sendOnlyVerb, false),
        // Weak: "모델별로 1+1 하나씩 돌려봐", "모델마다 2+2 보내봐".
        (#"(?<![가-힣])"# + surfaceNoun + #"\s*(?:별로|마다)"# + fill + "(?:" + weakVerb + "|" + meansVerb + "|" + plainVerb + ")", true),
        // "각 모델한테 하나씩 나눠서 보내봐": each route as the receiver.
        (#"(?<![가-힣])각\s*"# + surfaceNoun + #"\s*"# + towardRequired + fill + sendOnlyVerb, false),
        // Weak: "되는 모델 다 1+1 돌려봐", "갈 수 있는 데 다 보내봐", "쓸 수 있는 거 전부 써서 1+1 해보자",
        // "오에스원 연결된 데 다 1+1 해봐", "할 수 있는 데 다 물어봐"
        (#"(?<![가-힣])"# + able + #"\s*"# + what + range + #"\s*(?:최대한\s*)?"# + allAny + fill +
            "(?:" + weakVerb + "|" + meansVerb + "|" + plainVerb + ")", true),
        // "모든 경로로 라우팅해", "전부 쪽으로 라우팅해": a routing word, any target.
        (qualifierAdjective + every + target + #"\s*"# + toward + #"\s*(?:"# + all + #"\s*)?"# + fill + routeVerb, false),
        // "모든 모델로 보내봐", "every model한테 1+1 보내봐", "all routes로 보내봐".
        (qualifierAdjective + "(?:" + every + surfaceNoun + "|" + englishEvery + #")\s*"# + towardRequired + #"\s*(?:"# + all + #"\s*)?"# +
            fill + sendOnlyVerb, false),
        // "라우팅 가능한 모든 경로로 1+1 보내봐": the routing word in the qualifier.
        (#"(?<![가-힣])"# + routingWord + #"\s*"# + able + #"\s*"# + every + target + #"\s*"# + toward + #"\s*(?:"# + all + #"\s*)?"# + fill +
            "(?:" + routeVerb + "|" + weakVerb + "|" + plainVerb + ")", false),
        // Weak: "모든 모델 1+1 동시에 돌려봐", "전 경로로 1+1 보내봐", "모든 백엔드에 3+3 쏴봐", "every backend 1+1 해봐".
        (qualifierAdjective + "(?:" + every + target + "|" + englishEvery + #")\s*"# + toward + #"\s*(?:"# + all + #"\s*)?"# + fill +
            "(?:" + weakVerb + "|" + meansVerb + "|" + plainVerb + ")", true),
        // "최대한 라우팅 해봐", "최대한 많은 쪽으로 라우팅해"
        (#"(?<![가-힣])최대한\s*(?:많이\s*|많은\s*"# + target + #"\s*"# + toward + #"\s*)?"# + fill + routeVerb, false),
        // After an exclusion: "GPT 빼고 나머지 모델로 다 라우팅 해봐", "나머지 쪽으로 다 보내봐".
        (#"(?<![가-힣])(?:나머지|남은)\s*(?:"# + target + #"\s*"# + toward + #"\s*(?:다|전부|모두)?\s*"# + routeVerb + "|" +
            surfaceTarget + #"\s*"# + towardRequired + #"\s*(?:다|전부|모두)?\s*"# + sendOnlyVerb + ")", false),
        // "모델 다한테 1+1 동시에 보내봐": a kind of route, then every one of it.
        (#"(?<![가-힣])"# + surfaceNoun + #"\s*"# + allTo + fill + sendOnlyVerb, false),
        // Weak: "라우트 전부 써서 2+2 해봐", "모델 다 불러서 1+1 시켜봐"
        (#"(?<![가-힣])"# + surfaceNoun + #"\s*"# + allAny + fill + "(?:" + weakVerb + "|" + meansVerb + ")", true),
        // Weak: "원플러스원 다 돌려봐", "다 뿌려봐 1+1", "전부 다 보내봐 1+1", "다 불러서 1+1 물어봐"
        (allAny + fill + "(?:" + bareWeakVerb + "|" + meansVerb + ")", true),
        // Weak: "다 send 해봐 1+1", "전부 다 dispatch 해봐 1+1": an English verb said in Korean.
        (all + #"\s*(?:send|dispatch|broadcast)\s*(?:을\s*)?(?:해|시켜)"# + ending, true),
        // Weak: "다 라우팅 되나 테스트 1+1": a check of every route.
        (all + #"\s*"# + routingWord + #"\s*(?:잘\s*)?(?:되나|되는지)\s*(?:(?:한번|좀)\s*)?(?:테스트|확인|체크)(?:\s*(?:해|시켜)"# + ending + #")?(?![가-힣])"#, true),
        // Weak: "route all models 1+1", "route to every model 2+2".
        (#"(?<![A-Za-z])route\s+(?:to\s+)?"# + englishEvery + englishAfter, true),
        // "route all 해봐", "route-all 해봐"
        (#"(?<![A-Za-z])route[\s\-]*all\s*(?:을\s*)?(?:해|시켜|돌려)"# + ending, false),
        // English: "route to all backends", "send a quick 2+2 test to all backends",
        // "can you fan out 1+1 2+2 across all your models", "distribute 1+1 to every model available".
        (#"(?<![A-Za-z])"# + englishPolite + englishSendVerb + englishObject + englishFill + englishTo + englishEvery + englishAfter, false),
        // Weak: "fan out a simple math test to everything", "route 1+1 to all of them",
        // "run a quick routing test on every model with 1+1"
        (#"(?<![A-Za-z])"# + englishPolite + "(?:" + englishSendVerb + "|run|test)" + englishObject + englishFill + englishTo + englishAnything, true),
        // "route it to as many backends as possible"
        (#"(?<![A-Za-z])(?:route|send|dispatch)\s+(?:(?:it|this|that|them|these|those)\s+)?(?:to|through|across|on)\s+as\s+many\s+(?:routes|backends|surfaces|models|providers|lanes)\s+as\s+(?:possible|you\s+can)(?![A-Za-z])"#, false),
        // "route it everywhere", "quick smoke test route 2+2 everywhere"
        (#"(?<![A-Za-z])"# + englishPolite + "route" + englishObject + englishFill + #"\s+everywhere(?:\s+(?:possible|you\s+can))?(?![A-Za-z])"#, false),
        // Weak: "hit every route with 2+2", "ping all the models with 1+1", "send each one 1+1",
        // "give every route a trivial sum like 1+1", "test every route with basic arithmetic 2+2"
        (#"(?<![A-Za-z])"# + englishPolite + #"(?:hit|ping|test|give|send|query|ask)\s+"# + englishAnything, true),
    ]
    /// An order said without a verb (casual speech), weak and tried only when
    /// the sentence holds no order with a verb: "니가 할 수 있는 거 중에 전부
    /// 라우팅", "all routes에 1+1 2+2", "all models 2+2 go".
    static let fragments: [String] = [
        "(?:" + qualifier + #"\s*)?"# + all + #"\s*"# + routingWord + #"(?![가-힣A-Za-z])"#,
        "(?:" + every + surfaceNoun + "|" + englishEvery + #")(?:\s*"# + towardRequired + #")?(?![가-힣A-Za-z])"#,
    ]
    static let orderRegexes: [(regex: NSRegularExpression, weak: Bool)] = orders.compactMap { item in
        (try? NSRegularExpression(pattern: item.pattern, options: [.caseInsensitive])).map { ($0, item.weak) }
    }
    static let fragmentRegexes: [NSRegularExpression] = fragments.compactMap { try? NSRegularExpression(pattern: $0, options: [.caseInsensitive]) }
    /// An order that lists the routes: "로컬이랑 클로드 코드랑 코덱스 이렇게 세 개로
    /// 라우팅 해봐", "클로드랑 코덱스 다 라우팅 해봐", "로컬이랑 코덱스한테 보내봐",
    /// "send 1+1 to qwen codex claude code and claude, all of them". Group 1 is
    /// the list, group 2 (Korean only) the count the owner said.
    static let namedOrders: [String] = [
        nameBoundary + "(" + nameList + ")" +
            #"\s*(?:(?:이렇게|요렇게)\s*)?(?:((?:두|세|네|[2-4])\s?개|둘|셋|넷)\s*)?(?:(?:다|모두|전부|각각)\s*)?(?:(?:한테|에게|께|으로|로|에)\s*)?(?:(?:다|모두|전부|각각)\s*)?"# +
            fill + "(?:" + routeVerb + "|" + sendVerb + ")",
        #"(?<![A-Za-z])"# + englishPolite + englishSendVerb + englishObject + englishFill + #"\s+(?:to|through|across)\s+("# + nameList +
            #")(?:\s*,?\s*(?:all\s+of\s+them|each|both|all))?(?![A-Za-z])"#,
    ]
    static let namedOrderRegexes: [NSRegularExpression] = namedOrders.compactMap { try? NSRegularExpression(pattern: $0, options: [.caseInsensitive]) }
    /// The order put as a request question: "다 라우팅 해볼래?", "can you route …".
    /// It is an order only when the arithmetic to send is written.
    static let requestQuestionEnding = #"(?:볼래|줄래|봐줄래)(?:요)?$"#
    static let politeQuestion = #"^(?:can|could|would|will)\s+you\s"#
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
        /// A weak order: one only with the arithmetic written and nothing else beside it.
        let weak: Bool
        /// A request put as a question ("다 라우팅 해볼래?", "can you route …") or
        /// insisted on ("다 라우팅 시켜보라고"): one only with the arithmetic written.
        let asked: Bool
        /// Said without a verb ("다 라우팅 1+1"): framing must carry no reply or
        /// reference ("오케이", "좋아", "그만", "아까").
        let fragment: Bool
        /// The order asks ("다 물어봐"): with nothing written it asks nothing.
        let needsContent: Bool
    }

    static func canonical(_ prompt: String) -> String {
        prompt.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines)
            // "오에스 원": OS-1 said aloud ("원" is also a number word).
            .replacingOccurrences(of: #"(?<![가-힣])오에스\s+원(?=[아야]?(?![가-힣]))"#, with: "오에스원", options: .regularExpression)
            // "니가할수있는거…": the subject glued to the order (voice input).
            .replacingOccurrences(of: #"(?<![가-힣])(니가|네가|너가)(?=[가-힣])"#, with: "$1 ", options: .regularExpression)
    }

    /// The order sentence in `text` (exclusion phrases already blanked), or
    /// nil: no order, an order that is not one (question, quote, report,
    /// negation) or an order to route something other than OS-1's answers.
    static func find(_ text: String, afterExclusion: Bool = false) -> Found? {
        for (index, clause) in RouteFanout.clauses(text).enumerated() {
            let value = clause as NSString
            // The arithmetic may stand inside the order ("모든 모델로 원플러스원
            // 보내봐", "코덱스랑 로컬로 1+1 보내봐"): the order is matched with each
            // expression blanked, positions unchanged.
            let probe = masked(clause)
            let whole = NSRange(location: 0, length: value.length)
            var candidate: (range: NSRange, named: [Name], weak: Bool, fragment: Bool)?
            for named in namedOrderRegexes where candidate == nil {
                guard let match = named.firstMatch(in: probe, range: whole) else { continue }
                let listed = names(in: value.substring(with: match.range(at: 1)))
                // A list names at least two routes, or the local model alone.
                if listed.count >= 2 || listed.contains(where: { $0.kind == .surface(.local) }) {
                    // "세 개로": the owner's count matches the names listed.
                    let count = match.numberOfRanges < 3 || match.range(at: 2).location == NSNotFound
                        ? nil : routeCount(value.substring(with: match.range(at: 2)))
                    if count.map({ $0 == listed.count }) ?? true { candidate = (match.range, listed, false, false) }
                    else { return nil }
                }
            }
            // The order that starts first, the longest at one start, a strong one
            // before a weak one: "모든 백엔드로 다 라우팅 해" is one order, not "다
            // 라우팅 해" after a stray "모든 백엔드로". An order without a verb is
            // tried only when the sentence holds no order with one.
            func first(_ found: [(range: NSRange, weak: Bool)]) -> (range: NSRange, weak: Bool)? {
                found.min { a, b in
                    a.range.location != b.range.location ? a.range.location < b.range.location
                        : a.range.length != b.range.length ? a.range.length > b.range.length : !a.weak && b.weak
                }
            }
            if candidate == nil {
                if let found = first(orderRegexes.compactMap { item in item.regex.firstMatch(in: probe, range: whole).map { ($0.range, item.weak) } }) {
                    candidate = (found.range, [], found.weak, false)
                } else if let found = first(fragmentRegexes.compactMap { $0.firstMatch(in: probe, range: whole).map { ($0.range, true) } }) {
                    candidate = (found.range, [], true, true)
                }
            }
            guard let (order, listed, weak, fragment) = candidate else { continue }
            let head = value.substring(to: order.location), tail = value.substring(from: NSMaxRange(order))
            let span = value.substring(with: order), spanProbe = (probe as NSString).substring(with: order)
            // A quoted order is an example, not an order.
            if head.unicodeScalars.last.map(quotes.contains) == true || tail.unicodeScalars.first.map(quotes.contains) == true
            { continue }
            // The word right after the order: a report, a quote or a question.
            let after = tail.trimmingCharacters(in: .whitespaces)
            if tail.first?.isWhitespace == true || tail.isEmpty,
               let word = after.split(whereSeparator: { $0.isWhitespace }).first,
               String(word).range(of: continuation, options: [.regularExpression, .caseInsensitive]) != nil { continue }
            // "다 라우팅 해?": the order itself ends with a question mark. A request
            // put as a question ("다 라우팅 해볼래?", "can you route …") is an order
            // only with the arithmetic written (`order`).
            let polite = span.range(of: politeQuestion, options: [.regularExpression, .caseInsensitive]) != nil
            let questioned = after.trimmingCharacters(in: CharacterSet(charactersIn: "?？ ")).isEmpty &&
                RouteFanout.endsWithQuestionMark(clause, in: text)
            let requestEnding = span.trimmingCharacters(in: .whitespaces).range(of: requestQuestionEnding, options: .regularExpression) != nil
            if questioned, !requestEnding, !polite { continue }
            let insisted = spanProbe.trimmingCharacters(in: .whitespaces).range(of: emphatic, options: .regularExpression) != nil
            let asked = polite || (questioned && requestEnding) || insisted
            // The words right before the order, within its part of the clause,
            // the arithmetic blanked ("1+1을 다 라우팅 해봐": "1+1을" is what is sent).
            let maskedHead = (probe as NSString).substring(to: order.location)
            let segment = maskedHead.components(separatedBy: CharacterSet(charactersIn: ",，;:：")).last ?? maskedHead
            let before = segment.lowercased().split(whereSeparator: { $0.isWhitespace }).map(String.init)
            if before.suffix(2).contains(where: { $0.range(of: governingRejection, options: .regularExpression) != nil }) { continue }
            // "전 모델로 다시", "아까 전 경로로": the previous route, not every route.
            if spanProbe.range(of: bareEvery, options: .regularExpression) != nil,
               clause.range(of: #"다시|아까|방금|이전|바로\s*전"#, options: .regularExpression) != nil { continue }
            // "send 1+1 to everyone", "ask all of them": people, unless the
            // sentence is about routes ("route … to all of them").
            if listed.isEmpty, spanProbe.range(of: #"(?<![A-Za-z])(?:every\s*one|all\s+of\s+(?:them|those)|each\s+(?:one\s+)?of\s+(?:them|those)|each\s+one)(?![A-Za-z])"#,
                                               options: [.regularExpression, .caseInsensitive]) != nil,
               clause.range(of: routingWord + "|" + englishSurfaceNoun, options: [.regularExpression, .caseInsensitive]) == nil { continue }
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
            var referenced = spanReferential(spanProbe, afterExclusion: afterExclusion)
            for (position, word) in before.enumerated().reversed() {
                let bare = word.trimmingCharacters(in: CharacterSet(charactersIn: ",.!~"))
                if bare.isEmpty { continue }
                if demonstratives.contains(bare) { referenced = true; break }
                // "이 모델들한테 다 보내봐", "그 쪽으로 다 라우팅 해봐": the routes pointed at.
                if position == before.count - 1, ["이", "그", "저", "요"].contains(bare) { referenced = true; break }
                if referencedNouns.contains(stem(bare)), position > 0, pointers.contains(before[position - 1]) { referenced = true; break }
                if allowed(bare) { continue }
                if foreignObject(bare) { return nil }
                break
            }
            // "다 물어봐": a question to ask must be written.
            let needsContent = !weak && spanProbe.range(of: "물어" + ending + #"\s*$"#, options: .regularExpression) != nil
            return Found(index: index, clause: clause, order: order, named: listed, referenced: referenced, weak: weak, asked: asked,
                         fragment: fragment, needsContent: needsContent)
        }
        return nil
    }

    /// Words that point at content given earlier ("아까 거", "나머지", "다시",
    /// "다른 모델들한테도"): routing them would send what they point at, which no
    /// route has. With the arithmetic written they point at it; with none, the
    /// order is held (`Hold.referencedContent`), never sent with the defaults.
    static func referential(_ word: String, previous: String?, afterExclusion: Bool) -> Bool {
        let bare = word.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ",.!?~:;·…()[]\"'"))
        guard !bare.isEmpty else { return false }
        let stemmed = stem(bare)
        if demonstratives.contains(bare) || demonstratives.contains(stemmed) { return true }
        if ["아까", "방금", "저번", "지난번", "이전"].contains(where: { bare.hasPrefix($0) }) { return true }
        if !afterExclusion, bare.hasPrefix("나머지") || stemmed == "남은" { return true }
        if ["다른", "다시"].contains(stemmed) || bare == "다시" { return true }
        if let previous, pointers.contains(previous), referencedNouns.contains(stemmed) { return true }
        return false
    }
    /// What the order itself presupposes: "다른", "다시", "나머지" in it, a receiver
    /// with "도" ("다른 모델들한테도"), a bare "있는 거", a noun it sends as an
    /// object ("클로드한테 테스트 보내봐": which test?), or in English "send this"
    /// and "send the question".
    static func spanReferential(_ span: String, afterExclusion: Bool) -> Bool {
        let words = span.lowercased().split(whereSeparator: { $0.isWhitespace }).map(String.init)
        for (position, word) in words.enumerated() where referential(word, previous: position > 0 ? words[position - 1] : nil, afterExclusion: afterExclusion) {
            // "all of them", "each of those": the routes, not something given.
            if position > 0, words[position - 1] == "of" { continue }
            return true
        }
        if span.range(of: #"(?:한테|에게|께|에다가|에다|에|으로|로)도(?![가-힣])"#, options: .regularExpression) != nil { return true }
        if span.range(of: #"(?<![가-힣])(?<!수\s)(?<!고\s)있는\s*(?:거|것|건)(?![가-힣])"#, options: .regularExpression) != nil { return true }
        let value = span as NSString
        if let object = try? NSRegularExpression(pattern: #"(?<![가-힣])(?:문제|테스트|질문|계산|식)(?:을|를|도)?\s*(?:(?:좀|쫌|한번|함|다시)\s*)*(?:보내|시켜|돌려|던져|뿌려|물어|쏴|넣어)"#) {
            for match in object.matches(in: span, range: NSRange(location: 0, length: value.length)) {
                let previous = value.substring(to: match.range.location).split(whereSeparator: { $0.isWhitespace }).last.map(String.init) ?? ""
                if !describers.contains(previous) { return true }
            }
        }
        return span.range(of: englishReferenced, options: [.regularExpression, .caseInsensitive]) != nil
    }
    /// Words describing the arithmetic before a noun ("간단한 문제 보내봐"): it is
    /// the arithmetic, not something given earlier.
    static let describers: Set<String> = ["간단한", "쉬운", "엄청", "아주", "아무", "산수", "수학", "덧셈", "뺄셈", "곱셈", "계산", "이런",
        "같은", "작은", "단순한", "초간단", "개쉬운", "짧은", "기본적인", "라우팅", "간단하게"]
    /// "send this to …", "route it everywhere", "send the question to …".
    static let englishReferenced = #"(?<![A-Za-z])(?:route|send|dispatch|fan\s*-?\s*out|broadcast|distribute|routing|sending|dispatching|broadcasting|distributing)\s+(?:(?:it|this|that|them|these|those)(?![A-Za-z])|(?:the|that|this|these|those|my|our|your)\s+(?:[A-Za-z]+\s+){0,3}?(?:questions?|problems?|tests?|sums?|checks?|prompts?|tasks?|quer(?:y|ies)|ones?|things?|stuff|math)(?![A-Za-z]))"#

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
    static let trailingParticle = #"(?:\s*(?:이랑|하고|하구|이나)|(?:랑|과|와|나|은|는|이|가|을|를|도|요|으로|로|만))(?![가-힣])"#
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
        expressionMatches(text).map { ($0.range, $0.canonical) }
    }
    /// "3-4", "10-15" written without spaces: as likely a range of items or a
    /// date as a subtraction. Followed by "문제", "번", "개", "일" it is a range
    /// (`expressionMatches` skips it); alone it sends nothing in a weak order.
    static let rangeNoun = #"^\s*(?:문제|번째|번|개|일|월|행|줄|쪽|페이지|항|장|절|조|호)"#
    static func expressionMatches(_ text: String) -> [(range: NSRange, canonical: String, rangeLike: Bool)] {
        guard let regex = expressionAtPosition else { return [] }
        let value16 = text as NSString, length = value16.length
        func wordCharacter(_ unit: unichar) -> Bool {
            (unit >= 48 && unit <= 57) || (unit >= 65 && unit <= 90) || (unit >= 97 && unit <= 122) || (unit >= 0xAC00 && unit <= 0xD7A3)
        }
        var found: [(range: NSRange, canonical: String, rangeLike: Bool)] = []
        var position = 0, lastEnd = -1
        while position < length {
            let current = value16.character(at: position)
            let previous = position > 0 ? value16.character(at: position - 1) : 0
            // A digit right after a Hangul letter starts a number ("시켜봐1+1");
            // a number word inside a Hangul word does not ("원래").
            let atBoundary = position == 0 || position == lastEnd || !wordCharacter(previous) ||
                (current >= 48 && current <= 57 && previous >= 0xAC00 && previous <= 0xD7A3)
            if atBoundary, let match = regex.firstMatch(in: text, options: [.anchored], range: NSRange(location: position, length: length - position)),
               match.range.length > 0 {
                let left = value16.substring(with: match.range(at: 1)), right = value16.substring(with: match.range(at: 4))
                let symbolRange = match.range(at: 2).location != NSNotFound ? match.range(at: 2) : match.range(at: 3)
                let written = value16.substring(with: symbolRange).lowercased()
                let symbol = written == "x" ? "*" : operatorWords.first { $0.word == written }?.symbol
                if let a = value(left), let b = value(right), let symbol {
                    let core = value16.substring(with: NSRange(location: match.range(at: 1).location,
                                                               length: NSMaxRange(match.range(at: 4)) - match.range(at: 1).location))
                    let rangeLike = core.range(of: #"^[0-9]+-[0-9]+$"#, options: .regularExpression) != nil
                    if rangeLike, value16.substring(from: NSMaxRange(match.range(at: 4))).range(of: rangeNoun, options: .regularExpression) != nil {
                        position = NSMaxRange(match.range); lastEnd = -1
                        continue
                    }
                    found.append((match.range, "\(a)\(symbol)\(b)", rangeLike))
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
        // Addressing OS-1 and the owner's subjects.
        "너가", "너는", "니는", "넌", "os1", "os1아", "os-1", "os-1아", "오에스원", "오에스원아",
        // How the routes are covered, which `plan` decides anyway.
        "다", "전부", "모두", "나머지", "하나", "하나씩", "각각", "각자", "동시에", "한꺼번에", "병렬", "따로", "따로따로", "아까", "몇이냐고",
        "확인용", "확인차", "테스트용", "routing", "real", "smoke", "sanity", "check", "trivial", "tiny", "dumb", "easiest",
        "little", "available", "possible",
        // The owner's openers and asides, and ways of naming the arithmetic.
        "근데", "아니", "걍", "씨발", "존나", "루아", "루아야", "lua", "pls", "plz", "yo", "쫌", "함", "아니면", "이걸로", "이거로",
        "그걸로", "아무거나", "아무", "대충", "개쉬운", "초간단", "몽땅", "죄다",
    ]
    /// The owner's openers and address words.
    static let openerWords: Set<String> = [
        "너", "니", "네", "니가", "네가", "너가", "너는", "니는", "넌", "야", "자", "자자", "음", "아", "어", "그럼", "그러면", "그니까",
        "그러니까", "일단", "한번", "한번만", "한", "번", "좀", "쫌", "함", "지금", "바로", "이번엔", "이번에", "이번에는", "이번", "그냥", "걍",
        "오케이", "빨리", "얼른", "알았어", "알겠어", "좋아", "그래", "이제", "우선", "먼저", "제발", "부탁해", "그리고", "근데", "아니",
        "씨발", "존나", "엄청", "아주", "진짜", "완전", "되게", "매우", "정말", "뭐", "있잖아", "있잖아요", "말이야", "please", "pls", "plz",
        "now", "ok", "okay", "hey", "yo", "just", "quickly", "let's", "lets", "so", "then", "go", "ahead", "os1", "os1아", "os-1",
        "os-1아", "오에스원", "오에스원아", "루아", "루아야", "lua",
    ]
    static let chatLetters = #"^(?:ㅋ+|ㅎ+|ㄱ+|ㅇㅇ|ㅇㅋ|ㅠ+|ㅜ+)$"#
    /// Allowed words that name something: what is sent or which routes ("거",
    /// "테스트", "문제", "다", "하나") or a pointer ("아까", "그", "이거").
    static let objectWords: Set<String> = ["거", "것", "걸", "건", "그거", "이거", "저거", "이걸로", "이거로", "그걸로", "아까", "방금",
        "나머지", "다", "전부", "모두", "몽땅", "죄다", "하나", "하나씩", "테스트", "테스트용", "test", "문제", "계산", "수학", "산수", "덧셈",
        "뺄셈", "곱셈", "연산", "알제브라", "알지브라", "대수", "식", "예시", "그", "이", "저", "또", "또는", "아무거나", "아무",
        "몇이냐고", "확인용", "확인차"]
    /// Allowed words that carry nothing (openers, address, adverbs, a
    /// description): they may be cut from the edges of a piece to find the
    /// remark or frame sentence it is. Object and pointing words never are:
    /// "그리고 아까 거 다시 돌려" is a second instruction, not the frame "돌려".
    static func trimmable(_ word: String) -> Bool {
        guard allowed(word) else { return false }
        let stemmed = stem(word)
        return !objectWords.contains(word) && !objectWords.contains(stemmed) &&
            (word == "다시" || !referential(word, previous: nil, afterExclusion: false))
    }
    /// A verbless order beside these is a reply, a report or a stop, not an
    /// order: "다 라우팅 1+1 오케이", "모든 모델 1+1 뭐야", "다 라우팅 그만 1+1".
    static let fragmentReplies: Set<String> = ["오케이", "좋아", "알았어", "알겠어", "ok", "okay", "그래", "뭐야", "뭐지", "몇이야",
        "그만", "됐어", "됐다", "맞아", "맞지", "어때", "봤어", "했어", "나왔어", "왔어", "완료", "끝", "done"]
    static let particleSuffix = #"(?:으로요|으로|이랑|처럼|이나|은|는|이|가|을|를|도|만|로|에|요|야|랑|나)$"#
    static func stem(_ word: String) -> String {
        word.replacingOccurrences(of: particleSuffix, with: "", options: .regularExpression)
    }
    static func allowed(_ word: String) -> Bool {
        if allowedWords.contains(word) || particleWords.contains(word) || openerWords.contains(word) ||
            word.range(of: chatLetters, options: .regularExpression) != nil { return true }
        let stem = stem(word)
        // "그만" is no "그" with a particle, "이나" no "이".
        return stem != word && !stem.isEmpty && !["그", "이", "저"].contains(stem) && allowedWords.contains(stem)
    }
    /// Nothing but allowed words, once the expressions are taken out.
    static func onlyAllowed(_ text: String) -> Bool {
        text.lowercased().split(whereSeparator: { $0.isWhitespace || ",.?!~:;·…()[]=＝".contains($0) })
            .allSatisfy { allowed(String($0)) }
    }
    /// A remark on the previous routing beside the order, which carries no
    /// instruction: "아까는 하나로만 갔잖아", "방금 아스트라로 갔어".
    static let previousRouting = #"^(?:아까(?:는|도)?|방금(?:은|도)?|좀\s?전에(?:는)?|이전엔|전엔|저번엔|지난번엔)\s+(?:\S+\s+){0,4}?\S*(?:갔|됐|넘어갔|돌았|나왔|보냈|넘겼)(?:잖아요?|어요?|었어|네|더라|다)$"#
    /// One piece of the request beside the order: allowed words around the
    /// arithmetic, or a whole frame sentence (`RouteFanout`'s side sentences,
    /// a previous-routing remark) once the arithmetic is taken out.
    static func framing(_ piece: String, in text: String, leading: Bool, afterExclusion: Bool = false)
        -> (ok: Bool, expressions: [String], referenced: Bool, words: [String]) {
        let extracted = extract(piece)
        // "1+1 아니 2+2": the owner corrected the arithmetic; which one is meant
        // is not for the host to pick.
        if let correction = piece.range(of: #"(?<![가-힣])아니(?![가-힣])"#, options: .regularExpression),
           let first = expressionRanges(piece).first, let start = Range(first.range, in: piece), start.upperBound <= correction.lowerBound {
            return (false, [], false, [])
        }
        // What the accepted words say: a pointing word marks the order as
        // referencing ("다 라우팅 시켜봐 아까 거"); one after "그리고" adds an item
        // ("1+1 그리고 아까 거"), which no route can be given.
        func verdict(_ words: [String]) -> (ok: Bool, expressions: [String], referenced: Bool, words: [String]) {
            var coordinated = false, referenced = false
            for (position, word) in words.enumerated() {
                if ["그리고", "또", "또한", "and", "plus", "그다음에", "다음에"].contains(word) { coordinated = true; continue }
                if referential(word, previous: position > 0 ? words[position - 1] : nil, afterExclusion: afterExclusion) {
                    if coordinated { return (false, [], false, []) }
                    referenced = true
                }
            }
            return (true, extracted.expressions, referenced, words)
        }
        let all = extracted.rest.lowercased().split(whereSeparator: { $0.isWhitespace || ",.?!~:;·…()[]=＝".contains($0) }).map(String.init)
        if all.allSatisfy(allowed) { return verdict(all) }
        let rest = extracted.rest.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: " ,.!?~"))
        // Openers at the edges ("…갔잖아 이번엔", "야 테스트 한번 하자") are not the
        // sentence: every inner run of words whose cut edge words carry nothing.
        let words = rest.split(separator: " ").map(String.init)
        var sentences: [(sentence: String, edges: [String])] = [(rest, [])]
        var start = 0
        while start <= words.count {
            var end = words.count
            while end >= start {
                sentences.append((words[start..<end].joined(separator: " "), Array(words[..<start]) + Array(words[end...])))
                guard end > start, trimmable(words[end - 1].lowercased()) else { break }
                end -= 1
            }
            guard start < words.count, trimmable(words[start].lowercased()) else { break }
            start += 1
        }
        for (sentence, edges) in sentences where sentence.isEmpty || remark(sentence, leading: leading) ||
            RouteFanout.sideSentence(sentence, in: text, leading: leading) ||
            sentence.range(of: previousRouting, options: .regularExpression) != nil {
            return verdict(edges.map { $0.lowercased() })
        }
        return (false, [], false, [])
    }

    /// A remark on the route test beside the order, which carries no
    /// instruction: "라우팅 테스트 해보자", "라우팅 잘 되나", "라우팅 되는지 보게",
    /// "너 라우팅 할 수 있잖아", "let's see if every route works", "to check
    /// they all answer". Before the order, also what can run said on its own
    /// ("야 니가 할 수 있는 거 중에\n다 라우팅 시켜봐").
    static let routingRemarks: [NSRegularExpression] = [
        #"^(?:(?:라우팅|routing)\s*)?(?:테스트|확인|체크|test|check)(?:용|차)?(?:\s*(?:한번|한\s번|좀))?(?:\s*(?:해보자|하자|해볼게|할게|해보는\s*거야|하는\s*거야|야|이야|이에요|입니다))?$"#,
        #"^(?:(?:다|전부)\s*)?(?:라우팅|routing)\s*(?:이|가)?\s*(?:(?:다|잘|전부|제대로)\s*)*(?:되나|되는지|돼|되나\s*안\s*되나)(?:\s*(?:보게|보자|볼게|봐|보려고|확인|테스트|확인용|테스트용))?$"#,
        #"^(?:(?:너|니|네가|니가|너가)\s*)?(?:라우팅\s*)?(?:할|될|돼|되)\s*수\s*있잖아(?:요)?$"#,
        #"^(?:let'?s\s+)?(?:see|check|test)\s+(?:if|whether)\s+(?:all|every|each)\s+(?:of\s+(?:the|them)\s+|the\s+)?(?:routes?|models?|backends?|engines?|ones?)?\s*(?:works?|answers?|responds?|replies?)$"#,
        #"^(?:to\s+)?(?:check|see|make\s+sure|verify|confirm)\s+(?:that\s+|if\s+|whether\s+)?(?:they|all|each|every\s*(?:one|route|model|backend))(?:\s+of\s+them)?(?:\s+all)?\s+(?:works?|answers?|responds?|replies?)$"#,
        // Watching the answers: "뭐라고 하는지 보자", "다 맞추나 보자", "이번엔 되나 보자".
        #"^(?:(?:다|각각|전부|다들|뭐라고|뭐라|어떻게|잘|제대로)\s*)*(?:하는지|맞추나|맞추는지|맞히나|맞히는지|답하나|답하는지|대답하나|대답하는지|되나|되는지|나오나|나오는지|오나|오는지)\s*(?:한번\s*)?(?:보자|볼게|봐)$"#,
        // Returning the answers: "답만 받아와", "결과만 알려줘".
        #"^(?:답변?|결과|응답|대답)(?:만|은|는|도|을|를|이|가)?\s*(?:(?:좀|다|빨리|각각|따로)\s*)*(?:받아와(?:줘|요)?|받아줘|가져와(?:줘|요)?|알려줘(?:요)?|보여줘(?:요)?|말해(?:줘)?)$"#,
        // Asking the value: "몇이야", "답 얼마야".
        #"^(?:(?:답|결과)(?:이|은|는)?\s*)?(?:몇|얼마)(?:이야|이냐|임|일까|이지|야|냐|지)?$"#,
        // Enough: "그거면 돼", "이 정도면 충분해".
        #"^(?:그거|이거|그걸로|이걸로|그거로|이거로|그\s*정도|이\s*정도|그정도|이정도)(?:면|로|만)?\s*(?:돼|됨|된다|충분해|충분)$"#,
        #"^(?:(?:이런|그런|요런)\s*(?:거|것|걸)\s*)?알지(?:요)?$"#,
        // Not one model alone: "너 혼자 하지 말고", "하나로만 보내지 말고".
        #"^(?:(?:너|니가|네가|너가|니|넌)\s*)?(?:혼자(?:서)?|하나로만|하나만|한\s*(?:모델|군데|곳|데|쪽)(?:으로|로)?만?)\s*(?:하지|보내지|가지|돌리지|시키지|풀지)\s*말고$"#,
    ].compactMap { try? NSRegularExpression(pattern: $0, options: [.caseInsensitive]) }
    static let leadingQualifier = try? NSRegularExpression(pattern: "^" + qualifier + "$", options: [.caseInsensitive])
    static func remark(_ sentence: String, leading: Bool) -> Bool {
        let range = NSRange(location: 0, length: (sentence as NSString).length)
        if routingRemarks.contains(where: { $0.firstMatch(in: sentence, range: range) != nil }) { return true }
        return leading && leadingQualifier?.firstMatch(in: sentence, range: range) != nil
    }

    /// The recognised order in `prompt`, or nil when it is none.
    public static func order(_ prompt: String) -> Order? {
        let text = canonical(prompt)
        guard !text.isEmpty, text.count <= RouteFanout.maximumCharacters, !text.contains("```") else { return nil }
        let removed = removingExclusionPhrases(text)
        let excludedNames = removed.excluded
        // The owner's count of the routes ("4개 다", "넷 다", "이렇게 네 개") is
        // checked against the routes covered, then blanked.
        let (stripped, counts) = removingCounts(removed.text)
        guard let found = find(stripped, afterExclusion: removed.excludedAny) else { return nil }
        let written = expressionMatches(stripped)
        // A weak order or a request question is one only with the arithmetic
        // written, and a weak one never with only "3-4" or "10-15" (a range or a date).
        if found.weak || found.asked, written.isEmpty { return nil }
        if found.weak, written.allSatisfy(\.rangeLike) { return nil }
        let clauses = RouteFanout.clauses(stripped)
        let orderClause = clauses.indices.contains(found.index) ? clauses[found.index] : ""
        // "1+1 테스트 다 돌려봐", "1+1 2+2 문제 전부 다시 돌려봐": rerunning tests or
        // problems, unless the sentence says routing.
        if found.weak, (orderClause as NSString).substring(with: found.order).contains("돌려"),
           orderClause.range(of: routingWord, options: [.regularExpression, .caseInsensitive]) == nil,
           orderClause.range(of: #"(?<![가-힣])(?:테스트|문제|다시)(?:를|을|도|는|은|들)?(?![가-힣])"#, options: .regularExpression) != nil {
            return nil
        }
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
            // "클로드 빼고": both Claude surfaces are left out; "클로드 챗 빼고": only chat.
            if surface == .claudeChat, name.text.range(of: claudeChatName, options: [.regularExpression, .caseInsensitive]) == nil {
                covered.remove(.claude)
            }
        }
        var expressions: [String] = [], held = false, referenced = found.referenced, framingWords: [String] = []
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
                let result = framing(piece, in: stripped, leading: leading, afterExclusion: removed.excludedAny)
                if result.ok {
                    expressions += result.expressions
                    referenced = referenced || result.referenced
                    framingWords += result.words
                } else { held = true }
            }
        }
        // A route named outside the order ("1+1 Codex한테. 다 라우팅 해봐"): held.
        let outside = names(in: remainder(orderClause, removing: found.order)).count +
            clauses.enumerated().filter { $0.offset != found.index }.reduce(0) { $0 + names(in: $1.element).count }
        if outside > 0 || expressions.count > RouteFanout.maximumTargets { held = true }
        // "세 개 다 라우팅 해봐": a count that is not the routes covered.
        if counts.contains(where: { $0 != covered.count }) { held = true }
        // A weak order with anything but framing beside it is no order: the
        // request is ordinary work ("할 수 있는 거 다 해봐 1+1이 왜 2인지 증명해").
        if found.weak && held { return nil }
        // A verbless order beside a reply or a pointing word is no order.
        if found.fragment, framingWords.contains(where: { fragmentReplies.contains($0) || fragmentReplies.contains(stem($0)) }) || referenced {
            return nil
        }
        var seen = Set<String>()
        expressions = expressions.filter { seen.insert($0).inserted }
        // "다 물어봐": nothing to ask is no order, unless it points at something.
        if found.needsContent, expressions.isEmpty, !held, !referenced { return nil }
        let hold: Hold? = held ? .notArithmetic : referenced && expressions.isEmpty ? .referencedContent : nil
        return Order(surfaces: surfaceOrder.filter(covered.contains), named: !found.named.isEmpty, gptNames: gptNames,
                     excluded: excluded, expressions: hold == nil ? expressions : [], hold: hold)
    }

    /// The owner's count of the routes, right before "다"/"전부" or at the end:
    /// "4개 다", "네 군데 다", "넷 다", "이렇게 네 개".
    static let countPhrase = try? NSRegularExpression(pattern:
        #"(?<![가-힣0-9A-Za-z+\-*])(?:(?:이렇게|요렇게)\s*)?(?:([2-8])\s?(?:개|곳|군데)|(두|세|네)\s?(?:개|곳|군데)|(둘|셋|넷))(?![가-힣0-9])(?=\s*(?:다(?!른)|전부|모두|$|[.,!?。\n]))"#)
    static func removingCounts(_ text: String) -> (text: String, counts: [Int]) {
        guard let regex = countPhrase else { return (text, []) }
        let value = NSMutableString(string: text)
        let expressions = expressionRanges(text).map(\.range)
        var counts: [Int] = []
        for match in regex.matches(in: text, range: NSRange(location: 0, length: value.length)).reversed()
        where !expressions.contains(where: { NSIntersectionRange($0, match.range).length > 0 }) {
            // "문제 4개 다", "테스트 두 개 다": a count of things, not of routes.
            let line = (text as NSString).substring(to: match.range.location).components(separatedBy: CharacterSet(charactersIn: "\n.,!?")).last ?? ""
            if let word = line.split(whereSeparator: { $0.isWhitespace }).last.map(String.init),
               !trimmable(word.lowercased()), !expressions.contains(where: { NSMaxRange($0) <= match.range.location &&
                   (text as NSString).substring(with: NSRange(location: NSMaxRange($0), length: match.range.location - NSMaxRange($0)))
                       .trimmingCharacters(in: .whitespaces).isEmpty }) { continue }
            let word = (1...3).compactMap { group -> String? in
                match.range(at: group).location == NSNotFound ? nil : (text as NSString).substring(with: match.range(at: group))
            }.first ?? ""
            counts.append(Int(word) ?? ["두": 2, "둘": 2, "세": 3, "셋": 3, "네": 4, "넷": 4][word] ?? 0)
            value.replaceCharacters(in: match.range, with: String(repeating: " ", count: match.range.length))
        }
        return (value as String, counts)
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
        let handed = text.replacingOccurrences(of: #"(?<=(?:보내|시키|넘기|맡기|던지|물어보|돌리)고)\s+|\s+그리고\s+"#,
                                               with: ", ", options: .regularExpression)
        // "1+1 로컬한테 2+2 코덱스한테" (voice input, no punctuation): a part
        // ends after "<expression> <name>한테" where the next expression starts.
        let joined = splittingUnpunctuatedParts(handed)
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
    static func splittingUnpunctuatedParts(_ text: String) -> String {
        let value = NSMutableString(string: text)
        let expressions = expressionRanges(text).map(\.range)
        for name in names(in: text).reversed() {
            let after = (text as NSString).substring(from: NSMaxRange(name.range)) as NSString
            let particle = after.range(of: "^" + dative + #"(?=\s)"#, options: .regularExpression)
            guard particle.location != NSNotFound else { continue }
            let end = NSMaxRange(name.range) + NSMaxRange(particle)
            let partStart = ((text as NSString).substring(to: name.range.location) as NSString)
                .rangeOfCharacter(from: CharacterSet(charactersIn: ",，;.。!?\n"), options: .backwards)
            let from = partStart.location == NSNotFound ? 0 : NSMaxRange(partStart)
            // An expression in this part before the name, and one starting right after it.
            guard expressions.contains(where: { $0.location >= from && NSMaxRange($0) <= name.range.location }),
                  let next = expressions.first(where: { $0.location >= end }),
                  (text as NSString).substring(with: NSRange(location: end, length: next.location - end))
                    .trimmingCharacters(in: .whitespaces).isEmpty else { continue }
            value.insert(",", at: end)
        }
        return value as String
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
        // Build 384 (2026-10-15): the owner's wording around what can run was
        // held. The order is composed: what can run, every route, fillers and
        // the arithmetic, the imperative; a weak order (no routing word) only
        // with the arithmetic written and nothing else beside it.
        let incident384 = "야 네가 할 수 있는 거 중에 다 라우팅 시켜봐. 엄청 간단한 문제 뭐 1+1, 2+2 이런 거."
        check(order(incident384)?.hold == nil && routes(incident384) == ["local:1+1", "codex:2+2", "claude:1+1", "claude-chat:2+2"],
              "the build 384 incident reaches every route with the owner's expressions")
        for prompt in ["야 네가 할 수 있는 거 중에 다 라우팅 시켜봐 엄청 간단한 문제 뭐 1+1 2+2 이런 거",
                       "니가 할 수 있는 거 중에서 전부 라우팅 시켜봐 2+2 같은 거", "너가 할 수 있는 거 중에 다 라우팅 시켜볼래? 1+1",
                       "야 너 라우팅 할 수 있는 데까지 다 라우팅 해봐 1+1", "너가 할 수 있는 데까지 라우팅 다 돌려봐 엄청 간단한 걸로 뭐 1+1",
                       "되는 모델 다 1+1 돌려봐", "니가 가능한 모델 전부한테 원플러스원 물어봐", "1+1이랑 2+2 니가 갈 수 있는 데 다 보내봐",
                       "너 지금 연결돼 있는 거 다 1+1 돌려봐", "쓸 수 있는 모델 다 써서 1+1 해봐", "OS1아 할 수 있는 거 다 라우팅 시켜봐 1+1",
                       "니가 할수있는거중에 다 라우팅시켜봐 1+1", "라우팅시켜봐 다 1+1 2+2", "할 수 있는 거 중에 다 라우팅 시켜바 1+1",
                       "네가 라우팅 가능한 모든 경로로 1+1 보내봐", "야 니가 할 수 있는 거 중에\n다 라우팅 시켜봐\n뭐 1+1 같은 거",
                       "다 라우팅해봐 1+1=?", "이번엔 2+2로 다 라우팅 해봐", "야 테스트 한번 하자 다 라우팅 시켜봐 1+1",
                       "라우팅 잘 되나 1+1 다 보내봐", "야 너 라우팅 할 수 있잖아 다 라우팅 해봐 1+1", "다 라우팅 ㄱㄱ 1+1",
                       "다 route 시켜봐 1+1", "원플러스원 다 돌려봐", "야 진짜 간단한 거 1+1 니가 할 수 있는 거 중에 전부 라우팅",
                       "all routes에 간단한 계산 하나씩 1+1 2+2 3+3 4+4", "every model한테 1+1 보내봐",
                       "send a quick 2+2 test to all backends", "can you route 1+1 to all the routes you have just as a sanity check",
                       "let's see if every route works, send each one 1+1", "send 1+1 to qwen codex claude code and claude, all of them",
                       "로컬 큐웬 코덱스 클코 클로드 전부 2+2 돌려봐", "각 모델한테 1+1 2+2 하나씩 나눠서 보내봐 전부 다",
                       "되는 거 다 해봐 1+1 안 되는 건 빼고"] {
            check(order(prompt)?.hold == nil && plan(prompt, available: all)?.routes.count == 4, "route-all (build 384 wording): " + prompt)
        }
        check(routes("클로드 챗 빼고 되는 거 다 돌려봐 1+1") == ["local:1+1", "codex:1+1", "claude:1+1"],
              "excluding Claude chat by name leaves Claude Code in")
        check(routes("클로드 코드만 빼고 나머지 다 1+1 보내봐") == ["local:1+1", "codex:1+1", "claude-chat:1+1"], "an exclusion with 만")
        // Not orders: work, questions, reports, a weak order with no arithmetic
        // or with anything else beside it, a request question with nothing to send.
        for prompt in ["할 수 있는 거 중에 제일 싼 모델로 이 버그 고쳐", "네가 할 수 있는 거 중에 다 라우팅 시켜서 이 레포 테스트 전부 돌려",
                       "쿼터 남은 거 중에 다 라우팅 해서 이 리팩터링 나눠서 시켜봐", "할 수 있는 모델 다 써서 이 함수 최적화해봐",
                       "할 수 있는 모델 다한테 이 코드 리뷰 시켜봐", "니가 다 라우팅 할 수 있는 거 맞아?",
                       "다 라우팅 시켜봐 하면 어디어디로 가는 거야", "할 수 있는 거 중에 다 라우팅 시키면 로컬도 포함돼?",
                       "\"할 수 있는 거 중에 다 라우팅 시켜봐\" 이 문장 왜 안 먹혀", "어제 할 수 있는 거 중에 다 라우팅 시켜봐 라고 쳤더니 안 됐어",
                       "1+1 다 라우팅 하면 답 네 개 다 나와?", "1+1 2+2 다 라우팅 시키고 그 다음에 빌드 돌려",
                       "모든 모델한테 이 프롬프트 던져서 누가 제일 잘하나 봐봐", "1+1 코덱스한테만 보내봐",
                       "route all the eval prompts to every model and write the scores to a csv",
                       "don't route anything to all models, just answer 1+1 yourself",
                       "route 1+1 to every model and then open a PR with the results",
                       "되는 거 다 해봐", "할 수 있는 거 다 해봐 이 버그 고쳐", "할 수 있는 거 다 해봐 1+1이 안 나와", "다른 모델한테 1+1 보내봐",
                       "다 써봐 1+1", "니가 할 수 있는 거 중에 다 라우팅 시켜볼래?", "can you route to all backends?"] {
            check(!recognizes(prompt), "not route-all (build 384 wording): " + prompt)
        }
        for prompt in ["할 수 있는 거 중에 다 라우팅 해봐 1+1 그리고 이 PR 머지해", "할 수 있는 거 중에 다 라우팅 시켜봐 이 에러 메시지 원인 뭐야",
                       "할 수 있는 거 중에 다 라우팅 시켜봐 이 문장도 인식되게 정규식 추가해", "다 라우팅 시켜봐 원플러스원이 왜 2인지 증명해",
                       "다 라우팅 시켜봐 2+2 결과 나오면 슬랙으로 보내줘"] {
            check(order(prompt)?.hold == .notArithmetic && plan(prompt, available: all) == nil, "held (build 384 wording): " + prompt)
        }
        // Build 384 review (2026-10-15). Over-capture first: a work order after
        // the order, content pointed at after it or presupposed by it, an
        // English "this"/"the question", the previous model ("전 모델"), a
        // verbless order beside a reply, an exclusion of work items and an item
        // range are never sent as a route test.
        for prompt in ["1+1 다 라우팅 시켜봐 그리고 테스트 전부 다시 돌려", "다 라우팅 해봐 1+1 그리고 아까 거 다시 돌려",
                       "1+1 다 라우팅 해봐 그리고 나머지 테스트도 다 돌려", "다 라우팅 시켜봐 1+1 그리고 아까 거 다 보여줘",
                       "1+1 다 라우팅 해봐 그리고 나머지 알려줘", "다 라우팅 시켜봐 2+2 그리고 아까 거 가져와",
                       "다 라우팅 해봐 1+1 그리고 나머지는 니가 해", "다 라우팅 해봐 1+1. 그리고 테스트 전부 다시 돌려.",
                       "다 라우팅 해봐 1+1. 나머지는 니가 해.", "다 라우팅 해봐 1+1. 아까 거도 다 보내.", "다 라우팅 해봐 1+1 그리고 아까 거 보자",
                       "1+1 다 라우팅 시켜봐 그리고 테스트 다시 돌려", "다 라우팅 시켜봐 1+1 그리고 아까 거", "다 라우팅 해봐 1+1 아니 2+2",
                       "확인 안 된 거 빼고 다 라우팅 해봐", "테스트 안 된 거 빼고 다 라우팅 시켜봐", "체크 안 된 거 빼고 전부 다 라우팅 해",
                       "1-2 문제 다 라우팅 해봐", "다 라우팅 해봐 1+1 그만", "두 개 다 라우팅 해봐 1+1", "문제 4개 다 라우팅 해봐"] {
            check(order(prompt)?.hold == .notArithmetic && plan(prompt, available: all) == nil, "held, never sent (build 384 review): " + prompt)
        }
        for prompt in ["다 라우팅 시켜봐 아까 거", "다 라우팅 시켜봐 아까 그 문제", "모든 모델로 보내봐 아까 거", "라우팅 되는 데 다 물어봐 그거",
                       "라우팅 되는 거 다 써서 해봐 아까 거", "route all 해봐 그 문제", "route-all 해봐 아까 거", "every model한테 보내봐 그거",
                       "all routes로 보내봐 아까 거", "클로드 챗 빼고 다 라우팅 해봐 그 문제", "각 모델한테 하나씩 보내봐 그거",
                       "모델 다한테 동시에 보내봐 아까 거", "다 route 해봐 그거", "할 수 있는 거 중에 다 라우팅 시켜봐 이거",
                       "모든 경로로 라우팅 해 아까 거", "다 라우팅 시켜봐 그 문제", "다 라우팅 시켜봐 이거",
                       "please send this to all models", "please route it to every model", "please route it everywhere",
                       "broadcast this to every model", "distribute these to all models", "try sending this to all backends",
                       "please send them to every model", "please send this to codex and qwen", "broadcast it to codex, claude and qwen",
                       "send the question to all models", "send the problem to every model", "route the test to all backends",
                       "dispatch the question across all models", "send the real question to every model available",
                       "send the question to codex and claude", "route the question everywhere", "send the sum to every model",
                       "fan out the question to all your models", "send the easy test to every model", "send the smoke test to all models",
                       "send the sanity check to every model",
                       "다른 모델들한테도 전부 보내봐", "다른 모델한테도 다 라우팅 시켜봐", "코덱스랑 클로드한테 테스트 보내봐",
                       "로컬이랑 코덱스한테 문제 보내봐", "코덱스랑 클로드한테 다시 보내봐", "모든 모델로 다시 보내봐", "다 다시 라우팅 해봐",
                       "전부 다시 라우팅 시켜", "있는 거 다 라우팅 해봐", "지금 있는 거 다 라우팅 해봐", "나머지 거 다 라우팅 해봐",
                       "나머지도 다 라우팅 해봐", "나머지 문제도 다 라우팅 시켜봐", "아까처럼 다 라우팅 해봐", "아까 계산 다 라우팅 해봐",
                       "아까 테스트 다 라우팅 해봐", "아까 수학 문제 다 라우팅 해봐", "나머지 계산도 다 라우팅 해봐", "이 모델들한테 다 보내봐"] {
            check(order(prompt)?.hold == .referencedContent && plan(prompt, available: all) == nil,
                  "points at earlier content, nothing written: held (build 384 review): " + prompt)
        }
        for prompt in ["라우팅 할 수 있는 데 다 물어봐", "1+1 전 모델로 다시 보내봐", "아까 전 모델로 보내봐", "전 모델한테 다시 물어봐 1+1",
                       "1+1 전 엔진으로 다시 돌려봐", "모든 모델 1+1 뭐야", "every model 2+2 ok", "모든 모델 1+1 오케이", "모든 모델 1+1 좋아",
                       "다 라우팅 1+1 오케이", "전부 라우팅 2+2 알았어", "다 라우팅 1+1 좋아", "다 라우팅 아까 1+1", "다 라우팅 그만 1+1",
                       "모든 모델 그만 1+1", "3-4 문제 다 보내봐", "10-15 다 돌려봐", "1+1 테스트 다 돌려봐", "다 돌려봐 1+1 테스트 전부",
                       "1+1 2+2 문제 전부 다시 돌려봐", "send 1+1 to all of them", "send 1+1 to everyone", "ask everyone 1+1",
                       "다 라우팅 하라고", "다 라우팅 하자고 했잖아"] {
            check(!recognizes(prompt), "not route-all (build 384 review): " + prompt)
        }
        // Genuine orders the grammar missed: the arithmetic with its particle
        // before the order, more verbs and endings, fillers, a receiver with its
        // particle, more ways to say what can run, the count of the routes,
        // openers and remarks, the means form, ways of naming the arithmetic.
        for prompt in ["1+1 2+2를 할 수 있는 거 중에 다 라우팅 시켜봐", "1+1을 다 라우팅 시켜봐", "원플러스원을 다 라우팅 해봐",
                       "1+1이랑 2+2를 다 라우팅 시켜봐", "일 더하기 일을 다 라우팅 해봐", "1+1을 모든 모델로 보내봐",
                       "다 라우팅 하자 1+1", "다 라우팅 가자 1+1", "다 라우팅 해보자고 1+1", "다 라우팅 시켜보자고 1+1", "다 라우팅 하셈 1+1",
                       "다 라우팅 태워봐 1+1", "전부 라우팅 태워봐 1+1 2+2", "모든 모델에 라우팅 태워봐 1+1", "다 라우팅 걸어봐 1+1",
                       "전부 라우팅 걸어봐 1+1", "다 라우팅 시켜보라고 1+1", "다 라우팅 하라니까 1+1", "다 라우팅 시키라고 1+1",
                       "아니 씨발 다 라우팅 시켜보라고 1+1", "라우팅 좀 다 해봐 1+1", "라우팅 한번 다 시켜봐 1+1 2+2", "다 라우팅 쫌 시켜봐 1+1",
                       "야 라우팅 함 해봐 다 1+1", "모델들한테 다 1+1 보내봐", "모델한테 다 1+1 2+2 보내봐", "백엔드들한테 전부 1+1 보내봐",
                       "모델별로 1+1 하나씩 돌려봐", "사용할 수 있는 모델 전부 라우팅 해봐 1+1", "이용할 수 있는 거 다 라우팅 해봐 1+1",
                       "할 수 있는 모든 거 다 라우팅 시켜봐 1+1", "니가 사용할 수 있는 모델 다 1+1 돌려봐", "니가 호출할 수 있는 모델 다 1+1 시켜봐",
                       "니가 갖고 있는 모델 다 1+1 돌려봐", "할 수 있는 애들 다 라우팅 해봐 1+1", "되는 애들 다 1+1 돌려봐",
                       "니가 쓸 수 있는 애들한테 다 1+1 보내봐", "4개 다 라우팅 해봐 1+1", "네 군데 다 라우팅 시켜봐 1+1", "넷 다 라우팅 해봐 1+1",
                       "4곳 다 라우팅 해봐 1+1", "4개 전부 라우팅 시켜봐 1+1 2+2 3+3 4+4", "다 라우팅 해봐 1+1 2+2 3+3 4+4 이렇게 네 개",
                       "네 개 다 1+1 보내봐", "네 개 전부 돌려봐 1+1 2+2", "근데 다 라우팅 시켜봐 1+1", "아니 그러니까 다 라우팅 시켜봐 1+1",
                       "걍 다 라우팅 해봐 1+1", "씨발 다 라우팅 시켜봐 1+1", "아 씨발 그냥 다 라우팅 시켜봐 1+1", "야 다 라우팅 시켜봐 ㅋㅋ 1+1",
                       "다 라우팅 시켜봐 1+1 ㅇㅇ", "ㅇㅋ 다 라우팅 해봐 1+1", "루아야 다 라우팅 시켜봐 1+1", "오에스 원 다 라우팅 해봐 1+1",
                       "다 라우팅 시켜봐 1+1 뭐라고 하는지 보자", "다 라우팅 시켜봐 1+1 다 맞추나 보자", "다 라우팅 시켜봐 1+1 다 답하는지 보자",
                       "다시 다 라우팅 해봐 1+1 이번엔 되나 보자", "다 라우팅 시켜봐 1+1 2+2 답만 받아와", "다 라우팅 시켜봐 1+1 결과만 알려줘",
                       "다 라우팅 시켜봐 1+1 몇이야", "다 라우팅 시켜봐 1+1 2+2 그거면 돼", "다 라우팅 시켜봐 1+1 2+2 이런 거 알지",
                       "너 혼자 하지 말고 다 라우팅 시켜봐 1+1", "하나로만 보내지 말고 다 라우팅 해봐 1+1", "다 라우팅해서 1+1 물어봐",
                       "다 동원해서 1+1 풀어봐", "모든 모델한테 1+1 몇인지 물어봐", "다 계산시켜봐 1+1", "1+1 다 계산시켜봐", "1+1만 다 라우팅 해봐",
                       "다 라우팅 시켜봐 1+1 아니면 2+2", "1+1 이걸로 다 라우팅 해봐", "다 라우팅 시켜봐 1+1 같은 거 아무거나",
                       "다 라우팅 시켜봐 아무 간단한 계산이나", "다 라우팅 시켜봐 대충 1+1 이런 걸로", "개쉬운 거 1+1 다 라우팅 시켜봐",
                       "초간단 1+1 다 라우팅 해봐", "로컬 포함해서 다 라우팅 시켜봐 1+1", "로컬 코덱스 클코 클챗 다 라우팅 해봐 1+1",
                       "몽땅 다 라우팅 시켜봐 1+1", "전체 다 라우팅 해봐 1+1", "send 1+1 to all models pls", "yo route 2+2 to every model",
                       "죄다 라우팅 시켜봐 1+1", "다 따로따로 라우팅 해봐 1+1 2+2", "니가할수있는거다라우팅시켜봐1+1", "ㄱㄱ 다 라우팅 1+1",
                       "다 send 해봐 1+1", "전부 다 dispatch 해봐 1+1"] {
            check(order(prompt)?.hold == nil && plan(prompt, available: all)?.routes.count == 4, "route-all (build 384 review): " + prompt)
        }
        check(namedParts("1+1 로컬한테 2+2 코덱스한테")?.routes.map { $0.surface.rawValue + ":" + $0.instruction } == ["local:1+1", "codex:2+2"],
              "unpunctuated named parts split at the next expression")
        check(namedParts("1+1은 로컬한테 2+2는 코덱스한테 보내봐")?.routes.map { $0.surface.rawValue + ":" + $0.instruction } == ["local:1+1", "codex:2+2"],
              "unpunctuated named parts with topic particles")
        check(plan("다 던져봐 1+1 2+2 3+3 4+4 5+5", available: all)?.unsent == ["5+5"], "a fifth expression is reported unsent")
        check(routes("코덱스 빼고 세 개 다 라우팅 해봐 1+1") == ["local:1+1", "claude:1+1", "claude-chat:1+1"], "a count matching the routes left")
        check(order("다 라우팅 해봐 아까 거")?.hold == .referencedContent && routes("야 아까처럼 다 라우팅 시켜봐 1+1")?.count == 4 &&
              routes("아까 하나로만 갔잖아 이번엔 다 라우팅 해봐")?.count == 4, "a pointer with nothing written holds; with arithmetic or in a remark it does not")
        guard failed.isEmpty else { throw RouteAllIntentError.selfTest(failed) }
    }
}

public enum RouteAllIntentError: Error, CustomStringConvertible {
    case selfTest([String])
    public var description: String {
        switch self { case .selfTest(let failed): return "Route-all self-test failed: " + failed.joined(separator: "; ") }
    }
}
