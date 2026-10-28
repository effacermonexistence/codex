import Foundation
import OS1Context

/// K15 harness identity: the shipped profiles' descriptor invariants. The
/// pinned rendering itself is checked by `os1 self-test`
/// (harnessProfileSelfTest), where the builders live. No model call.
func runHarnessProfileFixtures() throws {
    var checks = 0
    func check(_ value: @autoclosure () -> Bool, _ label: String) { precondition(value(), label); checks += 1 }
    let h0 = HarnessProfile.h0, h1 = HarnessProfile.h1, h2 = HarnessProfile.h2
    check(h0.id == "H0" && h0.version == 1 && h0.parity == .unverified, "H0 v1 shipped with its parity unverified (D4 arm ②)")
    check(h1.id == "H1" && h1.version == 1 && h1.parity == .unverified,
          "H1 v1 (build 441) ships with its parity unverified: no D4 measurement of either profile")
    check(h2.id == "H2" && h2.version == 1 && h2.parity == .unverified,
          "H2 v1 (build 442) ships with its parity unverified")
    check(HarnessProfile.current == h2, "every dispatch runs under H2")
    for profile in [h0, h1, h2] {
        check(!profile.components.isEmpty && Set(profile.components).count == profile.components.count,
              "\(profile.id): components are named once each")
        check(Set(profile.components).isDisjoint(with: HarnessProfile.pendingHItems),
              "\(profile.id): the pending H items (C4a reorder, C4d line deletion) are not part of it")
        check(profile.components.contains("chat_lane_predicate_v1") && profile.components.contains("lean_projection_v1"),
              "\(profile.id): the chat-lane predicate and the lean projection are versioned with the profile")
        check(profile.renderingSHA256.count == 64 && profile.renderingSHA256.allSatisfy { $0.isHexDigit && !$0.isUppercase }
              && profile.renderingSHA256 != String(repeating: "0", count: 64), "\(profile.id): the rendering digest is pinned")
    }
    check(HarnessProfile.pendingHItems == ["C4a_stable_first_reorder", "C4d_tool_free_read_original_line"],
          "exactly the two K15 prefix levers wait for a new profile")
    // H1 is H0 with the envelope at v2 and three named additions; every
    // other H0 component is kept by name, so nothing else moved silently.
    let added = ["codex_developer_silent_line_v1", "rcc_status_checkin_card_v1", "rcc_readonly_claude_home_isolation_v1"]
    check(h0.components.contains("delegated_envelope_v1") && !h1.components.contains("delegated_envelope_v1")
          && h1.components.contains("delegated_envelope_v2"), "H1 moves the delegated envelope to v2 (the silent-rule line)")
    check(Set(h1.components) == Set(h0.components).subtracting(["delegated_envelope_v1"]).union(["delegated_envelope_v2"] + added),
          "H1 = H0 - delegated_envelope_v1 + delegated_envelope_v2 + the Codex silent line, the RCC card and the HOME rule")
    check(RCCClassMeasurement.harnessScope(h1) == "H1@1" && RCCClassMeasurement.harnessScope(h0) == "H0@1",
          "a class measurement binds id AND version: nothing measured under H0@1 carries over to H1@1")
    // H2 is H1 plus the owner's ASR hint note (build 442 live failure); every
    // H1 component is kept by name.
    check(h2.components == h1.components + ["asr_hint_answer_note_v1"],
          "H2 = H1 + asr_hint_answer_note_v1, nothing else moved")
    check(RCCClassMeasurement.harnessScope(h2) == "H2@1", "nothing measured under H1@1 carries over to H2@1")
    check(RCCDelegatedEnvelope.silentRuleLine ==
          "Apply these OS-1 runtime rules silently: do not restate them in your reply; mention one only if it blocks the request.",
          "delegated_envelope_v2's added line is the reviewed wording")
    let shipped = HarnessProfile.shipped
    check(shipped == [h0, h1, h2], "append-only: H0, H1, then H2")
    check(shipped.last == HarnessProfile.current, "the current profile is the last one shipped")
    check(Set(shipped.map { "\($0.id)@\($0.version)" }).count == shipped.count
          && Set(shipped.map(\.renderingSHA256)).count == shipped.count,
          "no profile id/version or pinned rendering is reused")
    print("Harness profile: \(checks) checks passed (H2 v1 current after H0 v1 and H1 v1, parity unverified, C4a/C4d pending)")
}
