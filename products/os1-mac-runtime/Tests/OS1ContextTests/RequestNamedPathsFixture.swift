import Foundation
import OS1Context

/// Paths named in a request are observed before and after a turn, so a write
/// there is seen even when the workspace manifest cannot see it (regression
/// 2026-09-24: a created ~/os1-four-surface-probe file read as "not done").
func runRequestNamedPathsFixtures() throws {
    var checks = 0
    func check(_ value: Bool, _ label: String) {
        precondition(value, "Request named paths: " + label); checks += 1
    }
    let home = "/Users/test"
    func extract(_ text: String) -> [String] { RequestNamedPaths.extract(text, home: home) }

    // The owner's own probe wording, Korean particle attached to the path.
    check(extract("/Users/test/os1-four-surface-probe/codex.txt 파일을 만들고 내용은 정확히 CODEX_SURFACE_OK")
          == ["/Users/test/os1-four-surface-probe/codex.txt"], "absolute path before a particle")
    check(extract("/tmp/probe/codex.txt를 만들어") == ["/tmp/probe/codex.txt"], "a particle glued to the path is not part of it")
    check(extract("~/Desktop/notes.md 수정해") == ["/Users/test/Desktop/notes.md"], "home-relative path")
    check(extract("경로:/tmp/a.txt, 그리고 (/tmp/b.txt).") == ["/tmp/a.txt", "/tmp/b.txt"], "punctuation around paths")
    check(extract("https://omaragi.com/history?benchmark=abcd-v3 봐줘").isEmpty, "a URL is not a local path")
    check(extract("products/os1-mac-runtime/Sources/OS1/main.swift 고쳐").isEmpty, "a relative path stays with the workspace")
    check(extract("/tmp/a.txt 와 /tmp/a.txt 그리고 /tmp/./a.txt") == ["/tmp/a.txt"], "duplicates collapse")
    check(extract((0..<40).map { "/tmp/f\($0).txt" }.joined(separator: " ")).count == RequestNamedPaths.maximumPaths,
          "bounded number of paths")
    check(extract("1/2 컵, 2026/09/24, /").isEmpty, "fractions, dates and a bare slash are not paths")
    check(extract("/tmp/a/main.swift:7473 와 /tmp/a/b.ts:12:5 봐") == ["/tmp/a/main.swift", "/tmp/a/b.ts"],
          "a line reference names the file")

    // Places every run writes are never observed (they would always "change").
    check(extract("~/.codex/sessions/2026/09/24/rollout.jsonl 분석해").isEmpty, "backend session logs are excluded")
    check(extract("~ 전체 정리해").isEmpty && extract("~/ 봐").isEmpty, "the home folder contains runtime writes")
    check(extract("~/.codex 설정 봐").isEmpty, "a folder containing session logs is excluded")
    check(extract("~/.codex/config.toml 수정해") == ["/Users/test/.codex/config.toml"], "a config file beside them is kept")
    check(extract("~/.claude.json, ~/.os1/fleet/jobs, ~/Library/Logs/x.log").isEmpty, "Claude state, OS-1 state and Library")

    // Credential-like files: size and time only, never their bytes.
    check(RequestNamedPaths.credentialLike("/Users/test/.ssh/id_ed25519"), "ssh key")
    check(RequestNamedPaths.credentialLike("/proj/.env.local"), "env file")
    check(RequestNamedPaths.credentialLike("/proj/deploy-token.txt"), "token file")
    check(!RequestNamedPaths.credentialLike("/proj/README.md"), "ordinary file")

    // State: stable when unchanged, different after create / edit / delete.
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-named-paths-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let file = root.appendingPathComponent("probe/codex.txt").path
    let folder = root.appendingPathComponent("probe").path
    let missing = RequestNamedPaths.stateMaterial([file])
    check(missing == RequestNamedPaths.stateMaterial([file]), "unchanged state is stable")
    try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
    try Data("CODEX_SURFACE_OK".utf8).write(to: URL(fileURLWithPath: file))
    let created = RequestNamedPaths.stateMaterial([file])
    check(created != missing, "a created file is observed")
    let folderBefore = RequestNamedPaths.stateMaterial([folder])
    let stamp = try FileManager.default.attributesOfItem(atPath: file)[.modificationDate] as! Date
    try Data("CODEX_SURFACE_NO".utf8).write(to: URL(fileURLWithPath: file))  // same size
    try FileManager.default.setAttributes([.modificationDate: stamp], ofItemAtPath: file)
    check(RequestNamedPaths.stateMaterial([file]) != created, "a same-size, same-time edit is observed by content")
    try FileManager.default.setAttributes([.modificationDate: stamp.addingTimeInterval(5)], ofItemAtPath: file)
    check(RequestNamedPaths.stateMaterial([folder]) != folderBefore, "an edit inside a named folder is observed")
    try FileManager.default.removeItem(atPath: file)
    check(RequestNamedPaths.stateMaterial([file]) == missing, "a deleted file reads as missing again")

    // A credential-like file's bytes are not read: same size and time, new bytes, same state.
    let secret = root.appendingPathComponent("deploy-token.txt").path
    try Data("aaaa".utf8).write(to: URL(fileURLWithPath: secret))
    let secretStamp = try FileManager.default.attributesOfItem(atPath: secret)[.modificationDate] as! Date
    let secretBefore = RequestNamedPaths.stateMaterial([secret])
    try Data("bbbb".utf8).write(to: URL(fileURLWithPath: secret))
    try FileManager.default.setAttributes([.modificationDate: secretStamp], ofItemAtPath: secret)
    check(RequestNamedPaths.stateMaterial([secret]) == secretBefore, "credential bytes are never read")
    try FileManager.default.removeItem(atPath: secret)
    check(RequestNamedPaths.stateMaterial([secret]) != secretBefore, "but its deletion is observed")

    print("Request named paths: \(checks) checks passed; extraction, runtime exclusions, credential boundary, state")
}
