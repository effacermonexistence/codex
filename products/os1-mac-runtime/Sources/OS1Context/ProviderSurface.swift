import Foundation

/// The execution surfaces the owner can choose, and what each one really is.
///
/// Both vendors ship two surfaces. OpenAI has ChatGPT chat and the Codex agent;
/// Anthropic has Claude chat and the Claude Code agent. The owner sees four
/// choices in ChatGPT.app and Claude and asks OS-1 for the same choice, so the
/// rail has to offer it — but they are not four independent quota pools and not
/// four programmatic executors, and a label that pretends otherwise is the
/// failure build 246 removed: builds 244/245 added "ChatGPT mode" and "Claude
/// mode" as names over the same two transports, and with Claude signed out
/// every "surface" ran on one Codex account.
///
/// So the distinction lives in the type, not in a string:
///
/// - `codex`, `claude` and `claudeChat` are executors. OS-1 dispatches a signed
///   ticket, receives output and adopts a verified result.
/// - `chatgpt` is a handoff. Measured 2026-09-29 on ChatGPT.app 26.924.20706:
///   the local Codex app-server protocol exposes 187 methods and none of them
///   sends a ChatGPT chat message (`CollaborationMode` is Codex's own
///   plan/default), the Desktop IPC socket carries only `thread-follower-*`
///   Codex-thread methods, and the ChatGPT chat client bundled in the app is a
///   web client that posts to `chatgpt.com/backend-api/f/conversation` behind
///   `/sentinel/chat-requirements`, a turnstile token and a proof-of-work
///   challenge. Reproducing that from OS-1 would mean defeating an
///   anti-automation control, so OS-1 hands the request to the signed-in
///   application instead of claiming to have run it.
public enum ProviderSurface: String, Codable, Sendable, CaseIterable {
    /// The private router chooses among the executors.
    case auto
    /// OpenAI's coding agent. Spends Codex usage.
    case codex
    /// OpenAI's chat surface. Handoff only; OS-1 cannot execute here.
    case chatgpt
    /// Anthropic's coding agent, full lane: machine customizations and tools.
    case claude
    /// Anthropic's chat-shaped lane: the same CLI and the same subscription
    /// limit with customizations, tools and the workspace left out. Measured
    /// 2026-09-29, same question and same fable/max route on both lanes:
    /// 28,620 tokens here against 754,630 for the full lane, a 26.4x
    /// difference, because ~/.claude/CLAUDE.md is cache-created on every
    /// full-lane turn. Cheaper, not free, and not a second pool.
    case claudeChat = "claude-chat"

    /// Which usage a turn on this surface actually spends.
    public enum QuotaPool: String, Codable, Sendable {
        /// No provider call: the local deterministic executor, or a handoff
        /// that OS-1 does not run.
        case none
        /// OpenAI Codex usage, separate from the ChatGPT chat allowance.
        case openAICodex = "openai_codex"
        /// The ChatGPT plan's chat allowance, spent by the owner in the app.
        case openAIChat = "openai_chat"
        /// One Anthropic subscription limit, shared by both Claude surfaces.
        case anthropic
    }

    /// True when OS-1 dispatches, verifies and adopts a result on this surface.
    public var isExecutor: Bool { self != .chatgpt }

    /// The `provider_preference` the signed routing gateway accepts. A handoff
    /// has none: it never asks for a ticket, so it can never spend a route.
    public var gatewayPreference: String? {
        switch self {
        case .auto: return "auto"
        case .codex: return "codex"
        case .claude, .claudeChat: return "claude"
        case .chatgpt: return nil
        }
    }

    /// The owner chose the bounded chat lane explicitly, so the lane's own
    /// narrow auto-trigger is not required for it to run.
    public var forcesClaudeChatLane: Bool { self == .claudeChat }

    /// A chat-shaped lane answers from the request itself, so it must never
    /// carry a write ticket.
    public var requiresReadOnly: Bool { self == .claudeChat }

    public var quotaPool: QuotaPool {
        switch self {
        case .auto: return .none
        case .codex: return .openAICodex
        case .chatgpt: return .openAIChat
        case .claude, .claudeChat: return .anthropic
        }
    }

    /// The rail tile a surface belongs to. There is one account per tile and
    /// two ways to spend it, which is the same shape the ChatGPT app presents:
    /// one sign-in, Codex or chat chosen inside it. `auto` belongs to no tile
    /// because it is the router, not a backend.
    public enum Backend: String, Codable, Sendable, CaseIterable {
        case openAI = "codex"
        case anthropic = "claude"

        /// Surfaces this tile may route to, executing one first. The order is
        /// the menu order, so the default is never buried under an alternative.
        public var surfaces: [ProviderSurface] {
            switch self {
            case .openAI: return [.codex, .chatgpt]
            case .anthropic: return [.claude, .claudeChat]
            }
        }

        /// What the tile does when the owner has not chosen otherwise: the
        /// surface OS-1 can actually execute and adopt.
        public var defaultSurface: ProviderSurface {
            switch self {
            case .openAI: return .codex
            case .anthropic: return .claude
            }
        }

        /// Reject a stored or hand-edited value that does not belong to this
        /// tile, so a settings file cannot move the OpenAI tile onto Claude.
        public func resolve(_ raw: String?) -> ProviderSurface {
            guard let raw, let surface = ProviderSurface(rawValue: raw),
                  surfaces.contains(surface) else { return defaultSurface }
            return surface
        }
    }

    /// The tile this surface is selected from, or nil for the router.
    public var backend: Backend? {
        switch self {
        case .auto: return nil
        case .codex, .chatgpt: return .openAI
        case .claude, .claudeChat: return .anthropic
        }
    }

    /// Short label for the rail tile when a non-default surface is selected,
    /// so the choice is visible on the tile rather than hidden in a menu.
    public var railBadge: String? {
        switch self {
        case .auto, .codex, .claude: return nil
        case .chatgpt: return "ChatGPT"
        case .claudeChat: return os1Tr("채팅", "chat")
        }
    }

    /// Menu label: what the surface does, not merely its name.
    public var choiceTitle: String {
        switch self {
        case .auto: return os1Tr("자동", "Auto")
        case .codex: return os1Tr("Codex — OS-1이 실행", "Codex — OS-1 executes")
        case .chatgpt: return os1Tr("ChatGPT — 앱으로 넘김", "ChatGPT — hand to the app")
        case .claude: return os1Tr("Claude Code — 전체 레인", "Claude Code — full lane")
        case .claudeChat: return os1Tr("Claude 채팅 — 읽기 전용, 저비용",
                                       "Claude chat — read-only, far cheaper")
        }
    }

    /// One line naming whose usage the surface spends, for the route notice.
    /// Never claims a separate pool where the pool is shared.
    public var usageLine: String {
        switch self {
        case .auto: return os1Tr("RCC가 실행 가능한 백엔드 중에서 고릅니다.",
                                "RCC chooses among the backends that can actually run.")
        case .codex: return os1Tr("Codex 사용량을 씁니다(ChatGPT 채팅 한도와 별개).",
                                  "Spends Codex usage, separate from the ChatGPT chat allowance.")
        case .chatgpt: return os1Tr("OS-1이 실행하지 않고 로그인된 ChatGPT 앱으로 넘깁니다. 답은 앱에서 직접 받습니다.",
                                    "OS-1 does not run this; it hands the request to the signed-in ChatGPT app, where the answer arrives.")
        case .claude: return os1Tr("Claude 구독 한도를 씁니다(Claude 채팅과 같은 한도).",
                                   "Spends the Anthropic subscription limit, the same limit Claude chat uses.")
        case .claudeChat: return os1Tr("같은 Claude 구독 한도를 쓰지만 지침·도구·워크스페이스를 빼서 훨씬 적게 씁니다.",
                                       "Spends the same Anthropic limit with instructions, tools and the workspace left out, so it costs far less.")
        }
    }
}

public enum ProviderSurfaceError: Error, CustomStringConvertible {
    case regression
    public var description: String { "Provider surface regression failed" }
}

/// Handing a request to the ChatGPT chat surface the owner is already signed in
/// to. This is deliberately not an executor: nothing here claims a result.
public enum ChatGPTHandoff {
    /// ChatGPT.app ships the Codex agent and the ChatGPT chat client in one
    /// bundle, so the identifier is Codex's.
    public static let bundleIdentifier = "com.openai.codex"
    public static let applicationPath = "/Applications/ChatGPT.app"

    public static func installed(_ fileManager: FileManager = .default) -> Bool {
        fileManager.fileExists(atPath: applicationPath)
    }

    /// What was handed over, so a later turn can tell a handoff from a run.
    /// No request text is stored: only its length and digest.
    public struct Receipt: Codable, Sendable {
        public let schema: Int
        public let surface: String
        public let executionID: String
        public let requestSHA256: String
        public let requestCharacters: Int
        public let clipboardVerified: Bool
        public let applicationOpened: Bool
        public let at: Date

        public init(executionID: String, requestSHA256: String, requestCharacters: Int,
                    clipboardVerified: Bool, applicationOpened: Bool, at: Date = Date()) {
            self.schema = 1
            self.surface = ProviderSurface.chatgpt.rawValue
            self.executionID = executionID
            self.requestSHA256 = requestSHA256
            self.requestCharacters = requestCharacters
            self.clipboardVerified = clipboardVerified
            self.applicationOpened = applicationOpened
            self.at = at
        }
    }

    public static func receiptRoot(_ fileManager: FileManager = .default) -> URL {
        fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1/chatgpt-handoffs", isDirectory: true)
    }

    /// The owner-facing result of a handoff. It says what OS-1 did and, just as
    /// plainly, what it did not do.
    public static func notice(clipboardVerified: Bool, applicationOpened: Bool, receiptPath: String) -> String {
        var lines: [String] = []
        lines.append(os1Tr("ChatGPT 채팅 표면으로 넘겼습니다. OS-1이 실행한 것은 아닙니다.",
                           "Handed to the ChatGPT chat surface. OS-1 did not run it."))
        lines.append("")
        lines.append(clipboardVerified
            ? os1Tr("• 요청을 클립보드에 넣었습니다. ChatGPT 입력창에서 붙여넣기(⌘V) 하세요.",
                    "• The request is on the clipboard. Paste it (⌘V) into the ChatGPT composer.")
            : os1Tr("• 클립보드 쓰기를 확인하지 못했습니다. 요청을 직접 복사해야 합니다.",
                    "• Clipboard write could not be verified; copy the request yourself."))
        lines.append(applicationOpened
            ? os1Tr("• ChatGPT 앱을 앞으로 가져왔습니다(직접 선택한 동작이므로 허용).",
                    "• ChatGPT.app was brought to the front, which this explicit choice permits.")
            : os1Tr("• ChatGPT 앱을 열지 못했습니다. 직접 실행하세요.",
                    "• ChatGPT.app could not be opened; start it yourself."))
        lines.append("")
        lines.append(os1Tr("ChatGPT 채팅에는 프로그램 실행 경로가 없습니다. 앱 안의 채팅 클라이언트는 sentinel·turnstile·proof-of-work로 보호된 웹 클라이언트이고, 로컬 Codex app-server 프로토콜에는 채팅 전송 메서드가 없습니다. 그래서 OS-1은 결과를 대신 받아오지 않습니다.",
                           "ChatGPT chat has no programmatic execution path: the in-app chat client is a web client guarded by sentinel, turnstile and a proof-of-work challenge, and the local Codex app-server protocol has no chat send method. OS-1 therefore does not collect the answer for you."))
        lines.append(os1Tr("실행까지 OS-1이 맡아야 하면 Codex(같은 OpenAI 계정, Codex 사용량)나 Claude를 고르세요.",
                           "If OS-1 should execute as well, choose Codex (the same OpenAI account, Codex usage) or Claude."))
        lines.append("")
        lines.append("handoff receipt: \(receiptPath)")
        return lines.joined(separator: "\n")
    }

    /// Why the bounded Claude chat lane cannot take a request. Stated before
    /// dispatch so an explicit chat-lane choice never silently becomes the
    /// expensive full lane.
    public static func chatLaneRefusal(needsShell: Bool, namedPaths: [String], images: Int,
                                      hasSource: Bool, machineMaterial: Bool) -> String? {
        if hasSource {
            return os1Tr("첨부된 소스가 있어 Claude 채팅 레인으로 보낼 수 없습니다. 소스 답변 레인이나 Claude Code를 쓰세요.",
                         "An attached source cannot go to the Claude chat lane; use the source-answer lane or Claude Code.")
        }
        if needsShell {
            return os1Tr("이 요청은 이 맥에서 명령 실행이 필요해서 도구 없는 Claude 채팅 레인으로 보낼 수 없습니다. Claude Code를 고르세요.",
                         "This request needs commands on this Mac, so the tool-free Claude chat lane cannot take it. Choose Claude Code.")
        }
        if !namedPaths.isEmpty {
            return os1Tr("요청이 이 맥의 경로(\(namedPaths.prefix(3).joined(separator: ", ")))를 지목해서 Claude 채팅 레인으로 보낼 수 없습니다. Claude Code를 고르세요.",
                         "The request names paths on this Mac (\(namedPaths.prefix(3).joined(separator: ", "))), so the Claude chat lane cannot take it. Choose Claude Code.")
        }
        if images > 0 {
            return os1Tr("첨부 이미지 \(images)장은 Claude 채팅 레인에서 전달되지 않습니다. Claude Code를 고르세요.",
                         "\(images) attached image(s) are not delivered on the Claude chat lane. Choose Claude Code.")
        }
        // A bare filename, a project name or "이거/확인해" all put this machine in
        // scope, and the chat lane has no tools and never reads the workspace.
        // `RequestNamedPaths` only sees real paths, so this is the guard that
        // catches "README.md를 번역해서 저장해".
        if machineMaterial {
            return os1Tr("이 요청은 이 맥의 파일·프로젝트·기록을 가리켜서 도구 없는 Claude 채팅 레인으로 보낼 수 없습니다. Claude Code를 고르세요.",
                         "This request points at files, projects or history on this Mac, so the tool-free Claude chat lane cannot take it. Choose Claude Code.")
        }
        return nil
    }

    public static func selfTest() throws {
        var checks: [Bool] = []
        // A handoff is never an executor and never asks the gateway for a route.
        checks.append(ProviderSurface.chatgpt.isExecutor == false)
        checks.append(ProviderSurface.chatgpt.gatewayPreference == nil)
        checks.append(ProviderSurface.allCases.filter { !$0.isExecutor } == [.chatgpt])
        // Every executor maps onto a preference the deployed gateway accepts.
        let accepted = Set(["auto", "codex", "claude"])
        checks.append(ProviderSurface.allCases.filter(\.isExecutor)
            .allSatisfy { $0.gatewayPreference.map(accepted.contains) == true })
        // Both Claude surfaces are one Anthropic pool; the two OpenAI surfaces
        // are not one pool. A rail label must not invent or merge a pool.
        checks.append(ProviderSurface.claude.quotaPool == ProviderSurface.claudeChat.quotaPool)
        checks.append(ProviderSurface.codex.quotaPool != ProviderSurface.chatgpt.quotaPool)
        checks.append(ProviderSurface.auto.quotaPool == .none && ProviderSurface.chatgpt.quotaPool == .openAIChat)
        // Only the explicit chat-lane choice forces the bounded lane, and it
        // must carry a read-only ticket so the choice cannot be cosmetic.
        checks.append(ProviderSurface.allCases.filter(\.forcesClaudeChatLane) == [.claudeChat])
        checks.append(ProviderSurface.claudeChat.requiresReadOnly && !ProviderSurface.claude.requiresReadOnly)
        // Wire values are stable: the GUI, the CLI and stored receipts share them.
        checks.append(ProviderSurface(rawValue: "claude-chat") == .claudeChat)
        checks.append(ProviderSurface(rawValue: "chatgpt") == .chatgpt)
        checks.append(ProviderSurface(rawValue: "chat-gpt") == nil)
        checks.append(ProviderSurface.allCases.count == 5)
        // The chat lane refuses before dispatch, one reason at a time.
        checks.append(chatLaneRefusal(needsShell: false, namedPaths: [], images: 0,
                                      hasSource: false, machineMaterial: false) == nil)
        checks.append(chatLaneRefusal(needsShell: true, namedPaths: [], images: 0,
                                      hasSource: false, machineMaterial: false) != nil)
        checks.append(chatLaneRefusal(needsShell: false, namedPaths: ["/tmp/x"], images: 0,
                                      hasSource: false, machineMaterial: false) != nil)
        checks.append(chatLaneRefusal(needsShell: false, namedPaths: [], images: 2,
                                      hasSource: false, machineMaterial: false) != nil)
        checks.append(chatLaneRefusal(needsShell: false, namedPaths: [], images: 0,
                                      hasSource: true, machineMaterial: false) != nil)
        checks.append(chatLaneRefusal(needsShell: false, namedPaths: [], images: 0,
                                      hasSource: false, machineMaterial: true) != nil)
        // The handoff notice never claims a result and always says who ran it.
        let notice = notice(clipboardVerified: true, applicationOpened: true, receiptPath: "/tmp/r.json")
        checks.append(!notice.isEmpty && notice.contains("/tmp/r.json"))
        // A receipt records the digest, never the request text.
        let receipt = Receipt(executionID: "e", requestSHA256: String(repeating: "a", count: 64),
                              requestCharacters: 7, clipboardVerified: true, applicationOpened: false)
        let encoded = try JSONEncoder().encode(receipt)
        let decoded = try JSONDecoder().decode(Receipt.self, from: encoded)
        checks.append(decoded.surface == "chatgpt" && decoded.requestCharacters == 7)
        checks.append(!String(decoding: encoded, as: UTF8.self).contains("requestText"))
        // Every rail tile offers exactly its own two surfaces, executing one
        // first, and no surface belongs to two tiles.
        checks.append(ProviderSurface.Backend.openAI.surfaces == [.codex, .chatgpt])
        checks.append(ProviderSurface.Backend.anthropic.surfaces == [.claude, .claudeChat])
        checks.append(ProviderSurface.Backend.allCases.allSatisfy { $0.surfaces.first == $0.defaultSurface })
        checks.append(ProviderSurface.Backend.allCases.allSatisfy { tile in
            tile.surfaces.allSatisfy { $0.backend == tile } })
        checks.append(ProviderSurface.Backend.allCases.allSatisfy { $0.defaultSurface.isExecutor })
        checks.append(ProviderSurface.auto.backend == nil)
        checks.append(Set(ProviderSurface.Backend.openAI.surfaces).isDisjoint(with: Set(ProviderSurface.Backend.anthropic.surfaces)))
        checks.append(ProviderSurface.Backend.allCases.flatMap(\.surfaces).count + 1 == ProviderSurface.allCases.count)
        // A tile's raw value is the backend the gateway already accepts, so the
        // rail identity and the route preference cannot drift apart.
        checks.append(ProviderSurface.Backend.openAI.rawValue == ProviderSurface.codex.gatewayPreference)
        checks.append(ProviderSurface.Backend.anthropic.rawValue == ProviderSurface.claude.gatewayPreference)
        // A stored or hand-edited value that does not belong to the tile falls
        // back to that tile's executor; it never crosses to the other account.
        checks.append(ProviderSurface.Backend.openAI.resolve("chatgpt") == .chatgpt)
        checks.append(ProviderSurface.Backend.openAI.resolve("claude-chat") == .codex)
        checks.append(ProviderSurface.Backend.openAI.resolve(nil) == .codex)
        checks.append(ProviderSurface.Backend.openAI.resolve("nonsense") == .codex)
        checks.append(ProviderSurface.Backend.anthropic.resolve("claude-chat") == .claudeChat)
        checks.append(ProviderSurface.Backend.anthropic.resolve("codex") == .claude)
        checks.append(ProviderSurface.Backend.anthropic.resolve("auto") == .claude)
        // Only a non-default surface is badged, so an unchanged tile stays clean.
        checks.append(ProviderSurface.codex.railBadge == nil && ProviderSurface.claude.railBadge == nil)
        checks.append(ProviderSurface.chatgpt.railBadge != nil && ProviderSurface.claudeChat.railBadge != nil)
        checks.append(ProviderSurface.allCases.allSatisfy { !$0.choiceTitle.isEmpty })
        guard checks.allSatisfy({ $0 }) else { throw ProviderSurfaceError.regression }
        print("OS-1 provider surfaces: \(checks.count) checks OK")
    }
}
