#!/usr/bin/env python3
"""Structural gate for the versioned harness profile (routing architecture v2, K15).

`os1 self-test` (harnessProfileSelfTest) renders the shipped harness (H2 since
build 442) from fixed inputs and compares it with the pinned digest, and
OS1ContextTests checks
the descriptor. Those stay green if a call site stops using what they test: the
receipt dropping the profile, the read-only launch going back to `Set` order,
the self-test unregistered, a literal TTL beside the named constant, a
per-attempt id or clock read interpolated into an instruction builder, or the
rcc-execute envelope no longer carrying the owner's ASR hints (judged inside
the envelope by the protected-material gate, kept out of the deferred-
deliverable post-check, mirrored on the local lane). This gate pins those call
sites.

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


# The descriptors: H0 v1 as shipped, H1 v1 (build 441), then H2 v1 (build
# 442), all parity unverified with distinct pinned renderings; C4a/C4d pending.
h0 = section(PROFILE, "public static let h0 = Descriptor(", "public static let h1 = Descriptor(")
h1 = section(PROFILE, "public static let h1 = Descriptor(", "public static let h2 = Descriptor(")
h2 = section(PROFILE, "public static let h2 = Descriptor(", "public static let current")
check('id: "H0"' in h0 and "version: 1" in h0 and "parity: .unverified" in h0,
      "H0 v1 shipped with its parity unverified")
check('id: "H1"' in h1 and "version: 1" in h1 and "parity: .unverified" in h1,
      "H1 v1 shipped with its parity unverified")
check('id: "H2"' in h2 and "version: 1" in h2 and "parity: .unverified" in h2,
      "H2 v1 ships with its parity unverified")
digests = [re.search(r'renderingSHA256: "([0-9a-f]{64})"', d) for d in (h0, h1, h2)]
check(all(d is not None and d.group(1) != "0" * 64 for d in digests) and len({d.group(1) for d in digests}) == 3,
      "H0's, H1's and H2's rendering digests are pinned and distinct")
check(h0.count('"4ecd97ffe17a1185f8dc35aa780c6b4344df5dfec81d15d34242917e8cf24c8b"') == 1,
      "H0 keeps the rendering it shipped with (append-only; re-pinning an entry is not a bump)")
check(h1.count('"ec23c06b3de21d542c2998dd440523cd82d813ee40e0f322388e4aae481baf53"') == 1,
      "H1 keeps the rendering it shipped with (append-only; re-pinning an entry is not a bump)")
for component in ("delegated_envelope_v2", "codex_developer_silent_line_v1", "rcc_status_checkin_card_v1",
                  "rcc_readonly_claude_home_isolation_v1"):
    check(f'"{component}"' in h1 and f'"{component}"' not in h0, "H1 names the new component " + component)
check('"delegated_envelope_v1"' in h0 and '"delegated_envelope_v1"' not in h1, "H1 retires delegated_envelope_v1")
def components(descriptor):
    return re.findall(r'"([a-z0-9_]+_v[0-9]+)"', descriptor.split("components: [", 1)[1].split("]", 1)[0])
check(components(h2) == components(h1) + ["asr_hint_answer_note_v1"] and '"asr_hint_answer_note_v1"' not in h1,
      "H2 = H1 + asr_hint_answer_note_v1, every H1 component kept by name")
check("public static let current = h2" in PROFILE and "public static let shipped: [Descriptor] = [h0, h1, h2]" in PROFILE,
      "every dispatch runs under H2, shipped after H0 and H1")
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
check("profile == HarnessProfile.h2" in golden and 'profile.id == "H2"' in golden,
      "the self-test pins H2 as the current profile")
check('"rcc.envelope.asr_note"' in golden and '"rcc.envelope.asr_no_match"' in golden and
      '"rcc.envelope.asr_quality_continuation"' in golden and "continuationInFreshSession: true" in golden and
      golden.count("asrHints: LocalClassifierHints.compiled") == 3,
      "the ASR hint note (its absence, and after a fresh-session quality correction) is part of the pinned rendering")

# H2 asr_hint_answer_note_v1: the one rcc-execute envelope carries the owner's
# hints (compiled + owner file, as the classifier loads them), the note is
# built in one place, and a protected-material match drops it.
ENVELOPE = (ROOT / "Sources/OS1Context/RCCDelegatedEnvelope.swift").read_text()
HINTS = (ROOT / "Sources/OS1Context/LocalClassifierHints.swift").read_text()
adapter = section(MAIN, "private func rccNativeAdapter(_ bytes: Data) async throws -> Data {", "\n}\n")
check(MAIN.count("RCCDelegatedEnvelope.prompt(instruction: t.instruction, ownerRequest: objective,") == 1 and
      "continuation: continuationPrompt, continuationInFreshSession: t.nativeResumeSessionID == nil," in adapter and
      "asrHints: asrHints, taskID: t.taskID, nodeID: t.nodeID, attemptID: t.attemptID)" in adapter and
      "let delegated = envelope(rccAnswerHints(ownerRequest: objective, envelope: envelope))" in adapter and
      "let noteless = envelope([])" in adapter,
      "the rcc-execute envelope (every surface: Codex, Claude Code, Claude chat; fleet nodes) passes the owner's hints; "
      "a quality correction (fresh session) carries them, a resumed full-access continuation does not")
answer_hints = section(MAIN, "func rccAnswerHints(ownerRequest: String,", "\n}")
# Review of H2: the gate counts signals across the whole envelope, so the note
# is judged inside the envelope it would travel in, never on its own.
check("LocalClassifierHints.load(home: home).hints" in answer_hints and
      "envelope: ([LocalClassifierHints.Hint]) -> String" in answer_hints and
      "!protectedRouteMaterialInEvidence(envelope(hints)) else { return [] }" in answer_hints and
      "protectedRouteMaterialInEvidence(note)" not in answer_hints,
      "rccAnswerHints keeps the hints only when the envelope WITH the note passes the protected-material gate")
check(ENVELOPE.count("LocalClassifierHints.answerNote(") == 1 and
      "let note = exact || (continuation != nil && !continuationInFreshSession) ? nil :" in ENVELOPE and
      'if let continuation { return continuation + (note.map { "\\n\\n" + $0 } ?? "") + "\\n\\n" + rules + "\\n\\n" + references }' in ENVELOPE and
      'backgroundEnd +\n            (note.map { "\\n\\n" + $0 } ?? "") +\n            "\\n\\n" + references' in ENVELOPE,
      "the envelope builds the note in one place, after END BACKGROUND or a fresh-session continuation's prompt, "
      "never for an exact-answer child or a resumed continuation")
# Review of H2: the note never changes a post-check's activation. The
# deferred-deliverable check (the one post-check that read the whole native
# input) reads the same input built from the note-free envelope.
check("let deliverableCheckPrompt = delegated == noteless ? nativePrompt :" in adapter and
      "try providerPrompt(current: noteless, context: h.context, r2Evidence: sourceDelivery.payload, workspaceContext: checkInHint)" in adapter and
      "deliverableCheckPrompt: deliverableCheckPrompt," in adapter and
      MAIN.count("claudeOutputDefersRequestedDeliverable(answer, prompt: deliverableCheckPrompt ?? prompt)") == 1 and
      "claudeOutputDefersRequestedDeliverable(answer, prompt: prompt)" not in MAIN,
      "the deferred-deliverable post-check reads the input without the ASR hint note")
# Review of H2: the local lane (rcc-plugin.mjs) gets the same line. Its hints
# are a mirror of the Swift ones: the compiled list, the limits, the line and
# the forbidden characters must match the Swift source exactly.
PLUGIN = (ROOT / "Resources/openclaw-os1-bridge/rcc-plugin.mjs").read_text()
swift_compiled = re.findall(r'\.init\(heard: "([^"]+)", intended: "([^"]+)"\)',
                            section(HINTS, "public static let compiled: [Hint] = [", "]\n"))
js_compiled = re.findall(r"Object\.freeze\(\{heard: '([^']+)', intended: '([^']+)'\}\)",
                         section(PLUGIN, "export const ASR_HINT_COMPILED = Object.freeze([", "]);"))
check(len(swift_compiled) == 4 and js_compiled == swift_compiled,
      "the bridge's compiled hints are the Swift compiled hints, in order")
swift_note = section(HINTS, "public static func answerNote(", "\n    }")
lead = re.search(r'return "([^"]+)" \+', swift_note).group(1)
tail = re.search(r'joined\(separator: ", "\) \+\n\s+"([^"]+)"', swift_note).group(1)
check(f"const ASR_NOTE_LEAD = '{lead}';" in PLUGIN and f"const ASR_NOTE_TAIL = '{tail}';" in PLUGIN and
      "matched.map(hint => `'${hint.heard}' → '${hint.intended}'`).join(', ')" in PLUGIN and
      "matched.map { \"'\\($0.heard)' → '\\($0.intended)'\" }.joined(separator: \", \")" in swift_note,
      "the bridge's note line is the Swift line, byte for byte")
check("public static let maximumPairs = 200" in HINTS and "public static let maximumHeardCharacters = 40" in HINTS and
      "public static let maximumIntendedCharacters = 80" in HINTS and "public static let maximumFileBytes = 32_768" in HINTS and
      "public static let maximumPerRequest = 8" in HINTS and
      "const ASR_HINT_LIMITS = Object.freeze({pairs: 200, heard: 40, intended: 80, fileBytes: 32_768, perRequest: 8});" in PLUGIN,
      "the bridge's owner-file limits are the Swift limits")
swift_extra = re.findall(r"\\u\{([0-9A-F]{4})\}", section(HINTS, "static let forbidden = ", "public static func valid("))
js_extra = re.findall(r"\\\\u([0-9A-F]{4})", section(PLUGIN, "const ASR_HINT_FORBIDDEN = new RegExp(", "'u');"))
check(len(swift_extra) == 21 and set(swift_extra) <= set(js_extra) and "$0.properties.isQuotationMark" in HINTS and
      "\\\\p{Quotation_Mark}" in PLUGIN and "\\\\p{Cc}\\\\p{Cf}\\\\p{Cs}" in PLUGIN and
      "<>\\'\"‘’‚‛“”„‟`" in PLUGIN and 'CharacterSet(charactersIn: "<>\'\\"‘’‚‛“”„‟`")' in HINTS,
      "the bridge refuses every character the Swift owner-file grammar refuses")
local = section(PLUGIN, "export function localModelExecutor(", "async function readExactNativeReceipt(")
check("const asrNote = arithmeticResult(ticket.instruction) === null ?\n      asrAnswerNote(ticket.original_objective, await loadAsrHints(home)) : null;" in local and
      "style: localWorkerStyle(ticket), asrNote}" in local and
      "content: asrNote ? instruction + '\\n\\n' + asrNote : instruction" in PLUGIN and
      "home: process.env.OS1_RCC_NATIVE_HOME})" in PLUGIN and
      "join(home, '.os1/local-classifier/asr-hints.json')" in PLUGIN and
      "constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK" in PLUGIN,
      "the local executor appends the note after the instruction's bytes, from the owner's home, never for exact arithmetic")
check(MAIN.count("LocalClassifierHints.answerNote(") == 1 and HINTS.count("public static func answerNote(") == 1 and
      "valid($0.heard, maximum: maximumHeardCharacters) && valid($0.intended, maximum: maximumIntendedCharacters)" in
      section(HINTS, "public static func answerNote(", "\n    }"),
      "one note builder, and every pair re-checked against the owner-file grammar")
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
print(f"OS-1 harness profile wiring: {checks} checks PASS (H2 v1 after H0 v1 and H1 v1, parity unverified; source only)")
