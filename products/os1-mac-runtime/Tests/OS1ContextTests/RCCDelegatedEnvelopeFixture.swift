import Foundation
import OS1Context

/// The provider message every delegated RCC child receives. Pure string
/// assembly plus one real Node evaluation of the exact verifier's own regular
/// expression (read from rcc-plugin.mjs, not exported or copied); no runtime,
/// adapter, provider, account or model is started.
func runRCCDelegatedEnvelopeFixtures() throws {
    typealias E = RCCDelegatedEnvelope
    typealias C = RCCRuntimeContract
    var checks = 0
    func check(_ pass: Bool, _ label: String) throws {
        guard pass else { throw NSError(domain: "RCCDelegatedEnvelopeFixture", code: 1,
                                        userInfo: [NSLocalizedDescriptionKey: label]) }
        checks += 1
    }
    func count(_ needle: String, in text: String) -> Int { text.components(separatedBy: needle).count - 1 }

    // The build 380 live test: one owner request, three named routes.
    let owner = "1+1 Codex한테. 2+3 Claude Code한테. 4+5 Claude한테."
    let routes: [C.ExplicitRoute] = [.init(surface: .codex, instruction: "1+1"),
                                     .init(surface: .claude, instruction: "2+3"),
                                     .init(surface: .claudeChat, instruction: "4+5")]
    let taskID = "3a857a4a-0ece-4048-ab90-5d11dff1ac27", attemptID = "02b1a9e4-0000-4000-8000-000000000001"
    func envelope(_ instruction: String, surface: C.Surface, routes explicit: [C.ExplicitRoute]? = routes,
                  scope: C.Scope = .readOnly, sourceCompletion: String = "", continuation: String? = nil,
                  node: String = "requested-1") -> String {
        E.prompt(instruction: instruction, ownerRequest: owner, continuation: continuation,
                 answerOnly: E.answerOnly(instruction: instruction, surface: surface, explicitRoutes: explicit),
                 scope: scope, sourceCompletion: sourceCompletion, taskID: taskID, nodeID: node, attemptID: attemptID)
    }

    // ---- Snapshot: the exact Codex child message of the live test ----------
    let snapshot = """
    Do this and answer directly:
    1+1

    Reply with only the final result — no other text.

    Background context only — the owner's full request, given so you understand the work above. Do not act on any other part of it:
    1+1 Codex한테. 2+3 Claude Code한테. 4+5 Claude한테.

    Scope: read_only. Do not spawn a competing orchestration or silently change model/account.

    Internal reference ids for audit (not a task to look up; no tool is needed to use them): RCC task 3a857a4a-0ece-4048-ab90-5d11dff1ac27; child requested-1; attempt 02b1a9e4-0000-4000-8000-000000000001.
    """
    try check(envelope("1+1", surface: .codex) == snapshot, "snapshot: imperative first, owner request as background, ids last")

    // ---- Every provider gets the same envelope -----------------------------
    for (index, route) in routes.enumerated() {
        let node = "requested-\(index + 1)"
        let text = envelope(route.instruction, surface: route.surface, node: node)
        let label = route.surface.rawValue + " " + route.instruction
        try check(text.hasPrefix("Do this and answer directly:\n" + route.instruction + "\n\n"),
                  "\(label): the delegated work leads as a plain imperative")
        try check(count("Reply with only the final result — no other text.", in: text) == 1 &&
                  text.contains(route.instruction + "\n\nReply with only the final result — no other text.\n\n"),
                  "\(label): answer-only line once, directly after the arithmetic instruction")
        guard let background = text.range(of: "Background context only — the owner's full request"),
              let request = text.range(of: owner), let guarantees = text.range(of: E.guaranteeLine),
              let reference = text.range(of: "Internal reference ids for audit (not a task to look up; no tool is needed to use them):") else {
            throw NSError(domain: "RCCDelegatedEnvelopeFixture", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "\(label): section missing"])
        }
        try check(text.range(of: route.instruction)!.lowerBound < background.lowerBound &&
                  background.upperBound <= request.lowerBound && request.upperBound <= guarantees.lowerBound &&
                  guarantees.upperBound <= reference.lowerBound,
                  "\(label): order is work, background owner request, guarantees, references")
        try check(text.components(separatedBy: "\n").last ==
                  "Internal reference ids for audit (not a task to look up; no tool is needed to use them): RCC task \(taskID); child \(node); attempt \(attemptID).",
                  "\(label): the ids are the last line, labeled as references")
        try check(count(taskID, in: text) == 1 && count(attemptID, in: text) == 1 && count("child " + node, in: text) == 1,
                  "\(label): every id still present, exactly once")
        try check(text.contains("Scope: read_only. Do not spawn a competing orchestration or silently change model/account."),
                  "\(label): scope statement and no-orchestration/no-silent-change guarantee kept")
        try check(!text.contains("ORIGINAL OWNER OBJECTIVE") && !text.contains("DELEGATED WORK ONLY"),
                  "\(label): the build 380 owner-first labels are gone")
        // Same bytes for every provider but the instruction and node id.
        try check(text.replacingOccurrences(of: route.instruction + "\n", with: "1+1\n")
                      .replacingOccurrences(of: "child " + node, with: "child requested-1") == snapshot,
                  "\(label): identical envelope for every provider")
    }

    // ---- The answer-only line only for the verifier's family ---------------
    for (instruction, surface, explicit, reason) in [
        ("README.md 요약해줘", C.Surface.codex, [C.ExplicitRoute(surface: .codex, instruction: "README.md 요약해줘")],
         "a non-arithmetic explicit route"),
        ("1+1", .codex, nil, "the same arithmetic in an auto (non-explicit) task"),
        ("1+1", .claude, routes, "an arithmetic route bound to another surface"),
        (" 1+1", .codex, routes, "an instruction that is not the route's exact bytes"),
        ("1+1+1", .codex, [C.ExplicitRoute(surface: .codex, instruction: "1+1+1")], "three operands"),
        ("3*4", .codex, [C.ExplicitRoute(surface: .codex, instruction: "3*4")], "multiplication"),
        ("1+1이 뭐야?", .codex, [C.ExplicitRoute(surface: .codex, instruction: "1+1이 뭐야?")], "arithmetic inside a sentence"),
    ] as [(String, C.Surface, [C.ExplicitRoute]?, String)] {
        let text = envelope(instruction, surface: surface, routes: explicit)
        try check(!E.answerOnly(instruction: instruction, surface: surface, explicitRoutes: explicit) &&
                  !text.contains("Reply with only the final result"), "no answer-only line: " + reason)
        try check(text == E.prompt(instruction: instruction, ownerRequest: owner, answerOnly: false, scope: .readOnly,
                                   taskID: taskID, nodeID: "requested-1", attemptID: attemptID) &&
                  text.hasPrefix("Do this and answer directly:\n" + instruction + "\n\nBackground context only"),
                  "otherwise unchanged envelope: " + reason)
    }

    // ---- A bound source writer: completion rules kept, ids still last ------
    let completion = "\nBOUND OS-1 SOURCE COMPLETION: modify only the delegated source scope."
    let writer = envelope("README.md에 설치 방법 추가해", surface: .codex, routes: nil, scope: .workspaceWrite,
                          sourceCompletion: completion)
    try check(writer.contains("Scope: workspace_write. Do not spawn a competing orchestration or silently change model/account." + completion + "\n\n"),
              "source completion rules follow the guarantees verbatim")
    try check(writer.hasSuffix("\n\nInternal reference ids for audit (not a task to look up; no tool is needed to use them): RCC task \(taskID); child requested-1; attempt \(attemptID)."),
              "ids stay last after the source completion rules")

    // ---- A full-access continuation keeps its own imperative lead ----------
    let resume = "Continue ONLY the non-OS-1 steps blocked by the broad task sandbox, in this SAME native session."
    let continued = envelope("1+1", surface: .codex, continuation: resume)
    try check(continued == resume + "\n\nScope: read_only. " + E.guaranteeLine + "\n\n" + E.referenceLabel +
              " RCC task \(taskID); child requested-1; attempt \(attemptID).",
              "continuation: its own prompt leads, no answer-only line or second background, ids last")

    // ---- The predicate is the exact verifier's family ----------------------
    let corpus: [(String, Bool)] = [
        ("1+1", true), ("2+3", true), ("4+5", true), (" 2 + 3 ", true), ("-4+5", true), ("4+-5", true),
        ("123456789+987654321", true), ("007+1", true), ("4+5\n", true), ("4\u{000B}+5", true),
        ("\t4\u{3000}+\u{FEFF}5\u{2028}", true), ("\u{00A0}4 +\u{202F}5\r\n", true),
        ("", false), ("1", false), ("+1", false), ("1+", false), ("1+1+1", false), ("1-1", false),
        ("3*4", false), ("1.5+1", false), ("1234567890+1", false), ("1+1=", false), ("1+1?", false),
        ("what is 1+1", false), ("1 + 1 please", false), ("--1+1", false), ("1 plus 1", false),
        ("\u{0661}+\u{0661}", false), ("\u{FF11}+\u{FF11}", false), ("1+1\u{0085}", false),
        ("1\u{200B}+1", false), ("1+1\n\n2+2", false),
    ]
    for (instruction, expected) in corpus {
        try check(E.exactArithmeticInstruction(instruction) == expected,
                  "Swift predicate \(expected) for \(instruction.unicodeScalars.map { String($0.value, radix: 16) })")
    }
    let verdicts = try verifierArithmeticVerdicts(corpus.map(\.0))
    try check(verdicts == corpus.map(\.1),
              "the verifier's own JS regex agrees on every corpus case (Node verdicts \(verdicts))")

    print("RCC delegated envelope fixtures: \(checks) checks OK; model calls 0")
}

/// Evaluates rcc-plugin.mjs's own `arithmeticSum` regular expression (the one
/// `verifyExactExplicitArithmetic` calls) in Node on each instruction.
private func verifierArithmeticVerdicts(_ instructions: [String]) throws -> [Bool] {
    let plugin = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Resources/openclaw-os1-bridge/rcc-plugin.mjs")
    let script = #"""
    import {readFileSync} from 'node:fs';
    const source = readFileSync(process.argv[1], 'utf8');
    const literal = [...source.matchAll(/const arithmeticSum = instruction => \{\n  const parts = \/(.+)\/u\.exec\(instruction\);/g)];
    const verifier = source.split('export async function verifyExactExplicitArithmetic(')[1]?.split('\nexport ')[0] ?? '';
    if (literal.length !== 1 || !verifier.includes('arithmeticSum(node.instruction)')) process.exit(3);
    const regex = new RegExp(literal[0][1], 'u');
    process.stdout.write(JSON.stringify(JSON.parse(readFileSync(0, 'utf8')).map(text => regex.exec(text) !== null)));
    """#
    let pinnedNode = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/share/node-v24.20.0/bin/node")
    let process = Process(), input = Pipe(), output = Pipe(), errors = Pipe()
    if let override = ProcessInfo.processInfo.environment["OS1_RCC_CONTRACT_NODE"] { process.executableURL = URL(fileURLWithPath: override) }
    else if FileManager.default.isExecutableFile(atPath: pinnedNode.path) { process.executableURL = pinnedNode }
    else { process.executableURL = URL(fileURLWithPath: "/usr/bin/env") }
    process.arguments = (process.executableURL?.path == "/usr/bin/env" ? ["node"] : []) +
        ["--input-type=module", "-e", script, plugin.path]
    process.standardInput = input; process.standardOutput = output; process.standardError = errors
    try process.run()
    try input.fileHandleForWriting.write(contentsOf: JSONEncoder().encode(instructions))
    try input.fileHandleForWriting.close()
    let bytes = output.fileHandleForReading.readDataToEndOfFile()
    _ = errors.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
    guard process.terminationStatus == 0 else { return [] }
    return (try? JSONDecoder().decode([Bool].self, from: bytes)) ?? []
}
