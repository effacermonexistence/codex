import Foundation

/// Liveness must not share a serial loop with slow result reads or job delivery.
/// This owns only maintenance: neither child can claim or execute a user job.
public enum FleetMaintenance {
    public static func run(
        heartbeatInterval: Duration = .seconds(10),
        mirrorInterval: Duration = .seconds(5),
        heartbeat: @escaping @Sendable () async throws -> Void,
        mirror: @escaping @Sendable () async throws -> Void,
        onHeartbeatFailure: @escaping @Sendable () -> Void = {},
        onMirrorFailure: @escaping @Sendable () -> Void = {}
    ) async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask {
                await repeatOperation(interval: heartbeatInterval, operation: heartbeat, onFailure: onHeartbeatFailure)
            }
            group.addTask {
                await repeatOperation(interval: mirrorInterval, operation: mirror, onFailure: onMirrorFailure)
            }
            await group.waitForAll()
        }
    }

    private static func repeatOperation(
        interval: Duration,
        operation: @Sendable () async throws -> Void,
        onFailure: @Sendable () -> Void
    ) async {
        while !Task.isCancelled {
            do {
                try Task.checkCancellation()
                try await operation()
            } catch is CancellationError {
                return
            } catch {
                if !Task.isCancelled { onFailure() }
            }
            do { try await Task.sleep(for: interval) }
            catch { return }
        }
    }
}
