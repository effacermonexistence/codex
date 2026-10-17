# SCV Instagram v195 evidence-floor custody (2026-09-16)

This records the build-lane release that replaced v194. It does not promote Gold, enable customer
traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v195` |
| content fingerprint | `076fe4176ecccc7a7def2dec55be09432bbb0456fb6b29edba1861b2efa50cc6` |
| release manifest sha256 | `7663a15ff325b4a221036cf6bbe0ea2c11770017ac9fe6ed9282aab363ae1ace` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260916T090129Z/v195/runtime/scv-instagram-single-20260914-v195-runtime.tar.gz` sha256 `779b3ad78b296fc25f206e95a0ada535122b1b5029fb2a91b56cf0d9d029942a` (1740113 bytes) |

## Requested conversation change (owner order 2026-09-16)

The owner reported a live drift on sealed v194: the assistant said it was working on a drawing, the client asked which
drawing, and the assistant replied about its own weekend and then asked the client "what are YOU drawing this time".
Nothing in the thread says the client draws. The control decision for that turn records one candidate pass, zero
re-author passes and a valid final verifier: the line passed every existing gate first try, because nothing in the stack
asked whether a question about the client is grounded in anything the client said. The lead law requires a lead on a
social turn, and the cheapest lead a small model can reach for is to hand its own topic back as a question about the
client, which fills the hidden variable "the client does this too".

v195 enforces, on the client-facing surface, the hard rule the archive context pack already stated in prose: no
unsupported assumption, no hidden-variable facts, do not fill hidden variables for fluency. On the plain-conversation
lanes a wh-question whose subject is the client, about an activity only the assistant has claimed in this thread and that
the client has never claimed for themselves, is rejected on every pass including the last. What the client establishes
about themselves comes from their declarative turns only, so a client question about the assistant's activity never
licenses the same question back. Measured on the owner's own outbound archive, 64.5% of his questions to the other party
re-use a stem from his own preceding messages (normal topic continuation, untouched here) while only 3 of 3,920 name the
other party as the subject of a wh-question and none of those re-use an activity he had just claimed for himself.
Preserved: models (nano), routes, literals, identity source bytes
(`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`), booking/deposit gates, templates, delivery-truth
semantics, the v180-v194 laws, ManyChat configuration, staging v168, Gold pins.

## Executed verification

- Active Railway deployment `3f3449c2-563b-42cd-a5d4-ff5737749067`; 294 installed sealed-file hashes verified; 23 installed harnesses
- Regression ledger: 119 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probes on `gpt-5.4-nano-2026-03-17` in the production container scratch root: 3 of 3 adopted after at most one
  emulated re-author pass, 5 author calls, replaying the exact live projection sequence, with the evidence-floor verdict recorded per case; 0 customer sends
- Fresh code-locked Omar.system reset at `2026-09-16T09:01:26.352Z`: residual 6 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 294 files, 23 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260916T090129Z/v195/v195-r2-manifest.json` sha256 `ae1f554f5ee3f6ff89900a10ae00ff4a0caed8692a1c0a5cf30e58c51e1aec00`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; v194 stays in the pointer chain
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v57/v195 Worker version `19ca7d31-20f1-4195-8aa7-1ad6a697b012`, first v57 scheduled run `2026-09-16T09:10:20.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-16/20260916T091020000Z.json` sha256 `4cde92da0af89e5258aa05ee6d8ac0c8d56fe2dec53a52401a49af8606bc38b6` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
