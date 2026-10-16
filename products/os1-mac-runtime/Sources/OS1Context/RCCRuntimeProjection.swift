import CryptoKit
import Foundation

/// Display-only projection of the authoritative OpenClaw RCC task. It cannot
/// schedule, retry, grant a route or certify output. There are no invented
/// planner/join workers: one real child is still a recorded one-child tree.
public enum RCCRuntimeProjection {
    public enum Rejection: String, Error, Sendable {
        case invalidBinding, invalidClock, unsupportedDisplaySize, invalidDependency
    }

    /// Observer custody only. The staged task survives GUI/CLI exit; neither
    /// this binding nor its refresh authorizes a new execution or installation.
    public struct InstallationBinding: Codable, Equatable, Sendable {
        public let submissionID: UUID
        public let objective: String
        public let firstObservedAt: Date
        public var observedRevision: Int
        public var deliveredOutputSHA256: String?
        public var cancellationRequested: Bool?
        public let handoff: RCCRuntimeContract.InstallHandoff

        public init(_ snapshot: RCCRuntimeContract.Snapshot, submissionID: UUID,
                    objective: String, firstObservedAt: Date) throws {
            try RCCRuntimeContract.validate(snapshot)
            guard snapshot.state == .awaitingInstall, let handoff = snapshot.installHandoff,
                  firstObservedAt.timeIntervalSince1970.isFinite,
                  !objective.isEmpty else { throw Rejection.invalidBinding }
            self.submissionID = submissionID; self.objective = objective
            self.firstObservedAt = firstObservedAt; self.observedRevision = snapshot.revision
            self.deliveredOutputSHA256 = snapshot.result.map { RCCRuntimeContract.digest(Data($0.output.utf8)) }
            self.cancellationRequested = nil
            self.handoff = handoff
        }

        /// New runtime receipts must identify the SAME original request,
        /// source and staged artifact. Current build identity is not evidence
        /// that this particular self-repair was installed.
        public func accepts(_ snapshot: RCCRuntimeContract.Snapshot) throws -> Bool {
            try RCCRuntimeContract.validate(snapshot)
            guard let next = snapshot.installHandoff else { return false }
            return snapshot.taskID == handoff.taskID && snapshot.requestSHA256 == handoff.requestSHA256 &&
                snapshot.revision >= observedRevision && next.schema == handoff.schema &&
                next.taskID == handoff.taskID && next.requestSHA256 == handoff.requestSHA256 &&
                next.nodeID == handoff.nodeID && next.parentAttemptID == handoff.parentAttemptID &&
                next.sourceFingerprint == handoff.sourceFingerprint && next.sourceRoot == handoff.sourceRoot &&
                next.sourceHead == handoff.sourceHead && next.protectedSourceSHA256 == handoff.protectedSourceSHA256 &&
                next.stagedIntentID == handoff.stagedIntentID && next.stagedReceiptSHA256 == handoff.stagedReceiptSHA256
        }

        public static func isResolved(_ snapshot: RCCRuntimeContract.Snapshot) -> Bool {
            guard let handoff = snapshot.installHandoff,
                  [.installed, .failed, .cancelled].contains(handoff.state) else { return false }
            return [.completed, .returnedUnverified, .held, .failed, .cancelled, .effectsUncertain].contains(snapshot.state)
        }
    }

    public static func project(_ core: RCCRuntimeContract.Snapshot,
                               conversationID: UUID, submissionID: UUID,
                               objective: String, observedAt: Date = Date(),
                               firstObservedAt: Date, maxParallelism: Int,
                               expectedRequestSHA256: String? = nil,
                               previous: ParallelAgentTask.Snapshot? = nil,
                               nativeReceipts: [String: Data] = [:]) throws -> ParallelAgentTask.Snapshot {
        try RCCRuntimeContract.validate(core)
        if let expectedRequestSHA256, expectedRequestSHA256 != core.requestSHA256 { throw Rejection.invalidBinding }
        guard observedAt.timeIntervalSince1970.isFinite, firstObservedAt.timeIntervalSince1970.isFinite,
              firstObservedAt <= observedAt else { throw Rejection.invalidClock }
        guard core.children.count <= ParallelAgentTask.maximumWorkerNodes,
              (1...ParallelAgentTask.maximumWorkerNodes).contains(maxParallelism) else { throw Rejection.unsupportedDisplaySize }
        let planID = identifier(core.taskID, "plan")
        let rootID = identifier(core.taskID, "root")
        let prior: ParallelAgentTask.Snapshot?
        if let previous {
            let value = try previous.validated(conversationID: conversationID, submissionID: submissionID,
                                               requestSHA256: core.requestSHA256)
            guard value.planID == planID, value.rootNodeID == rootID, value.updatedAt <= observedAt else { throw Rejection.invalidBinding }
            prior = value
        } else { prior = nil }
        let childIDs = Dictionary(uniqueKeysWithValues: core.children.map { ($0.id, identifier(core.taskID, "child:" + $0.id)) })
        // The caller acquires exact private receipt bytes; this pure projection
        // does no filesystem/backend work. One receipt or witnessed native turn
        // cannot be used to decorate more than one child. Bad display evidence
        // is omitted, never a reason to reject an otherwise valid Core graph.
        let receiptCounts = Dictionary(grouping: core.children.compactMap(\.nativeReceipt), by: { $0 }).mapValues(\.count)
        let witnesses = core.children.compactMap { child -> (String, NativeWitness)? in
            guard let path = child.nativeReceipt, receiptCounts[path] == 1,
                  let bytes = nativeReceipts[path],
                  let witness = nativeWitness(bytes, path: path, core: core, child: child) else { return nil }
            return (child.id, witness)
        }
        let witnessCounts = Dictionary(grouping: witnesses, by: { $0.1.identity }).mapValues(\.count)
        let nativeByChild = Dictionary(uniqueKeysWithValues: witnesses.filter { witnessCounts[$0.1.identity] == 1 })
        var knownTimes = [firstObservedAt]
        for child in core.children {
            for milliseconds in [child.startedAtMS, child.finishedAtMS].compactMap({ $0 }) {
                let date = Date(timeIntervalSince1970: Double(milliseconds) / 1000)
                guard date <= observedAt else { throw Rejection.invalidClock }
                knownTimes.append(date)
            }
        }
        let createdAt = min(prior?.createdAt ?? firstObservedAt, knownTimes.min() ?? firstObservedAt)
        let rootState: ParallelAgentTask.State
        switch core.state {
        case .queued: rootState = .pending
        case .planning, .running, .waiting, .cancelling, .awaitingInstall: rootState = .running
        case .completed: rootState = .succeeded
        case .returnedUnverified, .held: rootState = .blocked
        case .cancelled: rootState = .cancelled
        case .effectsUncertain: rootState = .interrupted
        case .failed: rootState = .failed
        }
        let priorRoot = prior?.nodes.first { $0.id == rootID }
        let rootStarted: Date? = rootState == .pending ? nil : (priorRoot?.startedAt ?? firstObservedAt)
        let rootFinished: Date? = rootState.isTerminal ? (priorRoot?.finishedAt ?? observedAt) : nil
        let rootDescription: String
        if let intent = core.routingIntent, intent.state == .resolving {
            rootDescription = "OpenClaw core is interpreting the original request; no worker dispatched."
        } else if let intent = core.routingIntent, intent.state == .held {
            rootDescription = "OpenClaw core held routing interpretation: " + (intent.reason ?? "unconfirmed")
        } else {
        rootDescription = core.state == .returnedUnverified
            ? "Output returned · task quality unverified; candidate retained."
            : core.state == .awaitingInstall
            ? "Verified staged artifact · installation pending; task is not complete."
            : "OpenClaw core state: " + core.state.rawValue
        }
        let root = ParallelAgentTask.Node(id: rootID, title: "OpenClaw task", role: .coordinator,
            state: rootState, startedAt: rootStarted, finishedAt: rootFinished,
            progressText: rootDescription,
            resultSummary: core.result == nil ? nil : "Returned output is retained in the original task; this graph is not a quality certificate.",
            failureSummary: [.held, .failed].contains(core.state) ? "Core held the task; original request and evidence are preserved." : nil)
        var nodes = [root]
        for (index, child) in core.children.enumerated() {
            guard let id = childIDs[child.id] else { throw Rejection.invalidBinding }
            let dependencyNames = child.dependencies ?? []
            guard Set(dependencyNames).count == dependencyNames.count,
                  !dependencyNames.contains(child.id), dependencyNames.allSatisfy({ childIDs[$0] != nil }) else {
                throw Rejection.invalidDependency
            }
            let state: ParallelAgentTask.State
            switch child.state {
            case .pending, .ready, .queued, .waiting: state = .pending
            case .running: state = .running
            case .succeeded, .completed: state = .succeeded
            case .failed: state = .failed
            case .cancelled: state = .cancelled
            case .held: state = .blocked
            case .effectsUncertain: state = .interrupted
            }
            let priorNode = prior?.nodes.first { $0.id == id }
            let observedStart = priorNode?.startedAt ?? observedAt
            let start: Date? = state == .pending ? nil : child.startedAtMS.map { Date(timeIntervalSince1970: Double($0) / 1000) } ?? observedStart
            let finish: Date? = state.isTerminal
                ? child.finishedAtMS.map { Date(timeIntervalSince1970: Double($0) / 1000) } ?? priorNode?.finishedAt ?? observedAt : nil
            var description = "Core child state: " + child.state.rawValue
            if let requested = child.requestedSurface {
                description += " · requested " + surfaceTitle(requested)
            }
            if let selected = child.selectedConfig {
                // Selected configuration is NOT independently observed execution.
                description += " · selected " + selected.surface.rawValue + " / " + selected.model + " / " + selected.effort.rawValue
            } else { description += " · execution configuration not exposed" }
            let native = nativeByChild[child.id]
            if let native { description += " · native " + native.provider + " execution verified" }
            if state != .pending, child.startedAtMS == nil {
                description += " · clock is first observation, not native start"
            }
            nodes.append(ParallelAgentTask.Node(id: id, parentID: rootID,
                dependencies: dependencyNames.compactMap { childIDs[$0] },
                title: childTitle(child, index: index), role: .worker, state: state,
                // Native receipt provenance can identify a real executor and
                // session. Selected/ACK model and effort remain NOT observed.
                provider: native?.provider, surface: native?.surface,
                model: nil, effort: nil, nativeSessionID: native?.sessionID,
                workerSubmissionID: identifier(core.taskID, "submission:" + child.id),
                startedAt: start, finishedAt: finish,
                progressText: ParallelAgentTask.publicText(description, maximum: 500),
                resultSummary: [.succeeded, .completed].contains(child.state) ? "Child execution returned; parent task quality remains a separate state." : nil,
                failureSummary: child.state == .effectsUncertain ? "Side effects uncertain; automatic replay is not authorized." :
                    ([.held, .failed].contains(child.state) ? "Core child did not complete; evidence retained." : nil),
                scope: child.selectedConfig.map { $0.scope == .workspaceWrite ? .workspaceWrite : .readOnly }))
        }
        return try ParallelAgentTask.Snapshot(planID: planID, conversationID: conversationID,
            submissionID: submissionID, requestSHA256: core.requestSHA256, rootNodeID: rootID,
            objective: ParallelAgentTask.publicText(objective, maximum: 500) ?? "Task",
            createdAt: createdAt, updatedAt: observedAt, maxParallelism: maxParallelism,
            nodes: nodes).validated(conversationID: conversationID, submissionID: submissionID,
                                   requestSHA256: core.requestSHA256)
    }

    private struct NativeWitness {
        let provider: String
        let surface: String
        let sessionID: String
        let recordPath: String
        let turnID: String?
        var identity: String { [provider, sessionID, recordPath, turnID ?? ""].joined(separator: "\0") }
    }

    /// Only the minimal witnessed fields are decoded. Raw instructions, output,
    /// tool arguments and native paths never enter public graph text.
    private struct NativeSummary: Decodable {
        let steps: [Step]
        struct Step: Decodable {
            let provider: String
            let surface: String
            let sessionID: String
            let exitCode: Int
            let nativeRecord: Record
            enum CodingKeys: String, CodingKey {
                case provider, surface
                case sessionID = "session_id", exitCode = "exit_code", nativeRecord = "native_record"
            }
            struct Record: Decodable {
                let recordPath: String
                let persistence: String
                let turnID: String?
                enum CodingKeys: String, CodingKey {
                    case persistence, recordPath = "record_path", turnID = "turn_id"
                }
            }
        }
    }

    private static func nativeWitness(_ bytes: Data, path: String,
                                      core: RCCRuntimeContract.Snapshot,
                                      child: RCCRuntimeContract.ChildSnapshot) -> NativeWitness? {
        guard bytes.count <= 1_048_576, absoluteNativePath(path),
              let selected = child.selectedConfig, let attempt = child.attemptID,
              let candidate = child.candidateID,
              let record = try? RCCRuntimeContract.decodeRecord(bytes),
              record.taskID == core.taskID, record.nodeID == child.id,
              record.attemptID == attempt, record.candidateID == candidate,
              record.configurationSHA256 == selected.configurationSHA256,
              record.selectedConfig == selected, record.nativeReceipt == path,
              record.status == .succeeded, record.dispatchStage == .dispatched, record.executionVerified,
              let raw = record.nativeSummary, raw.utf8.count <= 512_000 else { return nil }
        let summaryBytes = Data(raw.utf8)
        // Apply the shared duplicate-key/depth gate inside the opaque summary
        // too, then type-decode (e.g. false is never accepted as exit code 0).
        guard (try? RCCRuntimeContract.checkedObject(summaryBytes)) != nil,
              let summary = try? JSONDecoder().decode(NativeSummary.self, from: summaryBytes),
              summary.steps.count == 1, let step = summary.steps.first,
              step.exitCode == 0, step.nativeRecord.persistence == "verified",
              let session = UUID(uuidString: step.sessionID),
              absoluteNativePath(step.nativeRecord.recordPath),
              URL(fileURLWithPath: step.nativeRecord.recordPath).pathExtension == "jsonl",
              step.surface == selected.surface.rawValue else { return nil }
        let leaf = URL(fileURLWithPath: step.nativeRecord.recordPath).lastPathComponent.lowercased()
        let sessionLeaf = session.uuidString.lowercased() + ".jsonl"
        switch (step.provider, selected.transport, selected.surface) {
        case ("codex", .codexAppServer, .codex), ("codex", .codexAppServer, .gptChat):
            guard leaf.hasPrefix("rollout-"), leaf.hasSuffix("-" + sessionLeaf),
                  let turn = step.nativeRecord.turnID, UUID(uuidString: turn) != nil else { return nil }
        case ("claude", .claudeCLI, .claude), ("claude", .claudeCLI, .claudeChat):
            // Claude native records need not expose a separate turn UUID.
            guard leaf == sessionLeaf,
                  step.nativeRecord.turnID.map({ UUID(uuidString: $0) != nil }) ?? true else { return nil }
        default: return nil
        }
        return NativeWitness(provider: step.provider, surface: step.surface,
            sessionID: session.uuidString.lowercased(), recordPath: step.nativeRecord.recordPath,
            turnID: step.nativeRecord.turnID?.lowercased())
    }

    private static func absoluteNativePath(_ path: String) -> Bool {
        !path.isEmpty && path.utf8.count <= 4_096 && path.hasPrefix("/") &&
            !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) &&
            URL(fileURLWithPath: path).standardizedFileURL.path == path
    }

    private static func surfaceTitle(_ surface: RCCRuntimeContract.Surface) -> String {
        switch surface {
        case .chatgpt: return "ChatGPT"
        case .codex: return "Codex"
        case .claude: return "Claude Code"
        case .claudeChat: return "Claude chat"
        case .gptChat: return "GPT chat (Codex pool)"
        case .local: return "Local"
        }
    }

    private static func childTitle(_ child: RCCRuntimeContract.ChildSnapshot, index: Int) -> String {
        guard let requested = child.requestedSurface else { return "Task \(index + 1) · " + child.id }
        let name = surfaceTitle(requested)
        // Exact short arithmetic probes are safe, useful labels. Do not put
        // arbitrary private instructions, source text or raw output in a public title.
        if let instruction = child.instruction?.trimmingCharacters(in: .whitespacesAndNewlines),
           instruction.utf8.count <= 80,
           instruction.range(of: "^[0-9][0-9 ()+*/.^%−-]*$", options: .regularExpression) != nil {
            return name + " · " + instruction
        }
        return name
    }

    private static func identifier(_ task: String, _ object: String) -> UUID {
        var bytes = Array(SHA256.hash(data: Data(("os1-rcc-display-v1\0" + task + "\0" + object).utf8)).prefix(16))
        bytes[6] = (bytes[6] & 0x0f) | 0x50
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        return UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
            bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]))
    }
}
