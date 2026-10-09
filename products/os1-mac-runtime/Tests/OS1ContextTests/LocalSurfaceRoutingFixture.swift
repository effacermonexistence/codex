import Foundation
import OS1Context

/// Host contract fixtures, not model accuracy, measured costs or parity proof.
/// Every observation is fixture-only; no provider/model/native calls occur.
func runLocalSurfaceRoutingFixtures() throws {
    typealias Surface = LocalSurfaceRouting
    typealias Gate = DynamicRouteAdmission
    var checks = 0
    func check(_ passed: Bool, _ message: String) throws {
        guard passed else { throw NSError(domain: "LocalSurfaceRoutingFixture", code: 1,
            userInfo: [NSLocalizedDescriptionKey: message]) }
        checks += 1
    }
    let now = Date(timeIntervalSince1970: 10_000)
    let observation = Gate.Observation(receiptID: "fixture-not-production", observedAt: now.addingTimeInterval(-1),
                                       validUntil: now.addingTimeInterval(60))
    let old = Gate.Observation(receiptID: "fixture-expired", observedAt: now.addingTimeInterval(-100),
                              validUntil: now.addingTimeInterval(-1))
    let requirement = Gate.Requirement(id: "fixture-request", requiredCapabilities: ["answer"],
        trustedAuthorityIDs: ["fixture-authority"], qualificationKey: "fixture-known-family",
        acceptedQualityStates: [.policyAdmitted], requireFreshAvailability: true,
        requireFreshQuota: true, costMetric: "fixture-estimated-tokens")
    func descriptor(_ id: String, _ surface: Surface.LogicalSurface?, _ lane: Surface.Lane,
                    _ transport: Gate.Transport, _ provider: String, _ pool: Gate.QuotaPool,
                    account: String, usage: Double) -> Surface.Descriptor {
        let config = "fixture-config-" + id
        return .init(logicalSurface: surface, lane: lane, accountID: account, quotaAccountID: account,
            authentication: .init(mode: transport == .local ? .local : .subscription, accountID: account, observation: observation),
            billing: .init(mode: transport == .local ? .localCompute : .includedSubscription, accountID: account, observation: observation),
            candidate: .init(id: id, provider: provider, transport: transport, quotaPool: pool,
                configurationID: config, effort: "opaque", capabilities: ["answer"], authorityID: "fixture-authority",
                availability: .init(state: .available, observation: observation),
                quota: .init(remainingFraction: 0.7, observation: observation),
                quality: .init(state: transport == .local ? .exactDomainVerified : .policyAdmitted,
                    qualificationKey: "fixture-known-family", configurationID: config,
                    authorityID: "fixture-authority", observation: observation),
                cost: .init(metric: "fixture-estimated-tokens", expectedUsage: usage,
                    expectedLatencySeconds: 1, observation: observation)))
    }
    let chatGPT = descriptor("chatgpt-real", .consumerChatGPT, .consumerChat, .chatGPTService, "openai", .openAIChat,
                             account: "openai-account-fixture", usage: 1)
    let codex = descriptor("codex-real", .codexAgent, .agent, .codexAppServer, "codex", .openAICodex,
                           account: "openai-account-fixture", usage: 2)
    let claudeChat = descriptor("claude-chat-real", .claudeChat, .consumerChat, .claudeService, "anthropic", .anthropicShared,
                                account: "claude-account-fixture", usage: 3)
    let claudeCode = descriptor("claude-code-real", .claudeAgent, .agent, .claudeCLI, "claude", .anthropicShared,
                                account: "claude-account-fixture", usage: 4)
    let inventory = [chatGPT, codex, claudeChat, claudeCode]
    func input(_ items: [Surface.Descriptor] = inventory, eligible: [String]? = nil,
               request: String = "Explain the supplied text", requirement: Gate.Requirement = requirement,
               criterion: Surface.Criterion = .measuredMinimumUsage) -> Surface.Input {
        .init(request: request, inventory: items, eligibleCandidateIDs: eligible ?? items.map(\.id), requirement: requirement, criterion: criterion)
    }
    func choice(_ id: String) throws -> Data {
        try JSONSerialization.data(withJSONObject: ["preferred_candidate_id": id], options: [.sortedKeys])
    }
    func admit(_ id: String, _ bound: Surface.Input = input(), fingerprint: String? = nil) throws -> Surface.Admission {
        Surface.admit(rawOutput: try choice(id), producedForFingerprint: fingerprint ?? bound.fingerprint, for: bound, now: now)
    }
    func replace(_ row: Surface.Descriptor, candidate: Gate.Candidate? = nil,
                 authentication: Surface.AuthenticationObservation? = nil, billing: Surface.BillingObservation? = nil,
                 replaceAuth: Bool = false, replaceBilling: Bool = false,
                 surface: Surface.LogicalSurface? = nil, lane: Surface.Lane? = nil,
                 account: String? = nil, quotaAccountID: String? = nil, replaceQuotaAccount: Bool = false) -> Surface.Descriptor {
        .init(logicalSurface: surface ?? row.logicalSurface, lane: lane ?? row.lane, accountID: account ?? row.accountID,
            quotaAccountID: replaceQuotaAccount ? quotaAccountID : row.quotaAccountID,
            authentication: replaceAuth ? authentication : row.authentication,
            billing: replaceBilling ? billing : row.billing, candidate: candidate ?? row.candidate)
    }
    let adopted = try admit(chatGPT.id)
    try check(adopted.state == .candidateAccepted && adopted.selectedCandidateID == chatGPT.id,
              "local choice must agree with independently admitted host minimum")
    try check(adopted.hostDecision?.executionQuality == .unverified && adopted.hostDecision?.admissionQuality == .policyAdmitted,
              "route admission is not output/reference proof")
    try check(adopted.rawOutputSHA256.count == 64 && adopted.requestSHA256.count == 64 && adopted.inventorySHA256.count == 64,
              "receipt binds raw output, exact request and full inventory")
    let encoded = try JSONEncoder().encode(adopted)
    try check(try JSONDecoder().decode(Surface.Admission.self, from: encoded) == adopted, "receipt round trip")
    try check(try admit(codex.id).rejection == .hostRankingConflict, "model cannot override lower host-admitted cost")
    try check(try admit("fabricated").rejection == .unknownCandidate, "unknown target cannot become availability")
    try check(try admit(chatGPT.id, input(eligible: [codex.id])).rejection == .ineligibleCandidate,
              "only host-provided eligibility IDs")
    try check(try admit(chatGPT.id, fingerprint: "different-producer-input").rejection == .producerBindingMismatch,
              "response cannot transfer across request/inventory bindings")
    let changedRequest = input(request: "Execute a command instead")
    try check(try admit(chatGPT.id, changedRequest, fingerprint: input().fingerprint).rejection == .producerBindingMismatch,
              "original objective change invalidates proposal")
    var changedQuota = chatGPT.candidate; changedQuota.quota?.remainingFraction = 0.5
    let changedInventory = input([replace(chatGPT, candidate: changedQuota), codex])
    try check(try admit(chatGPT.id, changedInventory, fingerprint: input().fingerprint).rejection == .producerBindingMismatch,
              "inventory/quota change invalidates proposal")
    var explicit = requirement; explicit.requestedCandidateID = codex.id
    let explicitInput = input(requirement: explicit)
    try check(try admit(chatGPT.id, explicitInput).rejection == .explicitRequestConflict,
              "explicit owner target is not replaced by cheaper choice")
    try check(try admit(codex.id, explicitInput).state == .candidateAccepted, "explicit available target preserved")
    var unavailable = chatGPT.candidate; unavailable.availability = .init(state: .unavailable, observation: observation)
    let absentChatGPT = input([replace(chatGPT, candidate: unavailable), codex])
    let blocked = try admit(chatGPT.id, absentChatGPT)
    try check(blocked.state == .held && blocked.selectedCandidateID == nil,
              "unavailable ChatGPT never silently becomes Codex")
    var explicitChatGPT = requirement; explicitChatGPT.requestedCandidateID = chatGPT.id
    try check(try admit(codex.id, input([codex], requirement: explicitChatGPT)).rejection == .explicitRequestConflict,
              "missing explicit ChatGPT target cannot authorize another provider")
    try check(try admit(chatGPT.id, input([codex], requirement: explicitChatGPT)).selectedCandidateID == nil,
              "missing ChatGPT remains missing")

    try check(chatGPT.observedQuotaPool(at: now) == .openAIChat && codex.observedQuotaPool(at: now) == .openAICodex,
              "ordinary ChatGPT and Codex have distinct observed subscription pools")
    try check(claudeChat.observedQuotaPool(at: now) == .anthropicShared && claudeCode.observedQuotaPool(at: now) == .anthropicShared,
              "Claude chat/Code same-account subscription shares pool")
    try check(claudeChat.budgetKey(at: now) == claudeCode.budgetKey(at: now), "shared account pool identity")
    let otherClaude = replace(claudeChat, authentication: .init(mode: .subscription, accountID: "other-account", observation: observation),
        billing: .init(mode: .includedSubscription, accountID: "other-account", observation: observation),
        replaceAuth: true, replaceBilling: true, account: "other-account")
    try check(otherClaude.budgetKey(at: now) != claudeCode.budgetKey(at: now), "different accounts cannot merge budgets")
    let nativeGPTChat = descriptor("native-gpt-chat", .codexAgent, .boundedChat, .codexAppServer, "codex", .openAICodex,
                                   account: "openai-account-fixture", usage: 1)
    try check(nativeGPTChat.observedQuotaPool(at: now) == .openAICodex, "native GPT chat still spends Codex pool")
    try check(try admit(nativeGPTChat.id, input([nativeGPTChat])).state == .candidateAccepted,
              "truthfully named bounded Codex lane admitted")
    let falseConsumer = replace(nativeGPTChat, surface: .consumerChatGPT, lane: .consumerChat)
    try check(try admit(falseConsumer.id, input([falseConsumer])).descriptorRejections.first?.reasons.contains("logical_surface_transport_mismatch") == true,
              "native GPT lane cannot masquerade as consumer ChatGPT")
    var wrongPool = codex.candidate; wrongPool.quotaPool = .none
    try check(try admit(codex.id, input([replace(codex, candidate: wrongPool)])).state == .held,
              "coding transport cannot become free")
    wrongPool.quotaPool = .openAIChat
    try check(try admit(codex.id, input([replace(codex, candidate: wrongPool)])).state == .held,
              "Codex cannot use ordinary ChatGPT pool by label")
    for row in [
        replace(codex, replaceAuth: true),
        replace(codex, replaceBilling: true),
        replace(codex, authentication: .init(mode: .unknown, accountID: codex.accountID, observation: observation), replaceAuth: true),
        replace(codex, authentication: .init(mode: .subscription, accountID: codex.accountID, observation: old), replaceAuth: true),
        replace(codex, billing: .init(mode: .includedSubscription, accountID: codex.accountID, observation: old), replaceBilling: true),
        replace(codex, billing: .init(mode: .includedSubscription, accountID: "other-account", observation: observation), replaceBilling: true)
    ] {
        try check(row.observedQuotaPool(at: now) == .unknown && (try admit(row.id, input([row]))).state == .held,
                  "unknown/stale/cross-account authentication or billing held, not free")
    }
    for mode: Surface.BillingMode in [.paidCredits, .apiPayAsYouGo, .cloudPayAsYouGo, .unknown] {
        let row = replace(claudeCode, billing: .init(mode: mode, accountID: claudeCode.accountID, observation: observation), replaceBilling: true)
        try check(row.observedQuotaPool(at: now) == .unknown && (try admit(row.id, input([row]))).state == .held,
                  "different/unknown billing is not fabricated included subscription")
    }
    let apiKey = replace(claudeCode, authentication: .init(mode: .apiKey, accountID: claudeCode.accountID, observation: observation), replaceAuth: true)
    try check(try admit(apiKey.id, input([apiKey])).state == .held, "API auth cannot consume asserted subscription pool")

    let local = descriptor("local-exact", nil, .local, .local, "local", .none, account: "local-host", usage: 0)
    var exactRequirement = requirement; exactRequirement.acceptedQualityStates = [.exactDomainVerified]
    try check(local.observedQuotaPool(at: now) == .none, "local compute is no hosted quota, not a fourth hosted pool")
    try check(try admit(local.id, input([local], requirement: exactRequirement)).state == .candidateAccepted,
              "exact bounded local executor can pass existing host verifier")
    var unverifiedLocal = local.candidate; unverifiedLocal.quality?.state = .policyAdmitted
    try check(try admit(local.id, input([replace(local, candidate: unverifiedLocal)])).state == .held,
              "generic local LLM output is not exact-domain local execution")
    var unknownQuality = codex.candidate; unknownQuality.quality?.qualificationKey = "unknown-family"
    try check(try admit(codex.id, input([replace(codex, candidate: unknownQuality)])).state == .held,
              "unknown reference family cannot inherit quality qualification")
    var exhausted = codex.candidate; exhausted.quota?.remainingFraction = 0
    try check(try admit(codex.id, input([replace(codex, candidate: exhausted)])).state == .held,
              "fresh exhausted quota blocks local preference")
    var stale = codex.candidate; stale.quota?.observation = old
    try check(try admit(codex.id, input([replace(codex, candidate: stale)])).state == .held,
              "stale headroom cannot masquerade as available")
    var tools = requirement; tools.requiredCapabilities.append("write")
    try check(try admit(chatGPT.id, input(requirement: tools)).state == .held,
              "answer-only surface cannot acquire required execution capability")
    var incomparable = codex.candidate; incomparable.cost = nil
    try check(try admit(chatGPT.id, input([chatGPT, replace(codex, candidate: incomparable)])).state == .held,
              "no invented cheapest ranking from missing cost")
    var noChatCost = chatGPT.candidate; noChatCost.cost = nil
    let unknownCosts = [replace(chatGPT, candidate: noChatCost), replace(codex, candidate: incomparable)]
    let boundedInput = input(unknownCosts, criterion: .boundedQuotaPreference)
    let bounded = try admit(codex.id, boundedInput)
    try check(bounded.state == .candidateAccepted && bounded.selectedCandidateID == codex.id &&
              bounded.claimLevel == .boundedInference && bounded.selectionCriterion == .boundedQuotaPreference,
              "explicit bounded criterion can adopt equal-quality eligible preference under unknown cost")
    try check(bounded.selectedDescriptor?.id == codex.id && bounded.preferredDescriptor?.id == codex.id,
              "actual admitted descriptor travels with preferred/selected ID")
    try check(bounded.hostDecision?.executionQuality == .unverified,
              "bounded selection cannot become parity or output proof")
    try check(try admit(codex.id, input(unknownCosts)).state == .held,
              "old measured-minimum criterion stays held on the same unknown costs")
    try check(input(unknownCosts).fingerprint != boundedInput.fingerprint,
              "explicit criterion transition changes producer binding")
    try check(try admit(codex.id, input(criterion: .boundedQuotaPreference)).rejection == .hostRankingConflict,
              "bounded inference cannot override authoritative known lower comparable usage")
    let missingAuth = replace(codex, replaceAuth: true)
    try check(try admit(codex.id, input([missingAuth], criterion: .boundedQuotaPreference)).state == .held,
              "bounded inference still requires actual authentication")
    try check(try admit(apiKey.id, input([apiKey], criterion: .boundedQuotaPreference)).state == .held,
              "API shadow cannot become included subscription under bounded criterion")
    for quotaAccount in [nil, "other-account"] as [String?] {
        let wrongAccount = replace(codex, quotaAccountID: quotaAccount, replaceQuotaAccount: true)
        try check(try admit(codex.id, input([wrongAccount], criterion: .boundedQuotaPreference)).state == .held,
                  "actual quota source must bind the selected account")
    }
    try check(try admit(codex.id, input([replace(codex, candidate: stale)], criterion: .boundedQuotaPreference)).state == .held,
              "bounded preference cannot adopt stale quota")
    var forbidPool = requirement; forbidPool.forbiddenQuotaPools = [.openAICodex]
    try check(try admit(codex.id, input([codex], requirement: forbidPool, criterion: .boundedQuotaPreference)).state == .held,
              "explicit forbidden pool retained across bounded preference")
    try check(try admit(chatGPT.id, input(unknownCosts, requirement: explicit, criterion: .boundedQuotaPreference)).rejection == .explicitRequestConflict,
              "bounded inference preserves explicit requested ID")
    var stronger = codex.candidate; stronger.quality?.state = .referenceEquivalent
    var multipleQualityStates = requirement; multipleQualityStates.acceptedQualityStates = [.policyAdmitted, .referenceEquivalent]
    try check(try admit(chatGPT.id, input([chatGPT, replace(codex, candidate: stronger)], requirement: multipleQualityStates,
                                       criterion: .boundedQuotaPreference)).rejection == .qualityClassConflict,
              "unlike quality classes cannot be silently compared")
    let duplicateInput = input([codex, codex])
    try check(try admit(codex.id, duplicateInput).rejection == .invalidInput, "duplicate inventory identity rejected")
    try check(try admit(codex.id, input([codex], eligible: [codex.id, codex.id])).rejection == .invalidInput,
              "duplicate eligibility identity rejected")
    try check(try admit(codex.id, input([codex], eligible: ["made-up"])).rejection == .invalidInput,
              "eligibility cannot create an inventory node")
    for raw in [
        "{}", "[]", "null", "{\"preferred_candidate_id\":true}",
        "{\"preferred_candidate_id\":\"chatgpt-real\",\"model\":\"best\"}",
        "{\"preferred_candidate_id\":\"codex-real\",\"preferred_candidate_id\":\"chatgpt-real\"}",
        "{\"preferred_candidate_id\":\"codex-real\",\"\\u0070referred_candidate_id\":\"chatgpt-real\"}",
        "```json\n{\"preferred_candidate_id\":\"chatgpt-real\"}\n```", "Ben.\nLuaIsHere :3\n{}",
        "{\"preferred_candidate_id\":\"chatgpt-real\"}{}", "{\"preferred_candidate_id\":\" chatgpt-real\"}",
        "{\"preferred_candidate_id\":\"\"}", "{\"preferred_candidate_id\":\"bad\\nname\"}"
    ] {
        let bad = Surface.admit(rawOutput: Data(raw.utf8), producedForFingerprint: input().fingerprint, for: input(), now: now)
        try check(bad.rejection == .invalidOutput && bad.selectedCandidateID == nil, "closed preferred-ID document: " + raw)
    }
    let escaped = Data("{\"\\u0070referred_candidate_id\":\"chatgpt-real\"}".utf8)
    try check(Surface.admit(rawOutput: escaped, producedForFingerprint: input().fingerprint, for: input(), now: now).state == .candidateAccepted,
              "valid JSON key escaping does not change the schema")
    try check(Surface.admit(rawOutput: Data([0xff]), producedForFingerprint: input().fingerprint, for: input(), now: now).rejection == .invalidOutput,
              "invalid UTF-8 rejected")
    try check(Surface.admit(rawOutput: Data(repeating: 65, count: Surface.maximumOutputBytes + 1), producedForFingerprint: input().fingerprint, for: input(), now: now).rejection == .oversizedOutput,
              "local choice output budget")
    print("Local surface routing: \(checks) checks PASS; closed IDs, original/inventory binding, actual transport/account/billing pools and host admission; model calls 0")
}
