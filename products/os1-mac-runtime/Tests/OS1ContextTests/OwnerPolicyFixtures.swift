import Foundation
import OS1Context

func runOwnerPolicyFixtures() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let absent = try OwnerPolicySnapshot.load(root: root)
    precondition(absent == nil)
    let data = Data("authoritative fixture only".utf8)
    let digest = OwnerPolicySnapshot.digest(data)
    let file = root.appendingPathComponent(digest + ".txt")
    try data.write(to: file)
    let now = Date()
    let record: [String: Any] = ["schema": 1, "sourceSHA256": digest, "sourceFile": digest + ".txt",
        "projectionSHA256": OwnerPolicySnapshot.digest(Data("route\nprojection".utf8)),
        "routing": "route", "projection": "projection", "sourceID": "fixture", "sourceModified": "1",
        "checkedAt": now.timeIntervalSince1970]
    func put(_ value: [String: Any]) throws {
        try JSONSerialization.data(withJSONObject: value).write(to: root.appendingPathComponent("active.json"))
    }
    func reject(_ value: [String: Any]) throws {
        try put(value)
        do { _ = try OwnerPolicySnapshot.load(root: root, now: now); preconditionFailure("invalid policy accepted") }
        catch { }
    }
    try put(record)
    let loaded = try OwnerPolicySnapshot.load(root: root, now: now)!
    precondition(loaded.instructions.contains("not the entire original"))
    precondition(loaded.instructions.contains(digest))
    try loaded.verifyOriginal(root: root)
    for key in ["sourceFile", "sourceSHA256", "projection", "routing", "projectionSHA256"] {
        var bad = record; bad[key] = "../changed"; try reject(bad)
    }
    for offset in [-86_401.0, 61.0] {
        var bad = record; bad["checkedAt"] = now.timeIntervalSince1970 + offset; try reject(bad)
    }
    try put(record)
    try Data("tampered".utf8).write(to: file)
    do { try loaded.verifyOriginal(root: root); preconditionFailure("changed source accepted") } catch { }
    try reject(record)
    try FileManager.default.removeItem(at: file)
    let other = root.appendingPathComponent("other.txt"); try data.write(to: other)
    try FileManager.default.createSymbolicLink(at: file, withDestinationURL: other)
    try reject(record)
    OwnerPolicyContext.$snapshot.withValue(loaded) {
        precondition(OwnerPolicyContext.snapshot?.sourceSHA256 == digest)
        precondition(!OwnerPolicyContext.instructions.isEmpty)
    }
    precondition(OwnerPolicyContext.snapshot == nil)
    // A refresh diagnostic keeps the end of a capped stderr line: an
    // osascript error ends with its code, and one that quotes its reference
    // is longer than the cap even after masking (build 327 review: the
    // head-kept cap cut it before the code).
    let noteError = "Owner policy refresh rejected (CalledProcessError: osascript exit 1: 42:107: execution error: "
        + "Notes got an error: Can’t get note id \"x-coredata://8E1C4F2A-1B3C-4D5E-8F90-123456789ABC/ICNote/p1880\" "
        + "of every note whose name contains \"RCC ENGINE v26\". (-1728)); "
        + "retried once after 15 s; existing snapshot retained. --token fixture-credential-not-a-real-value-0123"
    precondition(noteError.count > NativeStepLabel.maximumCharacters)
    precondition(NativeStepLabel.redact(noteError)?.contains("(-1728)") == false, "the fixture must exceed the head-kept cap even after masking: \(NativeStepLabel.redact(noteError) ?? "")")
    let tail = OwnerPolicyRefresh.stderrTail(Data((noteError + "\nshort cause (-1712)\n").utf8))
    precondition(tail.count == 2 && tail[0].hasPrefix("… ") && tail[0].contains("(-1728)")
                 && !tail[0].contains("fixture-credential") && NativeStepLabel.isDisplayable(tail[0]), "capped line lost its end: \(tail)")
    precondition(tail[1] == NativeStepLabel.redact("short cause (-1712)"), "a line within the cap must redact as before")
    precondition(tail.allSatisfy { NativeStepLabel.redact($0) == $0 }, "a kept tail must stay stable under redaction")
    print("Owner policy: absent, integrity, freshness, path, symlink, pre/post mutation and task-local custody passed")
}
