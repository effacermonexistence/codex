import CryptoKit
import Darwin
import Foundation
import OS1Context

/// Transport only. OpenClaw's RCC Runtime owns the task, scheduler, attempts,
/// cancellation and outcome. A lost RPC is reconciled by task ID, never replayed
/// through an alternate route. Gateway launch supervision is not task planning.
enum RCCRuntimeGatewayClient {
    struct InstalledIdentity: Sendable {
        let nodePath: String
        let nodeSHA256: String
        let entryPath: String
        let entrySHA256: String
        let pluginDirectory: String
        /// Includes the complete installed bridge, not just its registration file.
        let pluginFileSHA256: [String: String]
        let nativeOS1Path: String
        let nativeOS1SHA256: String
    }
    struct Configuration: Sendable {
        let identity: InstalledIdentity
        /// Trusted host-prepared local-only OpenClaw configuration. The client
        /// installs its own authenticated loopback gateway section.
        let baseConfig: Data
        let bridgeEnvironment: [String: String]
        init(identity: InstalledIdentity, baseConfig: Data, bridgeEnvironment: [String: String] = [:]) {
            self.identity = identity; self.baseConfig = baseConfig; self.bridgeEnvironment = bridgeEnvironment
        }
    }
    enum Failure: String, Error, Sendable {
        case invalidRequest = "rcc_runtime_invalid_request"
        case invalidConfiguration = "rcc_runtime_invalid_configuration"
        case identityMismatch = "rcc_runtime_installed_identity_changed"
        case privateStateInvalid = "rcc_runtime_private_state_invalid"
        case startupBusy = "rcc_runtime_gateway_startup_busy"
        case existingGatewayUnavailable = "rcc_runtime_existing_gateway_unavailable_preserved"
        case gatewayIdentityChanged = "rcc_runtime_live_gateway_identity_changed_preserved"
        case gatewayStartFailed = "rcc_runtime_gateway_start_failed"
        case gatewayNotReady = "rcc_runtime_gateway_not_ready"
        case rpcFailed = "rcc_runtime_rpc_failed"
        case rpcRejected = "rcc_runtime_rpc_rejected_no_state_reuse"
        case rpcTimeout = "rcc_runtime_rpc_timeout_outcome_unknown"
        case snapshotInvalid = "rcc_runtime_snapshot_invalid"
        case observationEnded = "rcc_runtime_observation_ended_task_preserved"
        case cancellationPending = "rcc_runtime_cancellation_pending_task_preserved"
        case upgradeNotQuiescent = "rcc_runtime_upgrade_has_active_work_preserved"
        case upgradeStopFailed = "rcc_runtime_upgrade_owner_stop_failed"
        case installerMaintenance = "rcc_runtime_installer_maintenance_request_preserved"
    }
    private final class Cancellation: @unchecked Sendable {
        private let lock = NSLock(); private var value = false
        func request() { lock.lock(); value = true; lock.unlock() }
        var requested: Bool { lock.lock(); defer { lock.unlock() }; return value }
    }
    private struct Paths {
        let root: URL
        var lock: URL { root.appendingPathComponent("transport-start.lock") }
        var metadata: URL { root.appendingPathComponent("transport-owner.json") }
        var startupIntent: URL { root.appendingPathComponent("transport-starting.json") }
        var instances: URL { root.appendingPathComponent("transport", isDirectory: true) }
        var state: URL { root.appendingPathComponent("openclaw-state", isDirectory: true) }
        var workspace: URL { root.appendingPathComponent("workspace", isDirectory: true) }
    }
    private struct Owner: Codable {
        let schema: Int
        let pid: Int32
        let startedAt: Double
        let executable: String
        let port: Int
        let identitySHA256: String
        let configurationSHA256: String
        let directory: String
        let configSHA256: String
    }
    private struct Snapshot {
        let data: Data
        let state: String
        let revision: Int
        // Observer delivery is not task completion. A staged installation
        // must release this CLI/UI observer so the existing installer can
        // drain; the original task remains durable in the same core.
        var deliverable: Bool { ["held", "completed", "returned_unverified", "awaiting_install", "cancelled", "effects_uncertain", "failed"].contains(state) }
    }
    /// Startup readiness is an independent transport budget. It does not
    /// shorten, extend, or otherwise change a model/task execution timeout.
    static let startupReadinessBudget: TimeInterval = 60
    /// The official CLI must load before its own RPC timeout starts. This is
    /// observer bootstrap allowance, not extra Gateway/model execution time.
    private static let readinessCLIBootstrapAllowance: TimeInterval = 15
    private struct Limits {
        var rpc: TimeInterval = 15
        var ready: TimeInterval = RCCRuntimeGatewayClient.startupReadinessBudget
        var poll: TimeInterval = 1
        var observe: TimeInterval = 86_520
    }
    private static let maximumResponseBytes = 8_388_608
    private static let maximumRequestBytes = 8_388_608
    private static let methodSet: Set<String> = ["health", "os1.rcc.submit", "os1.rcc.status", "os1.rcc.cancel", "os1.rcc.quiesce"]
    // Params are read privately and put in the official CLI's in-memory argv.
    // Neither request material nor the gateway token enters kernel argv.
    private static let rpcShim = """
    import fs from 'node:fs'; import {pathToFileURL} from 'node:url';
    const entry = process.env.OS1_RCC_RPC_ENTRY;
    const method = process.env.OS1_RCC_RPC_METHOD;
    const params = fs.readFileSync(process.env.OS1_RCC_RPC_PARAMS, 'utf8');
    process.argv = [process.execPath, entry, 'gateway', 'call', method, '--params', params,
      '--json', '--expect-url', process.env.OS1_RCC_RPC_URL, '--timeout', process.env.OS1_RCC_RPC_TIMEOUT];
    await import(pathToFileURL(entry).href);
    """

    struct ReadinessReceipt: Encodable, Sendable {
        let schema = 1
        let state = "ready"
        let ready = true
        let gatewayIdentityVerified = true
        let taskSubmitted = false
        let providerCalls = 0
        let ownerPID: Int32
        let startedAt: Double
        let identitySHA256: String
        let configurationSHA256: String
        let checkedAt: String
        enum CodingKeys: String, CodingKey {
            case schema, state, ready
            case gatewayIdentityVerified = "gateway_identity_verified"
            case taskSubmitted = "task_submitted"
            case providerCalls = "provider_calls"
            case ownerPID = "owner_pid"
            case startedAt = "started_at"
            case identitySHA256 = "identity_sha256"
            case configurationSHA256 = "configuration_sha256"
            case checkedAt = "checked_at"
        }
    }

    /// Health-only startup supervision of the same persistent owner. It
    /// creates no task, submits no prompt, and does not call a model/provider.
    /// Readiness is observed, not assumed merely because spawn succeeded.
    static func warm(configuration: Configuration) async throws -> ReadinessReceipt {
        let cancellation = Cancellation()
        return try await withTaskCancellationHandler {
            try await Task.detached(priority: .utility) {
                try warmBlocking(configuration: configuration,
                    root: FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/rcc-runtime"),
                    limits: Limits(), fixture: false, cancelled: { cancellation.requested })
            }.value
        } onCancel: { cancellation.request() }
    }

    static func warmForOfflineFixture(configuration: Configuration, root: URL,
                                      readinessTimeout: TimeInterval = 3) throws -> ReadinessReceipt {
        guard root.standardizedFileURL.path.hasPrefix(NSTemporaryDirectory()),
              readinessTimeout > 0, readinessTimeout <= startupReadinessBudget else { throw Failure.privateStateInvalid }
        return try warmBlocking(configuration: configuration, root: root,
            limits: Limits(rpc: 1, ready: readinessTimeout, poll: 0.03, observe: 5), fixture: true, cancelled: { false })
    }

    private static func warmBlocking(configuration: Configuration, root: URL, limits: Limits,
                                     fixture: Bool, cancelled: () -> Bool) throws -> ReadinessReceipt {
        // Warmup cannot be used to race or bypass a verified installation.
        // The isolated fixture uses its own maintenance marker, never HOME.
        try checkInstallerMaintenance(root: root)
        let owner = try ensureGateway(configuration: configuration, paths: Paths(root: root),
            limits: limits, fixture: fixture, cancelled: cancelled)
        try checkInstallerMaintenance(root: root)
        return ReadinessReceipt(ownerPID: owner.pid, startedAt: owner.startedAt,
            identitySHA256: owner.identitySHA256, configurationSHA256: owner.configurationSHA256,
            checkedAt: ISO8601DateFormatter().string(from: Date()))
    }

    static func run(request: Data, configuration: Configuration,
                    progress: @escaping @Sendable (Data) -> Void = { _ in }) async throws -> Data {
        let cancellation = Cancellation()
        return try await withTaskCancellationHandler {
            try await Task.detached(priority: .utility) {
                try runBlocking(request: request, configuration: configuration,
                                root: FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/rcc-runtime"),
                                limits: Limits(), fixture: false, cancellation: { cancellation.requested || ExecutionCancellation.isCancelled }, progress: progress)
            }.value
        } onCancel: { cancellation.request() }
    }

    /// One observation of the existing task, never another submission. The
    /// post-install runtime may supervise its persistent Gateway, but it may
    /// not replay the staged task or call a provider to recreate its result.
    static func status(taskID: String, requestSHA256: String, configuration: Configuration) async throws -> Data {
        try await Task.detached(priority: .utility) {
            try queryExisting(taskID: taskID, requestSHA256: requestSHA256, cancelling: false,
                configuration: configuration,
                root: FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/rcc-runtime"),
                limits: Limits(), fixture: false)
        }.value
    }

    /// Cancellation remains an idempotent intent owned by the original core.
    /// A lost acknowledgement is reconciled by status, never by a new run.
    static func cancel(taskID: String, requestSHA256: String, configuration: Configuration) async throws -> Data {
        try await Task.detached(priority: .utility) {
            try queryExisting(taskID: taskID, requestSHA256: requestSHA256, cancelling: true,
                configuration: configuration,
                root: FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/rcc-runtime"),
                limits: Limits(), fixture: false)
        }.value
    }

    static func statusForOfflineFixture(taskID: String, requestSHA256: String,
                                       configuration: Configuration, root: URL, cancelling: Bool = false) throws -> Data {
        guard root.standardizedFileURL.path.hasPrefix(NSTemporaryDirectory()) else { throw Failure.privateStateInvalid }
        return try queryExisting(taskID: taskID, requestSHA256: requestSHA256, cancelling: cancelling,
            configuration: configuration, root: root, limits: Limits(rpc: 1, ready: 3, poll: 0.03, observe: 5), fixture: true)
    }

    private static func queryExisting(taskID: String, requestSHA256: String, cancelling: Bool,
                                      configuration: Configuration, root: URL,
                                      limits: Limits, fixture: Bool) throws -> Data {
        guard taskID.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil,
              requestSHA256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw Failure.invalidRequest }
        if !fixture { try checkInstallerMaintenance(root: root) }
        let paths = Paths(root: root)
        let owner = try ensureGateway(configuration: configuration, paths: paths, limits: limits,
                                      fixture: fixture, cancelled: { false })
        let query = try JSONSerialization.data(withJSONObject: ["schema": 1, "task_id": taskID], options: [.sortedKeys])
        if !fixture { try checkInstallerMaintenance(root: root) }
        if cancelling {
            do {
                let raw = try rpc("os1.rcc.cancel", parameters: query, owner: owner, configuration: configuration,
                                  paths: paths, timeout: limits.rpc, fixture: fixture)
                return try snapshot(raw, id: taskID, requestSHA256: requestSHA256, minimumRevision: 0).data
            } catch let error as Failure where error == .rpcRejected { throw error }
            catch { /* effects of the cancel intent are reconciled below */ }
        }
        let raw = try rpc("os1.rcc.status", parameters: query, owner: owner, configuration: configuration,
                          paths: paths, timeout: limits.rpc, fixture: fixture)
        return try snapshot(raw, id: taskID, requestSHA256: requestSHA256, minimumRevision: 0).data
    }

    struct UpgradeReceipt: Codable, Sendable {
        let schema: Int
        let hadGateway: Bool
        let requestID: String?
        let ownerPID: Int32?
        let queuedTasks: Int?
        let receiptPath: String?
    }

    /// Invoke from the CURRENT installed CLI before replacing any bytes.
    /// A staged/new CLI identity is deliberately not allowed to retire an old
    /// owner's authenticated configuration. This supervises process upgrade,
    /// never chooses, retries or cancels user work.
    static func quiesceForUpgrade(configuration: Configuration) async throws -> UpgradeReceipt {
        try await Task.detached(priority: .utility) {
            try quiesceBlocking(configuration: configuration,
                root: FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/rcc-runtime"),
                limits: Limits(), fixture: false)
        }.value
    }
    static func quiesceForOfflineFixture(configuration: Configuration, root: URL) throws -> UpgradeReceipt {
        guard root.standardizedFileURL.path.hasPrefix(NSTemporaryDirectory()) else { throw Failure.privateStateInvalid }
        return try quiesceBlocking(configuration: configuration, root: root,
            limits: Limits(rpc: 1, ready: 3, poll: 0.03, observe: 5), fixture: true)
    }

    private static func quiesceBlocking(configuration: Configuration, root: URL,
                                         limits: Limits, fixture: Bool) throws -> UpgradeReceipt {
        let paths = Paths(root: root)
        guard FileManager.default.fileExists(atPath: paths.metadata.path) else {
            // A crashed launch can leave an owned Gateway before PID metadata
            // was committed. Do not call that unresolved window "no gateway".
            guard !FileManager.default.fileExists(atPath: paths.startupIntent.path) else {
                throw Failure.existingGatewayUnavailable
            }
            return UpgradeReceipt(schema: 1, hadGateway: false, requestID: nil, ownerPID: nil, queuedTasks: nil, receiptPath: nil)
        }
        try verifyInstalled(configuration.identity)
        try checkPrivateDirectory(paths.root)
        let fd = open(paths.lock.path, O_RDWR | O_CREAT | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw Failure.privateStateInvalid }
        defer { _ = flock(fd, LOCK_UN); _ = close(fd) }
        try verifyPrivateDescriptor(fd)
        let deadline = Date().addingTimeInterval(limits.ready)
        while flock(fd, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EWOULDBLOCK, Date() < deadline else { throw Failure.startupBusy }
            Thread.sleep(forTimeInterval: 0.05)
        }
        let owner = try JSONDecoder().decode(Owner.self, from: readPrivate(paths.metadata, maximum: 16_384))
        try validateOwnerPath(owner, paths: paths)
        guard owner.identitySHA256 == (try identitySHA256(configuration.identity)),
              owner.configurationSHA256 == sha256(configuration.baseConfig +
                (try JSONSerialization.data(withJSONObject: configuration.bridgeEnvironment, options: [.sortedKeys]))) else {
            throw Failure.gatewayIdentityChanged
        }
        guard processMatches(owner, nodePath: configuration.identity.nodePath, fixture: fixture) else {
            // No signalling by stale/reused PID. Task reconciliation remains
            // the next core owner's job, not a fabricated quiescence assertion.
            return UpgradeReceipt(schema: 1, hadGateway: false, requestID: nil, ownerPID: nil, queuedTasks: nil, receiptPath: nil)
        }
        let requestID = UUID().uuidString.lowercased()
        let payload = try JSONSerialization.data(withJSONObject: ["schema": 1, "request_id": requestID], options: [.sortedKeys])
        let raw = try rpc("os1.rcc.quiesce", parameters: payload, owner: owner,
            configuration: configuration, paths: paths, timeout: limits.rpc, fixture: fixture)
        guard let value = try? JSONSerialization.jsonObject(with: raw) as? [String: Any],
              value["schema"] as? Int == 1, value["request_id"] as? String == requestID,
              value["owner_pid"] as? Int32 == owner.pid,
              value["active_dispatches"] as? Int == 0, value["safe_to_stop"] as? Bool == true,
              value["queued_preserved"] as? Bool == true,
              value["accepting_submissions"] as? Bool == false,
              let queued = value["queued_tasks"] as? Int, queued >= 0 else { throw Failure.upgradeNotQuiescent }
        let receipts = paths.root.appendingPathComponent("upgrade-receipts", isDirectory: true)
        try createPrivateDirectory(receipts)
        let receipt = receipts.appendingPathComponent("quiescence-" + requestID + ".json")
        let evidence: [String: Any] = ["schema": 1, "request_id": requestID,
            "owner_pid": owner.pid, "owner_started_at": owner.startedAt, "owner_executable": owner.executable,
            "identity_sha256": owner.identitySHA256, "configuration_sha256": owner.configurationSHA256,
            "quiescence_rpc_sha256": sha256(raw), "active_dispatches": 0, "queued_preserved": true,
            "queued_tasks": queued, "safe_to_stop": true,
            "observed_at": ISO8601DateFormatter().string(from: Date())]
        try writePrivate(try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys]), to: receipt)
        // Exact PID + creation time + executable binding before EVERY signal.
        // Authoritative core has paused admission and declared durable safety.
        if processMatches(owner, nodePath: configuration.identity.nodePath, fixture: fixture) {
            guard kill(owner.pid, SIGTERM) == 0 else { throw Failure.upgradeStopFailed }
        }
        let stopDeadline = Date().addingTimeInterval(fixture ? 2 : 10)
        while processMatches(owner, nodePath: configuration.identity.nodePath, fixture: fixture), Date() < stopDeadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        if processMatches(owner, nodePath: configuration.identity.nodePath, fixture: fixture) {
            guard kill(owner.pid, SIGKILL) == 0 else { throw Failure.upgradeStopFailed }
            let finalDeadline = Date().addingTimeInterval(2)
            while processMatches(owner, nodePath: configuration.identity.nodePath, fixture: fixture), Date() < finalDeadline {
                Thread.sleep(forTimeInterval: 0.05)
            }
        }
        guard !processMatches(owner, nodePath: configuration.identity.nodePath, fixture: fixture) else { throw Failure.upgradeStopFailed }
        // Retirement is explicit, archived, and bound to the exact metadata.
        // The next ensureGateway can start the new generation without deleting
        // the durable core database, queued requests, raw results or leases.
        let stopped = paths.root.appendingPathComponent("transport-owner-retired-" + requestID + ".json")
        try FileManager.default.moveItem(at: paths.metadata, to: stopped)
        try writePrivate(Data("verified owned gateway stopped; durable core state preserved\n".utf8),
                         to: receipts.appendingPathComponent("stopped-" + requestID + ".txt"))
        return UpgradeReceipt(schema: 1, hadGateway: true, requestID: requestID,
                              ownerPID: owner.pid, queuedTasks: queued, receiptPath: receipt.path)
    }

    /// Isolated fake-binary fixture only: no live home, provider, app or model.
    static func runForOfflineFixture(request: Data, configuration: Configuration, root: URL,
                                    cancelled: @escaping () -> Bool = { false },
                                    progress: @escaping (Data) -> Void = { _ in }) throws -> Data {
        guard root.standardizedFileURL.path.hasPrefix(NSTemporaryDirectory()),
              !root.standardizedFileURL.path.contains("/../") else { throw Failure.privateStateInvalid }
        return try runBlocking(request: request, configuration: configuration, root: root,
            limits: Limits(rpc: 1, ready: 3, poll: 0.03, observe: 5), fixture: true,
            cancellation: cancelled, progress: progress)
    }

    static func checkMaintenanceForOfflineFixture(root: URL) throws {
        guard root.standardizedFileURL.path.hasPrefix(NSTemporaryDirectory()) else { throw Failure.privateStateInvalid }
        try checkInstallerMaintenance(root: root)
    }

    private static func runBlocking(request: Data, configuration: Configuration, root: URL,
                                    limits: Limits, fixture: Bool,
                                    cancellation: () -> Bool, progress: (Data) -> Void) throws -> Data {
        let binding = try requestBinding(request)
        guard !cancellation() else { throw CancellationError() }
        let paths = Paths(root: root)
        if !fixture { try checkInstallerMaintenance(root: root) }
        let owner = try ensureGateway(configuration: configuration, paths: paths, limits: limits,
                                      fixture: fixture, cancelled: cancellation)
        let query = try JSONSerialization.data(withJSONObject: ["schema": 1, "task_id": binding.id], options: [.sortedKeys])
        var last: Snapshot?
        var sourceAcknowledged = false
        // The one and only submit. A timeout/invalid reply does NOT authorize a replay.
        if !fixture { try checkInstallerMaintenance(root: root) }
        do {
            let raw = try rpc("os1.rcc.submit", parameters: request, owner: owner,
                              configuration: configuration, paths: paths, timeout: limits.rpc, fixture: fixture)
            last = try snapshot(raw, id: binding.id, requestSHA256: binding.hash, minimumRevision: 0)
            // Core's positive submit acknowledgement attests admission of the
            // immutable WHOLE request (including source/policy fingerprint).
            // Status has no public source fields: never invent that evidence.
            sourceAcknowledged = binding.source != nil && binding.policy != nil
        } catch {
            // An authenticated negative acknowledgement is NOT ambiguous. In
            // particular an idempotency conflict must not return an older task
            // with the same request text but different source/policy context.
            guard recoverableObservation(error) else { throw error }
            // Submission may have been accepted before transport loss. Reconcile
            // the exact task; if this also fails, preserve all state and stop observing.
            let raw = try rpc("os1.rcc.status", parameters: query, owner: owner,
                              configuration: configuration, paths: paths, timeout: limits.rpc, fixture: fixture)
            last = try snapshot(raw, id: binding.id, requestSHA256: binding.hash, minimumRevision: 0)
        }
        var emittedRevision = -1
        let observationDeadline = Date().addingTimeInterval(min(limits.observe, binding.duration + 120))
        var cancellationSent = false
        var cancellationDeadline: Date?
        var observerRecoveries = 1 // whole-run budget, not one retry per poll
        func deadline() -> Date { min(observationDeadline, cancellationDeadline ?? observationDeadline) }
        func cancelOriginal(minimumRevision: Int) throws -> Snapshot? {
            guard !cancellationSent else { return nil }
            cancellationSent = true
            cancellationDeadline = Date().addingTimeInterval(min(15, limits.rpc + 2))
            do {
                let raw = try rpc("os1.rcc.cancel", parameters: query, owner: owner,
                    configuration: configuration, paths: paths, timeout: limits.rpc, fixture: fixture,
                    hardDeadline: deadline())
                return try snapshot(raw, id: binding.id, requestSHA256: binding.hash, minimumRevision: minimumRevision)
            } catch {
                guard recoverableObservation(error) else { throw error }
                return nil // only a status read may reconcile this intent
            }
        }
        func statusOnce(minimumRevision: Int, interruptible: Bool) throws -> Snapshot {
            let raw = try rpc("os1.rcc.status", parameters: query, owner: owner,
                configuration: configuration, paths: paths, timeout: limits.rpc, fixture: fixture,
                hardDeadline: deadline(), cancelled: { interruptible && cancellation() && !cancellationSent })
            return try snapshot(raw, id: binding.id, requestSHA256: binding.hash, minimumRevision: minimumRevision)
        }
        func reconcileCancellation(minimumRevision: Int) throws -> Snapshot {
            if let observed = try cancelOriginal(minimumRevision: minimumRevision) { return observed }
            return try statusOnce(minimumRevision: minimumRevision, interruptible: false)
        }
        func observe(minimumRevision: Int) throws -> Snapshot {
            do { return try statusOnce(minimumRevision: minimumRevision, interruptible: true) }
            catch is CancellationError { return try reconcileCancellation(minimumRevision: minimumRevision) }
            catch {
                guard recoverableObservation(error), sourceAcknowledged, observerRecoveries > 0,
                      sha256(request) == binding.originalSHA256, Date() < deadline() else { throw error }
                observerRecoveries -= 1
                // Same authenticated owner, exact original task/hash and a
                // monotonic revision. No submit, new owner, route or model.
                do { return try statusOnce(minimumRevision: minimumRevision, interruptible: true) }
                catch is CancellationError { return try reconcileCancellation(minimumRevision: minimumRevision) }
            }
        }
        while let current = last {
            if current.revision > emittedRevision { progress(current.data); emittedRevision = current.revision }
            if current.deliverable { return current.data }
            if cancellation(), !cancellationSent {
                // Cancel is idempotent task intent; failure is followed by status,
                // never process-wide termination or resetting the task store.
                if let observed = try cancelOriginal(minimumRevision: current.revision) {
                    last = observed
                    continue
                }
            }
            if let deadline = cancellationDeadline, Date() >= deadline { throw Failure.cancellationPending }
            guard Date() < observationDeadline else { throw Failure.observationEnded }
            Thread.sleep(forTimeInterval: limits.poll)
            // A failed observer/status request is not a failed execution. Do not
            // start another owner, select another provider or rerun the request.
            last = try observe(minimumRevision: current.revision)
        }
        throw Failure.snapshotInvalid
    }

    private static func recoverableObservation(_ error: Error) -> Bool {
        guard let failure = error as? Failure else { return false }
        // Authenticated refusals, identity/owner/custody/source/revision/schema
        // failures are NOT ambiguous transport and never get another read.
        return failure == .rpcTimeout || failure == .rpcFailed
    }

    private static func requestBinding(_ bytes: Data) throws -> (id: String, hash: String, duration: TimeInterval,
        source: String?, policy: String?, originalSHA256: String) {
        guard bytes.count > 2, bytes.count <= maximumRequestBytes,
              let value = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              value["schema"] as? Int == 1, let id = value["task_id"] as? String,
              id.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil,
              let request = value["request"] as? String, !request.isEmpty,
              let hash = value["request_sha256"] as? String, hash == sha256(Data(request.utf8)),
              let budget = value["budget"] as? [String: Any],
              let milliseconds = budget["max_duration_ms"] as? Int,
              milliseconds > 0, milliseconds <= 86_400_000 else { throw Failure.invalidRequest }
        let source = value["source_fingerprint"] as? String, policy = value["policy_sha256"] as? String
        for key in ["source_fingerprint", "policy_sha256"] where value[key] != nil {
            guard let digest = value[key] as? String,
                  digest.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw Failure.invalidRequest }
        }
        return (id, hash, Double(milliseconds) / 1000, source, policy, sha256(bytes))
    }

    private static func snapshot(_ data: Data, id: String, requestSHA256: String, minimumRevision: Int) throws -> Snapshot {
        guard data.count > 2, data.count <= maximumResponseBytes,
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(value.keys).isSubset(of: ["schema", "task_id", "request_sha256", "state", "revision", "children",
                  "result", "error", "install_handoff", "routing_intent", "skipped_routes"]),
              value["schema"] as? Int == 1, value["task_id"] as? String == id,
              value["request_sha256"] as? String == requestSHA256,
              let revision = value["revision"] as? Int, revision >= minimumRevision,
              let state = value["state"] as? String,
              ["held", "queued", "planning", "running", "waiting", "cancelling", "completed", "returned_unverified", "awaiting_install", "cancelled", "effects_uncertain", "failed"].contains(state),
              let children = value["children"] as? [[String: Any]], children.count <= 64,
              children.allSatisfy({ ($0["id"] as? String).map { !$0.isEmpty && $0.utf8.count <= 128 } == true }),
              Set(children.compactMap { $0["id"] as? String }).count == children.count else { throw Failure.snapshotInvalid }
        if state == "completed" || state == "returned_unverified" {
            guard let result = value["result"] as? [String: Any], result["output"] is String,
                  result["execution_verified"] is Bool, result["task_verified"] is Bool,
                  result["parity_state"] is String else { throw Failure.snapshotInvalid }
            if state == "completed", result["task_verified"] as? Bool != true { throw Failure.snapshotInvalid }
        }
        if state == "awaiting_install" {
            guard let handoff = value["install_handoff"] as? [String: Any],
                  handoff["task_id"] as? String == id,
                  handoff["request_sha256"] as? String == requestSHA256,
                  (value["result"] as? [String: Any])?["task_verified"] as? Bool != true else { throw Failure.snapshotInvalid }
        }
        return Snapshot(data: data, state: state, revision: revision)
    }

    private static func ensureGateway(configuration: Configuration, paths: Paths, limits: Limits,
                                      fixture: Bool, cancelled: () -> Bool) throws -> Owner {
        // Lock contention, owner launch and every health observer share ONE
        // readiness ceiling; taking the lock must not restart the clock.
        let readinessDeadline = Date().addingTimeInterval(limits.ready)
        try verifyInstalled(configuration.identity)
        if !fixture {
            guard configuration.bridgeEnvironment["OS1_RCC_RUNTIME"] == "1",
                  configuration.bridgeEnvironment["OS1_RCC_NATIVE_PATH"] == configuration.identity.nativeOS1Path,
                  configuration.bridgeEnvironment["OS1_RCC_NATIVE_SHA256"] == configuration.identity.nativeOS1SHA256 else {
                throw Failure.invalidConfiguration
            }
        }
        let identityHash = try identitySHA256(configuration.identity)
        let configurationHash = sha256(configuration.baseConfig + (try JSONSerialization.data(withJSONObject: configuration.bridgeEnvironment, options: [.sortedKeys])))
        try createPrivateDirectory(paths.root.deletingLastPathComponent())
        for directory in [paths.root, paths.instances, paths.state, paths.workspace] { try createPrivateDirectory(directory) }
        let lockFD = open(paths.lock.path, O_RDWR | O_CREAT | O_NOFOLLOW, 0o600)
        guard lockFD >= 0 else { throw Failure.privateStateInvalid }
        defer { _ = flock(lockFD, LOCK_UN); _ = close(lockFD) }
        try verifyPrivateDescriptor(lockFD)
        while flock(lockFD, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EWOULDBLOCK, Date() < readinessDeadline else { throw Failure.startupBusy }
            guard !cancelled() else { throw CancellationError() }
            Thread.sleep(forTimeInterval: 0.05)
        }
        if !fixture { try checkInstallerMaintenance(root: paths.root) }
        if FileManager.default.fileExists(atPath: paths.metadata.path) {
            let previous = try JSONDecoder().decode(Owner.self, from: readPrivate(paths.metadata, maximum: 16_384))
            try validateOwnerPath(previous, paths: paths)
            if processMatches(previous, nodePath: configuration.identity.nodePath, fixture: fixture) {
                guard previous.identitySHA256 == identityHash, previous.configurationSHA256 == configurationHash else {
                    throw Failure.gatewayIdentityChanged // live tasks may exist: never replace this owner
                }
                // A prior observer may have ended while this exact owner was
                // still starting. Wait for its readiness, never spawn another.
                try awaitReadiness(previous, configuration: configuration, paths: paths,
                    limits: limits, deadline: readinessDeadline, fixture: fixture, cancelled: cancelled, existing: true)
                return previous
            }
            // Only a proved-dead PID permits a replacement. A PID reused by an
            // unrelated process is not signalled; its old metadata is preserved.
            try FileManager.default.moveItem(at: paths.metadata,
                to: paths.root.appendingPathComponent("transport-owner-stale-\(UUID().uuidString).json"))
        }
        guard !cancelled() else { throw CancellationError() }
        guard !FileManager.default.fileExists(atPath: paths.startupIntent.path) else {
            throw Failure.existingGatewayUnavailable // unresolved prior launch; no duplicate owner
        }
        let directory = paths.instances.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try createPrivateDirectory(directory)
        let home = directory.appendingPathComponent("home", isDirectory: true)
        try createPrivateDirectory(home)
        let port = try freeLoopbackPort()
        var config = try checkedBaseConfig(configuration.baseConfig, installed: configuration.identity)
        let token = SymmetricKey(size: .bits256).withUnsafeBytes { $0.map { String(format: "%02x", $0) }.joined() }
        config["gateway"] = ["mode": "local", "bind": "loopback", "port": port,
            "auth": ["mode": "token", "token": token], "controlUi": ["enabled": false],
            "uploads": ["enabled": false], "cliAgents": ["enabled": false], "terminal": ["enabled": false], "tailscale": ["mode": "off"]]
        config["discovery"] = ["mdns": ["mode": "off"]]
        let configBytes = try JSONSerialization.data(withJSONObject: config, options: [.sortedKeys])
        try writePrivate(configBytes, to: directory.appendingPathComponent("config.json"))
        let temporary = Owner(schema: 1, pid: 0, startedAt: 0, executable: "", port: port,
            identitySHA256: identityHash, configurationSHA256: configurationHash,
            directory: directory.path, configSHA256: sha256(configBytes))
        let environment = try processEnvironment(configuration, paths: paths, owner: temporary)
        try writePrivate(try JSONSerialization.data(withJSONObject: ["schema": 1, "directory": directory.path,
            "identity_sha256": identityHash, "configuration_sha256": configurationHash], options: [.sortedKeys]), to: paths.startupIntent)
        let process: Process
        do {
            // The intent is visible BEFORE this last admission check. If the
            // installer acquired maintenance after our earlier check, we stop
            // before spawn; if we spawn first, its quiescence sees the intent.
            if !fixture { try checkInstallerMaintenance(root: paths.root) }
            process = try launch(configuration.identity.nodePath,
                arguments: [configuration.identity.entryPath, "gateway", "run", "--bind", "loopback", "--auth", "token", "--port", String(port)],
                environment: environment, workspace: paths.workspace,
                out: directory.appendingPathComponent("gateway.stdout"), err: directory.appendingPathComponent("gateway.stderr"))
        } catch {
            // launch returned no child. Remove only our own fresh intent.
            try? FileManager.default.removeItem(at: paths.startupIntent)
            throw error
        }
        guard let started = processStart(process.processIdentifier), let executable = processPath(process.processIdentifier),
              fixture || executable == URL(fileURLWithPath: configuration.identity.nodePath).resolvingSymlinksInPath().path else {
            stopChild(process)
            if !process.isRunning { try? FileManager.default.removeItem(at: paths.startupIntent) }
            throw Failure.gatewayStartFailed
        }
        let owner = Owner(schema: 1, pid: process.processIdentifier, startedAt: started, executable: executable, port: port,
            identitySHA256: identityHash, configurationSHA256: configurationHash, directory: directory.path,
            configSHA256: sha256(configBytes))
        // Persist before readiness: another observer must not launch a second
        // process after a crash in this startup window.
        do {
            try writePrivate(try JSONEncoder().encode(owner), to: paths.metadata)
            try FileManager.default.removeItem(at: paths.startupIntent)
        } catch {
            // A transport cannot run unrecorded after a failed custody write.
            stopChild(process)
            if !process.isRunning { try? FileManager.default.removeItem(at: paths.startupIntent) }
            throw error
        }
        try awaitReadiness(owner, configuration: configuration, paths: paths,
            limits: limits, deadline: readinessDeadline, fixture: fixture, cancelled: cancelled, existing: false)
        return owner
    }

    private static func awaitReadiness(_ owner: Owner, configuration: Configuration, paths: Paths,
                                       limits: Limits, deadline: Date, fixture: Bool, cancelled: () -> Bool,
                                       existing: Bool) throws {
        var retryDelay: TimeInterval = 0.25
        while Date() < deadline {
            guard !cancelled() else { throw CancellationError() }
            guard processMatches(owner, nodePath: configuration.identity.nodePath, fixture: fixture) else {
                throw existing ? Failure.existingGatewayUnavailable : Failure.gatewayStartFailed
            }
            do {
                if try health(owner, configuration: configuration, paths: paths,
                    timeout: min(3, limits.rpc), readinessDeadline: deadline,
                    fixture: fixture, cancelled: cancelled), Date() < deadline { return }
            } catch let failure as Failure {
                // Temporary connection refusal is a readiness observation.
                // Custody/identity failures remain precise terminal failures.
                guard [.rpcFailed, .rpcTimeout].contains(failure) else { throw failure }
            }
            // Only one CLI observer runs at a time. Back off cheap refusals or
            // "starting" replies instead of repeatedly cold-loading the CLI.
            Thread.sleep(forTimeInterval: max(0, min(retryDelay, deadline.timeIntervalSinceNow)))
            retryDelay = min(2, retryDelay * 2)
        }
        // Preserve this supervised PID/config and durable state on timeout.
        // There is no task replay, destructive reset, or alternate owner.
        throw existing ? Failure.existingGatewayUnavailable : Failure.gatewayNotReady
    }

    private static func checkedBaseConfig(_ bytes: Data, installed: InstalledIdentity) throws -> [String: Any] {
        guard bytes.count > 2, bytes.count <= 262_144,
              var config = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              let models = config["models"] as? [String: Any], models["mode"] as? String == "replace",
              let providers = models["providers"] as? [String: Any], Set(providers.keys) == ["ollama"],
              let ollama = providers["ollama"] as? [String: Any], ollama["baseUrl"] as? String == "http://127.0.0.1:11434",
              let plugins = config["plugins"] as? [String: Any], plugins["enabled"] as? Bool == true,
              plugins["allow"] as? [String] == ["os1-bridge"],
              let load = plugins["load"] as? [String: Any], load["paths"] as? [String] == [installed.pluginDirectory],
              let browser = config["browser"] as? [String: Any], browser["enabled"] as? Bool == false,
              let agents = config["agents"] as? [String: Any], let defaults = agents["defaults"] as? [String: Any],
              let model = defaults["model"] as? [String: Any], model["primary"] as? String == "ollama/qwen3.5:4b",
              model["fallbacks"] as? [String] == [],
              let tools = config["tools"] as? [String: Any], tools["deny"] as? [String] == ["*"] else {
            throw Failure.invalidConfiguration
        }
        // A service-owned planner has no transient caller's model-override
        // authority. Grant the official SDK exactly this local model, not any
        // hosted provider or a wildcard. All existing hook settings survive.
        var scopedPlugins = plugins
        var entries = scopedPlugins["entries"] as? [String: Any] ?? [:]
        var entry = entries["os1-bridge"] as? [String: Any] ?? ["enabled": true]
        entry["subagent"] = ["allowModelOverride": true, "allowedModels": ["ollama/qwen3.5:4b"]]
        entry["llm"] = ["allowModelOverride": true,
            "allowedModels": ["ollama/qwen3.5:4b"],
            "allowedCompletionModels": ["ollama/qwen3.5:4b"]]
        entries["os1-bridge"] = entry; scopedPlugins["entries"] = entries
        config["plugins"] = scopedPlugins
        config.removeValue(forKey: "gateway")
        return config
    }

    private static func processEnvironment(_ configuration: Configuration, paths: Paths, owner: Owner) throws -> [String: String] {
        guard configuration.bridgeEnvironment.count <= 32,
              configuration.bridgeEnvironment.allSatisfy({ $0.key.range(of: "^OS1_RCC_[A-Z0-9_]{1,64}$", options: .regularExpression) != nil
                  && $0.value.utf8.count <= 16_384 && !$0.value.contains("\0") }) else { throw Failure.invalidConfiguration }
        var env = configuration.bridgeEnvironment
        let directory = URL(fileURLWithPath: owner.directory)
        env["HOME"] = directory.appendingPathComponent("home").path
        env["OPENCLAW_HOME"] = env["HOME"]
        env["OPENCLAW_STATE_DIR"] = paths.state.path
        env["OPENCLAW_CONFIG_PATH"] = directory.appendingPathComponent("config.json").path
        env["PATH"] = URL(fileURLWithPath: configuration.identity.nodePath).deletingLastPathComponent().path + ":/usr/bin:/bin"
        env["NODE_DISABLE_COMPILE_CACHE"] = "1"
        env["OS1_RCC_STATE_ROOT"] = paths.root.path
        // Identity names (never credentials): the bridge forwards USER/LOGNAME
        // to native children, and the Claude CLI needs USER for its Keychain
        // sign-in lookup.
        for (key, value) in LoginIdentityEnvironment.missing(in: env, userName: LoginIdentityEnvironment.effectiveUserName()) {
            env[key] = value
        }
        return env
    }
    private static func health(_ owner: Owner, configuration: Configuration, paths: Paths, timeout: TimeInterval,
                               readinessDeadline: Date, fixture: Bool, cancelled: () -> Bool) throws -> Bool {
        let data = try rpc("health", parameters: Data("{}".utf8), owner: owner,
                           configuration: configuration, paths: paths, timeout: timeout, fixture: fixture,
                           cliBootstrapAllowance: readinessCLIBootstrapAllowance,
                           hardDeadline: readinessDeadline, cancelled: cancelled)
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return object["ok"] as? Bool == true && object["status"] as? String != "starting"
    }
    private static func rpc(_ method: String, parameters: Data, owner: Owner,
                            configuration: Configuration, paths: Paths, timeout: TimeInterval, fixture: Bool,
                            cliBootstrapAllowance: TimeInterval = 0, hardDeadline: Date? = nil,
                            cancelled: () -> Bool = { false }) throws -> Data {
        let boundedObserverDeadline = hardDeadline.map {
            min(Date().addingTimeInterval(cliBootstrapAllowance + timeout + 2), $0)
        }
        guard boundedObserverDeadline == nil || Date() < boundedObserverDeadline! else { throw Failure.rpcTimeout }
        guard methodSet.contains(method), parameters.count <= maximumRequestBytes,
              processMatches(owner, nodePath: configuration.identity.nodePath, fixture: fixture) else { throw Failure.existingGatewayUnavailable }
        try verifyInstalled(configuration.identity)
        let directory = URL(fileURLWithPath: owner.directory)
        guard sha256(try readPrivate(directory.appendingPathComponent("config.json"), maximum: 262_144)) == owner.configSHA256 else { throw Failure.privateStateInvalid }
        let call = directory.appendingPathComponent("rpc-\(UUID().uuidString)", isDirectory: true)
        try createPrivateDirectory(call)
        let params = call.appendingPathComponent("params.json")
        try writePrivate(parameters, to: params)
        var env = try processEnvironment(configuration, paths: paths, owner: owner)
        env["OS1_RCC_RPC_ENTRY"] = configuration.identity.entryPath
        env["OS1_RCC_RPC_METHOD"] = method
        env["OS1_RCC_RPC_PARAMS"] = params.path
        env["OS1_RCC_RPC_URL"] = "ws://127.0.0.1:\(owner.port)"
        env["OS1_RCC_RPC_TIMEOUT"] = String(Int(timeout * 1000))
        guard !cancelled() else { throw CancellationError() }
        guard boundedObserverDeadline == nil || Date() < boundedObserverDeadline! else { throw Failure.rpcTimeout }
        let process = try launch(configuration.identity.nodePath,
            arguments: fixture ? [configuration.identity.entryPath, "fixture-rpc"] : ["--input-type=module", "--eval", rpcShim],
            environment: env, workspace: paths.workspace,
            out: call.appendingPathComponent("stdout.json"), err: call.appendingPathComponent("stderr.txt"),
            qualityOfService: method == "health" ? .userInitiated : nil)
        // Ordinary task RPCs retain their existing post-launch watchdog. Only
        // readiness observers carry the shared pre-launch absolute deadline.
        let processDeadline = boundedObserverDeadline ?? Date().addingTimeInterval(timeout + 2)
        while process.isRunning && Date() < processDeadline {
            if cancelled() { stopChild(process); throw CancellationError() }
            if fileSize(call.appendingPathComponent("stdout.json")) > maximumResponseBytes || fileSize(call.appendingPathComponent("stderr.txt")) > 1_048_576 {
                stopChild(process); throw Failure.rpcFailed
            }
            Thread.sleep(forTimeInterval: 0.02)
        }
        guard !process.isRunning else { stopChild(process); throw Failure.rpcTimeout }
        guard hardDeadline == nil || Date() < processDeadline else { throw Failure.rpcTimeout }
        guard process.terminationReason == .exit, process.terminationStatus == 0 else {
            if let bytes = try? readPrivate(call.appendingPathComponent("stdout.json"), maximum: maximumResponseBytes),
               let failure = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
               failure["ok"] as? Bool == false,
               let detail = failure["error"] as? [String: Any],
               detail["type"] as? String == "gateway_request_error" { throw Failure.rpcRejected }
            throw Failure.rpcFailed
        }
        let result = try readPrivate(call.appendingPathComponent("stdout.json"), maximum: maximumResponseBytes)
        // Keep failed/uncertain RPC payloads for reconciliation; successful RPC
        // params can be removed once their returned snapshot is captured.
        try? FileManager.default.removeItem(at: params)
        return result
    }

    private static func verifyInstalled(_ identity: InstalledIdentity) throws {
        guard Set(identity.pluginFileSHA256.keys).isSuperset(of: ["index.mjs", "rcc-runtime.mjs", "rcc-plugin.mjs", "openclaw.plugin.json", "package.json"]),
              identity.pluginFileSHA256.count <= 16 else { throw Failure.identityMismatch }
        var files = [(identity.nodePath, identity.nodeSHA256), (identity.entryPath, identity.entrySHA256),
                     (identity.nativeOS1Path, identity.nativeOS1SHA256)]
        for (relative, hash) in identity.pluginFileSHA256 {
            guard relative.range(of: "^[A-Za-z0-9_.-]{1,128}$", options: .regularExpression) != nil else { throw Failure.identityMismatch }
            files.append((identity.pluginDirectory + "/" + relative, hash))
        }
        for (path, hash) in files {
            guard path.hasPrefix("/"), !path.contains("/../"), hash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                  try fileHash(URL(fileURLWithPath: path)) == hash else { throw Failure.identityMismatch }
        }
        guard access(identity.nodePath, X_OK) == 0, access(identity.nativeOS1Path, X_OK) == 0 else { throw Failure.identityMismatch }
    }
    private static func identitySHA256(_ identity: InstalledIdentity) throws -> String {
        sha256(try JSONSerialization.data(withJSONObject: ["node": identity.nodePath, "node_sha256": identity.nodeSHA256,
            "entry": identity.entryPath, "entry_sha256": identity.entrySHA256, "plugin": identity.pluginDirectory,
            "files": identity.pluginFileSHA256, "native": identity.nativeOS1Path, "native_sha256": identity.nativeOS1SHA256], options: [.sortedKeys]))
    }
    private static func validateOwnerPath(_ owner: Owner, paths: Paths) throws {
        let directory = URL(fileURLWithPath: owner.directory).standardizedFileURL
        guard owner.schema == 1, owner.pid > 0, owner.startedAt > 0,
              (49_152...65_535).contains(owner.port), directory.deletingLastPathComponent() == paths.instances,
              !owner.directory.contains("/../"), !owner.executable.isEmpty else { throw Failure.privateStateInvalid }
        try checkPrivateDirectory(directory)
    }
    private static func processMatches(_ owner: Owner, nodePath: String, fixture: Bool) -> Bool {
        guard let start = processStart(owner.pid), abs(start - owner.startedAt) < 0.000_01,
              let executable = processPath(owner.pid), executable == owner.executable else { return false }
        return fixture || executable == URL(fileURLWithPath: nodePath).resolvingSymlinksInPath().path
    }
    private static func processStart(_ pid: Int32) -> Double? {
        PendingOS1Repair.processStartTime(pid)?.timeIntervalSince1970
    }
    private static func checkInstallerMaintenance(root: URL) throws {
        let file = root.deletingLastPathComponent().appendingPathComponent("self-update/install-maintenance.pid")
        let fd = open(file.path, O_RDONLY | O_NOFOLLOW)
        if fd < 0 {
            if errno == ENOENT { return }
            throw Failure.privateStateInvalid
        }
        defer { _ = close(fd) }
        try verifyPrivateDescriptor(fd)
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_size > 0, info.st_size <= 128 else { throw Failure.privateStateInvalid }
        let bytes = try FileHandle(fileDescriptor: fd, closeOnDealloc: false).readToEnd() ?? Data()
        var named = stat()
        guard lstat(file.path, &named) == 0, named.st_dev == info.st_dev, named.st_ino == info.st_ino,
              bytes.count == info.st_size else { throw Failure.privateStateInvalid }
        guard let raw = String(data: bytes, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
              raw.range(of: "^[1-9][0-9]{0,9}$", options: .regularExpression) != nil,
              let pid = Int32(raw), pid > 1 else { throw Failure.privateStateInvalid }
        if kill(pid, 0) == 0 || errno == EPERM {
            // A PID reused after this marker was written is not its installer.
            // Never signal it or erase someone else's maintenance state.
            let modified = Double(info.st_mtimespec.tv_sec) + Double(info.st_mtimespec.tv_nsec) / 1_000_000_000
            if let started = processStart(pid), started > modified + 0.001 { return }
            throw Failure.installerMaintenance
        }
        guard errno == ESRCH else { throw Failure.privateStateInvalid }
        // A proved-dead installer does not block a request. Its stale marker
        // remains untouched for the installer to reconcile under its own rules.
    }
    private static func processPath(_ pid: Int32) -> String? {
        var bytes = [CChar](repeating: 0, count: 4096)
        guard proc_pidpath(pid, &bytes, UInt32(bytes.count)) > 0 else { return nil }
        return String(decoding: bytes.prefix(while: { $0 != 0 }).map { UInt8(bitPattern: $0) }, as: UTF8.self)
    }
    private static func freeLoopbackPort() throws -> Int {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { throw Failure.gatewayStartFailed }
        defer { _ = close(fd) }
        var address = sockaddr_in(); address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET); address.sin_addr.s_addr = inet_addr("127.0.0.1")
        for _ in 0..<32 {
            let port = Int.random(in: 49_152...65_535); address.sin_port = UInt16(port).bigEndian
            let bound = withUnsafePointer(to: &address) { pointer in pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            } }
            if bound == 0 { return port }
        }
        throw Failure.gatewayStartFailed
    }
    private static func launch(_ executable: String, arguments: [String], environment: [String: String],
                               workspace: URL, out: URL, err: URL, qualityOfService: QualityOfService? = nil) throws -> Process {
        let outFD = open(out.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard outFD >= 0 else { throw Failure.privateStateInvalid }
        let errFD = open(err.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard errFD >= 0 else { close(outFD); throw Failure.privateStateInvalid }
        let outHandle = FileHandle(fileDescriptor: outFD, closeOnDealloc: true)
        let errHandle = FileHandle(fileDescriptor: errFD, closeOnDealloc: true)
        let process = Process(); process.executableURL = URL(fileURLWithPath: executable); process.arguments = arguments
        // Only ephemeral health observers request this priority. The persistent
        // gateway/model worker launch keeps its existing scheduling policy.
        if let qualityOfService { process.qualityOfService = qualityOfService }
        process.environment = environment; process.currentDirectoryURL = workspace
        process.standardOutput = outHandle; process.standardError = errHandle; process.standardInput = FileHandle.nullDevice
        try process.run(); try? outHandle.close(); try? errHandle.close()
        return process
    }
    private static func stopChild(_ process: Process) {
        guard process.isRunning else { return }
        process.terminate()
        let deadline = Date().addingTimeInterval(1)
        while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.02) }
        if process.isRunning { _ = kill(process.processIdentifier, SIGKILL) }
    }
    private static func sha256(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    private static func fileHash(_ url: URL) throws -> String {
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else { throw Failure.identityMismatch }; defer { _ = close(fd) }
        var info = stat(); guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG else { throw Failure.identityMismatch }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: false)
        var hash = SHA256()
        while let bytes = try handle.read(upToCount: 1_048_576), !bytes.isEmpty { hash.update(data: bytes) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
    private static func createPrivateDirectory(_ url: URL) throws {
        if mkdir(url.path, 0o700) != 0, errno != EEXIST { throw Failure.privateStateInvalid }
        try checkPrivateDirectory(url)
    }
    private static func checkPrivateDirectory(_ url: URL) throws {
        var info = stat()
        guard lstat(url.path, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR,
              (info.st_mode & 0o077) == 0, info.st_uid == getuid() else { throw Failure.privateStateInvalid }
    }
    private static func verifyPrivateDescriptor(_ fd: Int32) throws {
        var info = stat(); guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
              (info.st_mode & 0o077) == 0, info.st_uid == getuid() else { throw Failure.privateStateInvalid }
    }
    private static func readPrivate(_ url: URL, maximum: Int) throws -> Data {
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else { throw Failure.privateStateInvalid }; defer { _ = close(fd) }
        try verifyPrivateDescriptor(fd)
        var info = stat(); guard fstat(fd, &info) == 0, info.st_size > 0, info.st_size <= maximum else { throw Failure.privateStateInvalid }
        return try FileHandle(fileDescriptor: fd, closeOnDealloc: false).readToEnd() ?? Data()
    }
    private static func writePrivate(_ data: Data, to url: URL) throws {
        let fd = open(url.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw Failure.privateStateInvalid }; defer { _ = close(fd) }
        try FileHandle(fileDescriptor: fd, closeOnDealloc: false).write(contentsOf: data)
        guard fsync(fd) == 0 else { throw Failure.privateStateInvalid }
    }
    private static func fileSize(_ url: URL) -> Int {
        (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.intValue ?? 0
    }
}
