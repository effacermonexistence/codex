import Foundation

/// Builds the OpenClaw candidate catalog from host observations. Pure: every
/// observation (profiles, native inventories, sign-in, quota, account ids,
/// capacity, clock, the chat-lane predicate) is an input, so the same inputs
/// always give the same bytes. `os1 rcc-catalog` only gathers observations.
///
/// Each row's identity and bytes are unchanged from the earlier inline
/// builder: id = "cfg-" + sha256(surface, provider, account, model, effort,
/// scope, executor contract)[0..<32]. What changed is which rows exist and
/// their ORDER, which now expresses a deterministic preference (pool, then
/// native model preference, then surface, effort and scope) instead of the
/// alphabetical order of profile names:
///
/// - GPT is no longer routed: no `gpt-chat`/`chatgpt` row is emitted.
/// - A pool whose owner capacity is 0 is excluded unless the owner named that
///   provider's surface (the host preference, or a route of an explicit
///   route test).
/// - An explicit effort/model-family word in the owner's request (see
///   `RoutingIntent`) restricts rows; if nothing matches the catalog is empty
///   with `explicit_constraint_unavailable`, never a substitute. The catalog
///   then carries that constraint as `routing_intent`, so the host names the
///   route explicit (and may bind an explicitly asked ultra effort).
/// - Without an explicit effort word, ultra/ultracode are not offered. max is
///   offered: it is the reference effort. Lower efforts and lower-tier models
///   stay in the catalog: the host routes each graded node to the cheapest
///   tier/effort expected to give the reference result (build 378).
/// - An explicit route test (`explicitRouteSurfaces` set) keeps its former
///   candidate set: the whole fan-out sentence is not read as one intent, and
///   no effort is withheld; only GPT, capacity and the chat gate apply. Each
///   route's OWN effort/model words travel separately
///   (`explicit_route_intents`): the host binds each named route's model and
///   effort by its grade on that route's surface, and an above-max effort
///   only when that route's own words asked for it.
/// - `claude-chat` rows exist only when the narrow chat-lane predicate holds.
/// - An active Claude quota cooldown (`ClaudeQuotaBackoff`, left by a real
///   execution rejection) excludes the cooled family, or every Claude profile
///   when it is account-wide, with `quota_backoff`; it is never probed.
/// - Every row's model carries its provider-stated tier (`ModelTiers`) in the
///   catalog's `model_tiers` (build 378). A pool's REFERENCE is its
///   frontier-tier model at the highest offered effort up to max, never the
///   first model in the native list (gpt-6.1-sol and opus are workhorses).
///   Lower tiers are no longer withheld: they carry trivial and standard work.
///   A pool whose frontier model offers no row now (absent, quota_zero,
///   quota_backoff, or no profile at the owner's effort word) keeps its lower
///   rows and records `reference_unavailable`: the host then never binds that
///   pool for deep work or a REVAS escalation, and nothing lower stands in.
///   An explicit model family or route test names its own route instead.
/// - Every excluded profile is counted per provider and reason, so an empty
///   catalog is an explained hold, not an opaque binding error.
public enum RCCNativeCatalogBuilder {
    public static let maximumCandidates = 256
    public static let effortOrder = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"]
    /// Above max: offered only when the owner explicitly asks. max itself is
    /// the default reference effort and is never withheld.
    public static let explicitOnlyEfforts: Set<String> = ["ultra", "ultracode"]
    static let maximumReferenceEffort = "max"

    public struct Profile: Equatable, Sendable {
        public var action: String
        public var provider: String
        public var model: String
        public var effort: String
        public init(action: String, provider: String, model: String, effort: String) {
            self.action = action; self.provider = provider; self.model = model; self.effort = effort
        }
    }
    /// One native Codex model row; `priority` is its index in the native list.
    public struct CodexModel: Equatable, Sendable {
        public var slug: String
        public var supportedEfforts: [String]
        public var priority: Int
        public init(slug: String, supportedEfforts: [String], priority: Int) {
            self.slug = slug; self.supportedEfforts = supportedEfforts; self.priority = priority
        }
    }
    /// One configured Claude model name, given in native inventory order.
    /// Claude lists one native row under several names (its value, resolved
    /// ID and family alias), each mapped to its own configured efforts.
    /// `nativeRank` is that row's ordinal in the native inventory, shared by
    /// every name of the row; nil when unobserved (the list index is used).
    public struct ClaudeModel: Equatable, Sendable {
        public var model: String
        public var supportedEfforts: [String]
        public var nativeRank: Int?
        public init(model: String, supportedEfforts: [String], nativeRank: Int? = nil) {
            self.model = model; self.supportedEfforts = supportedEfforts; self.nativeRank = nativeRank
        }
    }
    public enum Auth: Equatable, Sendable { case signedOut, nonSubscription, subscription }

    public struct Input: Sendable {
        public var taskID: String
        public var requestSHA256: String
        /// The owner's request text: scope, intent and nothing from history.
        public var request: String
        public var providerPreference: String
        public var requireReadOnly: Bool
        public var hasMaterialRefs: Bool
        public var capacityPlan: RCCRuntimeContract.CapacityPlan?
        public var executorContractSHA256: String
        public var now: Date
        public var showCodex: Bool
        /// The narrow chat-lane predicate for this request, computed by the
        /// host from the same function the executor uses.
        public var chatLaneEligible: Bool
        public var profiles: [Profile]
        public var codexModels: [CodexModel] = []
        public var claudeModels: [ClaudeModel] = []
        /// nil = not observed (treated as signed out).
        public var auth: [String: Auth] = [:]
        public var codexQuota: BackendHealth.QuotaSnapshot? = nil
        public var claudeQuota: BackendHealth.QuotaSnapshot? = nil
        public var accountIDs: [String: String] = [:]
        /// Active Claude quota cooldowns observed by the host. A real
        /// execution rejection outranks the metadata-only inventory: `true`
        /// cools every Claude profile; a family name
        /// (`BackendRecovery.claudeModelFamily`) cools only that family.
        public var claudeAccountQuotaBackoff = false
        public var claudeQuotaBackoffFamilies: Set<String> = []
        /// Codex slugs the native list reported but the host's general
        /// catalog dropped because their quota bucket is exhausted. They are
        /// in `codexModels` too (see `codexInventory`): they still define the
        /// pool's reference model, and every profile on them is quota_zero.
        public var codexQuotaExhaustedModels: Set<String> = []
        /// The surfaces an explicit route test names, or nil outside one.
        public var explicitRouteSurfaces: [String]? = nil
        /// Each explicit route's OWN effort/model words
        /// (`RoutingIntent.parse` of that route's payload), aligned with the
        /// host's original explicit route list; nil outside an explicit route
        /// test. One route's words never constrain another route.
        public var explicitRouteIntents: [RoutingIntent]? = nil
        public init(taskID: String, requestSHA256: String, request: String, providerPreference: String,
                    requireReadOnly: Bool, hasMaterialRefs: Bool, capacityPlan: RCCRuntimeContract.CapacityPlan?,
                    executorContractSHA256: String, now: Date, showCodex: Bool, chatLaneEligible: Bool,
                    profiles: [Profile]) {
            self.taskID = taskID; self.requestSHA256 = requestSHA256; self.request = request
            self.providerPreference = providerPreference; self.requireReadOnly = requireReadOnly
            self.hasMaterialRefs = hasMaterialRefs; self.capacityPlan = capacityPlan
            self.executorContractSHA256 = executorContractSHA256; self.now = now; self.showCodex = showCodex
            self.chatLaneEligible = chatLaneEligible; self.profiles = profiles
        }
    }
    /// How a pool was ranked. Kept beside the catalog for diagnosis; it is not
    /// part of the catalog wire.
    public struct PoolRanking: Equatable, Sendable {
        public var pool: String
        public var share: Double
        public var remainingFraction: Double?
        public var hoursToReset: Double
        public var resetUnknown: Bool
        public var score: Double?
    }
    public struct Output {
        public var candidates: [[String: Any]]
        public var exclusions: [RCCRuntimeContract.Exclusion]
        public var pools: [PoolRanking]
        public var intent: RoutingIntent
        /// Tier of every tiered model in `candidates` (`ModelTiers`).
        public var modelTiers: [String: String] = [:]
        /// Per offered model with known quota: the same pool score the pool
        /// order uses (capacity share x that model's own remaining quota /
        /// hours to its own reset, at most 1), in integer parts per billion so
        /// both sides compare exact values, so the host can rank pools by the
        /// model a node actually binds (build 378), not by another model's quota.
        public var quotaScores: [String: Int] = [:]
        /// An explicit route test's per-route intents (see Input).
        public var explicitRouteIntents: [RoutingIntent]? = nil
    }
    public enum Failure: Error, Equatable {
        /// Never truncate: an oversize inventory is an explicit boundary.
        case exceedsBound(Int)
        /// No row and no recorded reason (no configured profile for the
        /// admitted providers): a malformed configuration, not a hold reason.
        case unexplainedEmptyCatalog
    }

    // MARK: Preference

    /// GPT surfaces are no longer routed; a persisted GPT preference spends
    /// the same OpenAI account through Codex.
    public static func normalizedPreference(_ preference: String) -> String {
        ["gpt-chat", "chatgpt"].contains(preference) ? "codex" : preference
    }
    /// Which executed surfaces a host preference admits. Claude names the
    /// Anthropic family: its bounded chat lane runs only when its gate holds.
    public static func admits(preference: String, surface: String) -> Bool {
        switch normalizedPreference(preference) {
        case "auto": return ["codex", "claude", "claude-chat"].contains(surface)
        case "codex": return surface == "codex"
        case "claude": return surface == "claude" || surface == "claude-chat"
        case "claude-chat": return surface == "claude-chat"
        default: return false
        }
    }
    static func providerSurfaces(_ provider: String) -> [String] {
        provider == "codex" ? ["codex"] : ["claude", "claude-chat"]
    }
    static func pool(_ provider: String) -> String { provider == "codex" ? "openai_codex" : "anthropic_shared" }
    static func capacity(_ provider: String, _ plan: RCCRuntimeContract.CapacityPlan?) -> Int {
        guard let plan else { return 100 }
        return provider == "codex" ? plan.codex : plan.claude
    }
    /// The owner named this provider's surface (not Auto), which overrides a
    /// 0% capacity for that provider: the host preference, or one route of an
    /// explicit route test. A GPT route names nothing: it is dropped.
    public static func named(_ provider: String, preference: String, explicitSurfaces: [String]? = nil) -> Bool {
        func names(_ surface: String) -> Bool {
            provider == "codex" ? surface == "codex" : ["claude", "claude-chat"].contains(surface)
        }
        return names(normalizedPreference(preference)) || (explicitSurfaces ?? []).contains(where: names)
    }
    /// The capacity plan the execution authorization receives for a row of
    /// `provider`. The server denies a provider whose capacity is 0, so a
    /// provider the catalog admitted only because the owner named it is sent
    /// at 100 (the former fixed plan); one the owner did not name at 0 is
    /// refused here (nil), exactly as the catalog excluded it. Absent = 100/100.
    public static func authorizationCapacity(_ plan: RCCRuntimeContract.CapacityPlan?, provider: String,
                                             preference: String, explicitSurfaces: [String]?) -> RCCRuntimeContract.CapacityPlan? {
        guard var value = plan else { return .init(codex: 100, claude: 100) }
        guard capacity(provider, value) == 0 else { return value }
        guard named(provider, preference: preference, explicitSurfaces: explicitSurfaces) else { return nil }
        if provider == "codex" { value.codex = 100 } else { value.claude = 100 }
        return value
    }
    /// The owner-text intent the builder applies. An explicit route test has
    /// none: each route's payload is not a routing constraint for every route.
    public static func intent(_ input: Input) -> RoutingIntent {
        input.explicitRouteSurfaces == nil ? RoutingIntent.parse(input.request) : RoutingIntent()
    }

    // MARK: Admission

    enum Admission: Equatable { case skip, excluded(String), intentFiltered, admitted }

    /// Checks that need no native probe. A provider with no admitted profile
    /// here is never probed. `reference` asks only whether the profile may be
    /// its pool's reference model: the owner's effort word and a quota
    /// cooldown do not change WHICH model is the top one, only whether it can
    /// run now.
    static func staticAdmission(_ profile: Profile, _ input: Input, _ intent: RoutingIntent,
                                reference: Bool = false) -> Admission {
        guard ["codex", "claude"].contains(profile.provider) else { return .skip }
        guard providerSurfaces(profile.provider).contains(where: { admits(preference: input.providerPreference, surface: $0) }) else { return .skip }
        if profile.provider == "codex", !input.showCodex { return .excluded("codex_hidden") }
        if capacity(profile.provider, input.capacityPlan) == 0,
           !named(profile.provider, preference: input.providerPreference, explicitSurfaces: input.explicitRouteSurfaces) {
            return .excluded("capacity_zero")
        }
        if input.explicitRouteSurfaces == nil, intent.effort == nil, explicitOnlyEfforts.contains(profile.effort) {
            return .excluded("effort_requires_explicit_request")
        }
        let constraint = reference ? RoutingIntent(modelFamily: intent.modelFamily) : intent
        if !constraint.admits(model: profile.model, effort: profile.effort) { return .intentFiltered }
        if normalizedPreference(input.providerPreference) == "claude-chat", !(input.chatLaneEligible && !input.hasMaterialRefs) {
            return .excluded("chat_gate_refused")
        }
        // The provider already rejected this family (or the account) for
        // quota; offering it again only repeats the rejection.
        if !reference, profile.provider == "claude", input.claudeAccountQuotaBackoff ||
            input.claudeQuotaBackoffFamilies.contains(BackendRecovery.claudeModelFamily(profile.model)) {
            return .excluded("quota_backoff")
        }
        return .admitted
    }

    /// The builder's Codex inventory from the host's general catalog, which
    /// removes a quota-exhausted slug for every other caller. Removing it here
    /// would hide that the pool's frontier reference exists but cannot run
    /// (its reference_unavailable explanation), so it is kept and marked
    /// exhausted instead; every profile on it is quota_zero.
    public static func codexInventory(available: [CodexModel], quotaExcluded: [CodexModel])
        -> (models: [CodexModel], quotaExhausted: Set<String>) {
        let present = Set(available.map(\.slug))
        let kept = quotaExcluded.filter { !present.contains($0.slug) }
        return (available + kept, Set(kept.map(\.slug)))
    }

    /// Providers worth a native probe under the current preference, capacity,
    /// visibility, intent and chat gate.
    public static func providersToProbe(_ input: Input) -> Set<String> {
        let intent = intent(input)
        return Set(input.profiles.filter { staticAdmission($0, input, intent) == .admitted }.map(\.provider))
    }

    // MARK: Build

    public static func build(_ input: Input) throws -> Output {
        let intent = intent(input)
        var excluded: [String: [String: Int]] = [:]
        var intentFiltered: [String: Int] = [:]
        func exclude(_ provider: String, _ reason: String) { excluded[provider, default: [:]][reason, default: 0] += 1 }
        let readOnly = input.requireReadOnly || ScopeResolution.resolve(input.request).scope == .readOnly
        let scopes = readOnly ? ["read_only"] : ["read_only", "workspace_write"]
        let chatAllowed = input.chatLaneEligible && !input.hasMaterialRefs
        let nowMS = Int64(input.now.timeIntervalSince1970 * 1000)
        struct Row { var fields: [String: Any]; var provider: String; var model: String; var surface: String; var effort: String; var scope: String; var id: String; var remaining: Double?; var action: String }
        var rows: [Row] = []
        var seen = Set<String>()
        func nativelyAvailable(_ profile: Profile) -> Bool {
            profile.provider == "codex"
                ? input.codexModels.contains { $0.slug == profile.model && $0.supportedEfforts.contains(profile.effort) }
                : input.claudeModels.contains { $0.model == profile.model && $0.supportedEfforts.contains(profile.effort) }
        }
        // Every name of one native Claude row shares that row's rank; Codex
        // models rank by their native priority.
        func nativeRank(_ provider: String, _ model: String) -> Int {
            if provider == "codex" { return input.codexModels.first { $0.slug == model }?.priority ?? Int.max }
            guard let index = input.claudeModels.firstIndex(where: { $0.model == model }) else { return Int.max }
            return input.claudeModels[index].nativeRank ?? index
        }
        // Each pool's reference profiles (see the type comment): its
        // frontier-tier profiles this request may use at all, decided before
        // quota, cooldowns and an effort word.
        var referenceProfiles: [String: Int] = [:]
        for profile in input.profiles where ModelTiers.tier(of: profile.model) == .frontier &&
            staticAdmission(profile, input, intent, reference: true) == .admitted &&
            input.auth[profile.provider] == .subscription && nativelyAvailable(profile) {
            referenceProfiles[profile.provider, default: 0] += 1
        }
        for profile in input.profiles.sorted(by: { $0.action < $1.action }) {
            switch staticAdmission(profile, input, intent) {
            case .skip: continue
            case .excluded(let reason): exclude(profile.provider, reason); continue
            case .intentFiltered: intentFiltered[profile.provider, default: 0] += 1; continue
            case .admitted: break
            }
            switch input.auth[profile.provider] {
            case .subscription: break
            case .nonSubscription: exclude(profile.provider, "non_subscription"); continue
            case .signedOut, nil: exclude(profile.provider, "signed_out"); continue
            }
            guard nativelyAvailable(profile) else { exclude(profile.provider, "model_unavailable"); continue }
            let account = input.accountIDs[profile.provider] ?? ""
            let quota = profile.provider == "codex" ? input.codexQuota : input.claudeQuota
            if profile.provider == "codex", input.codexQuotaExhaustedModels.contains(profile.model) {
                exclude(profile.provider, "quota_zero"); continue
            }
            // Only a fresh observation for this account is quota evidence. A
            // stale, foreign or not-yet-current snapshot is unknown quota: all
            // three quota fields stay null (never an observed time without a
            // validity window, which the catalog contract rejects as a whole).
            let fresh = quota.flatMap { $0.isFresh(accountID: account, now: input.now) ? $0 : nil }
            let remaining = fresh?.effectiveRemaining(accountID: account, model: profile.model, now: input.now)
            if remaining == 0 { exclude(profile.provider, "quota_zero"); continue }
            for scope in scopes {
                let surfaces = scope == "read_only" ? providerSurfaces(profile.provider) : [profile.provider]
                for surface in surfaces {
                    guard admits(preference: input.providerPreference, surface: surface) else { continue }
                    if surface == "claude-chat", !chatAllowed { continue }
                    let tools = surface.hasSuffix("-chat") ? [] : scope == "read_only" ? ["read", "execute"] : ["read", "write", "execute"]
                    let tuple = [surface, profile.provider, account, profile.model, profile.effort, scope,
                                 input.executorContractSHA256].joined(separator: "\n")
                    let digest = RCCRuntimeContract.digest(Data(tuple.utf8))
                    let id = "cfg-" + String(digest.prefix(32))
                    guard seen.insert(id).inserted else { continue }
                    let fields: [String: Any] = ["id": id, "surface": surface,
                        "transport": profile.provider == "codex" ? "codex_app_server" : "claude_cli",
                        "account_id": account, "model": profile.model, "effort": profile.effort, "tools": tools,
                        "scope": scope, "permission_profile": scope,
                        "quota_pool": pool(profile.provider),
                        "allowed_paths": scope == "workspace_write" ? ["**"] : [], "configuration_sha256": digest,
                        "availability": "available", "availability_observed_at_ms": nowMS,
                        "availability_valid_until_ms": Int64(input.now.addingTimeInterval(120).timeIntervalSince1970 * 1000),
                        "quota_remaining_fraction": remaining.map { $0 / 100 as Any } ?? NSNull(),
                        "quota_observed_at_ms": remaining == nil ? NSNull() : fresh.map { Int64($0.observedAt.timeIntervalSince1970 * 1000) as Any } ?? NSNull(),
                        "quota_valid_until_ms": remaining == nil ? NSNull() : fresh.map { Int64($0.observedAt.addingTimeInterval(120).timeIntervalSince1970 * 1000) as Any } ?? NSNull(),
                        "quality_state": "policy_admitted", "estimated_cost_units": NSNull()]
                    rows.append(Row(fields: fields, provider: profile.provider, model: profile.model, surface: surface,
                                    effort: profile.effort, scope: scope, id: id, remaining: remaining.map { $0 / 100 },
                                    action: profile.action))
                }
            }
        }

        // A pool whose frontier (reference) model offers no row now keeps its
        // lower-tier rows for trivial and standard work, and says so: the host
        // never binds it for deep work or a REVAS escalation, and no lower
        // model stands in as its reference. An explicit model family names
        // its own route; an explicit route test keeps its candidate set.
        if input.explicitRouteSurfaces == nil, intent.modelFamily == nil {
            for provider in ["codex", "claude"] where rows.contains(where: { $0.provider == provider }) &&
                !rows.contains(where: { $0.provider == provider && ModelTiers.tier(of: $0.model) == .frontier }) {
                excluded[provider, default: [:]]["reference_unavailable", default: 0] += max(1, referenceProfiles[provider] ?? 0)
            }
        }

        // Within a pool the strongest tier comes first (frontier, workhorse,
        // efficient, fast, then models with no tier), so the pool's first
        // model in catalog order is its reference. Every name of one native
        // Claude row shares that row's rank and tier, so its rows sit
        // together. Within one rank the name with the highest reference
        // effort comes first: an alias with a narrow profile can never hide
        // the max effort configured under another name.
        func modelRank(_ row: Row) -> Int { nativeRank(row.provider, row.model) }
        func tierRank(_ row: Row) -> Int { ModelTiers.rank(row.model) }
        func effortRank(_ effort: String) -> Int { effortOrder.firstIndex(of: effort) ?? Int.max }
        // The host's reference effort of one model: its highest offered effort
        // up to max; above max only when nothing else is offered (an explicit
        // ultra request). Same rule as `referenceEffort` in rcc-runtime.mjs.
        var offeredEfforts: [String: [Int]] = [:]
        for row in rows { offeredEfforts[row.provider + "\0" + row.model, default: []].append(effortRank(row.effort)) }
        let maximumReference = effortRank(maximumReferenceEffort)
        func referenceRank(_ row: Row) -> Int {
            let offered = offeredEfforts[row.provider + "\0" + row.model] ?? []
            return offered.filter { $0 <= maximumReference }.max() ?? offered.max() ?? -1
        }
        func modelKeyLess(_ a: Row, _ b: Row) -> Bool {
            if tierRank(a) != tierRank(b) { return tierRank(a) < tierRank(b) }
            if modelRank(a) != modelRank(b) { return modelRank(a) < modelRank(b) }
            if referenceRank(a) != referenceRank(b) { return referenceRank(a) > referenceRank(b) }
            return a.model < b.model
        }
        // Pool order: share x remaining / hours-to-reset, unknown quota last.
        // A pool is scored by its first model in catalog order: its frontier
        // reference when it has one (else its strongest remaining tier), not
        // by the model with the most quota left. With model-scoped windows
        // those differ, and scoring the wrong one would spend a nearly
        // exhausted model while the other pool has room. That order serves
        // deep work and escalations; every offered model's own score is also
        // emitted (`quota_scores`), so trivial and standard work, which bind a
        // lower tier, rank pools by the model they actually spend.
        func scoreParts(_ row: Row) -> (share: Double, hours: Double, resetUnknown: Bool, score: Double?) {
            let share = Double(capacity(row.provider, input.capacityPlan)) / 100
            let quota = row.provider == "codex" ? input.codexQuota : input.claudeQuota
            let reset = quota?.limitingReset(accountID: input.accountIDs[row.provider] ?? "", model: row.model, now: input.now)
            let hours = reset.map { max(0, $0.timeIntervalSince(input.now) / 3600) } ?? 168
            return (share, hours, reset == nil, row.remaining.map { share * $0 / max(hours, 1) })
        }
        var rankings: [PoolRanking] = []
        var quotaScores: [String: Int] = [:]
        for row in rows where quotaScores[row.model] == nil {
            if let score = scoreParts(row).score, score.isFinite, score >= 0 {
                quotaScores[row.model] = Int((min(score, 1) * 1_000_000_000).rounded())
            }
        }
        for provider in ["codex", "claude"] {
            let poolRows = rows.filter { $0.provider == provider }
            guard let best = poolRows.min(by: modelKeyLess) else { continue }
            let parts = scoreParts(best)
            rankings.append(PoolRanking(pool: pool(provider), share: parts.share, remainingFraction: best.remaining,
                                        hoursToReset: parts.hours, resetUnknown: parts.resetUnknown, score: parts.score))
        }
        rankings.sort { a, b in
            switch (a.score, b.score) {
            case let (x?, y?) where x != y: return x > y
            case (.some, nil): return true
            case (nil, .some): return false
            default: return a.pool == "openai_codex" && b.pool != "openai_codex"
            }
        }
        let poolRank = Dictionary(uniqueKeysWithValues: rankings.enumerated().map { ($0.element.pool, $0.offset) })
        rows.sort { a, b in
            let poolA = poolRank[pool(a.provider)] ?? Int.max, poolB = poolRank[pool(b.provider)] ?? Int.max
            if poolA != poolB { return poolA < poolB }
            if a.model != b.model { return modelKeyLess(a, b) }
            let tailA = [a.surface == "claude" ? 1 : 0, effortRank(a.effort), a.scope == "read_only" ? 0 : 1]
            let tailB = [b.surface == "claude" ? 1 : 0, effortRank(b.effort), b.scope == "read_only" ? 0 : 1]
            if tailA != tailB { return tailA.lexicographicallyPrecedes(tailB) }
            return a.id < b.id
        }

        if ["gpt-chat", "chatgpt"].contains(input.providerPreference) { exclude("codex", "gpt_dropped") }
        if rows.isEmpty, !intent.isEmpty {
            for (provider, count) in intentFiltered where count > 0 && excluded[provider]?["explicit_constraint_unavailable"] == nil {
                excluded[provider, default: [:]]["explicit_constraint_unavailable", default: 0] += count
            }
        }
        var exclusions: [RCCRuntimeContract.Exclusion] = []
        for provider in excluded.keys.sorted() {
            for (reason, count) in excluded[provider, default: [:]].sorted(by: { $0.key < $1.key }) {
                exclusions.append(.init(provider: provider, reason: reason, count: min(count, 10_000)))
            }
        }
        guard rows.count <= maximumCandidates else { throw Failure.exceedsBound(rows.count) }
        guard !rows.isEmpty || !exclusions.isEmpty else { throw Failure.unexplainedEmptyCatalog }
        var tiers: [String: String] = [:]
        for row in rows { if let tier = ModelTiers.tier(of: row.model) { tiers[row.model] = tier.rawValue } }
        return Output(candidates: rows.map(\.fields), exclusions: exclusions, pools: rankings, intent: intent,
                      modelTiers: tiers, quotaScores: quotaScores,
                      explicitRouteIntents: input.explicitRouteSurfaces == nil ? nil : input.explicitRouteIntents)
    }

    /// The exact catalog bytes `os1 rcc-catalog` prints. `exclusions` appears
    /// only when non-empty and `routing_intent` only with an explicit owner
    /// constraint. `model_tiers` (build 378) appears whenever there is a
    /// candidate, possibly empty: an empty map tells the core that no offered
    /// model has a tier, so nothing is routed by tier (a catalog without the
    /// key is an older catalog and keeps the former reference routing).
    public static func catalogData(_ output: Output, taskID: String, requestSHA256: String) throws -> Data {
        var object: [String: Any] = ["schema": 1, "task_id": taskID, "request_sha256": requestSHA256,
                                     "candidates": output.candidates]
        if !output.exclusions.isEmpty {
            object["exclusions"] = output.exclusions.map { ["provider": $0.provider, "reason": $0.reason, "count": $0.count] }
        }
        if !output.intent.isEmpty {
            object["routing_intent"] = ["effort": output.intent.effort.map { $0 as Any } ?? NSNull(),
                                        "model_family": output.intent.modelFamily.map { $0 as Any } ?? NSNull()]
        }
        if !output.candidates.isEmpty { object["model_tiers"] = output.modelTiers }
        // Build 378, both optional: per-model pool scores (known quota only),
        // and an explicit route test's own per-route words (only when some
        // route carries one; aligned with the original route list).
        if !output.candidates.isEmpty, !output.quotaScores.isEmpty { object["quota_scores"] = output.quotaScores }
        if !output.candidates.isEmpty, let intents = output.explicitRouteIntents, intents.contains(where: { !$0.isEmpty }) {
            object["explicit_route_intents"] = intents.map { intent -> Any in
                intent.isEmpty ? NSNull() : ["effort": intent.effort.map { $0 as Any } ?? NSNull(),
                                             "model_family": intent.modelFamily.map { $0 as Any } ?? NSNull()]
            }
        }
        return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
    }
}
