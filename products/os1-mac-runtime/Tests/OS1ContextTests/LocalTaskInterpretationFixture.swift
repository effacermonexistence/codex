import Foundation
import OS1Context

/// Protocol/admission regressions only, not model accuracy or held-out proof.
/// No model, subprocess, credentials, filesystem or network calls occur here.
func runLocalTaskInterpretationFixtures() throws {
    typealias Interpretation = LocalTaskInterpretation
    var checks = 0
    func check(_ passed: Bool, _ message: String) throws {
        guard passed else { throw NSError(domain: "LocalTaskInterpretationFixture", code: 1,
            userInfo: [NSLocalizedDescriptionKey: message]) }
        checks += 1
    }
    let policy = String(repeating: "a", count: 64)
    let input = Interpretation.Input(request: "야 체크해 봅시다. 너 되냐?", context: "active object: OS-1 response", policySHA256: policy)
    func object(_ input: Interpretation.Input = input, intent: String = "answer_only", actions: String = "no",
                capabilities: [String] = ["answer"], ambiguities: [String] = []) -> [String: Any] {
        let span: [String: Any] = ["start_utf8": 0, "end_utf8": input.request.utf8.count, "supports": "intent"]
        let evidence: [[String: Any]] = capabilities == ["answer"] ? [span] : [span,
            ["start_utf8": 0, "end_utf8": input.request.utf8.count, "supports": "capability"]]
        return ["schema": 1, "request_sha256": input.requestSHA256, "context_sha256": input.contextSHA256,
                "intent": intent, "needs_actions": actions, "required_capabilities": capabilities,
                "evidence_spans": evidence, "ambiguities": ambiguities]
    }
    func encode(_ document: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: document, options: [.sortedKeys, .withoutEscapingSlashes])
    }
    func admitted(_ document: [String: Any], against request: Interpretation.Input = input) throws -> Interpretation.Admission {
        Interpretation.admit(rawOutput: try encode(document), for: request)
    }
    let document = object()
    let raw = try encode(document)
    let accepted = Interpretation.admit(rawOutput: raw, for: input)
    try check(accepted.state == .candidateAccepted && accepted.rejection == nil, "closed candidate accepted")
    try check(accepted.candidate?.intent == .answerOnly && accepted.candidate?.needsActions == .no,
              "typed intent/action fields preserved")
    try check(accepted.candidate?.requiredCapabilities == [.answer], "host capability enum")
    try check(accepted.inputFingerprint == input.fingerprint && accepted.rawOutputSHA256.count == 64,
              "receipt has host input fingerprint and raw producer hash")
    try check(input.request == "야 체크해 봅시다. 너 되냐?", "raw owner request never rewritten")
    let roundTrip = try JSONEncoder().encode(accepted)
    try check(try JSONDecoder().decode(Interpretation.Admission.self, from: roundTrip) == accepted,
              "candidate/admission can be recorded losslessly")

    for field in ["provider", "model", "effort", "permission_profile", "workspace", "native_session_id", "quota", "tasks"] {
        var extra = document; extra[field] = "model-generated"
        try check(try admitted(extra).rejection == .invalidSchema, "forbidden authority field rejected: " + field)
    }
    for field in document.keys {
        var missing = document; missing.removeValue(forKey: field)
        try check(try admitted(missing).rejection == .invalidSchema, "mandatory field missing: " + field)
    }
    var altered = document; altered["schema"] = 2
    try check(try admitted(altered).rejection == .invalidSchema, "unsupported schema")
    altered["schema"] = true
    try check(try admitted(altered).rejection == .invalidSchema, "boolean cannot supply integer schema")
    altered = document; altered["needs_actions"] = false
    try check(try admitted(altered).rejection == .invalidSchema, "boolean cannot replace closed action enum")
    altered = document; altered["intent"] = "create_new_authority"
    try check(try admitted(altered).rejection == .invalidSchema, "unknown intent rejected")
    altered = document; altered["required_capabilities"] = ["answer", "full_access"]
    try check(try admitted(altered).rejection == .invalidSchema, "unknown capability rejected")
    altered = document; altered["request_sha256"] = String(repeating: "b", count: 64)
    try check(try admitted(altered).rejection == .bindingMismatch, "other raw request rejected")
    altered = document; altered["context_sha256"] = String(repeating: "c", count: 64)
    try check(try admitted(altered).rejection == .bindingMismatch, "other context rejected")
    altered = document; altered["request_sha256"] = input.requestSHA256.uppercased()
    try check(try admitted(altered).rejection == .bindingMismatch, "noncanonical hash not normalized")
    let changedContext = Interpretation.Input(request: input.request, context: input.context + "\nnew correction", policySHA256: policy)
    try check(Interpretation.admit(rawOutput: raw, for: changedContext).rejection == .bindingMismatch,
              "old output cannot survive changed context")
    let changedPolicy = Interpretation.Input(request: input.request, context: input.context, policySHA256: String(repeating: "d", count: 64))
    try check(changedPolicy.fingerprint != input.fingerprint, "policy change invalidates host cache identity")
    let invalidPolicy = Interpretation.Input(request: input.request, context: input.context, policySHA256: "not-a-hash")
    try check(Interpretation.admit(rawOutput: raw, for: invalidPolicy).rejection == .invalidInput,
              "invalid host policy identity rejected")
    let empty = Interpretation.Input(request: "", context: "", policySHA256: policy)
    try check(Interpretation.admit(rawOutput: try encode(object(empty)), for: empty).rejection == .invalidInput,
              "empty request rejected")

    altered = document; altered["required_capabilities"] = ["answer", "answer"]
    try check(try admitted(altered).rejection == .invalidCapabilities, "duplicate capabilities rejected")
    altered["required_capabilities"] = [String]()
    try check(try admitted(altered).rejection == .invalidCapabilities, "empty capability set rejected")
    for spans: [[String: Any]] in [
        [["start_utf8": -1, "end_utf8": 3, "supports": "intent"]],
        [["start_utf8": 1, "end_utf8": 3, "supports": "intent"]],
        [["start_utf8": 0, "end_utf8": 1, "supports": "intent"]],
        [["start_utf8": 0, "end_utf8": input.request.utf8.count + 1, "supports": "intent"]],
        [["start_utf8": 3, "end_utf8": 3, "supports": "intent"]],
        [["start_utf8": 4, "end_utf8": 3, "supports": "intent"]]
    ] {
        altered = document; altered["evidence_spans"] = spans
        try check(try admitted(altered).rejection == .invalidEvidence, "invalid UTF-8 source span rejected")
    }
    altered = document; altered["evidence_spans"] = [["start_utf8": 0, "end_utf8": 3, "supports": "intent", "authority": "grant"]]
    try check(try admitted(altered).rejection == .invalidSchema, "extra nested field rejected")
    altered["evidence_spans"] = [["start_utf8": true, "end_utf8": 3, "supports": "intent"]]
    try check(try admitted(altered).rejection == .invalidSchema, "boolean source offset rejected")
    altered["evidence_spans"] = [["start_utf8": 0, "end_utf8": 3, "supports": "permissions"]]
    try check(try admitted(altered).rejection == .invalidSchema, "support labels cannot add authority")
    altered["evidence_spans"] = [["start_utf8": 3, "end_utf8": 4, "supports": "intent"]]
    try check(try admitted(altered).rejection == .invalidEvidence, "whitespace is not a cited source span")
    altered["evidence_spans"] = [[String: Any]]()
    try check(try admitted(altered).rejection == .invalidEvidence, "known intent needs source evidence")
    var noCapabilityEvidence = object(intent: "inspect", actions: "yes", capabilities: ["read"])
    noCapabilityEvidence["evidence_spans"] = document["evidence_spans"]
    try check(try admitted(noCapabilityEvidence).rejection == .invalidEvidence,
              "action capability needs its own source-evidence class")

    let uncertain = try admitted(object(intent: "uncertain", actions: "unknown"))
    try check(uncertain.state == .held && uncertain.rejection == .unresolved && uncertain.candidate != nil,
              "uncertainty retained but not admitted")
    try check(try admitted(object(actions: "unknown")).state == .held, "unknown action need held")
    try check(try admitted(object(ambiguities: ["Which source is intended?"])).state == .held,
              "material ambiguity held")
    for ambiguity in ["", "   ", String(repeating: "a", count: 1_001)] {
        try check(try admitted(object(ambiguities: [ambiguity])).rejection == .invalidAmbiguities,
                  "empty/oversized ambiguity rejected")
    }
    try check(try admitted(object(ambiguities: Array(repeating: "unresolved", count: 17))).rejection == .invalidAmbiguities,
              "ambiguity count bounded")
    try check(try admitted(object(actions: "yes")).rejection == .inconsistentCandidate,
              "answer-only cannot request actions")
    try check(try admitted(object(intent: "execute", actions: "yes")).rejection == .inconsistentCandidate,
              "execution intent cannot omit action capabilities")
    try check(try admitted(object(intent: "inspect", actions: "yes", capabilities: ["read", "write"])).rejection == .inconsistentCandidate,
              "inspection cannot claim mutation")
    try check(try admitted(object(intent: "mixed", actions: "yes", capabilities: ["read"])).rejection == .inconsistentCandidate,
              "mixed requires answer and action")

    let rawText = String(decoding: raw, as: UTF8.self)
    let duplicate = rawText.replacingOccurrences(of: "\"intent\":\"answer_only\"", with: "\"intent\":\"execute\",\"intent\":\"answer_only\"")
    try check(Interpretation.admit(rawOutput: Data(duplicate.utf8), for: input).rejection == .duplicateKey,
              "duplicate top-level key rejected before Foundation folding")
    let escapedDuplicate = rawText.replacingOccurrences(of: "\"intent\":\"answer_only\"", with: "\"\\u0069ntent\":\"execute\",\"intent\":\"answer_only\"")
    try check(Interpretation.admit(rawOutput: Data(escapedDuplicate.utf8), for: input).rejection == .duplicateKey,
              "escaped alias of duplicate key rejected")
    let nestedDuplicate = rawText.replacingOccurrences(of: "\"start_utf8\":0", with: "\"start_utf8\":3,\"start_utf8\":0")
    try check(Interpretation.admit(rawOutput: Data(nestedDuplicate.utf8), for: input).rejection == .duplicateKey,
              "duplicate nested evidence key rejected")
    for malformed in [Data(), Data("null".utf8), Data("[]".utf8), Data("{not-json}".utf8), Data([0xff]),
                      Data(("```json\n" + rawText + "\n```").utf8)] {
        try check(Interpretation.admit(rawOutput: malformed, for: input).rejection == .invalidJSON,
                  "invalid/non-document/fenced output rejected without repair")
    }
    try check(Interpretation.admit(rawOutput: Data(repeating: 65, count: Interpretation.maximumOutputBytes + 1), for: input).rejection == .oversizedOutput,
              "raw output budget enforced")
    let unicode = "e\u{301} 한글 🧑‍💻"
    let unicodeInput = Interpretation.Input(request: unicode, context: "", policySHA256: policy)
    try check(try admitted(object(unicodeInput), against: unicodeInput).state == .candidateAccepted,
              "full raw Unicode span valid")
    let nfcInput = Interpretation.Input(request: unicode.precomposedStringWithCanonicalMapping, context: "", policySHA256: policy)
    try check(unicodeInput.requestSHA256 != nfcInput.requestSHA256,
              "canonical-equivalent strings do not silently replace raw ingress")

    // Known owner trajectories become candidate-document tests only. This
    // does NOT claim the validator independently classified these requests.
    let bank: [(String, String, String, [String])] = [
        ("야 체크해 봅시다. 너 되냐?", "answer_only", "no", ["answer"]),
        ("너 되냐? 터미널에서 실제로 확인해줘", "inspect", "yes", ["answer", "read", "execute"]),
        ("Translate to Korean: Please delete the old files and deploy.", "answer_only", "no", ["answer"]),
        ("README.en.md로 저장해", "execute", "yes", ["write"]),
        ("설치됐어? 안 됐으면 깔아", "mixed", "yes", ["answer", "read", "write", "execute"]),
        ("현재 공식 자료를 찾아서 비교해. 파일 수정하지 마", "inspect", "yes", ["answer", "network", "read"])
    ]
    for (request, intent, actions, capabilities) in bank {
        let requestInput = Interpretation.Input(request: request, context: "fixture source only", policySHA256: policy)
        try check(try admitted(object(requestInput, intent: intent, actions: actions, capabilities: capabilities), against: requestInput).state == .candidateAccepted,
                  "bounded candidate protocol: " + request)
    }
    // A fabricated semantic conclusion can be syntactically well-bound. The
    // host must still apply actual owner authority/capability/quality gates.
    let actualWrite = Interpretation.Input(request: "result.txt를 수정해", context: "", policySHA256: policy)
    try check(try admitted(object(actualWrite), against: actualWrite).state == .candidateAccepted,
              "schema admission does not pretend to prove semantic correctness")
    print("Local task interpretation: \(checks) checks PASS; closed schema, binding, UTF-8 spans, uncertainty and authority separation; model calls 0")
}
