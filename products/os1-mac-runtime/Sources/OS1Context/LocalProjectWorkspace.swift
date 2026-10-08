import Foundation

/// A local-workspace project is only usable from its own source tree. When the
/// conversation's workspace is somewhere else (usually HOME), resolve the
/// project's registered root instead of binding an unrelated directory.
/// Roots come from the existing Codex project table; nothing is searched
/// recursively and nothing is created or written.
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
        return registeredRoots(home: home).filter {
            FileManager.default.fileExists(atPath: URL(fileURLWithPath: $0).appendingPathComponent(marker).path)
        }
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
