import AppKit
import AVFoundation
import Foundation
import OS1Context
import WebKit

/// Encoded audio from one owned browser capture. It never contains a credential
/// or transcript; the caller decides whether to send it to a transcription service.
struct CodexBrowserRecording: Sendable {
    let data: Data
    let contentType: String
    let sampleRate: Int
    let metadata: [String: String]
}

/// OS1-owned capture frontend. The nonpersistent document has no network access,
/// account state, provider API, or access to another app's microphone session.
@MainActor
final class CodexBrowserMicrophone: NSObject, WKNavigationDelegate, WKUIDelegate {
    let webView: WKWebView

    private enum Phase: Equatable { case idle, starting, recording, finishing }
    private static let origin = URL(string: "https://os1-dictation.invalid/")!
    private static let messageLimit = 16 * 1_024 * 1_024
    private static let base64Limit = messageLimit - 4_096
    private let messageProxy: CodexBrowserMessageProxy
    private var phase: Phase = .idle
    private var documentReady = false
    private var documentFailed = false
    private var generation = 0
    private var nonce = UUID().uuidString
    private var commandStarted = false
    private var ownerActivation = false
    private var synthetic = false
    private var readySampleRate = 0
    private var onLevel: ((CGFloat) -> Void)?
    private var startContinuation: CheckedContinuation<Void, Error>?
    private var finishContinuation: CheckedContinuation<CodexBrowserRecording, Error>?
    private var startupDeadline: Task<Void, Never>?
    private var finishDeadline: Task<Void, Never>?

    init(html: String) {
        let proxy = CodexBrowserMessageProxy()
        messageProxy = proxy
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController = WKUserContentController()
        configuration.userContentController.add(proxy, name: "os1Capture")
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.mediaTypesRequiringUserActionForPlayback = []
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        proxy.owner = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.loadHTMLString(html, baseURL: Self.origin)
    }

    /// Invoked only by the owner's recording action after the controller has
    /// obtained the OS microphone permission. This method never prompts for it.
    func start(onLevel: @escaping (CGFloat) -> Void) async throws {
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
            throw CodexDictationError.invalidState
        }
        try await begin(synthetic: false, onLevel: onLevel)
    }

    /// Exercises the real browser recorder with a generated stream, not a device.
    /// It cannot be selected by a normal UI action or by JavaScript in a web page.
    func startSyntheticForFixture(onLevel: @escaping (CGFloat) -> Void) async throws {
        guard CommandLine.arguments.contains("--self-test-composer") else {
            throw CodexDictationError.invalidState
        }
        try await begin(synthetic: true, onLevel: onLevel)
    }

    private func begin(synthetic: Bool, onLevel: @escaping (CGFloat) -> Void) async throws {
        guard !Task.isCancelled else { throw CodexDictationError.cancelled }
        guard phase == .idle, !documentFailed else { throw CodexDictationError.invalidState }
        generation += 1
        let epoch = generation
        nonce = UUID().uuidString
        self.synthetic = synthetic
        self.onLevel = onLevel
        readySampleRate = 0
        commandStarted = false
        ownerActivation = !synthetic
        phase = .starting
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                startContinuation = continuation
                startupDeadline = Task { @MainActor [weak self] in
                    do { try await Task.sleep(nanoseconds: 8_000_000_000) } catch { return }
                    self?.fail(epoch: epoch, with: .timedOut)
                }
                startWhenDocumentReady(epoch: epoch)
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.cancel(epoch: epoch) }
        }
        if Task.isCancelled { cancel(epoch: epoch); throw CodexDictationError.cancelled }
    }

    private func startWhenDocumentReady(epoch: Int) {
        guard generation == epoch, phase == .starting, documentReady, !commandStarted else { return }
        guard Self.isOwnURL(webView.url) else { fail(epoch: epoch, with: .invalidState); return }
        commandStarted = true
        let script = "window.OS1CodexCapture.configure(\"\(nonce)\", \(epoch)); " +
            "void window.OS1CodexCapture.start(\(synthetic ? "true" : "false"));"
        evaluate(script, epoch: epoch)
    }

    func finish() async throws -> CodexBrowserRecording {
        guard !Task.isCancelled else { throw CodexDictationError.cancelled }
        guard phase == .recording else { throw CodexDictationError.invalidState }
        let epoch = generation
        phase = .finishing
        let recording: CodexBrowserRecording = try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                finishContinuation = continuation
                finishDeadline = Task { @MainActor [weak self] in
                    do { try await Task.sleep(nanoseconds: 15_000_000_000) } catch { return }
                    self?.fail(epoch: epoch, with: .timedOut)
                }
                evaluate("void window.OS1CodexCapture.finish();", epoch: epoch)
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.cancel(epoch: epoch) }
        }
        guard !Task.isCancelled else { throw CodexDictationError.cancelled }
        return recording
    }

    func cancel() { cancel(epoch: generation) }

    private func cancel(epoch: Int) {
        guard generation == epoch else { return }
        fail(epoch: epoch, with: .cancelled)
    }

    private func evaluate(_ script: String, epoch: Int) {
        guard generation == epoch, Self.isOwnURL(webView.url) else {
            fail(epoch: epoch, with: .invalidState); return
        }
        webView.evaluateJavaScript(script) { [weak self] _, error in
            guard error != nil else { return }
            self?.fail(epoch: epoch, with: .invalidAudio)
        }
    }

    private func fail(epoch: Int, with error: CodexDictationError) {
        guard generation == epoch else { return }
        if documentReady, Self.isOwnURL(webView.url) {
            // Only this adapter's own capture is stopped. Late results are rejected
            // by both the native epoch and the document's run-identity checks.
            webView.evaluateJavaScript("window.OS1CodexCapture.cancel();", completionHandler: nil)
        }
        let starting = startContinuation, finishing = finishContinuation
        clearRun()
        starting?.resume(throwing: error)
        finishing?.resume(throwing: error)
    }

    private func clearRun() {
        startupDeadline?.cancel(); startupDeadline = nil
        finishDeadline?.cancel(); finishDeadline = nil
        startContinuation = nil; finishContinuation = nil
        onLevel = nil; ownerActivation = false; commandStarted = false
        readySampleRate = 0; phase = .idle
        generation += 1; nonce = UUID().uuidString
    }

    fileprivate func receive(_ message: WKScriptMessage) {
        guard message.webView === webView, message.name == "os1Capture",
              message.frameInfo.isMainFrame, Self.isOwnOrigin(message.frameInfo.securityOrigin),
              Self.isOwnURL(webView.url), phase != .idle,
              let body = message.body as? [String: Any], body["nonce"] as? String == nonce,
              let epoch = body["generation"] as? Int, epoch == generation,
              let event = body["event"] as? String,
              let payload = body["payload"] as? [String: Any] else { return }
        // Bound the complete message, not just the decoded recording. A broken
        // bridge cannot import arbitrary-size data or metadata into the process.
        guard JSONSerialization.isValidJSONObject(body),
              let encoded = try? JSONSerialization.data(withJSONObject: body),
              encoded.count <= Self.messageLimit else {
            fail(epoch: epoch, with: .messageTooLarge); return
        }
        switch event {
        case "ready":
            guard phase == .starting, let rate = payload["sampleRate"] as? Int,
                  (1...384_000).contains(rate), validatedMetadata(payload["metadata"]) != nil else {
                fail(epoch: epoch, with: .invalidResponse); return
            }
            readySampleRate = rate; phase = .recording
            startupDeadline?.cancel(); startupDeadline = nil
            let continuation = startContinuation; startContinuation = nil
            continuation?.resume()
        case "level":
            guard phase == .recording || phase == .finishing,
                  let value = payload["value"] as? Double, value.isFinite else { return }
            onLevel?(CGFloat(min(1, max(0, value))))
        case "finished":
            guard phase == .finishing,
                  let text = payload["base64"] as? String, !text.isEmpty,
                  text.utf8.count <= Self.base64Limit,
                  let contentType = payload["contentType"] as? String,
                  Self.validContentType(contentType),
                  let rate = payload["sampleRate"] as? Int, rate == readySampleRate,
                  let metadata = validatedMetadata(payload["metadata"]),
                  metadata["recorderMimeType"] == contentType,
                  let data = Data(base64Encoded: text), !data.isEmpty,
                  data.count <= Self.base64Limit / 4 * 3 else {
                fail(epoch: epoch, with: .invalidResponse); return
            }
            let recording = CodexBrowserRecording(data: data, contentType: contentType,
                                                  sampleRate: rate, metadata: metadata)
            let continuation = finishContinuation
            clearRun()
            continuation?.resume(returning: recording)
        case "error":
            let error: CodexDictationError
            switch payload["code"] as? String {
            case "cancelled", "capture_cancelled": error = .cancelled
            case "timed_out", "capture_start_timeout", "capture_finish_timeout", "worklet_flush_timeout",
                 "recorder_stop_timeout", "encoded_audio_read_timeout": error = .timedOut
            case "message_too_large", "encoded_audio_too_large": error = .messageTooLarge
            case "invalid_state", "capture_busy", "capture_not_ready", "capture_state_invalid": error = .invalidState
            default: error = .invalidAudio
            }
            fail(epoch: epoch, with: error)
        default: break
        }
    }

    private func validatedMetadata(_ value: Any?) -> [String: String]? {
        guard let metadata = value as? [String: String], metadata.count <= 9,
              metadata["captureFrontend"] == "webkit-owned",
              metadata["synthetic"] == (synthetic ? "true" : "false") else { return nil }
        for (key, text) in metadata {
            guard text.utf8.count <= 128 else { return nil }
            switch key {
            case "captureFrontend", "synthetic": break
            case "sampleRate":
                if text == "unknown" { continue }
                guard let rate = Int(text), (1...384_000).contains(rate) else { return nil }
            case "audioContextSampleRate":
                guard let rate = Int(text), (1...384_000).contains(rate) else { return nil }
            case "channelCount":
                if text == "unknown" { continue }
                guard let count = Int(text), (1...32).contains(count) else { return nil }
            case "echoCancellation", "noiseSuppression", "autoGainControl":
                guard text == "true" || text == "false" || text == "unknown" else { return nil }
            case "recorderMimeType":
                guard Self.validContentType(text) else { return nil }
            default: return nil // Never import device IDs/names, tokens, audio, or text.
            }
        }
        return metadata
    }

    private static func validContentType(_ value: String) -> Bool {
        guard value.utf8.count <= 128,
              value.unicodeScalars.allSatisfy({ (32...126).contains($0.value) }) else { return false }
        let mime = value.split(separator: ";", maxSplits: 1).first?.trimmingCharacters(in: .whitespaces).lowercased()
        return ["audio/webm", "audio/ogg", "audio/mp4", "audio/wav"].contains(mime ?? "")
    }

    private static func isOwnURL(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == "https" && url.host == "os1-dictation.invalid" &&
            (url.port == nil || url.port == 443) && url.user == nil && url.password == nil &&
            (url.path.isEmpty || url.path == "/") && url.query == nil && url.fragment == nil
    }

    private static func isOwnOrigin(_ origin: WKSecurityOrigin) -> Bool {
        origin.protocol == "https" && origin.host == "os1-dictation.invalid" &&
            (origin.port == 0 || origin.port == 443)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        // Only the initial owned document load is permitted. Even a same-origin
        // replacement cannot supply another document or make a network request.
        let allowed = webView === self.webView && !documentReady && !documentFailed &&
            action.targetFrame?.isMainFrame == true && Self.isOwnURL(action.request.url)
        decisionHandler(allowed ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === self.webView, Self.isOwnURL(webView.url) else {
            documentFailed = true; fail(epoch: generation, with: .invalidState); return
        }
        documentReady = true
        startWhenDocumentReady(epoch: generation)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        documentFailed = true; fail(epoch: generation, with: .invalidAudio)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        documentFailed = true; fail(epoch: generation, with: .invalidAudio)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        documentReady = false; documentFailed = true
        fail(epoch: generation, with: .invalidAudio)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) {
        let permitted = webView === self.webView && ownerActivation && !synthetic && phase == .starting &&
            type == .microphone && frame.isMainFrame && Self.isOwnOrigin(origin) &&
            Self.isOwnOrigin(frame.securityOrigin) && Self.isOwnURL(webView.url) &&
            AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
        decisionHandler(permitted ? .grant : .deny)
    }
}

/// WKUserContentController retains its handler; the handler never retains the
/// capture owner. Delegates and pending timers likewise do not create a cycle.
@MainActor
private final class CodexBrowserMessageProxy: NSObject, WKScriptMessageHandler {
    weak var owner: CodexBrowserMicrophone?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.receive(message)
    }
}
