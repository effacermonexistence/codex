import Foundation
import OS1Context

func runFrontierMonitorFixtures() throws {
    let source = FrontierMonitorSource(
        id: "openai-status",
        provider: .openAI,
        endpoint: URL(string: "https://status.openai.com/api/v2/incidents.json")!
    )
    let payload: [String: Any] = [
        "incidents": [
            [
                "id": "incident-1",
                "name": "Usage limits reset schedule updated",
                "status": "resolved",
                "created_at": "2026-09-12T01:00:00Z",
                "incident_updates": [[
                    "body": "The five-hour token quota resets at 2026-09-12T07:00:00Z.",
                    "created_at": "2026-09-12T02:00:00Z"
                ]],
                "shortlink": "https://status.openai.com/incidents/incident-1"
            ],
            [
                "id": "incident-2",
                "name": "Elevated errors",
                "status": "investigating",
                "created_at": "2026-09-11T23:00:00Z",
                "incident_updates": [["body": "We are investigating elevated errors."]]
            ],
            ["id": "blank", "name": "", "status": "resolved"]
        ]
    ]
    let data = try JSONSerialization.data(withJSONObject: payload)
    let now = Date(timeIntervalSince1970: 1_789_170_000)
    let items = FrontierNewsMonitor.parseStatusPage(data: data, source: source, detectedAt: now)
    precondition(items.count == 2, "blank status incidents must be ignored")
    let reset = items.first { $0.id == "openai-status:incident-1" }
    precondition(reset?.kind == .tokenReset, "reset language must be classified")
    precondition(reset?.resetAt != nil, "explicit ISO reset date must be retained")
    precondition(reset?.sourceURL.absoluteString == "https://status.openai.com/incidents/incident-1")
    precondition(items.first(where: { $0.id == "openai-status:incident-2" })?.kind == .incident)
    precondition(FrontierNewsMonitor.classify(title: "", summary: "토큰 한도 변경") == .usageLimit)
    precondition(FrontierNewsMonitor.classify(title: "", summary: "사용량 리셋 일정 변경") == .tokenReset)
    precondition(FrontierNewsMonitor.classify(title: "서비스 장애", summary: "복구 중", status: "investigating") == .incident)
    let feedSource = FrontierMonitorSource(
        id: "openai-news", provider: .openAI,
        endpoint: URL(string: "https://openai.com/news/rss.xml")!, format: .rss
    )
    let feed = Data("""
    <?xml version="1.0"?><rss><channel><item><title>Higher token usage limits</title><link>https://openai.com/news/limits</link><guid>news-1</guid><pubDate>Fri, 12 Sep 2026 01:00:00 GMT</pubDate><description>Usage limit changes are effective now.</description></item></channel></rss>
    """.utf8)
    let feedItems = FrontierNewsMonitor.parseFeed(data: feed, source: feedSource, detectedAt: now)
    precondition(feedItems.count == 1 && feedItems[0].kind == .usageLimit)
    precondition(feedItems[0].sourceURL.host == "openai.com")
    let googleSource = FrontierMonitorSource(
        id: "google-cloud-status", provider: .google,
        endpoint: URL(string: "https://status.cloud.google.com/incidents.json")!
    )
    let googleData = try JSONSerialization.data(withJSONObject: [[
        "id": "g-1", "external_desc": "Gemini API elevated errors",
        "begin": "2026-09-12T01:00:00+00:00",
        "updates": [["when": "2026-09-12T02:00:00+00:00", "text": "Mitigation in progress"]]
    ]])
    let googleItems = FrontierNewsMonitor.parseStatusPage(data: googleData, source: googleSource, detectedAt: now)
    precondition(googleItems.count == 1 && googleItems[0].provider == .google)
    print("OS-1 frontier news monitor: 11 deterministic checks passed")
}
