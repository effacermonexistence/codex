import CryptoKit
import Foundation

/// Build 442 (owner order 2026-10-27, DESIGN-3): which cheaper (model, effort)
/// may stand for a pool's reference on deep work, by the providers' own
/// benchmarks at tolerance delta = 0.
///
/// Compiled, never computed at run time: `scripts/capability-table.mjs`
/// applies the qualification rule (DESIGN-3 "Qualification rule", plus the
/// two conservative blockers it documents) to the reconciled first-party
/// benchmark rows `scripts/capability-evidence-20261027.json` and the compiled
/// list prices, and prints these bytes. `Resources/model-capability-table.json`
/// is the reviewable copy; fixtures prove the script output, the resource and
/// these bytes identical.
///
/// Per domain (the local classifier's v3 `domain`) and pool: the pool's
/// reference, the qualifying (model, effort) rows ordered by price (typical
/// call, then lower effort), the benchmarks and deltas behind each row with
/// their source URLs, and the rows only a blocker removed. Never a quality
/// claim about one answer: a capability route reads "공식 벤치마크상 기준 이상 ·
/// 이 답의 품질은 미검증". Refreshed only by recompiling on a new model release
/// (open item; FrontierNewsMonitor watches releases).
public struct ModelCapabilityTable: Codable, Equatable, Sendable {
    public struct Benchmark: Codable, Equatable, Sendable {
        public var benchmark: String
        public var category: String
        public var score: Double
        public var referenceScore: Double
        public var referenceEffort: String
        public var delta: Double
        public var lowerIsBetter: Bool
        public var unit: String
        public var cost: Double?
        public var referenceCost: Double?
        public var costComparable: Bool
        public var sources: [String]
        enum CodingKeys: String, CodingKey {
            case benchmark, category, score, delta, unit, cost, sources
            case referenceScore = "reference_score", referenceEffort = "reference_effort"
            case lowerIsBetter = "lower_is_better", referenceCost = "reference_cost", costComparable = "cost_comparable"
        }
    }
    public struct Entry: Codable, Equatable, Sendable {
        public var model: String
        public var effort: String
        public var typicalCallUSD: Double
        public var benchmarks: [Benchmark]
        enum CodingKeys: String, CodingKey { case model, effort, benchmarks, typicalCallUSD = "typical_call_usd" }
    }
    public struct Reference: Codable, Equatable, Sendable {
        public var model: String
        public var effort: String
        public var typicalCallUSD: Double?
        public var sharedBenchmarks: [String]
        enum CodingKeys: String, CodingKey {
            case model, effort, typicalCallUSD = "typical_call_usd", sharedBenchmarks = "shared_benchmarks"
        }
    }
    public struct Blocked: Codable, Equatable, Sendable {
        public var model: String
        public var effort: String
        public var reason: String
    }
    public struct Pool: Codable, Equatable, Sendable {
        public var reference: Reference
        public var qualifying: [Entry]
        public var blocked: [Blocked]
        public var rejectedCount: Int
        enum CodingKeys: String, CodingKey { case reference, qualifying, blocked, rejectedCount = "rejected_count" }
    }
    public struct Category: Codable, Equatable, Sendable {
        public var evidenceCategory: String
        public var pools: [String: Pool]
        enum CodingKeys: String, CodingKey { case pools, evidenceCategory = "evidence_category" }
    }
    public struct TypicalCall: Codable, Equatable, Sendable {
        public var uncachedInput: Int
        public var cachedInput: Int
        public var output: Int
        enum CodingKeys: String, CodingKey { case output, uncachedInput = "uncached_input", cachedInput = "cached_input" }
    }

    public var schema: Int
    public var policy: String
    public var tolerance: Double
    public var compiledOn: String
    public var blockers: [String]
    public var evidenceSHA256: String
    public var priceTableSHA256: String
    public var typicalCall: TypicalCall
    public var basis: String
    public var categories: [String: Category]
    enum CodingKeys: String, CodingKey {
        case schema, policy, tolerance, blockers, basis, categories
        case compiledOn = "compiled_on", evidenceSHA256 = "evidence_sha256", priceTableSHA256 = "price_table_sha256"
        case typicalCall = "typical_call"
    }

    public static let currentPolicy = RCCRuntimeContract.CapabilityRoutes.currentPolicy
    /// The quota pool of each provider the table covers (Core's pool names).
    public static let pools = ["openai_codex", "anthropic_shared"]
    static let efforts = ["low", "medium", "high", "xhigh", "max", "ultra"]

    public static let compiledBytes = Data((#"{"basis":"first_party_benchmarks_delta0_not_an_answer_check","blockers":["unconfirmed_below_reference","below_reference_at_higher_effort"],"categories":{"coding":{"evidence_category":"coding/agentic","pools":{"anthropic_shared":{"blocked":[{"effort":"xhigh","model":"claude-sonnet-5-5","reason":"below_reference_at_higher_effort:SWE-bench Multimodal@max"}],"qualifying":[{"benchmarks":[{"benchmark":"CursorBench 4.0","category":"coding/agentic","cost":2.9,"cost_comparable":true,"delta":0.7,"lower_is_better":false,"reference_cost":17.28,"reference_effort":"max","reference_score":51.8,"score":52.5,"sources":["https://www.anthropic.com/claude-opus-5-5","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"},{"benchmark":"FrontierCode v1.1 Extended","category":"coding/agentic","cost":null,"cost_comparable":false,"delta":1.7,"lower_is_better":false,"reference_cost":null,"reference_effort":"medium","reference_score":63.6,"score":65.3,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"},{"benchmark":"FrontierCode v1.1 Main","category":"coding/agentic","cost":0.8,"cost_comparable":true,"delta":4.36,"lower_is_better":false,"reference_cost":12.82,"reference_effort":"max","reference_score":50.28,"score":54.64,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-opus-5-5"],"unit":"%"},{"benchmark":"Internal agentic-coding benchmark, 370 tasks (docs)","category":"coding/agentic","cost":0.84,"cost_comparable":true,"delta":2.4,"lower_is_better":false,"reference_cost":2.68,"reference_effort":"medium","reference_score":84.2,"score":86.6,"sources":["https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence"],"unit":"%"},{"benchmark":"SWE-bench Pro subset (Anthropic 478-problem harness, docs)","category":"coding/agentic","cost":0.21,"cost_comparable":false,"delta":0.5,"lower_is_better":false,"reference_cost":1.19,"reference_effort":"high","reference_score":92.3,"score":92.8,"sources":["https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence"],"unit":"%"},{"benchmark":"Terminal-Bench 4.0","category":"coding/agentic","cost":2.94,"cost_comparable":true,"delta":1.8,"lower_is_better":false,"reference_cost":19.5,"reference_effort":"max","reference_score":55.8,"score":57.6,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-fable-and-mythos-5-1","https://www.anthropic.com/claude-opus-5-5","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"}],"effort":"medium","model":"claude-opus-5-5","typical_call_usd":0.074},{"benchmarks":[{"benchmark":"CursorBench 4.0","category":"coding/agentic","cost":3.97,"cost_comparable":true,"delta":4.2,"lower_is_better":false,"reference_cost":17.28,"reference_effort":"max","reference_score":51.8,"score":56,"sources":["https://www.anthropic.com/claude-opus-5-5","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"},{"benchmark":"FrontierCode v1.1 Main","category":"coding/agentic","cost":1.09,"cost_comparable":true,"delta":3.71,"lower_is_better":false,"reference_cost":12.82,"reference_effort":"max","reference_score":50.28,"score":53.99,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-opus-5-5"],"unit":"%"},{"benchmark":"SWE-bench Pro subset (Anthropic 478-problem harness, docs)","category":"coding/agentic","cost":0.29,"cost_comparable":false,"delta":3,"lower_is_better":false,"reference_cost":1.19,"reference_effort":"high","reference_score":92.3,"score":95.3,"sources":["https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence"],"unit":"%"},{"benchmark":"Terminal-Bench 4.0","category":"coding/agentic","cost":3.88,"cost_comparable":true,"delta":8.4,"lower_is_better":false,"reference_cost":19.5,"reference_effort":"max","reference_score":55.8,"score":64.2,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-fable-and-mythos-5-1","https://www.anthropic.com/claude-opus-5-5","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"}],"effort":"high","model":"claude-opus-5-5","typical_call_usd":0.074},{"benchmarks":[{"benchmark":"CursorBench 4.0","category":"coding/agentic","cost":6.99,"cost_comparable":true,"delta":4.2,"lower_is_better":false,"reference_cost":17.28,"reference_effort":"max","reference_score":51.8,"score":56,"sources":["https://www.anthropic.com/claude-opus-5-5","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"},{"benchmark":"FrontierCode v1.1 Main","category":"coding/agentic","cost":2.25,"cost_comparable":true,"delta":1.14,"lower_is_better":false,"reference_cost":12.82,"reference_effort":"max","reference_score":50.28,"score":51.42,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-opus-5-5"],"unit":"%"},{"benchmark":"SWE-bench Pro subset (Anthropic 478-problem harness, docs)","category":"coding/agentic","cost":0.74,"cost_comparable":false,"delta":4.4,"lower_is_better":false,"reference_cost":1.19,"reference_effort":"high","reference_score":92.3,"score":96.7,"sources":["https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence"],"unit":"%"},{"benchmark":"Terminal-Bench 4.0","category":"coding/agentic","cost":7.35,"cost_comparable":true,"delta":10.6,"lower_is_better":false,"reference_cost":19.5,"reference_effort":"max","reference_score":55.8,"score":66.4,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-fable-and-mythos-5-1","https://www.anthropic.com/claude-opus-5-5","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"}],"effort":"xhigh","model":"claude-opus-5-5","typical_call_usd":0.074},{"benchmarks":[{"benchmark":"CursorBench 4.0","category":"coding/agentic","cost":13.43,"cost_comparable":true,"delta":6,"lower_is_better":false,"reference_cost":17.28,"reference_effort":"max","reference_score":51.8,"score":57.8,"sources":["https://www.anthropic.com/claude-opus-5-5","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"},{"benchmark":"DeepSWE v1.1","category":"coding/agentic","cost":null,"cost_comparable":false,"delta":6.8,"lower_is_better":false,"reference_cost":null,"reference_effort":"max","reference_score":67.4,"score":74.2,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"},{"benchmark":"FrontierCode v1.1 Extended","category":"coding/agentic","cost":null,"cost_comparable":false,"delta":0,"lower_is_better":false,"reference_cost":null,"reference_effort":"medium","reference_score":63.6,"score":63.6,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"},{"benchmark":"FrontierCode v1.1 Main","category":"coding/agentic","cost":6.19,"cost_comparable":true,"delta":4.15,"lower_is_better":false,"reference_cost":12.82,"reference_effort":"max","reference_score":50.28,"score":54.43,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-opus-5-5"],"unit":"%"},{"benchmark":"FrontierSWE v2","category":"coding/agentic","cost":null,"cost_comparable":false,"delta":6,"lower_is_better":false,"reference_cost":null,"reference_effort":"max","reference_score":56.3,"score":62.3,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"},{"benchmark":"ProgramBench (long-context coding)","category":"coding/agentic","cost":null,"cost_comparable":false,"delta":3.6,"lower_is_better":false,"reference_cost":null,"reference_effort":"max","reference_score":87.6,"score":91.2,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"},{"benchmark":"SWE-bench Multilingual","category":"coding/agentic","cost":null,"cost_comparable":false,"delta":4.8,"lower_is_better":false,"reference_cost":null,"reference_effort":"max","reference_score":89.1,"score":93.9,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"},{"benchmark":"SWE-bench Multimodal","category":"coding/agentic","cost":null,"cost_comparable":false,"delta":6.7,"lower_is_better":false,"reference_cost":null,"reference_effort":"max","reference_score":54.7,"score":61.4,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"},{"benchmark":"SWE-bench Pro","category":"coding/agentic","cost":null,"cost_comparable":false,"delta":8.7,"lower_is_better":false,"reference_cost":null,"reference_effort":"max","reference_score":81.2,"score":89.9,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"},{"benchmark":"Terminal-Bench 4.0","category":"coding/agentic","cost":11.24,"cost_comparable":true,"delta":9,"lower_is_better":false,"reference_cost":19.5,"reference_effort":"max","reference_score":55.8,"score":64.8,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-fable-and-mythos-5-1","https://www.anthropic.com/claude-opus-5-5","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"}],"effort":"max","model":"claude-opus-5-5","typical_call_usd":0.074}],"reference":{"effort":"max","model":"claude-fable-5-1","shared_benchmarks":["CursorBench 4.0","DeepSWE v1.1","FrontierCode v1.1 Extended","FrontierCode v1.1 Main","FrontierSWE v2","Internal agentic-coding benchmark, 370 tasks (docs)","ProgramBench (long-context coding)","SWE-bench Multilingual","SWE-bench Multimodal","SWE-bench Pro","SWE-bench Pro subset (Anthropic 478-problem harness, docs)","Terminal-Bench 4.0"],"typical_call_usd":0.18},"rejected_count":16},"openai_codex":{"blocked":[],"qualifying":[],"reference":{"effort":"max","model":"gpt-6-astra","shared_benchmarks":["Agents' Last Exam v1 (Terra post chart)","Codex stale-experiment cleanup (internal workflow, accepted findings)","DeepSWE v1.1 (6.1 Sol post chart)","ExploitBench (cyber; saturated, contamination noted)","ExploitGym (intended-vulnerability success)","FrontierCode 1.1 Main (Sol/Luna post chart)","Internal Research Debugging (mean rubric, system cards)","SEC-Bench Pro (pass@1, system cards)","Terminal-Bench 4.0 (Terra post chart)"],"typical_call_usd":0.195},"rejected_count":27}}},"knowledge":{"evidence_category":"explain/knowledge","pools":{"anthropic_shared":{"blocked":[],"qualifying":[{"benchmarks":[{"benchmark":"Chartography (no tools, regraded)","category":"explain/knowledge","cost":null,"cost_comparable":false,"delta":19.6,"lower_is_better":false,"reference_cost":null,"reference_effort":"max","reference_score":44.8,"score":64.4,"sources":["https://www.anthropic.com/claude-haiku-5-5-system-card","https://www.anthropic.com/claude-opus-5-5-system-card","https://www.anthropic.com/claude-sonnet-5-5-system-card"],"unit":"%"},{"benchmark":"Chartography (with tools, regraded)","category":"explain/knowledge","cost":null,"cost_comparable":false,"delta":0.6,"lower_is_better":false,"reference_cost":null,"reference_effort":"max","reference_score":88.4,"score":89,"sources":["https://www.anthropic.com/claude-haiku-5-5-system-card","https://www.anthropic.com/claude-opus-5-5-system-card","https://www.anthropic.com/claude-sonnet-5-5-system-card"],"unit":"%"},{"benchmark":"Global MMLU (42 languages)","category":"explain/knowledge","cost":null,"cost_comparable":false,"delta":0.3,"lower_is_better":false,"reference_cost":null,"reference_effort":"max","reference_score":94,"score":94.3,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-haiku-5-5-system-card","https://www.anthropic.com/claude-opus-5-5-system-card","https://www.anthropic.com/claude-sonnet-5-5-system-card"],"unit":"%"},{"benchmark":"HealthBench Professional (length-adjusted)","category":"explain/knowledge","cost":null,"cost_comparable":false,"delta":3.5,"lower_is_better":false,"reference_cost":null,"reference_effort":"max","reference_score":62.1,"score":65.6,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"},{"benchmark":"HealthBench Professional (raw)","category":"explain/knowledge","cost":null,"cost_comparable":false,"delta":2.9,"lower_is_better":false,"reference_cost":null,"reference_effort":"max","reference_score":74.2,"score":77.1,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-haiku-5-5-system-card","https://www.anthropic.com/claude-opus-5-5-system-card","https://www.anthropic.com/claude-sonnet-5-5-system-card"],"unit":"%"}],"effort":"max","model":"claude-opus-5-5","typical_call_usd":0.074}],"reference":{"effort":"max","model":"claude-fable-5-1","shared_benchmarks":["Chartography (no tools, regraded)","Chartography (with tools, regraded)","Global MMLU (42 languages)","HealthBench Professional (length-adjusted)","HealthBench Professional (raw)"],"typical_call_usd":0.18},"rejected_count":7},"openai_codex":{"blocked":[],"qualifying":[],"reference":{"effort":"max","model":"gpt-6-astra","shared_benchmarks":["Factual error rate, difficult prompts - original version (lower is better)","Factual error rate, difficult prompts - refreshed Terra version (lower is better)","HealthBench Hard, length-adjusted (system cards)","HealthBench Professional, length-adjusted (system cards)","MMMU-Pro (Vision) (Terra post chart)","MentalHealthBench overall (system cards, max effort)"],"typical_call_usd":0.195},"rejected_count":25}}},"math":{"evidence_category":"math","pools":{"anthropic_shared":{"blocked":[],"qualifying":[{"benchmarks":[{"benchmark":"ArXivMath Aug 2026 (no tools)","category":"math","cost":null,"cost_comparable":false,"delta":3.9,"lower_is_better":false,"reference_cost":null,"reference_effort":"max","reference_score":82.9,"score":86.8,"sources":["https://www.anthropic.com/claude-opus-5-5-system-card","https://www.anthropic.com/claude-sonnet-5-5-system-card"],"unit":"%"},{"benchmark":"ArXivMath Aug 2026 (with tools)","category":"math","cost":null,"cost_comparable":false,"delta":3.1,"lower_is_better":false,"reference_cost":null,"reference_effort":"max","reference_score":92.1,"score":95.2,"sources":["https://www.anthropic.com/claude-opus-5-5-system-card","https://www.anthropic.com/claude-sonnet-5-5-system-card"],"unit":"%"}],"effort":"max","model":"claude-sonnet-5-5","typical_call_usd":0.037},{"benchmarks":[{"benchmark":"ArXivMath Aug 2026 (no tools)","category":"math","cost":null,"cost_comparable":false,"delta":8.3,"lower_is_better":false,"reference_cost":null,"reference_effort":"max","reference_score":82.9,"score":91.2,"sources":["https://www.anthropic.com/claude-opus-5-5-system-card","https://www.anthropic.com/claude-sonnet-5-5-system-card"],"unit":"%"},{"benchmark":"ArXivMath Aug 2026 (with tools)","category":"math","cost":null,"cost_comparable":false,"delta":4.8,"lower_is_better":false,"reference_cost":null,"reference_effort":"max","reference_score":92.1,"score":96.9,"sources":["https://www.anthropic.com/claude-opus-5-5-system-card","https://www.anthropic.com/claude-sonnet-5-5-system-card"],"unit":"%"}],"effort":"max","model":"claude-opus-5-5","typical_call_usd":0.074}],"reference":{"effort":"max","model":"claude-fable-5-1","shared_benchmarks":["ArXivMath Aug 2026 (no tools)","ArXivMath Aug 2026 (with tools)"],"typical_call_usd":0.18},"rejected_count":1},"openai_codex":{"blocked":[],"qualifying":[],"reference":{"effort":"max","model":"gpt-6-astra","shared_benchmarks":["FrontierMath Tier 4 (v2)"],"typical_call_usd":0.195},"rejected_count":5}}},"science":{"evidence_category":"science/reasoning","pools":{"anthropic_shared":{"blocked":[],"qualifying":[{"benchmarks":[{"benchmark":"Humanity's Last Exam (no tools)","category":"science/reasoning","cost":null,"cost_comparable":false,"delta":3.48,"lower_is_better":false,"reference_cost":2.23,"reference_effort":"max","reference_score":60.92,"score":64.4,"sources":["https://www.anthropic.com/claude-fable-and-mythos-5-1","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"},{"benchmark":"Terminal-Bench-Science 0.1","category":"science/reasoning","cost":null,"cost_comparable":false,"delta":6.1,"lower_is_better":false,"reference_cost":37.9,"reference_effort":"max","reference_score":52.6,"score":58.7,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-fable-and-mythos-5-1","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"}],"effort":"max","model":"claude-opus-5-5","typical_call_usd":0.074}],"reference":{"effort":"max","model":"claude-fable-5-1","shared_benchmarks":["ARC-AGI-2 (semi-private)","Humanity's Last Exam (no tools)","Terminal-Bench-Science 0.1"],"typical_call_usd":0.18},"rejected_count":16},"openai_codex":{"blocked":[],"qualifying":[],"reference":{"effort":"max","model":"gpt-6-astra","shared_benchmarks":["ARC-AGI-2","GPQA Diamond (Astra launch chart)","GeneBench Pro (Astra launch chart)","Humanity's Last Exam (with tools)","Terminal-Bench Science 0.1 (6.1 Sol / Terra post charts)"],"typical_call_usd":0.195},"rejected_count":20}}},"tool_use":{"evidence_category":"tool-use/web","pools":{"anthropic_shared":{"blocked":[],"qualifying":[{"benchmarks":[{"benchmark":"AutomationBench (Zapier, no fallback models)","category":"tool-use/web","cost":1.37,"cost_comparable":false,"delta":8.6,"lower_is_better":false,"reference_cost":null,"reference_effort":"max","reference_score":31.4,"score":40,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-opus-5-5","https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"},{"benchmark":"OSWorld 2.0-updated / 2.1 (Sep 10 2026 files), partial","category":"tool-use/web","cost":null,"cost_comparable":false,"delta":1.1,"lower_is_better":false,"reference_cost":null,"reference_effort":"max","reference_score":80.7,"score":81.8,"sources":["https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"},{"benchmark":"OSWorld 2.0-updated / 2.1 (Sep 10 2026 files), strict","category":"tool-use/web","cost":null,"cost_comparable":false,"delta":5.9,"lower_is_better":false,"reference_cost":null,"reference_effort":"max","reference_score":42.8,"score":48.7,"sources":["https://www.anthropic.com/claude-opus-5-5-system-card"],"unit":"%"},{"benchmark":"Toolathlon Verified Pass@1","category":"tool-use/web","cost":null,"cost_comparable":false,"delta":0,"lower_is_better":false,"reference_cost":null,"reference_effort":"max","reference_score":77.8,"score":77.8,"sources":["https://www.anthropic.com/claude-fable-5-1-mythos-5-1-system-card","https://www.anthropic.com/claude-opus-5-5-system-card","https://www.anthropic.com/claude-sonnet-5-5-system-card"],"unit":"%"}],"effort":"max","model":"claude-opus-5-5","typical_call_usd":0.074}],"reference":{"effort":"max","model":"claude-fable-5-1","shared_benchmarks":["AutomationBench (Zapier, no fallback models)","OSWorld 2.0-updated / 2.1 (Sep 10 2026 files), partial","OSWorld 2.0-updated / 2.1 (Sep 10 2026 files), strict","Toolathlon Verified Pass@1"],"typical_call_usd":0.18},"rejected_count":11},"openai_codex":{"blocked":[],"qualifying":[],"reference":{"effort":"max","model":"gpt-6-astra","shared_benchmarks":["AutomationBench 1.0.6 (6.1 Sol post chart)","BrowseComp","OSWorld 2.0 offline set, partial (6.1 Sol post run)","OSWorld 2.1 offline set (Terra post chart)"],"typical_call_usd":0.195},"rejected_count":25}}},"writing":{"evidence_category":"writing/deliverables","pools":{"anthropic_shared":{"blocked":[{"effort":"xhigh","model":"claude-opus-5-5","reason":"below_reference_at_higher_effort:OfficeQA@max"},{"effort":"xhigh","model":"claude-sonnet-5-5","reason":"unconfirmed_below_reference:GDPval-AA v2.1 (Elo)"}],"qualifying":[],"reference":{"effort":"max","model":"claude-fable-5-1","shared_benchmarks":["AA-Briefcase v1.1 (Elo)","GDPval-AA v2.1 (Elo)","Legal Agent Benchmark held-out (all-pass)","Legal Agent Benchmark held-out (criterion pass)","OfficeQA","OfficeQA Pro"],"typical_call_usd":0.18},"rejected_count":20},"openai_codex":{"blocked":[],"qualifying":[{"benchmarks":[{"benchmark":"GDP.pdf (6.1 Sol post chart)","category":"writing/deliverables","cost":0.3494,"cost_comparable":true,"delta":1,"lower_is_better":false,"reference_cost":2.0758,"reference_effort":"max","reference_score":31,"score":32,"sources":["https://openai.com/index/introducing-gpt-6-1-sol/"],"unit":"%"}],"effort":"high","model":"gpt-6.1-sol","typical_call_usd":0.037},{"benchmarks":[{"benchmark":"GDP.pdf (6.1 Sol post chart)","category":"writing/deliverables","cost":0.3681,"cost_comparable":true,"delta":0.8,"lower_is_better":false,"reference_cost":2.0758,"reference_effort":"max","reference_score":31,"score":31.8,"sources":["https://openai.com/index/introducing-gpt-6-1-sol/"],"unit":"%"}],"effort":"xhigh","model":"gpt-6.1-sol","typical_call_usd":0.037},{"benchmarks":[{"benchmark":"GDP.pdf (6.1 Sol post chart)","category":"writing/deliverables","cost":0.4199,"cost_comparable":true,"delta":0,"lower_is_better":false,"reference_cost":2.0758,"reference_effort":"max","reference_score":31,"score":31,"sources":["https://openai.com/index/introducing-gpt-6-1-sol/"],"unit":"%"}],"effort":"max","model":"gpt-6.1-sol","typical_call_usd":0.037}],"reference":{"effort":"max","model":"gpt-6-astra","shared_benchmarks":["GDP.pdf (6.1 Sol post chart)"],"typical_call_usd":0.195},"rejected_count":12}}}},"compiled_on":"2026-10-27","evidence_sha256":"742bd602c79ab9d39bd418ca4fe42ca0d049489a0a69a178788098242102d63f","policy":"capability_delta0_v1","price_table_sha256":"bb1dfcb77c246b2b67d70f97fd12503c37e883ae1590d4b082a48c81bda296a3","schema":1,"tolerance":0,"typical_call":{"cached_input":20000,"output":1500,"uncached_input":10000}}"# + "\n").utf8)
    public static let compiledSHA256 = "9a20bc80064a31dd8fc9e897212eb22f48fa5b33f0f6d03b707fb04eac6cdcd9"

    public enum Failure: Error, Equatable { case malformed, implausible }

    /// Strict decode: schema 1, the delta-0 policy, every domain and pool
    /// present, and every qualifying row cheaper than its pool's reference by
    /// the typical call, never below it on any benchmark behind it, at a
    /// dispatchable effort, priced in the same typical call shape as
    /// `ModelPriceTable.callUSD`.
    public static func decode(_ data: Data) throws -> ModelCapabilityTable {
        guard data.count <= 262_144, let value = try? JSONDecoder().decode(ModelCapabilityTable.self, from: data),
              value.schema == 1, value.policy == currentPolicy, value.tolerance == 0,
              value.typicalCall == TypicalCall(uncachedInput: 10_000, cachedInput: 20_000, output: 1_500),
              RCCRuntimeContract.isHash(value.evidenceSHA256), RCCRuntimeContract.isHash(value.priceTableSHA256),
              Set(value.categories.keys) == Set(RequestProfile.Domain.allCases.map(\.rawValue)) else { throw Failure.malformed }
        for category in value.categories.values {
            guard Set(category.pools.keys) == Set(pools) else { throw Failure.malformed }
            for pool in category.pools.values {
                let reference = pool.reference
                guard !reference.model.isEmpty, let referenceUSD = reference.typicalCallUSD, pool.qualifying.count <= 16,
                      Set(pool.qualifying.map { $0.model + "\n" + $0.effort }).count == pool.qualifying.count else {
                    throw Failure.implausible
                }
                for entry in pool.qualifying {
                    guard RCCRuntimeContract.CapabilityRoutes.validModel(entry.model), efforts.contains(entry.effort),
                          entry.typicalCallUSD.isFinite, entry.typicalCallUSD > 0, entry.typicalCallUSD < referenceUSD,
                          !entry.benchmarks.isEmpty, entry.benchmarks.allSatisfy({ benchmark in
                              benchmark.delta >= 0 && benchmark.sources.allSatisfy { $0.hasPrefix("https://") } &&
                                  (!benchmark.costComparable || (benchmark.cost ?? .infinity) < (benchmark.referenceCost ?? 0))
                          }) else { throw Failure.implausible }
                }
            }
        }
        return value
    }

    /// The compiled table. A byte or pin mismatch is a build defect the
    /// fixture rejects.
    public static var compiled: ModelCapabilityTable {
        // swiftlint:disable:next force_try
        try! decode(compiledBytes)
    }

    /// The catalog fact for one domain: each pool's qualifying (model, effort)
    /// rows in table order (price, then lower effort). Every domain has an
    /// entry (a pool with no qualifying row lists none).
    public func routes(for domain: RequestProfile.Domain) -> RCCRuntimeContract.CapabilityRoutes? {
        guard let category = categories[domain.rawValue] else { return nil }
        var lists: [String: [RCCRuntimeContract.CapabilityRoutes.Entry]] = [:]
        for pool in Self.pools {
            lists[pool] = (category.pools[pool]?.qualifying ?? []).map { .init(model: $0.model, effort: $0.effort) }
        }
        return .init(tableSHA256: Self.compiledSHA256, category: domain.rawValue, pools: lists)
    }

    /// `os1 capability show`: the table in readable lines (the compiled bytes
    /// themselves with --json).
    public func summary() -> String {
        var lines = ["OS-1 capability table (\(policy), tolerance \(tolerance == 0 ? "0" : String(tolerance)), compiled \(compiledOn))",
                     "sha256 \(Self.compiledSHA256); evidence \(evidenceSHA256.prefix(12)); prices \(priceTableSHA256.prefix(12))",
                     "blockers: " + (blockers.isEmpty ? "none" : blockers.joined(separator: ", ")),
                     "A row stands for its pool's reference on deep work only; the answer itself stays unverified."]
        for domain in RequestProfile.Domain.allCases {
            guard let category = categories[domain.rawValue] else { continue }
            lines.append("")
            lines.append("\(domain.rawValue) (\(category.evidenceCategory))")
            for pool in Self.pools {
                guard let value = category.pools[pool] else { continue }
                let reference = value.reference
                lines.append("  \(pool): reference \(reference.model) @\(reference.effort)" +
                    (reference.typicalCallUSD.map { String(format: " $%.4f/call", $0) } ?? "") +
                    ", \(reference.sharedBenchmarks.count) confirmed benchmark(s)")
                if value.qualifying.isEmpty { lines.append("    no cheaper row qualifies: the reference binds") }
                for entry in value.qualifying {
                    lines.append(String(format: "    %@ @%@ $%.4f/call", entry.model, entry.effort, entry.typicalCallUSD))
                    for benchmark in entry.benchmarks {
                        let cost = benchmark.costComparable ?
                            String(format: ", $%.2f vs $%.2f/task", benchmark.cost ?? 0, benchmark.referenceCost ?? 0) : ""
                        lines.append("      \(benchmark.benchmark): \(format(benchmark.score)) vs \(format(benchmark.referenceScore))" +
                            " @\(benchmark.referenceEffort) (\(benchmark.delta >= 0 ? "+" : "")\(format(benchmark.delta))" +
                            "\(benchmark.lowerIsBetter ? ", lower is better" : "")\(cost))")
                    }
                }
                for blocked in value.blocked {
                    lines.append("    blocked \(blocked.model) @\(blocked.effort): \(blocked.reason)")
                }
            }
        }
        return lines.joined(separator: "\n") + "\n"
    }
    private func format(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(format: "%g", value)
    }

    public static func selfTest() throws {
        var failed: [String] = []
        func check(_ value: Bool, _ name: String) { if !value { failed.append(name) } }
        let digest = SHA256.hash(data: compiledBytes).map { String(format: "%02x", $0) }.joined()
        check(digest == compiledSHA256, "compiled bytes match the pin")
        let table = compiled
        check(table.priceTableSHA256 == ModelPriceTable.compiledSHA256, "compiled against the compiled price table")
        let prices = ModelPriceTable.compiled
        for category in table.categories.values {
            for pool in category.pools.values {
                let reference = prices.callUSD(model: pool.reference.model)
                check(reference.map { abs($0 - (pool.reference.typicalCallUSD ?? -1)) < 1e-9 } == true,
                      "reference typical call = ModelPriceTable.callUSD")
                for entry in pool.qualifying {
                    check(prices.callUSD(model: entry.model).map { abs($0 - entry.typicalCallUSD) < 1e-9 } == true,
                          "qualifying typical call = ModelPriceTable.callUSD")
                }
            }
        }
        // DESIGN-3's evidence table, per domain: who may stand for the reference.
        func qualifying(_ domain: RequestProfile.Domain, _ pool: String) -> [String] {
            table.categories[domain.rawValue]?.pools[pool]?.qualifying.map { $0.model + "@" + $0.effort } ?? []
        }
        check(qualifying(.knowledge, "anthropic_shared") == ["claude-opus-5-5@max"] &&
              qualifying(.knowledge, "openai_codex").isEmpty, "knowledge: Opus 5.5 @max only")
        check(qualifying(.science, "anthropic_shared") == ["claude-opus-5-5@max"] &&
              qualifying(.science, "openai_codex").isEmpty, "science: Opus 5.5 @max only")
        check(qualifying(.math, "anthropic_shared") == ["claude-sonnet-5-5@max", "claude-opus-5-5@max"] &&
              qualifying(.math, "openai_codex").isEmpty, "math: Sonnet 5.5 @max, Opus 5.5 @max; OpenAI undetermined")
        check(qualifying(.coding, "anthropic_shared") ==
              ["claude-opus-5-5@medium", "claude-opus-5-5@high", "claude-opus-5-5@xhigh", "claude-opus-5-5@max"] &&
              qualifying(.coding, "openai_codex").isEmpty, "coding: Opus 5.5 medium..max; OpenAI none under the all-shared rule")
        check(qualifying(.writing, "openai_codex") == ["gpt-6.1-sol@high", "gpt-6.1-sol@xhigh", "gpt-6.1-sol@max"] &&
              qualifying(.writing, "anthropic_shared").isEmpty, "writing: GPT-6.1 Sol high/xhigh/max; Anthropic none")
        check(qualifying(.toolUse, "anthropic_shared") == ["claude-opus-5-5@max"] &&
              qualifying(.toolUse, "openai_codex").isEmpty, "tool use: Opus 5.5 @max only")
        check(table.routes(for: .coding)?.pools["anthropic_shared"]?.first == .init(model: "claude-opus-5-5", effort: "medium") &&
              table.routes(for: .coding)?.valid == true, "the catalog fact lists the table rows in order")
        var bad = try JSONSerialization.jsonObject(with: compiledBytes) as! [String: Any]
        bad["tolerance"] = 0.5
        check((try? decode(try JSONSerialization.data(withJSONObject: bad))) == nil, "a nonzero tolerance is refused")
        if !failed.isEmpty { throw NSError(domain: "ModelCapabilityTable", code: 1,
            userInfo: [NSLocalizedDescriptionKey: failed.joined(separator: "; ")]) }
    }
}
