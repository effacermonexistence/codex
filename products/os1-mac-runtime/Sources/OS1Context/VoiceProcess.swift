import Foundation
import Darwin

public final class VoiceProcessCancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false
    public init() {}
    public func cancel() { lock.lock(); cancelled = true; lock.unlock() }
    public var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return cancelled }
}

public enum VoiceProcessError: Error, LocalizedError {
    case cancelled, timedOut, outputLimit, failed(Int32, String)
    public var errorDescription: String? {
        switch self {
        case .cancelled: return "Transcription cancelled."
        case .timedOut: return "Transcription timed out. Your existing draft is preserved; try a shorter recording."
        case .outputLimit: return "Voice engine output exceeded its safety limit."
        case .failed(let status, let detail): return "Voice engine exited (\(status)): \(detail)"
        }
    }
}

/// Runs off the main actor. Never waits on a child with undrained pipes.
public enum VoiceProcess {
    public static func run(executable: URL, arguments: [String], cancellation: VoiceProcessCancellation,
                           timeout: TimeInterval = 180, maximumOutput: Int = 4_000_000) throws -> Data {
        guard !cancellation.isCancelled else { throw VoiceProcessError.cancelled }
        let files = FileManager.default
        let directory = files.temporaryDirectory.appendingPathComponent("os1-voice-process-" + UUID().uuidString)
        try files.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? files.removeItem(at: directory) }
        let outURL = directory.appendingPathComponent("stdout"), errURL = directory.appendingPathComponent("stderr")
        for url in [outURL, errURL] {
            guard files.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600]) else {
                throw CocoaError(.fileWriteUnknown)
            }
        }
        let output = try FileHandle(forWritingTo: outURL), errors = try FileHandle(forWritingTo: errURL)
        defer { try? output.close(); try? errors.close() }
        let process = Process()
        process.executableURL = executable; process.arguments = arguments
        process.standardOutput = output; process.standardError = errors; process.standardInput = FileHandle.nullDevice
        guard !cancellation.isCancelled else { throw VoiceProcessError.cancelled }
        try process.run()
        defer {
            if process.isRunning {
                process.terminate()
                let deadline = ProcessInfo.processInfo.systemUptime + 0.5
                while process.isRunning && ProcessInfo.processInfo.systemUptime < deadline { Thread.sleep(forTimeInterval: 0.02) }
                if process.isRunning { Darwin.kill(process.processIdentifier, SIGKILL) }
            }
            process.waitUntilExit()
        }
        func outputFits() throws -> Bool {
            try [outURL, errURL].allSatisfy { url in
                let size = (try files.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? Int.max
                return size <= maximumOutput
            }
        }
        let deadline = ProcessInfo.processInfo.systemUptime + max(0, timeout)
        while process.isRunning {
            guard !cancellation.isCancelled else { throw VoiceProcessError.cancelled }
            guard ProcessInfo.processInfo.systemUptime < deadline else { throw VoiceProcessError.timedOut }
            guard try outputFits() else { throw VoiceProcessError.outputLimit }
            Thread.sleep(forTimeInterval: 0.025)
        }
        guard !cancellation.isCancelled else { throw VoiceProcessError.cancelled }
        guard try outputFits() else { throw VoiceProcessError.outputLimit }
        guard process.terminationStatus == 0 else {
            let detail = String(decoding: try Data(contentsOf: errURL).prefix(4096), as: UTF8.self)
            throw VoiceProcessError.failed(process.terminationStatus, detail)
        }
        return try Data(contentsOf: outURL)
    }
}
