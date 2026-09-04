import CryptoKit
import Darwin
import Foundation

private let fleetProfiles = ["codex", "claude", "os1", "build", "test", "exo"]

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

private struct FleetJobStatus: Decodable {
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
    let ifconfig = try commandOutput("/sbin/ifconfig", [], timeout: 10)
    guard ifconfig.0 == 0 else { throw OS1Error.message("ZeroTier interface inspection failed") }
    let tokens = String(decoding: ifconfig.1, as: UTF8.self).split { $0.isWhitespace }.map(String.init)
    guard let address = tokens.first(where: { value in
        let parts = value.split(separator: ".")
        return parts.count == 4 && value.hasPrefix("10.215.90.")
    }) else { throw OS1Error.message("OS-1 ZeroTier address is unavailable") }
    return address
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
    let raw = config.exoAPIURL ?? "http://127.0.0.1:52415"
    guard let base = URL(string: raw) else { return 0 }
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
        hasCodex: (try? findExecutable("codex")) != nil,
        hasClaude: (try? findExecutable("claude")) != nil,
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

private func fleetClaim(client: APIClient, key: SigningKey) async throws -> FleetAssignment? {
    let now = fleetNowMs()
    let nonce = try randomNonce()
    let signature = Base64URL.encode(try key.sign(claimBytes(deviceID: client.deviceID, sentAtMs: now, nonce: nonce)))
    let response: FleetClaimResponse = try await client.post(
        "/v1/fleet/claim",
        body: FleetClaimRequest(sentAtMs: now, nonce: nonce, signature: signature),
        as: FleetClaimResponse.self
    )
    guard response.status == "idle" || response.status == "claimed" else {
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
    let root = repository.standardizedFileURL.path + "/"
    let path = workspace.standardizedFileURL.path
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

private func executeFleetClaude(
    assignment: FleetAssignment,
    workspace: String,
    config: RuntimeConfig
) throws -> RunSummary {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let ticket = Ticket(
        executionID: assignment.jobID,
        sequence: 1,
        provider: "claude",
        action: "cl_sonnet_medium",
        permissionProfile: "workspace_write",
        expiresAt: formatter.string(from: Date().addingTimeInterval(3_600)),
        nonce: Base64URL.encode(Data(repeating: 0, count: 32)),
        signature: Base64URL.encode(Data(repeating: 0, count: 64))
    )
    let execution = try execute(
        ticket: ticket,
        prompt: assignment.task,
        workspace: workspace,
        timeout: config.executionTimeoutSeconds,
        providerSessionID: nil,
        model: "sonnet",
        effort: "medium",
        executorContract: config.executorContract,
        desktopReveal: .never,
        workspaceBeforeHash: workspaceHash(workspace),
        claudeSafeMode: true
    )
    let artifact = execution.artifact
    return RunSummary(status: "complete", steps: [RunStepSummary(
        sequence: 1,
        provider: artifact.provider,
        action: artifact.action,
        model: artifact.model,
        effort: artifact.effort,
        revasDisposition: "fleet_device_verified",
        sessionID: execution.sessionID,
        permissionProfile: artifact.permissionProfile,
        exitCode: artifact.exitCode,
        output: artifact.output,
        stderr: artifact.stderr,
        durationMS: artifact.durationMS,
        nativeRecord: execution.nativeRecord
    )])
}

private func executeFleetCodex(
    assignment: FleetAssignment,
    prompt: String,
    workspace: String,
    config: RuntimeConfig
) throws -> RunSummary {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let ticket = Ticket(
        executionID: assignment.jobID,
        sequence: 1,
        provider: "codex",
        action: "cx_56luna_low",
        permissionProfile: "workspace_write",
        expiresAt: formatter.string(from: Date().addingTimeInterval(3_600)),
        nonce: Base64URL.encode(Data(repeating: 0, count: 32)),
        signature: Base64URL.encode(Data(repeating: 0, count: 64))
    )
    let execution = try execute(
        ticket: ticket,
        prompt: prompt,
        workspace: workspace,
        timeout: config.executionTimeoutSeconds,
        providerSessionID: nil,
        model: "gpt-5.6-luna",
        effort: "low",
        executorContract: config.executorContract,
        desktopReveal: .never,
        workspaceBeforeHash: workspaceHash(workspace)
    )
    let artifact = execution.artifact
    return RunSummary(status: "complete", steps: [RunStepSummary(
        sequence: 1,
        provider: artifact.provider,
        action: artifact.action,
        model: artifact.model,
        effort: artifact.effort,
        revasDisposition: "fleet_device_verified",
        sessionID: execution.sessionID,
        permissionProfile: artifact.permissionProfile,
        exitCode: artifact.exitCode,
        output: artifact.output,
        stderr: artifact.stderr,
        durationMS: artifact.durationMS,
        nativeRecord: execution.nativeRecord
    )])
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
        run = RunSummary(status: "complete", steps: [RunStepSummary(
            sequence: 1,
            provider: "local",
            action: "exo_distributed_inference",
            model: config.exoModelID ?? "mlx-community/Qwen3-0.6B-4bit",
            effort: "none",
            revasDisposition: "adopted",
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
        if assignment.profile == "claude" {
            run = try executeFleetClaude(assignment: assignment, workspace: workspace, config: config)
        } else {
            run = try executeFleetCodex(
                assignment: assignment,
                prompt: prompt,
                workspace: workspace,
                config: config
            )
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
    let response: [String: String] = try await client.post("/v1/fleet/complete", body: request, as: [String: String].self)
    guard response["status"] == "stored" else { throw OS1Error.message("Fleet result was not stored") }
}

func runFleetAgent(role: String, once: Bool) async throws {
    let config = try RuntimeConfig.load()
    let key = try SigningKey.loadOrCreate()
    let client = APIClient(config: config, token: try githubToken(), deviceID: try deviceID())
    try await register(client: client, key: key)
    repeat {
        do {
            let node = try await sendFleetHeartbeat(client: client, key: key, role: role)
            if let assignment = try await fleetClaim(client: client, key: key) {
                do {
                    let result = try await executeFleetAssignment(assignment, role: role, config: config)
                    try await completeFleetJob(client: client, key: key, assignment: assignment, outcome: "complete", result: result)
                } catch {
                    let result = String(decoding: try JSONEncoder().encode([
                        "error": String(String(describing: error).prefix(8_000)),
                    ]), as: UTF8.self)
                    try await completeFleetJob(client: client, key: key, assignment: assignment, outcome: "failed", result: result)
                }
            }
            if once {
                print("OS-1 fleet agent: OK (\(role), \(node.zeroTierIP), EXO nodes \(node.exoNodes))")
                return
            }
        } catch {
            if once { throw error }
            fputs("OS-1 fleet agent retry: \(error)\n", stderr)
        }
        try await Task.sleep(for: .seconds(5))
    } while true
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
    var normalized = remoteText
        .replacingOccurrences(of: "git@github.com:", with: "")
        .replacingOccurrences(of: "https://github.com/", with: "")
        .replacingOccurrences(of: "ssh://git@github.com/", with: "")
        .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    if normalized.hasSuffix(".git") {
        normalized.removeLast(4)
    }
    guard normalized.split(separator: "/").count == 2 else { throw OS1Error.message("Fleet requires a GitHub origin") }
    let rootURL = URL(fileURLWithPath: root).standardizedFileURL
    let workspaceURL = URL(fileURLWithPath: workspace).standardizedFileURL
    let relative = workspaceURL.path == rootURL.path ? "" : String(workspaceURL.path.dropFirst(rootURL.path.count + 1))
    return (normalized, String(decoding: revision.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines), relative)
}

func submitFleetTask(
    workspace: String,
    prompt: String,
    profile: String,
    minMemoryMiB: Int,
    cpuWeight: Int,
    preferDeviceID: String?
) async throws {
    guard fleetProfiles.contains(profile), (0...100).contains(cpuWeight), minMemoryMiB >= 0 else {
        throw OS1Error.message("Fleet task requirements are invalid")
    }
    let config = try RuntimeConfig.load()
    let key = try SigningKey.loadOrCreate()
    let id = try deviceID()
    let client = APIClient(config: config, token: try githubToken(), deviceID: id)
    try await register(client: client, key: key)
    let role = ProcessInfo.processInfo.hostName.lowercased().contains("air") ? "air" : "pro"
    _ = try await sendFleetHeartbeat(client: client, key: key, role: role)
    let identity = try fleetWorkspaceIdentity(workspace)
    let now = fleetNowMs()
    let nonce = try randomNonce()
    var request = FleetSubmitRequest(
        profile: profile, task: prompt, workspaceRepository: identity.0,
        workspaceRevision: identity.1, workspaceSubpath: identity.2,
        requirements: FleetRequirements(minMemoryMiB: minMemoryMiB, cpuWeight: cpuWeight, preferDeviceID: preferDeviceID),
        submittedAtMs: now, nonce: nonce, signature: ""
    )
    request = FleetSubmitRequest(
        profile: request.profile, task: request.task, workspaceRepository: request.workspaceRepository,
        workspaceRevision: request.workspaceRevision, workspaceSubpath: request.workspaceSubpath,
        requirements: request.requirements, submittedAtMs: request.submittedAtMs, nonce: request.nonce,
        signature: Base64URL.encode(try key.sign(submitBytes(deviceID: id, request: request)))
    )
    let submitted: FleetSubmitResponse = try await client.post("/v1/fleet/submit", body: request, as: FleetSubmitResponse.self)
    guard submitted.status == "queued", let assignment = submitted.assignment else {
        throw OS1Error.message("No eligible OS-1 fleet node is online")
    }
    print("OS-1 fleet job \(assignment.jobID): \(assignment.executionMode) on \(assignment.executorDeviceID)")
    let deadline = Date().addingTimeInterval(3_600)
    while Date() < deadline {
        try await Task.sleep(for: .seconds(2))
        let statusAt = fleetNowMs()
        let statusNonce = try randomNonce()
        let signature = Base64URL.encode(try key.sign(statusBytes(
            deviceID: id, jobID: assignment.jobID, sentAtMs: statusAt, nonce: statusNonce
        )))
        let status: FleetJobStatus = try await client.post(
            "/v1/fleet/status",
            body: FleetStatusRequest(jobID: assignment.jobID, sentAtMs: statusAt, nonce: statusNonce, signature: signature),
            as: FleetJobStatus.self
        )
        if status.state == "complete" {
            print(status.result ?? "")
            return
        }
        if status.state == "failed" || status.state == "expired" {
            throw OS1Error.message("Fleet job \(status.state): \(status.result ?? "no result")")
        }
    }
    throw OS1Error.message("Fleet job timed out")
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

func configureFleetAgent(role requestedRole: String) throws {
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
        "ThrottleInterval": 5,
        "StandardOutPath": logDirectory.appendingPathComponent("agent.log").path,
        "StandardErrorPath": logDirectory.appendingPathComponent("agent.log").path,
        "ProcessType": "Background",
        "EnvironmentVariables": [
            "OS1_CONFIG": home.appendingPathComponent(".local/lib/os1/config.json").path,
            "PATH": "\(home.path)/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        ],
    ]
    let data = try PropertyListSerialization.data(fromPropertyList: object, format: .xml, options: 0)
    try data.write(to: plist, options: .atomic)
    let launchctl = "/bin/launchctl"
    _ = try? commandOutput(launchctl, ["bootout", "gui/\(getuid())/\(label)"], timeout: 20)
    let bootstrapped = try commandOutput(launchctl, ["bootstrap", "gui/\(getuid())", plist.path], timeout: 20)
    guard bootstrapped.0 == 0 else { throw OS1Error.message("Fleet LaunchAgent installation failed") }
    let kicked = try commandOutput(launchctl, ["kickstart", "-k", "gui/\(getuid())/\(label)"], timeout: 20)
    guard kicked.0 == 0 else { throw OS1Error.message("Fleet LaunchAgent start failed") }
    print("OS-1 fleet agent installed (\(role))")
}
