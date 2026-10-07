import AppKit
import OS1Context
import SwiftUI

/// One account list for both places the owner reaches it: RCC Governance's
/// 로그인 tab and Settings › 계정. Laid out the way an account switcher is
/// expected to be — every account visible at once, the active one checked,
/// "계정 추가" at the end of each provider's list.
///
/// The runtime owns the account file and performs the provider's own browser
/// sign-in; this view only asks it to and shows what it reports. No credential
/// reaches the app.
@MainActor
final class BackendAccountsModel: ObservableObject {
    /// Posted after any change so other views (the rail) reload their copy.
    static let changed = Notification.Name("os1.backendAccountsChanged")

    @Published private(set) var book: BackendAccountBook
    /// Where the book comes from. The owner's accounts file by default; a
    /// preview passes an empty book so a render never reads owner state.
    private let load: () -> BackendAccountBook
    private let runner: @MainActor ([String], TimeInterval) async throws -> String
    @Published private(set) var setup: BackendSetupSnapshot?
    @Published private(set) var refreshing = false

    init(load: @escaping () -> BackendAccountBook = { BackendAccounts.load() },
         runner: @escaping @MainActor ([String], TimeInterval) async throws -> String = {
             try await BackendAccountRunner.run($0, timeout: $1)
         }) {
        self.load = load
        self.runner = runner
        book = load()
    }
    /// The provider whose sign-in is running, so its row can say so.
    @Published private(set) var busy: String?
    @Published var notice: String?

    func reload() { book = load() }

    /// Read-only: asks each provider's own status command who is signed in.
    func refresh() async {
        guard !refreshing, busy == nil else { return }
        refreshing = true
        defer { refreshing = false }
        do {
            let text = try await runner(["accounts", "discover", "--json"], 35)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let snapshot = try decoder.decode(BackendSetupSnapshot.self, from: Data(text.utf8))
            setup = snapshot
            book = snapshot.book
            notice = nil
        } catch {
            // A stale green row must never survive a failed current check.
            setup = nil
            notice = os1Tr("연결 상태를 확인하지 못했습니다. 기존 로그인은 변경하지 않았습니다. 다시 확인하세요.",
                           "Connection check failed. Existing sign-ins were not changed. Refresh to try again.")
        }
        NotificationCenter.default.post(name: Self.changed, object: nil)
    }

    func signIn(provider: String, accountID: String? = nil, newLabel: String? = nil) async {
        guard busy == nil, !refreshing else { return }
        if newLabel == nil, let found = setup?.providers.first(where: { $0.provider == provider }),
           accountID == nil || found.accountID == accountID {
            if found.state == .signedIn { return }
            guard found.state == .signedOut else { await refresh(); return }
        }
        var arguments = ["accounts", "login", "--provider", provider]
        if let accountID { arguments += ["--id", accountID] }
        if let newLabel { arguments += ["--new", "--label", newLabel] }
        await run(arguments, provider: provider, timeout: 420)
    }

    func use(provider: String, id: String) async {
        await run(["accounts", "use", "--provider", provider, "--id", id], provider: provider, timeout: 60)
    }

    func signOut(provider: String, id: String) async {
        await run(["accounts", "logout", "--provider", provider, "--id", id], provider: provider, timeout: 120)
    }

    func forget(provider: String, id: String) async {
        await run(["accounts", "forget", "--provider", provider, "--id", id], provider: provider, timeout: 120)
    }

    private func run(_ arguments: [String], provider: String, timeout: TimeInterval) async {
        guard busy == nil, !refreshing else { return }
        busy = provider
        notice = nil
        var failure: String?
        do {
            _ = try await runner(arguments, timeout)
        } catch {
            failure = error.localizedDescription
        }
        book = load()
        busy = nil
        await refresh()
        if let failure { notice = failure }
        NotificationCenter.default.post(name: Self.changed, object: nil)
    }

    func connection(_ provider: String) -> BackendSetupProvider? {
        setup?.providers.first { $0.provider == provider }
    }
}

enum BackendAccountRunnerError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let value) = self { return value }; return nil }
}

/// `os1 accounts …`. The runtime performs the sign-in; this only starts it and
/// reads what it printed.
enum BackendAccountRunner {
    static func executable() throws -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let bundled = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/os1").path
        for candidate in [bundled, home.appendingPathComponent(".local/bin/os1").path,
                          "/opt/homebrew/bin/os1", "/usr/local/bin/os1"]
        where FileManager.default.isExecutableFile(atPath: candidate) {
            return candidate
        }
        throw BackendAccountRunnerError.message(os1Tr("os1 실행 파일을 찾지 못했습니다.", "The os1 executable was not found."))
    }

    static func run(_ arguments: [String], timeout: TimeInterval) async throws -> String {
        let path = try executable()
        return try await Task.detached(priority: .userInitiated) {
            let process = Process(), output = Pipe(), errors = Pipe()
            process.executableURL = URL(fileURLWithPath: path)
            process.arguments = arguments
            process.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser
            process.standardOutput = output
            process.standardError = errors
            var environment = ProcessInfo.processInfo.environment
            let home = FileManager.default.homeDirectoryForCurrentUser.path
            environment["PATH"] = ["\(home)/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
                                   "/usr/sbin", "/sbin", environment["PATH"] ?? ""].joined(separator: ":")
            process.environment = environment
            // Read both pipes while the child runs: a sign-in prints progress
            // and would otherwise fill a pipe buffer and stall.
            let collected = BackendAccountOutput()
            output.fileHandleForReading.readabilityHandler = { collected.appendOut($0.availableData) }
            errors.fileHandleForReading.readabilityHandler = { collected.appendError($0.availableData) }
            try process.run()
            let deadline = Date().addingTimeInterval(timeout)
            while process.isRunning && Date() < deadline { try await Task.sleep(for: .milliseconds(200)) }
            if process.isRunning {
                process.terminate()
                throw BackendAccountRunnerError.message(os1Tr("로그인 확인 시간이 초과됐습니다. 브라우저에서 승인을 마쳤는지 확인하세요.",
                                                              "The sign-in was not confirmed in time. Check that you finished approving it in the browser."))
            }
            process.waitUntilExit()
            output.fileHandleForReading.readabilityHandler = nil
            errors.fileHandleForReading.readabilityHandler = nil
            collected.appendOut(output.fileHandleForReading.readDataToEndOfFile())
            collected.appendError(errors.fileHandleForReading.readDataToEndOfFile())
            let (stdout, stderr) = collected.contents()
            guard process.terminationStatus == 0 else {
                let text = String(decoding: stderr + stdout, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
                throw BackendAccountRunnerError.message(text.isEmpty
                    ? os1Tr("계정 작업을 확인하지 못했습니다.", "The account change could not be confirmed.")
                    : String(text.suffix(400)))
            }
            return String(decoding: stdout, as: UTF8.self)
        }.value
    }
}

/// Collects a child's two pipes from their reader threads.
final class BackendAccountOutput: @unchecked Sendable {
    private let lock = NSLock()
    private var out = Data(), error = Data()
    func appendOut(_ data: Data) { lock.lock(); out += data; lock.unlock() }
    func appendError(_ data: Data) { lock.lock(); error += data; lock.unlock() }
    func contents() -> (Data, Data) { lock.lock(); defer { lock.unlock() }; return (out, error) }
}

enum BackendAccountsStyle {
    static func title(_ provider: String) -> String { provider == "claude" ? "Claude Code" : "Codex" }
    static func organization(_ provider: String) -> String { provider == "claude" ? "Anthropic" : "OpenAI" }
    static func symbol(_ provider: String) -> String {
        provider == "claude" ? "sun.max.fill" : "chevron.left.forwardslash.chevron.right"
    }
    static func tint(_ provider: String) -> Color {
        provider == "claude" ? Color(red: 0.98, green: 0.53, blue: 0.68) : Color(red: 0.95, green: 0.64, blue: 0.80)
    }
    /// One letter for the account's circle, as an account switcher shows.
    static func initial(_ label: String) -> String {
        String(label.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1)).uppercased()
    }
}

struct BackendAccountsPanel: View {
    @ObservedObject var model: BackendAccountsModel
    /// Governance renders on a near-black panel; Settings on the system form.
    var dark = false
    /// The design-time preview has no runtime to ask, so it shows state only.
    var readOnly = false
    var providers: [String] = BackendAccounts.providers
    var onContinue: (() -> Void)? = nil
    @State private var addingProvider: String?
    @State private var newLabel = ""

    private var muted: Color { dark ? Color(white: 0.59) : Color.secondary }
    private var rowBackground: Color { dark ? Color.white.opacity(0.05) : Color.primary.opacity(0.045) }
    private var cardBackground: Color { dark ? Color.white.opacity(0.03) : Color.primary.opacity(0.025) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Text(os1Tr("에이전트 연결", "Connect your agents"))
                    .font(.system(size: 14, weight: .semibold))
                Spacer()
                if model.busy != nil || model.refreshing { ProgressView().controlSize(.small) }
                Button(os1Tr("새로 확인", "Refresh")) { Task { await model.refresh() } }
                    .disabled(readOnly || model.busy != nil || model.refreshing)
            }
            Text(os1Tr("이미 설치하고 로그인한 Codex·Claude Code를 자동으로 연결합니다. 둘 중 하나만 연결해도 시작할 수 있습니다. GitHub 연결은 로컬 사용에 필요하지 않습니다.",
                       "OS-1 detects installed Codex and Claude Code and reuses their existing sign-ins. Connect either one to start. GitHub is not required for local use."))
                .font(.system(size: 12)).foregroundStyle(muted).fixedSize(horizontal: false, vertical: true)
            ForEach(providers, id: \.self) { provider in
                providerCard(provider)
            }
            if let notice = model.notice {
                Text(notice).font(.system(size: 11)).foregroundStyle(Color.orange).textSelection(.enabled)
            }
            if let onContinue, providers.contains(where: { model.connection($0)?.state == .signedIn }) {
                Button(os1Tr("연결된 에이전트로 시작", "Continue with connected agent"), action: onContinue)
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("os1.setup.continue")
            }
            Text(os1Tr("로그인은 각 제공자의 공식 창에서 진행됩니다. OS-1은 계정 이름과 로그인 여부만 기록하고 토큰은 보지 않습니다. 계정마다 별도의 홈을 쓰므로 한 Mac에서 여러 계정을 번갈아 쓸 수 있습니다.",
                       "Each sign-in runs in that provider's own official flow. OS-1 records only the account name and whether it is signed in — never a token. Each account has its own home, so several accounts can share one Mac."))
                .font(.system(size: 10)).foregroundStyle(muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .task {
            guard !readOnly else { return }
            await model.refresh()
            // Detect a sign-in/install completed outside the panel without
            // opening OAuth or making inference calls. One probe at a time.
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(10)) } catch { return }
                guard !Task.isCancelled else { return }
                if providers.contains(where: { model.connection($0)?.state != .signedIn }) { await model.refresh() }
            }
        }
    }

    @ViewBuilder
    private func providerCard(_ provider: String) -> some View {
        let rows = BackendAccounts.accounts(provider: provider, in: model.book)
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: BackendAccountsStyle.symbol(provider))
                    .foregroundStyle(BackendAccountsStyle.tint(provider)).frame(width: 18)
                Text(BackendAccountsStyle.title(provider)).font(.system(size: 13, weight: .semibold))
                Text(BackendAccountsStyle.organization(provider)).font(.system(size: 11)).foregroundStyle(muted)
                Spacer()
            }
            .padding(.bottom, 2)
            connectionRow(provider)
            ForEach(rows) { row in accountRow(provider: provider, row: row) }
            addRow(provider)
        }
        .padding(12)
        .background(cardBackground, in: RoundedRectangle(cornerRadius: 12))
        .sheet(isPresented: Binding(get: { addingProvider == provider },
                                    set: { if !$0 { addingProvider = nil } })) {
            addSheet(provider)
        }
    }

    @ViewBuilder
    private func connectionRow(_ provider: String) -> some View {
        let connection = model.connection(provider)
        let state = connection?.state ?? .unverified
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Label(os1Tr("설치", "Installed"), systemImage: connection?.executablePath != nil ? "checkmark.circle.fill" : "circle")
                Label(state == .signedIn ? os1Tr("로그인 연결됨", "Sign-in connected") :
                        state == .signedOut ? os1Tr("로그인 필요", "Sign-in needed") :
                        state == .missing ? os1Tr("설치 필요", "Installation needed") : os1Tr("상태 미확인", "Status unconfirmed"),
                      systemImage: state == .signedIn ? "checkmark.circle.fill" : "circle")
                if let method = connection?.authMethod, method.contains("api") || method == "third_party" {
                    Text(os1Tr("API/외부 제공사 인증 · 해당 제공사의 청구 설정 사용", "API/external-provider authentication · provider billing applies"))
                        .foregroundStyle(Color.orange)
                }
            }.font(.system(size: 11)).foregroundStyle(state == .signedIn ? BackendAccountsStyle.tint(provider) : muted)
            Spacer()
            if model.busy == provider {
                Text(os1Tr("공식 로그인 승인 대기", "Waiting for official sign-in approval")).font(.system(size: 11))
            } else if state == .signedIn {
                Text(os1Tr("연결됨", "Connected")).font(.system(size: 11, weight: .semibold))
            } else if state == .missing {
                Button(os1Tr("설치 안내 열기", "Open installation guide")) {
                    if let text = connection?.installURL, let url = URL(string: text) { NSWorkspace.shared.open(url) }
                }.disabled(readOnly).controlSize(.small)
            } else if state == .signedOut {
                Button(os1Tr("\(BackendAccountsStyle.title(provider)) 연결", "Connect \(BackendAccountsStyle.title(provider))")) {
                    Task { await model.signIn(provider: provider, accountID: connection?.accountID) }
                }.disabled(readOnly || model.busy != nil || model.refreshing).controlSize(.small)
            } else {
                Button(os1Tr("다시 확인", "Check again")) { Task { await model.refresh() } }
                    .disabled(readOnly || model.busy != nil || model.refreshing).controlSize(.small)
            }
        }
        .padding(.vertical, 8)
        .accessibilityIdentifier("os1.setup.\(provider)")
    }

    @ViewBuilder
    private func accountRow(provider: String, row: BackendAccount) -> some View {
        let active = model.book.active[provider] == row.id
        HStack(spacing: 10) {
            ZStack {
                Circle().fill(BackendAccountsStyle.tint(provider).opacity(active ? 0.9 : 0.28))
                Text(BackendAccountsStyle.initial(row.label))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(active ? Color.black.opacity(0.8) : Color.primary.opacity(0.8))
            }
            .frame(width: 28, height: 28)
            VStack(alignment: .leading, spacing: 1) {
                Text(row.label).font(.system(size: 12, weight: active ? .semibold : .regular))
                Text(row.signedIn
                     ? (row.signedInAs.map { os1Tr("로그인됨 · \($0)", "Signed in · \($0)") } ?? os1Tr("로그인됨", "Signed in"))
                     : os1Tr("로그아웃 — 이 계정으로는 실행되지 않습니다", "Signed out — nothing runs on this account"))
                    .font(.system(size: 10))
                    .foregroundStyle(row.signedIn ? muted : Color.orange)
            }
            Spacer(minLength: 8)
            if active {
                Image(systemName: "checkmark").font(.system(size: 11, weight: .bold))
                    .foregroundStyle(BackendAccountsStyle.tint(provider))
                    .accessibilityLabel(os1Tr("사용 중", "In use"))
            }
            Button(row.signedIn ? os1Tr("연결됨", "Connected") : os1Tr("로그인", "Sign in")) {
                Task { await model.signIn(provider: provider, accountID: row.id) }
            }
            .controlSize(.small)
            .disabled(readOnly || row.signedIn || model.busy != nil || model.refreshing ||
                (active && model.connection(provider)?.state != .signedOut))
            if row.signedIn {
                Button(os1Tr("로그아웃", "Sign out")) { Task { await model.signOut(provider: provider, id: row.id) } }
                    .controlSize(.small).disabled(readOnly || model.busy != nil)
            }
            if !row.isDefault {
                Button(os1Tr("삭제", "Remove")) { Task { await model.forget(provider: provider, id: row.id) } }
                    .controlSize(.small).disabled(readOnly || model.busy != nil)
            }
        }
        .padding(.vertical, 6).padding(.horizontal, 10)
        .background(rowBackground, in: RoundedRectangle(cornerRadius: 10))
        .contentShape(RoundedRectangle(cornerRadius: 10))
        // The whole row switches account, the way an account list behaves.
        .onTapGesture {
            guard !readOnly, !active, model.busy == nil else { return }
            Task { await model.use(provider: provider, id: row.id) }
        }
        .help(active
              ? os1Tr("이 계정으로 실행됩니다", "Runs on this account")
              : os1Tr("눌러서 이 계정으로 전환", "Click to switch to this account"))
        .accessibilityElement(children: .combine)
        .accessibilityValue(active ? os1Tr("사용 중", "In use") : os1Tr("사용 안 함", "Not in use"))
    }

    @ViewBuilder
    private func addRow(_ provider: String) -> some View {
        Button {
            newLabel = ""
            addingProvider = provider
        } label: {
            HStack(spacing: 10) {
                ZStack {
                    Circle().strokeBorder(muted.opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                    Image(systemName: "plus").font(.system(size: 11, weight: .bold)).foregroundStyle(muted)
                }
                .frame(width: 28, height: 28)
                Text(os1Tr("계정 추가", "Add account")).font(.system(size: 12))
                Spacer()
            }
            .padding(.vertical, 6).padding(.horizontal, 10)
            .contentShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .disabled(readOnly || model.busy != nil)
    }

    @ViewBuilder
    private func addSheet(_ provider: String) -> some View {
        let title = BackendAccountsStyle.title(provider)
        VStack(alignment: .leading, spacing: 12) {
            Text(os1Tr("\(title) 계정 추가", "Add a \(title) account")).font(.headline)
            TextField(os1Tr("계정 이름 (예: 회사 계정)", "Account name (e.g. Work)"), text: $newLabel)
                .textFieldStyle(.roundedBorder)
            Text(os1Tr("이름은 이 Mac에서 계정을 구분하기 위한 것입니다. 다음 단계에서 \(title)의 공식 로그인 창이 열립니다.",
                       "The name only tells accounts apart on this Mac. The next step opens \(title)'s own sign-in."))
                .font(.footnote).foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button(os1Tr("취소", "Cancel")) { addingProvider = nil }.keyboardShortcut(.cancelAction)
                Button(os1Tr("로그인 열기", "Open sign-in")) {
                    let label = newLabel
                    addingProvider = nil
                    Task { await model.signIn(provider: provider, newLabel: label) }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(BackendAccounts.validLabel(newLabel) == nil)
            }
        }
        .padding(18).frame(width: 380)
    }
}

/// Uses fake status JSON only. No native auth, credentials, models, live
/// account store, or session store is opened by this UI regression.
@MainActor
func backendSetupSurfaceSelfTest() async throws {
    @MainActor final class Fixture {
        var calls: [[String]] = []
        var fail = false
        var state: BackendSetupState = .signedIn
        let book = BackendAccounts.normalized(BackendAccountBook())
        func run(_ args: [String], _ timeout: TimeInterval) async throws -> String {
            calls.append(args)
            try await Task.sleep(for: .milliseconds(30))
            if fail { throw BackendAccountRunnerError.message("fixture failure") }
            let now = Date(timeIntervalSince1970: 100)
            let snapshot = BackendSetupSnapshot(book: book, providers: [
                BackendSetupProvider(provider: "codex", executablePath: "/fixture/codex", state: state,
                                     checkedAt: now, accountID: "codex.default"),
                BackendSetupProvider(provider: "claude", executablePath: nil, state: .missing,
                                     checkedAt: now, accountID: "claude.default")
            ], checkedAt: now)
            let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
            return String(decoding: try encoder.encode(snapshot), as: UTF8.self)
        }
    }
    let fixture = Fixture()
    let model = BackendAccountsModel(load: { fixture.book }, runner: fixture.run)
    func check(_ value: Bool, _ name: String) throws {
        guard value else { throw BackendAccountRunnerError.message("Backend setup UI: " + name) }
    }
    async let first: Void = model.refresh()
    async let second: Void = model.refresh()
    _ = await (first, second)
    try check(fixture.calls.count == 1, "repeated refresh must be single-flight")
    try check(model.connection("codex")?.state == .signedIn && model.connection("claude")?.state == .missing,
              "one connected agent and one missing agent stay distinct")
    await model.signIn(provider: "codex", accountID: "codex.default")
    try check(fixture.calls.count == 1, "a connected account must not restart login")
    fixture.state = .unverified
    await model.refresh()
    await model.signIn(provider: "codex", accountID: "codex.default")
    try check(fixture.calls.allSatisfy { $0 == ["accounts", "discover", "--json"] },
              "unknown status may refresh but never trigger OAuth")
    fixture.fail = true
    await model.refresh()
    try check(model.setup == nil && model.notice != nil && model.book == fixture.book,
              "failed check clears stale connected badge but preserves account metadata")
    let view = BackendAccountsPanel(model: model, readOnly: true, onContinue: {})
    let rendered = NSHostingView(rootView: view)
    rendered.frame = NSRect(x: 0, y: 0, width: 580, height: 620)
    rendered.layoutSubtreeIfNeeded()
    try check(fixture.calls.allSatisfy { $0 == ["accounts", "discover", "--json"] },
              "preview must not start an install or sign-in")
    print("Backend setup UI: single-flight / native-login reuse / unknown-state / preview fixtures PASS; model calls 0")
}
