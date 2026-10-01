import Foundation

/// A bounded carry certificate is an optimization candidate, never a score oracle.
public enum ABCDCarryPolicy {
    public struct Certificate: Equatable, Sendable {
        public let taskIdentity: String
        public let contextIdentity: String
        public let policyIdentity: String
        public let carry: String
        public let donorDepth: Int
        public init(taskIdentity: String, contextIdentity: String, policyIdentity: String, carry: String, donorDepth: Int) {
            self.taskIdentity = taskIdentity
            self.contextIdentity = contextIdentity
            self.policyIdentity = policyIdentity
            self.carry = carry
            self.donorDepth = donorDepth
        }
    }
    public static func certify(taskIdentity: String, contextIdentity: String, policyIdentity: String,
                               depth: Int, saturationDepth: Int, minimumAgreement: Int,
                               carryWindow: [String], modelFreeAnswer: String?,
                               confidence: Double, threshold: Double) -> Certificate? {
        guard !taskIdentity.isEmpty, !contextIdentity.isEmpty, !policyIdentity.isEmpty,
              saturationDepth > 0, minimumAgreement > 0,
              depth >= saturationDepth, carryWindow.count >= minimumAgreement,
              confidence.isFinite, threshold.isFinite,
              (0...1).contains(confidence), (0...1).contains(threshold), confidence >= threshold,
              let answer = modelFreeAnswer, !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let window = carryWindow.suffix(minimumAgreement)
        guard window.allSatisfy({ $0 == answer }) else { return nil }
        return Certificate(taskIdentity: taskIdentity, contextIdentity: contextIdentity,
                           policyIdentity: policyIdentity, carry: answer, donorDepth: depth - 1)
    }
    /// Never re-use a carry across a task, context, or policy boundary.
    public static func adoptedCarry(_ certificate: Certificate?, taskIdentity: String,
                                    contextIdentity: String, policyIdentity: String,
                                    donorOutput: String) -> String? {
        guard let certificate,
              certificate.taskIdentity == taskIdentity,
              certificate.contextIdentity == contextIdentity,
              certificate.policyIdentity == policyIdentity,
              certificate.carry == donorOutput else { return nil }
        return donorOutput
    }
}
