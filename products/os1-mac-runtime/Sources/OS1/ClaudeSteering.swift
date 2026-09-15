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
    private let mailbox = ExecutionSteering()
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
    private let finished = DispatchSemaphore(value: 0)
    private var started = false

    init(submissionID: UUID?, sessionID: String, prompt: String, images: [ImageInput.Encoded] = []) {
        self.submissionID = submissionID
        self.sessionID = sessionID
        self.initialPrompt = prompt
        self.images = images
    }

    /// Mirror the parser thread's view of the stream. Called from onOutput.
    func observe(resultCount: Int, turnOpen: Bool) {
        lock.lock()
        self.resultCount = resultCount
        self.turnOpen = turnOpen
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

    private func snapshot() -> (results: Int, open: Bool, ended: Bool) {
        lock.lock(); defer { lock.unlock() }
        return (resultCount, turnOpen, processEnded)
    }

    private func loop() {
        defer { finished.signal() }
        // input id -> the result index its turn must reach to count as
        // persisted: sent mid-turn means "the turn after the current one".
        var requiredResult: [UUID: Int] = [:]
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
                if writeUserMessage(input.text) {
                    try? mailbox.record(input, state: .accepted, threadID: sessionID, turnID: "stream")
                    requiredResult[input.id] = state.results + (state.open ? 2 : 1)
                } else {
                    try? mailbox.record(input, state: .rejected, threadID: sessionID, turnID: "stream")
                }
            }
            var allPersisted = true
            for input in mailbox.inputs(submissionID) {
                guard let receipt = mailbox.receipt(input) else { allPersisted = false; continue }
                if receipt.state == .accepted {
                    if let needed = requiredResult[input.id], state.results >= needed {
                        try? mailbox.record(input, state: .persisted, threadID: sessionID,
                                            turnID: "result-\(state.results)")
                    } else {
                        allPersisted = false
                    }
                }
            }
            // The run ends when the current turn finished and nothing is
            // pending: closing stdin lets the CLI exit. A correction that
            // lands in the closing race stays unconsumed in the mailbox and
            // the app's existing continuation path re-attaches it.
            if state.results >= 1, allPersisted { closeStdin(); return }
            Thread.sleep(forTimeInterval: 0.25)
        }
    }

    private func writeUserMessage(_ text: String, images: [ImageInput.Encoded] = []) -> Bool {
        var content: [[String: Any]] = images.map { image in
            ["type": "image", "source": ["type": "base64", "media_type": image.mediaType, "data": image.base64]]
        }
        content.append(["type": "text", "text": text])
        let object: [String: Any] = ["type": "user", "message": ["role": "user", "content": content]]
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
