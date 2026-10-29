import Foundation
import OS1Context

/// K7: the shared os1-closed-arithmetic-v1 vectors (scripts/fixtures/
/// rcc-arithmetic-vectors.json) read from Swift. Every accepted answer is the
/// canonical output the host's "no model call" notice recognises; where the
/// independent legacy closed-task checker also reads a request, it agrees with
/// Core's value; and one real Node run of rcc-runtime.mjs zeroModelArithmetic
/// returns exactly every expected value. No runtime, provider or model starts.
func runRCCExactArithmeticVectorFixtures() throws {
    var checks = 0
    func check(_ pass: Bool, _ label: String) throws {
        guard pass else { throw NSError(domain: "RCCExactArithmeticVectorsFixture", code: 1,
                                        userInfo: [NSLocalizedDescriptionKey: label]) }
        checks += 1
    }
    struct Vector: Decodable { let input: String; let expected: String?; let why: String }
    struct File: Decodable { let schema: Int; let grammar: String; let limits: [String: Int]; let vectors: [Vector] }
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
    let file = try JSONDecoder().decode(File.self,
        from: Data(contentsOf: root.appendingPathComponent("scripts/fixtures/rcc-arithmetic-vectors.json")))
    try check(file.schema == 1 && file.grammar == "os1-closed-arithmetic-v1" && file.vectors.count >= 120,
              "the shared vector file is os1-closed-arithmetic-v1")
    try check(file.limits["output_digits"] == RCCExactArithmeticOutput.maximumDigits,
              "the notice predicate's digit cap is Core's output cap")

    // (i) Every accepted answer gets the notice; no check-in sentence does.
    let accepted = file.vectors.compactMap { vector in vector.expected.map { (vector.input, $0) } }
    try check(accepted.count >= 60 && accepted.count < file.vectors.count, "accepted and abstained vectors both present")
    for (input, expected) in accepted {
        try check(RCCExactArithmeticOutput.isCanonical(expected), "canonical answer \(expected) for \(input)")
    }
    for sentence in ["응, 지금 OS-1 로컬 요청·응답 경로는 살아 있어.", "Yes. This local OS-1 request-and-response path is working.",
                     "", "2.50", "-0", "+2", "01", ".5", "1.", "1e3", "1,000", "2\n", " 2", String(repeating: "9", count: 41)] {
        try check(!RCCExactArithmeticOutput.isCanonical(sentence), "\(sentence.debugDescription) is not a canonical answer")
    }

    // (ii) The legacy closed-task checker has its own grammar (number words,
    // no parentheses); where it reads the same request it must agree.
    var agreed = 0
    for (input, expected) in accepted {
        guard let evaluation = TaskQualityEvidence.evaluateClosedTask(objective: input, output: expected,
            artifactSHA256: String(repeating: "a", count: 64), executionVerified: true) else { continue }
        try check(evaluation.state == .taskContractVerified, "the closed-task checker agrees on \(input) = \(expected)")
        agreed += 1
    }
    try check(agreed >= 20, "the closed-task checker reads many shared vectors (\(agreed))")

    // (iii) The vector file is really shared: Node's Core expression returns it.
    let results = try coreZeroModelArithmetic(file.vectors.map(\.input), runtime: root
        .appendingPathComponent("Resources/openclaw-os1-bridge/rcc-runtime.mjs"))
    try check(results.count == file.vectors.count, "Node evaluated every vector (\(results.count))")
    for (vector, result) in zip(file.vectors, results) {
        try check(result == vector.expected, "Node zeroModelArithmetic(\(vector.input)) = \(result ?? "null")")
    }
    print("RCC exact arithmetic vector fixtures: \(checks) checks OK; model calls 0")
}

/// Runs rcc-runtime.mjs's exported zeroModelArithmetic (the exact expression
/// Core's zero-model site calls) in Node on each input; importing the module
/// starts no runtime.
private func coreZeroModelArithmetic(_ inputs: [String], runtime: URL) throws -> [String?] {
    let script = #"""
    import {readFileSync} from 'node:fs';
    import {pathToFileURL} from 'node:url';
    const {zeroModelArithmetic} = await import(pathToFileURL(process.argv[1]).href);
    (await import(pathToFileURL(process.argv[1]).href)).configureLocalModel('qwen3.5:4b');
    process.stdout.write(JSON.stringify(JSON.parse(readFileSync(0, 'utf8')).map(text => zeroModelArithmetic(text))));
    """#
    let pinnedNode = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/share/node-v24.20.0/bin/node")
    let process = Process(), input = Pipe(), output = Pipe(), errors = Pipe()
    if let override = ProcessInfo.processInfo.environment["OS1_RCC_CONTRACT_NODE"] { process.executableURL = URL(fileURLWithPath: override) }
    else if FileManager.default.isExecutableFile(atPath: pinnedNode.path) { process.executableURL = pinnedNode }
    else { process.executableURL = URL(fileURLWithPath: "/usr/bin/env") }
    process.arguments = (process.executableURL?.path == "/usr/bin/env" ? ["node"] : []) +
        ["--input-type=module", "-e", script, runtime.path]
    process.standardInput = input; process.standardOutput = output; process.standardError = errors
    try process.run()
    try input.fileHandleForWriting.write(contentsOf: JSONEncoder().encode(inputs))
    try input.fileHandleForWriting.close()
    let bytes = output.fileHandleForReading.readDataToEndOfFile()
    _ = errors.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
    guard process.terminationStatus == 0 else { return [] }
    return (try? JSONDecoder().decode([String?].self, from: bytes)) ?? []
}
