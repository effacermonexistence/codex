import Foundation
import OS1Context

/// Pure schema compatibility and observed-invocation fixtures. Browser receipt
/// file custody and live transport execution are separate App/runtime checks.
func runRouteFanoutBrowserRecordFixtures() throws {
    var count = 0
    func check(_ passed: Bool, _ label: String) throws {
        guard passed else { throw NSError(domain: "RouteFanoutBrowserRecordFixture", code: 1,
            userInfo: [NSLocalizedDescriptionKey: label]) }
        count += 1
    }
    let requestHash = String(repeating: "a", count: 64), resultHash = String(repeating: "b", count: 64)
    let projectionHash = String(repeating: "c", count: 64)
    let browser = RouteFanoutBrowserRecordEvidence(requestSHA256: requestHash, responseSHA256: resultHash,
        conversationURL: "https://chatgpt.com/c/browser-fixture-1", receiptPath: "/fixture/browser/receipt.json",
        policyProjectionSHA256: projectionHash)
    func record(state: RouteFanoutBrowserRecordEvidence.State = .returned, request: String = requestHash,
                response: String = resultHash, url: String = "https://chatgpt.com/c/browser-fixture-1",
                path: String = "/fixture/browser/receipt.json", projection: String? = projectionHash) -> RouteFanoutBrowserRecordEvidence {
        .init(state: state, requestSHA256: request, responseSHA256: response, conversationURL: url,
              receiptPath: path, policyProjectionSHA256: projection)
    }
    func route(_ evidence: RouteFanoutBrowserRecordEvidence? = browser, surface: String = "chatgpt",
               provider: String? = "chatgpt", executedSurface: String? = "chatgpt",
               native: RouteFanoutNativeRecordEvidence? = nil, exit: Int32? = 0,
               adoption: String? = "adopted", result: String? = resultHash) -> RouteFanoutRouteEvidence {
        .init(index: 1, surface: surface, executionIndex: 1, payloadSHA256: requestHash,
              provider: provider, executedSurface: executedSurface, action: "consumer_chat",
              effort: "unobserved", permissionProfile: "consumer_chat_only", exitCode: exit,
              revasDisposition: adoption, nativeRecord: native, resultSHA256: result, browserRecord: evidence)
    }
    let returned = route()
    try check(browser.isReturnedObservation && browser.matches(payloadSHA256: requestHash, resultSHA256: resultHash),
              "returned public-browser fields bind exact payload and response hashes")
    try check(!RouteFanoutRecord.observedNativeInvocation(in: [returned]), "browser response never becomes native invocation")
    try check(RouteFanoutRecord.observedAnyInvocation(in: [returned]), "schema3 browser-only success records model invocation")
    try check(!browser.matches(payloadSHA256: String(repeating: "d", count: 64), resultSHA256: resultHash),
              "other parent/payload hash cannot inherit browser result")
    try check(!browser.matches(payloadSHA256: requestHash, resultSHA256: String(repeating: "d", count: 64)),
              "altered response cannot inherit browser result")
    try check(!browser.matches(payloadSHA256: requestHash, resultSHA256: nil), "missing answer hash not successful evidence")
    for state: RouteFanoutBrowserRecordEvidence.State in [.approvalRequired, .ready, .blocked] {
        try check(!record(state: state).isReturnedObservation && !RouteFanoutRecord.observedAnyInvocation(in: [route(record(state: state))]),
                  "not-returned browser state is not observed model invocation")
    }
    for invalid in [
        record(request: "not-a-hash"), record(response: resultHash.uppercased()), record(projection: ""),
        record(url: "http://chatgpt.com/c/fixture"), record(url: "https://other.example/c/fixture"),
        record(url: "https://user:secret@chatgpt.com/c/fixture"), record(url: "https://chatgpt.com:444/c/fixture"),
        record(url: "https://chatgpt.com/backend-api/f/conversation"), record(url: "https://chatgpt.com/work/fixture"),
        record(url: "https://chatgpt.com/c/fixture?mode=work"), record(url: "https://chatgpt.com/c/fixture#fragment"),
        record(path: "relative.json"), record(path: "//other/receipt.json"), record(path: "/fixture/../receipt.json"),
        record(path: "/fixture/receipt.txt"), record(path: "/fixture/receipt\n.json")
    ] {
        try check(!invalid.isReturnedObservation && !RouteFanoutRecord.observedAnyInvocation(in: [route(invalid)]),
                  "invalid browser observation rejected without native proof fabrication")
    }
    try check(record(url: "https://chatgpt.com/", projection: nil).isReturnedObservation,
              "actual ordinary/temporary Chat URL and missing historical projection remain representable")
    for invalidRoute in [route(nil), route(surface: "gpt-chat"), route(provider: "codex"), route(executedSurface: "codex"),
                         route(exit: 1), route(exit: nil), route(adoption: "rejected"), route(adoption: nil), route(result: nil)] {
        try check(!RouteFanoutRecord.observedAnyInvocation(in: [invalidRoute]),
                  "route identity/exit/adoption cannot wash a browser observation")
    }
    let unverifiedNative = RouteFanoutNativeRecordEvidence(turnID: UUID().uuidString,
        recordPath: "/fixture/native.jsonl", persistence: "unverified", desktopVisibility: "none")
    try check(!RouteFanoutRecord.observedAnyInvocation(in: [route(native: unverifiedNative)]),
              "browser evidence cannot silently replace an attached invalid native claim")
    let native = RouteFanoutNativeRecordEvidence(turnID: "11111111-1111-4111-8111-111111111111",
        recordPath: "/fixture/rollout.jsonl", persistence: "verified", desktopVisibility: "none")
    let nativeRoute = RouteFanoutRouteEvidence(index: 2, surface: "codex", payloadSHA256: requestHash,
        provider: "codex", executedSurface: "codex", sessionID: "22222222-2222-4222-8222-222222222222",
        nativeRecord: native, resultSHA256: resultHash)
    try check(RouteFanoutRecord.observedNativeInvocation(in: [nativeRoute]), "existing Codex native observation unchanged")
    try check(RouteFanoutRecord.observedAnyInvocation(in: [nativeRoute, returned]), "mixed real transport observations")
    let attempt = RouteFanoutAttemptEvidence(sequence: 1, provider: "claude", action: "execution", effort: "unknown",
        revasDisposition: "rejected", sessionID: "33333333-3333-4333-8333-333333333333", permissionProfile: "read_only",
        exitCode: 0, durationMS: 1,
        nativeRecord: .init(recordPath: "/fixture/claude.jsonl", persistence: "verified", desktopVisibility: "none"),
        resultSHA256: resultHash)
    let rejectedNativeRoute = RouteFanoutRouteEvidence(index: 3, surface: "claude", payloadSHA256: requestHash, attempts: [attempt])
    try check(RouteFanoutRecord.observedNativeInvocation(in: [rejectedNativeRoute]),
              "rejected native invocation remains observed independently of adoption")
    for schema in [1, 2] {
        let old = RouteFanoutRecord(schema: schema, operationID: "legacy-fixture", resultSHA256: resultHash,
                                    routes: [nativeRoute, rejectedNativeRoute])
        let data = try JSONEncoder().encode(old)
        let encoded = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let routes = encoded["routes"] as! [[String: Any]]
        try check(routes.allSatisfy { $0["browser_record"] == nil }, "legacy schema does not invent browser fields")
        try check(try JSONDecoder().decode(RouteFanoutRecord.self, from: data) == old, "legacy schema exact field round trip")
    }
    let schema3 = RouteFanoutRecord(schema: 3, operationID: "browser-fixture",
        modelInvoked: RouteFanoutRecord.observedAnyInvocation(in: [returned]), resultSHA256: resultHash, routes: [returned])
    let encoded3 = try JSONEncoder().encode(schema3)
    let restored3 = try JSONDecoder().decode(RouteFanoutRecord.self, from: encoded3)
    try check(restored3 == schema3 && restored3.modelInvoked && restored3.schema == 3, "schema3 successful browser-only invocation survives restart")
    try check(restored3.routes.first?.nativeRecord == nil && restored3.routes.first?.browserRecord == browser,
              "separate public browser evidence remains separate after round trip")
    let browserKeys = (try JSONSerialization.jsonObject(with: JSONEncoder().encode(browser))) as! [String: Any]
    try check(Set(browserKeys.keys) == Set(["mode", "state", "request_sha256", "response_sha256", "conversation_url", "receipt_path", "policy_projection_sha256"]),
              "public evidence contains no native/credential/model/quota/quality invention")
    var invalidEnum = browserKeys; invalidEnum["mode"] = "work"
    try check((try? JSONDecoder().decode(RouteFanoutBrowserRecordEvidence.self, from: JSONSerialization.data(withJSONObject: invalidEnum))) == nil,
              "Work cannot decode as ordinary Chat mode")
    print("Route fan-out browser record: \(count) checks PASS; schema1/2 preservation, schema3 separate observed browser invocation; browser/model calls 0")
}
