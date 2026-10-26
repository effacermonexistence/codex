import CryptoKit
import CoreFoundation
import Darwin
import Foundation
import OS1Context
import OS1HookSupport

private let fleetProfiles = ["codex", "claude", "os1", "build", "test", "exo"]
let fleetAgentCycleInterval: Duration = .seconds(20)
let fleetJobStatusInterval: Duration = .seconds(5)

/// A job this Mac submits for itself wakes the local agent at once instead of
/// on its next 20 s cycle (submitter and agent are separate processes). The
/// wake is only a hint: the agent still claims through the gateway.
enum FleetLocalWake {
    static var url: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/fleet/wake")
    }

    static func stamp(at url: URL = url) -> Date? {
        (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date
    }

    static func signal(at url: URL = url) {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                 attributes: [.posixPermissions: 0o700])
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600])
        }
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
    }

    /// Sleeps up to `limit`, returning early once the wake file changes after `seen`.
    static func sleep(upTo limit: Duration, since seen: Date?, at url: URL = url,
                      step: Duration = .milliseconds(250)) async throws {
        let deadline = ContinuousClock.now + limit
        while ContinuousClock.now < deadline {
            try await Task.sleep(for: min(step, deadline - ContinuousClock.now))
            if let now = stamp(at: url), now != seen { return }
        }
    }
}

/// Status polling for a job just submitted: quick at first, then every 5 s.
func fleetStatusInterval(elapsed: Duration) -> Duration {
    elapsed < .seconds(120) ? .seconds(1) : fleetJobStatusInterval
}
let fleetLaunchAgentThrottleIntervalSeconds = 20

private struct FleetNodeHeartbeat: Codable {
    let role: String
    let hostname: String
    let zeroTierIP: String
    let cpuLogicalCount: Int
    let loadAverageMilli: Int
    let memoryTotalMiB: Int
    let memoryAvailableMiB: Int
    let queueDepth: Int
    let hasCodex: Bool
    let hasClaude: Bool
    let exoReady: Bool
    let exoNodes: Int

    enum CodingKeys: String, CodingKey {
        case role, hostname
        case zeroTierIP = "zerotier_ip"
        case cpuLogicalCount = "cpu_logical_count"
        case loadAverageMilli = "load_average_milli"
        case memoryTotalMiB = "memory_total_mib"
        case memoryAvailableMiB = "memory_available_mib"
        case queueDepth = "queue_depth"
        case hasCodex = "has_codex"
        case hasClaude = "has_claude"
        case exoReady = "exo_ready"
        case exoNodes = "exo_nodes"
    }
}

private struct FleetHeartbeatRequest: Codable {
    let sentAtMs: Int64
    let nonce: String
    let node: FleetNodeHeartbeat
    let signature: String

    enum CodingKeys: String, CodingKey {
        case sentAtMs = "sent_at_ms"
        case nonce, node, signature
    }
}

private struct FleetHeartbeatResponse: Decodable {
    let status: String
    let staleAfterMs: Int

    enum CodingKeys: String, CodingKey {
        case status
        case staleAfterMs = "stale_after_ms"
    }
}

private struct FleetRequirements: Codable {
    let minMemoryMiB: Int
    let cpuWeight: Int
    let preferDeviceID: String?

    enum CodingKeys: String, CodingKey {
        case minMemoryMiB = "min_memory_mib"
        case cpuWeight = "cpu_weight"
        case preferDeviceID = "prefer_device_id"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(minMemoryMiB, forKey: .minMemoryMiB)
        try container.encode(cpuWeight, forKey: .cpuWeight)
        if let preferDeviceID {
            try container.encode(preferDeviceID, forKey: .preferDeviceID)
        } else {
            try container.encodeNil(forKey: .preferDeviceID)
        }
    }
}

private struct FleetSubmitRequest: Codable {
    let profile: String
    let task: String
    let workspaceRepository: String
    let workspaceRevision: String
    let workspaceSubpath: String
    let requirements: FleetRequirements
    let submittedAtMs: Int64
    let nonce: String
    let signature: String

    enum CodingKeys: String, CodingKey {
        case profile, task, requirements, nonce, signature
        case workspaceRepository = "workspace_repository"
        case workspaceRevision = "workspace_revision"
        case workspaceSubpath = "workspace_subpath"
        case submittedAtMs = "submitted_at_ms"
    }
}

private struct FleetAssignment: Codable {
    let jobID: String
    let submitterDeviceID: String
    let profile: String
    let task: String
    let workspaceRepository: String
    let workspaceRevision: String
    let workspaceSubpath: String
    let requirements: FleetRequirements
    let createdAtMs: Int64
    let expiresAtMs: Int64
    let objectiveVersion: String
    let executionMode: String
    let executorDeviceID: String
    let score: Double

    enum CodingKeys: String, CodingKey {
        case profile, task, requirements, score
        case jobID = "job_id"
        case submitterDeviceID = "submitter_device_id"
        case workspaceRepository = "workspace_repository"
        case workspaceRevision = "workspace_revision"
        case workspaceSubpath = "workspace_subpath"
        case createdAtMs = "created_at_ms"
        case expiresAtMs = "expires_at_ms"
        case objectiveVersion = "objective_version"
        case executionMode = "execution_mode"
        case executorDeviceID = "executor_device_id"
    }
}

struct FleetEnqueueReceipt: Codable {
    let jobID: String
    let profile: String
    let executionMode: String
    let executorDeviceID: String
    let objectiveVersion: String

    enum CodingKeys: String, CodingKey {
        case profile
        case jobID = "job_id"
        case executionMode = "execution_mode"
        case executorDeviceID = "executor_device_id"
        case objectiveVersion = "objective_version"
    }
}

private struct FleetSubmitResponse: Decodable {
    let status: String
    let assignment: FleetAssignment?
}

private struct FleetClaimRequest: Codable {
    let sentAtMs: Int64
    let nonce: String
    let signature: String

    enum CodingKeys: String, CodingKey {
        case sentAtMs = "sent_at_ms"
        case nonce, signature
    }
}

private struct FleetClaimResponse: Decodable {
    let status: String
    let assignment: FleetAssignment?
}

private struct FleetSnapshotNode: Codable {
    let deviceID: String
    let role: String
    let hostname: String
    let zeroTierIP: String
    let cpuLogicalCount: Int
    let loadAverage1m: Double
    let memoryTotalMiB: Int
    let memoryAvailableMiB: Int
    let queueDepth: Int
    let hasCodex: Bool
    let hasClaude: Bool
    let exoReady: Bool
    let exoNodes: Int
    let lastSeenMs: Int64

    enum CodingKeys: String, CodingKey {
        case role, hostname
        case deviceID = "device_id"
        case zeroTierIP = "zerotier_ip"
        case cpuLogicalCount = "cpu_logical_count"
        case loadAverage1m = "load_average_1m"
        case memoryTotalMiB = "memory_total_mib"
        case memoryAvailableMiB = "memory_available_mib"
        case queueDepth = "queue_depth"
        case hasCodex = "has_codex"
        case hasClaude = "has_claude"
        case exoReady = "exo_ready"
        case exoNodes = "exo_nodes"
        case lastSeenMs = "last_seen_ms"
    }
}

private struct FleetSnapshotResponse: Codable {
    let nodes: [FleetSnapshotNode]
}

private struct FleetCompleteRequest: Codable {
    let jobID: String
    let outcome: String
    let result: String
    let resultHash: String
    let completedAtMs: Int64
    let nonce: String
    let signature: String

    enum CodingKeys: String, CodingKey {
        case outcome, result, nonce, signature
        case jobID = "job_id"
        case resultHash = "result_hash"
        case completedAtMs = "completed_at_ms"
    }
}

/// The gateway bounds the WHOLE /v1/fleet/complete body (MAX_REQUEST_BYTES
/// 65,536), not the result alone, and that body carries the result again as
/// an escaped JSON string: a receipt cut to 65,535 bytes became a 72,703-byte
/// request, was refused with HTTP 400 (never retried as a success) and kept
/// the agent from claiming anything until the claimed job's 12-hour TTL.
/// Every result is therefore sized against the request itself, with a margin.
let fleetCompleteRequestLimit = 65_536
let fleetCompleteRequestMargin = 1_024

/// The encoded /v1/fleet/complete body for `result`: the same fields and the
/// same default JSONEncoder as APIClient.postOnce, with the nonce, signature
/// and timestamp at the longest lengths the gateway accepts.
func fleetCompleteRequestBytes(outcome: String, result: String) -> Int {
    let request = FleetCompleteRequest(jobID: String(repeating: "0", count: 36), outcome: outcome, result: result,
        resultHash: String(repeating: "0", count: 64), completedAtMs: 9_007_199_254_740_991,
        nonce: String(repeating: "A", count: 128), signature: String(repeating: "A", count: 256))
    return (try? JSONEncoder().encode(request).count) ?? Int.max
}

func fleetResultFitsCompleteRequest(_ result: String, outcome: String) -> Bool {
    fleetCompleteRequestBytes(outcome: outcome, result: result) <= fleetCompleteRequestLimit - fleetCompleteRequestMargin
}

private struct FleetStatusRequest: Codable {
    let jobID: String
    let sentAtMs: Int64
    let nonce: String
    let signature: String

    enum CodingKeys: String, CodingKey {
        case jobID = "job_id"
        case sentAtMs = "sent_at_ms"
        case nonce, signature
    }
}

private struct FleetJobStatus: Codable {
    let jobID: String
    let state: String
    let profile: String
    let executionMode: String
    let executorDeviceID: String
    let objectiveVersion: String
    let result: String?
    let resultHash: String?

    enum CodingKeys: String, CodingKey {
        case state, profile, result
        case jobID = "job_id"
        case executionMode = "execution_mode"
        case executorDeviceID = "executor_device_id"
        case objectiveVersion = "objective_version"
        case resultHash = "result_hash"
    }
}

private struct FleetExecutionReceipt: Codable {
    let schema = 1
    let jobID: String
    let nodeRole: String
    let deviceID: String
    let profile: String
    let repository: String
    let revision: String
    let resultBranch: String?
    let resultCommit: String?
    var run: RunSummary
    /// OpenClaw Core's own result for this job (`FleetCoreOutcome`). Absent on
    /// EXO and legacy receipts, whose validation is unchanged.
    var core: FleetCoreOutcome? = nil

    enum CodingKeys: String, CodingKey {
        case schema, profile, repository, revision, run, core
        case jobID = "job_id"
        case nodeRole = "node_role"
        case deviceID = "device_id"
        case resultBranch = "result_branch"
        case resultCommit = "result_commit"
    }
}

private func fleetNowMs() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1_000)
}

private func requireFleetReceiptProtocol(_ config: RuntimeConfig) async throws {
    guard let base = URL(string: config.apiURL), let url = URL(string: "/v1/capabilities", relativeTo: base) else {
        throw OS1Error.message("Invalid Fleet service URL")
    }
    var request = URLRequest(url: url)
    request.timeoutInterval = 5
    request.cachePolicy = .reloadIgnoringLocalCacheData
    let (data, response) = try await URLSession.shared.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200, data.count <= 4096,
          let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let protocolVersion = object["fleet_receipt_protocol"] as? NSNumber,
          CFGetTypeID(protocolVersion) != CFBooleanGetTypeID(), protocolVersion.doubleValue == 1 else {
        throw OS1Error.message("Fleet service does not support safe submission recovery; no job submitted")
    }
}

private func fleetBytes(_ kind: String, deviceID: String, fields: [CustomStringConvertible?]) -> Data {
    let values = fields.map { item -> String in
        guard let item else { return "" }
        if let boolean = item as? Bool { return boolean ? "true" : "false" }
        return item.description
    }
    return Data(([kind, deviceID] + values).joined(separator: "\n").utf8)
}

private func heartbeatBytes(deviceID: String, sentAtMs: Int64, nonce: String, node: FleetNodeHeartbeat) -> Data {
    fleetBytes("os1-fleet-heartbeat-v1", deviceID: deviceID, fields: [
        sentAtMs, nonce, node.role, node.hostname, node.zeroTierIP, node.cpuLogicalCount,
        node.loadAverageMilli, node.memoryTotalMiB, node.memoryAvailableMiB, node.queueDepth,
        node.hasCodex, node.hasClaude, node.exoReady, node.exoNodes,
    ])
}

private func submitBytes(deviceID: String, request: FleetSubmitRequest) -> Data {
    fleetBytes("os1-fleet-submit-v1", deviceID: deviceID, fields: [
        request.profile, request.task, request.workspaceRepository, request.workspaceRevision,
        request.workspaceSubpath, request.requirements.minMemoryMiB, request.requirements.cpuWeight,
        request.requirements.preferDeviceID, request.submittedAtMs, request.nonce,
    ])
}

private func claimBytes(deviceID: String, sentAtMs: Int64, nonce: String) -> Data {
    fleetBytes("os1-fleet-claim-v1", deviceID: deviceID, fields: [sentAtMs, nonce])
}

private func completeBytes(deviceID: String, request: FleetCompleteRequest) -> Data {
    fleetBytes("os1-fleet-complete-v1", deviceID: deviceID, fields: [
        request.jobID, request.outcome, request.result, request.resultHash,
        request.completedAtMs, request.nonce,
    ])
}

private func statusBytes(deviceID: String, jobID: String, sentAtMs: Int64, nonce: String) -> Data {
    fleetBytes("os1-fleet-status-v1", deviceID: deviceID, fields: [jobID, sentAtMs, nonce])
}

private func fleetZeroTierIP() throws -> String {
    var interfaces: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&interfaces) == 0, let first = interfaces else {
        throw OS1Error.message("ZeroTier interface inspection failed")
    }
    defer { freeifaddrs(first) }

    var cursor: UnsafeMutablePointer<ifaddrs>? = first
    while let interface = cursor?.pointee {
        defer { cursor = interface.ifa_next }
        guard let socketAddress = interface.ifa_addr,
              socketAddress.pointee.sa_family == UInt8(AF_INET) else { continue }
        var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        guard getnameinfo(
            socketAddress,
            socklen_t(socketAddress.pointee.sa_len),
            &buffer,
            socklen_t(buffer.count),
            nil,
            0,
            NI_NUMERICHOST
        ) == 0 else { continue }
        let value = String(decoding: buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
        if value.hasPrefix("10.215.90."), value.split(separator: ".").count == 4 {
            return value
        }
    }
    throw OS1Error.message("OS-1 ZeroTier address is unavailable")
}

private func fleetAvailableMemoryMiB() -> Int {
    var statistics = vm_statistics64()
    var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64_data_t>.size / MemoryLayout<integer_t>.size)
    let status = withUnsafeMutablePointer(to: &statistics) { pointer in
        pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count)
        }
    }
    guard status == KERN_SUCCESS else { return Int(ProcessInfo.processInfo.physicalMemory / 4 / 1_048_576) }
    var pageSize: vm_size_t = 0
    host_page_size(mach_host_self(), &pageSize)
    let pages = UInt64(statistics.free_count + statistics.inactive_count + statistics.speculative_count)
    return Int(pages * UInt64(pageSize) / 1_048_576)
}

private func fleetLoadAverageMilli() -> Int {
    var loads = [Double](repeating: 0, count: 3)
    guard getloadavg(&loads, 3) == 3 else { return 0 }
    return max(0, Int((loads[0] * 1_000).rounded()))
}

private func fleetEXONodes(config: RuntimeConfig) async -> Int {
    guard let base = try? EXOConfiguration(runtimeConfig: config).apiURL else { return 0 }
    var request = URLRequest(url: base.appendingPathComponent("state/topology"))
    request.timeoutInterval = 3
    do {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let nodes = body["nodes"] as? [String] else { return 0 }
        return Set(nodes).count
    } catch { return 0 }
}

/// Advertised capacity means "can run a job now", never "binary installed".
/// A logged-out Claude or an exhausted Codex quota is not capacity, and an
/// unknown state (no probe yet) is not capacity either — the gateway must not
/// place work on a node that will fail it at preflight.
func fleetAdvertisedCapabilities(health: BackendHealth?, codexExecutable: Bool, claudeExecutable: Bool) -> (codex: Bool, claude: Bool) {
    guard let health else { return (false, false) }
    return (codexExecutable && health.codex.usable, claudeExecutable && health.claude.usable)
}

/// Single in-process health refresh; the heartbeat never blocks on the probe.
private actor FleetHealthRefresh {
    private var running = false
    func begin() -> Bool { if running { return false }; running = true; return true }
    func end() { running = false }
}
private let fleetHealthRefresh = FleetHealthRefresh()

private func fleetHeartbeatNode(role: String, config: RuntimeConfig) async throws -> FleetNodeHeartbeat {
    guard role == "pro" || role == "air" else { throw OS1Error.message("Fleet role must be pro or air") }
    let exoNodes = await fleetEXONodes(config: config)
    let health = BackendHealth.load(maxAge: 120)
    if health == nil, await fleetHealthRefresh.begin() {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        Task.detached(priority: .utility) {
            probeBackendHealth(workspace: home, config: config)
            await fleetHealthRefresh.end()
        }
    }
    // While a refresh runs, a record up to 15 minutes old is still the best
    // evidence; a node with no record at all advertises no backend capacity.
    let capabilities = fleetAdvertisedCapabilities(health: health ?? BackendHealth.load(maxAge: 900),
        codexExecutable: (try? findExecutable("codex")) != nil, claudeExecutable: (try? findExecutable("claude")) != nil)
    return FleetNodeHeartbeat(
        role: role,
        hostname: ProcessInfo.processInfo.hostName,
        zeroTierIP: try fleetZeroTierIP(),
        cpuLogicalCount: max(1, ProcessInfo.processInfo.activeProcessorCount),
        loadAverageMilli: fleetLoadAverageMilli(),
        memoryTotalMiB: Int(ProcessInfo.processInfo.physicalMemory / 1_048_576),
        memoryAvailableMiB: fleetAvailableMemoryMiB(),
        queueDepth: 0,
        hasCodex: capabilities.codex,
        hasClaude: capabilities.claude,
        exoReady: exoNodes >= 2,
        exoNodes: exoNodes
    )
}

private func sendFleetHeartbeat(client: APIClient, key: SigningKey, role: String) async throws -> FleetNodeHeartbeat {
    let node = try await fleetHeartbeatNode(role: role, config: client.config)
    let now = fleetNowMs()
    let nonce = try randomNonce()
    let signature = Base64URL.encode(try key.sign(heartbeatBytes(deviceID: client.deviceID, sentAtMs: now, nonce: nonce, node: node)))
    let request = FleetHeartbeatRequest(sentAtMs: now, nonce: nonce, node: node, signature: signature)
    let response: FleetHeartbeatResponse = try await client.post("/v1/fleet/heartbeat", body: request, as: FleetHeartbeatResponse.self)
    guard response.status == "online", response.staleAfterMs == 30_000 else {
        throw OS1Error.message("Fleet heartbeat was not adopted")
    }
    return node
}

private func fleetClaim(client: APIClient, key: SigningKey, nonce: String) async throws -> FleetAssignment? {
    let now = fleetNowMs()
    let signature = Base64URL.encode(try key.sign(claimBytes(deviceID: client.deviceID, sentAtMs: now, nonce: nonce)))
    let response: FleetClaimResponse = try await client.deliver(
        "/v1/fleet/claim",
        body: FleetClaimRequest(sentAtMs: now, nonce: nonce, signature: signature),
        as: FleetClaimResponse.self
    )
    guard (response.status == "idle" && response.assignment == nil) ||
          (response.status == "claimed" && response.assignment?.executorDeviceID == client.deviceID) else {
        throw OS1Error.message("Fleet claim response rejected")
    }
    return response.assignment
}

private func fleetJobsRoot() -> URL {
    FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/fleet/jobs", isDirectory: true)
}

private func fleetJobDirectory(_ jobID: String, jobs: URL = fleetJobsRoot()) throws -> URL {
    guard UUID(uuidString: jobID) != nil else { throw OS1Error.message("Fleet job identity rejected") }
    let directory = jobs.appendingPathComponent(jobID, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    return directory
}

/// A per-repository bare mirror makes each job's checkout a local, hard-linked
/// clone (≈1 s) instead of a fresh network clone (≈8 s for this repository,
/// 2026-09-24). Any mirror failure falls back to the network clone.
func fleetMirrorClone(repository: String, revision: String, into destination: URL,
                      mirrors: URL = FileManager.default.homeDirectoryForCurrentUser
                          .appendingPathComponent(".os1/fleet/mirrors", isDirectory: true),
                      remote: String? = nil) -> Bool {
    let parts = repository.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    guard parts.count == 2, parts.allSatisfy({ $0.wholeMatch(of: /[A-Za-z0-9][A-Za-z0-9._-]{0,99}/) != nil }),
          revision.wholeMatch(of: /[0-9a-f]{40}/) != nil, let git = try? findExecutable("git") else { return false }
    let origin = remote ?? "https://github.com/\(repository).git"
    let mirror = mirrors.appendingPathComponent(parts[0], isDirectory: true)
        .appendingPathComponent(parts[1] + ".git", isDirectory: true)
    func run(_ arguments: [String], timeout: Int) -> Bool {
        (try? commandOutput(git, arguments, timeout: timeout))?.0 == 0
    }
    do {
        try FileManager.default.createDirectory(at: mirror.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
    } catch { return false }
    if !FileManager.default.fileExists(atPath: mirror.appendingPathComponent("HEAD").path) {
        try? FileManager.default.removeItem(at: mirror)
        guard run(["clone", "--bare", "--no-tags", "--quiet", origin, mirror.path], timeout: 900) else {
            try? FileManager.default.removeItem(at: mirror)
            return false
        }
    }
    guard run(["-C", mirror.path, "fetch", "--no-tags", "--quiet", origin, revision], timeout: 600),
          run(["-C", mirror.path, "cat-file", "-e", revision + "^{commit}"], timeout: 20),
          run(["clone", "--local", "--no-checkout", "--quiet", mirror.path, destination.path], timeout: 300),
          run(["-C", destination.path, "remote", "set-url", "origin", origin], timeout: 20),
          run(["-C", destination.path, "cat-file", "-e", revision + "^{commit}"], timeout: 20) else {
        try? FileManager.default.removeItem(at: destination)
        return false
    }
    return true
}

private func fleetCheckout(_ assignment: FleetAssignment) throws -> String {
    let directory = try fleetJobDirectory(assignment.jobID)
    let repository = directory.appendingPathComponent("repository", isDirectory: true)
    let git = try findExecutable("git")
    if !FileManager.default.fileExists(atPath: repository.appendingPathComponent(".git").path),
       !fleetMirrorClone(repository: assignment.workspaceRepository, revision: assignment.workspaceRevision, into: repository) {
        let gh = try findExecutable("gh")
        let cloned = try commandOutput(gh, ["repo", "clone", assignment.workspaceRepository, repository.path, "--", "--filter=blob:none"], timeout: 600)
        guard cloned.0 == 0 else { throw OS1Error.message("Fleet repository clone failed") }
    }
    // A mirror-cloned (or resumed) checkout that already holds the revision
    // skips the network fetch.
    let present = try commandOutput(git, ["-C", repository.path, "cat-file", "-e", assignment.workspaceRevision + "^{commit}"], timeout: 20)
    if present.0 != 0 {
        let fetched = try commandOutput(git, ["-C", repository.path, "fetch", "--no-tags", "origin", assignment.workspaceRevision], timeout: 600)
        guard fetched.0 == 0 else { throw OS1Error.message("Fleet revision fetch failed") }
    }
    let checked = try commandOutput(git, ["-C", repository.path, "checkout", "--detach", assignment.workspaceRevision], timeout: 60)
    guard checked.0 == 0 else { throw OS1Error.message("Fleet revision checkout failed") }
    let workspace = assignment.workspaceSubpath.isEmpty
        ? repository
        : repository.appendingPathComponent(assignment.workspaceSubpath, isDirectory: true)
    let root = repository.resolvingSymlinksInPath().path + "/"
    let path = workspace.resolvingSymlinksInPath().path
    guard (path + "/").hasPrefix(root), FileManager.default.fileExists(atPath: path) else {
        throw OS1Error.message("Fleet workspace path rejected")
    }
    return path
}

private func fleetCommitResult(_ assignment: FleetAssignment, workspace: String) throws -> (String?, String?) {
    try fleetPublishResult(jobID: assignment.jobID, workspace: workspace, baseRevision: assignment.workspaceRevision)
}

/// Build products a backend leaves in the checkout are never part of a fleet
/// result. Job ff3819eb (2026-10-01) fixed a Swift package correctly, but
/// `git add -A` also committed its SwiftPM `.build` (2,016 files, 100 MB; the
/// repository ignores only OS-1's own `.build`), the push failed, and the
/// owner was told the job failed.
let fleetResultExcludedPathspecs = [
    ":(exclude,glob)**/.build/**", ":(exclude,glob)**/.swiftpm/**", ":(exclude,glob)**/DerivedData/**",
    ":(exclude,glob)**/__pycache__/**", ":(exclude,glob)**/.pytest_cache/**", ":(exclude,glob)**/node_modules/**",
    ":(exclude,glob)**/*.pyc",
]

/// Git's own reason for a failed publication step, bounded and with any
/// credential in a URL or token form removed, so a failure names its cause.
func fleetPublicationFailure(_ step: String, _ stderr: Data) -> OS1Error {
    var reason = String(decoding: stderr.suffix(600), as: UTF8.self)
        .replacingOccurrences(of: #"(https?://)[^/@\s]+@"#, with: "$1***@", options: .regularExpression)
        .replacingOccurrences(of: #"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})"#, with: "***", options: .regularExpression)
        .split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        .suffix(4).joined(separator: " | ")
    if reason.count > 400 { reason = String(reason.suffix(400)) }
    return OS1Error.message("Fleet result publication failed (\(step)\(reason.isEmpty ? "" : ": " + reason))")
}

/// Publishes a job's checkout changes as branch os1-fleet/<job>. With the
/// job's assigned `baseRevision`, a checkout that already moved past it is
/// published too, never reported as "nothing changed": an agent that ended
/// after its result commit (or during the up to 600 s push), or a task that
/// committed its own work, leaves a clean tree whose commits would otherwise
/// sit unreported on a local branch. The push of the same commit is
/// idempotent; a checkout that is not a descendant of the assigned revision
/// is refused, never published.
func fleetPublishResult(jobID: String, workspace: String, remote: String = "origin",
                        baseRevision: String? = nil) throws -> (String?, String?) {
    let git = try findExecutable("git")
    let repository = URL(fileURLWithPath: workspace).standardizedFileURL
    let rootResult = try commandOutput(git, ["-C", repository.path, "rev-parse", "--show-toplevel"], timeout: 20)
    guard rootResult.0 == 0 else { throw OS1Error.message("Fleet repository root unavailable") }
    let root = String(decoding: rootResult.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    let branch = "os1-fleet/\(jobID.lowercased())"
    func head() throws -> String {
        let revision = try commandOutput(git, ["-C", root, "rev-parse", "HEAD"], timeout: 20)
        guard revision.0 == 0 else { throw OS1Error.message("Fleet result revision unavailable") }
        return String(decoding: revision.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    let current = try commandOutput(git, ["-C", root, "symbolic-ref", "--quiet", "--short", "HEAD"], timeout: 20)
    var onBranch = current.0 == 0
        && String(decoding: current.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines) == branch
    func switchToBranch() throws {
        guard !onBranch else { return }
        let switched = try commandOutput(git, ["-C", root, "switch", "-c", branch], timeout: 30)
        guard switched.0 == 0 else { throw fleetPublicationFailure("branch", switched.2) }
        onBranch = true
    }
    let changed = try commandOutput(git, ["-C", root, "status", "--porcelain=v1"], timeout: 30)
    guard changed.0 == 0 else { throw OS1Error.message("Fleet result inspection failed") }
    var committed = false
    if !changed.1.isEmpty {
        let staged = try commandOutput(git, ["-C", root, "add", "-A", "--", "."] + fleetResultExcludedPathspecs, timeout: 120)
        guard staged.0 == 0 else { throw fleetPublicationFailure("stage", staged.2) }
        // Only build products changed: nothing new to commit.
        let pending = try commandOutput(git, ["-C", root, "diff", "--cached", "--quiet"], timeout: 30)
        guard pending.0 == 0 || pending.0 == 1 else { throw fleetPublicationFailure("inspect", pending.2) }
        if pending.0 == 1 {
            try switchToBranch()
            let commit = try commandOutput(git, ["-C", root, "commit", "-m", "OS-1 fleet result \(jobID)"], timeout: 120)
            guard commit.0 == 0 else { throw fleetPublicationFailure("commit", commit.2) }
            committed = true
        }
    }
    if !committed {
        guard let baseRevision else { return (nil, nil) }
        let tip = try head()
        if tip == baseRevision { return (nil, nil) }
        let descendant = try commandOutput(git, ["-C", root, "merge-base", "--is-ancestor", baseRevision, tip], timeout: 30)
        guard descendant.0 == 0 else {
            throw OS1Error.message("Fleet job checkout is not a descendant of its assigned revision; nothing was published")
        }
        try switchToBranch()
    }
    let pushed = try commandOutput(git, ["-C", root, "push", remote, "HEAD:refs/heads/\(branch)"], timeout: 600)
    guard pushed.0 == 0 else { throw fleetPublicationFailure("push", pushed.2) }
    return (branch, try head())
}


/// The exact request a fleet job hands to OpenClaw Core. Core keeps the task
/// under task_id = job id and request_sha256 = sha256 of this text, so a
/// restarted agent can find the task it started without resubmitting it.
func fleetPrompt(profile: String, task: String) -> String {
    switch profile {
    case "build": return "Build the repository as requested and verify the build.\n\n\(task)"
    case "test": return "Run and verify the requested repository tests.\n\n\(task)"
    default: return task
    }
}

private func fleetPrompt(for assignment: FleetAssignment) -> String {
    fleetPrompt(profile: assignment.profile, task: assignment.task)
}

/// Fleet remains delivery/check-out custody, not another task router: a
/// named backend is the job's own constraint, anything else is Auto.
func fleetProviderPreference(profile: String) -> String {
    ["codex", "claude"].contains(profile) ? profile : "auto"
}

/// OpenClaw Core's own terminal result for a fleet job, carried in the signed
/// receipt beside the host run summary. Core is the authority: the fleet maps
/// a snapshot once (`fleetCoreDisposition`) and applies no routing or quality
/// policy of its own, so it delivers exactly what the CLI and App deliver for
/// the same snapshot, with the same label.
struct FleetCoreOutcome: Codable, Equatable {
    let taskID: String
    let requestSHA256: String
    let state: String
    let revision: Int
    /// "task_verified" (Core completed) or "unverified" (returned_unverified).
    let verification: String
    /// `RCCRuntimeProjection.rootDescription` of the snapshot: the App's text.
    let label: String
    let error: String?
    /// Core's answer. Cut only to fit the signed result limit, and then
    /// `outputTruncated` is true and `outputSHA256` names the full answer.
    var output: String
    let outputSHA256: String
    let outputBytes: Int
    var outputTruncated: Bool
    /// Never present on a delivered answer: a partial result is undelivered.
    let partialCoverage: String?
    let parityState: String
    let taskQuality: String?
    let executionVerified: Bool
    let taskVerified: Bool
    /// R6: the checks Core disclosed for this answer (failed check IDs, an
    /// unavailable checker), projected as the App shows them beside the
    /// label. Absent when Core disclosed nothing.
    var qualityDisclosure: FleetCoreDisclosure? = nil

    enum CodingKeys: String, CodingKey {
        case state, revision, verification, label, error, output
        case taskID = "task_id", requestSHA256 = "request_sha256"
        case outputSHA256 = "output_sha256", outputBytes = "output_bytes", outputTruncated = "output_truncated"
        case partialCoverage = "partial_coverage", parityState = "parity_state", taskQuality = "task_quality"
        case executionVerified = "execution_verified", taskVerified = "task_verified"
        case qualityDisclosure = "quality_disclosure"
    }
}

/// Core's R6 disclosure for a delivered answer, exactly as the App's receipt
/// shows it (OS1App rccCoreReceipt): at most eight failed check IDs named,
/// an unavailable checker kept apart from a failed-check verdict.
struct FleetCoreDisclosure: Codable, Equatable {
    /// Distinct, sorted, at most eight (the App's visible list).
    let failedCheckIDs: [String]
    /// Every distinct failed check ID Core named.
    let failedCheckCount: Int
    let checkerUnavailable: Bool
    /// The App's English disclosure lines, newline-separated.
    let text: String

    enum CodingKeys: String, CodingKey {
        case text
        case failedCheckIDs = "failed_check_ids", failedCheckCount = "failed_check_count"
        case checkerUnavailable = "checker_unavailable"
    }
}

/// The App's disclosure projection of one Core snapshot (rccCoreReceipt):
/// nil when no child carries a quality disclosure.
func fleetCoreDisclosure(_ core: RCCRuntimeContract.Snapshot) -> FleetCoreDisclosure? {
    let disclosures = core.children.compactMap(\.qualityDisclosure)
    guard !disclosures.isEmpty else { return nil }
    let failed = Array(Set(disclosures.flatMap(\.failedCheckIDs))).sorted()
    let visible = failed.prefix(8).map { check in
        String(check.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) })
    }
    let unavailable = disclosures.contains { $0.checker == .unavailable }
    var lines: [String] = []
    if !failed.isEmpty {
        lines.append("Core-reported failed checks: " + visible.joined(separator: ", ")
                     + (failed.count > 8 ? " · +\(failed.count - 8)" : ""))
    }
    if unavailable { lines.append("Checker unavailable · not itself a failed-check verdict") }
    if lines.isEmpty { lines.append("Core check record present · task completion/reference parity unverified") }
    return FleetCoreDisclosure(failedCheckIDs: Array(visible), failedCheckCount: failed.count,
                               checkerUnavailable: unavailable, text: lines.joined(separator: "\n"))
}

/// A carried disclosure says what Core's disclosure says, and only an
/// unverified answer carries one (Core settles a disclosed task returned_unverified).
func fleetCoreDisclosureIsValid(_ disclosure: FleetCoreDisclosure?, state: String) -> Bool {
    guard let disclosure else { return true }
    let ids = disclosure.failedCheckIDs
    var lines: [String] = []
    if !ids.isEmpty {
        lines.append("Core-reported failed checks: " + ids.joined(separator: ", ")
                     + (disclosure.failedCheckCount > 8 ? " · +\(disclosure.failedCheckCount - 8)" : ""))
    }
    if disclosure.checkerUnavailable { lines.append("Checker unavailable · not itself a failed-check verdict") }
    if lines.isEmpty { lines.append("Core check record present · task completion/reference parity unverified") }
    return state == "returned_unverified" && ids == Array(Set(ids)).sorted()
        && ids.count == min(8, disclosure.failedCheckCount) && ids.allSatisfy { !$0.isEmpty }
        && disclosure.text == lines.joined(separator: "\n")
}

enum FleetCoreDisposition {
    /// Core completed, or returned an unverified whole answer: delivered.
    case delivered(FleetCoreOutcome)
    /// Every other state, with what Core kept: reported as "failed".
    case undelivered([String: String])
}

enum FleetCoreResolution {
    case delivered(RunSummary, FleetCoreOutcome)
    case undelivered([String: String])
}

/// A fleet job that ended without a deliverable answer. Its result replaces
/// the receipt and is never a success claim.
struct FleetUndelivered: Error, CustomStringConvertible {
    let result: [String: String]
    var description: String { result["error"] ?? "Fleet job was not delivered" }
}

private let fleetCoreDeliverableStates: Set<RCCRuntimeContract.State> = [
    .held, .completed, .returnedUnverified, .awaitingInstall, .cancelled, .effectsUncertain, .failed,
]

/// This executable, so the command names the binary that ran the job. It
/// reads THIS Mac's OpenClaw Core: the task exists only on the executor.
let fleetExecutablePath: String = {
    let invoked = URL(fileURLWithPath: CommandLine.arguments.first ?? "os1").resolvingSymlinksInPath().path
    return FileManager.default.isExecutableFile(atPath: invoked) ? invoked : "os1"
}()

func fleetObserveCommand(taskID: String, requestSHA256: String, executable: String = fleetExecutablePath) -> String {
    let quoted = executable == "os1" ? executable : "'" + executable.replacingOccurrences(of: "'", with: "'\\''") + "'"
    return "\(quoted) rcc-task-status --task-id \(taskID) --request-sha256 \(requestSHA256)"
}

/// An error as its owner can act on it: a gateway refusal is named by its
/// stable code (rcc_runtime_rpc_rejected_no_state_reuse), not the Swift case.
func fleetErrorText(_ error: Error) -> String {
    if let failure = error as? RCCRuntimeGatewayClient.Failure { return failure.rawValue }
    if let undelivered = error as? FleetUndelivered { return undelivered.description }
    return String(String(describing: error).prefix(8_000))
}

/// A failure result always fits the gateway's /v1/fleet/complete request
/// (`fleetResultFitsCompleteRequest`), as encoded and sent: the longest
/// carried text is halved (and marked `<key>_truncated`) until it fits.
/// A Core answer stays whole in Core (observe_command); nothing is cut silently.
func fleetBoundedFailure(_ value: [String: String]) -> [String: String] {
    var value = value
    let carried = ["partial_answer", "handoff_answer", "unadopted_answer", "workflow_blocker", "routing_notices",
                   "error", "core_error", "core_status_error", "core_quality_disclosure"]
    func fits(_ value: [String: String]) -> Bool {
        guard let data = try? JSONEncoder().encode(value) else { return false }
        return fleetResultFitsCompleteRequest(String(decoding: data, as: UTF8.self), outcome: "failed")
    }
    while !fits(value) {
        guard let key = carried.filter({ ($0 == "error" ? 256 : 64) < (value[$0]?.count ?? 0) })
            .max(by: { (value[$0]?.utf8.count ?? 0) < (value[$1]?.utf8.count ?? 0) }), let text = value[key] else { break }
        value[key] = String(text.prefix(text.count / 2))
        value[key + "_truncated"] = "true"
    }
    guard !fits(value) else { return value }
    // Nothing carried is long enough to halve: keep identity and the reason only.
    var minimal = ["result_truncated": "true"]
    for key in ["job_id", "core_admitted", "core_task_id", "request_sha256", "core_state", "observe_command", "agent_restarted"] {
        if let text = value[key] { minimal[key] = String(text.prefix(512)) }
    }
    minimal["error"] = String((value["error"] ?? "Fleet job failed").prefix(2_000))
    return minimal
}

/// Whether any Core child started an attempt (a native or local model call).
func fleetCoreModelDispatched(_ snapshot: RCCRuntimeContract.Snapshot) -> Bool {
    snapshot.children.contains { $0.attemptID != nil }
        || (snapshot.resourceUsage?.nativeAttempts ?? 0) > 0 || (snapshot.resourceUsage?.localWorkerAttempts ?? 0) > 0
}

/// The one map from a Core snapshot to a fleet outcome, used by execution and
/// by reconciliation alike. completed and an unverified whole answer are
/// delivered (the latter labelled exactly as the App labels it); a typed
/// partial, a hold, a failure, uncertain effects or a pending installation
/// are reported failed with what Core kept, never as an answer.
func fleetCoreDisposition(_ snapshot: RCCRuntimeContract.Snapshot?, run: RunSummary, jobID: String,
                          resultContractVersion: Int? = RCCRunBudgetOptions.appResultContractVersion) -> FleetCoreDisposition {
    let notices = (run.routingNotices ?? []).joined(separator: "\n")
    guard let core = snapshot else {
        var failure: [String: String] = [
            "error": "OS-1 held this fleet job before OpenClaw Core returned a task: " + (run.workflowBlocker ?? run.status),
            "job_id": jobID,
            "workflow_blocker": run.workflowBlocker ?? run.status,
            "partial_work": "Inspect this job's native records and checkout before resuming remaining work.",
        ]
        if !notices.isEmpty { failure["routing_notices"] = notices }
        return .undelivered(fleetBoundedFailure(failure))
    }
    let label = RCCRuntimeProjection.rootDescription(core)
    var failure: [String: String] = [
        "error": "OpenClaw Core task \(core.state.rawValue)" + (core.error.map { ": " + $0 } ?? ""),
        "job_id": jobID,
        "partial_work": "Inspect this job's native records and checkout before resuming remaining work.",
        "core_admitted": "yes",
        "core_task_id": core.taskID,
        "request_sha256": core.requestSHA256,
        "core_state": core.state.rawValue,
        "core_revision": String(core.revision),
        "core_label": label,
        "model_dispatched": fleetCoreModelDispatched(core) ? "true" : "false",
        "observe_command": fleetObserveCommand(taskID: core.taskID, requestSHA256: core.requestSHA256),
    ]
    if let error = core.error { failure["core_error"] = error }
    if !notices.isEmpty { failure["routing_notices"] = notices }
    if let result = core.result, let partial = result.partial {
        // K12b: a typed partial answers only a job that asked for contract v2.
        guard resultContractVersion == 2 else {
            failure["error"] = "OpenClaw Core returned a partial result this fleet job did not negotiate (result contract v\(resultContractVersion ?? 1)); no answer was delivered"
            failure["core_result_contract_breach"] = "true"
            return .undelivered(fleetBoundedFailure(failure))
        }
        failure["partial_answer"] = result.output
        failure["partial_coverage"] = partial.coverage.label()
        failure["verification"] = "partial_unverified"
        failure["partial_work"] = "partial_answer is OS-1 Core's completed part only, unverified. Resume only the unresolved work partial_coverage names; do not repeat the completed part."
        return .undelivered(fleetBoundedFailure(failure))
    }
    switch core.state {
    case .completed, .returnedUnverified:
        let completed = core.state == .completed
        guard let result = core.result, !result.output.isEmpty, result.taskVerified == completed,
              !result.taskVerified || result.executionVerified else {
            failure["error"] = "OpenClaw Core task \(core.state.rawValue) without a deliverable answer"
            return .undelivered(fleetBoundedFailure(failure))
        }
        guard run.status == rccRunStatus(core.state), run.steps.contains(where: { $0.exitCode == 0 }) else {
            failure["error"] = "OpenClaw Core answer has no matching host execution record; not delivered as a result"
            failure["unadopted_answer"] = result.output
            failure["unadopted_answer_note"] = label + " Treat as unverified."
            if let disclosure = fleetCoreDisclosure(core) { failure["core_quality_disclosure"] = disclosure.text }
            return .undelivered(fleetBoundedFailure(failure))
        }
        return .delivered(FleetCoreOutcome(
            taskID: core.taskID, requestSHA256: core.requestSHA256, state: core.state.rawValue, revision: core.revision,
            verification: completed ? "task_verified" : "unverified", label: label,
            error: core.error.map { String($0.prefix(2_000)) }, output: result.output,
            outputSHA256: sha256Hex(Data(result.output.utf8)), outputBytes: result.output.utf8.count, outputTruncated: false,
            partialCoverage: nil, parityState: result.parityState.rawValue, taskQuality: result.taskQuality?.rawValue,
            executionVerified: result.executionVerified, taskVerified: result.taskVerified,
            qualityDisclosure: fleetCoreDisclosure(core)))
    case .effectsUncertain:
        failure["error"] = "OpenClaw Core task effects_uncertain: a side effect may or may not have happened. Nothing was published and nothing will be replayed."
        failure["effects_uncertain"] = "true"
        failure["checkout"] = "~/.os1/fleet/jobs/\(jobID)/repository"
        failure["partial_work"] = "Inspect the preserved checkout (~/.os1/fleet/jobs/\(jobID)/repository) and Core's native records before any retry; never replay this job."
    case .awaitingInstall:
        failure["error"] = "OpenClaw Core staged an OS-1 installation: " + label
        if let output = core.result?.output, !output.isEmpty {
            failure["handoff_answer"] = output
            failure["handoff_answer_label"] = label
        }
    case .held, .failed, .cancelled:
        if failure["model_dispatched"] == "false" {
            failure["partial_work"] = "No model ran for this task (model_dispatched false); there is no remote work to reconcile."
        }
    default:
        failure["error"] = "OpenClaw Core task is still \(core.state.rawValue); this fleet job stopped observing it. Observe it with observe_command; do not resubmit."
    }
    return .undelivered(fleetBoundedFailure(failure))
}

/// A run summary for a Core snapshot this process did not observe to its
/// end (reconciliation): the same host steps, status and owner notices a run
/// reports (`rccHostSteps`, `rccRunStatus`).
func fleetRunSummary(_ snapshot: RCCRuntimeContract.Snapshot, prompt: String, jobID: String, startedAt: Date) -> RunSummary {
    let steps = rccHostSteps(snapshot, prompt: prompt, taskID: jobID, startedAt: startedAt)
    var run = RunSummary(status: rccRunStatus(snapshot.state), steps: steps, monitorTaskID: jobID,
                         workflowBlocker: snapshot.error, rccRuntime: snapshot)
    var notices: [String] = []
    if let skipped = routeAllSkippedNotice(snapshot.skippedRoutes) { notices.append(skipped) }
    if let review = RCCRuntimeContract.referenceReviewNotice(snapshot) { notices.append(review) }
    if steps.count == 1, steps[0].action == "rcc_deterministic", let notice = rccDeterministicArithmeticNotice(output: steps[0].output) {
        notices.append(notice)
    }
    if !notices.isEmpty { run.routingNotices = notices }
    return run
}

func fleetCoreResolution(_ snapshot: RCCRuntimeContract.Snapshot?, run: RunSummary, jobID: String,
                         resultContractVersion: Int?) -> FleetCoreResolution {
    switch fleetCoreDisposition(snapshot, run: run, jobID: jobID, resultContractVersion: resultContractVersion) {
    case .delivered(let outcome): return .delivered(run, outcome)
    case .undelivered(let failure): return .undelivered(failure)
    }
}

/// The Core calls a fleet job may make. `run` submits the job's one task;
/// `status` only observes an existing task by its id and request hash.
/// Injected so the fixtures make no gateway, provider or model call.
struct FleetCoreClient: Sendable {
    var run: @Sendable (_ prompt: String, _ workspace: String, _ preference: String, _ jobID: String,
                        _ resultContractVersion: Int) async throws -> RunSummary
    var status: @Sendable (_ taskID: String, _ requestSHA256: String) async throws -> RCCRuntimeContract.Snapshot
    var sleep: @Sendable (_ seconds: Double) async throws -> Void = { try await Task.sleep(for: .milliseconds(Int($0 * 1_000))) }
    var now: @Sendable () -> Date = { Date() }

    static let live = FleetCoreClient(
        run: { prompt, workspace, preference, jobID, version in
            // The job's one Core task, under the job's own id.
            let run = try await runOpenClawRCCTask(prompt: prompt, workspace: workspace, context: nil,
                surface: ProviderSurface(rawValue: preference) ?? .auto, codexSessionID: nil,
                claudeSessionID: nil, requireReadOnly: false, taskID: jobID, resultContractVersion: version)
            return run
        },
        status: { taskID, requestSHA256 in
            // The run's own gateway configuration (owner policy included), so
            // this read reaches the gateway that owns the task.
            let owner = try loadCurrentOwnerPolicy()
            let configuration = try await OwnerPolicyContext.$snapshot.withValue(owner) {
                try await LocalRouterBridge.rccRuntimeConfiguration()
            }
            return try RCCRuntimeContract.decodeSnapshot(
                try await RCCRuntimeGatewayClient.status(taskID: taskID, requestSHA256: requestSHA256, configuration: configuration))
        })
}

/// What a fleet job knew about Core admission when it lost sight of its task.
enum FleetCoreAdmissionPrior: Equatable {
    /// The run failed before it could submit (request binding, installer
    /// check, gateway start): one status read; an unreadable task was not admitted.
    case preSubmit
    /// A host error outside the gateway client: one read, else unknown.
    case hostError
    /// Transport, observation, custody or snapshot failure: the task may be admitted.
    case ambiguous
    /// The agent restarted while the job ran: admission was never observed.
    case restarted
}

func fleetAdmissionPrior(after error: Error) -> FleetCoreAdmissionPrior {
    guard let failure = error as? RCCRuntimeGatewayClient.Failure else { return .hostError }
    switch failure {
    // Raised only by request binding, checkInstallerMaintenance and
    // ensureGateway, all before the one os1.rcc.submit.
    case .startupBusy, .gatewayIdentityChanged, .gatewayStartFailed, .gatewayNotReady,
         .installerMaintenance, .invalidRequest, .invalidConfiguration:
        return .preSubmit
    // rpc() also raises existingGatewayUnavailable (owner process gone),
    // identityMismatch (installed bytes changed, e.g. an OS-1 install during
    // the job) and privateStateInvalid while it observes an ADMITTED task,
    // so none of them proves the task never reached Core.
    default:
        return .ambiguous
    }
}

/// Reconciles a job with its Core task instead of reporting it lost.
/// Observation only: it reads the job's own task (task id = job id, request
/// hash = sha256 of the job's prompt) until Core holds a terminal snapshot or
/// the job's original budget (3,600 s + 120 s observation) ends. It never
/// submits, plans or calls a model: `core.run` is never called here.
/// A gateway refusal is retried for `rejectionWindow` seconds (an OS-1
/// install hands the Core database to a new gateway in about 15 s). The
/// gateway reports task_not_found, rcc_runtime_unavailable and
/// runtime_owner_active alike (rpcRejected), so a refused read proves
/// nothing: only a run that failed before submitting is reported
/// core_admitted "no"; every other unread task is "unknown".
func fleetReconcileCore(jobID: String, prompt: String, resultContractVersion: Int?, startedAt: Date,
                        prior: FleetCoreAdmissionPrior, cause: Error?, notice: BackendFailureNotice? = nil,
                        core: FleetCoreClient, rejectionWindow: Double = 60, poll: Double = 3,
                        budget: Double = 3_720) async -> FleetCoreResolution {
    let requestSHA256 = sha256Hex(Data(prompt.utf8))
    let began = core.now()
    let deadline = startedAt.addingTimeInterval(budget)
    var observed: RCCRuntimeContract.Snapshot?
    func resolved(_ snapshot: RCCRuntimeContract.Snapshot) -> FleetCoreResolution {
        fleetCoreResolution(snapshot, run: fleetRunSummary(snapshot, prompt: prompt, jobID: jobID, startedAt: startedAt),
                            jobID: jobID, resultContractVersion: resultContractVersion)
    }
    func unobserved(_ statusError: Error) -> FleetCoreResolution {
        let admitted = prior == .preSubmit ? "no" : "unknown"
        var failure = prior == .restarted
            ? fleetInterruptedResult(jobID: jobID)
            : fleetFailureResult(error: cause ?? statusError, jobID: jobID, notice: notice)
        failure["core_admitted"] = admitted
        failure["core_task_id"] = jobID
        failure["request_sha256"] = requestSHA256
        failure["core_status_error"] = fleetErrorText(statusError)
        failure["observe_command"] = fleetObserveCommand(taskID: jobID, requestSHA256: requestSHA256)
        failure["partial_work"] = admitted == "no"
            ? "The run failed before OpenClaw Core admitted the task, so no model ran for it. Inspect the checkout (~/.os1/fleet/jobs/\(jobID)/repository) only if the request itself changed files."
            : "OpenClaw Core could not be read for this job, so whether it admitted the task is unknown: it may still run or have finished. Check observe_command on the executor Mac before redoing the work; inspect the checkout (~/.os1/fleet/jobs/\(jobID)/repository) before resuming."
        return .undelivered(fleetBoundedFailure(failure))
    }
    while true {
        var failed = false
        do {
            let snapshot = try await core.status(jobID, requestSHA256)
            guard snapshot.taskID == jobID, snapshot.requestSHA256 == requestSHA256 else {
                throw RCCRuntimeGatewayClient.Failure.snapshotInvalid
            }
            if fleetCoreDeliverableStates.contains(snapshot.state) { return resolved(snapshot) }
            observed = snapshot
            if core.now() >= deadline { return resolved(snapshot) }
        } catch {
            failed = true
            let now = core.now()
            if let observed {
                // Admission is known: a failed read is not a failed task.
                if now >= deadline { return resolved(observed) }
            } else if prior == .preSubmit || prior == .hostError || now >= began.addingTimeInterval(rejectionWindow) {
                return unobserved(error)
            }
        }
        do { try await core.sleep(failed ? min(poll * 2, 6) : poll) } catch {
            return observed.map(resolved) ?? unobserved(error)
        }
    }
}

/// Runs the job's one Core task and maps its result; a thrown transport or
/// observation error is reconciled with Core by task id, never resubmitted.
func fleetCoreRun(jobID: String, prompt: String, preference: String, workspace: String, core: FleetCoreClient,
                  resultContractVersion: Int = RCCRunBudgetOptions.appResultContractVersion) async -> FleetCoreResolution {
    let started = core.now()
    let run: RunSummary
    do {
        run = try await core.run(prompt, workspace, preference, jobID, resultContractVersion)
    } catch {
        return await fleetReconcileCore(jobID: jobID, prompt: prompt, resultContractVersion: resultContractVersion,
                                        startedAt: started, prior: fleetAdmissionPrior(after: error), cause: error,
                                        notice: BackendFailureNotice.takeLastEmitted(), core: core)
    }
    return fleetCoreResolution(run.rccRuntime, run: run, jobID: jobID, resultContractVersion: resultContractVersion)
}

/// A restarted agent's "running" job: its Core task may have finished (or
/// still run) after the old agent ended. Reconcile before reporting it lost.
private func fleetRestartedResolution(_ assignment: FleetAssignment, startedAtMs: Int64?, resultContractVersion: Int?,
                                      core: FleetCoreClient, rejectionWindow: Double = 60, poll: Double = 3) async -> FleetCoreResolution {
    let startedAt = startedAtMs.map { Date(timeIntervalSince1970: Double($0) / 1_000) } ?? core.now()
    return await fleetReconcileCore(jobID: assignment.jobID, prompt: fleetPrompt(for: assignment),
                                    resultContractVersion: resultContractVersion, startedAt: startedAt, prior: .restarted,
                                    cause: nil, core: core, rejectionWindow: rejectionWindow, poll: poll)
}

/// The signed receipt bytes for a delivered Core answer. Core keeps the
/// snapshot and task graph under the task id, so the receipt carries neither;
/// each was a further copy of the answer. When the /v1/fleet/complete request
/// carrying the receipt would exceed the gateway's limit
/// (`fleetResultFitsCompleteRequest`), step copies go first, then the answer
/// is cut with output_truncated and the full answer's sha256 (never silently).
private func fleetEncodedReceipt(_ receipt: FleetExecutionReceipt) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    func fits(_ data: Data) -> Bool {
        fleetResultFitsCompleteRequest(String(decoding: data, as: UTF8.self), outcome: "complete")
    }
    var compact = receipt
    compact.run.rccRuntime = nil
    compact.run.agentTask = nil
    var data = try encoder.encode(compact)
    if !fits(data), compact.core != nil {
        compact.run.steps = compact.run.steps.map { step in var step = step; step.output = ""; return step }
        data = try encoder.encode(compact)
    }
    if !fits(data), let outcome = compact.core, outcome.output.count > 1 {
        let characters = Array(outcome.output)
        compact.core?.outputTruncated = true
        var low = 1, high = characters.count - 1, best: Data?
        while low <= high {
            let middle = (low + high) / 2
            compact.core?.output = String(characters[0..<middle])
            let candidate = try encoder.encode(compact)
            if fits(candidate) { best = candidate; low = middle + 1 } else { high = middle - 1 }
        }
        if let best { data = best }
    }
    guard fits(data) else { throw OS1Error.message("Fleet result exceeds the signed result limit") }
    return data
}

/// A delivered Core answer as the receipt the submitter verifies; the same
/// check runs here first, so a receipt the submitter would refuse is never sent.
private func fleetCoreReceipt(_ assignment: FleetAssignment, role: String, deviceID: String,
                              published: (String?, String?), run: RunSummary, outcome: FleetCoreOutcome) throws -> String {
    let data = try fleetEncodedReceipt(FleetExecutionReceipt(
        jobID: assignment.jobID, nodeRole: role, deviceID: deviceID, profile: assignment.profile,
        repository: assignment.workspaceRepository, revision: assignment.workspaceRevision,
        resultBranch: published.0, resultCommit: published.1, run: run, core: outcome))
    guard let decoded = try? JSONDecoder().decode(FleetExecutionReceipt.self, from: data),
          fleetResultStatusIsValid(decoded.run, profile: decoded.profile, core: decoded.core) else {
        throw OS1Error.message("Fleet Core receipt failed its own validation")
    }
    return String(decoding: data, as: UTF8.self)
}

/// A delivered Core answer the fleet could not hand over (publication or
/// receipt failure): reported failed, with the answer kept and labelled.
private func fleetUndeliveredCoreAnswer(_ outcome: FleetCoreOutcome, jobID: String, error: Error) -> [String: String] {
    var failure = [
        "error": fleetErrorText(error),
        "job_id": jobID,
        "partial_work": "Inspect this job's native records and checkout before resuming remaining work.",
        "core_admitted": "yes",
        "core_task_id": outcome.taskID,
        "request_sha256": outcome.requestSHA256,
        "core_state": outcome.state,
        "core_label": outcome.label,
        "unadopted_answer": outcome.output,
        "unadopted_answer_note": outcome.label + " The fleet could not hand this answer over; treat it as unverified.",
        "observe_command": fleetObserveCommand(taskID: outcome.taskID, requestSHA256: outcome.requestSHA256),
    ]
    if let disclosure = outcome.qualityDisclosure { failure["core_quality_disclosure"] = disclosure.text }
    return fleetBoundedFailure(failure)
}

/// Publishes a delivered Core answer's checkout changes and returns its
/// receipt; anything else is a `FleetUndelivered` carrying Core's result.
/// The receipt is built and checked once BEFORE publication, so a result
/// branch is never pushed for a receipt the fleet could not send.
private func fleetDeliver(_ assignment: FleetAssignment, role: String, workspace: String,
                          resolution: FleetCoreResolution, device: () throws -> String = deviceID) throws -> String {
    switch resolution {
    case .undelivered(let failure):
        throw FleetUndelivered(result: failure)
    case .delivered(let run, let outcome):
        do {
            let executor = try device()
            _ = try fleetCoreReceipt(assignment, role: role, deviceID: executor,
                                     published: ("os1-fleet/" + assignment.jobID.lowercased(), String(repeating: "0", count: 64)),
                                     run: run, outcome: outcome)
            let published = try fleetCommitResult(assignment, workspace: workspace)
            return try fleetCoreReceipt(assignment, role: role, deviceID: executor, published: published, run: run, outcome: outcome)
        } catch {
            throw FleetUndelivered(result: fleetUndeliveredCoreAnswer(outcome, jobID: assignment.jobID, error: error))
        }
    }
}

private func executeFleetAssignment(_ assignment: FleetAssignment, role: String, config: RuntimeConfig?,
                                    core: FleetCoreClient = .live,
                                    checkout: (FleetAssignment) throws -> String = fleetCheckout,
                                    device: () throws -> String = deviceID) async throws -> String {
    guard fleetProfiles.contains(assignment.profile), assignment.objectiveVersion == "os1-fleet-objective-v1" else {
        throw OS1Error.message("Fleet assignment contract rejected")
    }
    guard assignment.profile == "exo" else {
        let workspace = try checkout(assignment)
        // Fleet remains delivery/check-out custody, not another task router.
        // Result contract v2, as the App: a held, failed or cancelled task
        // returns its completed part labelled partial instead of nothing.
        let resolution = await fleetCoreRun(jobID: assignment.jobID, prompt: fleetPrompt(for: assignment),
                                            preference: fleetProviderPreference(profile: assignment.profile),
                                            workspace: workspace, core: core)
        return try fleetDeliver(assignment, role: role, workspace: workspace, resolution: resolution, device: device)
    }
    guard assignment.executionMode == "distributed_exo", let config else {
        throw OS1Error.message("EXO fleet work was not assigned as distributed inference")
    }
    let inference = try await executeEXO(prompt: assignment.task, config: config)
    let run = RunSummary(status: "candidate", steps: [RunStepSummary(
        sequence: 1,
        provider: "local",
        action: "exo_distributed_inference",
        model: config.exoModelID ?? "mlx-community/Qwen3-0.6B-4bit",
        effort: "none",
        revasDisposition: "unverified_candidate",
        sessionID: assignment.jobID,
        permissionProfile: "read_only",
        exitCode: 0,
        output: inference.output,
        stderr: "",
        durationMS: inference.durationMS,
        nativeRecord: nil
    )])
    let receipt = FleetExecutionReceipt(
        jobID: assignment.jobID,
        nodeRole: role,
        deviceID: try device(),
        profile: assignment.profile,
        repository: assignment.workspaceRepository,
        revision: assignment.workspaceRevision,
        resultBranch: nil,
        resultCommit: nil,
        run: run
    )
    return String(decoding: try fleetEncodedReceipt(receipt), as: UTF8.self)
}

/// The checkout a restarted job's Core task ran in, as it is: never checked
/// out again, so Core's changes are published exactly as Core left them
/// (`fleetPublishResult` with the assigned revision also publishes a result
/// commit the ended agent made but never reported).
private func fleetPreservedWorkspace(_ assignment: FleetAssignment, jobs: URL = fleetJobsRoot()) throws -> String {
    let repository = try fleetJobDirectory(assignment.jobID, jobs: jobs).appendingPathComponent("repository", isDirectory: true)
    let workspace = assignment.workspaceSubpath.isEmpty
        ? repository : repository.appendingPathComponent(assignment.workspaceSubpath, isDirectory: true)
    let root = repository.resolvingSymlinksInPath().path + "/"
    let path = workspace.resolvingSymlinksInPath().path
    guard (path + "/").hasPrefix(root), FileManager.default.fileExists(atPath: path) else {
        throw OS1Error.message("Fleet job checkout is unavailable")
    }
    return path
}

/// The result of a job an agent restart interrupted: Core's own result when
/// its task reached one, otherwise the interrupted report with what Core
/// admitted. Never re-executed.
private func fleetFinishRestarted(_ work: FleetAgentWork, role: String, core: FleetCoreClient = .live,
                                  jobs: URL = fleetJobsRoot(), device: () throws -> String = deviceID,
                                  rejectionWindow: Double = 60, poll: Double = 3) async -> (outcome: String, result: String) {
    func encoded(_ value: [String: String]) -> String {
        String(decoding: (try? JSONEncoder().encode(value)) ?? Data(), as: UTF8.self)
    }
    guard work.assignment.profile != "exo" else {
        return ("failed", encoded(fleetInterruptedResult(jobID: work.assignment.jobID)))
    }
    let resolution = await fleetRestartedResolution(work.assignment, startedAtMs: work.startedAtMs,
                                                    resultContractVersion: work.resultContractVersion, core: core,
                                                    rejectionWindow: rejectionWindow, poll: poll)
    if case .undelivered(var failure) = resolution {
        failure["agent_restarted"] = "true"
        return ("failed", encoded(fleetBoundedFailure(failure)))
    }
    do {
        return ("complete", try fleetDeliver(work.assignment, role: role,
                                             workspace: try fleetPreservedWorkspace(work.assignment, jobs: jobs),
                                             resolution: resolution, device: device))
    } catch let undelivered as FleetUndelivered {
        var failure = undelivered.result
        failure["agent_restarted"] = "true"
        return ("failed", encoded(fleetBoundedFailure(failure)))
    } catch {
        if case .delivered(_, let outcome) = resolution {
            var failure = fleetUndeliveredCoreAnswer(outcome, jobID: work.assignment.jobID, error: error)
            failure["agent_restarted"] = "true"
            return ("failed", encoded(fleetBoundedFailure(failure)))
        }
        return ("failed", encoded(fleetBoundedFailure(fleetInterruptedResult(jobID: work.assignment.jobID))))
    }
}

/// A job whose agent process ended while it ran, and Core never admitted (or
/// could not report) its task. Never re-executed.
func fleetInterruptedResult(jobID: String) -> [String: String] {
    [
        "error": "Fleet job interrupted: the OS-1 fleet agent ended while it ran (crash, restart or update). It was not re-executed.",
        "job_id": jobID,
        "partial_work": "Inspect this job's native records and checkout (~/.os1/fleet/jobs/\(jobID)/repository) before resuming remaining work.",
    ]
}

/// A failed job still returns what its backend produced when only adoption
/// failed (the answer the app shows): the caller must not lose a correct
/// answer to a verifier disagreement. Bounded; never a success claim.
func fleetFailureResult(error: Error, jobID: String, notice: BackendFailureNotice?) -> [String: String] {
    var result = [
        "error": fleetErrorText(error),
        "job_id": jobID,
        "partial_work": "Inspect this job's native records and checkout before resuming remaining work.",
    ]
    if let notice, let answer = notice.publicProgress?.trimmingCharacters(in: .whitespacesAndNewlines), !answer.isEmpty {
        result["blocker"] = notice.blocker.rawValue
        result["unadopted_answer"] = String(answer.suffix(8_000))
        result["unadopted_answer_note"] = "Backend answer saved but not adopted (\(notice.blocker.rawValue)); treat as unverified."
    }
    return result
}

private func completeFleetJob(
    client: APIClient,
    key: SigningKey,
    assignment: FleetAssignment,
    outcome: String,
    result: String
) async throws {
    let now = fleetNowMs()
    let nonce = try randomNonce()
    let hash = sha256Hex(Data(result.utf8))
    var request = FleetCompleteRequest(
        jobID: assignment.jobID, outcome: outcome, result: result, resultHash: hash,
        completedAtMs: now, nonce: nonce, signature: ""
    )
    request = FleetCompleteRequest(
        jobID: request.jobID, outcome: request.outcome, result: request.result,
        resultHash: request.resultHash, completedAtMs: request.completedAtMs, nonce: request.nonce,
        signature: Base64URL.encode(try key.sign(completeBytes(deviceID: client.deviceID, request: request)))
    )
    let response: [String: String] = try await client.deliver("/v1/fleet/complete", body: request, as: [String: String].self)
    guard response["status"] == "stored" else { throw OS1Error.message("Fleet result was not stored") }
}

func runFleetAgent(role: String, once: Bool) async throws {
    let config = try RuntimeConfig.load()
    try await requireFleetReceiptProtocol(config)
    let key = try SigningKey.loadOrCreate()
    let client = APIClient(config: config, token: try githubToken(), deviceID: try deviceID(), requestTimeoutSeconds: 10)
    let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/fleet", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    guard let lease = try ExclusiveHookLease.tryAcquire(at: root.appendingPathComponent("main-agent.lock")) else {
        throw OS1Error.message("Another OS1 Fleet agent already owns execution")
    }
    defer { withExtendedLifetime(lease) {} }
    let activeFile = root.appendingPathComponent("main-agent-active.json")
    let claimFile = root.appendingPathComponent("main-agent-claim.json")
    var registered = false
    var maintenance: Task<Void, Never>?
    defer { maintenance?.cancel() }
    repeat {
        let wakeSeen = FleetLocalWake.stamp()
        do {
            if !registered {
                try await register(client: client, key: key)
                registered = true
            }
            let node = try await sendFleetHeartbeat(client: client, key: key, role: role)
            if once {
                try? await refreshFleetResultCache(client: client, key: key)
            } else if maintenance == nil {
                // Own maintenance across idle, running and delivery phases.
                // Result latency must never consume the heartbeat's freshness budget.
                maintenance = Task.detached { await runFleetMaintenance(role: role) }
            }
            var active: FleetAgentWork?
            if FileManager.default.fileExists(atPath: activeFile.path) {
                active = try JSONDecoder().decode(FleetAgentWork.self, from: Data(contentsOf: activeFile))
            } else if SelfUpdate.activeHold() == nil {
                // A staged OS-1 build waits only for running work: claim nothing
                // new until it installs (`SelfUpdate.holdsNewWork`). A queued job
                // keeps its start window and runs in the new build.
                let nonce: String
                if FileManager.default.fileExists(atPath: claimFile.path) {
                    nonce = try JSONDecoder().decode(String.self, from: Data(contentsOf: claimFile))
                } else {
                    nonce = try randomNonce()
                    try fleetPersist(nonce, at: claimFile)
                }
                if let assignment = try await fleetClaim(client: client, key: key, nonce: nonce) {
                    active = FleetAgentWork(assignment: assignment)
                    try fleetPersist(active!, at: activeFile)
                }
                try FileManager.default.removeItem(at: claimFile)
            }
            if var work = active {
                guard work.assignment.executorDeviceID == client.deviceID else {
                    throw OS1Error.message("Fleet active job belongs to another device")
                }
                work = try await fleetAdvanceWork(work, role: role,
                    persist: { try fleetPersist($0, at: activeFile) },
                    finishRestarted: { await fleetFinishRestarted($0, role: role) },
                    execute: { try await executeFleetAssignment($0, role: role, config: config) })
                guard work.phase == "delivery_pending", let result = work.result, let outcome = work.outcome else {
                    throw OS1Error.message("Fleet result outbox is invalid; preserved without re-execution")
                }
                var stored = true
                do {
                    try await completeFleetJob(client: client, key: key, assignment: work.assignment, outcome: outcome, result: result)
                } catch {
                    // An expired job can never accept this result. Keep the
                    // result locally and free the agent instead of retrying
                    // delivery forever; never re-execute.
                    guard try await fleetJobState(client: client, key: key, jobID: work.assignment.jobID) == "expired" else { throw error }
                    stored = false
                    fputs("OS-1 fleet: job \(work.assignment.jobID) expired before delivery; result kept at ~/.os1/fleet/jobs/\(work.assignment.jobID)/fleet-result.json\n", stderr)
                }
                if once { try? await refreshFleetResultCache(client: client, key: key) }
                try fleetPersist(fleetArchived(work, stored: stored),
                                 at: fleetJobDirectory(work.assignment.jobID).appendingPathComponent("fleet-result.json"))
                try FileManager.default.removeItem(at: activeFile)
            }
            if once {
                print("OS-1 fleet agent: OK (\(role), \(node.zeroTierIP), EXO nodes \(node.exoNodes))")
                return
            }
        } catch {
            if once { throw error }
            fputs("OS-1 fleet agent retry: \(error)\n", stderr)
        }
        try await FleetLocalWake.sleep(upTo: fleetAgentCycleInterval, since: wakeSeen)
    } while true
}

/// One pass of the agent's local job record, persisted before each next
/// step, so an agent that ends anywhere leaves a record a restart can finish.
/// This loop runs each job inline, so a "running" record here was left by an
/// agent process that ended mid-job (crash, restart, update). A crash is not
/// permission to repeat external writes: never re-execute. Until 2026-10-02
/// this threw on every pass, and job bf14bb2a kept the fleet from claiming
/// anything — and every staged OS-1 build from installing, since the fleet
/// stayed busy — for 3.5 hours. Core runs the job's task in its own process
/// and keeps it under the job id: 6b6106c3 and bfdb90a3 (2026-10-24/25) were
/// reported interrupted while Core went on to finish them, so a restart asks
/// Core (observation only) before reporting. A claimed job records when it
/// started and which result contract it asked for BEFORE it runs, so that
/// reconciliation keeps the original budget and contract.
private func fleetAdvanceWork(_ start: FleetAgentWork, role: String, now: () -> Int64 = fleetNowMs,
                              persist: (FleetAgentWork) throws -> Void,
                              finishRestarted: (FleetAgentWork) async -> (outcome: String, result: String),
                              execute: (FleetAssignment) async throws -> String) async throws -> FleetAgentWork {
    var work = start
    if work.phase == "running" {
        let finished = await finishRestarted(work)
        work.result = finished.result
        work.outcome = finished.outcome
        work.phase = "delivery_pending"
        try persist(work)
        fputs("OS-1 fleet: job \(work.assignment.jobID) was interrupted by an agent restart; reconciled with OpenClaw Core without re-execution (\(finished.outcome))\n", stderr)
    }
    if work.phase == "claimed" {
        guard work.assignment.expiresAtMs > now() else {
            throw OS1Error.message("Fleet assignment expired before execution; preserved for reconciliation")
        }
        work.phase = "running"
        work.startedAtMs = now()
        if work.assignment.profile != "exo" { work.resultContractVersion = RCCRunBudgetOptions.appResultContractVersion }
        try persist(work)
        _ = BackendFailureNotice.takeLastEmitted()
        do {
            work.result = try await execute(work.assignment)
            work.outcome = "complete"
        } catch let undelivered as FleetUndelivered {
            // Core's own non-answer state (held, failed, partial, effects
            // uncertain, ...) with what Core kept, verbatim.
            work.result = String(decoding: try JSONEncoder().encode(undelivered.result), as: UTF8.self)
            work.outcome = "failed"
        } catch {
            work.result = String(decoding: try JSONEncoder().encode(fleetBoundedFailure(
                fleetFailureResult(error: error, jobID: work.assignment.jobID,
                                   notice: BackendFailureNotice.takeLastEmitted()))), as: UTF8.self)
            work.outcome = "failed"
        }
        work.phase = "delivery_pending"
        try persist(work)
    }
    return work
}

private struct FleetAgentWork: Codable {
    let assignment: FleetAssignment
    var phase = "claimed"
    var outcome: String? = nil
    var result: String? = nil
    /// When execution started and which Core result contract it asked for,
    /// so a restarted agent reconciles the task within its original budget.
    /// Absent on records written before build 438.
    var startedAtMs: Int64? = nil
    var resultContractVersion: Int? = nil
}

/// The job's archived record. "delivery_pending" is the outbox phase only:
/// the archive says "delivered" once the gateway stored the outcome, or
/// "expired_kept" when the job expired first and the result stays local.
private func fleetArchived(_ work: FleetAgentWork, stored: Bool) -> FleetAgentWork {
    var archived = work
    archived.phase = stored ? "delivered" : "expired_kept"
    return archived
}

private func runFleetMaintenance(role: String) async {
    await FleetMaintenance.run(
        heartbeat: {
            let client = APIClient(config: try RuntimeConfig.load(), token: try githubToken(), deviceID: try deviceID(), requestTimeoutSeconds: 10)
            _ = try await sendFleetHeartbeat(client: client, key: SigningKey.loadOrCreate(), role: role)
        },
        mirror: {
            let client = APIClient(config: try RuntimeConfig.load(), token: try githubToken(), deviceID: try deviceID(), requestTimeoutSeconds: 10)
            try await refreshFleetResultCache(client: client, key: SigningKey.loadOrCreate())
        },
        onHeartbeatFailure: { fputs("OS-1 Fleet heartbeat temporarily unavailable\n", stderr) },
        onMirrorFailure: { fputs("OS-1 Fleet result mirror temporarily unavailable\n", stderr) }
    )
}

private func fleetWorkspaceIdentity(_ workspace: String) throws -> (String, String, String) {
    let git = try findExecutable("git")
    let rootResult = try commandOutput(git, ["-C", workspace, "rev-parse", "--show-toplevel"], timeout: 20)
    guard rootResult.0 == 0 else { throw OS1Error.message("Fleet work requires a Git workspace") }
    let root = String(decoding: rootResult.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    let dirty = try commandOutput(git, ["-C", root, "status", "--porcelain=v1"], timeout: 30)
    guard dirty.0 == 0, dirty.1.isEmpty else {
        throw OS1Error.message("Fleet work requires a committed workspace revision; preserve or commit local changes first")
    }
    let revision = try commandOutput(git, ["-C", root, "rev-parse", "HEAD"], timeout: 20)
    let remote = try commandOutput(git, ["-C", root, "remote", "get-url", "origin"], timeout: 20)
    guard revision.0 == 0, remote.0 == 0 else { throw OS1Error.message("Fleet Git identity is unavailable") }
    let remoteText = String(decoding: remote.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    let prefixes = ["git@github.com:", "https://github.com/", "ssh://git@github.com/"]
    guard let prefix = prefixes.first(where: { remoteText.hasPrefix($0) }) else {
        throw OS1Error.message("Fleet requires an authenticated GitHub origin")
    }
    var normalized = String(remoteText.dropFirst(prefix.count))
    if normalized.hasSuffix(".git") {
        normalized.removeLast(4)
    }
    let revisionText = String(decoding: revision.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    guard normalized.range(of: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", options: .regularExpression) != nil,
          !normalized.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }),
          revisionText.range(of: "^[0-9a-f]{40}$", options: .regularExpression) != nil else {
        throw OS1Error.message("Fleet GitHub repository or revision is invalid")
    }
    // The executor clones from origin and fetches exactly this revision, so a
    // commit that only exists locally can never run remotely. Local tracking
    // refs may be stale after a force push; read the exact commit at origin.
    // Fast, offline first: a commit that no origin/* tracking ref contains was
    // never pushed from here, so skip the network round trip entirely.
    let tracked = try commandOutput(git, ["-C", root, "for-each-ref", "--contains", revisionText, "refs/remotes/origin/"], timeout: 20)
    guard tracked.0 == 0, !tracked.1.isEmpty else {
        throw OS1Error.message("Fleet requires the workspace revision to exist on origin; push HEAD before Fleet dispatch")
    }
    let gh = try findExecutable("gh")
    let reachable = try commandOutput(gh, ["api", "repos/\(normalized)/commits/\(revisionText)", "--jq", ".sha"], timeout: 20)
    guard reachable.0 == 0 else {
        // Not proof of absence: an offline or TLS-intercepted session cannot
        // confirm publication, and the foreground path remains available.
        throw OS1Error.message("Fleet could not confirm the workspace revision on GitHub; dispatch skipped without a remote job")
    }
    guard String(decoding: reachable.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines) == revisionText else {
        throw OS1Error.message("Fleet requires the workspace revision to exist on origin; push HEAD before Fleet dispatch")
    }
    let rootURL = URL(fileURLWithPath: root).resolvingSymlinksInPath()
    let workspaceURL = URL(fileURLWithPath: workspace).resolvingSymlinksInPath()
    guard (workspaceURL.path + "/").hasPrefix(rootURL.path + "/") else {
        throw OS1Error.message("Fleet workspace escapes its Git repository")
    }
    let relative = workspaceURL.path == rootURL.path ? "" : String(workspaceURL.path.dropFirst(rootURL.path.count + 1))
    guard relative.range(of: "^(?:[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*)?$", options: .regularExpression) != nil else {
        throw OS1Error.message("Fleet workspace subpath is unsupported")
    }
    return (normalized, revisionText, relative)
}

func enqueueFleetTask(
    workspace: String,
    prompt: String,
    profile: String,
    minMemoryMiB: Int,
    cpuWeight: Int,
    preferDeviceID: String?,
    intentID requestedIntentID: String? = nil
) async throws -> FleetEnqueueReceipt {
    guard fleetProfiles.contains(profile), (0...100).contains(cpuWeight), (0...1_048_576).contains(minMemoryMiB),
          !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, prompt.utf8.count <= 48_000 else {
        throw OS1Error.message("Fleet task requirements are invalid")
    }
    let id = try deviceID()
    let identity = try fleetWorkspaceIdentity(workspace)
    let now = fleetNowMs()
    let nonce = try randomNonce()
    let intentID = requestedIntentID ?? sha256Hex(Data(nonce.utf8))
    let file = try fleetIntentURL(intentID)
    if FileManager.default.fileExists(atPath: file.path) {
        let prior = try JSONDecoder().decode(FleetSubmissionIntent.self, from: Data(contentsOf: file))
        guard prior.deviceID == id, prior.request.profile == profile, prior.request.task == prompt,
              prior.request.workspaceRepository == identity.0, prior.request.workspaceRevision == identity.1,
              prior.request.workspaceSubpath == identity.2,
              prior.request.requirements.minMemoryMiB == minMemoryMiB,
              prior.request.requirements.cpuWeight == cpuWeight,
              prior.request.requirements.preferDeviceID == preferDeviceID else {
            throw OS1Error.message("Fleet submission identity conflicts with preserved intent")
        }
        return try await resumeFleetSubmission(intentID)
    }
    // Finish local capability/auth checks before the intent becomes potentially
    // dispatched. Never advertise this submitting process as an agent heartbeat.
    let client = APIClient(config: try RuntimeConfig.load(), token: try githubToken(), deviceID: id, requestTimeoutSeconds: 10)
    try await requireFleetReceiptProtocol(client.config)
    try await register(client: client, key: SigningKey.loadOrCreate())
    let request = FleetSubmitRequest(
        profile: profile, task: prompt, workspaceRepository: identity.0,
        workspaceRevision: identity.1, workspaceSubpath: identity.2,
        requirements: FleetRequirements(minMemoryMiB: minMemoryMiB, cpuWeight: cpuWeight, preferDeviceID: preferDeviceID),
        submittedAtMs: now, nonce: nonce, signature: ""
    )
    try fleetPersist(FleetSubmissionIntent(deviceID: id, request: request), at: file)
    return try await resumeFleetSubmission(intentID)
}

enum FleetSubmissionError: Error, CustomStringConvertible {
    case noCapacity
    case pending(String)
    var description: String {
        switch self {
        case .noCapacity:
            // "No node online" alone sent the owner looking for a network
            // fault when this Mac was online but its Claude was logged out
            // (2026-09-24). Say what this Mac itself cannot run.
            return "No eligible OS-1 fleet node is online; no remote job was created"
                + (fleetLocalBackendNote().map { ". " + $0 } ?? "")
        case .pending(let id): return "Fleet submission delivery is uncertain; recover with fleet-resume-submit --intent \(id). Do not submit duplicate work."
        }
    }
}

/// This Mac's backends that cannot run now, from the last health check.
func fleetLocalBackendNote(health: BackendHealth? = BackendHealth.load(maxAge: 900)) -> String? {
    guard let health else { return nil }
    let blocked = [("Codex", health.codex), ("Claude", health.claude)].compactMap { name, backend -> String? in
        switch backend.state {
        case .usable, .disabled: return nil
        case .loggedOut: return "\(name) is not signed in — sign in from OS-1's \(name.uppercased()) tile"
        case .quotaExhausted: return "\(name) usage limit reached"
            + (backend.recoversAt.map { " until " + ISO8601DateFormatter().string(from: $0) } ?? "")
        default: return "\(name) \(backend.state.rawValue.replacingOccurrences(of: "_", with: " "))"
        }
    }
    guard !blocked.isEmpty else { return nil }
    let checked = ISO8601DateFormatter().string(from: health.checkedAt)
    return "On this Mac: " + blocked.joined(separator: "; ") + " (checked \(checked))"
}

private struct FleetSubmissionIntent: Codable {
    let deviceID: String
    let request: FleetSubmitRequest
    var receipt: FleetEnqueueReceipt? = nil
    var noCapacity = false
}

private func fleetPersist<T: Encodable>(_ value: T, at url: URL) throws {
    try JSONEncoder().encode(value).write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
}

private func fleetIntentURL(_ id: String) throws -> URL {
    guard id.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else {
        throw OS1Error.message("Invalid Fleet submission intent identifier")
    }
    let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/fleet/submissions", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    return root.appendingPathComponent(id + ".json")
}

func resumeFleetSubmission(_ intentID: String) async throws -> FleetEnqueueReceipt {
    let file = try fleetIntentURL(intentID)
    do {
        var intent = try JSONDecoder().decode(FleetSubmissionIntent.self, from: Data(contentsOf: file))
        let id = try deviceID()
        guard intent.deviceID == id else { throw OS1Error.message("Fleet intent belongs to another device") }
        if let receipt = intent.receipt { return receipt }
        if intent.noCapacity { throw FleetSubmissionError.noCapacity }
        let key = try SigningKey.loadOrCreate()
        let original = intent.request
        let unsigned = FleetSubmitRequest(
            profile: original.profile, task: original.task, workspaceRepository: original.workspaceRepository,
            workspaceRevision: original.workspaceRevision, workspaceSubpath: original.workspaceSubpath,
            requirements: original.requirements, submittedAtMs: fleetNowMs(), nonce: original.nonce, signature: ""
        )
        let request = FleetSubmitRequest(
            profile: unsigned.profile, task: unsigned.task, workspaceRepository: unsigned.workspaceRepository,
            workspaceRevision: unsigned.workspaceRevision, workspaceSubpath: unsigned.workspaceSubpath,
            requirements: unsigned.requirements, submittedAtMs: unsigned.submittedAtMs, nonce: unsigned.nonce,
            signature: Base64URL.encode(try key.sign(submitBytes(deviceID: id, request: unsigned)))
        )
        let client = APIClient(config: try RuntimeConfig.load(), token: try githubToken(), deviceID: id, requestTimeoutSeconds: 10)
        try await requireFleetReceiptProtocol(client.config)
        let response: FleetSubmitResponse = try await client.deliver("/v1/fleet/submit", body: request, as: FleetSubmitResponse.self)
        if response.status == "no_capacity", response.assignment == nil {
            intent.noCapacity = true
            try fleetPersist(intent, at: file)
            throw FleetSubmissionError.noCapacity
        }
        guard response.status == "queued", let assignment = response.assignment,
              assignment.submitterDeviceID == id, assignment.profile == original.profile,
              assignment.task == original.task, assignment.workspaceRepository == original.workspaceRepository,
              assignment.workspaceRevision == original.workspaceRevision, assignment.workspaceSubpath == original.workspaceSubpath,
              UUID(uuidString: assignment.jobID) != nil,
              assignment.objectiveVersion == "os1-fleet-objective-v1",
              assignment.executionMode == (original.profile == "exo" ? "distributed_exo" : "single_node") else {
            throw OS1Error.message("Fleet assignment does not match the preserved objective")
        }
        let receipt = FleetEnqueueReceipt(jobID: assignment.jobID, profile: assignment.profile,
            executionMode: assignment.executionMode, executorDeviceID: assignment.executorDeviceID,
            objectiveVersion: assignment.objectiveVersion)
        intent.receipt = receipt
        try fleetPersist(intent, at: file)
        if assignment.executorDeviceID == id { FleetLocalWake.signal() }
        return receipt
    } catch FleetSubmissionError.noCapacity { throw FleetSubmissionError.noCapacity }
    catch { throw FleetSubmissionError.pending(intentID) }
}

func waitForFleetTask(jobID: String, timeoutSeconds: Int = 3_600) async throws -> String {
    guard UUID(uuidString: jobID) != nil, (5...3_600).contains(timeoutSeconds) else {
        throw OS1Error.message("Fleet wait request is invalid")
    }
    let config = try RuntimeConfig.load()
    let key = try SigningKey.loadOrCreate()
    let id = try deviceID()
    let client = APIClient(config: config, token: try githubToken(), deviceID: id)
    let deadline = Date().addingTimeInterval(TimeInterval(timeoutSeconds))
    let waitStarted = ContinuousClock.now
    var poll = FleetStatusPoll()
    while Date() < deadline {
        try await Task.sleep(for: fleetStatusInterval(elapsed: ContinuousClock.now - waitStarted))
        let status: FleetJobStatus
        do {
            let statusAt = fleetNowMs()
            let statusNonce = try randomNonce()
            let signature = Base64URL.encode(try key.sign(statusBytes(
                deviceID: id, jobID: jobID, sentAtMs: statusAt, nonce: statusNonce
            )))
            status = try await client.post(
                "/v1/fleet/status",
                body: FleetStatusRequest(jobID: jobID, sentAtMs: statusAt, nonce: statusNonce, signature: signature),
                as: FleetJobStatus.self
            )
            poll.succeeded()
        } catch {
            try poll.failed(error, jobID: jobID)
            continue
        }
        guard status.jobID.lowercased() == jobID.lowercased() else {
            throw OS1Error.message("Fleet result job identity mismatch")
        }
        if let result = try fleetValidatedResult(status, jobID: jobID) { return result }
    }
    throw OS1Error.message("Fleet wait ended; job may still be running. Resume fleet-wait with the same job ID; do not submit duplicate work.")
}

/// A status read is idempotent: one failed poll is not the job's outcome.
/// 2026-10-01: the requester of build-eval job b36a0ffe stopped on a single
/// opaque HTTP 400 from /v1/fleet/status while the job kept running and
/// finished its fix minutes later; the caller was told the request failed.
/// Consecutive failures still end the wait, with the resume instruction.
struct FleetStatusPoll {
    static let maximumConsecutiveFailures = 6
    private(set) var consecutiveFailures = 0

    mutating func succeeded() { consecutiveFailures = 0 }

    mutating func failed(_ error: Error, jobID: String) throws {
        if case OS1Error.backendBlocked(.cancelled) = error { throw error }
        if error is CancellationError { throw error }
        consecutiveFailures += 1
        guard consecutiveFailures >= Self.maximumConsecutiveFailures else { return }
        throw OS1Error.message("Fleet status unavailable \(consecutiveFailures) times in a row (\(error)); job \(jobID) may still be running. Resume fleet-wait with the same job ID; do not submit duplicate work.")
    }
}

/// The executor may read its own job's state (the gateway accepts submitter or executor).
private func fleetJobState(client: APIClient, key: SigningKey, jobID: String) async throws -> String {
    let statusAt = fleetNowMs()
    let statusNonce = try randomNonce()
    let signature = Base64URL.encode(try key.sign(statusBytes(
        deviceID: client.deviceID, jobID: jobID, sentAtMs: statusAt, nonce: statusNonce
    )))
    let status: FleetJobStatus = try await client.post(
        "/v1/fleet/status",
        body: FleetStatusRequest(jobID: jobID, sentAtMs: statusAt, nonce: statusNonce, signature: signature),
        as: FleetJobStatus.self
    )
    guard status.jobID.lowercased() == jobID.lowercased() else {
        throw OS1Error.message("Fleet result job identity mismatch")
    }
    return status.state
}

private func fleetValidatedResult(_ status: FleetJobStatus, jobID: String) throws -> String? {
        guard status.jobID.lowercased() == jobID.lowercased(), status.objectiveVersion == "os1-fleet-objective-v1" else {
            throw OS1Error.message("Fleet result objective identity mismatch")
        }
        if status.state == "complete" {
            guard let result = status.result, let hash = status.resultHash,
                  sha256Hex(Data(result.utf8)) == hash,
                  let receipt = try? JSONDecoder().decode(FleetExecutionReceipt.self, from: Data(result.utf8)),
                  receipt.jobID.lowercased() == jobID.lowercased(), receipt.deviceID == status.executorDeviceID,
                  receipt.profile == status.profile,
                  fleetResultStatusIsValid(receipt.run, profile: receipt.profile, core: receipt.core) else {
                throw OS1Error.message("Fleet result integrity check failed")
            }
            return result
        }
        if status.state == "failed" || status.state == "expired" {
            throw OS1Error.message("Fleet job \(status.state): \(status.result ?? "no result")")
        }
        return nil
}

private func fleetResultCacheURL(_ jobID: String) throws -> URL {
    guard UUID(uuidString: jobID) != nil else { throw OS1Error.message("Invalid Fleet result ID") }
    return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/fleet/results", isDirectory: true)
        .appendingPathComponent(jobID.lowercased() + ".json")
}

private func fleetMirrorOrder(_ ids: [String], checkedAt: [String: Date]) -> [String] {
    ids.enumerated().sorted {
        let a = checkedAt[$0.element] ?? .distantPast
        let b = checkedAt[$1.element] ?? .distantPast
        return a == b ? $0.offset < $1.offset : a < b
    }.map(\.element)
}

private actor FleetMirrorSchedule {
    static let shared = FleetMirrorSchedule()
    private var checkedAt: [String: Date] = [:]
    func reserve(_ ids: [String]) -> Set<String> {
        let live = Set(ids)
        checkedAt = checkedAt.filter { live.contains($0.key) }
        let selected = Array(fleetMirrorOrder(ids, checkedAt: checkedAt).prefix(4))
        for id in selected { checkedAt[id] = Date() }
        return Set(selected)
    }
}

private func refreshFleetResultCache(client: APIClient, key: SigningKey) async throws {
    let manager = FileManager.default
    let root = manager.homeDirectoryForCurrentUser.appendingPathComponent(".os1/fleet/submissions", isDirectory: true)
    guard let files = try? manager.contentsOfDirectory(at: root, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
    // A bounded read-only mirror, not another executor. Existing receipts never
    // trigger more provider calls or include tokens, keys or authentication data.
    var candidates: [(FleetEnqueueReceipt, URL)] = []
    for file in files.filter({ $0.pathExtension == "json" }).sorted(by: {
        ((try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) >
        ((try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast)
    }).prefix(512) {
        guard let bytes = try? Data(contentsOf: file), bytes.count <= 256_000,
              let intent = try? JSONDecoder().decode(FleetSubmissionIntent.self, from: bytes), intent.deviceID == client.deviceID,
              let receipt = intent.receipt else { continue }
        let target = try fleetResultCacheURL(receipt.jobID)
        if manager.fileExists(atPath: target.path) { continue }
        candidates.append((receipt, target))
    }
    let selected = await FleetMirrorSchedule.shared.reserve(candidates.map { $0.0.jobID })
    for (receipt, target) in candidates where selected.contains(receipt.jobID) {
      do {
        let now = fleetNowMs(), nonce = try randomNonce()
        let signature = Base64URL.encode(try key.sign(statusBytes(deviceID: client.deviceID, jobID: receipt.jobID, sentAtMs: now, nonce: nonce)))
        let status: FleetJobStatus = try await client.post("/v1/fleet/status",
            body: FleetStatusRequest(jobID: receipt.jobID, sentAtMs: now, nonce: nonce, signature: signature), as: FleetJobStatus.self)
        guard status.jobID == receipt.jobID, status.executorDeviceID == receipt.executorDeviceID,
              status.profile == receipt.profile, status.objectiveVersion == receipt.objectiveVersion,
              status.executionMode == receipt.executionMode,
              ["complete", "failed", "expired"].contains(status.state) else { continue }
        // Mirror the immutable terminal response, not an assertion of task
        // success. The reader validates it before returning any result. An old
        // invalid receipt must surface its rejection, not starve newer jobs.
        try manager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try fleetPersist(status, at: target)
      } catch is CancellationError { throw CancellationError() }
      catch { fputs("OS-1 Fleet result mirror retry: \(receipt.jobID)\n", stderr) }
    }
}

private func readFleetCachedResult(at target: URL, jobID: String) throws -> String? {
    let attributes = try FileManager.default.attributesOfItem(atPath: target.path)
    guard attributes[.type] as? FileAttributeType == .typeRegular,
          (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
          (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600,
          (attributes[.size] as? NSNumber)?.intValue ?? Int.max <= 4_000_000 else {
        throw OS1Error.message("Fleet result cache ownership or permissions rejected")
    }
    let status = try JSONDecoder().decode(FleetJobStatus.self, from: Data(contentsOf: target))
    return try fleetValidatedResult(status, jobID: jobID)
}

func readFleetResult(jobID: String, timeoutSeconds: Int = 300) async throws -> String {
    guard (5...3_600).contains(timeoutSeconds) else { throw OS1Error.message("Invalid Fleet result wait limit") }
    let target = try fleetResultCacheURL(jobID)
    let deadline = Date().addingTimeInterval(TimeInterval(timeoutSeconds))
    repeat {
        if FileManager.default.fileExists(atPath: target.path) {
            if let result = try readFleetCachedResult(at: target, jobID: jobID) { return result }
        }
        try await Task.sleep(for: .seconds(1))
    } while Date() < deadline
    throw OS1Error.message("Fleet result is still pending in OS1. Resume fleet-result with this same job ID; do not duplicate the task.")
}

func fleetSnapshotJSON() async throws -> String {
    let config = try RuntimeConfig.load()
    let key = try SigningKey.loadOrCreate()
    let id = try deviceID()
    let client = APIClient(config: config, token: try githubToken(), deviceID: id)
    let now = fleetNowMs()
    let nonce = try randomNonce()
    let signature = Base64URL.encode(try key.sign(claimBytes(deviceID: id, sentAtMs: now, nonce: nonce)))
    let snapshot: FleetSnapshotResponse = try await client.post(
        "/v1/fleet/snapshot",
        body: FleetClaimRequest(sentAtMs: now, nonce: nonce, signature: signature),
        as: FleetSnapshotResponse.self
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return String(decoding: try encoder.encode(snapshot), as: UTF8.self)
}

func submitFleetTask(
    workspace: String,
    prompt: String,
    profile: String,
    minMemoryMiB: Int,
    cpuWeight: Int,
    preferDeviceID: String?
) async throws {
    let receipt = try await enqueueFleetTask(
        workspace: workspace,
        prompt: prompt,
        profile: profile,
        minMemoryMiB: minMemoryMiB,
        cpuWeight: cpuWeight,
        preferDeviceID: preferDeviceID
    )
    print("OS-1 fleet job \(receipt.jobID): \(receipt.executionMode) on \(receipt.executorDeviceID)")
    print(try await waitForFleetTask(jobID: receipt.jobID))
}

private func fleetConfiguredRole(_ requestedRole: String) throws -> String {
    if requestedRole == "pro" || requestedRole == "air" { return requestedRole }
    guard requestedRole == "auto" else { throw OS1Error.message("Fleet role must be auto, pro, or air") }
    let hardware = try commandOutput("/usr/sbin/system_profiler", ["SPHardwareDataType", "-json"], timeout: 30)
    guard hardware.0 == 0,
          let document = try JSONSerialization.jsonObject(with: hardware.1) as? [String: Any],
          let records = document["SPHardwareDataType"] as? [[String: Any]],
          let modelName = records.first?["machine_name"] as? String else {
        throw OS1Error.message("Fleet could not identify this Mac model")
    }
    if modelName == "MacBook Air" { return "air" }
    if modelName == "MacBook Pro" { return "pro" }
    throw OS1Error.message("Fleet supports MacBook Air and MacBook Pro roles")
}

func configureFleetAgent(role requestedRole: String) async throws {
    let role = try fleetConfiguredRole(requestedRole)
    let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.path
    let home = FileManager.default.homeDirectoryForCurrentUser
    let logDirectory = home.appendingPathComponent(".os1/fleet", isDirectory: true)
    try FileManager.default.createDirectory(at: logDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let label = "com.os1.fleet-agent"
    let plist = home.appendingPathComponent("Library/LaunchAgents/\(label).plist")
    let object: [String: Any] = [
        "Label": label,
        "ProgramArguments": [executable, "fleet-agent", "--role", role],
        "RunAtLoad": true,
        "KeepAlive": true,
        "ThrottleInterval": fleetLaunchAgentThrottleIntervalSeconds,
        "StandardOutPath": logDirectory.appendingPathComponent("agent.log").path,
        "StandardErrorPath": logDirectory.appendingPathComponent("agent.log").path,
        "ProcessType": "Standard",
        "EnvironmentVariables": [
            "OS1_CONFIG": home.appendingPathComponent(".local/bin/config.json").path,
            "PATH": "\(home.path)/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        ],
    ]
    let data = try PropertyListSerialization.data(fromPropertyList: object, format: .xml, options: 0)
    if let old = try? Data(contentsOf: plist), old == data,
       let running = try? commandOutput("/bin/launchctl", ["print", "gui/\(getuid())/\(label)"], timeout: 10),
       running.0 == 0 {
        print("OS-1 fleet agent already configured (\(role)); service was not restarted")
        return
    }
    let snapshot = try JSONDecoder().decode(FleetSnapshotResponse.self, from: Data(try await fleetSnapshotJSON().utf8))
    let id = try deviceID()
    guard snapshot.nodes.first(where: { $0.deviceID == id })?.queueDepth ?? 0 == 0,
          !FileManager.default.fileExists(atPath: logDirectory.appendingPathComponent("main-agent-active.json").path) else {
        throw OS1Error.message("Fleet is busy; installation preserves the running job. Retry configuration after its terminal result.")
    }
    if let old = try? Data(contentsOf: plist) {
        let backup = logDirectory.appendingPathComponent("agent-before-" + UUID().uuidString + ".plist")
        try old.write(to: backup, options: [.atomic])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: backup.path)
    }
    try data.write(to: plist, options: .atomic)
    let launchctl = "/bin/launchctl"
    _ = try? commandOutput(launchctl, ["bootout", "gui/\(getuid())/\(label)"], timeout: 20)
    let bootstrapped = try commandOutput(launchctl, ["bootstrap", "gui/\(getuid())", plist.path], timeout: 20)
    guard bootstrapped.0 == 0 else { throw OS1Error.message("Fleet LaunchAgent installation failed") }
    // RunAtLoad already starts the newly bootstrapped agent. An immediate
    // kickstart -k kills that healthy process and waits through launchd's
    // throttle interval, racing our timeout and interrupting claimed work.
    let loaded = try commandOutput(launchctl, ["print", "gui/\(getuid())/\(label)"], timeout: 10)
    guard loaded.0 == 0 else { throw OS1Error.message("Fleet LaunchAgent registration was not verified") }
    print("OS-1 fleet agent installed (\(role))")
}

func fleetResultStatusIsValid(_ run: RunSummary, profile: String, core: FleetCoreOutcome? = nil) -> Bool {
    if let core {
        // A Core receipt: Core is the authority, so no step disposition is
        // required (Core's model steps are "execution_only"), but the run, the
        // verification and the answer must all say what Core's state says.
        // An unverified answer can never be relabelled as a verified one.
        guard profile != "exo", core.state == "completed" || core.state == "returned_unverified" else { return false }
        let completed = core.state == "completed"
        let bytes = core.output.utf8.count
        return run.status == (completed ? "complete" : "returned_unverified")
            && core.taskVerified == completed && (!core.taskVerified || core.executionVerified)
            && core.verification == (completed ? "task_verified" : "unverified")
            && (completed ? !core.label.isEmpty : core.label == RCCRuntimeProjection.returnedUnverifiedDescription)
            && (completed || core.parityState == "unverified")
            && core.partialCoverage == nil && !core.output.isEmpty
            && fleetCoreDisclosureIsValid(core.qualityDisclosure, state: core.state)
            && core.outputSHA256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
            && (core.outputTruncated ? bytes < core.outputBytes
                : bytes == core.outputBytes && sha256Hex(Data(core.output.utf8)) == core.outputSHA256)
            && run.steps.contains { $0.exitCode == 0 }
    }
    guard !run.steps.isEmpty, run.steps.allSatisfy({ $0.exitCode == 0 }) else { return false }
    if profile == "exo" {
        return run.status == "candidate" && run.steps.allSatisfy {
            $0.action == "exo_distributed_inference" && $0.revasDisposition == "unverified_candidate"
        }
    }
    // A reviewed draft (build 289) is an adopted answer that a review replaced:
    // valid only beside the adopted review that names it. Build 289's first
    // fleet-run of a reviewed answer was refused here as an integrity failure.
    let shown = run.steps.filter { $0.revasDisposition == "adopted" || $0.revasDisposition == "control_verified" }
    let drafts = run.steps.filter { $0.revasDisposition == "reviewed_draft" }
    return run.status == "complete" && !shown.isEmpty && shown.count + drafts.count == run.steps.count
        && (drafts.isEmpty || shown.contains { $0.reviewedDraft != nil })
}

func fleetSelfTest() throws {
    var checks = 0
    func check(_ value: Bool, _ message: String) throws {
        if !value { throw OS1Error.message("Fleet self-test: " + message) }
        checks += 1
    }
    let original = try RuntimeConfig.load()
    var config = original
    config.exoMaximumOutputTokens = 123
    config.exoMinimumNodes = 2
    let decoded = try JSONDecoder().decode(RuntimeConfig.self, from: JSONEncoder().encode(config))
    try check(decoded.exoMaximumOutputTokens == 123, "EXO decoder ignored explicit settings")
    try check(try EXOConfiguration(runtimeConfig: decoded).maximumOutputTokens == 123, "EXO limits drifted")
    for address in ["http://example.com:52415", "http://127.0.0.1:80", "http://user:pass@127.0.0.1:52415", "https://127.0.0.1:52415"] {
        var invalid = original
        invalid.exoAPIURL = address
        try check((try? EXOConfiguration(runtimeConfig: invalid)) == nil, "non-loopback or credential URL accepted")
    }
    // An interrupted job is reported with the failure result's own keys, so
    // fleet-result readers parse it, and it names its preserved checkout.
    let interrupted = fleetInterruptedResult(jobID: "job-1")
    try check(Set(interrupted.keys) == ["error", "job_id", "partial_work"] && interrupted["job_id"] == "job-1"
              && interrupted["error"]?.contains("not re-executed") == true
              && interrupted["partial_work"]?.contains("~/.os1/fleet/jobs/job-1/repository") == true,
              "interrupted job result lost its shape")
    // A job refused only adoption returns its backend's answer, labelled.
    let refused = BackendFailureNotice(provider: "claude", sessionID: nil, blocker: .verificationRejected,
        dispatchStage: .dispatched, permissionProfile: "workspace_write", publicProgress: "  응, 가능함.  ")
    refused.emit()
    let carried = fleetFailureResult(error: OS1Error.backendBlocked(.verificationRejected), jobID: "job",
                                     notice: BackendFailureNotice.takeLastEmitted())
    try check(carried["unadopted_answer"] == "응, 가능함." && carried["blocker"] == "verification_rejected"
              && carried["unadopted_answer_note"]?.contains("not adopted") == true, "refused job lost its backend answer")
    try check(BackendFailureNotice.takeLastEmitted() == nil, "an emitted notice is taken once")
    let bare = fleetFailureResult(error: OS1Error.message("x"), jobID: "job", notice: nil)
    try check(bare["unadopted_answer"] == nil && bare["error"] == "x" && bare["job_id"] == "job", "plain failure invented an answer")
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("os1-fleet-self-test-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: directory) }
    // A job placed on this Mac wakes the local agent at once.
    let wakeFile = directory.appendingPathComponent("wake")
    try check(FleetLocalWake.stamp(at: wakeFile) == nil, "a missing wake file has no stamp")
    FleetLocalWake.signal(at: wakeFile)
    let firstStamp = FleetLocalWake.stamp(at: wakeFile)
    Thread.sleep(forTimeInterval: 0.02)
    FleetLocalWake.signal(at: wakeFile)
    try check(firstStamp != nil && FleetLocalWake.stamp(at: wakeFile) != firstStamp, "each signal changes the wake stamp")
    let woke = DispatchSemaphore(value: 0)
    let seenStamp = FleetLocalWake.stamp(at: wakeFile)
    let wakeStarted = Date()
    Task.detached {
        try? await FleetLocalWake.sleep(upTo: .seconds(10), since: seenStamp, at: wakeFile, step: .milliseconds(20))
        woke.signal()
    }
    Thread.sleep(forTimeInterval: 0.1)
    FleetLocalWake.signal(at: wakeFile)
    try check(woke.wait(timeout: .now() + 5) == .success && Date().timeIntervalSince(wakeStarted) < 3,
              "a wake signal must end the agent's cycle wait early")
    try check(fleetStatusInterval(elapsed: .seconds(10)) == .seconds(1) && fleetStatusInterval(elapsed: .seconds(300)) == .seconds(5),
              "status polling is quick only at first")
    // The job checkout is a local clone of the exact revision from the mirror.
    let git = try findExecutable("git")
    let source = directory.appendingPathComponent("source", isDirectory: true)
    func gitOK(_ arguments: [String]) throws -> String {
        let result = try commandOutput(git, arguments, timeout: 30)
        try check(result.0 == 0, "fixture git failed: \(arguments.prefix(3))")
        return String(decoding: result.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    _ = try gitOK(["init", "--quiet", source.path])
    var revisions: [String] = []
    for version in ["one", "two"] {
        try Data(version.utf8).write(to: source.appendingPathComponent("file.txt"))
        _ = try gitOK(["-C", source.path, "add", "file.txt"])
        _ = try gitOK(["-C", source.path, "-c", "user.name=OS-1", "-c", "user.email=os1@example.invalid",
                       "commit", "--quiet", "-m", version])
        revisions.append(try gitOK(["-C", source.path, "rev-parse", "HEAD"]))
    }
    let mirrors = directory.appendingPathComponent("mirrors", isDirectory: true)
    for (index, revision) in [revisions[0], revisions[1]].enumerated() {
        let job = directory.appendingPathComponent("job\(index)", isDirectory: true)
        try check(fleetMirrorClone(repository: "owner/repo", revision: revision, into: job, mirrors: mirrors, remote: source.path),
                  "mirror clone failed for revision \(index)")
        _ = try gitOK(["-C", job.path, "checkout", "--quiet", "--detach", revision])
        try check(try String(contentsOf: job.appendingPathComponent("file.txt"), encoding: .utf8) == ["one", "two"][index]
                  && (try gitOK(["-C", job.path, "remote", "get-url", "origin"])) == source.path,
                  "mirror clone must hold the exact revision and push to the real origin")
    }
    let missing = directory.appendingPathComponent("job-missing", isDirectory: true)
    try check(!fleetMirrorClone(repository: "owner/repo", revision: String(repeating: "0", count: 40), into: missing,
                                mirrors: mirrors, remote: source.path) && !FileManager.default.fileExists(atPath: missing.path),
              "an unknown revision must fall back without leaving a partial checkout")
    try check(!fleetMirrorClone(repository: "../escape", revision: revisions[0], into: missing, mirrors: mirrors, remote: source.path),
              "a repository name outside owner/name is refused")
    // A result commit carries the work, never the build products left beside it.
    let job0 = directory.appendingPathComponent("job0", isDirectory: true)
    let job1 = directory.appendingPathComponent("job1", isDirectory: true)
    for job in [job0, job1] {
        _ = try gitOK(["-C", job.path, "config", "user.name", "OS-1"])
        _ = try gitOK(["-C", job.path, "config", "user.email", "os1@example.invalid"])
    }
    func put(_ text: String, _ relative: String, in root: URL) throws {
        let file = root.appendingPathComponent(relative)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(text.utf8).write(to: file)
    }
    for product in ["pkg/.build/debug/a.o", "pkg/.swiftpm/state", "pkg/__pycache__/m.cpython-39.pyc", "web/node_modules/x/i.js", "pkg/top.pyc"] {
        try put("product", product, in: job0)
        try put("product", product, in: job1)
    }
    try put("fixed", "pkg/Sources/a.swift", in: job0)
    let published = try fleetPublishResult(jobID: "Fixture-Publish", workspace: job0.path)
    let tree = try gitOK(["-C", source.path, "ls-tree", "-r", "--name-only", "refs/heads/os1-fleet/fixture-publish"])
        .split(separator: "\n").map(String.init)
    try check(published.0 == "os1-fleet/fixture-publish" && published.1 == (try gitOK(["-C", source.path, "rev-parse", "refs/heads/os1-fleet/fixture-publish"])),
              "the published branch must hold the result commit")
    try check(Set(tree) == ["file.txt", "pkg/Sources/a.swift"], "a fleet result committed build products: \(tree)")
    let productsOnly = try fleetPublishResult(jobID: "fixture-products", workspace: job1.path)
    try check(productsOnly.0 == nil && productsOnly.1 == nil
              && (try gitOK(["-C", source.path, "branch", "--list", "os1-fleet/fixture-products"])).isEmpty,
              "build products alone were published as a result")
    try put("fixed", "pkg/Sources/b.swift", in: job1)
    do {
        _ = try fleetPublishResult(jobID: "fixture-unreachable", workspace: job1.path, remote: "missing-remote")
        try check(false, "a failed push reported success")
    } catch let error as OS1Error {
        try check(String(describing: error).contains("Fleet result publication failed (push: ")
                  && String(describing: error).contains("missing-remote"), "a failed push hid git's reason: \(error)")
    }
    // One failed status read never ends a wait; six in a row do, with the resume instruction.
    var poll = FleetStatusPoll()
    for _ in 1..<FleetStatusPoll.maximumConsecutiveFailures {
        try poll.failed(OS1Error.service(status: 400, message: "OS1 서버 요청을 처리하지 못했습니다(HTTP 400).", retryAfterMS: nil), jobID: "job")
    }
    poll.succeeded()
    try check(poll.consecutiveFailures == 0, "a successful status read must reset the failure count")
    for _ in 1..<FleetStatusPoll.maximumConsecutiveFailures {
        try poll.failed(OS1Error.message("transient"), jobID: "job")
    }
    do {
        try poll.failed(OS1Error.message("transient"), jobID: "job")
        try check(false, "endless status failures never ended the wait")
    } catch let error as OS1Error {
        try check(String(describing: error).contains("Resume fleet-wait with the same job ID"), "an ended wait lost the resume instruction")
    }
    var cancelled = FleetStatusPoll()
    do {
        try cancelled.failed(OS1Error.backendBlocked(.cancelled), jobID: "job")
        try check(false, "a cancelled wait kept polling")
    } catch OS1Error.backendBlocked(.cancelled) {
        try check(true, "")
    }
    let redacted = String(describing: fleetPublicationFailure("push", Data(
        "error: RPC failed; HTTP 400\nfatal: unable to access 'https://x-access-token:ghs_\(String(repeating: "A", count: 30))@github.com/o/r.git/': 400\n".utf8)))
    try check(redacted.contains("RPC failed") && redacted.contains("https://***@github.com") && !redacted.contains("ghs_")
              && !redacted.contains("x-access-token"), "a publication failure leaked a credential: \(redacted)")
    let request = FleetSubmitRequest(profile: "codex", task: "fixture", workspaceRepository: "owner/repo",
        workspaceRevision: String(repeating: "a", count: 40), workspaceSubpath: "",
        requirements: FleetRequirements(minMemoryMiB: 2048, cpuWeight: 50, preferDeviceID: nil),
        submittedAtMs: 1000, nonce: String(repeating: "n", count: 32), signature: "")
    let url = directory.appendingPathComponent("intent.json")
    try fleetPersist(FleetSubmissionIntent(deviceID: "fixture", request: request), at: url)
    let restored = try JSONDecoder().decode(FleetSubmissionIntent.self, from: Data(contentsOf: url))
    try check(restored.request.task == request.task && restored.request.nonce == request.nonce && restored.receipt == nil, "intent round trip changed objective")
    try check((try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? NSNumber)?.intValue == 0o600, "intent is not private")
    let assignment = FleetAssignment(jobID: UUID().uuidString, submitterDeviceID: "fixture", profile: "codex", task: request.task,
        workspaceRepository: request.workspaceRepository, workspaceRevision: request.workspaceRevision, workspaceSubpath: "",
        requirements: request.requirements, createdAtMs: 1000, expiresAtMs: 2000, objectiveVersion: "os1-fleet-objective-v1",
        executionMode: "single_node", executorDeviceID: "air", score: 1)
    var active = FleetAgentWork(assignment: assignment)
    active.phase = "delivery_pending"; active.outcome = "complete"; active.result = "preserved output"
    try fleetPersist(active, at: url)
    let recovered = try JSONDecoder().decode(FleetAgentWork.self, from: Data(contentsOf: url))
    try check(recovered.phase == "delivery_pending" && recovered.result == "preserved output" && recovered.assignment.jobID == assignment.jobID, "result recovery lost identity")
    let candidate = RunStepSummary(sequence: 1, provider: "local", action: "exo_distributed_inference",
        model: "fixture", effort: "none", revasDisposition: "unverified_candidate", sessionID: "fixture",
        permissionProfile: "read_only", exitCode: 0, output: "2", stderr: "", durationMS: 1, nativeRecord: nil)
    try check(fleetResultStatusIsValid(RunSummary(status: "candidate", steps: [candidate]), profile: "exo"), "EXO candidate transport rejected")
    try check(!fleetResultStatusIsValid(RunSummary(status: "complete", steps: [candidate]), profile: "exo"), "unverified EXO called complete")
    try check(!fleetResultStatusIsValid(RunSummary(status: "complete", steps: [candidate]), profile: "codex"), "EXO candidate adopted as native result")
    var draft = RunStepSummary(sequence: 1, provider: "codex", action: "cx_6astra_max", model: "gpt-6-astra", effort: "max",
        revasDisposition: "reviewed_draft", sessionID: "fixture-draft", permissionProfile: "workspace_write", exitCode: 0,
        output: "", stderr: "", durationMS: 1, nativeRecord: nil)
    var review = RunStepSummary(sequence: 1, provider: "claude", action: "cl_opus55_max", model: "claude-opus-5-5", effort: "max",
        revasDisposition: "adopted", sessionID: "fixture-review", permissionProfile: "read_only", exitCode: 0,
        output: "checked", stderr: "", durationMS: 1, nativeRecord: nil)
    review.reviewedDraft = "codex · gpt-6-astra · max"
    try check(fleetResultStatusIsValid(RunSummary(status: "complete", steps: [draft, review]), profile: "os1"), "reviewed answer refused")
    try check(!fleetResultStatusIsValid(RunSummary(status: "complete", steps: [draft]), profile: "os1"), "a lone reviewed draft accepted")
    review.reviewedDraft = nil
    try check(!fleetResultStatusIsValid(RunSummary(status: "complete", steps: [draft, review]), profile: "os1"), "a draft without its review accepted")
    draft.revasDisposition = "retry"
    try check(!fleetResultStatusIsValid(RunSummary(status: "complete", steps: [draft, review]), profile: "os1"), "an unadopted step accepted")
    let receipt = FleetExecutionReceipt(jobID: assignment.jobID, nodeRole: "air", deviceID: "air", profile: "exo",
        repository: request.workspaceRepository, revision: request.workspaceRevision, resultBranch: nil, resultCommit: nil,
        run: RunSummary(status: "candidate", steps: [candidate]))
    let result = String(decoding: try JSONEncoder().encode(receipt), as: UTF8.self)
    func fixture(state: String = "complete", hash: String? = nil) -> FleetJobStatus {
        FleetJobStatus(jobID: assignment.jobID, state: state, profile: "exo", executionMode: "distributed_exo",
            executorDeviceID: "air", objectiveVersion: "os1-fleet-objective-v1", result: result,
            resultHash: hash ?? sha256Hex(Data(result.utf8)))
    }
    try fleetPersist(fixture(), at: url)
    try check(try readFleetCachedResult(at: url, jobID: assignment.jobID) == result, "read-only result lost verified bytes")
    try check((try? readFleetCachedResult(at: url, jobID: UUID().uuidString)) == nil, "cross-job cached result accepted")
    try fleetPersist(fixture(hash: String(repeating: "0", count: 64)), at: url)
    try check((try? readFleetCachedResult(at: url, jobID: assignment.jobID)) == nil, "corrupt cached hash accepted")
    try fleetPersist(fixture(state: "claimed"), at: url)
    try check(try readFleetCachedResult(at: url, jobID: assignment.jobID) == nil, "pending receipt became a result")
    try fleetPersist(fixture(state: "failed"), at: url)
    try check((try? readFleetCachedResult(at: url, jobID: assignment.jobID)) == nil, "terminal failure became success")
    try fleetPersist(fixture(), at: url)
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: url.path)
    try check((try? readFleetCachedResult(at: url, jobID: assignment.jobID)) == nil, "public-readable cache accepted")
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    let link = directory.appendingPathComponent("link.json")
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: url)
    try check((try? readFleetCachedResult(at: link, jobID: assignment.jobID)) == nil, "cache symlink accepted")
    try check(fleetMirrorOrder(["new", "old", "pending"], checkedAt: ["pending": Date()]) == ["new", "old", "pending"], "pending job starves unchecked results")
    try check(fleetMirrorOrder(["new", "old"], checkedAt: ["new": Date(), "old": .distantPast]) == ["old", "new"], "old result starves behind new jobs")
    let dead = BackendHealth(claude: BackendHealth.Backend(state: .loggedOut), codex: BackendHealth.Backend(state: .quotaExhausted))
    let alive = BackendHealth(claude: BackendHealth.Backend(state: .usable), codex: BackendHealth.Backend(state: .usable))
    let deadFlags = fleetAdvertisedCapabilities(health: dead, codexExecutable: true, claudeExecutable: true)
    let aliveFlags = fleetAdvertisedCapabilities(health: alive, codexExecutable: true, claudeExecutable: false)
    let unknownFlags = fleetAdvertisedCapabilities(health: nil, codexExecutable: true, claudeExecutable: true)
    try check(!deadFlags.codex && !deadFlags.claude, "dead backends advertised as fleet capacity")
    try check(aliveFlags.codex && !aliveFlags.claude, "usable backend not advertised, or missing binary advertised")
    try check(!unknownFlags.codex && !unknownFlags.claude, "unprobed node advertised capacity")
    // No capacity names what this Mac cannot run (2026-09-24: a logged-out
    // Claude read as "no node online").
    let loggedOutClaude = BackendHealth(claude: BackendHealth.Backend(state: .loggedOut), codex: BackendHealth.Backend(state: .usable))
    try check(fleetLocalBackendNote(health: loggedOutClaude)?.contains("Claude is not signed in") == true
              && fleetLocalBackendNote(health: loggedOutClaude)?.contains("Codex") == false, "logged-out Claude not named")
    try check(fleetLocalBackendNote(health: alive) == nil && fleetLocalBackendNote(health: nil) == nil, "healthy node gained a note")
    try check(fleetLocalBackendNote(health: dead)?.contains("Codex usage limit reached") == true, "exhausted Codex not named")
    // Account status and sign-out see an account exactly as runs do: the
    // default account injects nothing (naming ~/.claude selects another slot).
    let claudeHome = URL(fileURLWithPath: "/Users/test/.claude", isDirectory: true)
    try check(BackendAccountCommands.accountEnvironment(provider: "claude", home: claudeHome, isDefault: true).isEmpty,
              "default Claude account status injected CLAUDE_CONFIG_DIR")
    try check(BackendAccountCommands.accountEnvironment(provider: "claude", home: claudeHome, isDefault: false)
              == ["CLAUDE_CONFIG_DIR": "/Users/test/.claude"], "second Claude account lost its own home")
    try check(BackendAccountCommands.accountEnvironment(provider: "codex", home: claudeHome, isDefault: true).isEmpty,
              "default Codex account status injected CODEX_HOME")
    // A fleet job hands its task to OpenClaw Core (since 2026-10-10), which
    // owns staging and routing; the former fleet-side split and capacity-mix
    // helpers (builds 257/261) no longer ran in production and their checks
    // here gave false assurance, so both were removed (build 438).
    try check(fleetProviderPreference(profile: "claude") == "claude" && fleetProviderPreference(profile: "codex") == "codex"
              && fleetProviderPreference(profile: "build") == "auto" && fleetProviderPreference(profile: "os1") == "auto",
              "a fleet job changed its backend constraint")
    // Fleet job f0b9ee10 asked to implement and ran read-only: the fleet asks
    // for write (private clone, own result branch), so the request's own
    // scope decides, and "구현 시작해" must resolve as an edit.
    try check(ScopeResolution.resolve(fleetPrompt(profile: "claude", task: "그럼 그 구조로 아키텍처 동결하고 구현 시작해")).scope
              == .workspaceWrite, "fleet implement request ran read-only")
    print("OS-1 Fleet self-test: \(checks) checks OK; config, EXO candidate, private read-only result validation, fair result polling, truthful capacity flags, local backend note, account environment, backend constraint and implement-request scope")
}

private final class FleetFixtureClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Date
    init(_ start: Date) { value = start }
    var now: Date { lock.lock(); defer { lock.unlock() }; return value }
    func advance(_ seconds: Double) { lock.lock(); value = value.addingTimeInterval(seconds); lock.unlock() }
}

private final class FleetFixtureBox<Value>: @unchecked Sendable {
    let value: Value
    init(_ value: Value) { self.value = value }
}

private final class FleetFixtureLog: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String] = []
    func add(_ value: String) { lock.lock(); values.append(value); lock.unlock() }
    var all: [String] { lock.lock(); defer { lock.unlock() }; return values }
}

/// Deterministic fleet ↔ OpenClaw Core fixtures (build 438): how a Core
/// snapshot becomes a fleet outcome, the signed receipt the submitter accepts,
/// and reconciliation of a job whose Core task outlived its observer. No
/// gateway, provider, model or network call; nothing under ~/.os1 is touched.
func fleetCoreSelfTest() async throws {
    typealias C = RCCRuntimeContract
    var checks = 0
    func check(_ value: Bool, _ message: String) throws {
        if !value { throw OS1Error.message("Fleet Core self-test: " + message) }
        checks += 1
    }
    let jobID = "6b6106c3-b8c1-49d3-9dec-14487d787d43"
    let prompt = "OS-1 라우팅 아키텍처를 검토해서 설명해."
    let hash = sha256Hex(Data(prompt.utf8))
    let answer = "Core answer: the router binds the reference tuple.\n결론: 레퍼런스 유지."
    let fixtureHash = String(repeating: "a", count: 64)
    func modelStep(_ output: String, disposition: String = "execution_only", exitCode: Int32 = 0) -> RunStepSummary {
        RunStepSummary(sequence: 1, provider: "claude", action: "cl_fable51_max", model: "claude-fable-5-1", effort: "max",
            revasDisposition: disposition, sessionID: "fixture-native-session", permissionProfile: "read_only", exitCode: exitCode,
            output: output, stderr: "", durationMS: 12, nativeRecord: nil)
    }
    func summaries(_ output: String) throws -> [String] {
        [String(decoding: try JSONEncoder().encode(RunSummary(status: "returned_unverified", steps: [modelStep(output)])), as: UTF8.self)]
    }
    let nativeConfig = C.ExactConfig(surface: .claude, transport: .claudeCLI, accountID: "default", model: "claude-fable-5-1",
        effort: .max, tools: [], scope: .readOnly, permissionProfile: .readOnly, quotaPool: .anthropicShared,
        allowedPaths: [], configurationSHA256: fixtureHash)
    func nativeChild(_ id: String = "node_0", state: C.ChildState = .succeeded, review: Bool = false) -> C.ChildSnapshot {
        C.ChildSnapshot(id: id, state: state, attemptID: "attempt-" + id, candidateID: "candidate-" + id,
            selectedConfig: nativeConfig, startedAtMS: 1_800_000_000_000, finishedAtMS: 1_800_000_001_000,
            routingDecision: review ? C.RoutingDecision(routeClass: "deep", resolvedCandidateID: "candidate-" + id, surface: .claude,
                model: "claude-fable-5-1", effort: .max, quotaPool: .anthropicShared,
                reason: "admitted_reference_owner_words;" + C.referenceReviewToken, quotaRemainingFraction: nil) : nil)
    }
    func snapshot(_ state: C.State, output: String? = nil, taskVerified: Bool = false, error: String? = nil,
                  children: [C.ChildSnapshot]? = nil, partial: C.Partial? = nil, handoff: C.InstallHandoff? = nil,
                  review: Bool = false) throws -> C.Snapshot {
        let result = try output.map {
            C.Result(output: $0, executionVerified: true, taskVerified: taskVerified, parityState: .unverified,
                     nativeReceipt: "/private/fixture/native-receipt.json", nativeSummaries: try summaries($0),
                     taskQuality: taskVerified ? .taskVerified : .executionOnly, partial: partial)
        }
        return C.Snapshot(taskID: jobID, requestSHA256: hash, state: state, revision: 7,
            children: children ?? [nativeChild(review: review)], result: result, error: error, installHandoff: handoff)
    }
    let assignment = FleetAssignment(jobID: jobID, submitterDeviceID: "device:fixture-submitter", profile: "claude", task: prompt,
        workspaceRepository: "owner/repo", workspaceRevision: String(repeating: "b", count: 40), workspaceSubpath: "",
        requirements: FleetRequirements(minMemoryMiB: 0, cpuWeight: 0, preferDeviceID: nil), createdAtMs: 1, expiresAtMs: 2,
        objectiveVersion: "os1-fleet-objective-v1", executionMode: "single_node", executorDeviceID: "device:fixture-air", score: 1)
    let clock = FleetFixtureClock(Date(timeIntervalSince1970: 1_800_000_000))
    func client(runs: FleetFixtureLog, statuses: FleetFixtureLog,
                run: @escaping @Sendable (String) throws -> RunSummary,
                status: @escaping @Sendable (Int) throws -> C.Snapshot) -> FleetCoreClient {
        FleetCoreClient(
            run: { prompt, _, preference, _, version in
                runs.add(prompt + "|" + preference + "|v\(version)")
                return try run(prompt)
            },
            status: { taskID, requestSHA256 in
                statuses.add(taskID + "|" + requestSHA256)
                return try status(statuses.all.count)
            },
            sleep: { clock.advance($0) },
            now: { clock.now })
    }
    func delivered(_ resolution: FleetCoreResolution) -> (RunSummary, FleetCoreOutcome)? {
        if case .delivered(let run, let outcome) = resolution { return (run, outcome) }
        return nil
    }
    func undelivered(_ resolution: FleetCoreResolution) -> [String: String]? {
        if case .undelivered(let failure) = resolution { return failure }
        return nil
    }
    func failure(_ disposition: FleetCoreDisposition) -> [String: String]? {
        if case .undelivered(let failure) = disposition { return failure }
        return nil
    }
    func receiptJSON(_ text: String) -> [String: Any]? {
        (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any]
    }
    /// What the gateway bounds: the whole /v1/fleet/complete request.
    func sendable(_ result: String, outcome: String = "complete") -> Bool {
        fleetCompleteRequestBytes(outcome: outcome, result: result) <= fleetCompleteRequestLimit - fleetCompleteRequestMargin
            && fleetCompleteRequestBytes(outcome: outcome, result: result) > result.utf8.count
    }
    func failureText(_ failure: [String: String]) throws -> String {
        String(decoding: try JSONEncoder().encode(failure), as: UTF8.self)
    }
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("os1-fleet-core-self-test-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: directory) }
    func mirrored(_ result: String, profile: String = "claude") throws -> String? {
        let url = directory.appendingPathComponent(UUID().uuidString + ".json")
        try fleetPersist(FleetJobStatus(jobID: jobID, state: "complete", profile: profile, executionMode: "single_node",
            executorDeviceID: "device:fixture-air", objectiveVersion: "os1-fleet-objective-v1", result: result,
            resultHash: sha256Hex(Data(result.utf8))), at: url)
        return try? readFleetCachedResult(at: url, jobID: jobID)
    }

    // F1: Core returned_unverified at the reference (one Fable max child, no
    // registered task verifier) is delivered, labelled exactly as the App
    // labels it, in a compact signed receipt the submitter accepts.
    let unverifiedCore = try snapshot(.returnedUnverified, output: answer, error: "no_registered_exact_task_verifier", review: true)
    var appRun = fleetRunSummary(unverifiedCore, prompt: prompt, jobID: jobID, startedAt: clock.now)
    appRun.agentTask = try RCCRuntimeProjection.project(unverifiedCore, conversationID: UUID(), submissionID: UUID(),
        objective: prompt, observedAt: clock.now.addingTimeInterval(10), firstObservedAt: clock.now, maxParallelism: 4,
        expectedRequestSHA256: hash)
    try check(appRun.rccRuntime != nil && appRun.agentTask != nil && appRun.status == "returned_unverified"
              && appRun.routingNotices?.contains(where: { $0.contains("reference review required") || $0.contains("레퍼런스 검토 필요") }) == true,
              "the fixture run must carry Core's snapshot, task graph and K14 notice like a real run")
    let f1Runs = FleetFixtureLog(), f1Statuses = FleetFixtureLog(), appRunBox = FleetFixtureBox(appRun)
    let f1Client = client(runs: f1Runs, statuses: f1Statuses, run: { _ in appRunBox.value }, status: { _ in throw OS1Error.message("no status") })
    let f1Resolution = await fleetCoreRun(jobID: jobID, prompt: prompt, preference: "claude", workspace: directory.path, core: f1Client)
    guard case .delivered(let f1Run, let f1Outcome) = f1Resolution else {
        throw OS1Error.message("Fleet Core self-test: F1 returned_unverified answer was not delivered: \(undelivered(f1Resolution) ?? [:])")
    }
    try check(f1Runs.all == [prompt + "|claude|v\(RCCRunBudgetOptions.appResultContractVersion)"] && f1Statuses.all.isEmpty,
              "F1 a fleet job runs Core once, with result contract v2, and needs no status read")
    try check(f1Outcome.state == "returned_unverified" && f1Outcome.verification == "unverified" && !f1Outcome.taskVerified
              && f1Outcome.label == RCCRuntimeProjection.returnedUnverifiedDescription
              && f1Outcome.label == RCCRuntimeProjection.rootDescription(unverifiedCore)
              && f1Outcome.output == unverifiedCore.result?.output && f1Outcome.error == "no_registered_exact_task_verifier"
              && f1Outcome.taskID == jobID && f1Outcome.requestSHA256 == hash && f1Outcome.parityState == "unverified"
              && f1Run.status == "returned_unverified", "F1 the unverified answer lost its state, label or text")
    let f1Receipt = try fleetCoreReceipt(assignment, role: "air", deviceID: "device:fixture-air", published: (nil, nil), run: f1Run, outcome: f1Outcome)
    let f1Object = receiptJSON(f1Receipt), f1RunObject = f1Object?["run"] as? [String: Any], f1Core = f1Object?["core"] as? [String: Any]
    try check(sendable(f1Receipt) && f1RunObject?["rccRuntime"] == nil && f1RunObject?["agentTask"] == nil
              && f1RunObject?["status"] as? String == "returned_unverified" && f1Core?["output"] as? String == answer
              && f1Core?["label"] as? String == RCCRuntimeProjection.returnedUnverifiedDescription
              && f1Core?["verification"] as? String == "unverified" && f1Core?["output_truncated"] as? Bool == false
              && (f1RunObject?["routingNotices"] as? [String])?.isEmpty == false,
              "F1 receipt must carry Core's answer, label and notices without the snapshot or task graph")
    let f1Decoded = try JSONDecoder().decode(FleetExecutionReceipt.self, from: Data(f1Receipt.utf8))
    try check(fleetResultStatusIsValid(f1Decoded.run, profile: "claude", core: f1Decoded.core), "F1 submitter refused a Core receipt")
    try check(try mirrored(f1Receipt) == f1Receipt, "F1 fleet-result must return the exact signed receipt bytes")
    try check(!fleetResultStatusIsValid(f1Decoded.run, profile: "claude"), "F1 a Core run passed the legacy check without its core block")

    // F2: Core completed (task_verified, model step "execution_only") is
    // delivered and accepted: the latent submitter rejection is gone.
    let completedCore = try snapshot(.completed, output: answer, taskVerified: true)
    guard case .delivered(let f2Outcome) = fleetCoreDisposition(completedCore,
            run: fleetRunSummary(completedCore, prompt: prompt, jobID: jobID, startedAt: clock.now), jobID: jobID) else {
        throw OS1Error.message("Fleet Core self-test: F2 completed answer was not delivered")
    }
    let f2Run = fleetRunSummary(completedCore, prompt: prompt, jobID: jobID, startedAt: clock.now)
    try check(f2Run.status == "complete" && f2Run.steps.map(\.revasDisposition) == ["execution_only"]
              && f2Outcome.verification == "task_verified" && f2Outcome.taskVerified && f2Outcome.state == "completed",
              "F2 completed Core answer lost its verification")
    let f2Receipt = try fleetCoreReceipt(assignment, role: "air", deviceID: "device:fixture-air", published: (nil, nil), run: f2Run, outcome: f2Outcome)
    try check(try mirrored(f2Receipt) == f2Receipt, "F2 the submitter refused a completed Core answer with execution_only steps")
    try check(!fleetResultStatusIsValid(f2Run, profile: "claude"), "F2 legacy rule must still refuse execution_only steps without a core block")

    // F3: Core's deterministic local answer (host "control_verified" step)
    // is delivered through reconciliation too; its legacy fields stay valid.
    let localConfig = C.ExactConfig(surface: .local, transport: .local, accountID: "local", model: "none", effort: .none,
        tools: [], scope: .readOnly, permissionProfile: .readOnly, quotaPool: .none, allowedPaths: [], configurationSHA256: fixtureHash)
    let deterministicCore = C.Snapshot(taskID: jobID, requestSHA256: hash, state: .completed, revision: 3,
        children: [C.ChildSnapshot(id: "local-core", state: .completed, attemptID: nil, candidateID: "local-core",
                                   selectedConfig: localConfig, instruction: prompt)],
        result: C.Result(output: "4", executionVerified: true, taskVerified: true, parityState: .unverified, nativeReceipt: nil,
                         taskQuality: .taskVerified), error: nil)
    let f3Runs = FleetFixtureLog(), f3Statuses = FleetFixtureLog()
    let f3 = await fleetCoreRun(jobID: jobID, prompt: prompt, preference: "auto", workspace: directory.path,
        core: client(runs: f3Runs, statuses: f3Statuses, run: { _ in throw RCCRuntimeGatewayClient.Failure.rpcTimeout },
                     status: { _ in deterministicCore }))
    guard case .delivered(let f3Run, let f3Outcome) = f3 else {
        throw OS1Error.message("Fleet Core self-test: F3 deterministic answer was not delivered: \(undelivered(f3) ?? [:])")
    }
    try check(f3Run.status == "complete" && f3Run.steps.count == 1 && f3Run.steps[0].revasDisposition == "control_verified"
              && f3Run.steps[0].action == "rcc_deterministic" && f3Outcome.output == "4"
              && fleetResultStatusIsValid(f3Run, profile: "auto") && fleetResultStatusIsValid(f3Run, profile: "auto", core: f3Outcome),
              "F3 deterministic local answer lost its host control_verified step")
    let f3Receipt = try fleetCoreReceipt(assignment, role: "air", deviceID: "device:fixture-air", published: (nil, nil), run: f3Run, outcome: f3Outcome)
    try check(try mirrored(f3Receipt) == f3Receipt && f3Runs.all.count == 1, "F3 deterministic receipt refused, or rpcTimeout resubmitted")

    // F4: a hold with no result reports why, never an answer.
    let heldCore = try snapshot(.held, error: "no_dispatchable_candidate:anthropic_shared=quota_unknown_or_exhausted", children: [])
    guard let f4 = failure(fleetCoreDisposition(heldCore, run: fleetRunSummary(heldCore, prompt: prompt, jobID: jobID, startedAt: clock.now), jobID: jobID)) else {
        throw OS1Error.message("Fleet Core self-test: F4 a held task was delivered")
    }
    try check(f4["core_state"] == "held" && f4["core_error"] == "no_dispatchable_candidate:anthropic_shared=quota_unknown_or_exhausted"
              && f4["model_dispatched"] == "false" && f4["error"]?.contains("held") == true
              && f4["partial_answer"] == nil && f4["handoff_answer"] == nil && f4["unadopted_answer"] == nil
              && f4["core_admitted"] == "yes" && f4["observe_command"]?.contains("--request-sha256 " + hash) == true,
              "F4 a held task lost its reason or invented an answer")

    // F5/F6: a v2 partial is reported failed with its coverage, under every
    // terminal state that may carry one; under v1 it is a contract breach.
    let partial = C.Partial(coverage: .init(completedNodeIDs: ["node_0"], unresolvedNodeIDs: ["node_1"]),
        parent: .init(taskID: jobID, requestSHA256: hash, revision: 6),
        nodes: [.init(nodeID: "node_0", attemptID: "attempt-node_0", outputSHA256: sha256Hex(Data("done".utf8)))])
    for state in [C.State.held, .failed, .cancelled, .returnedUnverified] {
        let core = try snapshot(state, output: "node_0: done", error: state == .returnedUnverified ? nil : "verified_not_dispatched_retry_exhausted",
            children: [nativeChild("node_0", state: .completed), nativeChild("node_1", state: .failed)], partial: partial)
        let run = fleetRunSummary(core, prompt: prompt, jobID: jobID, startedAt: clock.now)
        guard let v2 = failure(fleetCoreDisposition(core, run: run, jobID: jobID, resultContractVersion: 2)) else {
            throw OS1Error.message("Fleet Core self-test: F5/F6 a \(state.rawValue) partial was delivered as an answer")
        }
        try check(v2["partial_answer"] == "node_0: done" && v2["partial_coverage"] == partial.coverage.label()
                  && v2["verification"] == "partial_unverified" && v2["core_state"] == state.rawValue
                  && v2["partial_work"]?.contains("unresolved") == true, "F5/F6 \(state.rawValue) partial lost its coverage label")
        guard let v1 = failure(fleetCoreDisposition(core, run: run, jobID: jobID, resultContractVersion: nil)) else {
            throw OS1Error.message("Fleet Core self-test: F5 a v1 partial was delivered")
        }
        try check(v1["core_result_contract_breach"] == "true" && v1["partial_answer"] == nil && v1["unadopted_answer"] == nil,
                  "F5 a partial under v1 became an answer")
    }

    // F7: uncertain effects are never published or replayed.
    let uncertainCore = try snapshot(.effectsUncertain, error: "native_effects_uncertain")
    guard let f7 = failure(fleetCoreDisposition(uncertainCore, run: fleetRunSummary(uncertainCore, prompt: prompt, jobID: jobID, startedAt: clock.now), jobID: jobID)) else {
        throw OS1Error.message("Fleet Core self-test: F7 effects_uncertain was delivered")
    }
    try check(f7["effects_uncertain"] == "true" && f7["checkout"] == "~/.os1/fleet/jobs/\(jobID)/repository"
              && f7["partial_work"]?.contains("never replay") == true, "F7 effects_uncertain lost its checkout or no-replay rule")

    // F8: a staged installation is not a finished task.
    let handoff = C.InstallHandoff(taskID: jobID, requestSHA256: hash, nodeID: "node_0", parentAttemptID: "attempt-node_0",
        sourceFingerprint: fixtureHash, sourceRoot: "/tmp/fixture-source", sourceHead: String(repeating: "c", count: 40),
        protectedSourceSHA256: fixtureHash, stagedIntentID: "fixture-intent", stagedReceiptSHA256: fixtureHash, state: .staged)
    let stagedCore = try snapshot(.awaitingInstall, output: "Staged the fix.", handoff: handoff)
    guard let f8 = failure(fleetCoreDisposition(stagedCore, run: fleetRunSummary(stagedCore, prompt: prompt, jobID: jobID, startedAt: clock.now), jobID: jobID)) else {
        throw OS1Error.message("Fleet Core self-test: F8 awaiting_install was delivered")
    }
    try check(f8["core_state"] == "awaiting_install" && f8["handoff_answer"] == "Staged the fix."
              && f8["handoff_answer_label"]?.contains("installation pending; task is not complete") == true,
              "F8 a pending installation lost its handoff answer or label")

    // F9: an oversized answer is cut explicitly, never silently.
    let longAnswer = String(repeating: "가나다 abc 123\n", count: 17_000)
    try check(longAnswer.count >= 200_000, "F9 fixture answer is shorter than 200,000 characters")
    let longCore = try snapshot(.returnedUnverified, output: longAnswer, error: "no_registered_exact_task_verifier")
    let longRun = fleetRunSummary(longCore, prompt: prompt, jobID: jobID, startedAt: clock.now)
    guard case .delivered(let longOutcome) = fleetCoreDisposition(longCore, run: longRun, jobID: jobID) else {
        throw OS1Error.message("Fleet Core self-test: F9 long answer was not delivered")
    }
    let f9Receipt = try fleetCoreReceipt(assignment, role: "air", deviceID: "device:fixture-air", published: (nil, nil), run: longRun, outcome: longOutcome)
    let f9 = try JSONDecoder().decode(FleetExecutionReceipt.self, from: Data(f9Receipt.utf8))
    try check(sendable(f9Receipt) && f9.core?.outputTruncated == true && f9.core?.outputSHA256 == sha256Hex(Data(longAnswer.utf8))
              && f9.core?.outputBytes == longAnswer.utf8.count && longAnswer.hasPrefix(f9.core?.output ?? "x")
              && (f9.core?.output.utf8.count ?? 0) > 30_000 && f9.core?.label == RCCRuntimeProjection.returnedUnverifiedDescription
              && f9.run.steps.allSatisfy({ $0.output.isEmpty }) && fleetResultStatusIsValid(f9.run, profile: "claude", core: f9.core)
              && (try mirrored(f9Receipt)) == f9Receipt, "F9 oversized answer was not cut explicitly within the signed limit")
    let longFailure = fleetBoundedFailure(["error": "x", "job_id": jobID, "partial_answer": longAnswer])
    try check(sendable(try failureText(longFailure), outcome: "failed") && longFailure["partial_answer_truncated"] == "true"
              && longAnswer.hasPrefix(longFailure["partial_answer"] ?? "x"), "a long partial answer overflowed the signed result limit")

    // F9b: the gateway bounds the whole /v1/fleet/complete request, which
    // escapes the result again. A markdown answer full of quotes, backslashes
    // and slashes, and a whole 28 KB answer whose step copy doubled it (a
    // 67,219-byte request before build 438's fix), are sized against that
    // request: the step copy goes first, then the answer is cut explicitly.
    let markdown = String(repeating: "```swift\nlet path = \"/a/b\\\\c\" // \"quoted\" \\n\n```\n| a | \"b\" | </tag> |\n", count: 1_200)
    let markdownCore = try snapshot(.returnedUnverified, output: markdown, error: "no_registered_exact_task_verifier")
    let markdownRun = fleetRunSummary(markdownCore, prompt: prompt, jobID: jobID, startedAt: clock.now)
    guard case .delivered(let markdownOutcome) = fleetCoreDisposition(markdownCore, run: markdownRun, jobID: jobID) else {
        throw OS1Error.message("Fleet Core self-test: F9b markdown answer was not delivered")
    }
    let markdownReceipt = try fleetCoreReceipt(assignment, role: "air", deviceID: "device:fixture-air", published: (nil, nil),
                                               run: markdownRun, outcome: markdownOutcome)
    let markdownDecoded = try JSONDecoder().decode(FleetExecutionReceipt.self, from: Data(markdownReceipt.utf8))
    try check(sendable(markdownReceipt) && markdownDecoded.core?.outputTruncated == true
              && markdown.hasPrefix(markdownDecoded.core?.output ?? "x") && (markdownDecoded.core?.output.utf8.count ?? 0) > 20_000
              && fleetResultStatusIsValid(markdownDecoded.run, profile: "claude", core: markdownDecoded.core),
              "F9b an escaped markdown answer was not sized against the complete request")
    let wholeAnswer = String(repeating: "The \"router\" binds /reference/tuple.\n", count: 750)
    try check((26_000...30_000).contains(wholeAnswer.utf8.count), "F9b fixture answer is not about 28 KB")
    let wholeCore = try snapshot(.returnedUnverified, output: wholeAnswer, error: "no_registered_exact_task_verifier")
    let wholeRun = fleetRunSummary(wholeCore, prompt: prompt, jobID: jobID, startedAt: clock.now)
    guard case .delivered(let wholeOutcome) = fleetCoreDisposition(wholeCore, run: wholeRun, jobID: jobID) else {
        throw OS1Error.message("Fleet Core self-test: F9b whole answer was not delivered")
    }
    let wholeReceipt = try fleetCoreReceipt(assignment, role: "air", deviceID: "device:fixture-air", published: (nil, nil),
                                            run: wholeRun, outcome: wholeOutcome)
    let wholeDecoded = try JSONDecoder().decode(FleetExecutionReceipt.self, from: Data(wholeReceipt.utf8))
    try check(wholeRun.steps.first?.output == wholeAnswer && sendable(wholeReceipt) && wholeDecoded.core?.outputTruncated == false
              && wholeDecoded.core?.output == wholeAnswer && wholeDecoded.run.steps.allSatisfy({ $0.output.isEmpty }),
              "F9b a whole answer with its step copy was not delivered whole within the complete request")
    let markdownFailure = fleetBoundedFailure(["error": "x", "job_id": jobID, "partial_answer": markdown, "unadopted_answer": wholeAnswer])
    try check(sendable(try failureText(markdownFailure), outcome: "failed") && markdownFailure["partial_answer_truncated"] == "true"
              && markdown.hasPrefix(markdownFailure["partial_answer"] ?? "x"), "F9b an escaped partial answer overflowed the complete request")
    let unboundable = fleetBoundedFailure(["error": "x", "job_id": jobID, "core_task_id": jobID,
                                           "partial_coverage": String(repeating: "node_\"1\", ", count: 9_000)])
    try check(sendable(try failureText(unboundable), outcome: "failed") && unboundable["result_truncated"] == "true"
              && unboundable["core_task_id"] == jobID && unboundable["partial_coverage"] == nil,
              "F9b a failure with nothing to halve was not reduced to its identity")

    // F10: a Core state can never be laundered into another.
    func laundered(_ change: (inout RunSummary, inout FleetCoreOutcome) -> Void) -> Bool {
        var run = f1Run, outcome = f1Outcome
        change(&run, &outcome)
        return fleetResultStatusIsValid(run, profile: "claude", core: outcome)
    }
    try check(!laundered { run, _ in run = RunSummary(status: "complete", steps: run.steps) }, "F10 complete status on an unverified Core answer")
    try check(!laundered { _, outcome in outcome = FleetCoreOutcome(taskID: outcome.taskID, requestSHA256: outcome.requestSHA256,
        state: outcome.state, revision: outcome.revision, verification: outcome.verification, label: outcome.label, error: outcome.error,
        output: outcome.output, outputSHA256: outcome.outputSHA256, outputBytes: outcome.outputBytes, outputTruncated: false,
        partialCoverage: nil, parityState: outcome.parityState, taskQuality: "task_verified", executionVerified: true, taskVerified: true) },
        "F10 task_verified on returned_unverified")
    try check(!laundered { _, outcome in outcome.output += " tampered" }, "F10 output hash mismatch accepted")
    try check(!laundered { _, outcome in outcome = FleetCoreOutcome(taskID: outcome.taskID, requestSHA256: outcome.requestSHA256,
        state: outcome.state, revision: outcome.revision, verification: "task_verified", label: outcome.label, error: outcome.error,
        output: outcome.output, outputSHA256: outcome.outputSHA256, outputBytes: outcome.outputBytes, outputTruncated: false,
        partialCoverage: nil, parityState: outcome.parityState, taskQuality: outcome.taskQuality, executionVerified: true, taskVerified: false) },
        "F10 verified label on an unverified answer")
    try check(!laundered { _, outcome in outcome = FleetCoreOutcome(taskID: outcome.taskID, requestSHA256: outcome.requestSHA256,
        state: outcome.state, revision: outcome.revision, verification: outcome.verification, label: "OpenClaw core state: completed",
        error: outcome.error, output: outcome.output, outputSHA256: outcome.outputSHA256, outputBytes: outcome.outputBytes,
        outputTruncated: false, partialCoverage: nil, parityState: outcome.parityState, taskQuality: outcome.taskQuality,
        executionVerified: true, taskVerified: false) }, "F10 the unverified label was replaced")
    try check(!laundered { _, outcome in outcome = FleetCoreOutcome(taskID: outcome.taskID, requestSHA256: outcome.requestSHA256,
        state: outcome.state, revision: outcome.revision, verification: outcome.verification, label: outcome.label, error: outcome.error,
        output: outcome.output, outputSHA256: outcome.outputSHA256, outputBytes: outcome.outputBytes, outputTruncated: false,
        partialCoverage: "Partial result · completed 1/2 · unresolved: node_1", parityState: outcome.parityState,
        taskQuality: outcome.taskQuality, executionVerified: true, taskVerified: false) }, "F10 a partial delivered as an answer")
    try check(!fleetResultStatusIsValid(f1Run, profile: "claude") && !fleetResultStatusIsValid(RunSummary(status: "returned_unverified",
              steps: f1Run.steps), profile: "claude"), "F10 returned_unverified without a core block accepted")
    try check(!fleetResultStatusIsValid(f1Run, profile: "exo", core: f1Outcome), "F10 a Core block on an EXO receipt accepted")
    var tampered = f1Decoded
    tampered.run = RunSummary(status: "complete", steps: tampered.run.steps)
    let tamperedText = String(decoding: try JSONEncoder().encode(tampered), as: UTF8.self)
    try check(try mirrored(tamperedText) == nil, "F10 a relabelled receipt passed fleet-result")

    // F11: transport errors keep their stable code and Core identity.
    let rejected = fleetFailureResult(error: RCCRuntimeGatewayClient.Failure.rpcRejected, jobID: jobID, notice: nil)
    try check(rejected["error"] == "rcc_runtime_rpc_rejected_no_state_reuse", "F11 a gateway refusal kept the Swift case name")
    let f11aRuns = FleetFixtureLog(), f11aStatuses = FleetFixtureLog()
    guard let f11a = undelivered(await fleetCoreRun(jobID: jobID, prompt: prompt, preference: "claude", workspace: directory.path,
        core: client(runs: f11aRuns, statuses: f11aStatuses, run: { _ in throw RCCRuntimeGatewayClient.Failure.rpcRejected },
                     status: { _ in throw RCCRuntimeGatewayClient.Failure.rpcRejected }))) else {
        throw OS1Error.message("Fleet Core self-test: F11 a refused run was delivered")
    }
    try check(f11a["error"] == "rcc_runtime_rpc_rejected_no_state_reuse" && f11a["error"]?.contains("rpcRejected") == false
              && f11a["core_task_id"] == jobID && f11a["request_sha256"] == hash && f11a["core_admitted"] == "unknown"
              && f11aRuns.all.count == 1 && f11aStatuses.all.count > 1, "F11 rpcRejected lost its code, identity or reconciliation")
    for failure in [RCCRuntimeGatewayClient.Failure.gatewayIdentityChanged, .startupBusy] {
        let runs = FleetFixtureLog(), statuses = FleetFixtureLog()
        guard let result = undelivered(await fleetCoreRun(jobID: jobID, prompt: prompt, preference: "claude", workspace: directory.path,
            core: client(runs: runs, statuses: statuses, run: { _ in throw failure }, status: { _ in throw failure }))) else {
            throw OS1Error.message("Fleet Core self-test: F11 \(failure.rawValue) was delivered")
        }
        try check(result["core_admitted"] == "no" && result["error"] == failure.rawValue && runs.all.count == 1 && statuses.all.count == 1,
                  "F11 \(failure.rawValue) must report core_admitted no after one status read")
    }
    let f11bRuns = FleetFixtureLog(), f11bStatuses = FleetFixtureLog()
    let f11b = await fleetCoreRun(jobID: jobID, prompt: prompt, preference: "claude", workspace: directory.path,
        core: client(runs: f11bRuns, statuses: f11bStatuses, run: { _ in throw RCCRuntimeGatewayClient.Failure.rpcTimeout },
                     status: { _ in unverifiedCore }))
    try check(delivered(f11b)?.1.output == answer && f11bRuns.all.count == 1 && f11bStatuses.all == [jobID + "|" + hash],
              "F11 rpcTimeout must reconcile by status, never resubmit")
    // rpc() raises these while it observes an ADMITTED task (owner process
    // gone, installed bytes changed by an OS-1 install during the job,
    // private config changed): never "no model ran", and a readable task
    // is delivered.
    for failure in [RCCRuntimeGatewayClient.Failure.existingGatewayUnavailable, .identityMismatch, .privateStateInvalid] {
        let runs = FleetFixtureLog(), statuses = FleetFixtureLog()
        guard let result = undelivered(await fleetCoreRun(jobID: jobID, prompt: prompt, preference: "claude", workspace: directory.path,
            core: client(runs: runs, statuses: statuses, run: { _ in throw failure }, status: { _ in throw failure }))) else {
            throw OS1Error.message("Fleet Core self-test: F11 \(failure.rawValue) was delivered")
        }
        try check(result["core_admitted"] == "unknown" && result["error"] == failure.rawValue
                  && result["partial_work"]?.contains("no model ran") == false && result["partial_work"]?.contains("observe_command") == true
                  && runs.all.count == 1 && statuses.all.count > 1,
                  "F11 \(failure.rawValue) after admission must report core_admitted unknown, never that nothing ran")
        let readable = await fleetCoreRun(jobID: jobID, prompt: prompt, preference: "claude", workspace: directory.path,
            core: client(runs: FleetFixtureLog(), statuses: FleetFixtureLog(), run: { _ in throw failure }, status: { _ in unverifiedCore }))
        try check(delivered(readable)?.1.output == answer, "F11 \(failure.rawValue) with a readable Core task lost its answer")
    }

    // F12: an agent restart reconciles with Core by task id; no submit.
    let restartRuns = FleetFixtureLog()
    let neverRun: @Sendable (String) throws -> RunSummary = { _ in throw OS1Error.message("a restart resubmitted the job") }
    let f12aStatuses = FleetFixtureLog()
    let f12a = await fleetRestartedResolution(assignment, startedAtMs: Int64(clock.now.timeIntervalSince1970 * 1_000),
        resultContractVersion: nil, core: client(runs: restartRuns, statuses: f12aStatuses, run: neverRun, status: { _ in unverifiedCore }))
    guard case .delivered(let f12aRun, let f12aOutcome) = f12a else {
        throw OS1Error.message("Fleet Core self-test: F12a finished task not delivered: \(undelivered(f12a) ?? [:])")
    }
    try check(f12aOutcome.output == answer && f12aOutcome.verification == "unverified" && f12aRun.status == "returned_unverified"
              && f12aRun.steps.map(\.revasDisposition) == ["execution_only"]
              && sendable(try fleetCoreReceipt(assignment, role: "air", deviceID: "device:fixture-air", published: (nil, nil),
                                               run: f12aRun, outcome: f12aOutcome)),
              "F12a a task Core finished after a restart was not delivered with its answer")
    let f12bStatuses = FleetFixtureLog()
    let runningCore = try snapshot(.running, children: [nativeChild(state: .running)])
    let f12bStarted = clock.now
    let f12b = await fleetRestartedResolution(assignment, startedAtMs: Int64(f12bStarted.timeIntervalSince1970 * 1_000),
        resultContractVersion: 2, core: client(runs: restartRuns, statuses: f12bStatuses, run: neverRun,
            status: { count in
                if count == 3 { throw RCCRuntimeGatewayClient.Failure.rpcTimeout }
                return count < 5 ? runningCore : unverifiedCore
            }))
    try check(delivered(f12b)?.1.output == answer && f12bStatuses.all.count == 5 && clock.now > f12bStarted,
              "F12b reconciliation must keep observing a running task (across a failed read) until it is terminal")
    let f12cStatuses = FleetFixtureLog()
    let f12cStarted = clock.now
    let f12c = await fleetRestartedResolution(assignment, startedAtMs: nil, resultContractVersion: nil,
        core: client(runs: restartRuns, statuses: f12cStatuses, run: neverRun,
                     status: { _ in throw RCCRuntimeGatewayClient.Failure.rpcRejected }))
    // The gateway answers task_not_found, rcc_runtime_unavailable and
    // runtime_owner_active alike (rpcRejected): refusals prove nothing.
    try check(undelivered(f12c)?["core_admitted"] == "unknown" && undelivered(f12c)?["error"]?.contains("interrupted") == true
              && undelivered(f12c)?["core_status_error"] == "rcc_runtime_rpc_rejected_no_state_reuse"
              && undelivered(f12c)?["partial_work"]?.contains("observe_command") == true
              && f12cStatuses.all.count > 1 && clock.now.timeIntervalSince(f12cStarted) >= 60,
              "F12c a restarted job whose Core task refused every read must be reported interrupted with core_admitted unknown")
    let f12unknown = await fleetRestartedResolution(assignment, startedAtMs: nil, resultContractVersion: nil,
        core: client(runs: restartRuns, statuses: FleetFixtureLog(), run: neverRun,
                     status: { _ in throw RCCRuntimeGatewayClient.Failure.gatewayNotReady }))
    try check(undelivered(f12unknown)?["core_admitted"] == "unknown", "F12c an unreachable gateway proves no admission either way")
    for profile in ["claude", "codex", "build", "test"] {
        let statuses = FleetFixtureLog()
        let job = FleetAssignment(jobID: jobID, submitterDeviceID: assignment.submitterDeviceID, profile: profile, task: prompt,
            workspaceRepository: assignment.workspaceRepository, workspaceRevision: assignment.workspaceRevision, workspaceSubpath: "",
            requirements: assignment.requirements, createdAtMs: 1, expiresAtMs: 2, objectiveVersion: assignment.objectiveVersion,
            executionMode: "single_node", executorDeviceID: assignment.executorDeviceID, score: 1)
        _ = await fleetRestartedResolution(job, startedAtMs: nil, resultContractVersion: 2,
            core: client(runs: restartRuns, statuses: statuses, run: neverRun, status: { _ in throw RCCRuntimeGatewayClient.Failure.rpcRejected }))
        let expected = sha256Hex(Data(fleetPrompt(profile: profile, task: prompt).utf8))
        try check(!statuses.all.isEmpty && statuses.all.allSatisfy { $0 == jobID + "|" + expected }
                  && (["build", "test"].contains(profile) ? expected != hash : expected == hash),
                  "F12d \(profile) reconciliation must read Core by the job's own prompt hash")
    }
    try check(restartRuns.all.isEmpty, "F12 a restart reconciliation submitted work")

    // F13: a host hold with no Core snapshot says why.
    var blockedRun = RunSummary(status: "workflow_blocked", steps: [], workflowBlocker: "OpenClaw task connection unavailable (fixture); request preserved; no alternate route")
    blockedRun.routingNotices = ["GPT is no longer a routed surface. Running on Codex with the same OpenAI account (gpt-chat → codex)."]
    guard let f13 = failure(fleetCoreDisposition(nil, run: blockedRun, jobID: jobID)) else {
        throw OS1Error.message("Fleet Core self-test: F13 a host hold was delivered")
    }
    try check(f13["workflow_blocker"]?.contains("connection unavailable") == true && f13["routing_notices"]?.contains("GPT is no longer") == true
              && f13["error"]?.contains("connection unavailable") == true && f13["error"]?.contains("has not completed") == false,
              "F13 a host hold lost its blocker or notices")

    // F14: the archive says what happened to the outcome.
    var work = FleetAgentWork(assignment: assignment)
    work.phase = "delivery_pending"; work.outcome = "complete"; work.result = f1Receipt
    work.startedAtMs = 1_800_000_000_000; work.resultContractVersion = 2
    let archiveURL = directory.appendingPathComponent("fleet-result.json")
    try fleetPersist(fleetArchived(work, stored: true), at: archiveURL)
    let archived = try JSONDecoder().decode(FleetAgentWork.self, from: Data(contentsOf: archiveURL))
    try check(archived.phase == "delivered" && archived.result == f1Receipt && archived.startedAtMs == 1_800_000_000_000
              && archived.resultContractVersion == 2 && fleetArchived(work, stored: false).phase == "expired_kept"
              && work.phase == "delivery_pending", "F14 the archived job record kept the outbox phase")
    let legacyObject: [String: Any] = ["assignment": try JSONSerialization.jsonObject(with: JSONEncoder().encode(assignment)),
                                       "phase": "running"]
    let legacyRecord = try JSONSerialization.data(withJSONObject: legacyObject)
    let legacy = try JSONDecoder().decode(FleetAgentWork.self, from: legacyRecord)
    try check(legacy.phase == "running" && legacy.startedAtMs == nil && legacy.resultContractVersion == nil,
              "F14 a record written before build 438 no longer decodes")

    // F15: one label per Core state on every surface.
    let allStates: [C.State] = [.queued, .planning, .running, .waiting, .cancelling, .cancelled, .completed, .failed, .held,
                                .returnedUnverified, .effectsUncertain, .awaitingInstall]
    for state in allStates {
        let core = try snapshot(state, output: [.completed, .returnedUnverified, .awaitingInstall].contains(state) ? answer : nil,
                                taskVerified: state == .completed, handoff: state == .awaitingInstall ? handoff : nil)
        let label: String?
        switch fleetCoreDisposition(core, run: fleetRunSummary(core, prompt: prompt, jobID: jobID, startedAt: clock.now), jobID: jobID) {
        case .delivered(let outcome): label = outcome.label
        case .undelivered(let failure): label = failure["core_label"]
        }
        try check(label == RCCRuntimeProjection.rootDescription(core), "F15 fleet label differs from the App for \(state.rawValue)")
    }
    try check(RCCRuntimeProjection.rootDescription(unverifiedCore) == "Output returned · task quality unverified; candidate retained.",
              "F15 the App's unverified label changed")
    try check(allStates.map(rccRunStatus) == ["workflow_blocked", "workflow_blocked", "workflow_blocked", "workflow_blocked",
              "workflow_blocked", "workflow_blocked", "complete", "workflow_blocked", "workflow_blocked", "returned_unverified",
              "workflow_blocked", "workflow_blocked"], "F15 reconciliation reports another run status than a run")

    // F16: the disposition's own refusals. An answer without the host's
    // execution record is carried unadopted, never delivered.
    for (state, verified) in [(C.State.completed, true), (.returnedUnverified, false)] {
        let core = try snapshot(state, output: answer, taskVerified: verified)
        let run = fleetRunSummary(core, prompt: prompt, jobID: jobID, startedAt: clock.now)
        let empty = try snapshot(state, output: "", taskVerified: verified)
        try check(failure(fleetCoreDisposition(empty, run: fleetRunSummary(empty, prompt: prompt, jobID: jobID, startedAt: clock.now),
                                               jobID: jobID))?["error"]?.contains("without a deliverable answer") == true,
                  "F16 an empty \(state.rawValue) answer was delivered")
        let relabelled = try snapshot(state, output: answer, taskVerified: !verified)
        try check(failure(fleetCoreDisposition(relabelled, run: fleetRunSummary(relabelled, prompt: prompt, jobID: jobID, startedAt: clock.now),
                                               jobID: jobID))?["error"]?.contains("without a deliverable answer") == true,
                  "F16 a \(state.rawValue) snapshot with task_verified \(!verified) was delivered")
        for (label, mismatched) in [("status", RunSummary(status: rccRunStatus(state == .completed ? .returnedUnverified : .completed), steps: run.steps)),
                                    ("exit", RunSummary(status: run.status, steps: [modelStep(answer, exitCode: 1)])),
                                    ("steps", RunSummary(status: run.status, steps: []))] {
            let refused = failure(fleetCoreDisposition(core, run: mismatched, jobID: jobID))
            try check(refused?["unadopted_answer"] == answer && refused?["error"]?.contains("no matching host execution record") == true
                      && refused?["unadopted_answer_note"]?.contains("Treat as unverified") == true,
                      "F16 a \(state.rawValue) answer with a mismatched host record (\(label)) was delivered or lost")
        }
    }

    // F17: Core's R6 disclosure rides beside the label exactly as the App
    // shows it; it cannot be dropped onto a completed answer or rewritten.
    let failedIDs = (1...10).map { "check_\(String(format: "%02d", $0))" }
    var disclosedChild = nativeChild("node_0")
    disclosedChild.qualityDisclosure = C.QualityDisclosure(coverage: nil, failedCheckIDs: failedIDs, checker: .unavailable)
    var cleanChild = nativeChild("node_1")
    cleanChild.qualityDisclosure = C.QualityDisclosure(coverage: nil, failedCheckIDs: ["check_01", "node_verifier"])
    let disclosedCore = try snapshot(.returnedUnverified, output: answer, error: "child_quality_disclosed",
                                     children: [disclosedChild, cleanChild])
    let disclosedRun = fleetRunSummary(disclosedCore, prompt: prompt, jobID: jobID, startedAt: clock.now)
    guard case .delivered(let disclosedOutcome) = fleetCoreDisposition(disclosedCore, run: disclosedRun, jobID: jobID),
          let disclosure = disclosedOutcome.qualityDisclosure else {
        throw OS1Error.message("Fleet Core self-test: F17 a disclosed answer lost its disclosure")
    }
    let expectedIDs = Array((failedIDs + ["node_verifier"]).sorted().prefix(8))
    try check(disclosure.failedCheckIDs == expectedIDs && disclosure.failedCheckCount == 11 && disclosure.checkerUnavailable
              && disclosure.text == "Core-reported failed checks: " + expectedIDs.joined(separator: ", ") + " · +3\nChecker unavailable · not itself a failed-check verdict"
              && disclosedOutcome.label == RCCRuntimeProjection.returnedUnverifiedDescription,
              "F17 the disclosure differs from the App's projection")
    let disclosedReceipt = try fleetCoreReceipt(assignment, role: "air", deviceID: "device:fixture-air", published: (nil, nil),
                                                run: disclosedRun, outcome: disclosedOutcome)
    let disclosedDecoded = try JSONDecoder().decode(FleetExecutionReceipt.self, from: Data(disclosedReceipt.utf8))
    try check(disclosedDecoded.core?.qualityDisclosure == disclosure && (try mirrored(disclosedReceipt)) == disclosedReceipt
              && (receiptJSON(disclosedReceipt)?["core"] as? [String: Any])?["quality_disclosure"] != nil,
              "F17 the submitter refused, or the receipt dropped, Core's disclosure")
    try check(fleetCoreDisclosure(unverifiedCore) == nil && f1Outcome.qualityDisclosure == nil,
              "F17 an answer Core disclosed nothing for carries a disclosure")
    // The carried disclosure must say what its own IDs say (the signed
    // receipt's integrity is the executor's signature).
    for rewrite in [
        FleetCoreDisclosure(failedCheckIDs: disclosure.failedCheckIDs, failedCheckCount: disclosure.failedCheckCount,
                            checkerUnavailable: true, text: "Core check record present · task completion/reference parity unverified"),
        FleetCoreDisclosure(failedCheckIDs: disclosure.failedCheckIDs.reversed(), failedCheckCount: disclosure.failedCheckCount,
                            checkerUnavailable: disclosure.checkerUnavailable, text: disclosure.text),
        FleetCoreDisclosure(failedCheckIDs: failedIDs, failedCheckCount: 11, checkerUnavailable: true, text: disclosure.text),
        FleetCoreDisclosure(failedCheckIDs: disclosure.failedCheckIDs, failedCheckCount: disclosure.failedCheckCount,
                            checkerUnavailable: false, text: disclosure.text),
    ] {
        var rewritten = disclosedOutcome
        rewritten.qualityDisclosure = rewrite
        try check(!fleetResultStatusIsValid(disclosedRun, profile: "claude", core: rewritten), "F17 a rewritten disclosure was accepted")
    }
    var completedDisclosure = f2Outcome
    completedDisclosure.qualityDisclosure = disclosure
    try check(!fleetResultStatusIsValid(f2Run, profile: "claude", core: completedDisclosure), "F17 a completed answer carried a disclosure")
    let unhanded = fleetUndeliveredCoreAnswer(disclosedOutcome, jobID: jobID, error: OS1Error.message("publication failed"))
    try check(unhanded["core_quality_disclosure"] == disclosure.text && unhanded["unadopted_answer"] == answer,
              "F17 an answer the fleet could not hand over lost its disclosure")

    // F18: the agent's own job state machine and delivery path, end to end on
    // a private git checkout with a local bare origin (no network, no model).
    let git = try findExecutable("git")
    @discardableResult func gitOK(_ arguments: [String]) throws -> String {
        let result = try commandOutput(git, arguments, timeout: 60)
        try check(result.0 == 0, "F18 fixture git failed: \(arguments.prefix(4)) \(String(decoding: result.2, as: UTF8.self))")
        return String(decoding: result.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    let origin = directory.appendingPathComponent("origin.git", isDirectory: true)
    let seed = directory.appendingPathComponent("seed", isDirectory: true)
    try gitOK(["init", "--quiet", "--bare", origin.path])
    try gitOK(["init", "--quiet", seed.path])
    try Data("base\n".utf8).write(to: seed.appendingPathComponent("file.txt"))
    try gitOK(["-C", seed.path, "add", "file.txt"])
    try gitOK(["-C", seed.path, "-c", "user.name=OS-1", "-c", "user.email=os1@example.invalid", "commit", "--quiet", "-m", "base"])
    let base = try gitOK(["-C", seed.path, "rev-parse", "HEAD"])
    try gitOK(["-C", seed.path, "push", "--quiet", origin.path, "HEAD:refs/heads/main"])
    let jobs = directory.appendingPathComponent("jobs", isDirectory: true)
    func gitJob(_ id: String) throws -> (FleetAssignment, URL) {
        let job = FleetAssignment(jobID: id, submitterDeviceID: assignment.submitterDeviceID, profile: "claude", task: prompt,
            workspaceRepository: "owner/repo", workspaceRevision: base, workspaceSubpath: "", requirements: assignment.requirements,
            createdAtMs: 1, expiresAtMs: Int64(clock.now.timeIntervalSince1970 * 1_000) + 3_600_000,
            objectiveVersion: assignment.objectiveVersion, executionMode: "single_node",
            executorDeviceID: assignment.executorDeviceID, score: 1)
        let repository = jobs.appendingPathComponent(id, isDirectory: true).appendingPathComponent("repository", isDirectory: true)
        try gitOK(["clone", "--quiet", origin.path, repository.path])
        try gitOK(["-C", repository.path, "checkout", "--quiet", "--detach", base])
        try gitOK(["-C", repository.path, "config", "user.name", "OS-1"])
        try gitOK(["-C", repository.path, "config", "user.email", "os1@example.invalid"])
        return (job, repository)
    }
    func retargeted(_ core: C.Snapshot, as id: String) -> C.Snapshot {
        var copy = core
        copy.taskID = id
        return copy
    }
    let device: () throws -> String = { "device:fixture-air" }

    // F18a: the agent ended after its result commit, before the push: the
    // restart reconciles with Core and publishes that commit; never (nil, nil).
    let restartID = "7e92a37e-0000-4000-8000-000000000001"
    let (restartJob, restartRepository) = try gitJob(restartID)
    try Data("changed by Core\n".utf8).write(to: restartRepository.appendingPathComponent("file.txt"))
    try gitOK(["-C", restartRepository.path, "switch", "--quiet", "-c", "os1-fleet/" + restartID])
    try gitOK(["-C", restartRepository.path, "commit", "--quiet", "-am", "OS-1 fleet result " + restartID])
    let committed = try gitOK(["-C", restartRepository.path, "rev-parse", "HEAD"])
    var restartWork = FleetAgentWork(assignment: restartJob)
    restartWork.phase = "running"; restartWork.startedAtMs = Int64(clock.now.timeIntervalSince1970 * 1_000)
    restartWork.resultContractVersion = 2
    let f18Runs = FleetFixtureLog(), f18Statuses = FleetFixtureLog()
    let restartSnapshot = retargeted(unverifiedCore, as: restartID)
    let restartCore = client(runs: f18Runs, statuses: f18Statuses, run: neverRun, status: { _ in restartSnapshot })
    var restartPersisted: [FleetAgentWork] = []
    let restarted = try await fleetAdvanceWork(restartWork, role: "air", now: { 1 },
        persist: { restartPersisted.append($0) },
        finishRestarted: { await fleetFinishRestarted($0, role: "air", core: restartCore, jobs: jobs, device: device) },
        execute: { _ in throw OS1Error.message("a restart re-executed the job") })
    let restartedReceipt = try JSONDecoder().decode(FleetExecutionReceipt.self, from: Data((restarted.result ?? "").utf8))
    try check(restarted.outcome == "complete" && restarted.phase == "delivery_pending" && restartPersisted.map(\.phase) == ["delivery_pending"]
              && restartedReceipt.resultBranch == "os1-fleet/" + restartID && restartedReceipt.resultCommit == committed
              && (try gitOK(["--git-dir", origin.path, "rev-parse", "refs/heads/os1-fleet/" + restartID])) == committed
              && restartedReceipt.core?.output == answer && restartedReceipt.core?.verification == "unverified"
              && f18Runs.all.isEmpty && sendable(restarted.result ?? ""),
              "F18a a restarted job's unreported result commit was not published with Core's answer")
    let again = try fleetPublishResult(jobID: restartID, workspace: restartRepository.path, baseRevision: base)
    try check(again.0 == "os1-fleet/" + restartID && again.1 == committed, "F18a republishing the same result commit is not idempotent")

    // F18b: a restarted job Core never admitted: interrupted, unknown, no submit.
    let lostID = "549d3800-0000-4000-8000-000000000002"
    let (lostJob, lostRepository) = try gitJob(lostID)
    var lostWork = FleetAgentWork(assignment: lostJob)
    lostWork.phase = "running"
    let lost = try await fleetAdvanceWork(lostWork, role: "air", persist: { _ in },
        finishRestarted: { await fleetFinishRestarted($0, role: "air",
            core: client(runs: f18Runs, statuses: FleetFixtureLog(), run: neverRun,
                         status: { _ in throw RCCRuntimeGatewayClient.Failure.rpcRejected }), jobs: jobs, device: device) },
        execute: { _ in throw OS1Error.message("a restart re-executed the job") })
    let lostResult = receiptJSON(lost.result ?? "") as? [String: String]
    try check(lost.outcome == "failed" && lostResult?["core_admitted"] == "unknown" && lostResult?["agent_restarted"] == "true"
              && lostResult?["error"]?.contains("interrupted") == true && f18Runs.all.isEmpty
              && (try gitOK(["--git-dir", origin.path, "branch", "--list", "os1-fleet/" + lostID])).isEmpty,
              "F18b a restarted job Core never admitted was not reported interrupted and unknown")
    let untouched = try fleetPublishResult(jobID: lostID, workspace: lostRepository.path, baseRevision: base)
    try check(untouched.0 == nil && untouched.1 == nil, "F18b a checkout still at its assigned revision published a result")
    try gitOK(["-C", lostRepository.path, "switch", "--quiet", "--orphan", "unrelated"])
    try Data("unrelated\n".utf8).write(to: lostRepository.appendingPathComponent("other.txt"))
    try gitOK(["-C", lostRepository.path, "add", "other.txt"])
    try gitOK(["-C", lostRepository.path, "commit", "--quiet", "-m", "unrelated history"])
    do {
        _ = try fleetPublishResult(jobID: lostID, workspace: lostRepository.path, baseRevision: base)
        try check(false, "F18b a checkout that left its assigned revision's history was published")
    } catch let error as OS1Error {
        try check(String(describing: error).contains("not a descendant of its assigned revision")
                  && (try gitOK(["--git-dir", origin.path, "branch", "--list", "os1-fleet/" + lostID])).isEmpty,
                  "F18b an unrelated checkout was refused without naming why: \(error)")
    }

    // F18c: a claimed job persists its start and result contract BEFORE it
    // runs; Core's non-answer is carried verbatim; a restart of that record
    // keeps contract v2, so Core's partial stays a partial, not a breach.
    let heldID = "a1b2c3d4-0000-4000-8000-000000000003"
    let (heldJob, heldRepository) = try gitJob(heldID)
    let heldPartialCore = retargeted(try snapshot(.held, output: "node_0: done", error: "verified_not_dispatched_retry_exhausted",
        children: [nativeChild("node_0", state: .completed), nativeChild("node_1", state: .failed)], partial: partial), as: heldID)
    let heldClient = client(runs: FleetFixtureLog(), statuses: FleetFixtureLog(),
        run: { _ in fleetRunSummary(heldPartialCore, prompt: prompt, jobID: heldID, startedAt: clock.now) },
        status: { _ in heldPartialCore })
    var persisted: [FleetAgentWork] = []
    var seenAtExecution: FleetAgentWork?
    let held = try await fleetAdvanceWork(FleetAgentWork(assignment: heldJob), role: "air", now: { 1_800_000_000_000 },
        persist: { persisted.append($0) }, finishRestarted: { _ in ("failed", "") },
        execute: { job in
            seenAtExecution = persisted.last
            return try await executeFleetAssignment(job, role: "air", config: nil, core: heldClient,
                                                    checkout: { _ in heldRepository.path }, device: device)
        })
    let expectedHeld = failure(fleetCoreDisposition(heldPartialCore, run: fleetRunSummary(heldPartialCore, prompt: prompt, jobID: heldID,
                                                                                          startedAt: clock.now),
                                                    jobID: heldID, resultContractVersion: 2))
    try check(seenAtExecution?.phase == "running" && seenAtExecution?.startedAtMs == 1_800_000_000_000
              && seenAtExecution?.resultContractVersion == RCCRunBudgetOptions.appResultContractVersion
              && persisted.map(\.phase) == ["running", "delivery_pending"] && held.outcome == "failed"
              && (receiptJSON(held.result ?? "") as? [String: String]) == expectedHeld
              && expectedHeld?["partial_answer"] == "node_0: done" && expectedHeld?["core_state"] == "held",
              "F18c a claimed job did not persist its start and contract first, or lost Core's non-answer")
    let reconciled = await fleetFinishRestarted(seenAtExecution ?? FleetAgentWork(assignment: heldJob), role: "air", core: heldClient,
                                                jobs: jobs, device: device)
    var preContractRecord = seenAtExecution ?? FleetAgentWork(assignment: heldJob)
    preContractRecord.resultContractVersion = nil
    let legacyReconciled = await fleetFinishRestarted(preContractRecord, role: "air", core: heldClient, jobs: jobs, device: device)
    try check((receiptJSON(reconciled.result) as? [String: String])?["partial_answer"] == "node_0: done"
              && (receiptJSON(legacyReconciled.result) as? [String: String])?["core_result_contract_breach"] == "true",
              "F18c a restart lost the persisted result contract of the job it reconciles")

    // F18d: a delivered writer answer publishes its change from the job's
    // checkout; a generic execution error is bounded and carried.
    let writerID = "b2c3d4e5-0000-4000-8000-000000000004"
    let (writerJob, writerRepository) = try gitJob(writerID)
    let writerCore = retargeted(unverifiedCore, as: writerID)
    let writerClient = client(runs: FleetFixtureLog(), statuses: FleetFixtureLog(), run: { _ in
        try Data("written by Core\n".utf8).write(to: writerRepository.appendingPathComponent("file.txt"))
        return fleetRunSummary(writerCore, prompt: prompt, jobID: writerID, startedAt: clock.now)
    }, status: { _ in writerCore })
    let writer = try await fleetAdvanceWork(FleetAgentWork(assignment: writerJob), role: "air", persist: { _ in },
        finishRestarted: { _ in ("failed", "") },
        execute: { try await executeFleetAssignment($0, role: "air", config: nil, core: writerClient,
                                                    checkout: { _ in writerRepository.path }, device: device) })
    let writerReceipt = try JSONDecoder().decode(FleetExecutionReceipt.self, from: Data((writer.result ?? "").utf8))
    try check(writer.outcome == "complete" && writerReceipt.resultBranch == "os1-fleet/" + writerID
              && writerReceipt.resultCommit == (try gitOK(["--git-dir", origin.path, "rev-parse", "refs/heads/os1-fleet/" + writerID]))
              && fleetResultStatusIsValid(writerReceipt.run, profile: "claude", core: writerReceipt.core),
              "F18d a delivered writer answer was not published from its checkout")
    let crashed = try await fleetAdvanceWork(FleetAgentWork(assignment: writerJob), role: "air", persist: { _ in },
        finishRestarted: { _ in ("failed", "") },
        execute: { _ in throw OS1Error.message(String(repeating: "\"/\\ host failure ", count: 9_000)) })
    try check(crashed.outcome == "failed" && sendable(crashed.result ?? "", outcome: "failed")
              && (receiptJSON(crashed.result ?? "") as? [String: String])?["job_id"] == writerID,
              "F18d a generic execution error overflowed the complete request or lost its job")

    // The hook tells the waiting session what an unverified answer and a
    // job that never ran mean, so neither is redone or presented as
    // verified, and where Core's task can be read: only on the executor Mac.
    let hookReceipt = FleetEnqueueReceipt(jobID: jobID, profile: "claude", executionMode: "single_node",
        executorDeviceID: "device:fixture-air", objectiveVersion: "os1-fleet-objective-v1")
    let hookText = automaticFleetContext(receipt: hookReceipt, executable: "/usr/local/bin/os1", localDeviceID: "device:fixture-air")
    let remoteHookText = automaticFleetContext(receipt: hookReceipt, executable: "/usr/local/bin/os1", localDeviceID: "device:fixture-pro")
    for text in [hookText, remoteHookText] {
        try check(text.contains("core.label") && text.contains("unverified") && text.contains("do not repeat the task")
                  && text.contains("model_dispatched") && text.contains("core_admitted") && text.contains("rcc-task-status")
                  && text.contains("partial_answer") && text.contains("core.quality_disclosure"), "the hook does not explain Core receipts")
    }
    try check(hookText.contains("'/usr/local/bin/os1' rcc-task-status --task-id") && !hookText.contains("exist only there")
              && remoteHookText.contains("exist only there") && remoteHookText.contains("on the executor Mac")
              && !remoteHookText.contains("'/usr/local/bin/os1' rcc-task-status"),
              "the hook sends a session to read Core's task on a Mac that does not have it")
    try check(fleetObserveCommand(taskID: jobID, requestSHA256: hash, executable: "/Applications/OS 1.app/os1")
                == "'/Applications/OS 1.app/os1' rcc-task-status --task-id \(jobID) --request-sha256 \(hash)",
              "observe_command does not name the executor's own binary")
    print("OS-1 Fleet Core self-test: \(checks) checks OK; Core state mapping, unverified/partial labels, compact signed receipts, anti-laundering, transport codes, restart reconciliation without resubmission, archive phase, label parity, request-size bound, R6 disclosure, agent job state machine and restart publication")
}
