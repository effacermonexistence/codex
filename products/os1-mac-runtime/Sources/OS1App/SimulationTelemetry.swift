import Foundation
import OS1Context

/// Presentation only. `used` is an observed consumption count; a provider's
/// quota percentage is never converted into an absolute token balance.
struct OS1GardenTokenPool: Codable, Equatable, Sendable {
    let used: Int?
    let remaining: Int?
    let capacity: Int?
    let remainingPercent: Double?
    let label: String
    let source: String
    var quota: OS1GardenQuotaObservation? = nil

    static let unavailable = OS1GardenTokenPool(used: nil, remaining: nil, capacity: nil,
        remainingPercent: nil, label: "토큰 계측 없음", source: "unavailable")
}

/// No account identifiers, prompts, provider logs or credentials cross the
/// native/WebKit bridge. Observation and retained estimate remain distinct.
struct OS1GardenQuotaObservation: Codable, Equatable, Sendable {
    struct Window: Codable, Equatable, Sendable {
        let bucket: String
        let model: String?
        let surface: String?
        let observedRemainingPercent: Double
        let resetsAt: Date?
    }
    let provider: String
    let basis: String
    let observedAt: Date?
    let windows: [Window]
    let unknownReason: String?
}

enum OS1GardenTelemetry {
    /// The most recently supplied RCC task snapshot, not an inferred lifetime
    /// conversation total. Repeated snapshots REPLACE this value; never add
    /// their running totals. The caller owns exact task/request binding.
    static func resourcePool(_ usage: RCCRuntimeContract.ResourceUsageSummary?) -> OS1GardenTokenPool {
        let value = RuntimeResourcePresentation.resources(usage)
        guard value.state == .complete, let total = value.total else {
            return OS1GardenTokenPool(used: nil, remaining: nil, capacity: nil, remainingPercent: nil,
                label: value.state == .partial ? "이번 RCC 작업 · 토큰 계측 불완전" : "이번 RCC 작업 · 토큰 미상",
                source: "rcc_resource_usage_" + value.state.rawValue)
        }
        return OS1GardenTokenPool(used: total, remaining: nil, capacity: nil, remainingPercent: nil,
            label: "이번 RCC 작업 · 관측 토큰", source: "rcc_task_observed_attempts")
    }

    /// Same passive account/freshness recipe as ProviderStatusView. The raw
    /// cache may contain another account, but no such observation is adopted.
    static func quotas(from raw: OS1GardenTelemetrySources, codexAccountID: String,
                       claudeAccountID: String, codexEnabled: Bool, now: Date) -> [String: OS1GardenTokenPool] {
        func pool(_ provider: String, account: String) -> OS1GardenTokenPool {
            let backend = provider == "codex" ? raw.health?.codex : raw.health?.claude
            let ownClaude = provider == "claude" && raw.claudeStore?.accountID == account ? raw.claudeStore : nil
            let candidates = [backend?.quota, ownClaude?.snapshot].compactMap { $0 }
                .filter { !$0.accountID.isEmpty && $0.accountID == account }
            let snapshot = candidates.max { $0.observedAt < $1.observedAt }
            let backendMatches = backend?.quota?.accountID == account
            let probes = [backendMatches ? backend?.quotaProbe : nil, ownClaude?.probe]
                .compactMap { $0 }.filter { $0.attemptedAt <= now }
            let value = RuntimeResourcePresentation.quota(provider: provider, accountID: account,
                connectionState: provider == "codex" && !codexEnabled ? .disabled : backendMatches ? backend?.state : nil,
                snapshot: snapshot, probe: probes.max { $0.attemptedAt < $1.attemptedAt }, now: now)
            let title = provider == "codex" ? "Codex" : "Claude"
            let percent = value.basis == .unknown ? nil : value.generalRemainingEstimate
            let detail = OS1GardenQuotaObservation(provider: provider, basis: value.basis.rawValue,
                observedAt: value.observedAt, windows: value.windows.map {
                    .init(bucket: $0.bucket, model: $0.model, surface: $0.surface,
                        observedRemainingPercent: $0.observedRemainingPercent, resetsAt: $0.resetsAt)
                }, unknownReason: value.unknownReason?.rawValue)
            return OS1GardenTokenPool(used: nil, remaining: nil, capacity: nil,
                remainingPercent: percent, label: title + " · " + value.headline,
                source: value.source?.rawValue ?? "cached_quota_unavailable", quota: detail)
        }
        return ["codex": pool("codex", account: codexAccountID), "claude": pool("claude", account: claudeAccountID)]
    }
}

/// A read of the two existing, bounded local metadata caches. No provider
/// refresh, network call, model call, process launch or account mutation.
struct OS1GardenTelemetrySources: Sendable {
    let health: BackendHealth?
    let claudeStore: ClaudeQuotaStore?

    static func cached(now: Date) -> Self {
        .init(health: BackendHealth.load(maxAge: BackendHealth.QuotaSnapshot.retainedMaximumAge,
                                        now: now, invalidateReset: false),
              claudeStore: ClaudeQuotaStore.load(from: ClaudeQuotaStore.defaultURL))
    }
}

/// Off-main-actor IO, at most once every five seconds. Concurrent callers
/// share one read. Freshness/reset/account checks are re-evaluated on every
/// projection, even while the underlying file snapshot is cached.
actor OS1GardenTelemetryCache {
    typealias Loader = @Sendable (Date) -> OS1GardenTelemetrySources
    private let loader: Loader
    private var loadedAt: Date?
    private var sources: OS1GardenTelemetrySources?
    private var inFlight: Task<OS1GardenTelemetrySources, Never>?
    static let readInterval: TimeInterval = 5

    init(loader: @escaping Loader = { OS1GardenTelemetrySources.cached(now: $0) }) {
        self.loader = loader
    }

    func quotas(codexAccountID: String, claudeAccountID: String, codexEnabled: Bool,
                now: Date = Date()) async -> [String: OS1GardenTokenPool] {
        let raw: OS1GardenTelemetrySources
        if let pending = inFlight {
            raw = await pending.value
        } else if let loadedAt, let sources, now >= loadedAt,
                  now.timeIntervalSince(loadedAt) < Self.readInterval {
            raw = sources
        } else {
            let load = loader
            let task = Task.detached(priority: .utility) { load(now) }
            inFlight = task
            raw = await task.value
            sources = raw
            loadedAt = now
            inFlight = nil
        }
        return OS1GardenTelemetry.quotas(from: raw, codexAccountID: codexAccountID,
            claudeAccountID: claudeAccountID, codexEnabled: codexEnabled, now: now)
    }
}
