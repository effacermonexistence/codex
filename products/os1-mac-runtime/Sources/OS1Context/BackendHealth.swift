import Foundation

/// Observed usability of the local backends: the reason each one cannot run
/// and the earliest known recovery time. Public state only — never
/// credentials, prompts, rankings or raw provider logs. A dead-backend
/// preflight consults this to repair instead of ending the request.
public struct BackendHealth: Codable, Equatable, Sendable {
    public enum State: String, Codable, Sendable {
        case usable
        case loggedOut = "logged_out"
        case quotaExhausted = "quota_exhausted"
        case contextBudget = "context_budget"
        case missing
        case probeFailed = "probe_failed"
        /// Turned off by the user in Settings — not a failure, nothing to repair.
        case disabled
    }

    public struct Backend: Codable, Equatable, Sendable {
        public let state: State
        public let detail: String?
        public let recoversAt: Date?
        /// The account's current quota window, when the backend reports one:
        /// used share and reset time. Optional so older caches still decode.
        public var windowUsedPercent: Double? = nil
        public var windowResetsAt: Date? = nil
        public init(state: State, detail: String? = nil, recoversAt: Date? = nil) {
            self.state = state
            self.detail = detail.map { String($0.prefix(600)) }
            self.recoversAt = recoversAt
        }
        public var usable: Bool { state == .usable }
    }

    /// Repairs OS-1 may run by itself, in order. The official login is the
    /// owner's browser approval; OS-1 only opens it and waits.
    public enum RepairStep: String, Codable, Sendable {
        case reconnectClaude = "reconnect_claude"
        case waitCodexQuota = "wait_codex_quota"
        case waitClaudeQuota = "wait_claude_quota"
    }

    public let claude: Backend
    public let codex: Backend
    public let checkedAt: Date

    public init(claude: Backend, codex: Backend, checkedAt: Date = Date()) {
        self.claude = claude; self.codex = codex; self.checkedAt = checkedAt
    }

    public var anyUsable: Bool { claude.usable || codex.usable }
    public var earliestRecovery: Date? { [claude.recoversAt, codex.recoversAt].compactMap { $0 }.min() }

    public var repairSteps: [RepairStep] {
        var steps: [RepairStep] = []
        if claude.state == .loggedOut { steps.append(.reconnectClaude) }
        if codex.state == .quotaExhausted { steps.append(.waitCodexQuota) }
        if claude.state == .quotaExhausted { steps.append(.waitClaudeQuota) }
        return steps
    }

    // MARK: classification

    /// The Codex catalog carries its exclusion reasons in `source`; an empty
    /// catalog is classified from them, never guessed from the binary alone.
    /// Catalog `source` used whenever the user switched Codex off; the single
    /// spelling both the runtime and the health classifier agree on.
    public static let disabledCatalogSource = "Codex 백엔드가 설정에서 꺼져 있습니다"

    public static func codexBackend(modelCount: Int, source: String, resetsAt: Date?, executablePresent: Bool,
                                    window: CodexQuotaWindow? = nil) -> Backend {
        if source == disabledCatalogSource { return Backend(state: .disabled, detail: source) }
        if modelCount > 0 {
            var usable = Backend(state: .usable)
            usable.windowUsedPercent = window?.usedPercent
            usable.windowResetsAt = window?.resetsAt
            return usable
        }
        if !executablePresent { return Backend(state: .missing, detail: "codex 실행 파일 없음") }
        if source.contains("사용량 한도") { return Backend(state: .quotaExhausted, detail: source, recoversAt: resetsAt) }
        if source.contains("기본 지시문") { return Backend(state: .contextBudget, detail: source) }
        return Backend(state: .probeFailed, detail: source)
    }

    // MARK: cache

    public static var defaultURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1/backend-health.json")
    }

    public func save(to url: URL = BackendHealth.defaultURL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(self).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    /// Nil when absent, unreadable, from the future, or older than `maxAge`.
    public static func load(from url: URL = BackendHealth.defaultURL, maxAge: TimeInterval, now: Date = Date()) -> BackendHealth? {
        guard let data = try? Data(contentsOf: url), data.count <= 16_384 else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let health = try? decoder.decode(BackendHealth.self, from: data) else { return nil }
        let age = now.timeIntervalSince(health.checkedAt)
        guard age >= -5, age <= maxAge else { return nil }
        return health
    }

    // MARK: public wording

    public static func describe(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = "M월 d일 HH:mm zzz"
        return formatter.string(from: date)
    }

    private static func line(_ name: String, _ backend: Backend) -> String {
        switch backend.state {
        // A usable backend only appears in these lines when OS-1 is explaining
        // why it cannot run at all, so a quota-window suffix here would be
        // unreachable. The window reaches the owner through `os1
        // backend-health` and through the burn notice on the run itself.
        case .usable: return "\(name): 사용 가능"
        case .loggedOut: return os1Tr("\(name): 로그인 만료(OAuth) — 공식 로그인 승인이 필요합니다. 로그인 창을 여는 순간 기존 세션이 지워지므로, 연 창은 끝까지 완료해야 합니다.",
            "\(name): sign-in expired (OAuth) — the official login must be approved. Opening the login clears the stored session, so a window that was opened has to be finished.")
        case .quotaExhausted:
            let reset = backend.recoversAt.map { " — \(describe($0))에 복구" } ?? " — 복구 시각 미확인"
            return "\(name): 사용량 한도 소진\(reset)"
        case .contextBudget: return "\(name): 남은 모델이 계정 기본 지시문을 담지 못해 제외됨"
        case .missing: return "\(name): 실행 파일 없음"
        case .probeFailed: return "\(name): 상태 확인 실패" + (backend.detail.map { "(\($0))" } ?? "")
        case .disabled: return os1Tr("\(name): 설정에서 꺼짐", "\(name): turned off in Settings")
        }
    }

    public var diagnosisLines: [String] { [Self.line("Claude", claude), Self.line("Codex", codex)] }

    /// One-paragraph activity text while OS-1 repairs.
    public var publicSummary: String {
        "사용 가능한 백엔드가 없습니다. " + diagnosisLines.joined(separator: " · ") + ". " + repairPlanText
    }

    public var repairPlanText: String {
        var parts: [String] = []
        for step in repairSteps {
            switch step {
            case .reconnectClaude: parts.append("터미널 창에 공식 Claude 로그인을 열어 승인·코드 입력을 기다립니다")
            case .waitCodexQuota: parts.append("Codex 한도 복구" + (codex.recoversAt.map { "(\(Self.describe($0)))" } ?? "") + "를 기다립니다")
            case .waitClaudeQuota: parts.append("Claude 한도 복구" + (claude.recoversAt.map { "(\(Self.describe($0)))" } ?? "") + "를 기다립니다")
            }
        }
        return parts.isEmpty ? "OS1이 스스로 고칠 수 있는 항목이 없습니다." : "OS1 자가 복구: " + parts.joined(separator: ", ") + "."
    }

    /// Message preserved with the held request after repair did not finish.
    public func holdMessage(repairNote: String?) -> String {
        var lines = ["사용 가능한 백엔드가 없어 모델 호출 없이 사전 검사에서 중단했습니다. 요청은 보존했습니다."]
        lines += diagnosisLines.map { "- " + $0 }
        if let repairNote, !repairNote.isEmpty { lines.append("자가 복구 결과: " + repairNote) }
        lines.append("백엔드가 돌아오면 OS1이 이 요청을 자동으로 이어서 실행합니다."
            + (earliestRecovery.map { " 가장 이른 복구 예정: \(Self.describe($0))." } ?? ""))
        return lines.joined(separator: "\n")
    }

    /// Status line the app shows while waiting for a recovery.
    public var waitingStatus: String {
        var reasons: [String] = []
        if claude.state == .loggedOut { reasons.append("Claude 로그인 승인") }
        if codex.state == .quotaExhausted { reasons.append("Codex 한도 복구" + (codex.recoversAt.map { "(\(Self.describe($0)))" } ?? "")) }
        if claude.state == .quotaExhausted { reasons.append("Claude 한도 복구") }
        let trigger = reasons.isEmpty ? "백엔드 복구" : reasons.joined(separator: " 또는 ")
        return "백엔드 복구 대기 · \(trigger) 시 자동 재실행"
    }
}
