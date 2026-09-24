import Foundation

/// User-visible metering classes. These names describe the product surface;
/// they do not assert that every class has an independent allowance on the
/// current account. Runtime/account evidence owns that determination.
public enum OS1QuotaPool: String, Codable, Sendable, CaseIterable {
    case openAIConversation = "openai-conversation"
    case openAIAgentic = "openai-agentic"
    case anthropicInteractive = "anthropic-interactive"
    case anthropicProgrammatic = "anthropic-programmatic"
}

public enum OS1InteractionMode: String, Codable, Sendable {
    case conversation
    case agent
}

public enum OS1ExecutionSurface: String, Codable, Sendable, CaseIterable {
    case chatGPT
    case codex
    case claude
    case claudeCode

    public var quotaPool: OS1QuotaPool {
        switch self {
        case .chatGPT: return .openAIConversation
        case .codex: return .openAIAgentic
        case .claude: return .anthropicInteractive
        case .claudeCode: return .anthropicProgrammatic
        }
    }

    public var mode: OS1InteractionMode {
        switch self {
        case .chatGPT, .claude: return .conversation
        case .codex, .claudeCode: return .agent
        }
    }

    /// The provider transport that can execute this exact surface. Consumer
    /// chat applications intentionally return nil: relabeling an agent result
    /// as ChatGPT/Claude is not execution of that consumer surface.
    public var executorProviderID: String? {
        switch self {
        case .chatGPT, .claude: return nil
        case .codex: return "codex"
        case .claudeCode: return "claude"
        }
    }

    public var isAutomaticExecutorAvailable: Bool { executorProviderID != nil }

    public var displayName: String {
        switch self {
        case .chatGPT: return "ChatGPT"
        case .codex: return "Codex"
        case .claude: return "Claude"
        case .claudeCode: return "Claude Code"
        }
    }
}

public enum ExecutionSurfacePolicy {
    /// Only transports with a verifiable programmatic execution path are
    /// candidates. Permission scope constrains what they may do; it must never
    /// be used to invent a different product surface.
    public static func automaticCandidates(scope: TaskContext.Scope) -> [OS1ExecutionSurface] {
        switch scope {
        case .readOnly, .workspaceWrite: return [.codex, .claudeCode]
        case .fullAccess: return []
        }
    }

    public static func surface(providerID: String, permissionProfile: String) -> OS1ExecutionSurface? {
        _ = permissionProfile // capability, not product identity
        switch providerID.lowercased() {
        case "codex": return .codex
        case "claude": return .claudeCode
        default: return nil
        }
    }

    /// Public capability constraint only; private route scores remain private.
    public static func routingDirective(scope: TaskContext.Scope) -> String {
        let candidates = automaticCandidates(scope: scope)
        guard !candidates.isEmpty else {
            return "No automatic execution surface supports this permission scope."
        }
        let names = candidates.compactMap { surface in
            surface.executorProviderID.map { "\(surface.displayName) via \($0)" }
        }.joined(separator: ", ")
        return "Verified automatic execution surfaces: \(names). Select one usable provider tuple; do not duplicate the same task across providers. ChatGPT and Claude consumer chat surfaces are not automatic executors until a supported, independently verifiable transport is connected."
    }
}
