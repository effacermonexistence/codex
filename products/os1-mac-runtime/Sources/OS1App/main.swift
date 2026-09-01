import AppKit
import Foundation
import SwiftUI

private enum ProviderChoice: String, CaseIterable, Codable, Identifiable, Sendable {
    case auto
    case codex
    case claude

    var id: String { rawValue }
    var title: String {
        switch self {
        case .auto: return "Auto"
        case .codex: return "Codex"
        case .claude: return "Claude"
        }
    }
    var subtitle: String {
        switch self {
        case .auto: return "RCC chooses"
        case .codex: return "Build & edit"
        case .claude: return "Analyze & review"
        }
    }
    var symbol: String {
        switch self {
        case .auto: return "sparkles"
        case .codex: return "chevron.left.forwardslash.chevron.right"
        case .claude: return "sun.max.fill"
        }
    }
    var tint: Color {
        switch self {
        case .auto: return Color(red: 0.38, green: 0.86, blue: 0.58)
        case .codex: return Color(red: 0.82, green: 0.51, blue: 0.94)
        case .claude: return Color(red: 0.93, green: 0.49, blue: 0.34)
        }
    }
}

private enum MessageRole: String, Codable, Sendable {
    case user
    case assistant
    case receipt
    case system
}

private struct ChatMessage: Codable, Identifiable, Sendable {
    let id: UUID
    let role: MessageRole
    let text: String
    let provider: String?
    let permissionProfile: String?
    let timestamp: Date

    init(
        id: UUID = UUID(),
        role: MessageRole,
        text: String,
        provider: String? = nil,
        permissionProfile: String? = nil,
        timestamp: Date = Date()
    ) {
        self.id = id
        self.role = role
        self.text = text
        self.provider = provider
        self.permissionProfile = permissionProfile
        self.timestamp = timestamp
    }
}

private struct ConversationSession: Codable, Identifiable, Sendable {
    let id: UUID
    var title: String
    var workspace: String
    var provider: ProviderChoice
    var messages: [ChatMessage]
    var codexSessionID: String?
    var claudeSessionID: String?
    var lastProvider: String?
    var codexCapacity: Int?
    var claudeCapacity: Int?
    var updatedAt: Date

    init(
        id: UUID = UUID(),
        title: String = "New session pair",
        workspace: String,
        provider: ProviderChoice = .auto,
        messages: [ChatMessage] = [],
        codexSessionID: String? = nil,
        claudeSessionID: String? = nil,
        lastProvider: String? = nil,
        codexCapacity: Int = 30,
        claudeCapacity: Int = 100,
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.title = title
        self.workspace = workspace
        self.provider = provider
        self.messages = messages
        self.codexSessionID = codexSessionID
        self.claudeSessionID = claudeSessionID
        self.lastProvider = lastProvider
        self.codexCapacity = codexCapacity
        self.claudeCapacity = claudeCapacity
        self.updatedAt = updatedAt
    }

    var effectiveCodexCapacity: Int { codexCapacity ?? 30 }
    var effectiveClaudeCapacity: Int { claudeCapacity ?? 100 }
}

private struct SessionEnvelope: Codable {
    let schema: Int
    let sessions: [ConversationSession]
}

private struct AppRunStep: Decodable, Sendable {
    let sequence: Int
    let provider: String
    let action: String
    let effort: String
    let sessionID: String
    let permissionProfile: String
    let exitCode: Int32
    let output: String
    let stderr: String
    let durationMS: Int64

    enum CodingKeys: String, CodingKey {
        case sequence, provider, action, effort, output, stderr
        case sessionID = "session_id"
        case permissionProfile = "permission_profile"
        case exitCode = "exit_code"
        case durationMS = "duration_ms"
    }
}

private struct AppRunSummary: Decodable, Sendable {
    let status: String
    let steps: [AppRunStep]
}

private enum RunnerError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self { case .message(let value): return value }
    }
}

private func backendTierLabel(action: String, provider: String) -> String {
    let engine = provider == "codex" ? "Codex" : "Claude"
    switch action {
    case "agent_run_efficient": return "Efficient \(engine) backend"
    case "agent_run_deep": return "Deep \(engine) backend"
    default: return "Standard \(engine) backend"
    }
}

private enum OS1Runner {
    static func run(
        workspace: String,
        prompt: String,
        provider: ProviderChoice,
        context: String,
        codexSessionID: String?,
        claudeSessionID: String?,
        codexCapacity: Int,
        claudeCapacity: Int
    ) async throws -> AppRunSummary {
        try await Task.detached(priority: .userInitiated) {
            try runBlocking(
                workspace: workspace,
                prompt: prompt,
                provider: provider,
                context: context,
                codexSessionID: codexSessionID,
                claudeSessionID: claudeSessionID,
                codexCapacity: codexCapacity,
                claudeCapacity: claudeCapacity
            )
        }.value
    }

    private static func executable() throws -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let bundled = Bundle.main.resourceURL?.appendingPathComponent("os1").path
        let candidates = [bundled].compactMap { $0 } + [
            "/usr/local/bin/os1",
            "/opt/homebrew/bin/os1",
            "\(home)/.local/bin/os1",
        ]
        guard let path = candidates.first(where: FileManager.default.isExecutableFile) else {
            throw RunnerError.message("OS-1 runtime is missing. Reinstall OS-1, then try again.")
        }
        return path
    }

    private static func runBlocking(
        workspace: String,
        prompt: String,
        provider: ProviderChoice,
        context: String,
        codexSessionID: String?,
        claudeSessionID: String?,
        codexCapacity: Int,
        claudeCapacity: Int
    ) throws -> AppRunSummary {
        let fileManager = FileManager.default
        let temporary = fileManager.temporaryDirectory
            .appendingPathComponent("os1-app-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(
            at: temporary,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        defer { try? fileManager.removeItem(at: temporary) }

        let stdoutURL = temporary.appendingPathComponent("stdout.json")
        let stderrURL = temporary.appendingPathComponent("stderr.txt")
        fileManager.createFile(atPath: stdoutURL.path, contents: nil)
        fileManager.createFile(atPath: stderrURL.path, contents: nil)
        let stdout = try FileHandle(forWritingTo: stdoutURL)
        let stderr = try FileHandle(forWritingTo: stderrURL)

        var arguments = [
            "run",
            "--workspace", workspace,
            "--prompt", prompt,
            "--provider", provider.rawValue,
            "--output-format", "json",
        ]
        if !context.isEmpty {
            let contextURL = temporary.appendingPathComponent("session-context.txt")
            try Data(context.utf8).write(
                to: contextURL,
                options: [.atomic, .completeFileProtectionUnlessOpen]
            )
            try fileManager.setAttributes(
                [.posixPermissions: 0o600],
                ofItemAtPath: contextURL.path
            )
            arguments += ["--context-file", contextURL.path]
        }
        if let codexSessionID { arguments += ["--codex-session-id", codexSessionID] }
        if let claudeSessionID { arguments += ["--claude-session-id", claudeSessionID] }
        arguments += [
            "--codex-capacity", String(codexCapacity),
            "--claude-capacity", String(claudeCapacity),
        ]

        let process = Process()
        process.executableURL = URL(fileURLWithPath: try executable())
        process.arguments = arguments
        process.standardOutput = stdout
        process.standardError = stderr
        var environment = ProcessInfo.processInfo.environment
        let home = fileManager.homeDirectoryForCurrentUser.path
        let preferredPath = [
            "\(home)/.local/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
            environment["PATH"] ?? "",
        ].joined(separator: ":")
        environment["PATH"] = preferredPath
        process.environment = environment

        do {
            try process.run()
            process.waitUntilExit()
            try stdout.close()
            try stderr.close()
        } catch {
            try? stdout.close()
            try? stderr.close()
            throw RunnerError.message("OS-1 could not start: \(error.localizedDescription)")
        }

        let outputData = try Data(contentsOf: stdoutURL)
        let errorText = String(decoding: try Data(contentsOf: stderrURL), as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard process.terminationStatus == 0 else {
            let fallback = String(decoding: outputData, as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            throw RunnerError.message(errorText.isEmpty ? fallback : errorText)
        }
        do {
            return try JSONDecoder().decode(AppRunSummary.self, from: outputData)
        } catch {
            throw RunnerError.message("OS-1 returned an unreadable result.")
        }
    }
}

@MainActor
private final class SessionStore: ObservableObject {
    @Published var sessions: [ConversationSession] = []
    @Published var selectedSessionID: UUID?
    @Published var composer = ""
    @Published var search = ""
    @Published var isRunning = false
    @Published var statusText = "Ready"
    @Published var alertMessage: String?

    private let fileManager = FileManager.default

    init() {
        load()
        if sessions.isEmpty {
            createSession(provider: .auto)
        } else {
            selectedSessionID = sessions.first?.id
        }
    }

    var selectedIndex: Int? {
        sessions.firstIndex(where: { $0.id == selectedSessionID })
    }

    var selectedSession: ConversationSession? {
        guard let index = selectedIndex else { return nil }
        return sessions[index]
    }

    var filteredSessions: [ConversationSession] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return sessions }
        return sessions.filter {
            $0.title.localizedCaseInsensitiveContains(query) ||
            $0.workspace.localizedCaseInsensitiveContains(query)
        }
    }

    func createSession(provider: ProviderChoice? = nil) {
        let inherited = provider ?? selectedSession?.provider ?? .auto
        let session = ConversationSession(
            workspace: fileManager.homeDirectoryForCurrentUser.path,
            provider: inherited
        )
        sessions.insert(session, at: 0)
        selectedSessionID = session.id
        composer = ""
        statusText = "Choose a workspace, then describe the task"
        save()
    }

    func select(_ id: UUID) {
        selectedSessionID = id
        composer = ""
        statusText = "Ready"
    }

    func chooseProvider(_ provider: ProviderChoice) {
        guard let index = selectedIndex else { return }
        let previous = sessions[index].provider
        guard previous != provider else { return }
        sessions[index].provider = provider
        sessions[index].updatedAt = Date()
        if !sessions[index].messages.isEmpty {
            sessions[index].messages.append(ChatMessage(
                role: .system,
                text: provider == .auto
                    ? "RCC will choose and continue the matching native Codex or Claude session."
                    : "Next turn will create or resume the linked native \(provider.title) session.",
                provider: provider.rawValue
            ))
        }
        statusText = provider == .auto
            ? "RCC will choose the next engine"
            : "Next turn: \(provider.title)"
        save()
    }

    func setCapacity(_ provider: ProviderChoice, value: Int) {
        guard let index = selectedIndex, [0, 10, 25, 50, 75, 100].contains(value) else { return }
        if provider == .codex { sessions[index].codexCapacity = value }
        if provider == .claude { sessions[index].claudeCapacity = value }
        if sessions[index].effectiveCodexCapacity + sessions[index].effectiveClaudeCapacity == 0 {
            if provider == .codex { sessions[index].claudeCapacity = 10 }
            if provider == .claude { sessions[index].codexCapacity = 10 }
        }
        sessions[index].provider = .auto
        sessions[index].updatedAt = Date()
        statusText = "RCC capacity mix updated"
        save()
    }

    func chooseWorkspace() {
        guard !isRunning, let index = selectedIndex else { return }
        let panel = NSOpenPanel()
        panel.title = "Choose the project folder OS-1 may work in"
        panel.prompt = "Use this folder"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.directoryURL = URL(fileURLWithPath: sessions[index].workspace, isDirectory: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let nextWorkspace = url.standardizedFileURL.path
        if sessions[index].workspace != nextWorkspace,
           sessions[index].codexSessionID != nil || sessions[index].claudeSessionID != nil {
            sessions[index].codexSessionID = nil
            sessions[index].claudeSessionID = nil
            sessions[index].lastProvider = nil
            sessions[index].messages.append(ChatMessage(
                role: .system,
                text: "Workspace changed. Native Codex and Claude links were reset so sessions cannot resume in the wrong project."
            ))
        }
        sessions[index].workspace = nextWorkspace
        sessions[index].updatedAt = Date()
        statusText = "Workspace connected"
        save()
    }

    func useSuggestion(_ value: String) {
        composer = value
    }

    func send() {
        let request = composer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !request.isEmpty, !isRunning, let index = selectedIndex else { return }
        var isDirectory: ObjCBool = false
        let workspace = sessions[index].workspace
        guard fileManager.fileExists(atPath: workspace, isDirectory: &isDirectory), isDirectory.boolValue else {
            alertMessage = "Choose an existing project folder before sending the task."
            return
        }

        let sessionID = sessions[index].id
        let provider = sessions[index].provider
        let codexSessionID = sessions[index].codexSessionID
        let claudeSessionID = sessions[index].claudeSessionID
        let context = handoffContext(for: sessions[index], nextProvider: provider)
        if sessions[index].messages.isEmpty {
            sessions[index].title = title(for: request)
        }
        sessions[index].messages.append(ChatMessage(role: .user, text: request))
        sessions[index].updatedAt = Date()
        composer = ""
        isRunning = true
        statusText = provider == .auto
            ? "RCC is choosing the best engine…"
            : "\(provider.title) is working…"
        save()

        Task {
            do {
                let summary = try await OS1Runner.run(
                    workspace: workspace,
                    prompt: request,
                    provider: provider,
                    context: context,
                    codexSessionID: codexSessionID,
                    claudeSessionID: claudeSessionID,
                    codexCapacity: sessions[index].effectiveCodexCapacity,
                    claudeCapacity: sessions[index].effectiveClaudeCapacity
                )
                guard let target = sessions.firstIndex(where: { $0.id == sessionID }) else { return }
                if summary.steps.isEmpty {
                    sessions[target].messages.append(ChatMessage(
                        role: .assistant,
                        text: "The governed route completed without an additional model step.",
                        provider: provider.rawValue
                    ))
                }
                for step in summary.steps {
                    if step.provider == "codex" {
                        sessions[target].codexSessionID = step.sessionID
                    } else if step.provider == "claude" {
                        sessions[target].claudeSessionID = step.sessionID
                    }
                    sessions[target].lastProvider = step.provider
                    let visibleOutput = step.output.trimmingCharacters(in: .whitespacesAndNewlines)
                    let visibleError = step.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
                    sessions[target].messages.append(ChatMessage(
                        role: .assistant,
                        text: visibleOutput.isEmpty
                            ? (visibleError.isEmpty ? "The engine finished without text output." : visibleError)
                            : visibleOutput,
                        provider: step.provider,
                        permissionProfile: step.permissionProfile
                    ))
                    sessions[target].messages.append(ChatMessage(
                        role: .receipt,
                        text: "\(backendTierLabel(action: step.action, provider: step.provider)) · \(step.effort) reasoning · native session linked · step \(step.sequence) · \(step.durationMS / 1_000)s · exit \(step.exitCode)",
                        provider: step.provider,
                        permissionProfile: step.permissionProfile
                    ))
                }
                sessions[target].updatedAt = Date()
                statusText = "Native session linked · evidence recorded"
            } catch {
                guard let target = sessions.firstIndex(where: { $0.id == sessionID }) else { return }
                sessions[target].messages.append(ChatMessage(
                    role: .system,
                    text: error.localizedDescription
                ))
                sessions[target].updatedAt = Date()
                statusText = "Needs attention"
            }
            isRunning = false
            save()
        }
    }

    private func title(for request: String) -> String {
        let firstLine = request.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? request
        return String(firstLine.prefix(48))
    }

    private func handoffContext(for session: ConversationSession, nextProvider: ProviderChoice) -> String {
        guard !session.messages.isEmpty else { return "" }
        if nextProvider != .auto, session.lastProvider == nextProvider.rawValue { return "" }
        let relevant = session.messages.filter { $0.role == .user || $0.role == .assistant }.suffix(16)
        let text = relevant.map { message in
            let speaker = message.role == .user
                ? "USER"
                : (message.provider?.uppercased() ?? "ASSISTANT")
            return "\(speaker):\n\(String(message.text.prefix(12_000)))"
        }.joined(separator: "\n\n")
        return String(text.suffix(180_000))
    }

    func openCodexSession() {
        guard let value = selectedSession?.codexSessionID,
              UUID(uuidString: value) != nil,
              let url = URL(string: "codex://threads/\(value)") else {
            alertMessage = "Run one Codex turn first. Its native Codex task will be linked here."
            return
        }
        guard NSWorkspace.shared.open(url) else {
            alertMessage = "Codex could not open this native task."
            return
        }
        statusText = "Opened native Codex task"
    }

    func openClaudeSession() {
        guard let session = selectedSession,
              let value = session.claudeSessionID,
              UUID(uuidString: value) != nil else {
            alertMessage = "Run one Claude turn first. Its native Claude Code session will be linked here."
            return
        }
        let home = fileManager.homeDirectoryForCurrentUser.path
        let candidates = [
            "\(home)/.local/bin/claude",
            "/opt/homebrew/bin/claude",
            "/usr/local/bin/claude",
        ]
        guard let claude = candidates.first(where: fileManager.isExecutableFile) else {
            alertMessage = "Claude Code is not installed or signed in on this Mac."
            return
        }
        let command = "cd \(shellQuote(session.workspace)) && exec \(shellQuote(claude)) --resume \(shellQuote(value))"
        let escaped = command
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let arguments = [
            "-e", "tell application \"Terminal\" to activate",
            "-e", "tell application \"Terminal\" to do script \"\(escaped)\"",
        ]
        statusText = "Opening native Claude Code session…"
        Task {
            let failure = await Task.detached(priority: .userInitiated) { () -> String? in
                let process = Process()
                let stderr = Pipe()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
                process.arguments = arguments
                process.standardError = stderr
                do {
                    try process.run()
                    process.waitUntilExit()
                    guard process.terminationStatus == 0 else {
                        let detail = String(
                            decoding: stderr.fileHandleForReading.readDataToEndOfFile(),
                            as: UTF8.self
                        ).trimmingCharacters(in: .whitespacesAndNewlines)
                        return detail.isEmpty ? "Terminal rejected the session request." : detail
                    }
                    return nil
                } catch {
                    return error.localizedDescription
                }
            }.value
            if let failure {
                alertMessage = "Claude Code session could not open: \(failure)"
                statusText = "Needs attention"
            } else {
                statusText = "Opened native Claude Code session"
            }
        }
    }

    private func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    private var storageURL: URL {
        fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1", isDirectory: true)
            .appendingPathComponent("sessions.json", isDirectory: false)
    }

    private func load() {
        guard let data = try? Data(contentsOf: storageURL),
              let envelope = try? JSONDecoder().decode(SessionEnvelope.self, from: data),
              [1, 2, 3].contains(envelope.schema) else { return }
        let cutoff = Date().addingTimeInterval(-30 * 24 * 60 * 60)
        sessions = envelope.sessions
            .filter { $0.updatedAt >= cutoff }
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(30)
            .map { session in
                var bounded = session
                bounded.messages = Array(session.messages.suffix(40))
                return bounded
            }
    }

    private func save() {
        let directory = storageURL.deletingLastPathComponent()
        do {
            try fileManager.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            let bounded = sessions.sorted { $0.updatedAt > $1.updatedAt }.prefix(30).map { session in
                var copy = session
                copy.messages = Array(session.messages.suffix(40)).map { message in
                    ChatMessage(
                        id: message.id,
                        role: message.role,
                        text: String(message.text.prefix(120_000)),
                        provider: message.provider,
                        permissionProfile: message.permissionProfile,
                        timestamp: message.timestamp
                    )
                }
                return copy
            }
            let data = try JSONEncoder().encode(SessionEnvelope(schema: 3, sessions: bounded))
            try data.write(to: storageURL, options: [.atomic, .completeFileProtectionUnlessOpen])
            try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: storageURL.path)
        } catch {
            alertMessage = "Session history could not be saved: \(error.localizedDescription)"
        }
    }
}

private enum Theme {
    static let background = Color(red: 0.035, green: 0.035, blue: 0.045)
    static let panel = Color(red: 0.055, green: 0.055, blue: 0.068)
    static let panelRaised = Color(red: 0.075, green: 0.075, blue: 0.092)
    static let border = Color.white.opacity(0.09)
    static let muted = Color.white.opacity(0.48)
    static let text = Color.white.opacity(0.93)
    static let green = Color(red: 0.35, green: 0.92, blue: 0.55)
}

@main
private struct OS1DesktopApp: App {
    @StateObject private var store = SessionStore()

    var body: some Scene {
        WindowGroup("OS-1 Claudex") {
            RootView(store: store)
                .preferredColorScheme(.dark)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1240, height: 780)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New session pair") { store.createSession() }
                    .keyboardShortcut("n", modifiers: [.command])
            }
        }
    }
}

private struct RootView: View {
    @ObservedObject var store: SessionStore

    var body: some View {
        HStack(spacing: 0) {
            ProviderRail(store: store)
            Divider().overlay(Theme.border)
            SessionSidebar(store: store)
            Divider().overlay(Theme.border)
            ConversationView(store: store)
        }
        .frame(minWidth: 1_040, minHeight: 680)
        .background(Theme.background)
        .alert("OS-1 Claudex", isPresented: Binding(
            get: { store.alertMessage != nil },
            set: { if !$0 { store.alertMessage = nil } }
        )) {
            Button("OK", role: .cancel) { store.alertMessage = nil }
        } message: {
            Text(store.alertMessage ?? "")
        }
    }
}

private struct ProviderRail: View {
    @ObservedObject var store: SessionStore

    var body: some View {
        VStack(spacing: 18) {
            ZStack {
                Circle()
                    .fill(AngularGradient(
                        colors: [.pink, .purple, .orange, .pink],
                        center: .center
                    ))
                Circle().fill(Theme.background).padding(7)
                Circle().fill(Color.white.opacity(0.9)).frame(width: 7, height: 7)
            }
            .frame(width: 38, height: 38)
            .padding(.bottom, 5)

            ForEach([ProviderChoice.codex, ProviderChoice.claude]) { provider in
                BackendStatus(
                    provider: provider,
                    active: store.selectedSession?.lastProvider == provider.rawValue
                )
            }

            Spacer()

            RailButton(
                provider: .auto,
                selected: store.selectedSession?.provider == .auto,
                disabled: store.isRunning
            ) { store.chooseProvider(.auto) }

            VStack(spacing: 5) {
                Circle().fill(Theme.green).frame(width: 7, height: 7)
                    .shadow(color: Theme.green.opacity(0.7), radius: 5)
                Text("RCC")
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .foregroundStyle(Theme.muted)
            }
        }
        .padding(.vertical, 18)
        .frame(width: 82)
        .background(Color.black.opacity(0.2))
    }
}

private struct BackendStatus: View {
    let provider: ProviderChoice
    let active: Bool

    var body: some View {
        VStack(spacing: 7) {
            Image(systemName: provider.symbol).font(.system(size: 17, weight: .semibold))
            Text("BACKEND").font(.system(size: 7, weight: .bold, design: .rounded))
        }
        .foregroundStyle(active ? provider.tint : Theme.muted)
        .frame(width: 58, height: 58)
        .background(active ? provider.tint.opacity(0.12) : Color.clear)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(active ? provider.tint : Theme.border))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .help("Managed (provider.title) backend")
    }
}

private struct RailButton: View {
    let provider: ProviderChoice
    let selected: Bool
    let disabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 7) {
                Image(systemName: provider.symbol)
                    .font(.system(size: 17, weight: .semibold))
                Text(provider.title.uppercased())
                    .font(.system(size: 8, weight: .bold, design: .rounded))
            }
            .foregroundStyle(selected ? provider.tint : Theme.muted)
            .frame(width: 58, height: 58)
            .background(selected ? provider.tint.opacity(0.12) : Color.clear)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(selected ? provider.tint : Theme.border, lineWidth: selected ? 1.5 : 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .help("Use \(provider.title) for the next turn")
    }
}

private struct SessionSidebar: View {
    @ObservedObject var store: SessionStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("OS-1")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .tracking(2.4)
                    .foregroundStyle(Theme.muted)
                Text("CLAUDEX")
                    .font(.system(size: 19, weight: .bold, design: .rounded))
                    .tracking(1.6)
                    .foregroundStyle(Theme.text)
            }
            .padding(.horizontal, 18)
            .padding(.top, 23)
            .padding(.bottom, 18)

            Button { store.createSession() } label: {
                Label("New session pair", systemImage: "square.and.pencil")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 14)
                    .frame(height: 44)
                    .background(Theme.panelRaised)
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(Theme.border))
                    .clipShape(RoundedRectangle(cornerRadius: 9))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 14)

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted)
                TextField("Search sessions", text: $store.search)
                    .textFieldStyle(.plain)
            }
            .padding(.horizontal, 12)
            .frame(height: 38)
            .background(Color.black.opacity(0.16))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.border))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .padding(.horizontal, 14)
            .padding(.top, 10)

            HStack {
                Text("SESSION PAIRS")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .tracking(1.2)
                    .foregroundStyle(Theme.muted)
                Spacer()
                Text("\(store.filteredSessions.count)")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 18)
            .padding(.top, 20)
            .padding(.bottom, 8)

            ScrollView {
                LazyVStack(spacing: 4) {
                    ForEach(store.filteredSessions) { session in
                        SessionRow(
                            session: session,
                            selected: store.selectedSessionID == session.id
                        ) { store.select(session.id) }
                    }
                }
                .padding(.horizontal, 8)
            }

            Spacer(minLength: 0)

            HStack(spacing: 8) {
                Circle().fill(Theme.green).frame(width: 7, height: 7)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Governance active")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Theme.text)
                    Text("Real native sessions")
                        .font(.system(size: 10))
                        .foregroundStyle(Theme.muted)
                }
            }
            .padding(16)
        }
        .frame(width: 270)
        .background(Theme.panel)
    }
}

private struct SessionRow: View {
    let session: ConversationSession
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 7) {
                    Circle().fill(session.provider.tint).frame(width: 6, height: 6)
                    Text(session.title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                HStack(spacing: 6) {
                    Text(URL(fileURLWithPath: session.workspace).lastPathComponent)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    NativeBadge(label: "C", linked: session.codexSessionID != nil, tint: ProviderChoice.codex.tint)
                    NativeBadge(label: "A", linked: session.claudeSessionID != nil, tint: ProviderChoice.claude.tint)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? Color.white.opacity(0.07) : Color.clear)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(selected ? Theme.border : Color.clear)
            )
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
}

private struct NativeBadge: View {
    let label: String
    let linked: Bool
    let tint: Color

    var body: some View {
        Text(label)
            .font(.system(size: 8, weight: .bold, design: .rounded))
            .foregroundStyle(linked ? tint : Theme.muted.opacity(0.55))
            .frame(width: 17, height: 15)
            .background(linked ? tint.opacity(0.13) : Color.white.opacity(0.025))
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(linked ? tint.opacity(0.45) : Theme.border))
            .clipShape(RoundedRectangle(cornerRadius: 4))
    }
}

private struct ConversationView: View {
    @ObservedObject var store: SessionStore

    var body: some View {
        VStack(spacing: 0) {
            ConversationHeader(store: store)
            Divider().overlay(Theme.border)
            if let session = store.selectedSession {
                if session.messages.isEmpty {
                    WelcomeView(store: store, session: session)
                } else {
                    MessageTimeline(session: session, isRunning: store.isRunning)
                }
                ComposerView(store: store, session: session)
            }
        }
        .background(Theme.background)
    }
}

private struct ConversationHeader: View {
    @ObservedObject var store: SessionStore

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(store.selectedSession?.title ?? "OS-1 Claudex")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Circle().fill(Theme.green).frame(width: 6, height: 6)
                    Text(store.statusText)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
            }
            Spacer()

            if let session = store.selectedSession {
                Menu {
                    Button("Auto routing") { store.chooseProvider(.auto) }
                    Divider()
                    Menu("Codex capacity · \(session.effectiveCodexCapacity)%") {
                        ForEach([0, 10, 25, 50, 75, 100], id: \.self) { value in
                            Button("\(value)%") { store.setCapacity(.codex, value: value) }
                        }
                    }
                    Menu("Claude capacity · \(session.effectiveClaudeCapacity)%") {
                        ForEach([0, 10, 25, 50, 75, 100], id: \.self) { value in
                            Button("\(value)%") { store.setCapacity(.claude, value: value) }
                        }
                    }
                    Divider()
                    Button("Force Codex next turn") { store.chooseProvider(.codex) }
                    Button("Force Claude next turn") { store.chooseProvider(.claude) }
                    Divider()
                    Button("Inspect Codex backend") { store.openCodexSession() }
                        .disabled(session.codexSessionID == nil)
                    Button("Inspect Claude backend") { store.openClaudeSession() }
                        .disabled(session.claudeSessionID == nil)
                } label: {
                    Label(
                        session.provider == .auto
                            ? "Auto mix · C\(session.effectiveCodexCapacity) A\(session.effectiveClaudeCapacity)"
                            : "Override · \(session.provider.title)",
                        systemImage: "slider.horizontal.3"
                    )
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.green)
                    .padding(.horizontal, 10)
                    .frame(height: 35)
                    .background(Theme.green.opacity(0.08))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.green.opacity(0.3)))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .disabled(store.isRunning)

                Button { store.chooseWorkspace() } label: {
                    HStack(spacing: 7) {
                        Image(systemName: "folder")
                        Text(URL(fileURLWithPath: session.workspace).lastPathComponent)
                            .lineLimit(1)
                    }
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .padding(.horizontal, 11)
                    .frame(height: 35)
                    .background(Theme.panelRaised)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.border))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .disabled(store.isRunning)
                .help(session.workspace)
            }
        }
        .padding(.horizontal, 18)
        .frame(height: 64)
        .background(Theme.panel.opacity(0.8))
    }
}

private struct WelcomeView: View {
    @ObservedObject var store: SessionStore
    let session: ConversationSession

    private let suggestions = [
        "Inspect this project and explain the safest next step.",
        "Find the current bug, fix it, and verify the result.",
        "Review the repository and make the smallest production-ready improvement.",
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Spacer(minLength: 34)
                Text("What are we building?")
                    .font(.system(size: 34, weight: .semibold, design: .rounded))
                    .foregroundStyle(Theme.text)
                Text("Pick a project once. OS-1 treats Codex and Claude Code as managed backends, then selects the backend, model tier, and reasoning effort from task fit and weekly capacity.")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.white.opacity(0.62))
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 12) {
                    WelcomeStep(number: "1", title: "Choose folder", detail: "The project OS-1 may inspect or edit")
                    WelcomeStep(number: "2", title: "Set capacity", detail: "Default mix conserves scarce Codex usage")
                    WelcomeStep(number: "3", title: "Use OS-1", detail: "RCC selects backend, model, and effort")
                }

                VStack(alignment: .leading, spacing: 9) {
                    Text("TRY ONE")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .tracking(1.4)
                        .foregroundStyle(Theme.muted)
                    ForEach(suggestions, id: \.self) { suggestion in
                        Button { store.useSuggestion(suggestion) } label: {
                            HStack {
                                Text(suggestion)
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.text)
                                Spacer()
                                Image(systemName: "arrow.up.left")
                                    .font(.system(size: 10))
                                    .foregroundStyle(Theme.muted)
                            }
                            .padding(.horizontal, 14)
                            .frame(height: 42)
                            .background(Theme.panelRaised)
                            .overlay(RoundedRectangle(cornerRadius: 9).stroke(Theme.border))
                            .clipShape(RoundedRectangle(cornerRadius: 9))
                        }
                        .buttonStyle(.plain)
                    }
                }
                Spacer(minLength: 20)
            }
            .padding(.horizontal, 52)
            .frame(maxWidth: 850, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
    }
}

private struct WelcomeStep: View {
    let number: String
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(number)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(Theme.green)
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.text)
            Text(detail)
                .font(.system(size: 11))
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 108, alignment: .topLeading)
        .background(Theme.panel)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

private struct MessageTimeline: View {
    let session: ConversationSession
    let isRunning: Bool

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 16) {
                    ForEach(session.messages) { message in
                        MessageView(message: message).id(message.id)
                    }
                    if isRunning {
                        HStack(spacing: 10) {
                            ProgressView().controlSize(.small)
                            Text("Working in \(session.workspace)…")
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.muted)
                            Spacer()
                        }
                        .padding(.vertical, 12)
                        .id("running")
                    }
                }
                .padding(.horizontal, 34)
                .padding(.vertical, 28)
                .frame(maxWidth: 900)
                .frame(maxWidth: .infinity)
            }
            .onAppear {
                if let last = session.messages.last { proxy.scrollTo(last.id, anchor: .bottom) }
            }
            .onChange(of: session.messages.count) { _ in
                if let last = session.messages.last {
                    withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }
}

private struct MessageView: View {
    let message: ChatMessage

    var body: some View {
        switch message.role {
        case .user:
            HStack {
                Spacer(minLength: 100)
                Text(message.text)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.text)
                    .textSelection(.enabled)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 12)
                    .background(Color.white.opacity(0.09))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        case .assistant:
            VStack(alignment: .leading, spacing: 9) {
                HStack(spacing: 7) {
                    Image(systemName: message.provider == "claude"
                        ? ProviderChoice.claude.symbol
                        : ProviderChoice.codex.symbol)
                    Text((message.provider ?? "OS-1").uppercased())
                    if let permission = message.permissionProfile {
                        Text("· \(permission.replacingOccurrences(of: "_", with: " "))")
                            .foregroundStyle(Theme.muted)
                    }
                }
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(message.provider == "claude"
                    ? ProviderChoice.claude.tint
                    : ProviderChoice.codex.tint)
                Text(message.text)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.text)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .receipt:
            HStack(spacing: 9) {
                Image(systemName: "checkmark.shield.fill").foregroundStyle(Theme.green)
                Text("RCC GOVERNANCE RECEIPT")
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .tracking(1.1)
                Text(message.text)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(Theme.muted)
                Spacer()
                Text("VERIFIED")
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .foregroundStyle(Theme.green)
            }
            .padding(.horizontal, 12)
            .frame(height: 39)
            .background(Theme.panel)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.border))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        case .system:
            HStack(spacing: 8) {
                Image(systemName: "info.circle")
                Text(message.text)
                    .font(.system(size: 11))
                    .fixedSize(horizontal: false, vertical: true)
                Spacer()
            }
            .foregroundStyle(Theme.muted)
            .padding(.vertical, 4)
        }
    }
}

private struct ComposerView: View {
    @ObservedObject var store: SessionStore
    let session: ConversationSession
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 8) {
            HStack(alignment: .bottom, spacing: 12) {
                TextEditor(text: $store.composer)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.text)
                    .scrollContentBackground(.hidden)
                    .focused($focused)
                    .frame(minHeight: 54, maxHeight: 120)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .disabled(store.isRunning)
                    .overlay(alignment: .topLeading) {
                        if store.composer.isEmpty {
                            Text("Tell OS-1 what outcome you want…")
                                .font(.system(size: 13))
                                .foregroundStyle(Color.white.opacity(0.3))
                                .padding(.horizontal, 13)
                                .padding(.vertical, 14)
                                .allowsHitTesting(false)
                        }
                    }

                Button { store.send() } label: {
                    Image(systemName: store.isRunning ? "hourglass" : "arrow.up")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color.black.opacity(0.86))
                        .frame(width: 38, height: 38)
                        .background(session.provider.tint)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .disabled(store.isRunning || store.composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .keyboardShortcut(.return, modifiers: [.command])
            }
            .padding(10)
            .background(Theme.panelRaised)
            .overlay(RoundedRectangle(cornerRadius: 13).stroke(Theme.border))
            .clipShape(RoundedRectangle(cornerRadius: 13))

            HStack {
                Label(URL(fileURLWithPath: session.workspace).lastPathComponent, systemImage: "folder")
                Text("·")
                Text("OS-1 · RCC governed")
                Text("·")
                Text("capacity C\(session.effectiveCodexCapacity) / A\(session.effectiveClaudeCapacity)")
                Text("·")
                Text("Codex \(session.codexSessionID == nil ? "not linked" : "linked")")
                Text("·")
                Text("Claude \(session.claudeSessionID == nil ? "not linked" : "linked")")
                Spacer()
                Text("⌘↩ send")
            }
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 24)
        .padding(.top, 10)
        .padding(.bottom, 16)
        .background(Theme.background)
    }
}
