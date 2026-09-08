import Darwin
import Foundation

/// OS1-owned shared task state for one conversation. Backend session IDs are
/// bindings inside this state, never a substitute for it: a new native session
/// must not reset the objective, decisions, project baseline or sources.
public struct TaskContext: Codable, Equatable, Sendable {
    public static let schemaVersion = 1

    public enum ObjectiveKind: String, Codable, Sendable { case acquire, prepare, modify, explain, verify, other }
    public enum Scope: String, Codable, Sendable {
        case readOnly = "read_only", workspaceWrite = "workspace_write", fullAccess = "full_access"
    }

    public struct Objective: Codable, Equatable, Sendable {
        public var requestText: String
        public var kind: ObjectiveKind
        public var completionConditions: [String]
        public var scope: Scope
        public var prohibitions: [String]
        public var pendingDecisions: [String]
        public init(requestText: String, kind: ObjectiveKind = .other, completionConditions: [String] = [],
                    scope: Scope = .readOnly, prohibitions: [String] = [], pendingDecisions: [String] = []) {
            self.requestText = requestText; self.kind = kind; self.completionConditions = completionConditions
            self.scope = scope; self.prohibitions = prohibitions; self.pendingDecisions = pendingDecisions
        }
    }

    /// A recorded fact about a project version. `verifiedAt` is set only when
    /// OS1 actually checked the live state; a recorded pointer is never live.
    public struct BaselineRecord: Codable, Equatable, Sendable {
        public var id: String
        public var key: String?
        public var sha256: String?
        public var bytes: Int?
        public var recordedAt: String?
        public var verifiedAt: Date?
        public init(id: String, key: String? = nil, sha256: String? = nil, bytes: Int? = nil,
                    recordedAt: String? = nil, verifiedAt: Date? = nil) {
            self.id = id; self.key = key; self.sha256 = sha256; self.bytes = bytes
            self.recordedAt = recordedAt; self.verifiedAt = verifiedAt
        }
    }

    public struct ProjectBaseline: Codable, Equatable, Sendable {
        public var projectID: String
        public var repository: String?
        public var workspace: String?
        public var recoveryBaseline: BaselineRecord?
        public var operatingRecord: BaselineRecord?
        public var liveVerified: BaselineRecord?
        public init(projectID: String, repository: String? = nil, workspace: String? = nil,
                    recoveryBaseline: BaselineRecord? = nil, operatingRecord: BaselineRecord? = nil,
                    liveVerified: BaselineRecord? = nil) {
            self.projectID = projectID; self.repository = repository; self.workspace = workspace
            self.recoveryBaseline = recoveryBaseline; self.operatingRecord = operatingRecord; self.liveVerified = liveVerified
        }
    }

    public enum SourceRole: String, Codable, Sendable {
        case sourceCode = "source_code", operatingReleaseRecord = "operating_release_record",
             recoveryBaseline = "recovery_baseline", researchOriginal = "research_original",
             testResult = "test_result", userDocument = "user_document", retrievedSnapshot = "retrieved_snapshot"
    }
    public enum Coverage: String, Codable, Sendable { case full, excerpt, truncated }
    public enum Verification: String, Codable, Sendable { case verified, unverified, mismatch }

    public struct Provenance: Codable, Equatable, Sendable {
        public var repository: String?
        public var commit: String?
        public var bucket: String?
        public var key: String?
        public var path: String?
        public var sha256: String?
        public var bytes: Int?
        public var retrievedAt: Date?
        public init(repository: String? = nil, commit: String? = nil, bucket: String? = nil, key: String? = nil,
                    path: String? = nil, sha256: String? = nil, bytes: Int? = nil, retrievedAt: Date? = nil) {
            self.repository = repository; self.commit = commit; self.bucket = bucket; self.key = key
            self.path = path; self.sha256 = sha256; self.bytes = bytes; self.retrievedAt = retrievedAt
        }
    }

    public struct TaskSource: Codable, Equatable, Sendable {
        public var id: UUID
        public var role: SourceRole
        public var label: String
        public var reference: SourceReference?
        public var provenance: Provenance
        public var coverage: Coverage
        public var verification: Verification
        public var supersedes: UUID?
        public init(id: UUID = UUID(), role: SourceRole, label: String, reference: SourceReference? = nil,
                    provenance: Provenance = Provenance(), coverage: Coverage = .full,
                    verification: Verification = .unverified, supersedes: UUID? = nil) {
            self.id = id; self.role = role; self.label = label; self.reference = reference
            self.provenance = provenance; self.coverage = coverage; self.verification = verification
            self.supersedes = supersedes
        }
    }

    public struct BackendBinding: Codable, Equatable, Sendable {
        public var provider: String
        public var nativeSessionID: String
        public var environmentIdentity: String?
        public var lastIngestedCursor: String?
        public var lastHandedRevision: Int?
        public var capabilities: [String]
        public var checkedAt: Date?
        public init(provider: String, nativeSessionID: String, environmentIdentity: String? = nil,
                    lastIngestedCursor: String? = nil, lastHandedRevision: Int? = nil,
                    capabilities: [String] = [], checkedAt: Date? = nil) {
            self.provider = provider; self.nativeSessionID = nativeSessionID; self.environmentIdentity = environmentIdentity
            self.lastIngestedCursor = lastIngestedCursor; self.lastHandedRevision = lastHandedRevision
            self.capabilities = capabilities; self.checkedAt = checkedAt
        }
    }

    public enum SideEffects: String, Codable, Sendable { case none, possible, confirmed, unknown }
    public enum Adoption: String, Codable, Sendable { case pending, adopted, rejected, unverified }

    public struct ExecutionRecord: Codable, Equatable, Sendable {
        public var executionID: String
        public var provider: String
        public var stage: String
        public var startedAt: Date
        public var lastProgressAt: Date?
        public var endedAt: Date?
        public var sideEffects: SideEffects
        public var artifacts: [String]
        public var retryReason: String?
        public var adoption: Adoption
        public var contextRevision: Int
        public init(executionID: String, provider: String, stage: String, startedAt: Date, lastProgressAt: Date? = nil,
                    endedAt: Date? = nil, sideEffects: SideEffects = .unknown, artifacts: [String] = [],
                    retryReason: String? = nil, adoption: Adoption = .pending, contextRevision: Int) {
            self.executionID = executionID; self.provider = provider; self.stage = stage; self.startedAt = startedAt
            self.lastProgressAt = lastProgressAt; self.endedAt = endedAt; self.sideEffects = sideEffects
            self.artifacts = artifacts; self.retryReason = retryReason; self.adoption = adoption
            self.contextRevision = contextRevision
        }
    }

    public struct Decision: Codable, Equatable, Sendable {
        public var id: UUID
        public var text: String
        public var madeAt: Date
        public var supersedes: UUID?
        public init(id: UUID = UUID(), text: String, madeAt: Date, supersedes: UUID? = nil) {
            self.id = id; self.text = text; self.madeAt = madeAt; self.supersedes = supersedes
        }
    }

    public struct Fact: Codable, Equatable, Sendable {
        public var text: String
        public var verified: Bool
        public var evidence: String?
        public init(text: String, verified: Bool, evidence: String? = nil) {
            self.text = text; self.verified = verified; self.evidence = evidence
        }
    }

    public var schemaVersion: Int
    public var contextRevision: Int
    public var conversationID: UUID
    public var projectID: String?
    public var objectiveID: UUID
    public var createdAt: Date
    public var updatedAt: Date
    public var objective: Objective
    public var project: ProjectBaseline?
    public var sources: [TaskSource]
    public var bindings: [BackendBinding]
    public var executions: [ExecutionRecord]
    public var decisions: [Decision]
    public var facts: [Fact]
    public var nextSteps: [String]
    public var blockers: [String]
    /// Acquisition is owned by OS1 even when no backend has been dispatched.
    public var sourcePreparation: SourcePreparationState?

    public init(conversationID: UUID, objective: Objective, projectID: String? = nil, now: Date = Date()) {
        schemaVersion = Self.schemaVersion; contextRevision = 1
        self.conversationID = conversationID; self.projectID = projectID; objectiveID = UUID()
        createdAt = now; updatedAt = now; self.objective = objective; project = nil
        sources = []; bindings = []; executions = []; decisions = []; facts = []; nextSteps = []; blockers = []
    }

    /// First revision derived from the fields an existing conversation already
    /// stores. Nothing is deleted from the conversation; older executables keep
    /// reading their own fields.
    public static func migrated(conversationID: UUID, request: String, workspace: String?, sourceContext: SourceReference?,
                                codexSessionID: String?, claudeSessionID: String?, now: Date = Date()) -> TaskContext {
        var context = TaskContext(conversationID: conversationID,
                                  objective: Objective(requestText: request, kind: ObjectiveKind.classify(request)), now: now)
        if let workspace, !workspace.isEmpty {
            context.project = ProjectBaseline(projectID: "workspace:" + URL(fileURLWithPath: workspace).lastPathComponent,
                                              workspace: workspace)
        }
        if let sourceContext {
            context.sources.append(TaskSource(role: .retrievedSnapshot, label: "migrated conversation source",
                                              reference: sourceContext, provenance: Provenance(sha256: sourceContext.sha256),
                                              coverage: .full, verification: sourceContext.sha256.isEmpty ? .unverified : .verified))
        }
        for (provider, id) in [("codex", codexSessionID), ("claude", claudeSessionID)] {
            if let id, UUID(uuidString: id) != nil {
                context.bindings.append(BackendBinding(provider: provider, nativeSessionID: id.lowercased()))
            }
        }
        return context
    }

    // MARK: - Mutations (each bumps the revision)

    public mutating func touch(now: Date = Date()) {
        contextRevision += 1
        updatedAt = now
    }

    /// Sources accumulate. A new source may explicitly supersede an older one of
    /// the same role; it never silently removes a source with a different role.
    public mutating func attach(_ source: TaskSource, replacing previous: UUID? = nil, now: Date = Date()) {
        var incoming = source
        if let previous, sources.contains(where: { $0.id == previous && $0.role == source.role }) {
            incoming.supersedes = previous
        }
        if let existing = sources.firstIndex(where: {
            $0.role == incoming.role && $0.provenance.sha256 != nil && $0.provenance.sha256 == incoming.provenance.sha256
        }) {
            sources[existing].verification = incoming.verification
            sources[existing].coverage = incoming.coverage
            touch(now: now)
            return
        }
        sources.append(incoming)
        touch(now: now)
    }

    /// Sources that have not been explicitly superseded by a newer one.
    public var activeSources: [TaskSource] {
        let superseded = Set(sources.compactMap(\.supersedes))
        return sources.filter { !superseded.contains($0.id) }
    }

    public mutating func bind(provider: String, nativeSessionID: String, capabilities: [String]? = nil,
                              environmentIdentity: String? = nil, now: Date = Date()) {
        let normalized = nativeSessionID.lowercased()
        if let index = bindings.firstIndex(where: { $0.provider == provider }) {
            if bindings[index].nativeSessionID != normalized {
                // A new native session for the same provider keeps the task; only
                // the ingestion cursor restarts.
                bindings[index].nativeSessionID = normalized
                bindings[index].lastIngestedCursor = nil
            }
            if let capabilities { bindings[index].capabilities = capabilities; bindings[index].checkedAt = now }
            if let environmentIdentity { bindings[index].environmentIdentity = environmentIdentity }
        } else {
            bindings.append(BackendBinding(provider: provider, nativeSessionID: normalized, environmentIdentity: environmentIdentity,
                                           capabilities: capabilities ?? [], checkedAt: capabilities == nil ? nil : now))
        }
        touch(now: now)
    }

    public mutating func decide(_ text: String, replacing previous: UUID? = nil, now: Date = Date()) {
        decisions.append(Decision(text: text, madeAt: now, supersedes: previous))
        touch(now: now)
    }

    /// Decisions not superseded by a later decision, oldest first.
    public var activeDecisions: [Decision] {
        let superseded = Set(decisions.compactMap(\.supersedes))
        return decisions.filter { !superseded.contains($0.id) }
    }

    public mutating func record(execution: ExecutionRecord, now: Date = Date()) {
        if let index = executions.firstIndex(where: { $0.executionID == execution.executionID }) {
            executions[index] = execution
        } else {
            executions.append(execution)
        }
        touch(now: now)
    }

    /// A late result is adoptable only when no decision or objective change
    /// happened after the revision that execution was handed.
    public func acceptsLateResult(fromRevision revision: Int) -> Bool {
        let decisionRevisionChanged = decisions.contains { $0.madeAt > updatedAt } // defensive; decisions bump revision
        return revision >= latestSemanticRevision && !decisionRevisionChanged
    }

    /// Revision of the last change that alters what a backend must know
    /// (objective, decision, source set, project baseline). Bindings and
    /// execution bookkeeping do not invalidate in-flight work.
    public var latestSemanticRevision: Int { semanticRevision }
    private var semanticRevision: Int {
        // Encoded as a stored field on every semantic mutation below.
        return _semanticRevision ?? 1
    }
    private var _semanticRevision: Int?

    private mutating func semanticChange(now: Date) {
        touch(now: now)
        _semanticRevision = contextRevision
    }

    public mutating func setObjective(_ objective: Objective, now: Date = Date()) {
        self.objective = objective
        objectiveID = UUID()
        semanticChange(now: now)
    }

    public mutating func setProject(_ baseline: ProjectBaseline, now: Date = Date()) {
        project = baseline
        projectID = baseline.projectID
        semanticChange(now: now)
    }

    public mutating func attachSemantic(_ source: TaskSource, replacing previous: UUID? = nil, now: Date = Date()) {
        attach(source, replacing: previous, now: now)
        _semanticRevision = contextRevision
    }

    public mutating func decideSemantic(_ text: String, replacing previous: UUID? = nil, now: Date = Date()) {
        decide(text, replacing: previous, now: now)
        _semanticRevision = contextRevision
    }

    // MARK: - Adopting a runtime result

    /// The app hands a context revision to a run and receives a context back.
    /// If nothing changed in the app since the handoff, the result replaces the
    /// stored context. Otherwise the app keeps its newer objective/decisions
    /// and only merges bookkeeping (sources, bindings, executions, project,
    /// facts) from the result. A result for another conversation is rejected.
    public func adopting(_ result: TaskContext, handedRevision: Int?) -> TaskContext {
        guard result.conversationID == conversationID else { return self }
        if let handedRevision, handedRevision == contextRevision, result.conversationID == conversationID,
           result.contextRevision >= contextRevision {
            return result
        }
        var merged = self
        for source in result.sources where !merged.sources.contains(where: {
            $0.id == source.id || (source.provenance.sha256 != nil && $0.provenance.sha256 == source.provenance.sha256 && $0.role == source.role)
        }) { merged.sources.append(source) }
        for binding in result.bindings {
            merged.bind(provider: binding.provider, nativeSessionID: binding.nativeSessionID,
                        capabilities: binding.capabilities.isEmpty ? nil : binding.capabilities,
                        environmentIdentity: binding.environmentIdentity)
            if let index = merged.bindings.firstIndex(where: { $0.provider == binding.provider }),
               merged.bindings[index].lastIngestedCursor == nil {
                merged.bindings[index].lastIngestedCursor = binding.lastIngestedCursor
            }
        }
        for execution in result.executions { merged.record(execution: execution) }
        if merged.project == nil, let project = result.project { merged.project = project; merged.projectID = project.projectID }
        for fact in result.facts where !merged.facts.contains(fact) { merged.facts.append(fact) }
        if result.objectiveID == objectiveID { merged.sourcePreparation = result.sourcePreparation }
        if merged.nextSteps.isEmpty { merged.nextSteps = result.nextSteps }
        merged.touch()
        return merged
    }

    /// "결정: …" / "decision: …" lines are the only automatic decision capture;
    /// everything else stays a request until the user states it as a decision.
    public static func explicitDecisions(in request: String) -> [String] {
        request.split(whereSeparator: \.isNewline).compactMap { line -> String? in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            for marker in ["결정:", "결정 :", "decision:", "Decision:", "DECISION:"] where trimmed.hasPrefix(marker) {
                let body = trimmed.dropFirst(marker.count).trimmingCharacters(in: .whitespaces)
                return body.isEmpty ? nil : String(body.prefix(400))
            }
            return nil
        }
    }

    // MARK: - Handoff

    /// The block every backend receives regardless of transcript truncation.
    /// Sections are dropped from the least essential end only; the objective,
    /// scope, prohibitions and active decisions are never dropped.
    public func handoffBlock(limit: Int = 12_000) -> String {
        var essential: [String] = []
        essential.append("OS-1 TASK CONTEXT (revision \(contextRevision), conversation \(conversationID.uuidString.lowercased()))")
        essential.append("Objective: \(objective.requestText.replacingOccurrences(of: "\n", with: " ").prefix(600))")
        essential.append("Objective kind: \(objective.kind.rawValue); allowed scope: \(objective.scope.rawValue)")
        if !objective.completionConditions.isEmpty {
            essential.append("Completion conditions: " + objective.completionConditions.joined(separator: "; "))
        }
        if !objective.prohibitions.isEmpty {
            essential.append("Prohibitions (binding): " + objective.prohibitions.joined(separator: "; "))
        }
        if !objective.pendingDecisions.isEmpty {
            essential.append("Pending user decisions: " + objective.pendingDecisions.joined(separator: "; "))
        }
        let decisionsText = activeDecisions.map { "- \($0.text)" }
        if !decisionsText.isEmpty { essential.append("Confirmed decisions:\n" + decisionsText.joined(separator: "\n")) }

        var optional: [String] = []
        if let project {
            var lines = ["Project: \(project.projectID)"]
            if let repository = project.repository { lines.append("Repository: \(repository)") }
            if let workspace = project.workspace { lines.append("Workspace: \(workspace)") }
            lines.append("Recovery baseline: " + (project.recoveryBaseline.map(Self.describe) ?? "none recorded"))
            lines.append("Recorded operating release: " + (project.operatingRecord.map(Self.describe) ?? "none recorded"))
            lines.append("Live-verified state: " + (project.liveVerified.map { record in
                Self.describe(record) + " (verified \(ISO8601DateFormatter().string(from: record.verifiedAt ?? Date.distantPast)))"
            } ?? "unknown — not verified in this task; do not assume the recorded release is live"))
            optional.append(lines.joined(separator: "\n"))
        }
        let sourceLines = activeSources.map { source -> String in
            var parts = ["- [\(source.role.rawValue)] \(source.label)"]
            if let sha = source.provenance.sha256 ?? source.reference?.sha256, !sha.isEmpty { parts.append("sha256 \(sha.prefix(16))…") }
            if let key = source.provenance.key { parts.append("key \(key)") }
            if let path = source.provenance.path { parts.append("path \(path)") }
            if let commit = source.provenance.commit { parts.append("commit \(commit.prefix(12))") }
            parts.append("coverage \(source.coverage.rawValue), \(source.verification.rawValue)")
            return parts.joined(separator: " · ")
        }
        if !sourceLines.isEmpty { optional.append("Sources bound to this task (verifiable references):\n" + sourceLines.joined(separator: "\n")) }
        let verifiedFacts = facts.filter(\.verified).map { "- \($0.text)" + ($0.evidence.map { " (evidence: \($0))" } ?? "") }
        let claims = facts.filter { !$0.verified }.map { "- \($0.text)" }
        if !verifiedFacts.isEmpty { optional.append("Verified facts:\n" + verifiedFacts.joined(separator: "\n")) }
        if !claims.isEmpty { optional.append("Unverified claims (do not treat as facts):\n" + claims.joined(separator: "\n")) }
        if !nextSteps.isEmpty { optional.append("Next steps: " + nextSteps.joined(separator: "; ")) }
        if !blockers.isEmpty { optional.append("Blockers: " + blockers.joined(separator: "; ")) }
        let openExecutions = executions.filter { $0.endedAt == nil || $0.adoption == .pending || $0.sideEffects == .unknown }
        if !openExecutions.isEmpty {
            optional.append("Executions with unresolved state: " + openExecutions.map {
                "\($0.provider) \($0.executionID.prefix(8)) stage \($0.stage) side-effects \($0.sideEffects.rawValue) adoption \($0.adoption.rawValue)"
            }.joined(separator: "; "))
        }

        var block = essential.joined(separator: "\n")
        for section in optional {
            let candidate = block + "\n\n" + section
            if candidate.utf8.count > limit { break }
            block = candidate
        }
        return block
    }

    private static func describe(_ record: BaselineRecord) -> String {
        var parts = [record.id]
        if let key = record.key { parts.append("key \(key)") }
        if let sha = record.sha256 { parts.append("sha256 \(sha.prefix(16))…") }
        if let bytes = record.bytes { parts.append("\(bytes) bytes") }
        if let at = record.recordedAt { parts.append("recorded \(at)") }
        return parts.joined(separator: ", ")
    }
}

public extension TaskContext.ProjectBaseline {
    /// Three separate facts for the user surface. A recorded pointer and a
    /// recorded release are never presented as the live state.
    var baselineLines: [String] {
        var lines: [String] = []
        if let record = recoveryBaseline {
            var parts = ["복구 기준점(Gold 포인터): \(record.id)"]
            if let sha = record.sha256 { parts.append("sha256 \(sha.prefix(12))…") }
            if let at = record.recordedAt { parts.append("기록 \(at)") }
            lines.append(parts.joined(separator: " · "))
        } else {
            lines.append("복구 기준점(Gold 포인터): 기록 없음")
        }
        if let record = operatingRecord {
            var parts = ["기록된 운영 릴리스: \(record.id)"]
            if let key = record.key { parts.append("R2 \(key)") }
            if let sha = record.sha256 { parts.append("sha256 \(sha.prefix(12))…") }
            if let bytes = record.bytes { parts.append("\(bytes)바이트") }
            if let at = record.recordedAt { parts.append("기록 \(at)") }
            parts.append("실제 배포 상태 조회 아님")
            lines.append(parts.joined(separator: " · "))
        } else {
            lines.append("기록된 운영 릴리스: 기록 없음")
        }
        if let record = liveVerified, let at = record.verifiedAt {
            lines.append("운영 서버 실제 상태: \(record.id) · 확인 \(ISO8601DateFormatter().string(from: at))")
        } else {
            lines.append("운영 서버 실제 상태: 미확인 (운영 서버를 조회하지 않았습니다)")
        }
        return lines
    }
}

public extension TaskContext.ObjectiveKind {
    /// Coarse classification used for the first revision; explicit adapters and
    /// the preparation intent refine it. Prohibitions win over positive verbs.
    static func classify(_ request: String) -> TaskContext.ObjectiveKind {
        let value = request.precomposedStringWithCanonicalMapping.lowercased()
        if ScopeResolution.resolve(value).scope == .readOnly,
           ["설명", "explain", "왜", "why", "뭐야", "what is", "어떻게 되", "알려줘"].contains(where: value.contains) { return .explain }
        if ["검증", "verify", "확인해", "테스트해", "check that"].contains(where: value.contains) { return .verify }
        if PreparationIntent.detect(request) != nil { return .prepare }
        if ProjectMaterialIntent.scv(request)?.requiresTransformation == false { return .acquire }
        if ["수정", "고쳐", "구현", "바꿔", "fix", "implement", "modify", "edit", "change"].contains(where: value.contains) { return .modify }
        return .other
    }
}

// MARK: - Event log

public struct TaskEvent: Codable, Equatable, Sendable {
    public let revision: Int
    public let at: Date
    public let kind: String
    public let summary: String
    public init(revision: Int, at: Date, kind: String, summary: String) {
        self.revision = revision; self.at = at; self.kind = kind; self.summary = summary
    }
}

/// Append-only per-conversation event log. Progress streaming is not an
/// event; only durable task changes are recorded.
public struct TaskEventLog: Sendable {
    public let root: URL
    public init(root: URL) { self.root = root }
    public func url(for conversationID: UUID) -> URL {
        root.appendingPathComponent(conversationID.uuidString.lowercased() + ".jsonl")
    }
    public func append(_ event: TaskEvent, conversationID: UUID) throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let target = url(for: conversationID)
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        let line = try encoder.encode(event) + Data([10])
        // O_APPEND keeps concurrent writers line-atomic; the mode is applied
        // only when the file is created.
        let descriptor = open(target.path, O_WRONLY | O_CREAT | O_APPEND | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard descriptor >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        try handle.write(contentsOf: line)
    }
    public func events(for conversationID: UUID) throws -> [TaskEvent] {
        let target = url(for: conversationID)
        guard FileManager.default.fileExists(atPath: target.path) else { return [] }
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
        return try Data(contentsOf: target).split(separator: 0x0A).compactMap { try? decoder.decode(TaskEvent.self, from: Data($0)) }
    }
}

// MARK: - Preparation / continuation intent (project-independent)

/// "수정 좀 하자 준비해", "그거 이어서 해", "아까 자료 기준으로 설명해" are one
/// common capability: bind the project, attach existing context, choose a
/// baseline, make materials available, then route. Adapters interpret sources;
/// they do not own this flow.
public struct PreparationIntent: Equatable, Sendable {
    public enum Kind: String, Sendable { case prepare, continueWork, explainFromContext }
    public let kind: Kind
    public let projectID: String?
    public let modifies: Bool

    /// Registered projects only. A registered id resolves to an adapter in
    /// `ProjectAdapterRegistry`; an unregistered "workspace:<name>" project
    /// never triggers a local control answer.
    public static let projectAliases: [(id: String, aliases: [String])] = [
        ("scv-instagram", ["인스타", "instagram", "scv"]),
        ("os1-clodex", ["os1", "os-1", "clodex", "클로덱스"]),
    ]
    static let prepareMarkers = ["손보자", "손 보자", "손좀 보자", "손 좀 보자", "손보려고", "손볼 건데", "손볼건데",
                                 "준비해", "준비하자", "준비 좀", "준비할", "준비 해", "수정 좀 하자", "수정하자", "수정 하자", "고치자", "고쳐보자",
                                 "작업하자", "작업 시작", "시작하자", "prepare", "let's fix", "let's modify", "let's work on", "let's start",
                                 "get ready", "set up for", "이제 고치자", "이제 수정"]
    static let continueMarkers = ["이어서", "계속하자", "계속 하자", "지난번 하던", "하던 거", "하던거", "아까 하던", "아까 결정한", "아까 결정",
                                  "그 프로젝트", "그 작업", "resume", "continue where", "pick up where", "carry on with",
                                  "아까 자료 기준", "그 자료 기준", "그 코드 기준", "이전 결정대로", "결정한 방식으로", "as decided"]
    static let explainMarkers = ["설명해", "설명 해", "설명만", "알려줘", "explain", "describe", "walk me through"]
    static let modificationProhibitions = ["수정하지 마", "수정하지마", "수정 하지 마", "고치지 마", "바꾸지 마", "변경하지 마", "설명만", "do not modify",
                                           "don't modify", "do not change", "don't change", "explain only", "read only", "읽기만"]
    static let refusalMarkers = ["손보지 마", "손보지마", "손대지 마", "손대지마", "준비하지 마", "준비 하지 마", "이어서 하지 마", "계속하지 마", "don't prepare", "do not prepare", "don't continue"]

    public static func detect(_ prompt: String) -> PreparationIntent? {
        let value = prompt.precomposedStringWithCanonicalMapping.lowercased()
        guard !value.isEmpty else { return nil }
        if ["\"", "“", "`", "'"].contains(where: value.contains),
           ["번역", "translate", "비판", "critique", "프롬프트", "prompt", "인용", "quote"].contains(where: value.contains) { return nil }
        if refusalMarkers.contains(where: value.contains) { return nil }
        let prohibited = modificationProhibitions.contains(where: value.contains)
        let prepare = prepareMarkers.contains(where: value.contains)
        let continues = continueMarkers.contains(where: value.contains)
        let explains = explainMarkers.contains(where: value.contains)
        let projectID = projectAliases.first { $0.aliases.contains(where: value.contains) }?.id
        let kind: Kind
        if explains && (continues || prohibited) && !prepare { kind = .explainFromContext }
        else if prepare { kind = .prepare }
        else if continues { kind = .continueWork }
        else if projectID != nil && ScopeResolution.resolve(value).scope == .workspaceWrite { kind = .prepare }
        else { return nil }
        // "수정 좀 하자 준비해" is an intent to prepare, not a described change:
        // only change verbs that survive removing the preparation phrases
        // themselves make the request a backend modification.
        var remaining = value
        for marker in (prepareMarkers + continueMarkers).sorted(by: { $0.count > $1.count }) { remaining = remaining.replacingOccurrences(of: marker, with: " ") }
        if kind == .prepare, ["준비", "get ready", "prepare"].contains(where: value.contains) {
            // A future reason for preparation is not an instruction to edit
            // now. Concrete imperatives (e.g. 준비하고 가격 로직 수정해) survive.
            remaining = remaining.replacingOccurrences(of: #"(?:수정|변경|고치|손보)(?:해야\s*(?:되|하)(?:니까|니|므로)|할\s*(?:건데|거니까)|하려(?:고|니까))"#,
                with: " ", options: .regularExpression)
        }
        let wantsChange = ["손봐", "손 봐", "수정", "고치", "고쳐", "바꾸", "구현", "fix", "modify", "edit", "change", "implement"].contains(where: remaining.contains)
        return PreparationIntent(kind: kind, projectID: projectID, modifies: kind != .explainFromContext && wantsChange && !prohibited)
    }
}

// MARK: - Project adapter registry

/// The preparation capability is common; only the source adapter differs.
/// `remoteMaterials` acquires a verified package from R2 (SCV Instagram);
/// `localWorkspace` uses the selected workspace and its git revision.
public enum ProjectAdapterKind: String, Sendable { case remoteMaterials, localWorkspace }

public enum ProjectAdapterRegistry {
    public static let adapters: [String: ProjectAdapterKind] = [
        "scv-instagram": .remoteMaterials,
        "os1-clodex": .localWorkspace,
    ]
    public static func kind(for projectID: String?) -> ProjectAdapterKind? {
        projectID.flatMap { adapters[$0] }
    }
    public static func label(for projectID: String) -> String {
        switch projectID {
        case "scv-instagram": return "Instagram 자동화"
        case "os1-clodex": return "OS-1 CLODEX"
        default: return projectID
        }
    }
}

// MARK: - Scope resolution for mixed allow/deny sentences

/// "파일은 수정해. 서버는 변경하지 마" must stay a write task with a server
/// prohibition; "수정하지 말고 설명만" must stay read-only. A string
/// normalization equal to an expected string is not the meaning; this
/// resolves the permission and keeps the prohibitions as binding constraints.
public struct ScopeResolution: Equatable, Sendable {
    public let scope: TaskContext.Scope
    public let prohibitions: [String]

    // A shared trailing negation applies to the entire bounded action list,
    // not just its final item (e.g. "파일 수정, 테스트 실행, 배포는 하지 마").
    public static let enumeratedProhibitionPattern = #"(?:파일|코드)\s*(?:수정|변경|편집)(?:\s*(?:[,·/]|및)\s*(?:(?:테스트|빌드)\s*(?:실행)?|설치|배포|복원|복구|삭제|업로드|리셋|초기화)){1,8}\s*(?:은|는|을|를)?\s*하지\s*마(?:세요|십시오)?"#

    static let positiveEdit = ["손봐", "손 봐", "수정해", "수정하고", "수정 해", "고쳐", "고치고", "바꿔", "바꾸고", "구현해", "추가해", "삭제해", "리팩터", "만들어",
                               "fix ", "modify ", "edit ", "implement ", "add ", "remove ", "rename ", "change the code", "update the code"]
    static let negatedTargets: [(pattern: String, prohibition: String)] = [
        ("서버는 변경하지 마", "do not change the server"), ("서버를 변경하지 마", "do not change the server"), ("서버 변경하지 마", "do not change the server"),
        ("배포하지 마", "do not deploy"), ("배포는 하지 마", "do not deploy"), ("do not deploy", "do not deploy"), ("don't deploy", "do not deploy"),
        ("테스트를 실행하지 마", "do not run tests"), ("테스트 실행하지 마", "do not run tests"), ("테스트는 실행하지 마", "do not run tests"),
        ("do not run tests", "do not run tests"), ("don't run tests", "do not run tests"),
        ("파일·서버를 변경하거나 테스트를 실행하지 마", "do not change files or servers or run tests"),
        ("업로드하지 마", "do not upload"), ("삭제하지 마", "do not delete"), ("리셋하지 마", "do not reset"), ("초기화하지 마", "do not reset"),
    ]
    static let generalProhibitions = ["손보지 마", "손보지마", "손대지 마", "손대지마", "수정하지 마", "수정하지마", "수정 하지 마", "수정하지 말고", "고치지 마", "고치지 말고", "바꾸지 마", "바꾸지 말고",
                                      "변경하지 마", "변경하지 말고", "수정은 하지 마", "수정은 하지마", "변경은 하지 마", "편집은 하지 마",
                                      "편집하지 마", "설명만", "read only", "read-only", "do not modify", "don't modify",
                                      "do not change", "don't change", "explain only", "no changes"]

    public static func resolve(_ prompt: String) -> ScopeResolution {
        let value = prompt.precomposedStringWithCanonicalMapping.lowercased()
        var prohibitions: [String] = []
        var remaining = value
        if let pattern = try? NSRegularExpression(pattern: enumeratedProhibitionPattern) {
            let range = NSRange(remaining.startIndex..<remaining.endIndex, in: remaining)
            let matches = pattern.matches(in: remaining, range: range)
            if !matches.isEmpty {
                prohibitions.append("do not modify files")
                for match in matches {
                    guard let captured = Range(match.range, in: remaining) else { continue }
                    let clause = String(remaining[captured])
                    for (word, prohibition) in [("테스트", "do not run tests"), ("빌드", "do not build"),
                        ("설치", "do not install"), ("배포", "do not deploy"), ("복원", "do not restore"),
                        ("복구", "do not restore"), ("삭제", "do not delete"), ("업로드", "do not upload"),
                        ("리셋", "do not reset"), ("초기화", "do not reset")] where clause.contains(word) {
                        if !prohibitions.contains(prohibition) { prohibitions.append(prohibition) }
                    }
                }
                remaining = pattern.stringByReplacingMatches(in: remaining, range: range, withTemplate: "read-only")
            }
        }
        // Longest patterns first so a compound prohibition is recognized as a
        // whole before one of its clauses is consumed.
        for target in negatedTargets.sorted(by: { $0.pattern.count > $1.pattern.count }) where remaining.contains(target.pattern) {
            if !prohibitions.contains(target.prohibition) { prohibitions.append(target.prohibition) }
            remaining = remaining.replacingOccurrences(of: target.pattern, with: " ")
        }
        let generallyProhibited = generalProhibitions.contains(where: remaining.contains)
        let asksEdit = positiveEdit.contains(where: remaining.contains)
        if generallyProhibited && !asksEdit {
            if !prohibitions.contains("do not modify files") { prohibitions.append("do not modify files") }
            return ScopeResolution(scope: .readOnly, prohibitions: prohibitions)
        }
        if generallyProhibited && asksEdit {
            // "파일은 수정해. 수정하지 마" is contradictory; keep the safer reading.
            prohibitions.append("do not modify files")
            return ScopeResolution(scope: .readOnly, prohibitions: prohibitions)
        }
        return ScopeResolution(scope: asksEdit ? .workspaceWrite : .readOnly, prohibitions: prohibitions)
    }
}

// MARK: - Baseline selection

public enum BaselinePurpose: String, Sendable { case recoveryRestore, modificationPreparation, explanation }

public struct BaselineSelection: Equatable, Sendable {
    public let record: TaskContext.BaselineRecord?
    public let basis: String
    public let liveStatus: String

    public static func select(_ project: TaskContext.ProjectBaseline, purpose: BaselinePurpose, now: Date = Date()) -> BaselineSelection {
        let live: String
        if let verified = project.liveVerified, let at = verified.verifiedAt {
            live = "live state verified at \(ISO8601DateFormatter().string(from: at)): \(verified.id)"
        } else {
            live = "live state unknown (not verified)"
        }
        switch purpose {
        case .recoveryRestore:
            return BaselineSelection(record: project.recoveryBaseline,
                                     basis: project.recoveryBaseline == nil ? "no recovery baseline recorded" : "recovery baseline (Gold pointer); never the operating record",
                                     liveStatus: live)
        case .modificationPreparation, .explanation:
            if let operating = project.operatingRecord {
                return BaselineSelection(record: operating, basis: "recorded operating release; not a live check", liveStatus: live)
            }
            return BaselineSelection(record: project.recoveryBaseline,
                                     basis: project.recoveryBaseline == nil ? "no baseline recorded" : "recovery baseline used because no operating record exists; label it as such",
                                     liveStatus: live)
        }
    }
}

// MARK: - Incremental native ingestion

public struct NativeRecord: Equatable, Sendable {
    public let id: String
    public let ordinal: Int
    public let role: String
    public let text: String
    public let complete: Bool
    public init(id: String, ordinal: Int, role: String, text: String, complete: Bool) {
        self.id = id; self.ordinal = ordinal; self.role = role; self.text = text; self.complete = complete
    }
}

/// Reads native transcripts forward from a cursor, skips what OS1 itself sent,
/// and never promotes partial or cancelled output to a completed statement.
public enum NativeIngestion {
    public static func newRecords(_ all: [NativeRecord], after cursor: String?, sentByOS1 digests: Set<String>,
                                  seen: Set<String>) -> (records: [NativeRecord], nextCursor: String?) {
        let start = cursor.flatMap(Int.init) ?? -1
        var out: [NativeRecord] = []
        var last = start
        for record in all.sorted(by: { $0.ordinal < $1.ordinal }) where record.ordinal > start {
            // Do not commit a cursor beyond a record that may later become
            // complete. Otherwise the next poll permanently loses its answer.
            guard record.complete else { break }
            last = max(last, record.ordinal)
            guard !seen.contains(record.id) else { continue }
            // Anything OS1 already holds verbatim (its own prompts, adopted
            // outputs) is not ingested a second time, whatever the role.
            if digests.contains(digestOf(record.text)) { continue }
            if record.role == "user", let original = WorkspaceDiscovery.legacyRequestBeforeHints(record.text),
               digests.contains(digestOf(original)) { continue }
            out.append(record)
        }
        return (out, last >= 0 ? String(last) : cursor)
    }

    public static func digestOf(_ text: String) -> String {
        SourceContextStore.digest(Data(text.trimmingCharacters(in: .whitespacesAndNewlines).utf8))
    }
}


// MARK: - OS-1's own receipt text inside a request

/// A user often pastes an earlier OS-1 answer back into a new request. The
/// receipt lines OS-1 itself printed ("REVAS adopted · native record
/// verified …", "실행 기록 확인됨 · …") are not the user's intent and must not
/// turn a normal request into a protected-material or archive request.
public enum OS1ReceiptText {
    static let fingerprints = [
        "revas adopted", "os-1 control verified", "native record verified", "native session saved",
        "external app not opened", "실행 기록 확인됨", "실행 기록 미확인", "세부 정보 접기", "세부 정보 펼치기",
        "백엔드 실행 기록의 확인 여부입니다", "source snapshot delivered:", "· read only", "· 읽기 전용",
        "standard claude backend", "standard codex backend", "efficient claude backend", "efficient codex backend",
        "deep claude backend", "deep codex backend",
    ]

    /// Removes lines that are recognizably OS-1 receipt output. Everything
    /// else, including quoted source text, is returned unchanged.
    public static func stripped(_ request: String) -> String {
        request.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline).filter { line in
            let value = String(line).precomposedStringWithCanonicalMapping.lowercased()
            return !fingerprints.contains(where: value.contains)
        }.joined(separator: "\n")
    }

    public static func containsReceipt(_ request: String) -> Bool {
        stripped(request) != request
    }
}
