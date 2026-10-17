# SCV Instagram v184 Masound surface bias custody (2026-09-14)

This records the build-lane release that replaced v183 on the same day. It does not promote Gold,
enable customer traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v184` |
| content fingerprint | `95207f7160a0d95274668c4069969c80077942e2e8846fa5dd803ad6df7c47a2` |
| release manifest sha256 | `b9f8bbff84b0b8e2afd72629929bfcfd9d67fb56d1387d6f7778906ef257800a` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260914T151235Z/v184/runtime/scv-instagram-single-20260914-v184-runtime.tar.gz` sha256 `b3c823c15d35ca1c2ff86eadabbaa7ec1aa2ff8eab44a6787a16c43971c4c251` (1652824 bytes) |

## Requested change (owner order 2026-09-14)

Add a "Masound surface bias" to the language generation step: a latent phonetic signature (soft m syllables: ma me
mi mo mu, 마 모 무 …) preferred only between wordings that are equally accurate and equally natural, with the fixed
priority semantic accuracy > naturalness > Instagram rhythm and tone > Masound; never a quota, never forced, nothing a
reader could notice. This automation generates no captions or posts; its only language generation is the model-authored
DM reply, so the bias is one line in the Responses author prompt (`scv-masound-bias.js` → `codex-dm-runner.js`), reaching
every model-authored lane and the model's own non-English dual output. Deterministic literals, the bounded translator,
routes, verifiers, delivery, scheduling and account logic are untouched; two redundant runner sentences were folded to
keep the executor instruction budget. Preserved: identity source bytes (`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`),
the v180–v183 laws, CLIENT_LANGUAGE_VERSION and the catalog pin, booking/deposit gates, ManyChat configuration, staging v168,
Gold pins.

## OFF vs ON comparison (real provider, production container scratch root, no send)

108 representative turns per arm (Korean, English, German, Japanese; social, info and design lanes), two samples each.
Masound share of client-visible units (words / syllables): OFF 0.066 → ON 0.082; conspicuous lines
(repeated or stacked m words): OFF 0 → ON 1; v183 gates passed OFF 84/108 → ON 88/108.
Verdict: latent signature present (share 0.0664 → 0.0818, +0.0154, z=1.96 one-sided), nothing over-applied, gates intact

## Executed verification

- Active Railway deployment `c4a6d7e9-5da7-4ed5-807a-343e701e3354`; 283 installed sealed-file hashes verified; 15 installed harnesses
- Regression ledger: 111 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probes on `gpt-5.4-mini-2026-03-17`: 88 of 108 adopted through the v183 gates on the ON arm; 0 customer sends
- Fresh code-locked Omar.system reset at `2026-09-14T15:08:02.087Z`: residual 0 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 283 files, 15 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260914T151235Z/v184/v184-r2-manifest.json` sha256 `50aeb79bd2ab3178f6570316797f1dc728434c292cba62e72f6b3e9b628ba9d0`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; v183 stays in the pointer chain
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v45/v184 Worker version `63b4a972-a435-4302-bb4c-16c986093d05`, first v45 scheduled run `2026-09-14T15:10:04.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-14/20260914T151004000Z.json` sha256 `6efb80c89ef6ff05e9f3f2fcb708eb3dd90b0468db60b46526e4935662f28d74` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
