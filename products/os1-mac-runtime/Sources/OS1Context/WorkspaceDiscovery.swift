import Foundation

public enum WorkspaceDiscovery {
    /// Read only explicitly registered project roots, never recursively glob HOME.
    /// Paths are candidates, not a selection, a freshness claim or a write grant.
    public static func context(workspace: String, prompt: String, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> String {
        guard URL(fileURLWithPath:workspace).standardizedFileURL.path == home.standardizedFileURL.path else { return "" }
        let config = home.appendingPathComponent(".codex/config.toml")
        guard let bytes = try? Data(contentsOf:config), bytes.count <= 1_000_000,
              let text = String(data:bytes,encoding:.utf8) else { return "" }
        let lower = prompt.lowercased()
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
        return "\nVerified local directory candidates from the existing project registry (not a write grant or an active-release claim):\n" +
            candidates.sorted().map { "- " + $0 }.joined(separator:"\n") +
            "\nInspect relevant exact paths first. Do not run recursive Glob/Grep over HOME. Preserve the user's selected workspace and verify which project/release is actually active before changes.\n"
    }
}
