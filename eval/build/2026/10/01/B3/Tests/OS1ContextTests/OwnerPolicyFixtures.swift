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
    print("Owner policy: absent, integrity, freshness, path, symlink, pre/post mutation and task-local custody passed")
}
