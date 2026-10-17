# SCV Instagram v194 surface-history custody (2026-09-16)

This records the build-lane release that replaced v193 the same night. It does not promote Gold, enable customer
traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v194` |
| content fingerprint | `9ae2335e31fd705866f6edf49302dfb8d87dcd712206a7a605c1619f32bc6d57` |
| release manifest sha256 | `4d4c2ec691a146803aa4aa2e24c2f1bff50f43f906701b90fef8200d7c1cc1b7` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260915T232722Z/v194/runtime/scv-instagram-single-20260914-v194-runtime.tar.gz` sha256 `49e5be2b4be96184d91b927d42a9609525d63fd815a2b2d1c73bbbba68c909ca` (1726624 bytes) |

## Requested conversation change (owner order 2026-09-15)

v193 returned the assistant's own turns to the author's conversation. Auditing the rest of that path afterwards, by running
the real production loader rather than by reading the code, showed the conversation still was not what the thread held:
every prior turn on both sides arrived as the English canonical, with only the newest client message in the thread
language. The load boundary deliberately puts the English canonical in `text` and keeps the written surface in
`text_delivered`, and `originalEventText` prefers `text_delivered` for exactly that reason - but the field whitelist in
`dm-authority.loadRecentThreadHistory` dropped it, so the preference silently resolved to English. The model was
continuing a Korean conversation it could only read in translation.

v194 carries `text_delivered` and `text_canonical_en` through that whitelist. `text` is unchanged, so every parser that
reads it is byte-identical; the only consumers that see a difference are the ones already asking for the delivered
surface and receiving `undefined`. Preserved: models (nano), routes, literals, identity source bytes
(`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`), booking/deposit gates, templates, delivery-truth
semantics, the v180-v193 laws, ManyChat configuration, staging v168, Gold pins.

## Executed verification

- Active Railway deployment `3b9ead62-ab4b-4629-a104-28c27ba02fec`; 292 installed sealed-file hashes verified; 22 installed harnesses
- Regression ledger: 118 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probes on `gpt-5.4-nano-2026-03-17` in the production container scratch root: 2 of 3 adopted after at most one
  emulated re-author pass, 5 author calls, replaying the exact live contradiction sequence, with the supplied own-turn count recorded per case; 0 customer sends
- Fresh code-locked Omar.system reset at `2026-09-15T23:27:57.711Z`: residual 0 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 292 files, 22 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260915T232722Z/v194/v194-r2-manifest.json` sha256 `9e96f1e621b1090fe8ce5037bb3911865441cf5cff2545ae66e78f3aa42eb4f3`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; v193 stays in the pointer chain
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v56/v194 Worker version `6d23ec15-2442-43aa-8472-957896986f24`, first v56 scheduled run `2026-09-15T23:35:22.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-15/20260915T233522000Z.json` sha256 `f772340cec270fb498f0151f6221e8f329bbc2b3a42a032b04b9547be4f6299c` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
