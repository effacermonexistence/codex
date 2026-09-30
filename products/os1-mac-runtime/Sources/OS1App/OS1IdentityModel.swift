import AppKit
@preconcurrency import AuthenticationServices
import CryptoKit
import OS1Context
import Security
import SwiftUI

struct OS1IdentityCredential: Codable, Equatable {
    var profile: AppIdentityProfile
    var googleClientID: String?
    var accessToken: String?
    var refreshToken: String?
    var expiresAt: Date?
}

@MainActor
protocol OS1IdentityStorage {
    func read() throws -> OS1IdentityCredential?
    func write(_ credential: OS1IdentityCredential) throws
    func remove() throws
}

/// Only OS-1's own identity item. No provider CLI credential is read, copied,
/// changed, or signed out. Keychain sync is explicitly disabled.
@MainActor
struct OS1IdentityKeychain: OS1IdentityStorage {
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.omaragi.os1.identity",
         kSecAttrAccount as String: "primary",
         kSecAttrSynchronizable as String: false]
    }
    func read() throws -> OS1IdentityCredential? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw AppIdentityError.storage }
        return try JSONDecoder().decode(OS1IdentityCredential.self, from: data)
    }
    func write(_ credential: OS1IdentityCredential) throws {
        let data = try JSONEncoder().encode(credential)
        let update = [kSecValueData as String: data]
        var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(add as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw AppIdentityError.storage }
    }
    func remove() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw AppIdentityError.storage }
    }
}

struct OS1IdentityConfiguration {
    var google: GoogleIdentityConfiguration?
    var appleEnabled: Bool
    static func load(bundle: Bundle = .main) -> Self {
        let schemes = (bundle.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]] ?? [])
            .flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }
        return Self(google: try? GoogleIdentityConfiguration(
            clientID: bundle.object(forInfoDictionaryKey: "GIDClientID") as? String ?? "", registeredSchemes: schemes),
                    appleEnabled: bundle.object(forInfoDictionaryKey: "OS1AppleSignInEnabled") as? Bool == true)
    }
    func available(_ provider: AppIdentityProvider) -> Bool { provider == .google ? google != nil : appleEnabled }
}

@MainActor
protocol OS1IdentityAuthenticating: AnyObject {
    func signIn(_ provider: AppIdentityProvider) async throws -> OS1IdentityCredential
    func restore(_ credential: OS1IdentityCredential) async throws -> OS1IdentityCredential
    func cancel()
}

@MainActor
final class OS1IdentityModel: ObservableObject {
    @Published private(set) var profile: AppIdentityProfile?
    @Published private(set) var busy = false
    @Published private(set) var notice: String?
    let configuration: OS1IdentityConfiguration
    private let storage: any OS1IdentityStorage
    private let authenticator: any OS1IdentityAuthenticating
    private var generation = UUID()
    private var operation: Task<Void, Never>?
    private var restored = false

    init(configuration: OS1IdentityConfiguration = .load(),
         storage: any OS1IdentityStorage = OS1IdentityKeychain(),
         authenticator: (any OS1IdentityAuthenticating)? = nil,
         previewProfile: AppIdentityProfile? = nil) {
        self.configuration = configuration; self.storage = storage
        self.authenticator = authenticator ?? OS1NativeIdentityAuthenticator(configuration: configuration)
        self.profile = previewProfile
    }

    func beginSignIn(_ provider: AppIdentityProvider) {
        guard !busy else { return }
        operation = Task { await signIn(provider) }
    }

    func signIn(_ provider: AppIdentityProvider) async {
        guard !busy else { return }
        guard configuration.available(provider) else {
            notice = setupMessage(provider); return
        }
        busy = true; notice = nil
        let id = UUID(); generation = id
        defer { if generation == id { busy = false } }
        do {
            var credential = try await authenticator.signIn(provider)
            guard generation == id, !Task.isCancelled else { return }
            guard credential.profile.provider == provider, !credential.profile.subject.isEmpty else {
                throw AppIdentityError.invalidResponse
            }
            // Apple only supplies name/email on the first consent. Preserve
            // them only for this exact issuer + subject, never by email match.
            if provider == .apple, let saved = try storage.read(),
               saved.profile.provider == .apple, saved.profile.subject == credential.profile.subject {
                if credential.profile.name.isEmpty { credential.profile.name = saved.profile.name }
                if credential.profile.email == nil { credential.profile.email = saved.profile.email }
            }
            try storage.write(credential)
            profile = credential.profile
        } catch {
            if generation == id { notice = Self.message(error) }
        }
    }

    /// Cached identity alone never renders as a verified login. Revalidate with
    /// the provider; a network failure preserves storage but not signed-in UI.
    func restoreIfNeeded(force: Bool = false) async {
        guard !busy, !restored || force else { return }
        restored = true; busy = true
        let id = UUID(); generation = id
        defer { if generation == id { busy = false } }
        do {
            guard let saved = try storage.read() else { profile = nil; notice = nil; return }
            profile = nil
            guard configuration.available(saved.profile.provider) else {
                notice = setupMessage(saved.profile.provider); return
            }
            let checked = try await authenticator.restore(saved)
            guard generation == id, !Task.isCancelled else { return }
            guard checked.profile.subject == saved.profile.subject,
                  checked.profile.provider == saved.profile.provider else { throw AppIdentityError.invalidResponse }
            try storage.write(checked)
            profile = checked.profile; notice = nil
        } catch {
            if generation == id {
                profile = nil
                if error as? AppIdentityError == .expired { try? storage.remove() }
                notice = Self.message(error)
            }
        }
    }

    func cancel() {
        generation = UUID(); operation?.cancel(); operation = nil
        authenticator.cancel(); busy = false
        notice = os1Tr("로그인을 취소했습니다.", "Sign-in cancelled.")
    }

    func signOut() {
        cancel()
        do {
            try storage.remove(); profile = nil
            notice = os1Tr("OS-1에서 로그아웃했습니다. 이 Mac의 대화·큐·백엔드 연결은 유지됩니다.",
                           "Signed out of OS-1. This Mac's conversations, queues and backend connections are unchanged.")
        } catch { notice = Self.message(error) }
    }

    func setupMessage(_ provider: AppIdentityProvider) -> String {
        provider == .google
            ? os1Tr("배포 설정 필요 · Google OAuth 클라이언트 ID와 콜백 등록", "Release setup required · Google OAuth client ID and callback registration")
            : os1Tr("배포 설정 필요 · Apple Developer의 Sign in with Apple 권한 및 서명", "Release setup required · Sign in with Apple capability and signing")
    }

    static func message(_ error: Error) -> String {
        switch error as? AppIdentityError {
        case .cancelled: return os1Tr("로그인을 취소했습니다.", "Sign-in cancelled.")
        case .configuration: return os1Tr("이 빌드의 로그인 등록 설정을 확인해 주세요.", "Check this build's sign-in registration.")
        case .expired: return os1Tr("로그인 세션이 만료되었거나 해제되었습니다. 다시 로그인해 주세요.", "The session expired or was revoked. Sign in again.")
        case .storage: return os1Tr("키체인 저장을 확인하지 못해 계정을 변경하지 않았습니다.", "Keychain storage failed; the account was not changed.")
        default: return os1Tr("로그인을 확인하지 못했습니다. 네트워크와 앱 등록 설정을 확인한 뒤 다시 시도해 주세요.",
                             "Sign-in could not be verified. Check the network and app registration, then try again.")
        }
        // Never display a raw OAuth error, callback, token, or authorization code.
    }
}

/// Fixed Google endpoints, system-browser PKCE; Apple uses the native provider.
/// These credentials identify this local app profile, not server-side tenancy.
@MainActor
final class OS1NativeIdentityAuthenticator: NSObject, OS1IdentityAuthenticating,
    ASWebAuthenticationPresentationContextProviding, ASAuthorizationControllerPresentationContextProviding,
    ASAuthorizationControllerDelegate {
    let configuration: OS1IdentityConfiguration
    private var webSession: ASWebAuthenticationSession?
    private var browserContinuation: CheckedContinuation<URL, any Error>?
    private var browserID: UUID?
    private var appleController: ASAuthorizationController?
    private var appleContinuation: CheckedContinuation<OS1IdentityCredential, any Error>?
    private var appleState: String?
    private var anchor: NSWindow?
    private let network: URLSession

    init(configuration: OS1IdentityConfiguration) {
        self.configuration = configuration
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 25; config.timeoutIntervalForResource = 40
        config.httpCookieStorage = nil; config.urlCache = nil
        network = URLSession(configuration: config, delegate: IdentityNoRedirect(), delegateQueue: nil)
        super.init()
    }

    private func random() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw AppIdentityError.invalidResponse }
        return Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    func signIn(_ provider: AppIdentityProvider) async throws -> OS1IdentityCredential {
        guard configuration.available(provider), let window = NSApp.keyWindow ?? NSApp.mainWindow else {
            throw AppIdentityError.configuration
        }
        anchor = window
        defer { anchor = nil }
        if provider == .apple { return try await signInApple() }
        guard let config = configuration.google else { throw AppIdentityError.configuration }
        let request = GoogleIdentityRequest(configuration: config, state: try random(), verifier: try random())
        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let transactionID = UUID()
            browserID = transactionID
            browserContinuation = continuation
            let session = ASWebAuthenticationSession(url: request.authorizationURL, callbackURLScheme: config.callbackScheme) { [weak self] url, error in
                Task { @MainActor in
                    guard let self, self.browserID == transactionID, let pending = self.browserContinuation else { return }
                    self.browserContinuation = nil; self.webSession = nil; self.browserID = nil
                    if let url { pending.resume(returning: url) }
                    else { pending.resume(throwing: (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                                           ? AppIdentityError.cancelled : AppIdentityError.invalidResponse) }
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = true
            webSession = session
            if !session.start() {
                browserContinuation = nil; webSession = nil; browserID = nil
                continuation.resume(throwing: AppIdentityError.configuration)
            }
        }
        try Task.checkCancellation()
        let code = try request.authorizationCode(from: callback)
        let token = try await exchange(request.tokenBody(code: code))
        let profile = try await googleProfile(token: token.access_token)
        return OS1IdentityCredential(profile: profile, googleClientID: config.clientID,
            accessToken: token.access_token, refreshToken: token.refresh_token,
            expiresAt: Date().addingTimeInterval(token.expires_in))
    }

    func restore(_ credential: OS1IdentityCredential) async throws -> OS1IdentityCredential {
        var result = credential
        if credential.profile.provider == .apple {
            let state: ASAuthorizationAppleIDProvider.CredentialState = try await withCheckedThrowingContinuation { continuation in
                ASAuthorizationAppleIDProvider().getCredentialState(forUserID: credential.profile.subject) { state, error in
                    if error != nil { continuation.resume(throwing: AppIdentityError.invalidResponse) }
                    else { continuation.resume(returning: state) }
                }
            }
            guard state == .authorized else { throw AppIdentityError.expired }
            result.profile.verifiedAt = Date()
            return result
        }
        guard let config = configuration.google, credential.googleClientID == config.clientID else { throw AppIdentityError.configuration }
        if credential.expiresAt.map({ $0 <= Date().addingTimeInterval(60) }) ?? true {
            guard let refresh = credential.refreshToken, !refresh.isEmpty else { throw AppIdentityError.expired }
            let token = try await exchange(GoogleIdentityRequest.form([
                "client_id": config.clientID, "refresh_token": refresh, "grant_type": "refresh_token"]))
            result.accessToken = token.access_token; result.refreshToken = token.refresh_token ?? refresh
            result.expiresAt = Date().addingTimeInterval(token.expires_in)
        }
        guard let access = result.accessToken else { throw AppIdentityError.expired }
        result.profile = try await googleProfile(token: access)
        guard result.profile.subject == credential.profile.subject else { throw AppIdentityError.invalidResponse }
        return result
    }

    private struct GoogleToken: Decodable {
        var access_token: String
        var token_type: String
        var expires_in: Double
        var refresh_token: String?
    }
    private func exchange(_ body: Data) async throws -> GoogleToken {
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"; request.httpBody = body
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let (data, response) = try await network.data(for: request)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200 else {
            if let failure = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               failure["error"] as? String == "invalid_grant" { throw AppIdentityError.expired }
            throw AppIdentityError.invalidResponse
        }
        let token = try JSONDecoder().decode(GoogleToken.self, from: data)
        guard !token.access_token.isEmpty, token.token_type.lowercased() == "bearer",
              token.expires_in.isFinite, token.expires_in > 0, token.expires_in <= 86_400 else { throw AppIdentityError.invalidResponse }
        return token
    }
    private func googleProfile(token: String) async throws -> AppIdentityProfile {
        var request = URLRequest(url: URL(string: "https://openidconnect.googleapis.com/v1/userinfo")!)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        let (data, response) = try await network.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw AppIdentityError.invalidResponse }
        if response.statusCode == 401 { throw AppIdentityError.expired }
        guard response.statusCode == 200 else { throw AppIdentityError.invalidResponse }
        struct User: Decodable { var sub: String; var name: String?; var email: String?; var email_verified: Bool? }
        let user = try JSONDecoder().decode(User.self, from: data)
        guard !user.sub.isEmpty else { throw AppIdentityError.invalidResponse }
        return AppIdentityProfile(provider: .google, subject: user.sub, name: user.name ?? "",
                                  email: user.email_verified == true ? user.email : nil)
    }

    private func signInApple() async throws -> OS1IdentityCredential {
        let state = try random(), nonce = try random()
        appleState = state
        return try await withCheckedThrowingContinuation { continuation in
            appleContinuation = continuation
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]; request.state = state
            request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self; controller.presentationContextProvider = self
            appleController = controller; controller.performRequests()
        }
    }
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard controller === appleController, let pending = appleContinuation else { return }
        appleContinuation = nil; appleController = nil
        defer { appleState = nil }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              credential.state == appleState, !credential.user.isEmpty,
              credential.identityToken?.isEmpty == false, credential.authorizationCode?.isEmpty == false else {
            pending.resume(throwing: AppIdentityError.invalidResponse); return
        }
        let name = credential.fullName.map { PersonNameComponentsFormatter().string(from: $0) } ?? ""
        let profile = AppIdentityProfile(provider: .apple, subject: credential.user, name: name, email: credential.email)
        // The OS framework is the local identity verifier. Do not reuse its
        // token as a cloud session, entitlement, plan, or server authorization.
        pending.resume(returning: OS1IdentityCredential(profile: profile))
    }
    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard controller === appleController, let pending = appleContinuation else { return }
        appleContinuation = nil; appleController = nil; appleState = nil
        pending.resume(throwing: (error as? ASAuthorizationError)?.code == .canceled
                       ? AppIdentityError.cancelled : AppIdentityError.invalidResponse)
    }
    func cancel() {
        let browser = browserContinuation; browserContinuation = nil
        browserID = nil
        webSession?.cancel(); webSession = nil
        browser?.resume(throwing: AppIdentityError.cancelled)
        let apple = appleContinuation; appleContinuation = nil
        appleController?.cancel(); appleController = nil; appleState = nil
        apple?.resume(throwing: AppIdentityError.cancelled)
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor ?? NSWindow() }
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { anchor ?? NSWindow() }
}

private final class IdentityNoRedirect: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
