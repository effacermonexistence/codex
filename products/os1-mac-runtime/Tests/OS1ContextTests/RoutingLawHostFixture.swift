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

    // ---- DESIGN-9 section 4.8 (build 449): small talk (owner question 12,
    // law F1) is a subjective request: the owner is the judge and the local
    // row is admitted by the prior "local accepted" (form o) on its first
    // turn. It answers in one local dispatch, also with every pool exhausted
    // (its admission is evidence by itself) and in a writer lane (no tool and
    // no write: the node runs read-only); with no pool an unsound draft is
    // held, the draft withheld. On a later turn the reader and the local
    // worker are context-free, so a reference answers (after an OS-1 turn
    // that neither asks nor proposes, and after OS-1's proposal); with every
    // pool exhausted there the request is held, nothing dispatched. All reach
    // the owner through the host contract.
    for flow in ["small_talk_local", "small_talk_no_pool", "small_talk_writer_lane"] {
        let run = try coreFlow(flow, root: root)
        try check(run.dispatches == 1, "\(flow): one local dispatch")
        let path = try hostPath(run.snapshot, flow)
        try check(path.children.count == 1 && path.children[0].selectedConfig?.surface == .local &&
                  path.result?.output != nil, "\(flow): the local row answers small talk, the owner its judge")
    }
    for flow in ["small_talk_later_turn", "small_talk_later_turn_proposal"] {
        let run = try coreFlow(flow, root: root)
        try check(run.dispatches == 1, "\(flow): one reference dispatch")
        let path = try hostPath(run.snapshot, flow)
        try check(path.children.count == 1 && path.children[0].selectedConfig?.surface != .local &&
                  path.result?.output != nil, "\(flow): a later turn is a reference's, never the context-free local row's")
    }
    let unsound = try coreFlow("small_talk_hold", root: root)
    try check(unsound.dispatches == 1, "small_talk_hold: pools exhausted, only the local row ran")
    let unsoundPath = try hostPath(unsound.snapshot, "small_talk_hold")
    try check(unsoundPath.state == .held && unsoundPath.result?.output == nil,
              "small_talk_hold: an unsound local draft with no pool is held, the draft withheld")
    let laterHold = try coreFlow("small_talk_later_turn_hold", root: root)
    try check(laterHold.dispatches == 0, "small_talk_later_turn_hold: pools exhausted, nothing dispatches")
    let laterHoldPath = try hostPath(laterHold.snapshot, "small_talk_later_turn_hold")
    try check(laterHoldPath.state == .held && laterHoldPath.result?.output == nil,
              "small_talk_later_turn_hold: pools exhausted on a later turn, the request is held")

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
