import Foundation
import OS1Context

/// Build 441 part 2 (owner order 2026-10-27): the local request classifier and
/// its combination under the keyword rails. Offline: a fake inventory and a
/// fake local transport; no Ollama, provider, network or real HOME.
func runLocalRequestClassifierFixtures() throws {
    typealias L = LocalRequestClassifier
    typealias P = RequestProfile
    var checks = 0
    func check(_ pass: Bool, _ label: String) throws {
        guard pass else { throw NSError(domain: "LocalRequestClassifierFixture", code: 1, userInfo: [NSLocalizedDescriptionKey: label]) }
        checks += 1
    }
    /// Runs one async classification to completion from this synchronous runner.
    func run(_ work: @escaping @Sendable () async -> L.Receipt) -> L.Receipt {
        final class Box: @unchecked Sendable { var value: L.Receipt? }
        let box = Box(), done = DispatchSemaphore(value: 0)
        Task.detached { box.value = await work(); done.signal() }
        done.wait()
        return box.value!
    }
    func answer(_ task: L.TaskType, _ difficulty: L.Difficulty, _ tools: L.ToolNeed) -> L.Answer {
        .init(taskType: task, difficulty: difficulty, needsTools: tools)
    }
    func keyword(_ text: String, shell: Bool = false, material: Bool = false) -> P {
        P.classify(text, shellNeed: shell, hasMaterial: material)
    }
    func combined(_ text: String, _ local: L.Answer?, shell: Bool = false, model: String = "qwen3.5:9b") -> P {
        P.combine(keyword: keyword(text, shell: shell), request: text, local: local, model: local == nil ? nil : model)
    }

    // ---- The prompt, schema and settings are the measured ones (cls.py).
    try check(L.systemPrompt.hasPrefix("You classify one user request for an AI router. Reply with JSON only.\ntask_type: explain") &&
              L.systemPrompt.contains("'쉐딩과 방정식' = Schrödinger equation") && L.systemPrompt.contains("'QMGR' = QM + GR"),
              "the measured system prompt, with the speech-to-text misspelling hint")
    let schema = try JSONSerialization.jsonObject(with: Data(L.schemaJSON.utf8)) as? [String: Any]
    try check((schema?["required"] as? [String]) == ["task_type", "difficulty", "needs_tools"] &&
              L.schemaJSON.range(of: "task_type")!.lowerBound < L.schemaJSON.range(of: "difficulty")!.lowerBound,
              "the schema fills task_type, difficulty, needs_tools in that order")
    try check(L.preferredModels == ["qwen3.5:9b", "qwen3.5:4b"] && L.timeout == 12 && L.keepAlive == "30m",
              "9B first, else 4B; a 12 s bound; resident 30 minutes")
    try check(L.choose(installed: ["qwen3.5:4b", "qwen3.5:9b"]) == "qwen3.5:9b" &&
              L.choose(installed: ["qwen3.5:4b", "llama3:8b"]) == "qwen3.5:4b" && L.choose(installed: ["llama3:8b"]) == nil,
              "the model: 9B when installed, else 4B, never another model")
    try check(L.boundedRequest("  x  ") == "x" && L.boundedRequest(String(repeating: "가", count: 5000)).count == L.maximumRequestCharacters,
              "the request the model sees is trimmed and bounded")

    // ---- Strict decode: exactly the schema, nothing else.
    try check(L.decode(#"{"task_type":"design","difficulty":"deep","needs_tools":"none"}"#) == answer(.design, .deep, .none),
              "an on-schema answer decodes")
    for bad in [#"{"task_type":"design","difficulty":"deep"}"#, #"{"task_type":"poem","difficulty":"deep","needs_tools":"none"}"#,
                #"{"task_type":"design","difficulty":"deep","needs_tools":"none","why":"x"}"#,
                #"{"task_type":"design","difficulty":"hard","needs_tools":"none"}"#, "design deep none", "",
                #"{"task_type":1,"difficulty":"deep","needs_tools":"none"}"#] {
        try check(L.decode(bad) == nil, "off-schema answer refused: \(bad)")
    }

    // ---- The call: fake inventory and transport.
    let installed: L.Inventory = { ["qwen3.5:4b", "qwen3.5:9b"] }
    final class Seen: @unchecked Sendable { var model: String?; var system: String?; var text: String? }
    let seen = Seen()
    let ok = run {
        await L.classify("QMGR 통합하게 스키마 좀 짜봐", inventory: installed, ask: { model in
            { system, text in seen.model = model; seen.system = system; seen.text = text
                return #"{"task_type":"design","difficulty":"deep","needs_tools":"none"}"# } })
    }
    try check(ok.outcome == "adopted" && ok.model == "qwen3.5:9b" && ok.answer == answer(.design, .deep, .none) &&
              ok.adopted != nil && seen.model == "qwen3.5:9b" && seen.system == L.systemPrompt &&
              seen.text == "QMGR 통합하게 스키마 좀 짜봐", "the 9B model reads QMGR as design/deep: \(ok)")
    let down = run { await L.classify("anything", inventory: { nil }, ask: { _ in { _, _ in "never" } }) }
    try check(down.outcome == "ollama_unavailable" && down.answer == nil && down.adopted == nil && down.latencyMS < 1_000,
              "Ollama down: no classification, at once")
    let absent = run { await L.classify("anything", inventory: { ["llama3:8b"] }, ask: { _ in { _, _ in "never" } }) }
    try check(absent.outcome == "model_absent" && absent.adopted == nil, "neither model installed: no classification")
    let offSchema = run { await L.classify("anything", inventory: installed, ask: { _ in { _, _ in "design deep" } }) }
    try check(offSchema.outcome == "schema_mismatch" && offSchema.adopted == nil, "off-schema: no classification")
    let transport = run {
        await L.classify("anything", inventory: installed, ask: { _ in { _, _ in throw RoutingOrderInterpreter.Failure.transport("connection") } })
    }
    try check(transport.outcome == "model_transport:connection" && transport.adopted == nil, "a transport error: no classification")
    let notReady = run {
        await L.classify("anything", inventory: installed, ask: { _ in { _, _ in throw RoutingOrderInterpreter.Failure.modelNotReady } })
    }
    try check(notReady.outcome == "model_not_ready", "a 404 model: no classification")
    let started = Date()
    let slow = run {
        await L.classify("anything", timeout: 0.3, inventory: installed, ask: { _ in { _, _ in
            try await Task.sleep(nanoseconds: 5_000_000_000); return "late" } })
    }
    try check(slow.outcome == "model_timeout" && slow.adopted == nil && Date().timeIntervalSince(started) < 2,
              "the hard bound stops a slow model: \(slow)")
    let empty = run { await L.classify("   ", inventory: installed, ask: { _ in { _, _ in "never" } }) }
    try check(empty.outcome == "empty_request", "an empty request is not asked")

    // ---- One reading per task: the private store.
    let home = FileManager.default.temporaryDirectory.appendingPathComponent("os1-cls-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: home) }
    let directory = L.cacheDirectory(home: home)
    let key = L.cacheKey(taskID: "task-1", requestSHA256: String(repeating: "a", count: 64))
    try check(key.count == 64 && key != L.cacheKey(taskID: "task-2", requestSHA256: String(repeating: "a", count: 64)),
              "the key binds the task, the request and the prompt version")
    try check(L.cachedReceipt(key: key, directory: directory) == nil, "nothing stored yet")
    L.store(ok, key: key, directory: directory)
    try check(L.cachedReceipt(key: key, directory: directory) == ok, "the stored reading is reused")
    let stored = try String(contentsOf: directory.appendingPathComponent(key + ".json"), encoding: .utf8)
    try check(!stored.contains("QMGR") && stored.contains("\"outcome\":\"adopted\""), "the store keeps the receipt, never the request")
    let mode = (try FileManager.default.attributesOfItem(atPath: directory.appendingPathComponent(key + ".json").path)[.posixPermissions]
                as? NSNumber)?.intValue ?? 0
    let directoryMode = (try FileManager.default.attributesOfItem(atPath: directory.path)[.posixPermissions] as? NSNumber)?.intValue ?? 0
    try check(mode == 0o600 && directoryMode == 0o700, "owner-only file and directory")
    try check(L.cachedReceipt(key: key, directory: directory, now: Date().addingTimeInterval(25 * 3600)) == nil,
              "a day-old reading is not reused")
    L.store(down, key: key, directory: directory)
    try check(L.cachedReceipt(key: key, directory: directory)?.outcome == "ollama_unavailable",
              "a failed first reading is kept too: the whole task routes on the keyword profile")
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: directory.appendingPathComponent(key + ".json").path)
    try check(L.cachedReceipt(key: key, directory: directory) == nil, "a group- or world-readable receipt is not trusted")

    // ---- The combination: rails first, the local reading for everything else.
    // The owner's six questions (DESIGN-2 evidence) as the local model read them.
    let schrodinger = combined("쉐딩과 방정식 설명해 봐봐", answer(.explain, .standard, .none))
    try check(schrodinger.answerKind == .answerOnly && schrodinger.toolNeed == .none && schrodinger.difficulty == .standard &&
              schrodinger.taskType == .explain && schrodinger.classifier == "local_llm:qwen3.5:9b" && schrodinger.valid &&
              schrodinger.gradable, "an explanation: explain/standard, local provenance: \(schrodinger)")
    let greeting = combined("안녕! 좋은 아침이야", answer(.chat, .light, .none))
    try check(greeting.answersLocally && greeting.valid && keyword("안녕! 좋은 아침이야").answerKind == .unknown &&
              keyword("안녕! 좋은 아침이야").signals.isEmpty, "small talk the keywords could not read is very easy chat: \(greeting)")
    // The owner's invitation reads as a status check-in (a workspace rail):
    // the status card and the build-440 owner decision answer it, not the local model.
    let invitation = combined("자 이제 네가 얼마나 잘 되는지 보자", answer(.chat, .light, .none))
    try check(!invitation.answersLocally && invitation.toolNeed == .workspace && invitation.signals.contains("status_check_in") &&
              P.railsDecide(keyword("자 이제 네가 얼마나 잘 되는지 보자"), request: "자 이제 네가 얼마나 잘 되는지 보자"),
              "the invitation is a status check-in: its rail decides: \(invitation)")
    let qmgr = keyword("QMGR 통합하게 스키마 좀 짜봐")
    try check(P.railsDecide(qmgr, request: "QMGR 통합하게 스키마 좀 짜봐") &&
              combined("QMGR 통합하게 스키마 좀 짜봐", answer(.design, .deep, .none)).answerKind == .work,
              "QMGR: an order rail already keeps the reference; the local reading only names it design")
    let rate = combined("오늘 원달러 환율 설명해줘", answer(.explain, .standard, .none))
    try check(rate.toolNeed == .currentFacts && rate.answersReadOnly && !rate.answersWithoutTools &&
              rate.signals.contains("rail_overrules_llm"), "today's rate stays current facts whatever the model says: \(rate)")
    // Rails beat the local model (it reads each of these as a tool-free answer).
    for (text, shell, expect) in [("README.md 설명해줘", false, P.ToolNeed.workspace),
                                  ("슈뢰딩거 방정식 설명 정리해서 노션에 올려줘", false, nil),
                                  ("빌드해줘", true, nil), ("오늘 환율 알려줘", false, P.ToolNeed.currentFacts)] as [(String, Bool, P.ToolNeed?)] {
        for local in [answer(.explain, .standard, .none), answer(.chat, .light, .none)] {
            let value = combined(text, local, shell: shell)
            try check(!value.answersWithoutTools && !value.answersLocally && value.valid &&
                      (expect == nil ? value.answerKind == .work : value.toolNeed == expect),
                      "a rail stands against the local reading: \(text) -> \(value)")
        }
    }
    // The local model may raise, never lower.
    let raisedFacts = combined("엔트로피 설명해줘", answer(.explain, .standard, .currentFacts))
    try check(raisedFacts.toolNeed == .currentFacts && raisedFacts.signals.contains("llm_raised_tools"), "it may raise to current facts")
    let raisedWork = combined("엔트로피 설명해줘", answer(.explain, .standard, .execution))
    try check(raisedWork.answerKind == .work && raisedWork.taskType == .action && raisedWork.signals.contains("llm_raised_work"),
              "it may raise to work")
    // Measured 2026-10-27 (real run): the 9B model labelled "오늘 환율 알려줘" and
    // "지금 비트코인 시세 알려줘" action/light/current_facts. Only the tool need
    // raises to work; an action label with no execution need is an answer.
    let actionLookup = combined("지금 비트코인 시세 알려줘", answer(.action, .light, .currentFacts))
    try check(actionLookup.answerKind == .answerOnly && actionLookup.taskType == .explain &&
              actionLookup.toolNeed == .currentFacts && actionLookup.answersReadOnly &&
              actionLookup.signals.contains("llm_action_without_execution") && actionLookup.valid,
              "an action label without an execution need reads as a current-facts answer: \(actionLookup)")
    let actionAnswer = combined("엔트로피 설명해줘", answer(.action, .standard, .none))
    try check(actionAnswer.gradable && actionAnswer.taskType == .explain, "an action label with no tool need is an answer")
    let raisedSpace = combined("엔트로피 설명해줘", answer(.explain, .standard, .workspace))
    try check(raisedSpace.toolNeed == .workspace && !raisedSpace.gradable, "it may raise to a workspace need")
    let lowered = combined("슈뢰딩거 방정식을 엄밀하게 유도해줘", answer(.explain, .standard, .none))
    try check(lowered.difficulty == .standard && lowered.signals.contains("llm_sets_difficulty"),
              "the difficulty is the local reading's (a topic word is not a task shape)")
    let strongest = combined("신중하게 생각하고 엔트로피 설명해줘", answer(.explain, .standard, .none))
    try check(strongest.difficulty == .deep && strongest.signals.contains("quality_request") &&
              P.railsDecide(keyword("신중하게 생각하고 엔트로피 설명해줘"), request: "신중하게 생각하고 엔트로피 설명해줘"),
              "the owner asking for the strongest model stays deep (owner words): \(strongest)")
    for text in ["다음 문장을 영어로 번역해줘: 고양이가 귀엽다", "다음 문장을 영문으로 번역해줘: 내일 회의를 오후 3시로 옮겨도 될까요?"] {
        let translation = combined(text, answer(.explain, .light, .none))
        try check(translation.taskType == .write && translation.answerKind != .answerOnly && translation.valid &&
                  P.railsDecide(keyword(text), request: text), "a text operation stays a write task: \(translation)")
    }
    // Without a local reading: the keyword profile; a keyword unknown with no
    // rail is an answer at standard, never the reference for that alone.
    let fallback = combined("안녕! 좋은 아침이야", nil)
    try check(fallback.answerKind == .answerOnly && fallback.toolNeed == .none && fallback.difficulty == .standard &&
              fallback.taskType == .explain && fallback.classifier == P.keywordClassifier &&
              fallback.signals.contains("keyword_unknown_default") && fallback.valid && !fallback.answersLocally,
              "LLM down: keyword fallback, unknown-no-rail reads as an answer at standard: \(fallback)")
    let keywordAnswer = combined("슈뢰딩거 방정식 설명해봐", nil)
    try check(keywordAnswer.gradable && keywordAnswer.classifier == "keyword_v1" && keywordAnswer.taskType == .explain,
              "LLM down: the keyword answer profile, task explain")
    for text in ["빌드해줘", "README.md 설명해줘", "그럼 실제로 해봐", "오늘 환율 알려줘"] {
        let shell = text == "빌드해줘"
        try check(combined(text, nil, shell: shell).valid && !combined(text, nil, shell: shell).gradable, "LLM down: a rail stays: \(text)")
    }
    // Wire: both or neither, strictly checked; Codable round trip.
    var broken = schrodinger; broken.taskType = nil
    try check(!broken.valid, "a classifier without a task type is invalid")
    broken = schrodinger; broken.classifier = "gpt:remote"
    try check(!broken.valid, "an unknown classifier is invalid")
    broken = schrodinger; broken.taskType = .action
    try check(!broken.valid, "an answer is never an action task")
    let encoded = try JSONEncoder().encode(schrodinger)
    try check(try JSONDecoder().decode(P.self, from: encoded) == schrodinger &&
              String(decoding: encoded, as: UTF8.self).contains("\"task_type\":\"explain\""), "the combined profile round-trips")
    let legacyEncoded = try JSONEncoder().encode(keyword("슈뢰딩거 방정식 설명해봐"))
    try check(!String(decoding: legacyEncoded, as: UTF8.self).contains("classifier"), "a keyword-only profile carries neither key")
    print("Local request classifier fixtures: \(checks) checks OK; model calls 0")
}
