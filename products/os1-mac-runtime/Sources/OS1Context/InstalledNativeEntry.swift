import CryptoKit
import Darwin
import Foundation

/// A copied installed CLI is an entry point, not a new Gateway generation.
/// Canonicalize only known installed aliases after exact byte/resource/seal
/// checks. Source/staged executables retain their distinct native identity.
public enum InstalledNativeEntry {
    public enum Failure: Error, Equatable { case invalidFile, invalidResources, bytesDiffer, invalidSeal }
    public struct Identity: Sendable, Equatable {
        public let executable: URL
        public let sha256: String
        public let canonicalized: Bool
    }

    /// `resources` comes from the existing executable-bound installed resource
    /// resolver. The seal callback verifies the app, not a request-supplied
    /// hash. Alternate roots exist only for offline fixtures; callers never
    /// expose them as CLI/model inputs.
    public static func resolve(executable: URL, resources: URL, home: URL,
                               systemApplications: URL = URL(fileURLWithPath: "/Applications"),
                               systemCLI: URL = URL(fileURLWithPath: "/usr/local/bin/os1"),
                               verifyResourceSeal: (URL) throws -> Bool) throws -> Identity {
        // Classify lexical paths BEFORE resolving links: a staged symlink is
        // not permission to impersonate an installed entry point.
        let actual = executable.standardizedFileURL
        let localResources = home.appendingPathComponent("Applications/OS-1 CLODEX.app/Contents/Resources").standardizedFileURL
        let publicResources = systemApplications.appendingPathComponent("OS-1 CLODEX.app/Contents/Resources").standardizedFileURL
        let knownCopies = [home.appendingPathComponent(".local/bin/os1").standardizedFileURL,
                           systemCLI.standardizedFileURL]
        let knownBundles = [localResources.appendingPathComponent("os1"), publicResources.appendingPathComponent("os1")]
        let actualHash = try digest(actual, allowedOwners: [getuid(), 0])
        guard (knownCopies + knownBundles).contains(actual) else {
            return Identity(executable: actual, sha256: actualHash.sha256, canonicalized: false)
        }
        let trustedResources = resources.standardizedFileURL
        guard [localResources, publicResources].contains(trustedResources) else { throw Failure.invalidResources }
        let owners: Set<uid_t> = trustedResources == localResources ? [getuid()] : [getuid(), 0]
        // Verify each app/resource component, without following a replaced
        // bundle or Resources symlink. Public installs may be root-owned
        // packages or this user's sealed app, never another user's payload.
        var directories = [trustedResources, trustedResources.deletingLastPathComponent(),
                           trustedResources.deletingLastPathComponent().deletingLastPathComponent()]
        if knownCopies.contains(actual) {
            directories += [actual.deletingLastPathComponent(), actual.deletingLastPathComponent().deletingLastPathComponent()]
        }
        let directoryState = try checkedDirectories(directories, allowedOwners: owners)
        guard actual.resolvingSymlinksInPath() == actual,
              trustedResources.resolvingSymlinksInPath() == trustedResources else { throw Failure.invalidResources }
        let native = trustedResources.appendingPathComponent("os1")
        let nativeHash = try digest(native, allowedOwners: owners)
        guard nativeHash.sha256 == actualHash.sha256 else { throw Failure.bytesDiffer }
        guard try verifyResourceSeal(trustedResources) else { throw Failure.invalidSeal }
        // A signature check may take time. Do not canonicalize after an alias
        // or bundled file changed while the trusted app was being checked.
        let afterDirectories = try checkedDirectories(directories, allowedOwners: owners)
        guard zip(directoryState, afterDirectories).allSatisfy({ sameState($0.0, $0.1) }),
              actual.resolvingSymlinksInPath() == actual,
              trustedResources.resolvingSymlinksInPath() == trustedResources else { throw Failure.invalidResources }
        let afterActual = try digest(actual, allowedOwners: [getuid(), 0])
        let afterNative = try digest(native, allowedOwners: owners)
        guard afterActual.sha256 == actualHash.sha256, sameState(afterActual.state, actualHash.state),
              afterNative.sha256 == nativeHash.sha256, sameState(afterNative.state, nativeHash.state) else { throw Failure.bytesDiffer }
        return Identity(executable: native, sha256: nativeHash.sha256, canonicalized: true)
    }

    private static func checkedDirectories(_ directories: [URL], allowedOwners: Set<uid_t>) throws -> [stat] {
        try directories.map { directory in
            var info = stat()
            guard lstat(directory.path, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR,
                  allowedOwners.contains(info.st_uid), (info.st_mode & 0o022) == 0 else { throw Failure.invalidResources }
            return info
        }
    }

    private struct FileSnapshot { let sha256: String; let state: stat }
    private static func sameState(_ a: stat, _ b: stat) -> Bool {
        a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_mode == b.st_mode &&
        a.st_uid == b.st_uid && a.st_gid == b.st_gid && a.st_size == b.st_size &&
        a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec && a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec &&
        a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec && a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec
    }

    private static func digest(_ url: URL, allowedOwners: Set<uid_t>) throws -> FileSnapshot {
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else { throw Failure.invalidFile }
        defer { _ = close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
              allowedOwners.contains(info.st_uid), (info.st_mode & 0o022) == 0,
              (info.st_mode & 0o111) != 0, info.st_size > 0, info.st_size <= 128_000_000 else {
            throw Failure.invalidFile
        }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: false)
        var hash = SHA256()
        var count: Int64 = 0
        while let bytes = try handle.read(upToCount: 1_048_576), !bytes.isEmpty {
            count += Int64(bytes.count)
            guard count <= info.st_size else { throw Failure.invalidFile }
            hash.update(data: bytes)
        }
        var after = stat(); var named = stat()
        // Prove both the descriptor and the named path still identify the
        // originally measured regular file. An atomic replacement, append,
        // truncation, permission/owner change or timestamp change is not the
        // same execution identity, even if a hash could still look plausible.
        guard fstat(fd, &after) == 0, lstat(url.path, &named) == 0, count == info.st_size,
              sameState(info, after), sameState(info, named) else { throw Failure.invalidFile }
        return FileSnapshot(sha256: hash.finalize().map { String(format: "%02x", $0) }.joined(), state: info)
    }
}
