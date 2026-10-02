import Foundation

/// The hash-bound local receipt is the authority for a fan-out's execution
/// details. Schema 1 records remain readable without inventing the fields the
/// older runtime did not preserve. Answers and stderr are deliberately absent.
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

    enum CodingKeys: String, CodingKey {
        case schema, operation, frame, routes
        case operationID = "operation_id"
        case checkedAt = "checked_at"
        case modelInvoked = "model_invoked"
        case monitorTaskID = "monitor_task_id"
        case resultSHA256 = "result_sha256"
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
                attempts: [RouteFanoutAttemptEvidence]? = nil) {
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
        case resultSHA256 = "result_sha256"
        case handoffReceipt = "handoff_receipt"
    }
}
