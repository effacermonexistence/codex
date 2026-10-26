import Foundation
import OS1Context

/// K15 harness identity: the shipped profile's descriptor invariants. The
/// pinned rendering itself is checked by `os1 self-test`
/// (harnessProfileSelfTest), where the builders live. No model call.
func runHarnessProfileFixtures() throws {
    var checks = 0
    func check(_ value: @autoclosure () -> Bool, _ label: String) { precondition(value(), label); checks += 1 }
    let h0 = HarnessProfile.h0
    check(h0.id == "H0" && h0.version == 1 && h0.parity == .unverified, "H0 v1 ships with its parity unverified (D4 arm ②)")
    check(HarnessProfile.current == h0, "every dispatch runs under H0")
    check(!h0.components.isEmpty && Set(h0.components).count == h0.components.count, "components are named once each")
    check(Set(h0.components).isDisjoint(with: HarnessProfile.pendingHItems),
          "the pending H items (C4a reorder, C4d line deletion) are not part of H0")
    check(HarnessProfile.pendingHItems == ["C4a_stable_first_reorder", "C4d_tool_free_read_original_line"],
          "exactly the two K15 prefix levers wait for a new profile")
    check(h0.components.contains("chat_lane_predicate_v1") && h0.components.contains("lean_projection_v1"),
          "the chat-lane predicate and the lean projection are versioned with the profile")
    check(h0.renderingSHA256.count == 64 && h0.renderingSHA256.allSatisfy { $0.isHexDigit && !$0.isUppercase }
          && h0.renderingSHA256 != String(repeating: "0", count: 64), "the rendering digest is pinned")
    let shipped = HarnessProfile.shipped
    check(shipped.last == HarnessProfile.current, "the current profile is the last one shipped")
    check(Set(shipped.map { "\($0.id)@\($0.version)" }).count == shipped.count
          && Set(shipped.map(\.renderingSHA256)).count == shipped.count,
          "no profile id/version or pinned rendering is reused")
    print("Harness profile: \(checks) checks passed (H0 v1, parity unverified, C4a/C4d pending)")
}
