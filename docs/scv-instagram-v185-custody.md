# SCV Instagram v185 predicative like-that custody (2026-09-14)

This records the build-lane release that replaced the rolled-back v183 on the same day. v184 (Masound surface bias)
was rolled back to the sealed v183 bytes on the owner's order after his red team; v185 is built on v183 and does not
carry the Masound line. It does not promote Gold, enable customer traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v185` |
| content fingerprint | `c67ba7da0987f4e34001d6886f449fe9641eeda1bfaa877bc6dd45cb7b6fb897` |
| release manifest sha256 | `eb095dfedccc1168388f397ee35f63fd68abee6b756f077f20faf3973b0b2615` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260914T212150Z/v185/runtime/scv-instagram-single-20260914-v185-runtime.tar.gz` sha256 `80737022f77abec8739e6cde8a16024d7d79f186bd207f1618fcd2ead11eb202` (1650463 bytes) |

## Requested conversation change (owner order 2026-09-14)

On sealed v184 the Omar.system red team (20:26Z) hit two lines: "야, 뭐 하냐?" → "나 지금 잠깐 쉬는 중이야 오늘 하루 어땠어"
(the stock assistant question), and "뭐 그냥 그랬는데?" → the bounded translator's canonical "what, it was just like that?"
→ "like that" read as a visual pointer → `resolve_context / missing_attachment` → three answers rejected → the recovery
template "말하는 사진이나 레퍼런스 보내주면 한 번 볼게". The records carry no Masound, voice or lead rejection; the same
discourse floor exists in v183, so the rollback alone did not remove it.

v185: `scv-discourse-continuity.js` v27 (`PREDICATIVE_LIKE_GUARD`: "like that" after a copula, state verb, adverb or
indefinite is a manner phrase, never a pointer and never pointer evidence), `scv-client-language.js` (the Korean so-so idiom
canonicalises as the statement "it was just so-so" even with a rhetorical question mark), `codex-dm-runner.js`
(`GENERIC_AI_TONE_PATTERNS`: how was your day / hope your day / how are you doing today are generic-tone rejections),
`scv-social-author.js` (lead examples name concrete things, never "their day"). Preserved: identity source bytes
(`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`), the v180–v183 laws, CLIENT_LANGUAGE_VERSION and the
catalog pin, booking/deposit gates, transport/durability paths, ManyChat configuration, staging v168, Gold pins.

## Executed verification

- Active Railway deployment `99eb9d8a-f4fc-4b02-ac48-9e09fe951873`; 282 installed sealed-file hashes verified; 15 installed harnesses
- Regression ledger: 111 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probes on `gpt-5.4-mini-2026-03-17` in the production container scratch root: 5 of 5 adopted,
  including the exact two live turns and a pointer control; 0 customer sends
- Fresh code-locked Omar.system reset at `2026-09-14T21:17:17.306Z`: residual 0 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 282 files, 15 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260914T212150Z/v185/v185-r2-manifest.json` sha256 `68f836a4b36ba7235671e8a9076cdf98751d42e84be089ee29da45ed226ec315`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; v184 stays in the pointer chain as a rolled-back release
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v47/v185 Worker version `a61ada3f-b749-4ab6-8b87-630abdae2bd1`, first v47 scheduled run `2026-09-14T21:20:57.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-14/20260914T212057000Z.json` sha256 `83fa522556d7443b5748bc654c8003f93dc1105a721ca9a73b9986da9e0e1af0` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary. v46 (rollback to v183) preceded it the same day.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
