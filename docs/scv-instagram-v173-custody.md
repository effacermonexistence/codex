# SCV Instagram v173 custody record (2026-09-12)

Contextual conversational voice repair on the sealed production runtime. No recovery Gold promotion.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260912-v173` |
| content fingerprint | `0c85fd62640593df35048cbb40247df5a5b7001e442b72f12d27537646470582` |
| release manifest sha256 | `f982f01c3e3400b704b89b23e1e93b086b6c5222a06884fa9e62ee21d24b81e8` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260912T215417Z/v173/scv-instagram-single-20260912-v173-runtime.tar.gz` sha256 `3e6a06c84c11064092402586b7494ebf6c9c73b4d8496ea3dfa3ada6e1f14645` (1578654 bytes, downloaded and byte/hash verified) |

## Changes

- Social/general replies reject unsolicited helper offers such as offers to summarize or rewrite; explicit customer requests for those actions remain allowed
- A candidate rejected for voice or repetition cannot re-enter through the original-candidate liveness rescue after rewrite failure
- A self-contained direct social answer may end naturally without an unnecessary follow-up question; biography questions still require an answer
- Final generation guidance preserves short contextual language and avoids invented human activities; booking policies and approved information greeting remain unchanged
- Tone guidance used aggregate observations from the existing Instagram sent-message export; no private quote bank was bundled and no YouTube/X/Reddit corpus was inspected

## Executed verification

- Full existing suite: 102 commands passed after stale expectations were aligned with the new direct-social-reply contract
- New client-voice harness: 20 checks, including Korean/English paraphrases, explicit-request exemptions, bounded regeneration, and rejected-candidate non-adoption
- Production installation matched all 268 sealed input hashes and the release manifest
- R2 download matched archive SHA-256 and byte count; a fresh private cold restore matched all 268 inputs plus the manifest and passed four no-send harnesses
- Fresh exact Omar.system reset: ten workers paused and resumed, distinct pre/post snapshots restore-drilled, post-audit residual zero
- Post-reset production readiness was healthy and publication-pending checks were false

## Preserved boundaries

Production is restricted to the existing Omar.system debug identity. Staging v168 remains deliberately paused. ManyChat, non-debug customer state, model identity, pricing, booking policies, approved Gold pointers, and recovery evidence pins were not changed.

The archive is code-only, excluding credentials and mutable customer state. Cold package restoration is not a full operating-server disaster recovery claim. No-send harnesses verify the implemented rule boundaries, not universal naturalness or GPT parity. The owner performs the final Instagram delivery and tone test.
