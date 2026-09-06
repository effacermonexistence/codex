import Foundation

/// Public execution state only. Never reasoning, prompts, raw errors or policy.
public struct RuntimeActivity: Codable, Equatable, Sendable {
    public enum Phase: String, Codable, Sendable { case preparing, source, routing, executing, verifying, syncing, recovering }
    public let phase: Phase
    public let provider: String?
    public let model: String?
    public let effort: String?
    public let timestamp: Date
    public let publicText: String?
    public let tool: String?
    public init(_ phase: Phase, provider: String? = nil, model: String? = nil, effort: String? = nil, timestamp: Date = Date(), publicText: String? = nil, tool: String? = nil) {
        self.phase = phase; self.provider = provider; self.model = model; self.effort = effort; self.timestamp = timestamp
        self.publicText = publicText; self.tool = tool
    }
    public var label: String {
        switch phase {
        case .preparing: return "작업 준비 중"
        case .source: return "연결·자료 확인 중"
        case .routing: return "실행 모델 선택 중"
        case .executing: return "\(provider == "claude" ? "Claude" : provider == "codex" ? "Codex" : "OS-1") 작업 중"
        case .verifying: return "결과 검증 중"
        case .syncing: return "대화 기록 동기화 중"
        case .recovering: return "\(provider == "codex" ? "Codex" : provider == "claude" ? "Claude" : "다른 백엔드")로 작업 이어가는 중"
        }
    }
    public static func emit(_ phase: Phase, provider: String? = nil, model: String? = nil, effort: String? = nil, publicText: String? = nil, tool: String? = nil) {
        guard let path = ProcessInfo.processInfo.environment["OS1_ACTIVITY_FILE"] else { return }
        let previous = (try? Data(contentsOf:URL(fileURLWithPath:path))).flatMap { try? JSONDecoder().decode(Self.self,from:$0) }
        let retained = [.verifying, .syncing].contains(phase) ? previous?.publicText : nil
        let sameProvider = previous?.provider == provider
        guard let data = try? JSONEncoder().encode(Self(phase, provider: provider,
            model: model ?? (sameProvider ? previous?.model : nil), effort: effort ?? (sameProvider ? previous?.effort : nil),
            publicText: publicText ?? retained, tool: tool)) else { return }
        // Best-effort display telemetry must not fail or change execution.
        try? data.write(to: URL(fileURLWithPath: path), options: .atomic)
        if let journal = ProcessInfo.processInfo.environment["OS1_EVENT_JOURNAL"],
           let handle = try? FileHandle(forWritingTo:URL(fileURLWithPath:journal)) {
            defer { try? handle.close() }
            if let offset = try? handle.seekToEnd(), offset < 8_000_000 {
                try? handle.write(contentsOf:data + Data([10]))
            }
        }
    }
}
