import Foundation
import Darwin

/// `os1 dictation transcribe --wav PATH`: one owner-owned WAV file through the
/// exact Codex-native batch lane OS1App uses
/// (`CodexNativeDictation.transcribe(wav:)`, chatgpt.com/backend-api/transcribe).
/// The caller supplies the credential and transport; the CLI passes the App's
/// own defaults, `CodexDictationAuthorization.credential()` and
/// `CodexDictationURLSessionTransport()`. Nothing here discovers, stores or
/// prints a credential, records audio, runs a local recognizer or falls back to
/// another service. The file is caller-named audio input only; it is never a
/// credential or executable source.
public enum CodexDictationFileTranscription {
    /// Read bound for the input file (the Handy bridge's own bound). The batch
    /// request itself keeps the App's 16 MiB upload limit; a larger WAV is
    /// rejected as audio, not truncated.
    public static let maximumFileBytes = 25 * 1_024 * 1_024
    /// `CodexNativeDictation.transcriptionRequest(audio:)`'s own upload limit,
    /// checked before the credential is requested (fixture-pinned to the builder).
    public static let maximumUploadBytes = 16 * 1_024 * 1_024
    public static let defaultTimeoutSeconds: TimeInterval = 90
    public static let timeoutSecondsRange: ClosedRange<TimeInterval> = 1...300
    /// After a deadline the in-flight work is cancelled and given this long to
    /// release its own child (the Codex CLI authorization process) before exit.
    public static let cancellationGraceSeconds: TimeInterval = 2
    public static let usageText =
        "Expected: os1 dictation transcribe --wav /path/recording.wav [--language ko|auto] [--timeout-seconds 1...300] [--output text|json]"
    /// `--output json` prints exactly `{"schema":transcriptSchema,"text":...}`, so
    /// a caller (the Handy bridge) can tell a transcript from an older os1's
    /// usage text, which an unknown command prints on stdout with exit 0.
    public static let transcriptSchema = "os1.dictation.transcript.v1"

    /// Distinct, documented process exit statuses. Stdout carries only the
    /// transcript on `transcribed`; every other status writes nothing to stdout.
    public enum ExitStatus: Int32, CaseIterable, Sendable {
        case transcribed = 0
        case usage = 2
        case audioRejected = 3
        case noCredential = 4
        case transportFailed = 5
        case timedOut = 6
        case serviceRejected = 7
        case emptyTranscript = 8
        case invalidResponse = 9

        public var message: String {
            switch self {
            case .transcribed: "transcribed"
            case .usage: usageText
            case .audioRejected: "the audio file was rejected (owner-owned regular .wav file, RIFF/WAVE, at most the Codex batch upload size)"
            case .noCredential: "no Codex ChatGPT sign-in credential is available; sign in to Codex and retry"
            case .transportFailed: "the Codex dictation connection failed"
            case .timedOut: "the Codex dictation request timed out"
            case .serviceRejected: "the Codex dictation service rejected the request"
            case .emptyTranscript: "the Codex dictation service returned an empty transcript"
            case .invalidResponse: "the Codex dictation service returned an invalid response"
            }
        }
    }

    public enum FileRejection: String, Error, Equatable, Sendable {
        case invalidPath = "invalid_path", notWAVName = "not_wav_name", missing, symbolicLink = "symbolic_link"
        case notRegularFile = "not_regular_file", notOwned = "not_owned", tooSmall = "too_small", tooLarge = "too_large"
        case unreadable, notWAVContent = "not_wav_content", changedDuringRead = "changed_during_read"
        case overUploadLimit = "over_upload_limit"
    }

    public enum OutputFormat: String, Equatable, Sendable { case text, json }

    public struct Options: Equatable, Sendable {
        public let path: String
        public let language: String?
        public let timeoutSeconds: TimeInterval
        public let output: OutputFormat
        public init(path: String, language: String?, timeoutSeconds: TimeInterval, output: OutputFormat = .text) {
            self.path = path; self.language = language; self.timeoutSeconds = timeoutSeconds; self.output = output
        }
    }

    public struct UsageError: Error, Equatable, Sendable {}

    /// Accepts the full argument vector without the executable name:
    /// `dictation transcribe --wav PATH [--language CODE] [--timeout-seconds N] [--output text|json]`.
    public static func parse(_ arguments: [String]) throws -> Options {
        guard arguments.count >= 4, arguments.count <= 10, arguments[0] == "dictation", arguments[1] == "transcribe",
              arguments.count % 2 == 0 else { throw UsageError() }
        var path: String?, language: String?, languageSeen = false, timeout: TimeInterval?, output: OutputFormat?
        var index = 2
        while index < arguments.count {
            let name = arguments[index], value = arguments[index + 1]
            switch name {
            case "--wav":
                guard path == nil, !value.isEmpty, !value.hasPrefix("--") else { throw UsageError() }
                path = value
            case "--language":
                guard !languageSeen else { throw UsageError() }
                languageSeen = true
                do { language = try CodexNativeDictation.normalizedLanguage(value) } catch { throw UsageError() }
            case "--timeout-seconds":
                guard timeout == nil, let seconds = TimeInterval(value), seconds.isFinite,
                      timeoutSecondsRange.contains(seconds) else { throw UsageError() }
                timeout = seconds
            case "--output":
                guard output == nil, let format = OutputFormat(rawValue: value) else { throw UsageError() }
                output = format
            default: throw UsageError()
            }
            index += 2
        }
        guard let path else { throw UsageError() }
        return Options(path: path, language: language, timeoutSeconds: timeout ?? defaultTimeoutSeconds,
                       output: output ?? .text)
    }

    /// Reads one WAV the current user owns. The final path component is never
    /// followed (lstat + O_NOFOLLOW), the opened descriptor must be the same
    /// regular file that was inspected, and at most `maximumBytes + 1` bytes are
    /// ever read, so a growing or swapped file cannot exceed the bound.
    public static func readOwnedWAV(at path: String, maximumBytes: Int = maximumFileBytes,
                                    owner: uid_t = geteuid()) throws -> Data {
        guard !path.isEmpty, path.utf8.count <= Int(PATH_MAX) - 1, !path.utf8.contains(0),
              maximumBytes >= 44 else { throw FileRejection.invalidPath }
        let absolute = path.hasPrefix("/") ? path : FileManager.default.currentDirectoryPath + "/" + path
        let components = absolute.split(separator: "/", omittingEmptySubsequences: true)
        guard !components.contains(where: { $0 == "." || $0 == ".." }), let name = components.last else {
            throw FileRejection.invalidPath
        }
        guard name.count > 4, name.lowercased().hasSuffix(".wav") else { throw FileRejection.notWAVName }

        var inspected = stat()
        guard lstat(absolute, &inspected) == 0 else {
            throw errno == ENOENT || errno == ENOTDIR ? FileRejection.missing : FileRejection.unreadable
        }
        guard inspected.st_mode & S_IFMT != S_IFLNK else { throw FileRejection.symbolicLink }
        guard inspected.st_mode & S_IFMT == S_IFREG else { throw FileRejection.notRegularFile }
        guard inspected.st_uid == owner else { throw FileRejection.notOwned }

        // O_NONBLOCK: a FIFO swapped in after lstat cannot block the open.
        let descriptor = open(absolute, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard descriptor >= 0 else { throw errno == ELOOP ? FileRejection.symbolicLink : FileRejection.unreadable }
        defer { close(descriptor) }
        var opened = stat()
        guard fstat(descriptor, &opened) == 0 else { throw FileRejection.unreadable }
        guard opened.st_mode & S_IFMT == S_IFREG, opened.st_dev == inspected.st_dev,
              opened.st_ino == inspected.st_ino else { throw FileRejection.changedDuringRead }
        guard opened.st_uid == owner else { throw FileRejection.notOwned }
        guard opened.st_size >= 44 else { throw FileRejection.tooSmall }
        guard opened.st_size <= off_t(maximumBytes) else { throw FileRejection.tooLarge }

        var data = Data(); data.reserveCapacity(Int(opened.st_size))
        var buffer = [UInt8](repeating: 0, count: 65_536)
        while true {
            let remaining = maximumBytes + 1 - data.count
            let count = buffer.withUnsafeMutableBytes { Darwin.read(descriptor, $0.baseAddress, min($0.count, remaining)) }
            if count == 0 { break }
            if count < 0 {
                if errno == EINTR { continue }
                throw FileRejection.unreadable
            }
            data.append(contentsOf: buffer.prefix(count))
            guard data.count <= maximumBytes else { throw FileRejection.tooLarge }
        }
        guard data.count >= 44 else { throw FileRejection.tooSmall }
        guard data.prefix(4) == Data("RIFF".utf8), data.subdata(in: 8..<12) == Data("WAVE".utf8) else {
            throw FileRejection.notWAVContent
        }
        return data
    }

    /// The `--output json` line: exactly the keys `schema` and `text`.
    public static func transcriptEnvelope(_ text: String) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return String(decoding: try encoder.encode(["schema": transcriptSchema, "text": text]), as: UTF8.self)
    }

    public static func exitStatus(for error: CodexDictationError) -> ExitStatus {
        switch error {
        case .credentialUnavailable, .invalidCredential: .noCredential
        case .invalidAudio, .invalidRequest: .audioRejected
        case .transportFailed, .cancelled, .invalidState: .transportFailed
        case .timedOut: .timedOut
        case .serverRejected: .serviceRejected
        case .emptyTranscript: .emptyTranscript
        case .invalidResponse, .messageTooLarge: .invalidResponse
        }
    }

    /// The App's batch call with an outer deadline. A non-empty transcript is
    /// required, as the App requires before publishing one.
    public static func transcribe(wav: Data, language: String?, timeoutSeconds: TimeInterval,
                                  credential: @escaping CodexNativeDictation.Credential,
                                  transport: any CodexDictationTransport) async throws -> String {
        guard timeoutSeconds.isFinite, timeoutSecondsRange.contains(timeoutSeconds) else {
            throw CodexDictationError.invalidRequest
        }
        let work = Task<String, any Error> {
            let text = try await CodexNativeDictation.transcribe(wav: wav, language: language,
                                                                 credential: credential, transport: transport)
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw CodexDictationError.emptyTranscript
            }
            return text
        }
        let outcome = await CodexDictationDeadline.race(work, seconds: timeoutSeconds)
        switch outcome {
        case .success(let text): return text
        case .failure(let error):
            if error == .timedOut {
                work.cancel()
                // Let the cancelled credential child terminate before the CLI exits.
                _ = await CodexDictationDeadline.race(work, seconds: cancellationGraceSeconds)
            }
            throw error
        }
    }

    /// Entire command. `standardOutput` receives the transcript only on success;
    /// `standardError` receives one fixed status line on failure.
    public static func run(_ arguments: [String],
                           credential: @escaping CodexNativeDictation.Credential,
                           transport: any CodexDictationTransport,
                           owner: uid_t = geteuid(),
                           standardOutput: (String) -> Void,
                           standardError: (String) -> Void) async -> Int32 {
        func failed(_ status: ExitStatus, reason: FileRejection? = nil) -> Int32 {
            let detail = reason.map { " [\($0.rawValue)]" } ?? ""
            standardError("OS-1 dictation: \(status.message)\(detail) (exit \(status.rawValue))")
            return status.rawValue
        }
        let options: Options
        do { options = try parse(arguments) } catch { return failed(.usage) }
        let wav: Data
        do { wav = try readOwnedWAV(at: options.path, owner: owner) }
        catch { return failed(.audioRejected, reason: error as? FileRejection ?? .unreadable) }
        guard wav.count <= maximumUploadBytes else { return failed(.audioRejected, reason: .overUploadLimit) }
        // Every failure while obtaining the sign-in (the Codex CLI child's own
        // malformed reply, buffer limit, 10 s timer or pipe failure) is the
        // credential stage, exit 4. Cancellation keeps its own status, and the
        // command's outer deadline still ends as exit 6.
        let signIn: CodexNativeDictation.Credential = {
            do { return try await credential() }
            catch let error as CodexDictationError where error == .cancelled || error == .invalidCredential { throw error }
            catch is CancellationError { throw CodexDictationError.cancelled }
            catch { throw CodexDictationError.credentialUnavailable }
        }
        do {
            let text = try await transcribe(wav: wav, language: options.language, timeoutSeconds: options.timeoutSeconds,
                                            credential: signIn, transport: transport)
            switch options.output {
            case .text: standardOutput(text)
            case .json:
                guard let line = try? transcriptEnvelope(text) else { return failed(.invalidResponse) }
                standardOutput(line)
            }
            return ExitStatus.transcribed.rawValue
        } catch let error as CodexDictationError {
            return failed(exitStatus(for: error))
        } catch {
            return failed(.transportFailed)
        }
    }
}

/// First of {work result, deadline}. The losing work is not awaited here, so a
/// transport that ignores cancellation cannot hold the command past its limit.
enum CodexDictationDeadline {
    static func race(_ work: Task<String, any Error>, seconds: TimeInterval) async -> Result<String, CodexDictationError> {
        let nanoseconds = UInt64(max(0, min(seconds, 300)) * 1_000_000_000)
        return await withCheckedContinuation { (continuation: CheckedContinuation<Result<String, CodexDictationError>, Never>) in
            let latch = CodexDictationResultLatch(continuation)
            let deadline = Task {
                try? await Task.sleep(nanoseconds: nanoseconds)
                latch.resolve(.failure(.timedOut))
            }
            Task {
                let outcome: Result<String, CodexDictationError>
                do { outcome = .success(try await work.value) }
                catch let error as CodexDictationError { outcome = .failure(error) }
                catch is CancellationError { outcome = .failure(.cancelled) }
                catch { outcome = .failure(.transportFailed) }
                latch.resolve(outcome)
                deadline.cancel()
            }
        }
    }
}

/// One-shot continuation guard: the first resolution wins, later ones are
/// ignored. Internal (not file-private) like every type in this file.
final class CodexDictationResultLatch: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Result<String, CodexDictationError>, Never>?
    init(_ continuation: CheckedContinuation<Result<String, CodexDictationError>, Never>) {
        self.continuation = continuation
    }
    func resolve(_ result: Result<String, CodexDictationError>) {
        lock.lock()
        let waiting = continuation; continuation = nil
        lock.unlock()
        waiting?.resume(returning: result)
    }
}
