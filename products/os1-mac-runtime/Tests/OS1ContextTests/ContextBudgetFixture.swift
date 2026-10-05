import Foundation
import OS1Context

/// All inputs are synthetic fixtures. No provider, live session store, account
/// credential, or original transcript is read by this regression suite.
func runContextBudgetFixtures() throws {
    var checks = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "Context budget: " + message); checks += 1
    }
    let ample = ContextBudgetConfiguration(softContextLimitTokens: 800_000, hardContextLimitTokens: 900_000)
    func measured(_ count: Int, model: String = "gpt-6.1-sol") -> ContextInputUsage {
        ContextInputUsage(provider: .openAI, model: model, inputTokens: count, source: "synthetic.request")
    }
    func api(_ count: Int) -> ContextBudgetReceipt {
        ContextBudgetPolicy.evaluate(provider: .openAI, model: "gpt-6.1-sol", billingScope: .api,
            measured: measured(count), resumable: false, configuration: ample)
    }
    check(api(271_999).premiumStatus == .belowOrAtThreshold, "below exact price boundary")
    check(api(272_000).premiumStatus == .belowOrAtThreshold, "exactly 272K is not greater than 272K")
    check(api(272_001).premiumStatus == .crossedMeasured, "272001 crosses premium tier")
    let rule = ContextPricingRegistry.rule(provider: .openAI, model: "gpt-6.1-sol")!
    check(rule.inputMultiplier == 2 && rule.cachedInputMultiplier == 2 && rule.cacheWriteMultiplier == 2 && rule.outputMultiplier == 1.5,
          "input/cache/output multipliers remain separate")
    check(rule.verifiedAt == "2026-10-04" && !rule.sourceURLs.isEmpty && rule.chargingScope == .request,
          "source and pricing verification date carried with rule")
    check(ContextPricingRegistry.rule(provider: .openAI, model: "gpt-5.4-2026-03-05")?.chargingScope == .sessionDocumentation,
          "known dated snapshot preserves older source wording")
    check(ContextPricingRegistry.rule(provider: .openAI, model: "gpt-5.4-2099-01-01") == nil,
          "arbitrary future date cannot inherit official pricing")
    check(ContextPricingRegistry.rule(provider: .openAI, model: "not-gpt-6.1-sol") == nil,
          "substring model collision cannot inherit official rule")
    check(ContextPricingRegistry.rule(provider: .openAI, model: "gpt-5.6")?.model == "gpt-5.6-sol",
          "official explicit alias remains supported")
    check(ContextPricingRegistry.rule(provider: .anthropic, model: "claude-sonnet-5-5")?.pricingThresholdTokens == nil,
          "newer Claude has no assumed 200K premium")
    let claude = ContextBudgetPolicy.evaluate(provider: .anthropic, model: "claude-opus-4-6", billingScope: .api,
        measured: ContextInputUsage(provider: .anthropic, model: "claude-opus-4-6", inputTokens: 400_000, source: "fixture"),
        resumable: false, configuration: ample)
    check(claude.premiumStatus == .noPremiumDocumented && claude.softLimitTokens == 800_000,
          "no 200K pricing guard on Claude4.6")
    let subscription = ContextBudgetPolicy.evaluate(provider: .openAI, model: "gpt-6.1-sol", billingScope: .subscription,
        measured: measured(400_000), resumable: false, configuration: ample)
    check(subscription.premiumStatus == .subscriptionNotEstablished && subscription.softLimitTokens == 800_000,
          "API pricing not projected onto included subscription usage")
    check(ContextBudgetPolicy.evaluate(provider: .openAI, model: "gpt-6.1-sol", measured: measured(400_000),
        resumable: false, configuration: ample).premiumStatus == .unknownBillingScope, "unknown billing scope stays unknown")
    check(ContextBudgetPolicy.evaluate(provider: .openAI, model: "future-model", billingScope: .api,
        resumable: false).premiumStatus == .unknownModel, "unknown model cannot receive price facts")

    let codex = Data("""
    {"type":"event_msg","payload":{"type":"task_started","turn_id":"t1"}}
    {"type":"turn_context","payload":{"model":"gpt-6.1-sol"}}
    {"type":"event_msg","payload":{"type":"token_count","info":{"model_context_window":900000,"total_token_usage":{"input_tokens":9000000},"last_token_usage":{"input_tokens":260000,"cached_input_tokens":200000,"cache_write_input_tokens":10000,"output_tokens":5}}}}
    {"type":"token_usage_record","payload":{"turn_id":"t1","response_id":"r2","turn_token_usage":{"input_tokens":9999999}}}
    {"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":15000000},"last_token_usage":{"input_tokens":270000,"cached_input_tokens":220000,"output_tokens":6}}}}
    """.utf8)
    let current = ContextInputUsageParser.parseCodexJSONL(codex, turnID: "t1")
    check(current?.inputTokens == 270_000, "last request replaces earlier request, never sums lifetime spend")
    check(current?.cachedInputTokens == 220_000, "OpenAI cache tokens are a subset, not added again")
    check(current?.model == "gpt-6.1-sol" && current?.turnID == "t1", "model and turn identity retained")
    check(ContextInputUsageParser.parseCodexJSONL(codex, turnID: "other") == nil, "wrong turn rejected")
    let cumulativeOnly = Data("""
    {"type":"token_usage_record","payload":{"turn_id":"t1","response_id":"r1","turn_token_usage":{"input_tokens":999999}}}
    {"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":999999}}}}
    """.utf8)
    check(ContextInputUsageParser.parseCodexJSONL(cumulativeOnly) == nil, "even response-tagged turn total is not current context")
    let explicit = Data("""
    {"type":"token_usage_record","payload":{"turn_id":"t1","response_id":"r1","usage":{"input_tokens":123,"cached_input_tokens":40,"cache_write_input_tokens":10}}}
    {"type":"token_usage_record","payload":{"turn_id":"t1","response_id":"r2","response_token_usage":{"input_tokens":456}}}
    """.utf8)
    check(ContextInputUsageParser.parseCodexJSONL(explicit)?.inputTokens == 456, "explicit per-response record accepted without summing")
    let malformed = Data("""
    {"type":"token_usage_record","payload":{"response_id":"r","usage":{"input_tokens":true}}}
    {"type":"token_usage_record","payload":{"response_id":"r","usage":{"input_tokens":-1}}}
    {"type":"token_usage_record","payload":{"response_id":"r","usage":{"input_tokens":10,"cached_input_tokens":11}}}
    """.utf8)
    check(ContextInputUsageParser.parseCodexJSONL(malformed) == nil, "booleans/negative/inconsistent usage rejected")
    let claudeJSON = Data("""
    {"type":"assistant","message":{"id":"m1","model":"claude-opus-5-5","usage":{"input_tokens":10,"cache_creation_input_tokens":100,"cache_read_input_tokens":200,"output_tokens":20}}}
    {"type":"assistant","message":{"id":"m2","model":"claude-opus-5-5","usage":{"input_tokens":5,"cache_creation_input_tokens":30,"cache_read_input_tokens":60,"output_tokens":3}}}
    {"type":"result","usage":{"input_tokens":9999999},"modelUsage":{"claude-opus-5-5":{"inputTokens":9999999}}}
    """.utf8)
    let claudeCurrent = ContextInputUsageParser.parseClaudeJSONL(claudeJSON)
    check(claudeCurrent?.inputTokens == 95 && claudeCurrent?.cachedInputTokens == 60,
          "Claude current request includes ordinary + write + read, not result/modelUsage totals")
    check(claudeCurrent?.responseID == "m2", "last Claude message ID retained")
    check(ContextInputUsageParser.parseClaudeJSONL(Data("""
    {"type":"assistant","message":{"id":"m","usage":{"input_tokens":10}}}
    """.utf8)) == nil, "missing Claude cache fields are unknown, not zero")
    check(ContextInputUsageParser.parseClaudeJSONL(Data("""
    {"type":"assistant","message":{"id":"m","model":"<synthetic>","usage":{"input_tokens":10,"cache_creation_input_tokens":1,"cache_read_input_tokens":1}}}
    """.utf8)) == nil, "synthetic errors cannot mint measurements")
    let estimate = ContextTokenEstimate.utf8(texts: ["hello", "한글😀"], structuralOverheadTokens: 20)
    check(estimate.utf8Bytes == 15 && estimate.inputTokens == 35 && estimate.evidenceClass.contains("estimate"),
          "UTF8 heuristic explicitly differs from provider count")

    let configuration = try ContextBudgetConfiguration.decode(Data("""
    {"context_budget":{"soft_context_limit_tokens":100000,"hard_context_limit_tokens":140000,
    "retrieval_budget_tokens":12000,"active_state_budget_tokens":4000,"safety_margin_tokens":1000,
    "minimum_handoff_savings_tokens":2000,"provider_thresholds":[{"provider":"openai","model":"gpt-6.1-sol",
    "pricing_threshold_tokens":120000,"comparison":">="}]}}
    """.utf8))
    check(configuration.retrievalBudgetTokens == 12_000 && configuration.activeStateBudgetTokens == 4_000,
          "paging and active budgets load from actual JSON override")
    let overridden = ContextPricingRegistry.rule(provider: .openAI, model: "gpt-6.1-sol", configuration: configuration)!
    check(overridden.pricingThresholdTokens == 120_000 && overridden.comparison == .greaterThanOrEqual &&
          overridden.verification == .configurationOverride, "configured threshold does not pretend to be new official evidence")
    let rotated = ContextBudgetPolicy.evaluate(provider: .openAI, model: "gpt-6.1-sol", billingScope: .api,
        measured: measured(130_000), freshSessionEstimateTokens: 20_000, resumable: true, configuration: configuration)
    check(rotated.action == .rotateSession && rotated.preserveRawHistory && !rotated.truncateRequest,
          "resumable smaller carry rotates; raw evidence never truncated")
    let notResumable = ContextBudgetPolicy.evaluate(provider: .openAI, model: "gpt-6.1-sol", billingScope: .api,
        measured: measured(130_000), freshSessionEstimateTokens: 20_000, resumable: false, configuration: configuration)
    check(notResumable.action == .continueWithWarning, "not resumable does not auto-rotate")
    let alreadyFresh = ContextBudgetPolicy.evaluate(provider: .openAI, model: "gpt-6.1-sol", billingScope: .api,
        measured: measured(130_000), freshSessionEstimateTokens: 20_000, resumable: true,
        alreadyFresh: true, configuration: configuration)
    check(alreadyFresh.action == .continueWithWarning, "fresh session never enters repeated rotation loop")
    let irreducible = ContextBudgetPolicy.evaluate(provider: .openAI, model: "gpt-6.1-sol", billingScope: .api,
        estimate: ContextTokenEstimate(inputTokens: 150_000, utf8Bytes: 148_000, structuralOverheadTokens: 2_000),
        freshSessionEstimateTokens: 150_000, resumable: true, alreadyFresh: true, configuration: configuration)
    check(irreducible.action == .holdRequest && !irreducible.truncateRequest,
          "one oversized request held without truncation, silent model switch, or repeated reset")
    let noSavings = ContextBudgetPolicy.evaluate(provider: .openAI, model: "gpt-6.1-sol", billingScope: .api,
        measured: measured(100_001), freshSessionEstimateTokens: 99_500, resumable: true, configuration: configuration)
    check(noSavings.action == .continueWithWarning, "sub-marginal gain does not pay a rotation cost")
    let prospective = ContextBudgetPolicy.evaluate(provider: .openAI, model: "gpt-6.1-sol", billingScope: .api,
        measured: measured(270_000), estimate: ContextTokenEstimate(inputTokens: 280_000, utf8Bytes: 280_000, structuralOverheadTokens: 0),
        resumable: false, configuration: ample)
    check(prospective.premiumStatus == .crossedEstimated && prospective.measured?.inputTokens == 270_000,
          "next-payload estimate and past measured request remain separate evidence")
    let mismatch = ContextBudgetPolicy.evaluate(provider: .anthropic, model: "claude-opus-5-5", billingScope: .api,
        measured: measured(500_000), resumable: true)
    check(mismatch.measured == nil && mismatch.evaluatedInputTokens == nil, "wrong-provider measurements cannot drive policy")
    let codexCapacity = ContextBudgetPolicy.evaluate(provider: .openAI, model: "gpt-5.3-codex", billingScope: .api,
        measured: measured(300_000, model: "gpt-5.3-codex"), resumable: false, configuration: ample)
    check(codexCapacity.hardLimitTokens == 272_000 && codexCapacity.action == .holdRequest,
          "model input capacity is not inferred from nominal total context")
    check(ContextBudgetPolicy.evaluate(provider: .openAI, model: "gpt-6.1-sol", billingScope: .api,
        measured: measured(150_000), resumable: false, configuration: ample,
        runtimeMaximumInputTokens: 100_000).action == .holdRequest, "executed runtime input capacity bounds published capability")
    let invalid = Data("{\"soft_context_limit_tokens\":200,\"hard_context_limit_tokens\":100}".utf8)
    do { _ = try ContextBudgetConfiguration.decode(invalid); preconditionFailure("invalid config accepted") }
    catch { checks += 1 }
    let invalidManual = ContextBudgetConfiguration(safetyMarginTokens: Int.min)
    check(ContextBudgetPolicy.evaluate(provider: .openAI, model: "gpt-6.1-sol", billingScope: .api,
        measured: measured(500_000), resumable: true, configuration: invalidManual).action == .holdRequest,
        "invalid manually constructed policy is held before unsafe arithmetic")
    let encoded = try JSONEncoder().encode(rotated)
    let roundTrip = try JSONDecoder().decode(ContextBudgetReceipt.self, from: encoded)
    check(roundTrip == rotated, "public receipt JSON preserves measurements, estimates, sources and adoption status")
    print("Context budget: \(checks) checks passed; per-request accounting, exact pricing boundaries, configurable budgets and lossless handoff gates")
}
