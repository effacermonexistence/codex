import Foundation

/// A task is decomposed only when the owner's request is a substantial
/// workspace change. A read-only question or a small edit keeps the existing
/// single-execution fast path. This is a routing contract, not a model claim.
public enum TaskWorkflow: String, Codable, Sendable, CaseIterable {
    case architecture
    case implementation
    case verification

    public static func shouldDecompose(_ request: String, scope: TaskContext.Scope) -> Bool {
        guard scope == .workspaceWrite else { return false }
        let text = request.precomposedStringWithCanonicalMapping.lowercased()
        let substantial = ["오토메이션", "automation", "아키텍처", "architecture",
                           "통합", "integration", "integrate", "워크플로", "workflow", "파이프라인", "pipeline",
                           "os1", "os-1", "clodex", "복구", "restore", "self-repair", "셀프", "end-to-end", "e2e"].contains { text.contains($0) }
        let delivery = ["구현", "완성", "완료", "끝까지", "고쳐", "수정", "만들", "추가", "설치", "배포",
                        "implement", "finish", "complete", "build", "fix", "repair", "ship", "deploy"].contains { text.contains($0) }
        let explicitMultiStage = ["설계", "검증", "테스트", "로그", "원인", "완수율", "아키텍처",
                                  "architecture", "verify", "test", "root cause", "end-to-end", "e2e"].contains { text.contains($0) }
        return delivery && (explicitMultiStage || substantial)
    }

    public var readOnly: Bool { self != .implementation }

    /// Permission classification sees only the current stage, not quoted future
    /// write instructions. The complete owner objective stays in provider input.
    public var routingTask: String {
        readOnly ? "Read-only status inspection. Report observed completed, pending and uncertain steps for the interrupted objective in context, using read-only local and remote checks."
            : "Implement the authorized source change: modify files in the authorized workspace according to the architecture contract, then run deterministic tests. Avoid unrelated work and external side effects."
    }

    /// Stage scaffolding (including the OS-1 name and quoted BLOCK) is not
    /// an owner request to switch projects or permission scopes.
    public static func preparationRequest(owner: String?, stagePrompt: String) -> String {
        owner ?? stagePrompt
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
            return "Complex software architecture and root-cause analysis. Route to the strongest available reasoning tier; inspect source and logs read-only; output a bounded implementation contract."
        case .implementation:
            return "Bounded software implementation in the authorized workspace. Route to the lowest eligible observed coding tier, not an unverified price claim; apply the architecture contract, run deterministic tests, and avoid unrelated work."
        case .verification:
            return "Independent complex software verification. Route to the strongest available reasoning tier; inspect actual diff, tests and downstream effect read-only; report PASS or BLOCK."
        }
    }

    public func prompt(original: String, prior: String? = nil) -> String {
        let boundedPrior = prior.map { String($0.prefix(12_000)) } ?? "none"
        switch self {
        case .architecture:
            return """
            OS-1 WORKFLOW STAGE 1/3 — ARCHITECTURE (READ ONLY)
            Owner objective (preserve verbatim):
            \(original)

            Inspect the actual source, current runtime ownership, logs and last known-good state. Identify the highest broken layer, allowed/forbidden scope, smallest viable patch, deterministic tests, rollback, and completion evidence. Return a compact implementation contract with concrete file paths. Do not edit files, deploy, send messages, or claim the whole task complete.
            """
        case .implementation:
            return """
            OS-1 WORKFLOW STAGE 2/3 — IMPLEMENTATION
            Owner objective (preserve verbatim):
            \(original)

            Architecture handoff (candidate; verify against source):
            \(boundedPrior)

            Implement the smallest correct change in the authorized workspace. Run appropriate deterministic tests and preserve existing work. Record exact changed files, test commands/results, and unresolved limitations. Do not claim global completion: an independent verification stage follows. Do not perform external side effects outside the owner's original permission.
            """
        case .verification:
            return """
            OS-1 WORKFLOW STAGE 3/3 — INDEPENDENT VERIFICATION (READ ONLY)
            Owner objective (preserve verbatim):
            \(original)

            Implementation handoff (candidate, not proof):
            \(boundedPrior)

            Inspect the executed artifact and current workspace, not the implementer's success statement. Verify actual diff, required tests, forbidden scope, and visible/runtime effect when applicable. Do not edit, deploy, send, or replay. End with exactly one machine-readable line: OS1_WORKFLOW_VERDICT: PASS or OS1_WORKFLOW_VERDICT: BLOCK. PASS means all in-scope completion conditions are independently verified; otherwise BLOCK and list exact remaining work. Local tests alone do not prove production/live effect.
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

        Repair only the concrete remaining defect in the authorized workspace. Do not repeat already-completed work, widen scope, send messages, deploy, or overwrite accepted state. Run the relevant deterministic regression and report exact files and results. A fresh read-only verification follows.
        """
    }

    public static func verdict(_ output: String) -> Bool? {
        let lines = output.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let markers = lines.filter { $0 == "OS1_WORKFLOW_VERDICT: PASS" || $0 == "OS1_WORKFLOW_VERDICT: BLOCK" }
        guard markers.count == 1, lines.last == markers[0] else { return nil }
        return markers[0].hasSuffix("PASS")
    }

    public static func permitsBoundedRepair(verdict: Bool?, stageIndex: Int) -> Bool {
        verdict == false && stageIndex == 2
    }
}
