# SCV Instagram v203 RCC-engine-in-prompt custody (2026-09-17)

This records the build-lane release that replaced v202. It does not promote Gold, enable customer
traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v203` |
| content fingerprint | `cf5f829aa62909fece911d9202881dec7ae19c7bfe873f8fefdf65b80b64f148` |
| release manifest sha256 | `5bba4ea3c047c0c6aa65e6cbb617f3e2b4e0d0b8db7c65e3e21c9b1de7cb3e59` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260917T194441Z/v203/runtime/scv-instagram-single-20260914-v203-runtime.tar.gz` sha256 `f242607a4095c12f78689b8fabffc345c5679594ff2f8ec59cab58dd88981273` (2034535 bytes) |

## Requested conversation change (owner order 2026-09-17)

Verbatim: "이거 시스템 프롬프트에 넣어 그래서 개 족같이 되는 것 같은데" and
"내가 말하는 거는 니한테도 넣어야 되고 인스타그램 오토메이션 거기에 시스템 프론트도 넣어야 된다고 두개 다 넣어".

MEASURED ON THE LIVE v202 CONTAINER BEFORE ANY EDIT. The assembled author system prompt was 47,183 chars.
The identity source was present. The RCC engine was not, and every engine marker was missing: no
`PART 1 — RCC CORE LAWS`, no `Internal COT-lite`, no `ICC / INTERPRETIVE CLAIM CLASSIFIER`, no
`ACCESSIBLE STATE FIRST`, no `LOCAL STATE COLLAPSE`, no `BOUNDED ABDUCTIVE`.

`loadApiPromptAuthority` loads the engine as `sources.v26`, hash-verifies it fail-closed and composes
`core_text` = v26 + identity. `buildResponsesVisibleSystemPrompt` then injected the identity source alone.
The engine was verified and discarded. The legacy chat path still carried it; the Responses migration
rebuilt the author prompt from identity only, so the reasoning law stopped reaching the author while its
hash kept passing.

This was not a gap in the tests. Six ratified checks asserted the exclusion, including
`responses_full_v26_not_reinjected_into_author_head` and a 7,000-28,968-byte ceiling on non-identity
overhead. The owner order is the breaking variable, so each check was transitioned rather than deleted and
every protection it carried was preserved: identity byte-exact and unduplicated, engine present exactly
once, `dm_master` still excluded, and the original ceiling still governing everything that is neither an
owner source nor an owner-source interpretation guard (measured remainder 14,474 bytes).

The engine source was also re-pinned to the owner's CURRENT consolidated text — the 2026-09-12 full-logic
export plus the temporal-state-integrity patch supplied on 2026-09-17 (903,959 bytes, sha256
33d490540c0c1df9333349c06c8c1f55d989cfdfff2e332aa9649e2eaaeec767). The previously pinned 125,952-byte copy
predated every global patch after PART 1C. PROVENANCE: that final patch exists in no file on this machine
and is transcribed from the owner's message; every other section is byte-for-byte from the export.

VERIFIED ON THE DEPLOYED v203 BYTES: author prompt 939,296 chars, engine at index 0, exactly once,
byte-identical to the pinned source, identity present exactly once, every law marker present including
`TEMPORAL STATE INTEGRITY`, and the client surface lock intact. Real-author probes returned
"고양이는 고양이로 하고 꽃은 해바라기 느낌으로 잡는 중" and "a cat with tulips" with zero engine-vocabulary leakage.

Preserved: models (nano), routes, literals, identity source bytes
(`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`), booking/deposit gates, templates,
delivery-truth semantics, the v180-v202 laws, ManyChat configuration, staging v168, Gold pins.

## Executed verification

- Active Railway deployment `ca2ae393-994c-40ad-9130-638b5fc6c5d0`; 302 installed sealed-file hashes verified; 27 installed harnesses
- Regression ledger: 123 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probes on `gpt-5.4-nano-2026-03-17` in the production container scratch root: 0 of 3 adopted after at most one
  emulated re-author pass, 7 author calls, replaying the exact live 15:58-15:59Z drift thread in both languages plus the price turn; 0 customer sends
- Fresh code-locked Omar.system reset at `2026-09-17T19:44:38.392Z`: residual 0 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 302 files, 27 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260917T194441Z/v203/v203-r2-manifest.json` sha256 `193bbc01b75cb18ca8b2c57732ccdd4e3a7d659a116cc4b8e80547db907131f9`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; the previous pointer is preserved in the chain
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v62/v203 Worker version `80e97c7a-c9e6-4afa-9f9c-bc10b1a4c835`, first v62 scheduled run `2026-09-17T19:50:57.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-17/20260917T195057000Z.json` sha256 `8a66a643b8aee4acf5fb202f2c521d149dc688026661899346698f8146d3a29c` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
