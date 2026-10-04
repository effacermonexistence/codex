import Foundation

/// Content-free observations of a native transport. A tool request is not
/// proof it executed; a returned result is not proof of task success. Dates
/// are local receipt times, never reconstructed internal/cause timestamps.
public struct NativeExecutionProgress: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case ready, responseStarted, processing, toolStarted, toolReturned, toolFailed, toolWorking, responseBoundary, retrying
    }
    public struct Event: Codable, Equatable, Sendable {
        public let sequence: Int
        public let kind: Kind
        public let tool: String?
        public let scope: String
        public let observedAt: Date
        public init(sequence: Int, kind: Kind, tool: String?, scope: String, observedAt: Date) {
            self.sequence = sequence; self.kind = kind; self.tool = tool
            self.scope = scope; self.observedAt = observedAt
        }
    }
    public let sequence: Int
    public let kind: Kind
    public let tool: String?
    public let scope: String
    public let toolsRequested: Int
    public let toolsReturned: Int
    /// Identified observed requests with no matching returned signal yet.
    /// This does not certify that all these tools are currently running.
    public let activeTools: Int
    public let observedAt: Date
    public let events: [Event]

    public init(sequence: Int, kind: Kind, tool: String?, scope: String,
                toolsRequested: Int, toolsReturned: Int, activeTools: Int,
                observedAt: Date, events: [Event]) {
        self.sequence = sequence; self.kind = kind; self.tool = tool; self.scope = scope
        self.toolsRequested = toolsRequested; self.toolsReturned = toolsReturned
        self.activeTools = activeTools; self.observedAt = observedAt; self.events = events
    }

    public static func safeToolName(_ name: String) -> Bool {
        !name.isEmpty && name.count <= 96 && name.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.contains($0) || "_-".unicodeScalars.contains($0)
        }
    }
    private static func safeScope(_ scope: String) -> Bool {
        scope == "main" || scope.range(of: #"^subagent:[0-9a-f]{12}$"#, options: .regularExpression) != nil
    }
    public var isValid: Bool {
        guard (1...1_000_000).contains(sequence), Self.safeScope(scope),
              tool.map(Self.safeToolName) ?? true,
              (0...sequence).contains(toolsRequested), (0...toolsRequested).contains(toolsReturned),
              activeTools == toolsRequested - toolsReturned,
              observedAt.timeIntervalSince1970.isFinite,
              (1...12).contains(events.count), events.last?.sequence == sequence,
              events.last?.kind == kind, events.last?.tool == tool, events.last?.scope == scope,
              events.last?.observedAt == observedAt else { return false }
        var prior = 0
        for event in events {
            guard event.sequence > prior, event.sequence <= sequence,
                  Self.safeScope(event.scope), event.tool.map(Self.safeToolName) ?? true,
                  event.observedAt.timeIntervalSince1970.isFinite else { return false }
            prior = event.sequence
        }
        return true
    }

    private enum CodingKeys: String, CodingKey {
        case sequence, kind, tool, scope, toolsRequested, toolsReturned, activeTools, observedAt, events
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(sequence: try c.decode(Int.self, forKey: .sequence), kind: try c.decode(Kind.self, forKey: .kind),
            tool: try c.decodeIfPresent(String.self, forKey: .tool), scope: try c.decode(String.self, forKey: .scope),
            toolsRequested: try c.decode(Int.self, forKey: .toolsRequested), toolsReturned: try c.decode(Int.self, forKey: .toolsReturned),
            activeTools: try c.decode(Int.self, forKey: .activeTools), observedAt: try c.decode(Date.self, forKey: .observedAt),
            events: try c.decode([Event].self, forKey: .events))
        guard isValid else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid native progress metadata"))
        }
    }
}
