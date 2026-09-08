# Recover the v167 Gold without the original Mac

Second owner-approved recovery Gold (2026-09-08). It is a **separate dated Gold**: its own
record, its own point manifest and its own timestamped R2 keys. The first Gold
(`scv-instagram-recovery-gold-20260905T054647Z-v151`, snapshot 2026-09-04 22:25:49 UTC)
is untouched and stays restorable by id; see [RECOVER-V151.md](RECOVER-V151.md).

Identity (never inferred from memory): `LATEST_GOLD.json` on trusted **main** names
`scv-instagram-recovery-gold-20260908T231500Z-v167`; its dated record is `gold/20260908T231500Z-v167.json` (`2608` bytes,
sha256 `41ec7dae8f527470f0c471e5425605ff692306c81eab6cf8d7e9c4f9b2605038`). The record pins the point manifest
`scv-instagram-automation/recovery-points/20260908T221557Z/SCV_RECOVERY_POINT.json` for point `scv-instagram-20260908T221557Z-v167-clean-current` — snapshot **2026-09-08 22:15:57 UTC /
2026-09-08 15:15:57-07:00 America/Los_Angeles**, promotion 2026-09-08 23:15:00 UTC. Release
`scv-instagram-single-20260908-v167`, fingerprint
`6b85a63a25c23e9815491413eeb895e6b78ed8faa523f18aefea6b88f392faa7`, descriptor sha256
`2f12a00d12114bbbb05080438dda88a6278a82ae65a9fc9aaaff70a2a25ad4b6`, runtime package
`scv-instagram-automation/release-ready/20260908T203126Z/v167/…-any-picture-is-a-design-r2.tar.gz`
(sha256 `94ce2f59b5f3724118cfcabe16cfb7f267f00f7c6f01841be42dbf6c77e56afe`).

What the point holds: the sealed runtime and descriptor, the **post-reset clean production
state** (debug identity purged, customers preserved) with its pre-reset state and reset
receipt, the paused-worker **owner-verified state capture** taken before that reset (the
state exactly as the owner passed it), the production environment manifest (variable names,
lengths, hashes; secret values never stored), the live red-team evidence, the final
readiness snapshot and the offline restore tool. Extensions (OS closure, frozen secret
generation, deployed restore drill) are listed in the record's `manifests` when published.

From a trusted checkout of `effacermonexistence/codex` (pinned Wrangler 4.127.1, Node 20):

```sh
node products/scv-instagram/scripts/recover-gold.mjs --resolve --gold scv-instagram-recovery-gold-20260908T231500Z-v167
node products/scv-instagram/scripts/recover-gold.mjs --gold scv-instagram-recovery-gold-20260908T231500Z-v167 \
  --target /absolute/private/existing-parent/new-v167-gold-restore
```

Every referenced object is fetched from private R2 and byte-verified; the receipt is
**acquisition**, not activation. Activation follows [GOLD-RESTORE.md](GOLD-RESTORE.md)
(preserve the current state under a new timestamp, restore code/prompts/settings, verify,
run the exact-target Omar.system reset, save an activation receipt). Restoring the saved
customer state to this timestamp is a separate destructive choice that requires an
explicit request. ManyChat configuration is out of scope.
