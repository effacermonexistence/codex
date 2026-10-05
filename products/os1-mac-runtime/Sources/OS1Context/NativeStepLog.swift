import Foundation

/// The app's per-run list of tool steps, merged by step id from successive
/// activity snapshots. The activity file holds only the latest state and its
/// ring keeps 24 steps; some emits carry no progress at all. Accumulating here
/// keeps a step that scrolled out of the ring, and keeps the list across those
/// emits, for as long as the run is on screen. It is not persisted.
public struct NativeStepLog: Equatable, Sendable {
    public struct Entry: Equatable, Sendable, Identifiable {
        public internal(set) var step: NativeExecutionProgress.Step
        /// Increments when a new native stream starts (sequence went down).
        public let segment: Int
        /// The step is still in the latest received ring. A requested step that
        /// scrolled out may have returned unseen, so it is not shown as waiting.
        public internal(set) var inLatestRing: Bool
        public var id: String { "\(segment)|\(step.id)" }
    }
    public static let capacity = 200
    public private(set) var entries: [Entry] = []
    public private(set) var segment = 0
    private var lastSequence = 0

    public init() {}
    public init(merging progress: NativeExecutionProgress?) { merge(progress) }

    public var isEmpty: Bool { entries.isEmpty }

    public mutating func merge(_ progress: NativeExecutionProgress?) {
        guard let progress, progress.isValid else { return }
        if progress.sequence < lastSequence, !entries.isEmpty { segment += 1 }
        lastSequence = progress.sequence
        let incoming = progress.steps ?? []
        let ids = Set(incoming.map(\.id))
        for index in entries.indices where entries[index].segment == segment {
            entries[index].inLatestRing = ids.contains(entries[index].step.id)
        }
        for step in incoming {
            if let index = entries.lastIndex(where: { $0.segment == segment && $0.step.id == step.id }) {
                entries[index].step = Self.merged(entries[index].step, step)
            } else {
                entries.append(Entry(step: step, segment: segment, inLatestRing: true))
            }
        }
        if entries.count > Self.capacity { entries.removeFirst(entries.count - Self.capacity) }
    }

    /// Labels are write-once and state only moves forward, matching the CLI;
    /// a stale or reordered snapshot cannot undo a later observation.
    static func merged(_ old: NativeExecutionProgress.Step, _ new: NativeExecutionProgress.Step) -> NativeExecutionProgress.Step {
        var step = old
        if step.label == nil, new.label != nil { step.label = new.label; step.verb = new.verb }
        if step.state == .requested, new.state != .requested { step.state = new.state; step.endedAt = new.endedAt }
        if let uses = new.childToolUses, uses >= (step.childToolUses ?? 0) {
            step.childToolUses = uses; step.lastChildTool = new.lastChildTool
        }
        return step
    }

    /// The newest step still awaiting its return in the latest ring.
    public var latestWaiting: NativeExecutionProgress.Step? {
        entries.last { $0.segment == segment && $0.inLatestRing && $0.step.state == .requested }?.step
    }
}

extension NativeExecutionProgress {
    /// The newest step in this snapshot still awaiting its return.
    public var latestWaitingStep: Step? { steps?.last { $0.state == .requested } }
}
