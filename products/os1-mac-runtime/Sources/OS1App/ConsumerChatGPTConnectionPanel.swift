import AppKit
import Foundation
import OS1Context
import SwiftUI

/// Owner-operated connection control, separate from provider accounts and the
/// tool-free local router. Neither creating this model nor rendering the view
/// starts a process, enables browser control, or reads authentication storage.
@MainActor
final class ConsumerChatGPTConnectionModel: ObservableObject {
    @Published private(set) var state = "approval_required"
    @Published private(set) var busy = false
    @Published private(set) var notice: String?

    var helperAvailable: Bool { ConsumerChatGPTConnectionControl.available }

    func connectAfterOwnerConfirmation() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try ConsumerChatGPTConnectionControl.connectAfterOwnerConfirmation()
            state = "approval_required"
            notice = os1Tr("연결을 요청했습니다. Chrome의 원격 디버깅 설정과 Allow 승인은 별도로 직접 완료한 뒤 새로 확인하세요.",
                           "Connection requested. Complete Chrome's separate Remote Debugging and Allow approval, then refresh.")
        } catch {
            state = "blocked"
            notice = os1Tr("이 설치본에서 ChatGPT 브라우저 연결을 시작하지 못했습니다. Chrome과 기존 로그인은 변경하지 않았습니다.",
                           "This installation could not start the ChatGPT browser connection. Chrome and existing sign-ins were not changed.")
        }
    }

    func refresh() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let result = try await ConsumerChatGPTConnectionControl.status()
            state = result.state
            notice = result.error
        } catch {
            state = "blocked"
            notice = os1Tr("연결 상태를 확인하지 못했습니다. 새 연결을 시작하거나 권한을 승인하지 않았습니다.",
                           "Connection status could not be verified. No new connection or approval was started.")
        }
    }

    func disconnect() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await ConsumerChatGPTConnectionControl.disconnect()
            state = "approval_required"
            notice = os1Tr("OS-1의 전용 연결만 해제했습니다. Chrome과 ChatGPT 로그인은 그대로입니다.",
                           "Only OS-1's dedicated connection was disconnected. Chrome and the ChatGPT sign-in remain unchanged.")
        } catch {
            state = "blocked"
            notice = os1Tr("전용 연결 해제를 확인하지 못했습니다. Chrome을 종료하거나 로그아웃하지 않았습니다.",
                           "Dedicated disconnection could not be confirmed. Chrome was not stopped or signed out.")
        }
    }
}

@MainActor
private enum ConsumerChatGPTConnectionControl {
    struct Status: Decodable, Sendable { let state: String; let error: String? }
    static let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/browser-transport")
    static let node = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/share/node-v24.20.0/bin/node")
    private static var ownedServer: Process?

    private static func helper() throws -> URL {
        let name = "consumer-chatgpt-driver.mjs"
        var candidates = [Bundle.main.bundleURL.appendingPathComponent("Contents/Resources").appendingPathComponent(name)]
        if let resources = Bundle.main.resourceURL { candidates.append(resources.appendingPathComponent(name)) }
        let executable = (Bundle.main.executableURL ?? URL(fileURLWithPath: CommandLine.arguments[0])).resolvingSymlinksInPath()
        let sourceRuntime = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        if executable.path.hasPrefix(sourceRuntime.appendingPathComponent(".build").path + "/"),
           FileManager.default.fileExists(atPath: sourceRuntime.appendingPathComponent("Package.swift").path) {
            candidates.append(sourceRuntime.appendingPathComponent("Resources").appendingPathComponent(name))
        }
        guard FileManager.default.isExecutableFile(atPath: node.path) else {
            throw BackendAccountRunnerError.message("Pinned Node 24.20.0 is unavailable")
        }
        for file in candidates {
            if let values = try? file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]),
               values.isRegularFile == true, values.isSymbolicLink != true, (values.fileSize ?? Int.max) <= 262_144 {
                return file
            }
        }
        throw BackendAccountRunnerError.message("ChatGPT browser helper is not packaged in this installation")
    }

    static var available: Bool { (try? helper()) != nil }

    private static func environment() -> [String: String] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return ["HOME": home, "PATH": node.deletingLastPathComponent().path + ":/usr/bin:/bin",
                "OS1_BROWSER_TRANSPORT_ROOT": root.path, "OS1_BROWSER_USER_HOME": home,
                "CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS": "1", "CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS": "1"]
    }

    /// This method has one production call site: the explicit confirmation
    /// button below. The helper, not a UI boolean, owns Chrome's permission
    /// handoff, actual attach state, and the persistent socket lease.
    static func connectAfterOwnerConfirmation() throws {
        if ownedServer?.isRunning == true { return }
        let driver = try helper()
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let process = Process()
        process.executableURL = node
        process.arguments = [driver.path, "--serve", "--owner-connect"]
        process.environment = environment()
        process.currentDirectoryURL = root
        process.standardInput = FileHandle.nullDevice
        // The helper owns private receipts. Do not present a Chrome/MCP log as
        // a user response or leak incidental session details into this panel.
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        ownedServer = process
    }

    static func status() async throws -> Status {
        try await run(arguments: [], input: ["action": "status", "prompt": "", "request_sha256": "", "policy_projection": ""])
    }

    static func disconnect() async throws -> Status {
        // Do not signal Chrome, kill processes by name, or revoke site login.
        // The helper's own disconnect protocol retires only its socket owner.
        let status = try await run(arguments: ["--disconnect"], input: nil)
        guard status.state == "approval_required" else {
            throw BackendAccountRunnerError.message("Dedicated disconnection was not acknowledged")
        }
        ownedServer = nil
        return status
    }

    private static func run(arguments: [String], input: [String: String]?) async throws -> Status {
        let driver = try helper(), executable = node, env = environment()
        let payload = try input.map { try JSONSerialization.data(withJSONObject: $0, options: [.sortedKeys]) }
        return try await Task.detached(priority: .userInitiated) {
            let process = Process(), output = Pipe(), errors = Pipe()
            process.executableURL = executable
            process.arguments = [driver.path] + arguments
            process.environment = env
            process.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser
            process.standardOutput = output; process.standardError = errors
            let collected = BackendAccountOutput()
            output.fileHandleForReading.readabilityHandler = { collected.appendOut($0.availableData) }
            errors.fileHandleForReading.readabilityHandler = { collected.appendError($0.availableData) }
            defer {
                output.fileHandleForReading.readabilityHandler = nil
                errors.fileHandleForReading.readabilityHandler = nil
            }
            let stdin = Pipe()
            if payload == nil { process.standardInput = FileHandle.nullDevice }
            else { process.standardInput = stdin }
            try process.run()
            if let payload {
                try stdin.fileHandleForWriting.write(contentsOf: payload)
                try stdin.fileHandleForWriting.close()
            }
            let deadline = Date().addingTimeInterval(10)
            while process.isRunning && Date() < deadline { try await Task.sleep(for: .milliseconds(100)) }
            guard !process.isRunning else {
                // This is the short status/disconnect client, never the server
                // or browser process. A timeout does not establish connection.
                process.terminate()
                throw BackendAccountRunnerError.message("Browser connection check timed out")
            }
            process.waitUntilExit()
            collected.appendOut(output.fileHandleForReading.readDataToEndOfFile())
            collected.appendError(errors.fileHandleForReading.readDataToEndOfFile())
            let (stdout, _) = collected.contents()
            guard process.terminationStatus == 0, stdout.count <= 65_536,
                  let status = try? JSONDecoder().decode(Status.self, from: stdout),
                  ["approval_required", "ready", "blocked"].contains(status.state) else {
                throw BackendAccountRunnerError.message("Browser connection state was not verified")
            }
            return status
        }.value
    }
}

struct ConsumerChatGPTConnectionPanel: View {
    var dark = false
    var readOnly = false
    @StateObject private var model = ConsumerChatGPTConnectionModel()
    @State private var confirmingConnection = false

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Image(systemName: "bubble.left.and.bubble.right").foregroundStyle(Color(red: 0.95, green: 0.64, blue: 0.80))
                Text("ChatGPT").font(.system(size: 13, weight: .semibold))
                Spacer()
                if model.busy { ProgressView().controlSize(.small) }
                Text(model.state == "ready" ? os1Tr("브라우저 연결 확인됨", "Browser connection verified")
                     : os1Tr("연결 확인 필요", "Connection needs verification"))
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
            Text(os1Tr("기존 Chrome의 일반 ChatGPT에 연결합니다. Codex 실행기나 별도 API 키 연결이 아닙니다. 브라우저 제어 승인은 사이트 로그인과 별개입니다.",
                       "Connect to ordinary ChatGPT in your existing Chrome session, not the Codex executor or an API-key route. Browser-control approval is separate from site sign-in."))
                .font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Button(os1Tr("ChatGPT 연결", "Connect ChatGPT")) { confirmingConnection = true }
                    .accessibilityIdentifier("os1.chatgpt.browser.connect")
                Button(os1Tr("새로 확인", "Refresh")) { Task { await model.refresh() } }
                    .accessibilityIdentifier("os1.chatgpt.browser.refresh")
                Button(os1Tr("연결 해제", "Disconnect")) { Task { await model.disconnect() } }
                    .accessibilityIdentifier("os1.chatgpt.browser.disconnect")
            }
            .disabled(readOnly || model.busy || !model.helperAvailable)
            if !model.helperAvailable {
                Text(os1Tr("이 설치본에 브라우저 연결 도우미가 없습니다. 설치된 helper가 있어야 연결할 수 있습니다.",
                           "This installation does not include the browser connection helper. Connection is unavailable until it is packaged."))
                    .font(.system(size: 10)).foregroundStyle(.orange)
            }
            if let notice = model.notice { Text(notice).font(.system(size: 10)).foregroundStyle(.orange) }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 9).fill(dark ? Color.white.opacity(0.03) : Color.primary.opacity(0.025)))
        .alert(os1Tr("기존 Chrome 연결을 승인할까요?", "Allow connection to existing Chrome?"),
               isPresented: $confirmingConnection) {
            Button(os1Tr("취소", "Cancel"), role: .cancel) {}
            Button(os1Tr("연결 요청", "Request connection")) {
                guard !readOnly, model.helperAvailable else { return }
                Task { await model.connectAfterOwnerConfirmation() }
            }
        } message: {
            Text(os1Tr("Chrome 원격 디버깅 권한은 현재 브라우저의 탭과 데이터에 접근할 수 있는 브라우저 수준 권한입니다. OS-1의 연결 도우미는 자신이 만든 ChatGPT 탭과 표시된 대화만 사용하도록 제한합니다. Chrome의 원격 디버깅 설정과 연결 Allow 승인은 별도로 직접 완료해야 합니다. 쿠키·비밀번호·로그인을 복사하지 않으며, 연결 해제는 OS-1의 도우미만 종료합니다.",
                       "Chrome Remote Debugging grants browser-level access to the current browser tabs and data. OS-1 restricts its helper to ChatGPT tabs it creates and their visible conversation data. You must separately complete Chrome's Remote Debugging setting and connection Allow approval. Cookies, passwords, and sign-ins are not copied; disconnecting stops only OS-1's helper."))
        }
        // Deliberately no .task/onAppear/autoconnect. Only owner actions may
        // launch the persistent helper or ask Chrome for browser-control access.
    }
}
