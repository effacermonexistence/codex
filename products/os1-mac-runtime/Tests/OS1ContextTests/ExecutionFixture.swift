import Foundation
import CryptoKit
import OS1Context

func runExecutionFixtures() throws {
    try runNativeExecutionProgressFixtures()
    try runNativePublicRunLogFixtures()
    var checks = 0
    func check(_ x: Bool) { precondition(x); checks += 1 }
    let claude = ExecutionStream()
    let events: [[String: Any]] = [
        ["type":"stream_event","event":["type":"message_start","message":["id":"m1"]]],
        ["type":"stream_event","event":["type":"content_block_delta","delta":["type":"thinking_delta","thinking":"PRIVATE"]]],
        ["type":"stream_event","event":["type":"content_block_delta","delta":["type":"text_delta","text":"확인 중 👋"]]],
        ["type":"assistant","message":["id":"m1","content":[["type":"thinking","thinking":"PRIVATE"],["type":"text","text":"확인 중 👋"]]]],
        ["type":"assistant","parent_tool_use_id":"subagent","message":["id":"sub","content":[["type":"text","text":"HIDDEN SUBAGENT"]]]],
        ["type":"system","text":"PRIVATE HOOK"],
        ["type":"stream_event","event":["type":"content_block_start","content_block":["type":"tool_use","id":"read-1","name":"Read","input":["path":"PRIVATE PATH"]]]],
        ["type":"result","result":"완성","session_id":UUID().uuidString,"is_error":false],
    ]
    for event in events {
        var bytes = try JSONSerialization.data(withJSONObject: event); bytes.append(10)
        for byte in bytes { claude.ingestClaude(Data([byte])) }
    }
    claude.finishClaude()
    check(claude.text == "확인 중 👋")
    check(claude.tool == "Read")
    check(claude.result != nil)
    check(!claude.text.contains("PRIVATE") && !claude.text.contains("HIDDEN"))
    // An identified request opens a step; its partial input is never read.
    check(claude.progress?.steps?.count == 1 && claude.progress?.steps?.first?.label == nil)
    check(!String(decoding: try JSONEncoder().encode(claude.progress), as: UTF8.self).contains("PRIVATE"))
    let codex = ExecutionStream()
    func event(_ method: String, _ params: [String: Any]) { codex.ingestCodex(["method":method,"params":params],threadID:"t",turnID:"u") }
    event("item/reasoning/textDelta",["threadId":"t","turnId":"u","delta":"PRIVATE"])
    event("item/agentMessage/delta",["threadId":"other","turnId":"u","itemId":"a","delta":"OTHER"])
    event("item/agentMessage/delta",["threadId":"t","turnId":"u","itemId":"a","delta":"hello"])
    event("item/completed",["threadId":"t","turnId":"u","item":["type":"agentMessage","id":"a","text":"hello"]])
    // Codex shows a command with no read/search/list action (owner decision
    // B), so the label is the command, redacted: the credential is masked.
    event("item/started",["threadId":"t","turnId":"u","item":["type":"commandExecution","id":"cmd-1",
        "command":"deploy --token SECRET-VALUE-1 --region eu"]])
    check(codex.text == "hello")
    check(codex.tool == "commandExecution")
    check(codex.progress?.steps?.first?.label == "deploy --token … --region eu" && codex.progress?.steps?.first?.verb == "run")
    check(!String(decoding: try JSONEncoder().encode(codex.progress), as: UTF8.self).contains("SECRET"))
    let now = Date(timeIntervalSince1970: 1000)
    let quota: [String: Any] = ["rateLimitsByLimitId":[
        "codex":["primary":["usedPercent":66,"resetsAt":2000]],
        "bucket":["limitName":"GPT-5.3-Codex-Spark","primary":["usedPercent":0,"resetsAt":2000],"secondary":["usedPercent":100,"resetsAt":3000]],
    ]]
    check(CodexQuota.excludedModels(quota,models:["gpt-5.3-codex-spark","gpt-test"],now:now) == ["gpt-5.3-codex-spark"])
    check(CodexQuota.excludedModels(quota,models:["gpt-5.3-codex-spark"],now:Date(timeIntervalSince1970:4000)).isEmpty)
    check(CodexQuota.excludedModels([:],models:["gpt-test"],now:now).isEmpty)
    check(WorkspaceDiscovery.context(workspace:"/explicit/project",prompt:"setup instagram",home:URL(fileURLWithPath:"/fixture-home")).isEmpty)
    let inherited = ["PATH":"/fixture/bin", "UNCHANGED":"fixture"]
    let marked = ProviderExecutionEnvironment.marked(inherited)
    check(marked["OS1_INTERNAL_PROVIDER_EXECUTION"] == "1")
    check(marked["PATH"] == inherited["PATH"] && marked["UNCHANGED"] == inherited["UNCHANGED"])
    check(ProviderExecutionEnvironment.marked(marked) == marked)
    // A foreign agent session's identity never reaches a backend child.
    let nested = ProviderExecutionEnvironment.marked(inherited.merging([
        "CLAUDECODE": "1", "CLAUDE_CODE_SESSION_ID": "fixture", "CLAUDE_CODE_OAUTH_SCOPES": "user:inference",
        "CODEX_THREAD_ID": "fixture", "CLAUDE_CONFIG_DIR": "/fixture/claude", "CODEX_HOME": "/fixture/codex"]) { _, new in new })
    check(nested["CLAUDECODE"] == nil && nested["CLAUDE_CODE_SESSION_ID"] == nil && nested["CLAUDE_CODE_OAUTH_SCOPES"] == nil)
    check(nested["CODEX_THREAD_ID"] == nil && nested["CLAUDE_CONFIG_DIR"] == "/fixture/claude" && nested["CODEX_HOME"] == "/fixture/codex")
    check(nested["PATH"] == inherited["PATH"] && nested["OS1_INTERNAL_PROVIDER_EXECUTION"] == "1")
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-outbox-fixture-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let data = Data("finished paid result".utf8)
    let hash = SHA256.hash(data: data).map { String(format:"%02x",$0) }.joined()
    let id = UUID().uuidString + "-1"
    let record = DeliveryRecord(id:id,apiURL:"https://fixture",deviceID:"device",resultSHA256:hash,artifact:data,
        upload:Data(),submission:Data(),step:Data(),source:nil,output:"finished paid result")
    try DeliveryOutbox(root:root).save(record)
    check(try DeliveryOutbox(root:root).read(id).output == record.output)
    check((try FileManager.default.attributesOfItem(atPath:root.appendingPathComponent(id + ".json").path)[.posixPermissions] as? NSNumber)?.intValue == 0o600)
    do { _ = try DeliveryOutbox(root:root).read("../../secrets"); fatalError("path escape") } catch { checks += 1 }
    let session = UUID().uuidString.lowercased(), turn = UUID().uuidString.lowercased()
    let nativeURL = root.appendingPathComponent("native.jsonl")
    let answer = "준비 상태는 확인했지만 과제 완료는 아닙니다."
    let rows: [[String: Any]] = [
        ["type": "session_meta", "payload": ["id": session]],
        ["type": "event_msg", "payload": ["type": "task_complete", "turn_id": turn, "last_agent_message": answer]],
    ]
    let nativeData = try rows.reduce(into: Data()) { bytes, row in
        bytes.append(try JSONSerialization.data(withJSONObject: row)); bytes.append(10)
    }
    try nativeData.write(to: nativeURL)
    let native: [String: Any] = ["turn_id": turn, "record_path": nativeURL.path, "persistence": "verified"]
    let finished: [String: Any] = ["provider": "codex", "output": answer, "native_record": native]
    var step = finished; step["session_id"] = session
    let artifact = try JSONSerialization.data(withJSONObject: finished)
    let artifactHash = SHA256.hash(data: artifact).map { String(format: "%02x", $0) }.joined()
    func saved(_ text: String = answer, _ metadata: [String: Any]? = nil) throws -> DeliveryRecord {
        DeliveryRecord(id: id, apiURL: "https://fixture", deviceID: "fixture", resultSHA256: artifactHash,
            artifact: artifact, upload: Data(), submission: Data(),
            step: try JSONSerialization.data(withJSONObject: metadata ?? step), source: nil, output: text,
            localRejection: "capability_unavailable")
    }
    check(SavedResultEvidence.codexRecordVerified(try saved()))
    check(!SavedResultEvidence.codexRecordVerified(try saved("tampered answer")))
    var wrongSession = step; wrongSession["session_id"] = UUID().uuidString
    check(!SavedResultEvidence.codexRecordVerified(try saved(answer, wrongSession)))
    let ledger = ManagedNativeTurns(root: root.appendingPathComponent("ownership"))
    let submissionID = UUID()
    try ledger.record(submissionID: submissionID, threadID: session, turnID: turn)
    check(ledger.ownedTurns(threadID: session) == [turn])
    check(ledger.ownedTurns(threadID: UUID().uuidString).isEmpty)
    check(ManagedNativeTurns(root: ledger.root).ownedTurns(threadID: session) == [turn])
    // Legacy ownership is recovered from exact persisted evidence, even when
    // the result was rejected, not from its natural-language answer.
    var legacyObject = try JSONSerialization.jsonObject(with: JSONEncoder().encode(saved())) as! [String: Any]
    legacyObject["submissionID"] = submissionID.uuidString
    let legacy = try JSONDecoder().decode(DeliveryRecord.self, from: JSONSerialization.data(withJSONObject: legacyObject))
    try DeliveryOutbox(root: root).save(legacy)
    let migratedLedger = ManagedNativeTurns(root: root.appendingPathComponent("legacy-ownership"))
    check(migratedLedger.recoverLegacy(threadID: session, outbox: DeliveryOutbox(root: root)) == [turn])
    check(migratedLedger.recoverLegacy(threadID: UUID().uuidString, outbox: DeliveryOutbox(root: root)).isEmpty)
    let readonlyLedger = ManagedNativeTurns(root: root.appendingPathComponent("readonly-ownership"))
    let box = DeliveryOutbox(root: root)
    let before = readonlyLedger.legacyReadDiagnostics(outbox: box)
    check(readonlyLedger.recoverLegacy(threadID: session, outbox: box, persistRecovered: false) == [turn])
    let warm = readonlyLedger.legacyReadDiagnostics(outbox: box)
    check(warm.fullHashes == before.fullHashes + 1 && warm.metadataHits == before.metadataHits + 1)
    check(warm.decodedSnapshots == before.decodedSnapshots && warm.bytesRead > before.bytesRead)
    check(!FileManager.default.fileExists(atPath: readonlyLedger.root.path))
    check(readonlyLedger.recoverLegacy(threadID: UUID().uuidString, outbox: box, persistRecovered: false).isEmpty)
    let otherThread = readonlyLedger.legacyReadDiagnostics(outbox: box)
    check(otherThread.decodedSnapshots == warm.decodedSnapshots && otherThread.metadataHits == warm.metadataHits + 1)
    let authorityURL = root.appendingPathComponent(id + ".json")
    let originalBytes = try Data(contentsOf: authorityURL)
    let originalDate = try FileManager.default.attributesOfItem(atPath: authorityURL.path)[.modificationDate]!
    var changed = try JSONSerialization.jsonObject(with: originalBytes) as! [String: Any]
    let alternateSession = UUID().uuidString.lowercased()
    let oldStep = String(decoding: legacy.step, as: UTF8.self)
    changed["step"] = Data(oldStep.replacingOccurrences(of: session, with: alternateSession).utf8).base64EncodedString()
    let sameLengthReplacement = try JSONSerialization.data(withJSONObject: changed)
    check(sameLengthReplacement.count == originalBytes.count)
    try sameLengthReplacement.write(to: authorityURL)
    try FileManager.default.setAttributes([.modificationDate: originalDate], ofItemAtPath: authorityURL.path)
    check(readonlyLedger.recoverLegacy(threadID: session, outbox: box, persistRecovered: false).isEmpty)
    let replaced = readonlyLedger.legacyReadDiagnostics(outbox: box)
    check(replaced.decodedSnapshots == otherThread.decodedSnapshots + 1)
    try Data("{}".utf8).write(to: authorityURL)
    check(readonlyLedger.recoverLegacy(threadID: session, outbox: box, persistRecovered: false).isEmpty)
    try originalBytes.write(to: authorityURL)
    check(readonlyLedger.recoverLegacy(threadID: session, outbox: box, persistRecovered: false) == [turn])
    let restored = readonlyLedger.legacyReadDiagnostics(outbox: box)
    check(restored.decodedSnapshots == replaced.decodedSnapshots + 2)
    try FileManager.default.removeItem(at: authorityURL)
    check(readonlyLedger.recoverLegacy(threadID: session, outbox: box, persistRecovered: false).isEmpty)
    try originalBytes.write(to: authorityURL)
    check(readonlyLedger.recoverLegacy(threadID: session, outbox: box, persistRecovered: false) == [turn])
    check(readonlyLedger.legacyReadDiagnostics(outbox: box).decodedSnapshots == restored.decodedSnapshots + 1)
    let isolatedRoot = root.appendingPathComponent("isolated-outbox")
    try FileManager.default.createDirectory(at: isolatedRoot, withIntermediateDirectories: true)
    try originalBytes.write(to: isolatedRoot.appendingPathComponent(id + ".json"))
    let isolated = DeliveryOutbox(root: isolatedRoot)
    check(readonlyLedger.recoverLegacy(threadID: session, outbox: isolated, persistRecovered: false) == [turn])
    check(readonlyLedger.legacyReadDiagnostics(outbox: isolated).decodedSnapshots == 1)
    check(try box.verifiedSnapshot(id, bytes: originalBytes).id == id)
    do { _ = try box.verifiedSnapshot(id, bytes: Data("{}".utf8)); fatalError("invalid snapshot") } catch { checks += 1 }
    try Data("{}".utf8).write(to: nativeURL)
    check(!SavedResultEvidence.codexRecordVerified(try saved()))
    check(ManagedNativeTurns(root: root.appendingPathComponent("tampered-ownership")).recoverLegacy(threadID: session,
        outbox: DeliveryOutbox(root: root)).isEmpty)
    try FileManager.default.removeItem(at: nativeURL)
    check(!SavedResultEvidence.codexRecordVerified(try saved()))
    print("Execution stream, privacy, quota and durable outbox: \(checks) checks passed")
}
