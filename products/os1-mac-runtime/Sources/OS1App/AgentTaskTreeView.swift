import AppKit
import Foundation
import OS1Context
import SwiftUI

/// Optional display telemetry must not poison a legacy conversation/result.
/// Malformed/future snapshots are ignored; original conversation data remains.
@propertyWrapper
struct AgentTaskSnapshotField: Codable, Sendable {
    var wrappedValue: ParallelAgentTask.Snapshot?
    init(wrappedValue: ParallelAgentTask.Snapshot? = nil) { self.wrappedValue = wrappedValue }
    init(from decoder: Decoder) throws {
        wrappedValue = (try? ParallelAgentTask.Snapshot(from: decoder)).flatMap { try? $0.validated() }
    }
    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        if let wrappedValue { try value.encode(wrappedValue) } else { try value.encodeNil() }
    }
}

extension KeyedDecodingContainer {
    func decode(_ type: AgentTaskSnapshotField.Type, forKey key: Key) throws -> AgentTaskSnapshotField {
        (try? decodeIfPresent(type, forKey: key)) ?? AgentTaskSnapshotField()
    }
}

private enum AgentTreeStyle {
    static let background = Color(red: 0.015, green: 0.014, blue: 0.017)
    static let card = Color(red: 0.035, green: 0.029, blue: 0.034)
    static let pink = Color(red: 0.93, green: 0.70, blue: 0.80)
    static let muted = Color.white.opacity(0.47)
    static let border = Color.white.opacity(0.14)
}

/// The fixed header is native AppKit. Concrete CUA observations found
/// intermittent SwiftUI static-header paint loss across state transitions;
/// the task graph/card data stays unchanged by this bounded intervention.
@MainActor
final class AgentTreeNativeHeaderView: NSView {
    let captionField = NSTextField(labelWithString: "")
    let sessionField = NSTextField(labelWithString: "")
    let closeButton = NSButton()
    private let stack = NSStackView()
    var onClose: () -> Void = {}
    override var isFlipped: Bool { true }
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor(red: 0.015, green: 0.014, blue: 0.017, alpha: 1).cgColor
        captionField.font = .systemFont(ofSize: 12, weight: .semibold)
        captionField.textColor = NSColor(red: 0.93, green: 0.70, blue: 0.80, alpha: 1)
        captionField.setAccessibilityIdentifier("os1.agent-tree.header-title")
        sessionField.font = .systemFont(ofSize: 12)
        sessionField.textColor = NSColor.white.withAlphaComponent(0.95)
        sessionField.maximumNumberOfLines = 2
        sessionField.lineBreakMode = .byTruncatingTail
        sessionField.setAccessibilityIdentifier("os1.agent-tree.session-title")
        let caption = NSStackView(views: [captionField])
        caption.orientation = .horizontal; caption.alignment = .centerY; caption.spacing = 4
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 5
        stack.addArrangedSubview(caption); stack.addArrangedSubview(sessionField)
        stack.translatesAutoresizingMaskIntoConstraints = false
        closeButton.isBordered = false; closeButton.setButtonType(.momentaryChange)
        closeButton.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: nil)
        closeButton.contentTintColor = NSColor.white.withAlphaComponent(0.95)
        closeButton.target = self; closeButton.action = #selector(closePressed(_:))
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        closeButton.setAccessibilityIdentifier("os1.agent-tree.close")
        addSubview(stack); addSubview(closeButton)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 40),
            stack.trailingAnchor.constraint(equalTo: closeButton.leadingAnchor, constant: -12),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: bottomAnchor, constant: -16),
            sessionField.widthAnchor.constraint(equalTo: stack.widthAnchor),
            closeButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
            closeButton.topAnchor.constraint(equalTo: topAnchor, constant: 40),
            closeButton.widthAnchor.constraint(equalToConstant: 24),
            closeButton.heightAnchor.constraint(equalToConstant: 24),
        ])
    }
    required init?(coder: NSCoder) { fatalError("AgentTreeNativeHeaderView is programmatic") }
    func update(sessionTitle: String, onClose: @escaping () -> Void) {
        self.onClose = onClose
        captionField.stringValue = os1Tr("에이전트 작업 트리", "Agent task tree")
        sessionField.stringValue = sessionTitle
        closeButton.toolTip = os1Tr("작업 트리 닫기", "Close task tree")
        closeButton.setAccessibilityLabel(closeButton.toolTip)
        needsLayout = true; needsDisplay = true
    }
    @objc private func closePressed(_ sender: NSButton) { onClose() }
}

@MainActor
struct AgentTreeNativeHeader: NSViewRepresentable {
    let sessionTitle: String
    let onClose: () -> Void
    func makeNSView(context: Context) -> AgentTreeNativeHeaderView { AgentTreeNativeHeaderView(frame: .zero) }
    func updateNSView(_ view: AgentTreeNativeHeaderView, context: Context) {
        view.update(sessionTitle: sessionTitle, onClose: onClose)
    }
}

/// Real AppKit hit target at the RIGHT of the selected session row. An
/// independent button avoids SwiftUI nested-button action propagation.
@MainActor
final class AgentTreeMarkerNSButton: NSButton {
    var expanded = false { didSet { needsDisplay = true } }
    override func draw(_ dirtyRect: NSRect) {
        let bar = NSRect(x: bounds.midX - 1.5, y: 7, width: 3, height: max(3, bounds.height - 14))
        NSColor(red: 0.93, green: 0.70, blue: 0.80, alpha: isHighlighted ? 0.75 : 1).setFill()
        NSBezierPath(roundedRect: bar, xRadius: 1.5, yRadius: 1.5).fill()
    }
}

@MainActor
struct AgentTreeMarkerButton: NSViewRepresentable {
    let expanded: Bool
    let action: () -> Void
    final class Coordinator: NSObject {
        var action: () -> Void
        init(_ action: @escaping () -> Void) { self.action = action }
        @objc func press(_ sender: NSButton) { action() }
    }
    func makeCoordinator() -> Coordinator { Coordinator(action) }
    func makeNSView(context: Context) -> AgentTreeMarkerNSButton {
        let button = AgentTreeMarkerNSButton()
        button.title = ""; button.isBordered = false
        button.setButtonType(.momentaryChange)
        button.target = context.coordinator; button.action = #selector(Coordinator.press(_:))
        button.setAccessibilityIdentifier("os1.session.agent-tree-toggle")
        updateNSView(button, context: context)
        return button
    }
    func updateNSView(_ button: AgentTreeMarkerNSButton, context: Context) {
        context.coordinator.action = action; button.expanded = expanded
        button.toolTip = expanded ? os1Tr("에이전트 작업 트리 닫기", "Close agent task tree")
            : os1Tr("이 대화의 에이전트 작업 트리 열기", "Open this conversation's agent task tree")
        button.setAccessibilityLabel(button.toolTip)
        button.setAccessibilityValue(expanded ? os1Tr("열림", "Open") : os1Tr("닫힘", "Closed"))
    }
}

@MainActor
final class AgentTaskTreeDisclosure: ObservableObject {
    @Published private(set) var expanded: Set<UUID>
    private(set) var planID: UUID?
    init(planID: UUID? = nil, initiallyExpanded: Set<UUID> = []) {
        self.planID = planID; expanded = initiallyExpanded
    }
    func toggle(_ id: UUID) {
        if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
    }
    func bind(_ snapshot: ParallelAgentTask.Snapshot?) {
        guard planID != snapshot?.planID else { return }
        planID = snapshot?.planID
        expanded = []
    }
}

/// Native disclosure controls also make the production tree testable with
/// actual mouse events instead of a source-grep or a decorative mock.
@MainActor
struct AgentTreeDisclosureButton: NSViewRepresentable {
    let nodeID: UUID
    let expanded: Bool
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
        button.image = NSImage(systemSymbolName: expanded ? "chevron.down" : "chevron.right", accessibilityDescription: nil)
        button.contentTintColor = NSColor.white.withAlphaComponent(0.75)
        button.setAccessibilityIdentifier("os1.agent-tree.node." + nodeID.uuidString.lowercased())
        button.setAccessibilityLabel(os1Tr("에이전트 노드 펼치기/접기", "Expand or collapse agent node"))
        button.setAccessibilityValue(expanded ? "expanded" : "collapsed")
    }
}

struct AgentTreeVisibleNode: Identifiable {
    let node: ParallelAgentTask.Node
    let depth: Int
    var isLastSibling = true
    var id: UUID { node.id }
}

/// Parent edges define the outline. Dependencies are independently displayed
/// DAG edges, never fabricated from list order or execution timestamps.
enum AgentTaskTreePresentation {
    static func rows(_ snapshot: ParallelAgentTask.Snapshot, expanded: Set<UUID>) -> [AgentTreeVisibleNode] {
        guard snapshot.isValid else { return [] }
        var result: [AgentTreeVisibleNode] = [], visited: Set<UUID> = []
        func append(_ node: ParallelAgentTask.Node, depth: Int, isLastSibling: Bool = true) {
            guard visited.insert(node.id).inserted, depth <= 12 else { return }
            result.append(AgentTreeVisibleNode(node: node, depth: depth, isLastSibling: isLastSibling))
            // Root details start closed, but the task split remains visible.
            if depth == 0 || expanded.contains(node.id) {
                let children = snapshot.nodes.filter { $0.parentID == node.id }
                for (index, child) in children.enumerated() {
                    append(child, depth: depth + 1, isLastSibling: index == children.count - 1)
                }
            }
        }
        if let root = snapshot.nodes.first(where: { $0.id == snapshot.rootNodeID }) { append(root, depth: 0) }
        return result
    }
    static func stateTitle(_ state: ParallelAgentTask.State) -> String {
        switch state {
        case .pending: return os1Tr("대기", "Pending")
        case .running: return os1Tr("실행 중", "Running")
        case .succeeded: return os1Tr("노드 실행 성공", "Node succeeded")
        case .failed: return os1Tr("실패", "Failed")
        case .blocked: return os1Tr("차단됨", "Blocked")
        case .cancelled: return os1Tr("취소됨", "Cancelled")
        case .interrupted: return os1Tr("중단 · 결과 미확인", "Interrupted · outcome unconfirmed")
        }
    }
    static func route(_ node: ParallelAgentTask.Node) -> String {
        guard let provider = node.provider else { return os1Tr("실행 제공자 아직 관측 안 됨", "Execution provider not observed yet") }
        return [provider, node.model, node.effort].compactMap { $0 }.joined(separator: " · ")
    }
}

/// Connectors are drawn from actual parent edges, independently of DAG
/// dependencies. Continuous row spines and elbows make the split literal.
private struct AgentTreeBranchLines: Shape {
    let depth: Int
    let lastSibling: Bool
    func path(in rect: CGRect) -> Path {
        var path = Path()
        guard depth > 0 else { return path }
        let spine = CGFloat(depth - 1) * 26 + 20
        let child = CGFloat(depth) * 26
        let middle = (rect.height + 9) / 2
        path.move(to: CGPoint(x: spine, y: 0))
        path.addLine(to: CGPoint(x: spine, y: lastSibling ? middle : rect.height))
        path.move(to: CGPoint(x: spine, y: middle))
        path.addLine(to: CGPoint(x: child, y: middle))
        return path
    }
}

@MainActor
struct AgentTaskTreeView: View {
    let snapshot: ParallelAgentTask.Snapshot?
    let sessionTitle: String
    let isLive: Bool
    let onClose: () -> Void
    @StateObject private var disclosure: AgentTaskTreeDisclosure
    init(snapshot: ParallelAgentTask.Snapshot?, sessionTitle: String, isLive: Bool = false, onClose: @escaping () -> Void,
         disclosure: AgentTaskTreeDisclosure? = nil) {
        self.snapshot = snapshot; self.sessionTitle = sessionTitle; self.isLive = isLive; self.onClose = onClose
        _disclosure = StateObject(wrappedValue: disclosure ?? AgentTaskTreeDisclosure(planID: snapshot?.planID))
    }
    private var validated: ParallelAgentTask.Snapshot? { snapshot.flatMap { try? $0.validated() } }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().overlay(AgentTreeStyle.border)
            if let graph = validated {
                graphSummary(graph)
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(AgentTaskTreePresentation.rows(graph, expanded: disclosure.expanded)) { row in
                            nodeCard(row, graph: graph)
                                .padding(.leading, CGFloat(row.depth) * 26)
                                .padding(.top, row.depth == 0 ? 0 : 9)
                                .overlay {
                                    AgentTreeBranchLines(depth: row.depth, lastSibling: row.isLastSibling)
                                        .stroke(AgentTreeStyle.pink.opacity(0.34), lineWidth: 1.25)
                                        .allowsHitTesting(false)
                                }
                        }
                    }.padding(14)
                }
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    Image(systemName: "point.3.connected.trianglepath.dotted").font(.system(size: 25))
                    Text(snapshot == nil ? os1Tr("이 대화에 기록된 에이전트 계획이 없습니다.", "No recorded agent plan for this conversation.")
                        : os1Tr("유효한 실행 트리를 확인할 수 없습니다.", "A valid execution tree is unavailable."))
                        .font(.system(size: 13, weight: .medium))
                    Text(os1Tr("단일 실행·이전 대화에는 분기나 진행률을 만들어 표시하지 않습니다.",
                               "Single runs and legacy conversations do not imply agent branches or progress."))
                        .font(.system(size: 11)).foregroundStyle(AgentTreeStyle.muted)
                }.padding(20)
                Spacer()
            }
        }
        .foregroundStyle(Color.white.opacity(0.95))
        .background(AgentTreeStyle.background)
        .accessibilityIdentifier("os1.agent-tree.panel")
        .onAppear { disclosure.bind(validated) }
        .onChange(of: snapshot?.planID) { _ in disclosure.bind(validated) }
        .onExitCommand(perform: onClose)
    }
    private var header: some View {
        AgentTreeNativeHeader(sessionTitle: sessionTitle, onClose: onClose).frame(height: 104)
    }
    private func graphSummary(_ graph: ParallelAgentTask.Snapshot) -> some View {
        let running = graph.nodes.filter { $0.role == .worker && $0.state == .running }.count
        let closed = graph.nodes.filter { ![.pending, .running].contains($0.state) }.count
        return VStack(alignment: .leading, spacing: 8) {
            Text(graph.objective).font(.system(size: 12)).lineLimit(6).textSelection(.enabled)
            Text(isLive ? os1Tr("현재 실행 관측", "Current execution observation")
                : os1Tr("저장된 실행 기록 · 현재 실행 여부를 뜻하지 않습니다", "Recorded execution · not a claim of current liveness"))
                .font(.system(size: 10, weight: .medium)).foregroundStyle(AgentTreeStyle.pink)
            Text(os1Tr("워커 실행 \(running) · 종료 노드 \(closed)/\(graph.nodes.count) · 워커 제한 \(graph.maxParallelism)",
                       "Workers running \(running) · closed nodes \(closed)/\(graph.nodes.count) · worker limit \(graph.maxParallelism)"))
                .font(.system(size: 10, weight: .medium)).foregroundStyle(AgentTreeStyle.muted)
        }.padding(14).background(Color.white.opacity(0.025))
    }
    private func nodeCard(_ row: AgentTreeVisibleNode, graph: ParallelAgentTask.Snapshot) -> some View {
        let node = row.node, open = disclosure.expanded.contains(row.id)
        return VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .top, spacing: 8) {
                AgentTreeDisclosureButton(nodeID: node.id, expanded: open, action: { disclosure.toggle(node.id) })
                    .frame(width: 18, height: 22)
                VStack(alignment: .leading, spacing: 5) {
                    Text(node.title).font(.system(size: 12, weight: .semibold)).lineLimit(3)
                    Text(node.role.rawValue + " · " + AgentTaskTreePresentation.stateTitle(node.state))
                        .font(.system(size: 10)).foregroundStyle(stateColor(node.state))
                }.contentShape(Rectangle()).onTapGesture { disclosure.toggle(node.id) }
                Spacer(minLength: 0)
            }
            Text(AgentTaskTreePresentation.route(node)).font(.system(size: 10)).foregroundStyle(AgentTreeStyle.muted)
            if let progress = node.progressText { Text(progress).font(.system(size: 11)).lineLimit(open ? nil : 2) }
            if open { nodeDetails(node, graph: graph) }
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AgentTreeStyle.card, in: RoundedRectangle(cornerRadius: 10))
        .overlay(alignment: .leading) {
            if row.depth > 0 { RoundedRectangle(cornerRadius: 1).fill(AgentTreeStyle.border).frame(width: 2).padding(.vertical, 8) }
        }
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(stateColor(node.state).opacity(0.2), lineWidth: 1))
        .accessibilityIdentifier("os1.agent-tree.card." + node.id.uuidString.lowercased())
    }
    @ViewBuilder
    private func nodeDetails(_ node: ParallelAgentTask.Node, graph: ParallelAgentTask.Snapshot) -> some View {
        Divider().overlay(AgentTreeStyle.border)
        detail(os1Tr("목표", "Objective"), [.coordinator, .primary].contains(node.role) ? graph.objective : node.title)
        if !node.dependencies.isEmpty {
            detail(os1Tr("의존 노드", "Dependencies"), node.dependencies.map { id in
                graph.nodes.first(where: { $0.id == id })?.title ?? String(id.uuidString.prefix(8))
            }.joined(separator: " · "))
        }
        if let parent = node.parentID, let title = graph.nodes.first(where: { $0.id == parent })?.title {
            detail(os1Tr("상위 노드", "Parent"), title)
        }
        if let tool = node.tool { detail(os1Tr("관측 도구", "Observed tool"), tool) }
        if let started = node.startedAt { detail(os1Tr("실행 시작", "Started"), started.formatted(date: .omitted, time: .standard)) }
        if let finished = node.finishedAt { detail(os1Tr("종료", "Finished"), finished.formatted(date: .omitted, time: .standard)) }
        if let worker = node.workerSubmissionID { detail(os1Tr("작업 실행 ID", "Worker execution"), String(worker.uuidString.prefix(8))) }
        if let native = node.nativeSessionID { detail(os1Tr("네이티브 세션", "Native session"), String(native.prefix(8))) }
        if let failure = node.failureSummary { detail(os1Tr("실패 기록", "Failure"), failure) }
        if let result = node.resultSummary { detail(os1Tr("노드 결과", "Node result"), result) }
    }
    private func detail(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.system(size: 9, weight: .semibold)).foregroundStyle(AgentTreeStyle.muted)
            Text(value).font(.system(size: 11)).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }
    }
    private func stateColor(_ state: ParallelAgentTask.State) -> Color {
        switch state {
        case .running: return AgentTreeStyle.pink
        case .succeeded: return Color(red: 0.28, green: 0.93, blue: 0.55)
        case .failed, .blocked: return Color(red: 0.99, green: 0.78, blue: 0.35)
        default: return AgentTreeStyle.muted
        }
    }
}
