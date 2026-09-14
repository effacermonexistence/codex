import Foundation

public enum CodexQuota {
    /// Match public provider bucket names, never guess that catalog membership
    /// implies capacity. Unknown/missing limits are not interpreted as zero.
    public static func excludedModels(_ response: [String: Any], models: [String], now: Date = Date()) -> Set<String> {
        let buckets = response["rateLimitsByLimitId"] as? [String: [String: Any]] ?? [:]
        func exhausted(_ bucket: [String: Any]) -> Bool {
            if bucket["spendControlReached"] as? Bool == true { return true }
            return ["primary", "secondary"].contains { key in
                guard let window = bucket[key] as? [String: Any], let used = window["usedPercent"] as? NSNumber,
                      used.doubleValue >= 100 else { return false }
                if let reset = window["resetsAt"] as? NSNumber, reset.doubleValue <= now.timeIntervalSince1970 { return false }
                return true
            }
        }
        var excluded = Set<String>()
        for model in models {
            let explicit = buckets.values.first { ($0["limitName"] as? String)?.lowercased() == model.lowercased() }
            if let explicit { if exhausted(explicit) { excluded.insert(model) } }
            else if let general = buckets["codex"], exhausted(general) { excluded.insert(model) }
        }
        return excluded
    }

    /// Reset time of the exhausted general bucket, for user notices only.
    public static func exhaustedGeneralResetDescription(_ response: [String: Any], now: Date = Date()) -> String? {
        guard let general = (response["rateLimitsByLimitId"] as? [String: [String: Any]])?["codex"] else { return nil }
        for key in ["primary", "secondary"] {
            guard let window = general[key] as? [String: Any], let used = window["usedPercent"] as? NSNumber,
                  used.doubleValue >= 100, let reset = window["resetsAt"] as? NSNumber,
                  reset.doubleValue > now.timeIntervalSince1970 else { continue }
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = "yyyy-MM-dd HH:mm zzz"
            return formatter.string(from: Date(timeIntervalSince1970: reset.doubleValue))
        }
        return nil
    }
}
