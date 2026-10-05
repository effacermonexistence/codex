import Foundation

/// Public execution state only. Never reasoning, prompts, raw errors or policy.
public let journalRotationBytes = 8_000_000
/// Above this encoded size an activity snapshot drops its step labels; the
/// app's observer ignores files over 150,000 bytes.
public let activityStepBudgetBytes = 140_000

public struct RuntimeActivity: Codable, Equatable, Sendable {
    public enum Phase: String, Codable, Sendable { case preparing, waitingForSource, source, authorizing, routing, executing, verifying, syncing, recovering }
    public let phase: Phase
    public let provider: String?
    /// Actual executed mode, recorded only after lane selection. Absence on
    /// historical activity is unknown, never inferred from the model name.
    public let surface: String?
    public let model: String?
    public let effort: String?
    public let timestamp: Date
    public let publicText: String?
    public let tool: String?
    public let nativeSessionID: String?
    /// Native lifecycle metadata, not generated assistant prose or a verdict.
    public let progress: NativeExecutionProgress?
    public init(_ phase: Phase, provider: String? = nil, surface: String? = nil, model: String? = nil, effort: String? = nil, timestamp: Date = Date(), publicText: String? = nil, tool: String? = nil, nativeSessionID: String? = nil, progress: NativeExecutionProgress? = nil) {
        self.phase = phase; self.timestamp = timestamp
        // A source lease is acquired before dispatch. Never carry an earlier
        // turn's executed route or native session into this pre-backend wait.
        self.provider = phase == .waitingForSource ? nil : provider
        self.model = phase == .waitingForSource ? nil : model
        self.effort = phase == .waitingForSource ? nil : effort
        self.surface = (phase == .waitingForSource ? nil : surface).flatMap { raw in
            guard let resolved = ProviderSurface.resolveExecuted(rawSurface: raw, provider: provider),
                  resolved.rawValue == raw else { return nil }
            return raw
        }
        self.publicText = publicText; self.tool = phase == .waitingForSource ? nil : tool
        self.nativeSessionID = (phase == .waitingForSource ? nil : nativeSessionID).flatMap { UUID(uuidString: $0)?.uuidString.lowercased() }
        self.progress = phase == .waitingForSource ? nil : progress.flatMap { $0.isValid ? $0 : nil }
    }

    private enum CodingKeys: String, CodingKey {
        case phase, provider, surface, model, effort, timestamp, publicText, tool, nativeSessionID, waitingReason, progress
    }
    /// Decoder flag: skip `progress`. `emit` reads the previous snapshot on
    /// every event only for its route fields; decoding its step ring would
    /// re-redact every label each time.
    static let routeOnlyKey = CodingUserInfoKey(rawValue: "os1.runtimeActivity.routeOnly")!

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let recordedPhase = try values.decode(Phase.self, forKey: .phase)
        let publicText = try values.decodeIfPresent(String.self, forKey: .publicText)
        let waitingReason = try values.decodeIfPresent(String.self, forKey: .waitingReason)
        // The previous runtime used preparing for these exact public notices.
        // Recognize only its source-lock telemetry, not arbitrary output prose.
        let legacySourceNotice = publicText.map { text in
            ["OS-1 소스 쓰기 차례를 기다리는 중", "OS-1 자체 수리가 OS-1 소스를 쓰는 중이라 기다립니다",
             "Waiting for the OS-1 source writer", "Waiting for an OS-1 repair to finish"].contains { text.hasPrefix($0) }
        } ?? false
        let phase: Phase = recordedPhase == .preparing && (waitingReason == "source_write" || legacySourceNotice)
            ? .waitingForSource : recordedPhase
        self.init(phase, provider: try values.decodeIfPresent(String.self, forKey: .provider),
            surface: try values.decodeIfPresent(String.self, forKey: .surface),
            model: try values.decodeIfPresent(String.self, forKey: .model),
            effort: try values.decodeIfPresent(String.self, forKey: .effort),
            timestamp: try values.decode(Date.self, forKey: .timestamp), publicText: publicText,
            tool: try values.decodeIfPresent(String.self, forKey: .tool),
            nativeSessionID: try values.decodeIfPresent(String.self, forKey: .nativeSessionID),
            // Optional telemetry must never suppress valid public prose when
            // an older/unknown/malformed progress schema is encountered.
            progress: decoder.userInfo[Self.routeOnlyKey] as? Bool == true ? nil
                : try? values.decode(NativeExecutionProgress.self, forKey: .progress))
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        // App/runtime updates are staged independently. Old installed apps
        // reject unknown phase values, but ignore optional keys. Keep their
        // observer alive while new apps get the precise source-wait state.
        try values.encode(phase == .waitingForSource ? Phase.preparing : phase, forKey: .phase)
        if phase == .waitingForSource { try values.encode("source_write", forKey: .waitingReason) }
        try values.encodeIfPresent(provider, forKey: .provider)
        try values.encodeIfPresent(surface, forKey: .surface)
        try values.encodeIfPresent(model, forKey: .model)
        try values.encodeIfPresent(effort, forKey: .effort)
        try values.encode(timestamp, forKey: .timestamp)
        try values.encodeIfPresent(publicText, forKey: .publicText)
        try values.encodeIfPresent(tool, forKey: .tool)
        try values.encodeIfPresent(nativeSessionID, forKey: .nativeSessionID)
        try values.encodeIfPresent(progress, forKey: .progress)
    }
    public var label: String {
        switch phase {
        case .preparing: return os1Tr("작업 준비 중", "Preparing the task")
        case .waitingForSource: return os1Tr("OS-1 소스 접근 대기 중", "Waiting for OS-1 source access")
        case .source: return os1Tr("연결·자료 확인 중", "Checking connections and sources")
        case .authorizing: return os1Tr("공식 로그인 승인 대기 중 · 승인 후 같은 작업을 이어갑니다",
                                        "Waiting for the official sign-in · the same task continues after approval")
        case .routing: return os1Tr("실행 모델 선택 중", "Selecting the execution model")
        case .executing: return os1Tr("OS1 작업 중", "OS1 working")
        case .verifying: return os1Tr("결과 검증 중", "Verifying the result")
        case .syncing: return os1Tr("대화 기록 동기화 중", "Syncing conversation history")
        case .recovering: return os1Tr("OS1이 작업 이어가는 중", "OS1 is continuing the task")
        }
    }
    /// Public tool category only; never commands, credentials or reasoning.
    /// The backend's own per-call words live in `progress.steps`, redacted.
    public var toolProgressLabel: String? {
        guard let tool, !tool.isEmpty else { return nil }
        switch tool {
        case "commandExecution", "Bash": return os1Tr("셸 명령 도구 요청 관측", "Shell tool request observed")
        case "webSearch": return os1Tr("웹 자료 확인 중", "Checking web sources")
        case "fileChange", "Write", "Edit", "MultiEdit", "NotebookEdit": return os1Tr("파일 변경 도구 요청 관측", "File change tool request observed")
        case "Read", "Glob", "Grep": return os1Tr("파일 탐색·읽기 도구 요청 관측", "File inspection tool request observed")
        case "WebSearch", "WebFetch": return os1Tr("웹 자료 도구 요청 관측", "Web source tool request observed")
        case "Agent", "Task": return os1Tr("하위 에이전트 도구 요청 관측", "Subagent tool request observed")
        default: return os1Tr("도구 작업 진행 중", "Tool work in progress")
        }
    }
    public static func emit(_ phase: Phase, provider: String? = nil, surface: String? = nil, model: String? = nil, effort: String? = nil, publicText: String? = nil, tool: String? = nil, nativeSessionID: String? = nil, progress: NativeExecutionProgress? = nil) {
        guard let path = ProcessInfo.processInfo.environment["OS1_ACTIVITY_FILE"] else { return }
        let routeDecoder = JSONDecoder()
        routeDecoder.userInfo[routeOnlyKey] = true
        let previous = (try? Data(contentsOf:URL(fileURLWithPath:path))).flatMap { try? routeDecoder.decode(Self.self,from:$0) }
        let sameProvider = previous?.provider == provider
        // GPT and Codex (or Claude and Claude Code) share a transport, but a
        // lane change is still a route boundary. Never inherit the other
        // lane's model, native session or surface into its new dispatch.
        let sameRoute = sameProvider && phase != .waitingForSource && previous?.phase != .waitingForSource &&
            (surface == nil || surface == previous?.surface)
        let retained = sameRoute && [.verifying, .syncing].contains(phase) ? previous?.publicText : nil
        func activity(_ progress: NativeExecutionProgress?) -> Self {
            Self(phase, provider: provider,
                surface: surface ?? (sameRoute ? previous?.surface : nil),
                model: model ?? (sameRoute ? previous?.model : nil), effort: effort ?? (sameRoute ? previous?.effort : nil),
                publicText: publicText ?? retained, tool: tool,
                nativeSessionID: nativeSessionID ?? (sameRoute ? previous?.nativeSessionID : nil),
                progress: progress)
        }
        guard var data = try? JSONEncoder().encode(activity(progress)) else { return }
        // The app ignores an activity file over 150,000 bytes, which would
        // also hide the public text. Step labels are the first thing to go.
        if data.count > activityStepBudgetBytes, let progress, progress.steps != nil,
           let lean = try? JSONEncoder().encode(activity(progress.replacing(steps: nil, backendStatus: progress.backendStatus))) {
            data = lean
        }
        // Best-effort display telemetry must not fail or change execution.
        try? data.write(to: URL(fileURLWithPath: path), options: .atomic)
        if let journal = ProcessInfo.processInfo.environment["OS1_EVENT_JOURNAL"] {
            let url = URL(fileURLWithPath: journal)
            // A silently frozen journal hid the terminal phases of long runs.
            // Rotate once at the cap so the latest events are always recorded.
            if let size = (try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber,
               size.intValue >= journalRotationBytes {
                let previous = url.appendingPathExtension("previous")
                try? FileManager.default.removeItem(at: previous)
                try? FileManager.default.moveItem(at: url, to: previous)
                FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600])
            }
            if let handle = try? FileHandle(forWritingTo: url) {
                defer { try? handle.close() }
                if (try? handle.seekToEnd()) != nil { try? handle.write(contentsOf: data + Data([10])) }
            }
        }
    }
}
