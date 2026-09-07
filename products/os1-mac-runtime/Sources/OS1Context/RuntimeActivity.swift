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
        case .preparing: return "작업 준비 중"
        case .source: return "연결·자료 확인 중"
        case .authorizing: return "공식 로그인 승인 대기 중 · 승인 후 같은 작업을 이어갑니다"
        case .routing: return "실행 모델 선택 중"
        case .executing: return "\(provider == "claude" ? "Claude" : provider == "codex" ? "Codex" : "OS-1") 작업 중"
        case .verifying: return "결과 검증 중"
        case .syncing: return "대화 기록 동기화 중"
        case .recovering: return "\(provider == "codex" ? "Codex" : provider == "claude" ? "Claude" : "다른 백엔드")로 작업 이어가는 중"
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
