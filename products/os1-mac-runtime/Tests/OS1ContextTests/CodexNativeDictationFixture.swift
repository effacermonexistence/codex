import Foundation
import OS1Context

// Deliberately injected transport and fixture-only token. These tests never use
// URLSession, account stores, a microphone, or a speech/provider endpoint.
private enum DictationFixtureFailure: Error {
    case failed(String)
    case rawTransportSentinel
    case socketClosed
    case deadline
}

private final class DictationFixtureBox<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value
    init(_ value: Value) { self.value = value }
    func get() -> Value { lock.withLock { value } }
    func set(_ newValue: Value) { lock.withLock { value = newValue } }
}

private final class DictationTranscriptCollector: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String] = []
    func append(_ value: String) { lock.withLock { values.append(value) } }
    func snapshot() -> [String] { lock.withLock { values } }
}

private actor DictationFixtureCredential {
    private(set) var calls = 0
    private let token: String
    init(_ token: String = "os1-dictation-fixture-only") { self.token = token }
    func load() -> String { calls += 1; return token }
}

private actor DictationFixtureSocket: CodexDictationSocket {
    private var incoming: [Result<Data, DictationFixtureFailure>] = []
    private var waiters: [CheckedContinuation<Data, any Error>] = []
    private var sent: [Data] = []
    private var closed = false
    private var sendFailure = false
    private var holdSend = false
    private var heldSend: CheckedContinuation<Void, Never>?
    private(set) var receiveCalls = 0
    private(set) var closeCalls = 0

    func send(_ data: Data) async throws {
        if sendFailure { throw DictationFixtureFailure.rawTransportSentinel }
        if closed { throw DictationFixtureFailure.socketClosed }
        sent.append(data)
        if holdSend { await withCheckedContinuation { heldSend = $0 } }
        try Task.checkCancellation()
    }
    func receive() async throws -> Data {
        receiveCalls += 1
        if !incoming.isEmpty { return try incoming.removeFirst().get() }
        if closed { throw DictationFixtureFailure.socketClosed }
        return try await withCheckedThrowingContinuation { waiters.append($0) }
    }
    func close() async {
        closeCalls += 1
        guard !closed else { return }
        closed = true
        let pending = waiters; waiters.removeAll()
        for waiter in pending { waiter.resume(throwing: DictationFixtureFailure.socketClosed) }
    }
    func enqueue(_ data: Data) {
        guard !closed else { return }
        if !waiters.isEmpty { waiters.removeFirst().resume(returning: data) }
        else { incoming.append(.success(data)) }
    }
    func failReceive() {
        if !waiters.isEmpty { waiters.removeFirst().resume(throwing: DictationFixtureFailure.rawTransportSentinel) }
        else { incoming.append(.failure(.rawTransportSentinel)) }
    }
    func failSends() { sendFailure = true }
    func holdSends() { holdSend = true }
    func releaseSends() { holdSend = false; heldSend?.resume(); heldSend = nil }
    func messages() -> [Data] { sent }
}

private actor DictationFixtureTransport: CodexDictationTransport {
    let socket: DictationFixtureSocket
    private var requests: [URLRequest] = []
    private var posts: [URLRequest] = []
    private var failConnection = false
    private var failPost = false
    private var holdConnection = false
    private var heldConnection: CheckedContinuation<Void, Never>?
    private var holdPost = false
    private var heldPost: CheckedContinuation<Void, Never>?
    private let response: CodexDictationHTTPResponse
    init(socket: DictationFixtureSocket = .init(),
         response: CodexDictationHTTPResponse = .init(data: Data("{\"text\":\"fixture\"}".utf8), statusCode: 200)) {
        self.socket = socket; self.response = response
    }
    func connect(_ request: URLRequest) async throws -> any CodexDictationSocket {
        requests.append(request)
        if failConnection { throw DictationFixtureFailure.rawTransportSentinel }
        if holdConnection { await withCheckedContinuation { heldConnection = $0 } }
        return socket
    }
    func post(_ request: URLRequest) async throws -> CodexDictationHTTPResponse {
        posts.append(request)
        if failPost { throw DictationFixtureFailure.rawTransportSentinel }
        if holdPost { await withCheckedContinuation { heldPost = $0 } }
        return response
    }
    func failConnections() { failConnection = true }
    func failPosts() { failPost = true }
    func holdConnections() { holdConnection = true }
    func releaseConnections() { holdConnection = false; heldConnection?.resume(); heldConnection = nil }
    func holdPosts() { holdPost = true }
    func releasePosts() { holdPost = false; heldPost?.resume(); heldPost = nil }
    func connectionRequests() -> [URLRequest] { requests }
    func postRequests() -> [URLRequest] { posts }
}

private func dictationFixtureJSON(_ object: [String: Any]) throws -> Data {
    try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
}
private func dictationFixtureObject(_ data: Data) throws -> [String: Any] {
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw DictationFixtureFailure.failed("outgoing message must be an object")
    }
    return object
}
private func dictationFixtureType(_ data: Data) -> String? {
    (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["type"] as? String
}
private func dictationFixtureEvent(_ type: String, sequence: Int = 1,
                                  utterance: String? = nil, revision: Int? = nil,
                                  text: String? = nil) throws -> Data {
    var event: [String: Any] = ["type": type, "sequence_no": sequence]
    if let utterance { event["utterance_id"] = utterance }
    if let revision { event["revision"] = revision }
    if let text { event["text"] = text }
    return try dictationFixtureJSON(event)
}
private func dictationFixtureSessionEvent(_ type: String, id: String, status: String,
                                         sequence: Int = 1) throws -> Data {
    try dictationFixtureJSON([
        "type": type, "sequence_no": sequence,
        "session": ["session_id": id, "status": status,
                    "config": ["provider_mode": "streaming_sse", "transcript_delivery_mode": "segment"]]
    ])
}
private func dictationFixtureWait(_ condition: @escaping @Sendable () async -> Bool) async throws {
    let deadline = ProcessInfo.processInfo.systemUptime + 2
    while !(await condition()) {
        if ProcessInfo.processInfo.systemUptime > deadline { throw DictationFixtureFailure.deadline }
        try await Task.sleep(nanoseconds: 1_000_000)
    }
}
private func dictationFixtureStartID(_ socket: DictationFixtureSocket) async throws -> String {
    try await dictationFixtureWait { await socket.messages().count >= 1 }
    let messages = await socket.messages()
    let first = try dictationFixtureObject(messages[0])
    if let id = first["dictation_session_id"] as? String { return id }
    throw DictationFixtureFailure.failed("start frame must identify its session")
}

/// Sync entry point for the CLT-only executable fixture runner. The worker is
/// detached so blocking this entry point cannot starve a main-actor callback.
func runCodexNativeDictationFixtures() throws {
    let result = DictationFixtureBox<Result<Void, any Error>?>(nil)
    let semaphore = DispatchSemaphore(value: 0)
    let worker = Task.detached {
        do { try await codexNativeDictationFixtureChecks(); result.set(.success(())) }
        catch { result.set(.failure(error)) }
        semaphore.signal()
    }
    guard semaphore.wait(timeout: .now() + 20) == .success else {
        worker.cancel(); throw DictationFixtureFailure.deadline
    }
    guard let value = result.get() else { throw DictationFixtureFailure.deadline }
    try value.get()
}

private func codexNativeDictationFixtureChecks() async throws {
    var count = 0
    func check(_ value: Bool, _ message: String) throws {
        guard value else { throw DictationFixtureFailure.failed(message) }
        count += 1
    }
    func rejects(_ expected: CodexDictationError, _ body: () throws -> Void) throws {
        do { try body() }
        catch let error as CodexDictationError {
            try check(error == expected, "expected \(expected), received \(error)")
            return
        }
        throw DictationFixtureFailure.failed("expected rejection: \(expected)")
    }
    func rejectsAsync(_ expected: CodexDictationError, _ body: () async throws -> Void) async throws {
        do { try await body() }
        catch let error as CodexDictationError {
            try check(error == expected, "expected \(expected), received \(error)")
            return
        }
        throw DictationFixtureFailure.failed("expected async rejection: \(expected)")
    }

    // Builder assertions below target actual serialized requests and bytes,
    // never a duplicate model of the encoder.
    let samples: [Float] = [-1, -0.5, 0, 0.5, 1]
    let pcm = try CodexNativeDictation.pcm16(interleavedSamples: samples, channels: 1)
    try check(pcm.count == samples.count * 2, "PCM16 emits two bytes per mono sample")
    try check(pcm == Data([0x00, 0x80, 0x00, 0xc0, 0x00, 0x00, 0xff, 0x3f, 0xff, 0x7f]), "PCM clamps/scales signed endpoints and truncates native Float32 conversion")
    let clipped = try CodexNativeDictation.pcm16(interleavedSamples: [-2, 2], channels: 1)
    try check(clipped == Data([0x00, 0x80, 0xff, 0x7f]), "PCM clips both out-of-range endpoints")
    let stereo = try CodexNativeDictation.pcm16(interleavedSamples: [1, -1, 0.5, 0.5], channels: 2)
    try check(stereo.count == 4 && stereo.prefix(2) == Data([0, 0]), "stereo downmixes into mono, not interleaved upload")
    try rejects(.invalidAudio) { _ = try CodexNativeDictation.pcm16(interleavedSamples: [0], channels: 0) }
    try rejects(.invalidAudio) { _ = try CodexNativeDictation.pcm16(interleavedSamples: [0], channels: 2) }
    try rejects(.invalidAudio) { _ = try CodexNativeDictation.pcm16(interleavedSamples: [.nan], channels: 1) }
    try rejects(.invalidAudio) { _ = try CodexNativeDictation.pcm16(interleavedSamples: [.infinity], channels: 1) }

    let wav = try CodexNativeDictation.wav(pcm16: pcm, sampleRate: 24_000)
    func uint32(_ offset: Int) -> UInt32 {
        (0..<4).reduce(UInt32(0)) { $0 | UInt32(wav[offset + $1]) << ($1 * 8) }
    }
    try check(String(data: wav.prefix(4), encoding: .ascii) == "RIFF", "WAV RIFF header")
    try check(String(data: wav.subdata(in: 8..<12), encoding: .ascii) == "WAVE", "WAV container identity")
    try check(String(data: wav.subdata(in: 12..<16), encoding: .ascii) == "fmt ", "WAV format section")
    try check(wav[20] == 1 && wav[21] == 0 && wav[22] == 1 && wav[23] == 0, "WAV PCM mono format")
    try check(uint32(24) == 24_000 && uint32(28) == 48_000, "WAV sample rate and byte rate")
    try check(wav[32] == 2 && wav[34] == 16, "WAV block alignment and 16-bit depth")
    try check(uint32(4) == UInt32(wav.count - 8) && uint32(40) == UInt32(pcm.count), "WAV sizes match actual bytes")
    try check(wav.suffix(pcm.count) == pcm, "WAV retains exact PCM payload")
    try rejects(.invalidAudio) { _ = try CodexNativeDictation.wav(pcm16: Data([0]), sampleRate: 24_000) }
    try rejects(.invalidAudio) { _ = try CodexNativeDictation.wav(pcm16: pcm, sampleRate: 0) }

    let token = "os1-dictation-fixture-only"
    let request = try CodexNativeDictation.transcriptionRequest(wav: wav, bearerToken: token, language: "ko", boundary: "os1-fixture")
    try check(request.httpMethod == "POST", "batch request is POST")
    try check(request.url?.absoluteString == "https://chatgpt.com/backend-api/transcribe", "batch uses exact desktop transcription endpoint")
    try check(request.value(forHTTPHeaderField: "Authorization") == "Bearer " + token, "batch uses injected bearer credential")
    try check(request.value(forHTTPHeaderField: "Content-Type") == "multipart/form-data; boundary=os1-fixture", "multipart boundary header matches payload")
    let body = request.httpBody ?? Data()
    let bodyText = String(decoding: body, as: UTF8.self)
    try check(body.range(of: wav) != nil, "multipart contains actual WAV bytes")
    try check(bodyText.contains("name=\"file\"") && bodyText.contains("Content-Type: audio/wav"), "multipart names the audio file")
    try check(bodyText.contains("name=\"language\"") && bodyText.contains("\r\nko\r\n"), "multipart carries explicit language")
    try check(!bodyText.contains("name=\"model\""), "native batch dictation must not add an ASR model field")
    try check(bodyText.hasSuffix("--os1-fixture--\r\n"), "multipart closes its boundary")
    try check(!bodyText.contains(token), "credential never appears in request body")
    let noLanguage = try CodexNativeDictation.transcriptionRequest(wav: wav, bearerToken: token, boundary: "os1-fixture")
    try check(!String(decoding: noLanguage.httpBody ?? Data(), as: UTF8.self).contains("name=\"language\""), "absent language remains absent")
    try rejects(.invalidCredential) { _ = try CodexNativeDictation.transcriptionRequest(wav: wav, bearerToken: "") }
    try rejects(.invalidCredential) { _ = try CodexNativeDictation.transcriptionRequest(wav: wav, bearerToken: "fixture\r\nInjected: yes") }
    try rejects(.invalidRequest) { _ = try CodexNativeDictation.transcriptionRequest(wav: wav, bearerToken: token, boundary: "bad\r\nboundary") }
    try rejects(.invalidRequest) { _ = try CodexNativeDictation.transcriptionRequest(wav: wav, bearerToken: token, language: "ko\r\nInjected") }

    let streaming = try CodexNativeDictation.streamingRequest(bearerToken: token)
    try check(streaming.url?.scheme == "wss", "streaming uses websocket, not a whisper endpoint")
    try check(streaming.url?.absoluteString == "wss://chatgpt.com/backend-api/dictation/stream?dictation_surface=composer", "stream uses exact desktop dictation surface")
    try check(streaming.value(forHTTPHeaderField: "Sec-WebSocket-Protocol") == "chatgpt-dictation, codex-desktop", "stream declares exact native subprotocols in order")
    try check(streaming.value(forHTTPHeaderField: "Authorization") == "Bearer " + token, "stream uses explicit injected bearer")
    try check(streaming.httpBody == nil, "streaming handshake has no audio/request body")
    try rejects(.invalidCredential) { _ = try CodexNativeDictation.streamingRequest(bearerToken: "") }
    try rejects(.invalidCredential) { _ = try CodexNativeDictation.streamingRequest(bearerToken: "fixture\nsecret") }
    let start = try dictationFixtureObject(CodexNativeDictation.sessionStart(sampleRate: 24_000, language: "ko", sessionID: "session-fixture", attemptID: "attempt-fixture", deliverSegments: true))
    try check(start["type"] as? String == "session.start", "stream begins with native session.start")
    try check(start["dictation_session_id"] as? String == "session-fixture" && start["attempt_id"] as? String == "attempt-fixture", "start binds session and attempt identifiers")
    guard let config = start["config"] as? [String: Any], let vad = config["vad"] as? [String: Any] else {
        throw DictationFixtureFailure.failed("native start config/VAD object missing")
    }
    try check(config["input_audio_format"] as? String == "pcm16", "native input is PCM16")
    try check(config["sample_rate_hz"] as? Int == 24_000 && config["num_channels"] as? Int == 1, "config preserves actual mono capture rate")
    try check(config["max_buffer_size_bytes"] as? Int == 4_194_304, "native config buffer limit")
    try check(config["max_utterance_duration_ms"] as? Int == 30_000 && config["session_ttl_ms"] as? Int == 300_000, "native utterance/session duration contract")
    try check(config["provider_mode"] as? String == "streaming_sse", "native provider mode")
    try check(config["transcript_delivery_mode"] as? String == "segment" && config["language"] as? String == "ko", "explicit segment/language mode")
    try check(vad["type"] as? String == "server_vad" && vad["threshold"] as? Double == 0.5, "native server VAD contract")
    try check(vad["prefix_padding_ms"] as? Int == 300 && vad["silence_duration_ms"] as? Int == 500, "native VAD timing contract")
    let finalOnly = try dictationFixtureObject(CodexNativeDictation.sessionStart(sampleRate: 48_000, language: "auto", sessionID: "s", attemptID: "a", deliverSegments: false))
    let finalConfig = finalOnly["config"] as? [String: Any]
    try check(finalConfig?["transcript_delivery_mode"] as? String == "final_only", "no incremental callback uses final-only delivery")
    try check(finalConfig?["sample_rate_hz"] as? Int == 48_000 && finalConfig?["language"] == nil, "auto language omitted; actual capture rate is not fixed/resampled")
    try check(!String(decoding: try JSONSerialization.data(withJSONObject: start), as: UTF8.self).contains(token), "start event has no credential")
    try rejects(.invalidRequest) { _ = try CodexNativeDictation.sessionStart(sampleRate: 0, sessionID: "s", attemptID: "a", deliverSegments: true) }

    // qli's adaptive gain is state-local. Its rise is smoothed, its decrease
    // is immediate, and quiet/silent audio is not amplified to an invented peak.
    var gain = CodexDictationGain()
    let gainOutput = try gain.process(monoSamples: [0.02, 0.02])
    let targetGain = 0.063 / Double(Float(0.02))
    try check(abs(gain.value - (1 + (targetGain - 1) * 0.35)) < 1e-12, "gain rises by exact native 0.35 smoothing")
    try check(gainOutput == Data([0x7c, 0x04, 0x7c, 0x04]), "gain-adjusted Float32 samples truncate to native PCM16")
    _ = try gain.process(monoSamples: [0.1])
    try check(gain.value == 1, "gain decreases immediately, not by upward smoothing")
    let peakLimited = try gain.process(monoSamples: [1])
    try check(gain.value == 0.708 && peakLimited == Data([0x9f, 0x5a]), "peak limiting uses native 0.708 ceiling")
    var quietGain = CodexDictationGain(initial: 4)
    _ = try quietGain.process(monoSamples: [0.001])
    try check(quietGain.value == 1, "RMS below 0.003 uses unity target")
    var subUnitySilentGain = CodexDictationGain(initial: 0.708)
    _ = try subUnitySilentGain.process(monoSamples: [0, 0])
    try check(subUnitySilentGain.value == 1, "native silence branch resets sub-unity gain immediately")
    var subUnityQuietGain = CodexDictationGain(initial: 0.708)
    _ = try subUnityQuietGain.process(monoSamples: [0.001])
    try check(subUnityQuietGain.value == 1, "native RMS-under-threshold branch bypasses upward smoothing")
    var silentGain = CodexDictationGain()
    try check(try silentGain.process(monoSamples: [0, 0]) == Data([0, 0, 0, 0]) && silentGain.value == 1, "silence remains zero at unity gain")
    try rejects(.invalidAudio) { _ = try silentGain.process(monoSamples: []) }
    try rejects(.invalidAudio) { _ = try silentGain.process(monoSamples: [.nan]) }
    try rejects(.invalidAudio) { _ = try CodexNativeDictation.pcm16(interleavedSamples: [0], channels: 1, gain: -.infinity) }
    try rejects(.invalidAudio) { _ = try CodexNativeDictation.pcm16(interleavedSamples: [0], channels: 33) }

    let configuration = CodexDictationURLSessionTransport.configuration()
    try check(configuration.identifier == nil && configuration.httpCookieStorage == nil, "ephemeral configuration shares no persistent identifier/cookies")
    try check(!configuration.httpShouldSetCookies && configuration.urlCache == nil, "native adapter shares no cookie/cache state")
    try check(configuration.requestCachePolicy == .reloadIgnoringLocalCacheData, "native requests bypass cache")
    try check(configuration.timeoutIntervalForRequest == 30 && configuration.timeoutIntervalForResource == 300, "native transport keeps bounded timeouts")
    try check(request.value(forHTTPHeaderField: "User-Agent") == "OS-1 Native Dictation", "batch user agent identifies OS-1 truthfully")
    try check(streaming.value(forHTTPHeaderField: "User-Agent") == "OS-1 Native Dictation", "stream user agent identifies OS-1 truthfully")
    try check(request.value(forHTTPHeaderField: "X-Codex-Version") == nil && streaming.value(forHTTPHeaderField: "X-Codex-Version") == nil, "no fabricated Codex version headers")
    try check(try CodexNativeDictation.normalizedLanguage("auto") == nil && CodexNativeDictation.normalizedLanguage("") == nil, "auto/empty language is unspecified")
    try check(try CodexNativeDictation.normalizedLanguage("ko-KR") == "ko-KR", "explicit locale survives normalization")

    // Native batch executor uses only the injected HTTP transport. No stream
    // retry, no local ASR, no model/provider substitution, no credential store.
    let batchCredential = DictationFixtureCredential()
    let batchTransport = DictationFixtureTransport(response: .init(data: Data("{\"text\":\"mock native final\"}".utf8), statusCode: 200))
    let batchResult = try await CodexNativeDictation.transcribe(wav: wav, language: "ko",
        credential: { await batchCredential.load() }, transport: batchTransport)
    try check(batchResult == "mock native final", "batch adopts the actual decoded HTTP transcript")
    try check(await batchCredential.calls == 1, "batch resolves injected credential once")
    let batchPosts = await batchTransport.postRequests()
    try check(batchPosts.count == 1 && batchPosts[0].url == request.url, "batch uses one exact native POST")
    try check(await batchTransport.connectionRequests().isEmpty, "batch does not start a stream")
    let unconfiguredBatch = DictationFixtureTransport()
    try await rejectsAsync(.credentialUnavailable) { _ = try await CodexNativeDictation.transcribe(wav: wav, transport: unconfiguredBatch) }
    try check(await unconfiguredBatch.postRequests().isEmpty, "unconfigured batch stops before transport")
    for status in [0, 401, 403, 429, 500] {
        let rejected = DictationFixtureTransport(response: .init(data: Data("raw fixture rejected server body".utf8), statusCode: status))
        try await rejectsAsync(.serverRejected) { _ = try await CodexNativeDictation.transcribe(wav: wav, credential: { token }, transport: rejected) }
        try check(await rejected.postRequests().count == 1, "HTTP rejection is not retried")
        try check(await rejected.connectionRequests().isEmpty, "HTTP rejection is not streaming fallback")
    }
    for data in [Data("not-json raw fixture diagnostic".utf8), Data("{\"text\":42}".utf8), Data("{}".utf8), Data(repeating: 65, count: 4_194_305)] {
        let invalid = DictationFixtureTransport(response: .init(data: data, statusCode: 200))
        try await rejectsAsync(.invalidResponse) { _ = try await CodexNativeDictation.transcribe(wav: wav, credential: { token }, transport: invalid) }
        try check(await invalid.postRequests().count == 1, "bad batch response preserves exact-once invocation")
    }
    let postFailure = DictationFixtureTransport()
    await postFailure.failPosts()
    try await rejectsAsync(.transportFailed) { _ = try await CodexNativeDictation.transcribe(wav: wav, credential: { token }, transport: postFailure) }
    let heldHTTP = DictationFixtureTransport()
    await heldHTTP.holdPosts()
    let heldHTTPTask = Task { try await CodexNativeDictation.transcribe(wav: wav, credential: { token }, transport: heldHTTP) }
    try await dictationFixtureWait { await heldHTTP.postRequests().count == 1 }
    heldHTTPTask.cancel()
    await heldHTTP.releasePosts()
    try await rejectsAsync(.cancelled) { _ = try await heldHTTPTask.value }
    try check(await heldHTTP.postRequests().count == 1, "HTTP cancellation never repeats the request")

    // Missing credentials is a hard pre-transport stop; no test accesses an
    // actual credential store or asks the native URLSession transport to run.
    let unconfiguredTransport = DictationFixtureTransport()
    let unconfigured = CodexDictationSession(sampleRate: 24_000, transport: unconfiguredTransport)
    try await rejectsAsync(.credentialUnavailable) { try await unconfigured.start() }
    try check(await unconfiguredTransport.connectionRequests().isEmpty, "unconfigured credentials fail before connect")
    try check(await unconfiguredTransport.postRequests().isEmpty, "unconfigured credentials never fall back to HTTP")

    let invalidTransport = DictationFixtureTransport()
    let invalidCredential = DictationFixtureCredential("invalid\r\nfixture")
    let invalidSession = CodexDictationSession(sampleRate: 24_000, transport: invalidTransport, credential: { await invalidCredential.load() })
    try await rejectsAsync(.invalidCredential) { try await invalidSession.start() }
    try check(await invalidTransport.connectionRequests().isEmpty, "invalid credential rejected before connect")

    // Ordered startup: capture now, enqueue audio before server acknowledgement,
    // and Stop before acknowledgement. Nothing may precede session.start.
    let socket = DictationFixtureSocket()
    let transport = DictationFixtureTransport(socket: socket)
    let credential = DictationFixtureCredential()
    let transcript = DictationTranscriptCollector()
    let session = CodexDictationSession(sampleRate: 24_000, language: "ko", transport: transport,
                                       credential: { await credential.load() },
                                       onTranscript: { transcript.append($0) }, finishTimeout: 2)
    try await session.start()
    let sessionID = try await dictationFixtureStartID(socket)
    try await session.appendPCM16(Data([1, 0, 2, 0]))
    try await session.appendPCM16(Data([3, 0]))
    try check(await socket.messages().count == 1, "pre-ack audio is queued behind session.start")
    let finished = DictationFixtureBox(false)
    let finishTask = Task { let value = try await session.finish(); finished.set(true); return value }
    try await Task.sleep(nanoseconds: 10_000_000)
    let beforeAckCount = await socket.messages().count
    try check(!finished.get() && beforeAckCount == 1, "finish waits for startup and cannot send stop before ack")
    await socket.enqueue(try dictationFixtureSessionEvent("session.started", id: sessionID, status: "active"))
    try await dictationFixtureWait { await socket.messages().count >= 4 }
    let outgoing = await socket.messages()
    try check(dictationFixtureType(outgoing[0]) == "session.start", "start frame remains first")
    try check(outgoing.count == 4, "two queued audio frames and one terminal request are sent exactly once")
    let firstAudio = try dictationFixtureObject(outgoing[1]), secondAudio = try dictationFixtureObject(outgoing[2])
    try check(firstAudio["type"] as? String == "audio.append" && firstAudio["audio"] as? String == Data([1, 0, 2, 0]).base64EncodedString(), "first queued PCM frame stays exact and ordered")
    try check(secondAudio["type"] as? String == "audio.append" && secondAudio["audio"] as? String == Data([3, 0]).base64EncodedString(), "second queued PCM frame stays exact and ordered")
    try check(dictationFixtureType(outgoing[3]) == "session.close", "close comes after all queued PCM")

    await socket.enqueue(try dictationFixtureEvent("transcript.segment", sequence: 2, utterance: "u1", revision: 1, text: "old"))
    await socket.enqueue(try dictationFixtureEvent("transcript.segment", sequence: 3, utterance: "u1", revision: 3, text: "new"))
    await socket.enqueue(try dictationFixtureEvent("transcript.segment", sequence: 4, utterance: "u1", revision: 2, text: "stale"))
    await socket.enqueue(try dictationFixtureEvent("transcript.segment", sequence: 5, utterance: "u2", revision: 1, text: "second"))
    try await dictationFixtureWait { transcript.snapshot().last == "new second" }
    try check(!transcript.snapshot().contains(where: { $0.contains("stale") }), "stale partial revision never replaces latest partial")
    await socket.enqueue(try dictationFixtureEvent("transcript.delta", sequence: 6, utterance: "u1", revision: 99, text: "ignored delta"))
    await socket.enqueue(try dictationFixtureEvent("transcript.final", sequence: 7, utterance: "u1", revision: 1, text: "final first"))
    await socket.enqueue(try dictationFixtureEvent("transcript.final", sequence: 8, utterance: "u2", revision: 5, text: "final second"))
    await socket.enqueue(try dictationFixtureEvent("transcript.final", sequence: 9, utterance: "u2", revision: 4, text: "stale final"))
    await socket.enqueue(try dictationFixtureEvent("transcript.segment", sequence: 10, utterance: "u1", revision: 100, text: "post-final partial"))
    try await dictationFixtureWait { transcript.snapshot().last == "final first final second" }
    try check(!finished.get(), "final transcript alone is not terminal before closed session.updated")
    await socket.enqueue(try dictationFixtureSessionEvent("session.updated", id: sessionID, status: "closed", sequence: 11))
    let finalText = try await finishTask.value
    try check(finalText == "final first final second", "final combines utterances in stable insertion order")
    try check(!transcript.snapshot().contains(where: { $0.contains("ignored delta") || $0.contains("stale final") || $0.contains("post-final") }), "delta and post-final/stale updates cannot leak into adopted transcript")
    try check(await credential.calls == 1, "one session obtains credential exactly once")
    let connections = await transport.connectionRequests()
    let posts = await transport.postRequests()
    try check(connections.count == 1 && posts.isEmpty, "streaming is exact-once with no silent HTTP fallback")
    try check(await socket.closeCalls == 1, "terminal adoption closes socket exactly once")

    // Multiple Stop calls share one result and one close request. Repeating
    // Stop after completion must not create a second credential/connect/send.
    let concurrentSocket = DictationFixtureSocket()
    let concurrentTransport = DictationFixtureTransport(socket: concurrentSocket)
    let concurrentSession = CodexDictationSession(sampleRate: 24_000, transport: concurrentTransport,
        credential: { token }, finishTimeout: 2)
    try await concurrentSession.start()
    let concurrentID = try await dictationFixtureStartID(concurrentSocket)
    await concurrentSocket.enqueue(try dictationFixtureSessionEvent("session.started", id: concurrentID, status: "active"))
    try await concurrentSession.appendPCM16(Data([1, 0]))
    let finishes = (0..<6).map { _ in Task { try await concurrentSession.finish() } }
    try await dictationFixtureWait { await concurrentSocket.messages().count >= 3 }
    await concurrentSocket.enqueue(try dictationFixtureEvent("transcript.final", sequence: 2, utterance: "one", revision: 0, text: "exact once"))
    await concurrentSocket.enqueue(try dictationFixtureSessionEvent("session.updated", id: concurrentID, status: "closed", sequence: 3))
    for task in finishes { try check(try await task.value == "exact once", "every concurrent finish receives the same final") }
    try check(await concurrentSocket.messages().count == 3, "concurrent finish sends one terminal frame")
    try check(await concurrentSocket.closeCalls == 1, "concurrent finish closes once")
    try check(await concurrentTransport.connectionRequests().count == 1, "concurrent finish never reconnects")
    try check(try await concurrentSession.finish() == "exact once", "repeat finish retains the adopted final")
    await concurrentSession.cancel()
    try check(try await concurrentSession.finish() == "exact once", "late cancel does not erase an already adopted final")
    let terminalMessageCount = await concurrentSocket.messages().count
    let terminalCloseCount = await concurrentSocket.closeCalls
    try check(terminalMessageCount == 3 && terminalCloseCount == 1, "repeat finish/late cancel cannot mutate transport state")

    // Cancel before Start never resolves credentials or opens a socket.
    let preCancelSocket = DictationFixtureSocket()
    let preCancelTransport = DictationFixtureTransport(socket: preCancelSocket)
    let preCancelCredential = DictationFixtureCredential()
    let preCancelled = CodexDictationSession(sampleRate: 24_000, transport: preCancelTransport,
        credential: { await preCancelCredential.load() })
    await preCancelled.cancel()
    try await rejectsAsync(.cancelled) { try await preCancelled.start() }
    try check(await preCancelCredential.calls == 0, "cancel-before-start never resolves credentials")
    try check(await preCancelTransport.connectionRequests().isEmpty, "cancel-before-start never connects")

    // Cancel while finishing terminates all finish waiters, closes exactly once,
    // discards partial text, and never silently submits batch transcription.
    let cancelSocket = DictationFixtureSocket()
    let cancelTransport = DictationFixtureTransport(socket: cancelSocket)
    let cancelCollector = DictationTranscriptCollector()
    let cancelSession = CodexDictationSession(sampleRate: 24_000, transport: cancelTransport,
        credential: { token }, onTranscript: { cancelCollector.append($0) }, finishTimeout: 2)
    try await cancelSession.start()
    let cancelID = try await dictationFixtureStartID(cancelSocket)
    await cancelSocket.enqueue(try dictationFixtureSessionEvent("session.started", id: cancelID, status: "active"))
    await cancelSocket.enqueue(try dictationFixtureEvent("transcript.segment", sequence: 2, utterance: "cancel-u", revision: 0, text: "unadopted partial"))
    try await dictationFixtureWait { cancelCollector.snapshot().last == "unadopted partial" }
    let cancelWaiter = Task { try await cancelSession.finish() }
    try await dictationFixtureWait { await cancelSocket.messages().count >= 2 }
    await cancelSession.cancel()
    try await rejectsAsync(.cancelled) { _ = try await cancelWaiter.value }
    await cancelSession.cancel()
    try check(await cancelSocket.closeCalls == 1, "repeated cancellation closes once")
    try check(await cancelTransport.postRequests().isEmpty, "cancel never triggers HTTP fallback")
    await cancelSocket.enqueue(try dictationFixtureEvent("transcript.final", sequence: 3, utterance: "cancel-u", revision: 1, text: "late ignored"))
    try await Task.sleep(nanoseconds: 5_000_000)
    try check(!cancelCollector.snapshot().contains("late ignored"), "late cancellation events cannot replace transcript")

    // Cancel a caller while connect is suspended, then return the newly created
    // socket. It must close without any session.start frame or receive loop.
    let heldConnectSocket = DictationFixtureSocket()
    let heldConnectTransport = DictationFixtureTransport(socket: heldConnectSocket)
    await heldConnectTransport.holdConnections()
    let heldConnectSession = CodexDictationSession(sampleRate: 24_000, transport: heldConnectTransport,
        credential: { token }, finishTimeout: 2)
    let heldConnectTask = Task { try await heldConnectSession.start() }
    try await dictationFixtureWait { await heldConnectTransport.connectionRequests().count == 1 }
    heldConnectTask.cancel()
    try await rejectsAsync(.cancelled) { _ = try await heldConnectSession.finish() }
    await heldConnectTransport.releaseConnections()
    try await rejectsAsync(.cancelled) { try await heldConnectTask.value }
    try check(await heldConnectSocket.messages().isEmpty, "socket returned after task cancellation receives zero start frames")
    try check(await heldConnectSocket.receiveCalls == 0, "connect cancellation never creates a receiver")
    try check(await heldConnectSocket.closeCalls == 1, "socket returned after cancellation closes exactly once")
    try check(await heldConnectTransport.postRequests().isEmpty, "connect cancellation never falls back to HTTP")

    // Cancel during session.start send. Releasing the suspended mock send after
    // cancellation must not spawn a receiver, retry start, or close twice.
    let heldSendSocket = DictationFixtureSocket()
    await heldSendSocket.holdSends()
    let heldSendTransport = DictationFixtureTransport(socket: heldSendSocket)
    let heldSendSession = CodexDictationSession(sampleRate: 24_000, transport: heldSendTransport,
        credential: { token }, finishTimeout: 2)
    let heldSendTask = Task { try await heldSendSession.start() }
    try await dictationFixtureWait { await heldSendSocket.messages().count == 1 }
    heldSendTask.cancel()
    try await rejectsAsync(.cancelled) { _ = try await heldSendSession.finish() }
    await heldSendSocket.releaseSends()
    try await rejectsAsync(.cancelled) { try await heldSendTask.value }
    try check(await heldSendSocket.messages().count == 1, "cancelled start send is never repeated")
    try check(await heldSendSocket.receiveCalls == 0, "start-send cancellation never begins receiving events")
    try check(await heldSendSocket.closeCalls == 1, "start-send cancellation closes exactly once")
    try check(await heldSendTransport.postRequests().isEmpty, "start-send cancellation does not switch ASR/provider")

    // No server close is a real timeout, not successful partial adoption.
    let timeoutSocket = DictationFixtureSocket()
    let timeoutTransport = DictationFixtureTransport(socket: timeoutSocket)
    let timeoutSession = CodexDictationSession(sampleRate: 24_000, transport: timeoutTransport,
        credential: { token }, finishTimeout: 0.03)
    try await timeoutSession.start()
    let timeoutID = try await dictationFixtureStartID(timeoutSocket)
    await timeoutSocket.enqueue(try dictationFixtureSessionEvent("session.started", id: timeoutID, status: "active"))
    await timeoutSocket.enqueue(try dictationFixtureEvent("transcript.final", sequence: 2, utterance: "timeout-u", revision: 0, text: "not closed"))
    let timeoutStart = ProcessInfo.processInfo.systemUptime
    try await rejectsAsync(.timedOut) { _ = try await timeoutSession.finish() }
    try check(ProcessInfo.processInfo.systemUptime - timeoutStart < 1, "timeout is bounded")
    try check(await timeoutSocket.closeCalls == 1, "timeout closes once")
    try check(await timeoutTransport.postRequests().isEmpty, "timeout is not a silent provider fallback")

    // A closed session with partial-only text must fail; no synthetic final.
    let partialSocket = DictationFixtureSocket()
    let partialTransport = DictationFixtureTransport(socket: partialSocket)
    let partialSession = CodexDictationSession(sampleRate: 24_000, transport: partialTransport,
        credential: { token }, finishTimeout: 2)
    try await partialSession.start()
    let partialID = try await dictationFixtureStartID(partialSocket)
    await partialSocket.enqueue(try dictationFixtureSessionEvent("session.started", id: partialID, status: "active"))
    await partialSocket.enqueue(try dictationFixtureEvent("transcript.segment", sequence: 2, utterance: "partial-u", revision: 0, text: "partial only"))
    let partialWaiter = Task { try await partialSession.finish() }
    try await dictationFixtureWait { await partialSocket.messages().count >= 2 }
    await partialSocket.enqueue(try dictationFixtureSessionEvent("session.updated", id: partialID, status: "closed", sequence: 3))
    try await rejectsAsync(.invalidResponse) { _ = try await partialWaiter.value }
    try check(await partialSocket.closeCalls == 1, "partial-only rejection closes once")

    let emptySocket = DictationFixtureSocket()
    let emptyTransport = DictationFixtureTransport(socket: emptySocket)
    let emptySession = CodexDictationSession(sampleRate: 24_000, transport: emptyTransport,
        credential: { token }, finishTimeout: 2)
    try await emptySession.start()
    let emptyID = try await dictationFixtureStartID(emptySocket)
    await emptySocket.enqueue(try dictationFixtureSessionEvent("session.started", id: emptyID, status: "active"))
    let emptyWaiter = Task { try await emptySession.finish() }
    try await dictationFixtureWait { await emptySocket.messages().count >= 2 }
    await emptySocket.enqueue(try dictationFixtureSessionEvent("session.updated", id: emptyID, status: "closed", sequence: 2))
    try await rejectsAsync(.emptyTranscript) { _ = try await emptyWaiter.value }
    try check(await emptySocket.closeCalls == 1, "empty transcript rejection closes once")

    // Raw transport/backend diagnostics never become a user-visible error.
    let connectionTransport = DictationFixtureTransport()
    await connectionTransport.failConnections()
    let connectionSession = CodexDictationSession(sampleRate: 24_000, transport: connectionTransport,
        credential: { token }, finishTimeout: 2)
    try await rejectsAsync(.transportFailed) { try await connectionSession.start() }
    try check(await connectionTransport.connectionRequests().count == 1, "connect failure is not retried")
    try check(await connectionTransport.postRequests().isEmpty, "connect failure does not switch to batch")

    let receiveSocket = DictationFixtureSocket()
    let receiveTransport = DictationFixtureTransport(socket: receiveSocket)
    let receiveSession = CodexDictationSession(sampleRate: 24_000, transport: receiveTransport,
        credential: { token }, finishTimeout: 2)
    try await receiveSession.start()
    let receiveWaiter = Task { try await receiveSession.finish() }
    await receiveSocket.failReceive()
    try await rejectsAsync(.transportFailed) { _ = try await receiveWaiter.value }
    try check(await receiveSocket.closeCalls == 1, "receive failure closes once")

    let malformedSocket = DictationFixtureSocket()
    let malformedTransport = DictationFixtureTransport(socket: malformedSocket)
    let malformedSession = CodexDictationSession(sampleRate: 24_000, transport: malformedTransport,
        credential: { token }, finishTimeout: 2)
    try await malformedSession.start()
    let malformedWaiter = Task { try await malformedSession.finish() }
    await malformedSocket.enqueue(Data("not-json raw fixture server message".utf8))
    try await rejectsAsync(.invalidResponse) { _ = try await malformedWaiter.value }
    try check(await malformedSocket.closeCalls == 1, "malformed message closes once")

    let serverSocket = DictationFixtureSocket()
    let serverTransport = DictationFixtureTransport(socket: serverSocket)
    let serverSession = CodexDictationSession(sampleRate: 24_000, transport: serverTransport,
        credential: { token }, finishTimeout: 2)
    try await serverSession.start()
    let serverWaiter = Task { try await serverSession.finish() }
    await serverSocket.enqueue(try dictationFixtureJSON(["type": "session.error", "sequence_no": 2, "message": "raw fixture server message", "code": "fixture-secret"] ))
    try await rejectsAsync(.serverRejected) { _ = try await serverWaiter.value }
    try check(await serverSocket.closeCalls == 1, "server rejection closes once")

    // The inspected native validator accepts numeric revisions/sequence values,
    // not an invented integer-only contract. A stale fractional final still
    // cannot replace a higher accepted fractional revision.
    let numericSocket = DictationFixtureSocket()
    let numericCollector = DictationTranscriptCollector()
    let numericSession = CodexDictationSession(sampleRate: 24_000,
        transport: DictationFixtureTransport(socket: numericSocket), credential: { token },
        onTranscript: { numericCollector.append($0) }, finishTimeout: 2)
    try await numericSession.start()
    let numericID = try await dictationFixtureStartID(numericSocket)
    await numericSocket.enqueue(try dictationFixtureJSON(["type": "session.started", "sequence_no": 0.5,
        "session": ["session_id": numericID, "status": "active", "config": ["provider_mode": "streaming_sse", "transcript_delivery_mode": "segment"]]]))
    let numericWaiter = Task { try await numericSession.finish() }
    try await dictationFixtureWait { await numericSocket.messages().count >= 2 }
    await numericSocket.enqueue(try dictationFixtureJSON(["type": "transcript.final", "sequence_no": 1.5,
        "utterance_id": "numeric-u", "revision": 0.5, "text": "numeric final"]))
    await numericSocket.enqueue(try dictationFixtureJSON(["type": "transcript.final", "sequence_no": 2.5,
        "utterance_id": "numeric-u", "revision": 0.25, "text": "stale numeric final"]))
    await numericSocket.enqueue(try dictationFixtureJSON(["type": "session.updated", "sequence_no": 3.5,
        "session": ["session_id": numericID, "status": "closed", "config": ["provider_mode": "streaming_sse", "transcript_delivery_mode": "segment"]]]))
    try check(try await numericWaiter.value == "numeric final", "fractional numeric sequence/revision values are supported")
    try check(!numericCollector.snapshot().contains("stale numeric final"), "stale fractional final is ignored")
    try check(await numericSocket.closeCalls == 1, "fractional revision session closes once")

    for payload: [String: Any] in [
        ["type": "transcript.final", "sequence_no": -1, "utterance_id": "invalid-u", "revision": 0, "text": "invalid sequence"],
        ["type": "transcript.final", "sequence_no": 1, "utterance_id": "invalid-u", "revision": -0.5, "text": "invalid revision"],
        ["type": "transcript.final", "sequence_no": 1, "utterance_id": "", "revision": 0, "text": "missing identity"],
        ["type": "transcript.final", "sequence_no": 1, "utterance_id": "invalid-u", "revision": 0],
    ] {
        let validationSocket = DictationFixtureSocket()
        let validationSession = CodexDictationSession(sampleRate: 24_000,
            transport: DictationFixtureTransport(socket: validationSocket), credential: { token }, finishTimeout: 2)
        try await validationSession.start()
        let validationWaiter = Task { try await validationSession.finish() }
        await validationSocket.enqueue(try dictationFixtureJSON(payload))
        try await rejectsAsync(.invalidResponse) { _ = try await validationWaiter.value }
        try check(await validationSocket.closeCalls == 1, "invalid event schema closes once")
    }

    // Buffer and state rejection is pre-send. Rejected append data cannot
    // silently replace the already queued audio or terminate a valid session.
    let bufferSocket = DictationFixtureSocket()
    let bufferTransport = DictationFixtureTransport(socket: bufferSocket)
    let bufferSession = CodexDictationSession(sampleRate: 24_000, transport: bufferTransport,
        credential: { token }, finishTimeout: 2)
    try await rejectsAsync(.invalidState) { try await bufferSession.appendPCM16(Data([1, 0])) }
    try await rejectsAsync(.invalidState) { _ = try await bufferSession.finish() }
    try await bufferSession.start()
    try await rejectsAsync(.invalidState) { try await bufferSession.start() }
    try await rejectsAsync(.invalidAudio) { try await bufferSession.appendPCM16(Data()) }
    try await rejectsAsync(.invalidAudio) { try await bufferSession.appendPCM16(Data([1])) }
    try await rejectsAsync(.messageTooLarge) { try await bufferSession.appendPCM16(Data(repeating: 0, count: 4_194_306)) }
    try await bufferSession.appendPCM16(Data(repeating: 0, count: 4_194_304))
    try await rejectsAsync(.messageTooLarge) { try await bufferSession.appendPCM16(Data([1, 0])) }
    try check(await bufferSocket.messages().count == 1, "rejected/queued startup audio never escapes before ack")
    await bufferSession.cancel()
    try check(await bufferSocket.closeCalls == 1, "buffer cancellation frees session exactly once")
    try await rejectsAsync(.cancelled) { try await bufferSession.appendPCM16(Data([1, 0])) }

    // The active send queue has the same bounded capacity as startup. A
    // concurrent append cannot grow memory past it while a send is suspended.
    let activeBufferSocket = DictationFixtureSocket()
    let activeBufferTransport = DictationFixtureTransport(socket: activeBufferSocket)
    let activeBufferSession = CodexDictationSession(sampleRate: 24_000, transport: activeBufferTransport,
        credential: { token }, finishTimeout: 2)
    try await activeBufferSession.start()
    let activeBufferID = try await dictationFixtureStartID(activeBufferSocket)
    await activeBufferSocket.enqueue(try dictationFixtureSessionEvent("session.started", id: activeBufferID, status: "active"))
    try await activeBufferSession.appendPCM16(Data([1, 0]))
    try await dictationFixtureWait { await activeBufferSocket.messages().count == 2 }
    await activeBufferSocket.holdSends()
    let activeAppendTask = Task { try await activeBufferSession.appendPCM16(Data(repeating: 0, count: 4_194_304)) }
    try await dictationFixtureWait { await activeBufferSocket.messages().count == 3 }
    try await rejectsAsync(.messageTooLarge) { try await activeBufferSession.appendPCM16(Data([2, 0])) }
    try check(await activeBufferSocket.messages().count == 3, "active in-flight overflow is rejected before send")
    activeAppendTask.cancel()
    try await rejectsAsync(.cancelled) { _ = try await activeBufferSession.finish() }
    await activeBufferSocket.releaseSends()
    try await rejectsAsync(.cancelled) { try await activeAppendTask.value }
    try check(await activeBufferSocket.closeCalls == 1, "cancelled held active append closes exactly once")
    try check(await activeBufferTransport.postRequests().isEmpty, "active append cancellation never invokes batch fallback")

    let tooLargeSocket = DictationFixtureSocket()
    let tooLargeSession = CodexDictationSession(sampleRate: 24_000,
        transport: DictationFixtureTransport(socket: tooLargeSocket), credential: { token }, finishTimeout: 2)
    try await tooLargeSession.start()
    let tooLargeWaiter = Task { try await tooLargeSession.finish() }
    await tooLargeSocket.enqueue(Data(repeating: 65, count: 4_194_305))
    try await rejectsAsync(.messageTooLarge) { _ = try await tooLargeWaiter.value }
    try check(await tooLargeSocket.closeCalls == 1, "oversized response closes session exactly once")

    let sendFailureSocket = DictationFixtureSocket()
    let sendFailureSession = CodexDictationSession(sampleRate: 24_000,
        transport: DictationFixtureTransport(socket: sendFailureSocket), credential: { token }, finishTimeout: 2)
    try await sendFailureSession.start()
    let sendFailureID = try await dictationFixtureStartID(sendFailureSocket)
    await sendFailureSocket.failSends()
    try await sendFailureSession.appendPCM16(Data([1, 0]))
    let sendFailureWaiter = Task { try await sendFailureSession.finish() }
    await sendFailureSocket.enqueue(try dictationFixtureSessionEvent("session.started", id: sendFailureID, status: "active"))
    try await rejectsAsync(.transportFailed) { _ = try await sendFailureWaiter.value }
    try check(await sendFailureSocket.messages().count == 1, "failed audio send does not transmit a close/retry payload")
    try check(await sendFailureSocket.closeCalls == 1, "failed queued send closes exactly once")

    let fixedErrors: [CodexDictationError] = [.credentialUnavailable, .invalidCredential, .invalidAudio, .invalidRequest,
        .invalidState, .cancelled, .timedOut, .transportFailed, .serverRejected, .invalidResponse, .messageTooLarge, .emptyTranscript]
    for error in fixedErrors {
        let description = error.localizedDescription
        try check(!description.isEmpty, "every dictation error has a fixed description")
        try check(!description.contains(token) && !description.contains("raw fixture server") && !description.contains("rawTransportSentinel"), "fixed error descriptions contain no source diagnostics/credentials")
    }

    print("Codex native dictation: \(count) zero-network builder/lifecycle checks passed")
}
