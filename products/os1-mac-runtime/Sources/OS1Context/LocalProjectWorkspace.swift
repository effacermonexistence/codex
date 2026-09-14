import Foundation

/// A local-workspace project is only usable from its own source tree. When the
/// conversation's workspace is somewhere else (usually HOME), resolve the
/// project's registered root instead of binding an unrelated directory.
/// Roots come from the existing Codex project table; nothing is searched
/// recursively and nothing is created or written.
public enum LocalProjectWorkspace {
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

    /// Prefer the requested workspace when it is inside the project; otherwise
    /// the most recently changed registered root (its git index, else the
    /// directory itself). Other matching roots are reported as alternates.
    public static func resolve(projectID: String, requested: String,
                               home: URL = FileManager.default.homeDirectoryForCurrentUser) -> Resolution? {
        if let root = root(containing: requested, projectID: projectID) {
            return Resolution(workspace: root, alternates: [], fromRequestedWorkspace: true)
        }
        let found = candidates(projectID: projectID, home: home)
        guard !found.isEmpty else { return nil }
        func changedAt(_ root: String) -> Date {
            let index = URL(fileURLWithPath: root).appendingPathComponent(".git/index").path
            let path = FileManager.default.fileExists(atPath: index) ? index : root
            return (try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date ?? .distantPast
        }
        let ordered = found.sorted { changedAt($0) > changedAt($1) }
        return Resolution(workspace: ordered[0], alternates: Array(ordered.dropFirst()), fromRequestedWorkspace: false)
    }
}
