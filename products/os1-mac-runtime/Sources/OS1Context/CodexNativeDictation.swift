import Foundation

/// A source-derived desktop wire contract, not a public API/support or quality claim.
/// No credential discovery, microphone access, local ASR, or fallback lives here.
public enum CodexDictationError: Error, LocalizedError, Equatable, Sendable {
    case credentialUnavailable, invalidCredential, invalidAudio, invalidRequest, invalidState
    case cancelled, timedOut, transportFailed, serverRejected, invalidResponse, messageTooLarge, emptyTranscript

    public var errorDescription: String? {
        switch self {
        case .credentialUnavailable: "Codex dictation authorization is unavailable. Your draft is preserved."
        case .invalidCredential: "Native dictation authorization is invalid. Your draft is preserved."
        case .invalidAudio: "Native dictation received invalid audio. Your draft is preserved."
        case .invalidRequest: "Native dictation request is invalid. Your draft is preserved."
        case .invalidState: "Native dictation is not accepting audio in this state."
        case .cancelled: "Native dictation cancelled. Your draft is preserved."
        case .timedOut: "Native dictation timed out. Your draft is preserved."
        case .transportFailed: "Native dictation connection failed. Your draft is preserved."
        case .serverRejected: "Native dictation was rejected by the service. Your draft is preserved."
        case .invalidResponse: "Native dictation returned an invalid response. Your draft is preserved."
        case .messageTooLarge: "Native dictation exceeded its buffer limit. Your draft is preserved."
        case .emptyTranscript: "Native dictation returned no final transcript. Your draft is preserved."
        }
    }
}

public struct CodexDictationHTTPResponse: Sendable {
    public let data: Data
    public let statusCode: Int
    public init(data: Data, statusCode: Int) { self.data = data; self.statusCode = statusCode }
}

public protocol CodexDictationSocket: Sendable {
    func send(_ data: Data) async throws
    func receive() async throws -> Data
    func close() async
}

public protocol CodexDictationTransport: Sendable {
    func connect(_ request: URLRequest) async throws -> any CodexDictationSocket
    func post(_ request: URLRequest) async throws -> CodexDictationHTTPResponse
}

public enum CodexNativeDictation {
    public typealias Credential = @Sendable () async throws -> String
    public static let maximumBufferBytes = 4_194_304
    public static let maximumSocketMessageBytes = 8_388_608
    public static let transcriptionURL = URL(string: "https://chatgpt.com/backend-api/transcribe")!
    public static let streamingURL = URL(string: "wss://chatgpt.com/backend-api/dictation/stream?dictation_surface=composer")!
    public static let protocols = ["chatgpt-dictation", "codex-desktop"]
    public static let unconfiguredCredential: Credential = { throw CodexDictationError.credentialUnavailable }

    public static func mono(interleavedSamples samples: [Float], channels: Int) throws -> [Float] {
        guard channels > 0, channels <= 32, samples.count % channels == 0,
              samples.count <= maximumBufferBytes / 2 * channels, samples.allSatisfy(\.isFinite) else {
            throw CodexDictationError.invalidAudio
        }
        if channels == 1 { return samples }
        var result: [Float] = []; result.reserveCapacity(samples.count / channels)
        for index in stride(from: 0, to: samples.count, by: channels) {
            var sum = 0.0
            for channel in 0..<channels { sum += Double(samples[index + channel]) }
            result.append(Float(sum / Double(channels)))
        }
        return result
    }

    /// Jli: clamp, asymmetric PCM scale, then Int16Array-style truncation (not rounding).
    public static func pcm16(interleavedSamples samples: [Float], channels: Int, gain: Double = 1) throws -> Data {
        guard gain.isFinite, gain >= 0 else { throw CodexDictationError.invalidAudio }
        let mono = try mono(interleavedSamples: samples, channels: channels)
        var result = Data(); result.reserveCapacity(mono.count * 2)
        for sample in mono {
            let clipped = min(1.0, max(-1.0, Double(sample) * gain))
            let value = Int16(clipped * (clipped < 0 ? 32_768 : 32_767))
            let bits = UInt16(bitPattern: value)
            result.append(UInt8(truncatingIfNeeded: bits)); result.append(UInt8(truncatingIfNeeded: bits >> 8))
        }
        return result
    }

    /// Native ready().sampleRate is carried through; this does not resample to 16 kHz.
    public static func wav(pcm16: Data, sampleRate: Int) throws -> Data {
        guard (1...384_000).contains(sampleRate), pcm16.count % 2 == 0,
              pcm16.count <= Int(UInt32.max) - 36 else { throw CodexDictationError.invalidAudio }
        var output = Data()
        func text(_ value: String) { output.append(Data(value.utf8)) }
        func u16(_ value: UInt16) { output.append(UInt8(truncatingIfNeeded: value)); output.append(UInt8(truncatingIfNeeded: value >> 8)) }
        func u32(_ value: UInt32) { for shift in stride(from: 0, to: 32, by: 8) { output.append(UInt8(truncatingIfNeeded: value >> shift)) } }
        text("RIFF"); u32(UInt32(pcm16.count + 36)); text("WAVEfmt "); u32(16)
        u16(1); u16(1); u32(UInt32(sampleRate)); u32(UInt32(sampleRate * 2)); u16(2); u16(16)
        text("data"); u32(UInt32(pcm16.count)); output.append(pcm16)
        return output
    }

    private static func token(_ value: String) throws -> String {
        guard !value.isEmpty, value.utf8.count <= 16_384,
              value.unicodeScalars.allSatisfy({ (33...126).contains($0.value) }) else {
            throw CodexDictationError.invalidCredential
        }
        return value
    }

    public static func normalizedLanguage(_ language: String?) throws -> String? {
        guard let language, !language.isEmpty, language != "auto" else { return nil }
        guard language.utf8.count <= 64,
              language.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" }) else {
            throw CodexDictationError.invalidRequest
        }
        return language
    }

    public static func transcriptionRequest(wav: Data, bearerToken: String, language: String? = nil,
                                             boundary: String = "os1-" + UUID().uuidString) throws -> URLRequest {
        guard wav.count >= 44, wav.prefix(4) == Data("RIFF".utf8),
              wav.subdata(in: 8..<12) == Data("WAVE".utf8), !boundary.isEmpty, boundary.utf8.count <= 128,
              boundary.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.contains($0) || $0 == "-" }) else {
            throw CodexDictationError.invalidRequest
        }
        let bearer = try token(bearerToken), language = try normalizedLanguage(language)
        var body = Data()
        func text(_ value: String) { body.append(Data(value.utf8)) }
        text("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"codex.wav\"\r\nContent-Type: audio/wav\r\n\r\n")
        body.append(wav); text("\r\n")
        if let language { text("--\(boundary)\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\n\(language)\r\n") }
        text("--\(boundary)--\r\n")
        var request = URLRequest(url: transcriptionURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpMethod = "POST"; request.httpBody = body
        request.setValue("Bearer " + bearer, forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=" + boundary, forHTTPHeaderField: "Content-Type")
        request.setValue("OS-1 Native Dictation", forHTTPHeaderField: "User-Agent")
        return request
    }

    public static func streamingRequest(bearerToken: String) throws -> URLRequest {
        var request = URLRequest(url: streamingURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.setValue("Bearer " + (try token(bearerToken)), forHTTPHeaderField: "Authorization")
        request.setValue(protocols.joined(separator: ", "), forHTTPHeaderField: "Sec-WebSocket-Protocol")
        request.setValue("OS-1 Native Dictation", forHTTPHeaderField: "User-Agent")
        return request
    }

    public static func sessionStart(sampleRate: Int, language: String? = nil, sessionID: String,
                                    attemptID: String, deliverSegments: Bool) throws -> Data {
        guard (1...384_000).contains(sampleRate), !sessionID.isEmpty, sessionID.utf8.count <= 128,
              !attemptID.isEmpty, attemptID.utf8.count <= 128 else { throw CodexDictationError.invalidRequest }
        var config: [String: Any] = [
            "input_audio_format": "pcm16", "sample_rate_hz": sampleRate, "num_channels": 1,
            "max_buffer_size_bytes": maximumBufferBytes, "max_utterance_duration_ms": 30_000, "session_ttl_ms": 300_000,
            "provider_mode": "streaming_sse", "transcript_delivery_mode": deliverSegments ? "segment" : "final_only",
            "vad": ["type": "server_vad", "threshold": 0.5, "prefix_padding_ms": 300, "silence_duration_ms": 500],
        ]
        if let language = try normalizedLanguage(language) { config["language"] = language }
        return try JSONSerialization.data(withJSONObject: ["type": "session.start", "dictation_session_id": sessionID,
            "attempt_id": attemptID, "config": config], options: [.sortedKeys])
    }

    public static func transcribe(wav: Data, language: String? = nil,
                                 credential: Credential = unconfiguredCredential,
                                 transport: any CodexDictationTransport) async throws -> String {
        do {
            try Task.checkCancellation()
            let bearer = try await credential()
            try Task.checkCancellation()
            let request = try transcriptionRequest(wav: wav, bearerToken: bearer, language: language)
            let response = try await transport.post(request)
            try Task.checkCancellation()
            guard (200...299).contains(response.statusCode) else { throw CodexDictationError.serverRejected }
            guard response.data.count <= maximumBufferBytes,
                  let value = try? JSONDecoder().decode(HTTPTranscript.self, from: response.data) else {
                throw CodexDictationError.invalidResponse
            }
            return value.text
        } catch is CancellationError { throw CodexDictationError.cancelled }
        catch let error as CodexDictationError { throw error }
        catch { throw CodexDictationError.transportFailed }
    }
    private struct HTTPTranscript: Decodable { let text: String }
}

/// qli's gain policy. State belongs to one recording, never a global microphone setting.
public struct CodexDictationGain: Sendable {
    public private(set) var value: Double
    public private(set) var rms: Double = 0
    public init(initial: Double = 1) { value = initial }
    public mutating func process(monoSamples: [Float]) throws -> Data {
        guard !monoSamples.isEmpty, monoSamples.allSatisfy(\.isFinite), value.isFinite, value >= 0 else {
            throw CodexDictationError.invalidAudio
        }
        var squareSum = 0.0, peak = 0.0
        for sample in monoSamples { let x = Double(sample); squareSum += x * x; peak = max(peak, abs(x)) }
        rms = sqrt(squareSum / Double(monoSamples.count))
        if rms < 0.003 { value = 1 }
        else {
            let target = min(4, max(1, 0.063 / rms), 0.708 / peak)
            value = target <= value ? target : value + (target - value) * 0.35
        }
        return try CodexNativeDictation.pcm16(interleavedSamples: monoSamples, channels: 1, gain: value)
    }
}

/// Ephemeral adapter: no shared cookies/cache, no redirects, normal platform TLS.
/// Construction makes no connection; only an explicitly supplied credential can enable one.
public final class CodexDictationURLSessionTransport: CodexDictationTransport, @unchecked Sendable {
    private let session: URLSession
    public init() {
        session = URLSession(configuration: Self.configuration(), delegate: RedirectDenyDelegate(), delegateQueue: nil)
    }
    deinit { session.invalidateAndCancel() }
    public static func configuration() -> URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.httpShouldSetCookies = false; config.urlCache = nil; config.urlCredentialStorage = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 30; config.timeoutIntervalForResource = 300
        return config
    }
    private final class RedirectDenyDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
        func urlSession(_ session: URLSession, task: URLSessionTask,
                        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                        completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
    }
    public func connect(_ request: URLRequest) async throws -> any CodexDictationSocket {
        guard request.url == CodexNativeDictation.streamingURL else { throw CodexDictationError.invalidRequest }
        let task = session.webSocketTask(with: request)
        task.maximumMessageSize = CodexNativeDictation.maximumSocketMessageBytes
        task.resume()
        return URLSessionSocket(task: task)
    }
    public func post(_ request: URLRequest) async throws -> CodexDictationHTTPResponse {
        guard request.url == CodexNativeDictation.transcriptionURL, request.httpMethod == "POST" else {
            throw CodexDictationError.invalidRequest
        }
        do {
            let (data, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse else { throw CodexDictationError.invalidResponse }
            return CodexDictationHTTPResponse(data: data, statusCode: response.statusCode)
        } catch is CancellationError { throw CodexDictationError.cancelled }
        catch let error as CodexDictationError { throw error }
        catch { throw CodexDictationError.transportFailed }
    }
    private final class URLSessionSocket: CodexDictationSocket, @unchecked Sendable {
        let task: URLSessionWebSocketTask
        init(task: URLSessionWebSocketTask) { self.task = task }
        func send(_ data: Data) async throws {
            guard let text = String(data: data, encoding: .utf8) else { throw CodexDictationError.invalidRequest }
            do { try await task.send(.string(text)) }
            catch { throw Task.isCancelled ? CodexDictationError.cancelled : CodexDictationError.transportFailed }
        }
        func receive() async throws -> Data {
            do {
                switch try await task.receive() {
                case .data(let data): return data
                case .string(let string): return Data(string.utf8)
                @unknown default: throw CodexDictationError.invalidResponse
                }
            } catch let error as CodexDictationError { throw error }
            catch { throw Task.isCancelled ? CodexDictationError.cancelled : CodexDictationError.transportFailed }
        }
        func close() async { task.cancel(with: .goingAway, reason: nil) }
    }
}

/// One recording, one terminal result. No backend/provider fallback is performed.
public actor CodexDictationSession {
    private enum Phase { case idle, starting, active, finishing, terminal }
    private struct Revision { let revision: Double; let text: String }
    private struct Utterance { var partial: Revision?; var final: Revision? }
    private struct Event: Decodable {
        let type: String
        let sequence_no: Double?
        let utterance_id: String?
        let revision: Double?
        let text: String?
        let session: ServerSession?
    }
    private struct ServerSession: Decodable { let session_id: String; let status: String }
    private let sampleRate: Int, language: String?, transport: any CodexDictationTransport
    private let credential: CodexNativeDictation.Credential
    private let onTranscript: (@Sendable (String) -> Void)?
    private let finishTimeout: TimeInterval
    private let sessionID = UUID().uuidString.lowercased(), attemptID = UUID().uuidString.lowercased()
    private var phase = Phase.idle
    private var socket: (any CodexDictationSocket)?
    private var receiveTask: Task<Void, Never>?, sendTail: Task<Void, Error>?, timeoutTask: Task<Void, Never>?
    private var pendingAudio: [Data] = [], pendingBytes = 0, inFlightAudioBytes = 0
    private var finishRequested = false, closeSent = false
    private var serverSessionID: String?
    private var order: [String] = [], utterances: [String: Utterance] = [:]
    private var lastPublished = ""
    private var terminal: Result<String, CodexDictationError>?
    private var waiters: [CheckedContinuation<String, Error>] = []

    public init(sampleRate: Int, language: String? = nil, transport: any CodexDictationTransport,
                credential: @escaping CodexNativeDictation.Credential = CodexNativeDictation.unconfiguredCredential,
                onTranscript: (@Sendable (String) -> Void)? = nil, finishTimeout: TimeInterval = 30) {
        self.sampleRate = sampleRate; self.language = language; self.transport = transport
        self.credential = credential; self.onTranscript = onTranscript; self.finishTimeout = finishTimeout
    }

    public func start() async throws {
        guard phase == .idle, terminal == nil else { throw terminalError ?? CodexDictationError.invalidState }
        phase = .starting
        do {
            try await withTaskCancellationHandler {
                try Task.checkCancellation()
                let start = try CodexNativeDictation.sessionStart(sampleRate: sampleRate, language: language,
                    sessionID: sessionID, attemptID: attemptID, deliverSegments: onTranscript != nil)
                let bearer = try await credential()
                guard terminal == nil else { throw terminalError ?? CodexDictationError.cancelled }
                try Task.checkCancellation()
                let connected = try await transport.connect(CodexNativeDictation.streamingRequest(bearerToken: bearer))
                if Task.isCancelled { await connected.close(); throw CodexDictationError.cancelled }
                guard terminal == nil else { await connected.close(); throw terminalError ?? CodexDictationError.cancelled }
                socket = connected
                try await send(start)
                try Task.checkCancellation()
                guard terminal == nil else { throw terminalError ?? CodexDictationError.cancelled }
                receiveTask = Task { [weak self] in await self?.readEvents() }
            } onCancel: { Task { await self.cancel() } }
        } catch {
            let reason = sanitized(error)
            await complete(.failure(reason)); throw reason
        }
    }

    public func appendPCM16(_ audio: Data) async throws {
        if Task.isCancelled { await complete(.failure(.cancelled)); throw CodexDictationError.cancelled }
        guard terminal == nil, !finishRequested, phase == .starting || phase == .active else {
            throw terminalError ?? CodexDictationError.invalidState
        }
        guard !audio.isEmpty, audio.count % 2 == 0 else { throw CodexDictationError.invalidAudio }
        guard audio.count <= CodexNativeDictation.maximumBufferBytes else { throw CodexDictationError.messageTooLarge }
        if phase == .starting {
            guard pendingBytes <= CodexNativeDictation.maximumBufferBytes - audio.count else { throw CodexDictationError.messageTooLarge }
            pendingAudio.append(audio); pendingBytes += audio.count; return
        }
        guard inFlightAudioBytes <= CodexNativeDictation.maximumBufferBytes - audio.count else {
            throw CodexDictationError.messageTooLarge
        }
        inFlightAudioBytes += audio.count
        defer { inFlightAudioBytes -= audio.count }
        do {
            try await withTaskCancellationHandler {
                try await sendAudio(audio)
                try Task.checkCancellation()
                guard terminal == nil else { throw terminalError ?? CodexDictationError.invalidState }
            }
            onCancel: { Task { await self.cancel() } }
        }
        catch { let reason = sanitized(error); await complete(.failure(reason)); throw reason }
    }

    public func finish() async throws -> String {
        if let terminal { return try terminal.get() }
        guard phase != .idle else { throw CodexDictationError.invalidState }
        let first = !finishRequested; finishRequested = true
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                waiters.append(continuation)
                if first {
                    let duration = finishTimeout.isFinite ? max(0, min(300, finishTimeout)) : 30
                    timeoutTask = Task { [weak self] in
                        do { try await Task.sleep(nanoseconds: UInt64(duration * 1_000_000_000)) }
                        catch { return }
                        await self?.timeout()
                    }
                    Task { [weak self] in await self?.requestClose() }
                }
            }
        } onCancel: { Task { await self.cancel() } }
    }

    public func cancel() async { await complete(.failure(.cancelled)) }
    private var terminalError: CodexDictationError? { if case .failure(let error) = terminal { error } else { nil } }
    private func sanitized(_ error: Error) -> CodexDictationError {
        if error is CancellationError || Task.isCancelled { return .cancelled }
        return (error as? CodexDictationError) ?? .transportFailed
    }
    private func send(_ data: Data) async throws {
        guard terminal == nil, let socket else { throw terminalError ?? CodexDictationError.invalidState }
        let previous = sendTail
        let task = Task {
            if let previous { try await previous.value }
            try Task.checkCancellation()
            try await socket.send(data)
        }
        sendTail = task
        try await task.value
    }
    private func sendAudio(_ data: Data) async throws {
        try await send(JSONSerialization.data(withJSONObject: ["type": "audio.append", "audio": data.base64EncodedString()], options: [.sortedKeys]))
    }
    private func requestClose() async {
        guard terminal == nil, finishRequested, !closeSent, phase == .active else { return }
        closeSent = true; phase = .finishing
        do { try await send(Data("{\"type\":\"session.close\"}".utf8)) }
        catch { await complete(.failure(sanitized(error))) }
    }
    private func readEvents() async {
        guard let socket else { return }
        do {
            while terminal == nil, !Task.isCancelled {
                let data = try await socket.receive()
                guard data.count <= CodexNativeDictation.maximumSocketMessageBytes else { throw CodexDictationError.messageTooLarge }
                let event: Event
                do { event = try JSONDecoder().decode(Event.self, from: data) }
                catch { throw CodexDictationError.invalidResponse }
                guard terminal == nil else { return }
                try await consume(event)
            }
        } catch { if terminal == nil { await complete(.failure(sanitized(error))) } }
    }
    private func consume(_ event: Event) async throws {
        guard let sequence = event.sequence_no, sequence.isFinite, sequence >= 0 else { throw CodexDictationError.invalidResponse }
        switch event.type {
        case "session.started":
            guard phase == .starting, let session = event.session, !session.session_id.isEmpty, session.status == "active" else {
                throw CodexDictationError.invalidResponse
            }
            serverSessionID = session.session_id
            let queued = pendingAudio; pendingAudio.removeAll(); pendingBytes = 0
            // Keep startup gating until its queued frames have been serialized.
            for audio in queued { try await sendAudio(audio) }
            guard terminal == nil else { return }
            // Audio that arrived while the first queue drained also precedes close.
            while !pendingAudio.isEmpty {
                let next = pendingAudio; pendingAudio.removeAll(); pendingBytes = 0
                for audio in next { try await sendAudio(audio) }
            }
            guard terminal == nil else { return }
            phase = .active
            await requestClose()
        case "session.updated":
            guard let session = event.session, session.session_id == serverSessionID,
                  ["active", "closed"].contains(session.status) else { throw CodexDictationError.invalidResponse }
            if session.status == "closed" {
                guard finishRequested, closeSent else { throw CodexDictationError.invalidResponse }
                guard !order.isEmpty else { await complete(.failure(.emptyTranscript)); return }
                guard order.allSatisfy({ utterances[$0]?.final != nil }) else { throw CodexDictationError.invalidResponse }
                let text = combined(finalOnly: true)
                await complete(text.isEmpty ? .failure(.emptyTranscript) : .success(text))
            }
        case "transcript.segment", "transcript.final":
            guard let id = event.utterance_id, !id.isEmpty, id.utf8.count <= 128,
                  let revision = event.revision, revision.isFinite, revision >= 0, let text = event.text else {
                throw CodexDictationError.invalidResponse
            }
            if utterances[id] == nil { order.append(id); utterances[id] = Utterance() }
            var utterance = utterances[id]!
            if event.type == "transcript.final" {
                if revision >= (utterance.final?.revision ?? 0) { utterance.final = Revision(revision: revision, text: text); utterance.partial = nil }
            } else if utterance.final == nil, revision >= (utterance.partial?.revision ?? 0) {
                utterance.partial = Revision(revision: revision, text: text)
            }
            utterances[id] = utterance
            let combinedText = combined(finalOnly: false)
            if combinedText != lastPublished, terminal == nil { lastPublished = combinedText; onTranscript?(combinedText) }
        case "transcript.failed", "session.error": throw CodexDictationError.serverRejected
        case "transcript.delta", "speech.started", "speech.stopped", "audio.frame_processed", "asset.ready", "asset.committed", "asset.failed": break
        default: throw CodexDictationError.invalidResponse
        }
    }
    private func combined(finalOnly: Bool) -> String {
        order.compactMap { id in utterances[id]?.final?.text ?? (finalOnly ? nil : utterances[id]?.partial?.text) }
            .filter { !$0.isEmpty }.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private func timeout() async { await complete(.failure(.timedOut)) }
    private func complete(_ result: Result<String, CodexDictationError>) async {
        guard terminal == nil else { return }
        terminal = result; phase = .terminal
        pendingAudio.removeAll(); pendingBytes = 0
        receiveTask?.cancel(); receiveTask = nil
        timeoutTask?.cancel(); timeoutTask = nil
        sendTail?.cancel(); sendTail = nil
        let socket = self.socket; self.socket = nil
        let continuations = waiters; waiters.removeAll()
        // Lock final/error before either closing the transport or releasing callers.
        await socket?.close()
        for continuation in continuations { continuation.resume(with: result.mapError { $0 as Error }) }
    }
}
