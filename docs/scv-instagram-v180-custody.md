# SCV Instagram v180 source custody (2026-09-14)

This records read-only acquisition of an already-running release for OS1.
It does not deploy, reset, promote Gold, or enable customer traffic.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v180` |
| content fingerprint | `4f18ad47de8f95569867528948cef404ab0fceb5fed44a4b948f6a47c740221e` |
| release manifest sha256 | `06c0f31ccedc2e23cd2a001549b7c3e7169f171a855b8d52f6e1b7331dfc0840` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260914T100220Z/v180/runtime/scv-instagram-single-20260914-v180-runtime.tar.gz` sha256 `73892fd03d4342550631947afa54805f9b6eefc36f24173104a0b9dc6094a243` (1620783 bytes) |
| OS1 source archive (R2) | `scv-instagram-automation/source-custody/88359398a04f6c98f484b6c9c2c5c36297ec5c27c54ea02ed37a0c5c1bc6e119/source.tar.gz` sha256 `88359398a04f6c98f484b6c9c2c5c36297ec5c27c54ea02ed37a0c5c1bc6e119` |

At 2026-09-14T10:02:55Z the authenticated operator checked /readyz before and
after acquiring only the current container's 278 manifest-listed source files
and SCV_SINGLE_RELEASE.json. Every source size and SHA-256 matched the live
manifest, the descriptor digest matched the live manifest sha256, and the
content fingerprint was recomputed from the listed files. No unlisted, state
or credential paths were included. The archive uses portable ustar; R2
readback matched its SHA-256 and byte count. Installed OS1 build 114
source-register independently accepted all 278 files against the live
manifest without changing production.

This release replaced scv-instagram-single-20260913-v179 (recorded separately)
while that record was being published; both records describe releases that
were observed live at their own acquisition times.

The server reported production active, critical alerts 0, operational alerts 2.
Its behavior-contract identity remains Omar.system-only. This acquisition does
not verify customer-visible delivery or change audience/pause/ManyChat settings.
Sources remain in the existing private bucket; this public record contains only
identifiers, hashes and retrieval metadata. Recovery pointers, dated Gold and
historical baselines are unchanged.

## Release-ready custody and conversation change (build lane, owner order 2026-09-14)

Deployment `2b29d9d3-50c3-4441-b443-a09afdf2766c` was built, sealed and deployed by the build lane from the v179 source
with the unified owner persona change; the release-ready package and its evidence live beside the OS1 source
custody above:

- Release-ready runtime archive `scv-instagram-automation/release-ready/20260914T100220Z/v180/runtime/scv-instagram-single-20260914-v180-runtime.tar.gz` sha256 `73892fd03d4342550631947afa54805f9b6eefc36f24173104a0b9dc6094a243` (1620783 bytes); R2 readback and
  cold restore verified (278 files, 11 harnesses including
  `scv-unified-persona-harness.js`)
- Custody manifest `scv-instagram-automation/release-ready/20260914T100220Z/v180/v180-r2-manifest.json` sha256 `85e4ef5b062e4388129ccf6a5fdabd116881cc47f4e8fafa487c8f9e5d0ed699`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; v179 stays in the pointer chain

Owner order (2026-09-14): to the client, Ben, Lua and the account owner are one person. On sealed v179 the Omar.system tone
test produced "너한테 답장 중이지", "따로 뭐 하고 있던 건 없어", "지금 여기서 너랑 얘기하는 중이야" and "나는 밖에서 실제로 나가진
못하지만 여기서는 같이 놀 수 있어 지금은 수다 모드야" on four `social_continue` turns with zero verifier rejections. The v179 author
layer asked for exactly that ("speak honestly as the conversational AI", "no independently lived day") and the identity
interpretation boundary overrode the owner identity source ("Do not claim to be a human or the human account owner"),
contradicting `lua-dm-master-prompt-v17.txt` line 475 and RCC PART 12B (no AI-general defensive sentences).

v180 rewrites the author layers to the owner persona (social author, identity interpretation boundary, visible surface lock,
relationship and convergence locks, runner social temporal check, temporal verifier instruction), adds one bounded verifier
`scv-unified-persona.js` in the model-authored candidate gate (physical-absence, chat-only existence, chat-mode, AI self-label
and chat-presence-as-activity lines are rejections re-authored by the existing loop), answers a hangout invitation with interest
or a rain check without naming a day, time or place, and answers a direct "are you an AI" question as the owner in one line.
Preserved: identity source bytes (`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`), booking/deposit gates,
punctuation policy, transport/durability paths, ManyChat configuration, staging v168, Gold pins, the romantic/attachment boundary.
The executor non-identity instruction budget is 28950 of 28967 bytes.

Executed verification:

- Installed sealed-file hashes verified in the container (278 files, 11 installed harnesses)
- Regression ledger: 107 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probes on `gpt-5.4-mini-2026-03-17` in the production container scratch root: 12 of 13 adopted,
  including the exact four-turn owner replay of 2026-09-14 08:56Z; 0 customer sends. The one non-adoption is French
  "week-end", whose hyphen hits the pre-existing dash lock (v179 behaviour, backlog)
- Fresh code-locked Omar.system reset at `2026-09-14T10:01:23.555Z`: residual 7 to
  0, 10 workers paused and resumed, pre/post state snapshots with restore drills,
  downloaded from private R2 and restored into isolated directories with matching namespace tree digests

Sentinel alignment: v41/v180 Worker version `9b1239d2-46ec-4d33-bd6d-3b848c68a35e`, first v41 scheduled run `2026-09-14T10:10:47.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-14/20260914T101047000Z.json` sha256 `20f505ce1c619de387dcfa29fba6573075cd892ab69f5beb973e78ecddbe1ae9` downloaded from R2 and hash verified; the aggregate stays 503 by design while staging v168 remains pinned apart.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
