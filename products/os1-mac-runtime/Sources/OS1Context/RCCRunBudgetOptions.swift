import Foundation

/// Ordinary Core request controls, not model ranks or a second scheduler.
/// Absence preserves the previous nil-native / four-worker request exactly.
public enum RCCRunBudgetOptions {
    public struct Invalid: LocalizedError, Equatable {
        public let option: String
        public let upper: Int
        public var errorDescription: String? { "Invalid \(option): expected a canonical integer in 1...\(upper)" }
    }
    private static func parse(_ raw: String, option: String, upper: Int) throws -> Int {
        guard !raw.isEmpty, raw.first != "0", raw.utf8.allSatisfy({ (48...57).contains($0) }),
              let value = Int(raw), (1...upper).contains(value) else { throw Invalid(option: option, upper: upper) }
        return value
    }
    public static func nativeDispatches(_ raw: String) throws -> Int {
        try parse(raw, option: "--max-native-dispatches", upper: 64)
    }
    public static func parallelism(_ raw: String) throws -> Int {
        try parse(raw, option: "--max-parallel", upper: 8)
    }
}
