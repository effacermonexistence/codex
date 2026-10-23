import Foundation

/// Mechanical input preparation facts from this attempt's native adapter.
/// These are NOT token measurements, provider readbacks, calibrated features,
/// task-family labels, quality evidence, or permission to execute a model.
/// Unknown hidden/provider state remains explicit null on the wire.
public struct RCCConfiguredInputObservation: Codable, Equatable, Sendable {
    public static let kind = "native_configured_input_observation_v1"
    public static let renderer = "rcc_delegated_envelope_provider_prompt_native_channels_v1"
    public enum Failure: Error { case binding, time, channel, bounds, unsupported }
    public struct Bytes: Codable, Equatable, Sendable {
        public let sha256: String
        public let utf8Bytes: Int
        enum CodingKeys: String, CodingKey { case sha256, utf8Bytes = "utf8_bytes" }
        public init(_ text: String) throws {
            guard !text.isEmpty, !text.contains("\0"), text.utf8.count <= 8_388_608 else { throw Failure.bounds }
            sha256 = RCCRuntimeContract.digest(Data(text.utf8)); utf8Bytes = text.utf8.count
        }
    }
    public let schema: Int
    public let kind: String
    public let taskID: String, nodeID: String, attemptID: String, candidateID: String
    public let requestSHA256: String, sourceFingerprint: String, originalSourceFingerprint: String, policySHA256: String, policySourceSHA256: String
    public let configurationSHA256: String, selectedConfigSHA256: String
    public let rendererID: String, harnessSHA256: String, launchEntrySHA256: String
    public let catalogSHA256: String, catalogObservedAtMS: Int64, preparedAtMS: Int64
    public let catalogBasis: String, channel: String, sessionState: String
    public let delegatedInput: Bytes, providerInput: Bytes, instructions: Bytes, baseInstructions: Bytes?
    public let executionConfigurationSHA256: String
    public let executionConfigurationBasis: String, inputCoverage: String, nativeBinaryBasis: String
    public let captureState: String
    public let backendInclusionVerified: Bool, qualityCertified: Bool, executionAuthorized: Bool

    public init(ticket: RCCRuntimeContract.ExecutionTicket, delegatedInput: String, providerInput: String,
                instructions: String, baseInstructions: String?, channel: String, sessionState: String,
                harnessSHA256: String, launchEntrySHA256: String, executionConfigurationSHA256: String,
                catalogSHA256: String, catalogObservedAtMS: Int64, preparedAtMS: Int64) throws {
        try RCCRuntimeContract.validate(ticket)
        guard let original = ticket.originalRequest,
              RCCRuntimeContract.digest(Data(original.utf8)) == ticket.requestSHA256 else { throw Failure.binding }
        let provider = ticket.selectedConfig.transport
        guard (provider == .codexAppServer && channel == "codex_developer") ||
              (provider == .claudeCLI && channel == "claude_append_system") else { throw Failure.channel }
        guard ["new", "resumed"].contains(sessionState) else { throw Failure.unsupported }
        guard catalogObservedAtMS >= 0, preparedAtMS >= catalogObservedAtMS else { throw Failure.time }
        guard [harnessSHA256, launchEntrySHA256, executionConfigurationSHA256, catalogSHA256].allSatisfy(RCCRuntimeContract.isHash)
            else { throw Failure.binding }
        schema = 1; kind = Self.kind
        taskID = ticket.taskID; nodeID = ticket.nodeID; attemptID = ticket.attemptID; candidateID = ticket.candidateID
        requestSHA256 = ticket.requestSHA256; sourceFingerprint = ticket.sourceFingerprint
        originalSourceFingerprint = ticket.coreRouting?.originalSourceFingerprint ?? ticket.sourceFingerprint
        policySHA256 = ticket.policySHA256; policySourceSHA256 = ticket.policySourceSHA256
        configurationSHA256 = ticket.configurationSHA256
        selectedConfigSHA256 = RCCRuntimeContract.digest(try RCCRuntimeContract.encode(ticket.selectedConfig))
        rendererID = Self.renderer; self.harnessSHA256 = harnessSHA256; self.launchEntrySHA256 = launchEntrySHA256
        self.executionConfigurationSHA256 = executionConfigurationSHA256
        executionConfigurationBasis = channel == "codex_developer" ? "codex_app_server_overrides_only" : "claude_cli_final_arguments_only"
        inputCoverage = "os1_explicit_channels_only_provider_hidden_defaults_unobserved"
        nativeBinaryBasis = "backend_image_not_observed"
        self.catalogSHA256 = catalogSHA256; self.catalogObservedAtMS = catalogObservedAtMS; self.preparedAtMS = preparedAtMS
        catalogBasis = "selected_provider_inventory_before_authorization_not_core_candidate_catalog"
        self.channel = channel; self.sessionState = sessionState
        self.delegatedInput = try .init(delegatedInput); self.providerInput = try .init(providerInput)
        self.instructions = try .init(instructions); self.baseInstructions = try baseInstructions.map(Bytes.init)
        captureState = "prepared_before_native_turn"
        backendInclusionVerified = false; qualityCertified = false; executionAuthorized = false
    }

    public func validate(ticket: RCCRuntimeContract.ExecutionTicket? = nil, record: RCCRuntimeContract.ExecutionRecord? = nil) throws {
        guard schema == 1, kind == Self.kind, rendererID == Self.renderer,
              inputCoverage == "os1_explicit_channels_only_provider_hidden_defaults_unobserved",
              nativeBinaryBasis == "backend_image_not_observed",
              executionConfigurationBasis == (channel == "codex_developer" ? "codex_app_server_overrides_only" : "claude_cli_final_arguments_only"),
              captureState == "prepared_before_native_turn", !backendInclusionVerified, !qualityCertified, !executionAuthorized,
              catalogBasis == "selected_provider_inventory_before_authorization_not_core_candidate_catalog",
              [requestSHA256, sourceFingerprint, originalSourceFingerprint, policySHA256, policySourceSHA256, configurationSHA256, selectedConfigSHA256,
               harnessSHA256, launchEntrySHA256, executionConfigurationSHA256, catalogSHA256].allSatisfy(RCCRuntimeContract.isHash),
              catalogObservedAtMS >= 0, preparedAtMS >= catalogObservedAtMS,
              ["new", "resumed"].contains(sessionState),
              ["codex_developer", "claude_append_system"].contains(channel) else { throw Failure.binding }
        for bytes in [delegatedInput, providerInput, instructions] + (baseInstructions.map { [$0] } ?? []) {
            guard RCCRuntimeContract.isHash(bytes.sha256), bytes.utf8Bytes > 0, bytes.utf8Bytes <= 8_388_608 else { throw Failure.bounds }
        }
        if let ticket {
            guard taskID == ticket.taskID, nodeID == ticket.nodeID, attemptID == ticket.attemptID, candidateID == ticket.candidateID,
                  requestSHA256 == ticket.requestSHA256, sourceFingerprint == ticket.sourceFingerprint,
                  originalSourceFingerprint == (ticket.coreRouting?.originalSourceFingerprint ?? ticket.sourceFingerprint),
                  policySHA256 == ticket.policySHA256, policySourceSHA256 == ticket.policySourceSHA256,
                  configurationSHA256 == ticket.configurationSHA256,
                  selectedConfigSHA256 == RCCRuntimeContract.digest(try RCCRuntimeContract.encode(ticket.selectedConfig)) else { throw Failure.binding }
        }
        if let record {
            guard taskID == record.taskID, nodeID == record.nodeID, attemptID == record.attemptID, candidateID == record.candidateID,
                  configurationSHA256 == record.configurationSHA256,
                  selectedConfigSHA256 == RCCRuntimeContract.digest(try RCCRuntimeContract.encode(record.selectedConfig)),
                  channel == (record.selectedConfig.transport == .codexAppServer ? "codex_developer" :
                    record.selectedConfig.transport == .claudeCLI ? "claude_append_system" : "unsupported") else { throw Failure.binding }
        }
    }

    enum CodingKeys: String, CodingKey {
        case schema, kind, channel, instructions
        case taskID = "task_id", nodeID = "node_id", attemptID = "attempt_id", candidateID = "candidate_id"
        case requestSHA256 = "request_sha256", sourceFingerprint = "source_fingerprint", originalSourceFingerprint = "original_source_fingerprint", policySHA256 = "policy_sha256", policySourceSHA256 = "policy_source_sha256"
        case configurationSHA256 = "configuration_sha256", selectedConfigSHA256 = "selected_config_sha256"
        case rendererID = "renderer_id", harnessSHA256 = "harness_sha256", launchEntrySHA256 = "launch_entry_sha256", nativeBinarySHA256 = "native_binary_sha256", nativeBinaryBasis = "native_binary_basis"
        case catalogSHA256 = "catalog_sha256", catalogObservedAtMS = "catalog_observed_at_ms", preparedAtMS = "prepared_at_ms", catalogBasis = "catalog_basis"
        case delegatedInput = "delegated_input", providerInput = "provider_input", baseInstructions = "base_instructions", sessionState = "session_state"
        case executionConfigurationSHA256 = "execution_configuration_sha256", executionConfigurationBasis = "execution_configuration_basis", inputCoverage = "input_coverage", captureState = "capture_state"
        case backendInclusionVerified = "backend_inclusion_verified", qualityCertified = "quality_certified", executionAuthorized = "execution_authorized"
        case tokenizerID = "tokenizer_id", inputTokens = "input_tokens", contextWindowTokens = "context_window_tokens"
        case family = "family", capacityUpperBound = "capacity_upper_bound"
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        for k in [CodingKeys.tokenizerID, .inputTokens, .contextWindowTokens, .family, .capacityUpperBound, .nativeBinarySHA256] {
            guard c.contains(k), try c.decodeNil(forKey: k) else { throw Failure.unsupported }
        }
        schema = try c.decode(Int.self, forKey: .schema); kind = try c.decode(String.self, forKey: .kind)
        taskID = try c.decode(String.self, forKey: .taskID); nodeID = try c.decode(String.self, forKey: .nodeID)
        attemptID = try c.decode(String.self, forKey: .attemptID); candidateID = try c.decode(String.self, forKey: .candidateID)
        requestSHA256 = try c.decode(String.self, forKey: .requestSHA256); sourceFingerprint = try c.decode(String.self, forKey: .sourceFingerprint)
        originalSourceFingerprint = try c.decode(String.self, forKey: .originalSourceFingerprint)
        policySHA256 = try c.decode(String.self, forKey: .policySHA256); policySourceSHA256 = try c.decode(String.self, forKey: .policySourceSHA256)
        configurationSHA256 = try c.decode(String.self, forKey: .configurationSHA256); selectedConfigSHA256 = try c.decode(String.self, forKey: .selectedConfigSHA256)
        rendererID = try c.decode(String.self, forKey: .rendererID); harnessSHA256 = try c.decode(String.self, forKey: .harnessSHA256)
        launchEntrySHA256 = try c.decode(String.self, forKey: .launchEntrySHA256); catalogSHA256 = try c.decode(String.self, forKey: .catalogSHA256)
        catalogObservedAtMS = try c.decode(Int64.self, forKey: .catalogObservedAtMS); preparedAtMS = try c.decode(Int64.self, forKey: .preparedAtMS)
        catalogBasis = try c.decode(String.self, forKey: .catalogBasis); channel = try c.decode(String.self, forKey: .channel)
        sessionState = try c.decode(String.self, forKey: .sessionState); delegatedInput = try c.decode(Bytes.self, forKey: .delegatedInput)
        providerInput = try c.decode(Bytes.self, forKey: .providerInput); instructions = try c.decode(Bytes.self, forKey: .instructions)
        baseInstructions = try c.decodeIfPresent(Bytes.self, forKey: .baseInstructions)
        executionConfigurationSHA256 = try c.decode(String.self, forKey: .executionConfigurationSHA256)
        nativeBinaryBasis = try c.decode(String.self, forKey: .nativeBinaryBasis)
        executionConfigurationBasis = try c.decode(String.self, forKey: .executionConfigurationBasis); inputCoverage = try c.decode(String.self, forKey: .inputCoverage)
        captureState = try c.decode(String.self, forKey: .captureState)
        backendInclusionVerified = try c.decode(Bool.self, forKey: .backendInclusionVerified)
        qualityCertified = try c.decode(Bool.self, forKey: .qualityCertified); executionAuthorized = try c.decode(Bool.self, forKey: .executionAuthorized)
        try validate()
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(schema, forKey: .schema); try c.encode(kind, forKey: .kind)
        for (key, value) in [(CodingKeys.taskID, taskID), (.nodeID, nodeID), (.attemptID, attemptID), (.candidateID, candidateID),
            (.requestSHA256, requestSHA256), (.sourceFingerprint, sourceFingerprint), (.originalSourceFingerprint, originalSourceFingerprint), (.policySHA256, policySHA256), (.policySourceSHA256, policySourceSHA256),
            (.configurationSHA256, configurationSHA256), (.selectedConfigSHA256, selectedConfigSHA256), (.rendererID, rendererID),
            (.harnessSHA256, harnessSHA256), (.launchEntrySHA256, launchEntrySHA256), (.nativeBinaryBasis, nativeBinaryBasis), (.catalogSHA256, catalogSHA256),
            (.catalogBasis, catalogBasis), (.channel, channel), (.sessionState, sessionState),
            (.executionConfigurationSHA256, executionConfigurationSHA256), (.executionConfigurationBasis, executionConfigurationBasis), (.inputCoverage, inputCoverage), (.captureState, captureState)] { try c.encode(value, forKey: key) }
        try c.encode(catalogObservedAtMS, forKey: .catalogObservedAtMS); try c.encode(preparedAtMS, forKey: .preparedAtMS)
        try c.encode(delegatedInput, forKey: .delegatedInput); try c.encode(providerInput, forKey: .providerInput)
        try c.encode(instructions, forKey: .instructions); try c.encode(baseInstructions, forKey: .baseInstructions)
        try c.encode(false, forKey: .backendInclusionVerified); try c.encode(false, forKey: .qualityCertified); try c.encode(false, forKey: .executionAuthorized)
        for key in [CodingKeys.tokenizerID, .inputTokens, .contextWindowTokens, .family, .capacityUpperBound, .nativeBinarySHA256] { try c.encodeNil(forKey: key) }
    }
}
