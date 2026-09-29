import Foundation
import OS1Context

/// Certificate contract only: no model call, no score, no runtime state.
func runABCDCarryPolicyFixtures() {
    var checks = 0
    func check(_ value: @autoclosure () -> Bool, _ label: String) { precondition(value(), label); checks += 1 }
    func certify(depth: Int = 4, saturation: Int = 3, agreement: Int = 2, window: [String] = ["42", "42"],
                 modelFree: String? = "42", confidence: Double = 0.9, threshold: Double = 0.8,
                 task: String = "t", context: String = "c", policy: String = "p") -> ABCDCarryPolicy.Certificate? {
        ABCDCarryPolicy.certify(taskIdentity: task, contextIdentity: context, policyIdentity: policy,
                                depth: depth, saturationDepth: saturation, minimumAgreement: agreement,
                                carryWindow: window, modelFreeAnswer: modelFree, confidence: confidence, threshold: threshold)
    }
    let issued = certify()
    check(issued == ABCDCarryPolicy.Certificate(taskIdentity: "t", contextIdentity: "c", policyIdentity: "p",
                                                carry: "42", donorDepth: 3), "certificate carries the agreed answer from the previous depth")
    check(certify(depth: 2) == nil, "no carry before the saturation depth")
    check(certify(window: ["42"]) == nil, "too few agreeing depths")
    check(certify(window: ["41", "42"]) == nil, "the agreement window must be unanimous")
    check(certify(window: ["7", "42", "42"]) != nil, "only the most recent window counts")
    check(certify(modelFree: nil) == nil && certify(modelFree: "  ") == nil, "a model-free answer is required")
    check(certify(modelFree: "43") == nil, "repeated model agreement alone never certifies")
    check(certify(confidence: 0.79) == nil, "confidence below the threshold")
    check(certify(confidence: .nan) == nil && certify(threshold: 1.5) == nil, "confidence and threshold must be bounded numbers")
    check(certify(task: "") == nil && certify(context: "") == nil && certify(policy: "") == nil, "every identity is required")
    check(certify(saturation: 0) == nil && certify(agreement: 0) == nil, "degenerate parameters rejected")
    check(ABCDCarryPolicy.adoptedCarry(issued, taskIdentity: "t", contextIdentity: "c", policyIdentity: "p", donorOutput: "42") == "42",
          "a carry is reused only for the identical task, context and policy")
    for (task, context, policy, donor) in [("u", "c", "p", "42"), ("t", "d", "p", "42"), ("t", "c", "q", "42"), ("t", "c", "p", "41")] {
        check(ABCDCarryPolicy.adoptedCarry(issued, taskIdentity: task, contextIdentity: context, policyIdentity: policy,
                                           donorOutput: donor) == nil, "carry never crosses a boundary: \(task)/\(context)/\(policy)/\(donor)")
    }
    check(ABCDCarryPolicy.adoptedCarry(nil, taskIdentity: "t", contextIdentity: "c", policyIdentity: "p", donorOutput: "42") == nil,
          "no certificate, no carry")
    print("ABCD carry certificate: \(checks) checks passed")
}
