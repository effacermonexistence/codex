import Foundation

/// Build 446 (DESIGN-5 §C, owner order 2026-10-29): `os1 storage report`,
/// the sizes of OS-1's own storage areas, so growth is visible.
///
/// "Storage must stop piling up. Never delete anything that has any
/// connection to OS-1." This report is READ-ONLY: it walks the areas without
/// following a symbolic link, never opens a file's contents and never
/// writes, moves, converts or deletes anything. Allocated bytes are the
/// file system's per-file allocation, so APFS clones (build 446's new
/// recovery and Fleet copies, which share unchanged blocks) are counted in
/// full here; the volume line shows what the disk really has left.
public enum StorageReport {
    public struct Area: Codable, Equatable, Sendable {
        public let name: String
        public let path: String
        public let present: Bool
        public let files: Int
        public let directories: Int
        public let logicalBytes: Int64
        public let allocatedBytes: Int64
        /// Entries the walk could not read (permissions); never retried as root.
        public let unreadable: Int
        enum CodingKeys: String, CodingKey {
            case name, path, present, files, directories, unreadable
            case logicalBytes = "logical_bytes", allocatedBytes = "allocated_bytes"
        }
    }
    public struct Report: Codable, Equatable, Sendable {
        public let schema: Int
        public let generatedAt: String
        public let areas: [Area]
        public let volumeAvailableBytes: Int64?
        public let volumeTotalBytes: Int64?
        public let note: String
        enum CodingKeys: String, CodingKey {
            case schema, areas, note
            case generatedAt = "generated_at", volumeAvailableBytes = "volume_available_bytes", volumeTotalBytes = "volume_total_bytes"
        }
    }

    /// OS-1's areas, most specific first; `os1 (other)` is everything else
    /// under ~/.os1 (each byte is counted once).
    public static func areas(home: URL) -> [(name: String, path: URL)] {
        let os1 = home.appendingPathComponent(".os1", isDirectory: true)
        return [
            ("recovery (installer copies)", os1.appendingPathComponent("recovery", isDirectory: true)),
            ("fleet jobs", os1.appendingPathComponent("fleet/jobs", isDirectory: true)),
            ("fleet mirrors", os1.appendingPathComponent("fleet/mirrors", isDirectory: true)),
            ("fleet checkout templates", os1.appendingPathComponent("fleet/checkout-templates", isDirectory: true)),
            ("local models (Ollama store)", os1.appendingPathComponent("local-router/models", isDirectory: true)),
            ("rcc runtime", os1.appendingPathComponent("rcc-runtime", isDirectory: true)),
            ("install backups", os1.appendingPathComponent("install-backups", isDirectory: true)),
            ("backups", os1.appendingPathComponent("backups", isDirectory: true)),
            ("os1 (other)", os1),
            ("application support", home.appendingPathComponent("Library/Application Support/OS-1", isDirectory: true)),
            ("caches", home.appendingPathComponent("Library/Caches/OS-1", isDirectory: true)),
            ("installed app", home.appendingPathComponent("Applications/OS-1 CLODEX.app", isDirectory: true)),
        ]
    }

    /// Walk one root without following links; `excluded` subtrees (counted
    /// by their own areas) are skipped.
    static func measure(name: String, root: URL, excluded: [URL]) -> Area {
        let manager = FileManager.default
        let keys: [URLResourceKey] = [.isRegularFileKey, .isDirectoryKey, .isSymbolicLinkKey, .fileSizeKey,
                                      .totalFileAllocatedSizeKey, .fileAllocatedSizeKey]
        var isDirectory: ObjCBool = false
        guard manager.fileExists(atPath: root.path, isDirectory: &isDirectory),
              (try? root.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) != true else {
            return Area(name: name, path: root.path, present: false, files: 0, directories: 0, logicalBytes: 0,
                        allocatedBytes: 0, unreadable: 0)
        }
        let skipped = Set(excluded.map { $0.standardizedFileURL.path })
        var files = 0, directories = 0, unreadable = 0
        var logical: Int64 = 0, allocated: Int64 = 0
        func add(_ values: URLResourceValues) {
            if values.isSymbolicLink == true { return }
            if values.isDirectory == true { directories += 1; return }
            files += 1
            logical += Int64(values.fileSize ?? 0)
            allocated += Int64(values.totalFileAllocatedSize ?? values.fileAllocatedSize ?? values.fileSize ?? 0)
        }
        if !isDirectory.boolValue {
            if let values = try? root.resourceValues(forKeys: Set(keys)) { add(values) } else { unreadable += 1 }
        } else if let walker = manager.enumerator(at: root, includingPropertiesForKeys: keys, options: [],
                                                   errorHandler: { _, _ in unreadable += 1; return true }) {
            directories += 1
            for case let url as URL in walker {
                if skipped.contains(url.standardizedFileURL.path) { walker.skipDescendants(); continue }
                guard let values = try? url.resourceValues(forKeys: Set(keys)) else { unreadable += 1; continue }
                add(values)
            }
        }
        return Area(name: name, path: root.path, present: true, files: files, directories: directories,
                    logicalBytes: logical, allocatedBytes: allocated, unreadable: unreadable)
    }

    public static func make(home: URL = FileManager.default.homeDirectoryForCurrentUser, now: Date = Date()) -> Report {
        let all = areas(home: home)
        let measured = all.map { area -> Area in
            // An area that contains a more specific area leaves it out.
            let inner = all.map(\.path).filter { $0 != area.path && $0.path.hasPrefix(area.path.path + "/") }
            return measure(name: area.name, root: area.path, excluded: inner)
        }
        let volume = try? home.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey, .volumeTotalCapacityKey])
        return Report(schema: 1, generatedAt: ISO8601DateFormatter().string(from: now), areas: measured,
                      volumeAvailableBytes: volume?.volumeAvailableCapacityForImportantUsage,
                      volumeTotalBytes: volume?.volumeTotalCapacity.map(Int64.init),
                      note: "read-only; nothing was deleted, moved or converted. Allocated bytes count APFS clones in full.")
    }

    public static func format(_ bytes: Int64) -> String {
        let units = ["B", "KB", "MB", "GB", "TB"]
        var value = Double(bytes), unit = 0
        while value >= 1000 && unit < units.count - 1 { value /= 1000; unit += 1 }
        return unit == 0 ? "\(bytes) B" : String(format: "%.1f %@", value, units[unit])
    }

    public static func text(_ report: Report) -> String {
        var lines = ["OS-1 storage (read-only report, \(report.generatedAt))"]
        let width = report.areas.map(\.name.count).max() ?? 0
        for area in report.areas {
            let name = area.name.padding(toLength: width, withPad: " ", startingAt: 0)
            lines.append(area.present
                ? "  \(name)  \(format(area.allocatedBytes)) allocated, \(format(area.logicalBytes)) logical, \(area.files) files" +
                    (area.unreadable > 0 ? ", \(area.unreadable) unreadable" : "")
                : "  \(name)  absent")
        }
        let total = report.areas.filter(\.present).reduce(Int64(0)) { $0 + $1.allocatedBytes }
        lines.append("  total allocated: \(format(total))")
        if let available = report.volumeAvailableBytes, let size = report.volumeTotalBytes {
            lines.append("  volume: \(format(available)) available of \(format(size))")
        }
        lines.append("  " + report.note)
        return lines.joined(separator: "\n") + "\n"
    }
}
