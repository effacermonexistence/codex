import Foundation

/// A task is decomposed only when the owner's request is a substantial
/// workspace change. A read-only question or a small edit keeps the existing
/// single-execution fast path. This is a routing contract, not a model claim.
public enum TaskWorkflow: String, Codable, Sendable, CaseIterable {
    case architecture
    case implementation
    case verification

    /// A narrow owner-request fast path. Product names alone do not make a
    /// spacing edit an architecture task. Mixed/structural requests fail closed.
    public static func isBoundedAppearanceEdit(_ request: String) -> Bool {
        let text = request.precomposedStringWithCanonicalMapping.lowercased()
        guard text.count <= 1200 else { return false }
        let surface = ["ui", "interface", "인터페이스", "사이드바", "sidebar", "화면", "버튼", "button", "헤더", "header"]
        let cosmetic = ["여백", "공백", "간격", "padding", "spacing", "margin", "폰트", "글자체", "font", "색상", "색깔", "color", "corner radius"]
        let edit = ["수정", "고쳐", "바꿔", "줄여", "올려", "없애", "fix", "change", "reduce", "remove", "adjust"]
        let structural = ["라우팅", "routing", "router", "아키텍", "architecture", "backend", "백엔드", "백핸드", "quota", "쿼터", "인증", "로그인", "auth", "권한", "permission", "schema", "스키마", "migration", "마이그레이션", "telemetry", "실시간", "stream", "스티어링", "steering", "queue", "대기열", "복구", "restore", "데이터", "database", "저장", "persistence", "deadlock", "교착", "원인", "root cause", "멈", "freeze", "hanging", "hung", "crash", "충돌", "api", "보안", "security", "접근성", "accessibility", "키보드", "keyboard", "동작", "behavior", "전체 테스트", "모든 테스트", "전체 검증", "전수", "full test", "all test", "full suite", "end-to-end", "e2e"]
        return surface.contains(where: text.contains)
            && cosmetic.contains(where: text.contains)
            && edit.contains(where: text.contains)
            && !structural.contains(where: text.contains)
    }

    public static func validationContract(ownerRequest: String, scope: TaskContext.Scope) -> String? {
        guard scope == .workspaceWrite, isBoundedAppearanceEdit(ownerRequest) else { return nil }
        return """
        OS1 VALIDATION PROFILE: BOUNDED_APPEARANCE_EDIT
        This owner request is a bounded visual change, not a new architecture.
        Inspect the target view and preserve existing work. Implement the smallest change.
        Validate with the affected layout regression, one build, and one actual render/UI observation.
        Do not expand this task into a full runtime/fleet test battery or another model review unless
        the diff changes behavior/shared runtime logic or the owner explicitly requests that coverage.
        A failed renderer is a verification limitation, not a reason to repeat the same render/build loop.
        Use a different available UI observation once; if unavailable, report that exact limitation.
        Report source, build, installed state and visible effect separately. Existing self-update,
        permission, rollback and installation gates remain authoritative; do not bypass them.
        """
    }

    /// One backend turn does the whole job, as Codex and Claude Code do: the
    /// backend plans, edits and tests in its own loop, and OS-1's own checks
    /// (the self-repair build and tests, delivery checks) follow. Splitting a
    /// request into architecture, implementation and verification turns is
    /// used only when the owner asks for that separation explicitly: between
    /// 2026-09-19 and 09-23 the automatic split ran 15 owner requests, 8 of
    /// them ended held or unfinished, and they took a median of 22 minutes.
    public static func shouldDecompose(_ request: String, scope: TaskContext.Scope, projectID: String? = nil) -> Bool {
        guard scope == .workspaceWrite else { return false }
        let text = request.precomposedStringWithCanonicalMapping.lowercased()
        return explicitStagingMarkers.contains(where: text.contains)
    }

    /// The owner asking for separate stages or an independent verifier.
    public static let explicitStagingMarkers = [
        "독립 검증", "독립적으로 검증", "별도 검증", "별도로 검증", "검증은 따로", "따로 검증", "단계별로 나눠", "단계를 나눠",
        "설계·구현·검증", "설계, 구현, 검증",
        "independent verification", "separate verification", "verify separately", "in separate stages", "staged workflow",
    ]

    /// Phase instructions constrain actions, not executor capabilities.
    public var executionPermissionProfile: String { "workspace_write" }

    /// Permission classification sees only the current stage, not quoted future
    /// write instructions. The complete owner objective stays in provider input.
    public var routingTask: String {
        switch self {
        case .architecture:
            return "Review current repository sources, requirements and logs for software architecture. Return an evidence-grounded architecture contract with concrete paths, acceptance tests and rollback boundaries. This phase delivers analysis, not overall task completion."
        case .implementation:
            return "Implement the authorized source change: modify files in the authorized workspace according to the architecture contract, then run deterministic tests. Avoid unrelated work and external side effects."
        case .verification:
            return "Review actual repository artifacts, tests and execution records against the owner objective. Return an independent PASS or BLOCK verdict with evidence."
        }
    }

    /// Stage scaffolding (including the OS-1 name and quoted BLOCK) is not
    /// an owner request to switch projects or permission scopes.
    public static func preparationRequest(owner: String?, stagePrompt: String) -> String {
        owner ?? stagePrompt
    }

    /// Stage scaffolding must never replace the user's durable objective.
    public static func objectiveRequest(owner: String?, executionPrompt: String) -> String {
        owner ?? executionPrompt
    }

    public var progressText: String {
        switch self {
        case .architecture: return "1/3 제작 준비 · 구현 계약을 정리한 뒤 자동으로 제작합니다."
        case .implementation: return "2/3 제작 · 승인된 작업 공간의 파일을 만들고 수정합니다."
        case .verification: return "3/3 검증 · 생성된 파일과 실행 결과를 확인합니다."
        }
    }

    public static func permitsSelfUpdate(stage: TaskWorkflow?, finalVerdict: Bool?) -> Bool {
        stage == nil || (stage == .verification && finalVerdict == true)
    }


    /// Stage policy operates only on the native account's observed model
    /// inventory. These are routing tiers, not measured quality or price claims.
    public static func modelTier(_ identifier: String) -> Int {
        let model = identifier.lowercased()
        if model.contains("astra") { return 6 }
        if model.contains("5.6-sol") || model.contains("daybreak") || model.contains("opus") { return 5 }
        if model.contains("terra") || model.contains("sonnet") { return 3 }
        if model.contains("luna") || model.contains("fable") { return 2 }
        if model.contains("mini") || model.contains("spark") || model.contains("haiku") { return 1 }
        return 0
    }

    public func preferredModels(_ identifiers: [String]) -> Set<String> {
        guard !identifiers.isEmpty else { return [] }
        let tiers = identifiers.map { Self.modelTier($0) }
        let target: Int
        switch self {
        case .architecture, .verification:
            target = tiers.max() ?? 0
        case .implementation:
            target = tiers.contains(3) ? 3 : (tiers.contains(2) ? 2 : (tiers.max() ?? 0))
        }
        return Set(identifiers.filter { Self.modelTier($0) == target })
    }

    /// Stage quality preference must not erase another usable transport.
    /// Select within each provider; the signed router still ranks the union.
    public func preferredModelsByProvider(_ inventories: [[String]]) -> Set<String> {
        inventories.reduce(into: Set<String>()) { result, models in
            result.formUnion(preferredModels(models))
        }
    }

    /// Cost preference is not an availability boundary. Retain stronger models
    /// so the signed router can satisfy a task-specific capability floor.
    public func eligibleModelsByProvider(_ inventories: [[String]]) -> Set<String> {
        guard self == .implementation else { return preferredModelsByProvider(inventories) }
        return inventories.reduce(into: Set<String>()) { result, models in
            let floor = preferredModels(models).map { Self.modelTier($0) }.min() ?? 0
            result.formUnion(models.filter { Self.modelTier($0) >= floor })
        }
    }

    public func preferredEfforts(_ efforts: [String]) -> [String] {
        let selected: [String]
        switch self {
        case .architecture, .verification:
            selected = efforts.filter { ["high", "xhigh", "max", "ultra"].contains($0) }
            return selected.isEmpty ? efforts.suffix(1).map { $0 } : selected
        case .implementation:
            // Keep the router's capability floor satisfiable. Prefer cheaper efforts
            // by order, but never remove a required high-effort tuple.
            return efforts.filter { ["low", "medium"].contains($0) } +
                efforts.filter { !["low", "medium"].contains($0) }
        }
    }

    public var routeTask: String {
        switch self {
        case .architecture:
            return "Complex software architecture and root-cause analysis. Route to the strongest available reasoning tier; inspect source and logs and execute necessary bounded preparation; output a bounded implementation contract."
        case .implementation:
            return "Bounded software implementation in the authorized workspace. Route to the lowest eligible observed coding tier, not an unverified price claim; apply the architecture contract, run deterministic tests, and avoid unrelated work."
        case .verification:
            return "Independent complex software verification. Route to the strongest available reasoning tier; execute tests and inspect actual diff and downstream effect; report PASS or BLOCK."
        }
    }

    public func prompt(original: String, prior: String? = nil) -> String {
        let boundedPrior = prior.map { String($0.prefix(12_000)) } ?? "none"
        switch self {
        case .architecture:
            return """
            OS-1 WORKFLOW STAGE 1/3 — BUILD PREPARATION
            Owner objective (preserve verbatim):
            \(original)

            This is the preparation stage of an authorized create/modify workflow, NOT a read-only owner request or an interrupted-task status check. OS-1 automatically runs implementation next, then independent verification; do not ask the owner to authorize the same build again. In progress text say that you are preparing the build and implementation follows, not that the requested task is read-only.
            Inspect only the sources and requirements necessary for a compact implementation contract with concrete paths, allowed/forbidden scope, tests, rollback and completion evidence. For a new artifact, identify its target and acceptance criteria; do not invent a broken runtime or demand pre-existing files. For a repair, inspect relevant logs and the last known-good state. Keep this stage bounded and return the contract promptly. All stages use the executable workspace capability. Create bounded scaffolding or test fixtures when necessary for the contract. Preserve the owner's explicit prohibitions; do not perform unrelated changes or unauthorized external side effects. Do not claim the whole task complete.
            """
        case .implementation:
            return """
            OS-1 WORKFLOW STAGE 2/3 — IMPLEMENTATION
            Owner objective (preserve verbatim):
            \(original)

            Architecture handoff (candidate; verify against source):
            \(boundedPrior)

            The original owner create/modify authorization remains active across all stages; do not inherit restrictions from stage names or old handoffs. Preserve explicit owner prohibitions. Implement the smallest correct change in the authorized workspace. Run appropriate deterministic tests and preserve existing work. Record exact changed files, test commands/results, and unresolved limitations. Do not claim global completion: an independent verification stage follows. Do not perform external side effects outside the owner's original permission.
            """
        case .verification:
            return """
            OS-1 WORKFLOW STAGE 3/3 — INDEPENDENT VERIFICATION
            Owner objective (preserve verbatim):
            \(original)

            Implementation handoff (candidate, not proof):
            \(boundedPrior)

            Inspect the executed artifact and current workspace, not the implementer's success statement. Verify actual diff, required tests, forbidden scope, and visible/runtime effect when applicable. Execute the required verification, including necessary test artifacts. Do not alter acceptance criteria or production artifacts to manufacture a PASS; report defects for the repair stage. Preserve explicit owner prohibitions and inspect previous side effects before any replay. End with exactly one machine-readable line: OS1_WORKFLOW_VERDICT: PASS or OS1_WORKFLOW_VERDICT: BLOCK. PASS means all in-scope completion conditions are independently verified; otherwise BLOCK and list exact remaining work. Local tests alone do not prove production/live effect.
            """
        }
    }

    /// A verified BLOCK may trigger one bounded correction, never an
    /// unbounded same-frame patch loop or replay of an uncertain write.
    public static func repairPrompt(original: String, architecture: String, failedVerification: String) -> String {
        """
        OS-1 WORKFLOW STAGE — BOUNDED IMPLEMENTATION REPAIR (MAXIMUM ONE)
        Owner objective (preserve verbatim):
        \(original)

        Architecture contract (candidate; verify against source):
        \(String(architecture.prefix(6_000)))

        Separately verified BLOCK (failure evidence; re-check the actual state):
        \(String(failedVerification.prefix(6_000)))

        Repair only the concrete remaining defect in the authorized workspace. Do not repeat already-completed work, widen scope, send messages, deploy, or overwrite accepted state. Run the relevant deterministic regression and report exact files and results. A fresh independent verification execution follows.
        """
    }

    public static func verdict(_ output: String) -> Bool? {
        let lines = output.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let markers = lines.filter { $0 == "OS1_WORKFLOW_VERDICT: PASS" || $0 == "OS1_WORKFLOW_VERDICT: BLOCK" }
        guard markers.count == 1, lines.last == markers[0] else { return nil }
        return markers[0].hasSuffix("PASS")
    }

    public static func sourceAlreadySatisfied(_ output: String) -> Bool {
        let lines = output.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        let marker = "OS1_SOURCE_STATE: ALREADY_SATISFIED"
        return lines.filter { $0 == marker }.count == 1 && lines.last == marker
    }

    public static func permitsBoundedRepair(verdict: Bool?, stageIndex: Int, repairAttempted: Bool = false) -> Bool {
        verdict == false && !repairAttempted && (stageIndex == 1 || stageIndex == 2)
    }
}
