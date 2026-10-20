import Foundation
import OS1Context

struct InlineProjectionDisplayFixture {
    static func run() throws {
        var checks = 0
        func check(_ value: @autoclosure () throws -> Bool, _ name: String) throws {
            guard try value() else { throw NSError(domain: "InlineProjectionDisplayFixture", code: 1,
                userInfo: [NSLocalizedDescriptionKey: name]) }
            checks += 1
        }
        func rejects(_ name: String, _ body: () throws -> Void) throws {
            do { try body() } catch { checks += 1; return }
            throw NSError(domain: "InlineProjectionDisplayFixture", code: 2,
                userInfo: [NSLocalizedDescriptionKey: "accepted " + name])
        }
        typealias C = RCCRuntimeContract
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let conversation = UUID(), submission = UUID()
        let request = "Inspect only the requested fixture."
        let hash = C.digest(Data(request.utf8))
        func project(_ core: C.Snapshot, previous: ParallelAgentTask.Snapshot? = nil,
                     submitted: UUID = submission) throws -> ParallelAgentTask.Snapshot {
            try RCCRuntimeProjection.project(core, conversationID: conversation, submissionID: submitted,
                objective: request, observedAt: now, firstObservedAt: now, maxParallelism: 3,
                expectedRequestSHA256: hash, previous: previous,
                nativeReceipts: ["unused-private-native-receipt": Data("PRIVATE_NATIVE_REASONING_NOT_READ".utf8)])
        }
        func core(_ children: [C.ChildSnapshot] = []) -> C.Snapshot {
            C.Snapshot(taskID: "fixture-task", requestSHA256: hash,
                state: children.isEmpty ? .queued : .running, revision: 1,
                children: children, result: nil, error: nil)
        }
        let old = ParallelAgentTask.Node(title: "Legacy", role: .worker)
        let oldBytes = try JSONEncoder().encode(old)
        let decodedOld = try JSONDecoder().decode(ParallelAgentTask.Node.self, from: oldBytes)
        try check(decodedOld.publicOutputSummary == nil && decodedOld.qualityDisclosure == nil,
            "missing optional fields remain backward-compatible nil")
        let oldJSON = try JSONSerialization.jsonObject(with: oldBytes) as! [String: Any]
        try check(oldJSON["publicOutputSummary"] == nil && oldJSON["qualityDisclosure"] == nil,
            "nil fields omitted on wire")
        let empty = try project(core())
        try check(empty.nodes.count == 1 && empty.nodes[0].publicOutputSummary == nil,
            "no-plan root has no invented workers or output")
        let a = C.ChildSnapshot(id: "one", state: .running, attemptID: "attempt-one", candidateID: "candidate",
            outputSummary: "Actual branch one output")
        let one = try project(core([a]))
        try check(one.nodes.count == 2 && one.nodes[1].publicOutputSummary == "Actual branch one output",
            "one actual worker retains its public output")
        try check(one.nodes[1].resultSummary == nil && one.nodes[1].model == nil && one.nodes[1].effort == nil,
            "public output adds no execution/model/quality claim")
        let selection = RCCRuntimeProjection.inspectionIdentity(taskID: "fixture-task", childID: "one")
        try check(selection.planID == one.planID && selection.nodeID == one.nodes[1].id,
            "inspection IDs exactly match existing graph namespace")
        let otherSelection = RCCRuntimeProjection.inspectionIdentity(taskID: "another-task", childID: "one")
        try check(selection.planID != otherSelection.planID && selection.nodeID != otherSelection.nodeID,
            "display identities do not cross tasks")
        var b = a; b.id = "two"; b.attemptID = "attempt-two"; b.outputSummary = "Actual branch two output"
        let two = try project(core([a, b]))
        try check(two.nodes.filter { $0.role == .worker }.map(\.publicOutputSummary) ==
            ["Actual branch one output", "Actual branch two output"], "outputs bound to their actual children")
        var blankA = a; blankA.outputSummary = nil
        let reset = try project(core([blankA]), previous: one)
        try check(reset.nodes[1].publicOutputSummary == nil && reset.nodes[1].qualityDisclosure == nil,
            "current missing fields do not inherit previous output/disclosure")
        try rejects("new submission cannot inherit prior graph") { _ = try project(core([blankA]), previous: one, submitted: UUID()) }
        var foreign = core([blankA]); foreign.taskID = "another-task"
        try rejects("new task cannot inherit prior graph") { _ = try project(foreign, previous: one) }
        foreign = core([a]); foreign.requestSHA256 = String(repeating: "f", count: 64)
        try rejects("request binding mismatch") { _ = try project(foreign) }
        var completed = a; completed.state = .completed
        completed.qualityDisclosure = .init(coverage: .partial, failedCheckIDs: ["partial.schedule.capacity"],
            witnessSHA256: String(repeating: "a", count: 64))
        var returned = core([completed]); returned.state = .returnedUnverified
        returned.result = .init(output: "PRIVATE_ROOT_OUTPUT_MUST_NOT_PROJECT", executionVerified: true,
            taskVerified: false, parityState: .unverified, nativeReceipt: "fixture-private-record")
        let disclosed = try project(returned)
        try check(disclosed.nodes[1].state == .succeeded && disclosed.nodes[0].state == .blocked &&
            disclosed.nodes[1].failureSummary == nil, "known quality mismatch is not execution failure or parent success")
        try check(disclosed.nodes[1].qualityDisclosure == completed.qualityDisclosure &&
            disclosed.nodes[1].resultSummary == "Child execution returned; parent task quality remains a separate state.",
            "typed disclosure preserved and existing right-tree generic summary unchanged")
        try check(!String(decoding: try disclosed.encoded(), as: UTF8.self).contains("PRIVATE_ROOT_OUTPUT_MUST_NOT_PROJECT"),
            "root result never copied to child summary")
        completed.qualityDisclosure = .init(coverage: nil, failedCheckIDs: [], checker: .unavailable)
        returned.children = [completed]
        let unavailable = try project(returned)
        try check(unavailable.nodes[1].state == .succeeded && unavailable.nodes[1].qualityDisclosure?.checker == .unavailable &&
            unavailable.nodes[1].failureSummary == nil, "checker unavailable stays disclosed, not execution failure")
        completed.qualityDisclosure = .init(coverage: .partial, failedCheckIDs: ["bad\nidentifier"])
        returned.children = [completed]
        let unsafeDisplay = try project(returned)
        try check(unsafeDisplay.nodes[1].state == .succeeded && unsafeDisplay.nodes[1].qualityDisclosure == nil,
            "unsafe optional display metadata omitted without rejecting valid execution graph")
        blankA.state = .completed; returned.children = [blankA]
        let disclosureReset = try project(returned, previous: unavailable)
        try check(disclosureReset.nodes[1].publicOutputSummary == nil && disclosureReset.nodes[1].qualityDisclosure == nil,
            "disclosure absent from new snapshot clears prior optional display fields")
        completed.state = .held; returned.children = [completed]
        try rejects("disclosure invalid on held Core child") { _ = try project(returned) }
        var long = a; long.outputSummary = String(repeating: "x", count: 3_000)
        let bounded = try project(core([long]))
        try check((bounded.nodes[1].publicOutputSummary?.count ?? 0) <= 1_000,
            "existing public sanitizer bounds long public summary")
        var secret = a; secret.outputSummary = "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789"
        let redacted = try project(core([secret]))
        try check(redacted.nodes[1].publicOutputSummary?.contains("abcdefghijklmnopqrstuvwxyz0123456789") != true,
            "existing public summary secret masker retained")
        func mutatedNode(_ change: (inout [String: Any]) -> Void) throws -> Data {
            var value = oldJSON; change(&value)
            return try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        }
        func decodeNode(_ change: (inout [String: Any]) -> Void) throws {
            _ = try JSONDecoder().decode(ParallelAgentTask.Node.self, from: mutatedNode(change))
        }
        try rejects("unknown Node display key") { try decodeNode { $0["raw_reasoning"] = "not allowed" } }
        try rejects("wrong summary type") { try decodeNode { $0["publicOutputSummary"] = 42 } }
        try rejects("unknown disclosure field") { try decodeNode { $0["qualityDisclosure"] = ["coverage": "partial", "failed_check_ids": [], "raw_reasoning": "not allowed"] } }
        try rejects("wrong disclosure type") { try decodeNode { $0["qualityDisclosure"] = "not an object" } }
        try rejects("unknown coverage") { try decodeNode { $0["qualityDisclosure"] = ["coverage": "invented", "failed_check_ids": []] } }
        try rejects("empty disclosure without reason") { try decodeNode { $0["qualityDisclosure"] = ["failed_check_ids": []] } }
        try rejects("duplicate check IDs") { try decodeNode { $0["qualityDisclosure"] = ["failed_check_ids": ["capacity", "capacity"]] } }
        try rejects("control characters in check IDs") { try decodeNode { $0["qualityDisclosure"] = ["failed_check_ids": ["capacity\nraw text"]] } }
        try rejects("malformed witness digest") { try decodeNode { $0["qualityDisclosure"] = ["coverage": "partial", "failed_check_ids": [], "witness_sha256": "not-a-hash"] } }
        try rejects("too many check IDs") { try decodeNode { $0["qualityDisclosure"] = ["failed_check_ids": (0..<65).map { "c\($0)" }] } }
        var malformedGraph = one; malformedGraph.nodes[1].publicOutputSummary = String(repeating: "a", count: 1_001)
        try rejects("saved display oversized summary") { _ = try malformedGraph.validated() }
        malformedGraph = one; malformedGraph.nodes[1].qualityDisclosure = .init(coverage: .partial, failedCheckIDs: [])
        try rejects("saved disclosure on unfinished execution") { _ = try malformedGraph.validated() }
        let roundtrip = try ParallelAgentTask.Snapshot.decode(unavailable.encoded(), conversationID: conversation,
            submissionID: submission, requestSHA256: hash)
        try check(roundtrip == unavailable, "typed optional fields survive existing bound snapshot roundtrip")
        print("INLINE408 projection display fixtures: \(checks) PASS; provider calls 0")
    }
}
