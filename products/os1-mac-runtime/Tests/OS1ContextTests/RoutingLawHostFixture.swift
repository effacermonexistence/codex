import Foundation
import OS1Context

/// Build 448 (live q1 on build 447): the host side of the routing law's
/// no-dispatch and REVAS flows. On 447 Core built the ask-back locally with
/// zero dispatch, but the host's snapshot contract rejected the terminal
/// snapshot (`execution_verified` without a native receipt on a result that is
/// not task-verified), `os1 run` mapped that to rcc_transport_preserved and
/// the owner never saw the question. Every Core fixture passed because none
/// passed Core's snapshot through the host contract.
///
/// Here the REAL Core (rcc-runtime.mjs, through
/// scripts/fixtures/routing-law-host-snapshots.mjs: temp SQLite, fake executor,
/// no provider, model, network or real HOME) produces each terminal snapshot,
/// and the host decodes it on the path `os1 run` takes (main.swift
/// runOpenClawRCCTask): RCCRuntimeContract.decodeSnapshot, the K12b
/// negotiation, then the display projection; the delivered text is
/// `result.output`, the line printRunSummary prints.
func runRoutingLawHostFixtures() throws {
    var checks = 0
    func check(_ pass: Bool, _ label: String) throws {
        guard pass else { throw NSError(domain: "RoutingLawHostFixture", code: 1, userInfo: [NSLocalizedDescriptionKey: label]) }
        checks += 1
    }
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    struct Table: Decodable { struct AskBack: Decodable { let ko: String; let en: String }; let ask_back: AskBack }
    let table = try JSONDecoder().decode(Table.self, from: Data(contentsOf: root.appendingPathComponent("Resources/routing-law-table.json")))

    /// The host path of `os1 run` for one terminal snapshot: decode, negotiate
    /// (a v1 run), project. Returns the decoded snapshot.
    func hostPath(_ bytes: Data, _ label: String) throws -> RCCRuntimeContract.Snapshot {
        let snapshot: RCCRuntimeContract.Snapshot
        do { snapshot = try RCCRuntimeContract.decodeSnapshot(bytes) }
        catch { throw NSError(domain: "RoutingLawHostFixture", code: 2,
                              userInfo: [NSLocalizedDescriptionKey: "\(label): host rejected Core's snapshot: \(error)"]) }
        try check(RCCRuntimeContract.negotiated(snapshot, resultContractVersion: nil), "\(label): a v1 run reads it")
        let observed = Date()
        _ = try RCCRuntimeProjection.project(snapshot, conversationID: UUID(), submissionID: UUID(),
            objective: snapshot.children.first?.instruction ?? "", observedAt: observed, firstObservedAt: observed,
            maxParallelism: 4, expectedRequestSHA256: snapshot.requestSHA256)
        checks += 1
        return snapshot
    }

    // ---- The ask-back (owner question 8): no dispatch, delivered to the owner.
    let askBack = try coreFlow("ask_back", root: root)
    try check(askBack.dispatches == 0, "the ask-back dispatches nothing")
    let delivered = try hostPath(askBack.snapshot, "ask_back")
    try check(delivered.state == .returnedUnverified, "the ask-back settles returned_unverified")
    try check(delivered.result?.output == table.ask_back.ko, "the owner sees the question back: \(delivered.result?.output ?? "nil")")
    try check(delivered.result?.executionVerified == false && delivered.result?.taskVerified == false &&
              delivered.result?.nativeReceipt == nil, "it claims no verified execution and has no native receipt")
    try check(delivered.children.count == 1 && delivered.children[0].selectedConfig?.transport == .local &&
              delivered.children[0].selectedConfig?.model == "none", "one local-core child, no model")

    // The 447 snapshot (the same bytes with execution_verified true) is the one
    // the host rejected live: the contract is unchanged, Core was wrong.
    var object = try XCTUnwrapJSON(askBack.snapshot)
    var result = object["result"] as? [String: Any] ?? [:]
    result["execution_verified"] = true
    object["result"] = result
    let build447 = try JSONSerialization.data(withJSONObject: object)
    do { _ = try RCCRuntimeContract.decodeSnapshot(build447); try check(false, "the 447 ask-back snapshot must stay rejected") }
    catch let rejection as RCCRuntimeContract.Rejection { try check(rejection == .invalidSnapshot, "447's ask-back: invalidSnapshot") }

    // ---- Build 448 (DESIGN-8 step 5): a REVAS verified start of the local row
    // (owner question 11, the live q2 request). A passed check delivers the
    // local draft as produced (its own row); a failed one delivers the repair
    // the judge made at the same row. Both reach the owner through the host.
    let passed = try coreFlow("verified_pass", root: root)
    try check(passed.dispatches == 2, "a verified start: the draft and its check")
    let pass = try hostPath(passed.snapshot, "verified_pass")
    try check(pass.result?.output == "a correct local answer", "the checked draft is delivered: \(pass.result?.output ?? "nil")")
    try check(pass.children.count == 1 && pass.children[0].selectedConfig?.surface == .local,
              "the delivered attempt is the draft, on the local row")
    let repaired = try coreFlow("verified_repair", root: root)
    try check(repaired.dispatches == 3, "a failed check: the draft, the check and one repair")
    let repair = try hostPath(repaired.snapshot, "verified_repair")
    let repairedText = repair.result?.output ?? ""
    try check(repairedText.contains("인덱스와 슬라이싱") && !repairedText.contains("접근하는 반면"),
              "the owner sees the repaired answer, never the draft's error")
    try check(repair.children[0].selectedConfig?.surface != .local, "the repaired answer ran at the judge's row")

    // ---- Build 448 (DESIGN-8 step 2 (a)): small talk (owner question 12) on
    // the local row admitted by Core's deterministic verifier. Its pass
    // delivers the draft after ONE dispatch; a factual claim re-reads it as F2
    // (the judge checks the same draft and passes it); any other failure (the
    // real local Q12 draft: a self-disclaimer) is the full answer at the next
    // step. All three reach the owner through the host contract.
    let detPassed = try coreFlow("det_pass", root: root)
    try check(detPassed.dispatches == 1, "a deterministic pass: the local draft only")
    let detPass = try hostPath(detPassed.snapshot, "det_pass")
    try check((detPass.result?.output ?? "").hasPrefix("오늘 하루 정말 고생 많으셨어요") &&
              detPass.children.count == 1 && detPass.children[0].selectedConfig?.surface == .local,
              "the checked small-talk draft is delivered from the local row")
    let reread = try coreFlow("det_reread", root: root)
    try check(reread.dispatches == 2, "a factual claim: the draft and the F2 re-read's check")
    let rereadPass = try hostPath(reread.snapshot, "det_reread")
    try check(rereadPass.result?.output == "피곤할 때는 카페인보다 수분 섭취가 도움이 돼요." &&
              rereadPass.children[0].selectedConfig?.surface == .local, "the judge-passed draft is delivered as produced")
    let full = try coreFlow("det_full", root: root)
    try check(full.dispatches == 2, "another failure: the draft and the full answer at the next step")
    let fullAnswer = try hostPath(full.snapshot, "det_full")
    try check(!(fullAnswer.result?.output ?? "정상적으로 작동").contains("정상적으로 작동") &&
              fullAnswer.children[0].selectedConfig?.surface != .local, "the owner never sees the failed local draft")

    print("Routing law host fixtures: \(checks) checks OK; model calls 0")
}

private func XCTUnwrapJSON(_ data: Data) throws -> [String: Any] {
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw NSError(domain: "RoutingLawHostFixture", code: 3, userInfo: [NSLocalizedDescriptionKey: "snapshot is not an object"])
    }
    return object
}

/// One flow of scripts/fixtures/routing-law-host-snapshots.mjs: the real Core,
/// offline. Returns the terminal snapshot (re-serialized JSON) and the dispatch count.
func coreFlow(_ flow: String, root: URL) throws -> (snapshot: Data, dispatches: Int) {
    let pinnedNode = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/share/node-v24.20.0/bin/node")
    let process = Process(), output = Pipe(), errors = Pipe()
    if let override = ProcessInfo.processInfo.environment["OS1_RCC_CONTRACT_NODE"] { process.executableURL = URL(fileURLWithPath: override) }
    else if FileManager.default.isExecutableFile(atPath: pinnedNode.path) { process.executableURL = pinnedNode }
    else { process.executableURL = URL(fileURLWithPath: "/usr/bin/env") }
    process.arguments = (process.executableURL?.path == "/usr/bin/env" ? ["node"] : []) +
        [root.appendingPathComponent("scripts/fixtures/routing-law-host-snapshots.mjs").path, flow]
    process.standardOutput = output; process.standardError = errors
    try process.run()
    let bytes = output.fileHandleForReading.readDataToEndOfFile()
    let stderr = errors.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
    guard process.terminationStatus == 0,
          let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
          let snapshot = object["snapshot"], let dispatches = object["dispatches"] as? Int else {
        throw NSError(domain: "RoutingLawHostFixture", code: 4, userInfo: [NSLocalizedDescriptionKey:
            "Core flow \(flow) failed: \(String(decoding: stderr, as: UTF8.self))"])
    }
    return (try JSONSerialization.data(withJSONObject: snapshot), dispatches)
}
