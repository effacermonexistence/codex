# SCV Instagram v186 cheapest-model custody (2026-09-14)

This records the build-lane release that replaced v185 on the same day. It moves every OpenAI lane to the cheapest
snapshot the production key can see and changes nothing else. It does not promote Gold, enable customer traffic or change
ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v186` |
| content fingerprint | `500c18404cc6c0a3fb665f4332ba664e844dc9f3dfd1458ae25125e2d25680df` |
| release manifest sha256 | `b8d41b7aeded7e68089574a4209a87a90347be444e4b4d162b684a77145d8b01` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260915T001655Z/v186/runtime/scv-instagram-single-20260914-v186-runtime.tar.gz` sha256 `e4224e3dec91eefbe220fe364792dd4a8b19e86e735de2b35664aec29662598a` (1651557 bytes) |

## Requested change (owner order 2026-09-14)

"다 싼걸로 바꿔! … 제일 싼걸로 바꿔!" Before: visible author, recovery and classifier fallback on `gpt-5.4-mini-2026-03-17`;
intent classifier, vision and ASR adjudication on `gpt-4.1-mini-2025-04-14` (Railway environment); transcription on
`gpt-4o-mini-transcribe`. After (v186): text lanes on `gpt-5.4-nano-2026-03-17`, vision on `gpt-4.1-nano-2025-04-14`,
transcription unchanged (already the cheapest). `scv-runtime-behavior-contract.js` v5 carries the new constants and readiness
expectations; the four Railway production model variables were set to the same ids. Prompts, routes, verifiers, literals,
identity source bytes (`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`), booking/deposit gates, the v180–v185
laws, ManyChat configuration, staging v168 and Gold pins are unchanged. The owner's structural objection (ManyChat → API →
classifier + author candidates with verifiers → ManyChat) is recorded; the next cost levers (61 KB author prompt, candidate
budget, reasoning effort) are separate owner decisions.

## Executed verification

- Active Railway deployment `07f649c6-7a49-4375-95b5-e66ed8ba999e`; 282 installed sealed-file hashes verified; 15 installed harnesses
- Readiness capability canary after the reset: provider model `gpt-5.4-nano-2026-03-17`, visible_model_ok True, vision_ok True, voice_ok True
- Regression ledger: 111 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probes on the nano snapshots in the production container scratch root: 4 of 7 adopted through the
  v183/v185 gates, 9 author calls, models seen ['gpt-5.4-nano-2026-03-17', 'provider:gpt-5.4-nano-2026-03-17']; 0 customer sends
- Fresh code-locked Omar.system reset at `2026-09-15T00:11:30.118Z`: residual 0 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 282 files, 15 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260915T001655Z/v186/v186-r2-manifest.json` sha256 `8bda5c5adbdd69f0c872ad00c9c322335bf7ceaf168b0cce97f7889ffac655ef`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; v185 stays in the pointer chain
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v48/v186 Worker version `5c90b3d7-3cc9-4656-9d31-a7c7eb3ad2f3`, first v48 scheduled run `2026-09-15T00:20:57.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-15/20260915T002057000Z.json` sha256 `e105b7e49e6ca6143cd4cc8e3b09b8b51b0a2a9feb73bafcbdf68ba7c7c381c9` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
