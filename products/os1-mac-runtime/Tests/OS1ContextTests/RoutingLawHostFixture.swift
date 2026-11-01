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
    // delivers the draft after ONE dispatch. Round 3 of the 448 review
    // (decision 3): a rejected draft (the real local Q12 draft: a factual
    // claim) is repaired WITHIN F1 at the family's reference, with the draft
    // plus the verifier's findings; an empty draft is the full answer there.
    // All reach the owner through the host contract.
    let detPassed = try coreFlow("det_pass", root: root)
    try check(detPassed.dispatches == 1, "a deterministic pass: the local draft only")
    let detPass = try hostPath(detPassed.snapshot, "det_pass")
    try check((detPass.result?.output ?? "").hasPrefix("오늘 하루 정말 고생 많으셨어요") &&
              detPass.children.count == 1 && detPass.children[0].selectedConfig?.surface == .local,
              "the checked small-talk draft is delivered from the local row")
    let repairFlow = try coreFlow("det_repair", root: root)
    try check(repairFlow.dispatches == 2, "a rejected draft: the draft and one repair at the family's reference")
    let repairDelivered = try hostPath(repairFlow.snapshot, "det_repair")
    try check(repairDelivered.result?.output == "오늘 정말 고생 많으셨어요. 무슨 일 있으셨어요?" &&
              repairDelivered.children[0].selectedConfig?.surface != .local,
              "the owner sees the repair, never the draft's self-statement")
    let full = try coreFlow("det_full", root: root)
    try check(full.dispatches == 2, "an empty draft: the draft and the full answer at the family's reference")
    let fullAnswer = try hostPath(full.snapshot, "det_full")
    try check((fullAnswer.result?.output ?? "").hasPrefix("오늘 하루 고생 많으셨어요") &&
              fullAnswer.children[0].selectedConfig?.surface != .local, "the full answer ran at the reference")

    // ---- Round 2 of the 448 review (B): every pool exhausted (the 2026-11-01
    // state). Small talk still binds the local start: its deterministic pass is
    // evidence by itself and is delivered; a failing draft holds the request
    // (nothing can run), the draft withheld, and the host reads that hold.
    let heldPass = try coreFlow("det_hold_pass", root: root)
    try check(heldPass.dispatches == 1, "pools exhausted: the local draft only")
    let holdPass = try hostPath(heldPass.snapshot, "det_hold_pass")
    try check((holdPass.result?.output ?? "").hasPrefix("오늘 하루 정말 고생 많으셨어요") &&
              holdPass.children.count == 1 && holdPass.children[0].selectedConfig?.surface == .local,
              "pools exhausted: the checked small-talk draft is delivered from the local row")
    let heldFail = try coreFlow("det_hold_fail", root: root)
    try check(heldFail.dispatches == 1, "pools exhausted, a failing draft: nothing else runs")
    let holdFail = try hostPath(heldFail.snapshot, "det_hold_fail")
    try check(holdFail.state == .held && holdFail.result?.output == nil,
              "pools exhausted, a failing draft: the request is held, the draft withheld")

    // ---- Round 3 of the 448 review (decision 5): small talk has a route
    // whenever the local model is up: on a LATER turn (the host hands the
    // conversation over) the local start binds too, its check reading the
    // reply alone; with every pool exhausted a failing draft is held there
    // too; in a writer lane its node runs read-only and binds the local start.
    let later = try coreFlow("det_later_turn", root: root)
    try check(later.dispatches == 1, "a later turn: the local draft only")
    let laterPass = try hostPath(later.snapshot, "det_later_turn")
    try check((laterPass.result?.output ?? "").hasPrefix("오늘 하루 정말 고생 많으셨어요") &&
              laterPass.children.count == 1 && laterPass.children[0].selectedConfig?.surface == .local,
              "a later turn's small talk is delivered from the local row")
    let laterHeld = try coreFlow("det_later_turn_hold", root: root)
    try check(laterHeld.dispatches == 1, "a later turn, pools exhausted, a failing draft: nothing else runs")
    let laterHold = try hostPath(laterHeld.snapshot, "det_later_turn_hold")
    try check(laterHold.state == .held && laterHold.result?.output == nil,
              "a later turn, pools exhausted, a failing draft: held, the draft withheld")
    let writer = try coreFlow("det_writer_lane", root: root)
    try check(writer.dispatches == 1, "a writer lane's small talk: the local draft only")
    let writerPass = try hostPath(writer.snapshot, "det_writer_lane")
    try check((writerPass.result?.output ?? "").hasPrefix("오늘 하루 정말 고생 많으셨어요") &&
              writerPass.children.count == 1 && writerPass.children[0].selectedConfig?.surface == .local,
              "a writer lane's small talk runs read-only on the local row")

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
