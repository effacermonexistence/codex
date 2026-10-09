import AppKit
import Foundation
import OS1Context
import SwiftUI

/// One actual request/runtime/receipt projected for display. This is neither
/// a planner graph nor authority to dispatch an agent or certify task quality.
/// The store supplies recorded fields; missing model/effort/quality stay nil.
struct ObservedSingleExecution: Identifiable, Codable, Equatable, Sendable {
    let id: UUID
    let conversationID: UUID
    let objective: String
    let state: String
    let observedAt: Date
    let provider: String?
    let model: String?
    let effort: String?
    let surface: String?
    let progressText: String?
    let startedAt: Date?
    let finishedAt: Date?
    let receiptPath: String?
    let nativeSessionID: String?
    let nativeRecordVerified: Bool?
    let taskQuality: String?
    let publicAnswer: String?

    init(id: UUID, conversationID: UUID, objective: String, state: String, observedAt: Date,
         provider: String? = nil, model: String? = nil, effort: String? = nil, surface: String? = nil,
         progressText: String? = nil, startedAt: Date? = nil, finishedAt: Date? = nil,
         receiptPath: String? = nil, nativeSessionID: String? = nil, nativeRecordVerified: Bool? = nil,
         taskQuality: String? = nil, publicAnswer: String? = nil) {
        self.id = id; self.conversationID = conversationID; self.objective = objective; self.state = state
        self.observedAt = observedAt; self.provider = provider; self.model = model; self.effort = effort
        self.surface = surface; self.progressText = progressText; self.startedAt = startedAt
        self.finishedAt = finishedAt; self.receiptPath = receiptPath; self.nativeSessionID = nativeSessionID
        self.nativeRecordVerified = nativeRecordVerified; self.taskQuality = taskQuality; self.publicAnswer = publicAnswer
    }

    var isValid: Bool {
        !objective.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !state.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && observedAt.timeIntervalSince1970.isFinite
            && (startedAt?.timeIntervalSince1970.isFinite ?? true)
            && (finishedAt?.timeIntervalSince1970.isFinite ?? true)
            && !(startedAt.map { start in finishedAt.map { $0 < start } ?? false } ?? false)
    }

    var routeDescription: String {
        guard let provider, !provider.isEmpty else {
            return os1Tr("실행 제공자 아직 관측 안 됨", "Execution provider not observed yet")
        }
        let identity = provider == "local" ? os1Tr("OS-1 (로컬)", "OS-1 (local)") : surface.flatMap(ProviderSurface.init(rawValue:))
            .flatMap { $0.gatewayPreference == provider ? $0.routeTitle : nil } ?? provider
        return ([identity] + [model, effort].compactMap { $0 }).joined(separator: " · ")
    }
}

/// Optional observation telemetry cannot poison the authoritative session
/// store. Absent, corrupt or structurally invalid records decode to nil.
@propertyWrapper
struct ObservedExecutionField: Codable, Equatable, Sendable {
    var wrappedValue: ObservedSingleExecution?
    init(wrappedValue: ObservedSingleExecution? = nil) {
        self.wrappedValue = wrappedValue?.isValid == true ? wrappedValue : nil
    }
    init(from decoder: Decoder) throws {
        let decoded = try? ObservedSingleExecution(from: decoder)
        wrappedValue = decoded?.isValid == true ? decoded : nil
    }
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let wrappedValue, wrappedValue.isValid { try container.encode(wrappedValue) }
        else { try container.encodeNil() }
    }
}

extension KeyedDecodingContainer {
    func decode(_ type: ObservedExecutionField.Type, forKey key: Key) throws -> ObservedExecutionField {
        (try? decodeIfPresent(type, forKey: key)) ?? ObservedExecutionField()
    }
}

/// A presentation adapter, never runtime authority. Opening a window cannot
/// schedule work, change the selected conversation, or control a backend.
struct AgentTaskInspectorState {
    let conversationID: UUID
    let snapshot: ParallelAgentTask.Snapshot?
    let sessionTitle: String
    let isLive: Bool
    let observedExecution: ObservedSingleExecution?

    init(conversationID: UUID, snapshot: ParallelAgentTask.Snapshot?, sessionTitle: String, isLive: Bool,
         observedExecution: ObservedSingleExecution? = nil) {
        self.conversationID = conversationID
        self.snapshot = snapshot.flatMap { try? $0.validated(conversationID: conversationID) }
        self.sessionTitle = sessionTitle
        self.isLive = isLive
        self.observedExecution = self.snapshot == nil && observedExecution?.conversationID == conversationID
            && observedExecution?.isValid == true ? observedExecution : nil
    }
}

/// A projection of already observed native telemetry, not an executable plan
/// node. Tool-return signals establish tool state, never agent/task success.
struct ObservedNativeAgentScope: Identifiable, Equatable {
    let scope: String
    let steps: [NativeExecutionProgress.Step]
    let events: [NativeExecutionProgress.Event]
    var id: String { scope }
    var lastObserved: Date? {
        (steps.map { $0.endedAt ?? $0.startedAt } + events.map(\.observedAt)).max()
    }
    var latestStep: NativeExecutionProgress.Step? {
        steps.max { ($0.endedAt ?? $0.startedAt) < ($1.endedAt ?? $1.startedAt) }
    }
    var latestEvent: NativeExecutionProgress.Event? { events.max { $0.sequence < $1.sequence } }
    var lastTool: String? {
        if let event = latestEvent, event.observedAt >= (latestStep.map { $0.endedAt ?? $0.startedAt } ?? .distantPast) {
            return event.tool ?? latestStep?.tool
        }
        return latestStep?.tool ?? latestEvent?.tool
    }
    var hasObservedError: Bool { steps.contains { $0.state == .failed } || events.contains { $0.kind == .toolFailed } }
    /// NativeExecutionProgress has no task-terminal event. Even when every
    /// recorded tool returned or the parent finished, this stays unresolved.
    var taskCompletionEstablished: Bool { false }
}

enum ObservedNativeAgentScopes {
    static func project(_ progress: NativeExecutionProgress?) -> [ObservedNativeAgentScope] {
        guard let progress, progress.isValid else { return [] }
        let steps = progress.steps ?? []
        let scopes = Set(steps.map(\.scope) + progress.events.map(\.scope)).filter { $0 != "main" }
        return scopes.sorted().map { scope in
            ObservedNativeAgentScope(scope: scope,
                steps: steps.filter { $0.scope == scope }.sorted { $0.sequence < $1.sequence },
                events: progress.events.filter { $0.scope == scope }.sorted { $0.sequence < $1.sequence })
        }
    }
}

private struct NativeAgentScopeWindowKey: Hashable {
    let nodeID: UUID
    let scope: String
    var identifier: String {
        SourceContextStore.digest(Data((nodeID.uuidString.lowercased() + "\n" + scope).utf8))
    }
}

@MainActor
private final class AgentTaskInspectorModel: ObservableObject {
    @Published var state: AgentTaskInspectorState
    init(_ state: AgentTaskInspectorState) { self.state = state }
}

@MainActor
private final class AgentTaskInspectorWindowDelegate: NSObject, NSWindowDelegate {
    let closed: () -> Void
    init(closed: @escaping () -> Void) { self.closed = closed }
    func windowWillClose(_ notification: Notification) { closed() }
}

/// Explicit user navigation is the only place these windows are brought to
/// the front. Updating live telemetry changes content, never key/focus/level.
@MainActor
final class AgentTaskInspectorWindows {
    static let shared = AgentTaskInspectorWindows()

    private final class NodeWindow {
        let id: UUID
        let parentNodeID: UUID?
        let window: NSWindow
        let delegate: AgentTaskInspectorWindowDelegate
        init(id: UUID, parentNodeID: UUID?, window: NSWindow, delegate: AgentTaskInspectorWindowDelegate) {
            self.id = id; self.parentNodeID = parentNodeID; self.window = window; self.delegate = delegate
        }
    }
    private final class Entry {
        let window: NSWindow
        let model: AgentTaskInspectorModel
        let delegate: AgentTaskInspectorWindowDelegate
        let onClose: () -> Void
        var nodes: [UUID: NodeWindow] = [:]
        var nativeScopes: [NativeAgentScopeWindowKey: NSWindow] = [:]
        var nativeScopeDelegates: [NativeAgentScopeWindowKey: AgentTaskInspectorWindowDelegate] = [:]
        var observedWindow: NodeWindow?
        init(window: NSWindow, model: AgentTaskInspectorModel, delegate: AgentTaskInspectorWindowDelegate,
             onClose: @escaping () -> Void) {
            self.window = window; self.model = model; self.delegate = delegate; self.onClose = onClose
        }
    }
    private var entries: [UUID: Entry] = [:]

    func hasWindow(conversationID: UUID) -> Bool { entries[conversationID] != nil }

    /// Called only by the session marker's explicit action.
    func toggle(state: AgentTaskInspectorState, onClose: @escaping () -> Void) {
        if hasWindow(conversationID: state.conversationID) {
            close(conversationID: state.conversationID)
            return
        }
        let sourceWindow = NSApp.keyWindow
        open(state: state, adjacentTo: sourceWindow, onClose: onClose)
    }

    /// The store calls this on actual graph/progress changes, not on clicks.
    /// A replacement plan or an unknown current graph invalidates stale node
    /// windows; it never silently maps their ids into a new run.
    func update(state: AgentTaskInspectorState) {
        guard let entry = entries[state.conversationID] else { return }
        let previous = entry.model.state.snapshot
        if let previous, let incoming = state.snapshot, previous.planID == incoming.planID,
           previous.submissionID == incoming.submissionID, incoming.updatedAt < previous.updatedAt { return }
        let previousObservation = entry.model.state.observedExecution
        if previous == nil, state.snapshot == nil, let old = previousObservation, let incoming = state.observedExecution,
           old.id == incoming.id, incoming.observedAt < old.observedAt { return }
        let changedRun = previous?.planID != state.snapshot?.planID || previous?.submissionID != state.snapshot?.submissionID
            || previousObservation?.id != state.observedExecution?.id
        if changedRun || (state.snapshot == nil && state.observedExecution == nil) {
            closeAllNodes(entry)
        } else if let graph = state.snapshot {
            let valid = Set(graph.nodes.map(\.id))
            for id in Array(entry.nodes.keys) where !valid.contains(id) {
                closeNode(conversationID: state.conversationID, nodeID: id)
            }
            for key in Array(entry.nativeScopes.keys) {
                let progress = graph.nodes.first { $0.id == key.nodeID }?.nativeProgress
                if !ObservedNativeAgentScopes.project(progress).contains(where: { $0.scope == key.scope }) {
                    closeNativeScope(conversationID: state.conversationID, key: key)
                }
            }
        }
        entry.model.state = state
        entry.window.title = os1Tr("에이전트 작업 트리", "Agent task tree") + " · " + state.sessionTitle
        if let observation = state.observedExecution, let detail = entry.observedWindow {
            detail.window.title = os1Tr("실행 관측", "Execution observation") + " · " + String(observation.objective.prefix(100))
        }
        if let graph = state.snapshot {
            for record in entry.nodes.values {
                if let node = graph.nodes.first(where: { $0.id == record.id }) {
                    record.window.title = os1Tr("에이전트 진행", "Agent progress") + " · " + node.title
                }
            }
        }
    }

    func close(conversationID: UUID) {
        // Remove before closing: NSWindow's delegate callback can be synchronous.
        guard let entry = entries.removeValue(forKey: conversationID) else { return }
        closeAllNodes(entry)
        entry.window.close()
        entry.onClose()
    }

    private func closeAllNodes(_ entry: Entry) {
        let records = Array(entry.nodes.values)
        let scopes = Array(entry.nativeScopes.values)
        let observed = entry.observedWindow
        entry.nodes.removeAll()
        entry.nativeScopes.removeAll()
        entry.nativeScopeDelegates.removeAll()
        entry.observedWindow = nil
        scopes.forEach { $0.close() }
        records.forEach { $0.window.close() }
        observed?.window.close()
    }

    private func closeNode(conversationID: UUID, nodeID: UUID) {
        guard let entry = entries[conversationID], entry.nodes[nodeID] != nil else { return }
        var removed: Set<UUID> = [nodeID]
        while true {
            let children = Set(entry.nodes.values.compactMap { record in
                record.parentNodeID.map { removed.contains($0) ? record.id : nil } ?? nil
            })
            let next = removed.union(children)
            if next == removed { break }
            removed = next
        }
        let records = removed.compactMap { entry.nodes.removeValue(forKey: $0) }
        for key in Array(entry.nativeScopes.keys) where removed.contains(key.nodeID) {
            closeNativeScope(conversationID: conversationID, key: key)
        }
        records.forEach { $0.window.close() }
    }

    private func open(state: AgentTaskInspectorState, adjacentTo source: NSWindow?, onClose: @escaping () -> Void) {
        let id = state.conversationID
        let model = AgentTaskInspectorModel(state)
        let window = makeWindow(title: os1Tr("에이전트 작업 트리", "Agent task tree") + " · " + state.sessionTitle,
            size: NSSize(width: 390, height: 720), adjacentTo: source)
        window.setAccessibilityIdentifier("os1.agent-inspector.graph." + id.uuidString.lowercased())
        let delegate = AgentTaskInspectorWindowDelegate { [weak self] in self?.close(conversationID: id) }
        window.delegate = delegate
        window.contentView = NSHostingView(rootView: AgentTaskInspectorRootView(model: model,
            onClose: { [weak window] in window?.close() },
            onInspect: { [weak self, weak window] node in
                self?.openNode(conversationID: id, nodeID: node.id, adjacentTo: window)
            }, onInspectObserved: { [weak self, weak window] observation in
                self?.openObservedExecution(conversationID: id, executionID: observation.id, adjacentTo: window)
            }))
        entries[id] = Entry(window: window, model: model, delegate: delegate, onClose: onClose)
        // User clicked the marker: this reveal is intentional, unlike updates.
        window.makeKeyAndOrderFront(nil)
    }

    private func openObservedExecution(conversationID: UUID, executionID: UUID, adjacentTo source: NSWindow?) {
        guard let entry = entries[conversationID], entry.model.state.snapshot == nil,
              let observation = entry.model.state.observedExecution, observation.id == executionID else { return }
        if let existing = entry.observedWindow {
            existing.window.makeKeyAndOrderFront(nil)
            return
        }
        let window = makeWindow(title: os1Tr("실행 관측", "Execution observation") + " · " + String(observation.objective.prefix(100)),
            size: NSSize(width: 360, height: 620), adjacentTo: source ?? entry.window)
        window.setAccessibilityIdentifier("os1.agent-inspector.observed." + executionID.uuidString.lowercased())
        let delegate = AgentTaskInspectorWindowDelegate { [weak self] in
            self?.closeObservedExecution(conversationID: conversationID, executionID: executionID)
        }
        window.delegate = delegate
        window.contentView = NSHostingView(rootView: ObservedSingleExecutionInspectorView(model: entry.model, executionID: executionID))
        entry.observedWindow = NodeWindow(id: executionID, parentNodeID: nil, window: window, delegate: delegate)
        window.makeKeyAndOrderFront(nil)
    }

    private func closeObservedExecution(conversationID: UUID, executionID: UUID) {
        guard let entry = entries[conversationID], entry.observedWindow?.id == executionID else { return }
        let observed = entry.observedWindow
        entry.observedWindow = nil
        observed?.window.close()
    }

    private func openNode(conversationID: UUID, nodeID: UUID, adjacentTo source: NSWindow?) {
        guard let entry = entries[conversationID], let graph = entry.model.state.snapshot,
              let node = graph.nodes.first(where: { $0.id == nodeID }) else { return }
        if let existing = entry.nodes[nodeID] {
            existing.window.makeKeyAndOrderFront(nil)
            return
        }
        let parentID = entry.nodes.values.first(where: { $0.window === source })?.id
        let window = makeWindow(title: os1Tr("에이전트 진행", "Agent progress") + " · " + node.title,
            size: NSSize(width: 360, height: 620), adjacentTo: source ?? entry.window)
        window.setAccessibilityIdentifier("os1.agent-inspector.node." + nodeID.uuidString.lowercased())
        let delegate = AgentTaskInspectorWindowDelegate { [weak self] in
            self?.closeNode(conversationID: conversationID, nodeID: nodeID)
        }
        window.delegate = delegate
        window.contentView = NSHostingView(rootView: AgentTaskNodeInspectorView(model: entry.model, nodeID: nodeID,
            onInspect: { [weak self, weak window] next in
                self?.openNode(conversationID: conversationID, nodeID: next.id, adjacentTo: window)
            }, onInspectNativeScope: { [weak self, weak window] scope in
                self?.openNativeScope(conversationID: conversationID, nodeID: nodeID, scope: scope, adjacentTo: window)
            }))
        entry.nodes[nodeID] = NodeWindow(id: nodeID, parentNodeID: parentID, window: window, delegate: delegate)
        window.makeKeyAndOrderFront(nil)
    }

    /// Native subagents are separate observed-scope windows, never inserted
    /// into the authoritative planner graph. No CLI resume/action is exposed.
    private func openNativeScope(conversationID: UUID, nodeID: UUID, scope: String, adjacentTo source: NSWindow?) {
        guard let entry = entries[conversationID], let graph = entry.model.state.snapshot,
              let node = graph.nodes.first(where: { $0.id == nodeID }),
              ObservedNativeAgentScopes.project(node.nativeProgress).contains(where: { $0.scope == scope }) else { return }
        let key = NativeAgentScopeWindowKey(nodeID: nodeID, scope: scope)
        if let existing = entry.nativeScopes[key] { existing.makeKeyAndOrderFront(nil); return }
        let window = makeWindow(title: os1Tr("관측된 네이티브 하위 에이전트", "Observed native subagent") + " · " + String(scope.suffix(12)),
            size: NSSize(width: 360, height: 620), adjacentTo: source ?? entry.nodes[nodeID]?.window ?? entry.window)
        window.setAccessibilityIdentifier("os1.agent-inspector.native." + key.identifier)
        let delegate = AgentTaskInspectorWindowDelegate { [weak self] in
            self?.closeNativeScope(conversationID: conversationID, key: key)
        }
        window.delegate = delegate
        window.contentView = NSHostingView(rootView: NativeAgentScopeInspectorView(model: entry.model, key: key))
        entry.nativeScopes[key] = window; entry.nativeScopeDelegates[key] = delegate
        window.makeKeyAndOrderFront(nil)
    }

    private func closeNativeScope(conversationID: UUID, key: NativeAgentScopeWindowKey) {
        guard let entry = entries[conversationID], let window = entry.nativeScopes.removeValue(forKey: key) else { return }
        // Keep delegate alive until close completes, then discard its callback.
        let delegate = entry.nativeScopeDelegates.removeValue(forKey: key)
        window.close()
        withExtendedLifetime(delegate) {}
    }

    private func makeWindow(title: String, size: NSSize, adjacentTo source: NSWindow?) -> NSWindow {
        let screen = source?.screen ?? NSScreen.main ?? NSScreen.screens.first
        let visible = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1_280, height: 800)
        let frame = Self.adjacentFrame(size: size, source: source?.frame, visible: visible)
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: frame.size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.title = title
        window.level = .normal
        window.collectionBehavior = [.managed]
        window.backgroundColor = NSColor(red: 0.015, green: 0.014, blue: 0.017, alpha: 1)
        window.minSize = NSSize(width: min(300, frame.width), height: min(320, frame.height))
        // Frame includes titlebar too; always keep the whole window on screen.
        window.setFrame(frame, display: false)
        return window
    }

    /// Prefer the user's requested right-hand chain. Where the screen cannot
    /// fit another full pane, a bounded cascade remains reachable instead of
    /// moving a window off screen or resizing the owner's conversation.
    static func adjacentFrame(size: NSSize, source: NSRect?, visible: NSRect) -> NSRect {
        let width = min(size.width, visible.width), height = min(size.height, visible.height)
        let anchor = source ?? NSRect(x: visible.minX + 24, y: visible.maxY - height, width: 0, height: height)
        var x = anchor.maxX + 12
        if x + width > visible.maxX { x = anchor.minX - 28 }
        x = max(visible.minX, min(x, visible.maxX - width))
        let y = max(visible.minY, min(anchor.maxY - height, visible.maxY - height))
        return NSRect(x: x, y: y, width: width, height: height)
    }

    /// Isolated real-window fixture. It creates no live SessionStore and has
    /// no execution, account, queue, or filesystem callbacks.
    static func inspectorWindowSelfTest() async throws {
        let controller = AgentTaskInspectorWindows()
        let conversation = UUID(), submission = UUID(), root = UUID(), planner = UUID(), worker = UUID()
        let now = Date()
        let childScope = "subagent:abcdef123456"
        let childProgress = NativeExecutionProgress(sequence: 3, kind: .toolReturned, tool: "Read", scope: childScope,
            toolsRequested: 1, toolsReturned: 1, activeTools: 0, observedAt: now.addingTimeInterval(0.5), events: [
                .init(sequence: 1, kind: .ready, tool: nil, scope: "main", observedAt: now),
                .init(sequence: 2, kind: .toolStarted, tool: "Read", scope: childScope, observedAt: now),
                .init(sequence: 3, kind: .toolReturned, tool: "Read", scope: childScope, observedAt: now.addingTimeInterval(0.5)),
            ], steps: [.init(id: "abcdef654321", sequence: 2, tool: "Read", scope: childScope,
                verb: "read", label: "Read fixture source", state: .returned, startedAt: now,
                endedAt: now.addingTimeInterval(0.5))], stream: "111111111111")
        var snapshot = try ParallelAgentTask.Snapshot(conversationID: conversation, submissionID: submission,
            requestSHA256: String(repeating: "a", count: 64), rootNodeID: root, objective: "Inspect isolated parallel evidence",
            createdAt: now, updatedAt: now.addingTimeInterval(0.5), maxParallelism: 2, nodes: [
                .init(id: root, title: "Owner objective", role: .coordinator, state: .running, provider: "local", startedAt: now),
                .init(id: planner, parentID: root, title: "Bounded planner", role: .planner, state: .succeeded,
                    provider: "codex", startedAt: now, finishedAt: now),
                .init(id: worker, parentID: root, dependencies: [planner], title: "Read implementation", role: .worker,
                    state: .running, provider: "codex", model: "fixture-model", effort: "high", startedAt: now,
                    progressText: "Read request observed", tool: "Read", scope: .readOnly,
                    workspace: "/fixture/read-workspace", ownedPaths: [], nativeProgress: childProgress),
            ]).validated()
        var closeCalls = 0, checks = 0
        func check(_ value: Bool, _ message: String) throws {
            guard value else { throw InspectorFixtureFailure.failed(message) }; checks += 1
        }
        let projected = ObservedNativeAgentScopes.project(childProgress)
        try check(childProgress.isValid && projected.count == 1 && projected[0].scope == childScope,
            "only exact recorded native scope projected; main excluded")
        try check(projected[0].steps.count == 1 && projected[0].lastTool == "Read" && projected[0].lastObserved == now.addingTimeInterval(0.5),
            "projection preserves actual step/tool/observation timestamp")
        try check(!projected[0].taskCompletionEstablished && childProgress.activeTools == 0,
            "all tool returns never establish native task completion")
        let failedProgress = NativeExecutionProgress(sequence: 4, kind: .toolFailed, tool: "Read", scope: childScope,
            toolsRequested: 1, toolsReturned: 1, activeTools: 0, observedAt: now.addingTimeInterval(0.8),
            events: childProgress.events + [.init(sequence: 4, kind: .toolFailed, tool: "Read", scope: childScope, observedAt: now.addingTimeInterval(0.8))],
            steps: [.init(id: "abcdef654321", sequence: 2, tool: "Read", scope: childScope, verb: "read", label: "Read fixture source",
                state: .failed, startedAt: now, endedAt: now.addingTimeInterval(0.8))], stream: "111111111111")
        try check(failedProgress.isValid && ObservedNativeAgentScopes.project(failedProgress).first?.hasObservedError == true,
            "failed step/event remains error evidence without promoting task state")
        let source = NSWindow(contentRect: NSRect(x: 40, y: 80, width: 420, height: 620),
            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        source.isReleasedWhenClosed = false
        defer { controller.close(conversationID: conversation); source.close() }
        let state = AgentTaskInspectorState(conversationID: conversation, snapshot: snapshot, sessionTitle: "Isolated fixture", isLive: true)
        controller.open(state: state, adjacentTo: source) { closeCalls += 1 }
        guard let entry = controller.entries[conversation] else { throw InspectorFixtureFailure.failed("graph window missing") }
        try check(controller.hasWindow(conversationID: conversation) && entry.window.level == .normal,
            "real graph window is normal level")
        try check(entry.window !== source && entry.window.isVisible, "graph is a distinct visible window")
        try check(entry.model.state.snapshot?.planID == snapshot.planID, "window bound to original graph")
        entry.window.contentView?.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(40))
        guard let workerButton = inspectorButtons(entry.window.contentView).first(where: {
            $0.accessibilityIdentifier() == "os1.agent-tree.inspect." + worker.uuidString.lowercased()
        }) else { throw InspectorFixtureFailure.failed("production inspect-node button absent") }
        _ = workerButton.sendAction(workerButton.action, to: workerButton.target)
        guard let detail = entry.nodes[worker] else { throw InspectorFixtureFailure.failed("node click did not open detail") }
        try check(detail.window !== entry.window && detail.window.level == .normal && detail.window.isVisible,
            "node click opens distinct normal window")
        try check(detail.parentNodeID == nil, "first node detail anchored to graph")
        let detailIdentity = ObjectIdentifier(detail.window)
        controller.openNode(conversationID: conversation, nodeID: worker, adjacentTo: entry.window)
        try check(entry.nodes.count == 1 && ObjectIdentifier(entry.nodes[worker]!.window) == detailIdentity,
            "same node navigation reuses existing detail")
        detail.window.contentView?.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(40))
        let nativeKey = NativeAgentScopeWindowKey(nodeID: worker, scope: childScope)
        guard let nativeButton = inspectorButtons(detail.window.contentView).first(where: {
            $0.accessibilityIdentifier() == "os1.agent-tree.inspect-native." + nativeKey.identifier
        }) else { throw InspectorFixtureFailure.failed("observed native-scope button absent") }
        _ = nativeButton.sendAction(nativeButton.action, to: nativeButton.target)
        guard let nativeWindow = entry.nativeScopes[nativeKey] else { throw InspectorFixtureFailure.failed("native-scope button did not open window") }
        try check(nativeWindow.isVisible && nativeWindow.level == .normal && nativeWindow !== detail.window,
            "native observation opens distinct adjacent read-only window")
        controller.openNativeScope(conversationID: conversation, nodeID: worker, scope: childScope, adjacentTo: detail.window)
        try check(entry.nativeScopes.count == 1 && entry.nativeScopes[nativeKey] === nativeWindow, "native scope window reused by exact composite identity")
        controller.openNativeScope(conversationID: conversation, nodeID: worker, scope: "subagent:000000000000", adjacentTo: detail.window)
        controller.openNativeScope(conversationID: conversation, nodeID: planner, scope: childScope, adjacentTo: detail.window)
        controller.openNativeScope(conversationID: UUID(), nodeID: worker, scope: childScope, adjacentTo: detail.window)
        try check(entry.nativeScopes.count == 1, "unrecorded scope, foreign parent node and foreign conversation denied")
        guard let dependencyButton = inspectorButtons(detail.window.contentView).first(where: {
            $0.accessibilityIdentifier() == "os1.agent-tree.inspect." + planner.uuidString.lowercased()
        }) else { throw InspectorFixtureFailure.failed("actual dependency inspect button absent") }
        _ = dependencyButton.sendAction(dependencyButton.action, to: dependencyButton.target)
        try check(entry.nodes[planner]?.parentNodeID == worker && entry.nodes[planner]?.window.isVisible == true,
            "linked dependency detail opens from source detail")
        let keyBefore = NSApp.keyWindow
        snapshot.updatedAt = now.addingTimeInterval(1)
        snapshot.nodes[2].progressText = "Second actual observed event"
        controller.update(state: .init(conversationID: conversation, snapshot: snapshot,
            sessionTitle: "Updated fixture", isLive: true))
        try check(NSApp.keyWindow === keyBefore, "passive update never changes key window")
        try check(entry.model.state.snapshot?.nodes[2].progressText == "Second actual observed event",
            "existing detail observes live state updates")
        try check(entry.nativeScopes[nativeKey] === nativeWindow && !ObservedNativeAgentScopes.project(entry.model.state.snapshot?.nodes[2].nativeProgress)[0].taskCompletionEstablished,
            "live native observations remain separate from planned graph completion")
        var completedParent = snapshot
        completedParent.nodes[2].state = .succeeded; completedParent.nodes[2].finishedAt = snapshot.updatedAt
        controller.update(state: .init(conversationID: conversation, snapshot: completedParent, sessionTitle: "Worker finished", isLive: true))
        try check(entry.model.state.snapshot?.nodes[2].state == .succeeded && !ObservedNativeAgentScopes.project(entry.model.state.snapshot?.nodes[2].nativeProgress)[0].taskCompletionEstablished,
            "planned worker success does not fabricate native subagent completion")
        controller.closeNode(conversationID: conversation, nodeID: worker)
        try check(entry.nodes.isEmpty && entry.nativeScopes.isEmpty && !nativeWindow.isVisible && controller.hasWindow(conversationID: conversation) && closeCalls == 0,
            "closing node closes only its chain")
        controller.openNode(conversationID: conversation, nodeID: worker, adjacentTo: entry.window)
        snapshot.planID = UUID()
        controller.update(state: .init(conversationID: conversation, snapshot: snapshot, sessionTitle: "Replacement", isLive: true))
        try check(entry.nodes.isEmpty && controller.hasWindow(conversationID: conversation), "new plan invalidates stale node windows")
        controller.openNode(conversationID: conversation, nodeID: worker, adjacentTo: entry.window)
        controller.update(state: .init(conversationID: conversation, snapshot: nil, sessionTitle: "No current plan", isLive: true))
        try check(entry.nodes.isEmpty && entry.model.state.snapshot == nil, "unknown active graph clears stale details")
        let wrong = AgentTaskInspectorState(conversationID: UUID(), snapshot: snapshot, sessionTitle: "Foreign", isLive: true)
        try check(wrong.snapshot == nil, "foreign conversation graph rejected at view adapter")
        let observedID = UUID()
        let observation = ObservedSingleExecution(id: observedID, conversationID: conversation,
            objective: "Check the response path", state: "running", observedAt: now,
            provider: "codex", model: "fixture-model", effort: "low", surface: "gpt-chat",
            progressText: "Native request observed", startedAt: now)
        struct ObservationEnvelope: Codable {
            let authoritativeValue: String
            @ObservedExecutionField var observedExecution: ObservedSingleExecution? = nil
        }
        let envelope = ObservationEnvelope(authoritativeValue: "preserved", observedExecution: observation)
        let envelopeRoundTrip = try JSONDecoder().decode(ObservationEnvelope.self, from: JSONEncoder().encode(envelope))
        try check(envelopeRoundTrip.authoritativeValue == "preserved" && envelopeRoundTrip.observedExecution == observation,
            "single observation round trip preserves record independently from authoritative fields")
        for raw in [#"{"authoritativeValue":"preserved"}"#,
                    #"{"authoritativeValue":"preserved","observedExecution":null}"#,
                    #"{"authoritativeValue":"preserved","observedExecution":"future-unknown"}"#,
                    #"{"authoritativeValue":"preserved","observedExecution":{"unknown":true}}"#] {
            let decoded = try JSONDecoder().decode(ObservationEnvelope.self, from: Data(raw.utf8))
            try check(decoded.authoritativeValue == "preserved" && decoded.observedExecution == nil,
                "absent/null/malformed optional observation never loses authoritative session fields")
        }
        var invalidRecord = try JSONSerialization.jsonObject(with: JSONEncoder().encode(observation)) as! [String: Any]
        invalidRecord["objective"] = " "
        let invalidEnvelope = try JSONSerialization.data(withJSONObject: ["authoritativeValue": "preserved", "observedExecution": invalidRecord])
        let invalidDecoded = try JSONDecoder().decode(ObservationEnvelope.self, from: invalidEnvelope)
        try check(invalidDecoded.authoritativeValue == "preserved" && invalidDecoded.observedExecution == nil,
            "decodable but invalid optional observation is ignored without losing session data")
        let localObservation = ObservedSingleExecution(id: UUID(), conversationID: conversation,
            objective: "Check the local request path", state: "routing", observedAt: now, provider: "local")
        try check(localObservation.routeDescription == os1Tr("OS-1 (로컬)", "OS-1 (local)")
                  && localObservation.model == nil && localObservation.effort == nil,
            "local request remains local and unrecorded model/effort remain unknown")
        controller.update(state: .init(conversationID: conversation, snapshot: nil, sessionTitle: "One actual request", isLive: true,
            observedExecution: observation))
        try check(entry.model.state.snapshot == nil && entry.model.state.observedExecution?.id == observedID
                  && entry.nodes.isEmpty && entry.nativeScopes.isEmpty,
            "single observation does not fabricate a plan or planned child nodes")
        try check(observation.routeDescription.contains("fixture-model") && observation.nativeRecordVerified == nil
                  && observation.taskQuality == nil, "single observation preserves route and unknown verification fields")
        entry.window.contentView?.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(40))
        let observedButtons = inspectorButtons(entry.window.contentView).filter {
            $0.accessibilityIdentifier() == "os1.agent-tree.inspect." + observedID.uuidString.lowercased()
        }
        guard let observedButton = observedButtons.first else { throw InspectorFixtureFailure.failed("single observed execution inspect button absent") }
        try check(observedButtons.count == 1, "one actual request presents exactly one observed execution button")
        _ = observedButton.sendAction(observedButton.action, to: observedButton.target)
        guard let observedDetail = entry.observedWindow else { throw InspectorFixtureFailure.failed("single observation click did not open detail") }
        try check(observedDetail.id == observedID && observedDetail.window.isVisible && observedDetail.window.level == .normal
                  && observedDetail.window !== entry.window && entry.nodes.isEmpty,
            "observed execution opens adjacent normal detail without becoming a planned node")
        controller.openObservedExecution(conversationID: conversation, executionID: observedID, adjacentTo: entry.window)
        try check(entry.observedWindow?.window === observedDetail.window, "same observation navigation reuses exact detail window")
        let observedKeyWindow = NSApp.keyWindow
        let recorded = ObservedSingleExecution(id: observedID, conversationID: conversation,
            objective: observation.objective, state: "recorded", observedAt: now.addingTimeInterval(2),
            provider: "codex", model: "fixture-model", effort: "low", surface: "gpt-chat",
            progressText: "Recorded response returned", startedAt: now, finishedAt: now.addingTimeInterval(1),
            receiptPath: "/fixture/receipt.json", nativeSessionID: "fixture-native-session",
            nativeRecordVerified: true, taskQuality: "execution_only", publicAnswer: "A fixture response")
        controller.update(state: .init(conversationID: conversation, snapshot: nil, sessionTitle: "Recorded request", isLive: false,
            observedExecution: recorded))
        try check(entry.observedWindow?.window === observedDetail.window && NSApp.keyWindow === observedKeyWindow,
            "passive single-record update preserves detail identity and focus")
        try check(entry.model.state.observedExecution?.nativeRecordVerified == true
                  && entry.model.state.observedExecution?.taskQuality == "execution_only",
            "native verification does not upgrade recorded task-quality state")
        controller.update(state: .init(conversationID: conversation, snapshot: nil, sessionTitle: "Stale observation", isLive: true,
            observedExecution: observation))
        try check(entry.model.state.observedExecution?.state == "recorded", "older observation cannot replace newer record")
        controller.openObservedExecution(conversationID: UUID(), executionID: observedID, adjacentTo: entry.window)
        controller.openObservedExecution(conversationID: conversation, executionID: UUID(), adjacentTo: entry.window)
        try check(entry.observedWindow?.window === observedDetail.window, "foreign conversation and unrecorded execution cannot open observations")
        let foreignObservation = AgentTaskInspectorState(conversationID: UUID(), snapshot: nil, sessionTitle: "Foreign", isLive: true,
            observedExecution: observation)
        try check(foreignObservation.observedExecution == nil, "foreign observation rejected by conversation binding")
        let invalidObservation = ObservedSingleExecution(id: UUID(), conversationID: conversation, objective: " ", state: "running", observedAt: now)
        try check(AgentTaskInspectorState(conversationID: conversation, snapshot: nil, sessionTitle: "Invalid", isLive: true,
            observedExecution: invalidObservation).observedExecution == nil, "empty objective cannot create an observation")
        controller.closeObservedExecution(conversationID: conversation, executionID: observedID)
        try check(entry.observedWindow == nil && !observedDetail.window.isVisible && controller.hasWindow(conversationID: conversation)
                  && closeCalls == 0, "closing observed detail preserves root inspector and conversation")
        controller.openObservedExecution(conversationID: conversation, executionID: observedID, adjacentTo: entry.window)
        let replacement = ObservedSingleExecution(id: UUID(), conversationID: conversation, objective: "Next actual request", state: "routing", observedAt: now.addingTimeInterval(3))
        controller.update(state: .init(conversationID: conversation, snapshot: nil, sessionTitle: "Next request", isLive: true,
            observedExecution: replacement))
        try check(entry.observedWindow == nil && entry.model.state.observedExecution?.id == replacement.id,
            "new actual execution invalidates stale observed detail")
        controller.openObservedExecution(conversationID: conversation, executionID: replacement.id, adjacentTo: entry.window)
        controller.update(state: .init(conversationID: conversation, snapshot: snapshot, sessionTitle: "Actual plan", isLive: true,
            observedExecution: replacement))
        try check(entry.model.state.snapshot?.planID == snapshot.planID && entry.model.state.observedExecution == nil
                  && entry.observedWindow == nil, "valid planned graph supersedes observation without merging identities")
        let visible = NSRect(x: -400, y: 30, width: 900, height: 650)
        let adjacent = Self.adjacentFrame(size: .init(width: 360, height: 620), source: .init(x: -350, y: 40, width: 250, height: 630), visible: visible)
        let bounded = Self.adjacentFrame(size: .init(width: 1_000, height: 900), source: .init(x: 300, y: 500, width: 400, height: 500), visible: visible)
        try check(adjacent.minX == -88 && visible.contains(adjacent), "right adjacency with negative-origin display")
        try check(visible.contains(bounded), "screen overflow clamps entire window into visible area")
        entry.window.close()
        try check(!controller.hasWindow(conversationID: conversation) && closeCalls == 1, "graph close clears windows and invokes close callback once")
        print("Agent inspector windows: \(checks) checks PASS; real production windows/buttons, keyed detail chain, single execution observations, passive update focus, run invalidation; provider calls 0; live state writes 0")
    }
}

private enum InspectorFixtureFailure: Error { case failed(String) }

@MainActor
private func inspectorButtons(_ view: NSView?) -> [NSButton] {
    guard let view else { return [] }
    return (view as? NSButton).map { [$0] } ?? view.subviews.flatMap { inspectorButtons($0) }
}

/// Both graph rows and linked-node detail rows use the same real native hit
/// target; its public label is display data, never a runtime instruction.
@MainActor
struct AgentTaskInspectNodeButton: NSViewRepresentable {
    let nodeID: UUID
    let title: String
    let action: () -> Void
    func makeCoordinator() -> AgentTreeMarkerButton.Coordinator { .init(action) }
    func makeNSView(context: Context) -> NSButton {
        let button = NSButton()
        button.isBordered = false; button.setButtonType(.momentaryChange)
        button.target = context.coordinator
        button.action = #selector(AgentTreeMarkerButton.Coordinator.press(_:))
        updateNSView(button, context: context)
        return button
    }
    func updateNSView(_ button: NSButton, context: Context) {
        context.coordinator.action = action
        button.title = ""
        button.image = NSImage(systemSymbolName: "arrow.up.right.square", accessibilityDescription: nil)
        button.contentTintColor = NSColor(red: 0.93, green: 0.70, blue: 0.80, alpha: 1)
        button.setAccessibilityIdentifier("os1.agent-tree.inspect." + nodeID.uuidString.lowercased())
        let label = os1Tr("에이전트 진행 창 열기", "Open agent progress window") + " · " + title
        button.setAccessibilityLabel(label); button.toolTip = label
    }
}

@MainActor
private struct AgentTaskInspectorRootView: View {
    @ObservedObject var model: AgentTaskInspectorModel
    let onClose: () -> Void
    let onInspect: (ParallelAgentTask.Node) -> Void
    let onInspectObserved: (ObservedSingleExecution) -> Void
    var body: some View {
        AgentTaskTreeView(snapshot: model.state.snapshot, sessionTitle: model.state.sessionTitle,
            isLive: model.state.isLive, onClose: onClose, onInspectNode: onInspect,
            observedExecution: model.state.observedExecution, onInspectObservedExecution: onInspectObserved)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .environment(\.colorScheme, .dark)
    }
}

@MainActor
private struct ObservedSingleExecutionInspectorView: View {
    @ObservedObject var model: AgentTaskInspectorModel
    let executionID: UUID
    var body: some View {
        ScrollView {
            if model.state.snapshot == nil, let observation = model.state.observedExecution,
               observation.id == executionID {
                VStack(alignment: .leading, spacing: 14) {
                    Text(os1Tr("실제 실행 관측", "Observed execution"))
                        .font(.system(size: 15, weight: .semibold)).foregroundStyle(Color(red: 0.93, green: 0.70, blue: 0.80))
                    Text(model.state.isLive ? os1Tr("현재 요청/실행 상태", "Current request/execution state")
                        : os1Tr("저장된 실행 기록 · 현재 실행 여부를 뜻하지 않습니다", "Recorded execution · not a claim of current liveness"))
                        .font(.system(size: 10)).foregroundStyle(Color.white.opacity(0.5))
                    field(os1Tr("요청 목표", "Request objective"), observation.objective)
                    field(os1Tr("관측된 상태", "Recorded state"), observation.state)
                    field(os1Tr("실행 경로", "Execution route"), observation.routeDescription)
                    field(os1Tr("모델", "Model"), observation.model ?? os1Tr("미기록", "Not recorded"))
                    field(os1Tr("추론 설정", "Reasoning setting"), observation.effort ?? os1Tr("미기록", "Not recorded"))
                    if let surface = observation.surface { field(os1Tr("실제 실행 표면", "Actual execution surface"), surface) }
                    if let progress = observation.progressText { field(os1Tr("현재 관측", "Observed progress"), progress) }
                    field(os1Tr("실행 기록 검증", "Execution-record verification"), observation.nativeRecordVerified.map {
                        $0 ? os1Tr("검증됨 · 작업 완료나 품질 동등성을 뜻하지 않습니다", "Verified · does not establish task completion or quality parity")
                            : os1Tr("검증되지 않음", "Not verified")
                    } ?? os1Tr("미기록", "Not recorded"))
                    field(os1Tr("작업 품질 상태", "Task quality state"), observation.taskQuality ?? os1Tr("미확인", "Unverified"))
                    field(os1Tr("관측 시각", "Observed at"), observation.observedAt.formatted(date: .abbreviated, time: .standard))
                    if let start = observation.startedAt { field(os1Tr("시작", "Started"), start.formatted(date: .abbreviated, time: .standard)) }
                    if let finish = observation.finishedAt { field(os1Tr("종료", "Finished"), finish.formatted(date: .abbreviated, time: .standard)) }
                    field(os1Tr("요청/실행 ID", "Request/execution ID"), observation.id.uuidString.lowercased())
                    if let native = observation.nativeSessionID { field(os1Tr("네이티브 세션", "Native session"), native) }
                    if let receipt = observation.receiptPath { field(os1Tr("실행 영수증", "Execution receipt"), receipt) }
                    if let answer = observation.publicAnswer { field(os1Tr("기록된 공개 응답", "Recorded public answer"), answer) }
                    Text(os1Tr("실제 기록 한 건을 보여줍니다. 병렬 계획·하위 에이전트·완료율을 생성하지 않습니다.",
                               "Displays one actual record. It does not create a parallel plan, child agents, or completion percentage."))
                        .font(.system(size: 10)).foregroundStyle(Color.white.opacity(0.5))
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text(os1Tr("현재 상태에서 이 실행 관측을 확인할 수 없습니다.", "This execution observation is unavailable in the current state."))
                    .font(.system(size: 12)).padding(20)
            }
        }.foregroundStyle(Color.white.opacity(0.95))
            .background(Color(red: 0.015, green: 0.014, blue: 0.017)).environment(\.colorScheme, .dark)
            .accessibilityIdentifier("os1.agent-inspector.observed-content." + executionID.uuidString.lowercased())
    }
    private func field(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.system(size: 10, weight: .semibold)).foregroundStyle(Color.white.opacity(0.5))
            Text(value).font(.system(size: 12)).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }
    }
}

@MainActor
private struct AgentTaskNodeInspectorView: View {
    @ObservedObject var model: AgentTaskInspectorModel
    let nodeID: UUID
    let onInspect: (ParallelAgentTask.Node) -> Void
    let onInspectNativeScope: (String) -> Void
    private let pink = Color(red: 0.93, green: 0.70, blue: 0.80)
    var body: some View {
        ScrollView {
            if let graph = model.state.snapshot, let node = graph.nodes.first(where: { $0.id == nodeID }) {
                VStack(alignment: .leading, spacing: 15) {
                    Text(node.title).font(.system(size: 16, weight: .semibold)).textSelection(.enabled)
                    Text(node.role.rawValue + " · " + AgentTaskTreePresentation.stateTitle(node.state))
                        .font(.system(size: 12, weight: .medium)).foregroundStyle(pink)
                    Text(model.state.isLive ? os1Tr("현재 실행 관측", "Current execution observation")
                        : os1Tr("저장된 실행 기록 · 현재 실행 여부를 뜻하지 않습니다", "Recorded execution · not a claim of current liveness"))
                        .font(.system(size: 10)).foregroundStyle(Color.white.opacity(0.5))
                    field(os1Tr("전체 목표", "Shared objective"), graph.objective)
                    field(os1Tr("실행 경로", "Execution route"), AgentTaskTreePresentation.route(node))
                    if let surface = node.surface { field(os1Tr("실제 실행 표면", "Actual execution surface"), surface) }
                    if let scope = node.scope {
                        field(os1Tr("실제 권한 범위", "Actual permission scope"), scope.rawValue)
                        Text(scope == .readOnly ? os1Tr("읽기 전용 준비 · 구현 또는 변경 작업이 아닙니다", "Read-only preparation · not implementation or modification")
                            : os1Tr("기록된 소유 범위 안에서 쓰기 작업", "Write work within the recorded owned scope"))
                            .font(.system(size: 10)).foregroundStyle(pink)
                    }
                    if let workspace = node.workspace { field(os1Tr("실제 작업 공간 / 워크트리", "Actual workspace / worktree"), workspace) }
                    if let paths = node.ownedPaths, !paths.isEmpty {
                        field(os1Tr("소유 쓰기 경로", "Owned write paths"), paths.joined(separator: "\n"))
                    }
                    if let progress = node.progressText { field(os1Tr("현재 관측", "Observed progress"), progress) }
                    if let tool = node.tool { field(os1Tr("관측 도구", "Observed tool"), tool) }
                    if let start = node.startedAt { field(os1Tr("시작", "Started"), start.formatted(date: .omitted, time: .standard)) }
                    if let finish = node.finishedAt { field(os1Tr("종료", "Finished"), finish.formatted(date: .omitted, time: .standard)) }
                    if let failure = node.failureSummary { field(os1Tr("실패 기록", "Failure"), failure) }
                    if let result = node.resultSummary { field(os1Tr("노드 결과", "Node result"), result) }
                    if let native = node.nativeSessionID { field(os1Tr("네이티브 세션", "Native session"), String(native.prefix(8))) }
                    if let worker = node.workerSubmissionID { field(os1Tr("작업 실행 ID", "Worker execution"), String(worker.uuidString.prefix(8))) }
                    let children = graph.nodes.filter { $0.parentID == node.id }
                    if !children.isEmpty { linkedNodes(os1Tr("기록된 하위 작업", "Recorded child tasks"), children) }
                    if !node.dependencies.isEmpty {
                        linkedNodes(os1Tr("의존 작업", "Dependencies"), graph.nodes.filter { node.dependencies.contains($0.id) })
                    }
                    let observedScopes = ObservedNativeAgentScopes.project(node.nativeProgress)
                    if !observedScopes.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(os1Tr("관측된 네이티브 하위 에이전트", "Observed native subagents"))
                                .font(.system(size: 11, weight: .semibold)).foregroundStyle(pink)
                            Text(os1Tr("이 목록은 백엔드 도구 신호이며 OS-1의 계획 노드가 아닙니다.",
                                "Backend tool observations, separate from OS-1's planned task nodes."))
                                .font(.system(size: 10)).foregroundStyle(Color.white.opacity(0.5))
                            ForEach(observedScopes) { observation in
                                HStack(spacing: 8) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(observation.scope).font(.system(size: 11, weight: .medium))
                                        if let tool = observation.lastTool { Text(tool).font(.system(size: 10)).foregroundStyle(Color.white.opacity(0.5)) }
                                        if observation.hasObservedError { Text(os1Tr("오류 도구 신호 관측", "Failed tool signal observed")).font(.system(size: 10)).foregroundStyle(.orange) }
                                    }.contentShape(Rectangle()).onTapGesture { onInspectNativeScope(observation.scope) }
                                    Spacer(minLength: 0)
                                    AgentTaskInspectNativeScopeButton(nodeID: node.id, scope: observation.scope) {
                                        onInspectNativeScope(observation.scope)
                                    }.frame(width: 24, height: 24)
                                }.padding(10).background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 8))
                            }
                        }
                    }
                    if children.isEmpty {
                        Text(os1Tr("이 노드에 기록된 하위 작업은 없습니다. 관측되지 않은 분기를 만들어 표시하지 않습니다.",
                            "No child tasks are recorded for this node. Unobserved branches are not invented."))
                            .font(.system(size: 10)).foregroundStyle(Color.white.opacity(0.5))
                    }
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text(os1Tr("현재 계획에서 이 노드를 확인할 수 없습니다.", "This node is unavailable in the current plan."))
                    .font(.system(size: 13)).padding(20)
            }
        }
        .foregroundStyle(Color.white.opacity(0.95))
        .background(Color(red: 0.015, green: 0.014, blue: 0.017))
        .environment(\.colorScheme, .dark)
        .accessibilityIdentifier("os1.agent-inspector.node-content." + nodeID.uuidString.lowercased())
    }
    private func field(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.system(size: 10, weight: .semibold)).foregroundStyle(Color.white.opacity(0.5))
            Text(value).font(.system(size: 12)).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }
    }
    private func linkedNodes(_ title: String, _ nodes: [ParallelAgentTask.Node]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(pink)
            ForEach(nodes, id: \.id) { node in
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(node.title).font(.system(size: 12, weight: .medium))
                        Text(AgentTaskTreePresentation.stateTitle(node.state)).font(.system(size: 10)).foregroundStyle(Color.white.opacity(0.5))
                    }.contentShape(Rectangle()).onTapGesture { onInspect(node) }
                    Spacer(minLength: 0)
                    AgentTaskInspectNodeButton(nodeID: node.id, title: node.title) { onInspect(node) }.frame(width: 24, height: 24)
                }.padding(10).background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }
}

@MainActor
private struct AgentTaskInspectNativeScopeButton: NSViewRepresentable {
    let nodeID: UUID
    let scope: String
    let action: () -> Void
    func makeCoordinator() -> AgentTreeMarkerButton.Coordinator { .init(action) }
    func makeNSView(context: Context) -> NSButton {
        let button = NSButton()
        button.isBordered = false; button.setButtonType(.momentaryChange)
        button.target = context.coordinator; button.action = #selector(AgentTreeMarkerButton.Coordinator.press(_:))
        updateNSView(button, context: context); return button
    }
    func updateNSView(_ button: NSButton, context: Context) {
        context.coordinator.action = action; button.title = ""
        button.image = NSImage(systemSymbolName: "arrow.up.right.square", accessibilityDescription: nil)
        button.contentTintColor = NSColor(red: 0.93, green: 0.70, blue: 0.80, alpha: 1)
        let key = NativeAgentScopeWindowKey(nodeID: nodeID, scope: scope)
        button.setAccessibilityIdentifier("os1.agent-tree.inspect-native." + key.identifier)
        button.setAccessibilityLabel(os1Tr("관측된 네이티브 하위 에이전트 창 열기", "Open observed native subagent window") + " · " + scope)
    }
}

@MainActor
private struct NativeAgentScopeInspectorView: View {
    @ObservedObject var model: AgentTaskInspectorModel
    let key: NativeAgentScopeWindowKey
    var body: some View {
        ScrollView {
            if let graph = model.state.snapshot, let node = graph.nodes.first(where: { $0.id == key.nodeID }),
               let observation = ObservedNativeAgentScopes.project(node.nativeProgress).first(where: { $0.scope == key.scope }) {
                VStack(alignment: .leading, spacing: 14) {
                    Text(os1Tr("관측된 네이티브 하위 에이전트", "Observed native subagent"))
                        .font(.system(size: 15, weight: .semibold)).foregroundStyle(Color(red: 0.93, green: 0.70, blue: 0.80))
                    field(os1Tr("관측 범위 ID", "Observed scope ID"), observation.scope)
                    field(os1Tr("상위 계획 작업", "Parent planned task"), node.title)
                    field(os1Tr("전체 목표", "Shared objective"), graph.objective)
                    if let observed = observation.lastObserved {
                        field(os1Tr("마지막 수신 관측", "Last received observation"), observed.formatted(date: .omitted, time: .standard))
                    }
                    if let tool = observation.lastTool { field(os1Tr("마지막 관측 도구", "Last observed tool"), tool) }
                    field(os1Tr("하위 작업 완료", "Subagent task completion"), os1Tr("미확인 · 도구 반환은 작업 완료 증거가 아닙니다", "Unconfirmed · tool returns are not task-completion evidence"))
                    if observation.hasObservedError { field(os1Tr("오류 관측", "Error observation"), os1Tr("실패 도구 신호가 기록됐습니다", "A failed tool signal was recorded")) }
                    Text(os1Tr("기록된 도구 단계", "Recorded tool steps")).font(.system(size: 12, weight: .semibold))
                    ForEach(observation.steps, id: \.id) { step in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(step.tool + " · " + step.state.rawValue).font(.system(size: 12, weight: .medium))
                            if let label = step.label { Text(label).font(.system(size: 11)).textSelection(.enabled) }
                        }.padding(10).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 8))
                    }
                    if let last = observation.latestEvent {
                        field(os1Tr("마지막 수신 신호", "Last received signal"), last.kind.rawValue)
                    }
                    Text(os1Tr("최근 수신된 제한된 도구 기록입니다. 별도 세션·모델·진행률이나 종료 상태를 추정하지 않습니다.",
                        "Bounded recent tool observations; no separate session, model, percentage, or terminal state is inferred."))
                        .font(.system(size: 10)).foregroundStyle(Color.white.opacity(0.5))
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text(os1Tr("현재 수신 기록에서 이 하위 에이전트 범위를 확인할 수 없습니다.", "This native subagent scope is unavailable in the current observations."))
                    .font(.system(size: 12)).padding(20)
            }
        }.foregroundStyle(Color.white.opacity(0.95))
            .background(Color(red: 0.015, green: 0.014, blue: 0.017)).environment(\.colorScheme, .dark)
            .accessibilityIdentifier("os1.agent-inspector.native-content." + key.identifier)
    }
    private func field(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.system(size: 10, weight: .semibold)).foregroundStyle(Color.white.opacity(0.5))
            Text(value).font(.system(size: 12)).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// Kept callable beside the existing app fixture entry point.
@MainActor
func inspectorWindowSelfTest() async throws { try await AgentTaskInspectorWindows.inspectorWindowSelfTest() }
