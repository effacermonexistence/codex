import Foundation

/// Ordinary Core request controls, not model ranks or a second scheduler.
/// Absence preserves the previous nil-native / four-worker request exactly.
public enum RCCRunBudgetOptions {
    /// The typed native-dispatch cap every new App submission freezes and
    /// sends on `os1 run` (K6). 16 = 2 x 8: Core's own plan-time reserve of
    /// two native dispatches per node (RT ownerCollectionPlanEligible: cap >=
    /// 2 x obligations; _calibratedContext: headroom >= 2) over the largest
    /// plan or owner collection Core admits (8), so no plan-time eligibility
    /// outcome differs from an absent cap. It is not a run-time reserve: the
    /// cap counts every native dispatch, including the uncharged ladder descent
    /// and free pre-execution rejections, and nothing reads headroom when a
    /// descent binds, so a late node can exhaust it. A cap hit is a typed hold
    /// (native_dispatch_budget_exhausted), never a cheaper delivery. A direct
    /// CLI run without the flag, or a submission an older build saved, still
    /// means the legacy nil. Rollback raises this value (<= 64) or holds
    /// dispatch; it never removes the flag (RT-10).
    public static let appNativeDispatches = 16
    /// K12b: the result contract every new App submission freezes and sends
    /// on `os1 run` (`--result-contract-version 2`). v2 types a partial
    /// outcome (Result.partial), so a failed or held task's completed answers
    /// reach the owner labelled partial instead of being dropped. The version
    /// is part of Core's submit fingerprint: a submission an older build saved
    /// has none and keeps none across retry/restart under the same task ID, and
    /// a direct CLI run without the flag stays on v1.
    public static let appResultContractVersion = 2
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
    public static func resultContractVersion(_ raw: String) throws -> Int {
        try parse(raw, option: "--result-contract-version", upper: 2)
    }
}
