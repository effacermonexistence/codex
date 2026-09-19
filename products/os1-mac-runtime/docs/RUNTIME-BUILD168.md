# Runtime acknowledgement, writer queue and voice — build168

## Root causes and repair
- Source write lease exhausted a 180-second wait and returned a resend error. The default now waits with cancellation and a ten-second preparing heartbeat until the existing owner releases the lease. Optional explicit deadlines remain available. Canonical real paths identify ownership, including nested self-update calls. Never steal or unlink a live writer lock.
- Codex activity was emitted as executing before a turn-start acknowledgement. Preparation/dispatch now remain preparing. Executing requires the returned native thread and turn ID; this binding feeds the OS1 native-session list. Dispatch custody remains before the request because an interrupted request can have side effects.
- Local Whisper repair from build167 is included: resolve Handy logical model IDs through the downloaded model catalog instead of treating the ID as a filename.

## Verification performed
- Hook tests: held owner, repeated contention, release, exclusive successor and cancellation pass.
- Codex stdio fixture: acknowledged turn invokes started callback; missing turn ID never invokes it. No model call needed.
- Release stage passed runtime, Fleet, app, shell, composer, steering, sidebar/queue, queue/fork and parallel checks.
- Installed build168: nine installer checks pass; conversations 98 before and after; signing identity preserved. Receipt: `~/.os1/recovery/self-update-build168-2026-09-19T132445Z/install-receipt.json`.
- Live microphone: installed app Start Dictation → synthesized speech through MacBook Air Speakers → Finish Dictation → composer contained `Microphone test, please continue the task. Microphone test, please continue the task.` Test draft cleared; no task sent; audio defaults unchanged.
- Native provider probe actually launched the bundled Codex app-server, returned a native turn, persisted its response and left the empty probe workspace hash unchanged. This is execution evidence, not a full result-adoption pass: the exact sentinel request received the mandatory persona prefix and the remote verifier returned another route. The write-uncertainty gate retained the result instead of replaying it. No second provider call was spent to repair the optional probe wording. Do not count this probe as an adopted task.

## Visibility boundary
Codex app-server sessions are native Codex sessions, not ChatGPT web conversations. Background mode intentionally preserves native records without stealing focus or importing a second live writer. OS1 binds the acknowledged native ID while running. A generic preparation spinner is not provider execution proof. Desktop reveal and result adoption remain separate statuses.

## Method / scope
Source state → bounded hypothesis → reversible patch → deterministic regression → installed observation. Read https://arxiv.org/abs/2310.01798; the paper motivates external verification, not proof of this repair. No credential migration, old external-task replay or unrelated project changes. Installer retains rollback material.
