# Device-owner governance delivery — build173

## Implemented path

Before a CLI task or workflow dispatch, OS1 refreshes the latest locally available
Notes entry whose title contains `RCC ENGINE v26`. It stores the full original
privately and content-addressed, then delivers seven explicitly labeled bounded
source excerpts plus an execution/routing adapter to Codex or Claude Code.
This is a projection, not a claim that the whole original was injected or compiled.

One workflow pins one source/projection identity. Local preflight verifies source
integrity, provider instructions carry the projection, and local postflight verifies
that the pinned original is unchanged before adoption. Run-step and routing records
carry both hashes. Completion-feedback scope includes the projection identity so
feedback from a different policy is not silently reused. Backend permissions remain
binding; attached history does not authorize replay of unrelated work.

Refresh is local and model-free. Private atomic writes, source-path/hash validation,
exclusive refresh locking, timestamp validation and a second Notes index read prevent
promotion of a partially edited or ambiguously selected note. Missing/invalid policy
blocks dispatch before a paid call and preserves existing state.

## Executed verification (2026-09-20 UTC)

- Python synchronizer: 13 tests passed, including scientific-notation modification
  dates, locale-independent epoch construction, concurrent edits/newer notes, ties,
  path/hash/symlink checks, missing anchors and unavailable transport.
- Swift owner-policy fixtures passed: missing/valid/tampered/stale/future records,
  source tampering before/after execution and TaskLocal snapshot isolation.
- Universal release build and signing passed. Payload audit: 23 files, no findings.
- build173 installed as 0.9.107 after the active user task finished. The first
  installation attempt correctly held instead of terminating that task.
- Installer runtime/app/queue/parallel/fleet/queue-fork/composer/steering and existing
  conversations/messages/pins/drafts/native-binding checks passed. Sessions: 100→100.
- Installed CLI equals the staged executable; installed policy helper equals source.
  Installed OS1App process observed after installation.
- Installed build172 (same execution-policy wiring; build173 hardened the refresh
  helper) performed one real delegated Codex workspace write and readback. It wrote
  exactly `OS1_EXECUTION_OK`, returned the matching policy hashes, and was adopted
  by REVAS. Native Codex session:
  `01a0bc99-870a-7a72-9a85-73e1aad05f13`. Native record parsed with zero JSON errors.
  No extra provider call was spent repeating this after helper-only hardening.
- Provider-reported totals for that smoke: input 376,689; cached input 187,776;
  output 1,027 (reasoning 780); total 377,716. Cached input is a subset, not additional
  tokens. This includes inherited backend context. It is NOT a token-savings proof.

Private receipts: `~/.os1/verification/owner-policy-build173/verification.json` and
`~/.os1/recovery/owner-policy-build173-20260920T023756Z/install-receipt.json`.
Private source text, Notes IDs, native conversation content and authentication data
are not committed. Package SHA-256:
`d3863ccd2b6a18db286edcf42b7f723f66aec04bd3d3a7fdde0ee5cad8580918`.

## Scope / remaining limitations

- Latest means latest Notes state accessible on this device, not proof of global
  Apple synchronization. R2 continuity source was older; it was not promoted over
  the newer Notes source. No automatic canonical R2 policy fallback is implemented.
- Remote signed RCC engine remains independently pinned to v30. Local policy
  delivery does NOT prove its remote routing algorithm was regenerated from Notes.
- Model/effort/capacity routing already exists; this patch does not establish optimal
  routing, lower tokens, lower cost or improved task completion rate.
- Hash identity proves delivery/integrity, not model obedience or semantic completeness.
- Claude instruction wiring has deterministic coverage, not a fresh live Claude call.
  Ordinary subscription ChatGPT/Claude Chat is not verified as an executor here.
- No public website deployment, Instagram action or uncertain historical request replay.

## Repair method

Source/log observations → bounded repair → deterministic fixtures → signed/staged
build → installer preservation gates → installed artifact equality and native backend
receipt. ReAct (https://arxiv.org/abs/2210.03629) and intrinsic self-correction limits
(https://arxiv.org/abs/2310.01798) informed the observation/verification discipline;
those papers are not execution evidence or a guarantee of reliability.

## Release-verifier repair

The first CI build exposed the beta installer's stale 18-file payload allowlist.
The helper makes the payload 19 files (22 including component metadata). The exact
helper path is now allowed without relaxing unknown-file or signature rejection.
`test-beta-owner-policy.py` runs the actual verification-only installer: the signed
build173 package passes, a same-file-count helper rename fails the required-helper gate, and
helper content mutation fails signed-resource integrity, even with updated outer
package checksums. The same regression is wired into Mac release CI.

The payload contract is version-bound: releases before 0.9.107 retain the exact
18/21-file legacy contract; 0.9.107 onward require the signed helper and exact
19/22-file contract. Package and app versions must match the manifest. Removing
the new helper cannot select the legacy contract. The actual pinned 0.9.48
build105 bootstrap verification passed locally, alongside all 9 bootstrap tests.
