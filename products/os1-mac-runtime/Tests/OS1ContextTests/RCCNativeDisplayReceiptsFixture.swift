import Foundation
import OS1Context

private enum RCCNativeDisplayFixtureError: Error { case failed(String) }
func runRCCNativeDisplayReceiptsFixtures() throws {
    var checks = 0
    func check(_ value: Bool, _ label: String) throws {
        guard value else { throw RCCNativeDisplayFixtureError.failed(label) }; checks += 1
    }
    let fm = FileManager.default
    let home = fm.temporaryDirectory.resolvingSymlinksInPath()
        .appendingPathComponent("os1-native-display-" + UUID().uuidString, isDirectory: true)
    try fm.createDirectory(at: home, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer { try? fm.removeItem(at: home) }
    var root = home
    for name in [".os1", "rcc-runtime", "native-receipts"] {
        root.appendPathComponent(name, isDirectory: true)
        try fm.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    }
    let file = root.appendingPathComponent(UUID().uuidString.lowercased() + ".json")
    let bytes = Data("{\"fixture\":\"no private content\"}".utf8)
    try bytes.write(to: file); try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    var core = RCCRuntimeContract.Snapshot(taskID: "fixture-display", requestSHA256: String(repeating: "a", count: 64),
        state: .running, revision: 1, children: [.init(id: "child", state: .running, attemptID: "attempt",
            candidateID: "candidate", nativeReceipt: file.path)], result: nil, error: nil)
    func load() -> [String: Data] { RCCNativeDisplayReceipts.load(core, homeDirectory: home) }
    try check(load()[file.path] == bytes, "exact private child receipt read; no execution")
    let unknown = root.appendingPathComponent(UUID().uuidString.lowercased() + ".json")
    try bytes.write(to: unknown); try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: unknown.path)
    try check(load().count == 1, "does not enumerate unrelated private receipts")
    try fm.setAttributes([.posixPermissions: 0o644], ofItemAtPath: file.path)
    try check(load().isEmpty, "public receipt rejected")
    try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    let alias = root.appendingPathComponent(UUID().uuidString.lowercased() + ".json")
    try fm.linkItem(at: file, to: alias)
    try check(load().isEmpty, "hardlinked receipt rejected")
    try fm.removeItem(at: alias)
    try fm.createSymbolicLink(at: alias, withDestinationURL: file)
    core.children[0].nativeReceipt = alias.path
    try check(load().isEmpty, "symlink receipt rejected")
    core.children[0].nativeReceipt = home.appendingPathComponent(file.lastPathComponent).path
    try bytes.write(to: URL(fileURLWithPath: core.children[0].nativeReceipt!))
    try check(load().isEmpty, "outside exact native receipt root rejected")
    core.children[0].nativeReceipt = root.path + "/../native-receipts/" + file.lastPathComponent
    try check(load().isEmpty, "noncanonical path rejected")
    let nonUUID = root.appendingPathComponent("other.json")
    try bytes.write(to: nonUUID); try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: nonUUID.path)
    core.children[0].nativeReceipt = nonUUID.path
    try check(load().isEmpty, "non-native filename rejected")
    core.children[0].nativeReceipt = file.path
    try Data(repeating: 0, count: 1_048_577).write(to: file)
    try check(load().isEmpty, "oversized receipt rejected")
    try Data().write(to: file)
    try check(load().isEmpty, "empty receipt rejected")
    try bytes.write(to: file)
    try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: root.path)
    try check(load().isEmpty, "non-private parent rejected")
    try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
    core.children[0].nativeReceipt = nil
    try check(load().isEmpty, "no declared receipt remains unknown")
    print("RCC native display receipt custody: \(checks) checks PASS; temporary fixture only; no backend/model calls")
}
