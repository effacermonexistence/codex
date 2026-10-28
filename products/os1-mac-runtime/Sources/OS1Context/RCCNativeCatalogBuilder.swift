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
/// - Every signed, natively supported known effort stays available, including
///   ultra/ultracode. The reference uses the native frontier's highest supported
///   effort, not a fixed max ceiling. Lower efforts and lower-tier models stay:
///   the host still routes each graded node to the cheapest adequate tier.
/// - An explicit route test (`explicitRouteSurfaces` set) keeps its former
///   candidate set: the whole fan-out sentence is not read as one intent, and
///   no effort is withheld; only GPT, capacity and the chat gate apply. Each
///   route's OWN effort/model words travel separately
///   (`explicit_route_intents`): the host binds each named route's model and
///   effort by its grade on that route's surface. An explicit effort word is
///   exact; without one the same native reference ceiling applies.
/// - `claude-chat` rows exist only when the narrow chat-lane predicate holds.
/// - A `local` row (2026-10-14) exists only in an explicit route test that
///   names the local surface: the one tools-free, read-only, quota-free row of
///   the model OpenClaw already runs (`localWorkerModel`), available only when
///   the host's live readiness probe found it (`localModel`), unavailable when
///   it did not. Auto gets one only for very easy chat (build 441 part 2,
///   owner order 2026-10-27: `autoLocalRowEligible`); ordinary work is
///   never routed to the local model.
/// - An active Claude quota cooldown (`ClaudeQuotaBackoff`, left by a real
///   execution rejection) excludes the cooled family, or every Claude profile
///   when it is account-wide, with `quota_backoff`; it is never probed. An
///   active Codex model cooldown (`CodexQuotaBackoff`) excludes that model
///   the same way.
/// - Every row's model carries its provider-stated tier (`ModelTiers`) in the
///   catalog's `model_tiers` (build 378). A pool's REFERENCE is its
///   frontier-tier model at its highest known native-supported effort, never
///   the first model in the native list (gpt-6.1-sol and opus are workhorses).
///   Lower tiers are no longer withheld: they carry trivial and standard work.
///   A pool whose frontier model offers no row now (absent, quota_zero,
///   quota_backoff, or no profile at the owner's effort word) keeps its lower
///   rows and records `reference_unavailable`: the host then never binds that
///   pool for deep work or a REVAS escalation, and nothing lower stands in.
///   This also holds when that model has a lower row but its native ceiling
///   has no signed/admitted row. An explicit effort fixes its own ceiling;
///   an explicit model family or route test names its own route instead.
/// - Every excluded profile is counted per provider and reason, so an empty
///   catalog is an explained hold, not an opaque binding error.
/// - K14: in Auto (no route test, model family or exact model) a pool that
///   offers rows of an UNCLASSIFIED model (`ModelTiers.classification`: in
///   neither the tier table nor `knownUntiered`) records the informational
///   exclusion `unclassified_model` (count: distinct such models). Nothing
///   else changes: the model keeps its rows (sorted last, no `model_tiers`
///   entry), is never a reference, a certified descent or an escalation
///   target, and stays usable only through the owner's words. It never
///   explains an empty catalog or a hold; the core marks every model-backed
///   delivery `reference_review_required` instead.
public enum RCCNativeCatalogBuilder {
    public static let maximumCandidates = 256
    public static let effortOrder = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"]
    /// The local model OpenClaw runs (`LocalRouterBridge.model`, the planner's
    /// model) and the one local execution row's fixed identity.
    public static let localWorkerModel = "qwen3.5:4b"
    public static let localWorkerAccount = "os1-local"

    /// The host's live readiness probe of the local model (the pinned model
    /// at its pinned digest in the loopback inventory), observed at `at`.
    public struct LocalModelObservation: Equatable, Sendable {
        public var ready: Bool
        public var at: Date
        public init(ready: Bool, at: Date) { self.ready = ready; self.at = at }
    }

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
        /// Host-only opt-in. No ingress/config caller enables it in this patch.
        /// Both this capability and the immutable new-task marker are needed.
        public var enableRoutingIntentV2 = false
        public var routingIntentPolicyVersion: String? = nil
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
        /// Codex models with an active cooldown (`CodexQuotaBackoff`), left
        /// by a real rate-limit or usage-limit rejection of that model. Like
        /// a cooled Claude family they are excluded with `quota_backoff`;
        /// they still define the pool's reference, so a cooled frontier
        /// model leaves its pool `reference_unavailable`.
        public var codexQuotaBackoffModels: Set<String> = []
        /// The surfaces an explicit route test names, or nil outside one.
        public var explicitRouteSurfaces: [String]? = nil
        /// Each explicit route's OWN effort/model words
        /// (`RoutingIntent.parse` of that route's payload), aligned with the
        /// host's original explicit route list; nil outside an explicit route
        /// test. One route's words never constrain another route.
        public var explicitRouteIntents: [RoutingIntent]? = nil
        /// The local model's readiness, probed only when an explicit route
        /// names the local surface; nil otherwise (no local row).
        public var localModel: LocalModelObservation? = nil
        /// Build 407 (R2): the host's `ownerRequestRunsReadOnly` verdict for
        /// the request. Nil (callers before 407) emits no admission facts.
        public var ownerScope: RCCRuntimeContract.Scope? = nil
        /// Build 407 (R0(a)): an owner contract the host re-bound at catalog time.
        public var taskContract: RCCRuntimeContract.TaskContractFact? = nil
        /// Build 407 (R0(c), R11): the signed class table. Build 440 ships one
        /// certificate, `chat_explanatory`, whose basis is the compiled owner
        /// decision (`RCCClassOwnerDecision`), not a D4 measurement.
        public var classTable: RCCClassTable = .frozen
        /// K11: host-read D4 measurement artifacts, keyed by the
        /// `measurement_sha256` a table certificate names. Observations only:
        /// a certificate is emitted only when its artifact verifies
        /// (`RCCClassMeasurement.verified`).
        public var classMeasurements: [String: Data] = [:]
        /// K11: the harness scope this catalog's dispatches run under
        /// (`RCCClassMeasurement.harnessScope`). Nil loads no certificate.
        public var harnessProfile: String? = nil
        /// Build 441: the host's deterministic `RequestProfile` of the request
        /// (`RequestProfile.classify` with the host's shell and material
        /// facts). Emitted beside the admission facts only; nil emits none.
        /// Part 2: the host passes the combined profile
        /// (`RequestProfile.combine`, keyword rails first, then the local
        /// classifier's reading).
        public var requestProfile: RequestProfile? = nil
        /// Build 441 part 2: list prices (`ModelPriceTable.current()`). Each
        /// priced row's `estimated_cost_units` is then the USD of one typical
        /// OS-1 call on its model (`callUSD`, rounded to a millionth), the
        /// local model's row 0; nil (and an unpriced model) keeps null. A
        /// relative cost signal for Core's price-aware choice, never a quota
        /// or quality claim.
        public var priceTable: ModelPriceTable? = nil
        /// Build 442 (owner order 2026-10-27, DESIGN-3): the compiled
        /// capability table. With a profile whose local-classifier domain is
        /// known (and no strongest-model words), the catalog carries that
        /// domain's qualifying rows (`capability_routes`) for Core's deep
        /// nodes; nil emits none.
        public var capabilityTable: ModelCapabilityTable? = nil
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
        public var intentV2: RCCRuntimeContract.RoutingIntentV2? = nil
        /// Tier of every tiered model in `candidates` (`ModelTiers`).
        public var modelTiers: [String: String] = [:]
        /// Per offered model with known quota: the same pool score the pool
        /// order uses (capacity share x that model's own remaining quota /
        /// hours to its own reset, at most 1), in integer parts per billion so
        /// both sides compare exact values, so the host can rank pools by the
        /// model a node actually binds (build 378), not by another model's quota.
        public var quotaScores: [String: Int] = [:]
        /// The highest known native effort of each represented model, before
        /// signed-profile/quota filtering. Metadata only, never a new row or
        /// execution permission. Names of an evidenced native Claude alias row
        /// share its ceiling; unrelated models do not.
        public var nativeReferenceEfforts: [String: [String: String]] = [:]
        /// An explicit route test's per-route intents (see Input).
        public var explicitRouteIntents: [RoutingIntent]? = nil
        /// Build 407 admission facts (see `admissionFacts`); nil before 407.
        public var admission: AdmissionFacts? = nil
    }
    /// Build 407: what the Core admission law reads besides the rows. Facts
    /// only: no row is added, removed or reordered by them.
    public struct AdmissionFacts: Equatable, Sendable {
        public var ownerScope: RCCRuntimeContract.Scope
        public var chatLaneEligible: Bool
        public var requestClass: RCCRuntimeContract.RequestClass
        public var taskContract: RCCRuntimeContract.TaskContractFact?
        public var classCertificate: RCCRuntimeContract.ClassCertificate?
        public var classProviderPin: String?
        /// K11 diagnostics, never on the wire: why this class's table
        /// certificate was not loaded (nil when loaded or when none exists).
        public var classCertificateRejection: RCCClassMeasurement.Rejection? = nil
        /// Build 441: the host's request profile, a routing fact for Core's
        /// graded admission (never a certificate); nil emits none.
        public var requestProfile: RequestProfile? = nil
        /// Build 442: the profile's domain's capability-qualified rows
        /// (`capabilityRoutes(_:)`), a routing fact for Core's deep nodes,
        /// never a certificate; nil emits none.
        public var capabilityRoutes: RCCRuntimeContract.CapabilityRoutes? = nil
    }
    public enum Failure: Error, Equatable {
        /// Never truncate: an oversize inventory is an explicit boundary.
        case exceedsBound(Int)
        /// No row and no recorded reason (no configured profile for the
        /// admitted providers): a malformed configuration, not a hold reason.
        case unexplainedEmptyCatalog
        case intentPolicyUnavailable
        case intentUnresolved
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
        if input.routingIntentPolicyVersion != nil { return RoutingIntent() }
        return input.explicitRouteSurfaces == nil ? RoutingIntent.parse(input.request) : RoutingIntent()
    }
    static func intentV2(_ input: Input) -> RCCRuntimeContract.RoutingIntentV2? {
        guard input.enableRoutingIntentV2,
              input.routingIntentPolicyVersion == RCCRuntimeContract.RoutingIntentV2.version,
              input.explicitRouteSurfaces == nil else { return nil }
        let known = Set(input.profiles.map(\.model) + input.codexModels.map(\.slug) + input.claudeModels.map(\.model))
        return RoutingIntent.parseV2(input.request, knownModelIDs: known)
    }

    // MARK: Admission

    enum Admission: Equatable { case skip, excluded(String), intentFiltered, admitted }

    /// Checks that need no native probe. A provider with no admitted profile
    /// here is never probed. `reference` asks only whether the profile may be
    /// its pool's reference model: the owner's effort word and a quota
    /// cooldown do not change WHICH model is the top one, only whether it can
    /// run now.
    static func staticAdmission(_ profile: Profile, _ input: Input, _ intent: RoutingIntent,
                                reference: Bool = false, v2: RCCRuntimeContract.RoutingIntentV2? = nil) -> Admission {
        guard ["codex", "claude"].contains(profile.provider) else { return .skip }
        guard providerSurfaces(profile.provider).contains(where: { admits(preference: input.providerPreference, surface: $0) }) else { return .skip }
        if profile.provider == "codex", !input.showCodex { return .excluded("codex_hidden") }
        if capacity(profile.provider, input.capacityPlan) == 0,
           !named(profile.provider, preference: input.providerPreference, explicitSurfaces: input.explicitRouteSurfaces) {
            return .excluded("capacity_zero")
        }
        // Unknown effort names have no ordered/executable meaning in the
        // current contract, even if a native inventory happens to echo them.
        // They never become a fabricated higher or lower reference.
        if input.routingIntentPolicyVersion != nil {
            guard let v2, v2.valid, v2.state == "resolved" else { return .skip }
            if !v2.allowedSurfaces.isEmpty && !providerSurfaces(profile.provider).contains(where: v2.allowedSurfaces.contains) {
                return .intentFiltered
            }
            if let model = v2.exactModel, model != profile.model { return .intentFiltered }
            if let family = v2.modelFamily, !RoutingIntent.model(profile.model, belongsTo: family) { return .intentFiltered }
            if !reference, let effort = v2.effort, effort != profile.effort { return .intentFiltered }
        }
        guard effortOrder.contains(profile.effort) else { return .excluded("model_unavailable") }
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
        if !reference, profile.provider == "codex", input.codexQuotaBackoffModels.contains(profile.model) {
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

    // MARK: Admission facts (build 407)

    /// A scope hint is not write authority. Only a registered owner contract
    /// rechecked by RCCCatalogFacts for this objective/context/source/tree/
    /// policy can resolve a conservative text-classifier ambiguity. A public
    /// draft is not registered authority, nor is partial test coverage quality
    /// parity. Host read-only always wins; conflicting owner/chat facts do
    /// not authorize an override of the existing conservative classifier.
    private static func catalogReadOnly(_ input: Input) -> Bool {
        if input.requireReadOnly { return true }
        if let bound = input.taskContract, bound.bindingsChecked,
           bound.objectiveSHA256 == input.requestSHA256,
           bound.validUntilMS > Int64(input.now.timeIntervalSince1970 * 1000),
           [bound.contractSHA256, bound.contextSHA256, bound.startTreeSHA256,
            bound.referencePolicySHA256].allSatisfy(RCCRuntimeContract.isHash),
           bound.sourceSHA256.map(RCCRuntimeContract.isHash) ?? true {
            if bound.scope == .readOnly { return true }
            if bound.scope == .workspaceWrite, input.ownerScope == .workspaceWrite,
               !input.chatLaneEligible, input.explicitRouteSurfaces == nil { return false }
        }
        return ScopeResolution.resolve(input.request).scope == .readOnly
    }

    /// The deterministic request class (R0/R2), from host predicates only:
    /// an explicit route test first; then the R2 scope (read-only when the
    /// catalog offers no writer row (the host requires read-only, or the
    /// request's own resolved scope is read-only), the owner request runs
    /// read-only, or the chat lane takes it); read-only work splits into a
    /// self-contained text operation, a chat-lane question, work over
    /// attached material, or a lookup. A writer class therefore always has
    /// writer rows to bind. Build 408 narrows `chat_explanatory` to
    /// explanatory interrogatives.
    public static func requestClass(explicitRoute: Bool, catalogReadOnly: Bool, ownerScope: RCCRuntimeContract.Scope,
                                    chatLaneEligible: Bool, textOperation: Bool, hasMaterial: Bool)
        -> RCCRuntimeContract.RequestClass {
        if explicitRoute { return .explicitRoute }
        guard catalogReadOnly || ownerScope == .readOnly || chatLaneEligible else { return .writer }
        if chatLaneEligible { return textOperation ? .textOperation : .chatExplanatory }
        return hasMaterial ? .readonlyMaterial : .readonlyLookup
    }

    /// The admission facts for `input`, or nil when the host gave no owner
    /// scope. A contract or certificate is carried only as found; the table's
    /// entries for other classes never reach the catalog. K11: this class's
    /// table certificate is carried only when `RCCClassMeasurement.verified`
    /// admits it against the pool's current reference (`references`, computed
    /// once in `build`): by its D4 measurement artifact, or, for the build-440
    /// `chat_explanatory` certificate only, by the compiled owner decision
    /// (`RCCClassOwnerDecision`); a caller passing none never gets a certificate.
    public static func admissionFacts(_ input: Input,
                                      references: [String: RCCClassMeasurement.Reference] = [:]) -> AdmissionFacts? {
        guard let ownerScope = input.ownerScope else { return nil }
        let requestClass = requestClass(explicitRoute: input.explicitRouteSurfaces != nil,
            catalogReadOnly: catalogReadOnly(input),
            ownerScope: ownerScope, chatLaneEligible: input.chatLaneEligible,
            textOperation: ClaudeChatLane.selfContainedTextOperation(input.request), hasMaterial: input.hasMaterialRefs)
        var certificate: RCCRuntimeContract.ClassCertificate? = nil
        var rejection: RCCClassMeasurement.Rejection? = nil
        if let signed = input.classTable.certificate(for: requestClass) {
            // The owner decision's own scope inside its class (build 440 lead
            // narrowing): a request that is not a state-only check-in drops
            // the certificate and binds the reference.
            if signed.measurementSHA256 == RCCClassOwnerDecision.pinnedSHA256,
               !RCCClassOwnerDecision.admits(request: input.request) {
                rejection = .scopeMismatch
            } else {
                switch RCCClassMeasurement.verified(signed, requestClass: requestClass,
                    artifact: input.classMeasurements[signed.measurementSHA256], now: input.now,
                    executorContractSHA256: input.executorContractSHA256, harnessProfile: input.harnessProfile,
                    reference: references[signed.provider]) {
                case .success(let verified): certificate = verified
                case .failure(let reason): rejection = reason
                }
            }
        }
        return AdmissionFacts(ownerScope: ownerScope, chatLaneEligible: input.chatLaneEligible, requestClass: requestClass,
                         taskContract: input.taskContract, classCertificate: certificate,
                         classProviderPin: input.classTable.providerPin(for: requestClass), classCertificateRejection: rejection,
                         requestProfile: input.requestProfile, capabilityRoutes: capabilityRoutes(input))
    }

    /// Build 442 (owner order 2026-10-27, DESIGN-3): the capability-qualified
    /// rows the catalog carries, only for an Auto request (no explicit route
    /// test) whose profile the local classifier read with a known domain and
    /// that does not ask for the strongest model or more thinking (those
    /// words keep the reference; review of 442: in any of their common word
    /// orders and inflections, `asksForReference`). Core decides whether the
    /// node is deep work.
    public static func capabilityRoutes(_ input: Input) -> RCCRuntimeContract.CapabilityRoutes? {
        guard input.explicitRouteSurfaces == nil, let table = input.capabilityTable, let profile = input.requestProfile,
              profile.locallyClassified, let domain = profile.domain, !profile.signals.contains("quality_request"),
              !RequestProfile.asksForReference(input.request) else { return nil }
        return table.routes(for: domain)
    }

    /// Providers worth a native probe under the current preference, capacity,
    /// visibility, intent and chat gate.
    public static func providersToProbe(_ input: Input) -> Set<String> {
        let intent = intent(input), v2 = intentV2(input)
        return Set(input.profiles.filter { staticAdmission($0, input, intent, v2: v2) == .admitted }.map(\.provider))
    }

    // MARK: Build

    public static func build(_ input: Input) throws -> Output {
        let v2 = intentV2(input)
        if input.routingIntentPolicyVersion != nil {
            guard let v2, v2.valid else { throw Failure.intentPolicyUnavailable }
            guard v2.state == "resolved" else { throw Failure.intentUnresolved }
        }
        let intent = intent(input)
        var excluded: [String: [String: Int]] = [:]
        var intentFiltered: [String: Int] = [:]
        func exclude(_ provider: String, _ reason: String) { excluded[provider, default: [:]][reason, default: 0] += 1 }
        let readOnly = catalogReadOnly(input)
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
        func nativeEfforts(_ provider: String, _ model: String) -> Set<String> {
            let observed: [String]
            if provider == "codex" {
                observed = input.codexModels.first { $0.slug == model }?.supportedEfforts ?? []
            } else if let native = input.claudeModels.first(where: { $0.model == model }) {
                // Only an explicitly shared native-row identity proves alias
                // equivalence. Equal ordinal fallback values are not evidence
                // that unrelated model rows share capabilities.
                if let rank = native.nativeRank {
                    observed = input.claudeModels.filter { $0.nativeRank == rank }.flatMap(\.supportedEfforts)
                } else { observed = native.supportedEfforts }
            } else { observed = [] }
            return Set(observed).intersection(effortOrder)
        }
        func nativeMaximum(_ provider: String, _ model: String) -> String? {
            let supported = nativeEfforts(provider, model)
            return effortOrder.last(where: supported.contains)
        }
        // Each pool's reference profiles (see the type comment): its
        // frontier-tier profiles this request may use at all, decided before
        // quota, cooldowns and an effort word.
        var referenceProfiles: [String: Int] = [:]
        for profile in input.profiles where ModelTiers.tier(of: profile.model) == .frontier &&
            staticAdmission(profile, input, intent, reference: true, v2: v2) == .admitted &&
            input.auth[profile.provider] == .subscription && nativelyAvailable(profile) {
            referenceProfiles[profile.provider, default: 0] += 1
        }
        for profile in input.profiles.sorted(by: { $0.action < $1.action }) {
            switch staticAdmission(profile, input, intent, v2: v2) {
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
            // Quota evidence for this account: a fresh observation as observed
            // (valid 120 s, unchanged), or one retained after a failed refresh
            // as a conservative estimate (`QuotaSnapshot.estimate`: discounted,
            // true observedAt, valid at most ten minutes and never past a
            // reset). Anything else (foreign, future-dated, reset-crossed,
            // older than ten minutes, or estimated at/below the floor) is
            // unknown: all three quota fields stay null (never an observed
            // time without a validity window, which the contract rejects).
            let estimate = quota?.estimate(accountID: account, model: profile.model, now: input.now)
            let remaining = estimate?.remainingPercent
            if remaining == 0 { exclude(profile.provider, "quota_zero"); continue }
            for scope in scopes {
                let surfaces = scope == "read_only" ? providerSurfaces(profile.provider) : [profile.provider]
                for surface in surfaces {
                    guard admits(preference: input.providerPreference, surface: surface) else { continue }
                    if let v2, !v2.allowedSurfaces.isEmpty, !v2.allowedSurfaces.contains(surface) { continue }
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
                        "quota_observed_at_ms": estimate.map { Int64($0.observedAt.timeIntervalSince1970 * 1000) as Any } ?? NSNull(),
                        "quota_valid_until_ms": estimate.map { Int64($0.validUntil.timeIntervalSince1970 * 1000) as Any } ?? NSNull(),
                        "quality_state": "policy_admitted", "estimated_cost_units": estimatedCost(input, model: profile.model)]
                    rows.append(Row(fields: fields, provider: profile.provider, model: profile.model, surface: surface,
                                    effort: profile.effort, scope: scope, id: id, remaining: remaining.map { $0 / 100 },
                                    action: profile.action))
                }
            }
        }

        // Establish the reference ceiling from native capabilities BEFORE
        // signed-profile, quota and cooldown filtering. A signed max row must
        // not silently stand in when the same native frontier supports ultra
        // but no admitted ultra row exists. Native-rank aliases describe one
        // Claude model, so any observed name can supply that same ceiling.
        // Explicit effort remains exact and is not raised to the Auto ceiling.
        func referenceAvailable(_ provider: String) -> Bool {
            let inventory: [(model: String, efforts: [String], rank: Int)] = provider == "codex"
                ? input.codexModels.map { ($0.slug, $0.supportedEfforts, $0.priority) }
                : input.claudeModels.enumerated().map { ($0.element.model, $0.element.supportedEfforts, $0.element.nativeRank ?? $0.offset) }
            let frontiers = inventory.filter { ModelTiers.tier(of: $0.model) == .frontier }.sorted { a, b in
                if a.rank != b.rank { return a.rank < b.rank }
                let aCeiling = nativeMaximum(provider, a.model).flatMap { effortOrder.firstIndex(of: $0) } ?? -1
                let bCeiling = nativeMaximum(provider, b.model).flatMap { effortOrder.firstIndex(of: $0) } ?? -1
                return aCeiling != bCeiling ? aCeiling > bCeiling : a.model < b.model
            }
            guard let frontier = frontiers.first else { return false }
            let supported = nativeEfforts(provider, frontier.model)
            guard let ceiling = v2?.effort ?? intent.effort ?? nativeMaximum(provider, frontier.model),
                  supported.contains(ceiling) else { return false }
            // Only aliases with an actual shared native row may satisfy this
            // model's ceiling; equal Codex priority is not alias evidence.
            let names: Set<String>
            if provider == "claude", let native = input.claudeModels.first(where: { $0.model == frontier.model }),
               let rank = native.nativeRank {
                names = Set(input.claudeModels.filter { $0.nativeRank == rank }.map(\.model))
            } else { names = [frontier.model] }
            return rows.contains { $0.provider == provider && names.contains($0.model) && $0.effort == ceiling }
        }
        // Lower tiers remain usable for cheap work. Only automatic deep work
        // and REVAS reference escalation are held by this existing exclusion.
        // No model/effort is fabricated and candidate identities are unchanged.
        if input.explicitRouteSurfaces == nil, intent.modelFamily == nil, v2?.exactModel == nil, v2?.modelFamily == nil {
            for provider in ["codex", "claude"] where rows.contains(where: { $0.provider == provider }) &&
                !referenceAvailable(provider) {
                excluded[provider, default: [:]]["reference_unavailable", default: 0] += max(1, referenceProfiles[provider] ?? 0)
            }
            // K14, informational only: an offered model OS-1 cannot classify.
            // Counted from rows, so it never stands alone in an empty catalog.
            for provider in ["codex", "claude"] {
                let unclassified = Set(rows.filter { $0.provider == provider &&
                    ModelTiers.classification(of: $0.model) == .unclassified }.map(\.model))
                if !unclassified.isEmpty { excluded[provider, default: [:]]["unclassified_model"] = unclassified.count }
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
        // The host's reference effort of one model: its highest offered known
        // effort without a fixed max cap. Same ordered-ceiling rule as
        // `referenceEffort` in rcc-runtime.mjs; a missing native ceiling is
        // separately held by reference_unavailable above.
        var offeredEfforts: [String: [Int]] = [:]
        for row in rows { offeredEfforts[row.provider + "\0" + row.model, default: []].append(effortRank(row.effort)) }
        func referenceRank(_ row: Row) -> Int {
            let offered = offeredEfforts[row.provider + "\0" + row.model] ?? []
            return offered.max() ?? -1
        }
        func modelKeyLess(_ a: Row, _ b: Row) -> Bool {
            if tierRank(a) != tierRank(b) { return tierRank(a) < tierRank(b) }
            if modelRank(a) != modelRank(b) { return modelRank(a) < modelRank(b) }
            let aCeiling = nativeMaximum(a.provider, a.model).flatMap { effortOrder.firstIndex(of: $0) } ?? -1
            let bCeiling = nativeMaximum(b.provider, b.model).flatMap { effortOrder.firstIndex(of: $0) } ?? -1
            if aCeiling != bCeiling { return aCeiling > bCeiling }
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
            let reset = quota?.estimate(accountID: input.accountIDs[row.provider] ?? "", model: row.model, now: input.now)?.limitingReset
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

        // K11: each pool's current reference, the one a class measurement
        // must have been taken against: the pool's first frontier model in
        // catalog order at that model's native ceiling, with an offered row
        // (the core's frontier reference); none when the pool records
        // reference_unavailable.
        var references: [String: RCCClassMeasurement.Reference] = [:]
        for provider in ["codex", "claude"] where excluded[provider]?["reference_unavailable"] == nil {
            guard let frontier = rows.first(where: { $0.provider == provider && ModelTiers.tier(of: $0.model) == .frontier }),
                  let ceiling = nativeMaximum(provider, frontier.model),
                  rows.contains(where: { $0.provider == provider && $0.model == frontier.model && $0.effort == ceiling })
            else { continue }
            references[provider] = .init(provider: provider, model: frontier.model, effort: ceiling)
        }

        if ["gpt-chat", "chatgpt"].contains(input.providerPreference) { exclude("codex", "gpt_dropped") }
        if rows.isEmpty, !intent.isEmpty || v2 != nil {
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
        let local = localRow(input)
        guard rows.count + local.count <= maximumCandidates else { throw Failure.exceedsBound(rows.count + local.count) }
        guard !rows.isEmpty || !local.isEmpty || !exclusions.isEmpty else { throw Failure.unexplainedEmptyCatalog }
        var tiers: [String: String] = [:]
        var nativeReferenceEfforts: [String: [String: String]] = [:]
        for row in rows {
            if let tier = ModelTiers.tier(of: row.model) { tiers[row.model] = tier.rawValue }
            if let ceiling = nativeMaximum(row.provider, row.model) {
                nativeReferenceEfforts[row.provider, default: [:]][row.model] = ceiling
            }
        }
        return Output(candidates: rows.map(\.fields) + local, exclusions: exclusions, pools: rankings, intent: intent, intentV2: v2,
                      modelTiers: tiers, quotaScores: quotaScores, nativeReferenceEfforts: nativeReferenceEfforts,
                      explicitRouteIntents: input.explicitRouteSurfaces == nil ? nil : input.explicitRouteIntents,
                      admission: admissionFacts(input, references: references))
    }

    /// Build 441 part 2: one row's estimated USD for a typical call, or null.
    static func estimatedCost(_ input: Input, model: String) -> Any {
        guard let table = input.priceTable, let usd = table.callUSD(model: model), usd.isFinite, usd >= 0 else { return NSNull() }
        return (usd * 1_000_000).rounded() / 1_000_000
    }
    /// Build 441 part 2 (owner order 2026-10-27): Auto offers the local row
    /// only for very easy chat: a combined profile the local classifier read
    /// as chat, light and tool-free (`RequestProfile.answersLocally`), with
    /// no material, under the Auto preference. Core binds it as a graded
    /// route below a runnable reference, never certified.
    public static func autoLocalRowEligible(_ input: Input) -> Bool {
        input.explicitRouteSurfaces == nil && !input.hasMaterialRefs &&
            normalizedPreference(input.providerPreference) == "auto" && input.requestProfile?.answersLocally == true
    }
    /// The local execution row of an explicit route test that names the local
    /// surface, or (build 441 part 2) of an Auto chat request
    /// (`autoLocalRowEligible`); empty otherwise, and when the host did not
    /// probe the model: read-only, no tools, no quota pool, transport
    /// `local`, effort none.
    /// Its identity is fixed by its configuration, so a catalog refresh before
    /// dispatch finds the same row; its availability is the probe's own
    /// result for two minutes from the probe, never assumed.
    static func localRow(_ input: Input) -> [[String: Any]] {
        guard input.explicitRouteSurfaces?.contains("local") == true || autoLocalRowEligible(input),
              let observed = input.localModel else { return [] }
        let tuple = ["local", "local", localWorkerAccount, localWorkerModel, "none", "read_only",
                     input.executorContractSHA256].joined(separator: "\n")
        let digest = RCCRuntimeContract.digest(Data(tuple.utf8))
        let at = Int64(observed.at.timeIntervalSince1970 * 1000)
        return [["id": "cfg-" + String(digest.prefix(32)), "surface": "local", "transport": "local",
                 "account_id": localWorkerAccount, "model": localWorkerModel, "effort": "none", "tools": [String](),
                 "scope": "read_only", "permission_profile": "read_only", "quota_pool": "none",
                 "allowed_paths": [String](), "configuration_sha256": digest,
                 "availability": observed.ready ? "available" : "unavailable",
                 "availability_observed_at_ms": at, "availability_valid_until_ms": at + 120_000,
                 "quota_remaining_fraction": NSNull(), "quota_observed_at_ms": NSNull(), "quota_valid_until_ms": NSNull(),
                 "quality_state": "policy_admitted",
                 "estimated_cost_units": input.priceTable == nil ? NSNull() as Any : 0.0 as Any]]
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
        if let v2 = output.intentV2 {
            object["routing_intent_v2"] = try JSONSerialization.jsonObject(with: RCCRuntimeContract.encode(v2))
        }
        if !output.intent.isEmpty {
            object["routing_intent"] = ["effort": output.intent.effort.map { $0 as Any } ?? NSNull(),
                                        "model_family": output.intent.modelFamily.map { $0 as Any } ?? NSNull()]
        }
        if !output.candidates.isEmpty { object["model_tiers"] = output.modelTiers }
        // Fresh catalogs attest the native ceiling separately from executable
        // rows, including named-family and fan-out routes. Older stored
        // catalogs remain valid without this optional field.
        object["native_reference_efforts"] = output.nativeReferenceEfforts
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
        // Build 407, all optional: the admission facts always together, a
        // contract/certificate/pin only when one exists for this request.
        if let facts = output.admission {
            object["owner_scope"] = facts.ownerScope.rawValue
            object["chat_lane_eligible"] = facts.chatLaneEligible
            object["request_class"] = facts.requestClass.rawValue
            if let contract = facts.taskContract {
                object["task_contract"] = try JSONSerialization.jsonObject(with: RCCRuntimeContract.encode(contract))
            }
            if let certificate = facts.classCertificate {
                object["class_certificates"] = [facts.requestClass.rawValue:
                    try JSONSerialization.jsonObject(with: RCCRuntimeContract.encode(certificate))]
            }
            if let pin = facts.classProviderPin { object["class_provider_pins"] = [facts.requestClass.rawValue: pin] }
            // Build 441, optional: the host's request profile, beside the
            // facts only (Core's graded admission reads it; never a certificate).
            if let profile = facts.requestProfile {
                object["request_profile"] = try JSONSerialization.jsonObject(with: RCCRuntimeContract.encode(profile))
                // Build 442, optional, beside the profile only.
                if let routes = facts.capabilityRoutes {
                    object["capability_routes"] = try JSONSerialization.jsonObject(with: RCCRuntimeContract.encode(routes))
                }
            }
        }
        return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
    }
}
