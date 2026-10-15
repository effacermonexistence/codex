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
/// route order.
///
/// Recognition is conservative. The order must be an imperative sentence of
/// its own (no question mark, negation, report, hypothetical, quote or
/// question word) and the request must name no provider (a named list is
/// `RouteFanout`'s). Every other sentence must be framing (`RouteFanout`'s
/// side sentences) or describe the arithmetic to send. Anything else, a
/// question in words or a work order, keeps the order recognised but makes
/// the request unsupported: the host then holds it visibly instead of sending
/// the routing order to one worker (`supported`).
public enum RouteAllIntent {
    public typealias Surface = RCCRuntimeContract.Surface

    /// The execution surfaces a route-all order uses, in route order. GPT is
    /// no longer routed (2026-10-13).
    public static let surfaceOrder: [Surface] = [.local, .codex, .claude, .claudeChat]
    /// Used in route order when the owner wrote no expression.
    public static let defaultExpressions = ["1+1", "2+2", "3+3", "4+4"]

    public struct Plan: Equatable, Sendable {
        /// One route per available surface, in `surfaceOrder`.
        public let routes: [RCCRuntimeContract.ExplicitRoute]
        /// The owner's own expressions as written, made canonical ("1+1");
        /// empty when the defaults were used.
        public let expressions: [String]
        public var defaulted: Bool { expressions.isEmpty }
    }

    // MARK: Recognition

    static let target = #"(?:쪽|곳|경로|백엔드|모델|서피스|엔진|라우트)(?:들)?"#
    static let toward = #"(?:으로|로|에다가|에다|에게|한테|에)?"#
    static let all = #"(?<![가-힣])(?:다|전부|모두|전체|싹\s?다)"#
    /// The imperative ending: "해", "해봐", "시켜봐", "보내줘". Never "해서",
    /// "해야", "했어", "하라고" (the next letter must not be Hangul).
    static let ending = #"\s?(?:봐줘|봐요|봐라|봐봐|봐바|봐|보자|볼래|줘봐|줘요|줘|주세요|라)?(?![가-힣A-Za-z])"#
    static let routeVerb = #"라우팅\s*(?:을\s*)?(?:해|시켜|돌려)"# + ending
    static let sendVerb = #"(?:시켜|돌려|보내|던져|뿌려)"# + ending
    static let plainVerb = #"해"# + ending
    static let orders: [String] = [
        // "라우팅 할 수 있는 쪽으로 최대한 다 라우팅 해봐", "라우팅 가능한 경로로 다 해봐"
        #"라우팅\s*(?:(?:할|하는|될|되는)\s*수\s*있는|가능한)\s*"# + target + #"\s*"# + toward +
            #"\s*(?:최대한\s*)?"# + all + #"\s*(?:"# + routeVerb + "|" + sendVerb + "|" + plainVerb + ")",
        // "할 수 있는 쪽으로 다 보내봐", "가능한 백엔드로 전부 라우팅해"
        #"(?<![가-힣])(?:(?:할|하는|될|되는)\s*수\s*있는|가능한)\s*"# + target + #"\s*"# + toward +
            #"\s*(?:최대한\s*)?"# + all + #"\s*(?:"# + routeVerb + "|" + sendVerb + ")",
        // "라우팅 할 수 있는 거 다 해봐"
        #"라우팅\s*(?:(?:할|하는|될|되는)\s*수\s*있는|가능한)\s*(?:거|것|건)\s*(?:최대한\s*)?"# + all +
            #"\s*(?:"# + routeVerb + "|" + sendVerb + "|" + plainVerb + ")",
        // "최대한 다 라우팅 해봐", "전부 라우팅해", "다 라우팅 시켜봐"
        #"(?:(?<![가-힣])(?:최대한|가능한\s?한)\s*)?"# + all + #"\s*"# + routeVerb,
        // "최대한 라우팅 해봐", "최대한 많은 쪽으로 라우팅해"
        #"(?<![가-힣])최대한\s*(?:많이\s*|많은\s*"# + target + #"\s*"# + toward + #"\s*)?"# + routeVerb,
        // "모든 백엔드로 라우팅해", "모든 쪽으로 보내봐", "전부 쪽으로 라우팅해"
        #"(?<![가-힣])(?:모든|전체|전부)\s*(?:의\s*)?"# + target + #"\s*"# + toward + #"\s*(?:다\s*)?(?:"# +
            routeVerb + "|" + sendVerb + ")",
        // English: "route it to all backends", "send this to every available model"
        #"(?<![A-Za-z])(?:route|send|dispatch|fan\s*-?\s*out)\s+(?:(?:it|this|that|them|these|the\s+(?:request|task|question)s?)\s+)?(?:to|through|across|on)\s+(?:all|every|each)\s+(?:(?:of\s+)?the\s+)?(?:available\s+|possible\s+|routable\s+)?(?:routes?|backends?|surfaces?|models?|providers?|lanes?|engines?)(?![A-Za-z])"#,
        // "route it to as many backends as possible"
        #"(?<![A-Za-z])(?:route|send|dispatch)\s+(?:(?:it|this|that|them|these)\s+)?(?:to|through|across|on)\s+as\s+many\s+(?:routes|backends|surfaces|models|providers|lanes)\s+as\s+(?:possible|you\s+can)(?![A-Za-z])"#,
        // "route it everywhere"
        #"(?<![A-Za-z])route\s+(?:(?:it|this|that|them|these)\s+)?everywhere(?:\s+(?:possible|you\s+can))?(?![A-Za-z])"#,
    ]
    /// After the order, a report or a past or future statement, not an order:
    /// "모든 백엔드로 보내 버렸어", "다 라우팅 해봐 했더니 안 되더라". Before it a
    /// past tense does not make the order a report ("아까 하나로만 갔잖아 이번엔 다
    /// 라우팅 해봐" is recognised); such context is not framing, so `plan`
    /// still holds the request rather than guess it harmless.
    static let report = #"했|됐|봤|켰|냈|렸|었|았|였|겠|갔|왔|줬|버리|버린"#
    /// A hypothetical, a quote or a question: "다 라우팅하면", "다 라우팅 하라고",
    /// "왜 다 라우팅 해", "if you route to all backends".
    static let notAnOrder = #"만약|(?:하|되|시키|보내|돌리|해)면(?![가-힣])|라면(?![가-힣])|(?:라|이라|하라|해라|시키라|보내라)고(?![가-힣])|라는(?![가-힣])|["“”‘’「」『』]|(?<![가-힣])(?:왜|어떻게|뭐가|무슨)(?![가-힣])|(?<![A-Za-z])(?:if|whether|would|could|should|did|didn'?t|why|how|when|was|were|has|have|had)(?![A-Za-z])"#

    /// The owner's order to route to every route, as a sentence of its own,
    /// in a request that names no provider. Grants no dispatch authority by
    /// itself: `plan` decides what runs.
    public static func recognizes(_ prompt: String) -> Bool { orderClause(prompt) != nil }

    /// The order sentence (its index among the request's sentences) and the
    /// span of the order in it.
    static func orderClause(_ prompt: String) -> (index: Int, clause: String, order: NSRange)? {
        let text = prompt.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= RouteFanout.maximumCharacters, !text.contains("```"),
              !RouteFanout.containsName(text) else { return nil }
        for (index, clause) in RouteFanout.clauses(text).enumerated() {
            guard let found = orders.lazy.compactMap({ clause.range(of: $0, options: [.regularExpression, .caseInsensitive]) }).first
            else { continue }
            let order = NSRange(found, in: clause)
            let tail = (clause as NSString).substring(from: NSMaxRange(order))
            guard !RouteFanout.endsWithQuestionMark(clause, in: text),
                  clause.range(of: RouteFanout.negation, options: [.regularExpression, .caseInsensitive]) == nil,
                  clause.range(of: notAnOrder, options: [.regularExpression, .caseInsensitive]) == nil,
                  tail.range(of: RouteFanout.reportedRouting, options: [.regularExpression, .caseInsensitive]) == nil,
                  tail.range(of: report, options: .regularExpression) == nil else { continue }
            // "라우팅이 안 돼" and the like, outside the order itself.
            guard remainder(clause, removing: order).range(of: RouteFanout.routingTalk, options: .regularExpression) == nil
            else { continue }
            return (index, clause, order)
        }
        return nil
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
    /// Operators as written, and the canonical one each means.
    public static let operatorWords: [(word: String, symbol: String)] = [
        ("플러스", "+"), ("더하기", "+"), ("plus", "+"), ("+", "+"),
        ("마이너스", "-"), ("빼기", "-"), ("minus", "-"), ("-", "-"),
        ("곱하기", "*"), ("times", "*"), ("×", "*"), ("*", "*"),
    ]
    static let number = "(?:[0-9]{1,9}|" + numberWords.map { NSRegularExpression.escapedPattern(for: $0.word) }.joined(separator: "|") + ")"
    static let operation = "(?:" + operatorWords.map { NSRegularExpression.escapedPattern(for: $0.word) }.joined(separator: "|") + ")"
    /// One expression at the current position: "원플러스원", "1 + 1", "two x two".
    /// It ends where no letter, digit or operator follows, before a particle
    /// ("원플러스원이랑"), or right before the next expression ("원플러스원투플러스투").
    static let expressionAtPosition: NSRegularExpression? = try? NSRegularExpression(pattern:
        "(" + number + ")(?:\\s*(" + operation + ")\\s*|\\s+([xX])\\s+)(" + number + ")" +
        "(?=$|[^A-Za-z0-9가-힣+*×\\-]|(?:은|는|이랑|랑|하고|과|와|이|가|을|를|도|요)(?![가-힣])|" + number + "\\s*" + operation + ")",
        options: [.caseInsensitive])

    static func value(_ written: String) -> Int? {
        if let digits = Int(written), written.allSatisfy(\.isASCII) { return digits }
        let lowered = written.lowercased()
        return numberWords.first { $0.word == lowered }?.value
    }

    /// Every expression written in `text`, canonical and in order, and the
    /// text with each one blanked out.
    static func extract(_ text: String) -> (expressions: [String], rest: String) {
        guard let regex = expressionAtPosition else { return ([], text) }
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
        var rest = text
        for item in found.reversed() {
            if let range = Range(item.range, in: rest) { rest.replaceSubrange(range, with: " ") }
        }
        return (found.map(\.canonical), rest)
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
    static func allowed(_ word: String) -> Bool {
        if allowedWords.contains(word) { return true }
        let stem = word.replacingOccurrences(of: #"(?:으로요|으로|이랑|처럼|은|는|이|가|을|를|도|만|로|에|요|야|랑)$"#, with: "",
                                             options: .regularExpression)
        return stem != word && !stem.isEmpty && allowedWords.contains(stem)
    }
    /// Nothing but allowed words, once the expressions are taken out.
    static func onlyAllowed(_ text: String) -> Bool {
        text.lowercased().split(whereSeparator: { $0.isWhitespace || ",.?!~:;·…()[]".contains($0) })
            .allSatisfy { allowed(String($0)) }
    }

    /// The owner's expressions, or nil when the request carries anything
    /// besides the order, its framing and the arithmetic to send (a question
    /// in words, a work order, another instruction). Empty: none written.
    public static func expressions(_ prompt: String) -> [String]? {
        guard let found = orderClause(prompt) else { return nil }
        let text = prompt.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines)
        var expressions: [String] = []
        let clauses = RouteFanout.clauses(text), at = found.index
        guard clauses.indices.contains(at), clauses[at] == found.clause else { return nil }
        for (index, clause) in clauses.enumerated() {
            let extracted = extract(index == at ? remainder(clause, removing: found.order) : clause)
            if onlyAllowed(extracted.rest) { expressions += extracted.expressions; continue }
            // Framing beside the order ("라우팅 테스트야", "답변 받아와") carries no part.
            if index != at, extracted.expressions.isEmpty,
               RouteFanout.sideSentence(clause, in: text, leading: index < at) { continue }
            return nil
        }
        guard expressions.count <= RouteFanout.maximumTargets else { return nil }
        var seen = Set<String>()
        return expressions.filter { seen.insert($0).inserted }
    }

    /// The explicit routes for a recognised, supported route-all order on the
    /// `available` surfaces (kept in `surfaceOrder`), or nil when the request
    /// is not such an order. Routes may be empty: nothing can run now.
    public static func plan(_ prompt: String, available: [Surface]) -> Plan? {
        guard let written = expressions(prompt) else { return nil }
        let surfaces = surfaceOrder.filter(available.contains)
        let pool = written.isEmpty ? defaultExpressions : written
        let routes = surfaces.enumerated().map { index, surface in
            RCCRuntimeContract.ExplicitRoute(surface: surface, instruction: pool[index % pool.count])
        }
        return Plan(routes: routes, expressions: written)
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
                       "라우팅 가능한 경로로 다 해봐", "자 이번엔 라우팅 할 수 있는 거 다 해봐",
                       "Route it to all backends", "send this to every available model", "route this to as many backends as possible",
                       "ok let's route it to all backends",
                       "route it everywhere", "다 라우팅 해봐. 원 플러스 원, 투 플러스 투",
                       "라우팅 테스트야. 다 라우팅 해봐. 답변 받아와.", "알았어 그럼 다 라우팅 해봐",
                       "다 라우팅 해봐. 안 되면 말해."] {
            check(recognizes(prompt) && plan(prompt, available: all)?.routes.count == 4, "route-all: " + prompt)
        }
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
        check(extract("원래 하나씩 만 원").expressions.isEmpty, "number words outside an expression stay words")
        check(routes("다 라우팅 해봐. 1+1, 2+2, 3+3") == ["local:1+1", "codex:2+2", "claude:3+3", "claude-chat:1+1"],
              "three expressions round robin over four routes")
        // Not an order to route everywhere.
        for prompt in ["다 라우팅이 안 돼", "라우팅 다 됐어?", "왜 다 라우팅 안 했어", "다 라우팅하면 비용이 얼마야",
                       "다 라우팅 하지 마", "모든 백엔드로 라우팅되는 거 맞아?", "모든 모델로 라우팅하는 로직 고쳐",
                       "또 내가 이렇게 시켰잖아? 라우팅 할 수 있는데 다 시켜라고?", "다 라우팅 했잖아",
                       "모든 백엔드로 보내 버렸어", "다 라우팅 해보겠습니다", "라우팅 로직 좀 봐줘", "라우팅이 이상해",
                       "다 라우팅 해야지", "다 라우팅 하라고 했잖아", "\"다 라우팅 해봐\"라고 쓰면 돼",
                       "if you route it to all backends what happens", "why didn't you route it to all backends",
                       "클로드랑 코덱스 다 라우팅 해봐", "다 라우팅 해봐 코덱스한테", "1+1 계산해", "원플러스원 해봐",
                       "다 돌려봐", "모든 테스트 돌려", "이거 다 해봐", "다 라우팅 해봐 했더니 안 되더라",
                       "모든 백엔드로 보내 버렸어"] {
            check(!recognizes(prompt), "not route-all: " + prompt)
        }
        // Recognised, but carrying something besides arithmetic: never a single
        // task, never sent. Context beside the order is not guessed harmless
        // either ("아까 하나로만 갔잖아"): the request is held, visibly.
        for prompt in ["다 라우팅 해봐. 수도가 어디야", "모든 모델로 보내봐, 그리고 코드 리뷰 받아",
                       "다 라우팅 해봐. 그리고 커밋해", "최대한 다 라우팅 해봐 README 요약해서",
                       "아까 하나로만 갔잖아 이번엔 다 라우팅 해봐"] {
            check(recognizes(prompt) && plan(prompt, available: all) == nil, "recognised but unsupported: " + prompt)
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
