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
