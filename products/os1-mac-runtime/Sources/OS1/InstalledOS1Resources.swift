import CryptoKit
import Foundation

/// Resolve the exact installed app whose bundled CLI matches this process.
/// Public installs place the app in /Applications while verified local installs
/// use ~/Applications; ~/.local/bin/os1 may contain a copy from either lane.
/// A path's existence alone cannot establish artifact identity.
enum InstalledOS1Resources {
    private static func regular(_ url: URL, maximumBytes: Int = 128_000_000) -> Bool {
        guard let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]) else { return false }
        return values.isRegularFile == true && values.isSymbolicLink != true &&
            (values.fileSize ?? Int.max) > 0 && (values.fileSize ?? Int.max) <= maximumBytes
    }

    private static func digest(_ url: URL) -> String? {
        guard regular(url), let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        var hasher = SHA256()
        do {
            while true {
                let part = try handle.read(upToCount: 1_048_576) ?? Data()
                if part.isEmpty { break }
                hasher.update(data: part)
            }
            return hasher.finalize().map { String(format: "%02x", $0) }.joined()
        } catch { return nil }
    }

    static func resolve(executable: URL = URL(fileURLWithPath: CommandLine.arguments[0]),
                        candidates: [URL]? = nil) -> URL? {
        let actual = executable.resolvingSymlinksInPath().standardizedFileURL
        guard let actualHash = digest(actual) else { return nil }
        let home = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Applications/OS-1 CLODEX.app/Contents/Resources", isDirectory: true)
        let system = URL(fileURLWithPath: "/Applications/OS-1 CLODEX.app/Contents/Resources", isDirectory: true)
        for resources in candidates ?? [system, home] {
            guard let values = try? resources.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey]),
                  values.isDirectory == true, values.isSymbolicLink != true,
                  let bundledHash = digest(resources.appendingPathComponent("os1")),
                  bundledHash == actualHash else { continue }
            return resources
        }
        return nil
    }

    static func selfTest() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-installed-resource-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let publicResources = root.appendingPathComponent("public/OS-1 CLODEX.app/Contents/Resources")
        let privateResources = root.appendingPathComponent("private/OS-1 CLODEX.app/Contents/Resources")
        for dir in [publicResources, privateResources] {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        let copiedCLI = root.appendingPathComponent("user-bin/os1")
        try FileManager.default.createDirectory(at: copiedCLI.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("public-installed-cli".utf8).write(to: copiedCLI)
        try Data("public-installed-cli".utf8).write(to: publicResources.appendingPathComponent("os1"))
        try Data("old-private-cli".utf8).write(to: privateResources.appendingPathComponent("os1"))
        guard resolve(executable: copiedCLI, candidates: [privateResources, publicResources]) == publicResources else {
            throw OS1Error.message("OS-1 public installed CLI selected another app's resources")
        }
        try Data("changed-cli".utf8).write(to: copiedCLI)
        guard resolve(executable: copiedCLI, candidates: [privateResources, publicResources]) == nil else {
            throw OS1Error.message("OS-1 accepted a resource directory for a mismatched executable")
        }
        print("OS-1 installed resource identity: public/private copied CLI match and mismatch refusal PASS")
    }
}
