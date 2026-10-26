import Foundation

/// The canonical answer of Core's zero-model closed arithmetic
/// (os1-closed-arithmetic-v1, rcc-runtime.mjs zeroModelArithmetic): an exact
/// integer or finite decimal, never rounded, with no '+', leading zero,
/// trailing fraction zero, '-0', exponent or digit grouping, and at most 40
/// digits. The shared vectors are scripts/fixtures/rcc-arithmetic-vectors.json.
/// Core's only other zero-model answer, the local check-in, is a sentence.
public enum RCCExactArithmeticOutput {
    public static let maximumDigits = 40

    public static func isCanonical(_ output: String) -> Bool {
        guard output != "-0",
              output.range(of: #"^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$"#, options: .regularExpression) != nil
        else { return false }
        return output.unicodeScalars.filter { ("0"..."9").contains($0) }.count <= maximumDigits
    }
}
