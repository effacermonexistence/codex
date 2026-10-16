import Foundation
import OS1Context

/// Build 385 (2026-10-15): "다 넘겨봐 1+1", "1+1 to all models" and "다 라우팅
/// 해줄 수 있어? 1+1" each ran as one single-model task because the route-all
/// grammar is a closed list. The local model interprets what the grammar does
/// not cover; deterministic checks decide. No model, network or config here.
func runRoutingOrderInterpreterFixtures() throws {
    try RoutingOrderInterpreter.selfTest()
    final class Box: @unchecked Sendable { var error: Error? }
    let box = Box(), done = DispatchSemaphore(value: 0)
    Task.detached {
        do { try await RoutingOrderInterpreter.selfTestInterpret() } catch { box.error = error }
        done.signal()
    }
    done.wait()
    if let error = box.error { throw error }
}
