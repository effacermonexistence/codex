import Foundation
import CoreFoundation

/// Canonical JSON matching the OpenClaw wire's sorted-key JSON.stringify
/// representation. It preserves binary64 values; it never rounds timestamps
/// or uses Foundation JSONSerialization's different number spelling.
public enum RCCCanonicalJSON {
    enum Failure: Error { case unsupportedValue, unsafeInteger, invalidNumber, excessiveDepth }

    public static func encode(_ object: Any) throws -> Data {
        var writer = Writer()
        return Data(try writer.render(object, depth: 0).utf8)
    }

    private struct Writer {
        // Per-call, never a shared encoder used by concurrent native children.
        let encoder: JSONEncoder = {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.withoutEscapingSlashes]
            return encoder
        }()

        mutating func render(_ value: Any, depth: Int) throws -> String {
            guard depth <= 32 else { throw Failure.excessiveDepth }
            if let dictionary = value as? [String: Any] {
                // JavaScript Array.sort compares UTF-16 code units, not locale,
                // numeric substrings, or UTF-8 scalar order.
                let keys = dictionary.keys.sorted {
                    Array($0.utf16).lexicographicallyPrecedes(Array($1.utf16))
                }
                var fields: [String] = []
                for key in keys {
                    fields.append(try string(key) + ":" + render(dictionary[key]!, depth: depth + 1))
                }
                return "{" + fields.joined(separator: ",") + "}"
            }
            if let array = value as? [Any] {
                var elements: [String] = []
                for item in array { elements.append(try render(item, depth: depth + 1)) }
                return "[" + elements.joined(separator: ",") + "]"
            }
            if value is NSNull { return "null" }
            if let value = value as? String { return try string(value) }
            if let number = value as? NSNumber {
                if CFGetTypeID(number) == CFBooleanGetTypeID() {
                    return number.boolValue ? "true" : "false"
                }
                let kind = String(cString: number.objCType)
                if kind == "f" || kind == "d" { return try double(number.doubleValue) }
                // An integer that JavaScript cannot represent exactly must
                // fail, not be silently changed during the cross-language hop.
                if let value = Int64(number.stringValue) {
                    guard (-9_007_199_254_740_991...9_007_199_254_740_991).contains(value) else {
                        throw Failure.unsafeInteger
                    }
                    return String(value)
                }
                if let value = UInt64(number.stringValue) {
                    guard value <= 9_007_199_254_740_991 else { throw Failure.unsafeInteger }
                    return String(value)
                }
                throw Failure.invalidNumber
            }
            throw Failure.unsupportedValue
        }

        private func string(_ value: String) throws -> String {
            String(decoding: try encoder.encode(value), as: UTF8.self)
        }

        /// JSONEncoder supplies the shortest round-trip binary64 digits.
        /// ECMAScript chooses fixed notation for [1e-6, 1e21), and exponent
        /// notation outside it. Adjust spelling only, never the numeric value.
        private func double(_ value: Double) throws -> String {
            guard value.isFinite else { throw Failure.invalidNumber }
            if value == 0 { return "0" }
            var literal = String(decoding: try encoder.encode(value), as: UTF8.self).lowercased()
            let sign = literal.hasPrefix("-") ? "-" : ""
            if !sign.isEmpty { literal.removeFirst() }
            let parts = literal.split(separator: "e", omittingEmptySubsequences: false)
            guard parts.count <= 2, let exponent = parts.count == 2 ? Int(parts[1]) : 0 else {
                throw Failure.invalidNumber
            }
            let mantissa = parts[0].split(separator: ".", omittingEmptySubsequences: false)
            guard mantissa.count <= 2 else { throw Failure.invalidNumber }
            var digits = Array(mantissa.joined())
            guard !digits.isEmpty, digits.allSatisfy({ $0 >= "0" && $0 <= "9" }) else { throw Failure.invalidNumber }
            var decimalPosition = mantissa[0].count + exponent
            while digits.first == "0" { digits.removeFirst(); decimalPosition -= 1 }
            while digits.last == "0" { digits.removeLast() }
            guard !digits.isEmpty else { throw Failure.invalidNumber }
            if decimalPosition > 0 && decimalPosition <= 21 {
                if digits.count <= decimalPosition {
                    return sign + String(digits) + String(repeating: "0", count: decimalPosition - digits.count)
                }
                return sign + String(digits.prefix(decimalPosition)) + "." + String(digits.dropFirst(decimalPosition))
            }
            if decimalPosition > -6 && decimalPosition <= 0 {
                return sign + "0." + String(repeating: "0", count: -decimalPosition) + String(digits)
            }
            let fraction = digits.count > 1 ? "." + String(digits.dropFirst()) : ""
            let power = decimalPosition - 1
            return sign + String(digits[0]) + fraction + "e" + (power >= 0 ? "+" : "") + String(power)
        }
    }
}
