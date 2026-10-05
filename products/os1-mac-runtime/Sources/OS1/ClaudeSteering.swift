import Foundation
import OS1Context

/// Live steering for Claude runs: the run reads stream-json user messages
/// from stdin, so the owner's mid-run corrections join the same native
/// session as follow-up turns — the same mailbox and receipt contract the
/// Codex path already honors (.sending → .accepted on write, .persisted once
/// the turn that carries the correction completes). Only OS-1's own mailbox
/// is read; corrections are the owner's words, never model output.
final class ClaudeSteerDriver: @unchecked Sendable {
    private let lock = NSLock()
    private let mailbox: ExecutionSteering
    /// nil when the run has no owning OS-1 submission (no mailbox), e.g. a
    /// CLI run that still needs stream input to carry image attachments.
    private let submissionID: UUID?
    private let sessionID: String
    private let initialPrompt: String
    private let images: [ImageInput.Encoded]
    private var handle: FileHandle?
    private var stdinClosed = false
    private var processEnded = false
    private var mailboxOpened = false
    private var resultCount = 0
    private var turnOpen = false
    private var commandLifecycle: [String: ExecutionStream.CommandLifecycle] = [:]
    private var lastOutput = Date()
    /// Silence after a result before a correction written into that open turn
    /// counts as folded into it (see `loop`).
    private let foldQuietWindow: TimeInterval
    private let finished = DispatchSemaphore(value: 0)
    private var started = false

    init(submissionID: UUID?, sessionID: String, prompt: String, images: [ImageInput.Encoded] = [],
         mailbox: ExecutionSteering = ExecutionSteering(), foldQuietWindow: TimeInterval = 10) {
        self.mailbox = mailbox
        self.foldQuietWindow = foldQuietWindow
        self.submissionID = submissionID
        self.sessionID = sessionID
        self.initialPrompt = prompt
        self.images = images
    }

    /// Mirror the parser thread's view of the stream. Called from onOutput.
    func observe(resultCount: Int, turnOpen: Bool, commandLifecycle: [String: ExecutionStream.CommandLifecycle] = [:]) {
        lock.lock()
        self.resultCount = resultCount
        self.turnOpen = turnOpen
        self.commandLifecycle = commandLifecycle
        lastOutput = Date()
        lock.unlock()
    }

    /// Called with the process's stdin once it launched. Opens the steering
    /// lease (this is what enables the app's "현재 작업에 반영" button), sends
    /// the initial user message, and starts the mailbox loop.
    func attach(_ writeHandle: FileHandle) {
        lock.lock()
        handle = writeHandle
        started = true
        lock.unlock()
        if let submissionID {
            try? mailbox.open(submissionID: submissionID, threadID: sessionID, turnID: "stream")
            lock.lock(); mailboxOpened = true; lock.unlock()
        }
        _ = writeUserMessage(initialPrompt, images: images)
        Thread.detachNewThread { [weak self] in self?.loop() }
    }

    /// Called after the process exits (success or failure paths both).
    func processDidEnd() {
        lock.lock()
        processEnded = true
        let ranLoop = started
        lock.unlock()
        closeStdin()
        if ranLoop {
            _ = finished.wait(timeout: .now() + 3)
        }
        if let submissionID { mailbox.close(submissionID) }
    }

    /// Asked by the idle watchdog: true when the native final answer arrived
    /// and no turn is open, so only the CLI's exit is pending. Closes its
    /// stdin so it can still exit on its own.
    func releaseAfterFinalAnswer(resultCount: Int, turnOpen: Bool) -> Bool {
        guard resultCount >= 1, !turnOpen else { return false }
        closeStdin()
        return true
    }

    private struct State {
        let results: Int, open: Bool, ended: Bool, quiet: TimeInterval
        let lifecycle: [String: ExecutionStream.CommandLifecycle]
    }
    private func snapshot() -> State {
        lock.lock(); defer { lock.unlock() }
        return State(results: resultCount, open: turnOpen, ended: processEnded,
                     quiet: Date().timeIntervalSince(lastOutput), lifecycle: commandLifecycle)
    }

    private func loop() {
        defer { finished.signal() }
        // input id -> the result index its turn must reach to count as
        // persisted: sent mid-turn means "the turn after the current one",
        // unless the CLI folds it into the current one (see below).
        var requiredResult: [UUID: Int] = [:]
        var midTurn = Set<UUID>()
        while true {
            let state = snapshot()
            if state.ended { return }
            if ExecutionCancellation.isCancelled { closeStdin(); return }
            guard let submissionID else {
                // No mailbox: a single turn, then let the CLI exit.
                if state.results >= 1 { closeStdin(); return }
                Thread.sleep(forTimeInterval: 0.25)
                continue
            }
            for input in mailbox.inputs(submissionID) where mailbox.receipt(input) == nil {
                try? mailbox.record(input, state: .sending, threadID: sessionID, turnID: "stream")
                if writeUserMessage(input.text, uuid: input.id) {
                    try? mailbox.record(input, state: .accepted, threadID: sessionID, turnID: "stream")
                    requiredResult[input.id] = state.results + (state.open ? 2 : 1)
                    if state.open { midTurn.insert(input.id) }
                } else {
                    try? mailbox.record(input, state: .rejected, threadID: sessionID, turnID: "stream")
                }
            }
            var allPersisted = true
            for input in mailbox.inputs(submissionID) {
                guard let receipt = mailbox.receipt(input) else { allPersisted = false; continue }
                guard receipt.state == .accepted else { continue }
                switch Self.fate(of: input.id, required: requiredResult[input.id], midTurn: midTurn.contains(input.id),
                                 state: state, quietWindow: foldQuietWindow) {
                case .persisted(let turnID):
                    try? mailbox.record(input, state: .persisted, threadID: sessionID, turnID: turnID)
                case .notAnswered(let turnID):
                    // The CLI took it, then reports it never reached a model
                    // turn (or the turn died). It stays accepted, never
                    // persisted: a receipt only moves sending → accepted →
                    // persisted or sending → rejected (the Codex contract;
                    // the app's bubble treats accepted as final). Like a
                    // correction still pending when the watchdog releases the
                    // run, the app carries it into the continuation. Only the
                    // evidence is kept, once.
                    if receipt.turnID != turnID {
                        try? mailbox.record(input, state: .accepted, threadID: sessionID, turnID: turnID)
                    }
                case .pending:
                    allPersisted = false
                case .earlierAttempt:
                    continue
                }
            }
            // The run ends when the current turn finished and nothing is
            // pending: closing stdin lets the CLI exit. A correction that
            // lands in the closing race stays unconsumed in the mailbox and
            // the app's existing continuation path re-attaches it.
            if state.results >= 1, !state.open, allPersisted { closeStdin(); return }
            Thread.sleep(forTimeInterval: 0.25)
        }
    }

    private enum Fate: Equatable { case pending, persisted(String), notAnswered(String), earlierAttempt }

    /// Claude Code 2.1.286 folds a message that arrives during an open turn
    /// into that same turn ("absorbed_mid_turn": the text joins the turn as a
    /// queued_command attachment) and then ends it with one result, so the
    /// second result `required` expects never comes. Evidence, strongest first:
    /// 1. its `command_lifecycle` frames: `completed` before the required
    ///    result is a fold; cancelled/discarded/refused were not answered;
    /// 2. without frames, for a message written mid-turn: the turn it was
    ///    written into ended, no turn is open and the CLI stayed silent for
    ///    `quietWindow`. A message still queued would have drained into a new
    ///    turn at once, so it was consumed.
    /// A message the CLI drained into a turn of its own after that result
    /// (`started` later) is answered by that turn: wait for its result.
    /// The receipt names the result that answered it: the turn it started in
    /// ends with the result after the ones counted then. Without a `started`
    /// frame, a fold names the turn in flight when it was written — the open
    /// one for a mid-turn write (`required - 1`), else the next one
    /// (`required`), as for a correction written before the first
    /// `message_start`.
    private static func fate(of id: UUID, required: Int?, midTurn: Bool, state: State, quietWindow: TimeInterval) -> Fate {
        let lifecycle = state.lifecycle[id.uuidString.lowercased()]
        if let lifecycle, lifecycle.terminal {
            guard lifecycle.state == "completed" else { return .notAnswered("lifecycle-" + lifecycle.state) }
            let startedTurn = lifecycle.startedAfterResults.map { $0 + 1 }
            if let required, state.results < required {
                return .persisted("folded-into-result-\(startedTurn ?? (midTurn ? required - 1 : required))")
            }
            return .persisted("result-\(startedTurn ?? state.results)")
        }
        // Accepted by an earlier attempt of this submission, whose process is
        // gone: nothing this CLI does can answer it, so it must not hold
        // stdin open. Its receipt is left as the app last saw it.
        guard let required else { return .earlierAttempt }
        if state.results >= required { return .persisted("result-\(state.results)") }
        let foldTurn = required - 1
        guard midTurn, foldTurn >= 1, state.results >= foldTurn, !state.open, state.quiet >= quietWindow else { return .pending }
        if let started = lifecycle?.startedAfterResults, started >= foldTurn { return .pending }
        return .persisted("folded-into-result-\(foldTurn)")
    }

    private func writeUserMessage(_ text: String, images: [ImageInput.Encoded] = [], uuid: UUID? = nil) -> Bool {
        var content: [[String: Any]] = images.map { image in
            ["type": "image", "source": ["type": "base64", "media_type": image.mediaType, "data": image.base64]]
        }
        content.append(["type": "text", "text": text])
        var object: [String: Any] = ["type": "user", "message": ["role": "user", "content": content]]
        // Claude Code reports a uuid-carrying message's fate on stdout as
        // `command_lifecycle` frames under this same uuid (canonical lowercase).
        if let uuid { object["uuid"] = uuid.uuidString.lowercased() }
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return false }
        lock.lock(); defer { lock.unlock() }
        guard !stdinClosed, let handle else { return false }
        do {
            try handle.write(contentsOf: data + Data([10]))
            return true
        } catch {
            return false
        }
    }

    private func closeStdin() {
        lock.lock(); defer { lock.unlock() }
        guard !stdinClosed else { return }
        stdinClosed = true
        try? handle?.close()
    }
}

/// Fake-CLI cases for the Claude steering loop and the idle watchdog. All
/// state lives in a temporary directory; no model is called.
func claudeSteeringSelfTest() throws {
    func check(_ ok: Bool, _ message: String) throws {
        guard ok else { throw OS1Error.message("Claude steering: " + message) }
    }
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-claude-steering-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: root) }
    let python = try findExecutable("python3")
    // Mirrors Claude Code 2.1.286 in stream-json mode: a correction sent
    // while a turn is open is either folded into that turn (one result) or
    // answered as its own turn (a second result). The CLI exits at stdin EOF;
    // "final-silent" never exits, "never-final" never answers.
    let script = root.appendingPathComponent("fake-claude.py")
    try Data(#"""
import json, sys, time
mode, sid = sys.argv[1], sys.argv[2]
lifecycle = mode.endswith("-lifecycle")
def out(o):
    o["session_id"] = sid
    sys.stdout.write(json.dumps(o) + "\n"); sys.stdout.flush()
def read():
    line = sys.stdin.readline()
    return json.loads(line) if line.strip() else None
def result(n):
    out({"type": "result", "subtype": "success", "is_error": False, "result": "answer %d" % n})
def lc(uid, state):
    if lifecycle and uid: out({"type": "command_lifecycle", "command_uuid": uid, "state": state})
read()
out({"type": "system", "subtype": "init"})
if mode.startswith("early"):
    # The correction arrives before the first message_start: the driver
    # sees no open turn, and the CLI folds it into the turn it then runs.
    correction = read() or {}
    uid = correction.get("uuid")
    lc(uid, "queued")
    out({"type": "assistant", "message": {"id": "m1", "content": [{"type": "text", "text": "working"}]}})
    time.sleep(0.5); lc(uid, "completed"); time.sleep(1); result(1)
    while sys.stdin.readline():
        pass
    sys.exit(0)
out({"type": "assistant", "message": {"id": "m1", "content": [{"type": "text", "text": "working"}]}})
if mode == "plain":
    result(1)
    while sys.stdin.readline():
        pass
    sys.exit(0)
if mode == "never-final":
    time.sleep(600)
if mode == "final-silent":
    result(1)
    time.sleep(600)
correction = read() or {}
uid = correction.get("uuid")
lc(uid, "queued")
if mode.startswith("fold"):
    lc(uid, "started"); time.sleep(0.5); lc(uid, "completed"); result(1)
elif mode.startswith("cancel"):
    # Taken into the open turn, then that turn was aborted.
    lc(uid, "started"); time.sleep(0.5); lc(uid, "cancelled"); result(1)
else:
    time.sleep(0.5); result(1)
    time.sleep(3)
    lc(uid, "started")
    out({"type": "assistant", "message": {"id": "m2", "content": [{"type": "text", "text": "correction"}]}})
    time.sleep(1); result(2); lc(uid, "completed")
while sys.stdin.readline():
    pass
"""#.utf8).write(to: script)

    struct Outcome { let status: Int32; let elapsed: TimeInterval; let results: Int; let receipt: SteeringReceipt?; let error: String? }
    func run(_ mode: String, correct: Bool = true, idle: TimeInterval = 20, quiet: TimeInterval = 10,
             earlierAttempt: Bool = false, beforeTurn: Bool = false) -> Outcome {
        let mailbox = ExecutionSteering(root: root.appendingPathComponent("mailbox-" + mode))
        let submission = UUID(), sessionID = UUID().uuidString.lowercased()
        if earlierAttempt {
            let old = SteeringInput(submissionID: submission, text: "그 말이 아니라, 이전 시도에 보낸 정정.")
            try? mailbox.enqueue(old)
            try? mailbox.record(old, state: .accepted, threadID: "earlier", turnID: "stream")
        }
        let driver = ClaudeSteerDriver(submissionID: submission, sessionID: sessionID, prompt: "고쳐",
                                       mailbox: mailbox, foldQuietWindow: quiet)
        let stream = ExecutionStream(claudeSessionID: sessionID)
        let correction = SteeringInput(submissionID: submission, text: "그 말이 아니라, 로고만 바꿔.")
        var enqueued = !correct
        let started = Date()
        var status: Int32 = -1, failure: String?
        do {
            let output = try commandOutput(python, [script.path, mode, sessionID], timeout: 60, idleTimeout: idle,
                isProvider: true,
                onOutput: { bytes in
                    stream.ingestClaude(bytes)
                    driver.observe(resultCount: stream.resultCount, turnOpen: stream.turnOpen,
                                   commandLifecycle: stream.commandLifecycle)
                    // The owner corrects while the first turn is still open
                    // (or, `beforeTurn`, before it opened).
                    if !enqueued, stream.turnOpen != beforeTurn, stream.resultCount == 0 { try? mailbox.enqueue(correction); enqueued = true }
                },
                interactiveStdin: { driver.attach($0) },
                releaseAfterFinalAnswer: { driver.releaseAfterFinalAnswer(resultCount: stream.resultCount, turnOpen: stream.turnOpen) })
            status = output.0
        } catch { failure = "\(error)" }
        driver.processDidEnd()
        stream.finishClaude()
        return Outcome(status: status, elapsed: Date().timeIntervalSince(started), results: stream.resultCount,
                       receipt: correct ? mailbox.receipt(correction) : nil, error: failure)
    }

    // (a) Folded into the open turn, announced by command_lifecycle: one
    // result, the run ends at once and the receipt is persisted as folded.
    let foldedAnnounced = run("fold-lifecycle")
    try check(foldedAnnounced.error == nil && foldedAnnounced.status == 0 && foldedAnnounced.results == 1,
              "announced fold did not end normally: \(foldedAnnounced.error ?? "status \(foldedAnnounced.status)")")
    try check(foldedAnnounced.elapsed < 8, "announced fold took \(Int(foldedAnnounced.elapsed)) s")
    try check(foldedAnnounced.receipt?.state == .persisted && foldedAnnounced.receipt?.turnID == "folded-into-result-1",
              "announced fold receipt \(String(describing: foldedAnnounced.receipt))")
    // Written before the first message_start (no open turn yet) and folded
    // into that turn: the receipt names result 1, the one that answered it,
    // not a result 0 that never exists (build 327 review).
    let foldedEarly = run("early-lifecycle", beforeTurn: true)
    try check(foldedEarly.error == nil && foldedEarly.status == 0 && foldedEarly.results == 1 && foldedEarly.elapsed < 8,
              "early fold did not end normally: \(foldedEarly.error ?? "status \(foldedEarly.status)")")
    try check(foldedEarly.receipt?.state == .persisted && foldedEarly.receipt?.turnID == "folded-into-result-1",
              "early fold receipt names the wrong result: \(String(describing: foldedEarly.receipt))")
    // Taken into the open turn, then cancelled: the receipt stays accepted
    // (never persisted, never moved back to rejected — the app's bubble
    // already shows accepted as delivered), the run still ends at once, and
    // the app's continuation carries the correction on.
    let cancelled = run("cancel-lifecycle")
    try check(cancelled.error == nil && cancelled.status == 0 && cancelled.results == 1 && cancelled.elapsed < 8,
              "a cancelled correction held the run: \(cancelled.error ?? "\(Int(cancelled.elapsed)) s")")
    try check(cancelled.receipt?.state == .accepted && cancelled.receipt?.turnID == "lifecycle-cancelled",
              "a cancelled correction's receipt moved off accepted: \(String(describing: cancelled.receipt))")
    // (a) Folded without lifecycle frames (the 5A3C90FF/F050022B shape): the
    // run ends after the quiet window, well inside 15 s, not after 30 min.
    let foldedSilent = run("fold")
    try check(foldedSilent.error == nil && foldedSilent.status == 0 && foldedSilent.results == 1,
              "silent fold did not end normally: \(foldedSilent.error ?? "status \(foldedSilent.status)")")
    try check(foldedSilent.elapsed < 15, "silent fold took \(Int(foldedSilent.elapsed)) s")
    try check(foldedSilent.receipt?.state == .persisted && foldedSilent.receipt?.turnID.hasPrefix("folded") == true,
              "silent fold receipt \(String(describing: foldedSilent.receipt))")
    // (b) Answered as its own turn: the run waits for the second result, with
    // and without lifecycle frames.
    for mode in ["separate", "separate-lifecycle"] {
        let separate = run(mode)
        try check(separate.error == nil && separate.status == 0 && separate.results == 2,
                  "\(mode) turn ended early or failed: results \(separate.results), \(separate.error ?? "status \(separate.status)")")
        try check(separate.receipt?.state == .persisted && separate.receipt?.turnID == "result-2",
                  "\(mode) receipt \(String(describing: separate.receipt))")
    }
    // (c) Final answer, then silence (stdin closed, process never exits): the
    // idle watchdog finishes the run normally.
    let silent = run("final-silent", correct: false, idle: 1.5)
    try check(silent.error == nil && silent.status == 0 && silent.results == 1 && silent.elapsed < 10,
              "final answer then silence was not finished normally: \(silent.error ?? "status \(silent.status)")")
    // A correction accepted by an earlier attempt of the same submission does
    // not hold this attempt's stdin open.
    let retried = run("plain", correct: false, earlierAttempt: true)
    try check(retried.error == nil && retried.status == 0 && retried.results == 1 && retried.elapsed < 8,
              "earlier attempt's correction held the run: \(retried.error ?? "\(Int(retried.elapsed)) s")")
    // The watchdog stays strict for a run that never produced a final answer.
    let unanswered = run("never-final", correct: false, idle: 1.5)
    try check(unanswered.error?.contains("no backend activity") == true && unanswered.results == 0,
              "a run without a final answer escaped the idle watchdog")
    // Lifecycle parsing: a terminal state is never downgraded.
    let stream = ExecutionStream()
    let id = UUID()
    for state in ["queued", "started", "completed", "started", "bogus"] {
        stream.ingestClaude((try JSONSerialization.data(withJSONObject: [
            "type": "command_lifecycle", "command_uuid": id.uuidString, "state": state])) + Data([10]))
    }
    try check(stream.commandLifecycle == [id.uuidString.lowercased(): .init(state: "completed", startedAfterResults: 0)],
              "lifecycle state \(stream.commandLifecycle)")
    print("Claude steering: fold announced \(Int(foldedAnnounced.elapsed)) s, fold silent \(Int(foldedSilent.elapsed)) s, separate turns wait for result 2, silent final finished normally, unanswered run still times out")
}
