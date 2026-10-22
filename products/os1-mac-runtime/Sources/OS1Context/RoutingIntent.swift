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
/// An effort word that describes a noun ("a low effort change", "our ultra
/// thinking mode", "high reasoning models") or follows an article or
/// possessive is not a request about this run either, unless an imperative
/// verb owns the phrase ("Do a max reasoning pass").
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
    /// The effort describes a noun, not the answer: "a high effort task", "a
    /// low effort change", "minimal thinking mode toggle", "high reasoning
    /// models". A Korean noun followed by a directive particle ("최대 리즈닝
    /// 모드로 해줘") is still a request.
    static let descriptiveAfter = #"^[\s,:=]*(?:의|한|인)?\s*(?:리즈닝|추론|reasoning|effort|thinking)[\s\-]*(?:(?:tasks?|jobs?|work|problems?|questions?|requests?|changes?|fix(?:es)?|edits?|tweaks?|patch(?:es)?|modes?|toggles?|switch(?:es)?|options?|flags?|features?|models?|regimes?|tiers?|variants?)(?![a-z])|(?:작업|문제|질문|요청|변경|수정|모드|토글|옵션|기능|모델)(?!\s*(?:으로|로)))"#
    /// An article or possessive right before the effort word makes it part of
    /// a noun phrase ("this is a low effort fix", "our ultra thinking mode"),
    /// unless an imperative verb owns the phrase ("Do a max reasoning pass",
    /// "use a high reasoning pass").
    static let determinerBefore = #"(?<![a-z])(?:a|an|the|our|my|your|their|its|his|her|this|that|these|those)\s+$"#
    static let imperativeDeterminerBefore = #"(?<![a-z])(?:do|run|make|give|take|perform|start|try|apply|want|need|use|using|with|at)\s+(?:a|an|the)\s+$"#
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
            // Describing a noun is not asking for the effort: "a low effort
            // change", "our ultra thinking mode", "high reasoning models".
            let determined = matches(before(range, 24), determinerBefore) &&
                !matches(before(range, 24), imperativeDeterminerBefore)
            if matches(after(range, 40), descriptiveAfter) || determined || (inquiry && !directive) { continue }
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

extension RoutingIntent {
    /// Opt-in R10 parser. This is deliberately bounded intent extraction, not
    /// an execution policy or quality forecast. Unknown/ambiguous directives
    /// hold instead of choosing a favorable interpretation. Legacy parse stays
    /// byte-for-byte unchanged. Exact model IDs come from this host's inventory.
    public static func parseV2(_ text: String, knownModelIDs: Set<String>) -> RCCRuntimeContract.RoutingIntentV2 {
        var result = RCCRuntimeContract.RoutingIntentV2()
        guard text.utf8.count <= 64_000, !text.contains("\0") else { result.state = "unresolved"; return result }
        func matches(_ value: String, _ pattern: String) -> Bool {
            value.range(of: pattern, options: .regularExpression) != nil
        }
        var body = text.precomposedStringWithCanonicalMapping.lowercased()
        // Quoted/document examples are not owner execution directives. Do not
        // normalize a quoted reference model into an actual execution pin.
        body = body.replacingOccurrences(of: #"```[\s\S]*?```"#, with: " ", options: .regularExpression)
        for pattern in [#"`([^`\n]*)`"#, #"\"([^\"\n]*)\""#, #"“([^”\n]*)”"#, #"‘([^’\n]*)’"#,
                        #"(?<![a-z])'([^'\n]*)'(?![a-z])"#] {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
            let ns = body as NSString
            for match in regex.matches(in: body, range: NSRange(location: 0, length: ns.length)).reversed() {
                let content = ns.substring(with: match.range(at: 1))
                let prefix = ns.substring(to: match.range.location)
                let suffix = ns.substring(from: NSMaxRange(match.range))
                // A quoted exact ID in an actual use directive is still an
                // exact pin. A quoted command/example remains quoted data.
                let literalPin = knownModelIDs.contains(where: { $0.lowercased() == content }) &&
                    (matches(prefix, #"(?:\buse|\bmodel\s*:|모델)\s*$"#) ||
                     matches(suffix, #"^\s*(?:으로|로|한테|에게)"#))
                body = (body as NSString).replacingCharacters(in: match.range, with: literalPin ? content : " ")
            }
        }
        // Unclosed quoted routing data is ambiguous, never an execution pin.
        // Apostrophes in contractions are intentionally not quote openers.
        if (["\"", "`", "“", "”", "‘", "’"].contains(where: body.contains) || matches(body, #"(?<![a-z])'"#)) &&
            matches(body, #"gpt-|claude-|codex|코덱스|클로드|reasoning|effort|리즈닝|추론|model\s*:"#) {
            result.state = "unresolved"; return result
        }
        // Only control-shaped spans own settings. Provider/model/effort words
        // inside the task argument are data, even when another span says use/run.
        let providerToken = #"(?:codex|코덱스|claude(?:\s+code)?|클로드(?:\s*코드)?|클라우드\s*코드|chatgpt|챗\s*지?피티|gpt\s*chat|채찌피티)"#
        let modelToken = #"(?:(?:gpt|claude)-[a-z0-9][a-z0-9.\-]*|"# +
            familyWords.map { "(?:" + $0.pattern + ")" }.joined(separator: "|") + ")"
        let targetToken = "(?:" + modelToken + "|" + providerToken + ")"
        let effortValue = #"(?:max(?:imum)?|highest|high|x[\s-]?high|extra[\s-]?high|medium|low|minimal|minimum|ultra|최대|맥스|높은|높게|중간|낮은|낮게|최소|울트라)"#
        let effortToken = "(?:" + effortValue + #"\s*(?:reasoning|effort|thinking|리즈닝|추론)|(?:reasoning|effort|thinking|리즈닝|추론)\s*"# + effortValue + ")"
        let end = #"(?=$|\s*[,;:.!?]|\s+(?:to|for|please|with|at|and|but|without|if|unless|instead|now|today|tomorrow|first|here)(?![a-z])|\s+(?:reasoning|effort|thinking)\s*[:=]|\s+(?:(?:is|are)\s+)?not\b|\s*(?:으로|로|한테|에게|말고|빼고|쓰지|(?:사용|선택|실행)?하지\s*마|아니라|필요\s*없|원하지))"#
        typealias SettingSpan = (range: NSRange, valueRange: NSRange, value: String, kind: String)
        func spans(_ clause: String, _ pattern: String, kind: String) -> [SettingSpan] {
            let ns = clause as NSString
            return (try? NSRegularExpression(pattern: pattern))?.matches(in: clause,
                range: NSRange(location: 0, length: ns.length)).map {
                    ($0.range, $0.range(at: 1), ns.substring(with: $0.range(at: 1)), kind)
                } ?? []
        }
        func routeSpans(_ clause: String) -> [SettingSpan] {
            // The qualifier is inside the owned target: app screenshots/CLI
            // logs fail the terminal gate, while "Codex CLI to ..." passes.
            let target = "(" + targetToken + ")" + #"(?:\s+[0-9]+(?:\.[0-9]+)*)?(?:\s+(?:cli|app|model))?"#
            return [
                #"\b(?:use|using|via|run|execute)\s+(?:the\s+)?"# + target + end,
                #"\b(?:run|execute|route|send)\b(?:(?!\b(?:and|but|then)\b|[,;.!?\n]).){0,120}?\b(?:on|with|to|via)\s+(?:the\s+)?"# + target + end,
                "(" + targetToken + #")(?:\s*[0-9]+(?:\.[0-9]+)*)?\s*(?:으로|로|한테|에게)(?=\s|$|[,.!?]|돌려|설명|실행|써|사용|해|보내|맡겨)"#,
                "(" + targetToken + #")\s+(?:써줘|사용해|돌려|실행해|맡겨|보내줘)"#,
            ].flatMap { spans(clause, $0, kind: "target") }
        }
        func negative(_ clause: String, _ span: SettingSpan) -> Bool {
            let ns = clause as NSString
            let prefix = ns.substring(to: span.range.location)
            let suffix = ns.substring(from: NSMaxRange(span.range))
            return matches(prefix, #"\b(?:no|not|don't|never|avoid|except|without|instead\s+of)\s+(?:(?:use|using|run|execute|route|send|choose|select|pick|the|a|any)\s+){0,3}$"#) ||
                matches(suffix, #"^\s*(?:(?:으로|로|은|는|을|를|이|가)\s*)?(?:말고|빼고|쓰지|(?:사용|선택|실행)?하지\s*마|아니라|필요\s*없|원하지|(?:is\s+)?not\s+(?:needed|wanted|required))"#)
        }
        func conditional(_ clause: String, _ span: SettingSpan) -> Bool {
            let ns = clause as NSString
            let prefix = ns.substring(to: span.range.location)
            let suffix = ns.substring(from: NSMaxRange(span.range))
            return matches(prefix, #"\b(?:if|unless)\b|만약|(?:하면|라면|일\s*경우)|\b(?:would|could)\b(?!\s+(?:you\b|like\s+you\s+to\b))"#) ||
                matches(suffix, #"^\s+(?:if|unless)\b"#)
        }
        func informational(_ clause: String, _ span: SettingSpan) -> Bool {
            let ns = clause as NSString
            let prefix = ns.substring(to: span.range.location)
            let suffix = ns.substring(from: NSMaxRange(span.range))
            let own = ns.substring(with: span.range)
            // An explicit postposed control is a separate owner span.
            if matches(prefix, #"[,;]\s*$|\b(?:and|but|then)\s*$"#) { return false }
            if matches(suffix, #"^\s*(?:지원해|설정이|사용법|쓰는\s*법|실행하는\s*(?:법|방법))"#) { return true }
            let aboutPrefix = matches(prefix, #"^\s*(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:explain|describe|compare|summarize|tell\s+me|what|which|why|how|does|supports?)\b"#)
            guard aboutPrefix else { return false }
            // Instrumental execution is not the object being explained:
            // "explain this using X" vs "explain how to use X".
            if span.kind == "target" && matches(own, #"^\s*(?:using|via)\b"#) {
                return matches(prefix, #"\b(?:how|why|what|whether|means?|meaning|is|are|was|were|been)\s*(?:to\s*)?$"#)
            }
            return true
        }
        var surfaces = Set<String>(), models = Set<String>(), families = Set<String>(), efforts = Set<String>()
        var ceiling = false
        let sentences = body.replacingOccurrences(of: #"\.(?=\s|$)"#, with: "\n", options: .regularExpression)
        let clauses = sentences.components(separatedBy: CharacterSet(charactersIn: "\n;!?。"))
        for clause in clauses where !clause.trimmingCharacters(in: .whitespaces).isEmpty {
            let ns = clause as NSString
            let routes = routeSpans(clause).filter { !taskArgument($0.range) && !informational(clause, $0) }
            var settings = routes
            let familyToken = "(?:" + familyWords.map { "(?:" + $0.pattern + ")" }.joined(separator: "|") + ")"
            let tuple = familyToken + #"(?:\s+[0-9]+(?:\.[0-9]+)*)?\s+"# + effortValue
            settings += spans(clause, #"^\s*("# + tuple + ")" + end, kind: "tuple") +
                spans(clause, #"\b(?:use|using)\s+(?:the\s+)?("# + tuple + ")" + end, kind: "tuple")
            // Assignments have their own syntax, but an assignment mentioned
            // after "to fix/explain ..." is part of that task, not another knob.
            let assignments = spans(clause, #"(?:model|모델)\s*[:=]\s*([^\s,;!?。]*)"#, kind: "model") +
                spans(clause, #"(?:reasoning|effort|리즈닝|추론)\s*[:=]\s*([^\s,;!?。]*)"#, kind: "effort")
            func taskArgument(_ range: NSRange) -> Bool {
                let prefix = ns.substring(to: range.location)
                if matches(prefix, #"\b(?:and|but|then)\s*$"#) { return false }
                return matches(prefix, #"\b(?:to|for)\s+(?:fix|explain|compare|describe|review|debug|analyze|analyse|test|check|implement|write|summarize)\b[^;.!?\n]*$"#)
            }
            settings += assignments.filter { !taskArgument($0.range) && !informational(clause, $0) }
            // Legacy standalone tuple/effort syntax remains supported, but is
            // parsed only in an owned fragment, never across task prose.
            let effortForms = [
                #"\b(?:use|using|with|at|run)\s+(?:the\s+)?("# + effortToken + #")(?:\s+(?:mode|level))?"# + end,
                #"^\s*("# + effortToken + #")(?:\s+(?:mode|level))?"# + end,
                "(" + effortToken + #")\s*(?:으로|로)(?=\s|$|해|실행|돌려)"#,
                #"(?<![a-z])(x[\s-]?high)(?![a-z])"#,
            ].flatMap { spans(clause, $0, kind: "effort_phrase") }.filter { !taskArgument($0.range) && !informational(clause, $0) }
            settings += effortForms
            settings += (spans(clause, #"(최대로)\s*(?:실행|돌려)"#, kind: "ceiling") +
                spans(clause, #"\b(?:use|run|execute)\s+(?:the\s+)?((?:strongest|best|top|flagship)\s+model)\b"#, kind: "superlative"))
                .filter { !taskArgument($0.range) && !informational(clause, $0) }
            settings = settings.filter { !taskArgument($0.range) && !informational(clause, $0) }
            // Bare exclusions/conditionals are not silently erased: the v2
            // wire has no exclusion/conditional routing representation.
            let mentions = spans(clause, "(" + targetToken + #")(?:\s+[0-9]+(?:\.[0-9]+)*)?(?:\s+(?:cli|app|model))?"# + end, kind: "target") +
                spans(clause, "(" + effortToken + #")(?:\s+(?:mode|level))?"# + end, kind: "effort_phrase")
            // Conditional mentions without a directive do not grant a pin;
            // actual negative setting mentions remain unsupported exclusions.
            if (settings + mentions.filter { !taskArgument($0.range) && !informational(clause, $0) }).contains(where: { candidate in
                negative(clause, candidate) || settings.contains(where: {
                    $0.range == candidate.range && $0.kind == candidate.kind
                }) && conditional(clause, candidate)
            }) { result.state = "unresolved"; continue }
            for setting in routes {
                let token = setting.value
                if matches(token, #"^(?:codex|코덱스)$"#) { surfaces.insert("codex") }
                else if matches(token, #"^(?:claude(?:\s+code)?|클로드(?:\s*코드)?|클라우드\s*코드)$"#) {
                    surfaces.insert("claude"); surfaces.insert("claude-chat")
                } else if matches(token, #"^(?:chatgpt|챗\s*지?피티|gpt\s*chat|채찌피티)$"#) { result.state = "unresolved" }
            }
            let quality = matches(clause, #"결과|출력|품질|\b(result|output|quality|parity)\b"#) &&
                matches(clause, #"수준|동등|이상|같거나|똑같|최고|최상|최대|맥스|\b(match|equal|same|equivalent|highest|top|max|maximum|ultra|flagship|quality\s*target)\b"#)
            if quality {
                result.qualityTarget = "current_host_reference"
                // A quality descriptor cannot swallow an independently
                // owned execution setting. Reference words in the task body
                // produced no setting span and therefore create no conflict.
                let executionConstraint = settings.contains { setting in
                    setting.kind != "target" || !matches(setting.value, "^(?:" + providerToken + ")$")
                }
                if executionConstraint { result.state = "unresolved" }
                continue
            }
            for setting in settings {
                switch setting.kind {
                case "target":
                    if matches(setting.value, "^(?:" + providerToken + ")$") { continue }
                    if matches(setting.value, #"^(?:gpt|claude)-"#) {
                        if let actual = knownModelIDs.first(where: { $0.lowercased() == setting.value }) { models.insert(actual) }
                        else { result.state = "unresolved" }
                    } else if let family = familyWords.first(where: { matches(setting.value, "^(?:" + $0.pattern + ")$") })?.family {
                        families.insert(family)
                    }
                case "ceiling": ceiling = true
                case "superlative": result.state = "unresolved"
                case "tuple":
                    let intent = parse(setting.value)
                    if let family = intent.modelFamily { families.insert(family) }
                    if let effort = intent.effort { efforts.insert(effort) }
                case "model":
                    if let actual = knownModelIDs.first(where: { $0.lowercased() == setting.value }) { models.insert(actual) }
                    else { result.state = "unresolved" }
                case "effort":
                    if RCCRuntimeContract.Effort(rawValue: setting.value) != nil { efforts.insert(setting.value) }
                    else { result.state = "unresolved" }
                default:
                    // Generic maximum is the native ceiling in either word
                    // order. A literal `reasoning: max` is handled separately.
                    if matches(setting.value, #"(?:최대|\bmax(?:imum)?|\bhighest)\s*(?:추론|리즈닝|reasoning|effort|thinking)|(?:추론|리즈닝|reasoning|effort|thinking)\s*(?:최대|max(?:imum)?\b|highest\b)"#) { ceiling = true }
                    else if let effort = parse("use " + setting.value).effort { efforts.insert(effort) }
                }
            }
        }
        // A multi-provider instruction is not silently read as an intersection
        // or as a parallel plan. This migration covers ordinary one-route Auto.
        if surfaces.contains("codex") && surfaces.contains("claude") { result.state = "unresolved" }
        if models.count > 1 || families.count > 1 || efforts.count > 1 ||
            (!models.isEmpty && !families.isEmpty) || (ceiling && !efforts.isEmpty) { result.state = "unresolved" }
        result.allowedSurfaces = surfaces.sorted()
        result.exactModel = models.count == 1 ? models.first : nil
        result.modelFamily = families.count == 1 ? families.first : nil
        result.effort = efforts.count == 1 ? efforts.first : nil
        result.requireNativeCeiling = ceiling
        return result
    }
}
