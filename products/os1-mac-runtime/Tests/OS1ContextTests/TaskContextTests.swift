import Foundation
import OS1Context

/// Shared task context: the OS1-owned state that every backend receives and
/// returns to. These fixtures reproduce the 2026-09-06 incidents (cases A/B)
/// as deterministic checks and add negative controls.
func runTaskContextFixtures(root: URL) throws {
    var count = 0
    func check(_ value: @autoclosure () throws -> Bool, _ message: String) throws {
        guard try value() else { throw NSError(domain: "TaskContextTests", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
        count += 1
    }
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    // A. Preparation / continuation intent is project-independent and honors negation.
    let caseB = "야 인스타그램 수정 좀 하자 준비해"
    let setupIncident = "인스타그램 세팅을 좀 해봐.인스타그램 오토메이션 그거 수정 봐야되니까 세팅해라고 개새끼야"
    for text in [setupIncident, setupIncident.decomposedStringWithCanonicalMapping, "OS1 수정 해야되니까 셋업해"] {
        try check(PreparationIntent.detect(text)?.kind == .prepare && PreparationIntent.detect(text)?.modifies == false,
            "setup for future edit must acquire materials before model dispatch")
    }
    try check(PreparationIntent.detect("인스타그램 세팅하고 가격이 반복되는 버그 수정해")?.modifies == true,
        "concrete edit after setup must survive preparation parsing")
    try check(PreparationIntent.detect("인스타그램 세팅은 하지 말고 가격 안내 문구 수정해")?.modifies == true,
        "setup text must not suppress a concrete authorized edit")
    for text in ["인스타그램 오토메이션 좀 손보자", "인스타 자동화 손 좀 보자", "인스타그램 손볼 건데",
                 "인스타그램 오토메이션 좀 손보자".decomposedStringWithCanonicalMapping, "OS1 손보자"] {
        try check(PreparationIntent.detect(text)?.kind == .prepare && PreparationIntent.detect(text)?.modifies == false,
                  "bare work intent prepares without inventing a change: \(text)")
        try check(TaskContext.ObjectiveKind.classify(text) == .prepare, "work request is not other")
    }
    try check(PreparationIntent.detect("인스타그램 가격이 두 번 나가는 버그 손봐줘")?.modifies == true, "specific repair retains edit intent")
    try check(ScopeResolution.resolve("가격 안내 파일 손봐줘. 배포하지 마").scope == .workspaceWrite, "specific edit scope with no deployment")
    try check(PreparationIntent.detect("인스타그램 손보지 마") == nil, "no acquisition for refusal")
    try check(PreparationIntent.detect("\"인스타그램 손보자\" 번역해줘") == nil, "quoted repair is not a repair")
    for text in [caseB, caseB.decomposedStringWithCanonicalMapping, "인스타그램 수정 좀 하자 준비해"] {
        let intent = PreparationIntent.detect(text)
        // Bare preparation: no described change, so OS1 answers locally and the
        // backend is engaged by the next concrete request with the full context.
        try check(intent?.kind == .prepare && intent?.projectID == "scv-instagram" && intent?.modifies == false,
                  "case B must be a bare preparation intent bound to scv-instagram: \(text)")
    }
    try check(PreparationIntent.detect("그 프로젝트 이어서 하자")?.kind == .continueWork, "continuation phrasing")
    try check(PreparationIntent.detect("지난번 하던 거 수정하자")?.kind == .prepare, "resume-and-modify phrasing")
    try check(PreparationIntent.detect("인스타 자동화에서 가격 안내가 두 번 나가는 버그 수정해줘, 준비해")?.modifies == true,
              "a described change is a modification handed to a backend")
    try check(PreparationIntent.detect("자료 가져왔으니까 이제 고치자")?.kind == .prepare, "materials-then-fix phrasing")
    try check(PreparationIntent.detect("아까 결정한 방식으로 계속해")?.kind == .continueWork, "decided-way continuation")
    let explainOnly = PreparationIntent.detect("아까 자료 기준으로 설명해, 수정하지 마")
    try check(explainOnly?.kind == .explainFromContext && explainOnly?.modifies == false, "explain-from-context never modifies")
    try check(PreparationIntent.detect("수정하지 말고 설명만 해줘 준비된 자료로")?.modifies == false, "explicit prohibition wins")
    try check(PreparationIntent.detect("Let's work on the Instagram automation, get ready to fix it")?.projectID == "scv-instagram", "English alias")
    try check(PreparationIntent.detect("\"인스타그램 수정 좀 하자 준비해\" 번역해줘") == nil, "quoted translation request is not preparation")
    try check(PreparationIntent.detect("준비하지 마, 그냥 설명만") == nil, "refusal is not preparation")
    try check(PreparationIntent.detect("1 플러스 1이 뭐야") == nil, "arithmetic is not preparation")
    try check(PreparationIntent.detect("R2 연결시켜") == nil, "connection control is not preparation")
    let noProject = PreparationIntent.detect("그거 이어서 하자")
    try check(noProject?.kind == .continueWork && noProject?.projectID == nil, "project unresolved → must come from the conversation, never guessed")

    // B. Mixed allow/deny sentences keep the write scope and the prohibition.
    let mixed = ScopeResolution.resolve("파일은 수정해. 서버는 변경하지 마")
    try check(mixed.scope == .workspaceWrite && mixed.prohibitions == ["do not change the server"], "mixed allow/deny keeps write + server prohibition")
    let explain = ScopeResolution.resolve("수정하지 말고 설명만 해줘")
    try check(explain.scope == .readOnly && explain.prohibitions.contains("do not modify files"), "explain-only stays read-only")
    let compound = ScopeResolution.resolve("파일·서버를 변경하거나 테스트를 실행하지 마. Node 버전만 알려줘")
    try check(compound.scope == .readOnly && compound.prohibitions.contains("do not change files or servers or run tests"), "compound prohibition read-only")
    let editNoTests = ScopeResolution.resolve("함수를 수정해. 테스트는 실행하지 마")
    for request in ["파일 수정, 테스트 실행, 설치, 배포, 복원은 하지 마세요.",
                    "코드 변경·테스트·배포는 하지 마. 릴리스 알려줘", "파일 수정 및 설치는 하지 마세요."] {
        let resolved = ScopeResolution.resolve(request)
        try check(resolved.scope == .readOnly && resolved.prohibitions.contains("do not modify files"), "grouped trailing prohibition must forbid file writes")
        try check(ScopeResolution.resolve(request.decomposedStringWithCanonicalMapping) == resolved, "grouped prohibition survives Korean normalization")
    }
    try check(editNoTests.scope == .workspaceWrite && editNoTests.prohibitions == ["do not run tests"], "edit but no tests")
    let contradictory = ScopeResolution.resolve("파일은 수정해. 수정하지 마")
    try check(contradictory.scope == .readOnly, "contradictory request takes the safer reading")
    try check(ScopeResolution.resolve("복구할 수 있어?").scope == .readOnly, "capability question is not a change")
    let fleetReadOnlyAudit = ScopeResolution.resolve("""
        Read-only reconciliation of failed OS1 Fleet job 4c7663db-6087-4fe4-8fbd-1d524cf427aa.
        This is not permission to replay that job or perform any installation. Using only read tools,
        inspect the current checkout and report the recorded failure. Do not run commands, restart
        services, change files, read authentication caches or quote private log payloads.
        """)
    try check(fleetReadOnlyAudit.scope == .readOnly && fleetReadOnlyAudit.prohibitions.contains("do not modify files"),
              "a quoted Fleet failure audit remains read-only even when it names installation and files")

    // C. Baseline selection distinguishes recovery, recorded operating, live.
    let v151 = TaskContext.BaselineRecord(id: "scv-instagram-20260904T222549Z-v151-clean-current",
        key: "scv-instagram-automation/recovery-points/20260904T222549Z/SCV_RECOVERY_POINT.json",
        sha256: "75440f5063fb7deab879df404ea8fa7011fece7c3da1f7af93c042ee9a337a5a", recordedAt: "2026-09-05T03:57:15Z")
    let v157 = TaskContext.BaselineRecord(id: "scv-instagram-single-20260906-v157",
        key: "scv-instagram-automation/release-ready/20260906T230617Z/v157/scv-instagram-single-20260906T230617Z-v157-price-once.tar.gz",
        sha256: "d74cb331eac33465c043a5f3f59286c6a7198dda39ce8ef0c1a28e20b7873ad0", bytes: 1_441_639, recordedAt: "2026-09-06")
    var project = TaskContext.ProjectBaseline(projectID: "scv-instagram", repository: "effacermonexistence/codex",
                                              recoveryBaseline: v151, operatingRecord: v157)
    let restore = BaselineSelection.select(project, purpose: .recoveryRestore, now: now)
    try check(restore.record?.id == v151.id && restore.liveStatus.contains("unknown"), "restore uses the Gold pointer, never v157")
    let prepare = BaselineSelection.select(project, purpose: .modificationPreparation, now: now)
    try check(prepare.record?.id == v157.id && prepare.basis.contains("not a live check") && prepare.liveStatus.contains("unknown"),
              "modification prepares against the recorded operating release, labelled unverified")
    project.operatingRecord = nil
    let fallback = BaselineSelection.select(project, purpose: .modificationPreparation, now: now)
    try check(fallback.record?.id == v151.id && fallback.basis.contains("label it as such"), "fallback to recovery baseline is labelled")
    project.operatingRecord = v157
    project.liveVerified = TaskContext.BaselineRecord(id: v157.id, verifiedAt: now)
    try check(BaselineSelection.select(project, purpose: .explanation, now: now).liveStatus.contains("verified at"), "live status only when verified")
    project.liveVerified = nil

    // D. Multiple sources with roles coexist; supersession is explicit.
    var context = TaskContext(conversationID: UUID(), objective: TaskContext.Objective(requestText: caseB, kind: .prepare, scope: .workspaceWrite), projectID: "scv-instagram", now: now)
    context.setProject(project, now: now)
    let research = TaskContext.TaskSource(role: .researchOriginal, label: "QMGR objective v1",
        provenance: TaskContext.Provenance(repository: "effacermonexistence/orthogonal-projection-term-benchmarks", commit: "57c8bef70e4cdb7ce33ea865dda852c17001925e", sha256: String(repeating: "a", count: 64)), verification: .verified)
    let code = TaskContext.TaskSource(role: .sourceCode, label: "v157 runtime archive",
        provenance: TaskContext.Provenance(bucket: "omar-private-archive", key: v157.key, sha256: v157.sha256, bytes: v157.bytes), verification: .verified)
    context.attachSemantic(research, now: now)
    context.attachSemantic(code, now: now)
    try check(context.activeSources.count == 2, "reading a second source must not drop the first")
    let newerCode = TaskContext.TaskSource(role: .sourceCode, label: "v158 runtime archive",
        provenance: TaskContext.Provenance(bucket: "omar-private-archive", key: "future", sha256: String(repeating: "b", count: 64)), verification: .verified)
    context.attachSemantic(newerCode, replacing: code.id, now: now)
    try check(context.activeSources.count == 2 && context.activeSources.contains { $0.label == "v158 runtime archive" } &&
              context.activeSources.contains { $0.role == .researchOriginal }, "explicit supersession replaces only the same role")
    try check(context.sources.count == 3, "superseded sources are retained, not deleted")
    context.attachSemantic(research, now: now)
    try check(context.sources.count == 3, "same content is deduplicated by role + sha256")
    let excerpt = TaskContext.TaskSource(role: .userDocument, label: "spec excerpt", coverage: .excerpt)
    context.attachSemantic(excerpt, now: now)
    try check(context.handoffBlock().contains("coverage excerpt"), "excerpt coverage is declared to the backend")

    // E. The handoff block keeps objective/scope/prohibitions/decisions under any limit.
    context.objective.prohibitions = ["do not change the server"]
    context.decideSemantic("Node 20.20.2 is the required runtime; do not use Node 24", now: now)
    let tight = context.handoffBlock(limit: 400)
    try check(tight.contains("Objective:") && tight.contains("Prohibitions (binding)") && tight.contains("Node 20.20.2"),
              "objective, prohibitions and decisions survive a tight limit")
    try check(!tight.contains("Sources bound"), "optional sections are the ones dropped under a tight limit")
    let full = context.handoffBlock()
    try check(full.contains("Recorded operating release: scv-instagram-single-20260906-v157") &&
              full.contains("Recovery baseline: scv-instagram-20260904T222549Z-v151") &&
              full.contains("Live-verified state: unknown"), "three baseline facts stay distinct in the handoff")
    try check(full.contains("QMGR objective v1") && full.contains("v158 runtime archive"), "all active sources are referenced")

    // F. Decisions: a newer decision supersedes the older one; both are retained.
    let first = context.activeDecisions.last!
    context.decideSemantic("Use Node 20.20.2 via the installed .local/share runtime", replacing: first.id, now: now)
    try check(context.activeDecisions.count == 1 && context.decisions.count == 2, "superseded decision retained but inactive")
    try check(!context.handoffBlock().contains("do not use Node 24"), "superseded decision leaves the handoff")

    // G. Bindings: a new native session keeps the task; only the cursor restarts.
    context.bind(provider: "codex", nativeSessionID: "01A07994-2D48-77E3-B0CB-A771747C80A4", capabilities: ["shell", "r2_read"], now: now)
    context.bindings[0].lastIngestedCursor = "42"
    let semanticBefore = context.latestSemanticRevision
    context.bind(provider: "codex", nativeSessionID: "01a07a00-0000-7000-8000-000000000000", now: now)
    try check(context.bindings.count == 1 && context.bindings[0].lastIngestedCursor == nil && context.activeSources.count == 3 &&
              context.latestSemanticRevision == semanticBefore, "rebinding keeps sources/decisions and does not invalidate in-flight work")
    context.bind(provider: "claude", nativeSessionID: UUID().uuidString, now: now)
    try check(context.bindings.map(\.provider) == ["codex", "claude"], "one binding per provider")

    // H. Late results: adoptable only when no semantic change happened after the handed revision.
    let handed = context.latestSemanticRevision
    try check(context.acceptsLateResult(fromRevision: handed), "result from the current revision is adoptable")
    context.decideSemantic("Target v157 only; do not touch v151 Gold", now: now)
    try check(!context.acceptsLateResult(fromRevision: handed), "a decision after dispatch makes the old result non-adoptable")

    // I. Migration from an existing conversation keeps its single source and native links.
    let legacySource = SourceReference(kind: .snapshot, id: UUID(), sha256: String(repeating: "c", count: 64))
    let migrated = TaskContext.migrated(conversationID: UUID(), request: caseB, workspace: "/Users/lua",
                                        sourceContext: legacySource, codexSessionID: "01a07994-2d48-77e3-b0cb-a771747c80a4", claudeSessionID: nil, now: now)
    try check(migrated.sources.count == 1 && migrated.sources[0].reference == legacySource && migrated.sources[0].role == .retrievedSnapshot,
              "legacy single source becomes a retrieved snapshot source")
    try check(migrated.bindings.count == 1 && migrated.bindings[0].provider == "codex", "legacy native IDs become bindings")
    try check(migrated.objective.kind == .prepare, "case B classifies as preparation")
    try check(TaskContext.migrated(conversationID: UUID(), request: "인스타그램은 오토매이션 수정 좀 보자 데이트 다 가져와 봐", workspace: nil,
                                   sourceContext: nil, codexSessionID: nil, claudeSessionID: "not-a-uuid", now: now).bindings.isEmpty,
              "invalid native IDs are not migrated")
    try check(TaskContext.ObjectiveKind.classify("인스타그램은 오토매이션 수정 좀 보자 데이트 다 가져와 봐") == .acquire, "case A classifies as acquisition")
    try check(TaskContext.ObjectiveKind.classify("이 함수가 왜 느린지 설명해줘") == .explain, "explanation")
    try check(TaskContext.ObjectiveKind.classify("함수를 수정해") == .modify, "modification")
    try check(TaskContext.ObjectiveKind.classify("Create result.txt and verify its exact bytes") == .modify,
              "filename-targeted English imperative is a modification")
    let boundedCreate = ScopeResolution.resolve("Create auto-review-probe.txt and write exactly OS1_AUTO_REVIEW_OK followed by one newline, then verify its exact bytes. Do not modify anything else.")
    try check(boundedCreate.scope == .workspaceWrite && boundedCreate.prohibitions == ["do not modify anything else"],
              "a trailing scope fence keeps an explicit filename creation writable")
    try check(PreparationIntent.detect("Create auto-review-probe.txt and write exactly OS1_AUTO_REVIEW_OK followed by one newline, then verify its exact bytes. Do not modify anything else.") == nil,
              "an OS1 marker inside requested file content is not a project-preparation alias")
    try check(ScopeResolution.resolve("Write a concise summary of this function").scope == .readOnly,
              "ordinary generated prose does not gain workspace authority")
    let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
    let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
    let round = try decoder.decode(TaskContext.self, from: try encoder.encode(context))
    try check(round == context, "task context round-trips through JSON")

    // J. Event log is append-only and readable.
    let log = TaskEventLog(root: root.appendingPathComponent("task-events"))
    try log.append(TaskEvent(revision: 1, at: now, kind: "objective", summary: caseB), conversationID: context.conversationID)
    try log.append(TaskEvent(revision: 2, at: now, kind: "source", summary: "v157 runtime archive"), conversationID: context.conversationID)
    let events = try log.events(for: context.conversationID)
    try check(events.count == 2 && events[1].kind == "source", "events persist in order")
    try check(try log.events(for: UUID()).isEmpty, "unknown conversation has no events")

    // K. Incremental native ingestion: cursor, OS1-sent dedupe, partial output excluded.
    let sent = Set(["야 인스타그램 수정 좀 하자 준비해"].map(NativeIngestion.digestOf))
    let records = [
        NativeRecord(id: "u1", ordinal: 1, role: "user", text: "야 인스타그램 수정 좀 하자 준비해", complete: true),
        NativeRecord(id: "a1", ordinal: 2, role: "assistant", text: "준비 상태를 확인했습니다.", complete: true),
        NativeRecord(id: "u2", ordinal: 3, role: "user", text: "Desktop에서 직접 이어서 함", complete: true),
        NativeRecord(id: "a2", ordinal: 4, role: "assistant", text: "부분 출력…", complete: false),
    ]
    let first1 = NativeIngestion.newRecords(records, after: nil, sentByOS1: sent, seen: ["a1"])
    try check(first1.records.map(\.id) == ["u2"] && first1.nextCursor == "3", "OS1-sent prompt, already-seen and partial records are excluded without skipping unfinished work")
    let again = NativeIngestion.newRecords(records, after: first1.nextCursor, sentByOS1: sent, seen: ["a1", "u2"])
    try check(again.records.isEmpty && again.nextCursor == "3", "unfinished record keeps the committed cursor unchanged")
    let completed = records.dropLast() + [NativeRecord(id: "a2", ordinal: 4, role: "assistant", text: "완료된 답", complete: true)]
    let later = NativeIngestion.newRecords(Array(completed), after: again.nextCursor, sentByOS1: sent, seen: ["a1", "u2"])
    try check(later.records.map(\.id) == ["a2"], "a record completed later is ingested once its ordinal passes the cursor")
    let held = Set(["야 인스타그램 수정 좀 하자 준비해", "준비 상태를 확인했습니다."].map(NativeIngestion.digestOf))
    try check(NativeIngestion.newRecords(records, after: nil, sentByOS1: held, seen: []).records.map(\.id) == ["u2"],
              "an adopted output OS1 already holds is skipped by digest even without a seen id")

    let originalRequest = "바다와 호수의 차이를 설명해."
    let legacyHints = "\nVerified local directory candidates from the existing project registry (not a write grant or an active-release claim):\n- /tmp/example-project\nInspect relevant exact paths first. Do not run recursive Glob/Grep over HOME. Preserve the user's selected workspace and verify which project/release is actually active before changes.\n"
    let legacyRecord = NativeRecord(id: "legacy-hint", ordinal: 1, role: "user", text: originalRequest + legacyHints, complete: true)
    let ownDigests = Set([NativeIngestion.digestOf(originalRequest)])
    let legacyImport = NativeIngestion.newRecords([legacyRecord], after: nil, sentByOS1: ownDigests, seen: [])
    try check(legacyImport.records.isEmpty && legacyImport.nextCursor == "1", "own legacy hint must not create a fake external question")
    try check(NativeIngestion.newRecords([legacyRecord], after: nil, sentByOS1: [], seen: []).records == [legacyRecord],
        "unmatched direct-backend text must remain verbatim")
    for text in [originalRequest + legacyHints + "Actually explain this new instruction.",
                 originalRequest + legacyHints.replacingOccurrences(of: "- /tmp/", with: "- quoted "),
                 originalRequest + "\nVerified local directory candidates: quoted user text"] {
        let direct = NativeRecord(id: "literal", ordinal: 2, role: "user", text: text, complete: true)
        try check(NativeIngestion.newRecords([direct], after: nil, sentByOS1: ownDigests, seen: []).records == [direct],
            "lookalike or additional user text must not be swallowed")
    }
    let assistantHints = NativeRecord(id: "assistant-hint", ordinal: 3, role: "assistant", text: originalRequest + legacyHints, complete: true)
    try check(NativeIngestion.newRecords([assistantHints], after: nil, sentByOS1: ownDigests, seen: []).records == [assistantHints],
        "legacy user-wrapper rule must not suppress assistant content")

    // MARK: M. Adopting a runtime result against the handed revision; explicit decisions
    do {
        var app = TaskContext(conversationID: UUID(), objective: TaskContext.Objective(requestText: "준비해", kind: .prepare), projectID: "scv-instagram")
        let handed = app.contextRevision
        var runtime = app
        runtime.bind(provider: "codex", nativeSessionID: "01A07994-0000-4000-8000-000000000000")
        runtime.record(execution: TaskContext.ExecutionRecord(executionID: "e1", provider: "codex", stage: "adopted",
            startedAt: Date(), endedAt: Date(), sideEffects: .none, adoption: .adopted, contextRevision: handed))
        let adopted = app.adopting(runtime, handedRevision: handed)
        try check(adopted == runtime, "unchanged app context adopts the runtime result wholesale")
        app.setObjective(TaskContext.Objective(requestText: "다른 요청", kind: .other))
        try check(!app.acceptsLateResult(fromRevision: handed), "a newer objective makes the handed revision late")
        let merged = app.adopting(runtime, handedRevision: handed)
        try check(merged.objective.requestText == "다른 요청", "changed app context keeps its objective")
        try check(merged.bindings.map(\.nativeSessionID) == ["01a07994-0000-4000-8000-000000000000"], "bookkeeping bindings merge in")
        try check(merged.executions.map(\.executionID) == ["e1"], "executions merge in")
        try check(merged.contextRevision > app.contextRevision, "merge bumps the revision")
        var foreign = TaskContext(conversationID: UUID(), objective: TaskContext.Objective(requestText: "x"))
        foreign.attachSemantic(TaskContext.TaskSource(role: .userDocument, label: "unrelated private data"))
        foreign.bind(provider: "claude", nativeSessionID: UUID().uuidString)
        foreign.facts.append(TaskContext.Fact(text: "unrelated project fact", verified: true))
        try check(app.adopting(foreign, handedRevision: app.contextRevision) == app,
                  "a foreign conversation must not change sources, bindings, facts or any other state")
        try check(TaskContext.explicitDecisions(in: "결정: Node 20으로 간다\n그리고 수정해\ndecision: keep v151 as Gold") == ["Node 20으로 간다", "keep v151 as Gold"],
                  "explicit decision lines are extracted, ordinary lines are not")
        try check(TaskContext.explicitDecisions(in: "결정은 나중에").isEmpty, "'결정은' is not a decision marker")
    }

    // MARK: L. Recorded operating release (custody record) vs recovery pointer
    do {
        let custody = """
        # SCV Instagram v157 custody record (2026-09-06)

        Sixth fix of the owner's experiment round.

        ## Active release

        | field | value |
        | --- | --- |
        | release id | `scv-instagram-single-20260906-v157` |
        | content fingerprint | `6f4205fb91005b074b69cca4f2da72e353c690235a93d3c87eb4065f878ba9e5` |
        | recovery Gold | `scv-instagram-recovery-gold-20260905T054647Z-v151` (unchanged) |
        | runtime archive (R2) | `scv-instagram-automation/release-ready/20260906T230617Z/v157/scv-instagram-single-20260906T230617Z-v157-price-once.tar.gz` sha256 `d74cb331eac33465c043a5f3f59286c6a7198dda39ce8ef0c1a28e20b7873ad0` (1441639 bytes, readback byte-identical) |
        """
        let record = SCVCustodyRecord.parse(custody, path: "docs/scv-instagram-v157-custody.md", commit: "a0dd62b0123456789abc")
        try check(record?.id == "scv-instagram-single-20260906-v157", "custody release id")
        try check(record?.key == "scv-instagram-automation/release-ready/20260906T230617Z/v157/scv-instagram-single-20260906T230617Z-v157-price-once.tar.gz", "custody R2 key")
        try check(record?.sha256 == "d74cb331eac33465c043a5f3f59286c6a7198dda39ce8ef0c1a28e20b7873ad0", "custody sha256")
        try check(record?.bytes == 1_441_639, "custody bytes")
        try check(record?.recordedAt == "2026-09-06 docs/scv-instagram-v157-custody.md@a0dd62b01234", "custody recordedAt carries path and commit")
        try check(SCVCustodyRecord.parse("# nothing\n| release id | not-a-release |\n", path: "x", commit: "y") == nil, "malformed custody table rejected")
        try check(SCVCustodyRecord.version(ofFileName: "scv-instagram-v157-custody.md") == 157, "custody file version")
        try check(SCVCustodyRecord.version(ofFileName: "scv-instagram-v15-custody.md.bak") == nil, "custody file suffix rejected")
        try check(["scv-instagram-v122-custody.md", "scv-instagram-v157-custody.md", "scv-instagram-v99-custody.md", "README.md"]
            .compactMap(SCVCustodyRecord.version(ofFileName:)).max() == 157, "newest custody record wins numerically, not lexically")
        var project = TaskContext.ProjectBaseline(projectID: "scv-instagram", repository: "effacermonexistence/codex",
            recoveryBaseline: TaskContext.BaselineRecord(id: "scv-instagram-20260904T222549Z-v151-clean-current",
                sha256: "75440f5063fb7deab879df404ea8fa7011fece7c3da1f7af93c042ee9a337a5a", recordedAt: "2026-09-04T22:25:49Z"),
            operatingRecord: record)
        let lines = project.baselineLines
        try check(lines.count == 3, "three baseline lines")
        try check(lines[0].contains("v151") && lines[0].contains("복구 기준점"), "recovery line names v151")
        try check(lines[1].contains("v157") && lines[1].contains("실제 배포 상태 조회 아님"), "operating line names v157 and is not a live claim")
        try check(lines[2].contains("미확인"), "live line is unknown")
        project.liveVerified = TaskContext.BaselineRecord(id: "scv-instagram-single-20260906-v157", verifiedAt: Date(timeIntervalSince1970: 1_800_000_000))
        try check(project.baselineLines[2].contains("v157") && project.baselineLines[2].contains("확인 "), "live line shows verification time only when verified")
        try check(ScopeResolution.resolve("파일 수정은 하지 마.").scope == .readOnly, "'수정은 하지 마' is read-only")
        try check(ScopeResolution.resolve("코드 구조 설명해줘. 파일 수정은 하지 마.").prohibitions == ["do not modify files"], "'수정은 하지 마' yields the file prohibition")
    }

    do {
        let stream = [
            NativeRecord(id: "old-output", ordinal: 1, role: "assistant", text: "superseded answer", complete: true, turnID: "owned"),
            NativeRecord(id: "amended-output", ordinal: 2, role: "assistant", text: "latest answer", complete: true, turnID: "owned"),
            NativeRecord(id: "outside-user", ordinal: 3, role: "user", text: "real external work", complete: true, turnID: "outside"),
            NativeRecord(id: "outside-answer", ordinal: 4, role: "assistant", text: "in progress", complete: false, turnID: "outside")
        ]
        let fresh = NativeIngestion.newRecords(stream, after: nil, sentByOS1: [], seen: [], ownedTurnIDs: ["owned"])
        try check(fresh.records.map(\.id) == ["outside-user"] && fresh.nextCursor == "3", "owned intermediate answers reimported or external work dropped")
        let complete = NativeRecord(id: "outside-answer", ordinal: 4, role: "assistant", text: "done", complete: true, turnID: "outside")
        try check(NativeIngestion.newRecords([complete], after: fresh.nextCursor, sentByOS1: [], seen: [], ownedTurnIDs: ["owned"]).records == [complete],
            "owned-turn filtering lost later external completion")
        try check(NativeIngestion.newRecords(Array(stream.prefix(2)), after: nil, sentByOS1: [], seen: [], ownedTurnIDs: []).records.count == 2,
            "unknown turns were hidden without ownership evidence")
    }

    // MARK: N. Common preparation structure: a second registered project uses the same path
    do {
        let second = PreparationIntent.detect("OS1 앱 수정 좀 하자 준비해")
        try check(second?.projectID == "os1-clodex" && second?.kind == .prepare && second?.modifies == false,
                  "a second registered project resolves through the alias table, not an Instagram exception")
        try check(ProjectAdapterRegistry.kind(for: "os1-clodex") == .localWorkspace, "second project maps to the local workspace adapter")
        try check(ProjectAdapterRegistry.kind(for: "scv-instagram") == .remoteMaterials, "Instagram maps to the remote materials adapter")
        try check(ProjectAdapterRegistry.kind(for: "workspace:some-folder") == nil, "a migrated workspace project has no control adapter")
        try check(ProjectAdapterRegistry.kind(for: nil) == nil, "no project, no adapter")
        let unrelated = PreparationIntent.detect("테스트 작성 시작하자")
        try check(unrelated?.projectID == nil, "a prepare marker without a registered project never selects an adapter")
        try check(PreparationIntent.detect("OS1 앱 사이드바 고치자 준비해")?.modifies == false, "naming a target without a described change is still bare preparation")
        try check(PreparationIntent.detect("OS1 앱 사이드바에서 핀 순서가 바뀌는 버그 수정해줘, 준비해")?.modifies == true, "a described change on the second project routes to a backend")
        try check(ProjectAdapterRegistry.label(for: "os1-clodex") == "OS-1 CLODEX", "project label")
    }

    // MARK: O. A pasted OS-1 receipt is not the user's request
    do {
        let pasted = """
        야 하나만 수정하자. 벤치마크 ABCD에 2.39에서 1.93 M이라고 했거든? 단위 좀 바꿔.
        ◉  CLAUDE · read only
        확인했습니다. 다른 곳(run 페이지, r2-restored/2026-09-02/repos/... 체크아웃)은 전부 쉼표 정수로 씁니다.
        print(page)
        실행 기록 확인됨 · 세부 정보 접기
        백엔드 실행 기록의 확인 여부입니다. 답변의 정확성이나 과제 완수를 보증하지 않습니다.
        Standard Claude backend · opus · xhigh reasoning · REVAS adopted · native record verified · 7cb76823.jsonl · native session saved · external app not opened · step 1 · 320s · exit 0
        야 시발 이거 실패했어 이거 고쳐
        """
        let cleaned = OS1ReceiptText.stripped(pasted)
        try check(OS1ReceiptText.containsReceipt(pasted), "receipt lines are recognized")
        try check(!cleaned.lowercased().contains("revas") && !cleaned.contains("실행 기록 확인됨") && !cleaned.contains("CLAUDE · read only"),
                  "receipt lines are removed")
        try check(cleaned.contains("단위 좀 바꿔") && cleaned.contains("이거 고쳐") && cleaned.contains("print(page)"),
                  "the user's own lines and quoted code survive")
        try check(!OS1ReceiptText.containsReceipt("REVAS 라우팅 로직 소스 덤프해줘"), "a genuine request about route internals is not a receipt")
        try check(OS1ReceiptText.stripped("한 줄 요청") == "한 줄 요청", "no receipt, no change")
    }

    print("OS-1 task context fixtures: \(count) checks passed")
}
