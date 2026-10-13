import Foundation

/// Explicit model-family and reasoning-effort words in the OWNER's own request
/// text, never conversation history or a model-authored plan.
///
/// A word counts only beside a context that makes it a routing constraint:
/// a reasoning/effort word ("최대 리즈닝", "reasoning: high"), a model family
/// ("opus max", "gpt-6-sol", "fable 5.1 모델로") or, for Ultra, a Korean
/// directive particle ("울트라로"). "max file size", "높은 건물", "솔직히" and
/// "solo" are not constraints. Two different efforts or two different
/// families cancel each other instead of being guessed between, and a negated
/// mention ("opus 말고", "not max reasoning") is ignored.
///
/// Talking ABOUT a setting is not asking for it: "what is the max thinking
/// budget?", "클로드 최대 리즈닝 설정이 뭐야?", "Codex xhigh 지원해?" and "a high
/// effort task" set nothing, unless a directive form ("최대 리즈닝으로",
/// "use max reasoning") is also there. Only a question about the setting
/// itself counts: an inquiry word in the same noun phrase ("max reasoning
/// tokens", "리즈닝 설정이"), a wh-question, or a question with no request in
/// it. A task noun later in the sentence ("max reasoning: refactor the config
/// loader", "맥스 리즈닝, 이 함수 뭐하는지 설명해") or an imperative "Do a max
/// reasoning pass" is still a request. Saying the effort is not wanted
/// ("최대 리즈닝 필요 없어", "max reasoning not needed", "최대 추론은 과해")
/// sets nothing.
///
/// A family word needs a product/model word or a directive ("claude opus",
/// "use daybreak model", "소네트로 돌려", "astra 6 써줘", "use opus 5.5 for
/// this", "opus 5.5로 리뷰해줘", "run this on sonnet 5"): "use astra db",
/// "answer with haiku", "Fable 3" and "terra luna 2.0" are ordinary nouns. A
/// question or a description of a model ("what is claude opus?", "Claude
/// Opus의 장점을 설명해줘", "explain the claude sonnet model pricing") is not a
/// constraint unless it also says to run on it ("claude opus로 설명해줘").
public struct RoutingIntent: Equatable, Sendable {
    /// One of low, medium, high, xhigh, max, ultra.
    public var effort: String?
    /// Lowercase family token: fable, opus, sonnet, haiku, sol, luna, terra,
    /// astra or daybreak.
    public var modelFamily: String?

    public init(effort: String? = nil, modelFamily: String? = nil) {
        self.effort = effort; self.modelFamily = modelFamily
    }

    public var isEmpty: Bool { effort == nil && modelFamily == nil }

    public static let families = ["fable", "opus", "sonnet", "haiku", "sol", "luna", "terra", "astra", "daybreak"]

    /// A row matches a family only on a whole model-name token, so "sol" never
    /// matches an unrelated substring.
    public static func model(_ model: String, belongsTo family: String) -> Bool {
        model.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).contains { $0 == Substring(family) }
    }

    public func admits(model: String, effort: String) -> Bool {
        (self.effort.map { $0 == effort } ?? true) &&
            (modelFamily.map { Self.model(model, belongsTo: $0) } ?? true)
    }

    // MARK: Lexicon

    /// Ordered: xhigh before high, so "extra high" is never read as "high".
    static let effortWords: [(effort: String, pattern: String)] = [
        ("xhigh", #"(?<![a-z])(?:x[\s\-]?high|extra[\s\-]?high)(?![a-z])|엑스\s?하이(?![가-힣])"#),
        ("ultra", #"(?<![a-z])ultra(?![a-z])|울트라"#),
        ("max", #"(?<![a-z])max(?:imum)?(?![a-z])|최대|맥스(?![가-힣])"#),
        ("high", #"(?<![a-z])high(?![a-z])|높게|높은|높여|하이(?![가-힣])"#),
        ("medium", #"(?<![a-z])medium(?![a-z])|중간|미디엄(?![가-힣])"#),
        ("low", #"(?<![a-z])(?:low|minimal|minimum)(?![a-z])|낮게|낮은|낮춰|최소|미니멀|로우(?![가-힣])"#),
    ]
    /// Words that make an effort word a reasoning constraint.
    static let reasoningContext = #"(?:리즈닝|추론|reasoning|effort|thinking)"#
    static let familyWords: [(family: String, pattern: String)] = [
        ("fable", #"(?<![a-z0-9])fable(?![a-z])|(?<![가-힣])페이블"#),
        ("opus", #"(?<![a-z0-9])opus(?![a-z])|(?<![가-힣])오[퍼푸]스"#),
        ("sonnet", #"(?<![a-z0-9])sonnet(?![a-z])|(?<![가-힣])소네트|(?<![가-힣])소넷"#),
        ("haiku", #"(?<![a-z0-9])haiku(?![a-z])|(?<![가-힣])하이쿠"#),
        ("sol", #"(?<![a-z0-9])sol(?![a-z])|(?<![가-힣])솔(?![가-힣])"#),
        ("luna", #"(?<![a-z0-9])luna(?![a-z])|(?<![가-힣])루나"#),
        ("terra", #"(?<![a-z0-9])terra(?![a-z])|(?<![가-힣])테라(?![가-힣]{2})"#),
        ("astra", #"(?<![a-z0-9])astra(?![a-z])|(?<![가-힣])아스트라"#),
        ("daybreak", #"(?<![a-z0-9])daybreak(?![a-z])|(?<![가-힣])데이브레이크"#),
    ]
    /// A product or model word immediately before a family ("gpt-6-sol",
    /// "claude opus", "model fable"). A generic verb ("use", "run … on") is
    /// not one: it qualifies only through `genericVerbBefore`/`After`, so
    /// "use astra db" still names a database.
    static let familyLeftContext = #"(?:gpt|claude|클로드|codex|코덱스|model|모델)[\s\-:./]*(?:[0-9]+(?:[.\-][0-9]+)*[\s\-./]*)?$"#
    /// A version is part of a model name only when a model word or a directive
    /// follows it ("fable 5.1 모델로", "astra 6 써줘"); "Fable 3" and
    /// "luna 2.0 crash" are not routing.
    static let versionQualified = #"^[\s\-]*[0-9]+(?:[.\-][0-9]+)*(?![0-9])\s*(?:model|모델|(?:(?:으로|로|한테|에게)\s*)?(?:돌려|해|실행|써|사용|시켜|보내|맡겨|부탁|run))"#
    /// A version or a model word, then a Korean directive particle, whatever
    /// verb follows ("opus 5.5로 리뷰해줘", "fable 5.1 모델로", "opus 모델로
    /// 설명해").
    static let qualifiedParticle = #"^(?:[\s\-]*[0-9]+(?:[.\-][0-9]+)*(?![0-9])\s*(?:(?:model|모델)\s*)?|\s*(?:model|모델)\s*)(?:으로|로|한테|에게)"#
    /// A version, then a directive verb ("astra 6 써줘", "sol 6로 돌려").
    static let versionDirective = #"^[\s\-]*[0-9]+(?:[.\-][0-9]+)*(?![0-9])\s*(?:(?:으로|로|한테|에게)\s*)?(?:돌려|해|실행|써|사용|시켜|보내|맡겨|부탁|run)"#
    /// A generic verb names a model only when the family ends the phrase or a
    /// version, "for"/"to"/"please" or the model word follows: "use opus 5.5 for this",
    /// "using opus", "run this on sonnet 5", never "use astra db".
    static let genericVerbBefore = #"(?:(?<![a-z])(?:use|using|via)|(?<![a-z])run(?:\s+(?:it|this|that|these|them))?\s+(?:on|with)|(?<![a-z])switch(?:\s+(?:it|this|that))?\s+to)\s+(?:the\s+)?$"#
    static let genericVerbAfter = #"^(?:[\s\-]*[0-9]+(?:[.\-][0-9]+)*(?![0-9]))?\s*(?:$|[,!?;:\n]|\.(?:\s|$)|for(?![a-z])|to(?![a-z])|please(?![a-z])|model(?![a-z])|모델)"#
    /// Asking about a setting, not setting it: an inquiry word in the same
    /// noun phrase right after the effort/reasoning words ("max thinking
    /// budget", "리즈닝 설정이 뭐야", "xhigh 지원해?"). A colon or comma ends
    /// that phrase, so a later task noun ("max reasoning: refactor the config
    /// loader") is not an inquiry; "설정해" (set it) is a directive.
    static let inquiryAfter = #"^\s*(?:(?:의|한|인)\s*)?(?:(?:리즈닝|추론|reasoning|effort|thinking)\s*)?(?:(?:level|레벨)\s*)?(?:(?:의|은|는|이|가|을|를)\s*)?(?:budget|tokens?|settings?|config(?:uration)?|options?|limits?|supports?|supported|available|availability|설정(?!\s*(?:해|하|으로|로))|옵션|한도|토큰|지원|뭐|무엇|얼마|어떻게|차이|가격|요금)"#
    /// A wh-question opener starting the same clause ("what is the max…").
    static let inquiryBefore = #"(?:^|[.!?\n,]\s*)(?:what|which|how|whats|what's)(?![a-z])[^.!?\n,]{0,48}$"#
    /// An auxiliary opener asks only when its sentence ends with "?" ("do you
    /// support max reasoning?"); "Do a max reasoning pass" is an imperative.
    static let auxiliaryBefore = #"(?:^|[.!?\n,]\s*)(?:does|do|is|are|can|could|would|will)(?![a-z])[^.!?\n,]{0,48}$"#
    /// A request word anywhere in a "?" sentence makes it a request, not a
    /// question about the setting ("최대 리즈닝 쓸 수 있어?", "can you use…?").
    static let requestWords = #"(?<![a-z])(?:please|use|using|run|do|make|fix|write|add|refactor|implement|review|find|check|solve|answer|debug|give|show|tell|help|set)(?![a-z])|해|줘|줄래|줄\s*수|돌려|써|쓸|쓰|사용|시켜|하자|가자|부탁|봐"#
    /// Talking about a model, not running on it.
    static let familyInquiry = #"설명|차이|출시|뭐|무엇|장점|단점|가격|요금|비교|스펙|성능|벤치마크|컨텍스트|(?<![a-z])(?:what(?:'?s|\s+is|\s+are)|compare|comparison|vs|versus|pricing|price|cost|release|released|benchmark|explain|difference|context\s+window|spec|specs)(?![a-z])"#
    static let whQuestion = #"^\s*(?:what|which|how|whats|what's|why|who|when)(?![a-z])"#
    /// The effort describes a noun, not the answer: "a high effort task".
    static let descriptiveAfter = #"^[\s,:=]*(?:의|한|인)?\s*(?:리즈닝|추론|reasoning|effort|thinking)\s*(?:task|job|work|problem|question|request|작업|문제|질문|요청)(?![a-z])"#
    /// A directive form that outranks an inquiry word in the same clause:
    /// "최대 리즈닝으로 …", "리즈닝 최대로", "use/with/at max reasoning".
    static let directiveAfter = #"^[\s,:=]*(?:(?:의|한|인)?\s*(?:리즈닝|추론|reasoning|effort|thinking)\s*)?(?:으로|로)(?=\s|$|[,.!?]|해|돌|실행|써|사용|시켜|답|풀|처리|진행|부탁|가자|하자)"#
    static let directiveBefore = #"(?<![a-z])(?:use|using|with|at|set(?:\s+[a-z]+){0,3}\s+to)\s+(?:a\s+|an\s+|the\s+)?$"#
    /// Directive particles: "오퍼스로 돌려", "luna한테 시켜".
    static let directive = #"^\s*(?:으로|로|한테|에게)\s*(?:돌려|해|실행|써|사용|시켜|보내|맡겨|부탁|run)"#
    /// A negation or "not needed" predicate on the mention, after its
    /// particles and at most two filler words ("최대 리즈닝까지 할 필요는 없어",
    /// "max reasoning is unnecessary", "최대 추론은 과해", "opus 말고").
    static let negationAfter = #"^[\s,:=]*(?:(?:으로|로|의|은|는|을|를|이|가|까지|도)\s*)?(?:(?:리즈닝|추론|reasoning|effort|thinking|모델|model)\s*)?(?:(?:으로|로|은|는|을|를|이|가|까지는|까진|까지|도)\s*)?(?:(?:좀|굳이|꼭|really|is|are|was|to\s+use|할|쓸|돌릴|하는\s*건|쓰는\s*건|할\s*거|쓸\s*거)\s*){0,2}(?:말고|빼고|쓰지\s*마|하지\s*마|없이|금지|아니(?:고|라|야|에요|예요)|필요\s*(?:는|가|도)?\s*(?:없|않)|불필요|안\s*(?:해|써|하|쓰|돌려|돌리)|과해|과하|is\s+not|isn'?t|not\s+(?:needed|necessary|required|wanted)|unnecessary|overkill|no\s+need)"#
    /// Korean "X 말고 Y" negates X (handled after X), never Y.
    static let negationBefore = #"(?<![a-z])(?:no|not|don'?t|without|never|avoid|except)\s+(?:[a-z\-]+\s+){0,2}$"#

    // MARK: Parsing

    public static func parse(_ text: String) -> RoutingIntent {
        let value = text.precomposedStringWithCanonicalMapping.lowercased()
        let ns = value as NSString
        func ranges(_ pattern: String) -> [NSRange] {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
            return regex.matches(in: value, range: NSRange(location: 0, length: ns.length)).map(\.range)
        }
        func after(_ range: NSRange, _ length: Int = 24) -> String {
            let start = range.location + range.length
            return ns.substring(with: NSRange(location: start, length: min(length, ns.length - start)))
        }
        func before(_ range: NSRange, _ length: Int = 24) -> String {
            let start = max(0, range.location - length)
            return ns.substring(with: NSRange(location: start, length: range.location - start))
        }
        func matches(_ text: String, _ pattern: String) -> Bool {
            text.range(of: pattern, options: .regularExpression) != nil
        }
        func negated(_ range: NSRange) -> Bool {
            matches(after(range, 48), negationAfter) || matches(before(range, 24), negationBefore)
        }
        // A sentence ends at "!", "?", a newline or a "." before a space or the
        // end, never at the "." inside a version ("opus 5.5", "h.264").
        func terminates(_ index: Int) -> Bool {
            let c = ns.character(at: index)
            if c == 0x21 || c == 0x3F || c == 0x0A || c == 0xFF1F { return true }
            guard c == 0x2E else { return false }
            guard index + 1 < ns.length else { return true }
            return [0x20, 0x09, 0x0A].contains(ns.character(at: index + 1))
        }
        func sentence(_ range: NSRange) -> (text: String, question: Bool) {
            var start = range.location
            while start > 0, !terminates(start - 1) { start -= 1 }
            var end = range.location + range.length
            while end < ns.length, !terminates(end) { end += 1 }
            let question = end < ns.length && [0x3F, 0xFF1F].contains(ns.character(at: end))
            return (ns.substring(with: NSRange(location: start, length: end - start)), question)
        }

        // Effort words, longest-first; a span already claimed by an earlier
        // (longer) effort word is not read again ("x-high" is not also "high").
        var claimed: [NSRange] = []
        var efforts: [(effort: String, range: NSRange)] = []
        for (effort, pattern) in effortWords {
            for range in ranges(pattern) where !claimed.contains(where: { NSIntersectionRange($0, range).length > 0 }) {
                claimed.append(range); efforts.append((effort, range))
            }
        }
        var families: [(family: String, range: NSRange)] = []
        for (family, pattern) in familyWords {
            for range in ranges(pattern) { families.append((family, range)) }
        }

        var effortIntents = Set<String>()
        for (effort, range) in efforts where !negated(range) {
            // Effort then reasoning word: "최대 리즈닝", "max reasoning", "울트라 추론".
            let followedByContext = matches(after(range, 20),
                #"^[\s,:=]*(?:으로|로|의|한|인|level|레벨)?\s*"# + reasoningContext)
            // Reasoning word then effort: "reasoning: high", "리즈닝 최대로", "추론을 높게".
            let precededByContext = matches(before(range, 28), reasoningContext +
                #"\s*(?:effort|강도|레벨|level|수준)?\s*(?:을|를|은|는|이|가|:|=)?\s*(?:좀\s*)?$"#)
            // Family then effort: "opus max", "luna/high", "fable 울트라로".
            let precededByFamily = families.contains { family in
                let end = family.range.location + family.range.length
                guard end <= range.location else { return false }
                let gap = ns.substring(with: NSRange(location: end, length: range.location - end))
                return matches(gap, #"^[\s\-/,]*(?:[0-9]+(?:[.\-][0-9]+)*[\s\-/,]*)?(?:모델\s*)?(?:으로|로)?\s*$"#)
            }
            // A technical token that is never incidental, and the Korean
            // Ultra directive ("울트라로 해").
            let standalone = effort == "xhigh" && matches(ns.substring(with: range), #"^x[\s\-]?high$"#)
                || effort == "ultra" && matches(after(range, 4), #"^\s*(?:으로|로)(?![가-힣])"#)
            guard followedByContext || precededByContext || precededByFamily || standalone else { continue }
            // A question about the setting itself is not a request for the
            // effort, unless the same mention is also phrased as a directive.
            let directive = matches(after(range, 24), directiveAfter) || matches(before(range, 24), directiveBefore)
            let clause = sentence(range)
            let inquiry = matches(after(range, 48), inquiryAfter) ||
                matches(before(range, range.location), inquiryBefore) ||
                clause.question && (matches(before(range, range.location), auxiliaryBefore) ||
                                    !matches(clause.text, requestWords))
            if matches(after(range, 32), descriptiveAfter) || (inquiry && !directive) { continue }
            effortIntents.insert(effort)
        }

        var familyIntents = Set<String>()
        for (family, range) in families where !negated(range) {
            let left = matches(before(range, 24), familyLeftContext)
            let next = after(range, 24)
            let version = matches(next, versionQualified)
            let modelWord = matches(next, #"^\s*(?:model|모델)"#)
            let withEffort = efforts.contains { effort in
                let end = range.location + range.length
                guard effort.range.location >= end else { return false }
                let gap = ns.substring(with: NSRange(location: end, length: effort.range.location - end))
                return matches(gap, #"^[\s\-/,]*(?:[0-9]+(?:[.\-][0-9]+)*[\s\-/,]*)?(?:모델\s*)?(?:으로|로)?\s*$"#)
            }
            // "솔로" is also "solo": the bare Korean particle never qualifies Sol.
            let particle = family != "sol" && matches(next, directive)
            // Directive forms: the model is where the work runs.
            let generic = matches(before(range, 32), genericVerbBefore) && matches(next, genericVerbAfter)
            // After a product word the bare particle is the instrument
            // ("claude opus로 이 함수 설명해줘"), whatever verb follows.
            let productParticle = left && matches(next, #"^\s*(?:으로|로|한테|에게)(?![가-힣])"#)
            let runsOn = particle || generic || productParticle || matches(next, qualifiedParticle) ||
                matches(next, versionDirective)
            guard left || version || modelWord || withEffort || runsOn else { continue }
            // Asking about or describing a model is not running on it.
            let clause = sentence(range)
            let about = clause.question || matches(clause.text, familyInquiry) || matches(clause.text, whQuestion)
            if about && !runsOn { continue }
            familyIntents.insert(family)
        }
        return RoutingIntent(effort: effortIntents.count == 1 ? effortIntents.first : nil,
                             modelFamily: familyIntents.count == 1 ? familyIntents.first : nil)
    }
}
