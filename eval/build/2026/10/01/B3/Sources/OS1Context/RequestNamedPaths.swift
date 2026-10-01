import CryptoKit
import Foundation

/// Paths the owner names in a request are always part of the before/after
/// state OS-1 compares, wherever they are.
///
/// The workspace state alone missed real writes (2026-09-24): in the HOME
/// workspace the tree manifest stops at 20,000 files — it fills up on
/// Desktop, Applications and part of Documents — so a file the owner asked
/// for in a new ~/os1-four-surface-probe folder was created but never
/// observed, and the verifier reported the finished write as not done. Paths
/// outside the workspace or ignored by Git were equally invisible.
///
/// Only state is read (existence, type, size, modification time, and a hash
/// of at most 1 MiB of a regular file, or a directory's entry names). Nothing
/// here writes, and file contents never leave this digest.
public enum RequestNamedPaths {
    public static let maximumPaths = 16
    public static let maximumHashedBytes = 1 << 20
    public static let maximumDirectoryEntries = 2_000

    /// Absolute (`/…`) and home-relative (`~/…`) paths written in `text`.
    /// A path ends at whitespace, a quote or bracket, or the first non-ASCII
    /// character, so a Korean particle ("codex.txt를") is not part of it.
    public static func extract(_ text: String, home: String = NSHomeDirectory()) -> [String] {
        var found: [String] = []
        var seen = Set<String>()
        let scalars = Array(text.unicodeScalars)
        var index = 0
        while index < scalars.count, found.count < maximumPaths {
            let scalar = scalars[index]
            let startsHome = scalar == "~" && index + 1 < scalars.count && scalars[index + 1] == "/"
            let startsRoot = scalar == "/" && (index + 1 < scalars.count && isPathScalar(scalars[index + 1]))
            let boundary = index == 0 || !isPathScalar(scalars[index - 1]) || scalars[index - 1] == ":"
            guard (startsHome || startsRoot), boundary, !(scalar == "/" && index > 0 && scalars[index - 1] == "/") else {
                index += 1; continue
            }
            var end = index + 1
            while end < scalars.count, isPathScalar(scalars[end]) { end += 1 }
            var candidate = String(String.UnicodeScalarView(scalars[index..<end]))
            index = end
            while let last = candidate.last, ".,;:!?)]}".contains(last) { candidate.removeLast() }
            // "main.swift:7473" or ":12:5" names a line in the file.
            if let line = candidate.range(of: #":\d+(:\d+)?$"#, options: .regularExpression) {
                candidate.removeSubrange(line)
            }
            // Not a filesystem path: URL tails ("//host") and bare "/" words.
            guard candidate.count > 1, !candidate.hasPrefix("//") else { continue }
            if candidate.hasPrefix("~/") { candidate = home + String(candidate.dropFirst()) }
            let standardized = (candidate as NSString).standardizingPath
            guard standardized.hasPrefix("/"), standardized != "/", !runtimeWritten(standardized, home: home),
                  seen.insert(standardized).inserted else { continue }
            found.append(standardized)
        }
        return found
    }

    /// Locations the backends and OS-1 write during every run (session
    /// logs, prompt history, OS-1's own state). A named path inside one — or
    /// a folder that contains one, such as the home folder — would read as
    /// "changed" on every task, turning a clean retry into a held one.
    public static func runtimeWrittenRoots(home: String = NSHomeDirectory()) -> [String] {
        [".os1", ".codex/sessions", ".codex/archived_sessions", ".codex/history.jsonl", ".codex/log",
         ".codex/session_index.jsonl", ".codex/auth.json", ".claude/projects", ".claude/todos",
         ".claude/shell-snapshots", ".claude/statsig", ".claude/session-env", ".claude.json", "Library"]
            .map { (home as NSString).appendingPathComponent($0) }
    }

    static func runtimeWritten(_ path: String, home: String) -> Bool {
        runtimeWrittenRoots(home: home).contains { root in
            path == root || path.hasPrefix(root + "/") || root.hasPrefix(path == "/" ? path : path + "/")
        }
    }

    /// Paths inside a URL ("https://host/a/b") are not local paths.
    static func isPathScalar(_ scalar: Unicode.Scalar) -> Bool {
        guard scalar.isASCII else { return false }
        switch scalar {
        case "a"..."z", "A"..."Z", "0"..."9", "/", ".", "_", "-", "~", "+", "@", "%", ",", "=", ":": return true
        default: return false
        }
    }

    /// Files whose bytes OS-1 must not read, even to hash: keys, tokens,
    /// credential stores. Their size and time still show a create or edit.
    public static func credentialLike(_ path: String) -> Bool {
        let lower = path.lowercased()
        let name = (lower as NSString).lastPathComponent
        let folders = ["/.ssh/", "/.aws/", "/.gnupg/", "/.docker/", "/.kube/", "/.config/gh/", "/keychains/"]
        let names: Set<String> = [".netrc", ".npmrc", ".pypirc", ".git-credentials", "auth.json", "credentials",
                                  "credentials.json", ".credentials.json", "hosts.yml", "id_rsa", "id_ed25519", "id_ecdsa"]
        let extensions: Set<String> = ["pem", "key", "p12", "pfx", "keychain", "keychain-db", "mobileprovision"]
        return folders.contains { lower.contains($0) } || names.contains(name) || name.hasPrefix(".env")
            || extensions.contains((name as NSString).pathExtension)
            || ["secret", "token", "credential", "password", "private_key", "privatekey"].contains { name.contains($0) }
    }

    /// One line per named path: its observable state. Stable across calls
    /// when nothing changed; different after a create, edit, delete or rename.
    public static func stateMaterial(_ paths: [String]) -> Data {
        var material = Data("os1-named-paths-v1\n".utf8)
        let manager = FileManager.default
        for path in paths.prefix(maximumPaths) {
            material.append(Data(path.utf8)); material.append(0)
            guard let attributes = try? manager.attributesOfItem(atPath: path),
                  let type = attributes[.type] as? FileAttributeType else {
                material.append(Data("missing\n".utf8)); continue
            }
            let size = (attributes[.size] as? NSNumber)?.int64Value ?? -1
            let modified = (attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
            material.append(Data("\(type.rawValue)\u{0}\(size)\u{0}\(Int64(modified * 1000))\u{0}".utf8))
            if type == .typeRegular, !credentialLike(path), let handle = FileHandle(forReadingAtPath: path) {
                let prefix = (try? handle.read(upToCount: maximumHashedBytes)) ?? Data()
                try? handle.close()
                material.append(Data(SHA256.hash(data: prefix).map { String(format: "%02x", $0) }.joined().utf8))
            } else if type == .typeDirectory, let entries = try? manager.contentsOfDirectory(atPath: path) {
                // Entry names plus each entry's size and time: an edit in
                // place changes neither the listing nor the folder's own time.
                for name in entries.sorted().prefix(maximumDirectoryEntries) {
                    let child = (try? manager.attributesOfItem(atPath: (path as NSString).appendingPathComponent(name))) ?? [:]
                    let childSize = (child[.size] as? NSNumber)?.int64Value ?? -1
                    let childModified = (child[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
                    material.append(Data("\(name)\u{0}\(childSize)\u{0}\(Int64(childModified * 1000))\u{0}".utf8))
                }
            }
            material.append(0x0a)
        }
        return material
    }
}
