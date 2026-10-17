# SCV Instagram v196 answer-engagement custody (2026-09-16)

This records the build-lane release that replaced v195. It does not promote Gold, enable customer
traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v196` |
| content fingerprint | `93db0e621a1735bde6175d357eede52222d4cebaee96566b16b7e9c828cdbcb8` |
| release manifest sha256 | `ef5d092af8851d6a755f8eaa2bc33f37ddb456ad0eef1003a0d15c8be916c2b8` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260916T224438Z/v196/runtime/scv-instagram-single-20260914-v196-runtime.tar.gz` sha256 `587afc4cb16405d05f31e27d2fbc7de5947203946a1f9b5b0b9288145570bafa` (1755672 bytes) |

## Requested conversation change (owner order 2026-09-16)

The owner reported a live drift on sealed v195. The assistant asked him "너는 왜 이렇게 빡쳐있어 ㅋㅋ" (why are you so
pissed off); he answered "아, 그냥 내 말투가 이래" (that's just how I talk) and asked what the assistant was doing at the
weekend; the assistant replied "그냥 내 성격이 좀 쎄서 그래 ㅋㅋ" (it's just that MY personality is a bit intense). His
answer got no reaction at all, and his self-explanation came back as the assistant's own.

The exact shipped bubbles were run through the live v195 verifier stack inside the production container - unified
persona, unsolicited advice, repeated motif, evidence floor, question tic on canonical and rendered, question spacing,
Korean register, time-frame continuity, conversation lead, question register - and every gate passed. The transport
layer was cleared by execution too: the conversation the model received carried the correct roles and the correct
Korean surface. Of every verifier in the tree, only four receive the client's live text at all, and all four read it
only to grant an exemption, so a reply that ignores what the client said is unreachable by the stack rather than
merely missed.

v196 adds the first obligation derived from what the client said. When the newest delivered assistant turn asked the
client something and the client's live turn carries a declarative answer with content, the reply must react to that
answer: a reciprocity marker, a second-person anchor, a bubble-initial receipt token, or a content stem shared with
what they answered. Otherwise it is re-authored. Measured on the owner's own two-sided archive, he never once restates
the other party's self-description as his own in 1,556 opportunities, but he carries first person across speakers
constantly, so the law is written on the acknowledgement rather than on the pronoun. Three false positives found by the
real-provider probe are fixed in the same release: the unsolicited-advice law rejected the assistant describing its own
plan, and the evidence floor both read a demonstrative as an activity and discarded a client answer glued to a question.
Preserved: models (nano), routes, literals, identity source bytes
(`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`), booking/deposit gates, templates, delivery-truth
semantics, the v180-v195 laws, ManyChat configuration, staging v168, Gold pins.

## Executed verification

- Active Railway deployment `0f842908-592a-4723-a9ec-6b26dd213815`; 296 installed sealed-file hashes verified; 24 installed harnesses
- Regression ledger: 120 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probes on `gpt-5.4-nano-2026-03-17` in the production container scratch root: 3 of 3 adopted after at most one
  emulated re-author pass, 5 author calls, replaying the exact live unengaged-answer sequence, with the answer-engagement verdict recorded per case; 0 customer sends
- Fresh code-locked Omar.system reset at `2026-09-16T22:44:35.548Z`: residual 6 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 296 files, 24 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260916T224438Z/v196/v196-r2-manifest.json` sha256 `9075929b50b89ae3ef334b0c37f8c81a93615da01fff957ba5b55bba01392680`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; v195 stays in the pointer chain
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v58/v196 Worker version `884b37b0-9b96-4efa-9e09-ad279d21141f`, first v58 scheduled run `2026-09-16T22:50:20.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-16/20260916T225020000Z.json` sha256 `8033cdbbcf97e042eac48a94f1c35f97a0e3c3c889b86a642174dbf901756b06` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
