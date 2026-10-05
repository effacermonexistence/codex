import Darwin
import Foundation
import OS1Context

/// The durable record of an owner request's unfinished OS-1 repair (build
/// 327): one private file per conversation, updated as the repair runs and
/// reconciled at launch when its process is gone.
func runPendingOS1RepairFixtures() throws {
    var checks = 0
    func check(_ condition: Bool, _ message: String) {
        precondition(condition, "Pending OS-1 repair: " + message); checks += 1
    }
    let base = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("os1-pending-repair-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: base) }
    let store = PendingOS1RepairStore(root: base.appendingPathComponent("pending-os1-repairs"))

    let conversation = UUID(), submission = UUID()
    check(PendingOS1Repair.recordID(conversationID: conversation.uuidString, submissionID: submission.uuidString)
        == conversation.uuidString.lowercased(), "a conversation's record is found by its next request")
    check(PendingOS1Repair.recordID(conversationID: nil, submissionID: submission.uuidString) == submission.uuidString.lowercased(),
        "without a conversation the submission names it")
    check(PendingOS1Repair.recordID(conversationID: "not-a-uuid", submissionID: nil) == nil, "no id, no record")
    check(store.list().isEmpty && store.load(id: conversation.uuidString) == nil, "an absent folder is an empty store")

    let long = String(repeating: "가", count: 30_000)
    let start = Date(timeIntervalSince1970: 1_800_000_000)
    let record = PendingOS1Repair(id: conversation.uuidString.lowercased(), conversationID: conversation.uuidString,
        submissionID: submission.uuidString, ownerRequest: "밑에 너무 크거든", corrections: ["정정"], draftReport: "HEAD" + long + "TAIL",
        sourceRoot: "/os1", startCommit: String(repeating: "a", count: 40), now: start, pid: getpid())
    check(record.state == .running && record.attempts == 1, "a new record is a running first attempt")
    check(record.draftReport.count < 13_000 && record.draftReport.hasPrefix("HEAD") && record.draftReport.hasSuffix("TAIL"),
        "a long report keeps its head and tail")
    try store.save(record)
    let url = store.url(id: record.id)!
    let mode = (try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? NSNumber)?.intValue
    let folderMode = (try FileManager.default.attributesOfItem(atPath: store.root.path)[.posixPermissions] as? NSNumber)?.intValue
    check(mode == 0o600 && folderMode == 0o700, "the record is private")
    check(store.load(id: record.id.uppercased()) == record, "a record round-trips, whatever the id's case")

    // OS-1's completion records a staging failure on it.
    let later = start.addingTimeInterval(60)
    let failed = store.update(id: record.id, now: later) {
        $0.state = .stagingFailed; $0.failedGate = "app-self-test-parallel"
        $0.repairCommit = String(repeating: "c", count: 40); $0.repairBranch = "os1/inline-live-run-row"; $0.repairPushed = true
    }
    check(failed?.state == .stagingFailed && failed?.updatedAt == later && store.load(id: record.id)?.failedGate == "app-self-test-parallel",
        "an update is saved with its time")
    check(store.update(id: UUID().uuidString) { $0.state = .failed } == nil, "updating a missing record creates nothing")
    check(failed?.retryable(isAlive: { _ in true }) == true, "a staging failure is retried on the next request")

    // A running record whose process is gone is an interrupted repair.
    let other = UUID().uuidString.lowercased()
    try store.save(PendingOS1Repair(id: other, conversationID: nil, submissionID: other, ownerRequest: "로고",
        corrections: [], draftReport: "", sourceRoot: nil, startCommit: nil, now: start, pid: 999_999))
    check(store.load(id: other)?.effectiveState(isAlive: { _ in false }) == .interrupted, "a dead writer reads as interrupted")
    check(store.load(id: other)?.retryable(isAlive: { _ in true }) == false, "a live writer's repair is not taken over")
    let reconciled = store.reconcileInterrupted(isAlive: { $0.pid != 999_999 })
    check(reconciled.map(\.id) == [other] && store.load(id: other)?.state == .interrupted, "launch marks only the dead writer interrupted")
    check(store.list().count == 2, "every record is listed")
    check(!PendingOS1Repair.processAlive(0) && PendingOS1Repair.processAlive(getpid()), "the liveness probe")

    // The app's once-per-record resume flag survives a reload; an older
    // record without the field still decodes.
    let flagged = store.update(id: other) { $0.autoResumeAttempted = true }
    check(flagged?.autoResumeAttempted == true && store.load(id: other)?.autoResumeAttempted == true, "the resume flag is durable")
    check(store.load(id: record.id)?.autoResumeAttempted == nil, "a record written before the flag existed reads as not resumed")
    // A pid that is alive but started after the record was written is a
    // reused number, not the writer.
    var reused = store.load(id: record.id)!
    reused.pid = getpid()
    reused.updatedAt = Date(timeIntervalSince1970: 0)
    check(!PendingOS1Repair.writerAlive(reused), "a reused pid is not the writer")
    reused.updatedAt = Date()
    check(PendingOS1Repair.writerAlive(reused), "the running writer is alive")
    // The CLI's own binding uses the same rule by default (build 327 fix):
    // a running record whose pid now belongs to a process that started
    // later is interrupted and retryable, not "still running".
    var reusedRunning = reused
    reusedRunning.state = .running
    reusedRunning.updatedAt = Date(timeIntervalSince1970: 0)
    check(reusedRunning.effectiveState() == .interrupted && reusedRunning.retryable(),
        "the CLI's default liveness takes a reused pid for the writer")
    reusedRunning.updatedAt = Date()
    check(reusedRunning.effectiveState() == .running && !reusedRunning.retryable(), "a live writer's record is not retryable by default")
    check(PendingOS1Repair.systemBootTime().map { $0 < Date() && $0 > Date(timeIntervalSince1970: 1_000_000_000) } == true,
        "the boot time is readable")
    var exhausted = store.load(id: other)!
    exhausted.attempts = PendingOS1Repair.maximumAutomaticAttempts
    check(!exhausted.retryable(isAlive: { _ in false }), "automatic retries stop at the limit")

    // A write request continues a pending OS-1 change only when it is about
    // it (build 327 fix): retry phrasing, a short follow-up, or OS-1 itself.
    let home = URL(fileURLWithPath: "/Users/fixture", isDirectory: true)
    for continuing in ["아니 그래서 고치라니까?", "계속", "왜 안 됐냐", "밑에 너무 크거든 코덱스처럼 한 줄로", "retry",
                       "고쳐", "마저 해", "설치 됐어?", "OS-1 사이드바 정렬을 왼쪽으로 바꾸고 아이콘 간격도 조금 넓혀줘. 그리고 대기열 표시도 코덱스처럼 한 줄로 정리해 줘 부탁해 정말로"] {
        check(OS1SelfReference.continuesPendingOS1Change(continuing, home: home), "'\(continuing)' does not continue the pending OS-1 change")
    }
    for different in ["웹사이트 푸터 색 바꿔", "https://example.com 배포 상태 확인하고 다시 올려", "인스타 DM 자동응답 문구 고쳐",
                      "omaragi.com 랜딩 헤더 계속 수정해", "~/Projects/shop/README.md 에 설치 방법 한 줄 추가해",
                      String(repeating: "새 정리 작업을 해 줘 ", count: 9)] {
        check(!OS1SelfReference.continuesPendingOS1Change(different, home: home), "'\(different)' was taken over by the pending OS-1 change")
    }

    // Done or cancelled: the record is removed.
    store.remove(id: record.id)
    store.remove(id: "not-a-uuid")
    check(store.load(id: record.id) == nil && store.list().map(\.id) == [other], "removal is per record")
    print("Pending OS-1 repair fixtures: \(checks) checks; model calls 0")
}
