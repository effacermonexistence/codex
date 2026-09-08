import Foundation
import CryptoKit
import OS1Context

func runExecutionFixtures() throws {
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
        ["type":"stream_event","event":["type":"content_block_start","content_block":["type":"tool_use","name":"Read","input":["path":"PRIVATE PATH"]]]],
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
    let codex = ExecutionStream()
    func event(_ method: String, _ params: [String: Any]) { codex.ingestCodex(["method":method,"params":params],threadID:"t",turnID:"u") }
    event("item/reasoning/textDelta",["threadId":"t","turnId":"u","delta":"PRIVATE"])
    event("item/agentMessage/delta",["threadId":"other","turnId":"u","itemId":"a","delta":"OTHER"])
    event("item/agentMessage/delta",["threadId":"t","turnId":"u","itemId":"a","delta":"hello"])
    event("item/completed",["threadId":"t","turnId":"u","item":["type":"agentMessage","id":"a","text":"hello"]])
    event("item/started",["threadId":"t","turnId":"u","item":["type":"commandExecution","command":"SECRET COMMAND"]])
    check(codex.text == "hello")
    check(codex.tool == "commandExecution")
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
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-outbox-fixture-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let data = Data("finished paid result".utf8)
    let hash = SHA256.hash(data: data).map { String(format:"%02x",$0) }.joined()
    let id = UUID().uuidString + "-1"
    let record = DeliveryRecord(id:id,apiURL:"https://fixture",deviceID:"device",resultSHA256:hash,artifact:data,
        upload:Data(),submission:Data(),step:Data(),source:nil,output:"finished paid result")
    try DeliveryOutbox(root:root).save(record)
    check(try DeliveryOutbox(root:root).read(id).output == record.output)
    check(try DeliveryOutbox(root:root).read(id).localRejection == nil)
    let rejectedID = UUID().uuidString + "-1"
    let rejected = DeliveryRecord(id:rejectedID,apiURL:"https://fixture",deviceID:"device",resultSHA256:hash,
        artifact:data,upload:Data(),submission:Data(),step:Data(),source:nil,output:"finished paid result",
        localRejection:"presentation_rejected")
    try DeliveryOutbox(root:root).save(rejected)
    let recovered = try DeliveryOutbox(root:root).read(rejectedID)
    check(recovered.localRejection == "presentation_rejected")
    check(recovered.artifact == data && recovered.output == rejected.output)
    // Legacy successful records omit this optional field and remain readable.
    var legacy = try JSONSerialization.jsonObject(with: JSONEncoder().encode(record)) as! [String: Any]
    legacy.removeValue(forKey: "localRejection")
    check(try JSONDecoder().decode(DeliveryRecord.self, from: JSONSerialization.data(withJSONObject: legacy)).localRejection == nil)
    check((try FileManager.default.attributesOfItem(atPath:root.appendingPathComponent(id + ".json").path)[.posixPermissions] as? NSNumber)?.intValue == 0o600)
    do { _ = try DeliveryOutbox(root:root).read("../../secrets"); fatalError("path escape") } catch { checks += 1 }
    print("Execution stream, privacy, quota and durable outbox: \(checks) checks passed")
}
