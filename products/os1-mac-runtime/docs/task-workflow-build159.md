# Build159: owner intent and fresh repair permissions

## Implemented / installed
- Negated explain-only requests (`설명만 하지 말고`, `말만 하지 말고`, `don't just explain`) no longer become read-only; separately stated file/server prohibitions remain binding.
- A new explicit repair after a completed read-only task starts a new objective and backend session, retains the project binding, and archives the previous task. An uncertain prior write is not replayed.
- Workflow source preparation uses the owner's request rather than an architecture-stage scaffold that mentions R2.
- Release builds canonicalize their source path to prevent alias/physical-path Swift module-cache collisions.

## Executed verification
2026-09-19 UTC, macOS arm64 host:
- Context fixture suite passed, including NFC/NFD, fresh edit and separate negative prohibitions.
- Signed universal release staged via OS1 self-update: 11 checks PASS.
- OS1 applied its own update: 9 installation checks PASS; conversations 92 -> 92.
- Installed steering fixture: 32 checks; task replacement: 83 checks; no model calls.
- Running installed app observed after self-update.
- Installed executable SHA256: a3f21dd23c94f32fff83422c9ed838e541ee9deb10964fe77a7b6ec5b037992d
- Installed CLI SHA256: c8253316e7dbcf2b03b984dc583ff8120b6bae5d2ffa8f273c96d113382217be

Private receipts: ~/.os1/verification/workflow-build159/ and ~/.os1/recovery/self-update-build159-2026-09-19T025734Z/.
Build metadata records parent commit e326ed78; this patch was built from the modified working tree. Executable hashes, not parent commit alone, identify this installed artifact.

## Remaining boundary: ordinary subscription Chat
ChatGPT Chat and Claude Chat are NOT implemented as OS1 executors in this build. Codex and Claude Code remain distinct coding backends. No silent API/CLI substitution was introduced.
Safari JavaScript-from-Apple-Events permission was observed disabled. Native accessibility inspection did not establish a usable authenticated request/response path. The computer-use tool failed with a missing Node runtime. These observations do not prove ordinary Chat is impossible; they do prevent a verified send/readback claim here. No credentials, cookies or browser sessions were copied; no permission setting was changed.

## Repair method
Read ReAct abstract (https://arxiv.org/abs/2210.03629): interleave actual observations with bounded actions. Applied here through source inspection, deterministic permission/queue fixtures, staged release tests and installed hash/receipt verification. The paper is not execution proof.

No public website deployment, Instagram action, or uncertain historical request replay was performed.
