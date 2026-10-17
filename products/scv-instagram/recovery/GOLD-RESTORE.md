# Latest approved SCV recovery Gold — shared Codex / Claude procedure

The owner edits wording in Claude and wants a persistent fallback usable from
either agent, including on a replacement Mac. ManyChat configuration is excluded.
Do not turn this into wording changes, a new account setup or an Omar.system-only
reset. "최신 Gold로 돌아가", "최신 골드로 복원해", "restore latest Gold", and
"Reset to Gold" refer to `LATEST_GOLD.json`, not `LATEST.json`, git HEAD or an
unapproved newest backup. A question about readiness does not execute a rollback.

## Exact identity, never inferred from memory

Read `products/scv-instagram/recovery/LATEST_GOLD.json` from the trusted
`effacermonexistence/codex` **main** revision, then verify the byte count and hash
of its dated record. Read that record's exact point and closure manifests.
Do not let a stale checkout, edited prompt, conversation summary, old work path,
deployment ID or directory modification time choose the target.

This first recovery Gold is `scv-instagram-recovery-gold-20260905T054647Z-v151`.
Promotion: 2026-09-05 05:46:47 UTC. The underlying snapshot is **2026-09-04
22:25:49 UTC / 2026-09-04 15:25:49 America/Los_Angeles**. Promotion is not a new
customer-data snapshot. Its source still matched production at promotion audit;
111/112 environment hashes matched, with only platform-assigned HOSTNAME different.
Keep real new platform identity fields, never impersonate the old host identity.

Ordinary wording edits, commits, deploys and backups MUST NOT advance Gold.
Only an explicit owner request to promote a new Gold, followed by a separate
verified snapshot, may create another dated record and advance `LATEST_GOLD.json`.
Never overwrite dated Gold records or repurpose April Gold / behavioral GOLD-3.

## Several dated Golds, kept completely separate (2026-09-08)

The owner approved a second Gold on 2026-09-08 (the running v167, red-teamed by the
owner after the deploy). Golds are **dated records that coexist**; nothing about an
earlier Gold changes when a later one is added:

- Every Gold has its own record under `recovery/gold/<promotion-timestamp>-vNNN.json`
  and its own timestamped R2 keys (`recovery-gold/<promotion-timestamp>/…`,
  `recovery-points/<snapshot-timestamp>/…`). A record's point timestamp must equal the
  timestamp in its point-manifest key; the resolver rejects any record that mixes dates.
- The v151 record (`gold/20260905T054647Z-v151.json`, snapshot 2026-09-04 22:25:49 UTC,
  promotion 2026-09-05 05:46:47 UTC) and every R2 object it names stay byte-identical
  forever. The resolver keeps its original hard pin on exactly the v151 point and its
  three manifests.
- `LATEST_GOLD.json` names the **latest** owner-approved Gold. "최신 Gold로 돌아가" /
  "restore latest Gold" means that one. An earlier Gold is restored by its exact id:

```sh
node products/scv-instagram/scripts/recover-gold.mjs --list
node products/scv-instagram/scripts/recover-gold.mjs --resolve --gold scv-instagram-recovery-gold-20260905T054647Z-v151
node products/scv-instagram/scripts/recover-gold.mjs --gold scv-instagram-recovery-gold-20260905T054647Z-v151 \
  --target /absolute/private/existing-parent/new-v151-gold-restore
```

- The acquisition receipt records which Gold was selected (`selected_by`,
  `is_latest_approved_gold`) so an old-Gold restore can never be mistaken for the
  latest one. Each Gold's guide (`RECOVER-V151.md`, `RECOVER-V167.md`) stays with it.
- Adding a Gold = a new dated record + a new pointer commit after its own verified
  snapshot, point manifest, R2 readback and owner approval. Ordinary edits, deploys,
  backups and Omar.system resets never add or move a Gold.

## New Mac / original Mac unavailable

Obtain a fresh trusted main checkout via the durable bootstrap or verified
Git-to-R2 repository bundle. The bootstrap installs both agent instruction
files and pinned tools. Reuse existing authorized connections; a genuinely new
device can require official OAuth approval. Never copy login caches, depend on
the old Mac's private working directories, or request pasted secret values.

From the trusted repository root, inspect the target without changing state:

```sh
node products/scv-instagram/scripts/recover-gold.mjs --resolve
```

Download and verify the Gold into a NEW private directory outside public Git:

```sh
node products/scv-instagram/scripts/recover-gold.mjs \
  --target /absolute/private/existing-parent/new-gold-restore
```

Every object referenced by the selected Gold is fetched from private R2 and
verified. The prior guide recorded 60 referenced objects for its then-selected
Gold, including source, saved state, OS closure, environment manifest and
reconstruction evidence;
newer Golds have their own exact component count in the acquisition receipt.
`--offline-root /absolute/verified-mirror/objects` is available for offline drills.
This command never deploys, executes restored source, reads secret values or
applies historical customer state. Its receipt is **acquisition**, not activation.

## On an actual request to return the operating server to Gold

1. Resolve the current authorized production project/service/environment and
   running release. The recorded SCV service is project
   `fdd36e46-842c-457e-87ec-3e4505c8c2e2`, environment
   `b18df959-2017-428d-8b8c-0ad5dedec43b`, service
   `deff354a-08f1-41ac-9609-4d7d86d5fa44`; validate those live, never guess a target
   or blindly replay an archived operator pinned to an old deployment.
2. Preserve the current checkout, current running code/configuration and current
   production state under a NEW timestamp. Pause the complete verified worker
   set for consistent state snapshots, arm resume cleanup before pausing, verify
   the snapshot by staged restore, and retain an escape path to that pre-rollback
   point. Never use a reset that deletes all customer state.
3. Reconstruct the selected Gold's pinned runtime/OS in isolation. For a dated
   closure that explicitly uses an encrypted environment capsule, use its NEW
   ephemeral recovery-job procedure and destroy only that job's temporary key
   after use; historical destroyed keys/capsules are not reusable credentials.
   Do not invent a capsule requirement for a newer no-credential desktop closure.
   For that closure, preserve existing authorized Railway secrets and complete
   unavoidable per-device OAuth separately. Compare the selected closure's
   available environment/configuration evidence and explicitly map real new
   host/platform identity and validated target-only settings. Never copy auth
   caches or fabricate old environment proof for a different closure.
4. For the user's wording fallback, restore the Gold **code, prompts and settings**
   while preserving current customer messages, appointments, queues and delivery
   ledgers. Check compatibility before activation. Restoring customer data to the
   old timestamp is a separate destructive choice requiring an explicit request;
   never infer it from "Gold로 돌아가" or silently migrate incompatible data.
5. Validate the sealed source, build from the captured dependencies, deploy to
   the verified authorized target, then verify the Gold release/descriptor,
   exact canonical inventory, environment translation, expected worker set and
   readiness. Do not alter ManyChat account/flow configuration or make it a
   missing-export blocker. If a necessary deployment capability is unavailable,
   report that exact limitation instead of claiming success from extraction.
6. Follow the existing mandatory fresh exact-target Omar.system reset procedure
   after a verified production change: pre/post snapshot restore drills,
   code-locked debug-only purge, zero residual audit, Gmail tombstones/watermarks,
   exact worker resume and readiness. This is a completion substep, not a
   substitute for restoring Gold. Preserve every non-debug identity.
7. Save a timestamped activation receipt tying the requested Gold ID to the
   actual target deployment and checks. Only then report the operating server
   restored. Preserve both the pre-rollback point and the Gold unchanged.

## Scope of evidence

The prior v151 evidence proves code/state restoration, exact secret/environment
reconstruction and a fresh Linux/OCI staging deployment. The artifact fault drill
passed 131 checks after repair. This Gold resolver connects that same saved point
to both agents; it is not a new production rollback, a promise of identical future
LLM output or a guarantee of external account/provider availability. The user
can request restoration from either agent; neither should claim that a natural
language instruction by itself has already activated the restored server.

## Desktop closure extension for newly promoted portable Golds

A later explicitly approved dated Gold may include a desktop closure extension.
Its references use the existing `scv-instagram-automation/recovery-points/` prefix
and existing manifest-chain validator. Existing v151/v167 Golds retain their
original records; this section does not retrofit desktop artifacts into them.

The shared bootstrap installs `os1-scv-restore-gold` and the separate pinned
`os1-scv-install-railway` prerequisite helper. The latter uses official Railway
v5.45.10 release asset hashes for arm64/x86_64, does not copy auth, and runs only
when explicitly needed. Codex/ChatGPT and Railway authentication belongs to the
new device; private R2 access uses its existing official connection.

```sh
os1-scv-restore-gold --resolve
os1-scv-restore-gold --target /absolute/private/new-gold-recovery --acquire-only
# Device OAuth and prerequisite checks must succeed before local preparation:
os1-scv-restore-gold --target /absolute/private/another-new-recovery --prepare-local
```

The thin entry point calls the existing `recover-gold.mjs`, then uses ONLY the
Gold-chain-pinned desktop archive, metadata and restore adapter. Native source
retains its exact seven-file hash inventory. The viewer binds loopback only and
resolves the target HOME, not the old Mac username. Native preparation reuses
`install-local.cjs` without `--start`, preserves old plists/source and restores
plist bytes if preparation fails. A loaded old service requires a safe checkpoint
switch rather than automatic overwrite.

Before single-peer activation, use the included `continuity-adapter.cjs` with
the exact source release/config, a fresh full worker/native barrier and canonical
current customer histories. Reuse `portable-history.restoreVisible` to seed NEW
native threads without replaying old input or sending messages. Keep original
native IDs as provenance; do not claim to have transferred authentication or
provider-local hidden state. Per-customer/reset-epoch isolation, local/cloud
CAS phases, pinned receipts and rollback are mandatory. The cloud must still
match the current capture before changing its session associations; a stale
R2 customer snapshot is not permission to overwrite current live state.

The split phases are: `applyLocalPhase` on the target Mac, verified private plan
transfer through existing authenticated SSH, `applyCloudPhase` on the paused
Railway namespace, then `finalizeLocalPhase`. They do not automatically start
a peer. On failure keep peers paused, preserve new diagnostics and use the
verified rollback journal; never blindly replay a turn or restore old failure
files after a new execution/adoption/send has occurred.

Activate only one peer after old-host quiescence or independently verified lease
expiry, then check actual release identity, native online state, production
readiness and the relocated viewer. A same-Mac isolated HOME restore drill is
not a physical new-Mac activation test. Neither source restoration nor backup
means the executor runs while all authorized native hosts are off.


### Supplemental manual-reply context on a replacement Mac

A Gold may also reference a private `manual_context_custody` component. Its
`NEW-MAC-MANUAL-SYNC-RECIPE.json`, verified raw sender corpus, extraction helpers
and existing synchronization installer travel as separately hashed private
artifacts, never in the public repository. The production-state snapshot contains
`manual-ui-context/ACTIVE.json` and the immutable source snapshots it references.

After the source/native continuity gates pass, inspect that recipe and regenerate
the publisher configuration and LaunchAgent with the target device's actual HOME,
Node/Python/Railway paths and verified current release. Reuse the included
`railway-manual-context-publisher.py --probe` and
`install-manual-context-sync.py` plan/apply gates; do not copy an old device plist
or any authentication cache. Preserve original receipt/snapshot bytes and their
historical source paths as provenance. A local watermark, source digest, actual
cloud readback and running worker receipt must agree before claiming synchronization
restored. Unbound source handles remain held; both code-locked debug identities
remain excluded from supplemental history. No historical input replay, customer
send or transactional-state import is authorized by this data-only restoration.
