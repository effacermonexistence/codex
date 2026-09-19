# SCV Instagram v190 Korean-register custody (2026-09-15)

This records the build-lane release that replaced v189 on the same night. It does not promote Gold, enable customer
traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v190` |
| content fingerprint | `502290498fa0a73134741193791485a2b5361341ae211628a5c77de1171f4734` |
| release manifest sha256 | `b8991d42df694bdf448f2969c62902150fb153846d4cb51fbee0c7e4146cffe7` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260915T190028Z/v190/runtime/scv-instagram-single-20260914-v190-runtime.tar.gz` sha256 `dde80b7fdc7600f352522842d516b6a2361a1675b298cb9402aeede8c46640e1` (1692245 bytes) |

## Requested conversation change (owner order 2026-09-15)

On sealed v189 (nano) the Omar.system red team received "작업 좀 정리하고 있었어 지금 막 들어오니까 너 메시지 뜨더라 / 오늘 뭐 때문에
생각났어" for "야, 뭐 하냐?" — the owner's verdict: AI 말투; his own beat is "갑자기 무슨 일이야 ㅋㅋ". No verifier knew the Korean register
and the author held only English aggregate priors, so the Korean was a translation of an English thought.

v190 measures the owner's casual Korean (3,889 lines of his archive, aggregates only): words p50 3 / p90 6, most lines without an
ending mark, "?" 15.6%, ㅋ 4.1%; closes -는데 / -니까 / -거든 / -잖아 / -지 / nominal -임 -음 -함; openers 근데 / 그럼 / 아 / 그냥 / 존나; the
narrated-empathy closes (-더라 / -겠다 / -구나 / -라니) each under 0.5% and the textbook phrases (뭐 때문에 / 생각났어 / 부럽다 / 답답하겠다 /
-는 중이야 / -고 있었어 / 리셋 / 타이밍 …) at zero or one line. `scv-korean-register-law.js` rejects those forms on the social lanes of a
Korean thread (re-authored while a pass remains; a model line still beats a template), `scv-single-control-plane.js` wires it after
the question laws, and `scv-social-author.js` gives the author a Korean register block on Korean threads only ("write the Korean line
first, natively; the English canonical is its gloss"). Preserved: models (nano), routes, literals, identity source bytes
(`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`), booking/deposit gates, polite templates, the v180–v189 laws,
ManyChat configuration, staging v168, Gold pins.

## Executed verification

- Active Railway deployment `f729e591-e667-4827-a906-004add23e124`; 287 installed sealed-file hashes verified; 19 installed harnesses
- Regression ledger: 115 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probes on `gpt-5.4-nano-2026-03-17` in the production container scratch root: 2 of 3 adopted after at most one
  emulated re-author pass, 8 author calls, including the exact live opener (야, 뭐 하냐?) on a Korean thread; 0 customer sends
- Fresh code-locked Omar.system reset at `2026-09-15T19:00:23.325Z`: residual 4 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 287 files, 19 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260915T190028Z/v190/v190-r2-manifest.json` sha256 `2b336083f3e737c82804451a5cde29df1fa8fa3cc2ce29e0abd6671cd274bad0`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; v189 stays in the pointer chain
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v52/v190 Worker version `a38c73cd-8144-47a3-8b09-ce94793dabef`, first v52 scheduled run `2026-09-15T19:05:26.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-15/20260915T190526000Z.json` sha256 `0624c6fc6c1dd4e78e1acfc8349e3c82745a2f0b7835e4591c832b6cde1363d7` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
