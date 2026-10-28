import CryptoKit
import Foundation

/// Build 441 part 2 (owner order 2026-10-27): the owner's request read by the
/// LOCAL model. It is free (no subscription quota) and it was installed for
/// this job. The keyword `RequestProfile` cannot read "QMGR 통합하게 스키마 좀
/// 짜봐" (unify QM and GR: a deep theory-design task); a small local model
/// can, and its reading is combined UNDER the keyword rails
/// (`RequestProfile.combine`): it can raise a rail, never lower one.
///
/// The model proposes three enums; code decides. An answer off the schema, a
/// timeout, a transport error, a missing model or Ollama being down is "no
/// local classification": the catalog then carries the keyword profile.
///
/// Transport: the one OS-1 Ollama client (`RoutingOrderInterpreter.ollamaAsk`,
/// loopback only, no proxy, no streaming), with think off, temperature 0,
/// seed 7, this schema as the output format, a bounded answer and
/// `keep_alive` 30m so the model stays resident between owner requests.
/// Model: `qwen3.5:9b` when the loopback inventory lists it, else
/// `qwen3.5:4b` (the model OpenClaw already runs); nothing else.
public enum LocalRequestClassifier {
    /// Preference order; the first one the live inventory lists is asked.
    public static let preferredModels = ["qwen3.5:9b", "qwen3.5:4b"]
    /// The hard bound on the classification call, the host's inventory read
    /// (at most `inventoryTimeout`) included. Measured 2026-10-27 on this Mac with
    /// /Users/LUA/Documents/Codex/artifacts/OS1_ROUTING_20261027/cls.py: warm
    /// 4B about 4 s and warm 9B about 6 s; cold (first load) 10-16 s. 12 s
    /// admits a warm 9B answer at twice its measured time on a loaded Mac and
    /// stops a cold load short: the host then routes on the keyword profile
    /// instead of holding the owner's request. It runs beside the catalog's
    /// provider probes (4-6 s), so a warm answer adds about 0-2 s and the
    /// worst case adds at most 12 s minus the probes.
    public static let timeout: TimeInterval = 12
    public static let inventoryTimeout: TimeInterval = 1.5
    /// Model residency between requests (Ollama `keep_alive`).
    public static let keepAlive = "30m"
    /// Output bound: a compact answer is about 25 tokens.
    public static let maximumAnswerTokens = 64
    /// The request text the model sees (characters); the rest never changes
    /// a three-enum reading and only costs latency.
    public static let maximumRequestCharacters = 2_000
    /// Bumped whenever the prompt or schema changes (cache key, receipts).
    public static let promptVersion = "local_cls_v1"
    public static let chatEndpoint = RoutingOrderInterpreter.endpoint

    /// The system prompt measured on 2026-10-27 (cls.py), byte for byte,
    /// including the speech-to-text misspelling hint.
    public static let systemPrompt = "You classify one user request for an AI router. Reply with JSON only.\n" +
        "task_type: explain (explain/answer a question), design (design a theory, system, schema, architecture, proof, derivation, research-level reasoning), " +
        "write (produce a deliverable: essay, email, document, code, website), action (change files, run, build, deploy, send), chat (greeting/small talk/status).\n" +
        "difficulty: light (short factual/definitional), standard (normal explanation), deep (hard, open-ended, research-level, multi-step design or proof).\n" +
        "needs_tools: none, current_facts (needs today's/latest info), workspace (needs the user's files/projects/earlier results), execution (must run or change something).\n" +
        "The request may be speech-to-text with misspellings (e.g. '쉐딩과 방정식' = Schrödinger equation, '백프로' = backprop, 'QMGR' = QM + GR)."
    /// Ollama structured output; property order is fill order (sent byte for byte).
    public static let schemaJSON = #"{"type":"object","properties":{"task_type":{"type":"string","enum":["explain","design","write","action","chat"]},"difficulty":{"type":"string","enum":["light","standard","deep"]},"needs_tools":{"type":"string","enum":["none","current_facts","workspace","execution"]}},"required":["task_type","difficulty","needs_tools"]}"#

    public enum TaskType: String, Codable, Sendable, CaseIterable { case chat, explain, design, write, action }
    public enum Difficulty: String, Codable, Sendable, CaseIterable { case light, standard, deep }
    public enum ToolNeed: String, Codable, Sendable, CaseIterable {
        case none, currentFacts = "current_facts", workspace, execution
    }
    public struct Answer: Codable, Equatable, Sendable {
        public var taskType: TaskType
        public var difficulty: Difficulty
        public var needsTools: ToolNeed
        public init(taskType: TaskType, difficulty: Difficulty, needsTools: ToolNeed) {
            self.taskType = taskType; self.difficulty = difficulty; self.needsTools = needsTools
        }
        enum CodingKeys: String, CodingKey { case difficulty, taskType = "task_type", needsTools = "needs_tools" }
    }

    /// The answer only when it is exactly the schema: the three keys, no other
    /// key, each value one of its enums, bounded bytes.
    public static func decode(_ text: String) -> Answer? {
        let data = Data(text.utf8)
        guard data.count <= 1_024, let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == ["task_type", "difficulty", "needs_tools"],
              let task = (object["task_type"] as? String).flatMap(TaskType.init(rawValue:)),
              let difficulty = (object["difficulty"] as? String).flatMap(Difficulty.init(rawValue:)),
              let tools = (object["needs_tools"] as? String).flatMap(ToolNeed.init(rawValue:)) else { return nil }
        return Answer(taskType: task, difficulty: difficulty, needsTools: tools)
    }

    /// A model name the profile's `local_llm:<model>` provenance may carry.
    public static func validModelName(_ model: String) -> Bool {
        model.range(of: #"^[a-z0-9][a-z0-9._:-]{0,63}$"#, options: .regularExpression) != nil
    }
    /// The model to ask: the first preferred model the inventory lists.
    public static func choose(installed: [String]) -> String? {
        preferredModels.first { installed.contains($0) }
    }
    /// The owner's request as the model sees it: trimmed and bounded.
    public static func boundedRequest(_ request: String) -> String {
        String(request.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maximumRequestCharacters))
    }

    /// What the host records (a private stderr receipt line), never the text.
    public struct Receipt: Codable, Equatable, Sendable {
        public var model: String?
        public var answer: Answer?
        /// "adopted", or why no local classification was used.
        public var outcome: String
        public var latencyMS: Int
        public var promptVersion: String
        public init(model: String?, answer: Answer?, outcome: String, latencyMS: Int,
                    promptVersion: String = LocalRequestClassifier.promptVersion) {
            self.model = model; self.answer = answer; self.outcome = outcome; self.latencyMS = latencyMS
            self.promptVersion = promptVersion
        }
        enum CodingKeys: String, CodingKey {
            case model, answer, outcome, latencyMS = "latency_ms", promptVersion = "prompt_version"
        }
        /// The adopted reading, or nil.
        public var adopted: (answer: Answer, model: String)? {
            guard outcome == "adopted", let answer, let model else { return nil }
            return (answer, model)
        }
        /// One private log line: model, outcome, enums, latency.
        public var publicLine: String {
            "local classifier \(model ?? "none") \(outcome)" +
                (answer.map { " \($0.taskType.rawValue)/\($0.difficulty.rawValue)/\($0.needsTools.rawValue)" } ?? "") +
                " \(latencyMS) ms (\(promptVersion))"
        }
    }

    /// The installed model names, or nil when the loopback Ollama does not
    /// answer (fail fast: a refused connection returns at once).
    public typealias Inventory = @Sendable () async -> [String]?
    /// The classification call for one chosen model.
    public typealias AskFor = @Sendable (_ model: String) -> RoutingOrderInterpreter.Ask

    /// The live classification call (the shared Ollama client).
    public static func ollamaAsk(endpoint: URL = chatEndpoint) -> AskFor {
        { model in
            RoutingOrderInterpreter.ollamaAsk(endpoint: endpoint, model: model, timeout: timeout, schema: schemaJSON,
                                              maximumTokens: maximumAnswerTokens, keepAlive: keepAlive)
        }
    }

    /// Inventory, choose, ask (bounded by `timeout` overall), decode. Never
    /// throws: every failure is a receipt with no answer.
    /// `inventory` is the host's loopback inventory read
    /// (`LocalRouterBridge.installedModelNames`); `ask` the shared client.
    public static func classify(_ request: String, timeout: TimeInterval = timeout,
                                inventory: @escaping Inventory,
                                ask: @escaping AskFor = ollamaAsk()) async -> Receipt {
        let started = Date()
        func elapsed() -> Int { max(0, Int(Date().timeIntervalSince(started) * 1000)) }
        let text = boundedRequest(request)
        guard !text.isEmpty else { return Receipt(model: nil, answer: nil, outcome: "empty_request", latencyMS: 0) }
        guard let installed = await inventory() else {
            return Receipt(model: nil, answer: nil, outcome: "ollama_unavailable", latencyMS: elapsed())
        }
        guard let model = choose(installed: installed) else {
            return Receipt(model: nil, answer: nil, outcome: "model_absent", latencyMS: elapsed())
        }
        let remaining = timeout - Date().timeIntervalSince(started)
        guard remaining > 0 else { return Receipt(model: model, answer: nil, outcome: "model_timeout", latencyMS: elapsed()) }
        let call = ask(model)
        let raw: String
        do { raw = try await RoutingOrderInterpreter.bounded(remaining) { try await call(systemPrompt, text) } }
        catch {
            let reason: String
            switch error as? RoutingOrderInterpreter.Failure {
            case .timeout?: reason = "model_timeout"
            case .modelNotReady?: reason = "model_not_ready"
            case .transport(let detail)?: reason = "model_transport:" + detail
            case nil: reason = "model_error"
            }
            return Receipt(model: model, answer: nil, outcome: reason, latencyMS: elapsed())
        }
        guard let answer = decode(raw) else {
            return Receipt(model: model, answer: nil, outcome: "schema_mismatch", latencyMS: elapsed())
        }
        return Receipt(model: model, answer: answer, outcome: "adopted", latencyMS: elapsed())
    }

    // MARK: Kept warm (build 441 part 3, lead decision 2026-10-27)
    //
    // A cold classifier (first load, 10-16 s) misses the 12 s bound and the
    // request routes on the keyword profile, whose soft rails then send it to
    // the reference. The running App's existing idle poll (the frontier
    // monitor's, every 5 minutes; no new loop) keeps the classifier model
    // resident while the owner uses OS-1: when nothing runs, memory pressure
    // is normal, and the owner sent a request (or opened the App) within
    // `warmActivityWindow`, it loads the model if `/api/ps` does not list it,
    // or extends its residency when it would expire within
    // `warmRefreshMargin`; one tiny no-generation request, never a prompt.
    //
    // Memory, measured 2026-10-27 on this 16 GB Mac (Ollama 0.35.1): the 9B
    // classifier holds 5.63 GB resident at its 4096-token context and
    // OpenClaw's 4B 4.35 GB at its 32768-token context; Ollama would not keep
    // both (loading either one evicted the other), with about 10.5 GB of swap
    // already in use. So the default keeps the 9B warm only inside the
    // owner's activity window and never under memory pressure; outside it the
    // model unloads `keepAlive` after its last use. An evicting OpenClaw call
    // (an explicit local route, a local chat answer) costs the next
    // classification one reload (about 4-5 s from the page cache), which the
    // 12 s bound still admits.

    /// The owner activity that keeps the classifier warm.
    public static let warmActivityWindow: TimeInterval = 2 * 3600
    /// Residency left below which the poll extends it (twice the 5-minute poll).
    public static let warmRefreshMargin: TimeInterval = 10 * 60

    /// What the poll does this time, and why.
    public enum WarmDecision: Equatable, Sendable {
        case skip(String)
        case load(model: String, refresh: Bool)
    }
    /// The host facts alone: why no load may happen now, or nil.
    static func warmGate(idle: Bool, memoryPressure: RunAdmission.MemoryPressure, lastOwnerActivity: Date?,
                         now: Date) -> String? {
        guard idle else { return "busy" }
        guard memoryPressure == .normal else { return "memory_pressure" }
        guard let activity = lastOwnerActivity, now >= activity, now.timeIntervalSince(activity) <= warmActivityWindow else {
            return "owner_inactive"
        }
        return nil
    }
    /// The pure decision: nothing runs, normal memory pressure, the owner
    /// active within the window, an installed classifier model, and that model
    /// not resident for at least `warmRefreshMargin` more.
    public static func warmDecision(idle: Bool, memoryPressure: RunAdmission.MemoryPressure, lastOwnerActivity: Date?,
                                    installed: [String]?, loaded: [RoutingOrderInterpreter.LoadedModel]?,
                                    now: Date = Date()) -> WarmDecision {
        if let reason = warmGate(idle: idle, memoryPressure: memoryPressure, lastOwnerActivity: lastOwnerActivity, now: now) {
            return .skip(reason)
        }
        guard let installed, let loaded else { return .skip("ollama_unavailable") }
        guard let model = choose(installed: installed) else { return .skip("model_absent") }
        guard let resident = loaded.first(where: { $0.name == model }) else { return .load(model: model, refresh: false) }
        if let expiry = resident.expiresAt, expiry.timeIntervalSince(now) > warmRefreshMargin { return .skip("warm") }
        return .load(model: model, refresh: true)
    }

    /// One receipt line for the App's private log: the decision and, for a
    /// load, whether Ollama answered and how long it took.
    public struct WarmReceipt: Equatable, Sendable {
        public var decision: WarmDecision
        public var loaded: Bool?
        public var latencyMS: Int
        public var publicLine: String {
            switch decision {
            case .skip(let reason): return "local classifier warm: skip \(reason)"
            case .load(let model, let refresh):
                return "local classifier warm: \(refresh ? "refresh" : "load") \(model) " +
                    "\(loaded == true ? "ok" : "failed") \(latencyMS) ms"
            }
        }
    }
    /// The poll's step: read Ollama's inventory and residency (fail fast when
    /// it is down), decide, and load or refresh through the one Ollama client.
    /// Only reads Ollama when the host facts allow a load at all.
    public static func keepWarm(idle: Bool, memoryPressure: RunAdmission.MemoryPressure, lastOwnerActivity: Date?,
                                now: Date = Date(),
                                installed: @Sendable () async -> [String]? = { await RoutingOrderInterpreter.ollamaInstalledModels() },
                                loaded: @Sendable () async -> [RoutingOrderInterpreter.LoadedModel]? = {
                                    await RoutingOrderInterpreter.ollamaLoadedModels() },
                                load: @Sendable (String) async -> Bool = { model in
                                    await RoutingOrderInterpreter.ollamaLoad(model: model, keepAlive: LocalRequestClassifier.keepAlive) }) async -> WarmReceipt {
        if let reason = warmGate(idle: idle, memoryPressure: memoryPressure, lastOwnerActivity: lastOwnerActivity, now: now) {
            return WarmReceipt(decision: .skip(reason), loaded: nil, latencyMS: 0)
        }
        let decision = warmDecision(idle: idle, memoryPressure: memoryPressure, lastOwnerActivity: lastOwnerActivity,
                                    installed: await installed(), loaded: await loaded(), now: now)
        guard case .load(let model, _) = decision else { return WarmReceipt(decision: decision, loaded: nil, latencyMS: 0) }
        let started = Date()
        let ok = await load(model)
        return WarmReceipt(decision: decision, loaded: ok, latencyMS: max(0, Int(Date().timeIntervalSince(started) * 1000)))
    }

    // MARK: Per-task reading (one classification per task)

    /// Core builds a task's catalog more than once (bind, then each refresh
    /// before a dispatch). Every build of one task must carry the SAME
    /// profile: a second, different reading could drop the row the first
    /// one bound (`selected_candidate_disappeared`). The host keeps one
    /// receipt per task in a private directory: key = SHA-256 of the task id,
    /// the request hash and the prompt version; content = the receipt only
    /// (enums, model, outcome, latency; never the request text).
    public static func cacheKey(taskID: String, requestSHA256: String) -> String {
        SHA256.hash(data: Data((taskID + "\n" + requestSHA256 + "\n" + promptVersion).utf8))
            .map { String(format: "%02x", $0) }.joined()
    }
    public static func cacheDirectory(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        home.appendingPathComponent(".os1/rcc-runtime/request-classifications", isDirectory: true)
    }
    /// A receipt stored for this key no older than `maximumAge` (an owner-only
    /// regular file of at most 4 KiB), else nil.
    public static func cachedReceipt(key: String, directory: URL, now: Date = Date(),
                                     maximumAge: TimeInterval = 24 * 3600) -> Receipt? {
        let url = directory.appendingPathComponent(key + ".json")
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              (attributes[.type] as? FileAttributeType) == .typeRegular,
              (attributes[.size] as? NSNumber)?.intValue ?? .max <= 4_096,
              ((attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0o777) & 0o077 == 0,
              let modified = attributes[.modificationDate] as? Date, now.timeIntervalSince(modified) <= maximumAge,
              let data = try? Data(contentsOf: url), let receipt = try? JSONDecoder().decode(Receipt.self, from: data),
              receipt.promptVersion == promptVersion,
              receipt.model.map(validModelName) ?? true else { return nil }
        if receipt.outcome == "adopted" && (receipt.answer == nil || receipt.model == nil) { return nil }
        return receipt
    }
    /// Store a receipt atomically (directory 0700, file 0600) and prune
    /// receipts older than a day, keeping at most 512.
    public static func store(_ receipt: Receipt, key: String, directory: URL, now: Date = Date()) {
        let manager = FileManager.default
        guard (try? manager.createDirectory(at: directory, withIntermediateDirectories: true,
                                             attributes: [.posixPermissions: 0o700])) != nil,
              let data = try? JSONEncoder().encode(receipt) else { return }
        try? manager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        let target = directory.appendingPathComponent(key + ".json")
        let temporary = directory.appendingPathComponent("." + key + "." + UUID().uuidString + ".tmp")
        guard manager.createFile(atPath: temporary.path, contents: data, attributes: [.posixPermissions: 0o600]) else { return }
        if rename(temporary.path, target.path) != 0 { try? manager.removeItem(at: temporary) }
        let files = ((try? manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [])
            .filter { $0.pathExtension == "json" }
            .map { ($0, (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) }
            .sorted { $0.1 > $1.1 }
        for (index, entry) in files.enumerated() where index >= 512 || now.timeIntervalSince(entry.1) > 24 * 3600 {
            try? manager.removeItem(at: entry.0)
        }
    }
}
