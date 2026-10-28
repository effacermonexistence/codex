import Foundation
import Darwin
import OS1Context

// `os1 dictation transcribe` core. Injected transport and fixture-only token:
// no URLSession, account store, Codex CLI, microphone or provider endpoint.
private enum FileDictationFixtureFailure: Error {
    case failed(String)
    case deadline
    case rawTransportSentinel
}

private final class FileDictationFixtureBox<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value
    init(_ value: Value) { self.value = value }
    func get() -> Value { lock.withLock { value } }
    func set(_ newValue: Value) { lock.withLock { value = newValue } }
}

private actor FileDictationFixtureCredential {
    private(set) var calls = 0
    private let result: Result<String, CodexDictationError>
    init(_ result: Result<String, CodexDictationError>) { self.result = result }
    func load() throws -> String { calls += 1; return try result.get() }
}

private actor FileDictationFixtureTransport: CodexDictationTransport {
    private var posts: [URLRequest] = []
    private var connects = 0
    private let response: CodexDictationHTTPResponse?
    private let hold: Bool
    private var held: CheckedContinuation<Void, Never>?
    init(response: CodexDictationHTTPResponse? = .init(data: Data("{\"text\":\"슈뢰딩거 방정식 설명해줘\"}".utf8), statusCode: 200),
         hold: Bool = false) {
        self.response = response; self.hold = hold
    }
    func connect(_ request: URLRequest) async throws -> any CodexDictationSocket {
        connects += 1
        throw FileDictationFixtureFailure.rawTransportSentinel
    }
    func post(_ request: URLRequest) async throws -> CodexDictationHTTPResponse {
        posts.append(request)
        // A held post ignores cancellation, the worst case for the deadline.
        if hold { await withCheckedContinuation { held = $0 } }
        guard let response else { throw FileDictationFixtureFailure.rawTransportSentinel }
        return response
    }
    func release() { held?.resume(); held = nil }
    func postRequests() -> [URLRequest] { posts }
    func connectCount() -> Int { connects }
}

private final class FileDictationOutput: @unchecked Sendable {
    private let lock = NSLock()
    private var out: [String] = [], err: [String] = []
    func stdout(_ line: String) { lock.withLock { out.append(line) } }
    func stderr(_ line: String) { lock.withLock { err.append(line) } }
    var standardOutput: [String] { lock.withLock { out } }
    var standardError: [String] { lock.withLock { err } }
}

/// Sync entry point for the CLT-only fixture runner; the worker is detached.
func runCodexDictationFileTranscriptionFixtures() throws {
    let result = FileDictationFixtureBox<Result<Void, any Error>?>(nil)
    let semaphore = DispatchSemaphore(value: 0)
    let worker = Task.detached {
        do { try await codexDictationFileTranscriptionChecks(); result.set(.success(())) }
        catch { result.set(.failure(error)) }
        semaphore.signal()
    }
    guard semaphore.wait(timeout: .now() + 60) == .success else {
        worker.cancel(); throw FileDictationFixtureFailure.deadline
    }
    guard let value = result.get() else { throw FileDictationFixtureFailure.deadline }
    try value.get()
}

private func codexDictationFileTranscriptionChecks() async throws {
    var count = 0
    func check(_ value: Bool, _ message: String) throws {
        guard value else { throw FileDictationFixtureFailure.failed(message) }
        count += 1
    }
    typealias Status = CodexDictationFileTranscription.ExitStatus
    typealias Rejection = CodexDictationFileTranscription.FileRejection
    let token = "os1-file-dictation-fixture-only"

    let root = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        .appendingPathComponent("os1-file-dictation-" + UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false,
                                            attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: root) }
    let pcm = try CodexNativeDictation.pcm16(interleavedSamples: (0..<1_600).map { Float(sin(Double($0) / 9)) * 0.4 }, channels: 1)
    let wav = try CodexNativeDictation.wav(pcm16: pcm, sampleRate: 16_000)
    let good = root.appendingPathComponent("handy-recording.wav")
    try wav.write(to: good)

    func run(_ arguments: [String], credential: FileDictationFixtureCredential = .init(.success("os1-file-dictation-fixture-only")),
             transport: FileDictationFixtureTransport = .init(),
             owner: uid_t = geteuid()) async -> (Int32, FileDictationOutput) {
        let output = FileDictationOutput()
        let status = await CodexDictationFileTranscription.run(arguments, credential: { try await credential.load() },
            transport: transport, owner: owner, standardOutput: output.stdout, standardError: output.stderr)
        return (status, output)
    }
    func boundary(of request: URLRequest) -> String? {
        guard let value = request.value(forHTTPHeaderField: "Content-Type"),
              value.hasPrefix("multipart/form-data; boundary=") else { return nil }
        return String(value.dropFirst("multipart/form-data; boundary=".count))
    }
    func sameRequest(_ actual: URLRequest, _ expected: URLRequest) -> Bool {
        actual.url == expected.url && actual.httpMethod == expected.httpMethod &&
            actual.allHTTPHeaderFields == expected.allHTTPHeaderFields && actual.httpBody == expected.httpBody &&
            actual.timeoutInterval == expected.timeoutInterval && actual.cachePolicy == expected.cachePolicy
    }

    // 1. Success: stdout is the transcript only, the request is the App's
    // builder output for the same bytes and language, one credential read.
    let koCredential = FileDictationFixtureCredential(.success(token))
    let koTransport = FileDictationFixtureTransport()
    let (koStatus, koOutput) = await run(["dictation", "transcribe", "--wav", good.path, "--language", "ko"],
                                         credential: koCredential, transport: koTransport)
    try check(koStatus == Status.transcribed.rawValue && koStatus == 0, "a transcribed file exits 0")
    try check(koOutput.standardOutput == ["슈뢰딩거 방정식 설명해줘"], "stdout carries exactly the service transcript")
    try check(koOutput.standardError.isEmpty, "a success writes nothing to stderr")
    try check(await koCredential.calls == 1, "the credential is read exactly once")
    let koPosts = await koTransport.postRequests()
    let koConnects = await koTransport.connectCount()
    try check(koPosts.count == 1 && koConnects == 0, "one batch POST, never a stream")
    guard let koBoundary = boundary(of: koPosts[0]) else { throw FileDictationFixtureFailure.failed("multipart boundary") }
    let expectedKo = try CodexNativeDictation.transcriptionRequest(wav: wav, bearerToken: token, language: "ko", boundary: koBoundary)
    try check(sameRequest(koPosts[0], expectedKo), "the CLI request equals the App builder's request for the same WAV and language")
    try check(koPosts[0].url?.absoluteString == "https://chatgpt.com/backend-api/transcribe", "the Codex desktop batch endpoint")
    let koBody = String(decoding: koPosts[0].httpBody ?? Data(), as: UTF8.self)
    try check(koBody.contains("name=\"language\"\r\n\r\nko\r\n"), "--language ko reaches the multipart language field")
    try check(koBody.contains("filename=\"codex.wav\"\r\nContent-Type: audio/wav"), "the WAV is uploaded as the App uploads it")
    try check(koPosts[0].httpBody?.range(of: wav) != nil, "the exact file bytes are uploaded")

    // 2. Without a language (or with auto) the request equals the App's own
    // batch call, CodexNativeDictation.transcribe(wav:credential:transport:).
    let appTransport = FileDictationFixtureTransport()
    let appText = try await CodexNativeDictation.transcribe(wav: wav, credential: { token }, transport: appTransport)
    let appPosts = await appTransport.postRequests()
    for arguments in [["dictation", "transcribe", "--wav", good.path],
                      ["dictation", "transcribe", "--language", "auto", "--wav", good.path, "--timeout-seconds", "30"]] {
        let transport = FileDictationFixtureTransport()
        let (status, output) = await run(arguments, transport: transport)
        let posts = await transport.postRequests()
        try check(status == 0 && output.standardOutput == [appText], "auto/no language succeeds with the App's transcript")
        guard posts.count == 1, appPosts.count == 1, let cliBoundary = boundary(of: posts[0]) else {
            throw FileDictationFixtureFailure.failed("one CLI and one App request")
        }
        let appBody = String(decoding: appPosts[0].httpBody ?? Data(), as: UTF8.self)
        let rebased = boundary(of: appPosts[0]).map { appBody.replacingOccurrences(of: $0, with: cliBoundary) } ?? ""
        try check(String(decoding: posts[0].httpBody ?? Data(), as: UTF8.self) == rebased, "no-language body equals the App's body")
        try check(!rebased.contains("name=\"language\""), "auto sends no language field, as the App")
        var appHeaders = appPosts[0].allHTTPHeaderFields ?? [:]
        appHeaders["Content-Type"] = "multipart/form-data; boundary=" + cliBoundary
        try check(posts[0].allHTTPHeaderFields == appHeaders && posts[0].url == appPosts[0].url &&
                  posts[0].httpMethod == appPosts[0].httpMethod, "headers, URL and method equal the App's batch request")
    }
    let options = try CodexDictationFileTranscription.parse(["dictation", "transcribe", "--wav", "/x.wav", "--language", "ko-KR", "--timeout-seconds", "45"])
    try check(options == .init(path: "/x.wav", language: "ko-KR", timeoutSeconds: 45), "parsed options keep path, language and timeout")
    try check(try CodexDictationFileTranscription.parse(["dictation", "transcribe", "--wav", "/x.wav"]).timeoutSeconds == 90,
              "the default deadline is 90 seconds")

    // 3. Distinct exit statuses; failures never reach stdout or print the token.
    let statuses = Status.allCases.map(\.rawValue)
    try check(Set(statuses).count == statuses.count, "every exit status is distinct")
    try check(Set([Status.noCredential, .transportFailed, .serviceRejected, .emptyTranscript].map(\.rawValue)).count == 4 &&
              !statuses.contains(1), "credential/transport/rejected/empty are distinct and never the generic CLI failure 1")
    let mapped: [(CodexDictationError, Status)] = [(.credentialUnavailable, .noCredential), (.invalidCredential, .noCredential),
        (.transportFailed, .transportFailed), (.cancelled, .transportFailed), (.invalidState, .transportFailed),
        (.timedOut, .timedOut), (.serverRejected, .serviceRejected), (.emptyTranscript, .emptyTranscript),
        (.invalidResponse, .invalidResponse), (.messageTooLarge, .invalidResponse),
        (.invalidAudio, .audioRejected), (.invalidRequest, .audioRejected)]
    for (error, expected) in mapped {
        try check(CodexDictationFileTranscription.exitStatus(for: error) == expected, "error mapping \(error)")
    }
    func failure(_ name: String, credential: FileDictationFixtureCredential = .init(.success("os1-file-dictation-fixture-only")),
                 transport: FileDictationFixtureTransport, expected: Status, posts: Int) async throws {
        let (status, output) = await run(["dictation", "transcribe", "--wav", good.path], credential: credential, transport: transport)
        try check(status == expected.rawValue, "\(name) exits \(expected.rawValue), got \(status)")
        try check(output.standardOutput.isEmpty, "\(name) writes nothing to stdout")
        try check(output.standardError.count == 1 && output.standardError[0].contains("(exit \(expected.rawValue))"),
                  "\(name) writes one fixed stderr line")
        try check(!output.standardError.joined().contains(token) && !output.standardError.joined().contains("raw fixture"),
                  "\(name) never prints the token or a server body")
        try check(await transport.postRequests().count == posts, "\(name) POST count")
    }
    let missing = FileDictationFixtureCredential(.failure(.credentialUnavailable))
    try await failure("no credential", credential: missing, transport: .init(), expected: .noCredential, posts: 0)
    try check(await missing.calls == 1, "a missing credential is asked for once, no retry")
    try await failure("invalid credential", credential: .init(.failure(.invalidCredential)), transport: .init(),
                      expected: .noCredential, posts: 0)
    try await failure("malformed token", credential: .init(.success("bad token\r\nInjected: yes")), transport: .init(),
                      expected: .noCredential, posts: 0)
    try await failure("transport", transport: .init(response: nil), expected: .transportFailed, posts: 1)
    for code in [401, 403, 429, 500] {
        try await failure("HTTP \(code)", transport: .init(response: .init(data: Data("raw fixture body".utf8), statusCode: code)),
                          expected: .serviceRejected, posts: 1)
    }
    for body in ["{\"text\":\"\"}", "{\"text\":\"  \\n \"}"] {
        try await failure("empty transcript", transport: .init(response: .init(data: Data(body.utf8), statusCode: 200)),
                          expected: .emptyTranscript, posts: 1)
    }
    try await failure("invalid response", transport: .init(response: .init(data: Data("raw fixture not json".utf8), statusCode: 200)),
                      expected: .invalidResponse, posts: 1)

    // 4. Deadline: a POST that ignores cancellation still ends at the limit
    // plus the bounded cancellation grace, with exit 6 and no retry.
    let heldTransport = FileDictationFixtureTransport(hold: true)
    let started = Date()
    let (heldStatus, heldOutput) = await run(["dictation", "transcribe", "--wav", good.path, "--timeout-seconds", "1"],
                                             transport: heldTransport)
    let elapsed = Date().timeIntervalSince(started)
    await heldTransport.release()
    try check(heldStatus == Status.timedOut.rawValue && heldOutput.standardOutput.isEmpty, "a held POST times out with exit 6")
    try check(elapsed >= 0.9 && elapsed < 1 + CodexDictationFileTranscription.cancellationGraceSeconds + 1.5,
              "the deadline bounds the command (\(elapsed)s)")
    try check(await heldTransport.postRequests().count == 1, "a timed-out POST is not repeated")

    // 5. Usage errors exit 2 before any file, credential or transport use.
    let untouched = FileDictationFixtureCredential(.success(token)), unusedTransport = FileDictationFixtureTransport()
    for arguments in [["dictation", "transcribe"], ["dictation", "record", "--wav", good.path],
                      ["dictation", "transcribe", "--wav"], ["dictation", "transcribe", "--wav", good.path, "--wav", good.path],
                      ["dictation", "transcribe", "--wav", good.path, "--language", "ko\r\nInjected"],
                      ["dictation", "transcribe", "--wav", good.path, "--language", "ko", "--language", "en"],
                      ["dictation", "transcribe", "--wav", good.path, "--timeout-seconds", "0"],
                      ["dictation", "transcribe", "--wav", good.path, "--timeout-seconds", "301"],
                      ["dictation", "transcribe", "--wav", good.path, "--timeout-seconds", "nan"],
                      ["dictation", "transcribe", "--wav", good.path, "--model", "gpt-4o-transcribe"],
                      ["dictation", "transcribe", "--language", "ko", "--timeout-seconds", "5"],
                      ["dictation", "transcribe", "--wav", "--language"]] {
        let (status, output) = await run(arguments, credential: untouched, transport: unusedTransport)
        try check(status == Status.usage.rawValue && output.standardOutput.isEmpty, "usage error: \(arguments)")
    }
    let untouchedCalls = await untouched.calls, unusedPosts = await unusedTransport.postRequests()
    try check(untouchedCalls == 0 && unusedPosts.isEmpty, "usage errors touch no credential or transport")

    // 6. File bounds: owner-owned regular .wav, no symlink, RIFF/WAVE, size.
    func rejected(_ path: String, _ expected: Rejection, owner: uid_t = geteuid(), _ label: String) throws {
        do { _ = try CodexDictationFileTranscription.readOwnedWAV(at: path, owner: owner) }
        catch let error as Rejection { try check(error == expected, "\(label): expected \(expected), got \(error)"); return }
        throw FileDictationFixtureFailure.failed("\(label) was accepted")
    }
    try check(try CodexDictationFileTranscription.readOwnedWAV(at: good.path) == wav, "an owned WAV is read byte-exact")
    let link = root.appendingPathComponent("link.wav")
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: good)
    try rejected(link.path, .symbolicLink, "a symlinked final component")
    let directory = root.appendingPathComponent("folder.wav")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
    try rejected(directory.path, .notRegularFile, "a directory")
    let fifo = root.appendingPathComponent("pipe.wav")
    try check(mkfifo(fifo.path, 0o600) == 0, "fixture FIFO")
    try rejected(fifo.path, .notRegularFile, "a FIFO (never opened, never blocks)")
    try rejected(good.path, .notOwned, owner: geteuid() &+ 1, "a file another user owns")
    try rejected(root.appendingPathComponent("absent.wav").path, .missing, "a missing file")
    let mp3 = root.appendingPathComponent("recording.mp3"); try wav.write(to: mp3)
    try rejected(mp3.path, .notWAVName, "a non-.wav name")
    try rejected(root.path + "/../" + root.lastPathComponent + "/handy-recording.wav", .invalidPath, "a dot-dot path")
    try rejected("", .invalidPath, "an empty path")
    let tiny = root.appendingPathComponent("tiny.wav"); try Data("RIFF".utf8).write(to: tiny)
    try rejected(tiny.path, .tooSmall, "a header-less file")
    let fake = root.appendingPathComponent("fake.wav"); try Data(repeating: 0x41, count: 64).write(to: fake)
    try rejected(fake.path, .notWAVContent, "a .wav name without RIFF/WAVE bytes")
    func sparse(_ name: String, bytes: Int) throws -> URL {
        let url = root.appendingPathComponent(name)
        try wav.prefix(44).write(to: url)
        let handle = try FileHandle(forWritingTo: url)
        try handle.truncate(atOffset: UInt64(bytes)); try handle.close()
        return url
    }
    let huge = try sparse("huge.wav", bytes: CodexDictationFileTranscription.maximumFileBytes + 1)
    try rejected(huge.path, .tooLarge, "a file over 25 MiB")
    try check(CodexDictationFileTranscription.maximumFileBytes == 25 * 1_024 * 1_024, "the file bound is the bridge's 25 MiB")
    let readBound = try sparse("bound.wav", bytes: 4_096)
    try check((try? CodexDictationFileTranscription.readOwnedWAV(at: readBound.path, maximumBytes: 4_096))?.count == 4_096,
              "a file exactly at the bound is read whole")
    do { _ = try CodexDictationFileTranscription.readOwnedWAV(at: readBound.path, maximumBytes: 4_095); throw FileDictationFixtureFailure.failed("bound") }
    catch let error as Rejection { try check(error == .tooLarge, "one byte over the bound is rejected") }

    // The upload limit mirrors the App's request builder exactly.
    let limit = CodexDictationFileTranscription.maximumUploadBytes
    var atLimit = Data(wav.prefix(44)); atLimit.append(Data(count: limit - 44))
    try check((try? CodexNativeDictation.transcriptionRequest(wav: atLimit, bearerToken: token)) != nil, "the builder accepts the upload limit")
    atLimit.append(0)
    do { _ = try CodexNativeDictation.transcriptionRequest(wav: atLimit, bearerToken: token); throw FileDictationFixtureFailure.failed("limit") }
    catch let error as CodexDictationError { try check(error == .invalidRequest, "the builder rejects one byte over the upload limit") }
    let overUpload = try sparse("over-upload.wav", bytes: limit + 1)
    let fileCredential = FileDictationFixtureCredential(.success(token)), fileTransport = FileDictationFixtureTransport()
    for (path, reason) in [(overUpload.path, "over_upload_limit"), (huge.path, "too_large"), (link.path, "symbolic_link"),
                           (fifo.path, "not_regular_file"), (fake.path, "not_wav_content"), (mp3.path, "not_wav_name"),
                           (root.appendingPathComponent("absent.wav").path, "missing")] {
        let (status, output) = await run(["dictation", "transcribe", "--wav", path], credential: fileCredential, transport: fileTransport)
        try check(status == Status.audioRejected.rawValue && output.standardOutput.isEmpty, "rejected audio exits 3: \(path)")
        try check(output.standardError == ["OS-1 dictation: \(Status.audioRejected.message) [\(reason)] (exit 3)"],
                  "the rejection names its fixed reason only: \(reason)")
    }
    let (notOwnedStatus, _) = await run(["dictation", "transcribe", "--wav", good.path], credential: fileCredential,
                                        transport: fileTransport, owner: geteuid() &+ 1)
    try check(notOwnedStatus == Status.audioRejected.rawValue, "a foreign-owned file exits 3")
    let fileCalls = await fileCredential.calls, filePosts = await fileTransport.postRequests()
    try check(fileCalls == 0 && filePosts.isEmpty,
              "a rejected file never reads the credential or reaches the transport")

    print("Codex file dictation (os1 dictation transcribe): \(count) zero-network checks passed")
}
