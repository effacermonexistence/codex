import CryptoKit
import Foundation

/// A local model proposes a semantic task description, not an execution grant.
/// This gate checks its closed document, exact ingress binding and source spans.
/// It does not establish intent correctness, permissions, model choice, account
/// availability, or reference quality. Those remain host/signed-router duties.
public enum LocalTaskInterpretation {
    public static let schemaVersion = 1
    public static let maximumOutputBytes = 16_384

    public enum Intent: String, Codable, Sendable {
        case answerOnly = "answer_only", inspect, execute, mixed, uncertain
    }
    public enum ActionNeed: String, Codable, Sendable { case yes, no, unknown }
    public enum Capability: String, Codable, Sendable, CaseIterable { case answer, read, write, execute, network }
    public enum Support: String, Codable, Sendable { case intent, capability }

    /// Only the host constructs the immutable input. Hash exact UTF-8 bytes:
    /// NFC/NFD, whitespace, context revisions and policy changes stay distinct.
    public struct Input: Encodable, Equatable, Sendable {
        public let request: String
        public let context: String
        public let policySHA256: String
        public let requestSHA256: String
        public let contextSHA256: String

        public init(request: String, context: String, policySHA256: String) {
            self.request = request; self.context = context; self.policySHA256 = policySHA256
            requestSHA256 = LocalTaskInterpretation.digest(Data(request.utf8))
            contextSHA256 = LocalTaskInterpretation.digest(Data(context.utf8))
        }
        public var fingerprint: String {
            let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
            return (try? encoder.encode(self)).map(LocalTaskInterpretation.digest) ?? ""
        }
    }

    public struct EvidenceSpan: Codable, Equatable, Sendable {
        public let startUTF8: Int
        public let endUTF8: Int
        public let supports: Support
        private enum CodingKeys: String, CodingKey {
            case startUTF8 = "start_utf8", endUTF8 = "end_utf8", supports
        }
    }

    /// Decoding/encoding this type alone is NOT admission. Call `admit` with
    /// the original host Input; never use a model-decoded value as authority.
    public struct Candidate: Codable, Equatable, Sendable {
        public let schema: Int
        public let requestSHA256: String
        public let contextSHA256: String
        public let intent: Intent
        public let needsActions: ActionNeed
        public let requiredCapabilities: [Capability]
        public let evidenceSpans: [EvidenceSpan]
        public let ambiguities: [String]
        private enum CodingKeys: String, CodingKey {
            case schema, intent, ambiguities
            case requestSHA256 = "request_sha256", contextSHA256 = "context_sha256"
            case needsActions = "needs_actions", requiredCapabilities = "required_capabilities"
            case evidenceSpans = "evidence_spans"
        }
    }

    public enum Rejection: String, Codable, Sendable {
        case invalidInput = "invalid_input"
        case oversizedOutput = "oversized_output"
        case invalidJSON = "invalid_json"
        case duplicateKey = "duplicate_key"
        case invalidSchema = "invalid_schema"
        case bindingMismatch = "binding_mismatch"
        case invalidCapabilities = "invalid_capabilities"
        case invalidEvidence = "invalid_evidence"
        case invalidAmbiguities = "invalid_ambiguities"
        case inconsistentCandidate = "inconsistent_candidate"
        case unresolved
    }

    public struct Admission: Codable, Equatable, Sendable {
        public enum State: String, Codable, Sendable {
            /// Closed/bound candidate only. NOT verified semantic authority.
            case candidateAccepted = "candidate_accepted", held, rejected
        }
        public let state: State
        public let candidate: Candidate?
        public let rejection: Rejection?
        public let inputFingerprint: String
        public let rawOutputSHA256: String
    }

    public static func admit(rawOutput: Data, for input: Input) -> Admission {
        let fingerprint = input.fingerprint
        let outputHash = digest(rawOutput)
        func result(_ state: Admission.State, _ rejection: Rejection? = nil,
                    _ candidate: Candidate? = nil) -> Admission {
            Admission(state: state, candidate: candidate, rejection: rejection,
                      inputFingerprint: fingerprint, rawOutputSHA256: outputHash)
        }
        guard !input.request.isEmpty, validHash(input.policySHA256), !fingerprint.isEmpty else {
            return result(.rejected, .invalidInput)
        }
        guard rawOutput.count <= maximumOutputBytes else { return result(.rejected, .oversizedOutput) }
        guard !rawOutput.isEmpty, String(data: rawOutput, encoding: .utf8) != nil,
              let object = try? JSONSerialization.jsonObject(with: rawOutput),
              let dictionary = object as? [String: Any] else { return result(.rejected, .invalidJSON) }
        // Foundation's JSON objects otherwise retain one value from duplicate
        // keys. Reject ambiguity before a folded object can become a candidate.
        guard !hasDuplicateKeys(rawOutput) else { return result(.rejected, .duplicateKey) }
        let keys: Set<String> = ["schema", "request_sha256", "context_sha256", "intent", "needs_actions",
                                 "required_capabilities", "evidence_spans", "ambiguities"]
        guard Set(dictionary.keys) == keys,
              let spans = dictionary["evidence_spans"] as? [[String: Any]],
              spans.allSatisfy({ Set($0.keys) == Set(["start_utf8", "end_utf8", "supports"]) }),
              let candidate = try? JSONDecoder().decode(Candidate.self, from: rawOutput),
              candidate.schema == schemaVersion else { return result(.rejected, .invalidSchema) }
        guard validHash(candidate.requestSHA256), validHash(candidate.contextSHA256),
              candidate.requestSHA256 == input.requestSHA256,
              candidate.contextSHA256 == input.contextSHA256 else { return result(.rejected, .bindingMismatch) }
        let capabilities = Set(candidate.requiredCapabilities)
        guard !capabilities.isEmpty, capabilities.count == candidate.requiredCapabilities.count,
              candidate.requiredCapabilities.count <= Capability.allCases.count else {
            return result(.rejected, .invalidCapabilities)
        }
        let bytes = Array(input.request.utf8)
        func boundary(_ index: Int) -> Bool {
            index == bytes.count || (index >= 0 && index < bytes.count && bytes[index] & 0xC0 != 0x80)
        }
        guard candidate.evidenceSpans.count <= 64, candidate.evidenceSpans.allSatisfy({ span in
            span.startUTF8 >= 0 && span.endUTF8 > span.startUTF8 && span.endUTF8 <= bytes.count &&
                boundary(span.startUTF8) && boundary(span.endUTF8) &&
                String(data: Data(bytes[span.startUTF8..<span.endUTF8]), encoding: .utf8)?
                    .trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        }) else { return result(.rejected, .invalidEvidence) }
        guard candidate.ambiguities.count <= 16, candidate.ambiguities.allSatisfy({
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.utf8.count <= 1_000
        }) else { return result(.rejected, .invalidAmbiguities) }
        // A meaningful unresolved branch cannot become an admitted execution
        // requirement. Preserve the parsed candidate for a truthful receipt.
        if candidate.intent == .uncertain || candidate.needsActions == .unknown || !candidate.ambiguities.isEmpty {
            return result(.held, .unresolved, candidate)
        }
        guard candidate.evidenceSpans.contains(where: { $0.supports == .intent }),
              capabilities == [.answer] || candidate.evidenceSpans.contains(where: { $0.supports == .capability }) else {
            return result(.rejected, .invalidEvidence)
        }
        let actionCapabilities = capabilities.subtracting([.answer])
        let consistent: Bool
        switch candidate.intent {
        case .answerOnly:
            consistent = candidate.needsActions == .no && capabilities == [.answer]
        case .inspect:
            consistent = candidate.needsActions == .yes && !actionCapabilities.isEmpty && !capabilities.contains(.write)
        case .execute:
            consistent = candidate.needsActions == .yes && !actionCapabilities.isEmpty
        case .mixed:
            consistent = candidate.needsActions == .yes && capabilities.contains(.answer) && !actionCapabilities.isEmpty
        case .uncertain:
            consistent = false // Already returned as held above.
        }
        guard consistent else { return result(.rejected, .inconsistentCandidate) }
        return result(.candidateAccepted, nil, candidate)
    }

    private static func validHash(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
    private static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// Called only after Foundation has established syntactically valid JSON.
    /// Scan containers and quoted tokens without interpreting values. Decode
    /// key escapes so `intent` and `\u0069ntent` count as the same key.
    private static func hasDuplicateKeys(_ data: Data) -> Bool {
        let bytes = Array(data)
        var containers: [Set<String>?] = []
        var index = 0
        func whitespace(_ byte: UInt8) -> Bool { [9, 10, 13, 32].contains(byte) }
        while index < bytes.count {
            switch bytes[index] {
            case 123: containers.append(Set<String>()); index += 1
            case 91: containers.append(nil); index += 1
            case 125, 93: if !containers.isEmpty { containers.removeLast() }; index += 1
            case 34:
                let start = index
                index += 1
                while index < bytes.count {
                    if bytes[index] == 92 { index += 2; continue }
                    if bytes[index] == 34 { index += 1; break }
                    index += 1
                }
                var next = index
                while next < bytes.count && whitespace(bytes[next]) { next += 1 }
                if next < bytes.count, bytes[next] == 58, !containers.isEmpty,
                   var keys = containers[containers.count - 1],
                   let key = try? JSONDecoder().decode(String.self, from: Data(bytes[start..<index])) {
                    guard keys.insert(key).inserted else { return true }
                    containers[containers.count - 1] = keys
                }
            default: index += 1
            }
        }
        return false
    }
}
