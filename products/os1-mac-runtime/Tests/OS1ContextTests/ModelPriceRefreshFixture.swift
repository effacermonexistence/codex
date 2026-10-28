import CryptoKit
import Foundation
import OS1Context

private struct PriceRefreshFixtureFailure: Error, CustomStringConvertible {
    let description: String
}

private final class PriceRefreshFixtureBox<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value
    init(_ value: Value) { self.value = value }
    func set(_ newValue: Value) { lock.lock(); value = newValue; lock.unlock() }
    func get() -> Value { lock.lock(); defer { lock.unlock() }; return value }
}

/// Offline: the providers' pages are served from minimal verbatim excerpts
/// (Tests/Fixtures/model-pricing, provenance and sha256 in SOURCES.json).
func runModelPriceRefreshFixtures() throws {
    let result = PriceRefreshFixtureBox<Result<Int, any Error>?>(nil)
    let semaphore = DispatchSemaphore(value: 0)
    let worker = Task.detached {
        do { result.set(.success(try await modelPriceRefreshChecks())) } catch { result.set(.failure(error)) }
        semaphore.signal()
    }
    guard semaphore.wait(timeout: .now() + 60) == .success, let value = result.get() else {
        worker.cancel(); throw PriceRefreshFixtureFailure(description: "model price refresh fixtures timed out")
    }
    print("Model price refresh: \(try value.get()) checks passed (parsers, two-read agreement, x0.2-x5 band, refusals, atomic 0600 write, schedule)")
}

/// Opt-in network check (`--model-price-refresh-live HOME`): one real
/// refresh of the providers' pages into a throwaway home. Never part of the
/// offline suite.
func runModelPriceRefreshLive(home: URL) throws {
    let result = PriceRefreshFixtureBox<ModelPriceRefresh.Report?>(nil)
    let semaphore = DispatchSemaphore(value: 0)
    Task.detached { result.set(await ModelPriceRefresh.run(home: home, dryRun: false)); semaphore.signal() }
    guard semaphore.wait(timeout: .now() + 90) == .success, let report = result.get() else {
        throw PriceRefreshFixtureFailure(description: "live price refresh timed out")
    }
    print(String(decoding: try ModelPriceRefresh.encodeReceipt(report.receipt), as: UTF8.self), terminator: "")
    let table = ModelPriceTable.refreshedPath(home: home)
    let mode = ((try? FileManager.default.attributesOfItem(atPath: table.path)[.posixPermissions]) as? NSNumber)?.intValue
    guard report.receipt.outcome == "written", mode == 0o600, ModelPriceTable.current(home: home).refreshed else {
        throw PriceRefreshFixtureFailure(description: "live price refresh was not written as a fresh 0600 table")
    }
    print("Live price refresh: written 0600 at \(table.path); routing reads it as the refreshed table")
}

private func priceFixtureSHA256(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

private func modelPriceRefreshChecks() async throws -> Int {
    var count = 0
    func check(_ value: Bool, _ message: String) throws {
        guard value else { throw PriceRefreshFixtureFailure(description: "model price refresh: \(message)") }
        count += 1
    }
    func replaced(_ data: Data, _ old: String, _ new: String) throws -> Data {
        let text = String(decoding: data, as: UTF8.self)
        try check(text.components(separatedBy: old).count == 2, "fixture edit target is unique: \(old)")
        return Data(text.replacingOccurrences(of: old, with: new).utf8)
    }
    let files = FileManager.default
    let fixtureRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Fixtures/model-pricing")

    // Provenance: every excerpt is exactly the recorded bytes.
    let provenance = try JSONSerialization.jsonObject(with: Data(contentsOf: fixtureRoot.appendingPathComponent("SOURCES.json")))
    let excerpts = (provenance as? [String: Any])?["excerpts"] as? [String: [String: Any]] ?? [:]
    var fixtures: [String: Data] = [:]
    for (name, record) in excerpts {
        let data = try Data(contentsOf: fixtureRoot.appendingPathComponent(name))
        try check(priceFixtureSHA256(data) == record["sha256"] as? String && data.count == record["bytes"] as? Int,
                  "\(name) matches its recorded sha256 and size")
        fixtures[name] = data
    }
    try check(fixtures.count == 4, "four excerpts are recorded")
    let openAIPage = fixtures["openai-pricing.excerpt.html"]!, openAIMarkdown = fixtures["openai-pricing.excerpt.md"]!
    let claudePage = fixtures["claude-pricing.excerpt.html"]!, claudeMarkdown = fixtures["claude-pricing.excerpt.md"]!

    let compiled = ModelPriceTable.compiled
    func expected(_ id: String) -> ModelPriceRefresh.Prices {
        let price = compiled.models[id]!
        return .init(input: price.input, cachedInput: price.cachedInput, cacheWrite: price.cacheWrite, output: price.output)
    }
    let openAIModels = compiled.models.filter { $0.value.provider == "openai" }.keys.sorted()
    let claudeNames = ["claude-fable-5-1": "Claude Fable 5.1", "claude-opus-5-5": "Claude Opus 5.5",
                       "claude-sonnet-5-5": "Claude Sonnet 5.5", "claude-haiku-5-5": "Claude Haiku 5.5",
                       "claude-haiku-4-5-20251001": "Claude Haiku 4.5"]
    try check(openAIModels.count == 5 && claudeNames.count == 5 && compiled.models.count == 10, "ten compiled models")

    // Parsers, each read on its own.
    let fromOpenAIPage = ModelPriceRefresh.parseOpenAIPage(openAIPage)
    try check(fromOpenAIPage.recognized, "OpenAI page: standard-tier island found")
    for id in openAIModels { try check(fromOpenAIPage.rows[id] == expected(id), "OpenAI page row \(id)") }
    try check(fromOpenAIPage.rows["gpt-6-astra"]?.input == 10, "OpenAI page: the standard tier, never batch ($5)")
    try check(fromOpenAIPage.rows["gpt-5.6-sol"]?.output == 20 && fromOpenAIPage.ambiguous.isEmpty,
              "OpenAI page: a model in two standard islands with equal prices is one row")
    try check(fromOpenAIPage.incomplete.contains("gpt-5.5-pro"), "OpenAI page: a row with '-' prices is incomplete, not zero")
    let fromOpenAIMarkdown = ModelPriceRefresh.parseOpenAIMarkdown(openAIMarkdown)
    try check(fromOpenAIMarkdown.recognized, "OpenAI markdown: standard table found")
    for id in openAIModels { try check(fromOpenAIMarkdown.rows[id] == expected(id), "OpenAI markdown row \(id)") }
    try check(fromOpenAIMarkdown.rows["gpt-6-luna"]?.cacheWrite == 0.125, "OpenAI markdown: short-context 30m write, not batch")
    let fromClaudePage = ModelPriceRefresh.parseAnthropicPage(claudePage)
    try check(fromClaudePage.recognized, "Anthropic page: base table found")
    for (id, name) in claudeNames { try check(fromClaudePage.rows[name] == expected(id), "Anthropic page row \(name)") }
    try check(fromClaudePage.rows["Claude Opus 5"]?.input == 5, "Anthropic page: Claude Opus 5 is not Claude Opus 5.5")
    try check(fromClaudePage.rows["Claude Haiku 5.5"]?.output == 0.5, "Anthropic page: Haiku 5.5 uses the prompts-up-to-100k row")
    try check(fromClaudePage.rows["Claude Fable 5.1"]?.output == 50, "Anthropic page: the base table, never batch ($25)")
    let fromClaudeMarkdown = ModelPriceRefresh.parseAnthropicMarkdown(claudeMarkdown)
    try check(fromClaudeMarkdown.recognized, "Anthropic markdown: model table found")
    for (id, name) in claudeNames { try check(fromClaudeMarkdown.rows[name] == expected(id), "Anthropic markdown row \(name)") }
    try check(fromClaudeMarkdown.rows["Claude Opus 4.1"]?.input == 15, "Anthropic markdown: a linked qualifier keeps the name")
    try check(fromClaudeMarkdown.ambiguous.isEmpty && fromClaudePage.ambiguous.isEmpty, "Anthropic reads: prompt-length rows resolve")

    // A fake first-party transport serving the excerpts.
    struct Served: Sendable { var data: Data; var status = 200; var host: String?; var fails = false }
    func pages(_ openAIPage: Data, _ openAIMarkdown: Data, _ claudePage: Data, _ claudeMarkdown: Data) -> [String: Served] {
        var served: [String: Served] = [:]
        for source in ModelPriceRefresh.sources {
            let data: Data
            switch (source.provider, source.read) {
            case ("openai", .page): data = openAIPage
            case ("openai", .markdown): data = openAIMarkdown
            case ("anthropic", .page): data = claudePage
            default: data = claudeMarkdown
            }
            served[source.url.absoluteString] = Served(data: data)
        }
        return served
    }
    let baseline = pages(openAIPage, openAIMarkdown, claudePage, claudeMarkdown)
    func transport(_ served: [String: Served]) -> ModelPriceRefresh.Transport {
        { request in
            guard let url = request.url, let page = served[url.absoluteString] else { throw URLError(.fileDoesNotExist) }
            if page.fails { throw URLError(.notConnectedToInternet) }
            var final = url
            if let host = page.host { final = URL(string: "https://\(host)\(url.path)")! }
            return (page.data, HTTPURLResponse(url: final, statusCode: page.status, httpVersion: "HTTP/1.1", headerFields: nil)!)
        }
    }
    func temporaryHome() throws -> URL {
        let home = files.temporaryDirectory.appendingPathComponent("os1-price-refresh-\(UUID().uuidString)")
        try files.createDirectory(at: home, withIntermediateDirectories: true)
        return home
    }
    func mode(_ url: URL) -> Int { ((try? files.attributesOfItem(atPath: url.path)[.posixPermissions]) as? NSNumber)?.intValue ?? -1 }
    func codes(_ report: ModelPriceRefresh.Report) -> [String] { report.receipt.refusals.map(\.code) }
    var homes: [URL] = []
    defer { for home in homes { try? files.removeItem(at: home) } }
    let now = Date()

    // 1. The excerpts refresh to exactly the compiled prices.
    let home = try temporaryHome(); homes.append(home)
    let tableURL = ModelPriceTable.refreshedPath(home: home), receiptURL = ModelPriceRefresh.receiptPath(home: home)
    try check(ModelPriceRefresh.isDue(home: home, now: now), "no receipt: due")
    let first = await ModelPriceRefresh.run(home: home, now: now, dryRun: false, transport: transport(baseline))
    try check(first.receipt.outcome == "written", "baseline refresh is written: \(first.receipt.refusals)")
    try check(first.table?.models == compiled.models && first.receipt.changedRows.isEmpty, "unchanged prices, no changed rows")
    try check(first.receipt.reference == "compiled", "the first refresh is measured against the compiled table")
    try check(first.receipt.sources.count == 4 && first.receipt.sources.allSatisfy({ $0.httpStatus == 200 && $0.failure == nil }),
              "four first-party sources read")
    try check(Set(first.receipt.sources.compactMap(\.sha256)) == Set(fixtures.values.map(priceFixtureSHA256)),
              "the receipt records each source's sha256")
    let written = try Data(contentsOf: tableURL)
    try check(priceFixtureSHA256(written) == first.receipt.tableSHA256 && first.receipt.tablePath == tableURL.path,
              "the receipt names the written table")
    try check((try? ModelPriceTable.decode(written))?.models == compiled.models, "the written table decodes strictly")
    let day = String(decoding: written, as: UTF8.self).components(separatedBy: "\"retrieved_on\":\"").dropFirst().first?.prefix(10) ?? ""
    try check(Data(String(decoding: written, as: UTF8.self)
        .replacingOccurrences(of: "\"retrieved_on\":\"\(day)\"", with: "\"retrieved_on\":\"2026-10-27\"").utf8) == ModelPriceTable.compiledBytes,
        "unchanged prices reproduce the compiled bytes except the date")
    try check(mode(tableURL) == 0o600 && mode(receiptURL) == 0o600 && mode(tableURL.deletingLastPathComponent()) == 0o700,
              "table and receipt are 0600 in a 0700 directory")
    try check((try files.contentsOfDirectory(atPath: tableURL.deletingLastPathComponent().path)).sorted()
              == ["model-price-table.json", "refresh-receipt.json"], "no temporary file is left behind")
    try check(ModelPriceTable.current(home: home, now: now).refreshed, "the routing table now uses the refresh")
    try check(!ModelPriceRefresh.isDue(home: home, now: now), "just refreshed: not due")
    try check(ModelPriceRefresh.isDue(home: home, now: now.addingTimeInterval(24 * 3600)), "a day later: due")
    try check(ModelPriceRefresh.isDue(home: home, now: now.addingTimeInterval(-3600)), "a receipt from the future: due")

    // 2. A plausible change (x4) is written and recorded; the band then
    //    measures against the refreshed table, not the compiled one.
    let lunaPage = "[0,&quot;gpt-6-luna&quot;],[0,0.1],[0,0.01]"
    let lunaMarkdown = "| gpt-6-luna | $0.10 | $0.50 | $0.01 |"
    let moved = await ModelPriceRefresh.run(home: home, now: now, dryRun: false, transport: transport(pages(
        try replaced(openAIPage, lunaPage, "[0,&quot;gpt-6-luna&quot;],[0,0.4],[0,0.01]"),
        try replaced(openAIMarkdown, lunaMarkdown, "| gpt-6-luna | $0.40 | $0.50 | $0.01 |"), claudePage, claudeMarkdown)))
    try check(moved.receipt.outcome == "written" && moved.receipt.reference == "refreshed", "a x4 change is written")
    try check(moved.receipt.changedRows.count == 1 && moved.receipt.changedRows[0].model == "gpt-6-luna"
              && moved.receipt.changedRows[0].field == "input" && moved.receipt.changedRows[0].old == 0.1
              && moved.receipt.changedRows[0].new == 0.4, "the changed row is recorded")
    try check(ModelPriceTable.current(home: home, now: now).table.models["gpt-6-luna"]?.input == 0.4, "routing sees the new price")

    // 3. An implausible change (0.4 -> 0.07, x0.175 of the table in use; it
    //    would pass against the compiled 0.1) is refused; the last good table stays.
    let goodBytes = try Data(contentsOf: tableURL)
    let goodDate = try files.attributesOfItem(atPath: tableURL.path)[.modificationDate] as? Date
    let refused = await ModelPriceRefresh.run(home: home, now: now, dryRun: false, transport: transport(pages(
        try replaced(openAIPage, lunaPage, "[0,&quot;gpt-6-luna&quot;],[0,0.07],[0,0.01]"),
        try replaced(openAIMarkdown, lunaMarkdown, "| gpt-6-luna | $0.07 | $0.50 | $0.01 |"), claudePage, claudeMarkdown)))
    try check(refused.receipt.outcome == "refused" && refused.table == nil
              && refused.receipt.refusals.contains(where: { $0.code == "implausible_change" && $0.model == "gpt-6-luna" }),
              "a change below x0.2 of the table in use is refused")
    try check(try Data(contentsOf: tableURL) == goodBytes
              && (try files.attributesOfItem(atPath: tableURL.path)[.modificationDate] as? Date) == goodDate,
              "a refusal keeps the last good table untouched")
    try check(ModelPriceRefresh.lastReceipt(home: home)?.outcome == "refused", "the refusal is recorded in the receipt")
    // Stale fallback (ModelPriceTable): once the last good refresh is older
    // than 72 h, routing uses the compiled table again.
    try files.setAttributes([.modificationDate: now.addingTimeInterval(-73 * 3600)], ofItemAtPath: tableURL.path)
    try check(ModelPriceTable.current(home: home, now: now) == (compiled, false), "a stale refresh falls back to compiled")

    // 4. The band's edges: exactly x5 is accepted, just above it is refused.
    let astraPage = "[0,&quot;gpt-6-astra&quot;],[0,10],[0,1],[0,12.5],[0,50]"
    let astraMarkdown = "| gpt-6-astra | $10.00 | $50.00 |"
    for (output, accepted) in [("250", true), ("251", false)] {
        let edge = try temporaryHome(); homes.append(edge)
        let report = await ModelPriceRefresh.run(home: edge, now: now, dryRun: false, transport: transport(pages(
            try replaced(openAIPage, astraPage, "[0,&quot;gpt-6-astra&quot;],[0,10],[0,1],[0,12.5],[0,\(output)]"),
            try replaced(openAIMarkdown, astraMarkdown, "| gpt-6-astra | $10.00 | $\(output).00 |"), claudePage, claudeMarkdown)))
        try check((report.receipt.outcome == "written") == accepted && files.fileExists(atPath: ModelPriceTable.refreshedPath(home: edge).path) == accepted,
                  "astra output 50 -> \(output): \(accepted ? "written" : "refused")")
    }

    // 5. Refusals that never write a table, each recorded in the receipt.
    func refusedFresh(_ served: [String: Served], _ code: String, _ model: String?, _ name: String) async throws {
        let fresh = try temporaryHome(); homes.append(fresh)
        let report = await ModelPriceRefresh.run(home: fresh, now: now, dryRun: false, transport: transport(served))
        try check(report.receipt.outcome == "refused" && report.receipt.refusals.contains(where: { $0.code == code && (model == nil || $0.model == model) }),
                  "\(name): refused as \(code), got \(codes(report))")
        try check(!files.fileExists(atPath: ModelPriceTable.refreshedPath(home: fresh).path), "\(name): no table is written")
        try check(ModelPriceRefresh.lastReceipt(home: fresh)?.refusals == report.receipt.refusals, "\(name): the receipt records it")
    }
    try await refusedFresh(pages(openAIPage, try replaced(openAIMarkdown,
        "| gpt-6-sol | $2.00 | $10.00 | $0.20 | $2.50 | $5.00 | $4.00 | $15.00 | $0.40 | $5.00 | $10.00 |\n", ""), claudePage, claudeMarkdown),
        "missing_model", "gpt-6-sol", "a model missing from one read")
    try await refusedFresh(pages(openAIPage, openAIMarkdown, try replaced(claudePage, ">Claude Haiku 4.5</a>", ">Claude Haiku 4.6</a>"), claudeMarkdown),
        "missing_model", "claude-haiku-4-5-20251001", "a renamed Anthropic model")
    try await refusedFresh(pages(openAIPage, try replaced(openAIMarkdown, astraMarkdown, "| gpt-6-astra | $10.00 | $55.00 |"), claudePage, claudeMarkdown),
        "sources_disagree", "gpt-6-astra", "page and markdown disagree")
    try await refusedFresh(pages(Data("<html><body>moved</body></html>".utf8), openAIMarkdown, claudePage, claudeMarkdown),
        "format_unrecognized", nil, "the OpenAI page lost its price islands")
    let opusRow = String(decoding: claudeMarkdown, as: UTF8.self).components(separatedBy: "\n")
        .first { $0.hasPrefix("| Claude Opus 5.5 ") } ?? "missing"
    try await refusedFresh(pages(openAIPage, openAIMarkdown, claudePage, try replaced(claudeMarkdown, opusRow,
        "| Claude Opus 5.5 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.25 / MTok | $25 / MTok |\n" + opusRow)),
        "ambiguous_rows", "claude-opus-5-5", "two conflicting rows for one model")
    var serverError = baseline
    serverError[ModelPriceRefresh.sources[3].url.absoluteString]?.status = 500
    try await refusedFresh(serverError, "source_unavailable", nil, "HTTP 500")
    var offline = baseline
    offline[ModelPriceRefresh.sources[0].url.absoluteString]?.fails = true
    try await refusedFresh(offline, "source_unavailable", nil, "no network")
    var redirected = baseline
    redirected[ModelPriceRefresh.sources[2].url.absoluteString]?.host = "example.com"
    try await refusedFresh(redirected, "source_unavailable", nil, "a redirect off the provider's host")
    let failedHome = try temporaryHome(); homes.append(failedHome)
    let failedRead = await ModelPriceRefresh.run(home: failedHome, now: now, dryRun: true, transport: transport(serverError))
    try check(failedRead.receipt.sources[3].httpStatus == 500 && failedRead.receipt.sources[3].failure == "HTTP 500",
              "the receipt keeps the failing source's status")

    // 6. A dry run validates and writes nothing.
    let dry = try temporaryHome(); homes.append(dry)
    let dryReport = await ModelPriceRefresh.run(home: dry, now: now, dryRun: true, transport: transport(baseline))
    try check(dryReport.receipt.outcome == "dry_run_ok" && dryReport.table?.models == compiled.models && dryReport.receipt.dryRun,
              "a dry run validates the candidate")
    try check(!files.fileExists(atPath: ModelPriceTable.refreshedPath(home: dry).deletingLastPathComponent().path), "a dry run writes nothing")

    // 7. A symlink at the table path is refused, never followed or replaced.
    let linked = try temporaryHome(); homes.append(linked)
    let victim = linked.appendingPathComponent("victim.json")
    try Data("keep".utf8).write(to: victim)
    try files.createDirectory(at: ModelPriceTable.refreshedPath(home: linked).deletingLastPathComponent(), withIntermediateDirectories: true)
    try files.createSymbolicLink(at: ModelPriceTable.refreshedPath(home: linked), withDestinationURL: victim)
    let linkReport = await ModelPriceRefresh.run(home: linked, now: now, dryRun: false, transport: transport(baseline))
    try check(linkReport.receipt.outcome == "refused" && codes(linkReport) == ["write_failed"], "a symlinked table path is refused")
    try check(try Data(contentsOf: victim) == Data("keep".utf8)
              && (try files.attributesOfItem(atPath: ModelPriceTable.refreshedPath(home: linked).path)[.type] as? FileAttributeType) == .typeSymbolicLink,
              "the symlink target is untouched")

    // 8. The App's daily gate.
    let idle = try temporaryHome(); homes.append(idle)
    try check(ModelPriceRefresh.shouldStartScheduled(home: idle, now: now, busy: false, lastAttemptInProcess: nil), "idle and due: start")
    try check(!ModelPriceRefresh.shouldStartScheduled(home: idle, now: now, busy: true, lastAttemptInProcess: nil), "busy: wait")
    try check(!ModelPriceRefresh.shouldStartScheduled(home: idle, now: now, busy: false, lastAttemptInProcess: now.addingTimeInterval(-3600)),
              "attempted an hour ago in this process: wait")
    try check(!ModelPriceRefresh.shouldStartScheduled(home: home, now: now, busy: false, lastAttemptInProcess: nil),
              "a receipt from today: wait")
    return count
}
