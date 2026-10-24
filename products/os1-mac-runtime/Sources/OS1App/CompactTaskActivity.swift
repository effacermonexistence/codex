import Foundation
import OS1Context

/// A compact, display-only projection of already bound execution evidence.
/// Window visibility, a saved `running` node and elapsed time grant no runtime
/// ownership. The caller supplies ownership separately from inspector liveness.
/// No execution, cancellation, retrieval or persistence is performed here.
struct CompactTaskActivity: Equatable {
    let title: String
    let detailText: String
    let help: String
    let isAnimating: Bool
    let hasDetails: Bool
    let isRecorded: Bool
    let isAwaitingInstallation: Bool
    let workerCount: Int
    /// Current-owned workers only; a historical `running` value is not a count
    /// of work known to be running now.
    let runningWorkerCount: Int

    init(state: AgentTaskInspectorState, executionOwned: Bool, awaitingInstallation: Bool) {
        let graph = state.snapshot.flatMap { try? $0.validated(conversationID: state.conversationID) }
        let observation = graph == nil && state.observedExecution?.conversationID == state.conversationID
            && state.observedExecution?.isValid == true ? state.observedExecution : nil
        let root = graph.flatMap { graph in graph.nodes.first { $0.id == graph.rootNodeID } }
        let workers = graph?.nodes.filter { $0.role == .worker } ?? []

        isAnimating = executionOwned && state.isLive
        hasDetails = graph != nil || observation != nil
        isAwaitingInstallation = awaitingInstallation
        isRecorded = hasDetails && !isAnimating && !awaitingInstallation
        workerCount = workers.count
        runningWorkerCount = isAnimating && !awaitingInstallation
            ? workers.filter { $0.state == .running }.count : 0

        if awaitingInstallation {
            title = os1Tr("설치 대기", "Awaiting installation")
        } else if isRecorded {
            title = os1Tr("기록된 실행", "Recorded execution")
        } else if let root {
            title = Self.currentTitle(root.state)
        } else if isAnimating {
            title = os1Tr("작업 중", "Working")
        } else {
            title = os1Tr("작업 활동", "Task activity")
        }

        if awaitingInstallation {
            detailText = workers.isEmpty
                ? os1Tr("설치 영수증 대기", "Waiting for installation receipt")
                : Self.workerText(workers.count)
        } else if isRecorded, let root {
            detailText = Self.recordedTitle(root.state) + " · " + Self.workerText(workers.count)
        } else if graph != nil {
            detailText = runningWorkerCount > 0
                ? Self.workerText(workers.count) + " · " + os1Tr("실행 중 \(runningWorkerCount)", "\(runningWorkerCount) active")
                : Self.workerText(workers.count)
        } else if observation != nil {
            detailText = os1Tr("실제 실행 관측 1건", "1 observed execution")
        } else {
            detailText = isAnimating
                ? os1Tr("실행 세부 정보 아직 미관측", "Execution details not yet observed")
                : os1Tr("기록된 실행 없음", "No recorded execution")
        }

        if !hasDetails {
            help = os1Tr("기록된 실행 세부 정보가 아직 없습니다.", "No execution details are recorded yet.")
        } else if isRecorded {
            help = os1Tr("기록된 세부 정보 열기 · 현재 실행 중이라는 뜻이 아닙니다. 창을 닫아도 작업은 취소되지 않습니다.",
                         "Open recorded details · not a claim of current execution. Closing details does not cancel work.")
        } else {
            help = os1Tr("작업 세부 정보 열기 · 창을 닫아도 백그라운드 작업은 취소되지 않습니다.",
                         "Open task details · closing details does not cancel background work.")
        }
    }

    private static func workerText(_ count: Int) -> String {
        os1Tr("에이전트 \(count)개", "\(count) agent\(count == 1 ? "" : "s")")
    }

    private static func currentTitle(_ state: ParallelAgentTask.State) -> String {
        switch state {
        case .pending: return os1Tr("작업 대기", "Task queued")
        case .running: return os1Tr("작업 중", "Working")
        // A coordinator receipt is not a task-quality certificate.
        case .succeeded: return os1Tr("실행 반환", "Execution returned")
        case .failed: return os1Tr("실행 실패", "Execution failed")
        case .blocked: return os1Tr("작업 보류", "Task held")
        case .cancelled: return os1Tr("취소됨", "Cancelled")
        case .interrupted: return os1Tr("중단 · 결과 미확인", "Interrupted · outcome unconfirmed")
        }
    }

    private static func recordedTitle(_ state: ParallelAgentTask.State) -> String {
        switch state {
        case .pending: return os1Tr("마지막 기록: 대기", "Last recorded: queued")
        case .running: return os1Tr("마지막 기록: 실행 중", "Last recorded: running")
        default: return currentTitle(state)
        }
    }
}

private enum CompactTaskActivityFixtureFailure: Error { case failed(String) }

/// Pure fixtures only: no SessionStore, windows, provider calls or owner files.
/// The production agent-tree self-test can call this without a separate runner.
func compactTaskActivitySelfTest() throws {
    var checks = 0
    func check(_ value: @autoclosure () -> Bool, _ reason: String) throws {
        guard value() else { throw CompactTaskActivityFixtureFailure.failed(reason) }
        checks += 1
    }
    let conversation = UUID(), submission = UUID(), rootID = UUID()
    let created = Date(timeIntervalSince1970: 1_000), updated = Date(timeIntervalSince1970: 1_010)
    func graph(rootState: ParallelAgentTask.State = .running,
               workerStates: [ParallelAgentTask.State] = [.running, .pending]) throws -> ParallelAgentTask.Snapshot {
        func node(_ id: UUID, role: ParallelAgentTask.Role, state: ParallelAgentTask.State) -> ParallelAgentTask.Node {
            .init(id: id, parentID: role == .coordinator ? nil : rootID,
                  title: role == .coordinator ? "Fixture objective" : "Fixture worker", role: role, state: state,
                  startedAt: state == .pending ? nil : created,
                  finishedAt: state.isTerminal ? updated : nil)
        }
        return try ParallelAgentTask.Snapshot(conversationID: conversation, submissionID: submission,
            requestSHA256: String(repeating: "a", count: 64), rootNodeID: rootID, objective: "Fixture activity",
            createdAt: created, updatedAt: updated, maxParallelism: 2,
            nodes: [node(rootID, role: .coordinator, state: rootState)] + workerStates.map {
                node(UUID(), role: .worker, state: $0)
            }).validated()
    }
    let running = try graph()
    func state(_ snapshot: ParallelAgentTask.Snapshot?, live: Bool = true,
               observation: ObservedSingleExecution? = nil) -> AgentTaskInspectorState {
        .init(conversationID: conversation, snapshot: snapshot, sessionTitle: "Fixture session",
              isLive: live, observedExecution: observation)
    }
    let live = CompactTaskActivity(state: state(running), executionOwned: true, awaitingInstallation: false)
    try check(live.isAnimating && !live.isRecorded && live.hasDetails, "owned live execution animates")
    try check(live.workerCount == 2 && live.runningWorkerCount == 1, "only recorded workers are counted")
    try check(live.title == os1Tr("작업 중", "Working"), "live title is compact and localized")

    for liveFlag in [false, true] {
        for owned in [false, true] {
            let summary = CompactTaskActivity(state: state(running, live: liveFlag), executionOwned: owned,
                                              awaitingInstallation: false)
            try check(summary.isAnimating == (owned && liveFlag), "both ownership and liveness are required")
            try check(summary.runningWorkerCount == (owned && liveFlag ? 1 : 0), "history cannot produce active counts")
        }
    }
    let historical = CompactTaskActivity(state: state(running, live: false), executionOwned: false,
                                         awaitingInstallation: false)
    try check(historical.title == os1Tr("기록된 실행", "Recorded execution") && historical.isRecorded,
              "saved running graph is explicitly recorded")
    try check(historical.detailText.contains(os1Tr("마지막 기록: 실행 중", "Last recorded: running")),
              "historical running state is not presented as current")
    try check(historical.workerCount == 2 && historical.runningWorkerCount == 0 && !historical.isAnimating,
              "saved worker topology is preserved without current liveness")

    let held = CompactTaskActivity(state: state(try graph(rootState: .blocked, workerStates: [.succeeded, .succeeded])),
                                   executionOwned: true, awaitingInstallation: false)
    try check(held.title == os1Tr("작업 보류", "Task held") && held.runningWorkerCount == 0,
              "successful workers cannot turn a blocked coordinator into success")
    let failed = CompactTaskActivity(state: state(try graph(rootState: .failed, workerStates: [.succeeded])),
                                     executionOwned: true, awaitingInstallation: false)
    try check(failed.title == os1Tr("실행 실패", "Execution failed"), "root failure remains failure")
    let returned = CompactTaskActivity(state: state(try graph(rootState: .succeeded, workerStates: [.succeeded])),
                                       executionOwned: true, awaitingInstallation: false)
    try check(returned.title == os1Tr("실행 반환", "Execution returned"), "return is not promoted to task-quality success")
    let pending = CompactTaskActivity(state: state(try graph(rootState: .pending, workerStates: [.pending])),
                                      executionOwned: true, awaitingInstallation: false)
    try check(pending.title == os1Tr("작업 대기", "Task queued") && pending.runningWorkerCount == 0,
              "pending graph does not invent an executing worker")
    for terminal in [ParallelAgentTask.State.cancelled, .interrupted] {
        let summary = CompactTaskActivity(state: state(try graph(rootState: terminal, workerStates: [terminal]), live: false),
                                          executionOwned: false, awaitingInstallation: false)
        try check(summary.isRecorded && !summary.isAnimating && summary.runningWorkerCount == 0,
                  "terminal history remains recorded without animation")
    }

    let installation = CompactTaskActivity(state: state(running), executionOwned: false, awaitingInstallation: true)
    try check(installation.isAwaitingInstallation && !installation.isRecorded && !installation.isAnimating,
              "awaiting installation is distinct from live execution and history")
    try check(installation.title == os1Tr("설치 대기", "Awaiting installation") && installation.runningWorkerCount == 0,
              "installation waiting never labels saved workers active")
    let observation = ObservedSingleExecution(id: submission, conversationID: conversation,
        objective: "Fixture single execution", state: "executing", observedAt: updated, startedAt: created)
    let single = CompactTaskActivity(state: state(nil, observation: observation), executionOwned: true,
                                     awaitingInstallation: false)
    try check(single.hasDetails && single.isAnimating && single.workerCount == 0 && single.runningWorkerCount == 0,
              "single observation does not fabricate a plan or workers")
    let recordedSingle = CompactTaskActivity(state: state(nil, live: false, observation: observation),
                                             executionOwned: false, awaitingInstallation: false)
    try check(recordedSingle.isRecorded && !recordedSingle.isAnimating && recordedSingle.hasDetails,
              "single saved observation is not current execution")
    let empty = CompactTaskActivity(state: state(nil, live: false), executionOwned: false, awaitingInstallation: false)
    try check(!empty.hasDetails && !empty.isAnimating && !empty.isRecorded && empty.workerCount == 0,
              "no-plan history remains gracefully empty")
    let preparing = CompactTaskActivity(state: state(nil), executionOwned: true, awaitingInstallation: false)
    try check(preparing.isAnimating && !preparing.hasDetails && preparing.workerCount == 0,
              "owned request may be active before execution details arrive")
    let foreign = AgentTaskInspectorState(conversationID: UUID(), snapshot: running, sessionTitle: "Foreign", isLive: false,
                                          observedExecution: observation)
    let rejected = CompactTaskActivity(state: foreign, executionOwned: false, awaitingInstallation: false)
    try check(!rejected.hasDetails && rejected.workerCount == 0, "foreign evidence cannot populate compact activity")
    try check(running == state(running).snapshot, "projection does not mutate historical evidence")
    for summary in [live, historical, held, failed, returned, pending, installation, single, recordedSingle, empty, preparing, rejected] {
        try check(!summary.title.contains("\n") && !summary.detailText.contains("\n"), "compact labels stay single-line")
    }
    print("Compact task activity: \(checks) checks PASS; pure bound projections; provider calls 0; owner-state writes 0")
}
