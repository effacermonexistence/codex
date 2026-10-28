import CryptoKit
import Foundation

/// Build 441 (owner order 2026-10-27): list prices of the models OS-1 routes,
/// so route selection can compare "a cheaper tier, plus one reference re-run
/// if it fails" against "the reference straight away" in money, not guesses.
///
/// The compiled table was read from the providers' own pricing pages on
/// 2026-10-27 and cross-checked by two independent reads per provider. They
/// are API list prices in USD per 1M tokens (OpenAI Standard tier; Anthropic
/// base rates). They are NOT subscription quota: OpenAI states API prices do
/// not estimate included plan usage, so a price ratio is a relative cost
/// signal, never a quota claim. `Resources/model-price-table.json` is the
/// reviewable copy; a fixture proves the bytes identical.
///
/// A refreshed table (daily, `os1 pricing refresh`) may replace the compiled
/// one only through `current(home:now:)`, which validates it strictly and
/// falls back to the compiled table when it is missing, invalid or stale.
public struct ModelPriceTable: Codable, Equatable, Sendable {
    public struct Price: Codable, Equatable, Sendable {
        public var provider: String
        public var input: Double
        public var cachedInput: Double
        public var cacheWrite: Double
        public var output: Double
        public var source: String
        enum CodingKeys: String, CodingKey {
            case provider, input, output, source, cachedInput = "cached_input", cacheWrite = "cache_write"
        }
    }
    public var schema: Int
    public var retrievedOn: String
    public var currency: String
    public var unit: String
    public var basis: String
    public var cacheWriteNote: String
    public var models: [String: Price]
    enum CodingKeys: String, CodingKey {
        case schema, currency, unit, basis, models, retrievedOn = "retrieved_on", cacheWriteNote = "cache_write_note"
    }

    public static let compiledBytes = Data((#"{"basis":"api_standard_list_price_not_subscription_quota","cache_write_note":"openai cache_write is the 30-minute tier; anthropic cache_write is the 5-minute tier","currency":"USD","models":{"claude-fable-5-1":{"cache_write":12.5,"cached_input":0.25,"input":10,"output":50,"provider":"anthropic","source":"https://platform.claude.com/docs/en/about-claude/pricing"},"claude-haiku-4-5-20251001":{"cache_write":1.25,"cached_input":0.1,"input":1,"output":5,"provider":"anthropic","source":"https://platform.claude.com/docs/en/about-claude/pricing"},"claude-haiku-5-5":{"cache_write":0.125,"cached_input":0.01,"input":0.1,"output":0.5,"provider":"anthropic","source":"https://platform.claude.com/docs/en/about-claude/pricing"},"claude-opus-5-5":{"cache_write":5,"cached_input":0.2,"input":4,"output":20,"provider":"anthropic","source":"https://platform.claude.com/docs/en/about-claude/pricing"},"claude-sonnet-5-5":{"cache_write":2.5,"cached_input":0.1,"input":2,"output":10,"provider":"anthropic","source":"https://platform.claude.com/docs/en/about-claude/pricing"},"gpt-6-astra":{"cache_write":12.5,"cached_input":1,"input":10,"output":50,"provider":"openai","source":"https://developers.openai.com/api/docs/pricing"},"gpt-6-luna":{"cache_write":0.125,"cached_input":0.01,"input":0.1,"output":0.5,"provider":"openai","source":"https://developers.openai.com/api/docs/pricing"},"gpt-6-sol":{"cache_write":2.5,"cached_input":0.2,"input":2,"output":10,"provider":"openai","source":"https://developers.openai.com/api/docs/pricing"},"gpt-6.1-sol":{"cache_write":2.5,"cached_input":0.1,"input":2,"output":10,"provider":"openai","source":"https://developers.openai.com/api/docs/pricing"},"gpt-6.1-terra":{"cache_write":1.25,"cached_input":0.05,"input":1,"output":5,"provider":"openai","source":"https://developers.openai.com/api/docs/pricing"}},"retrieved_on":"2026-10-27","schema":1,"unit":"per_1m_tokens"}"# + "\n").utf8)
    public static let compiledSHA256 = "bb1dfcb77c246b2b67d70f97fd12503c37e883ae1590d4b082a48c81bda296a3"
    /// A refreshed table older than this is not used (the refresh runs daily).
    public static let maximumAge: TimeInterval = 72 * 3600

    public enum Failure: Error, Equatable { case malformed, implausible }

    /// Strict decode: schema 1, USD per 1M tokens, every price finite, positive
    /// and below $1000, cached input not above input, a known provider and an
    /// https source on that provider's own domain.
    public static func decode(_ data: Data) throws -> ModelPriceTable {
        guard data.count <= 65_536, let value = try? JSONDecoder().decode(ModelPriceTable.self, from: data),
              value.schema == 1, value.currency == "USD", value.unit == "per_1m_tokens",
              !value.models.isEmpty, value.models.count <= 64 else { throw Failure.malformed }
        for (name, price) in value.models {
            let numbers = [price.input, price.cachedInput, price.cacheWrite, price.output]
            let domain = price.provider == "openai" ? "https://developers.openai.com/" :
                price.provider == "anthropic" ? "https://platform.claude.com/" : nil
            guard !name.isEmpty, name.count <= 64, let domain, price.source.hasPrefix(domain),
                  numbers.allSatisfy({ $0.isFinite && $0 > 0 && $0 < 1000 }), price.cachedInput <= price.input else {
                throw Failure.implausible
            }
        }
        return value
    }

    /// The compiled table. A byte or pin mismatch is a build defect the
    /// fixture rejects.
    public static var compiled: ModelPriceTable {
        // swiftlint:disable:next force_try
        try! decode(compiledBytes)
    }

    /// Where the daily refresh keeps its validated table.
    public static func refreshedPath(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        home.appendingPathComponent(".os1/pricing/model-price-table.json")
    }

    /// The table route selection uses now: a valid refreshed table no older
    /// than `maximumAge` (by its file date), else the compiled one.
    public static func current(home: URL = FileManager.default.homeDirectoryForCurrentUser,
                               now: Date = Date()) -> (table: ModelPriceTable, refreshed: Bool) {
        let value = currentWithDigest(home: home, now: now)
        return (value.table, value.refreshed)
    }
    /// DESIGN-4 §8 (build 442): the table `current` returns and the SHA-256 of
    /// the bytes it came from (the compiled pin when no refresh is used): the
    /// active price basis a capability route is checked against.
    public static func currentWithDigest(home: URL = FileManager.default.homeDirectoryForCurrentUser,
                                         now: Date = Date()) -> (table: ModelPriceTable, refreshed: Bool, sha256: String) {
        let url = refreshedPath(home: home)
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              (attributes[.type] as? FileAttributeType) == .typeRegular,
              let modified = attributes[.modificationDate] as? Date, now.timeIntervalSince(modified) <= maximumAge,
              now.timeIntervalSince(modified) >= -300,
              let data = try? Data(contentsOf: url), let table = try? decode(data) else { return (compiled, false, compiledSHA256) }
        return (table, true, SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined())
    }

    /// The price of an exact model name. A native context-window suffix
    /// ("claude-fable-5-1[1m]") and the Claude CLI family aliases name the
    /// same model; nothing else is guessed.
    public func price(of model: String) -> Price? {
        let aliases = ["fable": "claude-fable-5-1", "opus": "claude-opus-5-5", "sonnet": "claude-sonnet-5-5",
                       "haiku": "claude-haiku-4-5-20251001", "claude-haiku-4-5": "claude-haiku-4-5-20251001"]
        let base = model.range(of: #"\[[0-9]+[km]\]$"#, options: .regularExpression).map { String(model[..<$0.lowerBound]) } ?? model
        return models[aliases[base] ?? base]
    }

    /// USD for one call of the given shape (uncached input, cache reads,
    /// output). The default shape is the typical OS-1 delegated call the
    /// table was compared on: 30,000 input tokens of which 20,000 are cache
    /// reads, plus 1,500 output tokens.
    public func callUSD(model: String, uncachedInput: Int = 10_000, cachedInput: Int = 20_000,
                        output: Int = 1_500) -> Double? {
        guard let price = price(of: model) else { return nil }
        return (Double(uncachedInput) * price.input + Double(cachedInput) * price.cachedInput +
                Double(output) * price.output) / 1_000_000
    }

    public static func selfTest() throws {
        var failed: [String] = []
        func check(_ value: Bool, _ name: String) { if !value { failed.append(name) } }
        let digest = SHA256.hash(data: compiledBytes).map { String(format: "%02x", $0) }.joined()
        check(digest == compiledSHA256, "compiled bytes match the pin")
        let table = compiled
        check(table.models.count == 10, "ten priced models")
        check(table.price(of: "claude-fable-5-1[1m]") == table.models["claude-fable-5-1"], "context suffix names the model")
        check(table.price(of: "haiku") == table.models["claude-haiku-4-5-20251001"], "CLI alias names the model")
        check(table.price(of: "gpt-6-astra-mini") == nil, "unknown model has no price")
        if let astra = table.callUSD(model: "gpt-6-astra"), let sol = table.callUSD(model: "gpt-6.1-sol"),
           let luna = table.callUSD(model: "gpt-6-luna") {
            check(abs(astra - 0.195) < 1e-9 && abs(sol - 0.037) < 1e-9 && abs(luna - 0.00195) < 1e-9,
                  "typical call: astra $0.195, sol $0.037, luna $0.00195")
        } else { check(false, "typical call prices") }
        var bad = try JSONSerialization.jsonObject(with: compiledBytes) as! [String: Any]
        var models = bad["models"] as! [String: Any]
        var row = models["gpt-6-luna"] as! [String: Any]; row["input"] = 0; models["gpt-6-luna"] = row; bad["models"] = models
        check((try? decode(try JSONSerialization.data(withJSONObject: bad))) == nil, "a zero price is refused")
        row["input"] = 0.1; row["source"] = "https://example.com/pricing"; models["gpt-6-luna"] = row; bad["models"] = models
        check((try? decode(try JSONSerialization.data(withJSONObject: bad))) == nil, "a non-provider source is refused")
        let home = FileManager.default.temporaryDirectory.appendingPathComponent("os1-price-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: home) }
        check(current(home: home).refreshed == false && current(home: home).table == table, "no refresh: compiled")
        try FileManager.default.createDirectory(at: refreshedPath(home: home).deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        try Data("{}".utf8).write(to: refreshedPath(home: home))
        check(current(home: home).refreshed == false, "an invalid refresh falls back to compiled")
        try compiledBytes.write(to: refreshedPath(home: home))
        check(current(home: home).refreshed == true, "a valid fresh refresh is used")
        check(current(home: home, now: Date().addingTimeInterval(maximumAge + 60)).refreshed == false, "a stale refresh is not used")
        if !failed.isEmpty { throw NSError(domain: "ModelPriceTable", code: 1,
            userInfo: [NSLocalizedDescriptionKey: failed.joined(separator: "; ")]) }
    }
}
