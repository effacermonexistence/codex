import CryptoKit
import Foundation

/// Quality evidence is independent of transport success and model prose. The
/// host constructs these objects from an explicitly trusted pre-dispatch
/// contract and observed checker/artifact receipts, never from an answer's
/// assertion that it passed tests or matched a reference.
public enum TaskQualityEvidence {
    public enum State: String, Codable, Sendable {
        case executionOnly = "execution_only"
        case taskContractVerified = "task_contract_verified"
        case referenceEquivalent = "reference_equivalent"
        case referenceAbove = "reference_above"
        case mismatch, unverified
    }
    public enum ProofMode: String, Codable, Sendable { case dev, proof, ownerAccepted = "owner_accepted" }
    public enum ContractBasis: String, Codable, Sendable { case declaredTrustedContract = "declared_trusted_contract" }
    public enum ReceiptBasis: String, Codable, Sendable {
        case observedCheckerReceipt = "observed_checker_receipt"
        case ownerAcceptedReceipt = "owner_accepted_receipt"
    }
    public enum CheckStatus: String, Codable, Sendable { case passed, failed, unverified }

    /// The host's declared reference, including the actual instruction setup.
    /// A reference-profile execution is not automatically a parity result.
    public struct ReferenceProfile: Codable, Equatable, Sendable {
        public var provider: String
        public var model: String
        public var effort: String
        public var instructionsSHA256: String
        public init(provider: String, model: String, effort: String, instructionsSHA256: String) {
            self.provider = provider; self.model = model; self.effort = effort; self.instructionsSHA256 = instructionsSHA256
        }
    }
    public struct Score: Codable, Equatable, Sendable {
        public var checkID: String
        /// Higher is better under the explicitly declared criterion. No
        /// normalization, tolerance or aggregation is introduced by this gate.
        public var value: Double
        public init(checkID: String, value: Double) { self.checkID = checkID; self.value = value }
    }
    public struct Reference: Codable, Equatable, Sendable {
        public var profile: ReferenceProfile
        public var objectiveSHA256: String
        public var contextSHA256: String
        public var sourceSHA256: String?
        public var startTreeSHA256: String
        public var verifierCodeSHA256: String
        public var referencePolicySHA256: String
        public var artifactSHA256s: [String]
        public var scores: [Score]
        public var measuredAt: Date
        public var validUntil: Date
        public var proofMode: ProofMode
        public init(profile: ReferenceProfile, objectiveSHA256: String, contextSHA256: String,
                    sourceSHA256: String?, startTreeSHA256: String, verifierCodeSHA256: String,
                    referencePolicySHA256: String, artifactSHA256s: [String], scores: [Score],
                    measuredAt: Date, validUntil: Date, proofMode: ProofMode) {
            self.profile = profile; self.objectiveSHA256 = objectiveSHA256; self.contextSHA256 = contextSHA256
            self.sourceSHA256 = sourceSHA256; self.startTreeSHA256 = startTreeSHA256
            self.verifierCodeSHA256 = verifierCodeSHA256; self.referencePolicySHA256 = referencePolicySHA256
            self.artifactSHA256s = artifactSHA256s; self.scores = scores; self.measuredAt = measuredAt
            self.validUntil = validUntil; self.proofMode = proofMode
        }
    }
    /// Locked before dispatch. fullCoverage must be explicitly declared by
    /// the trusted contract owner; it is deliberately not a default or a model
    /// estimate inferred from a generic test-suite pass.
    public struct Contract: Codable, Equatable, Sendable {
        public var schema: Int = 1
        public var basis: ContractBasis
        public var objectiveSHA256: String
        public var contextSHA256: String
        public var sourceSHA256: String?
        public var startTreeSHA256: String
        public var scope: TaskContext.Scope
        public var verifierCodeSHA256: String
        public var referencePolicySHA256: String
        public var requiredCheckIDs: [String]
        public var fullCoverage: Bool
        public var referenceProfiles: [ReferenceProfile]
        public var reference: Reference?
        public var issuedAt: Date
        public var validUntil: Date
        public init(basis: ContractBasis, objectiveSHA256: String, contextSHA256: String,
                    sourceSHA256: String?, startTreeSHA256: String, scope: TaskContext.Scope,
                    verifierCodeSHA256: String, referencePolicySHA256: String, requiredCheckIDs: [String],
                    fullCoverage: Bool, referenceProfiles: [ReferenceProfile], reference: Reference?,
                    issuedAt: Date, validUntil: Date) {
            self.basis = basis; self.objectiveSHA256 = objectiveSHA256; self.contextSHA256 = contextSHA256
            self.sourceSHA256 = sourceSHA256; self.startTreeSHA256 = startTreeSHA256; self.scope = scope
            self.verifierCodeSHA256 = verifierCodeSHA256; self.referencePolicySHA256 = referencePolicySHA256
            self.requiredCheckIDs = requiredCheckIDs; self.fullCoverage = fullCoverage
            self.referenceProfiles = referenceProfiles; self.reference = reference; self.issuedAt = issuedAt; self.validUntil = validUntil
        }
        public var sha256: String {
            let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
            encoder.dateEncodingStrategy = .millisecondsSince1970
            return (try? encoder.encode(self)).map(TaskQualityEvidence.digest) ?? ""
        }
    }

    /// The exact observed result. The runtime supplies these fields from its
    /// actual artifact and input snapshots, not from a candidate description.
    public struct Binding: Codable, Equatable, Sendable {
        public var objectiveSHA256: String
        public var contextSHA256: String
        public var sourceSHA256: String?
        public var startTreeSHA256: String
        public var scope: TaskContext.Scope
        public var executionID: String
        public var turnID: String
        public var outputSHA256: String
        public var workspaceAfterSHA256: String
        public var artifactSHA256: String
        public init(objectiveSHA256: String, contextSHA256: String, sourceSHA256: String?, startTreeSHA256: String,
                    scope: TaskContext.Scope, executionID: String, turnID: String, outputSHA256: String,
                    workspaceAfterSHA256: String, artifactSHA256: String) {
            self.objectiveSHA256 = objectiveSHA256; self.contextSHA256 = contextSHA256; self.sourceSHA256 = sourceSHA256
            self.startTreeSHA256 = startTreeSHA256; self.scope = scope; self.executionID = executionID; self.turnID = turnID
            self.outputSHA256 = outputSHA256; self.workspaceAfterSHA256 = workspaceAfterSHA256; self.artifactSHA256 = artifactSHA256
        }
    }
    public struct Check: Codable, Equatable, Sendable {
        public var checkID: String
        public var status: CheckStatus
        public var score: Double?
        public var observedReceiptSHA256: String?
        public init(checkID: String, status: CheckStatus, score: Double?, observedReceiptSHA256: String?) {
            self.checkID = checkID; self.status = status; self.score = score; self.observedReceiptSHA256 = observedReceiptSHA256
        }
    }
    public struct Receipt: Codable, Equatable, Sendable {
        public var schema: Int = 1
        public var basis: ReceiptBasis
        public var contractSHA256: String
        public var binding: Binding
        public var checkerIdentitySHA256: String
        public var observedReceiptSHA256: String
        public var checks: [Check]
        public var observedAt: Date
        public init(basis: ReceiptBasis, contractSHA256: String, binding: Binding, checkerIdentitySHA256: String,
                    observedReceiptSHA256: String, checks: [Check], observedAt: Date) {
            self.basis = basis; self.contractSHA256 = contractSHA256; self.binding = binding
            self.checkerIdentitySHA256 = checkerIdentitySHA256; self.observedReceiptSHA256 = observedReceiptSHA256
            self.checks = checks; self.observedAt = observedAt
        }
    }
    public struct ObservedArtifact: Codable, Equatable, Sendable {
        public var binding: Binding
        public var executionVerified: Bool
        public init(binding: Binding, executionVerified: Bool) { self.binding = binding; self.executionVerified = executionVerified }
    }
    public struct Evaluation: Codable, Equatable, Sendable {
        public var state: State
        public var reason: String
        public var contractSHA256: String
        public var artifactSHA256: String
        public var requiredCheckIDs: [String]
        public var failedCheckIDs: [String]
        /// A gate result never authorizes deleting, blanking or hiding the
        /// result artifact, including mismatch and unresolved evaluations.
        public var preservesArtifact: Bool = true
        public init(state: State, reason: String, contractSHA256: String, artifactSHA256: String,
                    requiredCheckIDs: [String], failedCheckIDs: [String], preservesArtifact: Bool = true) {
            self.state = state; self.reason = reason; self.contractSHA256 = contractSHA256; self.artifactSHA256 = artifactSHA256
            self.requiredCheckIDs = requiredCheckIDs; self.failedCheckIDs = failedCheckIDs; self.preservesArtifact = preservesArtifact
        }
        public var taskCompletionVerified: Bool {
            [.taskContractVerified, .referenceEquivalent, .referenceAbove].contains(state)
        }
        public var referenceParityVerified: Bool { [.referenceEquivalent, .referenceAbove].contains(state) }
    }

    /// Built-in exact-fit specification check used by the ordinary host path.
    /// It covers only a whole literal-response request or a finite exact
    /// Decimal expression. Additional implementation/source/effect obligations
    /// abstain. No reference comparison, model claim or guessed coverage enters
    /// this path; the host independently binds/preserves the actual artifact.
    public static func evaluateClosedTask(objective: String, output: String, artifactSHA256: String,
                                          executionVerified: Bool) -> Evaluation? {
        let request = objective.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines)
        let literal = captures(#"^(?:print|reply|respond|output|return)\s+(?:with\s+)?exactly\s+([A-Za-z0-9_.:-]{1,128}?)(?:\s+and\s+nothing\s+else)?\s*[.!]?\s*$"#, request, insensitive: true)?.first
        let expression = literal == nil ? closedExpression(request, requestFraming: true) : nil
        guard literal != nil || expression != nil else { return nil }
        let checkID = literal != nil ? "closed.literal.output" : "closed.decimal.output"
        let contractSHA = digest(Data(("task-quality-closed-v1\u{0}" + checkID + "\u{0}" + digest(Data(request.utf8))).utf8))
        func assessment(_ state: State, _ reason: String) -> Evaluation {
            Evaluation(state: state, reason: reason, contractSHA256: contractSHA, artifactSHA256: artifactSHA256,
                requiredCheckIDs: [checkID], failedCheckIDs: state == .mismatch ? [checkID] : [])
        }
        guard executionVerified, digestString(artifactSHA256) else { return assessment(.unverified, "closed_spec_artifact_execution_unverified") }
        let matched: Bool
        if let literal {
            matched = output.trimmingCharacters(in: .whitespacesAndNewlines) == literal
        } else if let expression {
            matched = closedArithmeticOutput(output, expression: expression)
        } else { return nil }
        return assessment(matched ? .taskContractVerified : .mismatch,
            matched ? "built_in_closed_whole_spec_verified_not_reference_parity" : "built_in_closed_whole_spec_mismatch")
    }

    private struct ClosedExpression {
        var operands: [Decimal]
        var operators: [String]
        var value: Decimal
    }
    private static func captures(_ pattern: String, _ value: String, insensitive: Bool = false) -> [String]? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: insensitive ? [.caseInsensitive] : []),
              let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)),
              match.range == NSRange(value.startIndex..., in: value) else { return nil }
        return (1..<match.numberOfRanges).map { index in
            Range(match.range(at: index), in: value).map { String(value[$0]) } ?? ""
        }
    }
    private static func replace(_ pattern: String, _ value: String, _ replacement: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return value }
        return regex.stringByReplacingMatches(in: value, range: NSRange(value.startIndex..., in: value), withTemplate: replacement)
    }
    private static func closedExpression(_ input: String, requestFraming: Bool) -> ClosedExpression? {
        guard input.count <= 240, !input.contains("\n"), !input.contains("\r") else { return nil }
        var text = input.precomposedStringWithCanonicalMapping.lowercased().trimmingCharacters(in: .whitespaces)
        if requestFraming {
            text = replace(#"^(?:use|run|ask)\s+(?:codex|claude)(?:\s+to)?[.:,]?\s*"#, text, "")
            text = replace(#"^(?:코덱스|클로드)(?:로|에게|한테)\s*"#, text, "")
            text = replace(#"^(?:what is|what's|calculate|compute|evaluate)\s+"#, text, "")
            text = replace(#"^(?:(?:야|어|그럼)\s+)+"#, text, "")
            text = replace(#"(?:이|은|는)?\s*(?:뭐야|뭔데|얼마야|몇이야|계산해(?:줘)?|구해(?:줘)?|알려줘)\s*[?!.]*$"#, text, "")
            text = text.trimmingCharacters(in: CharacterSet(charactersIn: " ?!"))
            if text.hasSuffix(".") { text.removeLast() }
        }
        for (pattern, value) in [(#"\bdivided\s+by\b"#, "/"), (#"\bmultiplied\s+by\b"#, "*"),
            (#"\bplus\b"#, "+"), (#"\bminus\b"#, "-"), (#"\btimes\b"#, "*"),
            (#"플\s*러\s*스|플\s*래\s*스|플\s*레\s*스|플\s*렉\s*스|(?:더|도|덧)\s*하\s*기|덕\s*이|더\s*기"#, "+"),
            (#"마\s*이\s*너\s*스|빼\s*기"#, "-"), (#"곱\s*하\s*기|곱\s*해"#, "*"),
            (#"나\s*누\s*기|나\s*눠"#, "/"), ("×", "*"), ("÷", "/")] {
            text = replace(pattern, text, value)
        }
        let words = ["zero":"0", "one":"1", "two":"2", "three":"3", "four":"4", "five":"5", "six":"6", "seven":"7", "eight":"8", "nine":"9", "ten":"10",
            "영":"0", "공":"0", "원":"1", "일":"1", "하나":"1", "이":"2", "둘":"2", "삼":"3", "셋":"3", "사":"4", "넷":"4", "오":"5", "육":"6", "칠":"7", "팔":"8", "구":"9", "십":"10"]
        let names = words.keys.sorted { $0.count > $1.count }.map(NSRegularExpression.escapedPattern(for:)).joined(separator: "|")
        let number = #"[+-]?\d+(?:\.\d+)?"#
        let operand = "(?:" + number + "|" + names + ")"
        guard captures("^(?:" + operand + ")(?:\\s*[+\\-*/]\\s*(?:" + operand + "))+$", text) != nil else { return nil }
        guard let lexer = try? NSRegularExpression(pattern: "\\s*(" + operand + ")\\s*([+\\-*/]|$)") else { return nil }
        let tokens = lexer.matches(in: text, range: NSRange(text.startIndex..., in: text))
        guard (2...32).contains(tokens.count) else { return nil }
        var operands: [Decimal] = [], operators: [String] = []
        for token in tokens {
            guard let range = Range(token.range(at: 1), in: text) else { return nil }
            let raw = String(text[range])
            guard let number = Decimal(string: words[raw] ?? raw, locale: Locale(identifier: "en_US_POSIX")), !number.isNaN else { return nil }
            operands.append(number)
            if let operatorRange = Range(token.range(at: 2), in: text), !operatorRange.isEmpty { operators.append(String(text[operatorRange])) }
        }
        guard operators.count == operands.count - 1 else { return nil }
        var terms = [operands[0]], sums: [String] = []
        for index in operators.indices {
            let op = operators[index]
            if op == "*" || op == "/" {
                guard let value = exactDecimal(terms.removeLast(), operands[index + 1], op) else { return nil }
                terms.append(value)
            } else { sums.append(op); terms.append(operands[index + 1]) }
        }
        var value = terms[0]
        for index in sums.indices {
            guard let next = exactDecimal(value, terms[index + 1], sums[index]) else { return nil }; value = next
        }
        return ClosedExpression(operands: operands, operators: operators, value: value)
    }
    private static func exactDecimal(_ lhs: Decimal, _ rhs: Decimal, _ op: String) -> Decimal? {
        var a = lhs, b = rhs, result = Decimal()
        let error: Decimal.CalculationError
        switch op {
        case "+": error = NSDecimalAdd(&result, &a, &b, .plain)
        case "-": error = NSDecimalSubtract(&result, &a, &b, .plain)
        case "*": error = NSDecimalMultiply(&result, &a, &b, .plain)
        case "/": error = NSDecimalDivide(&result, &a, &b, .plain)
        default: return nil
        }
        guard error == .noError, !result.isNaN else { return nil }
        if op == "/" {
            // macOS NSDecimalDivide can report noError after rounding a
            // recurring fraction. Reversibility is an independent exactness
            // gate, not permission to certify the rounded result as exact.
            var quotient = result, denominator = b, restored = Decimal()
            guard NSDecimalMultiply(&restored, &quotient, &denominator, .plain) == .noError,
                  restored == a else { return nil }
        }
        return result
    }
    private static func closedArithmeticOutput(_ input: String, expression: ClosedExpression) -> Bool {
        var output = input.trimmingCharacters(in: .whitespacesAndNewlines)
        output = replace(#"^Ben\.\s*\nLuaIsHere\s*:3\s*\n"#, output, "")
        output = replace(#"^(?:the answer is|answer|result|답|정답)(?:은|는)?\s*[:：]?\s*"#, output, "")
        output = replace(#"(?:입니다|이다|예요|야)[.!]?$"#, output, "")
        output = output.trimmingCharacters(in: .whitespacesAndNewlines)
        if output.hasSuffix(".") { output.removeLast(); output = output.trimmingCharacters(in: .whitespaces) }
        for wrapper in ["**", "`"] {
            if output.hasPrefix(wrapper), output.hasSuffix(wrapper), output.count >= wrapper.count * 2 {
                output = String(output.dropFirst(wrapper.count).dropLast(wrapper.count)).trimmingCharacters(in: .whitespaces)
            }
        }
        let number = #"[+-]?\d+(?:\.\d+)?"#
        if captures("^(" + number + ")$", output) != nil {
            return Decimal(string: output, locale: Locale(identifier: "en_US_POSIX")) == expression.value
        }
        guard let equation = captures("^([^=;\\n]+)\\s*=\\s*(" + number + ")$", output), equation.count == 2,
              let left = closedExpression(equation[0], requestFraming: false),
              left.operands == expression.operands, left.operators == expression.operators,
              left.value == expression.value else { return false }
        return Decimal(string: equation[1], locale: Locale(identifier: "en_US_POSIX")) == expression.value
    }

    public static func evaluate(contract: Contract, receipt: Receipt?, artifact: ObservedArtifact,
                                currentReferencePolicySHA256: String, now: Date) -> Evaluation {
        func result(_ state: State, _ reason: String, failed: [String] = []) -> Evaluation {
            Evaluation(state: state, reason: reason, contractSHA256: contract.sha256,
                artifactSHA256: artifact.binding.artifactSHA256, requiredCheckIDs: contract.requiredCheckIDs,
                failedCheckIDs: failed)
        }
        guard valid(contract), valid(artifact.binding), finite(now),
              contract.issuedAt <= now, now <= contract.validUntil,
              digestString(currentReferencePolicySHA256), currentReferencePolicySHA256 == contract.referencePolicySHA256,
              matches(contract, artifact.binding) else { return result(.unverified, "contract_or_current_artifact_binding_unverified") }
        guard artifact.executionVerified else { return result(.unverified, "execution_unverified") }
        guard let receipt else { return result(.executionOnly, "execution_is_not_task_quality_evidence") }
        guard receipt.schema == 1, digestString(receipt.contractSHA256), receipt.contractSHA256 == contract.sha256,
              receipt.binding == artifact.binding, digestString(receipt.checkerIdentitySHA256),
              receipt.checkerIdentitySHA256 == contract.verifierCodeSHA256,
              digestString(receipt.observedReceiptSHA256), finite(receipt.observedAt),
              receipt.observedAt >= contract.issuedAt, receipt.observedAt <= now,
              receipt.observedAt <= contract.validUntil else { return result(.unverified, "checker_receipt_binding_unverified") }
        let required = Set(contract.requiredCheckIDs)
        guard receipt.checks.count <= 128, Set(receipt.checks.map(\.checkID)).count == receipt.checks.count,
              receipt.checks.allSatisfy({ validID($0.checkID) && required.contains($0.checkID) &&
                  ($0.score.map { $0.isFinite } ?? true) && ($0.observedReceiptSHA256.map(digestString) ?? false) })
        else { return result(.unverified, "check_receipt_identity_or_shape_unverified") }
        // Only individually bound known failures may establish mismatch.
        // Missing successes or many unrelated passes cannot wash them away.
        let failed = receipt.checks.filter { $0.status == .failed }.map(\.checkID)
        if !failed.isEmpty { return result(.mismatch, "required_task_check_failed", failed: failed) }
        guard contract.fullCoverage, Set(receipt.checks.map(\.checkID)) == required,
              receipt.checks.allSatisfy({ $0.status == .passed }) else { return result(.unverified, "task_coverage_or_required_checks_unverified") }
        guard let reference = contract.reference else { return result(.taskContractVerified, "declared_task_contract_verified_no_reference_parity") }
        guard valid(reference), reference.proofMode != .dev,
              reference.objectiveSHA256 == contract.objectiveSHA256,
              reference.contextSHA256 == contract.contextSHA256, reference.sourceSHA256 == contract.sourceSHA256,
              reference.startTreeSHA256 == contract.startTreeSHA256, reference.verifierCodeSHA256 == contract.verifierCodeSHA256,
              reference.referencePolicySHA256 == currentReferencePolicySHA256,
              contract.referenceProfiles.contains(reference.profile),
              reference.measuredAt <= contract.issuedAt, reference.measuredAt <= now, now <= reference.validUntil,
              Set(reference.scores.map(\.checkID)) == required,
              receipt.checks.allSatisfy({ $0.score != nil }) else { return result(.unverified, "matched_reference_evidence_unverified") }
        let baseline = Dictionary(uniqueKeysWithValues: reference.scores.map { ($0.checkID, $0.value) })
        let lower = receipt.checks.filter { ($0.score ?? -.infinity) < baseline[$0.checkID]! }.map(\.checkID)
        if !lower.isEmpty { return result(.mismatch, "below_reference_on_required_check", failed: lower) }
        let above = receipt.checks.contains { ($0.score ?? -.infinity) > baseline[$0.checkID]! }
        return result(above ? .referenceAbove : .referenceEquivalent,
            above ? "matched_reference_above_with_no_required_regression" : "matched_reference_equivalent_on_every_required_check")
    }

    public static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    private static func digestString(_ value: String) -> Bool { value.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) != nil }
    private static func validID(_ value: String) -> Bool { value.range(of: #"^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$"#, options: .regularExpression) != nil }
    private static func finite(_ date: Date) -> Bool { date.timeIntervalSince1970.isFinite }
    private static func valid(_ profile: ReferenceProfile) -> Bool {
        ["codex", "claude"].contains(profile.provider) && validID(profile.model) &&
            ["low", "medium", "high", "xhigh", "max", "ultra"].contains(profile.effort) && digestString(profile.instructionsSHA256)
    }
    private static func valid(_ contract: Contract) -> Bool {
        contract.schema == 1 && digestString(contract.objectiveSHA256) && digestString(contract.contextSHA256) &&
            (contract.sourceSHA256.map(digestString) ?? true) && digestString(contract.startTreeSHA256) &&
            digestString(contract.verifierCodeSHA256) && digestString(contract.referencePolicySHA256) &&
            (1...128).contains(contract.requiredCheckIDs.count) && contract.requiredCheckIDs.allSatisfy(validID) &&
            Set(contract.requiredCheckIDs).count == contract.requiredCheckIDs.count &&
            contract.referenceProfiles.count <= 8 && contract.referenceProfiles.allSatisfy(valid) &&
            Set(contract.referenceProfiles.map { $0.provider + "\n" + $0.model + "\n" + $0.effort + "\n" + $0.instructionsSHA256 }).count == contract.referenceProfiles.count &&
            finite(contract.issuedAt) && finite(contract.validUntil) && contract.issuedAt < contract.validUntil && !contract.sha256.isEmpty
    }
    private static func valid(_ binding: Binding) -> Bool {
        digestString(binding.objectiveSHA256) && digestString(binding.contextSHA256) &&
            (binding.sourceSHA256.map(digestString) ?? true) && digestString(binding.startTreeSHA256) &&
            digestString(binding.outputSHA256) && digestString(binding.workspaceAfterSHA256) && digestString(binding.artifactSHA256) &&
            validID(binding.executionID) && validID(binding.turnID)
    }
    private static func valid(_ reference: Reference) -> Bool {
        valid(reference.profile) && digestString(reference.objectiveSHA256) && digestString(reference.contextSHA256) &&
            (reference.sourceSHA256.map(digestString) ?? true) && digestString(reference.startTreeSHA256) &&
            digestString(reference.verifierCodeSHA256) && digestString(reference.referencePolicySHA256) &&
            (1...16).contains(reference.artifactSHA256s.count) && reference.artifactSHA256s.allSatisfy(digestString) &&
            Set(reference.artifactSHA256s).count == reference.artifactSHA256s.count &&
            (1...128).contains(reference.scores.count) && reference.scores.allSatisfy({ validID($0.checkID) && $0.value.isFinite }) &&
            Set(reference.scores.map(\.checkID)).count == reference.scores.count &&
            finite(reference.measuredAt) && finite(reference.validUntil) && reference.measuredAt < reference.validUntil
    }
    private static func matches(_ contract: Contract, _ binding: Binding) -> Bool {
        contract.objectiveSHA256 == binding.objectiveSHA256 && contract.contextSHA256 == binding.contextSHA256 &&
            contract.sourceSHA256 == binding.sourceSHA256 && contract.startTreeSHA256 == binding.startTreeSHA256 && contract.scope == binding.scope
    }
}
