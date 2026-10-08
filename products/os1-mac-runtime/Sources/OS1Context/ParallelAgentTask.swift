import Foundation
import Darwin

/// OS-1-owned task graph. Plans are private executable input; snapshots are
/// bounded public execution receipts. Neither object grants a signed ticket.
/// The runtime owns process launch, native-session custody and cancellation.
public enum ParallelAgentTask {
    public static let maximumWorkers = 3
    /// Explicit native-route fanout may expose eight nodes; planner drafts stay bounded at three.
    public static let maximumWorkerNodes = 8
    public static let maximumNodes = 12
    public static let maximumSnapshotBytes = 64_000
    public enum Role: String, Codable, Sendable { case coordinator, planner, worker, primary }
    public enum State: String, Codable, Sendable {
        case pending, running, succeeded, failed, blocked, cancelled, interrupted
        public var isTerminal: Bool { self != .pending && self != .running }
        public var preventsDependencies: Bool { isTerminal && self != .succeeded }
    }
    public enum Failure: Error, Equatable, LocalizedError {
        case invalidDraft, invalidPlan, invalidSnapshot, bindingMismatch, unsafePath, oversized, invalidTransition
        public var errorDescription: String? {
            switch self {
            case .invalidDraft: return "Invalid bounded parallel-task draft."
            case .invalidPlan: return "Invalid private parallel-task plan."
            case .invalidSnapshot: return "Invalid public parallel-task snapshot."
            case .bindingMismatch: return "Parallel-task parent binding does not match."
            case .unsafePath: return "Parallel-task snapshot is not a private regular file."
            case .oversized: return "Parallel-task snapshot exceeds its read budget."
            case .invalidTransition: return "Parallel-task lifecycle transition is not permitted."
            }
        }
    }

    /// Model-produced candidate only: no provider, permissions, paths or native
    /// session identifiers are accepted from the planner's JSON.
    public struct DraftTask: Codable, Equatable, Sendable {
        public var id: String
        public var title: String
        public var instruction: String
        public var dependencies: [String]
        public var scope: TaskContext.Scope
        public var ownedPaths: [String]
        public init(id: String, title: String, instruction: String, dependencies: [String] = [],
                    scope: TaskContext.Scope = .readOnly, ownedPaths: [String] = []) {
            self.id = id; self.title = title; self.instruction = instruction; self.dependencies = dependencies
            self.scope = scope; self.ownedPaths = ownedPaths
        }
        private enum CodingKeys: String, CodingKey { case id, title, instruction, dependencies, scope, ownedPaths }
        public init(from decoder: Decoder) throws {
            try exactKeys(decoder, ["id", "title", "instruction", "dependencies", "scope", "ownedPaths"])
            let c = try decoder.container(keyedBy: CodingKeys.self)
            self.init(id: try c.decode(String.self, forKey: .id), title: try c.decode(String.self, forKey: .title),
                      instruction: try c.decode(String.self, forKey: .instruction),
                      dependencies: try c.decodeIfPresent([String].self, forKey: .dependencies) ?? [],
                      scope: try c.decodeIfPresent(TaskContext.Scope.self, forKey: .scope) ?? .readOnly,
                      ownedPaths: try c.decodeIfPresent([String].self, forKey: .ownedPaths) ?? [])
        }
    }
    public struct Draft: Codable, Equatable, Sendable {
        public var tasks: [DraftTask]
        public init(tasks: [DraftTask]) { self.tasks = tasks }
        private enum CodingKeys: String, CodingKey { case tasks }
        public init(from decoder: Decoder) throws {
            try exactKeys(decoder, ["tasks"])
            let c = try decoder.container(keyedBy: CodingKeys.self)
            tasks = try c.decode([DraftTask].self, forKey: .tasks)
            _ = try validated()
        }
        public func validated() throws -> Self {
            guard (2...maximumWorkers).contains(tasks.count), Set(tasks.map(\.id)).count == tasks.count,
                  tasks.allSatisfy({ slug($0.id) && nonempty($0.title, maximum: 120) &&
                      nonempty($0.instruction, maximum: 6_000) && $0.dependencies.count <= maximumWorkers &&
                      Set($0.dependencies).count == $0.dependencies.count && !$0.dependencies.contains($0.id) &&
                      validOwnership(scope: $0.scope, paths: $0.ownedPaths, dependencies: $0.dependencies.count) })
            else { throw Failure.invalidDraft }
            guard disjointOwnership(tasks.filter { $0.scope == .workspaceWrite }.map(\.ownedPaths)) else { throw Failure.invalidDraft }
            try validateDAG(Dictionary(uniqueKeysWithValues: tasks.map { ($0.id, $0.dependencies) }), failure: .invalidDraft)
            return self
        }
    }

    /// Public Swift visibility permits the runtime module to use this type.
    /// This private-custody payload must never be attached to RuntimeActivity.
    public struct WorkerSpec: Codable, Equatable, Sendable {
        public var id: UUID
        public var slug: String
        public var title: String
        public var instruction: String
        public var dependencies: [UUID]
        public var scope: TaskContext.Scope
        public var ownedPaths: [String]
        public init(id: UUID = UUID(), slug: String, title: String, instruction: String,
                    dependencies: [UUID] = [], scope: TaskContext.Scope = .readOnly, ownedPaths: [String] = []) {
            self.id = id; self.slug = slug; self.title = title; self.instruction = instruction
            self.dependencies = dependencies; self.scope = scope; self.ownedPaths = ownedPaths
        }
        private enum CodingKeys: String, CodingKey { case id, slug, title, instruction, dependencies, scope, ownedPaths }
        public init(from decoder: Decoder) throws {
            try exactKeys(decoder, ["id", "slug", "title", "instruction", "dependencies", "scope", "ownedPaths"])
            let c = try decoder.container(keyedBy: CodingKeys.self)
            self.init(id: try c.decode(UUID.self, forKey: .id), slug: try c.decode(String.self, forKey: .slug),
                title: try c.decode(String.self, forKey: .title), instruction: try c.decode(String.self, forKey: .instruction),
                dependencies: try c.decodeIfPresent([UUID].self, forKey: .dependencies) ?? [],
                scope: try c.decodeIfPresent(TaskContext.Scope.self, forKey: .scope) ?? .readOnly,
                ownedPaths: try c.decodeIfPresent([String].self, forKey: .ownedPaths) ?? [])
        }
    }
    public struct Plan: Codable, Equatable, Sendable {
        public var planID: UUID
        public var conversationID: UUID
        public var submissionID: UUID
        public var requestSHA256: String
        public var rootNodeID: UUID
        public var plannerNodeID: UUID
        public var primaryNodeID: UUID
        public var originalInstruction: String
        public var workspace: String
        public var workers: [WorkerSpec]
        public var maxParallelism: Int
        public var scope: TaskContext.Scope
        public init(planID: UUID = UUID(), conversationID: UUID, submissionID: UUID, requestSHA256: String,
                    rootNodeID: UUID = UUID(), plannerNodeID: UUID = UUID(), primaryNodeID: UUID = UUID(),
                    originalInstruction: String, workspace: String, workers: [WorkerSpec], maxParallelism: Int = 3,
                    scope: TaskContext.Scope = .workspaceWrite) {
            self.planID = planID; self.conversationID = conversationID; self.submissionID = submissionID
            self.requestSHA256 = requestSHA256; self.rootNodeID = rootNodeID; self.plannerNodeID = plannerNodeID
            self.primaryNodeID = primaryNodeID; self.originalInstruction = originalInstruction
            self.workspace = workspace; self.workers = workers; self.maxParallelism = maxParallelism; self.scope = scope
        }
        public func validated() throws -> Self {
            let ids = [rootNodeID, plannerNodeID, primaryNodeID] + workers.map(\.id)
            guard digest(requestSHA256), (2...maximumWorkers).contains(workers.count),
                  (1...maximumWorkers).contains(maxParallelism), scope != .fullAccess,
                  nonempty(originalInstruction, maximum: 64_000), safeAbsolutePath(workspace),
                  Set(ids).count == ids.count, Set(workers.map(\.slug)).count == workers.count,
                  workers.allSatisfy({ ($0.scope != .workspaceWrite || scope == .workspaceWrite) &&
                      validOwnership(scope: $0.scope, paths: $0.ownedPaths, dependencies: $0.dependencies.count) && slug($0.slug) && nonempty($0.title, maximum: 120) &&
                      nonempty($0.instruction, maximum: 6_000) && Set($0.dependencies).count == $0.dependencies.count &&
                      $0.dependencies.count <= maximumWorkers && !$0.dependencies.contains($0.id) })
            else { throw Failure.invalidPlan }
            // Dependent write pipelines need a separate snapshot/merge boundary;
            // never claim a child saw another candidate's unmerged files.
            guard !workers.contains(where: { $0.scope == .workspaceWrite }) || workers.allSatisfy({ $0.dependencies.isEmpty })
            else { throw Failure.invalidPlan }
            guard disjointOwnership(workers.filter { $0.scope == .workspaceWrite }.map(\.ownedPaths)) else { throw Failure.invalidPlan }
            try validateDAG(Dictionary(uniqueKeysWithValues: workers.map { ($0.id, $0.dependencies) }), failure: .invalidPlan)
            return self
        }
    }

    public struct Node: Codable, Equatable, Sendable {
        public typealias Role = ParallelAgentTask.Role
        public typealias State = ParallelAgentTask.State
        public var id: UUID
        public var parentID: UUID?
        public var dependencies: [UUID]
        public var title: String
        public var role: Role
        public var state: State
        public var provider: String?
        public var surface: String?
        public var model: String?
        public var effort: String?
        public var nativeSessionID: String?
        public var workerSubmissionID: UUID?
        public var startedAt: Date?
        public var finishedAt: Date?
        public var progressText: String?
        public var tool: String?
        public var resultSummary: String?
        public var failureSummary: String?
        public var scope: TaskContext.Scope?
        public var workspace: String?
        public var ownedPaths: [String]?
        public var nativeProgress: NativeExecutionProgress?
        public init(id: UUID = UUID(), parentID: UUID? = nil, dependencies: [UUID] = [], title: String,
                    role: Role, state: State = .pending, provider: String? = nil, surface: String? = nil, model: String? = nil,
                    effort: String? = nil, nativeSessionID: String? = nil, workerSubmissionID: UUID? = nil,
                    startedAt: Date? = nil, finishedAt: Date? = nil, progressText: String? = nil, tool: String? = nil,
                    resultSummary: String? = nil, failureSummary: String? = nil, scope: TaskContext.Scope? = nil,
                    workspace: String? = nil, ownedPaths: [String]? = nil, nativeProgress: NativeExecutionProgress? = nil) {
            self.id = id; self.parentID = parentID; self.dependencies = dependencies; self.title = title
            self.role = role; self.state = state; self.provider = provider; self.surface = surface; self.model = model; self.effort = effort
            self.nativeSessionID = nativeSessionID; self.workerSubmissionID = workerSubmissionID
            self.startedAt = startedAt; self.finishedAt = finishedAt; self.progressText = progressText; self.tool = tool
            self.resultSummary = resultSummary; self.failureSummary = failureSummary
            self.scope = scope; self.workspace = workspace; self.ownedPaths = ownedPaths; self.nativeProgress = nativeProgress
        }
        private enum CodingKeys: String, CodingKey {
            case id, parentID, dependencies, title, role, state, provider, surface, model, effort, nativeSessionID
            case workerSubmissionID, startedAt, finishedAt, progressText, tool, resultSummary, failureSummary, scope, workspace, ownedPaths, nativeProgress
        }
        public init(from decoder: Decoder) throws {
            try exactKeys(decoder, ["id", "parentID", "dependencies", "title", "role", "state", "provider", "surface", "model",
                "effort", "nativeSessionID", "workerSubmissionID", "startedAt", "finishedAt", "progressText", "tool",
                "resultSummary", "failureSummary", "scope", "workspace", "ownedPaths", "nativeProgress"])
            let c = try decoder.container(keyedBy: CodingKeys.self)
            self.init(id: try c.decode(UUID.self, forKey: .id), parentID: try c.decodeIfPresent(UUID.self, forKey: .parentID),
                dependencies: try c.decode([UUID].self, forKey: .dependencies), title: try c.decode(String.self, forKey: .title),
                role: try c.decode(Role.self, forKey: .role), state: try c.decode(State.self, forKey: .state),
                provider: try c.decodeIfPresent(String.self, forKey: .provider), surface: try c.decodeIfPresent(String.self, forKey: .surface), model: try c.decodeIfPresent(String.self, forKey: .model),
                effort: try c.decodeIfPresent(String.self, forKey: .effort), nativeSessionID: try c.decodeIfPresent(String.self, forKey: .nativeSessionID),
                workerSubmissionID: try c.decodeIfPresent(UUID.self, forKey: .workerSubmissionID),
                startedAt: try c.decodeIfPresent(Date.self, forKey: .startedAt), finishedAt: try c.decodeIfPresent(Date.self, forKey: .finishedAt),
                progressText: try c.decodeIfPresent(String.self, forKey: .progressText), tool: try c.decodeIfPresent(String.self, forKey: .tool),
                resultSummary: try c.decodeIfPresent(String.self, forKey: .resultSummary), failureSummary: try c.decodeIfPresent(String.self, forKey: .failureSummary),
                scope: try c.decodeIfPresent(TaskContext.Scope.self, forKey: .scope),
                workspace: try c.decodeIfPresent(String.self, forKey: .workspace),
                ownedPaths: try c.decodeIfPresent([String].self, forKey: .ownedPaths),
                nativeProgress: try? c.decode(NativeExecutionProgress.self, forKey: .nativeProgress))
        }
    }

    public struct Snapshot: Codable, Equatable, Sendable {
        public var schema: Int
        public var planID: UUID
        public var conversationID: UUID
        public var submissionID: UUID
        public var requestSHA256: String
        public var rootNodeID: UUID
        public var objective: String
        public var createdAt: Date
        public var updatedAt: Date
        public var maxParallelism: Int
        public var nodes: [Node]
        public init(schema: Int = 1, planID: UUID = UUID(), conversationID: UUID, submissionID: UUID,
                    requestSHA256: String, rootNodeID: UUID, objective: String, createdAt: Date = Date(),
                    updatedAt: Date = Date(), maxParallelism: Int = 3, nodes: [Node]) {
            self.schema = schema; self.planID = planID; self.conversationID = conversationID; self.submissionID = submissionID
            self.requestSHA256 = requestSHA256; self.rootNodeID = rootNodeID; self.objective = objective
            self.createdAt = createdAt; self.updatedAt = updatedAt; self.maxParallelism = maxParallelism; self.nodes = nodes
        }
        private enum CodingKeys: String, CodingKey {
            case schema, planID, conversationID, submissionID, requestSHA256, rootNodeID, objective
            case createdAt, updatedAt, maxParallelism, nodes
        }
        public init(from decoder: Decoder) throws {
            try exactKeys(decoder, ["schema", "planID", "conversationID", "submissionID", "requestSHA256", "rootNodeID",
                "objective", "createdAt", "updatedAt", "maxParallelism", "nodes"])
            let c = try decoder.container(keyedBy: CodingKeys.self)
            self.init(schema: try c.decode(Int.self, forKey: .schema), planID: try c.decode(UUID.self, forKey: .planID),
                conversationID: try c.decode(UUID.self, forKey: .conversationID), submissionID: try c.decode(UUID.self, forKey: .submissionID),
                requestSHA256: try c.decode(String.self, forKey: .requestSHA256), rootNodeID: try c.decode(UUID.self, forKey: .rootNodeID),
                objective: try c.decode(String.self, forKey: .objective), createdAt: try c.decode(Date.self, forKey: .createdAt),
                updatedAt: try c.decode(Date.self, forKey: .updatedAt), maxParallelism: try c.decode(Int.self, forKey: .maxParallelism),
                nodes: try c.decode([Node].self, forKey: .nodes))
            self = try validated()
        }
        public var isValid: Bool { (try? validated()) != nil }
        public func validated(conversationID expectedConversation: UUID? = nil, submissionID expectedSubmission: UUID? = nil,
                              requestSHA256 expectedRequest: String? = nil) throws -> Self {
            if expectedConversation.map({ $0 != conversationID }) ?? false ||
                expectedSubmission.map({ $0 != submissionID }) ?? false ||
                expectedRequest.map({ $0 != requestSHA256 }) ?? false { throw Failure.bindingMismatch }
            guard schema == 1, digest(requestSHA256), (1...maximumParallelism).contains(maxParallelism),
                  !nodes.isEmpty, nodes.count <= maximumNodes, Set(nodes.map(\.id)).count == nodes.count,
                  nonempty(objective, maximum: 500), finite(createdAt), finite(updatedAt), updatedAt >= createdAt,
                  nodes.filter({ $0.role == .coordinator }).count == 1,
                  nodes.filter({ $0.role == .planner }).count <= 1, nodes.filter({ $0.role == .primary }).count <= 2,
                  nodes.filter({ $0.role == .primary && !$0.state.isTerminal }).count <= 1,
                  nodes.filter({ $0.role == .worker }).count <= maximumWorkerNodes,
                  let root = nodes.first(where: { $0.id == rootNodeID }), root.role == .coordinator,
                  root.parentID == nil, root.dependencies.isEmpty,
                  nodes.filter({ $0.role == .worker && $0.state == .running }).count <= maxParallelism
            else { throw Failure.invalidSnapshot }
            let ids = Set(nodes.map(\.id))
            let primaries = nodes.filter { $0.role == .primary }
            // Failed preparation retains its blocked join. A distinct fallback
            // may run the original owner task, not rewrite that join as success.
            if primaries.count == 2 {
                guard primaries.filter({ $0.state == .blocked }).count == 1,
                      primaries.first(where: { $0.state != .blocked })?.dependencies.isEmpty == true
                else { throw Failure.invalidSnapshot }
            }
            let byID = Dictionary(uniqueKeysWithValues: nodes.map { ($0.id, $0) })
            guard nodes.allSatisfy({ node in
                ![State.running, .succeeded].contains(node.state) ||
                    node.dependencies.allSatisfy({ byID[$0]?.state == .succeeded })
            }) else { throw Failure.invalidSnapshot }
            var copy = self
            copy.objective = publicText(objective, maximum: 500) ?? "Task"
            for i in copy.nodes.indices {
                var node = copy.nodes[i]
                guard nonempty(node.title, maximum: 120), node.id == rootNodeID || node.parentID == rootNodeID,
                      Set(node.dependencies).count == node.dependencies.count, node.dependencies.count <= maximumNodes,
                      node.dependencies.allSatisfy({ ids.contains($0) && $0 != node.id && $0 != rootNodeID }),
                      optional(node.model, maximum: 128), optional(node.effort, maximum: 32),
                      node.provider.map({ ["codex", "claude", "local"].contains($0) }) ?? true,
                      node.surface.map({ ProviderSurface(rawValue: $0) != nil }) ?? true,
                      node.nativeSessionID.map({ UUID(uuidString: $0) != nil }) ?? true,
                      node.tool.map(NativeExecutionProgress.safeToolName) ?? true,
                      optional(node.progressText, maximum: 500), optional(node.resultSummary, maximum: 1_000),
                      optional(node.failureSummary, maximum: 500), node.startedAt.map(finite) ?? true,
                      node.finishedAt.map(finite) ?? true,
                      node.startedAt.map({ $0 >= createdAt && $0 <= updatedAt }) ?? true,
                      node.finishedAt.map({ $0 >= (node.startedAt ?? createdAt) && $0 <= updatedAt }) ?? true,
                      node.state.isTerminal == (node.finishedAt != nil),
                      node.state != .pending || node.startedAt == nil,
                      node.state != .running || node.startedAt != nil,
                      node.state != .succeeded || node.startedAt != nil,
                      node.role == .worker || node.workerSubmissionID == nil,
                      node.workerSubmissionID.map({ $0 != submissionID }) ?? true,
                      node.scope != .fullAccess, node.workspace.map(safeAbsolutePath) ?? true,
                      (node.ownedPaths?.count ?? 0) <= 12, node.ownedPaths?.allSatisfy(relativeOwnedPath) ?? true,
                      node.nativeProgress.map({ $0.isValid }) ?? true
                else { throw Failure.invalidSnapshot }
                node.title = publicText(node.title, maximum: 120) ?? "Task"
                node.progressText = node.progressText.flatMap { publicText($0, maximum: 500) }
                node.resultSummary = node.resultSummary.flatMap { publicText($0, maximum: 1_000) }
                node.failureSummary = node.failureSummary.flatMap { publicText($0, maximum: 500) }
                node.nativeSessionID = node.nativeSessionID.flatMap { UUID(uuidString: $0)?.uuidString.lowercased() }
                node.nativeProgress = node.nativeProgress.flatMap(boundedProgress)
                copy.nodes[i] = node
            }
            let submissions = nodes.compactMap(\.workerSubmissionID)
            guard Set(submissions).count == submissions.count else { throw Failure.invalidSnapshot }
            try validateDAG(Dictionary(uniqueKeysWithValues: nodes.map { ($0.id, $0.dependencies) }), failure: .invalidSnapshot)
            return copy
        }
        public static func fromPlan(_ plan: Plan, createdAt: Date = Date(), objective: String? = nil) throws -> Self {
            _ = try plan.validated()
            let root = Node(id: plan.rootNodeID, title: "Parallel task", role: .coordinator)
            let planner = Node(id: plan.plannerNodeID, parentID: plan.rootNodeID, title: "Task planning", role: .planner)
            let workers = plan.workers.map { Node(id: $0.id, parentID: plan.rootNodeID,
                dependencies: [plan.plannerNodeID] + $0.dependencies, title: $0.title, role: .worker,
                scope: $0.scope, ownedPaths: $0.ownedPaths) }
            let primary = Node(id: plan.primaryNodeID, parentID: plan.rootNodeID, dependencies: plan.workers.map(\.id),
                title: "Primary execution", role: .primary)
            return try Self(planID: plan.planID, conversationID: plan.conversationID, submissionID: plan.submissionID,
                requestSHA256: plan.requestSHA256, rootNodeID: plan.rootNodeID,
                objective: publicText(objective ?? plan.originalInstruction, maximum: 500) ?? "Task",
                createdAt: createdAt, updatedAt: createdAt, maxParallelism: plan.maxParallelism,
                nodes: [root, planner] + workers + [primary]).validated()
        }
        public func encoded() throws -> Data {
            let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
            let data = try encoder.encode(validated())
            guard data.count <= maximumSnapshotBytes else { throw Failure.oversized }
            return data
        }
        public static func decode(_ data: Data, conversationID: UUID? = nil, submissionID: UUID? = nil,
                                  requestSHA256: String? = nil) throws -> Self {
            guard data.count <= maximumSnapshotBytes else { throw Failure.oversized }
            return try JSONDecoder().decode(Self.self, from: data).validated(conversationID: conversationID,
                submissionID: submissionID, requestSHA256: requestSHA256)
        }
        public mutating func transition(nodeID: UUID, to state: State, at: Date = Date()) throws {
            _ = try validated()
            guard let i = nodes.firstIndex(where: { $0.id == nodeID }), !nodes[i].state.isTerminal,
                  finite(at), at >= updatedAt else { throw Failure.invalidTransition }
            let prior = nodes[i].state
            guard (prior == .pending && [.running, .blocked, .cancelled, .interrupted].contains(state)) ||
                  (prior == .running && state.isTerminal) else { throw Failure.invalidTransition }
            if state == .running {
                let byID = Dictionary(uniqueKeysWithValues: nodes.map { ($0.id, $0) })
                guard nodes[i].dependencies.allSatisfy({ byID[$0]?.state == .succeeded }),
                      nodes[i].role != .worker || nodes.filter({ $0.role == .worker && $0.state == .running }).count < maxParallelism
                else { throw Failure.invalidTransition }
            }
            var copy = self; copy.updatedAt = at; copy.nodes[i].state = state
            if state == .running { copy.nodes[i].startedAt = at }
            if state.isTerminal { copy.nodes[i].finishedAt = at }
            self = try copy.validated()
        }
        public mutating func blockFailedDependencies(at: Date = Date()) {
            guard finite(at), at >= updatedAt else { return }
            var changed = true
            while changed {
                changed = false
                let bad = Set(nodes.filter { $0.state.preventsDependencies }.map(\.id))
                for i in nodes.indices where nodes[i].state == .pending && nodes[i].dependencies.contains(where: bad.contains) {
                    nodes[i].state = .blocked; nodes[i].finishedAt = at; changed = true
                }
            }
            updatedAt = at
        }
        public mutating func reconcileAfterRestart(at: Date = Date()) {
            guard finite(at), at >= updatedAt else { return }
            for i in nodes.indices where nodes[i].state == .running {
                nodes[i].state = .interrupted; nodes[i].finishedAt = at
                nodes[i].failureSummary = "Execution interrupted; automatic replay not authorized."
            }
            updatedAt = at; blockFailedDependencies(at: at)
        }
    }

    /// Selection only, not process scheduling. The runtime remains the sole
    /// graph writer and marks started nodes before it launches fresh children.
    public static func readyWorkerIDs(in snapshot: Snapshot, limit: Int? = nil) throws -> [UUID] {
        let snapshot = try snapshot.validated()
        let workers = snapshot.nodes.filter { $0.role == .worker }
        guard (2...maximumWorkerNodes).contains(workers.count), limit.map({ (0...maximumWorkerNodes).contains($0) }) ?? true
        else { throw Failure.invalidSnapshot }
        guard snapshot.nodes.first(where: { $0.id == snapshot.rootNodeID })?.state == .running else { return [] }
        let byID = Dictionary(uniqueKeysWithValues: snapshot.nodes.map { ($0.id, $0) })
        let available = max(0, snapshot.maxParallelism - workers.filter { $0.state == .running }.count)
        return workers.filter { $0.state == .pending && $0.dependencies.allSatisfy { byID[$0]?.state == .succeeded } }
            .prefix(min(available, limit ?? maximumWorkerNodes)).map(\.id)
    }

    /// Heuristic masking is shared with existing native public progress. Never
    /// pass prompts, raw results or reasoning as a summary in the first place.
    public static func publicText(_ raw: String, maximum: Int = 500) -> String? {
        let bounded = String(raw.prefix(max(0, min(maximum, 2_048))))
        return NativeStepLabel.redact(bounded).map { String($0.prefix(maximum)) }
    }
    /// The child's own progress journal retains its full bounded ring. The
    /// multi-child snapshot preserves current counters/events and only the
    /// newest step ring that fits each node's display budget.
    private static func boundedProgress(_ progress: NativeExecutionProgress) -> NativeExecutionProgress? {
        guard progress.isValid else { return nil }
        var steps = Array((progress.steps ?? []).suffix(8))
        while true {
            let candidate = progress.replacing(steps: steps, backendStatus: progress.backendStatus)
            if let bytes = try? JSONEncoder().encode(candidate), bytes.count <= 5_500 { return candidate }
            guard !steps.isEmpty else { return nil }
            steps.removeFirst()
        }
    }

    public static func loadBound(path: String, conversationID: UUID, submissionID: UUID,
                                 requestSHA256: String? = nil) throws -> Snapshot? {
        let (parent, name) = try privateParent(path)
        defer { Darwin.close(parent) }
        let fd = openat(parent, name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        guard fd >= 0 else { if errno == ENOENT { return nil }; throw Failure.unsafePath }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true); defer { try? handle.close() }
        var before = stat()
        guard fstat(fd, &before) == 0, (before.st_mode & S_IFMT) == S_IFREG, before.st_nlink == 1,
              before.st_uid == getuid(), (before.st_mode & 0o077) == 0, before.st_size >= 0
        else { throw Failure.unsafePath }
        guard before.st_size <= maximumSnapshotBytes else { throw Failure.oversized }
        let data = try handle.read(upToCount: maximumSnapshotBytes + 1) ?? Data()
        var after = stat()
        guard fstat(fd, &after) == 0, before.st_size == after.st_size, before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec,
              before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec, data.count == before.st_size
        else { throw Failure.invalidSnapshot }
        return try Snapshot.decode(data, conversationID: conversationID, submissionID: submissionID, requestSHA256: requestSHA256)
    }
    public static func saveBound(_ snapshot: Snapshot, path: String) throws {
        let data = try snapshot.encoded()
        let (parent, name) = try privateParent(path); defer { Darwin.close(parent) }
        var info = stat()
        if fstatat(parent, name, &info, AT_SYMLINK_NOFOLLOW) == 0 {
            guard (info.st_mode & S_IFMT) == S_IFREG, info.st_nlink == 1, info.st_uid == getuid(), (info.st_mode & 0o077) == 0
            else { throw Failure.unsafePath }
        } else if errno != ENOENT { throw Failure.unsafePath }
        let temporary = ".agent-task-" + UUID().uuidString.lowercased()
        let fd = openat(parent, temporary, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw Failure.unsafePath }
        defer { _ = unlinkat(parent, temporary, 0) }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        do { try handle.write(contentsOf: data); try handle.synchronize(); try handle.close() }
        catch { try? handle.close(); throw error }
        guard renameat(parent, temporary, parent, name) == 0 else { throw Failure.unsafePath }
        _ = fsync(parent)
        guard let readback = try loadBound(path: path, conversationID: snapshot.conversationID,
            submissionID: snapshot.submissionID, requestSHA256: snapshot.requestSHA256), try readback.encoded() == data
        else { throw Failure.invalidSnapshot }
    }
    private static func privateParent(_ path: String) throws -> (Int32, String) {
        guard safeAbsolutePath(path) else { throw Failure.unsafePath }
        let url = URL(fileURLWithPath: path), parent = url.deletingLastPathComponent()
        guard parent.resolvingSymlinksInPath() == parent.standardizedFileURL else { throw Failure.unsafePath }
        let fd = Darwin.open(parent.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw Failure.unsafePath }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_uid == getuid(), (info.st_mode & 0o077) == 0 else {
            Darwin.close(fd); throw Failure.unsafePath
        }
        return (fd, url.lastPathComponent)
    }
    /// Lexical ownership only. The executor also checks Git paths and symlink ancestors.
    public static func relativeOwnedPath(_ path: String) -> Bool {
        guard !path.isEmpty, !path.hasPrefix("/"), path.utf8.count <= 1_024,
              !path.contains("\\"), !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
        else { return false }
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        let forbidden = Set([".git", ".os1", ".claude", ".codex", "agents.md", "claude.md", "handy",
            ".github", "scripts", "tests", "test", "policy", "policies", "config", "configuration", "signing",
            "release", "version", "info.plist", "package.swift", "package.resolved", "main.swift", "os1app.swift",
            "ownerpolicy.swift", "runtimeconfig.swift", "taskcontext.swift", "parallelagenttask.swift",
            "sourcewriteadmission.swift", "os1sourceconfinement.swift", "selfupdate.swift", "selfupdatecommands.swift",
            "parallelagentcoordinator.swift", "parallelprojectworkspace.swift"])
        guard parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && !forbidden.contains($0.lowercased()) }),
              !parts.contains(where: { $0.lowercased().contains("validator") || $0.lowercased().contains("governance") ||
                $0.lowercased().contains("selfupdate") || $0.lowercased().contains("permission") || $0.lowercased().contains("credential") }) else { return false }
        return true
    }
    public static func disjointOwnership(_ sets: [[String]]) -> Bool {
        for i in sets.indices { for j in sets.indices where j > i {
            for a in sets[i] { for b in sets[j] {
                if a == b || a.hasPrefix(b + "/") || b.hasPrefix(a + "/") { return false }
            }}
        }}
        return true
    }
    private static func validOwnership(scope: TaskContext.Scope, paths: [String], dependencies: Int) -> Bool {
        switch scope {
        case .readOnly: return paths.isEmpty
        case .workspaceWrite: return dependencies == 0 && !paths.isEmpty && paths.count <= 12 &&
            Set(paths).count == paths.count && paths.allSatisfy(relativeOwnedPath) && disjointOwnership(paths.map { [$0] })
        case .fullAccess: return false
        }
    }
    private static func safeAbsolutePath(_ path: String) -> Bool {
        path.hasPrefix("/") && path.utf8.count <= 4_096 && !path.contains("\0") && !path.contains("\\") &&
            path.split(separator: "/", omittingEmptySubsequences: false).dropFirst().allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }
    private static func nonempty(_ value: String, maximum: Int) -> Bool {
        !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && value.count <= maximum &&
            value.utf8.count <= maximum * 4 && !value.contains("\0")
    }
    private static func optional(_ value: String?, maximum: Int) -> Bool { value.map { nonempty($0, maximum: maximum) } ?? true }
    private static func digest(_ value: String) -> Bool { value.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) != nil }
    private static func slug(_ value: String) -> Bool { value.range(of: #"^[a-z][a-z0-9_-]{0,47}$"#, options: .regularExpression) != nil }
    private static func finite(_ value: Date) -> Bool { value.timeIntervalSince1970.isFinite }
    private static func validateDAG<Key: Hashable>(_ edges: [Key: [Key]], failure: Failure) throws {
        var visited = Set<Key>(), active = Set<Key>()
        func visit(_ key: Key) throws {
            if visited.contains(key) { return }
            guard !active.contains(key), let dependencies = edges[key] else { throw failure }
            active.insert(key)
            for dependency in dependencies { try visit(dependency) }
            active.remove(key); visited.insert(key)
        }
        for key in edges.keys { try visit(key) }
    }
    private struct AnyKey: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }
    private static func exactKeys(_ decoder: Decoder, _ keys: Set<String>) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        guard c.allKeys.allSatisfy({ keys.contains($0.stringValue) }) else { throw Failure.invalidSnapshot }
    }
    private static let maximumParallelism = maximumWorkerNodes
}
