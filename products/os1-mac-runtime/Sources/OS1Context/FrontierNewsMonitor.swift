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
    public enum Format: String, Codable, Sendable { case statuspageJSON, rss }

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

public struct FrontierMonitorPollResult: Sendable {
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
    public static let displayWindow: TimeInterval = 7 * 24 * 60 * 60

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
    private let session: URLSession
    private var state: PersistedState

    public init(storageRoot: URL? = nil, sources: [FrontierMonitorSource] = FrontierMonitorSource.firstParty,
                session: URLSession = .shared) {
        self.sources = sources
        self.session = session
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
        var fresh: [FrontierNewsItem] = []
        var statuses: [FrontierSourceStatus] = []
        var changed = false

        for source in sources {
            let checked = await fetch(source: source, now: now)
            statuses.append(checked.status)
            guard checked.status.available else { continue }
            if checked.notModified { continue }
            if !checked.items.isEmpty {
                for item in checked.items {
                    if state.seen[item.id] == nil {
                        state.seen[item.id] = now
                        fresh.append(item)
                        changed = true
                    }
                }
                let known = Set(state.items.map(\.id))
                state.items.append(contentsOf: checked.items.filter { !known.contains($0.id) })
                changed = true
            }
        }

        let cutoff = now.addingTimeInterval(-Self.displayWindow)
        let beforeCount = state.items.count
        state.items = state.items
            .filter { $0.publishedAt >= cutoff }
            .sorted { $0.publishedAt > $1.publishedAt }
            .prefix(100)
            .map { $0 }
        state.seen = state.seen.filter { $0.value >= cutoff }
        changed = changed || beforeCount != state.items.count || state.statuses != statuses
        state.statuses = statuses
        state.lastPollAt = now
        try? persist()

        return FrontierMonitorPollResult(completedAt: now, newItems: fresh.sorted { $0.publishedAt > $1.publishedAt },
                                         items: state.items, sourceStatuses: statuses, didChange: changed)
    }

    private struct FetchResult: Sendable {
        let status: FrontierSourceStatus
        let items: [FrontierNewsItem]
        let notModified: Bool
    }

    private func fetch(source: FrontierMonitorSource, now: Date) async -> FetchResult {
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
        request.setValue(source.format == .rss ? "application/rss+xml, application/xml, text/xml" : "application/json",
                         forHTTPHeaderField: "Accept")
        if let cursor = state.cursors[source.id] {
            if let etag = cursor.etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
            if let lastModified = cursor.lastModified { request.setValue(lastModified, forHTTPHeaderField: "If-Modified-Since") }
        }

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return FetchResult(status: sourceStatusBase(false, "HTTP 응답을 확인하지 못함", nil), items: [], notModified: false)
            }
            state.cursors[source.id] = SourceCursor(
                etag: http.value(forHTTPHeaderField: "ETag") ?? state.cursors[source.id]?.etag,
                lastModified: http.value(forHTTPHeaderField: "Last-Modified") ?? state.cursors[source.id]?.lastModified
            )
            if http.statusCode == 304 {
                return FetchResult(status: sourceStatusBase(true, "변경 없음 · 조건부 요청 확인", http.statusCode), items: [], notModified: true)
            }
            guard (200..<300).contains(http.statusCode) else {
                return FetchResult(status: sourceStatusBase(false, "공식 원본 응답 오류", http.statusCode), items: [], notModified: false)
            }
            guard data.count <= 2_000_000 else {
                return FetchResult(status: sourceStatusBase(false, "응답 크기 제한 초과", http.statusCode), items: [], notModified: false)
            }
            let items: [FrontierNewsItem]
            if source.format == .rss {
                items = Self.parseFeed(data: data, source: source, detectedAt: now)
            } else {
                items = Self.parseStatusPage(data: data, source: source, detectedAt: now)
            }
            return FetchResult(status: sourceStatusBase(true, "공식 원본 확인 · \(items.count)개 항목", http.statusCode), items: items, notModified: false)
        } catch {
            return FetchResult(status: sourceStatusBase(false, "공식 원본을 확인하지 못함", nil), items: [], notModified: false)
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
                let published = date(incident.createdAt ?? incident.updatedAt) ?? detectedAt
                let sourceURL = safeURL(incident.shortlink, fallback: source.endpoint)
                let combined = "\(title)\n\(body)"
                let kind = classify(title: title, summary: body, status: incident.status)
                let reset = explicitISODate(in: combined)
                let providerID = incident.id?.trimmingCharacters(in: .whitespacesAndNewlines)
                let identity = providerID?.isEmpty == false ? providerID! : fingerprint(provider: source.provider,
                    title: title, summary: body, publishedAt: published)
                return FrontierNewsItem(id: "\(source.provider.rawValue):\(identity)", provider: source.provider,
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
            let aiWords = ["ai", "gemini", "vertex", "machine learning", "generative", "model"]
            guard !title.isEmpty, aiWords.contains(where: combined.lowercased().contains) else { return nil }
            let published = date(object["begin"] as? String ?? object["created"] as? String ?? object["modified"] as? String) ?? detectedAt
            let identity: String
            if let objectID = (object["id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !objectID.isEmpty {
                identity = objectID
            } else {
                identity = fingerprint(provider: source.provider, title: title, summary: body, publishedAt: published)
            }
            return FrontierNewsItem(id: "\(source.provider.rawValue):\(identity)", provider: source.provider,
                                    title: title, summary: body, sourceURL: source.endpoint, publishedAt: published,
                                    detectedAt: detectedAt, kind: classify(title: title, summary: body),
                                    resetAt: explicitISODate(in: combined))
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
            let body = bounded(entry.summary.trimmingCharacters(in: .whitespacesAndNewlines), limit: 2_000)
            let published = date(entry.published) ?? detectedAt
            let identity: String
            if let guid = entry.guid?.trimmingCharacters(in: .whitespacesAndNewlines), !guid.isEmpty {
                identity = guid
            } else {
                identity = fingerprint(provider: source.provider, title: title, summary: body, publishedAt: published)
            }
            let url = safeURL(entry.link, fallback: source.endpoint)
            return FrontierNewsItem(id: "\(source.provider.rawValue):\(identity)", provider: source.provider,
                                    title: title, summary: body, sourceURL: url, publishedAt: published,
                                    detectedAt: detectedAt, kind: classify(title: title, summary: body),
                                    resetAt: explicitISODate(in: "\(title)\n\(body)"))
        }
    }

    public static func classify(title: String, summary: String, status: String? = nil) -> FrontierSignalKind {
        let value = "\(title) \(summary)".folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            .lowercased()
        let resetWords = ["reset", "resets", "quota", "usage limit", "rate limit", "rate-limit", "credits", "token limit", "five-hour", "5-hour", "context window", "사용량", "한도", "리셋", "토큰"]
        if resetWords.contains(where: value.contains) {
            return value.contains("reset") || value.contains("리셋") ? .tokenReset : .usageLimit
        }
        if status.map({ ["resolved", "postmortem"].contains($0.lowercased()) }) == true {
            return .incident
        }
        return .incident
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

    private static func explicitISODate(in text: String) -> Date? {
        let pattern = #"\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b"#
        guard let range = text.range(of: pattern, options: .regularExpression) else { return nil }
        return date(String(text[range]))
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
        return rfc822.date(from: value)
    }

    private static func bounded(_ value: String, limit: Int) -> String {
        guard value.count > limit else { return value }
        return String(value.prefix(limit)) + "…"
    }

private func parseStatusPage(data: Data, source: FrontierMonitorSource, detectedAt: Date) -> [FrontierNewsItem] {
        Self.parseStatusPage(data: data, source: source, detectedAt: detectedAt)
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
    var entries: [Entry] { parsedEntries }

    init(data: Data) { self.data = data }

    func parse() -> Bool {
        let parser = XMLParser(data: data)
        parser.delegate = self
        return parser.parse()
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?,
                attributes attributeDict: [String: String] = [:]) {
        let name = (qName ?? elementName).lowercased()
        if name == "item" || name == "entry" {
            insideEntry = true
            current = Entry()
        }
        text = ""
        if name == "link", let href = attributeDict["href"], insideEntry { current.link = href }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        guard insideEntry else { return }
        text.append(string)
        if text.count > 4_096 { text = String(text.prefix(4_096)) }
    }

    func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
        guard insideEntry else { return }
        text.append(String(decoding: CDATABlock.prefix(4_096), as: UTF8.self))
        if text.count > 4_096 { text = String(text.prefix(4_096)) }
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?) {
        let name = (qName ?? elementName).lowercased()
        guard insideEntry else { return }
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
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
