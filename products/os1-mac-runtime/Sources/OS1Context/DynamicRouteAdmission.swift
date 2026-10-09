import CryptoKit
import Foundation

/// A deterministic RCC admission/selection gate over host-supplied runtime
/// facts. It does not classify intent, discover models, sign profiles, estimate
/// costs, or prove output quality. Those sources must be checked by the host.
/// No provider/model name selects a tier or wins an evaluation here.
public enum DynamicRouteAdmission {
    public enum Transport: String, Codable, Sendable {
        case local
        case codexAppServer = "codex_app_server"
        case claudeCLI = "claude_cli"
        case chatGPTService = "chatgpt_service"
        case claudeService = "claude_service"
        case handoff

        public var quotaPool: QuotaPool {
            switch self {
            case .local, .handoff: return .none
            case .codexAppServer: return .openAICodex
            case .chatGPTService: return .openAIChat
            case .claudeCLI, .claudeService: return .anthropicShared
            }
        }
    }

    public enum QuotaPool: String, Codable, Sendable {
        case none, unknown
        case openAICodex = "openai_codex"
        case openAIChat = "openai_chat"
        case anthropicShared = "anthropic_shared"
    }

    public enum QualityState: String, Codable, Sendable {
        /// A verified signed routing policy permits this exact configuration.
        /// This is NOT measured reference parity or verified task completion.
        case policyAdmitted = "policy_admitted"
        case exactDomainVerified = "exact_domain_verified"
        case referenceEquivalent = "reference_equivalent"
        case referenceAbove = "reference_above"
        case unverified, mismatch
    }

    public enum AvailabilityState: String, Codable, Sendable { case available, unavailable, unknown }

    /// receiptID is an actual evidence pointer, not a generated explanation.
    /// Temporal fields belong to the observation, not a presumed cause time.
    public struct Observation: Codable, Equatable, Sendable {
        public var receiptID: String
        public var observedAt: Date
        public var validUntil: Date
        public init(receiptID: String, observedAt: Date, validUntil: Date) {
            self.receiptID = receiptID; self.observedAt = observedAt; self.validUntil = validUntil
        }
        public func isFresh(at now: Date) -> Bool {
            !receiptID.isEmpty && observedAt.timeIntervalSince1970.isFinite &&
                validUntil.timeIntervalSince1970.isFinite && observedAt <= now && now < validUntil
        }
    }

    public struct Availability: Codable, Equatable, Sendable {
        public var state: AvailabilityState
        public var observation: Observation
        public init(state: AvailabilityState, observation: Observation) {
            self.state = state; self.observation = observation
        }
    }

    public struct Quota: Codable, Equatable, Sendable {
        /// Minimum headroom across ALL applicable account/model windows,
        /// prepared by the host. A spacious scoped window must not hide an
        /// exhausted general weekly window. This is a fraction in 0...1.
        public var remainingFraction: Double
        public var observation: Observation
        public init(remainingFraction: Double, observation: Observation) {
            self.remainingFraction = remainingFraction; self.observation = observation
        }
    }

    public struct Cost: Codable, Equatable, Sendable {
        /// A host-supplied estimate for this requirement, on a common metric.
        /// Token estimates must not be described as measured monetary cost.
        public var metric: String
        public var expectedUsage: Double
        public var expectedLatencySeconds: Double?
        public var observation: Observation
        public init(metric: String, expectedUsage: Double, expectedLatencySeconds: Double? = nil,
                    observation: Observation) {
            self.metric = metric; self.expectedUsage = expectedUsage
            self.expectedLatencySeconds = expectedLatencySeconds; self.observation = observation
        }
    }

    public struct QualityQualification: Codable, Equatable, Sendable {
        public var state: QualityState
        /// Exact pre-dispatch family/domain/reference-policy identity. The
        /// caller supplies it; this gate does not infer the task's family.
        public var qualificationKey: String
        public var configurationID: String
        public var authorityID: String
        public var observation: Observation
        public init(state: QualityState, qualificationKey: String, configurationID: String,
                    authorityID: String, observation: Observation) {
            self.state = state; self.qualificationKey = qualificationKey
            self.configurationID = configurationID; self.authorityID = authorityID
            self.observation = observation
        }
    }

    public struct Candidate: Codable, Equatable, Sendable {
        public var id: String
        public var provider: String
        public var transport: Transport
        public var quotaPool: QuotaPool
        /// The exact model/effort/instruction/permission tuple's identity.
        /// Models and effort values are opaque metadata, not sortable tiers.
        public var configurationID: String
        public var effort: String
        public var capabilities: [String]
        public var authorityID: String
        public var availability: Availability?
        public var quota: Quota?
        public var quality: QualityQualification?
        public var cost: Cost?
        public init(id: String, provider: String, transport: Transport, quotaPool: QuotaPool,
                    configurationID: String, effort: String, capabilities: [String], authorityID: String,
                    availability: Availability? = nil, quota: Quota? = nil,
                    quality: QualityQualification? = nil, cost: Cost? = nil) {
            self.id = id; self.provider = provider; self.transport = transport; self.quotaPool = quotaPool
            self.configurationID = configurationID; self.effort = effort; self.capabilities = capabilities
            self.authorityID = authorityID; self.availability = availability; self.quota = quota
            self.quality = quality; self.cost = cost
        }
    }

    public struct Requirement: Codable, Equatable, Sendable {
        public var id: String
        public var requiredCapabilities: [String]
        public var trustedAuthorityIDs: [String]
        public var qualificationKey: String
        public var acceptedQualityStates: [QualityState]
        /// An explicit route request locks the action set. Failure means hold,
        /// not permission to spend another pool or silently reduce effort.
        public var requestedCandidateID: String?
        public var forbiddenQuotaPools: [QuotaPool]
        public var requireFreshAvailability: Bool
        public var requireFreshQuota: Bool
        public var costMetric: String
        public init(id: String, requiredCapabilities: [String], trustedAuthorityIDs: [String],
                    qualificationKey: String, acceptedQualityStates: [QualityState],
                    requestedCandidateID: String? = nil, forbiddenQuotaPools: [QuotaPool] = [],
                    requireFreshAvailability: Bool = false, requireFreshQuota: Bool = false,
                    costMetric: String = "tokens") {
            self.id = id; self.requiredCapabilities = requiredCapabilities
            self.trustedAuthorityIDs = trustedAuthorityIDs; self.qualificationKey = qualificationKey
            self.acceptedQualityStates = acceptedQualityStates; self.requestedCandidateID = requestedCandidateID
            self.forbiddenQuotaPools = forbiddenQuotaPools; self.requireFreshAvailability = requireFreshAvailability
            self.requireFreshQuota = requireFreshQuota; self.costMetric = costMetric
        }
    }

    public struct Rejection: Codable, Equatable, Sendable {
        public var candidateID: String
        public var reasons: [String]
    }
    public struct Decision: Codable, Equatable, Sendable {
        public enum State: String, Codable, Sendable { case selected, held, invalidState = "invalid_state" }
        public var state: State
        public var selectedCandidateID: String?
        public var admissionQuality: QualityState?
        /// Routing eligibility does not certify the output that has not yet
        /// been produced. The post-execution verifier remains responsible.
        public var executionQuality: QualityState = .unverified
        public var admittedCandidateIDs: [String]
        public var rejections: [Rejection]
        public var breakingVariables: [String]
        public var stateFingerprint: String
        public var reason: String
    }

    private struct StateSnapshot: Codable {
        var requirement: Requirement
        var candidates: [Candidate]
        var evaluatedAt: Date
    }
    private struct Admitted {
        var candidate: Candidate
        var cost: Cost?
        var quota: Quota?
    }

    /// Single-candidate execution-boundary check. This deliberately cannot
    /// replace the private signed router, invent a cheaper model, or fallback.
    public static func verifyActualTransport(candidate: Candidate, requirement: Requirement,
                                             now: Date = Date()) -> Decision {
        evaluate(requirement: requirement, candidates: [candidate], now: now)
    }

    public static func evaluate(requirement: Requirement, candidates: [Candidate], now: Date = Date()) -> Decision {
        var requirement = requirement
        requirement.requiredCapabilities = Array(Set(requirement.requiredCapabilities)).sorted()
        requirement.trustedAuthorityIDs = Array(Set(requirement.trustedAuthorityIDs)).sorted()
        requirement.forbiddenQuotaPools = Array(Set(requirement.forbiddenQuotaPools.map(\.rawValue))).sorted()
            .compactMap(QuotaPool.init(rawValue:))
        requirement.acceptedQualityStates = Array(Set(requirement.acceptedQualityStates.map(\.rawValue))).sorted()
            .compactMap(QualityState.init(rawValue:))
        let candidates = candidates.map { original -> Candidate in
            var candidate = original; candidate.capabilities = Array(Set(candidate.capabilities)).sorted(); return candidate
        }.sorted { $0.id < $1.id }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .millisecondsSince1970
        encoder.nonConformingFloatEncodingStrategy = .convertToString(positiveInfinity: "Infinity", negativeInfinity: "-Infinity", nan: "NaN")
        let bytes = try? encoder.encode(StateSnapshot(requirement: requirement, candidates: candidates, evaluatedAt: now))
        let fingerprint = bytes.map { SHA256.hash(data: $0).map { String(format: "%02x", $0) }.joined() } ?? ""
        var rejections: [Rejection] = []
        var breaking: [String] = []
        var admitted: [Admitted] = []
        func result(_ state: Decision.State, _ selected: Candidate?, _ reason: String) -> Decision {
            Decision(state: state, selectedCandidateID: selected?.id, admissionQuality: selected?.quality?.state,
                     admittedCandidateIDs: admitted.map { $0.candidate.id }.sorted(), rejections: rejections,
                     breakingVariables: Array(Set(breaking)).sorted(), stateFingerprint: fingerprint, reason: reason)
        }
        guard !fingerprint.isEmpty, now.timeIntervalSince1970.isFinite, !requirement.id.isEmpty,
              !requirement.qualificationKey.isEmpty, !requirement.trustedAuthorityIDs.isEmpty,
              !requirement.acceptedQualityStates.isEmpty, !requirement.costMetric.isEmpty,
              !requirement.acceptedQualityStates.contains(.unverified), !requirement.acceptedQualityStates.contains(.mismatch),
              requirement.requestedCandidateID.map({ !$0.isEmpty }) ?? true,
              Set(candidates.map(\.id)).count == candidates.count else {
            breaking.append("valid_unique_requirement_and_candidate_identity")
            return result(.invalidState, nil, "Invalid admission contract or duplicate candidate identity")
        }
        for candidate in candidates {
            var rejected: [String] = []
            func reject(_ reason: String) { rejected.append(reason) }
            if let requested = requirement.requestedCandidateID, candidate.id != requested { reject("explicit_route_locked") }
            if candidate.id.isEmpty || candidate.provider.isEmpty || candidate.configurationID.isEmpty || candidate.effort.isEmpty {
                reject("incomplete_execution_identity")
            }
            if !requirement.trustedAuthorityIDs.contains(candidate.authorityID) { reject("untrusted_execution_authority") }
            if !Set(requirement.requiredCapabilities).isSubset(of: Set(candidate.capabilities)) { reject("required_capability_missing") }
            if candidate.transport == .handoff { reject("handoff_is_not_execution") }
            if candidate.quotaPool != candidate.transport.quotaPool { reject("transport_quota_pool_mismatch") }
            if requirement.forbiddenQuotaPools.contains(candidate.quotaPool) { reject("quota_pool_forbidden") }
            // A local executor is admitted only after its parser/domain has
            // been checked for this requirement; a generic policy permit or
            // an assertion that the request "looks easy" is insufficient.
            if candidate.transport == .local && candidate.quality?.state != .exactDomainVerified {
                reject("local_executor_domain_not_verified")
            }

            let availability = candidate.availability.flatMap { $0.observation.isFresh(at: now) ? $0.state : nil }
            switch availability {
            case .available: break
            case .unavailable: reject("transport_unavailable")
            case .unknown, nil:
                breaking.append("\(candidate.id):fresh_transport_availability")
                if requirement.requireFreshAvailability { reject("transport_availability_unknown_or_stale") }
                // A service surface with no established execution connection
                // must never masquerade as a native CLI/app-server lane.
                if candidate.transport == .chatGPTService || candidate.transport == .claudeService {
                    reject("service_execution_connection_unverified")
                }
                if candidate.transport == .local { reject("local_executor_availability_unverified") }
            }

            if let quality = candidate.quality {
                if !requirement.acceptedQualityStates.contains(quality.state) { reject("quality_floor_not_admitted") }
                if quality.qualificationKey != requirement.qualificationKey { reject("quality_scope_mismatch") }
                if quality.configurationID != candidate.configurationID { reject("quality_configuration_mismatch") }
                if !requirement.trustedAuthorityIDs.contains(quality.authorityID) { reject("untrusted_quality_authority") }
                if !quality.observation.isFresh(at: now) { reject("quality_qualification_unknown_or_stale") }
            } else {
                reject("quality_qualification_missing")
                breaking.append("\(candidate.id):exact_quality_qualification")
            }
            let quota = candidate.quota.flatMap { value -> Quota? in
                guard value.observation.isFresh(at: now), value.remainingFraction.isFinite,
                      (0...1).contains(value.remainingFraction) else { return nil }
                return value
            }
            if candidate.quotaPool != .none {
                if let quota {
                    if quota.remainingFraction == 0 { reject("applicable_quota_exhausted") }
                } else {
                    breaking.append("\(candidate.id):fresh_applicable_quota_headroom")
                    if requirement.requireFreshQuota { reject("quota_unknown_or_stale") }
                }
            }
            let cost = candidate.cost.flatMap { value -> Cost? in
                guard value.observation.isFresh(at: now), value.metric == requirement.costMetric,
                      value.expectedUsage.isFinite, value.expectedUsage >= 0,
                      value.expectedLatencySeconds.map({ $0.isFinite && $0 >= 0 }) ?? true else { return nil }
                return value
            }
            if cost == nil { breaking.append("\(candidate.id):comparable_expected_usage") }
            if rejected.isEmpty { admitted.append(Admitted(candidate: candidate, cost: cost, quota: quota)) }
            else { rejections.append(Rejection(candidateID: candidate.id, reasons: Array(Set(rejected)).sorted())) }
        }
        if let requested = requirement.requestedCandidateID, !candidates.contains(where: { $0.id == requested }) {
            breaking.append("\(requested):requested_route_available")
        }
        guard !admitted.isEmpty else { return result(.held, nil, "No candidate passed the exact execution admission contract") }
        if admitted.count == 1 {
            return result(.selected, admitted[0].candidate, "Only admitted route; unknown facts remain explicit, not estimated")
        }
        // Do not compare different qualification strengths as if they were
        // the same measured quality, or resolve missing costs by model fame.
        guard Set(admitted.compactMap { $0.candidate.quality?.state.rawValue }).count == 1 else {
            breaking.append("common_quality_selection_class")
            return result(.held, nil, "Candidates have different quality classes; the host must lock a common criterion")
        }
        guard admitted.allSatisfy({ $0.cost != nil }) else {
            return result(.held, nil, "Cannot establish the cheapest admitted route with incomparable or missing cost observations")
        }
        let minimum = admitted.compactMap { $0.cost?.expectedUsage }.min()!
        var finalists = admitted.filter { $0.cost?.expectedUsage == minimum }
        if finalists.count > 1 {
            // Headroom is a tie-break after the exact same admitted quality
            // class and usage metric. Unknown is not secretly 0 or 100%.
            if finalists.allSatisfy({ $0.candidate.quotaPool == .none || $0.quota != nil }) {
                let headroom = finalists.map { $0.candidate.quotaPool == .none ? 1 : $0.quota!.remainingFraction }.max()!
                finalists = finalists.filter { ($0.candidate.quotaPool == .none ? 1 : $0.quota!.remainingFraction) == headroom }
            }
        }
        if finalists.count > 1, finalists.allSatisfy({ $0.cost?.expectedLatencySeconds != nil }) {
            let latency = finalists.compactMap { $0.cost?.expectedLatencySeconds }.min()!
            finalists = finalists.filter { $0.cost?.expectedLatencySeconds == latency }
        }
        guard finalists.count == 1 else {
            breaking.append("qualified_usage_headroom_latency_tie")
            return result(.held, nil, "Runtime facts do not distinguish the remaining admitted routes; no name-based tie-break")
        }
        return result(.selected, finalists[0].candidate, "Minimum supplied usage among same-quality admitted routes; headroom/latency only break ties")
    }

    /// In-memory regressions only: no provider call, file IO, or user state.
    public static func selfTest() throws {
        let now = Date(timeIntervalSince1970: 10_000)
        let observation = Observation(receiptID: "fixture-only", observedAt: now.addingTimeInterval(-1), validUntil: now.addingTimeInterval(60))
        let quality = QualityQualification(state: .policyAdmitted, qualificationKey: "scope-A", configurationID: "config-A",
                                           authorityID: "signed-fixture", observation: observation)
        let requirement = Requirement(id: "request-A", requiredCapabilities: ["answer"], trustedAuthorityIDs: ["signed-fixture"],
                                      qualificationKey: "scope-A", acceptedQualityStates: [.policyAdmitted], requireFreshAvailability: true)
        var first = Candidate(id: "A", provider: "fixture-one", transport: .codexAppServer, quotaPool: .openAICodex,
                              configurationID: "config-A", effort: "opaque", capabilities: ["answer"], authorityID: "signed-fixture",
                              availability: Availability(state: .available, observation: observation),
                              quota: Quota(remainingFraction: 0.7, observation: observation), quality: quality,
                              cost: Cost(metric: "tokens", expectedUsage: 10, expectedLatencySeconds: 5, observation: observation))
        var second = first; second.id = "B"; second.provider = "fixture-two"; second.transport = .claudeCLI; second.quotaPool = .anthropicShared
        second.capabilities.append("write"); second.quota?.remainingFraction = 0.9
        second.cost?.expectedUsage = 20
        var failures: [String] = []
        func check(_ passed: Bool, _ label: String) { if !passed { failures.append(label) } }
        func selected(_ req: Requirement = requirement, _ a: Candidate = first, _ b: Candidate = second) -> String? {
            evaluate(requirement: req, candidates: [a, b], now: now).selectedCandidateID
        }
        check(selected() == "A", "usage after capability/authority/quality")
        first.quota?.remainingFraction = 0
        check(selected() == "B", "fresh quota changes route")
        first.quota?.remainingFraction = 0.7
        var writes = requirement; writes.requiredCapabilities.append("write")
        check(selected(writes) == "B", "actual required tools change route")
        first.quality?.qualificationKey = "wrong-scope"
        check(selected() == "B", "evidence scope changes route")
        first.quality = quality; first.quality?.state = .unverified
        check(selected() == "B", "unqualified output cannot substitute for qualification")
        first.quality = quality
        var locked = requirement; locked.requestedCandidateID = "A"; first.quota?.remainingFraction = 0
        check(selected(locked) == nil, "requested route never silently falls back")
        first.quota?.remainingFraction = 0.7
        var forbidden = requirement; forbidden.forbiddenQuotaPools = [.openAICodex]
        check(selected(forbidden) == "B", "native GPT chat still spends Codex pool")
        var falseFree = first; falseFree.quotaPool = .none
        check(verifyActualTransport(candidate: falseFree, requirement: requirement, now: now).state == .held,
              "chat label cannot erase transport quota")
        var realChat = first; realChat.transport = .chatGPTService; realChat.quotaPool = .openAIChat
        realChat.availability = Availability(state: .unavailable, observation: observation)
        check(verifyActualTransport(candidate: realChat, requirement: requirement, now: now).state == .held,
              "unavailable real chat is not native fallback")
        var stale = first; stale.availability?.observation.validUntil = now
        check(verifyActualTransport(candidate: stale, requirement: requirement, now: now).state == .held, "stale availability stays unknown")
        var ordinary = requirement; ordinary.requireFreshAvailability = false; ordinary.requireFreshQuota = false
        var unknown = first; unknown.availability = nil; unknown.quota = nil
        let unknownDecision = verifyActualTransport(candidate: unknown, requirement: ordinary, now: now)
        check(unknownDecision.state == .selected && !unknownDecision.breakingVariables.isEmpty, "ordinary unknown is not all-work outage")
        check(unknownDecision.executionQuality == .unverified, "policy admission is not execution parity")
        var noCost = first; noCost.cost = nil
        check(evaluate(requirement: requirement, candidates: [noCost, second], now: now).state == .held,
              "unknown cost cannot certify cheapest selection")
        var wrongAuthority = first; wrongAuthority.authorityID = "model-assertion"
        check(selected(requirement, wrongAuthority, second) == "B", "model assertion cannot authorize transport")
        var staleQuality = first; staleQuality.quality?.observation.validUntil = now
        check(selected(requirement, staleQuality, second) == "B", "stale quality certificate cannot justify cheap route")
        second.cost?.expectedUsage = 10; second.quota?.remainingFraction = 0.9
        check(selected() == "B", "headroom breaks equal usage only")
        second.quota?.remainingFraction = 0.7; second.cost?.expectedLatencySeconds = 3
        check(selected() == "B", "latency after equal usage and headroom")
        second.cost?.expectedLatencySeconds = 5
        check(selected() == nil, "no provider identity tie-break")
        let forward = evaluate(requirement: requirement, candidates: [first, second], now: now)
        let reverse = evaluate(requirement: requirement, candidates: [second, first], now: now)
        check(forward == reverse && forward.stateFingerprint.count == 64, "input ordering does not alter decision/fingerprint")
        var local = first; local.id = "local"; local.provider = "local"; local.transport = .local; local.quotaPool = .none
        local.effort = "none"; local.quota = nil; local.quality?.state = .exactDomainVerified
        var exact = requirement; exact.acceptedQualityStates = [.exactDomainVerified]
        check(verifyActualTransport(candidate: local, requirement: exact, now: now).state == .selected, "verified exact local domain is usable")
        var vagueLocal = local; vagueLocal.quality?.state = .policyAdmitted
        check(verifyActualTransport(candidate: vagueLocal, requirement: requirement, now: now).state == .held,
              "local policy alone is not exact-domain verification")
        local.capabilities = []
        check(verifyActualTransport(candidate: local, requirement: exact, now: now).state == .held, "local executor abstains outside declared capabilities")
        guard failures.isEmpty else { throw DynamicRouteAdmissionError.selfTest(failures) }
    }
}

public enum DynamicRouteAdmissionError: Error, CustomStringConvertible {
    case selfTest([String])
    public var description: String {
        switch self {
        case .selfTest(let failures): return "Dynamic route admission self-test failed: " + failures.joined(separator: "; ")
        }
    }
}
