import CryptoKit
import Darwin
import Foundation
import OS1Context

// This is local executable-health evidence, never a task-adoption receipt.
// Native success cannot promote a rejected Fleet result to completed.
struct FleetProviderEvidence: Codable {
    let schema: Int
    let provider: String
    let executable: String
    let executableSHA256: String
    let runtimeSHA256: String
    let observedAt: TimeInterval
    let ready: Bool
    let sessionID: String?
    let outputSHA256: String?
    let failureCategory: String?

    func valid(provider expected: String, executable path: String, executableSHA256 binary: String,
               runtimeSHA256 runtime: String, now: TimeInterval) -> Bool {
        schema == 1 && provider == expected && executable == path && executableSHA256 == binary &&
            runtimeSHA256 == runtime && ready && now >= observedAt && now - observedAt < 86_400 &&
            sessionID.flatMap(UUID.init(uuidString:)) != nil && outputSHA256?.count == 64 && failureCategory == nil
    }
}

private func readinessURL(_ provider: String) throws -> URL {
    guard ["codex", "claude"].contains(provider) else { throw OS1Error.message("Invalid readiness provider") }
    return FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".os1/fleet/provider-evidence-v1", isDirectory: true)
        .appendingPathComponent(provider + ".json")
}

private func readinessFileHash(_ path: String) throws -> String {
    let reader = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
    defer { try? reader.close() }
    var hash = SHA256()
    while let bytes = try reader.read(upToCount: 1_048_576), !bytes.isEmpty { hash.update(data: bytes) }
    return hash.finalize().map { String(format: "%02x", $0) }.joined()
}

private func readinessIdentity(_ provider: String) throws -> (String, String, String) {
    let path = URL(fileURLWithPath: try findExecutable(provider)).resolvingSymlinksInPath().path
    // Bundled and user CLIs have different signing identifiers, but are built
    // from one release. Bind evidence to that build epoch, not its install path.
    return (path, try readinessFileHash(path), sha256Hex(Data(OS1RuntimeBuild.identity.utf8)))
}

func recordFleetProviderEvidence(provider: String, execution: ProviderExecution? = nil,
                                 failure: String? = nil) {
    guard ["codex", "claude"].contains(provider) else { return }
    do {
        let identity = try readinessIdentity(provider)
        let valid = execution.map {
            $0.artifact.exitCode == 0 && !$0.artifact.output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
                $0.nativeRecord.persistence == "verified" && UUID(uuidString: $0.sessionID) != nil
        } ?? false
        let record = FleetProviderEvidence(schema: 1, provider: provider, executable: identity.0,
            executableSHA256: identity.1, runtimeSHA256: identity.2, observedAt: Date().timeIntervalSince1970,
            ready: valid && failure == nil, sessionID: valid ? execution?.sessionID : nil,
            outputSHA256: valid ? execution.map { sha256Hex(Data($0.artifact.output.utf8)) } : nil,
            failureCategory: valid && failure == nil ? nil : (failure ?? "native_execution_unverified"))
        let url = try readinessURL(provider)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(record).write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    } catch {
        // If persistence fails, no prior successful evidence may survive as ready.
        if let url = try? readinessURL(provider) { try? FileManager.default.removeItem(at: url) }
        fputs("OS1 provider readiness evidence unavailable\n", stderr)
    }
}

func fleetProviderReady(_ provider: String) -> Bool {
    do {
        let url = try readinessURL(provider)
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
              (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600,
              (attributes[.size] as? NSNumber)?.intValue ?? Int.max < 16_384 else { return false }
        let record = try JSONDecoder().decode(FleetProviderEvidence.self, from: Data(contentsOf: url))
        let identity = try readinessIdentity(provider)
        guard record.valid(provider: provider, executable: identity.0, executableSHA256: identity.1,
                           runtimeSHA256: identity.2, now: Date().timeIntervalSince1970) else { return false }
        // Official local auth status only. Never read or mirror provider credentials.
        let auth = try commandOutput(identity.0, provider == "codex" ? ["login", "status"] : ["auth", "status"],
                                     timeout: 4, isProvider: true)
        guard auth.0 == 0 else { return false }
        if provider == "claude" {
            let json = try JSONSerialization.jsonObject(with: auth.1) as? [String: Any]
            return json?["loggedIn"] as? Bool == true
        }
        return true
    } catch { return false }
}

func providerReadinessSelfTest() throws {
    let id = UUID().uuidString, hash = String(repeating: "a", count: 64)
    let good = FleetProviderEvidence(schema: 1, provider: "codex", executable: "/fixture/codex",
        executableSHA256: hash, runtimeSHA256: hash, observedAt: 1_000, ready: true,
        sessionID: id, outputSHA256: hash, failureCategory: nil)
    func accepts(_ record: FleetProviderEvidence, now: Double = 1_001, binary: String? = nil, runtime: String? = nil) -> Bool {
        record.valid(provider: "codex", executable: "/fixture/codex", executableSHA256: binary ?? hash,
                     runtimeSHA256: runtime ?? hash, now: now)
    }
    let failed = FleetProviderEvidence(schema: 1, provider: "codex", executable: "/fixture/codex",
        executableSHA256: hash, runtimeSHA256: hash, observedAt: 1_000, ready: false,
        sessionID: nil, outputSHA256: nil, failureCategory: "quota_exhausted")
    guard accepts(good), !accepts(good, now: 999), !accepts(good, now: 87_400),
          !accepts(good, binary: "changed"), !accepts(good, runtime: "changed"), !accepts(failed) else {
        throw OS1Error.message("Provider readiness regression failed")
    }
    guard BackendBlocker.reported(in: "You've hit your session limit · resets 7pm") == .quotaExhausted,
          BackendBlocker.reported(in: "You’ve hit your usage limit") == .quotaExhausted,
          BackendBlocker.reported(in: "Read-only verification") == nil else {
        throw OS1Error.message("Native quota classification regression failed")
    }
    print("OS1 provider readiness/quota: 9 checks PASS; executable presence is not execution evidence")
}
