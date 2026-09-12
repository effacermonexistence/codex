import Foundation
import Darwin
import OS1System

/// Failures are classified before considering OAuth. Transport errors never
/// justify replacing an identity or opening another login window.
public enum ConnectionFailure: String, Codable, Sendable, Error, LocalizedError, CustomStringConvertible {
    public var description: String { errorDescription ?? rawValue }
    case authentication, permission, rateLimited, transport, unavailable, cancelled
    public static func classify(_ text: String) -> Self {
        let s = text.lowercased()
        if ["api rate limit exceeded", "secondary rate limit", "rate limit exceeded", "http 429"].contains(where: s.contains) { return .rateLimited }
        if ["not logged in", "not logged into", "token has expired", "token expired", "invalid access token",
            "bad credentials", "http 401", "authentication error", "authenticate wrangler",
            "non-interactive environment, it's necessary to set a cloudflare_api_token",
            "cloudflare_api_token environment variable for wrangler to work"].contains(where: s.contains) { return .authentication }
        if ["403", "forbidden", "permission", "access denied", "unauthorized to access"].contains(where: s.contains) { return .permission }
        if ["timed out", "timeout", "network", "fetch failed", "connection", "dns", "resolve host", "certificate", "econn", "502", "503", "504"].contains(where: s.contains) { return .transport }
        return .unavailable
    }
    public var errorDescription: String? {
        switch self {
        case .authentication: return "서비스 로그인이 필요합니다. OS1에 원래 요청을 보존했습니다."
        case .permission: return "로그인한 계정에 대상 자료 접근 권한이 없습니다. 다른 모델로 재실행하지 않았습니다."
        case .rateLimited: return "GitHub 조회 한도에 도달했습니다. 권한 오류가 아닙니다. 요청과 자료를 보존했으며 계정 변경이나 반복 모델 호출은 하지 않았습니다."
        case .transport: return "서비스와 통신하지 못했습니다. 인증을 바꾸지 않고 요청을 보존했습니다."
        case .unavailable: return "대상 서비스의 응답을 확인하지 못했습니다. 요청과 기존 자료는 유지됩니다."
        case .cancelled: return "승인을 취소했습니다. 원래 요청은 OS1에 보존했습니다."
        }
    }
}

/// One retry of a read-only connectivity probe, never of a provider execution
/// or an OAuth/write request. Injected wait keeps regression tests deterministic.
public enum ConnectionProbe {
    public static func readOnly<T>(probe: () throws -> T, wait: () -> Void,
                                   cancelled: () -> Bool = { false }) throws -> T {
        do { return try probe() }
        catch ConnectionFailure.transport {
            guard !cancelled() else { throw ConnectionFailure.cancelled }
            wait()
            guard !cancelled() else { throw ConnectionFailure.cancelled }
            return try probe()
        }
    }
}

/// Cross-process single flight. Credential storage remains owned by gh/Wrangler.
public final class ConnectionLease {
    private let descriptor: Int32
    public init(root: URL, service: String) throws {
        guard ["github", "r2"].contains(service) else { throw ConnectionFailure.unavailable }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        descriptor = Darwin.open(root.appendingPathComponent(service + ".lock").path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else { throw ConnectionFailure.unavailable }
    }
    public func tryAcquire() -> Bool { os1_flock(descriptor, LOCK_EX | LOCK_NB) == 0 }
    deinit { _ = os1_flock(descriptor, LOCK_UN); Darwin.close(descriptor) }
}

/// Process-local cancellation supplied by the owning OS1 submission. The path
/// is not a command, and must never be inherited by unrelated provider jobs.
public enum ExecutionCancellation {
    public static func url(submissionID: UUID) -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1/run-journals")
            .appendingPathComponent(submissionID.uuidString + ".cancel")
    }
    public static func request(submissionID: UUID) throws {
        let target = url(submissionID: submissionID)
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try Data("cancel\n".utf8).write(to: target, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
    }
    public static var isCancelled: Bool {
        guard let path = ProcessInfo.processInfo.environment["OS1_CANCEL_FILE"] else { return false }
        return FileManager.default.fileExists(atPath: path)
    }
}
