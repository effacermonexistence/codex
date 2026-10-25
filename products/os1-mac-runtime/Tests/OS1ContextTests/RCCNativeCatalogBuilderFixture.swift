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

    // Scope facts are not mutation authorization. These falsifiers protect
    // blanket bans from a broader ownerScope heuristic or a request-class fix.
    // A bounded named-target fence is tested separately by ScopeResolution;
    // no catalog hint may reinterpret a blanket ban as permission to write.
    let blanketWriteBans = [
        "Fix the login bug in Sources/App.swift. Do not modify files. Explain only.",
        "Repair report.csv. Do not modify any files; return an explanation only.",
        "Fix usage_ledger.py. Never modify files. Only describe the bug.",
        "이 파일의 버그를 고쳐줘. 파일 수정하지 마. 설명만 해.",
        "코드 문제를 확인해. 파일은 수정하지 마. 설명만 해.",
    ]
    for original in blanketWriteBans {
        let nfd = original.decomposedStringWithCanonicalMapping
        let forms = original.utf8.elementsEqual(nfd.utf8) ? [original] : [original, nfd]
        for request in forms {
            try check(ScopeResolution.resolve(request).scope == .readOnly,
                      "blanket write ban is an actual read-only boundary")
            for owner: C.Scope? in [nil, .readOnly, .workspaceWrite] {
                var value = input(request, chat: false)
                value.ownerScope = owner
                let output = try B.build(value)
                try check(!output.candidates.isEmpty && output.candidates.allSatisfy {
                    $0["scope"] as? String == "read_only"
                }, "ownerScope hint never overrides a blanket file-write ban")
                if owner == nil {
                    try check(output.admission == nil, "unknown owner scope invents no admission facts")
                } else {
                    try check(output.admission?.requestClass == .readonlyLookup,
                              "a blanket file-write ban cannot become writer request class")
                }
            }
        }
    }
    var explicitHostReadOnly = input(writeRequest, chat: false, readOnly: true)
    explicitHostReadOnly.ownerScope = .workspaceWrite
    let explicitHostRows = try B.build(explicitHostReadOnly)
    try check(explicitHostRows.candidates.allSatisfy { $0["scope"] as? String == "read_only" } &&
              explicitHostRows.admission?.requestClass == .readonlyLookup,
              "the explicit host read-only boundary beats a write-oriented owner hint")

    // Natural writer failure / CODE-OUTPUT control. These are test data,
    // never runtime marker rules or permission from a registered contract.
    let inputValueWriter = #"""
    OS1_LIVE_AUTO_20261023_B 구현 진단. 작업 폴더는 /tmp/fixture-workspace입니다. 그 폴더의 labels.py 파일 하나만 수정하세요. normalize_labels(values)는 문자열 리스트를 받아 앞뒤 공백을 strip하고 casefold로 정규화하며, 빈 값은 버리고 중복은 첫 등장 순서만 남겨야 합니다. 입력 리스트는 변경하지 마세요. import나 외부 패키지는 필요 없습니다. 다른 파일·네트워크·배포는 건드리지 마세요. 수정 후 아래 경우를 Python으로 확인하고 변경 파일과 테스트 결과만 보고하세요: 빈 리스트, 공백 값, 대소문자 중복, Straße/STRASSE 중복.
    """#
    let actualCodeOutputControl = #"""
    OS1_LIVE_AUTO_20261023_A3 진단. 아래 A와 B는 서로 독립된 작업이므로 각각 별도 하위 작업으로 나눠 병렬로 처리하세요. 도구·파일·웹을 사용하지 말고, 각 결과를 A/B로 구분해 원문 그대로 전달하세요.

    A — 제공된 기록만 사용하세요. [S1] 2026-10-23T08:00:00Z: Cobalt preview는 보안 검사 통과 후에만 허용되며 production은 허가되지 않았다. [S2] 08:10:00Z: 보안 검사는 미통과이고 배포 작업은 시작되지 않았다. [S3] 08:40:00Z: 지연된 알림이 preview eligible이라고 표시했으나 내부 자격 상태가 처음 바뀐 시각은 기록에 없다. 제공된 기록을 08:45:00Z에 평가하세요. preview_completed는 이 자료가 preview 완료를 입증하는지, production_authorized는 이 자료에 production 허가가 있는지를 뜻합니다. preview_completed, production_authorized, internal_eligibility_change_time, notice_time 네 필드를 가진 JSON 객체 하나만 답하세요. 미확인 시각은 null이며 알림 시각을 내부 상태 생성 시각으로 바꾸지 마세요.

    B — 다음 Python 함수를 순수 함수로 고친 코드만 답하세요. 입력은 문자열 리스트입니다. 앞뒤 공백을 제거하고 casefold()로 정규화하고, 정규화 후 빈 값은 제외하고, 중복은 첫 등장 순서만 남기세요. 입력 리스트를 수정하지 마세요. import·파일·도구 사용 없이 normalize_labels 함수 하나만 python 코드 블록으로 주세요.
    def normalize_labels(values):
        return [value.strip().lower() for value in values]
    """#
    for request in [inputValueWriter, "Modify labels.py. Do not change the input list."] {
        var value = input(request, chat: false)
        value.ownerScope = .workspaceWrite
        value.taskContract = nil
        let result = try B.build(value)
        try check(result.admission?.requestClass == .writer &&
            result.candidates.contains { $0["scope"] as? String == "workspace_write" },
            "ordinary file writer plus input-value immutability gets writer rows without contract")
        value.requireReadOnly = true
        let restricted = try B.build(value)
        try check(restricted.admission?.requestClass == .readonlyLookup &&
            restricted.candidates.allSatisfy { $0["scope"] as? String == "read_only" },
            "hard host read-only still wins over an input-value writer")
    }
    var codeOnly = input(actualCodeOutputControl, chat: false)
    codeOnly.ownerScope = .workspaceWrite
    let codeOnlyCatalog = try B.build(codeOnly)
    try check(ScopeResolution.resolve(actualCodeOutputControl).scope == .readOnly &&
        codeOnlyCatalog.admission?.requestClass == .readonlyLookup &&
        codeOnlyCatalog.candidates.allSatisfy { $0["scope"] as? String == "read_only" },
        "actual A3 CODE-OUTPUT task stays read-only; data-code repair is not file-edit authority")

    // Closed Korean exact-file fences work on a cold start, WITHOUT a
    // registered quality contract or an ownerScope override. Catalog rows
    // and admission class must consume the same shared scope resolution.
    let koreanColdWrite = "result.py만 고쳐, settings.yaml은 수정하지 마."
    for request in [koreanColdWrite, koreanColdWrite.decomposedStringWithCanonicalMapping,
                    "Modify result.py. settings.yaml은 수정하지 마.",
                    "result.py만 고쳐. Do not modify settings.yaml."] {
        var value = input(request, chat: false)
        value.ownerScope = .workspaceWrite
        value.taskContract = nil
        let output = try B.build(value)
        try check(output.candidates.contains { $0["scope"] as? String == "workspace_write" } &&
                  output.admission?.requestClass == .writer && output.admission?.taskContract == nil,
                  "cold Korean bounded write has writer rows AND writer class, without a registered contract")
        value.requireReadOnly = true
        let restricted = try B.build(value)
        try check(restricted.candidates.allSatisfy { $0["scope"] as? String == "read_only" } &&
                  restricted.admission?.requestClass == .readonlyLookup,
                  "hard host read-only still beats a parsed Korean write")
    }
    for request in ["result.py만 고쳐. result.py는 수정하지 마.",
                    "result.py만 고쳐. 어떤 파일도 수정하지 마.",
                    "어떤 파일도 수정하지 마. result.py만 고쳐.",
                    "승인받은 뒤에만 진행해. result.py만 고쳐. settings.yaml은 수정하지 마.",
                    "result.py만 고쳐. settings.yaml은 수정하지 마. Unless approved, do not proceed.",
                    "result.py만 고쳐. 테스트·README는 바꾸지 마."] {
        var value = input(request, chat: false)
        value.ownerScope = .workspaceWrite
        value.taskContract = nil
        let output = try B.build(value)
        try check(output.candidates.allSatisfy { $0["scope"] as? String == "read_only" } &&
                  output.admission?.requestClass == .readonlyLookup,
                  "contradiction/global ban/unresolved artifact labels never acquire cold writer rows from an owner hint")
    }

    // A host-rechecked registered contract is distinct from the ownerScope
    // hint above. It can settle bounded-preservation ambiguity for exactly
    // its current objective, without upgrading partial quality coverage.
    let publicBoundedRepair = "이 작은 저장소의 usage_ledger.py 버그를 고쳐줘. README의 계약을 그대로 지키고 공개 테스트를 실행해. 고쳐도 되는 파일은 usage_ledger.py 하나뿐이야. 테스트·README는 바꾸지 마. 외부 패키지 설치, 네트워크, 다른 폴더 접근은 하지 마. 마지막 답변은 한국어로 바뀐 점과 실제 테스트 결과만 짧게 보고해.\n"
    func boundContract(_ request: String, scope: C.Scope = .workspaceWrite) -> C.TaskContractFact {
        .init(coverage: .partial, scope: scope, objectiveSHA256: C.digest(Data(request.utf8)),
              contractSHA256: String(repeating: "1", count: 64), contextSHA256: String(repeating: "2", count: 64),
              sourceSHA256: nil, startTreeSHA256: String(repeating: "3", count: 64),
              referencePolicySHA256: String(repeating: "4", count: 64),
              validUntilMS: Int64(now.addingTimeInterval(600).timeIntervalSince1970 * 1000), bindingsChecked: true)
    }
    for request in [publicBoundedRepair, publicBoundedRepair.decomposedStringWithCanonicalMapping,
                    "Fix output.py only. Do not modify validation files or README.md."] {
        var value = input(request, chat: false)
        value.ownerScope = .workspaceWrite
        let fact = boundContract(request)
        value.taskContract = fact
        let output = try B.build(value)
        try check(output.candidates.contains { $0["scope"] as? String == "workspace_write" } &&
                  output.admission?.requestClass == .writer,
                  "exact rechecked current contract preserves the requested writer scope")
        try check(output.admission?.taskContract == fact && output.admission?.taskContract?.coverage == .partial &&
                  output.admission?.classCertificate == nil && output.admission?.classProviderPin == nil,
                  "a partial execution contract never becomes full quality or a class certificate")
    }
    var boundWriter = input(publicBoundedRepair, chat: false)
    boundWriter.ownerScope = .workspaceWrite
    boundWriter.taskContract = boundContract(publicBoundedRepair)
    var noContract = boundWriter; noContract.taskContract = nil
    let unboundRows = try B.build(noContract)
    let unboundScopes = Set(unboundRows.candidates.compactMap { $0["scope"] as? String })
    for invalid in ["expired", "wrong_objective", "bindings_unchecked", "owner_unknown",
                    "bad_contract_hash", "bad_context_hash", "bad_tree_hash", "bad_policy_hash", "bad_source_hash"] {
        var value = boundWriter
        switch invalid {
        case "expired": value.taskContract?.validUntilMS = Int64(now.timeIntervalSince1970 * 1000)
        case "wrong_objective": value.taskContract?.objectiveSHA256 = String(repeating: "5", count: 64)
        case "bindings_unchecked": value.taskContract?.bindingsChecked = false
        case "bad_contract_hash": value.taskContract?.contractSHA256 = "invalid"
        case "bad_context_hash": value.taskContract?.contextSHA256 = "invalid"
        case "bad_tree_hash": value.taskContract?.startTreeSHA256 = "invalid"
        case "bad_policy_hash": value.taskContract?.referencePolicySHA256 = "invalid"
        case "bad_source_hash": value.taskContract?.sourceSHA256 = "invalid"
        default: value.ownerScope = nil
        }
        let output = try B.build(value)
        try check(Set(output.candidates.compactMap { $0["scope"] as? String }) == unboundScopes,
                  "invalid or unknown owner contract cannot override the original scope: " + invalid)
        if invalid == "owner_unknown" {
            try check(output.admission == nil, "a contract cannot invent missing owner-scope facts")
        } else {
            try check(output.admission?.requestClass == unboundRows.admission?.requestClass,
                      "invalid contract does not rewrite the original request class")
        }
    }
    for boundary in ["owner_read_only", "chat", "explicit", "host_read_only"] {
        var value = boundWriter
        switch boundary {
        case "owner_read_only": value.ownerScope = .readOnly
        case "chat": value.chatLaneEligible = true
        case "explicit": value.explicitRouteSurfaces = ["codex"]
        default: value.requireReadOnly = true
        }
        let output = try B.build(value)
        try check(!output.candidates.isEmpty && output.candidates.allSatisfy { $0["scope"] as? String == "read_only" },
                  "conflicting owner/chat/explicit/hard-read-only facts prevent writer override: " + boundary)
        try check(output.admission?.requestClass != .writer, "boundary does not become a writer request class")
    }
    var narrowed = input(writeRequest, chat: false)
    narrowed.ownerScope = .workspaceWrite
    narrowed.taskContract = boundContract(writeRequest, scope: .readOnly)
    let narrowedRows = try B.build(narrowed)
    try check(!narrowedRows.candidates.isEmpty && narrowedRows.candidates.allSatisfy { $0["scope"] as? String == "read_only" } &&
              narrowedRows.admission?.requestClass == .readonlyLookup,
              "a bound read-only contract narrows an otherwise executable writer request")

    // Source-derived regression: the initial frozen quality smoke requested
    // an implementation, but named-file preservation and a future evaluator's
    // sandbox were incorrectly promoted into a global worker no-write rule.
    // This is development regression input, not held-out quality evidence.
    let scopedImplementation = """
    Implement exactly one file window_merge.py in the current workspace. Do not modify AGENTS.md or create other deliverables. Define exactly one top-level function merge_intervals(intervals), with no decorators, annotations, default arguments, imports, top-level executable statements, nested functions, classes, external dependencies, file/network/process operations, or I/O. A module/function docstring is allowed.

    Requirements:
    1. The outer argument must be a list or tuple. Each member must be a list or tuple of exactly two endpoints. Every endpoint must have exact type int; bool is invalid. Any invalid structure/type, or an interval with start > end, must raise ValueError. Validate every interval, including members after an empty interval. Empty outer input returns [].
    2. Intervals represent half-open [start,end) integer ranges. Zero-length intervals are valid but omitted from output.
    3. Return a list of two-integer tuples sorted by start, merging overlapping OR touching intervals. Example: [(5,7),(1,3),(3,5),(9,9)] -> [(1,7)]. Negative and arbitrarily large Python integers are valid. No floating conversion is allowed.
    4. Never modify the outer input or any nested input member. Repeated calls must not retain state.
    5. The output must be idempotent: merge_intervals(merge_intervals(x)) equals merge_intervals(x) for valid x.
    6. Use only pure Python syntax and these builtins: isinstance, type, int, bool, list, tuple, len, sorted, range, enumerate, zip, all, any, min, max, ValueError. List .append() and .sort() are the only permitted attribute calls. Do not access attributes/names beginning with an underscore. Loops, comprehensions, conditionals, assignment, tuple unpacking, slicing, arithmetic, comparisons, and a lambda used as a sorting key are allowed.

    The independent evaluator will parse the source and run the function in a read-only-filesystem, network-denied process sandbox. Its tests are not present in this workspace. Fulfill the requirements, not a guessed test. Reply briefly after writing the file. Do not run another agent or a model, change settings, or do unrelated work.
    """
    let scopedWrites = [
        "Repair report.csv, preserving its format. Do not modify paid.csv, create extra files, access the network or inspect anything outside this workspace.",
        "Fix handbook.md, correcting indentation. Do not modify archive.md, create other files or use the network.",
        scopedImplementation,
        "Implement exactly one file result.py. Do not modify instructions.md or create other deliverables.",
        "Create output.txt. Do not modify config.json.",
        "Write report.md. Never edit settings.yaml and credentials.txt.",
        "Create /tmp/output.txt. Do not modify /tmp/settings.yaml.",
        "Create .env. Do not modify config.yaml.",
        "Create \"output.txt\". Do not modify \"settings.yaml\".",
        "Implement exactly one file `result.py`. Do not modify `config.yaml`. The evaluator will run the function in a read-only sandbox.",
        "Create result.py. The independent evaluator will run the function in a read-only filesystem sandbox.",
        "Create report.json. The external checker will parse the output in a read-only process sandbox.",
        "Create result.py. The test runner will execute the function within a read only sandbox.",
        "Create result.py. Never modify the outer input or nested input members.",
    ]
    for request in scopedWrites {
        try check(ScopeResolution.resolve(request).scope == .workspaceWrite,
                  "named target/other actor restrictions must not revoke implementation: \(request.prefix(180))")
        let output = try B.build(input(request))
        try check(output.candidates.contains { $0["scope"] as? String == "workspace_write" },
                  "implementation must retain writable catalog rows")
        let forced = try B.build(input(request, readOnly: true))
        try check(!forced.candidates.isEmpty && forced.candidates.allSatisfy { $0["scope"] as? String == "read_only" },
                  "hard host read-only still wins")
    }
    // Actual395 prospective smoke scope failure, now a development regression.
    // The original request and failed arm remain frozen; this is not a rerun.
    let boundedSuppliedImplementation = """
    Fix the supplied stock_reconcile.py in this isolated workspace. Modify exactly that file; do not modify AGENTS.md or CLAUDE.md, and do not create other deliverables. Keep exactly one top-level function reconcile_stock(stock, changes), with those two positional parameters and no decorators, annotations or default arguments. A module/function docstring is allowed.

    Contract:
    - stock must have exact type dict. Each key must have exact type str and be nonempty; preserve keys literally (case and whitespace), without stripping or normalization. Each initial count must have exact type int and be >=0; bool and subclasses of int are invalid.
    - changes must have exact type list or tuple. Each member must have exact type list or tuple and exactly two elements: a valid key under the same rule, and a delta of exact type int (bool/subclasses invalid). A new key is allowed. Any invalid input raises ValueError.
    - Aggregate ALL deltas for each key as a transaction. Only FINAL counts must be nonnegative: an intermediate deficit that is later offset is valid. A negative final count raises ValueError. Do not reject a valid transaction merely because its input order has a temporary negative count.
    - Return a NEW ordinary dict containing every original key and every key mentioned by a change, including zero-valued keys and keys with net-zero changes. Preserve arbitrary-size integer arithmetic. No floats/coercion.
    - Never mutate stock, changes, or any nested change member, on success OR failure. Repeated calls share no state.
    - Pure Python only; no imports, nested functions, classes, I/O, network, process operations or external dependencies. Allowed builtins: isinstance,type,int,bool,str,list,tuple,dict,set,len,sorted,range,enumerate,zip,all,any,min,max,sum,ValueError. Permitted attributes/methods: append,add,get,copy,sort,items,keys,values,discard,remove. No underscore-prefixed names or attributes.

    Examples: reconcile_stock({'bolt':1}, [('bolt',-3),('bolt',3)]) returns {'bolt':1}; reconcile_stock({}, [('nut',0)]) returns {'nut':0}.

    Do not inspect parent/sibling evaluation files or invoke another model/agent. Private evaluator tests are not supplied. Briefly report the artifact change; do not claim private evaluator tests ran or passed.
    """
    let suppliedWrites = [
        boundedSuppliedImplementation,
        "Fix the supplied settings.yaml in this isolated workspace. Modify exactly that file; do not modify secrets.env or accounts.json, and do not create other deliverables.",
        "Update the supplied result.py in this isolated workspace. Do not modify AGENTS.md.",
        "Fix the supplied result.py in this isolated workspace. Modify exactly that file. Do not modify settings.yaml.",
    ]
    for request in suppliedWrites {
        let resolved = ScopeResolution.resolve(request)
        try check(resolved.scope == .workspaceWrite, "closed one-target supplied-file edit preserves writer scope: \(request.prefix(180))")
        try check(resolved.prohibitions.contains { $0.contains("do not modify") },
                  "named file prohibition is retained: \(request.prefix(200)); actual=\(resolved.prohibitions)")
        let output = try B.build(input(request))
        try check(output.candidates.contains { $0["scope"] as? String == "workspace_write" }, "native catalog must expose eligible writers for actual bounded edit")
        let forced = try B.build(input(request, readOnly: true))
        try check(!forced.candidates.isEmpty && forced.candidates.allSatisfy { $0["scope"] as? String == "read_only" }, "hard host read-only always wins over named-file edit")
    }
    for request in [
        "Fix the supplied result.py in this isolated workspace. Modify exactly that file; do not modify result.py.",
        "Fix the supplied result.py in this isolated workspace. Modify exactly that file; do not modify files.",
        "Fix the supplied result.py in this isolated workspace. Modify exactly that file; do not modify AGENTS.md. Read-only.",
        "Fix the supplied result.py in this isolated workspace. Modify exactly that file and settings.yaml; do not modify settings.yaml.",
        "Fix the supplied result.py and settings.yaml in this isolated workspace. Modify exactly that file; do not modify AGENTS.md.",
        "Fix the supplied result.py in this isolated workspace. Modify exactly that file if allowed; do not modify AGENTS.md.",
        "If approved, fix the supplied result.py in this isolated workspace. Modify exactly that file; do not modify AGENTS.md.",
        "Modify exactly that file; do not modify AGENTS.md.",
        "Explain this quoted instruction: \"Fix the supplied result.py in this isolated workspace. Modify exactly that file; do not modify AGENTS.md.\"",
        "Fix the supplied result.py in this isolated workspace. Do not modify '/known/workspace/result.py'.",
        "Fix the supplied out/result.py in this isolated workspace. Do not modify 'out/*.py'.",
        "Fix the supplied result.py in this isolated workspace. Modify exactly that file; do not modify AGENTS.md unless necessary.",
        "Fix the supplied ../result.py in this isolated workspace. Do not modify AGENTS.md.",
        "Fix the supplied /tmp/result.py in this isolated workspace. Do not modify AGENTS.md.",
    ] {
        try check(ScopeResolution.resolve(request).scope == .readOnly, "ambiguous/global/conflicting supplied-file restrictions stay read-only: \(request)")
        try check((try B.build(input(request))).candidates.allSatisfy { $0["scope"] as? String == "read_only" }, "denial does not create writer catalog rows")
    }
    // Separate preexisting quoted-span defect, observed while checking the
    // bounded supplied-file repair (the failed diagnostic/log is preserved).
    // Pair delimiters first: a filename's closing delimiter cannot swallow
    // the later prohibition. This does NOT extend the new supplied grammar
    // to infer write authority through quoted operands.
    let observedQuotedFence = "Edit the supplied `config.yaml` in this isolated workspace. Modify exactly that file; do not modify `secrets.env`."
    try check(OwnerIntentText.authorityText(observedQuotedFence) == observedQuotedFence,
              "original failed quoted filename control preserves every intervening clause verbatim")
    try check(ScopeResolution.resolve(observedQuotedFence).prohibitions.contains { $0.contains("secrets.env") },
              "the observed named prohibition cannot disappear")
    for request in [
        "Create `output.txt`. Do not modify `settings.yaml`.",
        "Modify `config.yaml`. Never edit `secrets.env`.",
        "Create \"output.txt\". Do not modify \"settings.yaml\".",
        "Modify “config.yaml”. Never edit “secrets.env”.",
    ] {
        try check(OwnerIntentText.authorityText(request) == request, "quoted filenames and fences remain verbatim")
        let resolved = ScopeResolution.resolve(request)
        try check(resolved.scope == .workspaceWrite && !resolved.prohibitions.isEmpty,
                  "independently supported quoted exact targets retain their actual preservation fence")
    }
    for request in [
        "Explain this instruction: `Create unsafe.py. Do not modify settings.yaml`.",
        "Explain this instruction: \"Create unsafe.py. Do not modify settings.yaml\".",
        "Explain this instruction: “Create unsafe.py. Do not modify settings.yaml”.",
        "If needed later, consider `Modify unsafe.py`; explain only now.",
        "Explain `Create unsafe.py", "Explain \"Create unsafe.py", "Explain “Create unsafe.py",
        "Explain Create unsafe.py”.",
        "Create output.txt. Do not modify `settings.yaml", "Create output.txt. Do not modify \"settings.yaml",
        #"Create output.txt. Do not modify \"settings.yaml\"."#,
        #"Explain \`Create unsafe.py\`."#,
        "Explain ``Create unsafe.py``.",
    ] {
        try check(ScopeResolution.resolve(request).scope == .readOnly,
                  "quoted commands and ambiguous/unmatched delimiters cannot acquire authority: \(request)")
    }
    for request in ["Create output.txt. Do not modify `settings.yaml", "Create output.txt. Do not modify \"settings.yaml"] {
        try check(OwnerIntentText.authorityText(request).contains("Do not modify"), "an unmatched span never silently drops a prohibition")
    }
    let globalReadOnly = [
        "Create result.py. Do not modify files.",
        "Create result.py. Never modify files.",
        "Create result.py. Never edit any files.",
        "Create result.py. No file writes.",
        "Create result.py. The worker must not modify files.",
        "Create result.py. Read-only.",
        "Create result.py. The evaluator will run the function in a read-only sandbox. Do not modify files.",
        "Create result.py. Do not modify settings.yaml. Read only; no changes.",
        "Create result.py. Do not modify result.py.",
        "Create result.py. Do not modify ./result.py.",
        "Create src/../result.py. Do not modify result.py.",
        "Create /tmp/result.py. Do not modify /tmp/./result.py.",
        "Create `result.py`. Do not modify 'result.py'.",
        "Create out/result.py. Do not modify 'out/*.py'.",
        "Create out/result.py. Do not modify 'out/?.py'.",
        "Create out/result.py. Do not modify 'out/[a-z].py'.",
        "Create out/result.py. Do not modify 'out/{result,other}.py'.",
        "Create out/result.py. Never edit 'out/*.py'.",
        "Create out/result.py. Don't edit out/*.py.",
        "Create result.py. Do not modify /known/workspace/result.py.",
        "Create /known/workspace/result.py. Do not modify result.py.",
        "Create result.py. Do not modify /known/workspace.",
        "Create src/result.py. Do not modify /known/workspace/src.",
        "Rename other.txt to result.py. Do not modify result.py.",
        "Move other.txt to result.py. Do not modify result.py.",
        "Create result.py and edit config.yaml. Do not modify config.yaml.",
        "Implement exactly one file result.py, then update config.yaml. Do not modify config.yaml.",
        "Create result.py. Also edit config.yaml. Do not modify config.yaml.",
        "Create /tmp/result.py. Do not modify /tmp/result.py.",
        "Modify Sources/App.swift. Never edit Sources/App.swift.",
        "Create result.py. The evaluator will run the function in a read-only sandbox, but you must make no changes.",
        "Explain the evaluator's read-only sandbox.",
        "Review this source only.\n```\nCreate unsafe.py. The evaluator will run read-only.\n```",
        "Explain the quoted instruction: \"Implement unsafe.py\".",
        "Explain the quoted instruction: 'Create unsafe.py'.",
        "Explain the source fragment: `Create unsafe.py`.",
        "Explain this quoted source:\n'\nCreate unsafe.py.\nThe evaluator will run in a read-only sandbox.\n'",
        "Explain this quoted source:\n\"\nCreate unsafe.py.\nThe evaluator will run in a read-only sandbox.\n\"",
        "Explain this quoted source:\n“\nCreate unsafe.py.\nThe evaluator will run in a read-only sandbox.\n”",
        "Create result.py. Don't modify files; it isn't necessary.",
        "Create result.py. The independent evaluator will run the function in a read-only sandbox. The worker must remain read-only.",
        "Create result.py. The evaluator will run in a read-only sandbox and no changes are allowed.",
        "Create result.py. The evaluator will run in a read-only sandbox and all file writes are prohibited.",
        "Create result.py. The evaluator will run in a read-only sandbox. The worker may not modify files.",
        "Create result.py. The evaluator will run in a read-only sandbox. You cannot edit files.",
        "Create result.py. The evaluator will run in a read-only sandbox. The worker is forbidden to modify files.",
        "The evaluator will run in a read-only sandbox.\n```\nImplement unsafe.py\n```",
    ]
    for request in globalReadOnly {
        try check(ScopeResolution.resolve(request).scope == .readOnly,
                  "real no-write, same-target contradiction and quoted source stay read-only: \(request)")
        try check((try B.build(input(request))).candidates.allSatisfy { $0["scope"] as? String == "read_only" },
                  "no write rows for real read-only request")
    }
    let preserved = ScopeResolution.resolve(scopedImplementation)
    try check(preserved.prohibitions.contains { $0.contains("agents.md") }, "named prohibition is preserved")
    try check(preserved.prohibitions.contains { $0.contains("independent evaluator") }, "actor-bound restriction is preserved")

    // ---- Ordering and id/byte stability against the former builder ------
    let base = try B.build(input())
    try check(base.candidates.contains { $0["model"] as? String == "gpt-6-sol" && $0["effort"] as? String == "ultra" },
              "ordinary Auto retains signed native-supported ultra for its reference without forcing cheap tiers")
    try check(tuples(base) == [
        // Anthropic first: 0.8 remaining with 4h to reset outscores Codex's 0.6 over 48h.
        // All signed native-supported efforts, including ultra, are retained. Within a pool
        // the strongest provider-stated tier leads (build 378): frontier fable,
        // then workhorse opus, then efficient sonnet, whatever the native order.
        "claude-chat/fable/low/read_only", "claude-chat/fable/xhigh/read_only", "claude-chat/fable/max/read_only",
        "claude/fable/low/read_only", "claude/fable/low/workspace_write",
        "claude/fable/xhigh/read_only", "claude/fable/xhigh/workspace_write",
        "claude/fable/max/read_only", "claude/fable/max/workspace_write",
        "claude-chat/claude-opus-5-5/xhigh/read_only", "claude-chat/claude-opus-5-5/max/read_only",
        "claude/claude-opus-5-5/xhigh/read_only", "claude/claude-opus-5-5/xhigh/workspace_write",
        "claude/claude-opus-5-5/max/read_only", "claude/claude-opus-5-5/max/workspace_write",
        "claude-chat/sonnet/medium/read_only", "claude/sonnet/medium/read_only", "claude/sonnet/medium/workspace_write",
        // Codex models here have no tier (older generations): native priority
        // (gpt-6-sol before gpt-5.6-luna), not action name, orders them.
        "codex/gpt-6-sol/low/read_only", "codex/gpt-6-sol/low/workspace_write",
        "codex/gpt-6-sol/medium/read_only", "codex/gpt-6-sol/medium/workspace_write",
        "codex/gpt-6-sol/ultra/read_only", "codex/gpt-6-sol/ultra/workspace_write",
        "codex/gpt-5.6-luna/low/read_only", "codex/gpt-5.6-luna/low/workspace_write",
        "codex/gpt-5.6-luna/max/read_only", "codex/gpt-5.6-luna/max/workspace_write",
    ], "pool, native model preference, surface, effort, scope order: \(tuples(base))")
    try check(base.pools.map(\.pool) == ["anthropic_shared", "openai_codex"] &&
              base.pools[0].score.map { abs($0 - 0.2) < 1e-9 } == true &&
              base.pools[1].score.map { abs($0 - 0.0125) < 1e-9 } == true, "pool score = share x remaining / hours")
    try check(reasons(base) == ["claude:model_unavailable:1", "codex:reference_unavailable:1"],
              "per-provider exclusions; ultra is admitted; a pool with no frontier model says so: \(reasons(base))")
    let legacy = legacyRows(input(), chatRefused: false)
    let legacyComparable = try Set(legacy.filter { $0["surface"] as? String != "gpt-chat" }.map(rowBytes))
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
    // Build 378: the provider-stated tier of every tiered model offered; a
    // model with no tier (gpt-6-sol, gpt-5.6-luna here) is left out.
    try check(decoded.modelTiers == ["fable": "frontier", "claude-opus-5-5": "workhorse", "sonnet": "efficient"] &&
              base.modelTiers == decoded.modelTiers, "model_tiers names the tier of each tiered model offered")
    try check(decoded.routingIntent == nil && !String(decoding: data, as: UTF8.self).contains("routing_intent"),
              "a catalog without an explicit owner constraint carries no routing_intent")

    // ---- Provider-stated model tiers (build 378) ----------------------------
    let observedTiers: [(String, ModelTier)] = [("gpt-6-astra", .frontier), ("gpt-6.1-sol", .workhorse),
        ("gpt-6-luna", .fast), ("claude-fable-5-1", .frontier), ("fable", .frontier), ("opus", .workhorse),
        ("claude-opus-5-5", .workhorse), ("sonnet", .efficient), ("claude-sonnet-5-5", .efficient), ("haiku", .fast),
        ("claude-haiku-4-5-20251001", .fast)]
    try check(observedTiers.allSatisfy { ModelTiers.tier(of: $0.0) == $0.1 } && ModelTiers.table.count == observedTiers.count,
              "every observed alias and resolved ID has its provider-stated tier, and nothing else is listed")
    try check(["gpt-6-sol", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.5", "gpt-5.4-mini", "gpt-5.3-codex-spark",
               "gpt-daybreak-blue-latest", "gpt-6-astra-mini", "claude-opus-5", "fable-6", "", "[1m]"]
                .allSatisfy { ModelTiers.tier(of: $0) == nil } &&
              ModelTiers.tier(of: "claude-fable-5-1[1m]") == .frontier && ModelTiers.rank("fable") == 0 &&
              ModelTiers.rank("gpt-6.1-sol") == 1 && ModelTiers.rank("sonnet") == 2 && ModelTiers.rank("gpt-6-luna") == 3 &&
              ModelTiers.rank("gpt-6-sol") == 4,
              "older, specialized and unknown models have no tier; a native context suffix keeps its model's tier")
    var withoutTiers = decoded; withoutTiers.modelTiers = nil
    try check(!String(decoding: try C.encode(withoutTiers), as: UTF8.self).contains("model_tiers") &&
              (try C.decodeCatalog(C.encode(withoutTiers))) == withoutTiers && (try C.decodeCatalog(C.encode(decoded))) == decoded,
              "model_tiers is optional: an older catalog decodes unchanged and a tiered one roundtrips")
    for bad in [["fable": "flagship"], ["gpt-9": "fast"], ["": "fast"], ["fable": "Frontier"]] {
        var invalid = decoded; invalid.modelTiers = bad
        do { _ = try C.decodeCatalog(C.encode(invalid)); try check(false, "invalid model_tiers accepted: \(bad)") }
        catch { checks += 1 }
    }
    var numericTier = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    numericTier["model_tiers"] = ["fable": 1]
    do { _ = try C.decodeCatalog(JSONSerialization.data(withJSONObject: numericTier)); try check(false, "numeric tier accepted") }
    catch { checks += 1 }

    // ---- Quota freshness never produces a contract-invalid catalog --------
    // Build 376 regression: the host captured `now` before probing, so a quota
    // observed during the call looked like it came from the future; every Codex
    // row then carried an observed time without a validity window and the whole
    // catalog failed decode (invalidObservation). Unknown quota is all-null.
    for (label, observedAt) in [("observed after now", now.addingTimeInterval(3)),
                                ("older than the freshness window", now.addingTimeInterval(-3_600))] {
        var unfresh = input()
        unfresh.codexQuota = .init(accountID: "acct-codex", observedAt: observedAt, source: .codexNative,
            windows: [.init(bucket: "primary", usedPercent: 10, resetsAt: now.addingTimeInterval(48 * 3600))])
        let out = try B.build(unfresh)
        let bytes = try B.catalogData(out, taskID: "task-fixture", requestSHA256: C.digest(Data(writeRequest.utf8)))
        let codexRows = try C.decodeCatalog(bytes).candidates.filter { $0.exactConfig.quotaPool == .openAICodex }
        try check(!codexRows.isEmpty && codexRows.allSatisfy {
            $0.quotaRemainingFraction == nil && $0.quotaObservedAtMS == nil && $0.quotaValidUntilMS == nil
        }, "quota \(label): Codex rows decode with all-null (unknown) quota")
    }
    var foreign = input()
    foreign.codexQuota = quota("another-account", used: 10, resetIn: 48)
    try check(try C.decodeCatalog(B.catalogData(B.build(foreign), taskID: "task-fixture",
        requestSHA256: C.digest(Data(writeRequest.utf8)))).candidates
        .filter { $0.exactConfig.quotaPool == .openAICodex }.allSatisfy { $0.quotaObservedAtMS == nil },
        "another account's quota is not evidence for this account")

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
    try check(tuples(try B.build(aliases)) == ["claude/fable/low/read_only", "claude/fable/xhigh/read_only",
        "claude/claude-sonnet-5-5/low/read_only", "claude/claude-sonnet-5-5/xhigh/read_only", "claude/sonnet/medium/read_only"],
              "frontier first; names of one native row share its rank: \(tuples(try B.build(aliases)))")
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
    // A model-scoped window: the pool is scored by its first model in
    // catalog order, its frontier reference (fable), not by the model with
    // the most quota left (sonnet, first in Claude's own inventory).
    var scopedWindow = input()
    scopedWindow.codexQuota = quota("acct-codex", used: 40, resetIn: 100)
    scopedWindow.claudeQuota = .init(accountID: "acct-claude", observedAt: now.addingTimeInterval(-5), source: .claudeNative,
        windows: [.init(bucket: "weekly", usedPercent: 15, resetsAt: now.addingTimeInterval(100 * 3600)),
                  .init(bucket: "weekly_model", usedPercent: 97, resetsAt: now.addingTimeInterval(100 * 3600), model: "fable")])
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
              reasons(exhaustedOut).contains("codex:quota_zero:5"), "a zero-remaining pool is excluded and counted")

    // ---- Tier reference per pool (build 378) ------------------------------
    // A pool's REFERENCE is its frontier-tier model at the highest known
    // native-supported effort, never the first model of the native list (Codex lists the
    // gpt-6.1-sol workhorse first, Claude its opus default). Lower tiers stay
    // for trivial and standard work; a pool whose frontier model cannot run
    // now keeps them, records reference_unavailable and serves no deep work.
    // Each case runs the real JS resolver on the builder's exact catalog
    // bytes: "pool/model/effort/route_kind[>escalation reference model]".
    func referenceInput(_ request: String = "Explain the login function", preference: String = "auto") -> B.Input {
        var value = input(request, preference: preference, chat: false, readOnly: true)
        value.profiles = [
            .init(action: "r_fable_low", provider: "claude", model: "claude-fable-5-1", effort: "low"),
            .init(action: "r_fable_xhigh", provider: "claude", model: "claude-fable-5-1", effort: "xhigh"),
            .init(action: "r_fable_max", provider: "claude", model: "claude-fable-5-1", effort: "max"),
            .init(action: "s_opus_low", provider: "claude", model: "claude-opus-5-5", effort: "low"),
            .init(action: "s_opus_max", provider: "claude", model: "claude-opus-5-5", effort: "max"),
            .init(action: "t_sonnet_low", provider: "claude", model: "claude-sonnet-5-5", effort: "low"),
            .init(action: "t_sonnet_alias_medium", provider: "claude", model: "sonnet", effort: "medium"),
            .init(action: "x_astra_medium", provider: "codex", model: "gpt-6-astra", effort: "medium"),
            .init(action: "x_astra_max", provider: "codex", model: "gpt-6-astra", effort: "max"),
            .init(action: "y_sol_medium", provider: "codex", model: "gpt-6.1-sol", effort: "medium"),
            .init(action: "y_sol_max", provider: "codex", model: "gpt-6.1-sol", effort: "max"),
            .init(action: "z_luna_low", provider: "codex", model: "gpt-6-luna", effort: "low"),
            .init(action: "z_previous_sol_max", provider: "codex", model: "gpt-6-sol", effort: "max")]
        // Native order lists the defaults first: opus, then sonnet, then fable.
        value.claudeModels = [.init(model: "claude-opus-5-5", supportedEfforts: ["low", "xhigh", "max"], nativeRank: 0),
            .init(model: "claude-sonnet-5-5", supportedEfforts: ["low", "xhigh", "max"], nativeRank: 1),
            .init(model: "sonnet", supportedEfforts: ["medium"], nativeRank: 1),
            .init(model: "claude-fable-5-1", supportedEfforts: ["low", "xhigh", "max"], nativeRank: 2)]
        value.codexModels = [.init(slug: "gpt-6.1-sol", supportedEfforts: ["low", "medium", "max"], priority: 0),
            .init(slug: "gpt-6-astra", supportedEfforts: ["medium", "max"], priority: 1),
            .init(slug: "gpt-6-luna", supportedEfforts: ["low", "max"], priority: 2),
            .init(slug: "gpt-6-sol", supportedEfforts: ["max"], priority: 3)]
        value.claudeQuota = claudeWindows(fableUsed: nil)
        value.codexQuota = quota("acct-codex", used: 40, resetIn: 48)
        return value
    }
    func claudeWindows(fableUsed: Double?) -> BackendHealth.QuotaSnapshot {
        .init(accountID: "acct-claude", observedAt: now.addingTimeInterval(-5), source: .claudeNative,
              windows: [.init(bucket: "weekly", usedPercent: 15, resetsAt: now.addingTimeInterval(4 * 3600))] +
                (fableUsed.map { [.init(bucket: "weekly_model", usedPercent: $0, resetsAt: now.addingTimeInterval(4 * 3600),
                                       model: "claude-fable-5-1")] } ?? []))
    }
    func route(_ output: B.Output, _ admission: String = "reference") throws -> String {
        try javascriptRoute(B.catalogData(output, taskID: "task-fixture", requestSHA256: C.digest(Data("r".utf8))),
                            admission: admission, now: now)
    }
    // [a certified read-only descent, the uncertified reference] (R0).
    func routes(_ output: B.Output) throws -> [String] { try ["certified", "reference"].map { try route(output, $0) } }
    let referenceBase = try B.build(referenceInput())
    try check(tuples(referenceBase).first == "claude/claude-fable-5-1/low/read_only" && referenceBase.exclusions.isEmpty &&
              tuples(referenceBase).first(where: { $0.hasPrefix("codex") }) == "codex/gpt-6-astra/medium/read_only" &&
              referenceBase.modelTiers == ["claude-fable-5-1": "frontier", "claude-opus-5-5": "workhorse",
                  "claude-sonnet-5-5": "efficient", "sonnet": "efficient", "gpt-6-astra": "frontier",
                  "gpt-6.1-sol": "workhorse", "gpt-6-luna": "fast"],
              "the frontier model leads each pool and the previous-generation sol has no tier: \(tuples(referenceBase))")
    try check(try routes(referenceBase) == ["anthropic_shared/claude-sonnet-5-5/low/route_tier>claude-fable-5-1",
        "anthropic_shared/claude-fable-5-1/max/route_reference"],
              "a certified descent takes the cheapest certified tier, every other node the frontier reference, never opus at max: \((try? routes(referenceBase)) ?? [])")

    // ---- Build 407-g: the per-kind table end to end -----------------------
    // The host facts this builder emits (owner_scope, chat_lane_eligible,
    // request_class) drive the real JS host plan (R7) and admission law (R0):
    // with the shipped empty class table and no contract, every kind binds its
    // pool's frontier reference at the native ceiling, before any dispatch.
    func kind(_ request: String, owner: C.Scope, chat: Bool = false, material: Bool = false, write: Bool = false,
              explicit: [String]? = nil) throws -> String {
        var value = referenceInput(request)
        value.ownerScope = owner; value.chatLaneEligible = chat; value.hasMaterialRefs = material
        value.requireReadOnly = !write; value.explicitRouteSurfaces = explicit
        let output = try B.build(value)
        return try javascriptHostRoute(B.catalogData(output, taskID: "task-fixture", requestSHA256: C.digest(Data(request.utf8))),
                                       request: request, now: now, write: write, material: material, explicit: explicit)
    }
    let perKind: [(String, String, String)] = [
        ("chat_explanatory", try kind("co가 무슨 뜻이야?", owner: .readOnly, chat: true),
         "chat_explanatory|node_0=claude-chat/claude-fable-5-1/max/read_only/admitted_reference_uncertified"),
        ("text_operation", try kind("Translate into English: 오늘 회의는 3시에 시작합니다.", owner: .workspaceWrite, chat: true),
         "text_operation|node_0=claude-chat/claude-fable-5-1/max/read_only/admitted_reference_uncertified"),
        ("readonly_lookup", try kind("What does the interval rule in this workspace mean?", owner: .readOnly),
         "readonly_lookup|node_0=claude/claude-fable-5-1/max/read_only/admitted_reference_uncertified"),
        ("readonly_material", try kind("Summarize the attached notes.", owner: .readOnly, material: true),
         "readonly_material|node_0=claude/claude-fable-5-1/max/read_only/admitted_reference_uncertified"),
        ("writer", try kind("Fix the login bug in Sources/App.swift", owner: .workspaceWrite, write: true),
         "writer|node_0=claude/claude-fable-5-1/max/workspace_write/admitted_reference_uncertified"),
        ("explicit_route", try kind("Codex한테 interval 규칙, Claude Code한테 merge 규칙.", owner: .readOnly,
                                    explicit: ["codex", "claude"]),
         "explicit_route|requested-1=codex/gpt-6-astra/max/read_only/admitted_reference_owner_words," +
            "requested-2=claude/claude-fable-5-1/max/read_only/admitted_reference_owner_words"),
    ]
    for (name, actual, expected) in perKind {
        try check(actual == expected, "per-kind table (407-g): \(name) binds its reference from the builder's own facts: \(actual)")
    }

    // ---- Source incident 2026-10-19 (build 405): one refused refresh ------
    // Claude was last observed 4 minutes ago (session 9% used, weekly 3%);
    // the refresh after it got HTTP 429. Codex is fresh with 10% left until
    // a reset five days out. Build 405 emitted every Claude row with null
    // quota, so a standard node bound Codex at 10%. The retained observation
    // is now a discounted estimate with its true observedAt, valid for ten
    // minutes from observation: Claude stays dispatchable and wins the pool.
    var refusedRefresh = referenceInput()
    refusedRefresh.claudeQuota = BackendHealth.QuotaSnapshot(accountID: "acct-claude", observedAt: now.addingTimeInterval(-240),
        source: .claudeNative, windows: [
            .init(bucket: "session", usedPercent: 9, resetsAt: now.addingTimeInterval(3 * 3600)),
            .init(bucket: "weekly_all", usedPercent: 3, resetsAt: now.addingTimeInterval(5 * 86_400))])
    refusedRefresh.codexQuota = quota("acct-codex", used: 90, resetIn: 5 * 24)
    let refusedOut = try B.build(refusedRefresh)
    let refusedRow = refusedOut.candidates.first { $0["model"] as? String == "claude-sonnet-5-5" }
    let refusedFraction = refusedRow?["quota_remaining_fraction"] as? Double
    try check(refusedFraction.map { abs($0 - (91 - 2 * 240.0 / 60) / 100) < 1e-9 } == true &&
              refusedRow?["quota_observed_at_ms"] as? Int64 == Int64(now.addingTimeInterval(-240).timeIntervalSince1970 * 1000) &&
              refusedRow?["quota_valid_until_ms"] as? Int64 == Int64(now.addingTimeInterval(360).timeIntervalSince1970 * 1000) &&
              refusedOut.quotaScores["claude-sonnet-5-5"] != nil,
              "a retained Claude observation is a discounted, dated, valid estimate with a pool score: \(String(describing: refusedRow))")
    _ = try C.decodeCatalog(B.catalogData(refusedOut, taskID: "task-fixture", requestSHA256: C.digest(Data("r".utf8))))
    try check((try routes(refusedOut))[1].hasPrefix("anthropic_shared/"),
              "the reference binds the Claude pool (83% est.) over Codex at 10%: \((try? routes(refusedOut)) ?? [])")
    var unknownClaudeInput = refusedRefresh; unknownClaudeInput.claudeQuota = nil
    try check((try routes(try B.build(unknownClaudeInput)))[1].hasPrefix("openai_codex/"),
              "the build-405 failure reproduced: unknown Claude quota spends the scarce pool: \((try? routes(try B.build(unknownClaudeInput))) ?? [])")
    var expired = refusedRefresh; expired.now = now.addingTimeInterval(400)
    try check(try B.build(expired).candidates.filter { $0["quota_pool"] as? String == "anthropic_shared" }
                .allSatisfy { $0["quota_remaining_fraction"] is NSNull && $0["quota_valid_until_ms"] is NSNull },
              "an observation older than ten minutes is unknown again")

    // ---- Native reference ceiling: cheap-first routing remains cheap ------
    // This is a deterministic regression fixture, not a new provider claim.
    // Native capabilities and signed profiles must BOTH authorize execution.
    var nativeCeiling = referenceInput(preference: "codex")
    nativeCeiling.profiles.append(.init(action: "x_astra_ultra", provider: "codex", model: "gpt-6-astra", effort: "ultra"))
    nativeCeiling.codexModels = nativeCeiling.codexModels.map { model in
        model.slug == "gpt-6-astra" ? .init(slug: model.slug, supportedEfforts: model.supportedEfforts + ["ultra"], priority: model.priority) : model
    }
    let nativeCeilingOut = try B.build(nativeCeiling)
    try check(nativeCeilingOut.exclusions.isEmpty &&
              nativeCeilingOut.candidates.contains { $0["model"] as? String == "gpt-6-luna" && $0["effort"] as? String == "low" } &&
              nativeCeilingOut.candidates.contains { $0["model"] as? String == "gpt-6.1-sol" && $0["effort"] as? String == "medium" } &&
              nativeCeilingOut.candidates.contains { $0["model"] as? String == "gpt-6-astra" && $0["effort"] as? String == "ultra" },
              "adding a real ultra reference keeps cheap tier rows and all execution constraints")
    try check(try routes(nativeCeilingOut) == ["openai_codex/gpt-6-luna/low/route_tier>gpt-6-astra",
        "openai_codex/gpt-6-astra/ultra/route_reference"],
              "a certified descent stays cheap, guarded by native ultra; the reference uses native ultra, not fixed max")
    let nativeCeilingData = try B.catalogData(nativeCeilingOut, taskID: "task-fixture", requestSHA256: C.digest(Data("r".utf8)))
    try check((try C.decodeCatalog(nativeCeilingData)).candidates.contains { $0.model == "gpt-6-astra" && $0.effort == .ultra },
              "native ultra catalog roundtrips the unchanged strict wire contract")

    var missingSignedCeiling = nativeCeiling
    missingSignedCeiling.profiles.removeAll { $0.model == "gpt-6-astra" && $0.effort == "ultra" }
    let missingSignedOut = try B.build(missingSignedCeiling)
    try check(missingSignedOut.candidates.contains { $0["model"] as? String == "gpt-6-astra" && $0["effort"] as? String == "max" } &&
              reasons(missingSignedOut) == ["codex:reference_unavailable:2"] &&
              (try route(missingSignedOut)) == "error:no_dispatchable_candidate:read_only:reference_unavailable" &&
              (try route(missingSignedOut, "certified")) == "error:no_dispatchable_candidate:read_only:reference_unavailable",
              "native ultra without signed ultra holds the reference and every descent below it (R9); max is not a silent weaker reference")
    var explicitLow = nativeCeiling
    explicitLow.request = "use low reasoning"
    let explicitLowOut = try B.build(explicitLow)
    try check(explicitLowOut.intent.effort == "low" && explicitLowOut.candidates.allSatisfy { $0["effort"] as? String == "low" } &&
              reasons(explicitLowOut).contains { $0.contains("reference_unavailable") },
              "an explicit low effort is never upgraded to native ultra; unsupported frontier low is held")
    explicitLow.profiles.append(.init(action: "x_astra_low", provider: "codex", model: "gpt-6-astra", effort: "low"))
    explicitLow.codexModels = explicitLow.codexModels.map { model in
        model.slug == "gpt-6-astra" ? .init(slug: model.slug, supportedEfforts: model.supportedEfforts + ["low"], priority: model.priority) : model
    }
    let supportedLow = try B.build(explicitLow)
    try check(supportedLow.exclusions.isEmpty && supportedLow.candidates.allSatisfy { $0["effort"] as? String == "low" } &&
              (try route(supportedLow)) == "openai_codex/gpt-6-astra/low/route_explicit",
              "native + signed explicit low remains low even with native ultra available")

    var unsupportedUltra = nativeCeiling
    unsupportedUltra.codexModels = unsupportedUltra.codexModels.map { model in
        .init(slug: model.slug, supportedEfforts: model.supportedEfforts.filter { $0 != "ultra" }, priority: model.priority)
    }
    let unsupportedAuto = try B.build(unsupportedUltra)
    try check(!unsupportedAuto.candidates.contains { $0["effort"] as? String == "ultra" } &&
              reasons(unsupportedAuto) == ["codex:model_unavailable:1"] &&
              (try route(unsupportedAuto)) == "openai_codex/gpt-6-astra/max/route_reference",
              "a signed but native-unsupported ultra is not invented; the actual supported ceiling is max")
    unsupportedUltra.request = "use ultra reasoning"
    let unsupportedExact = try B.build(unsupportedUltra)
    try check(unsupportedExact.candidates.isEmpty && reasons(unsupportedExact).contains("codex:model_unavailable:1") &&
              reasons(unsupportedExact).contains { $0.contains("explicit_constraint_unavailable") },
              "an explicit unavailable ultra holds instead of silently executing max")
    var unknownEffort = nativeCeiling
    unknownEffort.profiles.append(.init(action: "x_astra_future", provider: "codex", model: "gpt-6-astra", effort: "future"))
    unknownEffort.codexModels = unknownEffort.codexModels.map { model in
        .init(slug: model.slug, supportedEfforts: model.supportedEfforts + ["future"], priority: model.priority)
    }
    let unknownOut = try B.build(unknownEffort)
    try check(!unknownOut.candidates.contains { $0["effort"] as? String == "future" } &&
              reasons(unknownOut) == ["codex:model_unavailable:1"] &&
              (try C.decodeCatalog(B.catalogData(unknownOut, taskID: "task-fixture", requestSHA256: C.digest(Data("r".utf8)))))
                .candidates.allSatisfy { $0.effort.rawValue != "future" } &&
              (try route(unknownOut)) == "openai_codex/gpt-6-astra/ultra/route_reference",
              "unknown native/signed effort names are held, never ranked or contract-poisoning")
    var ultraExhausted = nativeCeiling
    ultraExhausted.codexQuotaExhaustedModels = ["gpt-6-astra"]
    let ultraExhaustedOut = try B.build(ultraExhausted)
    try check(reasons(ultraExhaustedOut) == ["codex:quota_zero:3", "codex:reference_unavailable:3"] &&
              (try route(ultraExhaustedOut)) == "error:no_dispatchable_candidate:read_only:reference_unavailable" &&
              (try route(ultraExhaustedOut, "certified")) == "error:no_dispatchable_candidate:read_only:reference_unavailable",
              "quota-exhausted native maximum has no weaker reference substitute, and no descent runs without it")

    // Native ceiling metadata is exact, optional and non-authoritative for
    // permissions: it can hold a missing tuple, never manufacture that tuple.
    let ceilingCatalog = try C.decodeCatalog(nativeCeilingData)
    try check(ceilingCatalog.nativeReferenceEfforts == nativeCeilingOut.nativeReferenceEfforts &&
              ceilingCatalog.nativeReferenceEfforts?["codex"]?["gpt-6-astra"] == "ultra" &&
              (try C.decodeCatalog(C.encode(ceilingCatalog))) == ceilingCatalog,
              "fresh native ceiling metadata roundtrips without changing candidate identity")
    var legacyCeiling = ceilingCatalog; legacyCeiling.nativeReferenceEfforts = nil
    try check(!String(decoding: try C.encode(legacyCeiling), as: UTF8.self).contains("native_reference_efforts") &&
              (try C.decodeCatalog(C.encode(legacyCeiling))).nativeReferenceEfforts == nil,
              "older catalogs without native evidence remain decodable, not retrospectively attested")
    func ceilingMutation(_ field: Any) throws -> Data {
        var value = try JSONSerialization.jsonObject(with: nativeCeilingData) as! [String: Any]
        value["native_reference_efforts"] = field
        return try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    }
    for (name, field): (String, Any) in [
        ("null", NSNull()), ("array", []), ("unknown provider", ["local": ["gpt-6-astra": "ultra"]]),
        ("non-object provider", ["codex": []]), ("unknown model", ["codex": ["not-offered": "ultra"]]),
        ("unknown effort", ["codex": ["gpt-6-astra": "future", "gpt-6.1-sol": "max", "gpt-6-luna": "max", "gpt-6-sol": "max"]]),
        ("numeric effort", ["codex": ["gpt-6-astra": 9]]),
        ("missing coverage", ["codex": ["gpt-6-astra": "ultra"]]),
        ("forged lower ceiling", ["codex": ["gpt-6-astra": "max", "gpt-6.1-sol": "max", "gpt-6-luna": "max", "gpt-6-sol": "max"]]),
        ("orphan provider", ["codex": nativeCeilingOut.nativeReferenceEfforts["codex"]!, "claude": [:]])
    ] {
        do { _ = try C.decodeCatalog(ceilingMutation(field)); try check(false, "invalid native ceiling accepted: \(name)") }
        catch { checks += 1 }
    }
    var oversizedNative: [String: String] = [:]
    for index in 0...256 { oversizedNative["model-\(index)"] = "max" }
    do { _ = try C.decodeCatalog(ceilingMutation(["codex": oversizedNative])); try check(false, "oversize native map accepted") }
    catch { checks += 1 }
    var missingFamilyCeiling = missingSignedCeiling
    missingFamilyCeiling.request = "astra로 돌려"
    let missingFamilyOut = try B.build(missingFamilyCeiling)
    try check(missingFamilyOut.intent.modelFamily == "astra" && missingFamilyOut.exclusions.isEmpty &&
              missingFamilyOut.nativeReferenceEfforts["codex"]?["gpt-6-astra"] == "ultra" &&
              (try route(missingFamilyOut)) == "error:no_dispatchable_candidate:read_only:deep",
              "naming a family without an effort cannot silently lower its native ultra reference to signed max")

    var aliasCeiling = referenceInput("fable로 돌려", preference: "claude")
    aliasCeiling.claudeModels = [.init(model: "fable", supportedEfforts: ["low", "max"], nativeRank: 0),
        .init(model: "claude-fable-5-1", supportedEfforts: ["low", "max", "ultra"], nativeRank: 0)]
    aliasCeiling.profiles = [.init(action: "a_alias_max", provider: "claude", model: "fable", effort: "max"),
        .init(action: "b_full_low", provider: "claude", model: "claude-fable-5-1", effort: "low"),
        .init(action: "b_full_max", provider: "claude", model: "claude-fable-5-1", effort: "max")]
    let aliasMissingOut = try B.build(aliasCeiling)
    try check(aliasMissingOut.nativeReferenceEfforts == ["claude": ["fable": "ultra", "claude-fable-5-1": "ultra"]] &&
              !aliasMissingOut.candidates.contains { $0["effort"] as? String == "ultra" } &&
              (try route(aliasMissingOut)) == "error:no_dispatchable_candidate:read_only:deep",
              "observed aliases share native ceiling; alias max never hides unsigned full-ID ultra")
    aliasCeiling.profiles.append(.init(action: "b_full_ultra", provider: "claude", model: "claude-fable-5-1", effort: "ultra"))
    let aliasAvailableOut = try B.build(aliasCeiling)
    try check((try route(aliasAvailableOut)) == "anthropic_shared/claude-fable-5-1/ultra/route_explicit" &&
              !aliasAvailableOut.candidates.contains { $0["model"] as? String == "fable" && $0["effort"] as? String == "ultra" },
              "a real full-ID ultra executes; metadata does not fabricate alias ultra capability")

    var mixedRoutes = aliasCeiling
    mixedRoutes.request = "Route two tasks"
    mixedRoutes.explicitRouteSurfaces = ["claude", "claude"]
    mixedRoutes.explicitRouteIntents = [.init(modelFamily: "fable"), .init(effort: "max", modelFamily: "sonnet")]
    mixedRoutes.profiles.removeAll { $0.effort == "ultra" }
    mixedRoutes.profiles.append(.init(action: "s_sonnet_max", provider: "claude", model: "sonnet", effort: "max"))
    mixedRoutes.claudeModels.append(.init(model: "sonnet", supportedEfforts: ["low", "max"], nativeRank: 1))
    let mixedOut = try B.build(mixedRoutes)
    let mixedData = try B.catalogData(mixedOut, taskID: "task-fixture", requestSHA256: C.digest(Data("r".utf8)))
    try check(mixedOut.exclusions.isEmpty &&
              (try javascriptRoute(mixedData, now: now, explicitRoutes: ["claude", "claude"], routeIndex: 0)) ==
                "error:no_dispatchable_candidate:read_only:deep" &&
              (try javascriptRoute(mixedData, now: now, explicitRoutes: ["claude", "claude"], routeIndex: 1)) ==
                "anthropic_shared/sonnet/max/route_explicit",
              "mixed same-pool fan-out: missing family ceiling holds only that route; exact other-family max runs")
    mixedRoutes.explicitRouteIntents = [.init(effort: "max", modelFamily: "fable"), .init(effort: "max", modelFamily: "sonnet")]
    let exactMixedData = try B.catalogData(B.build(mixedRoutes), taskID: "task-fixture", requestSHA256: C.digest(Data("r".utf8)))
    try check((try javascriptRoute(exactMixedData, now: now, explicitRoutes: ["claude", "claude"], routeIndex: 0)) ==
                "anthropic_shared/claude-fable-5-1/max/route_explicit",
              "an explicit lower max request remains exact even when native ceiling is ultra")

    // ---- Production-shaped Claude pool (2026-10-15) -----------------------
    // The 85-profile production set's Claude rows: build 383 added medium and high
    // for claude-opus-5-5, claude-sonnet-5-5 and claude-fable-5-1, and
    // claude-haiku-4-5-20251001 at effort "none" (cl_haiku45_none). Native rows
    // as the CLI 2.1.290 initialize inventory lists them (opus, fable 5.1,
    // sonnet, haiku); haiku's row has no effort control, so its one level is
    // "none" (ModelAvailability.claudeRows). Each name keeps only its own
    // configured efforts, as the host's configured catalog does.
    func productionClaude(_ request: String = "Explain the login function", readOnly: Bool = true) -> B.Input {
        var value = input(request, preference: "claude", chat: false, readOnly: readOnly)
        let all = ["low", "medium", "high", "xhigh", "max"]
        value.profiles = [("fable51", "claude-fable-5-1"), ("opus55", "claude-opus-5-5"), ("sonnet55", "claude-sonnet-5-5")]
            .flatMap { name, model in all.map { B.Profile(action: "cl_\(name)_\($0)", provider: "claude", model: model, effort: $0) } } + [
            .init(action: "cl_fable_low", provider: "claude", model: "fable", effort: "low"),
            .init(action: "cl_fable_xhigh", provider: "claude", model: "fable", effort: "xhigh"),
            .init(action: "cl_fable_max", provider: "claude", model: "fable", effort: "max"),
            .init(action: "cl_opus_xhigh", provider: "claude", model: "opus", effort: "xhigh"),
            .init(action: "cl_opus_max", provider: "claude", model: "opus", effort: "max"),
            .init(action: "cl_sonnet_medium", provider: "claude", model: "sonnet", effort: "medium"),
            .init(action: "cl_haiku45_none", provider: "claude", model: "claude-haiku-4-5-20251001", effort: "none"),
            .init(action: "os1_exact", provider: "local", model: "local-deterministic", effort: "none")]
        value.claudeModels = [.init(model: "claude-opus-5-5", supportedEfforts: all, nativeRank: 0),
            .init(model: "opus", supportedEfforts: ["xhigh", "max"], nativeRank: 0),
            .init(model: "claude-fable-5-1", supportedEfforts: all, nativeRank: 1),
            .init(model: "fable", supportedEfforts: ["low", "xhigh", "max"], nativeRank: 1),
            .init(model: "sonnet", supportedEfforts: ["medium"], nativeRank: 2),
            .init(model: "claude-sonnet-5-5", supportedEfforts: all, nativeRank: 2),
            .init(model: "claude-haiku-4-5-20251001", supportedEfforts: ["none"], nativeRank: 3)]
        value.claudeQuota = claudeWindows(fableUsed: nil)
        return value
    }
    func writeRoutes(_ output: B.Output) throws -> [String] {
        let data = try B.catalogData(output, taskID: "task-fixture", requestSHA256: C.digest(Data("r".utf8)))
        return try ["certified", "reference"].map { try javascriptRoute(data, admission: $0, now: now, scope: "workspace_write") }
    }
    let production = try B.build(productionClaude())
    let haikuRows = production.candidates.filter { $0["model"] as? String == "claude-haiku-4-5-20251001" }
    try check(haikuRows.count == 1 && haikuRows[0]["effort"] as? String == "none" && haikuRows[0]["scope"] as? String == "read_only" &&
              production.exclusions.isEmpty && production.modelTiers["claude-haiku-4-5-20251001"] == "fast" &&
              production.modelTiers["claude-opus-5-5"] == "workhorse" && production.modelTiers["claude-fable-5-1"] == "frontier",
              "the effortless haiku row is one read-only candidate at effort none, tiered fast: \(tuples(production))")
    try check(try C.decodeCatalog(B.catalogData(production, taskID: "task-fixture", requestSHA256: C.digest(Data("r".utf8))))
                .candidates.contains { $0.model == "claude-haiku-4-5-20251001" && $0.exactConfig.effort == .none },
              "a Claude row at effort none passes the strict Swift catalog contract")
    try check(try routes(production) == ["anthropic_shared/claude-haiku-4-5-20251001/none/route_tier>claude-fable-5-1",
        "anthropic_shared/claude-fable-5-1/max/route_reference"],
              "a certified read-only descent runs haiku at none, escalating once to fable 5.1 at max; every other node is the reference: \((try? routes(production)) ?? [])")
    let productionWrite = try B.build(productionClaude(writeRequest, readOnly: false))
    let writes = try writeRoutes(productionWrite)
    try check(writes.allSatisfy { !$0.contains("haiku") && !$0.hasPrefix("error") } &&
              writes == ["anthropic_shared/claude-fable-5-1/max/route_reference", "anthropic_shared/claude-fable-5-1/max/route_reference"],
              "a writer is never certified: it binds the reference writer row, never haiku (R5): \(writes)")
    let productionMedium = try B.build(productionClaude("use medium reasoning"))
    try check(B.intent(productionClaude("use medium reasoning")) == RoutingIntent(effort: "medium") &&
              !productionMedium.candidates.contains { $0["model"] as? String == "claude-haiku-4-5-20251001" } &&
              (try routes(productionMedium)).allSatisfy { !$0.contains("haiku") && !$0.hasPrefix("error") },
              "an owner effort word excludes haiku, which cannot honour it: \(tuples(productionMedium)) \((try? routes(productionMedium)) ?? [])")
    let productionHaiku = try B.build(productionClaude("haiku로 돌려"))
    try check(B.intent(productionClaude("haiku로 돌려")) == RoutingIntent(modelFamily: "haiku") &&
              tuples(productionHaiku) == ["claude/claude-haiku-4-5-20251001/none/read_only"] &&
              (try routes(productionHaiku)).allSatisfy { $0.hasPrefix("anthropic_shared/claude-haiku-4-5-20251001/none/") },
              "the family word 'haiku' admits the effortless row and runs it: \(tuples(productionHaiku)) \((try? routes(productionHaiku)) ?? [])")
    var nearlyInput = referenceInput(); nearlyInput.claudeQuota = claudeWindows(fableUsed: 97)
    let nearly = try B.build(nearlyInput)
    // The reference ranks pools by the frontier model's own quota; a certified
    // descent binds a lower tier and ranks pools by THAT model's quota
    // (quota_scores, R11): Claude's sonnet has 85% left with 4h to reset,
    // Codex's luna 60% over 48h.
    try check(tuples(nearly).first == "codex/gpt-6-astra/medium/read_only" &&
              (try routes(nearly)) == ["anthropic_shared/claude-sonnet-5-5/low/route_tier>claude-fable-5-1",
                "openai_codex/gpt-6-astra/max/route_reference"],
              "a nearly exhausted frontier model ranks its pool by that model for the reference only: \(tuples(nearly)) \((try? routes(nearly)) ?? [])")
    let nearlyScores = try C.decodeCatalog(B.catalogData(nearly, taskID: "task-fixture", requestSHA256: C.digest(Data("r".utf8)))).quotaScores
    try check(nearlyScores?["claude-fable-5-1"] == 7_500_000 && nearlyScores?["claude-sonnet-5-5"] == 212_500_000 &&
              nearlyScores?["gpt-6-luna"] == 12_500_000 && nearlyScores?["gpt-6-astra"] == 12_500_000,
              "quota_scores: share x the model's own remaining / hours to its own reset, parts per billion: \(nearlyScores ?? [:])")
    var zeroInput = referenceInput(); zeroInput.claudeQuota = claudeWindows(fableUsed: 100)
    let fableZero = try B.build(zeroInput)
    try check(!fableZero.candidates.contains { $0["model"] as? String == "claude-fable-5-1" } &&
              fableZero.candidates.contains { $0["model"] as? String == "claude-opus-5-5" } &&
              reasons(fableZero) == ["claude:quota_zero:3", "claude:reference_unavailable:3"] &&
              (try route(fableZero)) == "openai_codex/gpt-6-astra/max/route_reference" &&
              (try route(fableZero, "certified")) == "anthropic_shared/claude-sonnet-5-5/low/route_tier>gpt-6-astra",
              "a quota_zero frontier model is no reference; a descent in its pool escalates to the other pool's: \(reasons(fableZero)) \((try? routes(fableZero)) ?? [])")
    var cooledInput = referenceInput(); cooledInput.claudeQuotaBackoffFamilies = ["fable"]
    let cooled = try B.build(cooledInput)
    try check(reasons(cooled) == ["claude:quota_backoff:3", "claude:reference_unavailable:3"] &&
              (try route(cooled)) == "openai_codex/gpt-6-astra/max/route_reference" &&
              B.providersToProbe(cooledInput) == ["claude", "codex"],
              "a cooled frontier family serves no deep work: \(tuples(cooled)) \(reasons(cooled))")
    // Host-shaped input: the general Codex catalog drops a slug whose own
    // bucket is exhausted. Kept and marked exhausted, it still explains the
    // pool's reference_unavailable; the workhorse never stands in for deep work.
    var hostCodex = referenceInput()
    let astra = B.CodexModel(slug: "gpt-6-astra", supportedEfforts: ["medium", "max"], priority: 1)
    let available = hostCodex.codexModels.filter { $0.slug != "gpt-6-astra" }
    let shaped = B.codexInventory(available: available, quotaExcluded: [astra])
    try check(shaped.models == available + [astra] && shaped.quotaExhausted == ["gpt-6-astra"] &&
              B.codexInventory(available: available + [astra], quotaExcluded: [astra]).quotaExhausted.isEmpty,
              "host Codex inventory keeps a quota-excluded slug, marked exhausted")
    hostCodex.codexModels = shaped.models; hostCodex.codexQuotaExhaustedModels = shaped.quotaExhausted
    hostCodex.claudeQuota = claudeWindows(fableUsed: 100)
    let hostCodexOut = try B.build(hostCodex)
    try check(reasons(hostCodexOut) == ["claude:quota_zero:3", "claude:reference_unavailable:3",
                                        "codex:quota_zero:2", "codex:reference_unavailable:2"] &&
              (try route(hostCodexOut)) == "error:no_dispatchable_candidate:read_only:reference_unavailable" &&
              (try route(hostCodexOut, "certified")) == "error:no_dispatchable_candidate:read_only:reference_unavailable",
              "no frontier anywhere: nothing runs, not even a certified descent (R9, R12): \(reasons(hostCodexOut)) \((try? routes(hostCodexOut)) ?? [])")
    var hostCodexOnly = hostCodex; hostCodexOnly.claudeQuota = claudeWindows(fableUsed: nil)
    let hostCodexOnlyOut = try B.build(hostCodexOnly)
    try check(!hostCodexOnlyOut.candidates.contains { $0["model"] as? String == "gpt-6-astra" } &&
              (try route(hostCodexOnlyOut)) == "anthropic_shared/claude-fable-5-1/max/route_reference",
              "the other pool's frontier runs deep work, never gpt-6.1-sol: \(tuples(hostCodexOnlyOut))")
    // Host-shaped Claude input: the host passes the configured inventory
    // (cooled family included). Under a Claude preference a cooled frontier
    // family leaves an explained Claude-only catalog with no deep work.
    var hostClaude = referenceInput(preference: "claude"); hostClaude.claudeQuotaBackoffFamilies = ["fable"]
    let hostClaudeOut = try B.build(hostClaude)
    let hostClaudeData = try B.catalogData(hostClaudeOut, taskID: "task-fixture", requestSHA256: C.digest(Data("r".utf8)))
    try check(reasons(hostClaudeOut) == ["claude:quota_backoff:3", "claude:reference_unavailable:3"] &&
              (try C.decodeCatalog(hostClaudeData)).exclusions?.map(\.reason) == ["quota_backoff", "reference_unavailable"] &&
              (try route(hostClaudeOut)) == "error:no_dispatchable_candidate:read_only:reference_unavailable" &&
              (try route(hostClaudeOut, "certified")) == "error:no_dispatchable_candidate:read_only:reference_unavailable",
              "a cooled frontier family under a Claude preference holds every node, explained: \(reasons(hostClaudeOut))")
    try check(B.build(referenceInput(preference: "claude")).candidates.first?["model"] as? String == "claude-fable-5-1",
              "before the rejection the Claude preference's first row is its frontier reference")
    // An effort-only owner word fixes the reference those words leave: the
    // frontier at that effort, certified or not (R10).
    let medium = try B.build(referenceInput("use medium reasoning"))
    try check(B.intent(referenceInput("use medium reasoning")) == RoutingIntent(effort: "medium") &&
              tuples(medium) == ["claude/sonnet/medium/read_only", "codex/gpt-6-astra/medium/read_only",
                                 "codex/gpt-6.1-sol/medium/read_only"] &&
              reasons(medium) == ["claude:reference_unavailable:3"] &&
              // Claude's fable has no medium profile, so Codex's astra medium.
              (try routes(medium)) == ["openai_codex/gpt-6-astra/medium/route_explicit",
                "openai_codex/gpt-6-astra/medium/route_explicit"],
              "an effort word runs a frontier model at it, never a host-chosen lower model: \(tuples(medium)) \(reasons(medium))")
    // "최대 리즈닝" (max): the frontier at max. The previous-generation
    // gpt-6-sol max row never runs.
    let koreanMax = try B.build(referenceInput("최대 리즈닝으로 해줘"))
    try check(B.intent(referenceInput("최대 리즈닝으로 해줘")) == RoutingIntent(effort: "max") &&
              koreanMax.candidates.allSatisfy { $0["effort"] as? String == "max" } &&
              (try routes(koreanMax)) == ["anthropic_shared/claude-fable-5-1/max/route_explicit",
                "anthropic_shared/claude-fable-5-1/max/route_explicit"],
              "max reasoning runs the frontier at max, certified or not: \((try? routes(koreanMax)) ?? [])")
    let mediumClaudeOut = try B.build(referenceInput("use medium reasoning", preference: "claude"))
    try check(tuples(mediumClaudeOut) == ["claude/sonnet/medium/read_only"] &&
              reasons(mediumClaudeOut) == ["claude:reference_unavailable:3"] &&
              (try route(mediumClaudeOut)) == "error:no_dispatchable_candidate:read_only:reference_unavailable",
              "under a Claude preference the frontier model lacking the effort holds deep work: \(reasons(mediumClaudeOut))")
    // An explicit model family is its own route: no reference rule applies.
    var sonnetFamily = referenceInput("소네트로 돌려"); sonnetFamily.profiles.removeAll { $0.provider == "codex" }
    let sonnetOut = try B.build(sonnetFamily)
    try check(B.intent(sonnetFamily) == RoutingIntent(modelFamily: "sonnet") && sonnetOut.exclusions.isEmpty &&
              tuples(sonnetOut) == ["claude/sonnet/medium/read_only", "claude/claude-sonnet-5-5/low/read_only"] &&
              // This native Sonnet row supports max, but its signed profiles
              // offer only low/medium. Neither medium nor an alias can stand
              // in as the family's reference, certified or not (R10).
              (try routes(sonnetOut)) == ["error:no_dispatchable_candidate:read_only:deep",
                "error:no_dispatchable_candidate:read_only:deep"],
              "a named family holds its missing native reference ceiling: \(tuples(sonnetOut)) \((try? routes(sonnetOut)) ?? [])")
    // An explicit route test: each route's OWN words travel per route,
    // aligned with the original list (build 378 review); none means absent.
    var perRoute = referenceInput("1+1 Codex한테. 최대 리즈닝으로 3+3 Claude Code한테")
    perRoute.explicitRouteSurfaces = ["codex", "claude"]
    perRoute.explicitRouteIntents = [RoutingIntent.parse("1+1"), RoutingIntent.parse("최대 리즈닝으로 해줘")]
    let perRouteData = try B.catalogData(B.build(perRoute), taskID: "task-fixture", requestSHA256: C.digest(Data("r".utf8)))
    let perRouteCatalog = try C.decodeCatalog(perRouteData)
    try check(perRouteCatalog.explicitRouteIntents == [nil, .init(effort: "max", modelFamily: nil)] &&
              perRouteCatalog.routingIntent == nil && (try C.decodeCatalog(C.encode(perRouteCatalog))) == perRouteCatalog,
              "explicit_route_intents carries each route's own words, null for a route with none")
    // What the doc says about route words, checked on the real splitter and
    // parser: a fan-out part must be bare arithmetic, so a sentence whose part
    // carries its own effort or model words is not split into named routes,
    // and a bare family before the payload is no model word.
    try check(RouteFanout.plan("1+1 Codex한테. 3+3 Claude Code한테.")?.targets.map(\.payload) == ["1+1", "3+3"] &&
              RouteFanout.plan("최대 리즈닝으로 1+1 Codex한테. 3+3 Claude Code한테.") == nil &&
              RouteFanout.plan("astra로 돌려 1+1 Codex한테. 3+3 Claude Code한테.") == nil &&
              RoutingIntent.parse("astra로 돌려 1+1") == .init(effort: nil, modelFamily: "astra") &&
              RoutingIntent.parse("astra로 1+1").isEmpty,
              "route words: worded parts are not split; \"astra로 돌려\" names astra, a bare \"astra로\" names nothing")
    var wordless = perRoute; wordless.explicitRouteIntents = [RoutingIntent(), RoutingIntent()]
    try check(!String(decoding: try B.catalogData(B.build(wordless), taskID: "task-fixture",
                                                  requestSHA256: C.digest(Data("r".utf8))), as: UTF8.self)
                .contains("explicit_route_intents") &&
              !String(decoding: try B.catalogData(B.build(referenceInput()), taskID: "task-fixture",
                                                  requestSHA256: C.digest(Data("r".utf8))), as: UTF8.self)
                .contains("explicit_route_intents"),
              "no route words, or no explicit route test: no explicit_route_intents")
    // Both build-378 review fields are optional and strictly checked.
    func mutated(_ change: (inout [String: Any]) -> Void) throws -> Data {
        var object = try JSONSerialization.jsonObject(with: perRouteData) as! [String: Any]
        change(&object); return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }
    for (name, data) in [
        ("nine route intents", try mutated { $0["explicit_route_intents"] = Array(repeating: NSNull(), count: 9) }),
        ("an empty route intent", try mutated { $0["explicit_route_intents"] = [["effort": NSNull(), "model_family": NSNull()], NSNull()] }),
        ("a negative score", try mutated { $0["quota_scores"] = ["gpt-6-astra": -1] }),
        ("a score above one", try mutated { $0["quota_scores"] = ["gpt-6-astra": 1_000_000_001] }),
        ("a score for a model not offered", try mutated { $0["quota_scores"] = ["gpt-9": 5] }),
        ("an unknown field", try mutated { $0["route_scores"] = [:] as [String: Any] })] {
        do { _ = try C.decodeCatalog(data); try check(false, "accepted \(name)") } catch { checks += 1 }
    }
    var older = try JSONSerialization.jsonObject(with: perRouteData) as! [String: Any]
    older.removeValue(forKey: "explicit_route_intents"); older.removeValue(forKey: "quota_scores")
    let olderCatalog = try C.decodeCatalog(JSONSerialization.data(withJSONObject: older, options: [.sortedKeys]))
    try check(olderCatalog.explicitRouteIntents == nil && olderCatalog.quotaScores == nil,
              "an older catalog without the new fields still decodes")
    // An explicit route test keeps its former candidate set.
    var explicitReference = zeroInput; explicitReference.explicitRouteSurfaces = ["claude"]
    let explicitReferenceOut = try B.build(explicitReference)
    try check(explicitReferenceOut.candidates.contains { $0["model"] as? String == "claude-sonnet-5-5" } &&
              !reasons(explicitReferenceOut).contains { $0.contains("reference_unavailable") },
              "an explicit route test is exempt from the reference rule: \(reasons(explicitReferenceOut))")

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
    try check(namedCodex.candidates.count == 10 && !reasons(namedCodex).contains { $0.contains("capacity_zero") },
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
        // An effort word that describes a noun, or follows an article or a
        // possessive, is not a request about this run (review round 4).
        ("This is a low effort change: rename foo to bar in utils.js", nil, nil),
        ("Add a docstring; this is a low effort fix", nil, nil),
        ("Our app has a minimal thinking mode toggle; fix the bug where it crashes", nil, nil),
        ("Summarize this paper on high reasoning models", nil, nil),
        ("Our ultra thinking mode crashes on launch; fix it", nil, nil),
        ("the max reasoning feature is broken, fix it", nil, nil), ("우리 앱의 울트라 thinking 모드가 꺼져, 고쳐줘", nil, nil),
        ("최대 리즈닝 모드로 해줘", "max", nil), ("use a high reasoning pass for this", "high", nil),
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
    // Saying max is not needed sets no constraint: all native-supported
    // signed efforts stay available, without forcing an expensive selection.
    let notNeeded = try B.build(input("최대 리즈닝 필요 없어, 간단히 답해"))
    try check(!notNeeded.candidates.isEmpty && notNeeded.intent.isEmpty &&
              notNeeded.candidates.contains { $0["effort"] as? String == "max" } &&
              notNeeded.candidates.contains { $0["effort"] as? String == "ultra" },
              "a negated effort is no constraint; native-supported ultra remains: \(tuples(notNeeded))")
    let opusMax = try B.build(input("opus max로 해줘"))
    try check(!opusMax.candidates.isEmpty && opusMax.candidates.allSatisfy { $0["model"] as? String == "claude-opus-5-5" &&
              $0["effort"] as? String == "max" }, "explicit model+effort keeps exactly that tuple: \(tuples(opusMax))")
    // Max reasoning keeps every max row (build 378): the class then picks
    // the tier at max. Codex offers no frontier model here, so it says so.
    let korean = try B.build(input("최대 리즈닝으로 해줘"))
    try check(korean.candidates.allSatisfy { $0["effort"] as? String == "max" } &&
              Set(korean.candidates.map { $0["model"] as! String }) == ["fable", "claude-opus-5-5", "gpt-5.6-luna"] &&
              reasons(korean) == ["codex:reference_unavailable:1"],
              "Korean max reasoning keeps the max rows, explained: \(tuples(korean)) \(reasons(korean))")
    var koreanTop = input("최대 리즈닝으로 해줘")
    koreanTop.claudeModels = [.init(model: "fable", supportedEfforts: ["low", "xhigh", "max"]),
                              .init(model: "claude-opus-5-5", supportedEfforts: ["xhigh", "max"]),
                              .init(model: "sonnet", supportedEfforts: ["medium"])]
    koreanTop.codexModels = [.init(slug: "gpt-5.6-luna", supportedEfforts: ["low", "medium", "high", "xhigh", "max"], priority: 0),
                             .init(slug: "gpt-6-sol", supportedEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"], priority: 1)]
    let koreanTopOut = try B.build(koreanTop)
    try check(!koreanTopOut.candidates.isEmpty && koreanTopOut.candidates.allSatisfy { $0["effort"] as? String == "max" } &&
              Set(koreanTopOut.candidates.map { $0["model"] as! String }) == ["fable", "claude-opus-5-5", "gpt-5.6-luna"] &&
              tuples(koreanTopOut).first { $0.hasPrefix("claude") } == "claude-chat/fable/max/read_only",
              "Korean max reasoning keeps only max rows, the top model first: \(tuples(koreanTopOut))")
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
              String(decoding: haikuData, as: UTF8.self).contains("\"exclusions\"") &&
              !String(decoding: haikuData, as: UTF8.self).contains("model_tiers"),
              "empty-with-exclusions catalog decodes, with no model_tiers")
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

    // ---- Native-supported maximum is available without forcing every task ----
    try check(base.candidates.contains { $0["effort"] as? String == "ultra" } &&
              !base.candidates.contains { $0["effort"] as? String == "ultracode" },
              "ordinary Auto offers signed native-supported ultra and never invents ultracode")
    try check(base.candidates.contains { $0["effort"] as? String == "max" && $0["quota_pool"] as? String == "openai_codex" } &&
              base.candidates.contains { $0["effort"] as? String == "max" && $0["quota_pool"] as? String == "anthropic_shared" },
              "max is offered in both pools without an explicit effort word")


    // ---- Empty with exclusions; unexplained empty is malformed ------------
    var signedOut = input(plan: .init(codex: 0, claude: 100)); signedOut.auth["claude"] = .signedOut
    let blocked = try B.build(signedOut)
    try check(blocked.candidates.isEmpty && Set(blocked.exclusions.map(\.reason)) == ["capacity_zero", "signed_out"],
              "signed-out Claude plus a 0% Codex is an explained empty catalog: \(reasons(blocked))")
    var nonSubscription = input(); nonSubscription.auth["codex"] = .nonSubscription; nonSubscription.auth["claude"] = nil
    let nonSub = try B.build(nonSubscription)
    try check(reasons(nonSub).contains("codex:non_subscription:5") && reasons(nonSub).contains("claude:signed_out:7"),
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

    // ---- Local execution row (route-all, 2026-10-14) --------------------
    // Only an explicit route test that names the local surface gets the one
    // local model row, and only with the host's own readiness observation.
    var localRoutes = input("1+1"); localRoutes.explicitRouteSurfaces = ["local", "codex", "claude", "claude-chat"]
    try check(B.build(localRoutes).candidates.allSatisfy { $0["surface"] as? String != "local" },
              "an unprobed local model has no row (never fabricated available)")
    localRoutes.localModel = .init(ready: true, at: now)
    let localOut = try B.build(localRoutes)
    let localRows = localOut.candidates.filter { $0["surface"] as? String == "local" }
    try check(localRows.count == 1 && localRows[0]["model"] as? String == B.localWorkerModel &&
              localRows[0]["transport"] as? String == "local" && localRows[0]["quota_pool"] as? String == "none" &&
              localRows[0]["effort"] as? String == "none" && (localRows[0]["tools"] as? [String]) == [] &&
              localRows[0]["scope"] as? String == "read_only" && localRows[0]["availability"] as? String == "available" &&
              localRows[0]["availability_observed_at_ms"] as? Int64 == Int64(now.timeIntervalSince1970 * 1000) &&
              localOut.candidates.last.map({ $0["surface"] as? String }) == "local",
              "one read-only, tools-free, quota-free local row, last, available from the probe")
    let localCatalog = try C.decodeCatalog(B.catalogData(localOut, taskID: "task-fixture", requestSHA256: C.digest(Data("r".utf8))))
    try check(localCatalog.candidates.filter { $0.surface == .local }.count == 1 &&
              localCatalog.modelTiers?[B.localWorkerModel] == nil,
              "the local row passes the strict Swift catalog contract and carries no tier")
    var later = localRoutes; later.localModel = .init(ready: false, at: now.addingTimeInterval(30)); later.now = now.addingTimeInterval(30)
    let unready = try B.build(later).candidates.filter { $0["surface"] as? String == "local" }
    try check(unready.count == 1 && unready[0]["id"] as? String == localRows[0]["id"] as? String &&
              unready[0]["configuration_sha256"] as? String == localRows[0]["configuration_sha256"] as? String &&
              unready[0]["availability"] as? String == "unavailable",
              "the row's identity is stable across refreshes; a failed probe is an observed unavailable row")
    var autoLocal = input("1+1"); autoLocal.localModel = .init(ready: true, at: now)
    try check(B.build(autoLocal).candidates.allSatisfy { $0["surface"] as? String != "local" },
              "Auto never gets a local model row: ordinary work is not routed to the local model")
    var onlyLocal = localRoutes; onlyLocal.profiles = []; onlyLocal.explicitRouteSurfaces = ["local"]
    let onlyLocalOut = try B.build(onlyLocal)
    try check(onlyLocalOut.candidates.count == 1 &&
              (try C.decodeCatalog(B.catalogData(onlyLocalOut, taskID: "task-fixture", requestSHA256: C.digest(Data("r".utf8))))).modelTiers == [:],
              "a local-only explicit test is a valid catalog with an empty tier map")
    // R10 v2 is additive and OFF unless an immutable task marker AND host
    // capability opt-in agree. These synthetic observations grant no live gate.
    let knownV2 = Set(profiles.map(\.model))
    func v2(_ text: String) -> C.RoutingIntentV2 { RoutingIntent.parseV2(text, knownModelIDs: knownV2) }
    // Setting ownership: task constraints/subject nouns are not routing
    // constraints. These are pairs, not exemptions for one provider/name.
    let ordinaryV2 = [
        "Run the tests without changing code",
        "If there is a bug in Codex integration, explain it",
        "Fix Codex integration without changing authentication",
        "Explain how Claude handles errors, not how to configure it",
        "Fix the parser and do not touch Codex auth",
        "Run the Claude integration tests",
        "Use the Codex documentation to explain authentication",
        "Run the Codex integration tests",
        "Use the Claude documentation to explain authentication",
        "Use the Codex app screenshots to explain authentication",
        "Use the Claude CLI logs to explain authentication",
        "Explain why you should never use Codex",
        "Could you explain how to use Claude?",
        "Explain how to use gpt-6-sol",
        "Explain why using Codex is not needed",
        "Explain what model: fable means",
        "Could you explain this function",
        "This is not a high effort task",
        "Run this without a low effort change",
        "Codex 오류를 고치되 인증은 바꾸지 마",
    ]
    for text in ordinaryV2 {
        let parsed = v2(text)
        try check(parsed.state == "resolved" && parsed.allowedSurfaces.isEmpty &&
                  parsed.exactModel == nil && parsed.modelFamily == nil && parsed.effort == nil &&
                  !parsed.requireNativeCeiling && parsed.qualityTarget == nil,
                  "task subject/constraint does not become an execution setting: \(text)")
    }
    let providerV2: [(String, [String])] = [
        ("Use Codex without changing authentication", ["codex"]),
        ("Use Codex now", ["codex"]),
        ("Use Claude today", ["claude", "claude-chat"]),
        ("코덱스 써줘", ["codex"]),
        ("클로드 사용해", ["claude", "claude-chat"]),
        ("Use Codex to fix gpt-6-sol integration", ["codex"]),
        ("Use Codex to compare gpt-6-sol with claude-fable-5-1", ["codex"]),
        ("Use Codex to explain why you should never use Claude", ["codex"]),
        ("Explain this function using Codex", ["codex"]),
        ("Compare these models using Claude", ["claude", "claude-chat"]),
        ("Could you explain this using Codex?", ["codex"]),
        ("Use Codex to explain 최대 리즈닝으로 실행하는 법", ["codex"]),
        ("Use Codex to explain why people use strongest model", ["codex"]),
        ("코덱스로 가격을 설명해줘", ["codex"]),
        ("Use Codex, but do not modify files", ["codex"]),
        ("Could you use Codex to explain this function?", ["codex"]),
        ("I would like you to use Codex to explain this function", ["codex"]),
        ("Use Codex CLI to analyze this function", ["codex"]),
        ("Use the Claude app to explain this function", ["claude", "claude-chat"]),
        ("Would you use Claude to explain this function?", ["claude", "claude-chat"]),
        ("run tests on Claude", ["claude", "claude-chat"]),
        ("run tests on Codex", ["codex"]),
        ("코덱스로 이 함수 설명해줘. 파일 수정은 하지 마", ["codex"]),
        ("클로드로 이 함수 설명해줘. 파일 수정은 하지 마", ["claude", "claude-chat"]),
    ]
    for (text, expected) in providerV2 {
        let parsed = v2(text)
        try check(parsed.state == "resolved" && parsed.allowedSurfaces == expected &&
                  parsed.exactModel == nil && parsed.modelFamily == nil && parsed.effort == nil,
                  "actual execution-target phrase survives unrelated task prohibition: \(text)")
    }
    try check(v2("use opus 5.5 for this").modelFamily == "opus" &&
              v2("opus 5.5로 리뷰해줘").modelFamily == "opus" &&
              v2("opus max").modelFamily == "opus" && v2("opus max").effort == "max",
              "owned family/version/tuple settings retain their original constraints")
    let qualityAboutV2 = v2("Use Codex to explain how maximum reasoning affects output quality")
    try check(qualityAboutV2.state == "resolved" && qualityAboutV2.allowedSurfaces == ["codex"] &&
              qualityAboutV2.effort == nil && !qualityAboutV2.requireNativeCeiling,
              "quality task prose cannot become an owned execution maximum")
    try check(v2("Explain this function, reasoning: high").effort == "high" &&
              v2("Explain this function using gpt-6-sol").exactModel == "gpt-6-sol",
              "postposed assignment/instrument retains its own execution authority beside explanatory task")
    let scopedExactV2 = v2("Use Codex with reasoning: high but do not modify files")
    try check(scopedExactV2.state == "resolved" && scopedExactV2.allowedSurfaces == ["codex"] &&
              scopedExactV2.effort == "high", "unrelated prohibition cannot erase an exact effort pin")
    try check(v2("use gpt-6-sol reasoning:high without changing authentication").exactModel == "gpt-6-sol" &&
              v2("use gpt-6-sol reasoning:high without changing authentication").effort == "high",
              "exact model/effort pins preserve their meaning beside task constraints")
    for text in ["not max reasoning", "Don't use Codex today", "Do not use high reasoning mode", "no max reasoning", "최대 리즈닝 필요 없어", "코덱스 사용하지 마", "클로드로 실행하지 마", "don't use Codex", "never use Claude", "do not run tests on Claude", "don't pick Codex", "Codex 말고 Claude로 설명해줘",
                 "if Codex unavailable use Claude", "I could use Codex", "I would use Claude", "Use Codex if possible to explain this function",
                 "if possible use gpt-6-sol reasoning:high", "reasoning: high if possible"] {
        try check(v2(text).state == "unresolved", "actual negative/conditional routing needs unsupported exclusion/branch semantics: \(text)")
    }
    // Matched positive/negative examples protect explicit constraints while
    // the ordinary cases above prevent fixing only the observed sentence.
    try check(v2("use reasoning: high").effort == "high" &&
              v2("do not use reasoning: high").state == "unresolved",
              "negation of the actual setting still blocks adoption")
    let bareV2 = v2("Codex로 이 함수 설명해줘")
    try check(bareV2.allowedSurfaces == ["codex"] && bareV2.exactModel == nil && bareV2.effort == nil,
              "v2 bare provider constrains surface only")
    let literalV2 = v2("use gpt-6-sol reasoning:high")
    try check(literalV2.exactModel == "gpt-6-sol" && literalV2.effort == "high" && !literalV2.requireNativeCeiling,
              "v2 exact known model and effort remain hard pins")
    try check(v2("Codex로 최대로 실행해").requireNativeCeiling, "v2 generic maximum is native ceiling not max label")
    for text in ["최대 리즈닝으로 실행해", "리즈닝 최대로 실행해", "추론 최대로 실행해"] {
        let parsed = v2(text)
        try check(parsed.state == "resolved" && parsed.requireNativeCeiling && parsed.effort == nil,
                  "same generic-maximum setting remains native ceiling in both term orders: \(text)")
    }
    try check(v2("reasoning: max").effort == "max" && !v2("reasoning: max").requireNativeCeiling,
              "literal max assignment remains distinct from generic native maximum")
    let qualityV2 = v2("결과는 최고 모델 최대 추론 수준과 동등하게 해줘")
    try check(qualityV2.qualityTarget == "current_host_reference" && qualityV2.effort == nil &&
              qualityV2.exactModel == nil && !qualityV2.requireNativeCeiling, "result ceiling does not pin execution")
    try check(v2("match max reasoning result quality").qualityTarget == "current_host_reference" &&
              !v2("match max reasoning result quality").requireNativeCeiling, "max-level result is quality target even without highest word")
    try check(v2("use max reasoning for highest output quality").state == "unresolved", "ambiguous max execution/quality cannot silently become Auto")
    for text in ["if possible use gpt-6-sol reasoning:high", "gpt-6-sol 말고 설명해줘",
                 "\"use gpt-6-sol reasoning:high\"라는 예시를 설명해줘", "Codex xhigh 지원해?"] {
        let parsed = v2(text)
        try check(parsed.exactModel == nil && parsed.effort == nil && !parsed.requireNativeCeiling,
                  "conditional/negation/quoted/inquiry is not an execution pin: \(text)")
    }
    try check(v2("use `gpt-6-sol` reasoning:high").exactModel == "gpt-6-sol", "quoted exact ID in execution directive stays pinned")
    try check(v2("use gpt-6-sol and match highest output quality").state == "unresolved", "mixed same-clause quality/execution cannot erase exact model")
    try check(v2("Codex 말고 Claude로 설명해줘").state == "unresolved", "negative provider cannot become unrestricted route")
    for unknown in ["use model: not-in-inventory", "use reasoning: hyper", "use the strongest model"] {
        try check(v2(unknown).state == "unresolved", "unknown/ambiguous explicit execution pin holds: \(unknown)")
    }
    try check(v2("model: fable for highest output quality").state == "unresolved" &&
              v2("Fable로 최고 품질 결과 만들어").state == "unresolved", "quality wording cannot erase a same-clause model pin")
    for badToken in ["high2", "low_foo", "high-low", "max:low", "ultra/code"] {
        try check(v2("use reasoning: " + badToken).state == "unresolved", "whole unsupported effort token holds: \(badToken)")
    }
    for quotation in ["Explain the phrase \"use gpt-6-sol reasoning:high", "Explain `use gpt-6-sol reasoning:high", "```use gpt-6-sol reasoning:high",
                      "Explain the phrase 'use gpt-6-sol reasoning:high"] {
        try check(v2(quotation).state == "unresolved", "unclosed routing quotation cannot become execution pin")
    }
    try check(v2("Don't overcomplicate this explanation").state == "resolved", "contraction apostrophe is not unmatched quotation")
    try check(v2("use reasoning: high, explain this").effort == "high", "legitimate effort delimiter remains exact")
    try check(v2("use model: fable").exactModel == "fable" && v2("use model: fable").modelFamily == nil,
              "known native alias in explicit model assignment remains exact")
    try check(v2("use gpt-unobserved-new reasoning:high").state == "unresolved", "unknown exact model cannot become family guess")
    try check(v2("클라우드 코드로 설명해줘").allowedSurfaces == ["claude", "claude-chat"], "bounded ASR provider repair only")
    try check(v2("Soul로 설명해줘").modelFamily == nil, "unknown ASR entity does not become Sol")
    try check(v2("최대 추론으로 실행해서 최고 품질 결과를 만들어").state == "unresolved", "ambiguous quality/execution remains unresolved")
    try check(v2("ChatGPT로 보내줘").state == "unresolved", "v2 never resurrects dropped ChatGPT surface")
    try check(v2("use gpt-6-sol; use claude-opus-5-5").state == "unresolved", "conflicting exact model pins hold")
    var migrated = input("Codex로 이 함수 설명해줘", readOnly: true)
    migrated.routingIntentPolicyVersion = C.RoutingIntentV2.version
    try check(B.providersToProbe(migrated).isEmpty, "unactivated marker has zero provider probe eligibility")
    do { _ = try B.build(migrated); throw NSError(domain: "R10", code: 1) }
    catch B.Failure.intentPolicyUnavailable { checks += 1 }
    migrated.enableRoutingIntentV2 = true
    let migratedOutput = try B.build(migrated)
    try check(!migratedOutput.candidates.isEmpty && migratedOutput.intent.isEmpty &&
              migratedOutput.candidates.allSatisfy { ($0["surface"] as? String) == "codex" } &&
              Set(migratedOutput.candidates.compactMap { $0["effort"] as? String }).count > 1,
              "activated bare provider retains model/effort candidates rather than forcing max")
    let migratedWire = try JSONSerialization.jsonObject(with: B.catalogData(migratedOutput,
        taskID: migrated.taskID, requestSHA256: migrated.requestSHA256)) as! [String: Any]
    try check(migratedWire["routing_intent_v2"] != nil && migratedWire["routing_intent"] == nil,
              "v2 catalog marker is separate from legacy object")
    migrated.request = "use gpt-6-sol reasoning:high"; migrated.requestSHA256 = C.digest(Data(migrated.request.utf8))
    let unavailableV2 = try B.build(migrated)
    try check(unavailableV2.candidates.isEmpty && reasons(unavailableV2).contains(where: { $0.contains("explicit_constraint_unavailable") }),
              "unavailable signed tuple is explained hold not model/effort substitution")
    migrated.routingIntentPolicyVersion = "future-v9"
    try check(B.providersToProbe(migrated).isEmpty, "unknown migration version cannot probe")
    migrated.routingIntentPolicyVersion = nil; migrated.enableRoutingIntentV2 = true
    try check(try B.catalogData(B.build(migrated), taskID: migrated.taskID, requestSHA256: migrated.requestSHA256) ==
              B.catalogData(B.build({ var x = migrated; x.enableRoutingIntentV2 = false; return x }()), taskID: migrated.taskID,
                            requestSHA256: migrated.requestSHA256), "host capability alone does not reinterpret legacy request")
    for text in ordinaryV2 {
        var value = input(text, chat: false, readOnly: true)
        value.routingIntentPolicyVersion = C.RoutingIntentV2.version
        value.enableRoutingIntentV2 = true
        let output = try B.build(value)
        try check(!output.candidates.isEmpty && output.intentV2?.state == "resolved" &&
                  Set(output.candidates.compactMap { $0["surface"] as? String }) == ["codex", "claude"],
                  "activated ordinary Auto retains both native providers instead of holding or false pinning: \(text)")
    }
    for text in ["don't use Codex", "if Codex unavailable use Claude", "use gpt-unobserved-new reasoning:high"] {
        var value = input(text, chat: false, readOnly: true)
        value.routingIntentPolicyVersion = C.RoutingIntentV2.version
        value.enableRoutingIntentV2 = true
        do { _ = try B.build(value); throw NSError(domain: "R10Scope", code: 1) }
        catch B.Failure.intentUnresolved { checks += 1 }
    }
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

/// What the real JS resolver binds for one host node (read-only unless
/// `scope` says workspace_write) on exactly these catalog bytes, by the one
/// admission law (build 407): "reference" with no certifying source,
/// "certified" with a registered sound_full node verifier that applies to the
/// node (R0 (b), K4). Returns "pool/model/effort/route_kind", then ">model" of its
/// escalation reference when it has one, or "error:<code>".
private func javascriptRoute(_ catalog: Data, admission: String = "reference", now: Date,
                             scope: String = "read_only", explicitRoutes: [String]? = nil, routeIndex: Int = 0) throws -> String {
    let script = """
    import {pathToFileURL} from 'node:url';
    import {readFileSync} from 'node:fs';
    const {resolveRoutePlan,registerNodeVerifiers}=await import(pathToFileURL(process.argv[1]).href);
    const catalog=JSON.parse(readFileSync(0,'utf8'));
    const write=process.argv[4]==='workspace_write';
    const explicit=JSON.parse(process.argv[5]), ordinal=Number(process.argv[6]);
    const id=explicit?'requested-'+(ordinal+1):'n';
    const instruction=explicit?'Explain the login function':write?'Fix the login bug in Sources/App.swift':'Explain the login function';
    const task={mode:explicit?'explicit_routing_test':'auto',task_id:catalog.task_id,request_sha256:catalog.request_sha256,budget:{max_cost_units:null},
      host_context:{require_read_only:!write,...(explicit?{explicit_routes:explicit.map(surface=>({surface,instruction}))}:{})}};
    const plan={schema:1,task_id:catalog.task_id,request_sha256:catalog.request_sha256,nodes:[{id,
      instruction,dependencies:[],kind:'agent',scope:process.argv[4],owned_paths:write?['Sources/App.swift']:[],context_refs:[]}]};
    const verifierRegistry=process.argv[3]==='certified'?await registerNodeVerifiers(new Map([['fixture-sound',
      {id:'fixture-sound',scope:'read_only',surfaces:['agent','chat'],soundness:'sound_full',applies:()=>true,
        refutations:[{instruction:'Explain the login function',output:'fixture wrong answer'}],
        verify:async input=>({passed:input.output==='fixture answer',reason:'fixture'})}]])):null;
    try {
      const d=resolveRoutePlan(plan,task,catalog,Number(process.argv[2]),{verifierRegistry}).decisions[id];
      process.stdout.write(`${d.quota_pool}/${d.model}/${d.effort}/${d.reason.split(';')[1]}`+
        (d.ladder?.reference_model?'>'+d.ladder.reference_model:''));
    } catch (error) { process.stdout.write('error:'+(error.code??'unknown')); }
    """
    let surfaces = explicitRoutes.map { String(decoding: try! JSONSerialization.data(withJSONObject: $0), as: UTF8.self) } ?? "null"
    return try javascriptModule(script, arguments: [String(Int64(now.timeIntervalSince1970 * 1000)), admission, scope,
                                                   surfaces, String(routeIndex)], input: catalog)
}

/// What the real JS host plan and admission law bind for every node of one
/// request on exactly these catalog bytes (build 407: hostPlan, then
/// resolveRoutePlan with no certifying source): "<request_class>|<node>=
/// <surface>/<model>/<effort>/<scope>/<admission token>,...", or "error:<code>".
private func javascriptHostRoute(_ catalog: Data, request: String, now: Date, write: Bool, material: Bool,
                                 explicit: [String]?) throws -> String {
    let script = """
    import {pathToFileURL} from 'node:url';
    import {readFileSync} from 'node:fs';
    const {hostPlan,resolveRoutePlan}=await import(pathToFileURL(process.argv[1]).href);
    const catalog=JSON.parse(readFileSync(0,'utf8'));
    const [now,request,write,material,explicit]=[Number(process.argv[2]),process.argv[3],process.argv[4]==='1',
      process.argv[5]==='1',JSON.parse(process.argv[6])];
    const routes=explicit?explicit.map((surface,index)=>({surface,instruction:'route '+(index+1)+': '+request})):null;
    const task={mode:routes?'explicit_routing_test':'auto',task_id:catalog.task_id,request,request_sha256:catalog.request_sha256,
      material_refs:material?['material-1']:[],budget:{max_cost_units:null},
      host_context:{require_read_only:!write,...(routes?{explicit_routes:routes}:{})}};
    try {
      const plan=hostPlan(task,catalog);
      const resolved=resolveRoutePlan(plan,task,catalog,now);
      process.stdout.write(catalog.request_class+'|'+resolved.plan.nodes.map(node=>{const d=resolved.decisions[node.id];
        return `${node.id}=${d.surface}/${d.model}/${d.effort}/${node.scope}/`+d.reason.split(';').find(x=>x.startsWith('admitted_'));}).join(','));
    } catch (error) { process.stdout.write('error:'+(error.code??'unknown')); }
    """
    let routes = explicit.map { String(decoding: try! JSONSerialization.data(withJSONObject: $0), as: UTF8.self) } ?? "null"
    return try javascriptModule(script, arguments: [String(Int64(now.timeIntervalSince1970 * 1000)), request,
                                                   write ? "1" : "0", material ? "1" : "0", routes], input: catalog)
}

/// Runs one inline ES module against the sealed runtime module path (a real
/// Node import; no runtime, adapter or provider is started).
private func javascriptModule(_ script: String, arguments: [String] = [], input bytes: Data) throws -> String {
    let runtimeModule = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Resources/openclaw-os1-bridge/rcc-runtime.mjs")
    let pinnedNode = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/share/node-v24.20.0/bin/node")
    let process = Process(), input = Pipe(), output = Pipe(), errors = Pipe()
    if let override = ProcessInfo.processInfo.environment["OS1_RCC_CONTRACT_NODE"] { process.executableURL = URL(fileURLWithPath: override) }
    else if FileManager.default.isExecutableFile(atPath: pinnedNode.path) { process.executableURL = pinnedNode }
    else { process.executableURL = URL(fileURLWithPath: "/usr/bin/env") }
    process.arguments = (process.executableURL?.path == "/usr/bin/env" ? ["node"] : []) +
        ["--input-type=module", "-e", script, runtimeModule.path] + arguments
    process.standardInput = input; process.standardOutput = output; process.standardError = errors
    try process.run(); try input.fileHandleForWriting.write(contentsOf: bytes); try input.fileHandleForWriting.close()
    let text = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    _ = errors.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
    return process.terminationStatus == 0 ? text : ""
}

/// The JS runtime's own fingerprint for canonical host bytes (a real Node
/// import of the sealed module; no runtime, adapter or provider is started).
private func javascriptHostFingerprint(_ bytes: Data) throws -> String {
    try javascriptModule("""
    import {pathToFileURL} from 'node:url';
    import {readFileSync} from 'node:fs';
    const {hostContextFingerprint}=await import(pathToFileURL(process.argv[1]).href);
    process.stdout.write(hostContextFingerprint(JSON.parse(readFileSync(0,'utf8'))));
    """, input: bytes)
}
