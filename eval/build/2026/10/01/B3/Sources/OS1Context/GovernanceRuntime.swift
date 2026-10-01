import Foundation
import Darwin

/// Local process telemetry, deliberately independent of completed token receipts.
/// CPU is ps's process-average percentage, NOT remote model utilization or token rate.
public struct GovernanceRuntimeSample: Identifiable, Sendable {
    public let id: Date
    public let cpuPercent: Double?
    public let residentBytes: Int64?
    public let processes: Int?
    public init(at: Date, cpu: Double?, bytes: Int64?, processes: Int?) {
        self.id = at; self.cpuPercent = cpu; self.residentBytes = bytes; self.processes = processes
    }
}

public enum GovernanceRuntime {
    public static func parse(_ text: String, roots: Set<Int32>, at: Date = Date()) -> GovernanceRuntimeSample {
        struct Row { let pid: Int32; let parent: Int32; let cpu: Double; let rss: Int64; let executable: String }
        let rows: [Row] = text.split(separator: "\n").compactMap { line in
            let p = line.split(maxSplits: 4, omittingEmptySubsequences: true, whereSeparator: { $0.isWhitespace })
            guard p.count == 5, let pid = Int32(p[0]), let parent = Int32(p[1]),
                  let cpu = Double(p[2]), cpu.isFinite, cpu >= 0,
                  let rss = Int64(p[3]), rss >= 0, rss <= Int64.max / 1024 else { return nil }
            return Row(pid: pid, parent: parent, cpu: cpu, rss: rss, executable: String(p[4]))
        }
        guard !rows.isEmpty else { return GovernanceRuntimeSample(at: at, cpu: nil, bytes: nil, processes: nil) }
        // A saved PID alone is insufficient: require a live OS1 executable too.
        var selected = Set(rows.filter { roots.contains($0.pid) && ["os1", "OS1App"].contains(URL(fileURLWithPath: $0.executable).lastPathComponent) }.map(\.pid))
        while true {
            let next = selected.union(rows.filter { selected.contains($0.parent) }.map(\.pid))
            if next == selected { break }; selected = next
        }
        let included = rows.filter { selected.contains($0.pid) }
        return GovernanceRuntimeSample(at: at, cpu: included.reduce(0) { $0 + $1.cpu },
            bytes: included.reduce(0) { $0 + $1.rss * 1024 }, processes: included.count)
    }

    public static func sample(roots: Set<Int32>) -> GovernanceRuntimeSample {
        let unknown = GovernanceRuntimeSample(at: Date(), cpu: nil, bytes: nil, processes: nil)
        // File-backed stdout avoids pipe-buffer deadlock. No command arguments,
        // environment, auth data, or provider requests are collected.
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("os1-process-sample-\(UUID()).txt")
        guard FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600]),
              let output = try? FileHandle(forWritingTo: url) else { return unknown }
        defer { try? output.close(); try? FileManager.default.removeItem(at: url) }
        let process = Process(); process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-axo", "pid=,ppid=,%cpu=,rss=,comm="]
        process.environment = ["PATH": "/usr/bin:/bin", "LC_ALL": "C"]
        process.standardOutput = output; process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return unknown }
        let deadline = ProcessInfo.processInfo.systemUptime + 0.75
        while process.isRunning && ProcessInfo.processInfo.systemUptime < deadline { Thread.sleep(forTimeInterval: 0.01) }
        if process.isRunning { kill(process.processIdentifier, SIGKILL); process.waitUntilExit(); return unknown }
        process.waitUntilExit()
        guard process.terminationStatus == 0, let text = try? String(contentsOf: url, encoding: .utf8) else { return unknown }
        return parse(text, roots: roots)
    }
}
