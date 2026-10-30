import Foundation

/// Build 447 (DESIGN-8, owner-approved direction 2026-10-29): the host side
/// of the routing law.
///
/// The owner's only input is the objective: the result of the newest top
/// model at its highest reasoning, with less quota. Core (rcc-runtime.mjs,
/// routing law) turns the local model's reading into a family, keeps the
/// candidates with evidence that they give the reference's result on that
/// family's benchmark tiers (or a passed paired audit), prices each in real
/// quota at each pool's derived exchange (E[Q] = Q·price + p_fail x
/// Q(repair)·price; lead corrections 2026-10-29: a row with evidence inherits
/// its reference's p_fail, and a pool's price is the share of its remaining
/// allowance until its reset, from the `pools` the host sends) and binds the
/// argmin. Its inputs are one compiled
/// table (`scripts/routing-law-table.mjs`; `Resources/routing-law-table.json`
/// is the reviewable copy, Core embeds the same bytes): `tableSHA256` is the
/// pin both sides check.
///
/// The host only (a) decides the switch, (b) reads the request with the local
/// model for every Auto request (the keyword rails no longer decide the tier:
/// they set the permission scope only) and (c) carries the raw reading, the
/// owner's own reference words (`reference_request`, build 446's capability
/// guard) and the pools' rate-limit windows (`pools`, `poolStates`) in the
/// catalog's `routing_law`. The rollback is `routing_policy=law_446`: the
/// catalog then carries no `routing_law` and Core keeps build 446's routes.
public enum RoutingLaw {
    /// SHA-256 of `Resources/routing-law-table.json` (the compiled table).
    public static let tableSHA256 = "8d0b855d029221ef0b6f94d51921ee87e788770f8895b27dc3167420e539744b"

    public enum Policy: String, Codable, Sendable, CaseIterable {
        case law446 = "law_446", law447 = "law_447"
    }
    public static let defaultPolicy: Policy = .law447
    /// One-shot override for a process (tests, a rollback drill).
    public static let environmentKey = "OS1_ROUTING_POLICY"
    /// The persistent switch: `{"routing_policy":"law_446"}` rolls back,
    /// `{"routing_policy":"law_447"}` (or no file) runs the law.
    public static func policyFile(home: URL) -> URL { home.appendingPathComponent(".os1/routing-policy.json") }

    public struct Selection: Equatable, Sendable {
        public var policy: Policy
        /// `environment`, `file`, `default`, or `default_invalid_file` (an
        /// unreadable or malformed switch file: the default runs, visibly).
        public var source: String
        public init(policy: Policy, source: String) { self.policy = policy; self.source = source }
        public var receiptLine: String { "routing policy \(policy.rawValue) (\(source))" }
    }

    /// The switch: the environment, else the file, else the default.
    public static func policy(home: URL = FileManager.default.homeDirectoryForCurrentUser,
                              environment: [String: String] = ProcessInfo.processInfo.environment) -> Selection {
        if let raw = environment[environmentKey], let value = Policy(rawValue: raw) {
            return Selection(policy: value, source: "environment")
        }
        let url = policyFile(home: home)
        guard FileManager.default.fileExists(atPath: url.path) else { return Selection(policy: defaultPolicy, source: "default") }
        guard let data = try? Data(contentsOf: url), data.count <= 4_096,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == ["routing_policy"], let raw = object["routing_policy"] as? String,
              let value = Policy(rawValue: raw) else {
            return Selection(policy: defaultPolicy, source: "default_invalid_file")
        }
        return Selection(policy: value, source: "file")
    }

    /// Lead correction 2 (DESIGN-8, 2026-10-29): each quota pool's rate-limit
    /// state for Core's derived exchange (lawPoolPrice: the pool's weekly
    /// window's share still to run over its share left). From the host's own
    /// quota observations of the dispatching account, valid (fresh) until ten
    /// minutes after observation or the first reset. Review of 447: the last
    /// observation of that account travels even after it is no longer
    /// retainable (a failed probe), with its windows that have not reset yet:
    /// past valid_until Core prices each such window at its last share left with
    /// the whole window ahead (never pace 1 for a pool last seen scarce), and a
    /// window that has reset since is dropped (replenished). Only the general
    /// windows (no model or surface scope) whose length is known: the
    /// provider's reported length (Codex), else the provider's named window
    /// (Claude `session` = 5 hours, `weekly_*` = 7 days). A pool with no such
    /// window is absent: Core then prices it conservatively from its rows'
    /// remaining share with the whole window ahead.
    public static func poolStates(codex: BackendHealth.QuotaSnapshot?, claude: BackendHealth.QuotaSnapshot?,
                                  accountIDs: [String: String], now: Date) -> [String: RCCRuntimeContract.RoutingLaw.PoolState]? {
        var out: [String: RCCRuntimeContract.RoutingLaw.PoolState] = [:]
        for (pool, provider, snapshot) in [("openai_codex", "codex", codex), ("anthropic_shared", "claude", claude)] {
            guard let snapshot, let account = accountIDs[provider], !account.isEmpty, snapshot.accountID == account,
                  snapshot.observedAt <= now, !snapshot.windows.isEmpty, snapshot.windows.count <= 64,
                  snapshot.windows.allSatisfy({ $0.usedPercent.isFinite && (0...100).contains($0.usedPercent) })
            else { continue }
            let windows = snapshot.windows.compactMap { window -> RCCRuntimeContract.RoutingLaw.PoolWindow? in
                guard window.model == nil, window.surface == nil, let reset = window.resetsAt, reset > now,
                      let minutes = window.windowMinutes ?? claudeWindowMinutes(window.bucket, source: snapshot.source) else { return nil }
                return .init(usedPercent: window.usedPercent, resetsAtMS: Int64(reset.timeIntervalSince1970 * 1000), windowMinutes: minutes)
            }.prefix(8)
            guard !windows.isEmpty else { continue }
            let observed = Int64(snapshot.observedAt.timeIntervalSince1970 * 1000)
            let retained = Int64(snapshot.observedAt.addingTimeInterval(BackendHealth.QuotaSnapshot.retainedMaximumAge)
                .timeIntervalSince1970 * 1000)
            let state = RCCRuntimeContract.RoutingLaw.PoolState(observedAtMS: observed,
                validUntilMS: ([retained] + windows.map(\.resetsAtMS)).min()!, windows: Array(windows))
            if state.valid { out[pool] = state }
        }
        return out.isEmpty ? nil : out
    }
    /// Claude's named windows (`get_usage` kinds): the session window is five
    /// hours, a weekly window seven days; anything else is unknown.
    static func claudeWindowMinutes(_ bucket: String, source: BackendHealth.QuotaSnapshot.Source) -> Double? {
        guard source == .claudeNative else { return nil }
        if bucket == "session" { return 300 }
        if bucket.hasPrefix("weekly") { return 10_080 }
        return nil
    }

    /// The catalog's `routing_law` for one request under `policy`: nil under
    /// law_446 (build 446's routes), else the local reading as read (the
    /// enum call, the domain call and, build 447, the intent call), or
    /// `reader: none` with no reading when the local model gave none (Core's
    /// family U: only evidence across the broad tiers, or the reference).
    public static func catalogLaw(policy: Policy, receipt: LocalRequestClassifier.Receipt?) -> RCCRuntimeContract.RoutingLaw? {
        guard policy == .law447 else { return nil }
        guard let adopted = receipt?.adopted, LocalRequestClassifier.validModelName(adopted.model) else {
            return RCCRuntimeContract.RoutingLaw(tableSHA256: tableSHA256, reader: "none", reading: nil)
        }
        let answer = adopted.answer
        return RCCRuntimeContract.RoutingLaw(tableSHA256: tableSHA256, reader: "local_llm:" + adopted.model,
            reading: .init(taskType: answer.taskType.rawValue, difficulty: answer.difficulty.rawValue,
                           needsTools: answer.needsTools.rawValue, domain: answer.domain.rawValue,
                           intent: answer.intent?.rawValue))
    }
}
