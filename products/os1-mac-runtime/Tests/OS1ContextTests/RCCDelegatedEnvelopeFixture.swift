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
    let references = "Internal reference ids for audit (not a task to look up; no tool is needed to use them):"
    func envelope(_ instruction: String, surface: C.Surface, routes explicit: [C.ExplicitRoute]? = routes,
                  scope: C.Scope = .readOnly, sourceCompletion: String = "", continuation: String? = nil,
                  node: String = "requested-1", ownerRequest: String = owner) -> String {
        E.prompt(instruction: instruction, ownerRequest: ownerRequest, continuation: continuation,
                 answerOnly: E.answerOnly(instruction: instruction, surface: surface, scope: scope, explicitRoutes: explicit),
                 surface: surface, scope: scope, sourceCompletion: sourceCompletion,
                 taskID: taskID, nodeID: node, attemptID: attemptID)
    }
    func background(_ request: String) -> String {
        "--- BACKGROUND: the owner's full request ---\nDo not perform its other parts; its constraints (language, format, length, prohibitions, scope) still apply to your part.\n" +
            request + "\n--- END BACKGROUND ---"
    }

    // ---- Snapshot: the exact Codex child message of the live test ----------
    let snapshot = """
    Do this and answer directly:
    1+1

    Reply with only the final result — no other text.

    Scope: read_only. Do not spawn a competing orchestration or silently change model/account.

    --- BACKGROUND: the owner's full request ---
    Do not perform its other parts; its constraints (language, format, length, prohibitions, scope) still apply to your part.
    1+1 Codex한테. 2+3 Claude Code한테. 4+5 Claude한테.
    --- END BACKGROUND ---

    Internal reference ids for audit (not a task to look up; no tool is needed to use them): RCC task 3a857a4a-0ece-4048-ab90-5d11dff1ac27; child requested-1; attempt 02b1a9e4-0000-4000-8000-000000000001.
    """
    try check(envelope("1+1", surface: .codex) == snapshot,
              "snapshot: imperative first, binding rules, delimited owner background, ids last")

    // ---- Every provider gets the same envelope -----------------------------
    for (index, route) in routes.enumerated() {
        let node = "requested-\(index + 1)"
        let text = envelope(route.instruction, surface: route.surface, node: node)
        let label = route.surface.rawValue + " " + route.instruction
        try check(text.hasPrefix("Do this and answer directly:\n" + route.instruction + "\n\n"),
                  "\(label): the delegated work leads as a plain imperative")
        try check(count("Reply with only the final result — no other text.", in: text) == 1 &&
                  text.contains(route.instruction + "\n\nReply with only the final result — no other text.\n\nScope: read_only. "),
                  "\(label): answer-only line once, directly after the arithmetic instruction and before the rules")
        guard let answerOnly = text.range(of: E.answerOnlyLine), let guarantees = text.range(of: E.guaranteeLine),
              let start = text.range(of: "--- BACKGROUND: the owner's full request ---"),
              let request = text.range(of: owner), let end = text.range(of: "--- END BACKGROUND ---"),
              let reference = text.range(of: references) else {
            throw NSError(domain: "RCCDelegatedEnvelopeFixture", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "\(label): section missing"])
        }
        try check(text.range(of: route.instruction)!.lowerBound < answerOnly.lowerBound &&
                  answerOnly.upperBound <= guarantees.lowerBound && guarantees.upperBound <= start.lowerBound &&
                  start.upperBound <= request.lowerBound && request.upperBound <= end.lowerBound &&
                  end.upperBound <= reference.lowerBound,
                  "\(label): order is work, answer-only, rules, delimited background owner request, references")
        try check(text.components(separatedBy: "\n").last ==
                  references + " RCC task \(taskID); child \(node); attempt \(attemptID).",
                  "\(label): the ids are the last line, labeled as references")
        try check(count(taskID, in: text) == 1 && count(attemptID, in: text) == 1 && count("child " + node, in: text) == 1,
                  "\(label): every id still present, exactly once")
        try check(text.contains("Scope: read_only. Do not spawn a competing orchestration or silently change model/account."),
                  "\(label): scope statement and no-orchestration/no-silent-change guarantee kept")
        try check(!text.contains("ORIGINAL OWNER OBJECTIVE") && !text.contains("DELEGATED WORK ONLY") &&
                  !text.contains("Background context only") && !text.contains("Do not act on any other part"),
                  "\(label): the build 380 owner-first labels and the non-actionable background label are gone")
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
        ("3/4", .codex, [C.ExplicitRoute(surface: .codex, instruction: "3/4")], "division (not in the verifier's family)"),
        ("1+1이 뭐야?", .codex, [C.ExplicitRoute(surface: .codex, instruction: "1+1이 뭐야?")], "arithmetic inside a sentence"),
    ] as [(String, C.Surface, [C.ExplicitRoute]?, String)] {
        let text = envelope(instruction, surface: surface, routes: explicit)
        try check(!E.answerOnly(instruction: instruction, surface: surface, scope: .readOnly, explicitRoutes: explicit) &&
                  !text.contains("Reply with only the final result"), "no answer-only line: " + reason)
        try check(text == E.prompt(instruction: instruction, ownerRequest: owner, answerOnly: false, surface: surface,
                                   scope: .readOnly, taskID: taskID, nodeID: "requested-1", attemptID: attemptID) &&
                  text.hasPrefix("Do this task:\n" + instruction + "\n\nScope: read_only. " + E.guaranteeLine + "\n\n" +
                                 background(owner) + "\n\n" + references),
                  "neutral task lead, otherwise unchanged envelope: " + reason)
    }

    // ---- An explicit arithmetic route on its own surface, but a writer -----
    // verifyExactExplicitArithmetic rejects any scope but read_only, so the
    // writer is outside the verifier's family: no answer-only line, no direct
    // lead, and its completion rules are never contradicted.
    let completion = "\nBOUND OS-1 SOURCE COMPLETION: modify only the delegated source scope. When source changes are ready, run appropriate checks, make the bundle/runtime identity version-ready above the installed build, and create an authorized LOCAL commit of only this task's changes."
    let arithmeticWriter = envelope("1+1", surface: .codex, scope: .workspaceWrite, sourceCompletion: completion)
    try check(!E.answerOnly(instruction: "1+1", surface: .codex, scope: .workspaceWrite, explicitRoutes: routes) &&
              !arithmeticWriter.contains("Reply with only the final result") &&
              arithmeticWriter.hasPrefix("Do this task:\n1+1\n\nScope: workspace_write. " + E.guaranteeLine + completion + "\n\n"),
              "explicit arithmetic writer: no answer-only line, neutral lead, completion rules right after the work")
    try check(!E.prompt(instruction: "1+1", ownerRequest: owner, answerOnly: true, surface: .codex, scope: .workspaceWrite,
                        taskID: taskID, nodeID: "requested-1", attemptID: attemptID).contains("Reply with only the final result"),
              "the envelope itself ignores answerOnly for a writer scope")

    // ---- Lead by scope and answer family -----------------------------------
    let lookup = envelope("README.md 요약해줘", surface: .codex, routes: nil)
    try check(lookup.hasPrefix("Do this task:\nREADME.md 요약해줘\n\n") && !lookup.contains("answer directly"),
              "a read-only task that has to read files gets the neutral task lead")
    for chat in [C.Surface.claudeChat, .gptChat] {
        let text = envelope("양자컴퓨터가 뭐야?", surface: chat, routes: nil)
        try check(E.directAnswer(answerOnly: false, surface: chat, scope: .readOnly) &&
                  text.hasPrefix("Do this and answer directly:\n양자컴퓨터가 뭐야?\n\nScope: read_only. ") &&
                  !text.contains("Reply with only the final result"),
                  chat.rawValue + ": a tool-free chat lane answers directly, without the answer-only line")
    }
    try check(!E.directAnswer(answerOnly: false, surface: .codex, scope: .readOnly) &&
              !E.directAnswer(answerOnly: false, surface: .claude, scope: .readOnly) &&
              !E.directAnswer(answerOnly: true, surface: .codex, scope: .workspaceWrite) &&
              !E.directAnswer(answerOnly: false, surface: .claudeChat, scope: .workspaceWrite),
              "the direct lead never reaches a tool lane's ordinary child or a writer")

    // ---- A bound source writer: rules after the work, background delimited -
    let paragraphs = "README.md에 설치 방법 추가해.\n\n설치는 Homebrew 기준으로.\n\n다른 파일은 건드리지 마."
    let writer = envelope("README.md에 설치 방법 추가해", surface: .codex, routes: nil, scope: .workspaceWrite,
                          sourceCompletion: completion, ownerRequest: paragraphs)
    try check(writer == "Do this task:\nREADME.md에 설치 방법 추가해\n\nScope: workspace_write. " + E.guaranteeLine + completion +
              "\n\n" + background(paragraphs) + "\n\n" + references +
              " RCC task \(taskID); child requested-1; attempt \(attemptID).",
              "writer: neutral lead, scope/guarantee/completion rules directly after the work, then the background")
    guard let completionAt = writer.range(of: "BOUND OS-1 SOURCE COMPLETION"),
          let backgroundAt = writer.range(of: "--- BACKGROUND: the owner's full request ---"),
          let endAt = writer.range(of: "--- END BACKGROUND ---") else {
        throw NSError(domain: "RCCDelegatedEnvelopeFixture", code: 3, userInfo: [NSLocalizedDescriptionKey: "writer section missing"])
    }
    try check(completionAt.upperBound <= backgroundAt.lowerBound &&
              writer[backgroundAt.upperBound..<endAt.lowerBound] == "\n" + E.backgroundRule + "\n" + paragraphs + "\n",
              "a multi-paragraph owner request stays inside its markers; no binding rule follows it")
    try check(writer.hasSuffix("--- END BACKGROUND ---\n\n" + references + " RCC task \(taskID); child requested-1; attempt \(attemptID)."),
              "ids stay last, after the closed background")

    // ---- Owner-wide constraints stay binding on a planner's node -----------
    let summaries = "README.md와 CHANGELOG.md 각각 요약해. 둘 다 영어로 세 줄 이내로, 파일은 건드리지 마."
    let node = envelope("Summarize README.md", surface: .claude, routes: nil, ownerRequest: summaries)
    try check(E.backgroundRule.contains("Do not perform its other parts") &&
              E.backgroundRule.contains("its constraints (language, format, length, prohibitions, scope) still apply to your part") &&
              !E.backgroundRule.contains("Do not act on any other part") && !E.backgroundRule.contains("context only"),
              "the background forbids the other parts but keeps the owner's constraints binding")
    try check(node.contains(background(summaries)) && node.hasPrefix("Do this task:\nSummarize README.md\n\n"),
              "a planner node sees the owner's language/length/no-touch constraints as binding background")

    // ---- A full-access continuation keeps its own imperative lead ----------
    let resume = "Continue ONLY the non-OS-1 steps blocked by the broad task sandbox, in this SAME native session."
    let continued = envelope("1+1", surface: .codex, continuation: resume)
    try check(continued == resume + "\n\nScope: read_only. " + E.guaranteeLine + "\n\n" + E.referenceLabel +
              " RCC task \(taskID); child requested-1; attempt \(attemptID).",
              "continuation: its own prompt leads, no answer-only line or background, ids last")

    // ---- The exact-answer presentation contract (developer/system channel) -
    let exactContract = HumanOutputContract.exactAnswerInstructions
    for provider in ["codex", "claude"] {
        try check(HumanOutputContract.instructions(for: "1+1", provider: provider, exactAnswer: true) == exactContract &&
                  HumanOutputContract.instructions(for: "1+1", provider: provider) != exactContract,
                  provider + ": the exact-answer contract replaces the ordinary contract only when asked")
    }
    try check(["Lead with the result in natural language", "meaningful headings", "Use clear paragraphs", "never less coverage"]
                .allSatisfy { !exactContract.contains($0) } &&
              exactContract.contains("Reply with only the final result and no other text") &&
              exactContract.contains("Conclusion / Core reason / Breaking variable"),
              "the exact-answer contract carries no natural-language/headings layout and outranks the default layout")

    // ---- The predicate is the exact verifier's family ----------------------
    let corpus: [(String, Bool)] = [
        ("1+1", true), ("2+3", true), ("4+5", true), (" 2 + 3 ", true), ("-4+5", true), ("4+-5", true),
        ("123456789+987654321", true), ("007+1", true), ("4+5\n", true), ("4\u{000B}+5", true),
        ("\t4\u{3000}+\u{FEFF}5\u{2028}", true), ("\u{00A0}4 +\u{202F}5\r\n", true),
        ("1-1", true), ("3*4", true), ("5-1", true), ("6 * 2", true), ("9--10", true), ("-3*-4", true),
        ("", false), ("1", false), ("+1", false), ("1+", false), ("1+1+1", false), ("1/2", false), ("3x4", false),
        ("3×4", false), ("1--", false), ("1.5+1", false), ("1234567890+1", false), ("1+1=", false), ("1+1?", false),
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

/// Evaluates rcc-plugin.mjs's own `arithmeticResult` regular expression (the one
/// `verifyExactExplicitArithmetic` calls) in Node on each instruction.
private func verifierArithmeticVerdicts(_ instructions: [String]) throws -> [Bool] {
    let plugin = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Resources/openclaw-os1-bridge/rcc-plugin.mjs")
    let script = #"""
    import {readFileSync} from 'node:fs';
    const source = readFileSync(process.argv[1], 'utf8');
    const literal = [...source.matchAll(/export const arithmeticResult = instruction => \{\n  const parts = \/(.+)\/u\.exec\(instruction\);/g)];
    const verifier = source.split('export async function verifyExactExplicitArithmetic(')[1]?.split('\nexport ')[0] ?? '';
    if (literal.length !== 1 || !verifier.includes('arithmeticResult(node.instruction)')) process.exit(3);
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
