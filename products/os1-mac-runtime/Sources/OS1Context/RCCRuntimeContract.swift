import CryptoKit
import Foundation

/// The wire boundary of the ONE OpenClaw-owned task loop. These values carry
/// facts and proposals; they do not choose models, grant authority, or certify
/// quality. An adapter cannot silently create another plan/retry/fallback.
public enum RCCRuntimeContract {
    public static let schema = 1
    public static let maximumWireBytes = 8_388_608
    public static let maximumNodes = 64
    /// The one typed execution-record reason that lets Core move a node to
    /// another pool after the backend process started: the provider's own
    /// stream proved a quota rejection before any work, on a read-only attempt
    /// with an unchanged workspace. Valid only on that no-effect report.
    public static let providerQuotaRejectedBeforeExecution = "provider_quota_rejected_before_execution"
    /// The routing server refused to authorize this exact (provider, model,
    /// effort) before any ticket, lease or backend process existed (its opaque
    /// HTTP 400 from /v1/execution-authorizations). Nothing ran, in either
    /// scope. A client whose signed profiles are newer than the server's
    /// policy meets it for every newly added tuple (review 2026-10-15: build
    /// 383 against the 78-profile bundle). Valid only on a not-dispatched,
    /// no-effect report with a receipt.
    public static let nativeAuthorizationRefused = "native_authorization_refused"
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
        case awaitingInstall = "awaiting_install"
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
        public var maxNativeDispatches: Int?
        public var forbidModelGeneration: Bool?
        public init(maxAttempts: Int, maxParallel: Int, maxCostUnits: Double?, maxDurationMS: Int64, maxNativeDispatches: Int? = nil, forbidModelGeneration: Bool? = nil) {
            self.maxAttempts = maxAttempts; self.maxParallel = maxParallel
            self.maxCostUnits = maxCostUnits; self.maxDurationMS = maxDurationMS; self.maxNativeDispatches = maxNativeDispatches
            self.forbidModelGeneration = forbidModelGeneration
        }
        enum CodingKeys: String, CodingKey {
            case maxAttempts = "max_attempts", maxParallel = "max_parallel"
            case maxCostUnits = "max_cost_units", maxDurationMS = "max_duration_ms", maxNativeDispatches = "max_native_dispatches", forbidModelGeneration = "forbid_model_generation"
        }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            maxAttempts = try c.decode(Int.self, forKey: .maxAttempts)
            maxParallel = try c.decode(Int.self, forKey: .maxParallel)
            maxCostUnits = try c.decodeIfPresent(Double.self, forKey: .maxCostUnits)
            maxDurationMS = try c.decode(Int64.self, forKey: .maxDurationMS)
            maxNativeDispatches = try c.decodeIfPresent(Int.self, forKey: .maxNativeDispatches)
            // Present null/numbers/strings are not an explicit boolean policy.
            forbidModelGeneration = c.contains(.forbidModelGeneration)
                ? try c.decode(Bool.self, forKey: .forbidModelGeneration) : nil
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
    /// The owner's capacity mix per subscription pool, 0...100 each. It is a
    /// routing input, never quota evidence: 0 removes the pool unless the
    /// owner explicitly named that provider's surface. Absent means 100/100,
    /// and an absent key keeps older host fingerprints byte-identical.
    public struct CapacityPlan: Codable, Equatable, Sendable {
        public var codex: Int
        public var claude: Int
        public init(codex: Int, claude: Int) { self.codex = codex; self.claude = claude }
        public var isValid: Bool { (0...100).contains(codex) && (0...100).contains(claude) && codex + claude > 0 }
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
        public var conversationID: String?
        public var submissionID: String?
        public var capacityPlan: CapacityPlan?
        /// Route-all only (true or absent): Core runs every explicit route
        /// with a runnable row and skips the others with their reason, never
        /// holding the set for one surface. Absent: every named route is needed.
        public var explicitRoutesBestEffort: Bool?
        public init(workspace: String, context: String?, providerPreference: String, codexSessionID: String?,
                    claudeSessionID: String?, requireReadOnly: Bool, ownerPolicy: OwnerPolicySnapshot?,
                    explicitRoutes: [ExplicitRoute]? = nil, conversationID: String? = nil, submissionID: String? = nil,
                    capacityPlan: CapacityPlan? = nil, explicitRoutesBestEffort: Bool? = nil) {
            self.workspace = workspace; self.context = context; self.providerPreference = providerPreference
            self.codexSessionID = codexSessionID; self.claudeSessionID = claudeSessionID
            self.requireReadOnly = requireReadOnly; self.ownerPolicy = ownerPolicy
            self.explicitRoutes = explicitRoutes
            self.conversationID = conversationID; self.submissionID = submissionID
            self.capacityPlan = capacityPlan
            self.explicitRoutesBestEffort = explicitRoutesBestEffort
        }
        enum CodingKeys: String, CodingKey {
            case workspace, context, providerPreference = "provider_preference", codexSessionID = "codex_session_id"
            case claudeSessionID = "claude_session_id", requireReadOnly = "require_read_only", ownerPolicy = "owner_policy"
            case explicitRoutes = "explicit_routes"
            case conversationID = "conversation_id", submissionID = "submission_id"
            case capacityPlan = "capacity_plan"
            case explicitRoutesBestEffort = "explicit_routes_best_effort"
        }
    }
    /// A Core-admitted, read-only routing derivation. It preserves the original
    /// host identity, and native readers independently compile the same proposal.
    /// A hash is an integrity binding, never authority to invent recipients.
    public struct CoreRouting: Codable, Equatable, Sendable {
        public var schema: Int = 1
        public var originalSourceFingerprint: String
        public var originalMode: Mode
        public var originalProviderPreference: String
        public var originalRequireReadOnly: Bool
        public var resolutionSHA256: String
        public var modelAnswer: String?
        public init(originalSourceFingerprint: String, originalMode: Mode,
                    originalProviderPreference: String, originalRequireReadOnly: Bool,
                    resolutionSHA256: String, modelAnswer: String? = nil) {
            self.originalSourceFingerprint = originalSourceFingerprint; self.originalMode = originalMode
            self.originalProviderPreference = originalProviderPreference; self.originalRequireReadOnly = originalRequireReadOnly
            self.resolutionSHA256 = resolutionSHA256; self.modelAnswer = modelAnswer
        }
        enum CodingKeys: String, CodingKey {
            case schema, originalSourceFingerprint = "original_source_fingerprint", originalMode = "original_mode"
            case originalProviderPreference = "original_provider_preference", originalRequireReadOnly = "original_require_read_only"
            case resolutionSHA256 = "resolution_sha256", modelAnswer = "model_answer"
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
        public var coreRouting: CoreRouting?
        /// Explicit host migration marker, separate from unchanged original request bytes.
        public var routingIntentPolicyVersion: String?
        public init(schema: Int = 1, taskID: String, request: String, requestSHA256: String, objective: String,
                    policySHA256: String, sourceFingerprint: String, mode: Mode, materialRefs: [String], budget: Budget,
                    context: String? = nil, workspace: String? = nil, nativeSessions: [String: String]? = nil,
                    providerPreference: String? = nil, policy: Policy? = nil, hostContext: HostContext? = nil,
                    coreRouting: CoreRouting? = nil, routingIntentPolicyVersion: String? = nil) {
            self.schema = schema; self.taskID = taskID; self.request = request; self.requestSHA256 = requestSHA256
            self.objective = objective; self.policySHA256 = policySHA256; self.sourceFingerprint = sourceFingerprint
            self.mode = mode; self.materialRefs = materialRefs; self.budget = budget; self.context = context
            self.workspace = workspace; self.nativeSessions = nativeSessions; self.providerPreference = providerPreference; self.policy = policy
            self.hostContext = hostContext; self.coreRouting = coreRouting
            self.routingIntentPolicyVersion = routingIntentPolicyVersion
        }
        enum CodingKeys: String, CodingKey {
            case schema, request, objective, mode, budget, context, workspace, policy
            case taskID = "task_id", requestSHA256 = "request_sha256", policySHA256 = "policy_sha256"
            case sourceFingerprint = "source_fingerprint", materialRefs = "material_refs", nativeSessions = "native_sessions"
            case providerPreference = "provider_preference"
            case hostContext = "host_context", coreRouting = "core_routing"
            case routingIntentPolicyVersion = "routing_intent_policy_version"
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
    /// Why configured profiles produced no candidate, counted per provider.
    /// Evidence for an explicit hold, never a routing proposal or quota claim.
    public struct Exclusion: Codable, Equatable, Sendable {
        public static let reasons: Set<String> = ["signed_out", "non_subscription", "model_unavailable", "quota_zero",
            "capacity_zero", "codex_hidden", "effort_requires_explicit_request", "explicit_constraint_unavailable",
            "chat_gate_refused", "gpt_dropped", "quota_backoff", "reference_unavailable"]
        public static let providers: Set<String> = ["codex", "claude"]
        public var provider: String
        public var reason: String
        public var count: Int
        public init(provider: String, reason: String, count: Int) {
            self.provider = provider; self.reason = reason; self.count = count
        }
    }
    /// The owner's explicit routing constraint (`RoutingIntent`) the native
    /// builder already applied to the rows. Optional on the catalog: absent
    /// without a constraint and in older catalogs. Both keys are always
    /// written (null when unset), the shape the JS core checks exactly.
    public struct RoutingIntentConstraint: Codable, Equatable, Sendable {
        public static let efforts: Set<String> = ["low", "medium", "high", "xhigh", "max", "ultra"]
        public var effort: String?
        public var modelFamily: String?
        public init(effort: String?, modelFamily: String?) { self.effort = effort; self.modelFamily = modelFamily }
        enum CodingKeys: String, CodingKey { case effort, modelFamily = "model_family" }
        public func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(effort, forKey: .effort)
            try container.encode(modelFamily, forKey: .modelFamily)
        }
    }
    /// R10 v2 is a host-opted semantic contract, not an admission certificate.
    /// Empty allowedSurfaces means no additional surface constraint.
    public struct RoutingIntentV2: Codable, Equatable, Sendable {
        public static let version = "r10_joint_selection_v2"
        public var version: String = Self.version
        public var allowedSurfaces: [String] = []
        public var exactModel: String? = nil
        public var modelFamily: String? = nil
        public var effort: String? = nil
        public var requireNativeCeiling = false
        public var qualityTarget: String? = nil
        public var state = "resolved"
        public init() {}
        public var valid: Bool {
            version == Self.version && ["resolved", "unresolved"].contains(state) &&
            allowedSurfaces.count <= 3 && Set(allowedSurfaces).count == allowedSurfaces.count &&
            Set(allowedSurfaces).isSubset(of: ["codex", "claude", "claude-chat"]) &&
            (exactModel.map { !$0.isEmpty && $0.utf8.count <= 256 && !$0.contains("\0") } ?? true) &&
            (modelFamily.map { RoutingIntent.families.contains($0) } ?? true) &&
            !(exactModel != nil && modelFamily != nil) &&
            (effort.map { Effort(rawValue: $0) != nil } ?? true) &&
            !(requireNativeCeiling && effort != nil) &&
            (qualityTarget == nil || qualityTarget == "current_host_reference")
        }
        enum CodingKeys: String, CodingKey {
            case version, effort, state
            case allowedSurfaces = "allowed_surfaces", exactModel = "exact_model", modelFamily = "model_family"
            case requireNativeCeiling = "require_native_ceiling", qualityTarget = "quality_target"
        }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            guard [CodingKeys.version, .allowedSurfaces, .exactModel, .modelFamily, .effort,
                   .requireNativeCeiling, .qualityTarget, .state].allSatisfy(c.contains)
            else { throw Rejection.invalidObservation }
            version = try c.decode(String.self, forKey: .version)
            allowedSurfaces = try c.decode([String].self, forKey: .allowedSurfaces)
            exactModel = try c.decodeIfPresent(String.self, forKey: .exactModel)
            modelFamily = try c.decodeIfPresent(String.self, forKey: .modelFamily)
            effort = try c.decodeIfPresent(String.self, forKey: .effort)
            requireNativeCeiling = try c.decode(Bool.self, forKey: .requireNativeCeiling)
            qualityTarget = try c.decodeIfPresent(String.self, forKey: .qualityTarget)
            state = try c.decode(String.self, forKey: .state)
        }
        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(version, forKey: .version); try c.encode(state, forKey: .state)
            try c.encode(allowedSurfaces, forKey: .allowedSurfaces)
            try c.encode(exactModel, forKey: .exactModel); try c.encode(modelFamily, forKey: .modelFamily)
            try c.encode(effort, forKey: .effort); try c.encode(requireNativeCeiling, forKey: .requireNativeCeiling)
            try c.encode(qualityTarget, forKey: .qualityTarget)
        }
    }
    /// Build 407 (R0/R2/R11): the host's deterministic class of a request,
    /// computed from host predicates only (`RCCNativeCatalogBuilder.requestClass`),
    /// never from a model. It keys the signed class table.
    public enum RequestClass: String, Codable, Sendable, CaseIterable {
        case chatExplanatory = "chat_explanatory", textOperation = "text_operation"
        case readonlyLookup = "readonly_lookup", readonlyMaterial = "readonly_material"
        case writer, explicitRoute = "explicit_route"
        /// A class certificate may lower only read-only work (R0(c); writers
        /// never go below the reference in v1, R5). Owner words own explicit routes.
        public var certifiable: Bool { ![.writer, .explicitRoute].contains(self) }
    }
    /// Build 407 (R0(c)): one signed class certificate from a frozen offline
    /// measurement. The tuple is the certified (provider, model, effort);
    /// `format_check` names the per-answer check Core runs before adoption.
    public struct ClassCertificate: Codable, Equatable, Sendable {
        public var certificateID: String
        public var provider: String
        public var model: String
        public var effort: Effort
        public var formatCheck: String
        public var measurementSHA256: String
        public init(certificateID: String, provider: String, model: String, effort: Effort, formatCheck: String,
                    measurementSHA256: String) {
            self.certificateID = certificateID; self.provider = provider; self.model = model; self.effort = effort
            self.formatCheck = formatCheck; self.measurementSHA256 = measurementSHA256
        }
        enum CodingKeys: String, CodingKey {
            case provider, model, effort, certificateID = "certificate_id", formatCheck = "format_check"
            case measurementSHA256 = "measurement_sha256"
        }
    }
    /// Host-read, exact owner spans and independently FULL checked child contracts.
    /// This is a bounded non-statistical R0 capability, not trained/P7 evidence.
    public struct OwnerCollectionFact: Codable, Equatable, Sendable {
        public var schema: Int = 1
        public var kind: String = "independent_readonly_json_v1"
        public var manifestSHA256: String
        public var obligations: [Obligation]
        public struct Obligation: Codable, Equatable, Sendable {
            public var id: String
            public var instruction: String
            public var requestUTF8Start: Int
            public var requestUTF8End: Int
            public var sourcePaths: [String]
            public var sourceSHA256s: [String]
            public var contractSHA256: String
            public var verifierSHA256: String
            public var requiredCheckIDs: [String]
            public var validUntilMS: Int64
            public init(id: String, instruction: String, requestUTF8Start: Int, requestUTF8End: Int,
                        sourcePaths: [String], sourceSHA256s: [String], contractSHA256: String,
                        verifierSHA256: String, requiredCheckIDs: [String], validUntilMS: Int64) {
                self.id = id; self.instruction = instruction; self.requestUTF8Start = requestUTF8Start
                self.requestUTF8End = requestUTF8End; self.sourcePaths = sourcePaths; self.sourceSHA256s = sourceSHA256s
                self.contractSHA256 = contractSHA256; self.verifierSHA256 = verifierSHA256
                self.requiredCheckIDs = requiredCheckIDs; self.validUntilMS = validUntilMS
            }
            enum CodingKeys: String, CodingKey {
                case id, instruction, requestUTF8Start = "request_utf8_start", requestUTF8End = "request_utf8_end"
                case sourcePaths = "source_paths", sourceSHA256s = "source_sha256s", contractSHA256 = "contract_sha256"
                case verifierSHA256 = "verifier_sha256", requiredCheckIDs = "required_check_ids", validUntilMS = "valid_until_ms"
            }
        }
        public init(manifestSHA256: String, obligations: [Obligation]) {
            self.manifestSHA256 = manifestSHA256; self.obligations = obligations
        }
        enum CodingKeys: String, CodingKey {
            case schema, kind, manifestSHA256 = "manifest_sha256", obligations
        }
    }
    /// Build 407 (R0(a)): an owner task contract the host found for exactly
    /// this request text and re-checked at catalog time with the predicate
    /// `PreparedTaskQuality.prepare` enforces (objective, context, source,
    /// start tree, reference policy) plus validity. Absent = no contract.
    public struct TaskContractFact: Codable, Equatable, Sendable {
        public var coverage: OperationalQuality.Coverage
        public var scope: Scope
        public var objectiveSHA256: String
        public var contractSHA256: String
        public var contextSHA256: String
        public var sourceSHA256: String?
        public var startTreeSHA256: String
        public var referencePolicySHA256: String
        public var validUntilMS: Int64
        public var bindingsChecked: Bool
        /// Host-rechecked local-effects/fresh-session capability; absent preserves exclusive legacy dispatch.
        public var executionIsolation: String?
        public var executionIsolationSHA256: String?
        public var stagedWriterEnvelopeSHA256: String?
        public var stagedWriterBaseSHA256: String?
        public var ownerCollection: OwnerCollectionFact?
        public init(coverage: OperationalQuality.Coverage, scope: Scope, objectiveSHA256: String, contractSHA256: String,
                    contextSHA256: String, sourceSHA256: String?, startTreeSHA256: String, referencePolicySHA256: String,
                    validUntilMS: Int64, bindingsChecked: Bool = true, executionIsolation: String? = nil, executionIsolationSHA256: String? = nil, stagedWriterEnvelopeSHA256: String? = nil, stagedWriterBaseSHA256: String? = nil, ownerCollection: OwnerCollectionFact? = nil) {
            self.ownerCollection = ownerCollection
            self.coverage = coverage; self.scope = scope; self.objectiveSHA256 = objectiveSHA256
            self.contractSHA256 = contractSHA256; self.contextSHA256 = contextSHA256; self.sourceSHA256 = sourceSHA256
            self.startTreeSHA256 = startTreeSHA256; self.referencePolicySHA256 = referencePolicySHA256
            self.validUntilMS = validUntilMS; self.bindingsChecked = bindingsChecked; self.executionIsolation = executionIsolation; self.executionIsolationSHA256 = executionIsolationSHA256
            self.stagedWriterEnvelopeSHA256 = stagedWriterEnvelopeSHA256; self.stagedWriterBaseSHA256 = stagedWriterBaseSHA256
        }
        enum CodingKeys: String, CodingKey {
            case coverage, scope, objectiveSHA256 = "objective_sha256", contractSHA256 = "contract_sha256"
            case contextSHA256 = "context_sha256", sourceSHA256 = "source_sha256", startTreeSHA256 = "start_tree_sha256"
            case referencePolicySHA256 = "reference_policy_sha256", validUntilMS = "valid_until_ms"
            case bindingsChecked = "bindings_checked", executionIsolation = "execution_isolation", executionIsolationSHA256 = "execution_isolation_sha256"
            case stagedWriterEnvelopeSHA256 = "staged_writer_envelope_sha256", stagedWriterBaseSHA256 = "staged_writer_base_sha256"
            case ownerCollection = "owner_collection"
        }
    }
    public struct Catalog: Codable, Equatable, Sendable {
        public var schema: Int
        public var taskID: String
        public var requestSHA256: String
        public var candidates: [Candidate]
        /// Optional: absent in older catalogs. Required (non-empty) when no
        /// candidate is routable, so an empty catalog is never opaque.
        public var exclusions: [Exclusion]?
        /// Optional (2026-10-13): present only with an explicit owner constraint.
        public var routingIntentV2: RoutingIntentV2?
        public var routingIntent: RoutingIntentConstraint?
        /// Optional (build 378): the provider-stated tier (`ModelTiers`) of each
        /// tiered model in `candidates`, keyed by exact model name. Absent in
        /// older catalogs, where the core keeps its former reference routing.
        public var modelTiers: [String: String]?
        /// Optional (build 378): an explicit route test's own effort/model
        /// words per route, aligned with the host's original explicit route
        /// list (null where a route has none). Absent elsewhere.
        public var explicitRouteIntents: [RoutingIntentConstraint?]?
        /// Optional (build 378): per offered model with known quota, the
        /// builder's pool score for that model (capacity share x its own
        /// remaining quota / hours to its own reset), in integer parts per
        /// billion (0 ... 1_000_000_000).
        public var quotaScores: [String: Int]?
        /// Optional native capability evidence, separate from signed/executable
        /// candidates. A missing highest profile must not lower a reference.
        /// Exact candidate model names, grouped by codex/claude; never local.
        public var nativeReferenceEfforts: [String: [String: String]]?
        /// Optional (build 407), host facts for the Core admission law. The
        /// first three travel together; the rest exist only beside them.
        /// A catalog without them binds the reference.
        /// `ownerRequestRunsReadOnly` of the request (R2), affirmative only.
        public var ownerScope: Scope?
        /// The narrow chat-lane predicate the host already computes (R2/R3).
        public var chatLaneEligible: Bool?
        public var requestClass: RequestClass?
        /// An owner contract re-bound at catalog time (R0(a)); absent otherwise.
        public var taskContract: TaskContractFact?
        /// The signed class table's certificate for `request_class` only (R0(c)).
        public var classCertificates: [String: ClassCertificate]?
        /// The signed class table's reference-pool pin for `request_class` only (R11).
        public var classProviderPins: [String: String]?
        public init(schema: Int = 1, taskID: String, requestSHA256: String, candidates: [Candidate],
                    exclusions: [Exclusion]? = nil, routingIntent: RoutingIntentConstraint? = nil,
                    modelTiers: [String: String]? = nil, explicitRouteIntents: [RoutingIntentConstraint?]? = nil,
                    quotaScores: [String: Int]? = nil, nativeReferenceEfforts: [String: [String: String]]? = nil,
                    ownerScope: Scope? = nil, chatLaneEligible: Bool? = nil, requestClass: RequestClass? = nil,
                    taskContract: TaskContractFact? = nil, classCertificates: [String: ClassCertificate]? = nil,
                    classProviderPins: [String: String]? = nil, routingIntentV2: RoutingIntentV2? = nil) {
            self.schema = schema; self.taskID = taskID; self.requestSHA256 = requestSHA256; self.candidates = candidates
            self.routingIntentV2 = routingIntentV2
            self.exclusions = exclusions; self.routingIntent = routingIntent; self.modelTiers = modelTiers
            self.explicitRouteIntents = explicitRouteIntents; self.quotaScores = quotaScores
            self.nativeReferenceEfforts = nativeReferenceEfforts
            self.ownerScope = ownerScope; self.chatLaneEligible = chatLaneEligible; self.requestClass = requestClass
            self.taskContract = taskContract; self.classCertificates = classCertificates
            self.classProviderPins = classProviderPins
        }
        enum CodingKeys: String, CodingKey {
            case schema, candidates, exclusions, taskID = "task_id", requestSHA256 = "request_sha256"
            case routingIntent = "routing_intent", modelTiers = "model_tiers", routingIntentV2 = "routing_intent_v2"
            case explicitRouteIntents = "explicit_route_intents", quotaScores = "quota_scores"
            case nativeReferenceEfforts = "native_reference_efforts"
            case ownerScope = "owner_scope", chatLaneEligible = "chat_lane_eligible", requestClass = "request_class"
            case taskContract = "task_contract", classCertificates = "class_certificates"
            case classProviderPins = "class_provider_pins"
        }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            schema = try c.decode(Int.self, forKey: .schema)
            taskID = try c.decode(String.self, forKey: .taskID)
            requestSHA256 = try c.decode(String.self, forKey: .requestSHA256)
            candidates = try c.decode([Candidate].self, forKey: .candidates)
            exclusions = try c.decodeIfPresent([Exclusion].self, forKey: .exclusions)
            routingIntent = try c.decodeIfPresent(RoutingIntentConstraint.self, forKey: .routingIntent)
            routingIntentV2 = c.contains(.routingIntentV2)
                ? try c.decode(RoutingIntentV2.self, forKey: .routingIntentV2) : nil
            modelTiers = try c.decodeIfPresent([String: String].self, forKey: .modelTiers)
            explicitRouteIntents = try c.decodeIfPresent([RoutingIntentConstraint?].self, forKey: .explicitRouteIntents)
            quotaScores = try c.decodeIfPresent([String: Int].self, forKey: .quotaScores)
            // Absence is legacy; explicit null is not a native attestation.
            nativeReferenceEfforts = c.contains(.nativeReferenceEfforts)
                ? try c.decode([String: [String: String]].self, forKey: .nativeReferenceEfforts) : nil
            ownerScope = try c.decodeIfPresent(Scope.self, forKey: .ownerScope)
            chatLaneEligible = try c.decodeIfPresent(Bool.self, forKey: .chatLaneEligible)
            requestClass = try c.decodeIfPresent(RequestClass.self, forKey: .requestClass)
            taskContract = try c.decodeIfPresent(TaskContractFact.self, forKey: .taskContract)
            classCertificates = try c.decodeIfPresent([String: ClassCertificate].self, forKey: .classCertificates)
            classProviderPins = try c.decodeIfPresent([String: String].self, forKey: .classProviderPins)
        }
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
    /// Wire presence is semantic: omission is a legacy single worker, null
    /// collects independent outputs, and a string names the final owner.
    /// Optional<String> cannot preserve the first two states through Codable.
    public enum PlanFinalNode: Equatable, Sendable {
        case absent
        case collection
        case node(String)
    }
    /// A trusted caller may read a host-bound collection after Core inserted
    /// writer safety ordering. A proposal cannot opt in through JSON.
    public enum PlanValidationContext: Equatable, Sendable {
        case authored
        case hostBound
        /// Caller has already established the original explicit-routing mode.
        /// Existing Core fan-outs omit final_node_id and collect every route.
        case hostBoundExplicitRoutes
    }
    public struct Plan: Codable, Equatable, Sendable {
        public var schema: Int
        public var taskID: String
        public var requestSHA256: String
        public var nodes: [PlanNode]
        public var finalNodeID: PlanFinalNode
        public init(schema: Int = 1, taskID: String, requestSHA256: String, nodes: [PlanNode],
                    finalNodeID: PlanFinalNode = .absent) {
            self.schema = schema; self.taskID = taskID; self.requestSHA256 = requestSHA256; self.nodes = nodes
            self.finalNodeID = finalNodeID
        }
        enum CodingKeys: String, CodingKey {
            case schema, nodes, taskID = "task_id", requestSHA256 = "request_sha256", finalNodeID = "final_node_id"
        }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            schema = try c.decode(Int.self, forKey: .schema)
            taskID = try c.decode(String.self, forKey: .taskID)
            requestSHA256 = try c.decode(String.self, forKey: .requestSHA256)
            nodes = try c.decode([PlanNode].self, forKey: .nodes)
            if !c.contains(.finalNodeID) { finalNodeID = .absent }
            else if try c.decodeNil(forKey: .finalNodeID) { finalNodeID = .collection }
            else { finalNodeID = .node(try c.decode(String.self, forKey: .finalNodeID)) }
        }
        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(schema, forKey: .schema)
            try c.encode(taskID, forKey: .taskID)
            try c.encode(requestSHA256, forKey: .requestSHA256)
            try c.encode(nodes, forKey: .nodes)
            switch finalNodeID {
            case .absent: break
            case .collection: try c.encodeNil(forKey: .finalNodeID)
            case .node(let id): try c.encode(id, forKey: .finalNodeID)
            }
        }
    }
    /// Native receipt facts, not marker text or a model-authored permission grant.
    public enum HandbackKind: String, Codable, Sendable {
        case fullAccessRequired = "full_access_required", os1ChangeRequired = "os1_change_required", both
    }
    public enum HandbackAdoption: String, Codable, Sendable { case returned, rejected }
    public struct Handback: Codable, Equatable, Sendable {
        public var kind: HandbackKind
        public var nativeSessionID: String
        public var protectedRoot: String
        public var sourceHead: String
        public var protectedSourceSHA256: String
        public var sourceFingerprint: String
        public var requestSHA256: String
        public var parentAttemptID: String
        public var exitCode: Int
        public var cancelled: Bool
        public var adoption: HandbackAdoption
        public init(kind: HandbackKind, nativeSessionID: String, protectedRoot: String, sourceHead: String,
                    protectedSourceSHA256: String, sourceFingerprint: String, requestSHA256: String,
                    parentAttemptID: String, exitCode: Int = 0, cancelled: Bool = false,
                    adoption: HandbackAdoption = .returned) {
            self.kind = kind; self.nativeSessionID = nativeSessionID; self.protectedRoot = protectedRoot
            self.sourceHead = sourceHead; self.protectedSourceSHA256 = protectedSourceSHA256
            self.sourceFingerprint = sourceFingerprint; self.requestSHA256 = requestSHA256
            self.parentAttemptID = parentAttemptID; self.exitCode = exitCode
            self.cancelled = cancelled; self.adoption = adoption
        }
        enum CodingKeys: String, CodingKey {
            case kind, cancelled, adoption
            case nativeSessionID = "native_session_id", protectedRoot = "protected_root", sourceHead = "source_head"
            case protectedSourceSHA256 = "protected_source_sha256", sourceFingerprint = "source_fingerprint"
            case requestSHA256 = "request_sha256", parentAttemptID = "parent_attempt_id", exitCode = "exit_code"
        }
    }
    public struct Continuation: Codable, Equatable, Sendable {
        public var kind: HandbackKind
        public var parentAttemptID: String
        public var parentNativeReceipt: String
        public var parentNativeReceiptSHA256: String
        public var nativeSessionID: String
        public var protectedRoot: String
        public var sourceHead: String
        public var protectedSourceSHA256: String
        public var sourceFingerprint: String
        public var requestSHA256: String
        public init(kind: HandbackKind, parentAttemptID: String, parentNativeReceipt: String,
                    parentNativeReceiptSHA256: String, nativeSessionID: String, protectedRoot: String,
                    sourceHead: String, protectedSourceSHA256: String, sourceFingerprint: String, requestSHA256: String) {
            self.kind = kind; self.parentAttemptID = parentAttemptID; self.parentNativeReceipt = parentNativeReceipt
            self.parentNativeReceiptSHA256 = parentNativeReceiptSHA256; self.nativeSessionID = nativeSessionID
            self.protectedRoot = protectedRoot; self.sourceHead = sourceHead
            self.protectedSourceSHA256 = protectedSourceSHA256; self.sourceFingerprint = sourceFingerprint
            self.requestSHA256 = requestSHA256
        }
        enum CodingKeys: String, CodingKey {
            case kind, parentAttemptID = "parent_attempt_id", parentNativeReceipt = "parent_native_receipt"
            case parentNativeReceiptSHA256 = "parent_native_receipt_sha256", nativeSessionID = "native_session_id"
            case protectedRoot = "protected_root", sourceHead = "source_head", protectedSourceSHA256 = "protected_source_sha256"
            case sourceFingerprint = "source_fingerprint", requestSHA256 = "request_sha256"
        }
    }
    /// Host-produced operational checking evidence, not a reference grade.
    public struct OperationalQuality: Codable, Equatable, Sendable {
        public enum Coverage: String, Codable, Sendable { case partial, full }
        public var schema: Int = 1
        public var coverage: Coverage
        public var assessmentState: TaskQualityEvidence.State
        public var contractSHA256: String
        public var witnessPath: String
        public var witnessSHA256: String
        public var artifactSHA256: String
        public var workspaceAfterSHA256: String
        public var failedCheckIDs: [String]
        public var correctiveAttempts: Int
        public var localOnlyVerified: Bool
        public init(coverage: Coverage, assessmentState: TaskQualityEvidence.State, contractSHA256: String,
                    witnessPath: String, witnessSHA256: String, artifactSHA256: String, workspaceAfterSHA256: String,
                    failedCheckIDs: [String], correctiveAttempts: Int, localOnlyVerified: Bool) {
            self.coverage = coverage; self.assessmentState = assessmentState; self.contractSHA256 = contractSHA256
            self.witnessPath = witnessPath; self.witnessSHA256 = witnessSHA256; self.artifactSHA256 = artifactSHA256
            self.workspaceAfterSHA256 = workspaceAfterSHA256; self.failedCheckIDs = failedCheckIDs
            self.correctiveAttempts = correctiveAttempts; self.localOnlyVerified = localOnlyVerified
        }
        enum CodingKeys: String, CodingKey {
            case schema, coverage
            case assessmentState = "assessment_state", contractSHA256 = "contract_sha256", witnessPath = "witness_path"
            case witnessSHA256 = "witness_sha256", artifactSHA256 = "artifact_sha256", workspaceAfterSHA256 = "workspace_after_sha256"
            case failedCheckIDs = "failed_check_ids", correctiveAttempts = "corrective_attempts", localOnlyVerified = "local_only_verified"
        }
    }
    /// A known completed local writer's correction, separate from permission
    /// handback. It neither changes the original instruction nor grants scope.
    public struct QualityContinuation: Codable, Equatable, Sendable {
        public var schema: Int = 1
        public var parentAttemptID: String
        public var parentNativeReceipt: String
        public var parentNativeReceiptSHA256: String
        public var witnessPath: String
        public var witnessSHA256: String
        public var expectedWorkspaceAfterSHA256: String
        public var originalInstructionSHA256: String
        public var correctiveAttempts: Int
        public init(parentAttemptID: String, parentNativeReceipt: String, parentNativeReceiptSHA256: String,
                    witnessPath: String, witnessSHA256: String, expectedWorkspaceAfterSHA256: String,
                    originalInstructionSHA256: String, correctiveAttempts: Int = 1) {
            self.parentAttemptID = parentAttemptID; self.parentNativeReceipt = parentNativeReceipt
            self.parentNativeReceiptSHA256 = parentNativeReceiptSHA256; self.witnessPath = witnessPath
            self.witnessSHA256 = witnessSHA256; self.expectedWorkspaceAfterSHA256 = expectedWorkspaceAfterSHA256
            self.originalInstructionSHA256 = originalInstructionSHA256; self.correctiveAttempts = correctiveAttempts
        }
        enum CodingKeys: String, CodingKey {
            case schema, parentAttemptID = "parent_attempt_id", parentNativeReceipt = "parent_native_receipt"
            case parentNativeReceiptSHA256 = "parent_native_receipt_sha256", witnessPath = "witness_path", witnessSHA256 = "witness_sha256"
            case expectedWorkspaceAfterSHA256 = "expected_workspace_after_sha256", originalInstructionSHA256 = "original_instruction_sha256"
            case correctiveAttempts = "corrective_attempts"
        }
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
        public var coreRouting: CoreRouting?
        /// Optional continuity hint, not an account/ownership inference. The
        /// core may issue it only for a single full-native agent plan; adapters
        /// must independently retain the exact selected account authorization.
        public var nativeResumeSessionID: String?
        public var continuation: Continuation?
        public var qualityContinuation: QualityContinuation?
        public var instruction: String
        public var contextRefs: [String]
        public var ownedPaths: [String]
        /// Optional (build 407, R5): Core sets it on a reference or explicit
        /// final-owner node, whose native CLI may then run its own sub-agents
        /// (Codex ultra's automatic delegation). Absent/false keeps OS-1's
        /// managed delegation (sub-agent tools off). Not part of authorization.
        public var allowNativeSubagents: Bool?
        public var executionIsolation: String?
        public var executionIsolationSHA256: String?
        public var stagedWriterEnvelopeSHA256: String?
        public var stagedWriterBaseSHA256: String?
        public init(schema: Int = 1, taskID: String, nodeID: String, attemptID: String, candidateID: String,
                    requestSHA256: String, policySHA256: String, policySourceSHA256: String, sourceFingerprint: String,
                    configurationSHA256: String, selectedConfig: ExactConfig, objective: String, instruction: String,
                    contextRefs: [String], ownedPaths: [String], originalRequest: String? = nil,
                    originalObjective: String? = nil, hostContext: HostContext? = nil,
                    nativeResumeSessionID: String? = nil, continuation: Continuation? = nil, coreRouting: CoreRouting? = nil, qualityContinuation: QualityContinuation? = nil,
                    allowNativeSubagents: Bool? = nil, executionIsolation: String? = nil, executionIsolationSHA256: String? = nil, stagedWriterEnvelopeSHA256: String? = nil, stagedWriterBaseSHA256: String? = nil) {
            self.schema = schema; self.taskID = taskID; self.nodeID = nodeID; self.attemptID = attemptID
            self.candidateID = candidateID; self.requestSHA256 = requestSHA256; self.policySHA256 = policySHA256
            self.policySourceSHA256 = policySourceSHA256; self.sourceFingerprint = sourceFingerprint
            self.configurationSHA256 = configurationSHA256; self.selectedConfig = selectedConfig
            self.objective = objective; self.instruction = instruction; self.contextRefs = contextRefs; self.ownedPaths = ownedPaths
            self.originalRequest = originalRequest; self.originalObjective = originalObjective; self.hostContext = hostContext
            self.nativeResumeSessionID = nativeResumeSessionID
            self.continuation = continuation; self.coreRouting = coreRouting; self.qualityContinuation = qualityContinuation
            self.allowNativeSubagents = allowNativeSubagents
            self.executionIsolation = executionIsolation; self.executionIsolationSHA256 = executionIsolationSHA256
            self.stagedWriterEnvelopeSHA256 = stagedWriterEnvelopeSHA256; self.stagedWriterBaseSHA256 = stagedWriterBaseSHA256
        }
        enum CodingKeys: String, CodingKey {
            case schema, objective, instruction
            case taskID = "task_id", nodeID = "node_id", attemptID = "attempt_id", candidateID = "candidate_id"
            case requestSHA256 = "request_sha256", policySHA256 = "policy_sha256", policySourceSHA256 = "policy_source_sha256"
            case sourceFingerprint = "source_fingerprint", configurationSHA256 = "configuration_sha256"
            case selectedConfig = "selected_config", contextRefs = "context_refs", ownedPaths = "owned_paths"
            case originalRequest = "original_request", originalObjective = "original_objective", hostContext = "host_context"
            case nativeResumeSessionID = "native_resume_session_id"
            case continuation, coreRouting = "core_routing", qualityContinuation = "quality_continuation"
            case allowNativeSubagents = "allow_native_subagents"
            case executionIsolation = "execution_isolation", executionIsolationSHA256 = "execution_isolation_sha256"
            case stagedWriterEnvelopeSHA256 = "staged_writer_envelope_sha256", stagedWriterBaseSHA256 = "staged_writer_base_sha256"
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
    public struct RepairSource: Codable, Equatable, Sendable {
        public var sourceRoot: String
        public var sourceHead: String
        public var sourceBeforeHead: String
        public var sourceBeforeSHA256: String
        public var protectedSourceSHA256: String
        public var sourceBeforeClean: Bool
        public var changedPaths: [String]
        public init(sourceRoot: String, sourceHead: String, sourceBeforeHead: String, sourceBeforeSHA256: String,
                    protectedSourceSHA256: String, sourceBeforeClean: Bool, changedPaths: [String]) {
            self.sourceRoot = sourceRoot; self.sourceHead = sourceHead; self.sourceBeforeHead = sourceBeforeHead
            self.sourceBeforeSHA256 = sourceBeforeSHA256; self.protectedSourceSHA256 = protectedSourceSHA256
            self.sourceBeforeClean = sourceBeforeClean; self.changedPaths = changedPaths
        }
        enum CodingKeys: String, CodingKey {
            case sourceRoot = "source_root", sourceHead = "source_head", sourceBeforeHead = "source_before_head"
            case sourceBeforeSHA256 = "source_before_sha256", protectedSourceSHA256 = "protected_source_sha256"
            case sourceBeforeClean = "source_before_clean", changedPaths = "changed_paths"
        }
    }
    public enum InstallState: String, Codable, Sendable { case staged, installed, failed, cancelled, effectsUncertain = "effects_uncertain" }
    public struct InstallHandoff: Codable, Equatable, Sendable {
        public var schema: Int = 1
        public var taskID: String
        public var requestSHA256: String
        public var nodeID: String
        public var parentAttemptID: String
        public var sourceFingerprint: String
        public var sourceRoot: String
        public var sourceHead: String
        public var protectedSourceSHA256: String
        public var stagedIntentID: String
        public var stagedReceiptSHA256: String
        public var state: InstallState
        public var installedReceipt: String?
        public init(taskID: String, requestSHA256: String, nodeID: String, parentAttemptID: String,
                    sourceFingerprint: String, sourceRoot: String, sourceHead: String, protectedSourceSHA256: String,
                    stagedIntentID: String, stagedReceiptSHA256: String, state: InstallState, installedReceipt: String? = nil) {
            self.taskID = taskID; self.requestSHA256 = requestSHA256; self.nodeID = nodeID
            self.parentAttemptID = parentAttemptID; self.sourceFingerprint = sourceFingerprint; self.sourceRoot = sourceRoot
            self.sourceHead = sourceHead; self.protectedSourceSHA256 = protectedSourceSHA256; self.stagedIntentID = stagedIntentID
            self.stagedReceiptSHA256 = stagedReceiptSHA256; self.state = state; self.installedReceipt = installedReceipt
        }
        enum CodingKeys: String, CodingKey {
            case schema, state, taskID = "task_id", requestSHA256 = "request_sha256", nodeID = "node_id"
            case parentAttemptID = "parent_attempt_id", sourceFingerprint = "source_fingerprint", sourceRoot = "source_root"
            case sourceHead = "source_head", protectedSourceSHA256 = "protected_source_sha256"
            case stagedIntentID = "staged_intent_id", stagedReceiptSHA256 = "staged_receipt_sha256", installedReceipt = "installed_receipt"
        }
    }
    /// Host-owned atomic workspace transaction result, never a model-authored grade.
    public struct StagedWriter: Codable, Equatable, Sendable {
        public enum State: String, Codable, Sendable { case applied, discarded, held }
        public var state: State
        public var receiptPath: String
        public var receiptSHA256: String
        public init(state: State, receiptPath: String, receiptSHA256: String) {
            self.state = state; self.receiptPath = receiptPath; self.receiptSHA256 = receiptSHA256
        }
        enum CodingKeys: String, CodingKey {
            case state, receiptPath = "receipt_path", receiptSHA256 = "receipt_sha256"
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
        public var handback: Handback?
        public var repairSource: RepairSource?
        /// The adapter's attestation that the native turn itself ENDED: OS-1
        /// closed the provider process it owned (the Codex app-server writer,
        /// the Claude CLI), a Codex Desktop turn reported a terminal status,
        /// or nothing was dispatched (`RCCNativeAttemptOutcome.turnTerminated`).
        /// false: the record returned but the turn may still run elsewhere
        /// (Codex Desktop). Core releases a settled read-only attempt's pool
        /// lease only on true. Absent on records from older adapters.
        public var nativeTurnTerminated: Bool?
        public var operationalQuality: OperationalQuality?
        public var stagedWriter: StagedWriter?
        /// Actual host-prepared input metadata, never a token/quality/admission certificate.
        public var configuredInputObservation: RCCConfiguredInputObservation?
        public init(schema: Int = 1, taskID: String, nodeID: String, attemptID: String, candidateID: String,
                    configurationSHA256: String, selectedConfig: ExactConfig, acknowledgedConfig: ExactConfig?,
                    observedConfig: ExactConfig?, status: ExecutionStatus, output: String?, executionVerified: Bool,
                    taskVerified: Bool, taskQuality: TaskQuality, parityState: Parity, nativeReceipt: String?,
                    sideEffects: SideEffects, usage: Usage?, error: String? = nil,
                    dispatchStage: DispatchStage = .unknown, nativeSummary: String? = nil, handback: Handback? = nil,
                    repairSource: RepairSource? = nil, nativeTurnTerminated: Bool? = nil, operationalQuality: OperationalQuality? = nil, stagedWriter: StagedWriter? = nil,
                    configuredInputObservation: RCCConfiguredInputObservation? = nil) {
            self.schema = schema; self.taskID = taskID; self.nodeID = nodeID; self.attemptID = attemptID
            self.candidateID = candidateID; self.configurationSHA256 = configurationSHA256; self.selectedConfig = selectedConfig
            self.acknowledgedConfig = acknowledgedConfig; self.observedConfig = observedConfig; self.status = status
            self.dispatchStage = dispatchStage
            self.output = output; self.executionVerified = executionVerified; self.taskVerified = taskVerified
            self.taskQuality = taskQuality; self.parityState = parityState; self.nativeReceipt = nativeReceipt
            self.sideEffects = sideEffects; self.usage = usage; self.error = error
            self.nativeSummary = nativeSummary
            self.handback = handback
            self.repairSource = repairSource
            self.nativeTurnTerminated = nativeTurnTerminated; self.operationalQuality = operationalQuality; self.stagedWriter = stagedWriter
            self.configuredInputObservation = configuredInputObservation
        }
        enum CodingKeys: String, CodingKey {
            case schema, status, output, usage, error, handback
            case repairSource = "repair_source", nativeTurnTerminated = "native_turn_terminated", operationalQuality = "operational_quality", stagedWriter = "staged_writer"
            case taskID = "task_id", nodeID = "node_id", attemptID = "attempt_id", candidateID = "candidate_id"
            case configurationSHA256 = "configuration_sha256", selectedConfig = "selected_config"
            case acknowledgedConfig = "acknowledged_config", observedConfig = "observed_config"
            case executionVerified = "execution_verified", taskVerified = "task_verified", taskQuality = "task_quality"
            case parityState = "parity_state", nativeReceipt = "native_receipt", sideEffects = "side_effects"
            case dispatchStage = "dispatch_stage", nativeSummary = "native_summary"
            case configuredInputObservation = "configured_input_observation"
        }
    }
    /// Why the OpenClaw Core host bound this exact row (2026-10-13). The local
    /// planner grades a node (route_class, a task-family label); the host
    /// binds the pool's reference route (or an explicit owner constraint).
    /// This is a routing receipt, not observed execution or a quality claim.
    /// A nil route class means a row bound by the trusted adapter, not graded.
    public struct RoutingDecision: Codable, Equatable, Sendable {
        public static let routeClasses: Set<String> = ["trivial", "standard", "deep"]
        /// A route below the pool reference with its one REVAS escalation.
        /// Optional, present only on such a route. Without models (the REVAS
        /// effort ladder of 2026-10-13) it is a cheaper effort of the SAME
        /// model. With models (build 378 tier routing) the cheap tuple is a
        /// lower-tier model/effort and the reference is a frontier model at
        /// its reference effort, possibly in the other pool. The decision runs
        /// the cheap tuple, or the reference after a failure signal.
        public struct Ladder: Codable, Equatable, Sendable {
            public var cheapEffort: Effort
            public var referenceEffort: Effort
            public var cheapModel: String?
            public var referenceModel: String?
            public init(cheapEffort: Effort, referenceEffort: Effort, cheapModel: String? = nil, referenceModel: String? = nil) {
                self.cheapEffort = cheapEffort; self.referenceEffort = referenceEffort
                self.cheapModel = cheapModel; self.referenceModel = referenceModel
            }
            enum CodingKeys: String, CodingKey {
                case cheapEffort = "cheap_effort", referenceEffort = "reference_effort"
                case cheapModel = "cheap_model", referenceModel = "reference_model"
            }
        }
        public var routeClass: String?
        public var resolvedCandidateID: String
        public var surface: Surface
        public var model: String
        public var effort: Effort
        public var quotaPool: QuotaPool
        public var reason: String
        public var quotaRemainingFraction: Double?
        public var ladder: Ladder?
        /// Optional (build 378): the bound model's provider-stated tier
        /// (`ModelTier`) on a tier-routed catalog; nil for a model with no
        /// tier and absent in older decisions.
        public var tier: String?
        public init(routeClass: String?, resolvedCandidateID: String, surface: Surface, model: String, effort: Effort,
                    quotaPool: QuotaPool, reason: String, quotaRemainingFraction: Double?, ladder: Ladder? = nil,
                    tier: String? = nil) {
            self.routeClass = routeClass; self.resolvedCandidateID = resolvedCandidateID; self.surface = surface
            self.model = model; self.effort = effort; self.quotaPool = quotaPool; self.reason = reason
            self.quotaRemainingFraction = quotaRemainingFraction; self.ladder = ladder; self.tier = tier
        }
        enum CodingKeys: String, CodingKey {
            case surface, model, effort, reason, ladder, tier
            case routeClass = "route_class", resolvedCandidateID = "resolved_candidate_id"
            case quotaPool = "quota_pool", quotaRemainingFraction = "quota_remaining_fraction"
        }
    }
    /// Build 407 (R6): why a delivered child's completed output is not task
    /// verified. A partial operational check that failed (or a checker that
    /// was unavailable, or a registered node verifier that failed:
    /// failedCheckIDs names "node_verifier", with no coverage when no
    /// operational check ran) is disclosed beside the delivered output instead
    /// of holding it. Never a quality claim; the task settles returned_unverified.
    public struct QualityDisclosure: Codable, Equatable, Sendable {
        public enum Checker: String, Codable, Sendable { case unavailable }
        public var coverage: OperationalQuality.Coverage?
        public var failedCheckIDs: [String]
        public var witnessSHA256: String?
        public var checker: Checker?
        public init(coverage: OperationalQuality.Coverage?, failedCheckIDs: [String], witnessSHA256: String? = nil,
                    checker: Checker? = nil) {
            self.coverage = coverage; self.failedCheckIDs = failedCheckIDs; self.witnessSHA256 = witnessSHA256
            self.checker = checker
        }
        enum CodingKeys: String, CodingKey {
            case coverage, checker, failedCheckIDs = "failed_check_ids", witnessSHA256 = "witness_sha256"
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
        /// Literal user-requested surface. This is not selected or observed execution.
        public var requestedSurface: Surface?
        /// Optional; absent in snapshots written before 2026-10-13.
        public var routingDecision: RoutingDecision?
        /// Optional (build 407); present only on a delivered unverified output.
        public var qualityDisclosure: QualityDisclosure?
        public init(id: String, state: ChildState, attemptID: String?, candidateID: String?, selectedConfig: ExactConfig? = nil,
                    instruction: String? = nil, dependencies: [String]? = nil, startedAtMS: Int64? = nil,
                    finishedAtMS: Int64? = nil, nativeReceipt: String? = nil, outputSummary: String? = nil,
                    requestedSurface: Surface? = nil, routingDecision: RoutingDecision? = nil,
                    qualityDisclosure: QualityDisclosure? = nil) {
            self.id = id; self.state = state; self.attemptID = attemptID; self.candidateID = candidateID
            self.selectedConfig = selectedConfig; self.instruction = instruction; self.dependencies = dependencies
            self.startedAtMS = startedAtMS; self.finishedAtMS = finishedAtMS; self.nativeReceipt = nativeReceipt
            self.outputSummary = outputSummary
            self.requestedSurface = requestedSurface
            self.routingDecision = routingDecision
            self.qualityDisclosure = qualityDisclosure
        }
        enum CodingKeys: String, CodingKey {
            case id, state, dependencies, instruction, attemptID = "attempt_id", candidateID = "candidate_id"
            case selectedConfig = "selected_config", startedAtMS = "started_at_ms", finishedAtMS = "finished_at_ms", nativeReceipt = "native_receipt"
            case outputSummary = "output_summary"
            case requestedSurface = "requested_surface"
            case routingDecision = "routing_decision"
            case qualityDisclosure = "quality_disclosure"
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
    /// A route of a best-effort route test (route-all) that Core did not
    /// run because no runnable row offered it at admission, with the reason.
    public struct SkippedRoute: Codable, Equatable, Sendable {
        public var surface: Surface
        public var instruction: String
        public var reason: String
        public init(surface: Surface, instruction: String, reason: String) {
            self.surface = surface; self.instruction = instruction; self.reason = reason
        }
    }
    /// Public Core interpretation status: no raw prompt, model answer,
    /// private context or execution-observation upgrade crosses this boundary.
    public struct RoutingIntentSummary: Codable, Equatable, Sendable {
        public enum Status: String, Codable, Sendable { case resolving, ordinary, routes, held, localResponse = "local_response" }
        public var state: Status
        public var notices: [String]
        public var reason: String?
        public var resolutionSHA256: String?
        public init(state: Status, notices: [String], reason: String? = nil, resolutionSHA256: String? = nil) {
            self.state = state; self.notices = notices; self.reason = reason; self.resolutionSHA256 = resolutionSHA256
        }
        enum CodingKeys: String, CodingKey { case state, notices, reason, resolutionSHA256 = "resolution_sha256" }
    }
    /// Actual resource observations, not a route grade or a subscription bill.
    /// Missing legacy data stays nil; failed/cancelled attempts still count.
    public struct ResourceUsageSummary: Codable, Equatable, Sendable {
        public var schema: Int
        public var accountingComplete: Bool
        public var totalTokensObserved: Int?
        public var localTokensObserved: Int?
        public var nativeTokensObserved: Int?
        public var localCallsStarted: Int
        public var localCallsSettled: Int
        public var localWorkerAttempts: Int
        public var nativeAttempts: Int
        public var planModelCalls: Int?
        public var issues: [String]
        public var quotaSavings: String
        public var cashCost: String
        public var accountingScope: String
        enum CodingKeys: String, CodingKey {
            case schema, issues, accountingComplete = "accounting_complete", totalTokensObserved = "total_tokens_observed"
            case localTokensObserved = "local_tokens_observed", nativeTokensObserved = "native_tokens_observed"
            case localCallsStarted = "local_calls_started", localCallsSettled = "local_calls_settled"
            case localWorkerAttempts = "local_worker_attempts", nativeAttempts = "native_attempts"
            case planModelCalls = "plan_model_calls", quotaSavings = "quota_savings", cashCost = "cash_cost"
            case accountingScope = "accounting_scope"
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
        public var installHandoff: InstallHandoff?
        /// Present only when Core skipped a best-effort route; older snapshots have none.
        public var skippedRoutes: [SkippedRoute]?
        public var routingIntent: RoutingIntentSummary?
        public var resourceUsage: ResourceUsageSummary?
        public init(schema: Int = 1, taskID: String, requestSHA256: String, state: State, revision: Int,
                    children: [ChildSnapshot], result: Result?, error: String?, installHandoff: InstallHandoff? = nil,
                    skippedRoutes: [SkippedRoute]? = nil, routingIntent: RoutingIntentSummary? = nil,
                    resourceUsage: ResourceUsageSummary? = nil) {
            self.schema = schema; self.taskID = taskID; self.requestSHA256 = requestSHA256; self.state = state
            self.revision = revision; self.children = children; self.result = result; self.error = error
            self.installHandoff = installHandoff; self.skippedRoutes = skippedRoutes; self.routingIntent = routingIntent
            self.resourceUsage = resourceUsage
        }
        enum CodingKeys: String, CodingKey {
            case schema, state, revision, children, result, error, taskID = "task_id", requestSHA256 = "request_sha256"
            case installHandoff = "install_handoff", skippedRoutes = "skipped_routes", routingIntent = "routing_intent"
            case resourceUsage = "resource_usage"
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
        guard value.routingIntentPolicyVersion == nil ||
            (value.routingIntentPolicyVersion == RoutingIntentV2.version && value.mode == .auto)
            else { throw Rejection.invalidConfiguration }
        guard id(value.taskID) else { throw Rejection.invalidIdentity }
        guard isHash(value.requestSHA256), value.requestSHA256 == digest(Data(value.request.utf8)),
              isHash(value.policySHA256), isHash(value.sourceFingerprint) else { throw Rejection.invalidHash }
        guard text(value.request, max: 64_000), text(value.objective, max: 8_192), unique(value.materialRefs, max: 128),
              value.budget.maxAttempts > 0, value.budget.maxAttempts <= 3,
              value.budget.maxParallel > 0, value.budget.maxParallel <= 8,
              value.budget.maxDurationMS >= 1_000, value.budget.maxDurationMS <= 3_600_000,
              value.budget.maxCostUnits.map({ $0.isFinite && $0 >= 0 }) ?? true,
              value.budget.maxNativeDispatches.map({ (1...64).contains($0) }) ?? true,
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
        if let routing = value.coreRouting {
            guard value.mode == .explicitRoutingTest, let host = value.hostContext else { throw Rejection.invalidInput }
            try validateCoreRouting(routing, host: host, taskID: value.taskID, request: value.request,
                requestSHA256: value.requestSHA256, policySHA256: value.policySHA256)
        }
    }
    /// Native revalidation uses the original text and the SAME compiler. It
    /// neither contacts a model nor grants a new execution capability.
    public static func validateCoreRouting(_ routing: CoreRouting, host: HostContext, taskID: String,
                                          request: String, requestSHA256: String, policySHA256: String) throws {
        guard routing.schema == 1, routing.originalMode == .auto,
              isHash(routing.originalSourceFingerprint), isHash(routing.resolutionSHA256),
              routing.modelAnswer.map({ $0.utf8.count <= 4_096 }) ?? true,
              host.providerPreference == "auto", host.requireReadOnly,
              let routes = host.explicitRoutes, !routes.isEmpty else { throw Rejection.invalidInput }
        var originalHost = host
        originalHost.explicitRoutes = nil; originalHost.explicitRoutesBestEffort = nil
        originalHost.providerPreference = routing.originalProviderPreference
        originalHost.requireReadOnly = routing.originalRequireReadOnly
        try validate(originalHost)
        guard digest(try encode(originalHost)) == routing.originalSourceFingerprint,
              digest(Data(request.utf8)) == requestSHA256 else { throw Rejection.invalidHash }
        let compiled = try RCCCoreRoutingCompiler.compile(taskID: taskID, request: request,
            requestSHA256: requestSHA256, policySHA256: policySHA256,
            sourceFingerprint: routing.originalSourceFingerprint, modelAnswer: routing.modelAnswer)
        guard compiled.kind == .routes, compiled.routes == routes,
              compiled.bestEffort == (host.explicitRoutesBestEffort == true),
              try compiled.resolutionSHA256(modelAnswer: routing.modelAnswer) == routing.resolutionSHA256
        else { throw Rejection.invalidPlan }
    }
    public static func validate(_ value: HostContext) throws {
        guard absolutePath(value.workspace), value.context.map({ $0.utf8.count <= 500_000 && !$0.contains("\0") }) ?? true,
              ["auto", "codex", "claude", "chatgpt", "local", "gpt-chat", "claude-chat"].contains(value.providerPreference),
              value.codexSessionID.map(id) ?? true, value.claudeSessionID.map(id) ?? true,
              value.conversationID.map({ UUID(uuidString: $0) != nil }) ?? true,
              value.submissionID.map({ UUID(uuidString: $0) != nil }) ?? true else { throw Rejection.invalidInput }
        if let plan = value.capacityPlan { guard plan.isValid else { throw Rejection.invalidInput } }
        if let routes = value.explicitRoutes {
            guard routes.count <= 8, routes.allSatisfy({ text($0.instruction, max: 12_000) }),
                  Set(routes.map { $0.surface.rawValue + "\0" + $0.instruction }).count == routes.count else { throw Rejection.invalidInput }
        }
        // Best effort is a property of a route list, and only ever "true".
        if let bestEffort = value.explicitRoutesBestEffort {
            guard bestEffort, value.explicitRoutes != nil else { throw Rejection.invalidInput }
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
        if let exclusions = value.exclusions {
            guard !exclusions.isEmpty, exclusions.count <= 32,
                  Set(exclusions.map { $0.provider + "\0" + $0.reason }).count == exclusions.count,
                  exclusions.allSatisfy({ Exclusion.providers.contains($0.provider) && Exclusion.reasons.contains($0.reason) &&
                      (1...10_000).contains($0.count) }) else { throw Rejection.invalidObservation }
        }
        func validIntent(_ intent: RoutingIntentConstraint) -> Bool {
            (intent.effort != nil || intent.modelFamily != nil) &&
                (intent.effort.map({ RoutingIntentConstraint.efforts.contains($0) }) ?? true) &&
                (intent.modelFamily.map({ $0.range(of: "^[a-z][a-z0-9]{1,31}$", options: .regularExpression) != nil }) ?? true)
        }
        if let v2 = value.routingIntentV2 {
            guard v2.valid, v2.state == "resolved", value.routingIntent == nil,
                  value.nativeReferenceEfforts != nil, value.modelTiers != nil,
                  request.map({ $0.mode == .auto && $0.routingIntentPolicyVersion == RoutingIntentV2.version }) ?? false
            else { throw Rejection.invalidObservation }
        } else if request?.routingIntentPolicyVersion != nil { throw Rejection.invalidObservation }
        if let intent = value.routingIntent, !validIntent(intent) { throw Rejection.invalidObservation }
        if let intents = value.explicitRouteIntents {
            // One entry per route of the explicit route test (at most 8).
            guard (1...8).contains(intents.count), intents.allSatisfy({ $0.map(validIntent) ?? true }),
                  request.map({ $0.mode == .explicitRoutingTest && $0.hostContext?.explicitRoutes?.count == intents.count }) ?? true
            else { throw Rejection.invalidObservation }
        }
        if let scores = value.quotaScores {
            let models = Set(value.candidates.map(\.model))
            guard scores.count <= 256, scores.allSatisfy({ text($0.key, max: 256) && models.contains($0.key) &&
                (0...1_000_000_000).contains($0.value) }) else { throw Rejection.invalidObservation }
        }
        if let native = value.nativeReferenceEfforts {
            let efforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"]
            func provider(_ candidate: Candidate) -> String? {
                switch candidate.quotaPool {
                case .openAICodex: return "codex"
                case .anthropicShared: return "claude"
                default: return nil
                }
            }
            var represented: [String: Set<String>] = [:]
            for candidate in value.candidates {
                if let provider = provider(candidate) { represented[provider, default: []].insert(candidate.model) }
            }
            guard Set(native.keys).isSubset(of: ["codex", "claude"]),
                  native.values.reduce(0, { $0 + $1.count }) <= 256,
                  native.allSatisfy({ provider, models in
                      represented[provider] != nil && models.allSatisfy { model, effort in
                          text(model, max: 256) && represented[provider]?.contains(model) == true && efforts.contains(effort)
                      }
                  }), value.candidates.allSatisfy({ candidate in
                      guard let provider = provider(candidate) else { return true }
                      guard let ceiling = native[provider]?[candidate.model],
                            let ceilingRank = efforts.firstIndex(of: ceiling),
                            let offeredRank = efforts.firstIndex(of: candidate.effort.rawValue) else { return false }
                      return ceilingRank >= offeredRank
                  }) else { throw Rejection.invalidObservation }
        }
        if let tiers = value.modelTiers {
            // Only provider-stated tiers of models this catalog actually offers.
            let models = Set(value.candidates.map(\.model))
            guard tiers.count <= 256, tiers.allSatisfy({ text($0.key, max: 256) && models.contains($0.key) &&
                ModelTier(rawValue: $0.value) != nil }) else { throw Rejection.invalidObservation }
        }
        try validateAdmissionFacts(value, request: request)
        // An empty catalog must say why; otherwise it is a malformed binding.
        guard !value.candidates.isEmpty || value.exclusions != nil else { throw Rejection.invalidIdentity }
        for candidate in value.candidates { try validate(candidate) }
    }
    /// Build 407: the admission facts travel together (owner_scope,
    /// chat_lane_eligible, request_class) and agree with each other and the
    /// request; a contract, certificate or pin exists only beside them and
    /// keys this request (and its class) only.
    static func validateAdmissionFacts(_ value: Catalog, request: Request?) throws {
        let facts = [value.ownerScope != nil, value.chatLaneEligible != nil, value.requestClass != nil]
        guard facts.allSatisfy({ $0 }) || !facts.contains(true) else { throw Rejection.invalidObservation }
        guard let requestClass = value.requestClass, let ownerScope = value.ownerScope, let chat = value.chatLaneEligible else {
            guard value.taskContract == nil, value.classCertificates == nil, value.classProviderPins == nil else {
                throw Rejection.invalidObservation
            }
            return
        }
        switch requestClass {
        case .writer: guard ownerScope == .workspaceWrite, !chat else { throw Rejection.invalidObservation }
        case .chatExplanatory, .textOperation: guard chat else { throw Rejection.invalidObservation }
        case .readonlyLookup, .readonlyMaterial, .explicitRoute: break
        }
        if let request {
            guard (requestClass == .explicitRoute) == (request.mode == .explicitRoutingTest),
                  requestClass != .writer || request.hostContext?.requireReadOnly != true,
                  requestClass != .readonlyMaterial || !request.materialRefs.isEmpty else { throw Rejection.invalidObservation }
        }
        if let contract = value.taskContract {
            guard contract.bindingsChecked, contract.objectiveSHA256 == value.requestSHA256,
                  [contract.contractSHA256, contract.contextSHA256, contract.startTreeSHA256,
                   contract.referencePolicySHA256].allSatisfy(isHash),
                  contract.sourceSHA256.map(isHash) ?? true, contract.validUntilMS > 0,
                  (contract.executionIsolation == nil) == (contract.executionIsolationSHA256 == nil),
                  contract.executionIsolation == nil || (contract.executionIsolation == "codex_fresh_local_effects_v1" && contract.executionIsolationSHA256.map(isHash) == true),
                  contract.executionIsolation == nil || contract.sourceSHA256 == nil else { throw Rejection.invalidObservation }
            guard (contract.stagedWriterEnvelopeSHA256 == nil) == (contract.stagedWriterBaseSHA256 == nil),
                  contract.stagedWriterEnvelopeSHA256 == nil || (contract.stagedWriterEnvelopeSHA256.map(isHash) == true &&
                    contract.stagedWriterBaseSHA256.map(isHash) == true && contract.coverage == .full &&
                    contract.scope == .workspaceWrite && contract.sourceSHA256 == nil &&
                    contract.executionIsolation == "codex_fresh_local_effects_v1" &&
                    contract.stagedWriterEnvelopeSHA256 == contract.executionIsolationSHA256) else { throw Rejection.invalidObservation }
            if let collection = contract.ownerCollection {
                guard contract.coverage == .full, contract.scope == .readOnly, collection.schema == 1,
                    collection.kind == "independent_readonly_json_v1", isHash(collection.manifestSHA256),
                    (2...8).contains(collection.obligations.count),
                    unique(collection.obligations.map(\.id)), unique(collection.obligations.map(\.instruction)),
                    collection.obligations.allSatisfy({ o in
                        id(o.id) && text(o.instruction, max: 12_000) && o.requestUTF8Start >= 0 &&
                        o.requestUTF8End > o.requestUTF8Start && o.sourcePaths.count == o.sourceSHA256s.count &&
                        !o.sourcePaths.isEmpty && o.sourcePaths.count <= 128 && unique(o.sourcePaths) &&
                        o.sourcePaths.allSatisfy({ text($0, max: 4_096) && !$0.hasPrefix("/") && !$0.split(separator: "/").contains("..") && !$0.split(separator: "/").contains(".") }) && o.sourceSHA256s.allSatisfy(isHash) &&
                        isHash(o.contractSHA256) && isHash(o.verifierSHA256) && !o.requiredCheckIDs.isEmpty &&
                        o.requiredCheckIDs.count <= 64 && unique(o.requiredCheckIDs) &&
                        o.requiredCheckIDs.allSatisfy({ text($0, max: 128) }) && o.validUntilMS > 0
                    }) else { throw Rejection.invalidObservation }
                if let request {
                    let bytes = Data(request.request.utf8)
                    var end = 0
                    for o in collection.obligations {
                        guard o.requestUTF8Start >= end, o.requestUTF8End <= bytes.count,
                              Data(bytes[o.requestUTF8Start..<o.requestUTF8End]) == Data(o.instruction.utf8)
                        else { throw Rejection.invalidObservation }
                        end = o.requestUTF8End
                    }
                }
            }
            if let request {
                guard contract.referencePolicySHA256 == request.policySHA256,
                      contract.contextSHA256 == digest(Data((request.hostContext?.context ?? "").utf8)),
                      contract.executionIsolation == nil || (request.hostContext?.codexSessionID == nil &&
                        (request.nativeSessions == nil || request.nativeSessions?.isEmpty == true)) else {
                    throw Rejection.invalidObservation
                }
            }
        }
        if let certificates = value.classCertificates {
            guard certificates.count == 1, requestClass.certifiable,
                  let certificate = certificates[requestClass.rawValue], validClassCertificate(certificate) else {
                throw Rejection.invalidObservation
            }
        }
        if let pins = value.classProviderPins {
            guard pins.count == 1, requestClass != .explicitRoute, let pin = pins[requestClass.rawValue],
                  Exclusion.providers.contains(pin) else { throw Rejection.invalidObservation }
        }
    }
    /// One class certificate's own shape (the signed table and the catalog share it).
    public static func validClassCertificate(_ value: ClassCertificate) -> Bool {
        id(value.certificateID) && Exclusion.providers.contains(value.provider) && text(value.model, max: 256) &&
            value.effort != .none && isHash(value.measurementSHA256) &&
            value.formatCheck.range(of: "^[a-z][a-z0-9_]{0,63}$", options: .regularExpression) != nil
    }
    public static func validate(_ value: Plan, catalog: Catalog? = nil,
                                context: PlanValidationContext = .authored) throws {
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
        if context == .hostBoundExplicitRoutes {
            guard value.nodes.allSatisfy({ $0.dependencies.isEmpty && $0.kind == .agent }) else {
                throw Rejection.invalidPlan
            }
            if case .node = value.finalNodeID { throw Rejection.invalidPlan }
        }
        switch value.finalNodeID {
        case .absent:
            // Do not infer a sink, final worker or output order for old graphs.
            guard value.nodes.count == 1 || context == .hostBoundExplicitRoutes else { throw Rejection.invalidPlan }
        case .collection:
            guard context == .hostBound || value.nodes.allSatisfy({ $0.dependencies.isEmpty }) else {
                throw Rejection.invalidPlan
            }
        case .node(let final):
            guard id(final), ids.contains(final) else { throw Rejection.invalidPlan }
            var frontier = [final], covered = Set<String>()
            while let next = frontier.popLast() {
                if covered.insert(next).inserted { frontier += byID[next]?.dependencies ?? [] }
            }
            guard covered == ids else { throw Rejection.invalidPlan }
        }
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
        guard (value.executionIsolation == nil) == (value.executionIsolationSHA256 == nil),
              value.executionIsolation == nil || (value.executionIsolation == "codex_fresh_local_effects_v1" &&
                value.executionIsolationSHA256.map(isHash) == true && value.selectedConfig.surface == .codex &&
                value.selectedConfig.transport == .codexAppServer && value.nativeResumeSessionID == nil && value.continuation == nil) else {
            throw Rejection.invalidConfiguration
        }
        guard (value.stagedWriterEnvelopeSHA256 == nil) == (value.stagedWriterBaseSHA256 == nil),
              value.stagedWriterEnvelopeSHA256 == nil || (value.stagedWriterEnvelopeSHA256.map(isHash) == true &&
                value.stagedWriterBaseSHA256.map(isHash) == true && value.selectedConfig.scope == .workspaceWrite &&
                value.selectedConfig.surface == .codex && value.executionIsolation == "codex_fresh_local_effects_v1" &&
                value.stagedWriterEnvelopeSHA256 == value.executionIsolationSHA256 && value.qualityContinuation == nil) else { throw Rejection.invalidConfiguration }
        // Only a native agent surface has sub-agents to allow (R5).
        if value.allowNativeSubagents == true, ![.codex, .claude].contains(value.selectedConfig.surface) {
            throw Rejection.invalidConfiguration
        }
        if let host = value.hostContext {
            try validate(host)
            guard digest(try encode(host)) == value.sourceFingerprint,
                  !host.requireReadOnly || value.selectedConfig.scope == .readOnly else { throw Rejection.configurationMismatch }
        }
        if let routing = value.coreRouting {
            guard let host = value.hostContext, let original = value.originalRequest,
                  value.selectedConfig.scope == .readOnly,
                  host.explicitRoutes?.contains(where: { $0.surface == value.selectedConfig.surface && $0.instruction == value.instruction }) == true
            else { throw Rejection.configurationMismatch }
            try validateCoreRouting(routing, host: host, taskID: value.taskID, request: original,
                requestSHA256: value.requestSHA256, policySHA256: value.policySHA256)
        }
        if let q = value.qualityContinuation {
            guard q.schema == 1, q.correctiveAttempts == 1, id(q.parentAttemptID), q.parentAttemptID != value.attemptID,
                  value.originalRequest != nil, value.originalObjective != nil,
                  [q.parentNativeReceiptSHA256, q.witnessSHA256, q.expectedWorkspaceAfterSHA256, q.originalInstructionSHA256].allSatisfy(isHash),
                  q.originalInstructionSHA256 == digest(Data(value.instruction.utf8)),
                  [q.parentNativeReceipt, q.witnessPath].allSatisfy({ text($0, max: 4_096) && $0.hasPrefix("/") }),
                  value.selectedConfig.scope == .workspaceWrite, value.selectedConfig.permissionProfile == .workspaceWrite,
                  value.hostContext?.requireReadOnly == false,
                  value.continuation == nil, value.nativeResumeSessionID == nil else { throw Rejection.invalidIdentity }
        }
        if let sessionID = value.nativeResumeSessionID {
            guard id(sessionID), let host = value.hostContext else { throw Rejection.invalidIdentity }
            if let continuation = value.continuation {
                guard continuation.kind == .fullAccessRequired, continuation.nativeSessionID == sessionID else {
                    throw Rejection.configurationMismatch
                }
            } else {
            let sourceSessionID: String?
            switch value.selectedConfig.surface {
            case .codex: sourceSessionID = host.codexSessionID
            case .claude: sourceSessionID = host.claudeSessionID
            default: throw Rejection.configurationMismatch
            }
            guard sourceSessionID == sessionID else { throw Rejection.configurationMismatch }
            }
        }
        if let continuation = value.continuation {
            guard continuation.kind != .both, id(continuation.parentAttemptID),
                  continuation.parentAttemptID != value.attemptID, id(continuation.nativeSessionID),
                  text(continuation.parentNativeReceipt, max: 4_096), continuation.parentNativeReceipt.hasPrefix("/"),
                  text(continuation.protectedRoot, max: 4_096), continuation.protectedRoot.hasPrefix("/"),
                  continuation.sourceHead.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil,
                  [continuation.parentNativeReceiptSHA256, continuation.protectedSourceSHA256,
                   continuation.sourceFingerprint, continuation.requestSHA256].allSatisfy(isHash),
                  continuation.sourceFingerprint == value.sourceFingerprint, continuation.requestSHA256 == value.requestSHA256,
                  value.selectedConfig.scope == .workspaceWrite, value.selectedConfig.permissionProfile == .workspaceWrite,
                  value.selectedConfig.surface == .claude, value.selectedConfig.transport == .claudeCLI,
                  value.hostContext?.requireReadOnly == false,
                  (continuation.kind == .fullAccessRequired ? value.nativeResumeSessionID == continuation.nativeSessionID : value.nativeResumeSessionID == nil)
            else { throw Rejection.configurationMismatch }
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
                  value.hostContext == request.hostContext, value.coreRouting == request.coreRouting else { throw Rejection.invalidIdentity }
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
        try value.configuredInputObservation?.validate(ticket: ticket, record: value)
        if let staged = value.stagedWriter {
            guard value.selectedConfig.surface == .codex, value.selectedConfig.scope == .workspaceWrite,
                  text(staged.receiptPath, max: 4_096), staged.receiptPath.hasPrefix("/"), isHash(staged.receiptSHA256),
                  value.handback == nil, value.repairSource == nil else { throw Rejection.invalidExecutionRecord }
            if staged.state == .applied {
                guard value.executionVerified, value.nativeTurnTerminated == true, value.taskVerified,
                      value.operationalQuality?.coverage == .full else { throw Rejection.invalidExecutionRecord }
            } else if staged.state == .discarded {
                guard value.nativeTurnTerminated == true, value.sideEffects == .none, !value.taskVerified,
                      value.error == "native_staged_writer_discarded" else { throw Rejection.invalidExecutionRecord }
            }
            if let ticket { guard ticket.stagedWriterEnvelopeSHA256 != nil else { throw Rejection.invalidExecutionRecord } }
        } else if let ticket, ticket.stagedWriterEnvelopeSHA256 != nil, value.dispatchStage == .dispatched {
            throw Rejection.invalidExecutionRecord
        }
        if let q = value.operationalQuality {
            guard q.schema == 1, [q.contractSHA256, q.witnessSHA256, q.artifactSHA256, q.workspaceAfterSHA256].allSatisfy(isHash),
                  text(q.witnessPath, max: 4_096), q.witnessPath.hasPrefix("/"),
                  ![.referenceEquivalent, .referenceAbove].contains(q.assessmentState),
                  (q.assessmentState == .taskContractVerified) == value.taskVerified,
                  (0...1).contains(q.correctiveAttempts), q.failedCheckIDs.count <= 128,
                  Set(q.failedCheckIDs).count == q.failedCheckIDs.count, q.failedCheckIDs.allSatisfy({ text($0, max: 256) && !$0.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) }),
                  q.assessmentState == .mismatch ? !q.failedCheckIDs.isEmpty : q.failedCheckIDs.isEmpty,
                  q.coverage != .partial || ![.taskContractVerified, .referenceEquivalent, .referenceAbove].contains(q.assessmentState),
                  value.nativeTurnTerminated == true, value.executionVerified, value.parityState == .unverified,
                  q.assessmentState != .mismatch || (value.taskQuality == .failed && !value.taskVerified),
                  value.taskQuality != .taskVerified || q.assessmentState == .taskContractVerified,
                  value.handback == nil, value.repairSource == nil else { throw Rejection.invalidExecutionRecord }
        }
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
        if value.error == providerQuotaRejectedBeforeExecution {
            guard value.status == .failed, value.dispatchStage == .notDispatched, value.sideEffects == .none,
                  !value.executionVerified, value.nativeReceipt != nil,
                  value.selectedConfig.scope == .readOnly else { throw Rejection.invalidExecutionRecord }
        }
        if value.error == nativeAuthorizationRefused {
            guard value.status == .failed, value.dispatchStage == .notDispatched, value.sideEffects == .none,
                  !value.executionVerified, value.nativeReceipt != nil else { throw Rejection.invalidExecutionRecord }
        }
        if let handback = value.handback {
            guard value.executionVerified, value.status == .succeeded, !value.taskVerified, value.parityState == .unverified,
                  value.selectedConfig.scope == .workspaceWrite, value.selectedConfig.permissionProfile == .workspaceWrite,
                  value.selectedConfig.surface == .claude, value.selectedConfig.transport == .claudeCLI,
                  id(handback.nativeSessionID), handback.parentAttemptID == value.attemptID,
                  handback.exitCode == 0, !handback.cancelled,
                  text(handback.protectedRoot, max: 4_096), handback.protectedRoot.hasPrefix("/"),
                  handback.sourceHead.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil,
                  [handback.protectedSourceSHA256, handback.sourceFingerprint, handback.requestSHA256].allSatisfy(isHash),
                  value.nativeReceipt != nil, value.nativeSummary != nil,
                  value.output.map({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) == true,
                  ticket.map({ handback.sourceFingerprint == $0.sourceFingerprint && handback.requestSHA256 == $0.requestSHA256 }) ?? true
            else { throw Rejection.invalidExecutionRecord }
        }
        if let source = value.repairSource {
            guard value.executionVerified, value.status == .succeeded, value.handback == nil,
                  value.taskQuality != .failed, value.selectedConfig.scope == .workspaceWrite,
                  value.selectedConfig.permissionProfile == .workspaceWrite,
                  [.codex, .claude].contains(value.selectedConfig.surface),
                  text(source.sourceRoot, max: 4_096), source.sourceRoot.hasPrefix("/"),
                  [source.sourceHead, source.sourceBeforeHead].allSatisfy({ $0.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil }),
                  [source.sourceBeforeSHA256, source.protectedSourceSHA256].allSatisfy(isHash),
                  !source.changedPaths.isEmpty, unique(source.changedPaths), source.changedPaths.count <= 512,
                  source.changedPaths.allSatisfy({ $0.hasPrefix("products/os1-mac-runtime/") && !$0.contains("..") &&
                      text($0, max: 4_096) && $0 != "products/os1-mac-runtime/release" }),
                  ticket.map({ $0.hostContext.map { $0.workspace == source.sourceRoot || $0.workspace.hasPrefix(source.sourceRoot + "/") } == true }) ?? true
            else { throw Rejection.invalidExecutionRecord }
        }
        if let usage = value.usage {
            guard [usage.inputTokens, usage.outputTokens, usage.reasoningTokens, usage.cacheReadTokens,
                   usage.cacheWriteTokens, usage.durationMS].allSatisfy({ $0.map({ $0 >= 0 }) ?? true }),
                  usage.providerCalls.map({ $0 >= 0 }) ?? true,
                  usage.costUnits.map({ $0.isFinite && $0 >= 0 }) ?? true,
                  usage.costUnits == nil || usage.metric.map({ text($0, max: 64) }) == true else { throw Rejection.invalidObservation }
        }
    }
    /// Same strict observation contract at transport and UI boundaries.
    public static func validate(_ usage: ResourceUsageSummary) throws {
        let counts = [usage.totalTokensObserved, usage.localTokensObserved, usage.nativeTokensObserved,
                      usage.planModelCalls, usage.localCallsStarted, usage.localCallsSettled,
                      usage.localWorkerAttempts, usage.nativeAttempts]
        guard usage.schema == 1, counts.allSatisfy({ $0.map { (0...9_007_199_254_740_991).contains($0) } ?? true }),
              usage.localCallsSettled <= usage.localCallsStarted,
              usage.planModelCalls.map({ $0 <= usage.localCallsStarted }) ?? true,
              usage.issues.count <= 64, usage.issues.allSatisfy({ text($0, max: 256) }),
              usage.quotaSavings == "not_measured", usage.cashCost == "not_measured",
              usage.accountingScope == "observed_attempts_as_of_snapshot_not_future_cost" else { throw Rejection.invalidSnapshot }
        if usage.accountingComplete {
            guard usage.issues.isEmpty, let total = usage.totalTokensObserved,
                  let local = usage.localTokensObserved, let native = usage.nativeTokensObserved,
                  total == local + native, usage.planModelCalls != nil,
                  usage.localCallsSettled == usage.localCallsStarted else { throw Rejection.invalidSnapshot }
        } else if usage.totalTokensObserved != nil { throw Rejection.invalidSnapshot }
    }
    public static func validate(_ value: Snapshot) throws {
        guard value.schema == schema else { throw Rejection.invalidSchema }
        guard id(value.taskID), isHash(value.requestSHA256), value.revision >= 0, value.children.count <= maximumNodes,
              Set(value.children.map(\.id)).count == value.children.count else { throw Rejection.invalidSnapshot }
        if let intent = value.routingIntent {
            guard intent.notices.count <= 32, intent.notices.allSatisfy({ text($0, max: 4_096) }),
                  intent.reason.map({ text($0, max: 4_096) }) ?? true,
                  intent.resolutionSHA256.map(isHash) ?? true else { throw Rejection.invalidSnapshot }
        }
        if let usage = value.resourceUsage { try validate(usage) }
        for child in value.children {
            guard id(child.id), child.attemptID.map(id) ?? true, child.candidateID.map(id) ?? true,
                  child.state != .running || (child.attemptID != nil && child.candidateID != nil) else { throw Rejection.invalidSnapshot }
            if let config = child.selectedConfig { try validate(config) }
            if let requested = child.requestedSurface, let selected = child.selectedConfig,
               requested != selected.surface { throw Rejection.invalidSnapshot }
            if let decision = child.routingDecision {
                // The receipt names the exact row this child is bound to.
                guard id(decision.resolvedCandidateID), decision.resolvedCandidateID == child.candidateID,
                      decision.routeClass.map({ RoutingDecision.routeClasses.contains($0) }) ?? true,
                      decision.tier.map({ ModelTier(rawValue: $0) != nil }) ?? true,
                      text(decision.model, max: 256), text(decision.reason, max: 1_024),
                      decision.quotaRemainingFraction.map({ $0.isFinite && $0 >= 0 && $0 <= 1 }) ?? true,
                      child.selectedConfig.map({ $0.surface == decision.surface && $0.model == decision.model &&
                          $0.effort == decision.effort && $0.quotaPool == decision.quotaPool }) ?? true
                else { throw Rejection.invalidSnapshot }
                if let ladder = decision.ladder {
                    // Only a graded node is laddered, below its reference, and
                    // it runs either the cheap route or, once, the reference.
                    let order = RCCNativeCatalogBuilder.effortOrder
                    guard decision.routeClass != nil,
                          let cheap = order.firstIndex(of: ladder.cheapEffort.rawValue),
                          let reference = order.firstIndex(of: ladder.referenceEffort.rawValue) else { throw Rejection.invalidSnapshot }
                    switch (ladder.cheapModel, ladder.referenceModel) {
                    case (nil, nil):
                        // The effort ladder: one model, a strictly cheaper effort.
                        guard cheap < reference,
                              decision.effort == ladder.cheapEffort || decision.effort == ladder.referenceEffort
                        else { throw Rejection.invalidSnapshot }
                    case let (cheapModel?, referenceModel?):
                        // A tier route: two distinct model/effort tuples, and
                        // the decision runs exactly one of them.
                        guard text(cheapModel, max: 256), text(referenceModel, max: 256),
                              cheapModel != referenceModel || cheap < reference,
                              (decision.model == cheapModel && decision.effort == ladder.cheapEffort) ||
                                (decision.model == referenceModel && decision.effort == ladder.referenceEffort)
                        else { throw Rejection.invalidSnapshot }
                    default: throw Rejection.invalidSnapshot
                    }
                }
            }
            if let disclosure = child.qualityDisclosure {
                // Disclosed beside a delivered output, never on a held/failed one,
                // and never on a task-verified (completed) task (R6). It names
                // at least one reason: a coverage, a checker state or a failed
                // check (a node verifier's failure has no coverage).
                guard [.completed, .succeeded].contains(child.state), value.state != .completed,
                      disclosure.coverage != nil || disclosure.checker != nil || !disclosure.failedCheckIDs.isEmpty,
                      unique(disclosure.failedCheckIDs, max: 64), disclosure.failedCheckIDs.allSatisfy({ $0.utf8.count <= 256 }),
                      disclosure.witnessSHA256.map(isHash) ?? true else { throw Rejection.invalidSnapshot }
            }
            guard child.instruction.map({ text($0) }) ?? true, child.dependencies.map({ unique($0, max: maximumNodes) }) ?? true,
                  child.startedAtMS.map({ $0 >= 0 }) ?? true, child.finishedAtMS.map({ $0 >= (child.startedAtMS ?? 0) }) ?? true,
                  child.nativeReceipt.map({ text($0, max: 4_096) }) ?? true,
                  child.outputSummary.map({ $0.utf8.count <= 4_096 && !$0.contains("\0") }) ?? true else { throw Rejection.invalidSnapshot }
        }
        if let result = value.result {
            guard value.state == .completed || value.state == .returnedUnverified || value.installHandoff != nil,
                  text(result.output, max: 256_000),
                  !result.taskVerified || result.executionVerified,
                  !result.executionVerified || result.nativeReceipt != nil || (result.taskVerified && value.children.allSatisfy { $0.selectedConfig?.transport == .local }),
                  (result.parityState != .referenceAbove && result.parityState != .referenceEquivalent) || result.taskVerified else { throw Rejection.invalidSnapshot }
            if let quality = result.taskQuality { guard (quality == .taskVerified) == result.taskVerified else { throw Rejection.invalidSnapshot } }
            guard result.nativeSummary.map({ $0.utf8.count <= 512_000 && !$0.contains("\0") }) ?? true,
                  result.nativeSummaries.map({ $0.count <= maximumNodes && $0.allSatisfy { $0.utf8.count <= 512_000 && !$0.contains("\0") } }) ?? true else { throw Rejection.invalidSnapshot }
        }
        if value.state == .completed { guard value.result?.taskVerified == true && value.error == nil else { throw Rejection.invalidSnapshot } }
        if value.state == .returnedUnverified { guard let result = value.result, !result.taskVerified, result.parityState == .unverified else { throw Rejection.invalidSnapshot } }
        if let handoff = value.installHandoff {
            try validate(handoff)
            guard handoff.taskID == value.taskID, handoff.requestSHA256 == value.requestSHA256,
                  value.children.contains(where: { $0.id == handoff.nodeID }),
                  value.result?.taskVerified != true, value.state != .completed else { throw Rejection.invalidSnapshot }
        }
        if value.state == .awaitingInstall {
            guard value.installHandoff?.state == .staged, value.result?.taskVerified != true else { throw Rejection.invalidSnapshot }
        }
        guard value.error.map({ text($0, max: 8_192) }) ?? true else { throw Rejection.invalidSnapshot }
        if let skipped = value.skippedRoutes {
            guard !skipped.isEmpty, skipped.count <= 8,
                  skipped.allSatisfy({ text($0.instruction, max: 12_000) && text($0.reason, max: 1_024) }) else { throw Rejection.invalidSnapshot }
        }
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
    public static func validate(_ value: InstallHandoff) throws {
        guard value.schema == 1, [value.taskID, value.nodeID, value.parentAttemptID, value.stagedIntentID].allSatisfy(id),
              [value.requestSHA256, value.sourceFingerprint, value.protectedSourceSHA256, value.stagedReceiptSHA256].allSatisfy(isHash),
              value.sourceHead.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil,
              text(value.sourceRoot, max: 4_096), value.sourceRoot.hasPrefix("/"),
              value.installedReceipt.map({ text($0, max: 4_096) && $0.hasPrefix("/") }) ?? true,
              (value.state != .installed || value.installedReceipt != nil),
              (value.state != .staged || value.installedReceipt == nil) else { throw Rejection.invalidSnapshot }
    }

    // Decoders reject unknown fields at EVERY typed nesting boundary, before
    // Codable can ignore them. All external wire ingress must use these APIs.
    private struct Shape: Sendable {
        var keys: Set<String>?
        var children: [String: Shape] = [:]
        var element: (@Sendable () -> Shape)? = nil
        /// A map whose keys are data (e.g. a request class) and whose every value has this shape.
        var values: (@Sendable () -> Shape)? = nil
        static let leaf = Shape(keys: nil)
        static func object(_ keys: [String], _ children: [String: Shape] = [:]) -> Shape { .init(keys: Set(keys), children: children) }
        static func array(_ shape: Shape) -> Shape { .init(keys: nil, element: { shape }) }
        static func map(_ shape: Shape) -> Shape { .init(keys: nil, values: { shape }) }
    }
    private static let configKeys = ["surface", "transport", "account_id", "model", "effort", "tools", "scope", "permission_profile", "quota_pool", "allowed_paths", "configuration_sha256"]
    private static let configShape = Shape.object(configKeys)
    private static let candidateShape = Shape.object(["id"] + configKeys + ["quota_remaining_fraction", "quota_observed_at_ms", "quota_valid_until_ms", "quality_state", "estimated_cost_units", "availability", "availability_observed_at_ms", "availability_valid_until_ms"])
    private static let budgetShape = Shape.object(["max_attempts", "max_parallel", "max_cost_units", "max_duration_ms", "max_native_dispatches", "forbid_model_generation"])
    private static let policyShape = Shape.object(["source_sha256", "projection_sha256", "text"])
    private static let ownerPolicyShape = Shape.object(["schema", "sourceSHA256", "sourceFile", "projectionSHA256", "projection", "sourceID", "sourceModified", "checkedAt", "routing"])
    private static let explicitRouteShape = Shape.object(["surface", "instruction"])
    private static let capacityPlanShape = Shape.object(["codex", "claude"])
    private static let hostShape = Shape.object(["workspace", "context", "provider_preference", "codex_session_id", "claude_session_id", "require_read_only", "owner_policy", "explicit_routes", "conversation_id", "submission_id", "capacity_plan", "explicit_routes_best_effort"], ["owner_policy": ownerPolicyShape, "explicit_routes": .array(explicitRouteShape), "capacity_plan": capacityPlanShape])
    private static let coreRoutingShape = Shape.object(["schema", "original_source_fingerprint", "original_mode", "original_provider_preference", "original_require_read_only", "resolution_sha256", "model_answer"])
    private static let requestShape = Shape.object(["schema", "task_id", "request", "request_sha256", "objective", "policy_sha256", "source_fingerprint", "mode", "material_refs", "budget", "context", "workspace", "native_sessions", "provider_preference", "policy", "host_context", "core_routing", "routing_intent_policy_version"], ["budget": budgetShape, "policy": policyShape, "host_context": hostShape, "core_routing": coreRoutingShape])
    private static let exclusionShape = Shape.object(["provider", "reason", "count"])
    private static let routingIntentV2Shape = Shape.object(["version", "allowed_surfaces", "exact_model", "model_family", "effort", "require_native_ceiling", "quality_target", "state"])
    private static let routingIntentShape = Shape.object(["effort", "model_family"])
    private static let collectionObligationShape = Shape.object(["id", "instruction", "request_utf8_start", "request_utf8_end", "source_paths", "source_sha256s", "contract_sha256", "verifier_sha256", "required_check_ids", "valid_until_ms"])
    private static let collectionShape = Shape.object(["schema", "kind", "manifest_sha256", "obligations"], ["obligations": .array(collectionObligationShape)])
    private static let taskContractShape = Shape.object(["coverage", "scope", "objective_sha256", "contract_sha256", "context_sha256", "source_sha256", "start_tree_sha256", "reference_policy_sha256", "valid_until_ms", "bindings_checked", "execution_isolation", "execution_isolation_sha256", "staged_writer_envelope_sha256", "staged_writer_base_sha256", "owner_collection"], ["owner_collection": collectionShape])
    private static let classCertificateShape = Shape.object(["certificate_id", "provider", "model", "effort", "format_check", "measurement_sha256"])
    private static let catalogShape = Shape.object(["schema", "task_id", "request_sha256", "candidates", "exclusions", "routing_intent", "routing_intent_v2", "model_tiers", "explicit_route_intents", "quota_scores", "native_reference_efforts", "owner_scope", "chat_lane_eligible", "request_class", "task_contract", "class_certificates", "class_provider_pins"], ["candidates": .array(candidateShape), "exclusions": .array(exclusionShape), "routing_intent": routingIntentShape, "routing_intent_v2": routingIntentV2Shape, "explicit_route_intents": .array(routingIntentShape), "task_contract": taskContractShape, "class_certificates": .map(classCertificateShape)])
    private static let nodeShape = Shape.object(["id", "instruction", "dependencies", "kind", "candidate_id", "scope", "owned_paths", "context_refs"])
    private static let planShape = Shape.object(["schema", "task_id", "request_sha256", "nodes", "final_node_id"], ["nodes": .array(nodeShape)])
    private static let handbackShape = Shape.object(["kind", "native_session_id", "protected_root", "source_head", "protected_source_sha256", "source_fingerprint", "request_sha256", "parent_attempt_id", "exit_code", "cancelled", "adoption"])
    private static let repairSourceShape = Shape.object(["source_root", "source_head", "source_before_head", "source_before_sha256", "protected_source_sha256", "source_before_clean", "changed_paths"])
    private static let installHandoffShape = Shape.object(["schema", "task_id", "request_sha256", "node_id", "parent_attempt_id", "source_fingerprint", "source_root", "source_head", "protected_source_sha256", "staged_intent_id", "staged_receipt_sha256", "state", "installed_receipt"])
    private static let continuationShape = Shape.object(["kind", "parent_attempt_id", "parent_native_receipt", "parent_native_receipt_sha256", "native_session_id", "protected_root", "source_head", "protected_source_sha256", "source_fingerprint", "request_sha256"])
    private static let qualityContinuationShape = Shape.object(["schema", "parent_attempt_id", "parent_native_receipt", "parent_native_receipt_sha256", "witness_path", "witness_sha256", "expected_workspace_after_sha256", "original_instruction_sha256", "corrective_attempts"])
    private static let operationalQualityShape = Shape.object(["schema", "coverage", "assessment_state", "contract_sha256", "witness_path", "witness_sha256", "artifact_sha256", "workspace_after_sha256", "failed_check_ids", "corrective_attempts", "local_only_verified"])
    private static let ticketShape = Shape.object(["schema", "task_id", "node_id", "attempt_id", "candidate_id", "request_sha256", "policy_sha256", "policy_source_sha256", "source_fingerprint", "configuration_sha256", "selected_config", "objective", "instruction", "context_refs", "owned_paths", "original_request", "original_objective", "host_context", "native_resume_session_id", "continuation", "core_routing", "quality_continuation", "allow_native_subagents", "execution_isolation", "execution_isolation_sha256", "staged_writer_envelope_sha256", "staged_writer_base_sha256"], ["selected_config": configShape, "host_context": hostShape, "continuation": continuationShape, "core_routing": coreRoutingShape, "quality_continuation": qualityContinuationShape])
    private static let usageShape = Shape.object(["input_tokens", "output_tokens", "reasoning_tokens", "cache_read_tokens", "cache_write_tokens", "provider_calls", "duration_ms", "cost_units", "metric"])
    private static let stagedWriterShape = Shape.object(["state", "receipt_path", "receipt_sha256"])
    private static let configuredBytesShape = Shape.object(["sha256", "utf8_bytes"])
    private static let configuredInputShape = Shape.object(["schema", "kind", "task_id", "node_id", "attempt_id", "candidate_id", "request_sha256", "source_fingerprint", "original_source_fingerprint", "policy_sha256", "policy_source_sha256", "configuration_sha256", "selected_config_sha256", "renderer_id", "harness_sha256", "launch_entry_sha256", "native_binary_sha256", "native_binary_basis", "catalog_sha256", "catalog_observed_at_ms", "prepared_at_ms", "catalog_basis", "channel", "session_state", "delegated_input", "provider_input", "instructions", "base_instructions", "execution_configuration_sha256", "execution_configuration_basis", "input_coverage", "capture_state", "backend_inclusion_verified", "quality_certified", "execution_authorized", "tokenizer_id", "input_tokens", "context_window_tokens", "family", "capacity_upper_bound"], ["delegated_input": configuredBytesShape, "provider_input": configuredBytesShape, "instructions": configuredBytesShape, "base_instructions": configuredBytesShape])
    private static let recordShape = Shape.object(["schema", "task_id", "node_id", "attempt_id", "candidate_id", "configuration_sha256", "selected_config", "acknowledged_config", "observed_config", "status", "output", "execution_verified", "task_verified", "task_quality", "parity_state", "native_receipt", "side_effects", "usage", "error", "dispatch_stage", "native_summary", "handback", "repair_source", "native_turn_terminated", "operational_quality", "staged_writer", "configured_input_observation"], ["selected_config": configShape, "acknowledged_config": configShape, "observed_config": configShape, "usage": usageShape, "handback": handbackShape, "repair_source": repairSourceShape, "operational_quality": operationalQualityShape, "staged_writer": stagedWriterShape, "configured_input_observation": configuredInputShape])
    private static let resultShape = Shape.object(["output", "execution_verified", "task_verified", "task_quality", "parity_state", "native_receipt", "native_summary", "native_summaries"])
    private static let ladderShape = Shape.object(["cheap_effort", "reference_effort", "cheap_model", "reference_model"])
    private static let routingDecisionShape = Shape.object(["route_class", "resolved_candidate_id", "surface", "model", "effort", "quota_pool", "reason", "quota_remaining_fraction", "ladder", "tier"], ["ladder": ladderShape])
    private static let qualityDisclosureShape = Shape.object(["coverage", "failed_check_ids", "witness_sha256", "checker"])
    private static let childShape = Shape.object(["id", "state", "attempt_id", "candidate_id", "selected_config", "instruction", "dependencies", "started_at_ms", "finished_at_ms", "native_receipt", "output_summary", "requested_surface", "routing_decision", "quality_disclosure"], ["selected_config": configShape, "routing_decision": routingDecisionShape, "quality_disclosure": qualityDisclosureShape])
    private static let skippedRouteShape = Shape.object(["surface", "instruction", "reason"])
    private static let routingIntentSummaryShape = Shape.object(["state", "notices", "reason", "resolution_sha256"])
    private static let resourceUsageShape = Shape.object(["schema", "accounting_complete", "total_tokens_observed", "local_tokens_observed", "native_tokens_observed", "local_calls_started", "local_calls_settled", "local_worker_attempts", "native_attempts", "plan_model_calls", "issues", "quota_savings", "cash_cost", "accounting_scope"])
    private static let snapshotShape = Shape.object(["schema", "task_id", "request_sha256", "state", "revision", "children", "result", "error", "install_handoff", "skipped_routes", "routing_intent", "resource_usage"], ["children": .array(childShape), "result": resultShape, "install_handoff": installHandoffShape, "skipped_routes": .array(skippedRouteShape), "routing_intent": routingIntentSummaryShape, "resource_usage": resourceUsageShape])
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
        } else if let valueShape = shape.values {
            guard let map = object as? [String: Any], map.count <= 256 else { throw Rejection.unsupportedField }
            for child in map.values { try checkShape(child, valueShape(), depth: depth + 1) }
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
    public static func decodePlan(_ data: Data, catalog: Catalog? = nil,
                                  context: PlanValidationContext = .authored) throws -> Plan {
        let x = try decode(Plan.self, data: data, shape: planShape)
        try validate(x, catalog: catalog, context: context)
        return x
    }
    public static func decodeTicket(_ data: Data, candidate: Candidate? = nil, request: Request? = nil) throws -> ExecutionTicket { let x = try decode(ExecutionTicket.self, data: data, shape: ticketShape); try validate(x, candidate: candidate, request: request); return x }
    public static func decodeRecord(_ data: Data, ticket: ExecutionTicket? = nil) throws -> ExecutionRecord { let x = try decode(ExecutionRecord.self, data: data, shape: recordShape); try validate(x, ticket: ticket); return x }
    public static func decodeResourceUsageSummary(_ data: Data) throws -> ResourceUsageSummary {
        let x = try decode(ResourceUsageSummary.self, data: data, shape: resourceUsageShape)
        try validate(x); return x
    }
    public static func decodeSnapshot(_ data: Data) throws -> Snapshot { let x = try decode(Snapshot.self, data: data, shape: snapshotShape); try validate(x); return x }
    public static func decodeEvent(_ data: Data) throws -> Event { let x = try decode(Event.self, data: data, shape: eventShape); try validate(x); return x }
    /// For mechanical envelopes: apply the same duplicate-key/size gate before
    /// selecting their strictly named nested typed objects.
    public static func checkedObject(_ data: Data) throws -> [String: Any] {
        guard data.count <= maximumWireBytes else { throw Rejection.oversized }
        var scanner = DuplicateKeyScanner(bytes: Array(data)); try scanner.scan()
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Rejection.invalidInput }
        return object
    }
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
            if dictionary["original_source_fingerprint"] != nil && dictionary["resolution_sha256"] != nil { optional += ["model_answer"] }
            if dictionary["require_read_only"] != nil { optional += ["context", "codex_session_id", "claude_session_id", "owner_policy", "explicit_routes"] }
            if dictionary["quality_state"] != nil { optional += ["quota_remaining_fraction", "quota_observed_at_ms", "quota_valid_until_ms", "estimated_cost_units", "availability_observed_at_ms", "availability_valid_until_ms"] }
            if dictionary["context_refs"] != nil && dictionary["selected_config"] != nil { optional += ["native_resume_session_id", "continuation"] }
            if dictionary["task_quality"] != nil && dictionary["configuration_sha256"] != nil { optional += ["acknowledged_config", "observed_config", "output", "native_receipt", "usage", "error", "native_summary", "handback", "repair_source"] }
            if dictionary["children"] != nil { optional += ["result", "error", "install_handoff"] }
            if dictionary["staged_intent_id"] != nil { optional += ["installed_receipt"] }
            if dictionary["parity_state"] != nil && dictionary["configuration_sha256"] == nil { optional += ["native_receipt", "native_summary", "native_summaries"] }
            if dictionary["state"] != nil && dictionary["id"] != nil { optional += ["attempt_id", "candidate_id", "selected_config", "instruction", "dependencies", "started_at_ms", "finished_at_ms", "native_receipt", "output_summary", "requested_surface"] }
            for key in optional where dictionary[key] == nil { dictionary[key] = NSNull() }
            for (key, child) in dictionary { dictionary[key] = normalize(child) }
            return dictionary
        }
        object = normalize(object)
        let data = try RCCCanonicalJSON.encode(object)
        guard data.count <= maximumWireBytes else { throw Rejection.oversized }; return data
    }
}

/// Pure routing compiler under the OpenClaw task owner. Grammar recognition
/// and admission are functions, not another queue or model owner. This never
/// calls Ollama: a supplied model answer remains a deterministically checked
/// candidate under the existing recipient/payload/negation/scope gates.
public enum RCCCoreRoutingCompiler {
    public enum Kind: String, Sendable { case ordinary, routes, hold, needsModel = "needs_model", localResponse = "local_response" }
    public struct Result: Equatable, Sendable {
        public let taskID: String, requestSHA256: String, policySHA256: String, sourceFingerprint: String
        public let kind: Kind
        public let routes: [RCCRuntimeContract.ExplicitRoute]
        public let bestEffort: Bool
        public let notices: [String]
        public let reason: String?
        public let modelPrompt: String?, modelInput: String?
        public func wireObject() throws -> [String: Any] {
            var object: [String: Any] = ["schema": 1, "task_id": taskID, "request_sha256": requestSHA256,
                "policy_sha256": policySHA256, "source_fingerprint": sourceFingerprint,
                "kind": kind.rawValue, "routes": routes.map { ["surface": $0.surface.rawValue, "instruction": $0.instruction] },
                "best_effort": bestEffort, "notices": notices, "reason": reason as Any? ?? NSNull()]
            if let modelPrompt, let modelInput {
                object["model_prompt"] = modelPrompt; object["model_input"] = modelInput
                // Canonical wire JSON sorts object keys; preserve the original
                // schema property insertion order separately for model output.
                object["model_schema_json"] = RoutingOrderInterpreter.schemaJSON
                object["model_schema"] = try JSONSerialization.jsonObject(with: Data(RoutingOrderInterpreter.schemaJSON.utf8))
            }
            return object
        }
        public func resolutionSHA256(modelAnswer: String?) throws -> String {
            let object: [String: Any] = ["schema": 1, "task_id": taskID, "request_sha256": requestSHA256,
                "policy_sha256": policySHA256, "source_fingerprint": sourceFingerprint,
                "routes": routes.map { ["surface": $0.surface.rawValue, "instruction": $0.instruction] },
                "best_effort": bestEffort, "model_answer": modelAnswer as Any? ?? NSNull()]
            return RCCRuntimeContract.digest(try RCCCanonicalJSON.encode(object))
        }
    }
    public static func compile(_ task: RCCRuntimeContract.Request, modelAnswer: String? = nil) throws -> Result {
        try RCCRuntimeContract.validate(task)
        guard task.coreRouting == nil else { throw RCCRuntimeContract.Rejection.invalidInput }
        // Source-owned response-path recognition runs inside the existing
        // Core compiler, never in a second ingress controller or a model's
        // answer. Explicit providers/materials/actions keep their own route.
        if modelAnswer == nil, task.mode == .auto, task.hostContext?.providerPreference == "auto",
           task.providerPreference == nil || task.providerPreference == "auto",
           task.hostContext?.explicitRoutes == nil, task.materialRefs.isEmpty,
           task.objective == task.request, PromptAttachments.paths(in: task.request).isEmpty,
           !task.request.contains(PromptAttachments.marker), StatusCheckIn.responsePathOnly(task.request) {
            return Result(taskID: task.taskID, requestSHA256: task.requestSHA256,
                policySHA256: task.policySHA256, sourceFingerprint: task.sourceFingerprint,
                kind: .localResponse, routes: [], bestEffort: false, notices: [], reason: nil,
                modelPrompt: nil, modelInput: nil)
        }
        return try compile(taskID: task.taskID, request: task.request, requestSHA256: task.requestSHA256,
            policySHA256: task.policySHA256, sourceFingerprint: task.sourceFingerprint,
            hasAttachments: !task.materialRefs.isEmpty, alreadyExplicit: task.mode == .explicitRoutingTest,
            modelAnswer: modelAnswer)
    }
    public static func compile(taskID: String, request: String, requestSHA256: String,
                               policySHA256: String, sourceFingerprint: String,
                               hasAttachments: Bool = false, alreadyExplicit: Bool = false,
                               modelAnswer: String? = nil) throws -> Result {
        guard RCCRuntimeContract.isHash(requestSHA256), RCCRuntimeContract.isHash(policySHA256),
              RCCRuntimeContract.isHash(sourceFingerprint),
              RCCRuntimeContract.digest(Data(request.utf8)) == requestSHA256,
              modelAnswer.map({ $0.utf8.count <= 4_096 }) ?? true else { throw RCCRuntimeContract.Rejection.invalidHash }
        func result(_ kind: Kind, _ routes: [RCCRuntimeContract.ExplicitRoute] = [],
                    bestEffort: Bool = false, notices: [String] = [], reason: String? = nil,
                    modelInput: String? = nil) -> Result {
            Result(taskID: taskID, requestSHA256: requestSHA256, policySHA256: policySHA256,
                sourceFingerprint: sourceFingerprint, kind: kind, routes: routes, bestEffort: bestEffort,
                notices: notices, reason: reason,
                modelPrompt: kind == .needsModel ? RoutingOrderInterpreter.systemPrompt : nil, modelInput: modelInput)
        }
        if alreadyExplicit { return result(.ordinary, reason: "existing_explicit_contract") }
        if hasAttachments || !PromptAttachments.paths(in: request).isEmpty || request.contains(PromptAttachments.marker) {
            return result(.ordinary, reason: "attachments")
        }
        func named(_ parts: RouteAllIntent.NamedParts) -> Result {
            let notes = parts.gptParts.isEmpty ? [] : ["GPT is no longer routed; dropped: " + parts.gptParts.joined(separator: ", ")]
            return parts.routes.isEmpty ? result(.hold, notices: notes, reason: "no_routes_left") : result(.routes, parts.routes, notices: notes)
        }
        func all(_ order: RouteAllIntent.Order) -> Result {
            var notes: [String] = []
            if !order.gptNames.isEmpty { notes.append("GPT is no longer routed; excluded: " + order.gptNames.joined(separator: ", ")) }
            if !order.excluded.isEmpty { notes.append("Excluded as requested: " + order.excluded.joined(separator: ", ")) }
            if let hold = order.hold { return result(.hold, notices: notes, reason: hold.rawValue) }
            guard let plan = RouteAllIntent.plan(order, available: RouteAllIntent.surfaceOrder), !plan.routes.isEmpty else {
                return result(.hold, notices: notes, reason: "no_routes_left")
            }
            if plan.defaulted { notes.append("No expression was supplied; the established default arithmetic is used.") }
            if !plan.unsent.isEmpty { notes.append("Expressions with no route: " + plan.unsent.joined(separator: ", ")) }
            return result(.routes, plan.routes, bestEffort: true, notices: notes)
        }
        // Same compiler priority as former ingress; no health, quota,
        // configuration, readiness or account is inspected here.
        if !RouteAllIntent.namesLocalRoute(request), let fanout = RouteFanout.plan(request) {
            let partition = RouteFanout.droppingGPT(fanout.targets)
            let routes = partition.kept.compactMap { target -> RCCRuntimeContract.ExplicitRoute? in
                guard let surface = RCCRuntimeContract.Surface(rawValue: target.surface.rawValue) else { return nil }
                return .init(surface: surface, instruction: target.payload)
            }
            var notes: [String] = []
            if !partition.dropped.isEmpty { notes.append("GPT is no longer routed; dropped: " + partition.dropped.map { $0.mention + ": " + $0.payload }.joined(separator: ", ")) }
            if !partition.remapped.isEmpty { notes.append("Codex-named chat parts use Codex, not GPT.") }
            return routes.isEmpty ? result(.hold, notices: notes, reason: "explicit_route_surface_dropped") :
                result(.routes, routes, notices: notes)
        }
        if let parts = RouteAllIntent.namedParts(request) { return named(parts) }
        if let order = RouteAllIntent.order(request) { return all(order) }
        let facts: RoutingOrderInterpreter.Facts
        switch RoutingOrderInterpreter.screen(request, hasAttachments: false) {
        case .skip(let reason): return result(.ordinary, reason: reason)
        case .ask(let value): facts = value
        }
        guard let modelAnswer else { return result(.needsModel, modelInput: facts.text) }
        guard let answer = RoutingOrderInterpreter.decode(modelAnswer) else { return result(.hold, reason: "schema_mismatch") }
        let verdict = RoutingOrderInterpreter.verify(answer, facts: facts)
        guard let decision = verdict.decision else {
            let refused = answer.kind == "other" || answer.otherInstruction || answer.sendsPointedContent
            return result(refused ? .ordinary : .hold, reason: verdict.reason ?? "intent_unconfirmed")
        }
        switch decision {
        case .routeAll(let order): return all(order)
        case .namedRoutes(let parts): return named(parts)
        }
    }
    /// Duplicate/unknown keys and malformed task types fail before a
    /// candidate answer can affect any dispatch.
    public static func compileEnvelope(_ bytes: Data) throws -> Data {
        let object = try RCCRuntimeContract.checkedObject(bytes)
        guard Set(object.keys).isSubset(of: ["schema", "task", "answer"]),
              let schema = object["schema"] as? NSNumber,
              CFGetTypeID(schema) != CFBooleanGetTypeID(), schema.intValue == 1, schema.doubleValue == 1,
              let task = object["task"] as? [String: Any] else { throw RCCRuntimeContract.Rejection.invalidInput }
        let answer: String?
        if let supplied = object["answer"] {
            guard let raw = supplied as? String, raw.utf8.count <= 4_096 else { throw RCCRuntimeContract.Rejection.invalidInput }
            answer = raw
        } else { answer = nil }
        let request = try RCCRuntimeContract.decodeRequest(JSONSerialization.data(withJSONObject: task, options: [.sortedKeys, .withoutEscapingSlashes]))
        return try RCCCanonicalJSON.encode(compile(request, modelAnswer: answer).wireObject())
    }
}
