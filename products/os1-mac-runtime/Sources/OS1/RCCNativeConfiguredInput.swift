import Foundation
import OS1Context
import CryptoKit
import Darwin

/// Only execute() can supply this final configured channel. It carries ephemeral
/// text already owned by that invocation; the durable record contains hashes and
/// byte lengths only. No native/provider process is started by this helper.
struct RCCNativeConfiguredInput {
    let channel: String
    let prompt: String
    let instructions: String
    let baseInstructions: String?
    let nativeExecutable: String
    let sessionState: String
    let executionConfiguration: Data?

    func observation(ticket: RCCRuntimeContract.ExecutionTicket, delegated: String,
                     catalog: Data, catalogObservedAtMS: Int64) throws -> RCCConfiguredInputObservation {
        guard let executionConfiguration else { throw RCCConfiguredInputObservation.Failure.binding }
        // The actual current harness and selected executable, not paths claimed
        // by a model, old package, environment alias or training record.
        let harness = try Self.executableSHA256(Self.runningExecutablePath())
        let native = try Self.executableSHA256(nativeExecutable)
        return try .init(ticket: ticket, delegatedInput: delegated, providerInput: prompt,
            instructions: instructions, baseInstructions: baseInstructions, channel: channel, sessionState: sessionState,
            harnessSHA256: harness, nativeBinarySHA256: native,
            executionConfigurationSHA256: RCCRuntimeContract.digest(executionConfiguration),
            catalogSHA256: RCCRuntimeContract.digest(catalog), catalogObservedAtMS: catalogObservedAtMS,
            preparedAtMS: Int64(Date().timeIntervalSince1970 * 1000))
    }

    /// The loader's current process, never the installed staging helper or an enclosing .app bundle.
    static func runningExecutablePath() throws -> String {
        var size: UInt32 = 0
        _ = _NSGetExecutablePath(nil, &size)
        guard size > 0, size <= 65_536 else { throw RCCConfiguredInputObservation.Failure.binding }
        var buffer = [CChar](repeating: 0, count: Int(size))
        guard _NSGetExecutablePath(&buffer, &size) == 0 else { throw RCCConfiguredInputObservation.Failure.binding }
        let bytes = buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }
        return URL(fileURLWithPath: String(decoding: bytes, as: UTF8.self)).resolvingSymlinksInPath().path
    }

    /// Bounded descriptor read of only the executor-selected file. This is
    /// its preparation-time identity, NOT proof of which image the OS loaded.
    static func executableSHA256(_ path: String) throws -> String {
        guard path.hasPrefix("/"), !path.contains("\0") else { throw RCCConfiguredInputObservation.Failure.binding }
        let resolved = URL(fileURLWithPath: path).resolvingSymlinksInPath().path
        let fd = Darwin.open(resolved, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw RCCConfiguredInputObservation.Failure.binding }
        defer { Darwin.close(fd) }
        var before = stat()
        guard fstat(fd, &before) == 0, (before.st_mode & S_IFMT) == S_IFREG,
              before.st_size > 0, before.st_size <= 200_000_000 else { throw RCCConfiguredInputObservation.Failure.bounds }
        var digest = SHA256(), buffer = [UInt8](repeating: 0, count: 65_536), total: Int64 = 0
        while true {
            let n = buffer.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress!, $0.count) }
            guard n >= 0 else { throw RCCConfiguredInputObservation.Failure.binding }
            if n == 0 { break }
            total += Int64(n)
            guard total <= before.st_size else { throw RCCConfiguredInputObservation.Failure.bounds }
            digest.update(data: Data(buffer.prefix(n)))
        }
        var after = stat()
        guard fstat(fd, &after) == 0, before.st_dev == after.st_dev, before.st_ino == after.st_ino,
              before.st_size == after.st_size, total == after.st_size,
              before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec,
              before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec,
              before.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec,
              before.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec else { throw RCCConfiguredInputObservation.Failure.binding }
        return digest.finalize().map { String(format: "%02x", $0) }.joined()
    }
}
