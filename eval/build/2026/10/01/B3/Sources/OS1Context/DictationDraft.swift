import Foundation

/// Recognition owns only its last emitted span. Typing elsewhere survives a
/// partial/final replacement; edits inside that span relinquish ownership.
public enum DictationDraft {
    public static func replacing(current: String, previous: String, dictated: String,
                                 replacement: String, initial: String) -> String? {
        if dictated.isEmpty {
            guard !replacement.isEmpty else { return current }
            let separator = current.isEmpty || current.last?.isWhitespace == true ? "" : " "
            return current + separator + replacement
        }
        guard let owned = previous.range(of: dictated, options: .backwards) else { return nil }
        let prefix = String(previous[..<owned.lowerBound])
        let suffix = String(previous[owned.upperBound...])
        if current == previous {
            if replacement.isEmpty && current == initial + (initial.isEmpty || initial.last?.isWhitespace == true ? "" : " ") + dictated { return initial }
            return prefix + replacement + suffix
        }
        let old = Array(previous), new = Array(current)
        var start = 0, tail = 0
        while start < min(old.count, new.count), old[start] == new[start] { start += 1 }
        while tail < min(old.count - start, new.count - start),
              old[old.count - 1 - tail] == new[new.count - 1 - tail] { tail += 1 }
        let ownedStart = previous.distance(from: previous.startIndex, to: owned.lowerBound)
        let ownedEnd = ownedStart + dictated.count
        let shiftedStart: Int
        if old.count - tail <= ownedStart { shiftedStart = ownedStart + new.count - old.count }
        else if start >= ownedEnd { shiftedStart = ownedStart }
        else { return nil }
        guard shiftedStart >= 0, shiftedStart + dictated.count <= new.count,
              String(new[shiftedStart..<(shiftedStart + dictated.count)]) == dictated else { return nil }
        return String(new[..<shiftedStart]) + replacement + String(new[(shiftedStart + dictated.count)...])
    }
}
