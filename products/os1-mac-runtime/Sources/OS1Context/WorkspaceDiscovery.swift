import Foundation

public enum WorkspaceDiscovery {
    /// Exact preinstalled runtime hints, never a PATH rewrite or installation.
    public static func nodeContext(version: String, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> String {
        guard version.range(of: #"^[0-9]+\.[0-9]+\.[0-9]+$"#, options: .regularExpression) != nil else { return "" }
        let paths = [".local/share/node-v\(version)/bin/node", ".nvm/versions/node/v\(version)/bin/node",
                     ".volta/tools/image/node/\(version)/bin/node"]
        let found = paths.map { home.appendingPathComponent($0).path }.filter(FileManager.default.isExecutableFile(atPath:))
        guard !found.isEmpty else { return "\nProject runtime requirement: Node \(version). No matching managed local executable was found. This does not block source/document reading.\n" }
        return "\nProject runtime requirement: Node \(version). Existing executable candidates (verify --version before tests):\n" +
            found.map { "- " + $0 }.joined(separator: "\n") +
            "\nUse the exact matching runtime for project tests only; do not globally replace Node/PATH. Reading sources does not require tests or npm install.\n"
    }
    /// Read only explicitly registered project roots, never recursively glob HOME.
    /// Paths are candidates, not a selection, a freshness claim or a write grant.
    public static func context(workspace: String, prompt: String, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> String {
        guard URL(fileURLWithPath:workspace).standardizedFileURL.path == home.standardizedFileURL.path else { return "" }
        let config = home.appendingPathComponent(".codex/config.toml")
        guard let bytes = try? Data(contentsOf:config), bytes.count <= 1_000_000,
              let text = String(data:bytes,encoding:.utf8) else { return "" }
        let lower = prompt.precomposedStringWithCanonicalMapping.lowercased()
        let instagram = lower.contains("instagram") || lower.contains("인스타") || lower.contains("scv")
        var candidates = Set<String>()
        let prefix = "[projects."
        for line in text.split(separator:"\n").prefix(3000) {
            guard line.hasPrefix(prefix), line.hasSuffix("]") else { continue }
            let encoded = String(line.dropFirst(prefix.count).dropLast())
            guard let root = try? JSONDecoder().decode(String.self,from:Data(encoded.utf8)), root.hasPrefix(home.path + "/"),
                  !root.contains("/.os1/fleet/jobs/"), root != workspace else { continue }
            let target = instagram ? URL(fileURLWithPath:root).appendingPathComponent("products/scv-instagram").path : root
            var directory: ObjCBool = false
            if FileManager.default.fileExists(atPath:target,isDirectory:&directory), directory.boolValue { candidates.insert(target) }
            if candidates.count >= 8 { break }
        }
        guard !candidates.isEmpty else { return "\nWorkspace is projectless. Do not recursively search the home directory; use exact user/source paths or ask for the missing project selection.\n" }
        let runtimeHints = candidates.sorted().compactMap { path -> String? in
            let package = URL(fileURLWithPath: path).appendingPathComponent("runtime/package.json")
            guard let bytes = try? Data(contentsOf: package), bytes.count <= 100_000,
                  let json = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                  let engines = json["engines"] as? [String: String], let version = engines["node"] else { return nil }
            return nodeContext(version: version, home: home)
        }.joined()
        return "\nVerified local directory candidates from the existing project registry (not a write grant or an active-release claim):\n" +
            candidates.sorted().map { "- " + $0 }.joined(separator:"\n") +
            "\nInspect relevant exact paths first. Do not run recursive Glob/Grep over HOME. Preserve the user's selected workspace and verify which project/release is actually active before changes.\n" + runtimeHints
    }
}
