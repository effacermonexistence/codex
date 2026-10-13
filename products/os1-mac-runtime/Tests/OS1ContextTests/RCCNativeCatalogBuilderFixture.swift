import Foundation
import OS1Context

/// Pure catalog-builder, routing-intent and contract checks. No provider,
/// account, model, gateway or live state is touched; every observation is a
/// fixture value. One Node subprocess computes the JS host fingerprint.
func runRCCNativeCatalogBuilderFixtures() throws {
    typealias B = RCCNativeCatalogBuilder
    typealias C = RCCRuntimeContract
    var checks = 0
    func check(_ pass: Bool, _ label: String) throws {
        guard pass else { throw NSError(domain: "RCCNativeCatalogBuilderFixture", code: 1,
                                        userInfo: [NSLocalizedDescriptionKey: label]) }
        checks += 1
    }
    func rowBytes(_ row: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: row, options: [.sortedKeys, .withoutEscapingSlashes])
    }

    // ---- Fixture observations -------------------------------------------
    let now = Date(timeIntervalSince1970: 1_790_000_000)
    let contract = String(repeating: "c", count: 64)
    let profiles: [B.Profile] = [
        .init(action: "a_luna_low", provider: "codex", model: "gpt-5.6-luna", effort: "low"),
        .init(action: "a_luna_max", provider: "codex", model: "gpt-5.6-luna", effort: "max"),
        .init(action: "b_sol_low", provider: "codex", model: "gpt-6-sol", effort: "low"),
        .init(action: "b_sol_medium", provider: "codex", model: "gpt-6-sol", effort: "medium"),
        .init(action: "b_sol_ultra", provider: "codex", model: "gpt-6-sol", effort: "ultra"),
        .init(action: "c_fable_low", provider: "claude", model: "fable", effort: "low"),
        .init(action: "c_fable_xhigh", provider: "claude", model: "fable", effort: "xhigh"),
        .init(action: "c_fable_max", provider: "claude", model: "fable", effort: "max"),
        .init(action: "d_opus_xhigh", provider: "claude", model: "claude-opus-5-5", effort: "xhigh"),
        .init(action: "d_opus_max", provider: "claude", model: "claude-opus-5-5", effort: "max"),
        .init(action: "e_sonnet_medium", provider: "claude", model: "sonnet", effort: "medium"),
        .init(action: "f_haiku_low", provider: "claude", model: "haiku", effort: "low"),
        .init(action: "os1_exact", provider: "local", model: "local-deterministic", effort: "none"),
    ]
    let writeRequest = "Fix the login bug in Sources/App.swift"
    try check(ScopeResolution.resolve(writeRequest).scope == .workspaceWrite, "fixture request needs both scopes")
    func quota(_ account: String, used: Double, resetIn hours: Double?) -> BackendHealth.QuotaSnapshot {
        .init(accountID: account, observedAt: now.addingTimeInterval(-5), source: .codexNative,
              windows: [.init(bucket: "primary", usedPercent: used, resetsAt: hours.map { now.addingTimeInterval($0 * 3600) })])
    }
    func input(_ request: String = writeRequest, preference: String = "auto", plan: C.CapacityPlan? = nil,
               chat: Bool = true, material: Bool = false, readOnly: Bool = false) -> B.Input {
        var value = B.Input(taskID: "task-fixture", requestSHA256: C.digest(Data(request.utf8)), request: request,
            providerPreference: preference, requireReadOnly: readOnly, hasMaterialRefs: material, capacityPlan: plan,
            executorContractSHA256: contract, now: now, showCodex: true, chatLaneEligible: chat, profiles: profiles)
        value.codexModels = [.init(slug: "gpt-6-sol", supportedEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"], priority: 0),
                             .init(slug: "gpt-5.6-luna", supportedEfforts: ["low", "medium", "high", "xhigh", "max"], priority: 1)]
        // Native inventory order, deliberately not alphabetical.
        value.claudeModels = [.init(model: "sonnet", supportedEfforts: ["medium"]),
                              .init(model: "fable", supportedEfforts: ["low", "xhigh", "max"]),
                              .init(model: "claude-opus-5-5", supportedEfforts: ["xhigh", "max"])]
        value.auth = ["codex": .subscription, "claude": .subscription]
        value.accountIDs = ["codex": "acct-codex", "claude": "acct-claude"]
        value.codexQuota = quota("acct-codex", used: 40, resetIn: 48)
        value.claudeQuota = quota("acct-claude", used: 20, resetIn: 4)
        return value
    }
    func tuples(_ output: B.Output) -> [String] {
        output.candidates.map { "\($0["surface"]!)/\($0["model"]!)/\($0["effort"]!)/\($0["scope"]!)" }
    }
    func reasons(_ output: B.Output) -> [String] { output.exclusions.map { "\($0.provider):\($0.reason):\($0.count)" } }

    // ---- Ordering and id/byte stability against the former builder ------
    let base = try B.build(input())
    try check(tuples(base) == [
        // Anthropic first: 0.8 remaining with 4h to reset outscores Codex's 0.6 over 48h.
        // max is offered by default (2026-10-13): it is the reference effort.
        "claude-chat/sonnet/medium/read_only", "claude/sonnet/medium/read_only", "claude/sonnet/medium/workspace_write",
        "claude-chat/fable/low/read_only", "claude-chat/fable/xhigh/read_only", "claude-chat/fable/max/read_only",
        "claude/fable/low/read_only", "claude/fable/low/workspace_write",
        "claude/fable/xhigh/read_only", "claude/fable/xhigh/workspace_write",
        "claude/fable/max/read_only", "claude/fable/max/workspace_write",
        "claude-chat/claude-opus-5-5/xhigh/read_only", "claude-chat/claude-opus-5-5/max/read_only",
        "claude/claude-opus-5-5/xhigh/read_only", "claude/claude-opus-5-5/xhigh/workspace_write",
        "claude/claude-opus-5-5/max/read_only", "claude/claude-opus-5-5/max/workspace_write",
        // Codex by native priority (gpt-6-sol before gpt-5.6-luna), not by action name.
        "codex/gpt-6-sol/low/read_only", "codex/gpt-6-sol/low/workspace_write",
        "codex/gpt-6-sol/medium/read_only", "codex/gpt-6-sol/medium/workspace_write",
        "codex/gpt-5.6-luna/low/read_only", "codex/gpt-5.6-luna/low/workspace_write",
        "codex/gpt-5.6-luna/max/read_only", "codex/gpt-5.6-luna/max/workspace_write",
    ], "pool, native model preference, surface, effort, scope order: \(tuples(base))")
    try check(base.pools.map(\.pool) == ["anthropic_shared", "openai_codex"] &&
              base.pools[0].score.map { abs($0 - 0.2) < 1e-9 } == true &&
              base.pools[1].score.map { abs($0 - 0.0125) < 1e-9 } == true, "pool score = share x remaining / hours")
    try check(reasons(base) == ["claude:model_unavailable:1", "codex:effort_requires_explicit_request:1"],
              "per-provider exclusions; only ultra waits for an explicit request: \(reasons(base))")
    let legacy = legacyRows(input(), chatRefused: false)
    let legacyComparable = try Set(legacy.filter { $0["surface"] as? String != "gpt-chat" &&
        !["ultra", "ultracode"].contains($0["effort"] as? String ?? "") }.map(rowBytes))
    try check(try Set(base.candidates.map(rowBytes)) == legacyComparable && legacyComparable.count == base.candidates.count,
              "every row keeps the former id hash tuple and exact field bytes")
    try check(legacy.contains { $0["surface"] as? String == "gpt-chat" } &&
              !base.candidates.contains { ["gpt-chat", "chatgpt"].contains($0["surface"] as? String ?? "") },
              "the former builder emitted gpt-chat; the new one never does")
    try check(try tuples(B.build(input())) == tuples(base), "same inputs, same order")
    let data = try B.catalogData(base, taskID: "task-fixture", requestSHA256: C.digest(Data(writeRequest.utf8)))
    let decoded = try C.decodeCatalog(data)
    try check(decoded.candidates.map(\.id) == base.candidates.map { $0["id"] as! String } && decoded.exclusions?.count == 2,
              "builder bytes decode through the strict contract with exclusions")
    try check(decoded.routingIntent == nil && !String(decoding: data, as: UTF8.self).contains("routing_intent"),
              "a catalog without an explicit owner constraint carries no routing_intent")

    // Claude lists one native row under several names (alias and resolved
    // ID), each with its own configured efforts. Every name shares the row's
    // rank, so its rows sit together ahead of a less-preferred model and the
    // resolver compares their efforts as one model.
    var aliases = input("Explain the login function", chat: false, readOnly: true)
    aliases.profiles = [.init(action: "s_alias_medium", provider: "claude", model: "sonnet", effort: "medium"),
        .init(action: "s_full_low", provider: "claude", model: "claude-sonnet-5-5", effort: "low"),
        .init(action: "s_full_xhigh", provider: "claude", model: "claude-sonnet-5-5", effort: "xhigh"),
        .init(action: "t_fable_low", provider: "claude", model: "fable", effort: "low"),
        .init(action: "t_fable_xhigh", provider: "claude", model: "fable", effort: "xhigh")]
    aliases.claudeModels = [.init(model: "sonnet", supportedEfforts: ["medium"], nativeRank: 0),
        .init(model: "fable", supportedEfforts: ["low", "xhigh"], nativeRank: 1),
        .init(model: "claude-sonnet-5-5", supportedEfforts: ["low", "xhigh"], nativeRank: 0)]
    try check(tuples(try B.build(aliases)) == ["claude/claude-sonnet-5-5/low/read_only", "claude/claude-sonnet-5-5/xhigh/read_only",
        "claude/sonnet/medium/read_only", "claude/fable/low/read_only", "claude/fable/xhigh/read_only"],
              "names of one native row share its rank: \(tuples(try B.build(aliases)))")
    aliases.claudeModels = aliases.claudeModels.map { .init(model: $0.model, supportedEfforts: $0.supportedEfforts) }
    try check(tuples(try B.build(aliases)).last == "claude/claude-sonnet-5-5/xhigh/read_only",
              "without an observed native row the list position is the rank")
    // Within one native row the name with the highest reference effort comes
    // first, whatever its spelling: the host takes a pool's first model as its
    // reference, so the alias configured at max is never hidden behind the
    // resolved ID configured only up to xhigh.
    var opusNames = input("Explain the login function", chat: false, readOnly: true)
    opusNames.profiles = [.init(action: "o_full_xhigh", provider: "claude", model: "claude-opus-5-5", effort: "xhigh"),
        .init(action: "o_alias_max", provider: "claude", model: "opus", effort: "max"),
        .init(action: "p_sonnet_max", provider: "claude", model: "sonnet", effort: "max")]
    opusNames.claudeModels = [.init(model: "claude-opus-5-5", supportedEfforts: ["xhigh", "max"], nativeRank: 0),
        .init(model: "opus", supportedEfforts: ["xhigh", "max"], nativeRank: 0),
        .init(model: "sonnet", supportedEfforts: ["max"], nativeRank: 1)]
    let opusOut = try B.build(opusNames)
    try check(tuples(opusOut) == ["claude/opus/max/read_only", "claude/claude-opus-5-5/xhigh/read_only",
        "claude/sonnet/max/read_only"], "the name carrying the reference effort leads its native row: \(tuples(opusOut))")

    // Unknown or stale quota goes last, with the reset noted as unknown.
    var stale = input(); stale.claudeQuota = nil
    let staleOut = try B.build(stale)
    try check(staleOut.pools.map(\.pool) == ["openai_codex", "anthropic_shared"] && staleOut.pools[1].score == nil
              && staleOut.pools[1].resetUnknown && staleOut.pools[1].hoursToReset == 168,
              "an unknown-quota pool stays as evidence but ranks last")
    try check(staleOut.candidates.contains { $0["quota_remaining_fraction"] is NSNull }, "unknown quota stays null, never 1")
    var unknownReset = input(); unknownReset.codexQuota = quota("acct-codex", used: 0, resetIn: nil)
    unknownReset.claudeQuota = quota("acct-claude", used: 99, resetIn: 1)
    let resetOut = try B.build(unknownReset)
    try check(resetOut.pools.first { $0.pool == "openai_codex" }?.resetUnknown == true &&
              resetOut.pools.first { $0.pool == "openai_codex" }?.hoursToReset == 168, "unknown reset uses 168h and is recorded")
    // A model-scoped window: the pool is scored by the model the resolver
    // binds first (sonnet, first in Claude's inventory), not by the model with
    // the most quota left (fable).
    var scopedWindow = input()
    scopedWindow.codexQuota = quota("acct-codex", used: 40, resetIn: 100)
    scopedWindow.claudeQuota = .init(accountID: "acct-claude", observedAt: now.addingTimeInterval(-5), source: .claudeNative,
        windows: [.init(bucket: "weekly", usedPercent: 15, resetsAt: now.addingTimeInterval(100 * 3600)),
                  .init(bucket: "weekly_model", usedPercent: 97, resetsAt: now.addingTimeInterval(100 * 3600), model: "sonnet")])
    let scopedOut = try B.build(scopedWindow)
    try check(scopedOut.pools.map(\.pool) == ["openai_codex", "anthropic_shared"] &&
              scopedOut.pools[1].remainingFraction.map { abs($0 - 0.03) < 1e-9 } == true,
              "a nearly exhausted first-preference model ranks its pool by that model: \(scopedOut.pools)")
    try check(tuples(scopedOut).first == "codex/gpt-6-sol/low/read_only", "the pool with room for its first model leads")
    var tie = input(); tie.codexQuota = quota("acct-codex", used: 20, resetIn: 4)
    try check(try B.build(tie).pools.first?.pool == "openai_codex", "an exact score tie prefers openai_codex")
    var exhausted = input(); exhausted.codexQuota = quota("acct-codex", used: 100, resetIn: 2)
    let exhaustedOut = try B.build(exhausted)
    try check(!exhaustedOut.candidates.contains { $0["quota_pool"] as? String == "openai_codex" } &&
              reasons(exhaustedOut).contains("codex:quota_zero:4"), "a zero-remaining pool is excluded and counted")

    // ---- GPT is never emitted --------------------------------------------
    for preference in ["auto", "codex", "claude", "claude-chat", "gpt-chat", "chatgpt"] {
        for readOnly in [true, false] {
            let out = try B.build(input(preference: preference, readOnly: readOnly))
            try check(!out.candidates.contains { ["gpt-chat", "chatgpt"].contains($0["surface"] as? String ?? "") },
                      "no GPT surface for preference \(preference)")
        }
    }
    let gptPreference = try B.build(input(preference: "gpt-chat"))
    try check(Set(gptPreference.candidates.map { $0["surface"] as! String }) == ["codex"] &&
              reasons(gptPreference).contains("codex:gpt_dropped:1"), "a stored GPT preference runs on Codex, recorded as gpt_dropped")
    try check(B.normalizedPreference("chatgpt") == "codex" && B.admits(preference: "gpt-chat", surface: "codex") &&
              !B.admits(preference: "auto", surface: "gpt-chat") && !B.admits(preference: "codex", surface: "gpt-chat") &&
              !B.admits(preference: "auto", surface: "chatgpt"), "GPT surfaces are admitted by no preference")
    try check(B.admits(preference: "claude", surface: "claude-chat") && B.admits(preference: "claude", surface: "claude") &&
              !B.admits(preference: "claude-chat", surface: "claude") && !B.admits(preference: "codex", surface: "claude") &&
              !B.admits(preference: "local", surface: "codex"), "preference admission table")

    // ---- Capacity --------------------------------------------------------
    let zeroCodex = try B.build(input(plan: .init(codex: 0, claude: 100)))
    try check(!zeroCodex.candidates.contains { $0["quota_pool"] as? String == "openai_codex" } &&
              reasons(zeroCodex).contains("codex:capacity_zero:5"), "a 0% pool is excluded under Auto")
    try check(B.providersToProbe(input(plan: .init(codex: 0, claude: 100))) == ["claude"], "a 0% pool is never probed")
    let namedCodex = try B.build(input(preference: "codex", plan: .init(codex: 0, claude: 100)))
    try check(namedCodex.candidates.count == 8 && !reasons(namedCodex).contains { $0.contains("capacity_zero") },
              "an explicitly named provider overrides its 0% capacity")
    var shared = input(plan: .init(codex: 100, claude: 1))
    shared.codexQuota = quota("acct-codex", used: 50, resetIn: 10)
    try check(try B.build(shared).pools.first?.pool == "openai_codex", "capacity share weighs the pool score")
    // An explicit route test names its providers: a 0% pool a route names is
    // still offered (and probed), while an unnamed 0% pool stays excluded.
    let fanoutText = "1+1 Codex한테. 2+2 Claude Code한테. 라우팅 시켜서 답변 받아와"
    var explicitZero = input(fanoutText, plan: .init(codex: 0, claude: 100))
    explicitZero.explicitRouteSurfaces = ["codex", "claude"]
    let explicitZeroOut = try B.build(explicitZero)
    try check(explicitZeroOut.candidates.contains { $0["quota_pool"] as? String == "openai_codex" } &&
              !reasons(explicitZeroOut).contains { $0.contains("capacity_zero") } &&
              B.providersToProbe(explicitZero) == ["codex", "claude"], "a route naming a 0% provider keeps it: \(reasons(explicitZeroOut))")
    var explicitClaudeOnly = explicitZero; explicitClaudeOnly.explicitRouteSurfaces = ["claude-chat"]
    try check(reasons(try B.build(explicitClaudeOnly)).contains("codex:capacity_zero:5"),
              "a 0% provider no route names stays excluded")
    // Authorization: the server denies 0%, so a named 0% provider is sent at
    // 100; an unnamed one is refused before any request.
    try check(B.authorizationCapacity(nil, provider: "codex", preference: "auto", explicitSurfaces: nil) == .init(codex: 100, claude: 100) &&
              B.authorizationCapacity(.init(codex: 0, claude: 100), provider: "codex", preference: "codex", explicitSurfaces: nil) == .init(codex: 100, claude: 100) &&
              B.authorizationCapacity(.init(codex: 0, claude: 100), provider: "codex", preference: "gpt-chat", explicitSurfaces: nil) == .init(codex: 100, claude: 100) &&
              B.authorizationCapacity(.init(codex: 0, claude: 40), provider: "codex", preference: "auto", explicitSurfaces: ["codex"]) == .init(codex: 100, claude: 40) &&
              B.authorizationCapacity(.init(codex: 0, claude: 100), provider: "codex", preference: "auto", explicitSurfaces: nil) == nil &&
              B.authorizationCapacity(.init(codex: 70, claude: 0), provider: "claude", preference: "claude-chat", explicitSurfaces: nil) == .init(codex: 70, claude: 100) &&
              B.authorizationCapacity(.init(codex: 30, claude: 60), provider: "claude", preference: "auto", explicitSurfaces: nil) == .init(codex: 30, claude: 60),
              "authorization capacity: named 0% is sent at 100, unnamed 0% is refused, any other plan unchanged")
    // Every catalog-admitted row gets a positive authorization capacity.
    let admittedCases: [(String, [String]?, C.CapacityPlan)] = [("codex", nil, .init(codex: 0, claude: 100)),
        ("auto", ["codex", "claude"], .init(codex: 0, claude: 100)), ("claude", nil, .init(codex: 100, claude: 0)),
        ("claude-chat", nil, .init(codex: 100, claude: 0)), ("auto", nil, .init(codex: 0, claude: 100))]
    for (preference, explicitSurfaces, plan) in admittedCases {
        var value = input(preference: preference, plan: plan)
        value.explicitRouteSurfaces = explicitSurfaces
        for row in try B.build(value).candidates {
            let provider = row["quota_pool"] as? String == "openai_codex" ? "codex" : "claude"
            let plan = B.authorizationCapacity(value.capacityPlan, provider: provider, preference: preference,
                                               explicitSurfaces: explicitSurfaces)
            try check(plan.map { provider == "codex" ? $0.codex > 0 : $0.claude > 0 } == true,
                      "admitted \(provider) row authorizes with a positive capacity under \(preference)")
        }
    }

    // ---- Explicit intent -------------------------------------------------
    let intents: [(String, String?, String?)] = [
        ("opus max로 해줘", "max", "opus"), ("최대 리즈닝으로 해줘", "max", nil), ("리즈닝 최대로", "max", nil),
        ("울트라로 돌려", "ultra", nil), ("xhigh로 해", "xhigh", nil), ("extra high reasoning please", "xhigh", nil),
        ("reasoning: high", "high", nil), ("추론 높게 해서 답해", "high", nil), ("중간 추론으로", "medium", nil),
        ("최소 리즈닝으로", "low", nil), ("minimal reasoning", "low", nil), ("리즈닝 낮게", "low", nil),
        ("gpt-6-sol로 해줘", nil, "sol"), ("fable 5.1 모델로", nil, "fable"), ("소네트로 돌려", nil, "sonnet"),
        ("루나한테 시켜", nil, "luna"), ("use daybreak model", nil, "daybreak"), ("sol 모델 high로", "high", "sol"),
        ("opus 말고 sonnet으로 돌려", nil, "sonnet"), ("terra/xhigh", "xhigh", "terra"), ("astra 6 써줘", nil, "astra"),
        // Incidental words are not constraints.
        ("max file size를 알려줘", nil, nil), ("높은 건물 사진 찾아줘", nil, nil), ("솔직히 말해서 어때", nil, nil),
        ("솔로로 해", nil, nil), ("ultra-wide 모니터 추천", nil, nil), ("max reasoning 말고 그냥 해", nil, nil),
        ("opus랑 sonnet 비교해줘", nil, nil), ("ultracode 설명해줘", nil, nil), ("solve this puzzle", nil, nil),
        ("테라바이트 단위로 계산해", nil, nil), ("opus max 아니면 high reasoning", nil, "opus"),
        // Talking about a setting, or an ordinary noun, is not a constraint.
        ("what is the max thinking budget for claude?", nil, nil),
        ("summarize the max reasoning tokens setting in config", nil, nil),
        ("클로드 최대 리즈닝 설정이 뭐야?", nil, nil), ("Codex xhigh 지원해?", nil, nil),
        ("this is a high effort task, please fix the bug", nil, nil),
        ("explain the terra luna 2.0 crash", nil, nil), ("use astra db to store the sessions", nil, nil),
        ("answer with haiku please", nil, nil), ("write a review of Fable 3", nil, nil),
        ("fable 5.1 vs opus 비교해줘", nil, nil), ("is xhigh supported here", nil, nil),
        // A directive still wins over a setting word in the same clause.
        ("최대 리즈닝으로 이 설정 파일 고쳐줘", "max", nil), ("use max reasoning to fix the config", "max", nil),
        ("this is urgent, use high reasoning", "high", nil), ("xhigh로 config 고쳐", "xhigh", nil),
        ("claude opus로 해", nil, "opus"), ("최대 리즈닝으로 해줄 수 있어?", "max", nil),
        // A task noun later in an ordinary instruction is not a question
        // about the setting, and "Do …" is an imperative.
        ("max reasoning: refactor the config loader", "max", nil),
        ("xhigh reasoning, add support for the new token API", "xhigh", nil),
        ("high reasoning: fix the rate limits handling", "high", nil),
        ("Do a max reasoning pass over this diff", "max", nil),
        ("맥스 리즈닝, 이 함수 뭐하는지 설명해", "max", nil), ("최대 리즈닝 써서 뭐가 문제인지 찾아줘", "max", nil),
        ("최대 리즈닝: 설정 파일 로더 리팩터링해", "max", nil), ("최대 리즈닝을 설정해줘", "max", nil),
        ("최대 리즈닝 쓸 수 있어?", "max", nil),
        // A question about the setting itself still sets nothing.
        ("do you support max reasoning?", nil, nil), ("max reasoning이 필요할까?", nil, nil),
        ("opus max 가격이 얼마야?", nil, nil),
        // Saying the effort is not wanted never asks for it.
        ("최대 리즈닝 필요 없어, 간단히 답해", nil, nil), ("max reasoning 안 써도 돼", nil, nil),
        ("최대 리즈닝까지 할 필요는 없어", nil, nil), ("최대 추론은 과해, 그냥 답해", nil, nil),
        ("고민 많이 하지 말고, 최대 리즈닝 안 해도 돼", nil, nil),
        ("max reasoning not needed, just answer briefly", nil, nil), ("max reasoning is unnecessary here", nil, nil),
        ("high reasoning 필요 없는 간단한 질문", nil, nil), ("no need for max reasoning here", nil, nil),
        ("최대 리즈닝으로 안 되는 버그 고쳐", "max", nil),
        // A generic verb names a model when the family ends the phrase or a
        // version/"for"/"to" follows; a version then a particle is a directive.
        ("Use Opus 5.5 for this review", nil, "opus"), ("opus 5.5로 리뷰해줘", nil, "opus"),
        ("run this on sonnet 5", nil, "sonnet"), ("use sonnet for this", nil, "sonnet"),
        ("Do a deep review using opus", nil, "opus"), ("switch to fable", nil, "fable"),
        ("run it on opus please", nil, "opus"), ("comment on sonnet 18", nil, nil), ("write a poem with haiku", nil, nil),
        // Asking about or describing a model is not running on it, unless the
        // sentence also says to run on it.
        ("what is claude opus?", nil, nil), ("Claude Opus 5.5 출시일 알려줘", nil, nil),
        ("Claude Opus의 장점을 설명해줘", nil, nil), ("explain the claude sonnet model pricing", nil, nil),
        ("GPT-6 Sol 모델이 뭐가 좋아?", nil, nil), ("gpt-5.6-luna 모델 컨텍스트 창 크기?", nil, nil),
        ("claude opus로 이 함수 설명해줘", nil, "opus"), ("use opus to explain this function", nil, "opus"),
    ]
    for (text, effort, family) in intents {
        let parsed = RoutingIntent.parse(text)
        try check(parsed.effort == effort && parsed.modelFamily == family,
                  "intent \(text) -> \(parsed.effort ?? "nil")/\(parsed.modelFamily ?? "nil")")
    }
    try check(RoutingIntent.model("gpt-6.1-sol", belongsTo: "sol") && !RoutingIntent.model("gpt-consol", belongsTo: "sol") &&
              RoutingIntent.model("claude-fable-5-1", belongsTo: "fable"), "a family matches a whole model token")
    // A question about a Claude model on the Codex tile still runs on Codex:
    // it is not a family constraint that empties the catalog.
    let question = try B.build(input("what is claude opus?", preference: "codex"))
    try check(!question.candidates.isEmpty && question.candidates.allSatisfy { $0["quota_pool"] as? String == "openai_codex" } &&
              !reasons(question).contains { $0.contains("explicit_constraint_unavailable") },
              "a model question is not a constraint: \(reasons(question))")
    // Saying max is not needed sets no constraint: the catalog is the default
    // one (max is the reference effort), and ultra still waits for a request.
    let notNeeded = try B.build(input("최대 리즈닝 필요 없어, 간단히 답해"))
    try check(!notNeeded.candidates.isEmpty && notNeeded.intent.isEmpty &&
              notNeeded.candidates.contains { $0["effort"] as? String == "max" } &&
              !notNeeded.candidates.contains { ["ultra", "ultracode"].contains($0["effort"] as? String ?? "") },
              "a negated effort is no constraint; ultra stays withheld: \(tuples(notNeeded))")
    let opusMax = try B.build(input("opus max로 해줘"))
    try check(!opusMax.candidates.isEmpty && opusMax.candidates.allSatisfy { $0["model"] as? String == "claude-opus-5-5" &&
              $0["effort"] as? String == "max" }, "explicit model+effort keeps exactly that tuple: \(tuples(opusMax))")
    let korean = try B.build(input("최대 리즈닝으로 해줘"))
    try check(!korean.candidates.isEmpty && korean.candidates.allSatisfy { $0["effort"] as? String == "max" },
              "Korean max reasoning keeps only max rows")
    let ultra = try B.build(input("울트라로 돌려"))
    try check(!ultra.candidates.isEmpty && ultra.candidates.allSatisfy { $0["effort"] as? String == "ultra" && $0["model"] as? String == "gpt-6-sol" },
              "Korean Ultra directive keeps only ultra rows")
    // The explicit constraint travels with the catalog, so the host names the
    // route explicit and may bind the ultra effort the owner asked for.
    let ultraData = try B.catalogData(ultra, taskID: "task-fixture", requestSHA256: C.digest(Data("울트라로 돌려".utf8)))
    let ultraObject = try JSONSerialization.jsonObject(with: ultraData) as! [String: Any]
    try check((ultraObject["routing_intent"] as? [String: Any])?["effort"] as? String == "ultra" &&
              (ultraObject["routing_intent"] as? [String: Any])?["model_family"] is NSNull,
              "routing_intent carries both keys, null when unset")
    let ultraCatalog = try C.decodeCatalog(ultraData)
    try check(ultraCatalog.routingIntent == .init(effort: "ultra", modelFamily: nil) &&
              (try C.decodeCatalog(C.encode(ultraCatalog))) == ultraCatalog &&
              String(decoding: try C.encode(ultraCatalog), as: UTF8.self).contains(#""model_family":null"#),
              "routing_intent decodes and re-encodes with explicit nulls")
    let opusIntent = try C.decodeCatalog(B.catalogData(try B.build(input("opus max로 해줘")), taskID: "task-fixture",
        requestSHA256: C.digest(Data("opus max로 해줘".utf8))))
    try check(opusIntent.routingIntent == .init(effort: "max", modelFamily: "opus"), "an effort and a family travel together")
    for bad in [C.RoutingIntentConstraint(effort: nil, modelFamily: nil), .init(effort: "none", modelFamily: nil),
                .init(effort: "max", modelFamily: "Opus 5"), .init(effort: "ultracode", modelFamily: nil)] {
        var invalid = ultraCatalog; invalid.routingIntent = bad
        do { _ = try C.decodeCatalog(C.encode(invalid)); try check(false, "invalid routing_intent accepted: \(bad)") }
        catch { checks += 1 }
    }
    var extraIntent = ultraObject
    extraIntent["routing_intent"] = ["effort": "ultra", "model_family": NSNull(), "guess": "max"]
    do { _ = try C.decodeCatalog(JSONSerialization.data(withJSONObject: extraIntent)); try check(false, "extra intent key accepted") }
    catch { checks += 1 }
    let haiku = try B.build(input("haiku로 돌려"))
    let haikuReasons = Set(haiku.exclusions.map(\.reason))
    try check(haiku.candidates.isEmpty && haikuReasons.contains("explicit_constraint_unavailable") &&
              haikuReasons.contains("model_unavailable"), "an unavailable explicit model holds; nothing is substituted")
    let haikuData = try B.catalogData(haiku, taskID: "task-fixture", requestSHA256: C.digest(Data("haiku로 돌려".utf8)))
    let haikuCatalog = try C.decodeCatalog(haikuData)
    try check(haikuCatalog.candidates.isEmpty && haikuCatalog.exclusions == haiku.exclusions &&
              String(decoding: haikuData, as: UTF8.self).contains("\"exclusions\""), "empty-with-exclusions catalog decodes")
    try check(B.providersToProbe(input("haiku로 돌려")) == ["claude"], "a family constraint probes only its provider")
    // An explicit route test keeps its former candidate set: the fan-out
    // sentence is not one intent for every route and no effort is withheld.
    var explicitIntent = input("1+1 코덱스 sol한테. 2+2 클로드 opus max로 해", plan: nil)
    explicitIntent.explicitRouteSurfaces = ["codex", "claude"]
    let explicitIntentOut = try B.build(explicitIntent)
    try check(explicitIntentOut.candidates.contains { $0["quota_pool"] as? String == "openai_codex" } &&
              explicitIntentOut.candidates.contains { $0["quota_pool"] as? String == "anthropic_shared" } &&
              explicitIntentOut.candidates.contains { $0["effort"] as? String == "max" } &&
              !reasons(explicitIntentOut).contains { $0.contains("effort_requires_explicit_request") || $0.contains("explicit_constraint") },
              "explicit routes ignore owner-text intent and keep max rows: \(reasons(explicitIntentOut))")
    try check(B.intent(explicitIntent).isEmpty && B.intent(input("opus max로 해줘")) == RoutingIntent(effort: "max", modelFamily: "opus"),
              "intent is read only outside explicit route tests")

    // ---- ultra needs an explicit request; max is the default reference ----
    try check(!base.candidates.contains { ["ultra", "ultracode"].contains($0["effort"] as? String ?? "") },
              "ultra/ultracode are not offered without an explicit effort word")
    try check(base.candidates.contains { $0["effort"] as? String == "max" && $0["quota_pool"] as? String == "openai_codex" } &&
              base.candidates.contains { $0["effort"] as? String == "max" && $0["quota_pool"] as? String == "anthropic_shared" },
              "max is offered in both pools without an explicit effort word")
    try check(!B.explicitOnlyEfforts.contains("max") && B.explicitOnlyEfforts == ["ultra", "ultracode"],
              "only above-max efforts are explicit-only")

    // ---- Empty with exclusions; unexplained empty is malformed ------------
    var signedOut = input(plan: .init(codex: 0, claude: 100)); signedOut.auth["claude"] = .signedOut
    let blocked = try B.build(signedOut)
    try check(blocked.candidates.isEmpty && Set(blocked.exclusions.map(\.reason)) == ["capacity_zero", "signed_out"],
              "signed-out Claude plus a 0% Codex is an explained empty catalog: \(reasons(blocked))")
    var nonSubscription = input(); nonSubscription.auth["codex"] = .nonSubscription; nonSubscription.auth["claude"] = nil
    let nonSub = try B.build(nonSubscription)
    try check(reasons(nonSub).contains("codex:non_subscription:4") && reasons(nonSub).contains("claude:signed_out:7"),
              "API-key/unknown billing and unobserved sign-in are distinct reasons: \(reasons(nonSub))")
    var hidden = input(preference: "codex"); hidden.showCodex = false
    try check(reasons(try B.build(hidden)) == ["codex:codex_hidden:5"], "hidden Codex is a recorded reason")
    var nothing = input(preference: "local")
    nothing.profiles = profiles
    do { _ = try B.build(nothing); try check(false, "an unexplained empty catalog must throw") }
    catch B.Failure.unexplainedEmptyCatalog { checks += 1 }
    var oversize = input()
    oversize.profiles = (0..<300).map { .init(action: "p\($0)", provider: "codex", model: "gpt-6-sol", effort: "low") }
    oversize.codexModels = (0..<300).map { _ in .init(slug: "gpt-6-sol", supportedEfforts: ["low"], priority: 0) }
    try check(try B.build(oversize).candidates.count == 2, "identical tuples collapse to one id, never duplicate")
    oversize.profiles = (0..<300).map { .init(action: "p\($0)", provider: "codex", model: "m\($0)", effort: "low") }
    oversize.codexModels = (0..<300).map { .init(slug: "m\($0)", supportedEfforts: ["low"], priority: $0) }
    do { _ = try B.build(oversize); try check(false, "oversize must throw") }
    catch B.Failure.exceedsBound(let count) { try check(count == 600, "the 256 bound is explicit, never truncation") }

    // ---- Chat gating -----------------------------------------------------
    let noChat = try B.build(input(chat: false))
    try check(!noChat.candidates.contains { $0["surface"] as? String == "claude-chat" } && noChat.exclusions == base.exclusions,
              "claude-chat rows exist only when the chat-lane predicate holds")
    try check(!(try B.build(input(material: true))).candidates.contains { $0["surface"] as? String == "claude-chat" },
              "attached material never reaches the tool-free lane")
    let chatOnly = try B.build(input(preference: "claude-chat"))
    try check(!chatOnly.candidates.isEmpty && chatOnly.candidates.allSatisfy { $0["surface"] as? String == "claude-chat" && $0["scope"] as? String == "read_only" },
              "an explicit Claude chat choice yields only gated chat rows")
    let refused = try B.build(input(preference: "claude-chat", chat: false))
    try check(refused.candidates.isEmpty && reasons(refused).contains("claude:chat_gate_refused:7"),
              "an explicit Claude chat choice the gate refuses holds with chat_gate_refused: \(reasons(refused))")
    try check(B.providersToProbe(input(preference: "claude-chat", chat: false)).isEmpty, "a refused chat choice probes nothing")
    let anthropic = try B.build(input(preference: "claude"))
    try check(Set(anthropic.candidates.map { $0["surface"] as! String }) == ["claude", "claude-chat"],
              "the Anthropic tile admits its gated chat lane")

    // ---- Contract: capacity_plan and exclusions ----------------------------
    var host = C.HostContext(workspace: "/tmp/rcc-fixture", context: nil, providerPreference: "auto",
        codexSessionID: nil, claudeSessionID: nil, requireReadOnly: true, ownerPolicy: nil)
    let legacyHostBytes = try C.encode(host)
    try check(!String(decoding: legacyHostBytes, as: UTF8.self).contains("capacity_plan"), "an absent plan keeps old host bytes")
    host.capacityPlan = .init(codex: 30, claude: 100)
    let planBytes = try C.encode(host)
    let canonical = #"{"capacity_plan":{"claude":100,"codex":30},"claude_session_id":null,"codex_session_id":null,"context":null,"explicit_routes":null,"owner_policy":null,"provider_preference":"auto","require_read_only":true,"workspace":"/tmp/rcc-fixture"}"#
    try check(String(decoding: planBytes, as: UTF8.self) == canonical, "Swift canonical host bytes match the shared JS literal")
    try check(try javascriptHostFingerprint(planBytes) == C.digest(planBytes), "actual Swift/JS fingerprint parity with capacity_plan")
    try C.validate(host); checks += 1
    for bad in [C.CapacityPlan(codex: 0, claude: 0), .init(codex: 101, claude: 0), .init(codex: -1, claude: 50)] {
        var invalid = host; invalid.capacityPlan = bad
        do { try C.validate(invalid); try check(false, "invalid plan accepted") } catch { checks += 1 }
    }
    let request = C.Request(taskID: "task-fixture", request: writeRequest, requestSHA256: C.digest(Data(writeRequest.utf8)),
        objective: writeRequest, policySHA256: C.digest(Data("p".utf8)), sourceFingerprint: C.digest(planBytes), mode: .auto,
        materialRefs: [], budget: .init(maxAttempts: 2, maxParallel: 4, maxCostUnits: nil, maxDurationMS: 60_000), hostContext: host)
    try check(try C.decodeRequest(C.encode(request)).hostContext?.capacityPlan == host.capacityPlan, "capacity plan round trip")
    var extra = try JSONSerialization.jsonObject(with: C.encode(request)) as! [String: Any]
    var extraHost = extra["host_context"] as! [String: Any]
    extraHost["capacity_plan"] = ["codex": 30, "claude": 100, "chatgpt": 5]; extra["host_context"] = extraHost
    do { _ = try C.decodeRequest(JSONSerialization.data(withJSONObject: extra)); try check(false, "extra plan field accepted") }
    catch { checks += 1 }
    let oldCatalog = C.Catalog(taskID: "task-fixture", requestSHA256: request.requestSHA256, candidates: decoded.candidates)
    try check(!String(decoding: try C.encode(oldCatalog), as: UTF8.self).contains("exclusions") &&
              (try C.decodeCatalog(C.encode(oldCatalog))) == oldCatalog, "a catalog without exclusions is unchanged")
    let emptyOpaque = C.Catalog(taskID: "task-fixture", requestSHA256: request.requestSHA256, candidates: [])
    do { _ = try C.decodeCatalog(C.encode(emptyOpaque)); try check(false, "unexplained empty catalog accepted") } catch { checks += 1 }
    for bad in [[C.Exclusion(provider: "codex", reason: "cheaper", count: 1)], [.init(provider: "chatgpt", reason: "gpt_dropped", count: 1)],
                [.init(provider: "codex", reason: "quota_zero", count: 0)], [],
                [.init(provider: "codex", reason: "quota_zero", count: 1), .init(provider: "codex", reason: "quota_zero", count: 2)]] {
        let invalid = C.Catalog(taskID: "task-fixture", requestSHA256: request.requestSHA256, candidates: [], exclusions: bad)
        do { _ = try C.decodeCatalog(C.encode(invalid)); try check(false, "invalid exclusions accepted") } catch { checks += 1 }
    }

    // ---- Explicit fan-out: GPT parts are dropped, not substituted -----------
    let fanout = RouteFanout.plan("1+1 GPT한테. 2+2 Codex한테. 3+3 Claude한테. 4+4 Claude Code한테.")
    let partition = RouteFanout.droppingGPT(fanout?.targets ?? [])
    try check(partition.kept.map(\.surface) == [.codex, .claudeChat, .claude] && partition.dropped.map(\.surface) == [.chatgpt] &&
              partition.remapped.isEmpty, "one GPT part is dropped; the other three still run")
    let notice = RouteFanout.gptDroppedNotice(partition.dropped, remaining: partition.kept.count)
    try check(notice.contains("1+1") && notice.contains("3"), "the drop notice names the dropped part and the remaining count")
    let allGPT = RouteFanout.droppingGPT(RouteFanout.plan("1+1 GPT한테. 2+2 gpt-chat한테.")?.targets ?? [])
    try check(allGPT.kept.isEmpty && allGPT.dropped.map(\.surface) == [.chatgpt, .gptChat],
              "an all-GPT fan-out keeps nothing, so Core holds it visibly")
    // A part addressed to Codex as a chat lane names Codex, not GPT: it runs
    // on Codex with a notice, never dropped as GPT.
    for text in ["1+1 코덱스 채팅한테. 2+2 클로드한테.", "1+1 Codex chat한테. 2+2 Claude한테."] {
        let codexChat = RouteFanout.droppingGPT(RouteFanout.plan(text)?.targets ?? [])
        try check(codexChat.kept.map { "\($0.surface.rawValue):\($0.payload)" } == ["codex:1+1", "claude-chat:2+2"] &&
                  codexChat.dropped.isEmpty && codexChat.remapped.count == 1 &&
                  RouteFanout.codexChatRemappedNotice(codexChat.remapped).contains("1+1"),
                  "a Codex-named chat part runs on Codex: \(text)")
    }
    let bothCodex = RouteFanout.droppingGPT(RouteFanout.plan("1+1 Codex chat한테. 2+2 코덱스 채팅한테.")?.targets ?? [])
    try check(bothCodex.kept.map(\.surface) == [.codex, .codex] && bothCodex.dropped.isEmpty,
              "two Codex-named chat parts both run on Codex, nothing is held")
    let repeated = RouteFanout.droppingGPT(RouteFanout.plan("1+1 Codex chat한테. 1+1 Codex한테.")?.targets ?? [])
    try check(repeated.kept.map { "\($0.surface.rawValue):\($0.payload)" } == ["codex:1+1"],
              "a remapped part never duplicates an existing Codex route")
    try check(ProviderSurface.Backend.openAI.surfaces == [.codex] && ProviderSurface.Backend.openAI.resolve("gpt-chat") == .codex &&
              ProviderSurface.Backend.openAI.resolve("chatgpt") == .codex, "the OpenAI tile no longer offers GPT")
    try check("클로드한테 시켜".range(of: ProviderNameAliases.claude, options: .regularExpression) != nil &&
              "클로드한테 시켜".range(of: ProviderNameAliases.claudeKoreanSpellings, options: .regularExpression) != nil &&
              "클라우드로 백업".range(of: ProviderNameAliases.claudeKoreanSpellings, options: .regularExpression) == nil,
              "one alias table: 클로드 is Claude everywhere; the cloud word stays out of account detection")
    func directed(_ text: String, _ pattern: String) -> Bool { text.range(of: pattern, options: .regularExpression) != nil }
    try check(directed("클로즈한테 이거 시켜", ProviderNameAliases.claudeDirected) &&
              directed("클로드 코드한테 시켜", ProviderNameAliases.claudeDirected) &&
              !directed("이 pr 클로즈해줘", ProviderNameAliases.claudeDirected) &&
              !directed("이슈 클로즈 해줘", ProviderNameAliases.claudeDirected) &&
              !directed("포지션 클로즈해", ProviderNameAliases.claudeDirected) &&
              directed("코덱한테 이거 시켜", ProviderNameAliases.codexDirected) &&
              directed("코덱 에게 시켜", ProviderNameAliases.codexDirected) &&
              directed("코덱센트 시켜", ProviderNameAliases.codexDirected) &&
              directed("코덱스로 돌려", ProviderNameAliases.codexDirected) &&
              !directed("이 영상 h 264 코덱으로 인코딩해", ProviderNameAliases.codexDirected) &&
              !directed("코덱 설정 확인해", ProviderNameAliases.codexDirected),
              "the directed detector: 클로즈 ('close') and bare 코덱 ('codec') only before a dative particle")

    print("RCC native catalog builder: \(checks) checks OK; model calls 0")
}

/// The former inline `rccNativeCatalog` row loop (build 7bf2409), kept only
/// as a reference to prove that row identity and bytes did not change.
private func legacyRows(_ input: RCCNativeCatalogBuilder.Input, chatRefused: Bool) -> [[String: Any]] {
    var candidates: [[String: Any]] = []
    for profile in input.profiles.sorted(by: { $0.action < $1.action }) {
        guard ["codex", "claude"].contains(profile.provider), profile.provider != "codex" || input.showCodex else { continue }
        let available = profile.provider == "codex"
            ? input.codexModels.contains { $0.slug == profile.model && $0.supportedEfforts.contains(profile.effort) }
            : input.claudeModels.contains { $0.model == profile.model && $0.supportedEfforts.contains(profile.effort) }
        guard available, input.auth[profile.provider] == .subscription else { continue }
        let account = input.accountIDs[profile.provider] ?? ""
        let quota = profile.provider == "codex" ? input.codexQuota : input.claudeQuota
        let remaining = quota?.effectiveRemaining(accountID: account, model: profile.model, now: input.now)
        if remaining == 0 { continue }
        let scopes = input.requireReadOnly || ScopeResolution.resolve(input.request).scope == .readOnly
            ? ["read_only"] : ["read_only", "workspace_write"]
        for scope in scopes {
            let surfaces = scope == "read_only" ? [profile.provider, profile.provider == "codex" ? "gpt-chat" : "claude-chat"] : [profile.provider]
            for surface in surfaces {
                guard input.providerPreference == "auto" || input.providerPreference == surface else { continue }
                if surface.hasSuffix("-chat"), chatRefused { continue }
                let tools = surface.hasSuffix("-chat") ? [] : scope == "read_only" ? ["read", "execute"] : ["read", "write", "execute"]
                let tuple = [surface, profile.provider, account, profile.model, profile.effort, scope, input.executorContractSHA256].joined(separator: "\n")
                let digest = RCCRuntimeContract.digest(Data(tuple.utf8))
                candidates.append(["id": "cfg-" + String(digest.prefix(32)), "surface": surface,
                    "transport": profile.provider == "codex" ? "codex_app_server" : "claude_cli",
                    "account_id": account, "model": profile.model, "effort": profile.effort, "tools": tools,
                    "scope": scope, "permission_profile": scope,
                    "quota_pool": profile.provider == "codex" ? "openai_codex" : "anthropic_shared",
                    "allowed_paths": scope == "workspace_write" ? ["**"] : [], "configuration_sha256": digest,
                    "availability": "available", "availability_observed_at_ms": Int64(input.now.timeIntervalSince1970 * 1000),
                    "availability_valid_until_ms": Int64(input.now.addingTimeInterval(120).timeIntervalSince1970 * 1000),
                    "quota_remaining_fraction": remaining.map { $0 / 100 } as Any? ?? NSNull(),
                    "quota_observed_at_ms": quota.map { Int64($0.observedAt.timeIntervalSince1970 * 1000) } as Any? ?? NSNull(),
                    "quota_valid_until_ms": quota.flatMap { $0.isFresh(accountID: account, now: input.now) ? Int64($0.observedAt.addingTimeInterval(120).timeIntervalSince1970 * 1000) : nil } as Any? ?? NSNull(),
                    "quality_state": "policy_admitted", "estimated_cost_units": NSNull()])
            }
        }
    }
    return candidates
}

/// The JS runtime's own fingerprint for canonical host bytes (a real Node
/// import of the sealed module; no runtime, adapter or provider is started).
private func javascriptHostFingerprint(_ bytes: Data) throws -> String {
    let runtimeModule = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Resources/openclaw-os1-bridge/rcc-runtime.mjs")
    let pinnedNode = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/share/node-v24.20.0/bin/node")
    let process = Process(), input = Pipe(), output = Pipe(), errors = Pipe()
    if let override = ProcessInfo.processInfo.environment["OS1_RCC_CONTRACT_NODE"] { process.executableURL = URL(fileURLWithPath: override) }
    else if FileManager.default.isExecutableFile(atPath: pinnedNode.path) { process.executableURL = pinnedNode }
    else { process.executableURL = URL(fileURLWithPath: "/usr/bin/env") }
    let script = """
    import {pathToFileURL} from 'node:url';
    import {readFileSync} from 'node:fs';
    const {hostContextFingerprint}=await import(pathToFileURL(process.argv[1]).href);
    process.stdout.write(hostContextFingerprint(JSON.parse(readFileSync(0,'utf8'))));
    """
    process.arguments = (process.executableURL?.path == "/usr/bin/env" ? ["node"] : []) +
        ["--input-type=module", "-e", script, runtimeModule.path]
    process.standardInput = input; process.standardOutput = output; process.standardError = errors
    try process.run(); try input.fileHandleForWriting.write(contentsOf: bytes); try input.fileHandleForWriting.close()
    let digest = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    _ = errors.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
    return process.terminationStatus == 0 ? digest : ""
}
