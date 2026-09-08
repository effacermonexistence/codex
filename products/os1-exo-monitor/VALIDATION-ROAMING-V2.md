# Roaming v2 validation — 2026-09-07 (America/Los_Angeles)

Scope: preserve the existing two-node ZeroTier/EXO connection after Wi-Fi
changes and display measured recovery status. No physical Wi-Fi change was
performed on the user's active connection.

## Passing checks

- 21 standard-library policy/effect/rollback tests; no live services touched by
  tests. Covers changed Wi-Fi, offline peer, recovery grace/stagger, busy or
  malformed state, ongoing downloads, identity mismatch, exact local SIGTERM,
  persistent budget, ambiguous bootstrap timeout and rollback.
- 4 source-overlay route/sanitization/freshness tests.
- Mock R2 package validation and invalid-object-key rejection.
- Root `pnpm run check:all`, Python Ruff checks and dashboard production build.
- Pro rebuilt binary passed ad-hoc codesign verification and preserved peer ID.
- Independent live check: 92.34s, 19 samples, zero failures. Both APIs retained
  exactly the same enrolled two nodes; every lastSeen advanced, maximum age
  6.143s. Pro roaming status was connected and fresh throughout; six guard
  updates with maximum age 14.883s. Recovery count remained zero. EXO PID
  59858/runs 1 and guard PID 60807/runs 1 were unchanged.
- Browser showed Pro `연결 정상 · Wi-Fi 이동 감시 중`, recovery count zero.
- Installed guard/source SHA-256:
  `137b333d959e9658868f0606ab1588d96ea7ea69967c697251db9d50959fb633`.

## Boundaries and pending evidence

Air's Activity endpoint is reachable but its roaming field was absent at this
check. Publishing the shared R2 package is not evidence that Air installed it.
Air's local executor must apply the release before both sides can report guard
installation. No credentials were copied and Air was not remotely modified.

This does not guarantee captive-portal login, transport through every hotel
firewall, resumption of interrupted inference, or transparent pooling of all
macOS processes. Actual travel between two Wi-Fi networks remains untested.

Full upstream EXO checks are not claimed: Svelte has 15 pre-existing errors in
unrelated files, nix/project pytest are unavailable, and a complete successful
basedpyright result was not obtained. The focused helper tests and built
Activity route passed. Portable mail-patch context lines intentionally retain
their whitespace; the source changes themselves passed Ruff/diff checks.
