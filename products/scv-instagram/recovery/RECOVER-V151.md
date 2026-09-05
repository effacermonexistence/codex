# Recover saved v151 artifacts without the original Mac

This entry point downloads the exact timestamped recovery point and both later
extensions from private R2, verifies every SHA-256 and byte count, and reconstructs
the sealed source and saved production-state tree in a **new private directory**.
It does not depend on the original Mac's workspace layout, downloaded files,
temporary decryption key or a historical Railway deployment ID.

It does **not** restore ManyChat configuration, recover secret values, deploy,
send messages, reset Omar.system or claim full-system recovery. OS archives are
downloaded and hash-verified, not booted by this entry point. Historical deployed
restore receipts are preserved as evidence, never promoted to a new test result.

## Acquisition and source/state restoration

Use a trusted checkout of `effacermonexistence/codex`, its lockfile-installed
Wrangler 4.127.1, Node compatible with that CLI, `tar`, and an existing authorized
Cloudflare connection. Do not copy authentication caches or ask for pasted keys.
The output directory must not exist, its parent must exist, and it must be outside
the public repository. Approximately 420 MB is downloaded, including both exact
OS encodings and the historical evidence; allow at least 1 GB of free space.

From the repository root:

```sh
node products/scv-instagram/scripts/recover-v151.mjs \
  --point scv-instagram-20260904T222549Z-v151-clean-current \
  --target /absolute/private/existing-parent/new-v151-recovery
```

The command uses only official `wrangler r2 object get --remote` operations. It
does not open a login page or modify cloud resources. If any download, hash,
archive safety, inventory or state-tree check fails, no success receipt is written.
Partial output is preserved for inspection, never silently overwritten or deleted.
Retry with a different new destination; do not treat partial output as verified.

Successful output contains:

- `objects/`: every pinned component under its original R2 object key.
- `staged/runtime/`: exactly the 254 canonical files and release descriptor.
- `staged/production-state/prod/`: saved state, matching the 2,128-entry tree;
  only the historically documented volatile supervisor-status file is excluded
  from equality. AppleDouble `._*` archive metadata is excluded on extraction.
- `ACQUISITION-AND-RESTORE-RECEIPT.json`: the artifact inventory, source and state
  verification, and explicit **false** values for unperformed full-system checks.

For another offline drill, pass `--offline-root /absolute/prior-recovery/objects`
and a different new `--target`. Every input is byte-verified again; no network is
used. The program does not execute restored application code in either mode.

## Required next gates — not automatic or already passed by this command

1. Use the pinned secret-recovery tooling to create a **new ephemeral job** and
   recover the frozen `v151_20260904T222549Z_*` secret generation. Do not reuse the
   old encrypted capsule with its intentionally destroyed private key, print
   secret values, or import laptop OAuth caches. Check all 112 environment hashes.
2. Resolve the authentic current target host/service/environment. The archived
   staging operators are exact-target historical evidence and may reject a new
   deployment. Do not blindly replay or weaken their target, pause, preservation,
   source-integrity or namespace gates. The verified OS closure supports a
   registry-independent Linux/OCI build; actual devices and `/proc` come from the host.
3. Capture and restore the full current ManyChat nodes, triggers and External
   Request definitions. The existing 2,137-byte flow inventory is insufficient.
   A task-scoped browser without visible tabs is **unknown access**, not proof the
   user is logged out. Inspect existing authenticated surfaces before asking them.
4. Follow a fresh exact-target Omar.system reset and pre/post snapshot drill for
   any authorized live red team, then observe a real ManyChat-origin inbound and
   Instagram-visible reply from the recovered deployment. Provider acceptance,
   old reset receipts and `/readyz` are not substitutes. Do not route customer
   traffic or perform a production cutover simply to obtain a passing receipt.

The April origin, GOLD-3, prior v150 and this v151 point remain separate. This is
recovery of the saved timestamp, not every message received after that timestamp.
Account access, provider availability and future credential/model validity remain
external dependencies; no unconditional future-service guarantee is made.

Command reference: [Cloudflare R2 download documentation](https://developers.cloudflare.com/r2/objects/download-objects/).
