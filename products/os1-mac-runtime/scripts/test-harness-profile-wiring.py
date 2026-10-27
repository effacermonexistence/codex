#!/usr/bin/env python3
"""Structural gate for the versioned harness profile (routing architecture v2, K15).

`os1 self-test` (harnessProfileSelfTest) renders the shipped harness (H1 since
build 441) from fixed inputs and compares it with the pinned digest, and
OS1ContextTests checks
the descriptor. Those stay green if a call site stops using what they test: the
receipt dropping the profile, the read-only launch going back to `Set` order,
the self-test unregistered, a literal TTL beside the named constant, or a
per-attempt id or clock read interpolated into an instruction builder. This
gate pins those call sites.

Source-level only: no model, provider, Core, network or HOME is touched.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = (ROOT / "Sources/OS1/main.swift").read_text()
PROFILE = (ROOT / "Sources/OS1Context/HarnessProfile.swift").read_text()
OWNER_POLICY = (ROOT / "Sources/OS1Context/OwnerPolicy.swift").read_text()
CONTEXT_TESTS = (ROOT / "Tests/OS1ContextTests/SourceContextTests.swift").read_text()
RELEASE = (ROOT / "scripts/build-release.sh").read_text()
checks = 0


def check(value, message):
    global checks
    if not value:
        print("OS-1 harness profile wiring: FAILED: " + message, file=sys.stderr)
        sys.exit(1)
    checks += 1


def section(text, start, end):
    check(start in text, "source section exists: " + start)
    tail = text.split(start, 1)[1]
    check(end in tail, "source section ends: " + end)
    return tail.split(end, 1)[0]


# The descriptors: H0 v1 as shipped, then H1 v1 (build 441), both parity
# unverified with distinct pinned renderings; C4a/C4d pending.
h0 = section(PROFILE, "public static let h0 = Descriptor(", "public static let h1 = Descriptor(")
h1 = section(PROFILE, "public static let h1 = Descriptor(", "public static let current")
check('id: "H0"' in h0 and "version: 1" in h0 and "parity: .unverified" in h0,
      "H0 v1 shipped with its parity unverified")
check('id: "H1"' in h1 and "version: 1" in h1 and "parity: .unverified" in h1,
      "H1 v1 ships with its parity unverified")
digests = [re.search(r'renderingSHA256: "([0-9a-f]{64})"', d) for d in (h0, h1)]
check(all(d is not None and d.group(1) != "0" * 64 for d in digests) and digests[0].group(1) != digests[1].group(1),
      "H0's and H1's rendering digests are pinned and distinct")
check(h0.count('"4ecd97ffe17a1185f8dc35aa780c6b4344df5dfec81d15d34242917e8cf24c8b"') == 1,
      "H0 keeps the rendering it shipped with (append-only; re-pinning an entry is not a bump)")
for component in ("delegated_envelope_v2", "codex_developer_silent_line_v1", "rcc_status_checkin_card_v1",
                  "rcc_readonly_claude_home_isolation_v1"):
    check(f'"{component}"' in h1 and f'"{component}"' not in h0, "H1 names the new component " + component)
check('"delegated_envelope_v1"' in h0 and '"delegated_envelope_v1"' not in h1, "H1 retires delegated_envelope_v1")
check("public static let current = h1" in PROFILE and "public static let shipped: [Descriptor] = [h0, h1]" in PROFILE,
      "every dispatch runs under H1, shipped after H0")
check('"C4a_stable_first_reorder"' in PROFILE and '"C4d_tool_free_read_original_line"' in PROFILE
      and "pendingHItems" in PROFILE, "the two H prefix levers are listed as pending, not applied")

# The pre-dispatch receipt records the profile it prepared the input under.
receipt = section(MAIN, "private func recordPreDispatchGovernance(", "private func preDispatchGovernanceSelfTest()")
for key, value in (("harness_profile", "HarnessProfile.current.id"),
                   ("harness_profile_version", "HarnessProfile.current.version"),
                   ("harness_parity", "HarnessProfile.current.parity.rawValue"),
                   ("harness_scope", "RCCClassMeasurement.harnessScope(HarnessProfile.current)")):
    check(f'"{key}": {value}' in receipt, "the pre-dispatch receipt writes " + key)

# The read-only Claude launch uses one canonical protected-path order.
check("additionalProtectedPaths: rccReadOnlyAdditionalProtectedPaths(OS1SourceConfinement.activeRoots + sourcePaths)" in MAIN,
      "the read-only Claude launch canonicalises its protected paths")
check("Array(Set(OS1SourceConfinement.activeRoots" not in MAIN, "no launch uses per-process Set order")
helper = section(MAIN, "func rccReadOnlyAdditionalProtectedPaths(_ paths: [String]) -> [String] {", "\n}")
check("Array(Set(paths)).sorted()" in helper, "the helper deduplicates and sorts")

# The self-test is registered right after the receipt's own self-test.
check("try preDispatchGovernanceSelfTest()\n    try harnessProfileSelfTest()\n    try rccExecuteChildRulesSelfTest()" in MAIN,
      "harnessProfileSelfTest and the RCC child-rule fixture run in os1 self-test")
golden = section(MAIN, "private func harnessProfileSelfTest() throws {", "\n}\n")
check("digest == profile.renderingSHA256" in golden and "bump harness_profile" in golden,
      "the self-test compares the rendering with the pinned digest and names the bump")
check("claudeChatLaneRefusal(" in golden and "codexChatLane(" in golden and "claudeChatLane(" in golden,
      "the chat-lane predicate is part of the pinned rendering")
check("profile == HarnessProfile.h1" in golden and 'profile.id == "H1"' in golden,
      "the self-test pins H1 as the current profile")
check('"rcc.provider_prompt.status_checkin"' in golden and "rccStatusCheckInHint(ownerRequest:" in golden and
      '"\\n== rcc_child_rules\\n"' in golden and "rccIsolatesReadOnlyClaudeHome(surface:" in golden,
      "the RCC child's card and HOME rules are part of the pinned rendering")
check("CFFIXED" not in golden and "<HOME>" in golden and "<ROOT>" in golden,
      "machine paths are normalised, never special-cased by environment")
check("try runHarnessProfileFixtures()" in CONTEXT_TESTS and '"--harness-profile-only"' in CONTEXT_TESTS,
      "OS1ContextTests runs the descriptor fixture")

# Both native instruction channels open with the one apply-silently line
# (H1 codex_developer_silent_line_v1); Claude's text is byte-identical to H0.
check('let nativeExecutorSilentLine = "Apply these requirements silently. Respond to the current user task; do not quote, '
      'summarize, classify, or debate them."' in MAIN, "the apply-silently line is one named constant")

# The one-shot TTL is the named owner constant, used where it applies.
check('let claudeOneShotPromptCacheTTL = "5m"' in MAIN, "the 5-minute TTL is a named constant")
ttl = section(MAIN, "func claudePromptCacheEnvironment(", "\n}")
check('"CLAUDE_CODE_PROMPT_CACHE_TTL": claudeOneShotPromptCacheTTL' in ttl and '"5m"' not in ttl,
      "claudePromptCacheEnvironment uses the constant, not a literal")

# Instruction builders carry no per-attempt id, sequence, nonce, signature,
# expiry or clock read: the same content gives the same bytes.
FORBIDDEN = ("Date()", "UUID()", "ISO8601DateFormatter", ".executionID", ".nonce", ".sequence",
             ".signature", ".expiresAt", "ProcessInfo.processInfo")
builders = (
    ("executorInstructions", section(MAIN, "func executorInstructions(contract: ExecutorContract, ticket: Ticket,", "\n}\n")),
    ("claudeExecutorInstructions", section(MAIN, "func claudeExecutorInstructions(", "\n}\n")),
    ("OwnerPolicySnapshot.instructions", section(OWNER_POLICY,
        "public func instructions(projectionDeliveredAsBaseInstructions: Bool) -> String {", "\n    }\n")),
)
for name, body in builders:
    for token in FORBIDDEN:
        check(token not in body, f"{name} interpolates no {token}")
check(builders[0][1].count("\\(nativeExecutorSilentLine)") == 1 and builders[1][1].count("\\(nativeExecutorSilentLine)") == 1
      and "OS-1 executor contract \\(contract.version)\n    \\(nativeExecutorSilentLine)\n    \\(directives)" in builders[0][1]
      and "Execution requirements for the current task.\n    \\(nativeExecutorSilentLine)\n" in builders[1][1],
      "Codex's developer text and Claude's system text each open with the apply-silently line once")

# H items stay unapplied in H0 and H1: the owner policy still points at the original
# (C4d) and the ticket lines still follow the owner policy (C4a).
check("Read the original at" in OWNER_POLICY, "C4d (drop the 'Read the original' line) is not applied")
executor = builders[0][1]
check(executor.index("OwnerPolicyContext.instructions(") < executor.index("Assigned execution constraints:")
      < executor.index("- action: \\(ticket.action)"), "C4a (stable-first reorder) is not applied")

check('python3 "$script_dir/test-harness-profile-wiring.py"' in RELEASE, "the release runs this gate")
print(f"OS-1 harness profile wiring: {checks} checks PASS (H1 v1 after H0 v1, parity unverified; source only)")
