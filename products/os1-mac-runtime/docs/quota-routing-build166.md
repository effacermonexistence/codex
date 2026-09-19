# Build 166: weekly quota rejection and safe alternate routing

## Observed failure
The installed runtime classified Claude's `You've hit your weekly limit` response as unclassified. The provider emitted a synthetic rate-limit assistant event followed by an API-error 429 result with zero usage and one rejected turn. Repeated verification attempts selected other Claude models, which share the exhausted account allowance.

## Repair
- Recognize weekly-limit wording as quota exhaustion, but only on an error terminal result.
- Distinguish CLI dispatch from a protocol-attested rejection before model execution.
- Require matching session IDs, one terminal result, API error 429, one turn, four zero usage fields, no permission denial, no assistant generation/tool/subagent execution and no damaged stream.
- Require the observed workspace hash to remain unchanged before applying that state to a write-capable request.
- Auto mode preserves the permission profile and context and requests an available alternate provider. Explicit provider pins remain explicit. Partial execution or ambiguous effects are not blindly replayed.
- Do not retry different Claude models against the same exhausted account.

This does not change provider quotas, credentials, billing or OS permissions. Existing held website/deployment work is not automatically repeated by installing the repair.

## Verification
`QuotaRejectionFixture.swift`: 17 assertions, including session mismatch, nested tools, corrupt streams, multiple turns/results, nonzero usage, policy denial, changed workspace, alternate selection and no available alternate.
Full OS1ContextTests passed before release staging. Live/install receipts are stored privately under `~/.os1/verification/quota-routing-build166/` and the standard self-update outcomes directory.

## Repair method
External feedback rather than generated self-assurance: https://arxiv.org/abs/2310.01798 . The actual adoption anchors are the provider stream, deterministic tests, staged executable checks and live runtime receipts, not the paper.

## Build environment
A first release build encountered duplicate Darwin module-cache identities through a symlink and its physical path. Only generated per-architecture build outputs were cleared; the rebuild uses the physical source path. User sessions, queues and the untracked website workspace were preserved.

## Installed/runtime receipt
Build 166 was installed by OS1 self-update. All nine installer gates passed; conversations remained 98 → 98. The installed app process and CLI 0.9.100/build166 were observed after installation.

The opt-in live quota script passed: an explicitly pinned Claude request stopped after one classified quota rejection; a separate Auto request completed through Codex with a verified native record in 19.8 seconds. Auto selected Codex initially in that run, so this live receipt is **not** a Claude-to-Codex mid-request handoff reproduction. That branch is covered by the deterministic quota fixtures.

An additional exploratory request in `/tmp` returned Codex text but did not pass final adoption (effects_uncertain); it is retained as a failed test, not counted as success. Temporary quota-window preference changes used during that experiment were restored byte-for-byte. No held user operation was replayed.
