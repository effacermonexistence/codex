import Darwin
import Dispatch

/// Pure, new-run admission only. No decision here cancels or terminates an
/// existing run. The caller owns per-conversation serialization and queue state.
public enum RunAdmission {
    public enum MemoryPressure: Equatable, Sendable {
        case normal, warning, critical, unknown
    }

    public enum HoldReason: Equatable, Sendable {
        case slotLimit, memoryWarning, memoryCritical

        /// Explicit language input keeps tests independent of owner settings.
        public func message(interfaceLanguage: String) -> String {
            let korean = interfaceLanguage.lowercased().hasPrefix("ko")
            switch self {
            case .slotLimit:
                return korean ? "실행 슬롯이 비기를 기다리는 중" : "Waiting for an available run slot"
            case .memoryWarning:
                return korean ? "메모리 압박 경고 · 새 실행 대기 중" : "Memory pressure warning · new run queued"
            case .memoryCritical:
                return korean ? "심각한 메모리 압박 · 새 실행 대기 중" : "Critical memory pressure · new run queued"
            }
        }
    }

    public struct Decision: Equatable, Sendable {
        public let admitted: Bool
        public let reason: HoldReason?
        /// Source-lease waiters are preserved runs, but consume no run slots.
        public let occupiedCount: Int
    }

    public static func occupiedCount(activeRuns: Int, waitingForSourceRuns: Int = 0) -> Int {
        let active = max(0, activeRuns)
        return active - min(active, max(0, waitingForSourceRuns))
    }

    /// `nil` means no slot ceiling. Only observed warning/critical pressure
    /// pauses new starts; an unavailable sampler is not invented as pressure
    /// and cannot permanently strand a queue. The caller resamples on retry.
    public static func decide(limit: Int?, activeRuns: Int, waitingForSourceRuns: Int = 0,
                              memoryPressure: MemoryPressure) -> Decision {
        let occupied = occupiedCount(activeRuns: activeRuns, waitingForSourceRuns: waitingForSourceRuns)
        let reason: HoldReason?
        switch memoryPressure {
        case .warning: reason = .memoryWarning
        case .critical: reason = .memoryCritical
        case .normal, .unknown:
            if let limit, occupied >= min(64, max(1, limit)) {
                reason = .slotLimit
            } else {
                reason = nil
            }
        }
        return Decision(admitted: reason == nil, reason: reason, occupiedCount: occupied)
    }
}

/// Read-only OS adapter, separate from the pure admission function. Uses a
/// direct sysctl, not a shell/provider process or a free-memory percentage.
public enum RunMemoryPressure {
    public static let sysctlName = "kern.memorystatus_vm_pressure_level"

    public static func current() -> RunAdmission.MemoryPressure {
        sample(readLevel: readSysctlLevel)
    }

    /// Injectable adapter seam. Missing/unrecognized values remain unknown.
    public static func sample(readLevel: () -> UInt32?) -> RunAdmission.MemoryPressure {
        guard let level = readLevel() else { return .unknown }
        // XNU's sysctl returns dispatch flags, not its internal pressure enum:
        // bsd/kern/kern_memorystatus_notify.c:
        // convert_internal_pressure_level_to_dispatch_level + sysctl handler.
        // SDK DispatchSource.MemoryPressureEvent: normal=1, warning=2, critical=4.
        switch level {
        case UInt32(DispatchSource.MemoryPressureEvent.normal.rawValue): return .normal
        case UInt32(DispatchSource.MemoryPressureEvent.warning.rawValue): return .warning
        case UInt32(DispatchSource.MemoryPressureEvent.critical.rawValue): return .critical
        default: return .unknown
        }
    }

    private static func readSysctlLevel() -> UInt32? {
        var level: UInt32 = 0
        var size = MemoryLayout<UInt32>.size
        guard sysctlbyname(sysctlName, &level, &size, nil, 0) == 0,
              size == MemoryLayout<UInt32>.size else { return nil }
        return level
    }
}
