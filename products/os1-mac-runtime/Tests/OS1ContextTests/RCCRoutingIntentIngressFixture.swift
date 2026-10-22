import Foundation
import OS1Context

/// Pure host ingress checks: no metadata probe, native provider or Core call.
func runRCCRoutingIntentIngressFixtures() throws {
    typealias C = RCCRuntimeContract
    typealias I = RCCRoutingIntentIngress
    func check(_ value: Bool, _ reason: String) throws {
        guard value else { throw NSError(domain: "RCCRoutingIntentIngressFixture", code: 1,
                                         userInfo: [NSLocalizedDescriptionKey: reason]) }
    }
    func rejects(_ expected: I.Failure, _ work: () throws -> Void) throws {
        do { try work(); throw NSError(domain: "RCCRoutingIntentIngressFixture", code: 2) }
        catch let error as I.Failure { try check(error == expected, "wrong refusal: \(error)") }
    }
    let version = C.RoutingIntentV2.version
    try check(try I.acceptCLIOption(version, previous: nil) == version, "typed CLI version is accepted exactly")
    try rejects(.duplicateOption) { _ = try I.acceptCLIOption(version, previous: version) }
    try rejects(.unsupportedVersion) { _ = try I.acceptCLIOption("future-v9", previous: nil) }
    try check(I.enableRoutingIntentV2, "reviewed host adoption is compiled into this source version")
    try check(I.versionForNewSubmission(provider: "auto", request: "Explain this function") == version,
              "new configured-Auto receives the adopted typed version")
    try check(I.versionForNewSubmission(provider: "auto", request: "Explain this function", hostEnabled: false) == nil,
              "disabled host capability still cannot be enabled by request wording")
    try check(I.versionForNewSubmission(provider: "auto", request: "Explain this function", hostEnabled: true) == version,
              "only a reviewed host switch stamps a new Auto")
    try check(I.versionForNewSubmission(provider: "codex", request: "Explain this function", hostEnabled: true) == nil,
              "explicit provider does not receive an Auto marker")
    for request in ["Codex로 이 함수 설명해줘", "Claude로 이 함수 설명해줘"] {
        try check(I.versionForNewSubmission(provider: "auto", request: request, hostEnabled: true) == version,
                  "bare provider stays a typed v2 request on configured Auto")
    }
    for request in ["1+1 Codex한테. 2+2 Claude Code한테.", "다 라우팅 해봐. 1+1", "로컬한테 1+1 시켜봐"] {
        try check(I.versionForNewSubmission(provider: "auto", request: request, hostEnabled: true) == nil,
                  "fanout, route-all and local requests remain unmarked legacy paths: " + request)
    }
    try I.validate(nil, mode: .auto, hostEnabled: false)
    try I.validate(nil, mode: .auto, hostEnabled: true)
    try rejects(.hostCapabilityDisabled) { try I.validate(version, mode: .auto, hostEnabled: false) }
    try rejects(.unsupportedVersion) { try I.validate("future-v9", mode: .auto, hostEnabled: true) }
    try rejects(.nonAutoTask) { try I.validate(version, mode: .explicitRoutingTest, hostEnabled: true) }
    try rejects(.nonAutoTask) { try I.validate(version, mode: .auto, provider: "codex", hostEnabled: true) }
    try rejects(.recoveryOrChildTask) {
        try I.validate(version, mode: .auto, provider: "auto", recoveryOrChild: true, hostEnabled: true)
    }

    let requestText = "Codex로 이 함수 설명해줘"
    let requestHash = C.digest(Data(requestText.utf8))
    var task = C.Request(taskID: "ingress-fixture", request: requestText, requestSHA256: requestHash,
        objective: requestText, policySHA256: String(repeating: "a", count: 64),
        sourceFingerprint: String(repeating: "b", count: 64), mode: .auto, materialRefs: [],
        budget: .init(maxAttempts: 2, maxParallel: 4, maxCostUnits: nil, maxDurationMS: 60_000))
    let legacyBytes = try C.encode(task)
    try check(!(String(decoding: legacyBytes, as: UTF8.self)).contains("routing_intent_policy_version"),
              "legacy wire must retain omitted marker")
    task.routingIntentPolicyVersion = version
    let decoded = try C.decodeRequest(C.encode(task))
    try check(decoded.routingIntentPolicyVersion == version && decoded.taskID == task.taskID &&
              decoded.requestSHA256 == requestHash && decoded.sourceFingerprint == task.sourceFingerprint &&
              decoded.policySHA256 == task.policySHA256, "marker must not mutate immutable task binding")
    var sameV2Retry = decoded
    try I.bindRequest(&sameV2Retry, version: version, provider: "auto", hostEnabled: true)
    try check(try C.encode(sameV2Retry) == C.encode(decoded),
              "same task ID and marker replay byte-identically, including read-only tasks")
    var sameLegacyRetry = task
    sameLegacyRetry.routingIntentPolicyVersion = nil
    try I.bindRequest(&sameLegacyRetry, version: nil, provider: "auto", hostEnabled: true)
    try check(try C.encode(sameLegacyRetry) == legacyBytes,
              "same old task ID cannot be upgraded by a later host capability")

    func input() -> RCCNativeCatalogBuilder.Input {
        .init(taskID: task.taskID, requestSHA256: requestHash, request: requestText,
              providerPreference: "auto", requireReadOnly: false, hasMaterialRefs: false,
              capacityPlan: nil, executorContractSHA256: String(repeating: "c", count: 64),
              now: Date(timeIntervalSince1970: 1_790_000_000), showCodex: true,
              chatLaneEligible: false, profiles: [.init(action: "readonly", provider: "codex",
                                                         model: "gpt-6-sol", effort: "low")])
    }
    var legacyInput = input()
    var oldTask = task; oldTask.routingIntentPolicyVersion = nil
    try I.bindCatalog(&legacyInput, request: oldTask, hostEnabled: true)
    try check(legacyInput.routingIntentPolicyVersion == nil && legacyInput.enableRoutingIntentV2,
              "capability alone leaves an old task on legacy intent")
    var blocked = input()
    try rejects(.hostCapabilityDisabled) { try I.bindCatalog(&blocked, request: decoded, hostEnabled: false) }
    try check(blocked.routingIntentPolicyVersion == nil && !blocked.enableRoutingIntentV2,
              "disabled host refuses before catalog mutation or provider probe")
    var adopted = input()
    adopted.requireReadOnly = true // ordinary task permission, not recovery provenance
    try I.bindCatalog(&adopted, request: decoded, hostEnabled: true)
    try check(adopted.routingIntentPolicyVersion == version && adopted.enableRoutingIntentV2 &&
              adopted.taskID == decoded.taskID && adopted.requestSHA256 == decoded.requestSHA256,
              "native catalog receives exact marker and independent host capability")
    try check(adopted.requireReadOnly && adopted.routingIntentPolicyVersion == version,
              "fresh read-only Auto remains eligible for v2 without weakening permission scope")
    try check(RCCNativeCatalogBuilder.providersToProbe(adopted) == ["codex"],
              "fake supported provider is probed only for an accepted v2 task")
    print("RCC routing intent host ingress: typed and same-task retry checks OK; provider/model calls 0")
}
