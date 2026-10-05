import Foundation

/// Observations of a native transport. A tool request is not proof it
/// executed; a returned result is not proof of task success. Dates are local
/// receipt times, never reconstructed internal/cause timestamps.
///
/// Lifecycle events stay content-free. `steps` carry the backend's own
/// redacted words for each tool call (see `NativeStepLabel`); thinking, tool
/// results/outputs, file contents and prompts never enter this record.
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
    /// One tool call, as Claude Code lists it while the backend works. Kept
    /// in its own ring so "processing" signals cannot push steps out.
    public struct Step: Codable, Equatable, Sendable {
        public enum State: String, Codable, Sendable { case requested, returned, failed }
        /// 12-hex digest of provider:scope:toolID, never the raw tool id.
        public let id: String
        /// Progress sequence at which the request (or first sight) was received.
        public let sequence: Int
        public let tool: String
        public let scope: String
        /// Fixed `NativeStepLabel.Verb` code tied to the tool identity; the app
        /// renders it. Unknown codes from a newer runtime are shown without it.
        public internal(set) var verb: String?
        /// The backend's redacted description/path/query; nil until one arrives.
        public internal(set) var label: String?
        /// Subagent tool calls reported by the backend's own task progress.
        public internal(set) var childToolUses: Int?
        public internal(set) var lastChildTool: String?
        public internal(set) var state: State
        public let startedAt: Date
        public internal(set) var endedAt: Date?

        public init(id: String, sequence: Int, tool: String, scope: String, verb: String? = nil, label: String? = nil,
                    childToolUses: Int? = nil, lastChildTool: String? = nil, state: State = .requested,
                    startedAt: Date, endedAt: Date? = nil) {
            self.id = id; self.sequence = sequence; self.tool = tool; self.scope = scope
            self.verb = verb; self.label = label; self.childToolUses = childToolUses; self.lastChildTool = lastChildTool
            self.state = state; self.startedAt = startedAt; self.endedAt = endedAt
        }

        public var isValid: Bool {
            id.range(of: #"^[0-9a-f]{12}$"#, options: .regularExpression) != nil &&
                (1...1_000_000).contains(sequence) && NativeExecutionProgress.safeToolName(tool) &&
                NativeExecutionProgress.safeScope(scope) &&
                (verb.map { $0.range(of: #"^[A-Za-z]{1,24}$"#, options: .regularExpression) != nil } ?? true) &&
                (label.map(NativeStepLabel.isDisplayable) ?? true) &&
                (childToolUses.map { (0...1_000_000).contains($0) } ?? true) &&
                (lastChildTool.map(NativeExecutionProgress.safeToolName) ?? true) &&
                startedAt.timeIntervalSince1970.isFinite && (endedAt?.timeIntervalSince1970.isFinite ?? true) &&
                (state == .requested) == (endedAt == nil)
        }

        private enum CodingKeys: String, CodingKey {
            case id, sequence, tool, scope, verb, label, childToolUses, lastChildTool, state, startedAt, endedAt
        }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            // Defence in depth: whatever reached the file is redacted again here.
            let label = try c.decodeIfPresent(String.self, forKey: .label).flatMap(NativeStepLabel.redact)
            let verb = try c.decodeIfPresent(String.self, forKey: .verb)
            self.init(id: try c.decode(String.self, forKey: .id), sequence: try c.decode(Int.self, forKey: .sequence),
                tool: try c.decode(String.self, forKey: .tool), scope: try c.decode(String.self, forKey: .scope),
                verb: label == nil ? nil : verb, label: label,
                childToolUses: try c.decodeIfPresent(Int.self, forKey: .childToolUses),
                lastChildTool: try c.decodeIfPresent(String.self, forKey: .lastChildTool),
                state: try c.decode(State.self, forKey: .state), startedAt: try c.decode(Date.self, forKey: .startedAt),
                endedAt: try c.decodeIfPresent(Date.self, forKey: .endedAt))
            guard isValid else {
                throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid native step"))
            }
        }
    }
    public static let maximumSteps = 24
    /// Backend status words relayed as-is (Claude `system/status`).
    public static let backendStatuses: Set<String> = ["compacting"]

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
    /// Latest tool steps, oldest first, at most `maximumSteps`.
    public let steps: [Step]?
    /// A backend status word such as "compacting"; nil when none is active.
    public let backendStatus: String?

    public init(sequence: Int, kind: Kind, tool: String?, scope: String,
                toolsRequested: Int, toolsReturned: Int, activeTools: Int,
                observedAt: Date, events: [Event], steps: [Step]? = nil, backendStatus: String? = nil) {
        self.sequence = sequence; self.kind = kind; self.tool = tool; self.scope = scope
        self.toolsRequested = toolsRequested; self.toolsReturned = toolsReturned
        self.activeTools = activeTools; self.observedAt = observedAt; self.events = events
        self.steps = steps; self.backendStatus = backendStatus
    }

    /// Same lifecycle observation with a different step ring or status word.
    public func replacing(steps: [Step]?, backendStatus: String?) -> NativeExecutionProgress {
        NativeExecutionProgress(sequence: sequence, kind: kind, tool: tool, scope: scope, toolsRequested: toolsRequested,
            toolsReturned: toolsReturned, activeTools: activeTools, observedAt: observedAt, events: events,
            steps: steps, backendStatus: backendStatus)
    }

    static func validSteps(_ steps: [Step], sequence: Int) -> Bool {
        guard steps.count <= maximumSteps, Set(steps.map(\.id)).count == steps.count else { return false }
        var prior = 0
        for step in steps {
            guard step.isValid, step.sequence > prior, step.sequence <= sequence else { return false }
            prior = step.sequence
        }
        return true
    }

    public static func safeToolName(_ name: String) -> Bool {
        !name.isEmpty && name.count <= 96 && name.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.contains($0) || "_-".unicodeScalars.contains($0)
        }
    }
    static func safeScope(_ scope: String) -> Bool {
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
              events.last?.observedAt == observedAt,
              steps.map({ Self.validSteps($0, sequence: sequence) }) ?? true,
              backendStatus.map(Self.backendStatuses.contains) ?? true else { return false }
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
        case sequence, kind, tool, scope, toolsRequested, toolsReturned, activeTools, observedAt, events, steps, backendStatus
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let sequence = try c.decode(Int.self, forKey: .sequence)
        // Steps and status are optional display text: a malformed or unknown
        // shape drops only them, never the lifecycle telemetry beside them.
        let steps = (try? c.decodeIfPresent([Step].self, forKey: .steps))
            .flatMap { Self.validSteps($0, sequence: sequence) ? $0 : nil }
        let status = (try? c.decodeIfPresent(String.self, forKey: .backendStatus))
            .flatMap { Self.backendStatuses.contains($0) ? $0 : nil }
        self.init(sequence: sequence, kind: try c.decode(Kind.self, forKey: .kind),
            tool: try c.decodeIfPresent(String.self, forKey: .tool), scope: try c.decode(String.self, forKey: .scope),
            toolsRequested: try c.decode(Int.self, forKey: .toolsRequested), toolsReturned: try c.decode(Int.self, forKey: .toolsReturned),
            activeTools: try c.decode(Int.self, forKey: .activeTools), observedAt: try c.decode(Date.self, forKey: .observedAt),
            events: try c.decode([Event].self, forKey: .events), steps: steps, backendStatus: status)
        guard isValid else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid native progress metadata"))
        }
    }
}
