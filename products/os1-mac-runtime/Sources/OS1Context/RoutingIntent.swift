import Foundation

/// Explicit model-family and reasoning-effort words in the OWNER's own request
/// text, never conversation history or a model-authored plan.
///
/// A word counts only beside a context that makes it a routing constraint:
/// a reasoning/effort word ("최대 리즈닝", "reasoning: high"), a model family
/// ("opus max", "gpt-6-sol", "fable 5.1") or, for Ultra, a Korean directive
/// particle ("울트라로"). "max file size", "높은 건물", "솔직히" and "solo" are
/// not constraints. Two different efforts or two different families cancel
/// each other instead of being guessed between, and a negated mention
/// ("opus 말고", "not max reasoning") is ignored.
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
    /// "claude opus", "model fable", "use luna").
    static let familyLeftContext = #"(?:gpt|claude|클로드|codex|코덱스|model|모델|use|using|with|run|on)[\s\-:./]*(?:[0-9]+(?:[.\-][0-9]+)*[\s\-./]*)?$"#
    /// Directive particles: "오퍼스로 돌려", "luna한테 시켜".
    static let directive = #"^\s*(?:으로|로|한테|에게)\s*(?:돌려|해|실행|써|사용|시켜|보내|맡겨|부탁|run)"#
    static let negationAfter = #"^[\s,:=]*(?:(?:으로|로|의|은|는|을|를)\s*)?(?:(?:리즈닝|추론|reasoning|effort|thinking|모델|model)\s*)?(?:(?:으로|로|은|는|을|를)\s*)?(?:말고|빼고|쓰지\s*마|하지\s*마|없이|금지|아니(?:고|라)|is\s+not|isn'?t)"#
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
            matches(after(range, 24), negationAfter) || matches(before(range, 24), negationBefore)
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
            if followedByContext || precededByContext || precededByFamily || standalone {
                effortIntents.insert(effort)
            }
        }

        var familyIntents = Set<String>()
        for (family, range) in families where !negated(range) {
            let left = matches(before(range, 24), familyLeftContext)
            let next = after(range, 24)
            let version = matches(next, #"^[\s\-]*[0-9]+(?:[.\-][0-9]+)*(?![0-9])"#)
            let modelWord = matches(next, #"^\s*(?:model|모델)"#)
            let withEffort = efforts.contains { effort in
                let end = range.location + range.length
                guard effort.range.location >= end else { return false }
                let gap = ns.substring(with: NSRange(location: end, length: effort.range.location - end))
                return matches(gap, #"^[\s\-/,]*(?:[0-9]+(?:[.\-][0-9]+)*[\s\-/,]*)?(?:모델\s*)?(?:으로|로)?\s*$"#)
            }
            // "솔로" is also "solo": the bare Korean particle never qualifies Sol.
            let particle = family != "sol" && matches(next, directive)
            if left || version || modelWord || withEffort || particle { familyIntents.insert(family) }
        }
        return RoutingIntent(effort: effortIntents.count == 1 ? effortIntents.first : nil,
                             modelFamily: familyIntents.count == 1 ? familyIntents.first : nil)
    }
}
