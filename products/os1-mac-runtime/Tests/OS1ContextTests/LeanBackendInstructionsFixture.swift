import Foundation
import OS1Context

/// Lean backend instructions: file custody, quoting and header extraction.
/// No model call, no real ~/.claude or ~/.codex read.
func runLeanBackendInstructionsFixtures() throws {
    var checks = 0
    func check(_ value: @autoclosure () -> Bool, _ label: String) { precondition(value(), label); checks += 1 }
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-lean-" + UUID().uuidString, isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }

    check(LeanBackendInstructions.enabled([:]), "lean by default")
    check(!LeanBackendInstructions.enabled([LeanBackendInstructions.killSwitch: "1"]), "kill switch restores the full defaults")
    check(LeanBackendInstructions.claudeEnabled([:]) == LeanBackendInstructions.claudeLeanVerified
          && LeanBackendInstructions.claudeEnabled(["OS1_LEAN_CLAUDE": "1"])
          && !LeanBackendInstructions.claudeEnabled(["OS1_LEAN_CLAUDE": "1", LeanBackendInstructions.killSwitch: "1"]),
          "Claude lean only once verified or explicitly measured; the kill switch still wins")

    let first = try LeanBackendInstructions.codexInstructionsFile("projection A", root: root.appendingPathComponent("store"))
    let again = try LeanBackendInstructions.codexInstructionsFile("projection A", root: root.appendingPathComponent("store"))
    let other = try LeanBackendInstructions.codexInstructionsFile("projection B", root: root.appendingPathComponent("store"))
    check(first == again && first != other, "content-addressed: same text, same file; new text, new file")
    check((try? String(contentsOf: first, encoding: .utf8)) == "projection A", "file holds exactly the projection")

    let spaced = URL(fileURLWithPath: "/Users/x/Library/Application Support/OS-1/a\"b\\c.md")
    check(LeanBackendInstructions.codexOverride(file: spaced)
          == #"model_instructions_file="/Users/x/Library/Application Support/OS-1/a\"b\\c.md""#, "TOML basic-string quoting")

    let home = root.appendingPathComponent("home", isDirectory: true)
    let workspace = root.appendingPathComponent("repo", isDirectory: true)
    try FileManager.default.createDirectory(at: home.appendingPathComponent(".claude"), withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
    let header = "# GitHub to R2 infrastructure\n\n- Never commit tokens."
    try (header + "\n\n# OMAR / LUA / RCC ENGINE v26 — GOVERNING REASONING LAW\n" + String(repeating: "engine ", count: 50_000))
        .write(to: home.appendingPathComponent(".claude/CLAUDE.md"), atomically: true, encoding: .utf8)
    check(LeanBackendInstructions.operatingHeader(of: home.appendingPathComponent(".claude/CLAUDE.md")) == header,
          "only the operating header, never the engine")
    check(LeanBackendInstructions.operatingHeader(of: root.appendingPathComponent("missing.md")) == nil, "missing file")

    try header.write(to: workspace.appendingPathComponent("CLAUDE.md"), atomically: true, encoding: .utf8)
    let same = LeanBackendInstructions.claudeWorkspaceContext(home: home, workspace: workspace.path)
    check(same.contains("Never commit tokens.") && same.components(separatedBy: "Never commit tokens.").count == 2,
          "a workspace copy of the header is not sent twice")
    try "# Project rules\n- Run make test before committing.".write(to: workspace.appendingPathComponent("CLAUDE.md"),
                                                                     atomically: true, encoding: .utf8)
    let both = LeanBackendInstructions.claudeWorkspaceContext(home: home, workspace: workspace.path)
    check(both.contains("Never commit tokens.") && both.contains("Run make test before committing.") && !both.contains("engine engine"),
          "header and workspace rules, no engine")

    let long = (0..<3_000).map { "- rule \($0) keeps its place in a long project file" }.joined(separator: "\n")
    try long.write(to: workspace.appendingPathComponent("CLAUDE.md"), atomically: true, encoding: .utf8)
    let bounded = LeanBackendInstructions.operatingHeader(of: workspace.appendingPathComponent("CLAUDE.md")) ?? ""
    check(bounded.utf8.count < LeanBackendInstructions.maximumContextBytes + 400 && bounded.contains("rule 0 ")
          && bounded.contains("[truncated — read"), "a long file is bounded and says where the rest is")
    print("Lean backend instructions: \(checks) checks passed")
}
