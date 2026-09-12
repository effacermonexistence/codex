import CryptoKit
import Foundation

/// First-party frontier-provider signal sources. These are public operational
/// feeds; they are not an account-quota API and never carry credentials.
public enum FrontierProvider: String, Codable, CaseIterable, Sendable {
    case openAI = "openai"
    case anthropic = "anthropic"
    case google = "google"
    case cohere = "cohere"

    public var displayName: String {
        switch self {
        case .openAI: return "OpenAI"
        case .anthropic: return "Anthropic"
        case .google: return "Google AI"
        case .cohere: return "Cohere"
        }
    }
}

public enum FrontierSignalKind: String, Codable, Sendable {
    case tokenReset = "token_reset"
    case usageLimit = "usage_limit"
    case incident
    case announcement

    public var label: String {
        switch self {
        case .tokenReset: return "토큰·리셋"
        case .usageLimit: return "사용량·한도"
        case .incident: return "서비스 상태"
        case .announcement: return "공지"
        }
    }
}

public struct FrontierNewsItem: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let provider: FrontierProvider
    public let title: String
    public let summary: String
    public let sourceURL: URL
    public let publishedAt: Date
    public let detectedAt: Date
    public let kind: FrontierSignalKind
    /// Set only when the source contains an unambiguous ISO-8601 timestamp.
    /// Relative phrases such as “resets at 7pm” remain nil by design.
    public let resetAt: Date?
    public let sourceStatus: String?

    public init(
        id: String,
        provider: FrontierProvider,
        title: String,
        summary: String,
        sourceURL: URL,
        publishedAt: Date,
        detectedAt: Date = Date(),
        kind: FrontierSignalKind,
        resetAt: Date? = nil,
        sourceStatus: String? = nil
    ) {
        self.id = id
        self.provider = provider
        self.title = title
        self.summary = summary
        self.sourceURL = sourceURL
        self.publishedAt = publishedAt
        self.detectedAt = detectedAt
        self.kind = kind
        self.resetAt = resetAt
        self.sourceStatus = sourceStatus
    }
}

public struct FrontierMonitorSource: Codable, Equatable, Identifiable, Sendable {
    public enum Format: String, Codable, Sendable { case statuspageJSON, rss, anthropicNews }

    public let id: String
    public let provider: FrontierProvider
    public let endpoint: URL
    public let format: Format

    public init(id: String, provider: FrontierProvider, endpoint: URL, format: Format = .statuspageJSON) {
        self.id = id
        self.provider = provider
        self.endpoint = endpoint
        self.format = format
    }

    public static let firstParty: [FrontierMonitorSource] = [
        FrontierMonitorSource(
            id: "openai-news",
            provider: .openAI,
            endpoint: URL(string: "https://openai.com/news/rss.xml")!,
            format: .rss
        ),
        FrontierMonitorSource(
            id: "openai-status",
            provider: .openAI,
            endpoint: URL(string: "https://status.openai.com/api/v2/incidents.json")!
        ),
        FrontierMonitorSource(
            id: "anthropic-news", provider: .anthropic,
            endpoint: URL(string: "https://www.anthropic.com/news")!, format: .anthropicNews
        ),
        FrontierMonitorSource(
            id: "anthropic-status",
            provider: .anthropic,
            endpoint: URL(string: "https://status.claude.com/api/v2/incidents.json")!
        ),
        FrontierMonitorSource(
            id: "google-cloud-status",
            provider: .google,
            endpoint: URL(string: "https://status.cloud.google.com/incidents.json")!
        ),
        FrontierMonitorSource(
            id: "google-ai-news", provider: .google,
            endpoint: URL(string: "https://blog.google/technology/ai/rss/")!, format: .rss
        ),
        FrontierMonitorSource(
            id: "deepmind-news", provider: .google,
            endpoint: URL(string: "https://deepmind.google/blog/rss.xml")!, format: .rss
        ),
        FrontierMonitorSource(
            id: "cohere-status",
            provider: .cohere,
            endpoint: URL(string: "https://status.cohere.com/api/v2/incidents.json")!
        ),
    ]

    var allowedHost: String { endpoint.host?.lowercased() ?? "" }
}

public struct FrontierSourceStatus: Codable, Equatable, Sendable {
    public let sourceID: String
    public let provider: FrontierProvider
    public let checkedAt: Date
    public let available: Bool
    public let message: String
    public let httpStatus: Int?

    public init(sourceID: String, provider: FrontierProvider, checkedAt: Date, available: Bool,
                message: String, httpStatus: Int? = nil) {
        self.sourceID = sourceID
        self.provider = provider
        self.checkedAt = checkedAt
        self.available = available
        self.message = message
        self.httpStatus = httpStatus
    }
}

public struct FrontierMonitorPollResult: Codable, Sendable {
    public let completedAt: Date
    public let newItems: [FrontierNewsItem]
    public let items: [FrontierNewsItem]
    public let sourceStatuses: [FrontierSourceStatus]
    public let didChange: Bool

    public init(completedAt: Date, newItems: [FrontierNewsItem], items: [FrontierNewsItem],
                sourceStatuses: [FrontierSourceStatus], didChange: Bool) {
        self.completedAt = completedAt
        self.newItems = newItems
        self.items = items
        self.sourceStatuses = sourceStatuses
        self.didChange = didChange
    }
}

/// A bounded, credential-free monitor. It intentionally does not call a
/// language model, alter routing, or put provider notices into task context.
public actor FrontierNewsMonitor {
    public static let defaultPollInterval: TimeInterval = 300
    public static let displayWindow: TimeInterval = 30 * 24 * 60 * 60
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    private struct SourceCursor: Codable, Sendable {
        var etag: String?
        var lastModified: String?
    }

    private struct PersistedState: Codable, Sendable {
        var schema: Int
        var lastPollAt: Date?
        var items: [FrontierNewsItem]
        var seen: [String: Date]
        var cursors: [String: SourceCursor]
        var statuses: [FrontierSourceStatus]
    }

    private struct StatusPageIncident: Decodable {
        let id: String?
        let name: String?
        let status: String?
        let createdAt: String?
        let updatedAt: String?
        let resolvedAt: String?
        let shortlink: String?
        let incidentUpdates: [IncidentUpdate]?

        struct IncidentUpdate: Decodable {
            let body: String?
            let createdAt: String?
            let displayAt: String?

            enum CodingKeys: String, CodingKey {
                case body
                case createdAt = "created_at"
                case displayAt = "display_at"
            }
        }

        enum CodingKeys: String, CodingKey {
            case id, name, status, shortlink
            case createdAt = "created_at"
            case updatedAt = "updated_at"
            case resolvedAt = "resolved_at"
            case incidentUpdates = "incident_updates"
        }
    }

    private struct StatusPageEnvelope: Decodable {
        let incidents: [StatusPageIncident]
    }

    private let sources: [FrontierMonitorSource]
    private let stateURL: URL
    private let transport: Transport
    private var state: PersistedState
    private var activePoll: Task<FrontierMonitorPollResult, Never>?

    public init(storageRoot: URL? = nil, sources: [FrontierMonitorSource] = FrontierMonitorSource.firstParty,
                transport: Transport? = nil) {
        self.sources = sources
        self.transport = transport ?? Self.publicTransport
        let root = storageRoot ?? FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1", isDirectory: true)
        self.stateURL = root.appendingPathComponent("frontier-news-monitor.json")
        if let data = try? Data(contentsOf: stateURL),
           let decoded = try? JSONDecoder().decode(PersistedState.self, from: data),
           decoded.schema == 1 {
            self.state = decoded
        } else {
            self.state = PersistedState(schema: 1, lastPollAt: nil, items: [], seen: [:], cursors: [:], statuses: [])
        }
    }

    public func snapshot() -> FrontierMonitorPollResult {
        FrontierMonitorPollResult(
            completedAt: state.lastPollAt ?? Date.distantPast,
            newItems: [],
            items: state.items,
            sourceStatuses: state.statuses,
            didChange: false
        )
    }

    public func poll(now: Date = Date()) async -> FrontierMonitorPollResult {
        if let activePoll { return await activePoll.value }
        let task = Task { await self.performPoll(now: now) }
        activePoll = task
        let result = await task.value
        activePoll = nil
        return result
    }

    private func performPoll(now: Date) async -> FrontierMonitorPollResult {
        var fresh: [FrontierNewsItem] = []
        var statuses: [FrontierSourceStatus] = []
        let previous = state.items
        let cutoff = now.addingTimeInterval(-Self.displayWindow)
        var indexed = Dictionary(state.items.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let cursors = state.cursors
        let transport = self.transport
        let checks = await withTaskGroup(of: (String, FetchResult).self) { group in
            for source in sources {
                group.addTask {
                    (source.id, await Self.fetch(source: source, cursor: cursors[source.id], now: now, transport: transport))
                }
            }
            var results: [String: FetchResult] = [:]
            for await (id, value) in group { results[id] = value }
            return results
        }
        for source in sources {
            guard let checked = checks[source.id] else { continue }
            statuses.append(checked.status)
            guard checked.status.available else { continue }
            if let cursor = checked.cursor { state.cursors[source.id] = cursor }
            if checked.notModified { continue }
            for item in checked.items where item.publishedAt >= cutoff && item.publishedAt <= now.addingTimeInterval(300) {
                let revision = Self.revision(of: item)
                if state.seen[revision] == nil {
                    // Baseline history is shown without an alert storm. Newly
                    // changed incidents can still notify even if created earlier.
                    if item.publishedAt >= now.addingTimeInterval(-86400) || indexed[item.id] != nil {
                        fresh.append(item)
                    }
                    state.seen[revision] = now
                }
                if indexed[item.id].map(Self.revision) != revision { indexed[item.id] = item }
            }
        }
        state.items = indexed.values
            .filter { $0.publishedAt >= cutoff }
            .sorted { $0.publishedAt == $1.publishedAt ? $0.id < $1.id : $0.publishedAt > $1.publishedAt }
            .prefix(100)
            .map { $0 }
        state.seen = state.seen.filter { $0.value >= cutoff }
        state.statuses = statuses
        state.lastPollAt = now
        do { try persist() } catch {
            statuses.append(FrontierSourceStatus(sourceID: "local-history", provider: .openAI, checkedAt: now,
                available: false, message: "로컬 기록 저장 실패 · 재시작 후 중복 알림 가능"))
        }

        return FrontierMonitorPollResult(completedAt: now, newItems: fresh.sorted { $0.publishedAt > $1.publishedAt },
                                         items: state.items, sourceStatuses: statuses, didChange: previous != state.items)
    }

    private struct FetchResult: Sendable {
        let status: FrontierSourceStatus
        let items: [FrontierNewsItem]
        let notModified: Bool
        var cursor: SourceCursor? = nil
    }

    private static func fetch(source: FrontierMonitorSource, cursor: SourceCursor?, now: Date,
                              transport: Transport) async -> FetchResult {
        let sourceStatusBase = { (available: Bool, message: String, code: Int?) in
            FrontierSourceStatus(sourceID: source.id, provider: source.provider, checkedAt: now,
                                 available: available, message: message, httpStatus: code)
        }
        guard source.endpoint.scheme?.lowercased() == "https",
              source.endpoint.host?.lowercased() == source.allowedHost,
              !source.allowedHost.isEmpty else {
            return FetchResult(status: sourceStatusBase(false, "공식 HTTPS 원본이 아님", nil), items: [], notModified: false)
        }

        var request = URLRequest(url: source.endpoint)
        request.httpMethod = "GET"
        request.timeoutInterval = 12
        request.setValue(source.format == .rss ? "application/rss+xml, application/xml, text/xml" :
                            (source.format == .anthropicNews ? "text/html" : "application/json"),
                         forHTTPHeaderField: "Accept")
        if let cursor {
            if let etag = cursor.etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
            if let lastModified = cursor.lastModified { request.setValue(lastModified, forHTTPHeaderField: "If-Modified-Since") }
        }

        do {
            let (data, http) = try await transport(request)
            guard http.url?.scheme == "https", http.url?.host?.lowercased() == source.allowedHost else {
                throw URLError(.redirectToNonExistentLocation)
            }
            if http.statusCode == 304 {
                guard cursor != nil else { throw URLError(.badServerResponse) }
                return FetchResult(status: sourceStatusBase(true, "변경 없음 · 조건부 요청 확인", http.statusCode), items: [], notModified: true)
            }
            guard (200..<300).contains(http.statusCode) else {
                return FetchResult(status: sourceStatusBase(false, "공식 원본 응답 오류", http.statusCode), items: [], notModified: false)
            }
            guard data.count <= 2_000_000 else {
                return FetchResult(status: sourceStatusBase(false, "응답 크기 제한 초과", http.statusCode), items: [], notModified: false)
            }
            let items: [FrontierNewsItem]
            try Self.validate(data: data, source: source)
            if source.format == .anthropicNews {
                items = Self.parseNewsroom(data: data, source: source, detectedAt: now)
            } else if source.format == .rss {
                items = Self.parseFeed(data: data, source: source, detectedAt: now)
            } else {
                items = Self.parseStatusPage(data: data, source: source, detectedAt: now)
            }
            return FetchResult(status: sourceStatusBase(true, "공식 원본 확인 · \(items.count)개 항목", http.statusCode),
                items: items, notModified: false, cursor: SourceCursor(etag: http.value(forHTTPHeaderField: "ETag"),
                    lastModified: http.value(forHTTPHeaderField: "Last-Modified")))
        } catch {
            return FetchResult(status: sourceStatusBase(false, "공식 원본을 확인하지 못함", nil), items: [], notModified: false)
        }
    }

    public static func revision(of item: FrontierNewsItem) -> String {
        let value = "\(item.id)|\(item.title)|\(item.summary)|\(item.sourceStatus ?? "")|\(item.sourceURL)|\(item.publishedAt.timeIntervalSince1970)"
        return item.id + ":" + SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// No browser cookies, credentials or authenticated session are reused.
    private static func publicTransport(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.urlCache = nil
        config.timeoutIntervalForResource = 15
        let session = URLSession(configuration: config, delegate: FrontierRedirectGuard(host: request.url?.host), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard response.expectedContentLength <= 2_000_000 else { throw URLError(.dataLengthExceedsMaximum) }
        var data = Data()
        for try await byte in bytes {
            guard data.count < 2_000_000 else { throw URLError(.dataLengthExceedsMaximum) }
            data.append(byte)
        }
        return (data, http)
    }

    public static func validate(data: Data, source: FrontierMonitorSource) throws {
        switch source.format {
        case .rss:
            guard RSSParser(data: data).parse() else { throw URLError(.cannotParseResponse) }
        case .anthropicNews:
            guard !parseNewsroom(data: data, source: source).isEmpty else { throw URLError(.cannotParseResponse) }
        case .statuspageJSON:
            if (try? JSONDecoder().decode(StatusPageEnvelope.self, from: data)) != nil { return }
            guard source.provider == .google,
                  let rows = try JSONSerialization.jsonObject(with: data) as? [[String: Any]],
                  rows.allSatisfy({ $0["external_desc"] is String && $0["begin"] is String }) else {
                throw URLError(.cannotParseResponse)
            }
        }
    }

    private func persist() throws {
        let directory = stateURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                 attributes: [.posixPermissions: 0o700])
        let data = try JSONEncoder().encode(state)
        try data.write(to: stateURL, options: [.atomic])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: stateURL.path)
    }

    /// Deterministic parser used by the runtime and its no-network tests.
    public static func parseStatusPage(data: Data, source: FrontierMonitorSource,
                                       detectedAt: Date = Date()) -> [FrontierNewsItem] {
        if let envelope = try? JSONDecoder().decode(StatusPageEnvelope.self, from: data) {
            return envelope.incidents.compactMap { (incident) -> FrontierNewsItem? in
                let title = bounded(incident.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "", limit: 240)
                guard !title.isEmpty else { return nil }
                let updates = incident.incidentUpdates ?? []
                let latest = updates.sorted {
                    (date($0.displayAt ?? $0.createdAt) ?? .distantPast) >
                        (date($1.displayAt ?? $1.createdAt) ?? .distantPast)
                }.first
                let body = bounded(latest?.body?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "", limit: 2_000)
                guard let published = date(incident.createdAt ?? incident.updatedAt) else { return nil }
                let sourceURL = safeURL(incident.shortlink, fallback: source.endpoint)
                let combined = "\(title)\n\(body)"
                let kind = classify(title: title, summary: body, status: incident.status)
                let reset = resetDate(in: combined)
                let providerID = incident.id?.trimmingCharacters(in: .whitespacesAndNewlines)
                let identity = providerID?.isEmpty == false ? providerID! : fingerprint(provider: source.provider,
                    title: title, summary: body, publishedAt: published)
                return FrontierNewsItem(id: "\(source.id):\(identity)", provider: source.provider,
                                        title: title, summary: body, sourceURL: sourceURL, publishedAt: published,
                                        detectedAt: detectedAt, kind: kind, resetAt: reset,
                                        sourceStatus: incident.status)
            }
        }

        // Google Cloud's public incident feed uses a top-level array rather
        // than Statuspage's { incidents: [...] } envelope.
        guard source.provider == .google,
              let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return array.compactMap { object -> FrontierNewsItem? in
            let title = bounded((object["external_desc"] as? String ?? object["name"] as? String ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines), limit: 240)
            let updates = object["updates"] as? [[String: Any]] ?? []
            let latest = updates.sorted {
                (date($0["when"] as? String ?? $0["created"] as? String) ?? .distantPast) >
                    (date($1["when"] as? String ?? $1["created"] as? String) ?? .distantPast)
            }.first
            let body = bounded((latest?["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines), limit: 2_000)
            let combined = "\(title)\n\(body)"
            guard !title.isEmpty, combined.range(of: #"(?i)\b(ai|gemini|vertex|machine learning|generative|models?)\b"#,
                options: .regularExpression) != nil else { return nil }
            guard let published = date(object["begin"] as? String ?? object["created"] as? String ?? object["modified"] as? String) else { return nil }
            let identity: String
            if let objectID = (object["id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !objectID.isEmpty {
                identity = objectID
            } else {
                identity = fingerprint(provider: source.provider, title: title, summary: body, publishedAt: published)
            }
            return FrontierNewsItem(id: "\(source.id):\(identity)", provider: source.provider,
                                    title: title, summary: body, sourceURL: source.endpoint, publishedAt: published,
                                    detectedAt: detectedAt, kind: classify(title: title, summary: body, status: "incident"),
                                    resetAt: resetDate(in: combined))
        }
    }

    /// Parses RSS 2.0 and the common Atom subset without rendering HTML.
    /// Provider newsroom feeds are treated as untrusted text and bounded
    /// before they can reach the monitor panel.
    public static func parseFeed(data: Data, source: FrontierMonitorSource,
                                 detectedAt: Date = Date()) -> [FrontierNewsItem] {
        let parser = RSSParser(data: data)
        guard parser.parse() else { return [] }
        return parser.entries.compactMap { (entry) -> FrontierNewsItem? in
            let title = bounded(entry.title.trimmingCharacters(in: .whitespacesAndNewlines), limit: 240)
            guard !title.isEmpty else { return nil }
            let body = bounded(plainText(entry.summary), limit: 2_000)
            guard let published = date(entry.published) else { return nil }
            let identity: String
            if let guid = entry.guid?.trimmingCharacters(in: .whitespacesAndNewlines), !guid.isEmpty {
                identity = guid
            } else {
                identity = fingerprint(provider: source.provider, title: title, summary: body, publishedAt: published)
            }
            let url = safeURL(entry.link, fallback: source.endpoint)
            return FrontierNewsItem(id: "\(source.id):\(identity)", provider: source.provider,
                                    title: title, summary: body, sourceURL: url, publishedAt: published,
                                    detectedAt: detectedAt, kind: classify(title: title, summary: body),
                                    resetAt: resetDate(in: "\(title)\n\(body)"))
        }
    }

    public static func classify(title: String, summary: String, status: String? = nil) -> FrontierSignalKind {
        let value = "\(title) \(summary)".folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            .lowercased()
        let resetWords = ["quota", "usage", "rate limit", "rate-limit", "credits", "token", "five-hour", "5-hour", "context window", "사용량", "한도", "토큰"]
        if resetWords.contains(where: value.contains) {
            return value.contains("reset") || value.contains("리셋") ? .tokenReset : .usageLimit
        }
        if status.map({ ["resolved", "postmortem"].contains($0.lowercased()) }) == true {
            return .incident
        }
        return status == nil ? .announcement : .incident
    }

    private static func fingerprint(provider: FrontierProvider, title: String, summary: String, publishedAt: Date) -> String {
        let value = "\(provider.rawValue)|\(title)|\(summary)|\(publishedAt.timeIntervalSince1970)"
        return SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private static func safeURL(_ value: String?, fallback: URL) -> URL {
        guard let value, let url = URL(string: value), url.scheme?.lowercased() == "https" else { return fallback }
        // A status item may point at a provider's own canonical status host;
        // otherwise keep the verified feed URL rather than opening redirects.
        let host = url.host?.lowercased() ?? ""
        let fallbackHost = fallback.host?.lowercased() ?? ""
        return host == fallbackHost || host.hasSuffix("." + fallbackHost) ? url : fallback
    }

    public static func resetDate(in text: String) -> Date? {
        // Extract only a timestamp immediately attached to an explicit usage
        // reset clause, never a publication/incident time elsewhere in the text.
        let pattern = #"(?i)(?:quota|usage|token|rate[ -]?limit|usage[ -]?limit|credits?|한도|사용량|토큰)[^.!?\n]{0,60}?(?:reset(?:s|ting)?|리셋|초기화)\s*(?:at|on|:|시각|시간)?\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let matches = regex.matches(in: text, range: NSRange(text.startIndex..., in: text))
        let dates = Set(matches.compactMap { match -> Date? in
            guard let r = Range(match.range(at: 1), in: text) else { return nil }
            return date(String(text[r]))
        })
        return dates.count == 1 ? dates.first : nil
    }

    private static func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        let precise = ISO8601DateFormatter()
        precise.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let parsed = precise.date(from: value) { return parsed }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let parsed = plain.date(from: value) { return parsed }
        let rfc822 = DateFormatter()
        rfc822.locale = Locale(identifier: "en_US_POSIX")
        rfc822.timeZone = TimeZone(secondsFromGMT: 0)
        rfc822.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        if let parsed = rfc822.date(from: value) { return parsed }
        rfc822.dateFormat = "MMM d, yyyy"
        return rfc822.date(from: value)
    }

    private static func bounded(_ value: String, limit: Int) -> String {
        guard value.count > limit else { return value }
        return String(value.prefix(limit)) + "…"
    }

    private static func plainText(_ html: String) -> String {
        html.replacingOccurrences(of: #"<[^>]*>"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: "&amp;", with: "&").replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'").replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Strictly reads visible newsroom cards; script/Next data is never run.
    public static func parseNewsroom(data: Data, source: FrontierMonitorSource,
                                    detectedAt: Date = Date()) -> [FrontierNewsItem] {
        guard source.provider == .anthropic, let html = String(data: data, encoding: .utf8),
              let links = try? NSRegularExpression(pattern: #"<a\b[^>]*href="(/news/[^"?#]+)"[^>]*>([\s\S]*?)</a>"#) else { return [] }
        func capture(_ pattern: String, in text: String) -> String? {
            guard let r = try? NSRegularExpression(pattern: pattern),
                  let m = r.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
                  let range = Range(m.range(at: 1), in: text) else { return nil }
            return String(text[range])
        }
        var seen = Set<String>()
        return links.matches(in: html, range: NSRange(html.startIndex..., in: html)).prefix(150).compactMap { match in
            guard let pathRange = Range(match.range(at: 1), in: html), let bodyRange = Range(match.range(at: 2), in: html) else { return nil }
            let path = String(html[pathRange]), body = String(html[bodyRange])
            guard let rawDate = capture(#"<time\b[^>]*>([\s\S]*?)</time>"#, in: body),
                  let published = date(plainText(rawDate)),
                  let titleHTML = capture(#"<h[1-6]\b[^>]*>([\s\S]*?)</h[1-6]>"#, in: body)
                    ?? capture(#"<span\b[^>]*class="[^"]*__title[^"]*"[^>]*>([\s\S]*?)</span>"#, in: body),
                  seen.insert(path).inserted else { return nil }
            let title = bounded(plainText(titleHTML), limit: 240)
            let summary = bounded(plainText(capture(#"<p\b[^>]*>([\s\S]*?)</p>"#, in: body) ?? ""), limit: 2000)
            let url = safeURL(URL(string: path, relativeTo: source.endpoint)?.absoluteURL.absoluteString, fallback: source.endpoint)
            return FrontierNewsItem(id: source.id + ":" + path, provider: source.provider, title: title, summary: summary,
                sourceURL: url, publishedAt: published, detectedAt: detectedAt, kind: classify(title: title, summary: summary),
                resetAt: resetDate(in: title + "\n" + summary))
        }
    }
}

private final class FrontierRedirectGuard: NSObject, URLSessionTaskDelegate, Sendable {
    let host: String?
    init(host: String?) { self.host = host?.lowercased() }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(request.url?.scheme == "https" && request.url?.host?.lowercased() == host ? request : nil)
    }
}

private final class RSSParser: NSObject, XMLParserDelegate, @unchecked Sendable {
    struct Entry: Sendable {
        var title = ""
        var summary = ""
        var link: String?
        var guid: String?
        var published: String?
    }

    private let data: Data
    private var text = ""
    private var current = Entry()
    private var insideEntry = false
    private var parsedEntries: [Entry] = []
    private var recognizedRoot = false
    private var rootSeen = false
    private var stack: [(name: String, text: String)] = []
    var entries: [Entry] { parsedEntries }

    init(data: Data) { self.data = data }

    func parse() -> Bool {
        let parser = XMLParser(data: data)
        parser.delegate = self
        parser.shouldResolveExternalEntities = false
        return parser.parse() && recognizedRoot
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?,
                attributes attributeDict: [String: String] = [:]) {
        let name = (qName ?? elementName).lowercased()
        if !rootSeen { rootSeen = true; recognizedRoot = name == "rss" || name == "feed" }
        stack.append((name, ""))
        if name == "item" || name == "entry" {
            insideEntry = true
            current = Entry()
        }
        text = ""
        if name == "link", let href = attributeDict["href"], insideEntry { current.link = href }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        guard insideEntry else { return }
        guard !stack.isEmpty else { return }
        stack[stack.count - 1].text = String((stack[stack.count - 1].text + string).prefix(4096))
    }

    func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
        guard insideEntry else { return }
        self.parser(parser, foundCharacters: String(decoding: CDATABlock.prefix(4096), as: UTF8.self))
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?) {
        let name = (qName ?? elementName).lowercased()
        let ended = stack.popLast()?.text ?? ""
        if !stack.isEmpty { stack[stack.count - 1].text = String((stack[stack.count - 1].text + ended).prefix(4096)) }
        guard insideEntry else { return }
        let value = ended.trimmingCharacters(in: .whitespacesAndNewlines)
        switch name {
        case "title": current.title = value
        case "description", "summary", "content": current.summary = value
        case "link": if current.link == nil, !value.isEmpty { current.link = value }
        case "guid", "id": current.guid = value
        case "pubdate", "published", "updated": current.published = value
        case "item", "entry":
            if !current.title.isEmpty { parsedEntries.append(current) }
            insideEntry = false
        default: break
        }
        text = ""
    }
}
