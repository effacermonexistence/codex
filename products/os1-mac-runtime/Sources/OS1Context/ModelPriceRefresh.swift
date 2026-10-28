import CryptoKit
import Foundation

/// Build 441 (owner order 2026-10-27): refresh the routed models' list prices
/// once a day from the providers' own pricing pages, so a price change reaches
/// route selection without a new build.
///
/// Two first-party reads per provider must agree exactly before a row is
/// used: the documentation page itself and the Markdown rendition the same
/// site serves at `<page>.md`. OpenAI's page keeps the full standard-tier
/// table only in its Astro island props, which are positional
/// `[model, input, cached input, 30m write, output]`; the Markdown read is
/// labelled, so their agreement also proves the positional reading.
///
/// Nothing is guessed. A missing model, an unrecognised page, a disagreement
/// between the two reads, or a change outside ×0.2–×5 of the table in use
/// refuses the whole refresh: the last good table stays, and the receipt
/// records why. `ModelPriceTable.current` already falls back to the compiled
/// table when the refreshed one is missing, invalid or older than 72 h.
public enum ModelPriceRefresh {
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    /// At most one refresh attempt per day, refused or not.
    public static let minimumInterval: TimeInterval = 24 * 3600
    public static let lowestRatio = 0.2
    public static let highestRatio = 5.0
    /// The Anthropic page is about 1.3 MB of HTML today.
    static let maximumBytes = 4_000_000

    public enum Read: String, Codable, CaseIterable, Sendable { case page, markdown }

    public struct Source: Hashable, Sendable {
        public let provider: String
        public let read: Read
        public let url: URL
    }

    public static let openAIPage = URL(string: "https://developers.openai.com/api/docs/pricing")!
    public static let anthropicPage = URL(string: "https://platform.claude.com/docs/en/about-claude/pricing")!
    public static let sources: [Source] = [
        Source(provider: "openai", read: .page, url: openAIPage),
        Source(provider: "openai", read: .markdown, url: URL(string: openAIPage.absoluteString + ".md")!),
        Source(provider: "anthropic", read: .page, url: anthropicPage),
        Source(provider: "anthropic", read: .markdown, url: URL(string: anthropicPage.absoluteString + ".md")!),
    ]

    /// Anthropic's table names models for people; these are the exact names
    /// of the compiled models. OpenAI's table names them by model ID.
    static let anthropicDisplayNames: [String: String] = [
        "claude-fable-5-1": "Claude Fable 5.1",
        "claude-opus-5-5": "Claude Opus 5.5",
        "claude-sonnet-5-5": "Claude Sonnet 5.5",
        "claude-haiku-5-5": "Claude Haiku 5.5",
        "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
    ]

    public struct Prices: Equatable, Sendable {
        public var input: Double
        public var cachedInput: Double
        public var cacheWrite: Double
        public var output: Double
        public init(input: Double, cachedInput: Double, cacheWrite: Double, output: Double) {
            self.input = input; self.cachedInput = cachedInput; self.cacheWrite = cacheWrite; self.output = output
        }
        init(_ price: ModelPriceTable.Price) {
            self.init(input: price.input, cachedInput: price.cachedInput, cacheWrite: price.cacheWrite, output: price.output)
        }
        var fields: [(String, Double)] {
            [("input", input), ("cached_input", cachedInput), ("cache_write", cacheWrite), ("output", output)]
        }
    }

    /// One read of one page: every priced row it names, plus the names whose
    /// rows could not be read unambiguously.
    public struct Extraction: Equatable, Sendable {
        public var rows: [String: Prices] = [:]
        public var ambiguous: Set<String> = []
        public var incomplete: Set<String> = []
        /// The expected table or island was found at all.
        public var recognized = false
        public init() {}
    }

    public struct Fetched: Codable, Equatable, Sendable {
        public let provider: String
        public let read: String
        public let url: String
        public let httpStatus: Int?
        public let bytes: Int
        public let sha256: String?
        /// Why no document was taken from this source, if none was.
        public let failure: String?
        enum CodingKeys: String, CodingKey { case provider, read, url, bytes, sha256, failure, httpStatus = "http_status" }
    }

    public struct Change: Codable, Equatable, Sendable {
        public let model: String
        public let field: String
        public let old: Double
        public let new: Double
    }

    public struct Refusal: Codable, Equatable, Sendable {
        public let code: String
        public let model: String?
        public let detail: String
    }

    public struct Receipt: Codable, Equatable, Sendable {
        public var schema = 1
        public var fetchedAt: String
        public var dryRun: Bool
        /// `written`, `dry_run_ok` or `refused`.
        public var outcome: String
        /// The table the ×0.2–×5 band was measured against: `refreshed` or `compiled`.
        public var reference: String
        public var sources: [Fetched]
        public var changedRows: [Change]
        public var refusals: [Refusal]
        public var tablePath: String?
        public var tableSHA256: String?
        enum CodingKeys: String, CodingKey {
            case schema, outcome, reference, sources, refusals
            case fetchedAt = "fetched_at", dryRun = "dry_run", changedRows = "changed_rows"
            case tablePath = "table_path", tableSHA256 = "table_sha256"
        }
    }

    public struct Report: Sendable {
        public let receipt: Receipt
        /// The validated candidate, present only when nothing was refused.
        public let table: ModelPriceTable?
    }

    public static func receiptPath(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        ModelPriceTable.refreshedPath(home: home).deletingLastPathComponent().appendingPathComponent("refresh-receipt.json")
    }

    // MARK: - Scheduling

    /// The last attempt's receipt, if it is a small regular file that decodes.
    public static func lastReceipt(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> Receipt? {
        let url = receiptPath(home: home)
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              (attributes[.type] as? FileAttributeType) == .typeRegular,
              ((attributes[.size] as? NSNumber)?.intValue ?? .max) <= 262_144,
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Receipt.self, from: data)
    }

    /// Due when no attempt is on record, the last one is at least a day old,
    /// or its time lies in the future (the clock moved back).
    public static func isDue(home: URL = FileManager.default.homeDirectoryForCurrentUser, now: Date = Date()) -> Bool {
        guard let receipt = lastReceipt(home: home), let fetched = timestamp(receipt.fetchedAt) else { return true }
        let age = now.timeIntervalSince(fetched)
        return age >= minimumInterval || age < -300
    }

    /// The App's gate: never while work runs, never twice a day in one process
    /// (even when the receipt could not be written), and only when due.
    public static func shouldStartScheduled(home: URL = FileManager.default.homeDirectoryForCurrentUser, now: Date = Date(),
                                            busy: Bool, lastAttemptInProcess: Date?) -> Bool {
        guard !busy else { return false }
        if let last = lastAttemptInProcess, now >= last, now.timeIntervalSince(last) < minimumInterval { return false }
        return isDue(home: home, now: now)
    }

    // MARK: - Refresh

    /// The outcome of a scheduled refresh whose host turned busy during the
    /// fetch: nothing written, no receipt, so the refresh stays due.
    public static let deferredOutcome = "deferred_busy"

    /// Build 441 review: `mayWrite` is the host's busy gate asked again just
    /// before the table is written; a host that turned busy during the fetch
    /// (a run started) gets `deferredOutcome`: no table, no receipt.
    public static func run(home: URL = FileManager.default.homeDirectoryForCurrentUser, now: Date = Date(),
                           dryRun: Bool, transport: Transport? = nil,
                           mayWrite: @Sendable () async -> Bool = { true }) async -> Report {
        let transport = transport ?? publicTransport
        let fetched = await withTaskGroup(of: (Source, FetchOutcome).self) { group in
            for source in sources { group.addTask { (source, await fetch(source, transport: transport)) } }
            var results: [Source: FetchOutcome] = [:]
            for await (source, outcome) in group { results[source] = outcome }
            return results
        }
        var documents: [Source: Data] = [:]
        var receiptSources: [Fetched] = []
        for source in sources {
            let outcome = fetched[source] ?? FetchOutcome(data: nil, status: nil, failure: "not fetched")
            receiptSources.append(Fetched(provider: source.provider, read: source.read.rawValue, url: source.url.absoluteString,
                                          httpStatus: outcome.status, bytes: outcome.data?.count ?? 0,
                                          sha256: outcome.data.map(sha256), failure: outcome.failure))
            if let data = outcome.data { documents[source] = data }
        }
        let current = ModelPriceTable.current(home: home, now: now)
        let evaluation = evaluate(documents: documents, reference: current.table, now: now)
        let refusals = evaluation.refusals
        var receipt = Receipt(fetchedAt: isoTimestamp(now), dryRun: dryRun, outcome: "refused",
                              reference: current.refreshed ? "refreshed" : "compiled", sources: receiptSources,
                              changedRows: evaluation.changes, refusals: refusals, tablePath: nil, tableSHA256: nil)
        var accepted: ModelPriceTable?
        if refusals.isEmpty, let table = evaluation.table, let bytes = try? encode(table) {
            receipt.tableSHA256 = sha256(bytes)
            if dryRun {
                receipt.outcome = "dry_run_ok"; accepted = table
            } else if !(await mayWrite()) {
                receipt.outcome = deferredOutcome; receipt.tableSHA256 = nil
                return Report(receipt: receipt, table: nil)
            } else {
                do {
                    try writePrivate(bytes, to: ModelPriceTable.refreshedPath(home: home))
                    receipt.outcome = "written"; receipt.tablePath = ModelPriceTable.refreshedPath(home: home).path
                    accepted = table
                } catch {
                    receipt.refusals.append(Refusal(code: "write_failed", model: nil, detail: "\(error)"))
                    receipt.tableSHA256 = nil
                }
            }
        }
        if !dryRun, let bytes = try? encodeReceipt(receipt) {
            try? writePrivate(bytes, to: receiptPath(home: home))
        }
        return Report(receipt: receipt, table: accepted)
    }

    /// Pure decision over already fetched documents: the candidate table, the
    /// rows that differ from `reference`, and every reason to refuse it.
    public static func evaluate(documents: [Source: Data], reference: ModelPriceTable,
                                now: Date) -> (table: ModelPriceTable?, changes: [Change], refusals: [Refusal]) {
        let compiled = ModelPriceTable.compiled
        var extractions: [Source: Extraction] = [:]
        var refusals: [Refusal] = []
        for source in sources {
            guard let data = documents[source] else {
                refusals.append(Refusal(code: "source_unavailable", model: nil,
                                        detail: "\(source.provider) \(source.read.rawValue): \(source.url.absoluteString) was not read"))
                continue
            }
            let extraction: Extraction
            switch (source.provider, source.read) {
            case ("openai", .page): extraction = parseOpenAIPage(data)
            case ("openai", .markdown): extraction = parseOpenAIMarkdown(data)
            case ("anthropic", .page): extraction = parseAnthropicPage(data)
            default: extraction = parseAnthropicMarkdown(data)
            }
            if extraction.recognized { extractions[source] = extraction } else {
                refusals.append(Refusal(code: "format_unrecognized", model: nil,
                                        detail: "\(source.provider) \(source.read.rawValue): the price table was not found"))
            }
        }
        var models: [String: ModelPriceTable.Price] = [:]
        var changes: [Change] = []
        for (id, compiledRow) in compiled.models.sorted(by: { $0.key < $1.key }) {
            let provider = compiledRow.provider
            guard let name = provider == "openai" ? id : anthropicDisplayNames[id],
                  let page = sources.first(where: { $0.provider == provider && $0.read == .page }) else {
                refusals.append(Refusal(code: "unmapped_model", model: id, detail: "no page name is known for this model"))
                continue
            }
            var reads: [Read: Prices] = [:]
            for read in Read.allCases {
                guard let source = sources.first(where: { $0.provider == provider && $0.read == read }),
                      let extraction = extractions[source] else { continue } // the source itself is refused above
                if extraction.ambiguous.contains(name) {
                    refusals.append(Refusal(code: "ambiguous_rows", model: id, detail: "\(read.rawValue): \(name) has conflicting rows"))
                } else if extraction.incomplete.contains(name) {
                    refusals.append(Refusal(code: "incomplete_row", model: id, detail: "\(read.rawValue): \(name) lacks a price"))
                } else if let row = extraction.rows[name] {
                    reads[read] = row
                } else {
                    refusals.append(Refusal(code: "missing_model", model: id, detail: "\(read.rawValue): \(name) is not on the page"))
                }
            }
            guard let fromPage = reads[.page], let fromMarkdown = reads[.markdown] else { continue }
            guard fromPage == fromMarkdown else {
                refusals.append(Refusal(code: "sources_disagree", model: id,
                                        detail: "page \(describe(fromPage)) != markdown \(describe(fromMarkdown))"))
                continue
            }
            let old = Prices(reference.models[id] ?? compiledRow)
            for ((field, previous), (_, value)) in zip(old.fields, fromPage.fields) where previous != value {
                changes.append(Change(model: id, field: field, old: previous, new: value))
                let ratio = value / previous
                if !(ratio >= lowestRatio && ratio <= highestRatio) {
                    refusals.append(Refusal(code: "implausible_change", model: id,
                                            detail: "\(field) \(previous) -> \(value) is outside x\(lowestRatio)-x\(highestRatio)"))
                }
            }
            models[id] = ModelPriceTable.Price(provider: provider, input: fromPage.input, cachedInput: fromPage.cachedInput,
                                               cacheWrite: fromPage.cacheWrite, output: fromPage.output,
                                               source: page.url.absoluteString)
        }
        guard refusals.isEmpty, models.count == compiled.models.count else { return (nil, changes, refusals) }
        let candidate = ModelPriceTable(schema: 1, retrievedOn: isoDay(now), currency: "USD", unit: "per_1m_tokens",
                                        basis: compiled.basis, cacheWriteNote: compiled.cacheWriteNote, models: models)
        guard let bytes = try? encode(candidate), let validated = try? ModelPriceTable.decode(bytes), validated == candidate else {
            return (nil, changes, [Refusal(code: "validation_failed", model: nil,
                                           detail: "the candidate table failed ModelPriceTable.decode")])
        }
        return (validated, changes, [])
    }

    // MARK: - Page readers

    /// OpenAI page: the `TextTokenPricingTables` Astro islands of the
    /// standard tier (the flagship table and model-group tables such as
    /// cyber). Each row is `[model, input, cached input, 30m write, output]`.
    public static func parseOpenAIPage(_ data: Data) -> Extraction {
        var collector = Collector()
        guard let html = String(data: data, encoding: .utf8) else { return collector.extraction }
        for tag in captures(#"<astro-island\b[^>]*>"#, in: html) {
            guard let tag = tag.first ?? nil, tag.contains(#"component-export="TextTokenPricingTables""#),
                  let raw = captures(#"\sprops="([^"]*)""#, in: tag).first?[1],
                  let json = try? JSONSerialization.jsonObject(with: Data(decodeEntities(raw).utf8)) as? [String: Any],
                  (json["tier"].flatMap(astro) as? String) == "standard",
                  let rows = json["rows"].flatMap(astro) as? [Any] else { continue }
            collector.extraction.recognized = true
            for case let row as [Any] in rows {
                guard let label = row.first as? String else { continue }
                let numbers = row.dropFirst().map(number)
                let prices = numbers.count == 4 && numbers.allSatisfy({ $0 != nil })
                    ? Prices(input: numbers[0]!, cachedInput: numbers[1]!, cacheWrite: numbers[2]!, output: numbers[3]!) : nil
                collector.add(name: modelName(label), context: label, prices: prices)
            }
        }
        return collector.extraction
    }

    /// OpenAI Markdown: the tables under a "Standard pricing data" heading,
    /// read by their column labels (short-context prices).
    public static func parseOpenAIMarkdown(_ data: Data) -> Extraction {
        markdownExtraction(data, heading: "standard pricing data", labels: [
            "model", "short context input", "short context cached input", "short context 30m write", "short context output",
        ])
    }

    /// Anthropic page: the base price table, read by its column labels. A
    /// model with several rows (Haiku 5.5 by prompt length) uses the row for
    /// prompts "up to" the threshold.
    public static func parseAnthropicPage(_ data: Data) -> Extraction {
        var collector = Collector()
        guard let html = String(data: data, encoding: .utf8) else { return collector.extraction }
        let wanted = ["name", "input", "hits and refreshes", "5m writes", "output"]
        for table in captures(#"<table\b[^>]*>([\s\S]*?)</table>"#, in: html) {
            guard let body = table[1], let head = captures(#"<thead\b[^>]*>([\s\S]*?)</thead>"#, in: body).first?[1],
                  let labelRow = captures(#"<tr\b[^>]*>([\s\S]*?)</tr>"#, in: head).last?[1] else { continue }
            let labels = captures(#"<th\b[^>]*>([\s\S]*?)</th>"#, in: labelRow).map { label(plainLines($0[1] ?? "").joined(separator: " ")) }
            let indices = wanted.compactMap { name in labels.firstIndex(of: name) }
            guard indices.count == wanted.count, Set(labels).count == labels.count, indices[0] == 0 else { continue }
            collector.extraction.recognized = true
            let rest = body.components(separatedBy: "</thead>").dropFirst().joined(separator: "</thead>")
            var current: (name: String, remaining: Int)?
            for row in captures(#"<tr\b[^>]*>([\s\S]*?)</tr>"#, in: rest) {
                let cells = captures(#"(<td\b[^>]*>)([\s\S]*?)</td>"#, in: row[1] ?? "")
                let context = plainLines(row[1] ?? "").joined(separator: " ")
                var name: String, shift: Int
                if cells.count == labels.count, let first = plainLines(cells[0][2] ?? "").first {
                    name = first; shift = 0
                    let span = captures(#"rowSpan="([0-9]+)""#, in: cells[0][1] ?? "").first?[1].flatMap { Int($0) } ?? 1
                    current = span > 1 ? (first, span - 1) : nil
                } else if cells.count == labels.count - 1, let held = current, held.remaining > 0 {
                    name = held.name; shift = 1
                    current = held.remaining > 1 ? (held.name, held.remaining - 1) : nil
                } else { current = nil; continue }
                let values = indices.dropFirst().map { cellPrice(plainLines(cells[$0 - shift][2] ?? "").joined(separator: " ")) }
                let prices = values.allSatisfy({ $0 != nil })
                    ? Prices(input: values[0]!, cachedInput: values[1]!, cacheWrite: values[2]!, output: values[3]!) : nil
                collector.add(name: name, context: context, prices: prices)
            }
        }
        return collector.extraction
    }

    /// Anthropic Markdown: the model pricing table, read by its column labels.
    public static func parseAnthropicMarkdown(_ data: Data) -> Extraction {
        markdownExtraction(data, heading: nil, labels: [
            "model", "base input tokens", "cache hits and refreshes", "5m cache writes", "output tokens",
        ])
    }

    // MARK: - Reading helpers

    /// Several rows for one name must agree; prompt-length variants resolve
    /// to the "up to" row. Anything else is ambiguous, never picked.
    struct Collector {
        var extraction = Extraction()
        private var candidates: [String: [(context: String, prices: Prices?)]] = [:]
        mutating func add(name: String, context: String, prices: Prices?) {
            guard !name.isEmpty else { return }
            candidates[name, default: []].append((context, prices))
            var pool = candidates[name]!
            if pool.count > 1 {
                let upTo = pool.filter { $0.context.range(of: #"(?i)\bup to\b"#, options: .regularExpression) != nil }
                if !upTo.isEmpty { pool = upTo }
            }
            extraction.rows[name] = nil; extraction.ambiguous.remove(name); extraction.incomplete.remove(name)
            let distinct = pool.reduce(into: [Prices?]()) { seen, item in if !seen.contains(item.prices) { seen.append(item.prices) } }
            if distinct.count > 1 { extraction.ambiguous.insert(name) }
            else if let prices = distinct.first ?? nil { extraction.rows[name] = prices }
            else { extraction.incomplete.insert(name) }
        }
    }

    static func markdownExtraction(_ data: Data, heading wantedHeading: String?, labels wanted: [String]) -> Extraction {
        var collector = Collector()
        guard let text = String(data: data, encoding: .utf8) else { return collector.extraction }
        let lines = text.components(separatedBy: "\n")
        var heading: String?
        var index = 0
        while index < lines.count {
            let line = lines[index].trimmingCharacters(in: .whitespaces)
            if let title = captures(#"^#{1,6}\s+(.+)$"#, in: line).first?[1] { heading = label(title) }
            let separator = index + 1 < lines.count ? markdownCells(lines[index + 1]) : []
            guard line.hasPrefix("|"), !separator.isEmpty,
                  separator.allSatisfy({ $0.range(of: #"^:?-{3,}:?$"#, options: .regularExpression) != nil }) else {
                index += 1; continue
            }
            let labels = markdownCells(line).map(label)
            var rowIndex = index + 2
            defer { index = rowIndex }
            let indices = wanted.compactMap { labels.firstIndex(of: $0) }
            guard wantedHeading == nil || heading == wantedHeading, indices.count == wanted.count,
                  Set(labels).count == labels.count else {
                while rowIndex < lines.count, lines[rowIndex].trimmingCharacters(in: .whitespaces).hasPrefix("|") { rowIndex += 1 }
                continue
            }
            collector.extraction.recognized = true
            while rowIndex < lines.count, lines[rowIndex].trimmingCharacters(in: .whitespaces).hasPrefix("|") {
                let cells = markdownCells(lines[rowIndex])
                rowIndex += 1
                guard cells.count == labels.count else { continue }
                let values = indices.dropFirst().map { cellPrice(cells[$0]) }
                let prices = values.allSatisfy({ $0 != nil })
                    ? Prices(input: values[0]!, cachedInput: values[1]!, cacheWrite: values[2]!, output: values[3]!) : nil
                collector.add(name: modelName(cells[indices[0]]), context: cells.joined(separator: " | "), prices: prices)
            }
        }
        return collector.extraction
    }

    static func markdownCells(_ line: String) -> [String] {
        var body = line.trimmingCharacters(in: .whitespaces)
        guard body.hasPrefix("|") else { return [] }
        body.removeFirst()
        if body.hasSuffix("|") && !body.hasSuffix(#"\|"#) { body.removeLast() }
        var cells: [String] = [], cell = "", escaped = false
        for character in body {
            if escaped { cell.append(character); escaped = false }
            else if character == "\\" { escaped = true; cell.append(character) }
            else if character == "|" { cells.append(cell); cell = "" }
            else { cell.append(character) }
        }
        cells.append(cell)
        return cells.map { $0.trimmingCharacters(in: .whitespaces) }
    }

    /// "Claude Opus 4.1 ([retired …](…))" and "gpt-5.5 (<272K context length)"
    /// name "Claude Opus 4.1" and "gpt-5.5"; the qualifier stays in the context.
    static func modelName(_ cell: String) -> String {
        var text = decodeEntities(cell).replacingOccurrences(of: #"<[^>]*>"#, with: "", options: .regularExpression)
        if let linked = captures(#"^\[([^\]]+)\]\([^)]*\)"#, in: text).first?[1] { text = linked }
        return (text.components(separatedBy: " (").first ?? text).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func label(_ text: String) -> String {
        text.replacingOccurrences(of: "*", with: "").lowercased()
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
    }

    /// The first dollar amount in a cell ("$0.25 / MTok<sup>1</sup>",
    /// "$0.10 / MTok for prompts up to 100,000 tokens"); "-" has none.
    static func cellPrice(_ text: String) -> Double? {
        guard let raw = captures(#"\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)"#, in: text).first?[1] else { return nil }
        return Double(raw.replacingOccurrences(of: ",", with: ""))
    }

    static func plainLines(_ html: String) -> [String] {
        decodeEntities(html.replacingOccurrences(of: #"<[^>]*>"#, with: "\n", options: .regularExpression))
            .replacingOccurrences(of: "\u{00A0}", with: " ")
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    static func decodeEntities(_ text: String) -> String {
        guard text.contains("&"), let regex = try? NSRegularExpression(pattern: #"&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});"#) else {
            return text
        }
        let named = ["amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": "\u{00A0}"]
        var output = "", cursor = text.startIndex
        for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            guard let whole = Range(match.range, in: text), let nameRange = Range(match.range(at: 1), in: text) else { continue }
            output += text[cursor..<whole.lowerBound]
            let name = String(text[nameRange])
            var replacement: String?
            if name.hasPrefix("#x") || name.hasPrefix("#X") {
                replacement = UInt32(name.dropFirst(2), radix: 16).flatMap(Unicode.Scalar.init).map { String(Character($0)) }
            } else if name.hasPrefix("#") {
                replacement = UInt32(name.dropFirst()).flatMap(Unicode.Scalar.init).map { String(Character($0)) }
            } else { replacement = named[name] }
            output += replacement ?? String(text[whole])
            cursor = whole.upperBound
        }
        return output + text[cursor...]
    }

    /// Astro serialises island props as `[0, value]` (objects carry wrapped
    /// values) and `[1, [items]]` for arrays; `[0]` is undefined.
    static func astro(_ value: Any) -> Any? {
        guard let pair = value as? [Any], let kind = pair.first as? NSNumber, !isBool(kind) else { return nil }
        switch (kind.intValue, pair.count) {
        case (0, 1): return NSNull()
        case (0, 2):
            guard let object = pair[1] as? [String: Any] else { return pair[1] }
            var decoded: [String: Any] = [:]
            for (key, item) in object { guard let item = astro(item) else { return nil }; decoded[key] = item }
            return decoded
        case (1, 2):
            guard let items = pair[1] as? [Any] else { return nil }
            var decoded: [Any] = []
            for item in items { guard let item = astro(item) else { return nil }; decoded.append(item) }
            return decoded
        default: return nil
        }
    }

    static func number(_ value: Any) -> Double? {
        guard let number = value as? NSNumber, !isBool(number) else { return nil }
        return number.doubleValue
    }

    private static func isBool(_ number: NSNumber) -> Bool { CFGetTypeID(number) == CFBooleanGetTypeID() }

    /// Capture groups of every match; group 0 is the whole match.
    static func captures(_ pattern: String, in text: String) -> [[String?]] {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.anchorsMatchLines]) else { return [] }
        return regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).map { match in
            (0..<match.numberOfRanges).map { Range(match.range(at: $0), in: text).map { String(text[$0]) } }
        }
    }

    // MARK: - Output

    static func encode(_ table: ModelPriceTable) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(table) + Data("\n".utf8)
    }

    public static func encodeReceipt(_ receipt: Receipt) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes, .prettyPrinted]
        return try encoder.encode(receipt) + Data("\n".utf8)
    }

    public enum WriteFailure: Error, Equatable { case unsafePath, ioFailed }

    /// Atomic replacement: a fresh 0600 file in the same 0700 directory is
    /// written, synced and renamed over the target. A symlink or any other
    /// non-regular file at the target is refused, never followed or replaced.
    static func writePrivate(_ data: Data, to url: URL) throws {
        let directory = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        var status = stat()
        guard lstat(directory.path, &status) == 0, status.st_mode & S_IFMT == S_IFDIR, status.st_uid == getuid() else {
            throw WriteFailure.unsafePath
        }
        if lstat(url.path, &status) == 0 {
            guard status.st_mode & S_IFMT == S_IFREG else { throw WriteFailure.unsafePath }
        } else if errno != ENOENT { throw WriteFailure.unsafePath }
        let temporary = directory.appendingPathComponent(".\(url.lastPathComponent).\(UUID().uuidString.lowercased()).tmp")
        let descriptor = open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw WriteFailure.ioFailed }
        var renamed = false
        defer { if !renamed { unlink(temporary.path) } }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        do { try handle.write(contentsOf: data); try handle.synchronize(); try handle.close() }
        catch { try? handle.close(); throw WriteFailure.ioFailed }
        guard rename(temporary.path, url.path) == 0 else { throw WriteFailure.ioFailed }
        renamed = true
        let directoryDescriptor = open(directory.path, O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        if directoryDescriptor >= 0 { _ = fsync(directoryDescriptor); close(directoryDescriptor) }
    }

    // MARK: - Network

    struct FetchOutcome: Sendable {
        let data: Data?
        let status: Int?
        let failure: String?
    }

    static func fetch(_ source: Source, transport: Transport) async -> FetchOutcome {
        var request = URLRequest(url: source.url)
        request.httpMethod = "GET"
        request.timeoutInterval = 20
        request.setValue(source.read == .page ? "text/html" : "text/markdown, text/plain", forHTTPHeaderField: "Accept")
        do {
            let (data, http) = try await transport(request)
            guard http.url?.scheme == "https", http.url?.host?.lowercased() == source.url.host?.lowercased() else {
                return FetchOutcome(data: nil, status: http.statusCode, failure: "left the provider's host")
            }
            guard (200..<300).contains(http.statusCode) else {
                return FetchOutcome(data: nil, status: http.statusCode, failure: "HTTP \(http.statusCode)")
            }
            guard !data.isEmpty, data.count <= maximumBytes else {
                return FetchOutcome(data: nil, status: http.statusCode, failure: "\(data.count) bytes is outside the size bound")
            }
            return FetchOutcome(data: data, status: http.statusCode, failure: nil)
        } catch {
            let error = error as NSError
            return FetchOutcome(data: nil, status: nil, failure: "\(error.domain) \(error.code): \(error.localizedDescription)")
        }
    }

    /// Credential-free, cookie-free, cache-free, same-host redirects only.
    private static func publicTransport(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.timeoutIntervalForResource = 30
        let session = URLSession(configuration: configuration, delegate: FrontierRedirectGuard(host: request.url?.host),
                                 delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard response.expectedContentLength <= Int64(maximumBytes) else { throw URLError(.dataLengthExceedsMaximum) }
        var data = Data()
        for try await byte in bytes {
            guard data.count < maximumBytes else { throw URLError(.dataLengthExceedsMaximum) }
            data.append(byte)
        }
        return (data, http)
    }

    // MARK: - Small utilities

    static func sha256(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

    static func describe(_ prices: Prices) -> String {
        "in \(prices.input) cached \(prices.cachedInput) write \(prices.cacheWrite) out \(prices.output)"
    }

    static func isoTimestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    static func timestamp(_ text: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: text)
    }

    /// `retrieved_on` is the UTC calendar day, matching `fetched_at`.
    static func isoDay(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        return formatter.string(from: date)
    }
}
