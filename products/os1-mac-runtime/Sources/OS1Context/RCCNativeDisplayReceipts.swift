import Darwin
import Foundation

/// Read-only display evidence. This does not execute, retry, grant a backend,
/// or certify task quality. Missing/unsafe evidence leaves the graph unknown.
public enum RCCNativeDisplayReceipts {
    private static let maximumBytes = 1_048_576

    public static func load(_ snapshot: RCCRuntimeContract.Snapshot,
                            homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser) -> [String: Data] {
        guard (try? RCCRuntimeContract.validate(snapshot)) != nil else { return [:] }
        let home = homeDirectory.standardizedFileURL
        guard home.isFileURL, home.path == homeDirectory.path,
              home.resolvingSymlinksInPath().path == home.path else { return [:] }
        let homeFD = open(home.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard homeFD >= 0 else { return [:] }
        defer { close(homeFD) }
        var parentFD = homeFD
        var ownedFDs: [Int32] = []
        defer { for fd in ownedFDs.reversed() { close(fd) } }
        for component in [".os1", "rcc-runtime", "native-receipts"] {
            let fd = openat(parentFD, component, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            guard fd >= 0 else { return [:] }
            ownedFDs.append(fd)
            var state = stat()
            guard fstat(fd, &state) == 0, state.st_uid == getuid(),
                  state.st_mode & 0o077 == 0 else { return [:] }
            parentFD = fd
        }
        let root = home.appendingPathComponent(".os1/rcc-runtime/native-receipts", isDirectory: true)
        // Current attempt-indexed display metadata is independent of the
        // terminal receipt. It cannot create children or certify execution.
        var receipts = RCCNativeDisplayStore.load(snapshot, homeDirectory: homeDirectory)
        for child in snapshot.children {
            guard let path = child.nativeReceipt, receipts[path] == nil else { continue }
            let file = URL(fileURLWithPath: path)
            guard file.standardizedFileURL.path == path,
                  file.deletingLastPathComponent().path == root.path,
                  file.pathExtension == "json",
                  UUID(uuidString: file.deletingPathExtension().lastPathComponent) != nil,
                  let bytes = readPrivateFile(file.lastPathComponent, parentFD: parentFD) else { continue }
            receipts[path] = bytes
        }
        return receipts
    }

    private static func readPrivateFile(_ name: String, parentFD: Int32) -> Data? {
        let fd = openat(parentFD, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard fd >= 0 else { return nil }
        defer { close(fd) }
        var before = stat()
        guard fstat(fd, &before) == 0, before.st_mode & S_IFMT == S_IFREG,
              before.st_uid == getuid(), before.st_nlink == 1, before.st_mode & 0o077 == 0,
              before.st_size > 0, before.st_size <= Int64(maximumBytes) else { return nil }
        var bytes = Data(), buffer = [UInt8](repeating: 0, count: 16_384)
        while true {
            let count = buffer.withUnsafeMutableBytes { read(fd, $0.baseAddress, $0.count) }
            if count < 0 { if errno == EINTR { continue }; return nil }
            if count == 0 { break }
            guard bytes.count + count <= maximumBytes else { return nil }
            bytes.append(contentsOf: buffer.prefix(count))
        }
        var after = stat(), named = stat()
        guard fstat(fd, &after) == 0,
              fstatat(parentFD, name, &named, AT_SYMLINK_NOFOLLOW) == 0,
              named.st_mode & S_IFMT == S_IFREG, named.st_uid == before.st_uid,
              named.st_nlink == 1, named.st_mode & 0o077 == 0,
              before.st_dev == named.st_dev, before.st_ino == named.st_ino,
              before.st_size == Int64(bytes.count), after.st_size == before.st_size,
              before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec,
              before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec,
              before.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec,
              before.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec else { return nil }
        return bytes
    }
}
