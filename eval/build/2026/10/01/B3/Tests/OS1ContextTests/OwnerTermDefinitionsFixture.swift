import Foundation
import OS1Context

/// Owner-term definitions: which request terms get the original's own
/// definition, and what stays out. Synthetic policy text only.
func runOwnerTermDefinitionsFixtures() throws {
    var checks = 0
    func check(_ value: @autoclosure () -> Bool, _ label: String) { precondition(value(), label); checks += 1 }
    let bar = String(repeating: "=", count: 60)
    let filler = (0..<40).map { "Unrelated guidance line \($0) about ordinary work." }.joined(separator: "\n")
    let source = """
    CORE OPERATION
    Lock the object first.

    \(bar)
    PART 3B — ZETA / TRIAL LOGIC UPDATE
    \(bar)
    ZETA is the owner's trial benchmark family.
    Wrong-row-only law:
    Rerun only rows that were wrong, with the floor locked.

    \(bar)
    PART 3C — BETA-BLIND PROOF CORRECTION
    \(bar)
    Proof field definitions:

    alpha_visible_ceiling:
    Best-of chosen with the grader visible. Diagnostic only.

    alpha_final_score:
    Final sheet locked before any grade is seen.

    \(filler)

    \(bar)
    2. FAILURE TAXONOMY
    \(bar)
    Parent failure class

    OMICRON STATE DRIFT

    Definition:
    The system treats a local view as the whole state.

    kappa_B (baseline kept, final changed) = floor alarm.

    \(bar)
    PART 9 — LONG SECTION
    \(bar)
    \(String(repeating: "Padding sentence for a long section.\n", count: 200))delta_marker:
    Defined deep inside a long section.

    \(bar)
    REGRESSION FIXTURE — OVERLOADED ACRONYM
    \(bar)
    ZETA = a later, local reuse of the acronym.
    """
    let covered = "Routing adapter.\nCORE OPERATION\nLock the object first. The OMEGA rule applies."

    let both = OwnerTermDefinitions.excerpts(
        prompt: "OMEGA에서 beta-blind final lock이 왜 필요해? alpha_visible_ceiling이랑 차이도.", source: source, covered: covered)
    check(both.count == 1 && both[0].heading.hasPrefix("PART 3C") && Set(both[0].terms) == ["alpha_visible_ceiling", "beta-blind"],
          "two terms defined in one section share one excerpt")
    check(both[0].text.contains("Best-of chosen with the grader visible."), "the excerpt carries the definition itself")
    check(OwnerTermDefinitions.directive(prompt: "OMEGA 규칙 설명해", source: source, covered: covered).isEmpty,
          "a term the projection already covers adds nothing")

    for ordinary in ["바다와 호수의 차이를 스무 항목으로 설명해.",
                     "model_instructions_file 설정은 어떻게 해?",
                     "self-update stage가 read-only에서 왜 막혀? OS-1 코드 기준으로."] {
        check(OwnerTermDefinitions.directive(prompt: ordinary, source: source, covered: covered).isEmpty,
              "no owner term, nothing attached: \(ordinary)")
    }

    let acronym = OwnerTermDefinitions.excerpts(prompt: "ZETA 점수 올랐네", source: source, covered: covered)
    check(acronym.count == 1 && acronym[0].heading.hasPrefix("PART 3B"), "the earliest definition wins over a later local reuse")
    let label = OwnerTermDefinitions.excerpts(prompt: "wrong-row-only는 언제 유효해?", source: source, covered: covered)
    check(label.count == 1 && label[0].text.contains("Rerun only rows"), "a label line with trailing words defines its term")
    check(OwnerTermDefinitions.excerpts(prompt: "alpha_visible 얘기야", source: source, covered: covered).isEmpty,
          "a prefix of a defined term is not that term")

    let phrase = OwnerTermDefinitions.excerpts(prompt: "OMICRON STATE DRIFT가 뭐야?", source: source, covered: covered)
    check(phrase.count == 1 && phrase[0].terms == ["OMICRON STATE DRIFT"] && phrase[0].text.contains("treats a local view"),
          "a capitalized phrase is one term, defined by the Definition that follows it")
    check(OwnerTermDefinitions.candidateTerms(in: "OMICRON STATE DRIFT 말고 ZETA") == ["OMICRON STATE DRIFT", "ZETA"],
          "words inside a phrase are not separate terms")
    let parenthetical = OwnerTermDefinitions.excerpts(prompt: "kappa_B가 뭐야?", source: source, covered: covered)
    check(parenthetical.count == 1 && parenthetical[0].text.contains("= floor alarm"), "a label may carry a parenthetical")

    let deep = OwnerTermDefinitions.excerpts(prompt: "delta_marker가 뭐야?", source: source, covered: covered)
    check(deep.count == 1 && deep[0].heading == "delta_marker:" && deep[0].text.contains("Defined deep inside")
          && !deep[0].text.contains("PART 9"), "a definition deep in a long section is quoted and labelled around itself")

    let many = OwnerTermDefinitions.excerpts(prompt: "ZETA, alpha_final_score, delta_marker, 그리고 wrong-row-only",
                                             source: source, covered: covered)
    check(many.count <= OwnerTermDefinitions.maximumExcerpts
          && many.reduce(0) { $0 + $1.text.count } <= OwnerTermDefinitions.maximumCharacters, "bounded count and size")

    let directive = OwnerTermDefinitions.directive(prompt: "alpha_final_score가 뭐야", source: source, covered: covered)
    check(directive.contains("[EXACT SOURCE EXCERPT: PART 3C") && directive.contains("do not describe these terms as undefined"),
          "labelled exact excerpt with its authority")

    // Through the snapshot: only a digest-matching original is quoted.
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-terms-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let data = Data(source.utf8)
    let digest = OwnerPolicySnapshot.digest(data)
    try data.write(to: root.appendingPathComponent(digest + ".txt"))
    let record: [String: Any] = ["schema": 1, "sourceSHA256": digest, "sourceFile": digest + ".txt",
        "projectionSHA256": OwnerPolicySnapshot.digest(Data("route\n\(covered)".utf8)),
        "routing": "route", "projection": covered, "sourceID": "fixture", "sourceModified": "1",
        "checkedAt": Date().timeIntervalSince1970]
    try JSONSerialization.data(withJSONObject: record).write(to: root.appendingPathComponent("active.json"))
    let snapshot = try OwnerPolicySnapshot.load(root: root)!
    check(snapshot.termDefinitions(for: "alpha_final_score가 뭐야", root: root).contains("Final sheet locked"), "snapshot quotes its original")
    try Data((source + "\nedited").utf8).write(to: root.appendingPathComponent(digest + ".txt"))
    check(snapshot.termDefinitions(for: "alpha_final_score가 뭐야", root: root).isEmpty, "a changed original is never quoted")
    print("Owner term definitions: \(checks) checks passed")
}
