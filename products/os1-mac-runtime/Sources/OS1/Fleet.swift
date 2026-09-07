import CryptoKit
import CoreFoundation
import Darwin
import Foundation
import OS1Context
import OS1HookSupport

private let fleetProfiles = ["codex", "claude", "os1", "build", "test", "exo"]
let fleetAgentCycleInterval: Duration = .seconds(20)
let fleetJobStatusInterval: Duration = .seconds(5)
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
    var schema = 1
    let jobID: String
    let nodeRole: String
    let deviceID: String
    let profile: String
    let repository: String
    let revision: String
    let resultBranch: String?
    let resultCommit: String?
    let run: RunSummary

    enum CodingKeys: String, CodingKey {
        case schema, profile, repository, revision, run
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

private func fleetHeartbeatNode(role: String, config: RuntimeConfig) async throws -> FleetNodeHeartbeat {
    guard role == "pro" || role == "air" else { throw OS1Error.message("Fleet role must be pro or air") }
    let exoNodes = await fleetEXONodes(config: config)
    return FleetNodeHeartbeat(
        role: role,
        hostname: ProcessInfo.processInfo.hostName,
        zeroTierIP: try fleetZeroTierIP(),
        cpuLogicalCount: max(1, ProcessInfo.processInfo.activeProcessorCount),
        loadAverageMilli: fleetLoadAverageMilli(),
        memoryTotalMiB: Int(ProcessInfo.processInfo.physicalMemory / 1_048_576),
        memoryAvailableMiB: fleetAvailableMemoryMiB(),
        queueDepth: 0,
        hasCodex: fleetProviderReady("codex"),
        hasClaude: fleetProviderReady("claude"),
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

private func fleetJobDirectory(_ jobID: String) throws -> URL {
    guard UUID(uuidString: jobID) != nil else { throw OS1Error.message("Fleet job identity rejected") }
    let directory = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".os1/fleet/jobs", isDirectory: true)
        .appendingPathComponent(jobID, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    return directory
}

private func fleetCheckout(_ assignment: FleetAssignment) throws -> String {
    let directory = try fleetJobDirectory(assignment.jobID)
    let repository = directory.appendingPathComponent("repository", isDirectory: true)
    let git = try findExecutable("git")
    if !FileManager.default.fileExists(atPath: repository.appendingPathComponent(".git").path) {
        let gh = try findExecutable("gh")
        let cloned = try commandOutput(gh, ["repo", "clone", assignment.workspaceRepository, repository.path, "--", "--filter=blob:none"], timeout: 600)
        guard cloned.0 == 0 else { throw OS1Error.message("Fleet repository clone failed") }
    }
    let fetched = try commandOutput(git, ["-C", repository.path, "fetch", "--no-tags", "origin", assignment.workspaceRevision], timeout: 600)
    guard fetched.0 == 0 else { throw OS1Error.message("Fleet revision fetch failed") }
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
    let git = try findExecutable("git")
    let repository = URL(fileURLWithPath: workspace).standardizedFileURL
    let rootResult = try commandOutput(git, ["-C", repository.path, "rev-parse", "--show-toplevel"], timeout: 20)
    guard rootResult.0 == 0 else { throw OS1Error.message("Fleet repository root unavailable") }
    let root = String(decoding: rootResult.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    let changed = try commandOutput(git, ["-C", root, "status", "--porcelain=v1"], timeout: 30)
    guard changed.0 == 0 else { throw OS1Error.message("Fleet result inspection failed") }
    guard !changed.1.isEmpty else { return (nil, nil) }
    let branch = "os1-fleet/\(assignment.jobID.lowercased())"
    guard try commandOutput(git, ["-C", root, "switch", "-c", branch], timeout: 30).0 == 0,
          try commandOutput(git, ["-C", root, "add", "-A"], timeout: 30).0 == 0,
          try commandOutput(git, ["-C", root, "commit", "-m", "OS-1 fleet result \(assignment.jobID)"], timeout: 120).0 == 0,
          try commandOutput(git, ["-C", root, "push", "origin", "HEAD:refs/heads/\(branch)"], timeout: 600).0 == 0 else {
        throw OS1Error.message("Fleet result publication failed")
    }
    let revision = try commandOutput(git, ["-C", root, "rev-parse", "HEAD"], timeout: 20)
    guard revision.0 == 0 else { throw OS1Error.message("Fleet result revision unavailable") }
    return (branch, String(decoding: revision.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines))
}


private func executeFleetAssignment(_ assignment: FleetAssignment, role: String, config: RuntimeConfig) async throws -> String {
    guard fleetProfiles.contains(assignment.profile), assignment.objectiveVersion == "os1-fleet-objective-v1" else {
        throw OS1Error.message("Fleet assignment contract rejected")
    }
    let run: RunSummary
    let published: (String?, String?)
    if assignment.profile == "exo" {
        guard assignment.executionMode == "distributed_exo" else {
            throw OS1Error.message("EXO fleet work was not assigned as distributed inference")
        }
        let inference = try await executeEXO(prompt: assignment.task, config: config)
        run = RunSummary(status: "candidate", steps: [RunStepSummary(
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
        published = (nil, nil)
    } else {
        let workspace = try fleetCheckout(assignment)
        let prompt: String
        switch assignment.profile {
        case "build": prompt = "Build the repository as requested and verify the build.\n\n\(assignment.task)"
        case "test": prompt = "Run and verify the requested repository tests.\n\n\(assignment.task)"
        default: prompt = assignment.task
        }
        run = try await runTask(
            prompt: prompt, workspace: workspace,
            providerPreference: ["codex", "claude"].contains(assignment.profile) ? assignment.profile : "auto",
            context: nil, codexSessionID: nil, claudeSessionID: nil,
            codexCapacity: 100, claudeCapacity: 100, progress: false, desktopReveal: .never
        )
        guard run.status == "complete", !run.steps.isEmpty, run.steps.allSatisfy({ $0.exitCode == 0 }) else {
            throw OS1Error.message("Fleet governed execution has not completed")
        }
        published = try fleetCommitResult(assignment, workspace: workspace)
    }
    let receipt = FleetExecutionReceipt(
        jobID: assignment.jobID,
        nodeRole: role,
        deviceID: try deviceID(),
        profile: assignment.profile,
        repository: assignment.workspaceRepository,
        revision: assignment.workspaceRevision,
        resultBranch: published.0,
        resultCommit: published.1,
        run: run
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    let data = try encoder.encode(receipt)
    guard data.count <= 65_536 else { throw OS1Error.message("Fleet result exceeds the signed result limit") }
    return String(decoding: data, as: UTF8.self)
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
    var initialHeartbeat: FleetNodeHeartbeat?
    var heartbeatPublisher: Task<Void, Never>?
    defer { heartbeatPublisher?.cancel() }
    repeat {
        do {
            if !registered {
                try await register(client: client, key: key)
                initialHeartbeat = try await sendFleetHeartbeat(client: client, key: key, role: role)
                registered = true
                if !once {
                    // Liveness must not wait for result mirroring, claim, Git,
                    // native execution, publication or delivery retries.
                    heartbeatPublisher = Task.detached { await fleetHeartbeatService(role: role) }
                }
            }
            try? await refreshFleetResultCache(client: client, key: key)
            var active: FleetAgentWork?
            if FileManager.default.fileExists(atPath: activeFile.path) {
                active = try JSONDecoder().decode(FleetAgentWork.self, from: Data(contentsOf: activeFile))
            } else {
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
                if work.phase == "running" {
                    // A process crash is not permission to repeat external writes.
                    throw OS1Error.message("Fleet job \(work.assignment.jobID) was interrupted; native execution reconciliation is required. Preserved state prevents duplicate execution.")
                }
                if work.phase == "claimed" {
                    guard work.assignment.expiresAtMs > fleetNowMs() else {
                        throw OS1Error.message("Fleet assignment expired before execution; preserved for reconciliation")
                    }
                    work.phase = "running"
                    try fleetPersist(work, at: activeFile)
                    do {
                        work.result = try await executeFleetAssignment(work.assignment, role: role, config: config)
                        work.outcome = "complete"
                    } catch {
                        work.result = String(decoding: try JSONEncoder().encode([
                            "error": String(String(describing: error).prefix(8_000)),
                            "job_id": work.assignment.jobID,
                            "partial_work": "Inspect this job's native records and checkout before resuming remaining work.",
                        ]), as: UTF8.self)
                        work.outcome = "failed"
                    }
                    work.phase = "delivery_pending"
                    try fleetPersist(work, at: activeFile)
                }
                guard work.phase == "delivery_pending", let result = work.result, let outcome = work.outcome else {
                    throw OS1Error.message("Fleet result outbox is invalid; preserved without re-execution")
                }
                try await completeFleetJob(client: client, key: key, assignment: work.assignment, outcome: outcome, result: result)
                try? await refreshFleetResultCache(client: client, key: key)
                try fleetPersist(work, at: fleetJobDirectory(work.assignment.jobID).appendingPathComponent("fleet-result.json"))
                try FileManager.default.removeItem(at: activeFile)
            }
            if once {
                guard let node = initialHeartbeat else { throw OS1Error.message("Fleet heartbeat was not published") }
                print("OS-1 fleet agent: OK (\(role), \(node.zeroTierIP), EXO nodes \(node.exoNodes))")
                return
            }
        } catch {
            if once { throw error }
            fputs("OS-1 fleet agent retry: \(error)\n", stderr)
        }
        try await Task.sleep(for: fleetAgentCycleInterval)
    } while true
}

private struct FleetAgentWork: Codable {
    let assignment: FleetAssignment
    var phase = "claimed"
    var outcome: String? = nil
    var result: String? = nil
}

private func fleetHeartbeatService(role: String) async {
    await runFleetHeartbeatPublisher(interval: .seconds(10)) {
        let client = APIClient(config: try RuntimeConfig.load(), token: try githubToken(), deviceID: try deviceID(), requestTimeoutSeconds: 10)
        _ = try await sendFleetHeartbeat(client: client, key: SigningKey.loadOrCreate(), role: role)
        // No result mirroring here: slow status calls must not delay liveness.
    }
}

private func runFleetHeartbeatPublisher(interval: Duration,
                                       publish: @Sendable () async throws -> Void) async {
    while !Task.isCancelled {
        do {
            try await Task.sleep(for: interval)
            try Task.checkCancellation()
            try await publish()
        } catch is CancellationError { return }
        catch { if !Task.isCancelled { fputs("OS-1 Fleet heartbeat temporarily unavailable\n", stderr) } }
    }
}

private actor FleetHeartbeatTestCounter {
    var count = 0
    func tick() { count += 1 }
}

func fleetHeartbeatSelfTest() async throws {
    let counter = FleetHeartbeatTestCounter()
    let publisher = Task.detached {
        await runFleetHeartbeatPublisher(interval: .milliseconds(20)) { await counter.tick() }
    }
    // Represents a slow claim/result/checkout path. It must not own the clock.
    try await Task.sleep(for: .milliseconds(200))
    let duringSlowWork = await counter.count
    publisher.cancel()
    _ = await publisher.result
    let stopped = await counter.count
    try await Task.sleep(for: .milliseconds(60))
    guard duringSlowWork >= 3, await counter.count == stopped else {
        throw OS1Error.message("Fleet heartbeat publisher stalled behind work or ignored cancellation")
    }
    print("OS1 Fleet heartbeat: 2 checks PASS; slow work does not block publisher, cancellation stops it")
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
        case .noCapacity: return "No eligible OS-1 fleet node is online; no remote job was created"
        case .pending(let id): return "Fleet submission delivery is uncertain; recover with fleet-resume-submit --intent \(id). Do not submit duplicate work."
        }
    }
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
    while Date() < deadline {
        try await Task.sleep(for: fleetJobStatusInterval)
        let statusAt = fleetNowMs()
        let statusNonce = try randomNonce()
        let signature = Base64URL.encode(try key.sign(statusBytes(
            deviceID: id, jobID: jobID, sentAtMs: statusAt, nonce: statusNonce
        )))
        let status: FleetJobStatus = try await client.post(
            "/v1/fleet/status",
            body: FleetStatusRequest(jobID: jobID, sentAtMs: statusAt, nonce: statusNonce, signature: signature),
            as: FleetJobStatus.self
        )
        guard status.jobID.lowercased() == jobID.lowercased() else {
            throw OS1Error.message("Fleet result job identity mismatch")
        }
        if let result = try fleetValidatedResult(status, jobID: jobID) { return result }
    }
    throw OS1Error.message("Fleet wait ended; job may still be running. Resume fleet-wait with the same job ID; do not submit duplicate work.")
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
                  receipt.profile == status.profile, fleetResultStatusIsValid(receipt.run, profile: receipt.profile) else {
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

private func readPrivateFleetCache(at target: URL) throws -> Data {
    let attributes = try FileManager.default.attributesOfItem(atPath: target.path)
    guard attributes[.type] as? FileAttributeType == .typeRegular,
          (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
          (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600,
          (attributes[.size] as? NSNumber)?.intValue ?? Int.max <= 4_000_000 else {
        throw OS1Error.message("Fleet result cache ownership or permissions rejected")
    }
    return try Data(contentsOf: target)
}

private func readFleetCachedResult(at target: URL, jobID: String) throws -> String? {
    let status = try JSONDecoder().decode(FleetJobStatus.self, from: readPrivateFleetCache(at: target))
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

// The v1 Fleet wire transports a clean Git revision and bounded text, not local
// source receipts or native sessions. Preserve those locally rather than drop
// them or pretend another Mac can resume an Air-local provider session.
func automaticAppFleetLocalReason(context: String?, requireReadOnly: Bool,
                                 promptBytes: Int, internalExecution: Bool,
                                 provider: String, codexCapacity: Int, claudeCapacity: Int) throws -> String? {
    if internalExecution { return "executor_recursion_guard" }
    if requireReadOnly { return "local_reconciliation_custody" }
    if try SessionHandoff.decode(context).source != nil { return "local_source_receipt_custody" }
    if promptBytes > 48_000 { return "context_exceeds_fleet_v1_limit" }
    if provider == "auto" && (codexCapacity != 100 || claudeCapacity != 100) {
        return "provider_capacity_constraints_not_in_fleet_v1"
    }
    return nil
}

private func appFleetRun(_ raw: String, receipt: FleetEnqueueReceipt,
                         repository: String, revision: String) throws -> RunSummary {
    let result = try JSONDecoder().decode(FleetExecutionReceipt.self, from: Data(raw.utf8))
    guard result.schema == 1, result.jobID == receipt.jobID, result.deviceID == receipt.executorDeviceID,
          result.profile == receipt.profile, result.repository == repository, result.revision == revision,
          receipt.objectiveVersion == "os1-fleet-objective-v1", receipt.executionMode == "single_node",
          fleetResultStatusIsValid(result.run, profile: receipt.profile), result.run.sourceContext == nil,
          result.run.steps.allSatisfy({
              ["codex", "claude"].contains($0.provider) &&
                  (receipt.profile == "os1" || $0.provider == receipt.profile) &&
                  $0.revasDisposition == "adopted" && $0.nativeRecord?.persistence == "verified" &&
                  UUID(uuidString: $0.sessionID) != nil
          }) else { throw OS1Error.message("OS1 app rejected mismatched or unverified Fleet result; no local re-execution") }
    var summary = result.run
    summary.fleet = FleetRunProvenance(executorDeviceID: result.deviceID, jobID: result.jobID,
                                      resultSHA256: sha256Hex(Data(raw.utf8)))
    return summary
}

func runTaskWithAutomaticFleet(prompt: String, workspace: String, providerPreference: String,
                               context: String?, codexSessionID: String?, claudeSessionID: String?,
                               codexCapacity: Int, claudeCapacity: Int, progress: Bool,
                               desktopReveal: DesktopRevealMode, requireReadOnly: Bool) async throws -> RunSummary {
    let submission = ProcessInfo.processInfo.environment["OS1_SUBMISSION_ID"]
    let intent: String? = try submission.flatMap { value in
        guard UUID(uuidString: value) != nil else { return nil }
        return sha256Hex(try JSONEncoder().encode(["os1-app-fleet-v1", try deviceID(), value]))
    }
    let existingIntent = try intent.map { FileManager.default.fileExists(atPath: try fleetIntentURL($0).path) } ?? false
    func local(_ reason: String) async throws -> RunSummary {
        guard !existingIntent else {
            throw OS1Error.message("This app submission has preserved Fleet custody; resume intent " +
                (intent ?? "") + ". A changed workspace/context must not trigger duplicate local execution.")
        }
        RuntimeActivity.emit(.preparing, publicText: "OS1 로컬 실행: " + reason)
        var summary = try await runTask(prompt: prompt, workspace: workspace, providerPreference: providerPreference,
            context: context, codexSessionID: codexSessionID, claudeSessionID: claudeSessionID,
            codexCapacity: codexCapacity, claudeCapacity: claudeCapacity, progress: progress,
            desktopReveal: desktopReveal, requireReadOnly: requireReadOnly)
        summary.fleet = FleetRunProvenance(executorDeviceID: try deviceID(), localReason: reason)
        return summary
    }
    let bypass = AutomaticFleetHookPolicy.shouldBypass(cwd: workspace,
        homeDirectory: FileManager.default.homeDirectoryForCurrentUser.path,
        environment: ProcessInfo.processInfo.environment)
    let handoff = try SessionHandoff.decode(context)
    let task = try providerPrompt(current: prompt, context: handoff.transcript.isEmpty ? nil : handoff.transcript)
    if let reason = try automaticAppFleetLocalReason(context: context, requireReadOnly: requireReadOnly,
        promptBytes: task.utf8.count, internalExecution: bypass, provider: providerPreference,
        codexCapacity: codexCapacity, claudeCapacity: claudeCapacity) {
        return try await local(reason)
    }
    if protectedRouteMaterialRequested(prompt, context: context) || protectedRouteMaterialInEvidence(task) {
        return try await local("protected_input_boundary")
    }
    let identity: (String, String, String)
    do { identity = try fleetWorkspaceIdentity(workspace) }
    catch { return try await local("workspace_not_a_clean_transportable_git_revision") }
    guard let intent else {
        return try await local("missing_recoverable_app_submission_id")
    }
    let stateURL = try fleetIntentURL(intent).deletingLastPathComponent().appendingPathComponent(intent + ".app-result.json")
    let receipt: FleetEnqueueReceipt
    do {
        receipt = try await enqueueFleetTask(workspace: workspace, prompt: task,
            profile: providerPreference == "auto" ? "os1" : providerPreference,
            minMemoryMiB: AutomaticFleetHookPolicy.minimumMemoryMiB,
            cpuWeight: AutomaticFleetHookPolicy.cpuWeight, preferDeviceID: nil, intentID: intent)
    } catch FleetSubmissionError.noCapacity {
        // Server proved that it created no job. An uncertain delivery is NOT
        // caught here: its preserved intent must be resumed, never duplicated.
        return try await local("no_eligible_fleet_executor")
    }
    RuntimeActivity.emit(.executing, publicText: "Fleet " + receipt.executorDeviceID + " · " + receipt.jobID)
    let raw: String
    if FileManager.default.fileExists(atPath: stateURL.path) {
        raw = try JSONDecoder().decode(String.self, from: readPrivateFleetCache(at: stateURL))
    } else {
        do { raw = try await waitForFleetTask(jobID: receipt.jobID) }
        catch {
            throw OS1Error.message("Fleet job " + receipt.jobID + " remains in custody. " +
                "Inspect fleet-result with this job ID; no local task was re-executed. " + String(describing: error))
        }
        _ = try appFleetRun(raw, receipt: receipt, repository: identity.0, revision: identity.1)
        try fleetPersist(raw, at: stateURL)
    }
    return try appFleetRun(raw, receipt: receipt, repository: identity.0, revision: identity.1)
}

func automaticAppFleetSelfTest() throws {
    func reason(_ context: String? = nil, readOnly: Bool = false, bytes: Int = 20,
                internalRun: Bool = false, provider: String = "codex", cx: Int = 30, cl: Int = 100) throws -> String? {
        try automaticAppFleetLocalReason(context: context, requireReadOnly: readOnly, promptBytes: bytes,
            internalExecution: internalRun, provider: provider, codexCapacity: cx, claudeCapacity: cl)
    }
    guard try reason() == nil, try reason("prior transcript") == nil,
          try reason(readOnly: true) == "local_reconciliation_custody",
          try reason(bytes: 48_001) == "context_exceeds_fleet_v1_limit",
          try reason(internalRun: true) == "executor_recursion_guard",
          try reason(provider: "auto") == "provider_capacity_constraints_not_in_fleet_v1",
          try reason(provider: "auto", cx: 100) == nil else {
        throw OS1Error.message("App Fleet custody regression failed")
    }
    let wrong = FleetEnqueueReceipt(jobID: UUID().uuidString, profile: "codex", executionMode: "single_node",
        executorDeviceID: "device:fixture", objectiveVersion: "os1-fleet-objective-v1")
    guard (try? appFleetRun("{}", receipt: wrong, repository: "owner/repo", revision: String(repeating: "a", count: 40))) == nil else {
        throw OS1Error.message("App Fleet accepted an incomplete result")
    }
    let source = try SessionHandoff(transcript: "fixture", source: SourceReference(
        kind: .snapshot, id: UUID(), sha256: String(repeating: "a", count: 64))).encoded()
    guard try reason(source) == "local_source_receipt_custody" else {
        throw OS1Error.message("App Fleet discarded a local source receipt")
    }
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("os1-app-cache-test-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let cache = directory.appendingPathComponent("result.json"), link = directory.appendingPathComponent("link.json")
    try fleetPersist("fixture", at: cache)
    guard try JSONDecoder().decode(String.self, from: readPrivateFleetCache(at: cache)) == "fixture" else {
        throw OS1Error.message("App Fleet private cache roundtrip failed")
    }
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: cache)
    guard (try? readPrivateFleetCache(at: link)) == nil else {
        throw OS1Error.message("App Fleet accepted symlinked result cache")
    }
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: cache.path)
    guard (try? readPrivateFleetCache(at: cache)) == nil else {
        throw OS1Error.message("App Fleet accepted nonprivate result cache")
    }
    let fixtureStep = RunStepSummary(sequence: 1, provider: "codex", action: "agent_run", model: "fixture",
        effort: "low", revasDisposition: "adopted", sessionID: UUID().uuidString, permissionProfile: "read_only",
        exitCode: 0, output: "fixture", stderr: "", durationMS: 1,
        nativeRecord: NativeRecordEvidence(turnID: UUID().uuidString, recordPath: "/fixture", persistence: "verified", desktopVisibility: "not_revealed"))
    var fixture = FleetExecutionReceipt(jobID: wrong.jobID, nodeRole: "air", deviceID: wrong.executorDeviceID,
        profile: "codex", repository: "owner/repo", revision: String(repeating: "a", count: 40),
        resultBranch: nil, resultCommit: nil, run: RunSummary(status: "complete", steps: [fixtureStep]))
    func checked(_ value: FleetExecutionReceipt) throws -> RunSummary {
        try appFleetRun(String(decoding: JSONEncoder().encode(value), as: UTF8.self), receipt: wrong,
                        repository: "owner/repo", revision: String(repeating: "a", count: 40))
    }
    guard try checked(fixture).fleet?.jobID == wrong.jobID else {
        throw OS1Error.message("App Fleet rejected bound fixture")
    }
    fixture.schema = 99
    guard (try? checked(fixture)) == nil else {
        throw OS1Error.message("App Fleet accepted unknown receipt schema")
    }
    print("OS1 app Fleet: 14 checks PASS; continuity, limits, private cache, receipt schema and recursion")
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

func fleetResultStatusIsValid(_ run: RunSummary, profile: String) -> Bool {
    guard !run.steps.isEmpty, run.steps.allSatisfy({ $0.exitCode == 0 }) else { return false }
    if profile == "exo" {
        return run.status == "candidate" && run.steps.allSatisfy {
            $0.action == "exo_distributed_inference" && $0.revasDisposition == "unverified_candidate"
        }
    }
    return run.status == "complete" && run.steps.allSatisfy { $0.revasDisposition == "adopted" || $0.revasDisposition == "control_verified" }
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
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("os1-fleet-self-test-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: directory) }
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
    print("OS-1 Fleet self-test: \(checks) checks OK; config, EXO candidate, private read-only result validation and fair result polling")
}
