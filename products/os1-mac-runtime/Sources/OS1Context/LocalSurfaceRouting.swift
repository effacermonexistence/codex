import CryptoKit
import Foundation

/// A local model may prefer one host-listed execution descriptor. It may not
/// manufacture a transport, authentication mode, budget, model, or permission.
/// Every choice passes the existing deterministic host admission/ranking gate.
public enum LocalSurfaceRouting {
    public static let maximumOutputBytes = 4_096
    public static let maximumInventoryCount = 64

    /// Four requested product surfaces, not four independent usage pools.
    public enum LogicalSurface: String, Codable, Sendable {
        case consumerChatGPT = "consumer_chatgpt", codexAgent = "codex_agent"
        case claudeChat = "claude_chat", claudeAgent = "claude_agent"
    }
    /// Bounded GPT through Codex is a Codex transport/lane, NOT consumer ChatGPT.
    public enum Lane: String, Codable, Sendable { case agent, boundedChat = "bounded_chat", consumerChat = "consumer_chat", local }
    public enum AuthenticationMode: String, Codable, Sendable {
        case subscription, apiKey = "api_key", cloudProvider = "cloud_provider", local, unknown
    }
    public enum BillingMode: String, Codable, Sendable {
        case includedSubscription = "included_subscription", paidCredits = "paid_credits"
        case apiPayAsYouGo = "api_pay_as_you_go", cloudPayAsYouGo = "cloud_pay_as_you_go", localCompute = "local_compute", unknown
    }
    public enum Criterion: String, Codable, Sendable {
        /// Existing whole-inventory deterministic usage ranking. Missing or
        /// incomparable host costs still hold; this behavior is not weakened.
        case measuredMinimumUsage = "measured_minimum_usage"
        /// An explicit bounded preference among independently admitted equal-
        /// quality candidates. This does NOT establish the cheapest route.
        case boundedQuotaPreference = "bounded_quota_preference"
    }
    public enum SelectionClaim: String, Codable, Sendable {
        case minimumSuppliedUsage = "minimum_supplied_usage"
        case boundedInference = "bounded_inference_not_proven_cheapest_or_parity"
    }
    public struct AuthenticationObservation: Codable, Equatable, Sendable {
        public let mode: AuthenticationMode
        public let accountID: String
        public let observation: DynamicRouteAdmission.Observation
        public init(mode: AuthenticationMode, accountID: String, observation: DynamicRouteAdmission.Observation) {
            self.mode = mode; self.accountID = accountID; self.observation = observation
        }
    }
    public struct BillingObservation: Codable, Equatable, Sendable {
        public let mode: BillingMode
        public let accountID: String
        public let observation: DynamicRouteAdmission.Observation
        public init(mode: BillingMode, accountID: String, observation: DynamicRouteAdmission.Observation) {
            self.mode = mode; self.accountID = accountID; self.observation = observation
        }
    }

    public struct Descriptor: Codable, Equatable, Sendable {
        /// nil denotes a host-owned local executor, not another hosted pool.
        public let logicalSurface: LogicalSurface?
        public let lane: Lane
        public let accountID: String
        /// The account binding of the actual host quota observation. Quota
        /// percentages from another account must not fund this descriptor.
        public let quotaAccountID: String?
        public let authentication: AuthenticationObservation?
        public let billing: BillingObservation?
        /// All availability, capability, quality, quota and cost facts are
        /// supplied by the host. No field is taken from the local choice JSON.
        public let candidate: DynamicRouteAdmission.Candidate
        public init(logicalSurface: LogicalSurface?, lane: Lane, accountID: String, quotaAccountID: String? = nil,
                    authentication: AuthenticationObservation? = nil, billing: BillingObservation? = nil,
                    candidate: DynamicRouteAdmission.Candidate) {
            self.logicalSurface = logicalSurface; self.lane = lane; self.accountID = accountID
            self.quotaAccountID = quotaAccountID
            self.authentication = authentication; self.billing = billing; self.candidate = candidate
        }
        public var id: String { candidate.id }

        /// Classify only the observed billing mode, never the product label.
        /// Unknown or PAYG must not look like a free/subscription allowance.
        public func observedQuotaPool(at now: Date) -> DynamicRouteAdmission.QuotaPool {
            guard let authentication, let billing,
                  authentication.accountID == accountID, billing.accountID == accountID,
                  authentication.observation.isFresh(at: now), billing.observation.isFresh(at: now) else { return .unknown }
            if candidate.transport == .local, logicalSurface == nil, lane == .local,
               authentication.mode == .local, billing.mode == .localCompute { return .none }
            guard authentication.mode == .subscription, billing.mode == .includedSubscription else { return .unknown }
            switch candidate.transport {
            case .chatGPTService: return .openAIChat
            case .codexAppServer: return .openAICodex
            case .claudeCLI, .claudeService: return .anthropicShared
            case .local, .handoff: return .unknown
            }
        }
        /// Shared pool identity must retain account and billing mode. It is
        /// not proof that two turns consume the same quantity of that pool.
        public func budgetKey(at now: Date) -> String? {
            let pool = observedQuotaPool(at: now)
            guard pool != .unknown, !accountID.isEmpty else { return nil }
            return pool.rawValue + ":" + accountID
        }
    }

    public struct Input: Encodable, Equatable, Sendable {
        public let request: String
        public let requestSHA256: String
        public let inventory: [Descriptor]
        /// Host-prepared eligibility IDs; candidates still pass admission.
        public let eligibleCandidateIDs: [String]
        public let requirement: DynamicRouteAdmission.Requirement
        public let criterion: Criterion
        public init(request: String, inventory: [Descriptor], eligibleCandidateIDs: [String],
                    requirement: DynamicRouteAdmission.Requirement, criterion: Criterion = .measuredMinimumUsage) {
            self.request = request; requestSHA256 = LocalSurfaceRouting.digest(Data(request.utf8))
            self.inventory = inventory; self.eligibleCandidateIDs = eligibleCandidateIDs; self.requirement = requirement
            self.criterion = criterion
        }
        public var inventorySHA256: String { LocalSurfaceRouting.encodedDigest(inventory) }
        public var fingerprint: String { LocalSurfaceRouting.encodedDigest(self) }
    }

    public enum Rejection: String, Codable, Sendable {
        case invalidInput = "invalid_input", invalidOutput = "invalid_output", oversizedOutput = "oversized_output"
        case producerBindingMismatch = "producer_binding_mismatch", unknownCandidate = "unknown_candidate"
        case ineligibleCandidate = "ineligible_candidate", explicitRequestConflict = "explicit_request_conflict"
        case hostAdmissionHeld = "host_admission_held", hostAdmissionRejected = "host_admission_rejected"
        case hostRankingConflict = "host_ranking_conflict"
        case qualityClassConflict = "quality_class_conflict"
    }
    public struct DescriptorRejection: Codable, Equatable, Sendable {
        public let candidateID: String
        public let reasons: [String]
    }
    public struct Admission: Codable, Equatable, Sendable {
        public enum State: String, Codable, Sendable { case candidateAccepted = "candidate_accepted", held, rejected }
        public let state: State
        public let preferredCandidateID: String?
        public let selectedCandidateID: String?
        public let preferredDescriptor: Descriptor?
        public let selectedDescriptor: Descriptor?
        public let selectionCriterion: Criterion
        public let claimLevel: SelectionClaim?
        public let rejection: Rejection?
        public let descriptorRejections: [DescriptorRejection]
        public let hostDecision: DynamicRouteAdmission.Decision?
        public let requestSHA256: String
        public let inventorySHA256: String
        public let inputFingerprint: String
        public let rawOutputSHA256: String
    }

    /// The adapter retains `producedForFingerprint` from the immutable input
    /// it actually submitted. This is host provenance, not a model JSON field.
    /// A model preference never overrides the owner's explicit ID or the host's
    /// independently admitted/ranked route. Held/rejected has no selected ID.
    public static func admit(rawOutput: Data, producedForFingerprint: String, for input: Input,
                             now: Date = Date()) -> Admission {
        let fingerprint = input.fingerprint
        var preferred: String?
        var failures: [DescriptorRejection] = []
        var decision: DynamicRouteAdmission.Decision?
        func result(_ state: Admission.State, _ reason: Rejection? = nil, selected: String? = nil) -> Admission {
            Admission(state: state, preferredCandidateID: preferred, selectedCandidateID: selected,
                preferredDescriptor: input.inventory.first(where: { $0.id == preferred }),
                selectedDescriptor: selected.flatMap { id in input.inventory.first(where: { $0.id == id }) },
                selectionCriterion: input.criterion,
                claimLevel: selected == nil ? nil : (input.criterion == .measuredMinimumUsage ? .minimumSuppliedUsage : .boundedInference),
                rejection: reason,
                descriptorRejections: failures, hostDecision: decision, requestSHA256: input.requestSHA256,
                inventorySHA256: input.inventorySHA256, inputFingerprint: fingerprint, rawOutputSHA256: digest(rawOutput))
        }
        let inventoryIDs = input.inventory.map(\.id)
        guard !input.request.isEmpty, !fingerprint.isEmpty,
              input.inventory.count <= maximumInventoryCount,
              inventoryIDs.allSatisfy(validID), Set(inventoryIDs).count == inventoryIDs.count,
              input.eligibleCandidateIDs.allSatisfy(validID),
              Set(input.eligibleCandidateIDs).count == input.eligibleCandidateIDs.count,
              Set(input.eligibleCandidateIDs).isSubset(of: Set(inventoryIDs)) else { return result(.rejected, .invalidInput) }
        guard producedForFingerprint == fingerprint else { return result(.rejected, .producerBindingMismatch) }
        guard rawOutput.count <= maximumOutputBytes else { return result(.rejected, .oversizedOutput) }
        guard let chosen = parseClosedChoice(rawOutput) else { return result(.rejected, .invalidOutput) }
        preferred = chosen
        guard inventoryIDs.contains(chosen) else { return result(.rejected, .unknownCandidate) }
        guard input.eligibleCandidateIDs.contains(chosen) else { return result(.rejected, .ineligibleCandidate) }
        if let explicit = input.requirement.requestedCandidateID, chosen != explicit {
            return result(.rejected, .explicitRequestConflict)
        }
        var checked: [DynamicRouteAdmission.Candidate] = []
        for descriptor in input.inventory where input.eligibleCandidateIDs.contains(descriptor.id) {
            let reasons = descriptorIssues(descriptor, now: now)
            if !reasons.isEmpty { failures.append(.init(candidateID: descriptor.id, reasons: reasons)); continue }
            checked.append(descriptor.candidate)
        }
        // The existing gate independently checks actual transport, scope,
        // quality class/identity, availability, quota, cost, and explicit IDs.
        guard checked.contains(where: { $0.id == chosen }) else { return result(.held, .hostAdmissionRejected) }
        if input.criterion == .boundedQuotaPreference {
            // A separately declared criterion permits useful bounded inference
            // when comparative cost is unknown. It is not an exception to the
            // original measured-minimum contract. Force fresh observations for
            // this preference even if another caller's requirement was lax.
            var strict = input.requirement
            strict.requireFreshAvailability = true; strict.requireFreshQuota = true
            var individuallyAdmitted: [(candidate: DynamicRouteAdmission.Candidate, decision: DynamicRouteAdmission.Decision)] = []
            for candidate in checked {
                let verdict = DynamicRouteAdmission.verifyActualTransport(candidate: candidate, requirement: strict, now: now)
                if candidate.id == chosen { decision = verdict }
                if verdict.state == .selected { individuallyAdmitted.append((candidate, verdict)) }
            }
            guard let preferred = individuallyAdmitted.first(where: { $0.candidate.id == chosen }) else {
                return result(.held, .hostAdmissionRejected)
            }
            guard Set(individuallyAdmitted.compactMap { $0.candidate.quality?.state }).count == 1 else {
                return result(.held, .qualityClassConflict)
            }
            func comparableCost(_ candidate: DynamicRouteAdmission.Candidate) -> Double? {
                guard let cost = candidate.cost, cost.metric == strict.costMetric,
                      cost.observation.isFresh(at: now), cost.expectedUsage.isFinite, cost.expectedUsage >= 0 else { return nil }
                return cost.expectedUsage
            }
            if let preferredCost = comparableCost(preferred.candidate), individuallyAdmitted.contains(where: {
                $0.candidate.id != chosen && comparableCost($0.candidate).map { $0 < preferredCost } == true
            }) { return result(.rejected, .hostRankingConflict) }
            return result(.candidateAccepted, selected: chosen)
        }
        decision = DynamicRouteAdmission.evaluate(requirement: input.requirement, candidates: checked, now: now)
        guard let host = decision, host.state == .selected, let selected = host.selectedCandidateID else {
            return result(.held, .hostAdmissionHeld)
        }
        guard host.admittedCandidateIDs.contains(chosen) else { return result(.held, .hostAdmissionRejected) }
        guard selected == chosen else { return result(.rejected, .hostRankingConflict) }
        return result(.candidateAccepted, selected: chosen)
    }

    private static func descriptorIssues(_ value: Descriptor, now: Date) -> [String] {
        var reasons: [String] = []
        let candidate = value.candidate
        if value.accountID.isEmpty { reasons.append("account_identity_missing") }
        switch (value.logicalSurface, value.lane, candidate.transport) {
        case (nil, .local, .local): break
        case (.consumerChatGPT?, .consumerChat, .chatGPTService): break
        case (.codexAgent?, .agent, .codexAppServer), (.codexAgent?, .boundedChat, .codexAppServer): break
        case (.claudeAgent?, .agent, .claudeCLI): break
        case (.claudeChat?, .boundedChat, .claudeCLI), (.claudeChat?, .consumerChat, .claudeService): break
        default: reasons.append("logical_surface_transport_mismatch")
        }
        let provider = candidate.provider.lowercased()
        switch candidate.transport {
        case .local: if provider != "local" { reasons.append("provider_transport_mismatch") }
        case .codexAppServer: if provider != "codex" { reasons.append("provider_transport_mismatch") }
        case .chatGPTService: if provider != "openai" && provider != "chatgpt" { reasons.append("provider_transport_mismatch") }
        case .claudeCLI: if provider != "claude" { reasons.append("provider_transport_mismatch") }
        case .claudeService: if provider != "anthropic" && provider != "claude" { reasons.append("provider_transport_mismatch") }
        case .handoff: reasons.append("handoff_is_not_execution")
        }
        let observedPool = value.observedQuotaPool(at: now)
        if observedPool == .unknown { reasons.append("authentication_or_billing_unverified_or_not_included_subscription") }
        else if candidate.quotaPool != observedPool { reasons.append("observed_billing_quota_pool_mismatch") }
        if observedPool != .none && value.quotaAccountID != value.accountID { reasons.append("quota_account_binding_missing_or_mismatch") }
        return reasons
    }

    private static func validID(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 256 && value == value.trimmingCharacters(in: .whitespacesAndNewlines) &&
            value.rangeOfCharacter(from: .controlCharacters) == nil
    }
    private static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    private static func encodedDigest<T: Encodable>(_ value: T) -> String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .millisecondsSince1970
        encoder.nonConformingFloatEncodingStrategy = .convertToString(positiveInfinity: "Infinity", negativeInfinity: "-Infinity", nan: "NaN")
        return (try? encoder.encode(value)).map(digest) ?? ""
    }

    /// Parse exactly one string-valued property rather than accepting a JSON
    /// decoder's folded duplicate keys. No fence/header/extra-field repair.
    private static func parseClosedChoice(_ data: Data) -> String? {
        guard String(data: data, encoding: .utf8) != nil else { return nil }
        let bytes = Array(data)
        var index = 0
        func skip() { while index < bytes.count && [9, 10, 13, 32].contains(bytes[index]) { index += 1 } }
        func consume(_ byte: UInt8) -> Bool {
            skip(); guard index < bytes.count, bytes[index] == byte else { return false }; index += 1; return true
        }
        func string() -> String? {
            skip(); guard index < bytes.count, bytes[index] == 34 else { return nil }
            let start = index; index += 1
            while index < bytes.count {
                if bytes[index] == 92 { index += 2; continue }
                if bytes[index] == 34 {
                    index += 1
                    return try? JSONDecoder().decode(String.self, from: Data(bytes[start..<index]))
                }
                index += 1
            }
            return nil
        }
        guard consume(123), string() == "preferred_candidate_id", consume(58),
              let id = string(), validID(id), consume(125) else { return nil }
        skip(); return index == bytes.count ? id : nil
    }
}
