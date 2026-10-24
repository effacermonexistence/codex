import Foundation

/// Closed, in-memory observations for --self-test-composer only. This value
/// never selects a capture path, retries, changes a deadline or authorizes Send.
/// A failure survives normal cleanup until the next explicit fixture start.
struct VoiceFixtureDiagnostic: Equatable {
    enum Stage: String {
        case starting, ready, finishRequested, finishedEnvelope, finishedEnvelopeAccepted
        case captureReturned, credentialReady, transcriptionPreflight, transcriptReturned
        case publishingTranscript, finalizationReady
    }
    enum Origin: String {
        case javascript, evaluation, navigation, contentProcess, nativeAdapter, controller
    }
    enum NativeError: String {
        case credentialUnavailable, invalidCredential, invalidAudio, invalidRequest, invalidState
        case cancelled, timedOut, transportFailed, serverRejected, invalidResponse, messageTooLarge, emptyTranscript
    }
    enum JavaScriptError: String {
        case capture_cancelled, capture_busy, capture_not_ready, capture_unsupported
        case capture_start_timeout, capture_finish_timeout, capture_state_invalid
        case permission_denied, microphone_unavailable, microphone_ended
        case audio_context_not_running, worklet_flush_timeout, recorder_error
        case recorder_paused, recorder_stopped_early, recorder_stop_timeout
        case encoded_audio_empty, encoded_audio_too_large, encoded_audio_invalid
        case encoded_audio_read_timeout, encoded_audio_read_failed, mime_unsupported
        case mime_mismatch, bridge_unavailable, capture_failed, unknown
    }
    enum MIMEFamily: String { case webm, ogg, mp4, wav, aac, m4a, other }

    private(set) var stage: Stage = .starting
    private(set) var failureStage: Stage?
    private(set) var failureOrigin: Origin?
    private(set) var nativeError: NativeError?
    private(set) var javaScriptError: JavaScriptError?
    private(set) var mimeFamily: MIMEFamily?
    private(set) var browserMIMEShapeValid: Bool?
    private(set) var requestMIMEShapeValid: Bool?

    mutating func reached(_ value: Stage) {
        guard failureOrigin == nil else { return }
        stage = value
    }

    mutating func failed(origin: Origin, error: NativeError) {
        // Keep the first observed failure boundary; a later controller catch
        // or cancellation cannot reinterpret the original browser event.
        if nativeError == nil { nativeError = error }
        guard failureOrigin == nil else { return }
        failureStage = stage; failureOrigin = origin; nativeError = error
    }

    mutating func javaScriptFailed(_ value: Any?) {
        guard failureOrigin == nil else { return }
        javaScriptError = (value as? String).flatMap(JavaScriptError.init(rawValue:)) ?? .unknown
        failureStage = stage; failureOrigin = .javascript
    }

    mutating func observedMIME(_ value: String) {
        guard failureOrigin == nil else { return }
        // Mirror the two existing validators separately; do not normalize the
        // actual recording/request. The original MIME string is never stored.
        let base = value.split(separator: ";", maxSplits: 1).first.map(String.init) ?? ""
        let browserBase = base.trimmingCharacters(in: .whitespaces).lowercased()
        let requestBase = base.lowercased()
        switch browserBase {
        case "audio/webm": mimeFamily = .webm
        case "audio/ogg": mimeFamily = .ogg
        case "audio/mp4": mimeFamily = .mp4
        case "audio/wav": mimeFamily = .wav
        case "audio/aac": mimeFamily = .aac
        case "audio/x-m4a": mimeFamily = .m4a
        default: mimeFamily = .other
        }
        let shape = value.utf8.count <= 128 && value.unicodeScalars.allSatisfy { (32...126).contains($0.value) }
        browserMIMEShapeValid = shape && ["audio/webm", "audio/ogg", "audio/mp4", "audio/wav"].contains(browserBase)
        requestMIMEShapeValid = shape && ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/aac", "audio/x-m4a"].contains(requestBase)
    }

    /// Only enum labels and booleans. No exception/alert, transcript, audio,
    /// credential, arbitrary MIME string or path can reach this rendering.
    var closedDescription: String {
        func flag(_ value: Bool?) -> String { value.map { $0 ? "true" : "false" } ?? "unknown" }
        return "fixture_stage=\(stage.rawValue); fixture_failure_stage=\(failureStage?.rawValue ?? "unknown"); " +
            "fixture_failure_origin=\(failureOrigin?.rawValue ?? "unknown"); " +
            "fixture_native_error=\(nativeError?.rawValue ?? "unknown"); " +
            "fixture_js_error=\(javaScriptError?.rawValue ?? "unknown"); " +
            "fixture_mime_family=\(mimeFamily?.rawValue ?? "unknown"); " +
            "fixture_browser_mime_shape_valid=\(flag(browserMIMEShapeValid)); " +
            "fixture_request_mime_shape_valid=\(flag(requestMIMEShapeValid))"
    }
}
