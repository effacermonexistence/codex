import Foundation
import OS1Context

private struct Reply: Sendable {
    var body: String
    var code: Int = 200
    var etag: String? = nil
    var host: String? = nil
}

private actor TestTransport {
    let replies: [Reply]
    var requests: [URLRequest] = []
    init(_ replies: [Reply]) { self.replies = replies }
    func fetch(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let reply = replies[min(requests.count, replies.count - 1)]
        requests.append(request)
        try await Task.sleep(for: .milliseconds(10))
        let url = reply.host.flatMap(URL.init(string:)) ?? request.url!
        return (Data(reply.body.utf8), HTTPURLResponse(url: url, statusCode: reply.code, httpVersion: nil,
            headerFields: reply.etag.map { ["ETag": $0] })!)
    }
}

@main
struct FrontierMonitorTests {
    static func main() async throws {
        var checks = 0
        func check(_ condition: Bool, _ name: String) {
            precondition(condition, name); checks += 1
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-frontier-tests-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let now = ISO8601DateFormatter().date(from: "2026-09-12T12:00:00Z")!
        let source = FrontierMonitorSource(id: "test-status", provider: .openAI,
            endpoint: URL(string: "https://status.openai.com/api/v2/incidents.json")!)
        func payload(_ body: String, status: String = "investigating") -> String {
            """
            {"incidents":[{"id":"one","name":"Token usage limits","status":"\(status)","created_at":"2026-09-12T01:00:00Z","incident_updates":[{"body":"\(body)"}]}]}
            """
        }
        let transport = TestTransport([
            Reply(body: payload("Usage quota resets at 2026-09-12T18:00:00Z."), etag: "v1"),
            Reply(body: payload("Usage quota resets at 2026-09-12T18:00:00Z."), etag: "v1"),
            Reply(body: payload("Usage quota reset postponed", status: "resolved"), etag: "v2"),
            Reply(body: "", code: 304),
            Reply(body: "<html>challenge</html>", etag: "invalid"),
            Reply(body: "", code: 500, etag: "error")
        ])
        let monitor = FrontierNewsMonitor(storageRoot: root, sources: [source], transport: { try await transport.fetch($0) })
        let first = await monitor.poll(now: now)
        check(first.newItems.count == 1 && first.items.count == 1, "first live notice")
        check(first.items[0].resetAt != nil, "explicit reset clause")
        check(first.sourceStatuses.allSatisfy(\.available), "valid source")
        let same = await monitor.poll(now: now.addingTimeInterval(1))
        check(same.newItems.isEmpty && !same.didChange, "unchanged poll is quiet")
        let edited = await monitor.poll(now: now.addingTimeInterval(2))
        check(edited.newItems.count == 1 && edited.items.count == 1, "same ID update replaces")
        check(edited.items[0].sourceStatus == "resolved" && edited.items[0].resetAt == nil, "corrected status/deadline")
        let restarted = FrontierNewsMonitor(storageRoot: root, sources: [source], transport: { try await transport.fetch($0) })
        let notModified = await restarted.poll(now: now.addingTimeInterval(3))
        check(notModified.newItems.isEmpty && notModified.items == edited.items, "restart/304 keeps checked cache")
        let malformed = await restarted.poll(now: now.addingTimeInterval(4))
        check(!malformed.sourceStatuses[0].available && malformed.items == edited.items, "200 malformed remains unavailable")
        let failed = await restarted.poll(now: now.addingTimeInterval(5))
        check(!failed.sourceStatuses[0].available && failed.items.count == 1, "failure preserves history")
        let requests = await transport.requests
        check(requests[1].value(forHTTPHeaderField: "If-None-Match") == "v1", "ETag conditional request")
        check(requests[5].value(forHTTPHeaderField: "If-None-Match") == "v2", "invalid ETag never cached")
        let permission = try FileManager.default.attributesOfItem(atPath: root.appendingPathComponent("frontier-news-monitor.json").path)[.posixPermissions] as? Int
        check(permission == 0o600, "private state permissions")

        for (name, reply) in [
            ("cold304", Reply(body: "", code: 304)),
            ("host", Reply(body: payload("usage"), host: "https://untrusted.example/")),
            ("oversize", Reply(body: String(repeating: " ", count: 2_000_001))),
            ("badJSON", Reply(body: "{\"wrong\":[]}"))
        ] {
            let t = TestTransport([reply])
            let m = FrontierNewsMonitor(storageRoot: root.appendingPathComponent(name), sources: [source], transport: { try await t.fetch($0) })
            let result = await m.poll(now: now)
            check(!result.sourceStatuses[0].available, name + " fails closed")
        }
        let concurrent = TestTransport([Reply(body: payload("new quota"))])
        let m = FrontierNewsMonitor(storageRoot: root.appendingPathComponent("concurrent"), sources: [source], transport: { try await concurrent.fetch($0) })
        async let a = m.poll(now: now)
        async let b = m.poll(now: now)
        _ = await (a, b)
        check(await concurrent.requests.count == 1, "overlapping polls share a request")
        let stale = await m.poll(now: now.addingTimeInterval(FrontierNewsMonitor.displayWindow + 86400))
        let staleAgain = await m.poll(now: now.addingTimeInterval(FrontierNewsMonitor.displayWindow + 86401))
        check(stale.items.isEmpty && stale.newItems.isEmpty && staleAgain.newItems.isEmpty, "old feed items cannot re-alert")

        let rss = FrontierMonitorSource(id: "news", provider: .openAI, endpoint: URL(string: "https://openai.com/news/rss.xml")!, format: .rss)
        let feed = Data("""
        <rss><channel><item><title>New <b>model</b> release</title><guid>a</guid><pubDate>Sat, 12 Sep 2026 01:00:00 GMT</pubDate><description><![CDATA[<p>New &amp; useful</p>]]></description><link>https://evil.example/</link></item></channel></rss>
        """.utf8)
        try FrontierNewsMonitor.validate(data: feed, source: rss)
        let parsed = FrontierNewsMonitor.parseFeed(data: feed, source: rss)
        check(parsed.count == 1 && parsed[0].title == "New model release", "nested XML text")
        check(parsed[0].summary == "New & useful", "non-executable plain text")
        check(parsed[0].sourceURL == rss.endpoint && parsed[0].kind == .announcement, "safe URL and news classification")
        do {
            try FrontierNewsMonitor.validate(data: Data("<html/>".utf8), source: rss)
            preconditionFailure("HTML is not RSS")
        } catch { checks += 1 }
        check(FrontierNewsMonitor.resetDate(in: "Incident began 2026-09-12T18:00:00Z; quota reset delayed.") == nil, "unrelated timestamp")
        check(FrontierNewsMonitor.resetDate(in: "Usage resets at 7pm") == nil, "ambiguous timezone")
        check(FrontierNewsMonitor.resetDate(in: "Usage resets at 2026-09-12T18:00:00Z. Usage resets at 2026-09-13T18:00:00Z") == nil, "multiple deadlines unknown")
        check(FrontierNewsMonitor.classify(title: "Password reset", summary: "") == .announcement, "not every reset is quota")
        let newsroom = FrontierMonitorSource.firstParty.first { $0.id == "anthropic-news" }!
        let html = Data("""
        <a href="/news/limit"><time>Sep 12, 2026</time><h4>Usage credits increase</h4><p>Quota resets at 2026-09-13T18:00:00Z.</p></a>
        <a href="/news/limit"><time>Sep 12, 2026</time><h4>Usage credits increase</h4></a>
        <a href="/news/unknown"><h4>No publication date</h4></a>
        """.utf8)
        let news = FrontierNewsMonitor.parseNewsroom(data: html, source: newsroom)
        check(news.count == 1 && news[0].resetAt != nil && news[0].sourceURL.host == "www.anthropic.com", "dated newsroom cards and dedupe")
        check(FrontierNewsMonitor.parseFeed(data: Data("<rss><channel><item><title>missing date</title></item></channel></rss>".utf8), source: rss).isEmpty, "unknown publication never becomes now")
        let google = FrontierMonitorSource.firstParty.first { $0.id == "google-cloud-status" }!
        let g = Data("[{\"external_desc\":\"Email failure\",\"begin\":\"2026-09-12T01:00:00Z\",\"updates\":[]}]".utf8)
        check(FrontierNewsMonitor.parseStatusPage(data: g, source: google).isEmpty, "failure is not AI keyword")
        print("Frontier monitor: \(checks) checks PASS; model calls 0; network calls 0")
    }
}
