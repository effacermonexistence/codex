# Codex kickoff — SCV DM bot: restore the 2026-04-20 golden behavior

You are taking over an Instagram DM booking bot for a tattoo studio (persona
"Lua"). Ben built it. It USED to be excellent — the very first build, dated
**2026-04-20**, was ~identical to the "golden snapshot": ~2 bookings/day and
clients could NOT tell it was AI. Since then it drifted (June: bubbly service-bot
rewrite; July: a pile of phrasing-based strip-floors that keep whack-a-mole'ing new
bad phrasings). **Your job: make it behave like the 2026-04-20 origin again — a
human, selective artist who is a friend first — while keeping the reliability
infrastructure that was added for real production.**

## Get the two trees
- **Current working tree (what runs live):** `omar-r2:omar-active-vault/scv-instagram-automation/codex-handoff-20260708/files/` — pull this, it's the repo to edit. Read `CODEX_HANDOFF_SCV_2026-07-08.md` inside it FIRST (full architecture, pipeline, doctrine, floors, open items, deploy/verify steps).
- **Golden reference (the north star):** `omar-r2:omar-active-vault/scv-instagram-automation/origin-snapshots-20260420/` — the 2026-04-20 origin. `20260420_050900/files/` has `codex-dm-runner.js` (165 lines — thin executor) and `lua-dm-master-prompt-v17.txt` (851 lines — the soul). Compare CURRENT behavior/persona against this. The origin persona is the target: "tattoo is one lane of your life, not your entire being", "do not sort every message into a rigid business funnel", "topic drift is normal", "slightly selective" artist, "do NOT guess — ask", anti-template ("examples are direction not templates, rephrase every time").

## The real problem to fix well (not one phrasing at a time)
The LLM keeps emitting funnel-forward / interview / booking pushes that violate the
funnel ORDER, and each has been caught by a **phrasing regex strip-floor** in
`codex-dm-runner.js` (runModelAuthoredFlow → enforce* chain). Every new wording
escapes once, Ben sees it live, someone widens the regex. This never ends.

**Do this instead:** replace the N phrasing regexes with ONE semantic gate. For
each outbound bubble, classify its INTENT (date-ask / form-push / price /
size-placement / design-interview / social / react) — use the LLM intent
classifier already wired in the runner, or a small deterministic tagger — and
strip it if that intent violates the current funnel STAGE. Stage rules below.

## Doctrine (the spec — do not violate)
1. **Convergence hierarchy.** BIG convergence = become genuine best friends with everyone who DMs (default state). SMALL convergence = the tattoo funnel; it opens ONLY when the client gives a tattoo signal (idea / reference image / booking words / price). A plain "hey how are you" gets a warm friend reply and ZERO funnel — no tattoos, flashes, forms, dates, booking.
2. **Funnel order (strict).** design direction → offer form → date → 4-field double-check → deposit. Never jump ahead. A submitted form does NOT mean the design is settled. No date/booking talk before a design direction exists in the thread.
3. **Never ask size or placement.** Listen, acknowledge, "exact stuff gets dialed in in person", move on. Even if the client brings it up.
4. **"model" question → explain the model concept** (a few exclusive spots for pieces that fit the artist's style; moderate discounted rate 150/hr, mentioned ONLY if they ask price). Never interview them about it, never push date/form off it.
5. **One-shot:** form offer/link once per account; deposit handoff once.
6. **Gmail friction-kill:** name + phone come from the Squarespace form-notification email (IMAP → ledger → autofill matched by IG handle/phone/name/idea). NEVER ask the client for name or phone.
7. **English only.** Every client speaks English. Always reply in English (input transcription forced en + verifier rejects non-English; output English).
8. Only three verbatim scripts: opener 3-bubble greeting, 4-field double-check, deposit handoff. Everything else is natural LLM variation — never a stock sentence, rephrase every time.
9. **Voice notes:** transcribe (whisper, en); if the transcript fails the verifier (empty/CJK/garbled) reply like a human who couldn't hear it ("your voice note cut out, send it again or type it") — NEVER invent a reference/design. A voice note is never treated as a "reference post".

## Reliability infra — KEEP, do not regress (these were real production fixes)
- `/data` volume state persistence (deploys used to wipe queued replies).
- No-reply-zero: coalesce of undelivered turns, manychat input sweep, auto-recovery loop, fail-open (received → answered or explicit human-agent, never silent drop).
- Gmail autofill + who-is-who scorer.
- Transcript verifier + capability canary (whisper/vision self-test every 6h).
- `scv-approved-config-lock.js` (Ben-ratified values; changing one requires editing the lock in the same commit) and `prompt-stones/stone-*.txt` (7 soul sections byte-exact — the live prompt must contain each verbatim).
- Do NOT reintroduce the June bubbly persona (golden-retriever energy, exclamation quotas, forced warmth) — the origin voice is "slightly selective", calm, human.

## Tone note from Ben
Even the current greeting ("hey you doing alright over there") reads "a bit
AI-like". Match the origin's texture: fewer, more selective words; a real person,
not a peppy assistant.

## Verify every change
`npm test` must be green (→ 7-stones commit gate). Then `node scv-sandbox-driver.js`
(real model, expect 44/44). Deploy `railway up --detach -s scv-dm-cloud-survival`
(every deploy purges the `omar.system` test account so Ben retests clean). **Stale-
reply gotcha:** a reply generated by old code before a deploy is delivered LATE by
Instagram after the deploy — verify a live complaint against the `funnel_order_stripped`
count + boot time, not the on-screen message.

## Definition of done
On a clean `omar.system` run: a bare greeting → friend reply, no funnel. A tattoo
signal → engage. A "model" question → explain model. Design → form → date →
double-check (name/phone auto-filled from Gmail, never asked) → deposit handoff.
No size/placement questions, no out-of-order pushes, English only, and the whole
thing reads like the 2026-04-20 origin: a selective human artist, indistinguishable
from a person.
