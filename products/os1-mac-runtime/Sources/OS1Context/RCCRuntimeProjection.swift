import CryptoKit
import Foundation

/// Display-only projection of the authoritative OpenClaw RCC task. It cannot
/// schedule, retry, grant a route or certify output. There are no invented
/// planner/join workers: one real child is still a recorded one-child tree.
public enum RCCRuntimeProjection {
    public enum Rejection: String, Error, Sendable {
        case invalidBinding, invalidClock, unsupportedDisplaySize, invalidDependency
    }

    public static func project(_ core: RCCRuntimeContract.Snapshot,
                               conversationID: UUID, submissionID: UUID,
                               objective: String, observedAt: Date = Date(),
                               firstObservedAt: Date, maxParallelism: Int,
                               expectedRequestSHA256: String? = nil,
                               previous: ParallelAgentTask.Snapshot? = nil) throws -> ParallelAgentTask.Snapshot {
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
        case .planning, .running, .waiting, .cancelling: rootState = .running
        case .completed: rootState = .succeeded
        case .returnedUnverified, .held: rootState = .blocked
        case .cancelled: rootState = .cancelled
        case .effectsUncertain: rootState = .interrupted
        case .failed: rootState = .failed
        }
        let priorRoot = prior?.nodes.first { $0.id == rootID }
        let rootStarted: Date? = rootState == .pending ? nil : (priorRoot?.startedAt ?? firstObservedAt)
        let rootFinished: Date? = rootState.isTerminal ? (priorRoot?.finishedAt ?? observedAt) : nil
        let rootDescription = core.state == .returnedUnverified
            ? "Output returned · task quality unverified; candidate retained."
            : "OpenClaw core state: " + core.state.rawValue
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
            if let selected = child.selectedConfig {
                // Selected configuration is NOT independently observed execution.
                description += " · selected " + selected.surface.rawValue + " / " + selected.model + " / " + selected.effort.rawValue
            } else { description += " · execution configuration not exposed" }
            if state != .pending, child.startedAtMS == nil {
                description += " · clock is first observation, not native start"
            }
            nodes.append(ParallelAgentTask.Node(id: id, parentID: rootID,
                dependencies: dependencyNames.compactMap { childIDs[$0] },
                title: "Task \(index + 1) · " + child.id, role: .worker, state: state,
                // No selected -> executed upgrade. Native-observed route/session
                // can be attached by the caller from its real execution receipt.
                provider: nil, surface: nil, model: nil, effort: nil, nativeSessionID: nil,
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

    private static func identifier(_ task: String, _ object: String) -> UUID {
        var bytes = Array(SHA256.hash(data: Data(("os1-rcc-display-v1\0" + task + "\0" + object).utf8)).prefix(16))
        bytes[6] = (bytes[6] & 0x0f) | 0x50
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        return UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
            bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]))
    }
}
