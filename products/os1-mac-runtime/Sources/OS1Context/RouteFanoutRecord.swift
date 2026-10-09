import Foundation

/// The hash-bound local receipt is the authority for a fan-out's execution
/// details. Schema 1 records remain readable without inventing the fields the
/// older runtime did not preserve. Answers and stderr are deliberately absent.
/// Schema 3 adds a separately observed public-browser transport; it never
/// turns that evidence into a native transcript or changes schemas 1/2.
public struct RouteFanoutRecord: Codable, Equatable, Sendable {
    public let schema: Int
    public let operationID: String
    public let operation: String
    public let checkedAt: String?
    public let modelInvoked: Bool
    public let monitorTaskID: String?
    public let frame: [String]?
    public let resultSHA256: String
    public let routes: [RouteFanoutRouteEvidence]

    public init(schema: Int = 2, operationID: String, operation: String = "route_fanout",
                checkedAt: String? = nil, modelInvoked: Bool = false, monitorTaskID: String? = nil,
                frame: [String]? = nil, resultSHA256: String, routes: [RouteFanoutRouteEvidence]) {
        self.schema = schema
        self.operationID = operationID
        self.operation = operation
        self.checkedAt = checkedAt
        self.modelInvoked = modelInvoked
        self.monitorTaskID = monitorTaskID
        self.frame = frame
        self.resultSHA256 = resultSHA256
        self.routes = routes
    }

    /// Provider invocation is observed independently of result adoption. The
    /// two native adapters expose different receipts: Codex has a turn UUID;
    /// Claude proves the current turn through its fresh/pinned session and
    /// persisted transcript probe, and legitimately has no turn UUID.
    public static func observedNativeInvocation(in routes: [RouteFanoutRouteEvidence]) -> Bool {
        func observed(provider: String?, sessionID: String?, native: RouteFanoutNativeRecordEvidence?) -> Bool {
            guard let native, native.persistence == "verified", let path = native.recordPath,
                  !path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
            switch provider {
            case "codex": return native.turnID.flatMap(UUID.init(uuidString:)) != nil
            case "claude": return sessionID.flatMap(UUID.init(uuidString:)) != nil
            default: return false
            }
        }
        return routes.contains { route in
            observed(provider: route.provider, sessionID: route.sessionID, native: route.nativeRecord) ||
                (route.attempts ?? []).contains { attempt in
                    observed(provider: attempt.provider, sessionID: attempt.sessionID, native: attempt.nativeRecord)
                }
        }
    }

    /// Schema 3 invocation evidence includes a matching ordinary ChatGPT
    /// browser response. The App must separately inspect the actual private
    /// receipt bytes. This shape check does not prove usage or output quality.
    /// Schemas 1/2 continue to call observedNativeInvocation unchanged.
    public static func observedAnyInvocation(in routes: [RouteFanoutRouteEvidence]) -> Bool {
        observedNativeInvocation(in: routes) || routes.contains { route in
            route.surface == "chatgpt" && route.executedSurface == "chatgpt" && route.provider == "chatgpt" &&
                route.exitCode == 0 && route.revasDisposition == "adopted" && route.nativeRecord == nil &&
                route.browserRecord?.matches(payloadSHA256: route.payloadSHA256, resultSHA256: route.resultSHA256) == true
        }
    }

    enum CodingKeys: String, CodingKey {
        case schema, operation, frame, routes
        case operationID = "operation_id"
        case checkedAt = "checked_at"
        case modelInvoked = "model_invoked"
        case monitorTaskID = "monitor_task_id"
        case resultSHA256 = "result_sha256"
    }
}

/// Public fields copied from an observed browser transport result, not a model
/// claim. Unlike native evidence this object has no native turn/session UUID,
/// transcript persistence, model/effort, quota, or reference-parity assertion.
public struct RouteFanoutBrowserRecordEvidence: Codable, Equatable, Sendable {
    public enum Mode: String, Codable, Sendable { case chat }
    public enum State: String, Codable, Sendable {
        case approvalRequired = "approval_required", ready, returned, blocked
    }
    public let mode: Mode
    public let state: State
    /// Exact per-target payload hash, not the entire parent's fan-out request.
    public let requestSHA256: String
    public let responseSHA256: String
    public let conversationURL: String
    public let receiptPath: String
    public let policyProjectionSHA256: String?

    public init(mode: Mode = .chat, state: State = .returned, requestSHA256: String,
                responseSHA256: String, conversationURL: String, receiptPath: String,
                policyProjectionSHA256: String? = nil) {
        self.mode = mode; self.state = state; self.requestSHA256 = requestSHA256
        self.responseSHA256 = responseSHA256; self.conversationURL = conversationURL
        self.receiptPath = receiptPath; self.policyProjectionSHA256 = policyProjectionSHA256
    }

    /// Syntactic evidence only. The host/App verifies private receipt custody,
    /// actual request/response/projection bytes and completion before adoption.
    public var isReturnedObservation: Bool {
        guard mode == .chat, state == .returned, Self.validSHA(requestSHA256), Self.validSHA(responseSHA256),
              policyProjectionSHA256.map(Self.validSHA) ?? true,
              receiptPath.hasPrefix("/"), !receiptPath.hasPrefix("//"), receiptPath.utf8.count <= 4_096,
              receiptPath.rangeOfCharacter(from: .controlCharacters) == nil,
              URL(fileURLWithPath: receiptPath).pathExtension == "json",
              !receiptPath.split(separator: "/").contains(".."),
              let url = URLComponents(string: conversationURL), url.scheme == "https", url.host == "chatgpt.com",
              url.user == nil, url.password == nil, url.port == nil || url.port == 443,
              url.query == nil, url.fragment == nil else { return false }
        return url.path == "/" || url.path.range(of: #"^/c/[A-Za-z0-9_-]+/?$"#, options: .regularExpression) != nil
    }
    public func matches(payloadSHA256: String, resultSHA256: String?) -> Bool {
        isReturnedObservation && requestSHA256 == payloadSHA256 && responseSHA256 == resultSHA256
    }
    private static func validSHA(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
    enum CodingKeys: String, CodingKey {
        case mode, state
        case requestSHA256 = "request_sha256", responseSHA256 = "response_sha256"
        case conversationURL = "conversation_url", receiptPath = "receipt_path"
        case policyProjectionSHA256 = "policy_projection_sha256"
    }
}

public struct RouteFanoutNativeRecordEvidence: Codable, Equatable, Sendable {
    public let turnID: String?
    public let recordPath: String?
    public let persistence: String
    public let desktopVisibility: String

    public init(turnID: String? = nil, recordPath: String? = nil, persistence: String,
                desktopVisibility: String) {
        self.turnID = turnID
        self.recordPath = recordPath
        self.persistence = persistence
        self.desktopVisibility = desktopVisibility
    }

    public var isVerified: Bool { persistence == "verified" }

    enum CodingKeys: String, CodingKey {
        case turnID = "turn_id"
        case recordPath = "record_path"
        case persistence
        case desktopVisibility = "desktop_visibility"
    }
}

/// Only observations returned by the executor, not a reconstructed model
/// trace. A returned rejected or reviewed step is preserved separately from
/// the route's adopted answer. If execution threw, no attempt is fabricated.
public struct RouteFanoutAttemptEvidence: Codable, Equatable, Sendable {
    public let sequence: Int
    public let provider: String
    public let action: String
    public let model: String?
    public let effort: String
    public let revasDisposition: String
    public let sessionID: String
    public let permissionProfile: String
    public let exitCode: Int32
    public let durationMS: Int64
    public let surface: String?
    public let nativeRecord: RouteFanoutNativeRecordEvidence?
    public let reviewedDraft: String?
    public let resultSHA256: String

    public init(sequence: Int, provider: String, action: String, model: String? = nil,
                effort: String, revasDisposition: String, sessionID: String,
                permissionProfile: String, exitCode: Int32, durationMS: Int64,
                surface: String? = nil, nativeRecord: RouteFanoutNativeRecordEvidence? = nil,
                reviewedDraft: String? = nil, resultSHA256: String) {
        self.sequence = sequence
        self.provider = provider
        self.action = action
        self.model = model
        self.effort = effort
        self.revasDisposition = revasDisposition
        self.sessionID = sessionID
        self.permissionProfile = permissionProfile
        self.exitCode = exitCode
        self.durationMS = durationMS
        self.surface = surface
        self.nativeRecord = nativeRecord
        self.reviewedDraft = reviewedDraft
        self.resultSHA256 = resultSHA256
    }

    enum CodingKeys: String, CodingKey {
        case sequence, provider, action, model, effort, surface
        case revasDisposition = "revas_disposition"
        case sessionID = "session_id"
        case permissionProfile = "permission_profile"
        case exitCode = "exit_code"
        case durationMS = "duration_ms"
        case nativeRecord = "native_record"
        case reviewedDraft = "reviewed_draft"
        case resultSHA256 = "result_sha256"
    }
}

public struct RouteFanoutRouteEvidence: Codable, Equatable, Sendable {
    public let index: Int
    /// Requested surface. Keep the schema 1 key; never relabel actual execution.
    public let surface: String
    /// Route processing start order. A batched handoff shares its one start.
    /// This does not, by itself, prove a provider invocation.
    public let executionIndex: Int?
    public let payload: String?
    public let payloadSHA256: String
    public let provider: String?
    public let executedSurface: String?
    public let sessionID: String?
    public let model: String?
    public let action: String?
    public let effort: String?
    public let permissionProfile: String?
    public let exitCode: Int32?
    public let durationMS: Int64?
    public let revasDisposition: String?
    public let nativeRecord: RouteFanoutNativeRecordEvidence?
    /// Schema 3 only; never a replacement native-record proof for old schemas.
    public let browserRecord: RouteFanoutBrowserRecordEvidence?
    public let resultSHA256: String?
    public let failure: String?
    public let handoffReceipt: String?
    public let attempts: [RouteFanoutAttemptEvidence]?

    public init(index: Int, surface: String, executionIndex: Int? = nil, payload: String? = nil,
                payloadSHA256: String, provider: String? = nil, executedSurface: String? = nil,
                sessionID: String? = nil, model: String? = nil, action: String? = nil,
                effort: String? = nil, permissionProfile: String? = nil, exitCode: Int32? = nil,
                durationMS: Int64? = nil, revasDisposition: String? = nil,
                nativeRecord: RouteFanoutNativeRecordEvidence? = nil, resultSHA256: String? = nil,
                failure: String? = nil, handoffReceipt: String? = nil,
                attempts: [RouteFanoutAttemptEvidence]? = nil,
                browserRecord: RouteFanoutBrowserRecordEvidence? = nil) {
        self.index = index
        self.surface = surface
        self.executionIndex = executionIndex
        self.payload = payload
        self.payloadSHA256 = payloadSHA256
        self.provider = provider
        self.executedSurface = executedSurface
        self.sessionID = sessionID
        self.model = model
        self.action = action
        self.effort = effort
        self.permissionProfile = permissionProfile
        self.exitCode = exitCode
        self.durationMS = durationMS
        self.revasDisposition = revasDisposition
        self.nativeRecord = nativeRecord
        self.browserRecord = browserRecord
        self.resultSHA256 = resultSHA256
        self.failure = failure
        self.handoffReceipt = handoffReceipt
        self.attempts = attempts
    }

    enum CodingKeys: String, CodingKey {
        case index, surface, payload, provider, model, action, effort, failure, attempts
        case executionIndex = "execution_index"
        case payloadSHA256 = "payload_sha256"
        case executedSurface = "executed_surface"
        case sessionID = "session_id"
        case permissionProfile = "permission_profile"
        case exitCode = "exit_code"
        case durationMS = "duration_ms"
        case revasDisposition = "revas_disposition"
        case nativeRecord = "native_record"
        case browserRecord = "browser_record"
        case resultSHA256 = "result_sha256"
        case handoffReceipt = "handoff_receipt"
    }
}
