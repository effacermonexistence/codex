import Foundation

/// Passive presentation only. These projections neither refresh a provider nor
/// authorize a route. Token observations, account quota and cash are different
/// objects; a missing observation never becomes zero or a claim of savings.
public enum RuntimeResourcePresentation {
    public enum AccountingState: String, Equatable, Sendable { case complete, partial, unavailable, invalid }
    public struct Resources: Equatable, Sendable {
        public let state: AccountingState
        public let total: Int?
        public let local: Int?
        public let native: Int?
        public let nativeAttempts: Int?
        public let localCalls: Int?

        public var text: String {
            let boundary = os1Tr("구독 쿼터 절감·청구액 미측정", "subscription quota savings / billing not measured")
            switch state {
            case .complete:
                return os1Tr("관측 토큰", "Observed tokens") + " · \(total!)" +
                    os1Tr(" · 로컬 \(local!) / 네이티브 \(native!)", " · local \(local!) / native \(native!)") +
                    os1Tr(" · 로컬 호출 \(localCalls!) / 네이티브 시도 \(nativeAttempts!)", " · local calls \(localCalls!) / native attempts \(nativeAttempts!)") +
                    " · " + boundary
            case .partial:
                // Empty-row subtotals can be zero while another attempt is
                // unmetered. Do not advertise that as a measured zero total.
                return os1Tr("토큰 계측 불완전 · 총량 미상", "Token accounting incomplete · total unknown") + " · " + boundary
            case .unavailable, .invalid:
                return os1Tr("토큰 계측 없음 · 총량 미상", "Token accounting unavailable · total unknown") + " · " + boundary
            }
        }
    }

    public static func resources(_ usage: RCCRuntimeContract.ResourceUsageSummary?) -> Resources {
        func unknown(_ state: AccountingState) -> Resources {
            .init(state: state, total: nil, local: nil, native: nil, nativeAttempts: nil, localCalls: nil)
        }
        guard let usage else { return unknown(.unavailable) }
        let maximum = 9_007_199_254_740_991
        let counts = [usage.totalTokensObserved, usage.localTokensObserved, usage.nativeTokensObserved,
                      usage.planModelCalls, usage.localCallsStarted, usage.localCallsSettled,
                      usage.localWorkerAttempts, usage.nativeAttempts]
        guard usage.schema == 1, counts.allSatisfy({ $0.map { (0...maximum).contains($0) } ?? true }),
              usage.localCallsSettled <= usage.localCallsStarted, usage.issues.count <= 64,
              usage.quotaSavings == "not_measured", usage.cashCost == "not_measured",
              usage.accountingScope == "observed_attempts_as_of_snapshot_not_future_cost" else { return unknown(.invalid) }
        guard usage.accountingComplete else {
            return unknown(usage.totalTokensObserved == nil ? .partial : .invalid)
        }
        guard usage.issues.isEmpty, let total = usage.totalTokensObserved,
              let local = usage.localTokensObserved, let native = usage.nativeTokensObserved,
              total == local + native, usage.planModelCalls == 0 else { return unknown(.invalid) }
        return .init(state: .complete, total: total, local: local, native: native,
                     nativeAttempts: usage.nativeAttempts, localCalls: usage.localCallsStarted)
    }

    public enum QuotaBasis: String, Equatable, Sendable { case fresh, retainedEstimate = "retained_estimate", unknown }
    public enum UnknownReason: String, Equatable, Sendable {
        case missing, accountMismatch, connectionUnavailable, futureObservation, stale, resetCrossed, malformed, rejected
    }
    public struct QuotaWindow: Equatable, Sendable {
        public let bucket: String
        public let model: String?
        public let surface: String?
        /// Historical provider observation, not a guaranteed current balance.
        public let observedRemainingPercent: Double
        public let resetsAt: Date?
    }
    public struct Quota: Equatable, Sendable {
        public let provider: String
        public let connectionState: BackendHealth.State?
        public let basis: QuotaBasis
        public let unknownReason: UnknownReason?
        public let source: BackendHealth.QuotaSnapshot.Source?
        public let observedAt: Date?
        public let windows: [QuotaWindow]
        public let generalRemainingEstimate: Double?
        public let probeOutcome: BackendHealth.QuotaProbe.Outcome?
        public let probeAttemptedAt: Date?

        public var headline: String {
            switch basis {
            case .fresh: return os1Tr("잔여 쿼터 · 관측값", "Remaining quota · observed")
            case .retainedEstimate: return os1Tr("잔여 쿼터 · 보관 관측값의 추정", "Remaining quota · retained estimate")
            case .unknown: return os1Tr("잔여 쿼터 미상", "Remaining quota unknown")
            }
        }
        public var reasonText: String? {
            switch unknownReason {
            case .missing: return os1Tr("사용 가능한 관측값 없음", "No usable observation")
            case .accountMismatch: return os1Tr("현재 계정과 관측 계정 불일치", "Observation is for a different account")
            case .connectionUnavailable: return os1Tr("현재 연결 상태로 잔량을 확인할 수 없음", "Current connection state does not establish remaining quota")
            case .futureObservation: return os1Tr("미래 시각의 관측값은 사용하지 않음", "Future-dated observation not used")
            case .stale: return os1Tr("관측값 만료 · 현재 잔량 미상", "Observation expired · current remaining unknown")
            case .resetCrossed: return os1Tr("리셋 시각 경과 · 보충량 추정 안 함", "Reset crossed · replenishment not inferred")
            case .malformed: return os1Tr("관측 형식이 유효하지 않음", "Invalid observation")
            case .rejected: return os1Tr("관측 이후 한도 거절 기록 있음", "A quota rejection supersedes this observation")
            case nil: return nil
            }
        }
    }

    /// All inputs are supplied values. No filesystem, refresh, process, network,
    /// account switch or model invocation is reachable from this projection.
    public static func quota(provider: String, accountID: String, connectionState: BackendHealth.State?,
                             snapshot: BackendHealth.QuotaSnapshot?, probe: BackendHealth.QuotaProbe? = nil,
                             rejectedAt: Date? = nil, now: Date) -> Quota {
        let validProbe = probe.flatMap { $0.attemptedAt <= now ? $0 : nil }
        func value(_ basis: QuotaBasis = .unknown, reason: UnknownReason? = nil,
                   source: BackendHealth.QuotaSnapshot.Source? = nil, observedAt: Date? = nil,
                   windows: [QuotaWindow] = [], estimate: Double? = nil) -> Quota {
            .init(provider: provider, connectionState: connectionState, basis: basis, unknownReason: reason,
                  source: source, observedAt: observedAt, windows: windows, generalRemainingEstimate: estimate,
                  probeOutcome: validProbe?.outcome, probeAttemptedAt: validProbe?.attemptedAt)
        }
        guard let snapshot else { return value(reason: .missing) }
        guard !accountID.isEmpty, snapshot.accountID == accountID else { return value(reason: .accountMismatch) }
        let source = snapshot.source, observed = snapshot.observedAt
        guard (provider == "codex" && source == .codexNative) || (provider == "claude" && source == .claudeNative) else {
            return value(reason: .malformed)
        }
        // Unknown connection status is not a positive availability claim, but
        // it does not erase an independently account-bound quota observation.
        // An explicit disconnected/disabled state does invalidate its use.
        guard connectionState == nil || connectionState == .usable || connectionState == .quotaExhausted else {
            return value(reason: .connectionUnavailable, source: source, observedAt: observed)
        }
        guard observed <= now else { return value(reason: .futureObservation, source: source, observedAt: observed) }
        guard !snapshot.windows.isEmpty, snapshot.windows.count <= 64,
              snapshot.windows.allSatisfy({ !$0.bucket.isEmpty && $0.bucket.count <= 64 &&
                  $0.usedPercent.isFinite && (0...100).contains($0.usedPercent) }) else {
            return value(reason: .malformed, source: source, observedAt: observed)
        }
        if let rejectedAt, rejectedAt <= now, observed <= rejectedAt {
            return value(reason: .rejected, source: source, observedAt: observed)
        }
        guard now.timeIntervalSince(observed) <= BackendHealth.QuotaSnapshot.retainedMaximumAge else {
            return value(reason: .stale, source: source, observedAt: observed)
        }
        guard snapshot.windows.allSatisfy({ $0.resetsAt.map { $0 > now } ?? true }) else {
            return value(reason: .resetCrossed, source: source, observedAt: observed)
        }
        let windows = snapshot.windows.map {
            QuotaWindow(bucket: $0.bucket, model: $0.model, surface: $0.surface,
                        observedRemainingPercent: 100 - $0.usedPercent, resetsAt: $0.resetsAt)
        }
        let fresh = snapshot.isFresh(accountID: accountID, now: now)
        return value(fresh ? .fresh : .retainedEstimate, source: source, observedAt: observed,
                     windows: windows, estimate: snapshot.estimate(accountID: accountID, now: now)?.remainingPercent)
    }
}
