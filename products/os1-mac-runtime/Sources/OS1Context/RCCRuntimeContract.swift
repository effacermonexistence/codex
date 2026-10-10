import CryptoKit
import Foundation

/// The wire boundary of the ONE OpenClaw-owned task loop. These values carry
/// facts and proposals; they do not choose models, grant authority, or certify
/// quality. An adapter cannot silently create another plan/retry/fallback.
public enum RCCRuntimeContract {
    public static let schema = 1
    public static let maximumWireBytes = 8_388_608
    public static let maximumNodes = 64
    public enum Rejection: String, Error, Sendable {
        case invalidSchema, invalidIdentity, invalidHash, invalidInput, unsupportedField
        case invalidConfiguration, invalidObservation, invalidPlan, configurationMismatch
        case invalidExecutionRecord, invalidSnapshot, unsupportedBilling, oversized
    }
    public enum Mode: String, Codable, Sendable { case auto, explicitRoutingTest = "explicit_routing_test" }
    public enum Surface: String, Codable, Sendable {
        case chatgpt, codex, claude, local
        case gptChat = "gpt-chat", claudeChat = "claude-chat"
    }
    public enum Transport: String, Codable, Sendable {
        case local, codexAppServer = "codex_app_server", claudeCLI = "claude_cli"
        case chatGPTService = "chatgpt_service", claudeService = "claude_service"
    }
    public enum Effort: String, Codable, Sendable { case none, minimal, low, medium, high, xhigh, max, ultra, ultracode }
    public enum Scope: String, Codable, Sendable { case readOnly = "read_only", workspaceWrite = "workspace_write" }
    public enum QuotaPool: String, Codable, Sendable {
        case none, unknown, openAICodex = "openai_codex", openAIChat = "openai_chat", anthropicShared = "anthropic_shared"
    }
    public enum Availability: String, Codable, Sendable { case available, unavailable, unknown }
    public enum QualityState: String, Codable, Sendable {
        case unverified, mismatch, policyAdmitted = "policy_admitted", exactDomainVerified = "exact_domain_verified"
        case referenceEquivalent = "reference_equivalent", referenceAbove = "reference_above"
    }
    public enum Kind: String, Codable, Sendable { case agent, deterministic }
    public enum ExecutionStatus: String, Codable, Sendable { case succeeded, failed, effectsUncertain = "effects_uncertain" }
    public enum DispatchStage: String, Codable, Sendable { case notDispatched = "not_dispatched", dispatched, unknown }
    public enum SideEffects: String, Codable, Sendable { case none, possible, confirmed }
    public enum TaskQuality: String, Codable, Sendable { case unverified, executionOnly = "execution_only", taskVerified = "task_verified", failed }
    public enum Parity: String, Codable, Sendable {
        case unverified, mismatch, referenceEquivalent = "reference_equivalent", referenceAbove = "reference_above"
    }
    public enum State: String, Codable, Sendable {
        case queued, planning, running, waiting, cancelling, cancelled, completed, failed, held
        case returnedUnverified = "returned_unverified"
        case effectsUncertain = "effects_uncertain"
    }
    public enum ChildState: String, Codable, Sendable {
        case pending, ready, queued, running, waiting, succeeded, completed, failed, cancelled, held
        case effectsUncertain = "effects_uncertain"
    }
    public enum EventType: String, Codable, Sendable {
        case accepted, planning, planRecorded = "plan_recorded", nodeStarted = "node_started"
        case nodeProgress = "node_progress", nodeReturned = "node_returned", nodeHeld = "node_held"
        case retryPlanned = "retry_planned", cancelRequested = "cancel_requested", cancelled
        case completed, failed, held, snapshot
    }
    public struct Budget: Codable, Equatable, Sendable {
        public var maxAttempts: Int
        public var maxParallel: Int
        public var maxCostUnits: Double?
        public var maxDurationMS: Int64
        public init(maxAttempts: Int, maxParallel: Int, maxCostUnits: Double?, maxDurationMS: Int64) {
            self.maxAttempts = maxAttempts; self.maxParallel = maxParallel
            self.maxCostUnits = maxCostUnits; self.maxDurationMS = maxDurationMS
        }
        enum CodingKeys: String, CodingKey {
            case maxAttempts = "max_attempts", maxParallel = "max_parallel"
            case maxCostUnits = "max_cost_units", maxDurationMS = "max_duration_ms"
        }
    }
    public struct Policy: Codable, Equatable, Sendable {
        public var sourceSHA256: String
        public var projectionSHA256: String
        public var text: String
        public init(sourceSHA256: String, projectionSHA256: String, text: String) {
            self.sourceSHA256 = sourceSHA256; self.projectionSHA256 = projectionSHA256; self.text = text
        }
        enum CodingKeys: String, CodingKey { case sourceSHA256 = "source_sha256", projectionSHA256 = "projection_sha256", text }
    }
    /// A host-parsed explicit user target, never a model-authored route alias.
    /// Ordinary ChatGPT is .chatgpt, not the Codex-funded .gptChat lane.
    public struct ExplicitRoute: Codable, Equatable, Sendable {
        public var surface: Surface
        public var instruction: String
        public init(surface: Surface, instruction: String) { self.surface = surface; self.instruction = instruction }
    }
    public struct HostContext: Codable, Equatable, Sendable {
        public var workspace: String
        public var context: String?
        public var providerPreference: String
        public var codexSessionID: String?
        public var claudeSessionID: String?
        public var requireReadOnly: Bool
        public var ownerPolicy: OwnerPolicySnapshot?
        public var explicitRoutes: [ExplicitRoute]?
        public init(workspace: String, context: String?, providerPreference: String, codexSessionID: String?,
                    claudeSessionID: String?, requireReadOnly: Bool, ownerPolicy: OwnerPolicySnapshot?,
                    explicitRoutes: [ExplicitRoute]? = nil) {
            self.workspace = workspace; self.context = context; self.providerPreference = providerPreference
            self.codexSessionID = codexSessionID; self.claudeSessionID = claudeSessionID
            self.requireReadOnly = requireReadOnly; self.ownerPolicy = ownerPolicy
            self.explicitRoutes = explicitRoutes
        }
        enum CodingKeys: String, CodingKey {
            case workspace, context, providerPreference = "provider_preference", codexSessionID = "codex_session_id"
            case claudeSessionID = "claude_session_id", requireReadOnly = "require_read_only", ownerPolicy = "owner_policy"
            case explicitRoutes = "explicit_routes"
        }
    }
    public struct Request: Codable, Equatable, Sendable {
        public var schema: Int
        public var taskID: String
        public var request: String
        public var requestSHA256: String
        public var objective: String
        public var policySHA256: String
        public var sourceFingerprint: String
        public var mode: Mode
        public var materialRefs: [String]
        public var budget: Budget
        /// Host-preserved source context, not permission to scan arbitrary HOME.
        public var context: String?
        public var workspace: String?
        public var nativeSessions: [String: String]?
        public var providerPreference: String?
        public var policy: Policy?
        public var hostContext: HostContext?
        public init(schema: Int = 1, taskID: String, request: String, requestSHA256: String, objective: String,
                    policySHA256: String, sourceFingerprint: String, mode: Mode, materialRefs: [String], budget: Budget,
                    context: String? = nil, workspace: String? = nil, nativeSessions: [String: String]? = nil,
                    providerPreference: String? = nil, policy: Policy? = nil, hostContext: HostContext? = nil) {
            self.schema = schema; self.taskID = taskID; self.request = request; self.requestSHA256 = requestSHA256
            self.objective = objective; self.policySHA256 = policySHA256; self.sourceFingerprint = sourceFingerprint
            self.mode = mode; self.materialRefs = materialRefs; self.budget = budget; self.context = context
            self.workspace = workspace; self.nativeSessions = nativeSessions; self.providerPreference = providerPreference; self.policy = policy
            self.hostContext = hostContext
        }
        enum CodingKeys: String, CodingKey {
            case schema, request, objective, mode, budget, context, workspace, policy
            case taskID = "task_id", requestSHA256 = "request_sha256", policySHA256 = "policy_sha256"
            case sourceFingerprint = "source_fingerprint", materialRefs = "material_refs", nativeSessions = "native_sessions"
            case providerPreference = "provider_preference"
            case hostContext = "host_context"
        }
    }
    public struct ExactConfig: Codable, Equatable, Sendable {
        public var surface: Surface
        public var transport: Transport
        public var accountID: String
        public var model: String
        public var effort: Effort
        public var tools: [String]
        public var scope: Scope
        public var permissionProfile: Scope
        public var quotaPool: QuotaPool
        public var allowedPaths: [String]
        public var configurationSHA256: String
        public init(surface: Surface, transport: Transport, accountID: String, model: String, effort: Effort,
                    tools: [String], scope: Scope, permissionProfile: Scope, quotaPool: QuotaPool,
                    allowedPaths: [String], configurationSHA256: String) {
            self.surface = surface; self.transport = transport; self.accountID = accountID; self.model = model
            self.effort = effort; self.tools = tools; self.scope = scope; self.permissionProfile = permissionProfile
            self.quotaPool = quotaPool; self.allowedPaths = allowedPaths; self.configurationSHA256 = configurationSHA256
        }
        enum CodingKeys: String, CodingKey {
            case surface, transport, model, effort, tools, scope
            case accountID = "account_id", permissionProfile = "permission_profile", quotaPool = "quota_pool"
            case allowedPaths = "allowed_paths", configurationSHA256 = "configuration_sha256"
        }
    }
    /// Flat descriptor mirrors the core catalog. Unknown quota/cost are null;
    /// neither unknown nor a product label implies a free execution resource.
    public struct Candidate: Codable, Equatable, Sendable {
        public var id: String
        public var surface: Surface
        public var transport: Transport
        public var accountID: String
        public var model: String
        public var effort: Effort
        public var tools: [String]
        public var scope: Scope
        public var permissionProfile: Scope
        public var quotaPool: QuotaPool
        public var quotaRemainingFraction: Double?
        public var quotaObservedAtMS: Int64?
        public var quotaValidUntilMS: Int64?
        public var qualityState: QualityState
        public var configurationSHA256: String
        public var allowedPaths: [String]
        public var estimatedCostUnits: Double?
        public var availability: Availability
        public var availabilityObservedAtMS: Int64?
        public var availabilityValidUntilMS: Int64?
        public init(id: String, config: ExactConfig, quotaRemainingFraction: Double?, quotaObservedAtMS: Int64?,
                    quotaValidUntilMS: Int64?, qualityState: QualityState, estimatedCostUnits: Double?,
                    availability: Availability, availabilityObservedAtMS: Int64?, availabilityValidUntilMS: Int64?) {
            self.id = id; self.surface = config.surface; self.transport = config.transport; self.accountID = config.accountID
            self.model = config.model; self.effort = config.effort; self.tools = config.tools; self.scope = config.scope
            self.permissionProfile = config.permissionProfile; self.quotaPool = config.quotaPool
            self.configurationSHA256 = config.configurationSHA256; self.allowedPaths = config.allowedPaths
            self.quotaRemainingFraction = quotaRemainingFraction; self.quotaObservedAtMS = quotaObservedAtMS
            self.quotaValidUntilMS = quotaValidUntilMS; self.qualityState = qualityState; self.estimatedCostUnits = estimatedCostUnits
            self.availability = availability; self.availabilityObservedAtMS = availabilityObservedAtMS
            self.availabilityValidUntilMS = availabilityValidUntilMS
        }
        public var exactConfig: ExactConfig {
            .init(surface: surface, transport: transport, accountID: accountID, model: model, effort: effort,
                  tools: tools, scope: scope, permissionProfile: permissionProfile, quotaPool: quotaPool,
                  allowedPaths: allowedPaths, configurationSHA256: configurationSHA256)
        }
        enum CodingKeys: String, CodingKey {
            case id, surface, transport, model, effort, tools, scope, availability
            case accountID = "account_id", permissionProfile = "permission_profile", quotaPool = "quota_pool"
            case quotaRemainingFraction = "quota_remaining_fraction", quotaObservedAtMS = "quota_observed_at_ms"
            case quotaValidUntilMS = "quota_valid_until_ms", qualityState = "quality_state"
            case configurationSHA256 = "configuration_sha256", allowedPaths = "allowed_paths", estimatedCostUnits = "estimated_cost_units"
            case availabilityObservedAtMS = "availability_observed_at_ms", availabilityValidUntilMS = "availability_valid_until_ms"
        }
    }
    public struct Catalog: Codable, Equatable, Sendable {
        public var schema: Int
        public var taskID: String
        public var requestSHA256: String
        public var candidates: [Candidate]
        public init(schema: Int = 1, taskID: String, requestSHA256: String, candidates: [Candidate]) {
            self.schema = schema; self.taskID = taskID; self.requestSHA256 = requestSHA256; self.candidates = candidates
        }
        enum CodingKeys: String, CodingKey { case schema, candidates, taskID = "task_id", requestSHA256 = "request_sha256" }
    }
    public struct PlanNode: Codable, Equatable, Sendable {
        public var id: String
        public var instruction: String
        public var dependencies: [String]
        public var kind: Kind
        public var candidateID: String
        public var scope: Scope
        public var ownedPaths: [String]
        public var contextRefs: [String]
        public init(id: String, instruction: String, dependencies: [String], kind: Kind, candidateID: String,
                    scope: Scope, ownedPaths: [String], contextRefs: [String]) {
            self.id = id; self.instruction = instruction; self.dependencies = dependencies; self.kind = kind
            self.candidateID = candidateID; self.scope = scope; self.ownedPaths = ownedPaths; self.contextRefs = contextRefs
        }
        enum CodingKeys: String, CodingKey {
            case id, instruction, dependencies, kind, scope
            case candidateID = "candidate_id", ownedPaths = "owned_paths", contextRefs = "context_refs"
        }
    }
    public struct Plan: Codable, Equatable, Sendable {
        public var schema: Int
        public var taskID: String
        public var requestSHA256: String
        public var nodes: [PlanNode]
        public init(schema: Int = 1, taskID: String, requestSHA256: String, nodes: [PlanNode]) {
            self.schema = schema; self.taskID = taskID; self.requestSHA256 = requestSHA256; self.nodes = nodes
        }
        enum CodingKeys: String, CodingKey { case schema, nodes, taskID = "task_id", requestSHA256 = "request_sha256" }
    }
    public struct ExecutionTicket: Codable, Equatable, Sendable {
        public var schema: Int
        public var taskID: String
        public var nodeID: String
        public var attemptID: String
        public var candidateID: String
        public var requestSHA256: String
        public var policySHA256: String
        public var policySourceSHA256: String
        public var sourceFingerprint: String
        public var configurationSHA256: String
        public var selectedConfig: ExactConfig
        public var objective: String
        public var originalRequest: String?
        public var originalObjective: String?
        public var hostContext: HostContext?
        /// Optional continuity hint, not an account/ownership inference. The
        /// core may issue it only for a single full-native agent plan; adapters
        /// must independently retain the exact selected account authorization.
        public var nativeResumeSessionID: String?
        public var instruction: String
        public var contextRefs: [String]
        public var ownedPaths: [String]
        public init(schema: Int = 1, taskID: String, nodeID: String, attemptID: String, candidateID: String,
                    requestSHA256: String, policySHA256: String, policySourceSHA256: String, sourceFingerprint: String,
                    configurationSHA256: String, selectedConfig: ExactConfig, objective: String, instruction: String,
                    contextRefs: [String], ownedPaths: [String], originalRequest: String? = nil,
                    originalObjective: String? = nil, hostContext: HostContext? = nil,
                    nativeResumeSessionID: String? = nil) {
            self.schema = schema; self.taskID = taskID; self.nodeID = nodeID; self.attemptID = attemptID
            self.candidateID = candidateID; self.requestSHA256 = requestSHA256; self.policySHA256 = policySHA256
            self.policySourceSHA256 = policySourceSHA256; self.sourceFingerprint = sourceFingerprint
            self.configurationSHA256 = configurationSHA256; self.selectedConfig = selectedConfig
            self.objective = objective; self.instruction = instruction; self.contextRefs = contextRefs; self.ownedPaths = ownedPaths
            self.originalRequest = originalRequest; self.originalObjective = originalObjective; self.hostContext = hostContext
            self.nativeResumeSessionID = nativeResumeSessionID
        }
        enum CodingKeys: String, CodingKey {
            case schema, objective, instruction
            case taskID = "task_id", nodeID = "node_id", attemptID = "attempt_id", candidateID = "candidate_id"
            case requestSHA256 = "request_sha256", policySHA256 = "policy_sha256", policySourceSHA256 = "policy_source_sha256"
            case sourceFingerprint = "source_fingerprint", configurationSHA256 = "configuration_sha256"
            case selectedConfig = "selected_config", contextRefs = "context_refs", ownedPaths = "owned_paths"
            case originalRequest = "original_request", originalObjective = "original_objective", hostContext = "host_context"
            case nativeResumeSessionID = "native_resume_session_id"
        }
    }
    public struct Usage: Codable, Equatable, Sendable {
        public var inputTokens: Int64?
        public var outputTokens: Int64?
        public var reasoningTokens: Int64?
        public var cacheReadTokens: Int64?
        public var cacheWriteTokens: Int64?
        public var providerCalls: Int?
        public var durationMS: Int64?
        public var costUnits: Double?
        public var metric: String?
        public init(inputTokens: Int64? = nil, outputTokens: Int64? = nil, reasoningTokens: Int64? = nil,
                    cacheReadTokens: Int64? = nil, cacheWriteTokens: Int64? = nil, providerCalls: Int? = nil,
                    durationMS: Int64? = nil, costUnits: Double? = nil, metric: String? = nil) {
            self.inputTokens = inputTokens; self.outputTokens = outputTokens; self.reasoningTokens = reasoningTokens
            self.cacheReadTokens = cacheReadTokens; self.cacheWriteTokens = cacheWriteTokens; self.providerCalls = providerCalls
            self.durationMS = durationMS; self.costUnits = costUnits; self.metric = metric
        }
        enum CodingKeys: String, CodingKey {
            case inputTokens = "input_tokens", outputTokens = "output_tokens", reasoningTokens = "reasoning_tokens"
            case cacheReadTokens = "cache_read_tokens", cacheWriteTokens = "cache_write_tokens", providerCalls = "provider_calls"
            case durationMS = "duration_ms", costUnits = "cost_units", metric
        }
    }
    public struct ExecutionRecord: Codable, Equatable, Sendable {
        public var schema: Int
        public var taskID: String
        public var nodeID: String
        public var attemptID: String
        public var candidateID: String
        public var configurationSHA256: String
        public var selectedConfig: ExactConfig
        public var acknowledgedConfig: ExactConfig?
        public var observedConfig: ExactConfig?
        public var status: ExecutionStatus
        public var dispatchStage: DispatchStage
        public var output: String?
        public var executionVerified: Bool
        public var taskVerified: Bool
        public var taskQuality: TaskQuality
        public var parityState: Parity
        public var nativeReceipt: String?
        public var sideEffects: SideEffects
        public var usage: Usage?
        public var error: String?
        /// Opaque native RunSummary serialization; no re-authored result.
        public var nativeSummary: String?
        public init(schema: Int = 1, taskID: String, nodeID: String, attemptID: String, candidateID: String,
                    configurationSHA256: String, selectedConfig: ExactConfig, acknowledgedConfig: ExactConfig?,
                    observedConfig: ExactConfig?, status: ExecutionStatus, output: String?, executionVerified: Bool,
                    taskVerified: Bool, taskQuality: TaskQuality, parityState: Parity, nativeReceipt: String?,
                    sideEffects: SideEffects, usage: Usage?, error: String? = nil,
                    dispatchStage: DispatchStage = .unknown, nativeSummary: String? = nil) {
            self.schema = schema; self.taskID = taskID; self.nodeID = nodeID; self.attemptID = attemptID
            self.candidateID = candidateID; self.configurationSHA256 = configurationSHA256; self.selectedConfig = selectedConfig
            self.acknowledgedConfig = acknowledgedConfig; self.observedConfig = observedConfig; self.status = status
            self.dispatchStage = dispatchStage
            self.output = output; self.executionVerified = executionVerified; self.taskVerified = taskVerified
            self.taskQuality = taskQuality; self.parityState = parityState; self.nativeReceipt = nativeReceipt
            self.sideEffects = sideEffects; self.usage = usage; self.error = error
            self.nativeSummary = nativeSummary
        }
        enum CodingKeys: String, CodingKey {
            case schema, status, output, usage, error
            case taskID = "task_id", nodeID = "node_id", attemptID = "attempt_id", candidateID = "candidate_id"
            case configurationSHA256 = "configuration_sha256", selectedConfig = "selected_config"
            case acknowledgedConfig = "acknowledged_config", observedConfig = "observed_config"
            case executionVerified = "execution_verified", taskVerified = "task_verified", taskQuality = "task_quality"
            case parityState = "parity_state", nativeReceipt = "native_receipt", sideEffects = "side_effects"
            case dispatchStage = "dispatch_stage", nativeSummary = "native_summary"
        }
    }
    public struct ChildSnapshot: Codable, Equatable, Sendable {
        public var id: String
        public var state: ChildState
        public var attemptID: String?
        public var candidateID: String?
        public var selectedConfig: ExactConfig?
        public var instruction: String?
        public var dependencies: [String]?
        public var startedAtMS: Int64?
        public var finishedAtMS: Int64?
        public var nativeReceipt: String?
        public var outputSummary: String?
        public init(id: String, state: ChildState, attemptID: String?, candidateID: String?, selectedConfig: ExactConfig? = nil,
                    instruction: String? = nil, dependencies: [String]? = nil, startedAtMS: Int64? = nil,
                    finishedAtMS: Int64? = nil, nativeReceipt: String? = nil, outputSummary: String? = nil) {
            self.id = id; self.state = state; self.attemptID = attemptID; self.candidateID = candidateID
            self.selectedConfig = selectedConfig; self.instruction = instruction; self.dependencies = dependencies
            self.startedAtMS = startedAtMS; self.finishedAtMS = finishedAtMS; self.nativeReceipt = nativeReceipt
            self.outputSummary = outputSummary
        }
        enum CodingKeys: String, CodingKey {
            case id, state, dependencies, instruction, attemptID = "attempt_id", candidateID = "candidate_id"
            case selectedConfig = "selected_config", startedAtMS = "started_at_ms", finishedAtMS = "finished_at_ms", nativeReceipt = "native_receipt"
            case outputSummary = "output_summary"
        }
    }
    public struct Result: Codable, Equatable, Sendable {
        public var output: String
        public var executionVerified: Bool
        public var taskVerified: Bool
        public var taskQuality: TaskQuality?
        public var parityState: Parity
        public var nativeReceipt: String?
        public var nativeSummary: String?
        public var nativeSummaries: [String]?
        public init(output: String, executionVerified: Bool, taskVerified: Bool, parityState: Parity, nativeReceipt: String?, nativeSummary: String? = nil,
                    nativeSummaries: [String]? = nil, taskQuality: TaskQuality? = nil) {
            self.output = output; self.executionVerified = executionVerified; self.taskVerified = taskVerified
            self.parityState = parityState; self.nativeReceipt = nativeReceipt
            self.nativeSummary = nativeSummary
            self.nativeSummaries = nativeSummaries
            self.taskQuality = taskQuality
        }
        enum CodingKeys: String, CodingKey {
            case output, executionVerified = "execution_verified", taskVerified = "task_verified"
            case parityState = "parity_state", nativeReceipt = "native_receipt"
            case nativeSummary = "native_summary"
            case nativeSummaries = "native_summaries"
            case taskQuality = "task_quality"
        }
    }
    public struct Snapshot: Codable, Equatable, Sendable {
        public var schema: Int
        public var taskID: String
        public var requestSHA256: String
        public var state: State
        public var revision: Int
        public var children: [ChildSnapshot]
        public var result: Result?
        public var error: String?
        public init(schema: Int = 1, taskID: String, requestSHA256: String, state: State, revision: Int,
                    children: [ChildSnapshot], result: Result?, error: String?) {
            self.schema = schema; self.taskID = taskID; self.requestSHA256 = requestSHA256; self.state = state
            self.revision = revision; self.children = children; self.result = result; self.error = error
        }
        enum CodingKeys: String, CodingKey {
            case schema, state, revision, children, result, error, taskID = "task_id", requestSHA256 = "request_sha256"
        }
    }
    public struct Event: Codable, Equatable, Sendable {
        public var schema: Int
        public var taskID: String
        public var revision: Int
        public var type: EventType
        public var nodeID: String?
        public var attemptID: String?
        public var observedAtMS: Int64
        public var snapshot: Snapshot?
        public init(schema: Int = 1, taskID: String, revision: Int, type: EventType, nodeID: String?, attemptID: String?,
                    observedAtMS: Int64, snapshot: Snapshot?) {
            self.schema = schema; self.taskID = taskID; self.revision = revision; self.type = type
            self.nodeID = nodeID; self.attemptID = attemptID; self.observedAtMS = observedAtMS; self.snapshot = snapshot
        }
        enum CodingKeys: String, CodingKey {
            case schema, revision, type, snapshot, taskID = "task_id", nodeID = "node_id", attemptID = "attempt_id", observedAtMS = "observed_at_ms"
        }
    }

    public static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    public static func isHash(_ value: String) -> Bool { value.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } }
    private static func id(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 128 && value.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 || $0 == 95 }
    }
    private static func text(_ value: String, max: Int = 96_000) -> Bool { !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && value.utf8.count <= max && !value.contains("\0") }
    private static func unique(_ values: [String], max: Int = 256) -> Bool { values.count <= max && Set(values).count == values.count && values.allSatisfy { text($0, max: 4_096) } }
    private static func paths(_ values: [String]) -> Bool {
        unique(values, max: 64) && values.allSatisfy { value in
            value == "**" || (!value.hasPrefix("/") && !value.hasPrefix("~") && !value.contains("\\") &&
                value.utf8.count <= 512 && value.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." })
        }
    }
    private static func absolutePath(_ value: String) -> Bool {
        text(value, max: 4_096) && value.hasPrefix("/") && !value.split(separator: "/", omittingEmptySubsequences: false).contains("..")
    }
    private static func timestamps(_ start: Int64?, _ end: Int64?) -> Bool {
        if start == nil && end == nil { return true }
        guard let start, let end else { return false }
        return start >= 0 && end > start
    }
    public static func validate(_ value: Request) throws {
        guard value.schema == schema else { throw Rejection.invalidSchema }
        guard id(value.taskID) else { throw Rejection.invalidIdentity }
        guard isHash(value.requestSHA256), value.requestSHA256 == digest(Data(value.request.utf8)),
              isHash(value.policySHA256), isHash(value.sourceFingerprint) else { throw Rejection.invalidHash }
        guard text(value.request, max: 64_000), text(value.objective, max: 8_192), unique(value.materialRefs, max: 128),
              value.budget.maxAttempts > 0, value.budget.maxAttempts <= 3,
              value.budget.maxParallel > 0, value.budget.maxParallel <= 8,
              value.budget.maxDurationMS >= 1_000, value.budget.maxDurationMS <= 3_600_000,
              value.budget.maxCostUnits.map({ $0.isFinite && $0 >= 0 }) ?? true,
              value.context.map({ $0.utf8.count <= 500_000 && !$0.contains("\0") }) ?? true,
              value.workspace.map(absolutePath) ?? true else { throw Rejection.invalidInput }
        if let sessions = value.nativeSessions {
            guard Set(sessions.keys).isSubset(of: ["codex", "claude", "chatgpt", "local"]), sessions.values.allSatisfy(id) else { throw Rejection.invalidIdentity }
        }
        if let preference = value.providerPreference {
            guard ["auto", "codex", "claude", "chatgpt", "local", "gpt-chat", "claude-chat"].contains(preference) else { throw Rejection.invalidConfiguration }
        }
        if let policy = value.policy {
            guard isHash(policy.sourceSHA256), isHash(policy.projectionSHA256), policy.projectionSHA256 == value.policySHA256,
                  digest(Data(policy.text.utf8)) == policy.projectionSHA256, text(policy.text, max: 256_000) else { throw Rejection.invalidHash }
        }
        if let host = value.hostContext {
            try validate(host)
            guard digest(try encode(host)) == value.sourceFingerprint else { throw Rejection.invalidHash }
        }
    }
    public static func validate(_ value: HostContext) throws {
        guard absolutePath(value.workspace), value.context.map({ $0.utf8.count <= 500_000 && !$0.contains("\0") }) ?? true,
              ["auto", "codex", "claude", "chatgpt", "local", "gpt-chat", "claude-chat"].contains(value.providerPreference),
              value.codexSessionID.map(id) ?? true, value.claudeSessionID.map(id) ?? true else { throw Rejection.invalidInput }
        if let routes = value.explicitRoutes {
            guard routes.count <= 8, routes.allSatisfy({ text($0.instruction, max: 12_000) }),
                  Set(routes.map { $0.surface.rawValue + "\0" + $0.instruction }).count == routes.count else { throw Rejection.invalidInput }
        }
        if let policy = value.ownerPolicy {
            guard policy.schema == 1, isHash(policy.sourceSHA256), isHash(policy.projectionSHA256),
                  policy.sourceFile == policy.sourceSHA256 + ".txt", policy.checkedAt.isFinite,
                  text(policy.projection, max: 24_000), text(policy.routing, max: 3_000),
                  digest(Data((policy.routing + "\n" + policy.projection).utf8)) == policy.projectionSHA256 else { throw Rejection.invalidHash }
        }
    }
    public static func validate(_ value: ExactConfig) throws {
        guard text(value.accountID, max: 256), text(value.model, max: 256), isHash(value.configurationSHA256),
              value.scope == value.permissionProfile, unique(value.tools, max: 128), paths(value.allowedPaths) else { throw Rejection.invalidConfiguration }
        let compatible: Bool
        switch (value.surface, value.transport, value.quotaPool) {
        case (.local, .local, .none): compatible = true
        case (.codex, .codexAppServer, .openAICodex), (.gptChat, .codexAppServer, .openAICodex): compatible = true
        case (.claude, .claudeCLI, .anthropicShared), (.claudeChat, .claudeCLI, .anthropicShared),
             (.claudeChat, .claudeService, .anthropicShared): compatible = true
        case (.chatgpt, .chatGPTService, .openAIChat): compatible = true
        default: compatible = false
        }
        guard compatible else { throw Rejection.unsupportedBilling }
        if value.surface == .chatgpt || value.surface == .gptChat || value.surface == .claudeChat {
            guard value.scope == .readOnly, value.tools.isEmpty else { throw Rejection.invalidConfiguration }
        }
    }
    public static func validate(_ value: Candidate) throws {
        guard id(value.id) else { throw Rejection.invalidIdentity }
        try validate(value.exactConfig)
        guard timestamps(value.quotaObservedAtMS, value.quotaValidUntilMS),
              timestamps(value.availabilityObservedAtMS, value.availabilityValidUntilMS),
              value.quotaRemainingFraction.map({ $0.isFinite && (0...1).contains($0) }) ?? true,
              value.estimatedCostUnits.map({ $0.isFinite && $0 >= 0 }) ?? true else { throw Rejection.invalidObservation }
        if value.quotaRemainingFraction != nil && value.quotaObservedAtMS == nil { throw Rejection.invalidObservation }
        if value.availability != .unknown && value.availabilityObservedAtMS == nil { throw Rejection.invalidObservation }
    }
    public static func validate(_ value: Catalog, request: Request? = nil) throws {
        guard value.schema == schema else { throw Rejection.invalidSchema }
        guard id(value.taskID), isHash(value.requestSHA256), value.candidates.count <= 256,
              Set(value.candidates.map(\.id)).count == value.candidates.count else { throw Rejection.invalidIdentity }
        if let request { guard value.taskID == request.taskID && value.requestSHA256 == request.requestSHA256 else { throw Rejection.invalidIdentity } }
        for candidate in value.candidates { try validate(candidate) }
    }
    public static func validate(_ value: Plan, catalog: Catalog? = nil) throws {
        guard value.schema == schema else { throw Rejection.invalidSchema }
        guard id(value.taskID), isHash(value.requestSHA256), !value.nodes.isEmpty, value.nodes.count <= maximumNodes,
              Set(value.nodes.map(\.id)).count == value.nodes.count else { throw Rejection.invalidPlan }
        let ids = Set(value.nodes.map(\.id))
        for node in value.nodes {
            guard id(node.id), id(node.candidateID), text(node.instruction), unique(node.dependencies, max: maximumNodes),
                  !node.dependencies.contains(node.id), Set(node.dependencies).isSubset(of: ids),
                  paths(node.ownedPaths), unique(node.contextRefs) else { throw Rejection.invalidPlan }
            if node.scope == .readOnly && !node.ownedPaths.isEmpty { throw Rejection.invalidPlan }
            if let catalog {
                guard value.taskID == catalog.taskID, value.requestSHA256 == catalog.requestSHA256,
                      let candidate = catalog.candidates.first(where: { $0.id == node.candidateID }), candidate.scope == node.scope,
                      node.kind != .deterministic || candidate.transport == .local,
                      node.ownedPaths.allSatisfy({ path in candidate.allowedPaths.contains { $0 == "**" || path == $0 || path.hasPrefix($0 + "/") } }) else { throw Rejection.invalidPlan }
            }
        }
        var finished = Set<String>()
        while finished.count < ids.count {
            let ready = value.nodes.filter { !finished.contains($0.id) && Set($0.dependencies).isSubset(of: finished) }
            guard !ready.isEmpty else { throw Rejection.invalidPlan }
            finished.formUnion(ready.map(\.id))
        }
        let byID = Dictionary(uniqueKeysWithValues: value.nodes.map { ($0.id, $0) })
        func precedes(_ earlier: String, _ later: String) -> Bool {
            var frontier = byID[later]?.dependencies ?? [], visited = Set<String>()
            while let next = frontier.popLast() {
                if next == earlier { return true }
                if visited.insert(next).inserted { frontier += byID[next]?.dependencies ?? [] }
            }
            return false
        }
        func overlaps(_ left: String, _ right: String) -> Bool {
            let a = left.hasSuffix("/") ? String(left.dropLast()) : left
            let b = right.hasSuffix("/") ? String(right.dropLast()) : right
            return a == "**" || b == "**" || a == b || a.hasPrefix(b + "/") || b.hasPrefix(a + "/")
        }
        for index in value.nodes.indices {
            for other in value.nodes.indices where other > index {
                let a = value.nodes[index], b = value.nodes[other]
                if a.scope == .workspaceWrite && b.scope == .workspaceWrite &&
                    a.ownedPaths.contains(where: { p in b.ownedPaths.contains(where: { overlaps(p, $0) }) }) {
                    guard precedes(a.id, b.id) || precedes(b.id, a.id) else { throw Rejection.invalidPlan }
                }
            }
        }
    }
    public static func validate(_ value: ExecutionTicket, candidate: Candidate? = nil, request: Request? = nil) throws {
        guard value.schema == schema else { throw Rejection.invalidSchema }
        guard [value.taskID, value.nodeID, value.attemptID, value.candidateID].allSatisfy(id) else { throw Rejection.invalidIdentity }
        guard [value.requestSHA256, value.policySHA256, value.policySourceSHA256, value.sourceFingerprint, value.configurationSHA256].allSatisfy(isHash) else { throw Rejection.invalidHash }
        try validate(value.selectedConfig)
        guard value.configurationSHA256 == value.selectedConfig.configurationSHA256,
              text(value.objective), text(value.instruction), unique(value.contextRefs), paths(value.ownedPaths) else { throw Rejection.invalidInput }
        if value.selectedConfig.scope == .readOnly && !value.ownedPaths.isEmpty { throw Rejection.invalidConfiguration }
        if let host = value.hostContext {
            try validate(host)
            guard digest(try encode(host)) == value.sourceFingerprint,
                  !host.requireReadOnly || value.selectedConfig.scope == .readOnly else { throw Rejection.configurationMismatch }
        }
        if let sessionID = value.nativeResumeSessionID {
            guard id(sessionID), let host = value.hostContext else { throw Rejection.invalidIdentity }
            let sourceSessionID: String?
            switch value.selectedConfig.surface {
            case .codex: sourceSessionID = host.codexSessionID
            case .claude: sourceSessionID = host.claudeSessionID
            default: throw Rejection.configurationMismatch
            }
            guard sourceSessionID == sessionID else { throw Rejection.configurationMismatch }
        }
        if let original = value.originalRequest {
            guard digest(Data(original.utf8)) == value.requestSHA256 else { throw Rejection.invalidHash }
        }
        if let objective = value.originalObjective { guard text(objective) else { throw Rejection.invalidInput } }
        if let candidate { guard candidate.id == value.candidateID && candidate.exactConfig == value.selectedConfig else { throw Rejection.configurationMismatch } }
        if let request {
            guard value.taskID == request.taskID, value.requestSHA256 == request.requestSHA256,
                  value.policySHA256 == request.policySHA256, value.sourceFingerprint == request.sourceFingerprint,
                  value.originalObjective.map({ $0 == request.objective }) ?? true,
                  request.policy.map({ $0.sourceSHA256 == value.policySourceSHA256 }) ?? true else { throw Rejection.invalidIdentity }
            guard value.originalRequest.map({ $0 == request.request }) ?? true,
                  value.originalObjective.map({ $0 == request.objective }) ?? true,
                  value.hostContext == request.hostContext else { throw Rejection.invalidIdentity }
        }
    }
    public static func validate(_ value: ExecutionRecord, ticket: ExecutionTicket? = nil) throws {
        guard value.schema == schema else { throw Rejection.invalidSchema }
        guard [value.taskID, value.nodeID, value.attemptID, value.candidateID].allSatisfy(id), isHash(value.configurationSHA256) else { throw Rejection.invalidIdentity }
        try validate(value.selectedConfig)
        if let ack = value.acknowledgedConfig { try validate(ack) }
        if let observed = value.observedConfig { try validate(observed) }
        guard value.selectedConfig.configurationSHA256 == value.configurationSHA256,
              value.output.map({ $0.utf8.count <= 256_000 && !$0.contains("\0") }) ?? true,
              value.nativeReceipt.map({ text($0, max: 4_096) }) ?? true,
              value.nativeSummary.map({ $0.utf8.count <= 512_000 && !$0.contains("\0") }) ?? true,
              value.error.map({ text($0, max: 8_192) }) ?? true else { throw Rejection.invalidExecutionRecord }
        if let ticket {
            guard value.taskID == ticket.taskID, value.nodeID == ticket.nodeID, value.attemptID == ticket.attemptID,
                  value.candidateID == ticket.candidateID, value.configurationSHA256 == ticket.configurationSHA256,
                  value.selectedConfig == ticket.selectedConfig else { throw Rejection.configurationMismatch }
        }
        if value.executionVerified {
            guard value.status == .succeeded, value.nativeReceipt != nil,
                  value.dispatchStage == .dispatched,
                  value.observedConfig.map({ $0 == value.selectedConfig }) ?? true,
                  value.acknowledgedConfig.map({ $0 == value.selectedConfig }) ?? true,
                  value.observedConfig == value.selectedConfig || value.acknowledgedConfig == value.selectedConfig else { throw Rejection.invalidExecutionRecord }
        }
        guard !value.taskVerified || value.executionVerified,
              (value.taskQuality == .taskVerified) == value.taskVerified,
              value.taskQuality != .executionOnly || value.executionVerified,
              (value.parityState != .referenceEquivalent && value.parityState != .referenceAbove) || value.taskVerified else { throw Rejection.invalidExecutionRecord }
        if value.status != .succeeded {
            guard !value.executionVerified, !value.taskVerified,
                  value.parityState == .unverified || value.parityState == .mismatch else { throw Rejection.invalidExecutionRecord }
        }
        if value.dispatchStage == .notDispatched && value.sideEffects != .none { throw Rejection.invalidExecutionRecord }
        if value.status == .effectsUncertain && value.sideEffects == .none { throw Rejection.invalidExecutionRecord }
        if let usage = value.usage {
            guard [usage.inputTokens, usage.outputTokens, usage.reasoningTokens, usage.cacheReadTokens,
                   usage.cacheWriteTokens, usage.durationMS].allSatisfy({ $0.map({ $0 >= 0 }) ?? true }),
                  usage.providerCalls.map({ $0 >= 0 }) ?? true,
                  usage.costUnits.map({ $0.isFinite && $0 >= 0 }) ?? true,
                  usage.costUnits == nil || usage.metric.map({ text($0, max: 64) }) == true else { throw Rejection.invalidObservation }
        }
    }
    public static func validate(_ value: Snapshot) throws {
        guard value.schema == schema else { throw Rejection.invalidSchema }
        guard id(value.taskID), isHash(value.requestSHA256), value.revision >= 0, value.children.count <= maximumNodes,
              Set(value.children.map(\.id)).count == value.children.count else { throw Rejection.invalidSnapshot }
        for child in value.children {
            guard id(child.id), child.attemptID.map(id) ?? true, child.candidateID.map(id) ?? true,
                  child.state != .running || (child.attemptID != nil && child.candidateID != nil) else { throw Rejection.invalidSnapshot }
            if let config = child.selectedConfig { try validate(config) }
            guard child.instruction.map({ text($0) }) ?? true, child.dependencies.map({ unique($0, max: maximumNodes) }) ?? true,
                  child.startedAtMS.map({ $0 >= 0 }) ?? true, child.finishedAtMS.map({ $0 >= (child.startedAtMS ?? 0) }) ?? true,
                  child.nativeReceipt.map({ text($0, max: 4_096) }) ?? true,
                  child.outputSummary.map({ $0.utf8.count <= 4_096 && !$0.contains("\0") }) ?? true else { throw Rejection.invalidSnapshot }
        }
        if let result = value.result {
            guard value.state == .completed || value.state == .returnedUnverified, text(result.output, max: 256_000),
                  !result.taskVerified || result.executionVerified,
                  !result.executionVerified || result.nativeReceipt != nil || (result.taskVerified && value.children.allSatisfy { $0.selectedConfig?.transport == .local }),
                  (result.parityState != .referenceAbove && result.parityState != .referenceEquivalent) || result.taskVerified else { throw Rejection.invalidSnapshot }
            if let quality = result.taskQuality { guard (quality == .taskVerified) == result.taskVerified else { throw Rejection.invalidSnapshot } }
            guard result.nativeSummary.map({ $0.utf8.count <= 512_000 && !$0.contains("\0") }) ?? true,
                  result.nativeSummaries.map({ $0.count <= maximumNodes && $0.allSatisfy { $0.utf8.count <= 512_000 && !$0.contains("\0") } }) ?? true else { throw Rejection.invalidSnapshot }
        }
        if value.state == .completed { guard value.result?.taskVerified == true && value.error == nil else { throw Rejection.invalidSnapshot } }
        if value.state == .returnedUnverified { guard let result = value.result, !result.taskVerified, result.parityState == .unverified else { throw Rejection.invalidSnapshot } }
        guard value.error.map({ text($0, max: 8_192) }) ?? true else { throw Rejection.invalidSnapshot }
    }
    public static func validate(_ value: Event) throws {
        guard value.schema == schema else { throw Rejection.invalidSchema }
        guard id(value.taskID), value.revision >= 0, value.observedAtMS >= 0,
              value.nodeID.map(id) ?? true, value.attemptID.map(id) ?? true else { throw Rejection.invalidIdentity }
        if let snapshot = value.snapshot {
            try validate(snapshot)
            guard snapshot.taskID == value.taskID && snapshot.revision == value.revision else { throw Rejection.invalidSnapshot }
        }
    }

    // Decoders reject unknown fields at EVERY typed nesting boundary, before
    // Codable can ignore them. All external wire ingress must use these APIs.
    private struct Shape: Sendable {
        var keys: Set<String>?
        var children: [String: Shape] = [:]
        var element: (@Sendable () -> Shape)? = nil
        static let leaf = Shape(keys: nil)
        static func object(_ keys: [String], _ children: [String: Shape] = [:]) -> Shape { .init(keys: Set(keys), children: children) }
        static func array(_ shape: Shape) -> Shape { .init(keys: nil, element: { shape }) }
    }
    private static let configKeys = ["surface", "transport", "account_id", "model", "effort", "tools", "scope", "permission_profile", "quota_pool", "allowed_paths", "configuration_sha256"]
    private static let configShape = Shape.object(configKeys)
    private static let candidateShape = Shape.object(["id"] + configKeys + ["quota_remaining_fraction", "quota_observed_at_ms", "quota_valid_until_ms", "quality_state", "estimated_cost_units", "availability", "availability_observed_at_ms", "availability_valid_until_ms"])
    private static let budgetShape = Shape.object(["max_attempts", "max_parallel", "max_cost_units", "max_duration_ms"])
    private static let policyShape = Shape.object(["source_sha256", "projection_sha256", "text"])
    private static let ownerPolicyShape = Shape.object(["schema", "sourceSHA256", "sourceFile", "projectionSHA256", "projection", "sourceID", "sourceModified", "checkedAt", "routing"])
    private static let explicitRouteShape = Shape.object(["surface", "instruction"])
    private static let hostShape = Shape.object(["workspace", "context", "provider_preference", "codex_session_id", "claude_session_id", "require_read_only", "owner_policy", "explicit_routes"], ["owner_policy": ownerPolicyShape, "explicit_routes": .array(explicitRouteShape)])
    private static let requestShape = Shape.object(["schema", "task_id", "request", "request_sha256", "objective", "policy_sha256", "source_fingerprint", "mode", "material_refs", "budget", "context", "workspace", "native_sessions", "provider_preference", "policy", "host_context"], ["budget": budgetShape, "policy": policyShape, "host_context": hostShape])
    private static let catalogShape = Shape.object(["schema", "task_id", "request_sha256", "candidates"], ["candidates": .array(candidateShape)])
    private static let nodeShape = Shape.object(["id", "instruction", "dependencies", "kind", "candidate_id", "scope", "owned_paths", "context_refs"])
    private static let planShape = Shape.object(["schema", "task_id", "request_sha256", "nodes"], ["nodes": .array(nodeShape)])
    private static let ticketShape = Shape.object(["schema", "task_id", "node_id", "attempt_id", "candidate_id", "request_sha256", "policy_sha256", "policy_source_sha256", "source_fingerprint", "configuration_sha256", "selected_config", "objective", "instruction", "context_refs", "owned_paths", "original_request", "original_objective", "host_context", "native_resume_session_id"], ["selected_config": configShape, "host_context": hostShape])
    private static let usageShape = Shape.object(["input_tokens", "output_tokens", "reasoning_tokens", "cache_read_tokens", "cache_write_tokens", "provider_calls", "duration_ms", "cost_units", "metric"])
    private static let recordShape = Shape.object(["schema", "task_id", "node_id", "attempt_id", "candidate_id", "configuration_sha256", "selected_config", "acknowledged_config", "observed_config", "status", "output", "execution_verified", "task_verified", "task_quality", "parity_state", "native_receipt", "side_effects", "usage", "error", "dispatch_stage", "native_summary"], ["selected_config": configShape, "acknowledged_config": configShape, "observed_config": configShape, "usage": usageShape])
    private static let resultShape = Shape.object(["output", "execution_verified", "task_verified", "task_quality", "parity_state", "native_receipt", "native_summary", "native_summaries"])
    private static let childShape = Shape.object(["id", "state", "attempt_id", "candidate_id", "selected_config", "instruction", "dependencies", "started_at_ms", "finished_at_ms", "native_receipt", "output_summary"], ["selected_config": configShape])
    private static let snapshotShape = Shape.object(["schema", "task_id", "request_sha256", "state", "revision", "children", "result", "error"], ["children": .array(childShape), "result": resultShape])
    private static let eventShape = Shape.object(["schema", "task_id", "revision", "type", "node_id", "attempt_id", "observed_at_ms", "snapshot"], ["snapshot": snapshotShape])
    private static func checkShape(_ object: Any, _ shape: Shape, depth: Int = 0) throws {
        guard depth <= 32 else { throw Rejection.oversized }
        if object is NSNull { return }
        if let keys = shape.keys {
            guard let value = object as? [String: Any], Set(value.keys).isSubset(of: keys) else { throw Rejection.unsupportedField }
            for (key, nested) in shape.children { if let child = value[key] { try checkShape(child, nested, depth: depth + 1) } }
        } else if let element = shape.element {
            guard let values = object as? [Any], values.count <= 256 else { throw Rejection.invalidInput }
            for child in values { try checkShape(child, element(), depth: depth + 1) }
        }
    }
    private static func decode<T: Decodable>(_ type: T.Type, data: Data, shape: Shape) throws -> T {
        guard !data.isEmpty && data.count <= maximumWireBytes else { throw Rejection.oversized }
        let object = try JSONSerialization.jsonObject(with: data)
        var scanner = DuplicateKeyScanner(bytes: Array(data))
        try scanner.scan()
        try checkShape(object, shape)
        return try JSONDecoder().decode(type, from: data)
    }
    /// Foundation decoders accept duplicate JSON keys. Reject them before a
    /// local model's first/last-key ambiguity can select a different config.
    private struct DuplicateKeyScanner {
        let bytes: [UInt8]
        var index = 0
        mutating func spaces() { while index < bytes.count && [9, 10, 13, 32].contains(bytes[index]) { index += 1 } }
        mutating func string() throws -> String {
            guard index < bytes.count && bytes[index] == 34 else { throw Rejection.invalidInput }
            let start = index; index += 1
            while index < bytes.count {
                let byte = bytes[index]; index += 1
                if byte == 92 { guard index < bytes.count else { throw Rejection.invalidInput }; index += 1 }
                else if byte == 34 { return try JSONDecoder().decode(String.self, from: Data(bytes[start..<index])) }
            }
            throw Rejection.invalidInput
        }
        mutating func value(depth: Int) throws {
            guard depth <= 32 else { throw Rejection.oversized }
            spaces(); guard index < bytes.count else { throw Rejection.invalidInput }
            switch bytes[index] {
            case 123:
                index += 1; spaces(); var keys = Set<String>()
                if index < bytes.count && bytes[index] == 125 { index += 1; return }
                while true {
                    spaces(); let key = try string(); guard keys.insert(key).inserted else { throw Rejection.unsupportedField }
                    spaces(); guard index < bytes.count && bytes[index] == 58 else { throw Rejection.invalidInput }; index += 1
                    try value(depth: depth + 1); spaces(); guard index < bytes.count else { throw Rejection.invalidInput }
                    let delimiter = bytes[index]; index += 1
                    if delimiter == 125 { return }; guard delimiter == 44 else { throw Rejection.invalidInput }
                }
            case 91:
                index += 1; spaces()
                if index < bytes.count && bytes[index] == 93 { index += 1; return }
                while true {
                    try value(depth: depth + 1); spaces(); guard index < bytes.count else { throw Rejection.invalidInput }
                    let delimiter = bytes[index]; index += 1
                    if delimiter == 93 { return }; guard delimiter == 44 else { throw Rejection.invalidInput }
                }
            case 34: _ = try string()
            default:
                let start = index
                while index < bytes.count && ![9, 10, 13, 32, 44, 93, 125].contains(bytes[index]) { index += 1 }
                guard index > start else { throw Rejection.invalidInput }
            }
        }
        mutating func scan() throws { try value(depth: 0); spaces(); guard index == bytes.count else { throw Rejection.invalidInput } }
    }
    public static func decodeRequest(_ data: Data) throws -> Request { let x = try decode(Request.self, data: data, shape: requestShape); try validate(x); return x }
    public static func decodeCatalog(_ data: Data, request: Request? = nil) throws -> Catalog { let x = try decode(Catalog.self, data: data, shape: catalogShape); try validate(x, request: request); return x }
    public static func decodePlan(_ data: Data, catalog: Catalog? = nil) throws -> Plan { let x = try decode(Plan.self, data: data, shape: planShape); try validate(x, catalog: catalog); return x }
    public static func decodeTicket(_ data: Data, candidate: Candidate? = nil, request: Request? = nil) throws -> ExecutionTicket { let x = try decode(ExecutionTicket.self, data: data, shape: ticketShape); try validate(x, candidate: candidate, request: request); return x }
    public static func decodeRecord(_ data: Data, ticket: ExecutionTicket? = nil) throws -> ExecutionRecord { let x = try decode(ExecutionRecord.self, data: data, shape: recordShape); try validate(x, ticket: ticket); return x }
    public static func decodeSnapshot(_ data: Data) throws -> Snapshot { let x = try decode(Snapshot.self, data: data, shape: snapshotShape); try validate(x); return x }
    public static func decodeEvent(_ data: Data) throws -> Event { let x = try decode(Event.self, data: data, shape: eventShape); try validate(x); return x }
    /// Canonical UTF-8 sorted-key JSON matches the core's stable JSON, and
    /// explicitly preserves unknown optional observations as JSON null.
    public static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let raw = try encoder.encode(value)
        var object = try JSONSerialization.jsonObject(with: raw)
        func normalize(_ item: Any) -> Any {
            if let array = item as? [Any] { return array.map(normalize) }
            guard var dictionary = item as? [String: Any] else { return item }
            var optional: [String] = []
            if dictionary["max_attempts"] != nil { optional += ["max_cost_units"] }
            if dictionary["require_read_only"] != nil { optional += ["context", "codex_session_id", "claude_session_id", "owner_policy", "explicit_routes"] }
            if dictionary["quality_state"] != nil { optional += ["quota_remaining_fraction", "quota_observed_at_ms", "quota_valid_until_ms", "estimated_cost_units", "availability_observed_at_ms", "availability_valid_until_ms"] }
            if dictionary["context_refs"] != nil && dictionary["selected_config"] != nil { optional += ["native_resume_session_id"] }
            if dictionary["task_quality"] != nil && dictionary["configuration_sha256"] != nil { optional += ["acknowledged_config", "observed_config", "output", "native_receipt", "usage", "error", "native_summary"] }
            if dictionary["children"] != nil { optional += ["result", "error"] }
            if dictionary["parity_state"] != nil && dictionary["configuration_sha256"] == nil { optional += ["native_receipt", "native_summary", "native_summaries"] }
            if dictionary["state"] != nil && dictionary["id"] != nil { optional += ["attempt_id", "candidate_id", "selected_config", "instruction", "dependencies", "started_at_ms", "finished_at_ms", "native_receipt", "output_summary"] }
            for key in optional where dictionary[key] == nil { dictionary[key] = NSNull() }
            for (key, child) in dictionary { dictionary[key] = normalize(child) }
            return dictionary
        }
        object = normalize(object)
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
        guard data.count <= maximumWireBytes else { throw Rejection.oversized }; return data
    }
}
