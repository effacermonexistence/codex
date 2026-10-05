import Darwin
import Foundation
import OS1Context

func runSourceWriteAdmissionFixtures() throws {
    var checks = 0
    func check(_ condition: Bool, _ message: String) {
        precondition(condition, "Source admission: " + message); checks += 1
    }
    let home = FileManager.default.temporaryDirectory.appendingPathComponent("os1-source-admission-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: home) }
    let current = home.appendingPathComponent("current"), stale = home.appendingPathComponent("stale")
    for root in [current, stale] {
        let marker = root.appendingPathComponent(LocalProjectWorkspace.marker(for: "os1-clodex")!)
        try FileManager.default.createDirectory(at: marker.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("fixture".utf8).write(to: marker)
    }
    let config = home.appendingPathComponent(".codex/config.toml")
    try FileManager.default.createDirectory(at: config.deletingLastPathComponent(), withIntermediateDirectories: true)
    let registrations = [current, stale].map { "[projects.\(String(reflecting: $0.path))]\ntrust_level = \"trusted\"\n" }.joined()
    try Data(registrations.utf8).write(to: config)
    let info = SelfUpdate.installedAppURL(home: home).appendingPathComponent("Contents/Info.plist")
    try FileManager.default.createDirectory(at: info.deletingLastPathComponent(), withIntermediateDirectories: true)
    try PropertyListSerialization.data(fromPropertyList: ["CFBundleVersion": "297"], format: .xml, options: 0).write(to: info)
    check(SourceWriteAdmission.currentRoot(home: home) == nil, "no installed outcome leaves source unknown")
    func outcome(_ root: URL, build: Int) throws {
        let intent = SelfUpdate.Intent(build: build, version: "fixture", sourceRoot: root.path, sourceCommit: nil,
            stagedAppSHA256: "fixture-app", stagedCLISHA256: "fixture-cli", conversationID: nil, submissionID: nil, checks: [])
        try SelfUpdate.saveOutcome(.init(intent: intent, success: true, receiptPath: nil, error: nil, summary: "fixture"), home: home)
    }
    try outcome(stale, build: 296)
    check(SourceWriteAdmission.currentRoot(home: home) == nil, "older successful install is not live source")
    try outcome(current, build: 297)
    let canonical = LocalProjectWorkspace.executionPath(current.path)
    check(SourceWriteAdmission.currentRoot(home: home) == canonical, "installed successful root wins over stale registered copy")
    try Data().write(to: config)
    check(SourceWriteAdmission.currentRoot(home: home) == nil, "unregistered installed root is not invented")
    try Data(registrations.utf8).write(to: config)
    let root = SourceWriteAdmission.currentRoot(home: home)!
    func access(_ workspace: URL, _ request: String = "파일 수정해", _ project: String? = nil, _ write: Bool = true) -> SourceWriteAdmission.Access? {
        SourceWriteAdmission.access(request: request, workspace: workspace.path, projectID: project, writeScope: write, root: root, home: home)
    }
    check(access(current) == .exclusive, "live source writer needs exclusive access")
    check(access(current.appendingPathComponent("products")) == .exclusive, "live source child is still exclusive")
    check(access(home) == .shared, "HOME retains source containment guard")
    check(SourceWriteAdmission.parksBehindSourceWriter(.exclusive), "an OS-1 writer still waits for another OS-1 writer")
    check(!SourceWriteAdmission.parksBehindSourceWriter(.shared),
        "a HOME request is not parked behind a repair; its runtime confines Claude or waits on the lease for Codex")
    check(access(home, "파일 읽어", nil, false) == nil, "read-only request does not wait on source writer")
    let sibling = home.appendingPathComponent("website")
    check(access(sibling) == nil, "unrelated sibling workspace bypasses source lock")
    check(access(home, "사이드바 버그 고쳐", "scv-instagram") == .shared, "other project suppresses repair inference but preserves HOME source guard")
    check(access(sibling, "사이드바 버그 고쳐", "scv-instagram") == nil, "explicit sibling project bypasses source guard without invented HOME narrowing")
    check(access(home, "OS-1 라우팅 고쳐", "workspace:LUA") == .exclusive, "generic HOME binding permits explicit OS1 repair")
    check(SourceWriteAdmission.access(request: "파일 수정해", workspace: home.path, projectID: nil, writeScope: true, root: nil, home: home) == nil,
        "unknown current root does not manufacture admission authority")
    let lock = SourceWriteAdmission.lockURL(root: root, home: home)
    check(SourceWriteAdmission.availability(root: root, access: .shared, home: home) == .available, "missing lock does not imply contention")
    check(!FileManager.default.fileExists(atPath: lock.path), "probe never creates a missing lock")
    check(!SourceWriteAdmission.heldOnlyByReaders(root: root, home: home), "missing source lock is not a reader hold")
    try FileManager.default.createDirectory(at: lock.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data("fixture untouched bytes".utf8).write(to: lock)
    let descriptor = open(lock.path, O_RDONLY | O_CLOEXEC)
    guard descriptor >= 0 else { fatalError("fixture lock open failed") }
    defer { close(descriptor) }
    check(flock(descriptor, LOCK_EX | LOCK_NB) == 0, "fixture owns exclusive source lease")
    check(SourceWriteAdmission.availability(root: root, access: .shared, home: home) == .busy, "HOME parks behind exclusive repair")
    check(SourceWriteAdmission.availability(root: root, access: .exclusive, home: home) == .busy, "source writer parks behind repair")
    check(!SourceWriteAdmission.heldOnlyByReaders(root: root, home: home), "exclusive repair is not mistaken for shared readers")
    _ = flock(descriptor, LOCK_UN)
    check(SourceWriteAdmission.availability(root: root, access: .shared, home: home) == .available, "source release admits preserved requests")
    check(flock(descriptor, LOCK_SH | LOCK_NB) == 0, "fixture owns shared HOME source lease")
    check(SourceWriteAdmission.availability(root: root, access: .shared, home: home) == .available, "HOME work can share with another HOME request")
    check(SourceWriteAdmission.availability(root: root, access: .exclusive, home: home) == .busy, "existing HOME reader blocks source writer")
    check(SourceWriteAdmission.heldOnlyByReaders(root: root, home: home), "reader-only hold admits one writer to announce intent")
    _ = flock(descriptor, LOCK_UN)
    let writerIntent = lock.appendingPathExtension("writer-intent")
    try Data().write(to: writerIntent)
    let intentDescriptor = open(writerIntent.path, O_RDONLY | O_CLOEXEC)
    guard intentDescriptor >= 0 else { fatalError("fixture intent open failed") }
    defer { close(intentDescriptor) }
    check(flock(intentDescriptor, LOCK_EX | LOCK_NB) == 0, "fixture announces waiting exclusive writer")
    check(!SourceWriteAdmission.heldOnlyByReaders(root: root, home: home), "announced writer prevents a second writer admission")
    check(SourceWriteAdmission.availability(root: root, access: .shared, home: home) == .busy, "waiting repair stops new HOME readers from starving it")
    _ = flock(intentDescriptor, LOCK_UN)
    check(SourceWriteAdmission.availability(root: root, access: .shared, home: home) == .available, "writer-intent release clears queue hold")
    check(try Data(contentsOf: lock) == Data("fixture untouched bytes".utf8), "probes preserve existing source-lock bytes")
    let alias = home.appendingPathComponent("lock-alias")
    try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: lock)
    check(SourceWriteAdmission.probe(at: alias, access: .shared) == .unknown, "probe never follows a lock symlink")
    print("Source-write admission fixtures: \(checks) checks; model calls 0")
    try runOS1SourceConfinementFixtures()
}
