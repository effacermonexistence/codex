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

    @Published private(set) var book = BackendAccounts.load()
    /// The provider whose sign-in is running, so its row can say so.
    @Published private(set) var busy: String?
    @Published var notice: String?

    func reload() { book = BackendAccounts.load() }

    /// Read-only: asks each provider's own status command who is signed in.
    func refresh() async {
        _ = try? await BackendAccountRunner.run(["accounts", "list", "--json"], timeout: 90)
        book = BackendAccounts.load()
        NotificationCenter.default.post(name: Self.changed, object: nil)
    }

    func signIn(provider: String, accountID: String? = nil, newLabel: String? = nil) async {
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
        busy = provider
        notice = nil
        defer { busy = nil }
        do {
            _ = try await BackendAccountRunner.run(arguments, timeout: timeout)
        } catch {
            notice = error.localizedDescription
        }
        book = BackendAccounts.load()
        NotificationCenter.default.post(name: Self.changed, object: nil)
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
    @State private var addingProvider: String?
    @State private var newLabel = ""

    private var muted: Color { dark ? Color(white: 0.59) : Color.secondary }
    private var rowBackground: Color { dark ? Color.white.opacity(0.05) : Color.primary.opacity(0.045) }
    private var cardBackground: Color { dark ? Color.white.opacity(0.03) : Color.primary.opacity(0.025) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Text(os1Tr("계정 · 로그인 상태", "Accounts · sign-in state"))
                    .font(.system(size: 14, weight: .semibold))
                Spacer()
                if model.busy != nil { ProgressView().controlSize(.small) }
                Button(os1Tr("새로 확인", "Refresh")) { Task { await model.refresh() } }
                    .disabled(readOnly || model.busy != nil)
            }
            ForEach(providers, id: \.self) { provider in
                providerCard(provider)
            }
            if let notice = model.notice {
                Text(notice).font(.system(size: 11)).foregroundStyle(Color.orange).textSelection(.enabled)
            }
            Text(os1Tr("로그인은 각 제공자의 공식 창에서 진행됩니다. OS-1은 계정 이름과 로그인 여부만 기록하고 토큰은 보지 않습니다. 계정마다 별도의 홈을 쓰므로 한 Mac에서 여러 계정을 번갈아 쓸 수 있습니다.",
                       "Each sign-in runs in that provider's own official flow. OS-1 records only the account name and whether it is signed in — never a token. Each account has its own home, so several accounts can share one Mac."))
                .font(.system(size: 10)).foregroundStyle(muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .task { if !readOnly { await model.refresh() } }
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
            Button(row.signedIn ? os1Tr("다시 로그인", "Sign in again") : os1Tr("로그인", "Sign in")) {
                Task { await model.signIn(provider: provider, accountID: row.id) }
            }
            .controlSize(.small)
            .disabled(readOnly || model.busy != nil)
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
