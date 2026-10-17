# SCV Instagram v197 social-time custody (2026-09-17)

This records the build-lane release that replaced v196. It does not promote Gold, enable customer
traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v197` |
| content fingerprint | `20e68cbc3e2fa4a7b717cf751f2c6de8ea8733cb32dfc03f6f8049f5bd8257b4` |
| release manifest sha256 | `6e699cc6118ba2ff987ad3ca8712e43fbeb2bf050105cf1ce09f12783d253da0` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260917T012340Z/v197/runtime/scv-instagram-single-20260914-v197-runtime.tar.gz` sha256 `5186068304c7ea7dd1f0949dad3e05ccea7cb0abea3f0c6d2de15b613d3606b2` (1768002 bytes) |

## Requested conversation change (owner order 2026-09-16)

The owner switched from Korean to English mid-thread and asked when the assistant was free at the weekend. The reply was
"weekends are usually open after 2" / "sat or sun afternoons work best" - a shop announcing hours - and he read it as the
bot dropping into tattoo/booking mode. The whole thread was two friends making weekend plans, with no tattoo topic in it.

The route never left the social lane: every control event records social_continue,
latest_turn_self_contained_nonfunnel_owns_route and booking_stage_hint open_conversation. What fired was the booking
funnel's calendar lock on the post-filter adoption path, which was the one funnel law there with no lane, stage or
intent term. Executed on the exact live input with tattoo intent FALSE, it rejected "saturday afternoon works for me"
while passing "weekends are usually open after 2": it removed every phrasing a friend uses and left the shop-hours
register standing, and the reply that shipped is what the re-author loop had left to write.

v197 scopes that guard to threads that actually carry tattoo or booking state, adds a rejection for publishing standing
availability on a social time question, and replaces the author prose that forbade naming a day or a time - prose that
was stricter than the ratified law and contradicted the v192 time-frame law. Lifting the lock let the social lane name
days and times, which made two latent English-only protected-token defects reachable on every non-English thread: a
weekday and a clock time produced a token from the English canonical and none from its Korean render. Both token
families are language-aware now, and the availability sense of "free" is no longer read as a price claim.
Preserved: models (nano), routes, literals, identity source bytes
(`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`), booking/deposit gates, templates, delivery-truth
semantics, the v180-v196 laws, ManyChat configuration, staging v168, Gold pins. A differential against the sealed v196
module asserts ZERO booking-gate verdict changes on five threads that carry tattoo or booking state.

## Executed verification

- Active Railway deployment `2d543ed1-ab8c-4468-90ba-65223bdd9325`; 297 installed sealed-file hashes verified; 25 installed harnesses
- Regression ledger: 121 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probes on `gpt-5.4-nano-2026-03-17` in the production container scratch root: 1 of 3 adopted after at most one
  emulated re-author pass, 7 author calls, replaying the exact live weekend-time sequence in both languages plus a tattoo-thread control; 0 customer sends
- Fresh code-locked Omar.system reset at `2026-09-17T01:23:38.154Z`: residual 0 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 297 files, 25 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260917T012340Z/v197/v197-r2-manifest.json` sha256 `485eb1686e6737a1fbf0cf0f089419ce5d269ecb4f4d6386c37b1757fcffa0fc`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; v195 stays in the pointer chain
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v59/v197 Worker version `5165acec-a4b2-4128-b8a4-ad4e52d7b69c`, first v59 scheduled run `2026-09-17T01:30:51.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-17/20260917T013051000Z.json` sha256 `769c251366d766d460d7544954deda6c99c5d496a1b9dd09652d4a6c5c2454c8` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
