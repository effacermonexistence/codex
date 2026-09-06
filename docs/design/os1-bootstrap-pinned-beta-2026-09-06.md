# New-Mac OS1 release selection repair

Objective: a new-Mac bootstrap must install a Fleet-capable OS1 main runtime, not download the old stable CLI then fail its new hook commands. Preserve device-specific OAuth, native trust and macOS permission boundaries.

Observed: `/v1/releases/latest` returned 0.9.1 while main's installer calls `fleet-self-test` and configures native hooks. Build70 beta.4 passed clean Mac installation gates and actual Pro native Codex/Claude delivery, but is not Apple-notarized. Stable promotion is not justified by that evidence.

Five views: intent/runtime mismatch (0.9.1 vs build70); source continuity (fixed source commit, tag, asset and inner hashes); capability (existing official installer, no copied credentials); verification (build/architectures/signature/allowlist before installation); cost and UX (fail before system mutation, one pinned download, no model calls); security (no trust-store edits, no Gatekeeper/TCC changes).

Architecture: inspect stable metadata → use stable only when Fleet-compatible → otherwise explicitly announce the pinned unnotarized beta → verify GitHub release/tag/commit and ZIP hash → verify inner PKG/hash/version/build70 → run the trusted main installer. The installer rechecks stable version after download to reject pointer drift. Never modify the stable manifest. Network or malformed metadata errors do not silently trigger a different source. Existing installer manages per-device OAuth and official native hook review.

Acceptance: old stable falls back, compatible stable stays stable, moved tag/asset/manifest/hash fails before installation; fresh private staging plus verify-only performs no app/config installation; current native/account state remains unchanged. Clean CI builds the universal runtime and tests the pinned download path. Rollback: revert only bootstrap selector/helper and installer version guard; immutable beta.4 and previous packages remain intact. A verify-only run is not a fresh-Mac installation and does not substitute for per-device approvals.
