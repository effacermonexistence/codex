# SCV Instagram v193 session-memory custody (2026-09-15)

This records the build-lane release that replaced v192 on the same night. It does not promote Gold, enable customer
traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v193` |
| content fingerprint | `73c121493edd1516379f74ca35f7a8ed872b713fc932e9075f4722b97d611d47` |
| release manifest sha256 | `126aed2f43279a5b4cefb7ad32abbf34323f69944094bf9a884be08ac582a716` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260915T230421Z/v193/runtime/scv-instagram-single-20260914-v193-runtime.tar.gz` sha256 `4a5634f7cf9b61271a2fa746c7ed146f9c1ed0eef216dee42dd426ccfec84807` (1724953 bytes) |

## Requested conversation change (owner order 2026-09-15)

On sealed v192 the Omar.system red team caught the bot contradicting itself: it wrote "너 계속 찔러보는중" ("you keep poking me"),
denied having said it one turn later, and then asked the client to explain the bot's own sentence. The owner named the cause
correctly - the architecture. Production artifacts prove it: every assistant turn is persisted as `assistant_attempted` with
`delivery_status: manychat_accepted_unverified`, all three live turns ran `conversation_context_mode: full_visible_ledger_reseed`
with an empty `previous_response_id`, and the reseed filter dropped every one of those events. The author model received only the
client's messages, on every turn.

v193 separates CONVERSATIONAL MEMORY from DELIVERY TRUTH. `isConversationVisibleAssistantEvent` is unchanged and still governs
booking state, drift, discourse and the accepted-unverified boundary everywhere it is used. The new
`isConversationMemoryAssistantEvent` admits the assistant's own transport-accepted turns, and only the author's full-ledger
reseed uses it - so one Instagram account now behaves as one accumulating session, replayed in the thread language. A bare or
failed attempt is still never replayed, the provider-chain anchor still requires a reconciled delivery, and the newest client
message is no longer shown twice. Preserved: models (nano), routes, literals, identity source bytes
(`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`), booking/deposit gates, templates, the v180-v192 laws,
ManyChat configuration, staging v168, Gold pins.

## Executed verification

- Active Railway deployment `c55f27fa-4b31-4752-9c3e-560ebdb8b95e`; 292 installed sealed-file hashes verified; 22 installed harnesses
- Regression ledger: 118 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probes on `gpt-5.4-nano-2026-03-17` in the production container scratch root: 1 of 3 adopted after at most one
  emulated re-author pass, 5 author calls, replaying the exact live contradiction sequence (찔러보는중); 0 customer sends
- Fresh code-locked Omar.system reset at `2026-09-15T23:04:57.086Z`: residual 9 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 292 files, 22 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260915T230421Z/v193/v193-r2-manifest.json` sha256 `66112fbb471a3f6b071f6b3354cacba7da109e9854f9a43f3a0e502e530b7a5b`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; v192 stays in the pointer chain
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v55/v193 Worker version `a6e9f4df-302c-4c3e-8a1e-d94a8ad1c571`, first v55 scheduled run `2026-09-15T23:10:22.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-15/20260915T231022000Z.json` sha256 `4ff54c4c2b0de950ce02cddd9e594c737cc4a04a8e9e8c1072b8edbd4bcfb5e9` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
