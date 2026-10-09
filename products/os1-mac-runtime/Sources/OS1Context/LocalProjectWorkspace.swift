import Foundation
import CryptoKit
import Darwin

/// A local-workspace project is only usable from its own source tree. When the
/// conversation's workspace is somewhere else (usually HOME), resolve the
/// project's registered root instead of binding an unrelated directory.
/// Roots come from the existing Codex project table or an exact activated OS-1
/// installation outcome; nothing is searched recursively or registered as trusted.
public enum LocalProjectWorkspace {
    /// Resolve aliases before giving a backend a writable root. Codex rejects
    /// symlinked writable roots; keep the same target and permission, not a wider sandbox.
    public static func executionPath(_ workspace: String) -> String {
        URL(fileURLWithPath: workspace).standardizedFileURL.resolvingSymlinksInPath().path
    }

    public static let markers: [String: String] = ["os1-clodex": "products/os1-mac-runtime/Package.swift"]

    public static func marker(for projectID: String) -> String? { markers[projectID] }

    /// The root that contains the marker, walking up at most four levels so a
    /// conversation opened inside the tree still resolves to its repository root.
    public static func root(containing workspace: String, projectID: String) -> String? {
        guard let marker = markers[projectID] else { return nil }
        var url = URL(fileURLWithPath: workspace).standardizedFileURL
        for _ in 0...4 {
            if FileManager.default.fileExists(atPath: url.appendingPathComponent(marker).path) { return url.path }
            let parent = url.deletingLastPathComponent()
            if parent.path == url.path { break }
            url = parent
        }
        return nil
    }

    /// Registered project roots under HOME, excluding fleet job checkouts and
    /// temporary directories.
    public static func registeredRoots(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> [String] {
        let config = home.appendingPathComponent(".codex/config.toml")
        guard let bytes = try? Data(contentsOf: config), bytes.count <= 1_000_000,
              let text = String(data: bytes, encoding: .utf8) else { return [] }
        var roots: [String] = []
        for line in text.split(separator: "\n").prefix(3000) {
            guard line.hasPrefix("[projects."), line.hasSuffix("]") else { continue }
            let encoded = String(line.dropFirst("[projects.".count).dropLast())
            guard let root = try? JSONDecoder().decode(String.self, from: Data(encoded.utf8)),
                  root.hasPrefix(home.path + "/"), !root.contains("/.os1/fleet/jobs/"),
                  !root.hasPrefix("/private/tmp/"), !root.hasPrefix("/tmp/") else { continue }
            if !roots.contains(root) { roots.append(root) }
        }
        return roots
    }

    public static func candidates(projectID: String, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> [String] {
        guard let marker = markers[projectID] else { return [] }
        var roots = registeredRoots(home: home).filter {
            FileManager.default.fileExists(atPath: URL(fileURLWithPath: $0).appendingPathComponent(marker).path)
        }
        // An installed self-repair may have used an unregistered checkout.
        // Reuse its existing activation receipt, not a new registry/trust grant.
        if projectID == "os1-clodex", let activated = activatedOS1Root(home: home),
           !roots.contains(where: { executionPath($0) == activated }) { roots.insert(activated, at: 0) }
        return roots
    }

    private static func activatedOS1Root(home: URL) -> String? {
        let canonicalHome = executionPath(home.path)
        let build = SelfUpdate.installedBuild(home: home)
        let outcomes = SelfUpdate.outcomes(home: home).reversed().filter { $0.success && $0.intent.build == build }
        guard build > 0, !outcomes.isEmpty else { return nil }
        let app = SelfUpdate.installedAppURL(home: home)
        guard executionPath(app.path).hasPrefix(canonicalHome + "/"),
              let appSHA = executableSHA256(app.appendingPathComponent("Contents/MacOS/OS1App")),
              let cliSHA = executableSHA256(app.appendingPathComponent("Contents/Resources/os1")) else { return nil }
        for outcome in outcomes {
            let intent = outcome.intent
            guard intent.schema == 1, intent.stagedAppSHA256 == appSHA, intent.stagedCLISHA256 == cliSHA,
                  let commit = intent.sourceCommit,
                  commit.range(of: "^[0-9a-f]{40}$", options: .regularExpression) != nil,
                  intent.sourceRoot.hasPrefix("/") else { continue }
            let source = executionPath(intent.sourceRoot)
            guard source == intent.sourceRoot, source.hasPrefix(canonicalHome + "/") else { continue }
            let relative = String(source.dropFirst(canonicalHome.count + 1))
            guard !relative.contains(".os1/fleet/jobs/"),
                  !relative.split(separator: "/").contains(where: { ["tmp", "temp", "TemporaryItems"].contains(String($0)) }),
                  root(containing: source, projectID: "os1-clodex").map(executionPath) == source,
                  let top = localGit(source, home: home, arguments: ["rev-parse", "--show-toplevel"]),
                  executionPath(top) == source,
                  let origin = localGit(source, home: home, arguments: ["remote", "get-url", "origin"]),
                  ["https://github.com/effacermonexistence/codex", "https://github.com/effacermonexistence/codex.git",
                   "git@github.com:effacermonexistence/codex.git", "ssh://git@github.com/effacermonexistence/codex.git"].contains(origin),
                  localGit(source, home: home, arguments: ["merge-base", "--is-ancestor", commit, "HEAD"]) != nil else { continue }
            return source
        }
        return nil
    }

    /// Hash only the two actual regular installed binaries, streaming and bounded.
    private static func executableSHA256(_ url: URL) -> String? {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              attributes[.type] as? FileAttributeType == .typeRegular,
              let size = attributes[.size] as? NSNumber, size.int64Value > 0, size.int64Value <= 250_000_000,
              let file = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? file.close() }
        var hasher = SHA256(), count: Int64 = 0
        do {
            while let bytes = try file.read(upToCount: 65_536), !bytes.isEmpty {
                count += Int64(bytes.count)
                guard count <= size.int64Value else { return nil }
                hasher.update(data: bytes)
            }
        } catch { return nil }
        guard count == size.int64Value else { return nil }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    /// Fixed local read-only queries. No fetch, global config, authentication or
    /// trust registration; output and elapsed time are bounded independently.
    private static func localGit(_ root: String, home: URL, arguments: [String]) -> String? {
        let files = FileManager.default
        let outputURL = files.temporaryDirectory.appendingPathComponent("os1-source-identity-" + UUID().uuidString)
        guard files.createFile(atPath: outputURL.path, contents: nil, attributes: [.posixPermissions: 0o600]),
              let output = try? FileHandle(forWritingTo: outputURL) else { return nil }
        defer { try? output.close(); try? files.removeItem(at: outputURL) }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["--no-optional-locks", "-C", root] + arguments
        process.environment = ["PATH": "/usr/bin:/bin", "HOME": home.path, "LC_ALL": "C",
                               "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_OPTIONAL_LOCKS": "0"]
        process.standardInput = FileHandle.nullDevice; process.standardOutput = output; process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return nil }
        let deadline = ProcessInfo.processInfo.systemUptime + 5
        while process.isRunning && ProcessInfo.processInfo.systemUptime < deadline {
            let size = (try? files.attributesOfItem(atPath: outputURL.path)[.size] as? NSNumber)?.intValue ?? Int.max
            if size > 16_384 { break }
            Thread.sleep(forTimeInterval: 0.01)
        }
        if process.isRunning { Darwin.kill(process.processIdentifier, SIGKILL); process.waitUntilExit(); return nil }
        process.waitUntilExit()
        guard process.terminationStatus == 0, let bytes = try? Data(contentsOf: outputURL), bytes.count <= 16_384,
              let text = String(data: bytes, encoding: .utf8) else { return nil }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public struct Resolution: Equatable, Sendable {
        public let workspace: String
        public let alternates: [String]
        public let fromRequestedWorkspace: Bool
    }

    /// Prefer the requested workspace only when it also satisfies `isCurrent`.
    /// Every candidate, including a sole/requested root, crosses the same gate.
    /// Never fall back to a known stale tree for a self-update.
    public static func resolve(projectID: String, requested: String,
                               home: URL = FileManager.default.homeDirectoryForCurrentUser,
                               additionalCandidates: [String] = [],
                               isCurrent: ((String) -> Bool)? = nil) -> Resolution? {
        let requestedRoot = root(containing: requested, projectID: projectID).map(executionPath)
        let localHome = executionPath(home.path)
        // Installed-bundle source hints are candidates, not Codex trust grants.
        // They remain local marked roots and cross the same current-state gate.
        let additional = additionalCandidates.map(executionPath).filter {
            $0.hasPrefix(localHome + "/") && !$0.contains("/.os1/fleet/jobs/")
                && root(containing: $0, projectID: projectID).map(executionPath) == $0
        }
        var seen = Set<String>()
        let found = ([requestedRoot].compactMap { $0 } + additional + candidates(projectID: projectID, home: home).map(executionPath))
            .filter { seen.insert($0).inserted }
            .filter { isCurrent?($0) ?? true }
        guard !found.isEmpty else { return nil }
        func changedAt(_ root: String) -> Date {
            let index = URL(fileURLWithPath: root).appendingPathComponent(".git/index").path
            let path = FileManager.default.fileExists(atPath: index) ? index : root
            return (try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date ?? .distantPast
        }
        let ordered = found.sorted {
            if $0 == $1 { return false }
            if $0 == requestedRoot { return true }
            if $1 == requestedRoot { return false }
            if additional.contains($0) != additional.contains($1) { return additional.contains($0) }
            let lhs = changedAt($0), rhs = changedAt($1)
            return lhs == rhs ? $0 < $1 : lhs > rhs
        }
        return Resolution(workspace: ordered[0], alternates: Array(ordered.dropFirst()),
                          fromRequestedWorkspace: ordered[0] == requestedRoot)
    }
}
