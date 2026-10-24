import AppKit
import Foundation
import OS1Context

// Routing lanes: one routed turn drawn inside the conversation as equal-width
// lanes, one per route the task ran, each with its route, model and reasoning,
// a status that changes in place, and its answer once it returned. Display
// only: it reads the same graph the Agent task tree reads (live) and the
// finished Core snapshot (saved with the turn). It never schedules, retries or
// certifies anything, and it adds no state Core does not report. Saved records
// hold codes and Core's own words; every label is written in the interface
// language when the turn is drawn.

/// What a lane is doing, in the owner's words. Every value comes from a state
/// Core or the observed graph reports; none is inferred from time.
enum RouteLaneStatus: String, Codable, Sendable, CaseIterable {
    /// Core is still interpreting or planning the request; no route yet.
    case planning
    /// Planned, not dispatched yet (Core pending/ready/queued).
    case queued
    /// The route is executing (Core running).
    case processing
    /// The route returned and Core is checking it before it is delivered
    /// (Core child `waiting`: node verifier, continuation or ladder check), or,
    /// for the whole task, every route returned and the task check is open.
    case verifying
    /// Core is stopping the task (Core `cancelling`).
    case cancelling
    /// The task returned output whose task quality was not verified.
    case returned
    case completed
    case failed
    case held
    case cancelled
    /// Side effects uncertain; replay is not authorized.
    case interrupted
    /// The task ended before this route ran, or Core skipped the route.
    case skipped
    /// The task ended while Core still listed this route as running or
    /// waiting: Core reported no final state for it.
    case unreported

    var title: String {
        switch self {
        case .planning: return os1Tr("계획 중", "Planning")
        case .queued: return os1Tr("대기", "Queued")
        case .processing: return os1Tr("처리 중", "Processing")
        case .verifying: return os1Tr("검증 중", "Verifying")
        case .cancelling: return os1Tr("취소 중", "Cancelling")
        case .returned: return os1Tr("수신 · 미검증", "Returned · unverified")
        case .completed: return os1Tr("완료", "Completed")
        case .failed: return os1Tr("실패", "Failed")
        case .held: return os1Tr("보류", "Held")
        case .cancelled: return os1Tr("취소됨", "Cancelled")
        case .interrupted: return os1Tr("중단 · 효과 불확실", "Interrupted · effects uncertain")
        case .skipped: return os1Tr("실행 안 됨", "Not run")
        case .unreported: return os1Tr("상태 미보고", "Not reported")
        }
    }

    /// Drawn inside the pill by the transcript view, never part of the text,
    /// so VoiceOver reads the status word alone.
    var glyph: String {
        switch self {
        case .planning: return "◇"
        case .queued: return "○"
        case .processing: return "●"
        case .verifying: return "◐"
        case .cancelling: return "◌"
        case .returned: return "◑"
        case .completed: return "✓"
        case .failed: return "✕"
        case .held: return "‖"
        case .cancelled, .skipped: return "–"
        case .interrupted: return "!"
        case .unreported: return "?"
        }
    }

    var isTerminal: Bool { ![.planning, .queued, .processing, .verifying, .cancelling].contains(self) }

    /// The only meaning colour carries on a lane: its status. No route uses
    /// any of these hues (`RouteLaneSurface.tint`).
    var color: NSColor {
        switch self {
        case .planning, .queued, .cancelling, .cancelled, .skipped, .unreported: return RouteLanePalette.gray
        case .processing: return RouteLanePalette.pink
        case .verifying: return RouteLanePalette.violet
        case .returned, .held: return RouteLanePalette.yellow
        case .completed: return RouteLanePalette.green
        case .failed, .interrupted: return RouteLanePalette.red
        }
    }
}

/// Fixed colors: the production window is always dark
/// (`.preferredColorScheme(.dark)`), so nothing here adapts to the system
/// appearance.
enum RouteLanePalette {
    static let text = NSColor.white.withAlphaComponent(0.95)
    static let secondary = NSColor.white.withAlphaComponent(0.74)
    static let muted = NSColor.white.withAlphaComponent(0.50)
    static let gray = NSColor.white.withAlphaComponent(0.56)
    // Status hues.
    static let pink = NSColor(calibratedRed: 0.93, green: 0.70, blue: 0.80, alpha: 1)
    static let violet = NSColor(calibratedRed: 0.80, green: 0.62, blue: 1.0, alpha: 1)
    static let green = NSColor(calibratedRed: 0.28, green: 0.93, blue: 0.55, alpha: 1)
    static let yellow = NSColor(calibratedRed: 1.0, green: 0.86, blue: 0.36, alpha: 1)
    static let red = NSColor(calibratedRed: 1.0, green: 0.45, blue: 0.47, alpha: 1)
    // Route identity hues: distinct from each other and from every status.
    static let local = NSColor(calibratedRed: 0.62, green: 0.74, blue: 0.80, alpha: 1)
    static let codex = NSColor(calibratedRed: 0.42, green: 0.64, blue: 1.0, alpha: 1)
    static let gptChat = NSColor(calibratedRed: 0.58, green: 0.80, blue: 1.0, alpha: 1)
    static let chatgpt = NSColor(calibratedRed: 0.40, green: 0.88, blue: 0.96, alpha: 1)
    static let claude = NSColor(calibratedRed: 0.99, green: 0.58, blue: 0.27, alpha: 1)
    static let claudeChat = NSColor(calibratedRed: 0.33, green: 0.84, blue: 0.75, alpha: 1)
    static let card = NSColor.white.withAlphaComponent(0.035)
    static let cardStroke = NSColor.white.withAlphaComponent(0.10)
}

/// A route's identity as the transcript names and draws it.
enum RouteLaneSurface {
    /// Raw surface values Core and the executed lanes use.
    static let known = ["local", "codex", "gpt-chat", "claude", "claude-chat", "chatgpt"]

    static func title(_ surface: String?) -> String? {
        switch surface {
        case "local": return os1Tr("로컬", "Local")
        case "codex": return "Codex"
        case "gpt-chat": return os1Tr("GPT 채팅 (Codex)", "GPT chat (Codex)")
        case "claude": return "Claude Code"
        case "claude-chat": return "Claude chat"
        case "chatgpt": return "ChatGPT"
        default: return nil
        }
    }

    /// The surface the projection's English route title names.
    static func fromTitle(_ title: String) -> String? {
        let head = title.components(separatedBy: " · ").first ?? title
        switch head {
        case "Local": return "local"
        case "Codex": return "codex"
        case "GPT chat (Codex pool)": return "gpt-chat"
        case "Claude Code": return "claude"
        case "Claude chat": return "claude-chat"
        case "ChatGPT": return "chatgpt"
        default: return nil
        }
    }

    static func tint(_ surface: String?) -> NSColor {
        switch surface {
        case "local": return RouteLanePalette.local
        case "codex": return RouteLanePalette.codex
        case "gpt-chat": return RouteLanePalette.gptChat
        case "chatgpt": return RouteLanePalette.chatgpt
        case "claude": return RouteLanePalette.claude
        case "claude-chat": return RouteLanePalette.claudeChat
        default: return RouteLanePalette.secondary
        }
    }

    static func symbol(_ surface: String?) -> String {
        switch surface {
        case "local": return "desktopcomputer"
        case "codex": return "terminal"
        case "gpt-chat", "chatgpt": return "bubble.left"
        case "claude": return "chevron.left.forwardslash.chevron.right"
        case "claude-chat": return "bubble.left.and.bubble.right"
        default: return "point.3.connected.trianglepath.dotted"
        }
    }

    /// The short arithmetic the projection shows beside an explicit route;
    /// any other instruction stays private and is not kept.
    static func publicInstruction(_ instruction: String?) -> String? {
        guard let value = instruction?.trimmingCharacters(in: .whitespacesAndNewlines), value.utf8.count <= 80,
              value.range(of: "^[0-9][0-9 ()+*/.^%−-]*$", options: .regularExpression) != nil else { return nil }
        return value
    }

    /// "<route> · <short arithmetic>", or the route alone.
    static func laneTitle(surface: String?, instruction: String?, fallback: String) -> String {
        guard let name = title(surface) else { return fallback }
        return publicInstruction(instruction).map { name + " · " + $0 } ?? name
    }
}

/// Where a lane's model and reasoning come from. Core's selected
/// configuration is what it bound; only a verified native record of the
/// returned output is an observation of what ran.
enum RouteLaneConfigProvenance: String, Codable, Sendable {
    case selected, observed
}

/// An earlier attempt of the same route that did not deliver: Core checked
/// it and ran the route again, on a stronger configuration (REVAS ladder or
/// tier escalation) or on the same one (continuation).
struct RouteLaneAttempt: Codable, Equatable, Sendable {
    enum Outcome: String, Codable, Sendable {
        /// The node verifier rejected the result; Core escalated.
        case verifierFailed
        /// A failure signal (no deliverable result); Core escalated.
        case failureSignal
        /// Core checked the result and continued on the same configuration.
        case continued

        var title: String {
            switch self {
            case .verifierFailed: return os1Tr("검증 실패 → 에스컬레이션", "verifier failed → escalated")
            case .failureSignal: return os1Tr("실패 신호 → 에스컬레이션", "failure signal → escalated")
            case .continued: return os1Tr("확인 후 이어서 실행", "checked, then continued")
            }
        }
    }
    var model: String?
    var effort: String?
    var outcome: Outcome
}

/// Why the whole task stands where it does, as a code: its words are written
/// in the interface language when the turn is drawn.
enum RouteLanesTaskNote: String, Codable, Sendable {
    case conditionsVerified, completenessUnverified, awaitingInstall, allReturned, interpreting

    var title: String {
        switch self {
        case .conditionsVerified: return os1Tr("작업 조건 확인됨", "Task conditions verified")
        case .completenessUnverified: return os1Tr("작업 완성도 미검증", "Task completeness unverified")
        case .awaitingInstall: return os1Tr("검증된 산출물 설치 대기", "Verified artifact awaiting install")
        case .allReturned: return os1Tr("모든 경로 반환 · 작업 확인 중", "Every route returned · checking the task")
        case .interpreting: return os1Tr("요청 해석 중 · 아직 경로 없음", "Interpreting the request · no route yet")
        }
    }
}

/// Host-built navigation custody. A label or a URL in model prose cannot
/// create this attribute, and the store rechecks the current graph on click.
struct RouteLaneInspection: Codable, Equatable, Sendable {
    let submissionID: UUID
    let planID: UUID
    let requestSHA256: String
    let nodeID: UUID

    func matches(_ graph: ParallelAgentTask.Snapshot, conversationID: UUID) -> Bool {
        guard let bound = try? graph.validated(conversationID: conversationID, submissionID: submissionID,
                                               requestSHA256: requestSHA256), bound.planID == planID else { return false }
        return bound.nodes.contains { $0.id == nodeID && $0.role == .worker }
    }
    var isValid: Bool { requestSHA256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil }
    static func trustedLink(in text: NSAttributedString, url: URL, at index: Int) -> Self? {
        guard (0..<text.length).contains(index),
              let host = text.attribute(.os1RouteLaneInspection, at: index, effectiveRange: nil) as? RouteLaneInspectionBox,
              host.binding.isValid, host.binding.url == url else { return nil }
        return host.binding
    }
    var url: URL {
        URL(string: "os1-route://inspect/" + submissionID.uuidString.lowercased() + "/" +
            planID.uuidString.lowercased() + "/" + nodeID.uuidString.lowercased())!
    }
}

struct RouteLane: Codable, Equatable, Sendable, Identifiable {
    var id: String
    /// Raw surface ("codex", …); nil when Core named none.
    var surface: String?
    /// A route the owner named (titled by its route and short sum), as
    /// opposed to a node of Core's own plan (titled by its place in the plan).
    var explicitRoute: Bool
    /// The short arithmetic an explicit route was asked (`publicInstruction`).
    var instruction: String?
    /// The node's place in Core's plan, from 0.
    var planIndex: Int?
    /// The graph's own title, kept only when it is neither shape above.
    var label: String?
    var model: String?
    var effort: String?
    var configuration: RouteLaneConfigProvenance?
    /// Core's selected model and reasoning, kept only when the observed
    /// configuration differs from them.
    var selectedModel: String?
    var selectedEffort: String?
    var status: RouteLaneStatus
    /// Public graph observations only; never generated progress or hidden reasoning.
    var progressText: String?
    var publicOutputSummary: String?
    var qualityDisclosure: RCCRuntimeContract.QualityDisclosure?
    var inspection: RouteLaneInspection?
    /// Core's own words for this route (a skipped route's reason).
    var coreReason: String?
    /// Core's ≤600-character summary of this route's output, kept only when
    /// the answer cannot be read back from its message text.
    var excerpt: String?
    /// A verified native record of exactly this lane's returned output.
    var executionVerified: Bool?
    var startedAt: Date?
    var finishedAt: Date?
    /// Earlier attempts of this route, oldest first.
    var attempts: [RouteLaneAttempt]?

    init(id: String, surface: String? = nil, explicitRoute: Bool = false, instruction: String? = nil, planIndex: Int? = nil,
         label: String? = nil, model: String? = nil, effort: String? = nil, configuration: RouteLaneConfigProvenance? = nil,
         status: RouteLaneStatus, coreReason: String? = nil, excerpt: String? = nil, executionVerified: Bool? = nil,
         startedAt: Date? = nil, finishedAt: Date? = nil, attempts: [RouteLaneAttempt]? = nil,
         progressText: String? = nil, publicOutputSummary: String? = nil,
         qualityDisclosure: RCCRuntimeContract.QualityDisclosure? = nil, inspection: RouteLaneInspection? = nil) {
        self.id = id; self.surface = surface; self.explicitRoute = explicitRoute
        self.instruction = RouteLaneSurface.publicInstruction(instruction); self.planIndex = planIndex
        self.label = label; self.model = model; self.effort = effort; self.configuration = configuration
        self.status = status; self.coreReason = coreReason; self.excerpt = excerpt
        self.executionVerified = executionVerified; self.startedAt = startedAt; self.finishedAt = finishedAt
        self.attempts = attempts; self.progressText = progressText; self.publicOutputSummary = publicOutputSummary
        self.qualityDisclosure = qualityDisclosure; self.inspection = inspection
    }

    /// The lane's name in the interface language.
    var title: String {
        let name = RouteLaneSurface.title(surface)
        if explicitRoute, let name { return instruction.map { name + " · " + $0 } ?? name }
        if let planIndex { return (name.map { $0 + " · " } ?? "") + os1Tr("작업 \(planIndex + 1)", "task \(planIndex + 1)") }
        return label ?? name ?? id
    }

    /// Quality is independent of execution state: an executed/returned worker
    /// can have known failed partial checks, without becoming an execution error.
    var qualityNotice: String? {
        guard let q = qualityDisclosure else { return nil }
        if !q.failedCheckIDs.isEmpty {
            return os1Tr("실행 종료 · 검사 실패: ", "Finished · checks failed: ") + q.failedCheckIDs.prefix(8).joined(separator: ", ") +
                (q.failedCheckIDs.count > 8 ? os1Tr(" · 외 \(q.failedCheckIDs.count - 8)건", " · +\(q.failedCheckIDs.count - 8) more") : "")
        }
        if q.checker == .unavailable { return os1Tr("검사기 사용 불가 · 품질 미검증", "Checker unavailable · quality unverified") }
        return os1Tr("검사 기록 있음 · 전체 작업 품질 미검증", "Checks recorded · whole-task quality unverified")
    }

    /// What this lane can truthfully say about itself.
    var reason: String? { coreReason ?? Self.reason(for: status) }

    static func reason(for status: RouteLaneStatus) -> String? {
        switch status {
        case .verifying: return os1Tr("반환됨 · Core가 결과를 확인하는 중", "Returned · Core is checking the result")
        case .failed: return os1Tr("Core가 이 경로를 실패로 기록 · 증거 보존", "Core recorded this route as failed · evidence retained")
        case .held: return os1Tr("Core가 이 경로를 보류 · 원래 요청 보존", "Core held this route · original request preserved")
        case .interrupted: return os1Tr("효과 불확실 · 자동 재실행 안 함", "Side effects uncertain · no automatic replay")
        case .skipped: return os1Tr("작업이 끝나기 전에 실행되지 않음", "Did not run before the task ended")
        case .unreported: return os1Tr("작업이 끝날 때 Core가 이 경로의 최종 상태를 보고하지 않음",
                                       "Core reported no final state for this route when the task ended")
        default: return nil
        }
    }

    var isValid: Bool {
        func bounded(_ value: String?, _ limit: Int) -> Bool { value.map { $0.utf8.count <= limit && !$0.contains("\0") } ?? true }
        return !id.isEmpty && bounded(id, 128) && bounded(surface, 32) && bounded(instruction, 80) && bounded(label, 256) &&
            (planIndex.map { (0..<64).contains($0) } ?? true) &&
            bounded(model, 256) && bounded(effort, 32) && bounded(selectedModel, 256) && bounded(selectedEffort, 32) &&
            bounded(coreReason, 1_024) && bounded(excerpt, 4_096) && bounded(progressText, 500) &&
            bounded(publicOutputSummary, 1_000) && (inspection?.isValid ?? true) &&
            (qualityDisclosure.map { [.completed, .returned].contains(status) &&
                ($0.coverage != nil || $0.checker != nil || !$0.failedCheckIDs.isEmpty) &&
                $0.failedCheckIDs.count <= 64 && Set($0.failedCheckIDs).count == $0.failedCheckIDs.count &&
                $0.failedCheckIDs.allSatisfy { !$0.isEmpty && $0.utf8.count <= 256 &&
                    !$0.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) } &&
                ($0.witnessSHA256.map { $0.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil } ?? true)
            } ?? true) && (attempts?.count ?? 0) <= 8 &&
            (attempts ?? []).allSatisfy { bounded($0.model, 256) && bounded($0.effort, 32) } &&
            (startedAt.flatMap { start in finishedAt.map { $0 >= start } } ?? true)
    }
}

/// A finished routed turn's lanes, kept on the message that holds the turn's
/// result. Answers are not copied: when `answersInText` is set they are read
/// back from that message's text, which they reproduce exactly.
struct RouteLanesRecord: Codable, Equatable, Sendable {
    static let currentSchema = 1
    var schema: Int
    var submissionID: UUID
    var taskStatus: RouteLaneStatus
    var taskNote: RouteLanesTaskNote?
    /// Core's own reason for a task that did not complete.
    var taskReason: String?
    var lanes: [RouteLane]
    /// The message text is exactly the lanes' answers as Core joins them
    /// ("<lane>: <answer>" blocks; the one route that ran, unlabeled): the
    /// lanes show them and the combined text is not drawn again.
    var answersInText: Bool

    init(submissionID: UUID, taskStatus: RouteLaneStatus, taskNote: RouteLanesTaskNote? = nil, taskReason: String? = nil,
         lanes: [RouteLane], answersInText: Bool) {
        schema = Self.currentSchema; self.submissionID = submissionID; self.taskStatus = taskStatus
        self.taskNote = taskNote; self.taskReason = taskReason; self.lanes = lanes; self.answersInText = answersInText
    }

    var isValid: Bool {
        schema == Self.currentSchema && (1...24).contains(lanes.count) && lanes.allSatisfy(\.isValid) &&
            Set(lanes.map(\.id)).count == lanes.count &&
            lanes.allSatisfy({ $0.inspection.map { $0.submissionID == submissionID } ?? true }) && (taskReason.map { $0.utf8.count <= 1_024 } ?? true)
    }

    /// Each lane's answer: read from the message text when the lanes cover
    /// it, otherwise Core's own summary of the lane's output. The same rule
    /// as `build`: one route that ran answers unlabeled, however many routes
    /// Core skipped.
    func answers(in text: String) -> [String: String] {
        if answersInText {
            let ran = lanes.filter { $0.status != .skipped }
            if ran.count == 1, let only = ran.first, !text.hasPrefix(only.id + ": ") { return [only.id: text] }
            if let split = RouteLanesRecord.splitLabeled(text, ids: lanes.map(\.id)) { return split }
        }
        var excerpts: [String: String] = [:]
        for lane in lanes { if let excerpt = lane.excerpt { excerpts[lane.id] = excerpt } }
        return excerpts
    }

    /// Splits Core's joined output — `<id>: <answer>` blocks in plan order,
    /// joined by a blank line, some ids possibly absent — back into answers.
    /// nil unless the blocks rebuild the text byte for byte.
    static func splitLabeled(_ text: String, ids: [String]) -> [String: String]? {
        guard !ids.isEmpty, Set(ids).count == ids.count else { return nil }
        guard let first = ids.firstIndex(where: { text.hasPrefix($0 + ": ") }) else { return nil }
        var remaining = Array(ids[(first + 1)...])
        var current = ids[first]
        var cursor = text.index(text.startIndex, offsetBy: current.count + 2)
        var order: [String] = [], answers: [String: String] = [:]
        while true {
            var next: (range: Range<String.Index>, offset: Int)?
            for (offset, id) in remaining.enumerated() {
                if let found = text.range(of: "\n\n" + id + ": ", options: .literal, range: cursor..<text.endIndex),
                   next.map({ found.lowerBound < $0.range.lowerBound }) ?? true {
                    next = (found, offset)
                }
            }
            guard let next else {
                answers[current] = String(text[cursor...]); order.append(current)
                break
            }
            answers[current] = String(text[cursor..<next.range.lowerBound]); order.append(current)
            current = remaining[next.offset]
            remaining = Array(remaining[(next.offset + 1)...])
            cursor = next.range.upperBound
        }
        let rebuilt = order.map { $0 + ": " + (answers[$0] ?? "") }.joined(separator: "\n\n")
        return rebuilt == text ? answers : nil
    }

    /// One returned step as the run reported it, for matching a lane's exact
    /// output to the native record that produced it.
    struct Observation {
        let surface: String?
        let model: String?
        let effort: String?
        let output: String
        let verified: Bool
    }

    /// The finished Core task's lanes. `messageText` is the text of the
    /// message the record is attached to (nil when the task returned none).
    static func build(core: RCCRuntimeContract.Snapshot, submissionID: UUID, messageText: String?,
                      observations: [Observation] = []) -> RouteLanesRecord? {
        guard !core.children.isEmpty || !(core.skippedRoutes ?? []).isEmpty else { return nil }
        let terminal = [.completed, .failed, .held, .cancelled, .returnedUnverified, .effectsUncertain].contains(core.state)
        let statuses = core.children.map { laneStatus($0.state, taskTerminal: terminal) }
        // The routes that ran: Core answers one of them unlabeled, however
        // many it skipped or never reached.
        let ran = zip(core.children, statuses).filter { $0.1 != .skipped }.map(\.0)
        // A child's own summary is its output's first 600 UTF-16 units: an
        // answer that disagrees with it is not that child's answer.
        func agrees(_ child: RCCRuntimeContract.ChildSnapshot, _ answer: String?) -> Bool {
            guard let answer, let summary = child.outputSummary else { return true }
            return Array(answer.utf16.prefix(600)) == Array(summary.utf16)
        }
        var answers: [String: String]?
        if let text = messageText, !text.isEmpty {
            if ran.count == 1, let only = ran.first, !text.hasPrefix(only.id + ": ") {
                if agrees(only, text) { answers = [only.id: text] }
            } else if let split = splitLabeled(text, ids: core.children.map(\.id)),
                      core.children.allSatisfy({ agrees($0, split[$0.id]) }) {
                answers = split
            }
        }
        // The text is the lanes' answers only when it is exactly the
        // completed routes' answers, each on its own lane.
        let completed = Set(zip(core.children, statuses).filter { $0.1 == .completed }.map(\.0.id))
        let answersInText = answers.map { Set($0.keys) == completed && !completed.isEmpty } ?? false

        // Only a verified record of exactly one lane's output, claimed by no
        // other lane, observes that lane's model.
        var matches: [String: [Int]] = [:]
        for (child, status) in zip(core.children, statuses) where status == .completed {
            guard let answer = answers?[child.id] else { continue }
            let surface = child.selectedConfig?.surface.rawValue ?? child.requestedSurface?.rawValue
            matches[child.id] = observations.indices.filter { index in
                let step = observations[index]
                return step.verified && step.output == answer && (step.surface == nil || surface == nil || step.surface == surface)
            }
        }
        var claims: [Int: Int] = [:]
        for indices in matches.values { for index in indices { claims[index, default: 0] += 1 } }

        var lanes: [RouteLane] = []
        for (index, child) in core.children.enumerated() {
            let config = child.selectedConfig, decision = child.routingDecision
            let surface = config?.surface.rawValue ?? child.requestedSurface?.rawValue
            let model = config?.model ?? decision?.model
            let effort = config?.effort.rawValue ?? decision?.effort.rawValue
            var lane = RouteLane(id: child.id, surface: surface, explicitRoute: child.requestedSurface != nil,
                instruction: child.instruction, planIndex: child.requestedSurface == nil ? index : nil,
                model: model, effort: effort, configuration: config == nil && decision == nil ? nil : .selected,
                status: statuses[index],
                startedAt: child.startedAtMS.map { Date(timeIntervalSince1970: Double($0) / 1000) },
                finishedAt: child.finishedAtMS.map { Date(timeIntervalSince1970: Double($0) / 1000) })
            if let found = matches[child.id], found.count == 1, let only = found.first, claims[only] == 1 {
                let step = observations[only]
                lane.executionVerified = true
                if let observed = step.model, !observed.isEmpty {
                    if observed != model || (step.effort ?? effort) != effort {
                        lane.selectedModel = model; lane.selectedEffort = effort
                    }
                    lane.model = observed; lane.effort = step.effort ?? effort; lane.configuration = .observed
                }
            }
            let display = RCCRuntimeProjection.inspectionIdentity(taskID: core.taskID, childID: child.id)
            lane.inspection = RouteLaneInspection(submissionID: submissionID, planID: display.planID,
                requestSHA256: core.requestSHA256, nodeID: display.nodeID)
            lane.qualityDisclosure = child.qualityDisclosure
            // A REVAS ladder or tier escalation ran a cheaper tuple first.
            if let decision, decision.reason.contains("escalated_after"), let ladder = decision.ladder {
                lane.attempts = [RouteLaneAttempt(model: ladder.cheapModel ?? decision.model, effort: ladder.cheapEffort.rawValue,
                    outcome: decision.reason.contains("escalated_after_verifier") ? .verifierFailed : .failureSignal)]
            }
            if !answersInText, let summary = child.outputSummary, !summary.isEmpty { lane.excerpt = summary }
            lanes.append(lane)
        }
        for (index, route) in (core.skippedRoutes ?? []).prefix(8).enumerated() {
            lanes.append(RouteLane(id: "skipped-\(index + 1)", surface: route.surface.rawValue, explicitRoute: true,
                instruction: route.instruction, label: route.surface.rawValue, status: .skipped,
                coreReason: String(humanizedCode(route.reason).prefix(240))))
        }
        let (taskStatus, note) = taskStatus(core)
        let record = RouteLanesRecord(submissionID: submissionID, taskStatus: taskStatus, taskNote: note,
            taskReason: taskStatus == .completed ? nil : core.error.map(humanizedCode), lanes: lanes,
            answersInText: answersInText)
        return record.isValid ? record : nil
    }

    static func laneStatus(_ state: RCCRuntimeContract.ChildState, taskTerminal: Bool) -> RouteLaneStatus {
        switch state {
        case .pending, .ready, .queued: return taskTerminal ? .skipped : .queued
        case .running: return taskTerminal ? .unreported : .processing
        case .waiting: return taskTerminal ? .unreported : .verifying
        case .succeeded, .completed: return .completed
        case .failed: return .failed
        case .held: return .held
        case .cancelled: return .cancelled
        case .effectsUncertain: return .interrupted
        }
    }

    static func taskStatus(_ core: RCCRuntimeContract.Snapshot) -> (RouteLaneStatus, RouteLanesTaskNote?) {
        switch core.state {
        case .queued: return (.queued, nil)
        case .planning: return (.planning, nil)
        case .running, .waiting: return (.processing, nil)
        case .cancelling: return (.cancelling, nil)
        case .awaitingInstall: return (.verifying, .awaitingInstall)
        case .completed: return (.completed, .conditionsVerified)
        case .returnedUnverified: return (.returned, .completenessUnverified)
        case .held: return (.held, nil)
        case .failed: return (.failed, nil)
        case .cancelled: return (.cancelled, nil)
        case .effectsUncertain: return (.interrupted, nil)
        }
    }

    /// "parent_task_verifier_unavailable" → "parent task verifier unavailable".
    static func humanizedCode(_ code: String) -> String {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.range(of: "^[a-z0-9_]+$", options: .regularExpression) != nil else { return trimmed }
        return trimmed.replacingOccurrences(of: "_", with: " ")
    }
}

/// Optional display evidence never makes a conversation unreadable: an
/// invalid or future record decodes to nil, and a message without one keeps
/// its stored shape.
@propertyWrapper
struct RouteLanesField: Codable, Equatable, Sendable {
    var wrappedValue: RouteLanesRecord?
    init(wrappedValue: RouteLanesRecord? = nil) {
        self.wrappedValue = wrappedValue?.isValid == true ? wrappedValue : nil
    }
    init(from decoder: Decoder) throws {
        let value = try? RouteLanesRecord(from: decoder)
        wrappedValue = value?.isValid == true ? value : nil
    }
    func encode(to encoder: Encoder) throws {
        if let value = wrappedValue, value.isValid { try value.encode(to: encoder) }
        else { var container = encoder.singleValueContainer(); try container.encodeNil() }
    }
}

extension KeyedDecodingContainer {
    func decode(_ type: RouteLanesField.Type, forKey key: Key) throws -> RouteLanesField {
        (try? decodeIfPresent(type, forKey: key)).flatMap { $0 } ?? RouteLanesField()
    }
}

extension KeyedEncodingContainer {
    mutating func encode(_ value: RouteLanesField, forKey key: Key) throws {
        try encodeIfPresent(value.wrappedValue?.isValid == true ? value.wrappedValue : nil, forKey: key)
    }
}

/// What the transcript draws for one routed turn, live or finished. It holds
/// no interface text: titles, notes and reasons are written when drawn.
struct RouteLanesPresentation: Equatable {
    var taskStatus: RouteLaneStatus
    var taskNote: RouteLanesTaskNote?
    /// Core's own reason for the task's state.
    var taskReason: String?
    var lanes: [RouteLane]
    var startedAt: Date?
    var finishedAt: Date?
    /// The second the live lanes' clocks show; nil for a finished turn.
    var now: Date?
    /// Who split the task: OpenClaw Core, or OS-1's own coordinator.
    var coordinator = "OpenClaw"

    var noteText: String? { taskNote?.title ?? taskReason }

    func at(_ date: Date) -> Self {
        var value = self
        let second = (date.timeIntervalSince1970 + 0.001).rounded(.down)
        value.now = Date(timeIntervalSince1970: second)
        return value
    }

    init(taskStatus: RouteLaneStatus, taskNote: RouteLanesTaskNote? = nil, taskReason: String? = nil, lanes: [RouteLane],
         startedAt: Date? = nil, finishedAt: Date? = nil, now: Date? = nil) {
        self.taskStatus = taskStatus; self.taskNote = taskNote; self.taskReason = taskReason; self.lanes = lanes
        self.startedAt = startedAt; self.finishedAt = finishedAt; self.now = now
    }

    init(record: RouteLanesRecord) {
        self.init(taskStatus: record.taskStatus, taskNote: record.taskNote, taskReason: record.taskReason, lanes: record.lanes,
            startedAt: record.lanes.compactMap(\.startedAt).min(), finishedAt: record.lanes.compactMap(\.finishedAt).max())
    }

    // Compiled once: the live graph is read on every change of the store.
    private static let rootState = try! NSRegularExpression(pattern: #"OpenClaw core state: ([a-z_]+)"#)
    private static let childState = try! NSRegularExpression(pattern: #"Core child state: ([a-z_]+)"#)
    /// "selected <surface> / <model> / <effort>": what Core bound, not what ran.
    private static let selected = try! NSRegularExpression(pattern: #"selected ([a-z-]+) / ([^/·…]+?) / ([a-z]+)"#)
    private static let plannedTitle = try! NSRegularExpression(pattern: #"^Task ([0-9]+) · "#)

    /// The live run's lanes from its observed task graph: one per worker, in
    /// plan order. nil without a coordinator.
    init?(liveGraph graph: ParallelAgentTask.Snapshot) {
        guard let graph = try? graph.validated(),
              let root = graph.nodes.first(where: { $0.id == graph.rootNodeID }) else { return nil }
        let workers = graph.nodes.filter { $0.role == .worker }
        let lanes = workers.prefix(8).map { node in
            var lane = Self.lane(node)
            lane.inspection = RouteLaneInspection(submissionID: graph.submissionID, planID: graph.planID,
                requestSHA256: graph.requestSHA256, nodeID: node.id)
            return lane
        }
        let rootRaw = Self.captures(Self.rootState, root.progressText)?.first
        let interpreting = root.progressText?.hasPrefix("OpenClaw core is interpreting") == true
        let status: RouteLaneStatus
        var note: RouteLanesTaskNote?, reason: String?
        switch root.state {
        case .pending: status = .queued
        case .running:
            if rootRaw == "cancelling" { status = .cancelling }
            else if interpreting || rootRaw == "planning" || lanes.isEmpty { status = .planning }
            else if rootRaw == "queued" { status = .queued }
            else if rootRaw == "awaiting_install" { status = .verifying; note = .awaitingInstall }
            else if lanes.allSatisfy({ $0.status.isTerminal }) { status = .verifying; note = .allReturned }
            else { status = .processing }
        case .succeeded: status = .completed
        case .blocked:
            if root.progressText?.hasPrefix("Output returned") == true { status = .returned }
            else {
                status = .held
                reason = root.progressText?.components(separatedBy: "held routing interpretation: ").dropFirst().first
            }
        case .failed: status = .failed
        case .cancelled: status = .cancelled
        case .interrupted: status = .interrupted
        }
        if interpreting { note = .interpreting }
        self.init(taskStatus: status, taskNote: note, taskReason: reason, lanes: Array(lanes), startedAt: root.startedAt,
            finishedAt: root.finishedAt)
        if root.title != "OpenClaw task" { coordinator = "OS-1" }
    }

    private static func captures(_ regex: NSRegularExpression, _ text: String?) -> [String]? {
        guard let text, let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        return (1..<match.numberOfRanges).map { group in
            Range(match.range(at: group), in: text).map { String(text[$0]) } ?? ""
        }
    }

    private static func lane(_ node: ParallelAgentTask.Node) -> RouteLane {
        let progress = node.progressText
        let raw = captures(childState, progress)?.first
        let selection = captures(selected, progress)
        let selectedModel = selection?[1].trimmingCharacters(in: .whitespaces)
        let surface = node.surface ?? selection?[0] ?? RouteLaneSurface.fromTitle(node.title)
        // The projection titles an explicit route "<Route> · <sum>" and a
        // planned node "Task N · <id>"; any other title is the graph's own.
        let explicit = RouteLaneSurface.fromTitle(node.title) != nil
        let planned = captures(plannedTitle, node.title)?.first.flatMap(Int.init).map { $0 - 1 }
        let status: RouteLaneStatus
        switch node.state {
        case .pending: status = raw == "waiting" ? .verifying : .queued
        case .running: status = .processing
        case .succeeded: status = .completed
        case .failed: status = .failed
        case .blocked: status = .held
        case .cancelled: status = .cancelled
        case .interrupted: status = .interrupted
        }
        let observed = node.model != nil
        var lane = RouteLane(id: node.id.uuidString.lowercased(), surface: surface, explicitRoute: explicit,
            instruction: explicit ? node.title.components(separatedBy: " · ").dropFirst().joined(separator: " · ") : nil,
            planIndex: explicit ? nil : planned.map { max(0, $0) },
            label: explicit || planned != nil ? nil : node.title,
            model: node.model ?? selectedModel, effort: node.effort ?? selection?[2],
            configuration: observed ? .observed : (selectedModel == nil ? nil : .selected), status: status,
            startedAt: node.startedAt, finishedAt: node.finishedAt)
        lane.progressText = node.progressText
        if let native = node.nativeProgress, native.isValid {
            let counts = os1Tr("관측 도구 요청 \(native.toolsRequested) · 반환 \(native.toolsReturned)",
                "Observed tool requests \(native.toolsRequested) · returns \(native.toolsReturned)")
            lane.progressText = String(([node.progressText, counts].compactMap { $0 }).joined(separator: " · ").prefix(500))
        }
        lane.publicOutputSummary = node.publicOutputSummary
        lane.qualityDisclosure = node.qualityDisclosure
        if node.provider != nil || progress?.contains("execution verified") == true { lane.executionVerified = true }
        return lane
    }
}

/// What the live graph forgets between two of its snapshots, kept for one run:
/// a lane that went back from Verifying (or Processing) to Queued or
/// Processing ran again — an escalation to a stronger configuration or a
/// continuation on the same one — and a returned lane keeps the clock it
/// had when it returned. Display only; it observes, never schedules.
struct RouteLanesLiveHistory: Equatable {
    struct Trace: Equatable {
        var status: RouteLaneStatus
        var model: String?
        var effort: String?
        var start: Date?
        var returnedAt: Date?
        var attempts: [RouteLaneAttempt] = []
    }
    private(set) var submissionID: UUID?
    private var traces: [String: Trace] = [:]

    init(submissionID: UUID? = nil) { self.submissionID = submissionID }

    /// `p` as observed at `observed`, with what earlier snapshots showed.
    mutating func absorb(_ p: RouteLanesPresentation, submissionID: UUID, at observed: Date) -> RouteLanesPresentation {
        if self.submissionID != submissionID { self = Self(submissionID: submissionID) }
        var out = p
        for (index, lane) in p.lanes.enumerated() {
            var trace = traces[lane.id] ?? Trace(status: lane.status, model: lane.model, effort: lane.effort)
            let ranAgain = (trace.status == .verifying && [.queued, .processing].contains(lane.status)) ||
                (trace.status == .processing && lane.status == .queued)
            if ranAgain, trace.attempts.count < 8 {
                let same = lane.model != nil && lane.model == trace.model && lane.effort == trace.effort
                trace.attempts.append(RouteLaneAttempt(model: trace.model, effort: trace.effort,
                    outcome: same ? .continued : (trace.status == .verifying ? .verifierFailed : .failureSignal)))
                trace.start = nil; trace.returnedAt = nil
            }
            if lane.model != nil { trace.model = lane.model; trace.effort = lane.effort }
            if let start = lane.startedAt, lane.status == .processing { trace.start = start }
            if lane.status == .verifying, trace.status != .verifying || trace.returnedAt == nil { trace.returnedAt = observed }
            trace.status = lane.status
            traces[lane.id] = trace
            var shown = lane
            if shown.status == .verifying, shown.startedAt == nil, let start = trace.start, let back = trace.returnedAt, back >= start {
                shown.startedAt = start; shown.finishedAt = back
            }
            if !trace.attempts.isEmpty { shown.attempts = trace.attempts }
            out.lanes[index] = shown
        }
        return out
    }
}

extension NSAttributedString.Key {
    /// On a lane's text: the card the transcript paints behind its cell.
    static let os1RouteLaneCard = NSAttributedString.Key("com.omaragi.os1.route-lane-card")
    /// On a status label: the rounded pill (and its glyph) painted behind it.
    static let os1RouteLanePill = NSAttributedString.Key("com.omaragi.os1.route-lane-pill")
    static let os1RouteLaneInspection = NSAttributedString.Key("com.omaragi.os1.route-lane-inspection")
}

/// Host-created attributed-string payload, separate from any model Markdown link.
final class RouteLaneInspectionBox: NSObject {
    let binding: RouteLaneInspection
    init(_ binding: RouteLaneInspection) { self.binding = binding }
}

/// What a lane card is painted with.
/// `index` keeps two neighbouring cards of the same color from merging into
/// one attribute run.
final class RouteLaneCardStyle: NSObject {
    let accent: NSColor
    let live: Bool
    let index: Int
    let inspection: RouteLaneInspection?
    init(accent: NSColor, live: Bool, index: Int, inspection: RouteLaneInspection? = nil) {
        self.accent = accent; self.live = live; self.index = index; self.inspection = inspection
    }
    override func isEqual(_ object: Any?) -> Bool {
        guard let other = object as? RouteLaneCardStyle else { return false }
        return accent == other.accent && live == other.live && index == other.index && inspection == other.inspection
    }
    override var hash: Int { accent.hash ^ (live ? 1 : 0) ^ (index << 4) }
}

/// A status pill: its colour and the glyph drawn in the space it reserves.
final class RouteLanePillStyle: NSObject {
    let color: NSColor
    let glyph: String
    init(color: NSColor, glyph: String) { self.color = color; self.glyph = glyph }
    override func isEqual(_ object: Any?) -> Bool {
        guard let other = object as? RouteLanePillStyle else { return false }
        return color == other.color && glyph == other.glyph
    }
    override var hash: Int { color.hash ^ glyph.hashValue }
}

enum RouteLanesRenderer {
    /// A lane narrower than this wraps its route title and model on every
    /// word: the lanes become a grid instead.
    static let minimumLaneWidth: CGFloat = 170
    /// Space between two cards; each cell keeps half of it as its margin.
    static let gap: CGFloat = 10
    /// The conversation column's own width (760) holds four lanes.
    static let defaultCapacity = 4
    /// Lanes over this many characters (or lines) open on "Show more".
    static let foldCharacters = 520
    static let foldLines = 12

    /// Disclosure belongs to this exact observed run, not a global "show
    /// progress" preference. A later submission cannot inherit open cards.
    static func disclosureKey(_ p: RouteLanesPresentation, key: String) -> String {
        let identity = p.lanes.compactMap(\.inspection).first.map {
            $0.submissionID.uuidString + ":" + $0.planID.uuidString + ":" + $0.requestSHA256
        } ?? ((p.startedAt.map { String($0.timeIntervalSince1970) } ?? "pending") + ":" + p.lanes.map(\.id).joined(separator: ":"))
        return key + "-routes-" + String(SourceContextStore.digest(Data(identity.utf8)).prefix(16))
    }

    static func showsDetails(_ p: RouteLanesPresentation, key: String, expanded: Set<String>, expandAll: Bool) -> Bool {
        expandAll || expanded.contains(disclosureKey(p, key: key))
    }

    /// Ordinary chat stays small. Details are a presentation-only click;
    /// neither rendering this line nor opening it dispatches a backend.
    static func compact(_ p: RouteLanesPresentation, key: String, lead: NSAttributedString? = nil,
                        trailing: NSAttributedString? = nil) -> NSAttributedString {
        let line = NSMutableAttributedString()
        let font = NSFont.systemFont(ofSize: 11, weight: .medium)
        if let lead { line.append(lead) }
        else { line.append(symbol("point.3.connected.trianglepath.dotted", color: RouteLanePalette.secondary, size: 11)) }
        line.append(piece(" " + p.coordinator + " · ", font, RouteLanePalette.secondary))
        line.append(pill(p.taskStatus))
        if !p.lanes.isEmpty { line.append(piece(" · " + os1Tr("경로 \(p.lanes.count)개", "\(p.lanes.count) routes"), font, RouteLanePalette.muted)) }
        if p.lanes.contains(where: { $0.qualityNotice != nil }) {
            let warning = NSMutableAttributedString(attributedString: piece(" · " + os1Tr("품질 주의", "Quality notice"), font, RouteLanePalette.yellow))
            let notices = p.lanes.compactMap(\.qualityNotice).prefix(2).joined(separator: "\n")
            warning.addAttribute(.toolTip, value: notices, range: NSRange(location: 0, length: warning.length))
            line.append(warning)
        }
        if p.now == nil { line.append(piece(" · " + os1Tr("실행 기록", "Recorded"), font, RouteLanePalette.muted)) }
        line.append(disclosure(p, key: key, open: false, trailing: trailing))
        return line
    }

    static func disclosure(_ p: RouteLanesPresentation, key: String, open: Bool,
                           trailing: NSAttributedString? = nil) -> NSAttributedString {
        let caption = open ? os1Tr("상세 접기", "Hide details") : os1Tr("실행 상세", "Execution details")
        let detail = NSMutableAttributedString(attributedString: piece("  " + (open ? "▾ " : "▸ ") + caption,
            NSFont.systemFont(ofSize: 11, weight: .medium), RouteLanePalette.secondary))
        let url = URL(string: "os1-detail://toggle/" + disclosureKey(p, key: key))!
        detail.addAttribute(.link, value: url, range: NSRange(location: 0, length: detail.length))
        detail.addAttribute(.toolTip, value: p.noteText ?? os1Tr("이 작업의 경로와 로그 펼치기", "Expand this task's routes and logs"), range: NSRange(location: 0, length: detail.length))
        if let trailing { detail.append(trailing) }
        return detail
    }

    /// Lanes a text column `width` points wide holds side by side.
    static func capacity(textWidth width: CGFloat) -> Int {
        guard width > 1 else { return defaultCapacity }
        return max(1, min(8, Int((width + gap) / (minimumLaneWidth + gap))))
    }

    /// Columns for `count` lanes: as many as fit, balanced over the rows a
    /// narrow column needs (four lanes in three columns become 2 × 2).
    static func columns(lanes count: Int, capacity: Int) -> Int {
        guard count > 0 else { return 1 }
        let rows = (count + max(1, capacity) - 1) / max(1, capacity)
        return (count + rows - 1) / rows
    }

    static func duration(_ seconds: TimeInterval) -> String {
        guard seconds >= 1 else { return os1Tr("1초 미만", "<1s") }
        let whole = Int(seconds.rounded(.down))
        let hours = whole / 3_600, minutes = whole % 3_600 / 60, rest = whole % 60
        if hours > 0 { return os1Tr("\(hours)시간 \(minutes)분", "\(hours)h \(minutes)m") }
        if minutes > 0 { return os1Tr("\(minutes)분 \(rest)초", "\(minutes)m \(rest)s") }
        return os1Tr("\(rest)초", "\(rest)s")
    }

    static func elapsed(start: Date?, end: Date?, now: Date?) -> String? {
        guard let start, let stop = end ?? now else { return nil }
        return duration(max(0, stop.timeIntervalSince(start)))
    }

    /// A raw reasoning effort as a label ("none" is written as such).
    static func effortLabel(_ raw: String) -> String {
        raw == "none" ? os1Tr("없음", "none") : raw
    }

    /// "추론 low" with a no-break space, so the pair never splits.
    static func reasoningTag(_ effort: String) -> String {
        os1Tr("추론", "reasoning") + "\u{00A0}" + effortLabel(effort)
    }

    static func symbol(_ name: String, color: NSColor, size: CGFloat, label: String? = nil) -> NSAttributedString {
        guard let image = NSImage(systemSymbolName: name, accessibilityDescription: label)?
            .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: size, weight: .semibold)
                .applying(NSImage.SymbolConfiguration(paletteColors: [color]))) else {
            return NSAttributedString(string: "", attributes: [.font: NSFont.systemFont(ofSize: size), .foregroundColor: color])
        }
        if let label { image.accessibilityDescription = label }
        let attachment = NSTextAttachment()
        attachment.image = image
        let height = size + 1, width = image.size.height > 0 ? image.size.width * height / image.size.height : height
        attachment.bounds = NSRect(x: 0, y: -2, width: width, height: height)
        let text = NSMutableAttributedString(attachment: attachment)
        text.addAttributes([.font: NSFont.systemFont(ofSize: size), .foregroundColor: color],
                           range: NSRange(location: 0, length: text.length))
        return text
    }

    /// The status word on its pill. The glyph is not text: the transcript
    /// view draws it in the space reserved after the pill's leading space.
    static func pill(_ status: RouteLaneStatus, size: CGFloat = 10.5) -> NSAttributedString {
        let font = NSFont.systemFont(ofSize: size, weight: .semibold)
        let style = RouteLanePillStyle(color: status.color, glyph: status.glyph)
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: status.color, .os1RouteLanePill: style]
        let glyph = (status.glyph as NSString).size(withAttributes: [.font: font]).width
        let figure = ("\u{2007}" as NSString).size(withAttributes: [.font: font]).width
        let text = NSMutableAttributedString(string: "\u{2002}", attributes: attributes)
        var reserve = attributes; reserve[.kern] = glyph + 3 - figure
        text.append(NSAttributedString(string: "\u{2007}", attributes: reserve))
        text.append(NSAttributedString(string: status.title + "\u{2002}", attributes: attributes))
        return text
    }

    private static func piece(_ text: String, _ font: NSFont, _ color: NSColor) -> NSAttributedString {
        NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color])
    }

    /// "gpt-6-luna · 추론 low" on one line (single-route strip), or nil when
    /// Core exposed no configuration.
    static func configuration(_ lane: RouteLane) -> String? {
        guard let model = lane.model, !model.isEmpty else { return nil }
        guard let effort = lane.effort, !effort.isEmpty else { return model }
        return model + " · " + os1Tr("추론 ", "reasoning ") + effortLabel(effort)
    }

    private static func configurationTip(_ lane: RouteLane) -> String {
        var tip: String
        switch lane.configuration {
        case .observed:
            tip = os1Tr("검증된 실행 기록에서 관측한 모델·추론", "Model and reasoning observed in the verified execution record")
            if let selected = lane.selectedModel {
                tip += os1Tr(" · Core 선택값: ", " · Core selected: ") + selected +
                    (lane.selectedEffort.map { " · " + reasoningTag($0) } ?? "")
            }
        case .selected:
            tip = os1Tr("OpenClaw Core가 이 경로에 선택한 설정 · 관측된 실행이 아님",
                        "The configuration OpenClaw Core selected for this route · not observed execution")
        case nil:
            tip = os1Tr("실행 설정이 공개되지 않음", "Execution configuration not exposed")
        }
        if lane.executionVerified == true { tip += os1Tr(" · 검증된 실행 기록 있음", " · verified execution record") }
        return tip
    }

    /// "1차 gpt-x · 추론 low → 검증 실패 → 에스컬레이션" for each earlier attempt.
    static func attemptLines(_ lane: RouteLane) -> [String] {
        (lane.attempts ?? []).enumerated().map { index, attempt in
            os1Tr("\(index + 1)차", "Attempt \(index + 1)") + " " +
                (attempt.model ?? os1Tr("모델 미공개", "model not exposed")) +
                (attempt.effort.map { " · " + reasoningTag($0) } ?? "") + " · " + attempt.outcome.title
        }
    }

    /// The turn's header line: who split it, into how many routes, the
    /// task's status and clock. A live run puts its working mark in front
    /// (`lead`) and its disclosure at the end (`trailing`), so the turn has
    /// one status line.
    static func header(_ p: RouteLanesPresentation, lead: NSAttributedString? = nil,
                       trailing: NSAttributedString? = nil) -> NSAttributedString {
        let line = NSMutableAttributedString()
        let small = NSFont.systemFont(ofSize: 11, weight: .medium)
        if let lead { line.append(lead) }
        else { line.append(symbol(RouteLaneSurface.symbol(nil), color: RouteLanePalette.secondary, size: 11, label: p.coordinator)) }
        line.append(piece((lead == nil ? " " : "") + p.coordinator, NSFont.systemFont(ofSize: 11, weight: .semibold),
                          RouteLanePalette.text))
        if p.lanes.count > 1 {
            line.append(piece(" · " + os1Tr("경로 \(p.lanes.count)개로 나눔", "split into \(p.lanes.count) routes"), small,
                              RouteLanePalette.muted))
        }
        line.append(piece("   ", small, RouteLanePalette.muted))
        line.append(pill(p.taskStatus))
        if let clock = elapsed(start: p.startedAt, end: p.finishedAt, now: p.now) {
            line.append(piece("  " + clock, NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .regular), RouteLanePalette.muted))
        }
        if let note = p.noteText, !note.isEmpty {
            line.append(piece("  · " + note, NSFont.systemFont(ofSize: 11), RouteLanePalette.muted))
        }
        // Live, every model on screen is the one Core selected.
        if p.now != nil, p.lanes.count > 1, p.lanes.contains(where: { $0.configuration == .selected }) {
            let tag = NSMutableAttributedString(attributedString: piece("  · " + os1Tr("모델은 Core 선택값", "models as Core selected"),
                NSFont.systemFont(ofSize: 10.5), RouteLanePalette.muted))
            tag.addAttribute(.toolTip, value: os1Tr("OpenClaw Core가 각 경로에 선택한 설정 · 관측된 실행이 아님",
                "The configuration OpenClaw Core selected for each route · not observed execution"),
                range: NSRange(location: 0, length: tag.length))
            line.append(tag)
        }
        if let trailing { line.append(trailing) }
        return line
    }

    /// One route on one line: the single-route turn's caption above its
    /// answer, or the live strip of a one-route task.
    static func strip(_ lane: RouteLane, now: Date? = nil, lead: NSAttributedString? = nil,
                      trailing: NSAttributedString? = nil) -> NSAttributedString {
        let line = NSMutableAttributedString()
        let tint = RouteLaneSurface.tint(lane.surface)
        if let lead { line.append(lead) }
        line.append(symbol(RouteLaneSurface.symbol(lane.surface), color: tint, size: 11, label: RouteLaneSurface.title(lane.surface)))
        line.append(piece(" " + lane.title, NSFont.systemFont(ofSize: 11, weight: .semibold), tint))
        if let configuration = configuration(lane) {
            let config = NSMutableAttributedString(attributedString: piece("  " + configuration,
                NSFont.systemFont(ofSize: 11, weight: .medium), RouteLanePalette.secondary))
            config.addAttribute(.toolTip, value: configurationTip(lane), range: NSRange(location: 0, length: config.length))
            line.append(config)
        }
        // Live, the model on screen is Core's selection, not yet observed.
        if now != nil, lane.configuration == .selected {
            line.append(piece(" · " + os1Tr("선택값", "selected"), NSFont.systemFont(ofSize: 10), RouteLanePalette.muted))
        }
        line.append(piece("   ", NSFont.systemFont(ofSize: 11), RouteLanePalette.muted))
        line.append(pill(lane.status))
        if let clock = elapsed(start: lane.startedAt, end: lane.finishedAt, now: now) {
            line.append(piece("  " + clock, NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .regular), RouteLanePalette.muted))
        }
        if let reason = lane.reason, lane.status != .completed {
            line.append(piece("  · " + reason, NSFont.systemFont(ofSize: 11), lane.status.color))
        }
        for attempt in attemptLines(lane) {
            line.append(piece("  · " + attempt, NSFont.systemFont(ofSize: 10.5), RouteLanePalette.secondary))
        }
        if let trailing { line.append(trailing) }
        return line
    }

    /// The lanes side by side as one native text table: selectable, found by
    /// the find bar, read by VoiceOver. Cards and status pills are painted
    /// behind the text by the transcript view.
    /// `answers`: each lane's answer by lane id. `finalText`: the answer drawn
    /// below the lanes, so a lane whose summary begins it points to it.
    static func block(_ p: RouteLanesPresentation, answers: [String: String] = [:], capacity: Int, key: String,
                      expanded: Set<String>, expandAll: Bool, finalText: String? = nil,
                      lead: NSAttributedString? = nil, trailing: NSAttributedString? = nil) -> NSAttributedString {
        let result = NSMutableAttributedString()
        let headerStyle = NSMutableParagraphStyle()
        headerStyle.paragraphSpacing = 10; headerStyle.lineSpacing = 2
        let head = NSMutableAttributedString(attributedString: header(p, lead: lead, trailing: trailing))
        head.append(NSAttributedString(string: "\n", attributes: [.font: NSFont.systemFont(ofSize: 11)]))
        head.addAttribute(.paragraphStyle, value: headerStyle, range: NSRange(location: 0, length: head.length))
        result.append(head)
        guard !p.lanes.isEmpty else { return result }

        let columns = columns(lanes: p.lanes.count, capacity: capacity)
        let table = NSTextTable()
        table.numberOfColumns = columns
        table.layoutAlgorithm = .fixedLayoutAlgorithm
        table.collapsesBorders = false
        table.setContentWidth(100, type: .percentageValueType)
        let live = p.now != nil
        for (index, lane) in p.lanes.enumerated() {
            let cell = NSTextTableBlock(table: table, startingRow: index / columns, rowSpan: 1,
                                        startingColumn: index % columns, columnSpan: 1)
            cell.setContentWidth(100 / CGFloat(columns), type: .percentageValueType)
            cell.setWidth(12, type: .absoluteValueType, for: .padding)
            cell.setWidth(4, type: .absoluteValueType, for: .padding, edge: .minY)
            cell.setWidth(gap / 2, type: .absoluteValueType, for: .margin)
            cell.setWidth(0, type: .absoluteValueType, for: .border)
            cell.verticalAlignment = .topAlignment
            let content = laneContent(lane, answer: answers[lane.id] ?? lane.publicOutputSummary, now: p.now, key: key, expanded: expanded,
                                      expandAll: expandAll, finalText: finalText)
            content.enumerateAttribute(.paragraphStyle, in: NSRange(location: 0, length: content.length)) { value, range, _ in
                let style = ((value as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle) ?? NSMutableParagraphStyle()
                style.textBlocks = [cell] + style.textBlocks
                content.addAttribute(.paragraphStyle, value: style, range: range)
            }
            content.addAttribute(.os1RouteLaneCard, value: RouteLaneCardStyle(accent: lane.qualityNotice == nil ? lane.status.color : RouteLanePalette.yellow,
                live: live, index: index, inspection: lane.inspection),
                                 range: NSRange(location: 0, length: content.length))
            result.append(content)
        }
        // A short last row keeps its cells the grid's width: AppKit widens
        // the cells of a row the table leaves incomplete. The filler cells
        // are empty and unpainted.
        for slot in p.lanes.count..<((p.lanes.count + columns - 1) / columns * columns) {
            let cell = NSTextTableBlock(table: table, startingRow: slot / columns, rowSpan: 1,
                                        startingColumn: slot % columns, columnSpan: 1)
            cell.setContentWidth(100 / CGFloat(columns), type: .percentageValueType)
            cell.setWidth(12, type: .absoluteValueType, for: .padding)
            cell.setWidth(4, type: .absoluteValueType, for: .padding, edge: .minY)
            cell.setWidth(gap / 2, type: .absoluteValueType, for: .margin)
            cell.setWidth(0, type: .absoluteValueType, for: .border)
            let style = NSMutableParagraphStyle(); style.textBlocks = [cell]
            result.append(NSAttributedString(string: "\n", attributes: [.font: NSFont.systemFont(ofSize: 4), .paragraphStyle: style]))
        }
        return result
    }

    private static func laneContent(_ lane: RouteLane, answer: String?, now: Date?, key: String, expanded: Set<String>,
                                    expandAll: Bool, finalText: String?) -> NSMutableAttributedString {
        let content = NSMutableAttributedString()
        func paragraph(_ text: NSAttributedString, before: CGFloat = 0, after: CGFloat = 3, tip: String? = nil) {
            let style = NSMutableParagraphStyle()
            style.paragraphSpacingBefore = before; style.paragraphSpacing = after; style.lineSpacing = 1.5
            let line = NSMutableAttributedString(attributedString: text)
            let font = line.length > 0 ? line.attribute(.font, at: line.length - 1, effectiveRange: nil) as? NSFont : nil
            line.append(NSAttributedString(string: "\n", attributes: [.font: font ?? NSFont.systemFont(ofSize: 11)]))
            line.addAttribute(.paragraphStyle, value: style, range: NSRange(location: 0, length: line.length))
            if let tip { line.addAttribute(.toolTip, value: tip, range: NSRange(location: 0, length: line.length - 1)) }
            content.append(line)
        }
        // Route identity: its own hue, which no status uses.
        let tint = RouteLaneSurface.tint(lane.surface)
        let title = NSMutableAttributedString(attributedString: symbol(RouteLaneSurface.symbol(lane.surface), color: tint, size: 12,
            label: RouteLaneSurface.title(lane.surface)))
        title.append(piece(" " + lane.title, NSFont.systemFont(ofSize: 12.5, weight: .semibold), tint))
        if let inspection = lane.inspection {
            title.addAttribute(.link, value: inspection.url, range: NSRange(location: 0, length: title.length))
            title.addAttribute(.os1RouteLaneInspection, value: RouteLaneInspectionBox(inspection),
                               range: NSRange(location: 0, length: title.length))
            title.addAttribute(.toolTip, value: os1Tr("기존 작업 트리의 이 노드 열기", "Open this node in the existing task inspector"),
                               range: NSRange(location: 0, length: title.length))
        }
        paragraph(title, before: 10, after: 4)
        // Model on one line, reasoning on the next: every lane in a row keeps
        // its status pill at the same height.
        let modelLine = NSMutableAttributedString()
        if let model = lane.model, !model.isEmpty {
            modelLine.append(piece(model, NSFont.systemFont(ofSize: 11, weight: .medium), RouteLanePalette.text))
            if lane.executionVerified == true {
                modelLine.append(piece(" ✓", NSFont.systemFont(ofSize: 10, weight: .semibold), RouteLanePalette.muted))
            }
        } else {
            modelLine.append(piece(os1Tr("모델 미공개", "Model not exposed"), NSFont.systemFont(ofSize: 11), RouteLanePalette.muted))
        }
        paragraph(modelLine, after: 1, tip: configurationTip(lane))
        let effortLine = NSMutableAttributedString()
        if let effort = lane.effort, !effort.isEmpty {
            effortLine.append(piece(reasoningTag(effort), NSFont.systemFont(ofSize: 10.5, weight: .medium), RouteLanePalette.secondary))
        } else {
            effortLine.append(piece(os1Tr("추론\u{00A0}미공개", "reasoning\u{00A0}not\u{00A0}exposed"), NSFont.systemFont(ofSize: 10.5),
                                    RouteLanePalette.muted))
        }
        // The observed model differs from the one Core selected: say so.
        if lane.configuration == .observed, lane.selectedModel != nil {
            effortLine.append(piece(" · " + os1Tr("관측됨", "observed"), NSFont.systemFont(ofSize: 10), RouteLanePalette.muted))
        }
        paragraph(effortLine, after: 1, tip: configurationTip(lane))
        // Every pill row has the same shape: a clock, or a dash without one.
        let status = NSMutableAttributedString(attributedString: pill(lane.qualityDisclosure == nil ? lane.status : .returned))
        status.append(piece("  " + (elapsed(start: lane.startedAt, end: lane.finishedAt, now: now) ?? "—"),
                            NSFont.monospacedDigitSystemFont(ofSize: 10.5, weight: .regular), RouteLanePalette.muted))
        paragraph(status, before: 6, after: 6)
        if let reason = lane.reason, !reason.isEmpty, lane.status != .completed {
            paragraph(piece(reason, NSFont.systemFont(ofSize: 10.5), lane.status.color.withAlphaComponent(0.9)), after: 6)
        }
        if let quality = lane.qualityNotice {
            paragraph(piece(quality, NSFont.systemFont(ofSize: 10.5, weight: .medium), RouteLanePalette.yellow), after: 6)
        }
        if let progress = lane.progressText, !progress.isEmpty {
            paragraph(piece(os1Tr("공개 진행: ", "Public progress: ") + progress,
                NSFont.systemFont(ofSize: 10.5), RouteLanePalette.secondary), after: 6)
        }
        for attempt in attemptLines(lane) {
            paragraph(piece("↳ " + attempt, NSFont.systemFont(ofSize: 10.5), RouteLanePalette.secondary), after: 6)
        }
        guard let answer = answer?.trimmingCharacters(in: .whitespacesAndNewlines), !answer.isEmpty else {
            if lane.status == .completed {
                // The live graph carries no route's output: it arrives with
                // the task's result. A note under the pill, not body text.
                paragraph(piece(now != nil ? os1Tr("답변은 최종 결과와 함께 표시", "Answer arrives with the final result")
                                           : os1Tr("답변 텍스트 없음", "No answer text"),
                                NSFont.systemFont(ofSize: 10), RouteLanePalette.muted), after: 10)
            } else {
                // Keep a little room under the status so the card breathes.
                paragraph(piece(" ", NSFont.systemFont(ofSize: 4), RouteLanePalette.muted), after: 6)
            }
            return content
        }
        if let finalText, lane.excerpt != nil,
           finalText.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix(answer) {
            paragraph(piece(os1Tr("↓ 아래 최종 답변으로 사용됨", "↓ Used as the final answer below"), NSFont.systemFont(ofSize: 10.5),
                            RouteLanePalette.muted), after: 10)
            return content
        }
        if now != nil, lane.publicOutputSummary != nil {
            paragraph(piece(os1Tr("공개 출력 요약 · 최종 답변/품질 판정 아님", "Public output summary · not a final answer or quality verdict"),
                NSFont.systemFont(ofSize: 10), RouteLanePalette.muted), after: 4)
        }
        let adopted = lane.status == .completed
        // Core's summary is cut at 600 characters: it can always open to
        // the rest of what it holds.
        let cutSummary = lane.excerpt != nil && answer.utf16.count >= 600
        let moreKey = key + "-" + lane.id + "-more"
        let open = expandAll || expanded.contains(moreKey)
        let lines = answer.components(separatedBy: "\n")
        let long = answer.count > foldCharacters || lines.count > foldLines || cutSummary
        var shown = answer
        if long, !open {
            var cut = String(answer.prefix(360))
            if lines.count > 8 { cut = lines.prefix(8).joined(separator: "\n") }
            if cut.count > 360 { cut = String(cut.prefix(360)) }
            if let space = cut.lastIndex(where: { $0 == " " || $0 == "\n" }), cut.distance(from: space, to: cut.endIndex) < 40 {
                cut = String(cut[..<space])
            }
            shown = cut.trimmingCharacters(in: .whitespacesAndNewlines) + " …"
        }
        if cutSummary, open || !long {
            shown += "\n\n" + os1Tr("(Core 요약 · 앞부분 600자 · 전체 출력은 실행 기록)",
                                    "(Core summary · first 600 characters · full output in the execution record)")
        }
        let rendered = NSMutableAttributedString(attributedString:
            TranscriptMarkdown.render(shown, key: key + "-" + lane.id, expanded: expanded, expandAll: expandAll))
        // Narrower than the conversation column: one step smaller. Output
        // the task did not adopt: one more step smaller and dimmed, so it
        // never outweighs the lane's status.
        let step: CGFloat = adopted ? 1 : 2.5
        rendered.enumerateAttribute(.font, in: NSRange(location: 0, length: rendered.length)) { value, range, _ in
            guard let font = value as? NSFont, font.pointSize > 11 else { return }
            rendered.addAttribute(.font, value: NSFont(descriptor: font.fontDescriptor,
                size: max(adopted ? 12 : 11, font.pointSize - step)) ?? font, range: range)
        }
        if !adopted {
            rendered.enumerateAttribute(.foregroundColor, in: NSRange(location: 0, length: rendered.length)) { value, range, _ in
                let color = (value as? NSColor) ?? RouteLanePalette.text
                rendered.addAttribute(.foregroundColor, value: color.withAlphaComponent(color.alphaComponent * 0.6), range: range)
            }
        }
        if rendered.length > 0 {
            let style = (rendered.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle)?.mutableCopy()
                as? NSMutableParagraphStyle ?? NSMutableParagraphStyle()
            style.paragraphSpacingBefore = 2
            let first = (rendered.string as NSString).paragraphRange(for: NSRange(location: 0, length: 0))
            rendered.addAttribute(.paragraphStyle, value: style, range: first)
        }
        // Markdown leaves the last paragraph open; the cell's paragraph must
        // end here, not run into the next lane's title.
        if rendered.length > 0, !rendered.string.hasSuffix("\n") {
            var attributes = rendered.attributes(at: rendered.length - 1, effectiveRange: nil)
            attributes.removeValue(forKey: .link); attributes.removeValue(forKey: .attachment)
            rendered.append(NSAttributedString(string: "\n", attributes: attributes))
        }
        if !adopted {
            paragraph(piece(os1Tr("미채택 출력", "Output not adopted"), NSFont.systemFont(ofSize: 10, weight: .medium),
                            RouteLanePalette.muted), before: 2, after: 2)
        }
        content.append(rendered)
        if long {
            let link = TranscriptMarkdown.detailLink(open ? os1Tr("접기", "Show less") : os1Tr("더 보기", "Show more"), key: moreKey,
                color: RouteLanePalette.secondary)
            paragraph(link, before: 2, after: 10)
        } else if let last = content.string.last, last == "\n" {
            // Breathing room under the answer inside the card.
            let end = (content.string as NSString).paragraphRange(for: NSRange(location: content.length - 1, length: 0))
            if let style = (content.attribute(.paragraphStyle, at: end.location, effectiveRange: nil) as? NSParagraphStyle)?
                .mutableCopy() as? NSMutableParagraphStyle {
                style.paragraphSpacing = max(style.paragraphSpacing, 10)
                content.addAttribute(.paragraphStyle, value: style, range: end)
            }
        }
        return content
    }
}

/// Paints the lane cards and status pills behind the transcript's text.
enum RouteLanesDrawing {
    /// How far above and below the dirty rectangle text is looked up: a
    /// card's padding holds no glyph, yet its edge may be all that is dirty.
    static let probe: CGFloat = 48

    @MainActor static func draw(in view: NSTextView, dirtyRect: NSRect) {
        guard let storage = view.textStorage, storage.length > 0,
              let layout = view.layoutManager, let container = view.textContainer else { return }
        let origin = view.textContainerOrigin
        let local = dirtyRect.offsetBy(dx: -origin.x, dy: -origin.y).insetBy(dx: 0, dy: -probe)
        let glyphs = layout.glyphRange(forBoundingRect: local, in: container)
        var characters = layout.characterRange(forGlyphRange: glyphs, actualGlyphRange: nil)
        characters = NSRange(location: max(0, characters.location - 1),
                             length: min(storage.length - max(0, characters.location - 1), characters.length + 1))
        guard characters.length > 0 else { return }
        // A cell's glyphs precede the next cell's: a short lane whose text
        // ends above the dirty rectangle is found through its table, and
        // every card of a table that reaches the rectangle is painted.
        var tables: [(table: NSTextTable, at: Int)] = [], seenTables = Set<ObjectIdentifier>()
        storage.enumerateAttribute(.os1RouteLaneCard, in: characters) { value, range, _ in
            guard value is RouteLaneCardStyle,
                  let block = (storage.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle)?
                    .textBlocks.first as? NSTextTableBlock,
                  seenTables.insert(ObjectIdentifier(block.table)).inserted else { return }
            tables.append((block.table, range.location))
        }
        var painted = Set<ObjectIdentifier>()
        var pillRanges = [characters]
        for (table, at) in tables {
            let tableRange = storage.range(of: table, at: at)
            pillRanges.append(tableRange)
            storage.enumerateAttribute(.os1RouteLaneCard, in: tableRange) { value, range, _ in
                guard let style = value as? RouteLaneCardStyle,
                      let block = (storage.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle)?
                        .textBlocks.first as? NSTextTableBlock,
                      painted.insert(ObjectIdentifier(block)).inserted else { return }
                let blockRange = storage.range(of: block, at: range.location)
                let blockGlyphs = layout.glyphRange(forCharacterRange: blockRange, actualCharacterRange: nil)
                let bounds = layout.boundsRect(for: block, glyphRange: blockGlyphs)
                let margin = block.width(for: .margin, edge: .minX)
                let rect = bounds.offsetBy(dx: origin.x, dy: origin.y).insetBy(dx: margin, dy: margin)
                guard rect.width > 4, rect.height > 4, rect.intersects(dirtyRect) else { return }
                let card = NSBezierPath(roundedRect: rect, xRadius: 12, yRadius: 12)
                RouteLanePalette.card.setFill(); card.fill()
                (style.live ? style.accent.withAlphaComponent(0.34) : RouteLanePalette.cardStroke).setStroke()
                card.lineWidth = 1; card.stroke()
                // The status accent along the card's top edge.
                NSGraphicsContext.saveGraphicsState()
                card.addClip()
                style.accent.withAlphaComponent(0.85).setFill()
                NSRect(x: rect.minX, y: rect.minY, width: rect.width, height: 2.5).fill()
                NSGraphicsContext.restoreGraphicsState()
            }
        }
        var pills = Set<Int>()
        let whole = NSRange(location: 0, length: storage.length)
        for range in pillRanges {
            storage.enumerateAttribute(.os1RouteLanePill, in: range) { value, found, _ in
                guard let style = value as? RouteLanePillStyle else { return }
                // The whole pill, even when the looked-up range cuts it.
                var range = NSRange()
                _ = storage.attribute(.os1RouteLanePill, at: found.location, longestEffectiveRange: &range, in: whole)
                guard range.length > 2, pills.insert(range.location).inserted else { return }
                let pillGlyphs = layout.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
                guard pillGlyphs.length > 2 else { return }
                // Centered on the label's own glyphs, not its line's spacing.
                let font = storage.attribute(.font, at: range.location, effectiveRange: nil) as? NSFont ?? .systemFont(ofSize: 10.5)
                let line = layout.lineFragmentRect(forGlyphAt: pillGlyphs.location, effectiveRange: nil)
                let baseline = line.minY + layout.location(forGlyphAt: pillGlyphs.location).y
                let span = layout.boundingRect(forGlyphRange: pillGlyphs, in: container)
                let height = ceil(font.ascender - font.descender) + 4
                let center = baseline - (font.ascender + font.descender) / 2
                let pill = NSRect(x: span.minX + origin.x, y: center - height / 2 + origin.y, width: span.width, height: height)
                guard pill.width > 2, pill.intersects(dirtyRect) else { return }
                let path = NSBezierPath(roundedRect: pill, xRadius: height / 2, yRadius: height / 2)
                style.color.withAlphaComponent(0.15).setFill(); path.fill()
                style.color.withAlphaComponent(0.32).setStroke(); path.lineWidth = 0.75; path.stroke()
                // The status glyph, in the space the pill reserves after its
                // leading space (it is not part of the text).
                let reserved = pillGlyphs.location + 1
                let x = line.minX + layout.location(forGlyphAt: reserved).x + origin.x + 1
                (style.glyph as NSString).draw(at: NSPoint(x: x, y: baseline + origin.y - font.ascender),
                    withAttributes: [.font: font, .foregroundColor: style.color])
            }
        }
    }
}
