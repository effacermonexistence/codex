import Foundation

/// Public execution state only. Never reasoning, prompts, raw errors or policy.
public let journalRotationBytes = 8_000_000

public struct RuntimeActivity: Codable, Equatable, Sendable {
    public enum Phase: String, Codable, Sendable { case preparing, source, authorizing, routing, executing, verifying, syncing, recovering }
    public let phase: Phase
    public let provider: String?
    public let model: String?
    public let effort: String?
    public let timestamp: Date
    public let publicText: String?
    public let tool: String?
    public let nativeSessionID: String?
    public init(_ phase: Phase, provider: String? = nil, model: String? = nil, effort: String? = nil, timestamp: Date = Date(), publicText: String? = nil, tool: String? = nil, nativeSessionID: String? = nil) {
        self.phase = phase; self.provider = provider; self.model = model; self.effort = effort; self.timestamp = timestamp
        self.publicText = publicText; self.tool = tool
        self.nativeSessionID = nativeSessionID.flatMap { UUID(uuidString: $0)?.uuidString.lowercased() }
    }
    public var label: String {
        switch phase {
        case .preparing: return os1Tr("작업 준비 중", "Preparing the task")
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
    /// Public tool category only; never expose commands, credentials or reasoning.
    public var toolProgressLabel: String? {
        guard let tool, !tool.isEmpty else { return nil }
        switch tool {
        case "commandExecution": return os1Tr("명령 실행·결과 확인 중", "Executing commands and checking results")
        case "webSearch": return os1Tr("웹 자료 확인 중", "Checking web sources")
        case "fileChange": return os1Tr("파일 변경 처리 중", "Processing file changes")
        default: return os1Tr("도구 작업 진행 중", "Tool work in progress")
        }
    }
    public static func emit(_ phase: Phase, provider: String? = nil, model: String? = nil, effort: String? = nil, publicText: String? = nil, tool: String? = nil, nativeSessionID: String? = nil) {
        guard let path = ProcessInfo.processInfo.environment["OS1_ACTIVITY_FILE"] else { return }
        let previous = (try? Data(contentsOf:URL(fileURLWithPath:path))).flatMap { try? JSONDecoder().decode(Self.self,from:$0) }
        let retained = [.verifying, .syncing].contains(phase) ? previous?.publicText : nil
        let sameProvider = previous?.provider == provider
        guard let data = try? JSONEncoder().encode(Self(phase, provider: provider,
            model: model ?? (sameProvider ? previous?.model : nil), effort: effort ?? (sameProvider ? previous?.effort : nil),
            publicText: publicText ?? retained, tool: tool,
            nativeSessionID: nativeSessionID ?? (sameProvider ? previous?.nativeSessionID : nil))) else { return }
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
