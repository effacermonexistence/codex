# SCV Instagram v172 custody record (2026-09-12)

Sealed production runtime with narrowly scoped reset-orphan reconciliation and extended client-language normalization/rendering. No recovery Gold promotion.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260912-v172` |
| content fingerprint | `5efa093308ef32400b20e7c193d38e387180b31a43ea0c2af5d36b91c2747acc` |
| release manifest sha256 | `eca63fd9b8e36ff0a7253b77b5c86a802871af9cfff989f55a6d8120f547dd56` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260912T193958Z/v172/scv-instagram-single-20260912-v172-runtime.tar.gz` sha256 `981669ffe3dce597038b102efebeec64f20817175e54473f7c7455425709e94a` (1575435 bytes, downloaded and byte/hash verified) |

## Changes

- Old accepted-unverified pending records can be quarantined only for the exact code-locked debug identity when its absent observer and a valid strictly newer reset watermark establish the reset orphan. Pending bytes and a durable audit are preserved. Customer records and active locks are excluded.
- Existing English/French/Spanish/Korean fast paths remain. Other supported language tags use the bounded model executor and persisted thread language. English canonical semantics and protected-token verification stay authoritative; failed rendering retains the English never-silence floor.

## Executed verification

- Existing full npm suite and single-release suite passed, including the two new harnesses
- Reset-orphan harness: 13 checks; extended-language harness: 29 checks; existing client-language harness: 257 checks
- Separate cold restore from the R2 readback matched all 267 sealed inputs and the recomputed release fingerprint; all three harnesses passed in that restored copy
- Production installation matched all 267 sealed input hashes and the exact release manifest
- Fresh exact-debug reset: 10 workers paused and resumed, distinct pre/post snapshots restore-drilled, residual count zero
- Post-reset publication checks returned false and production readiness returned HTTP 200 with preflight verified and fail-close inactive

## Preserved boundaries

Production remains restricted to the existing Omar.system debug identity. Staging v168 remains deliberately paused; its sentinel mismatch is expected. ManyChat, non-debug customer state, model identity, pricing, booking policies, existing Gold pointers and recovery evidence pins were not changed.

The archive is code-only, excluding credentials and mutable customer state. It is not proof of full operating-server recovery. Language tests use injected deterministic executors, not an empirical guarantee of every language. Final Instagram user-visible delivery remains the owner's test; provider acceptance alone is not a customer-visible receipt.

The pre-existing B2 Korean-design and D2 English-design reproduction cases with `semantic:size_answer_requires_visible_next_move` under a `resolve_context` plan are outside this patch and remain unchanged. No claim of universal conversation perfection is made.
