# SCV DESIGN INTENT LOCK — Ben-owned source of truth

This file is the **motivation stone**. It records what the SCV / Lua DM automation is
*supposed* to do, as decided by Ben. It outranks any accreted "fix" an agent makes.

## Ben-ratified config (2026-07-04) — enforced by `scv-approved-config-lock.js`

These exact values are approved and hard-asserted by the `test:approved-config` firewall (21 checks in `npm test`, wired into the 7-stones gate). Any drift fails the build and blocks deploy. R2 snapshot: `omar-r2:omar-active-vault/scv-instagram-automation/approved-config-latest` (+ timestamped snapshots).

- **Delay**: first reply random **3–12 min** (180000ms / 720000ms), lock `scv-delivery-pacing-lock-2026-07-04-v6-first-reply-3to12min`. Restored from June's 20–60min drift. (April's *mechanism* was model-chosen `delay_ms` per bubble, 3-8 / 4-12 min; the current mechanism is system-forced uniform random 3–12 min — Ben chose to keep system-forced for reliability. omar.system test account = zero-delay.)
- **Model rate**: 150/hr, mentioned ONLY when directly asked. A "what is model" question → concept only (limited/selective spots, gray line, no price, no free feeling).
- **Studio address**: `10 Arkansas St San Francisco CA 94107` — public, answered directly, NEVER deposit-gated.
- **Everyone gets a living Lua reply**: a bare "hi" / "how are you" / "whats up" stays human and social. Tattoo info asks, references, pricing, form, availability, or booking signals open the tattoo lane. The retired fixed 3-bubble opener must never fire.
- **Form consent**: robust to combos + Korean ("okay sure", "yeah ok", "주세요"); questions excluded. LLM intent classifier primary, regex floor fallback.
- **Talek-Lua Self-Identity Core + HUMAN SURFACE LOCK**: injected verbatim at the top of the master prompt (Ben directive).
- **100% reply + Lua is the last speaker** (Ben's explicit choice, not April's strategic silence). CONTEXT-FIT: never fabricate a reply on a nonsensical / misheard input — infer or ask.

## Live booking checkpoint surface lock (2026-07-14)

- The four-field hotel check renders every known month/day as `25th of July`, not
  `july 25`, and never as a bare ordinal.
- A positive reply to that check moves immediately to the deposit handoff.
- Deposit order is amount, `This is my zelle!`, account, then one and only one
  post-send CTA as the final bubble.
- The amount bubble cannot contain an early `once you send` CTA, and the Zelle
  account cannot precede its label.
- A pass-one route derived from opaque media is provisional. Once vision or ASR
  resolves the current inbound, that evidence owns the route before post-filter
  verification. A controller repair route is already frozen and cannot be rederived.

## Model-authored executed-path liveness lock (2026-07-15)

- Non-transactional conversation copy remains model-authored. A deterministic
  filter/verifier may reject a route but may not append a canned visible CTA.
- One broad pre-design idea / subject / reference / vibe question is the required
  `design_intake` action. It must survive the funnel filter; detailed probing such
  as "what part of that reference" does not.
- Every candidate is filtered first and then verified as the exact packet that
  would ship. Invalid visible packets are re-authored under the frozen controller
  route with a bounded 12-candidate adoption budget.
- Regression proof for the intermittent info-opener drop: 50/50 authority runs
  passed, zero exceptions, zero fixed fallback hits, and 50 unique visible packets.

## Anti-drift protocol (why this file exists)

The hard-locks (`scv-delivery-pacing.js`, `scv-hard-harness-lock.js`,
`scv-contract-harness.js`) protect the *current config value*, not Ben's *intent*.
Over months the config drifted (initial delay 3–12min → 20–60min; one-question-to-form
→ design/placement/size ladder; consent whitelist too narrow) because an agent changed
the code **and** the lock together, so the firewall moved with the drift.

Rule going forward (OMAR ENGINE PART 22 — LOCKED STATE must not be silently overwritten):

1. Each invariant below is Ben-owned. An agent may **propose** a change but must **flag it
   as an intent mutation and get Ben's explicit ratification** before changing a locked value.
2. Every invariant is backed by at least one test in `npm test`. If behavior regresses from
   intent, that test fails → the 7-stones commit gate blocks the commit → it cannot deploy.
   This is the "redundant stones" firewall: intent lives in (a) this doc, (b) the test suite,
   (c) the live `scv-drift-monitor`. A change that moves one but not the others is drift.
3. Never loosen a test to make it pass. Never delete an invariant to silence a failure.
   Fix the code to match intent, or bring the intent change to Ben.

## Intent detection architecture (root fix for the whitelist whack-a-mole)

The funnel's intent gates (is this a "yes"? did they accept the slot? submit the form? pay?)
are decided by the **LLM**, not by regex keyword whitelists — that is the whole point of
using an LLM. `codex-dm-runner.js` runs an intent classifier (`classifyLiveTurnIntent`) that
reads the conversation and returns structured intent flags by MEANING (handles "okay sure",
"yeah ok", "the 25th works", "all done", "i paid", Korean, slang, typos).

Safety design (why this can't misfire or lose a turn):
- **Union, LLM-leads**: the classifier can only *promote* a flag (raise recall). Regex stays
  as the fallback floor. Every promotion is double-gated by code-side funnel context
  (form_consent needs a prior offer, slot needs a prior offer, submitted needs the link sent).
- **Fail-open**: any classifier failure / timeout / bad JSON falls back to the regex flags.
  No turn is ever dropped. Toggle with `SCV_LLM_INTENT` (default on).
- **Determinism kept where it matters**: fixed outputs (form URL, deposit script, double-check
  format) and idempotency (no double-send) remain deterministic. The LLM decides *when*, the
  code controls *what* the fixed outputs are.
- Regex gates + their 30+ regression tests remain as the enforced floor, so the fallback
  itself can't silently drift.

## Locked invariants (each → enforcing test)

| # | Intent | Locked value | Enforced by |
|---|--------|--------------|-------------|
| 1 | First reply feels human, not instant, not slow | initial delay **random 3–12 min** (min 180000ms, max 720000ms); omar.system = zero-delay test account only | `test:pacing`, `test:hard-harness` (lock `...-v6-first-reply-3to12min`) |
| 2 | Only transactional checkpoints may be deterministic | retired opener is rejected; exact form URL, four-field double-check, and deposit handoff remain locked; ordinary conversation stays freshly model-authored | `test:fixed-script`, `test:harness`, `test:runner-semantic-repair` |
| 3 | Do not dawdle — converge fast | one light idea touch → form; **no** design→placement→size interview; **no** invented style menus; placement/size decided in person | prompt `FAST CONVERGENCE LOCK`; `test:runner-semantic-repair` (kahbran size-after-form route) |
| 4 | Form fires on ANY consent | yes/ok/sure/"okay sure"/"yeah ok"/"sure thing"/give-it-to-me/Korean(네·주세요·보내줘); questions & negations excluded | `test:runner-semantic-repair` (form-consent block) |
| 5 | Slot acceptance in any phrasing | "the 25th works"/"friday works"/"book it"/"im down"/"cool"/"lock it in"/"okay 30 is totally fine"; questions/negations excluded | `test:runner-semantic-repair` (slot block) |
| 6 | Form-submitted signal in any phrasing | "done"/"all done"/"its in"/"all set"/"did the form"/Korean(제출·완료·보냈); "not yet"/"isnt working"/questions excluded | `test:runner-semantic-repair` (submit block) |
| 7 | Deposit-sent signal in any phrasing | "i paid"/"just paid"/"sent the 100"/"zelled you"/Korean(입금·송금); questions excluded | `test:runner-semantic-repair` (deposit block) |
| 8 | Price question → answer only | give the 150/hour rate; do NOT re-open consultation after design/deposit already covered | `codex-dm-runner` rate route; prompt `MODEL RATE CONTEXT` |
| 9 | No silent loss | every real inbound ends in a visible reply / quarantine-with-reason / human-agent / retry; no throw→deadletter→silence | `test:missed-inbound`, `test:auto-recovery`; `finalizeSemanticContract` fail-open |
| 10 | Post-only share still replies | a shared post/reel with no text still gets a reply (reference-post route) | *(open — instrumentation live via `INBOUND_DOOR`, awaiting real payload)* |
| 20 | A photo after the deposit handoff is a PAYMENT SCREENSHOT, never a reference | Context-aware media routing (`dm-authority.applyDepositProofMediaOverride`): a media turn with deposit context (zelle handoff in history / `deposit_requested`) flips to the deposit-hold lane — reference flags cleared AND the live text itself rewritten to `sent the deposit payment screenshot` (state flags alone were bypassed by the runner's text-keyed media rules). Reply = thank + not landed yet + checking + will confirm once it lands; funnel paused, no design reset. Media without deposit context keeps the reference lane. E2E live-model verified; sandbox S13. | `test:media` (19 checks) + sandbox S13 |
| 19 | Username heuristics never silence an inbound reply | Hidden pre-existing suppression (`instagram-thread-suppression.js`): handles that look like tattoo shops (`studio`/`ink` tokens etc.) were auto-suppressed — real lead **wondercrushstudio** ("Hello, can I get more info on this?") lost 28 straight replies while the input-sweep looped recovering the same turn. Heuristic verdicts are now marked `heuristic:true` and BOTH reply lanes bypass them (inbox-worker at generation, outbox-worker at send — the send lane was a second ambush). Explicit operator suppressions (ManyChat `flag` tag, known-shop list) stay authoritative; heuristic stays advisory for reaction lanes. Verified live: her 3-bubble opener delivered (`delivery_accepted:true`). | `test:suppression` (`scv-reply-suppression-harness`, 11 checks) |
| 17 | No size/placement talk, no consultation after a stated design, one-shot checkpoints are deterministic | Ben directives (live cases: crema.tori got asked size; sock-monkey lead got a consultation): **SIZE/PLACEMENT HARD LOCK** (never ask/estimate/discuss; one warm beat → "dialed in in person" → next gate) + **DESIGN DECIDED → FORM NOW** (a stated idea ends consultation; affirm + offer form in the same reply) + **`enforceOneShotCheckpoints`** strips repeat form offers/links and repeat zelle handoffs from the FINAL packet deterministically (the semantic contract failed open live, letting repeats ship). Offered ≠ sent: consent to a pending offer still delivers the first link. Explicit user re-request allows resend. Deterministic exact-address bubble appended when a location ask lacks the locked address. Name+phone asked TOGETHER. | `test:oneshot` (18 checks) + sandbox S11/S12 |
| 18 | Name/phone never asked when the current form email already has them (friction kill) | Squarespace form submissions email Ben's Gmail; `scv-gmail-form-reader` (10s IMAP poller, spawned by cloud-start; dark until `GMAIL_IMAP_USER`/`GMAIL_IMAP_APP_PASSWORD` env; kill switch `SCV_GMAIL_FORM_READER=0`) decodes MIME quoted-printable fields and records them in `form-submissions/` (volume). `dm-authority.applyGmailFormAutofill` adopts identity only from exact/fuzzy Instagram or independently corroborated thread evidence; the count of unclaimed records is never identity evidence. Every Omar.system adoption must also be newer than the form link in the current replay, including explicit “just submitted” turns, so an old debug form cannot re-enter. Known values are never overwritten → deterministic four-line double-check fires with the matched values. Date comes from the lead's accepted chat slot. **2pm is only the preferred time offer, never client authority**: a date-only reply stays at `awaiting_time`; the client must state a time or accept the exact offered slot before the four-field double-check may fire. If the current client says a different explicit time (for example `1pm works` after a `2pm` offer), that current time overrides the old offer and any model acceptance label. | `test:gmail`, `test:fixed-script`, `test:closed-transition`, `test:single-control`, `test:runner-semantic-repair` |
| 16 | Full funnel holds under messy real-lead behavior (sandbox-proven) | Full-funnel sandbox (real gpt-4.1-mini + real authority pipeline via `recent_history_override`, `CODEX_BIN` forced to the live openai fallback): 10 scenarios / 34 checks — greeting→idea→form→submit→name+phone→double-check→deposit handoff→deposit claim→address, phone-only turn, name-then-phone split, price-first, address ask, coalesce backlog, media-only, typo consent, slot accept, bot accusation. **34/34.** Fixes it drove: (a) deposit-sent claims never enter the deterministic booking lane; (b) a confirm-token+question turn ("cool! whats the exact address?") goes to the model, and a contract-violating fixed script falls back to the model instead of throwing (was a hard no-reply); (c) deterministic double-check also fires when the live turn supplies the last identity field (form context required) — bare "4157602883" / "415 760 2883" now double-checks instead of re-asking; (d) prompt rules for live_turn_phone/name_candidate. Driver: scratchpad `scv-sandbox-driver.js` (re-runnable). | sandbox runs (2026-07-06) + `test:runner-semantic-repair`, `test:fixed-script` |
| 15 | Inputs ManyChat received but never forwarded still get answered | `scv-manychat-input-sweep` loop (spawned by cloud-start, every 10min) polls ManyChat getInfo for every known contact (thread-state on the volume) and enqueues any fresh unprocessed human turn through the orphan-recovery pipeline (`buildRecoveryPacket` + `hasProcessedLatestInput` dedup). Phone-shaped digits-only inputs (7–15 digits) count as human turns — rejecting them made christian.bolanos.35977's "4157602883" unrecoverable. Aged-out (>24h) and test accounts skipped; kill switch `SCV_MANYCHAT_INPUT_SWEEP=0`. Boundary: a sender who NEVER reached the webhook once (no ManyChat contact / IG request folder) is invisible to the sweep — manual IG reply is the only lane (bazata91 class). | `test:sweep` (`scv-manychat-input-sweep-harness`, 15 checks) |
| 14 | State survives deploys (queued replies must never die on `railway up`) | Railway volume `scv-dm-cloud-survival-volume` mounted at `/data`; `cloud-start` binds all 17 state dirs (`outbox`, `thread-state`, `thread-history`, quarantines, …) onto it via symlinks at boot (`scv-persistent-state.js`, idempotent, one-time migration, plain mkdir when no volume). **Root cause (SSH-confirmed): no volume → ephemeral /app wiped every deploy/restart → pending delayed replies silently destroyed** (christian.bolanos.35977's phone-number reply among them — the "많이 빠진 답장" family: 5+ deploys during active hours each killed the in-flight queue). Verified live: marker + thread state survived a container replacement (deploy `6f568933`→`ffa3cf4d`), boot receipt `scv_persistent_state persistent=true`. Never remove the volume; never bypass the symlink binding. | `test:persist` (`scv-persistent-state-harness`, 14 checks incl. simulated deploy wipe) |
| 13 | 24h-window (3031) recovery | on a window-blocked ManyChat send, `outbound-scv2` retries ONCE with Meta `HUMAN_AGENT` tag (fail-open; kill switch `SCV_HUMAN_AGENT_TAG_RETRY=0`). **Live-verified: retry fires on real 3031, but ManyChat currently rejects the tag for IG ("Unsupported message tag") — platform boundary, not our bug.** Coverage today: (a) lead returns → coalesce merges undelivered content into the next reply (invariant #11); (b) lead never returns → `outbox_human_agent_required` queue, Ben replies manually from the IG app to reopen the window; (c) if ManyChat enables Human Agent permission, retry works with zero code change. Direct IG fallback (`instagram-cli-4llm`) is dead — source unrecoverable, do not chase it. | `test:window` (`scv-window-recovery-harness`, 14 checks) |
| 12 | Reply to media-only / view-once inbounds (never drop) | a photo / view-once "burn" pic / voice / sticker arrives as empty `message_text` with no accessible media (ManyChat forwards only `message_text`). `pickInboundText` gives a real-but-textless inbound (contact identity + message/media envelope key) a synthetic `sent a photo` turn → passes the `inbound-scv.js:1370` empty-text guard → warm human reply (acknowledge the pic, note it may have vanished, ask to resend / describe idea). Root cause was line 1370 dropping `!packet.text` with 400. Log-confirmed victim: `christian.bolanos.35977` msg 1783234824176 → `INBOUND_EMPTY_TEXT_DROP`. Verified live via clean canary. **Note: `enrichInboundPacket` getInfo can override `sent a photo` with a recoverable ManyChat `last_input_text` — still a reply, never a drop.** | `test:media` (`scv-media-only-inbound-harness`, 13 checks) |
| 11 | No dropped message when a lead sends 2+ messages fast | earlier UNANSWERED user turns (no delivered assistant reply yet) are collected by `collectPendingUnansweredUserTurns` and **merged into the LIVE INPUT** the model replies to (+ routed substantive), so the outbox stale-drop (`newer_inbound_exists_for_thread`) can discard the older reply without losing its content. Verified live: long halloween idea + quick "how much" → single reply covered idea + size + price. Root cause was `outbox-worker.js:669/751` dropping any reply whose `message_id != thread latest`. **A prompt-only side field failed live (price-only rule outranked it); the fix had to merge into the live turn structurally.** | `test:coalesce` (`scv-unanswered-coalesce-harness`, 16 checks) |

## Deploy truth (do not let this drift either)

- Real deploy = `railway up --detach -s scv-dm-cloud-survival` (builds local source).
  `railway redeploy` only **restarts the existing image** — it does NOT ship new code.
- Verify live code by: new `delivery_pacing_lock_version` in boot log, `INBOUND_DOOR` on real
  traffic, deployment ID change to `● Online` (not Building/Deploying).
- omar.system is the only zero-delay/auto-purged test account; real accounts get the 3–12 min gate.

Last ratified by Ben: 2026-07-04 (delay restored to April 3–12 min; convergence + gate under-match audit).

## Generic info fast path and transport truthfulness (owner directive 2026-09-02)

Live incident (inbound `legacy-manychat-6818f3db…`, 2026-09-02T04:10Z, code-locked
Omar.system identity): "Can I please get more information?" was routed to
`design_intake` / `direct_info_request_owns_live_turn`, then spent 53 s in three
model/verifier reauthor passes (`non_authoring_guard_requires_model_reauthor`,
`info_opener_requires_customization_open_door`,
`placement_possibility_branch_must_answer_and_move_next`), exhausted, and shipped
the generic recovery line. The owner also reported that the reply never appeared
in Instagram although ManyChat answered `{"status":"success"}`.

Owner-ratified intent, both enforced by `npm test`:

1. **Generic info fast path** (`scv-generic-info-fast-path.js`,
   `test:generic-info-fast-path`). A self-contained general information request
   with no concrete motif, no media, no booking fact and no money question is
   answered by a bounded deterministic packet BEFORE the optional intent
   classifier and before any model call. The packet explains the model spot,
   points at profile / story highlights as inspiration, keeps custom ideas open,
   leaves exactly one next move, and carries no form / rate / date / deposit /
   double-check wording. Stale double-check, deposit, form or date state never
   resumes an old stage on that turn. Wording varies per message and never
   repeats the previous visible text. `deterministicAuthorityOutput` still
   contract-checks the packet; on rejection the existing model lane runs.
   Concrete motifs, price questions, media turns, deposit claims, negated
   interest, controller repair passes and ungrounded "how does this work"
   questions stay on their existing lanes. This narrows the 2026-07-15
   "non-transactional copy is model-authored" rule for exactly this request
   family; it is not a return of the retired 3-bubble opener.

2. **Transport truthfulness** (`scv-delivery-visibility.js`,
   `test:delivery-visibility-truth`). Provider acceptance and Instagram
   visibility are separate facts with four states: `confirmed_visible`,
   `provider_accepted_visibility_unknown`, `confirmed_failure`,
   `transport_exception_outcome_unknown`. `manychat_accepted_unverified` is never
   promoted to visible success. `delivery_outcome_ambiguous` keeps meaning
   "provider acceptance unknown"; `delivery_visibility_unknown` means "accepted
   but not confirmed visible". Every accepted attempt opens an entry in the
   reconciliation ledger (`logs/delivery-visibility-reconciliation.ndjson`) that
   survives outbox removal and closes only through a real probe or an explicit
   operator resolution (`scv-delivery-visibility-reconcile.js`). The
   accepted-unverified conversation boundary remains a dialogue-ledger inclusion
   rule only; a strictly newer inbound is never visibility proof. `/readyz` and
   `/stability` expose `delivery_visibility`; the drift monitor reports the
   unconfirmed backlog as an operational (never critical) alert. Blind resend
   stays forbidden.

## Four-field checkpoint revisions and template retirement (owner directive 2026-09-02, v139)

Incident (Omar.system red-team, 2026-09-02 19:46Z): after the hotel-style
double-check ("Time : 2pm"), the client wrote "Can we actually do 3 PM?". The
time-revision grammar rejected the modal frame because of the discourse filler
"actually", so no checkpoint invalidation happened; the controller froze on
`await_double_check_confirmation`, rejected three model drafts (non-authoring
guard, backtrack while awaiting, duplicate double-check), and after 69 seconds
shipped the fixed recovery line "got you i saw that and i haven't changed or
confirmed the booking yet what detail do you want me to update?". The same
turn also overwrote `known_design_context` with the scheduling text.

Law:

1. Revision grammar is a class, not a phrase list. Modal revision frames accept
   discourse fillers (actually, honestly, just, like, maybe, then, please …)
   and the change verbs push / bump / shift / set / put / change / reschedule.
2. Inside an open four-field checkpoint a suffixless hour ("3", "3:30",
   "three", "hmm 4") is a clock candidate on the tattoo-day clock (8–11 am,
   12 noon, 1–7 pm). Outside the checkpoint the older narrow contextual
   bare-hour law is unchanged. Phones, money, sizes, quantities, ordinals and
   calendar days are never hours.
3. A resolved revision (new time, date, name, or phone) invalidates the
   checkpoint and re-issues the corrected four-field block deterministically on
   the first pass; the corrected identity value outranks the Gmail-derived one
   for that thread. A monthless ordinal revision ("the 10th") belongs to the
   checkpoint's month.
4. An unresolved revision ("2 or 3?", "not 3pm", "after 3", "i need to change
   the time", "i wanna change the date", "can i fix the name", "wait can i
   change something") routes to the exact field:
   `double_check_time_revision_unresolved`, `double_check_date_revision_unresolved`,
   `double_check_identity_revision_unresolved`, or
   `double_check_revision_unclassified_ask_which_field`, and is answered
   deterministically before any model call with a question built from the live
   turn and the checkpoint values ("do you want 2pm or 3pm?", "what time do you
   want instead of 3pm?", "which part do you want me to change the time the date
   or the name and number?"). The which-field ask rotates wording and never
   repeats the previous assistant line.
5. The await-stage recovery template is retired everywhere. No recovery
   surface may emit "i haven't changed or confirmed the booking yet" or "what
   detail do you want me to update"; the divergence harness locks the source.
6. While the checkpoint is open, the live turn is a confirmation or a revision
   of booking fields, never a new design statement: `known_design_context` is
   authored only by a turn that gives concrete design direction or that itself
   establishes the client-anchored inspiration.

Proof: `scv-double-check-divergence-harness.js` v2 replays the exact live
wording through the real authority + controller path (one deterministic pass,
corrected checkpoint, design context untouched) and locks the grammar
families, the bare-hour boundary, the four unresolved routes, and the template
absence.

## v140 addendum (2026-09-02, after the v139 live red-team)

The v139 live red-team on the code-locked debug identity proved the exact
incident wording fixed but exposed four more holes in the same family:

1. **Checkpoint stays open across clarification turns.** "2 or 4?" is answered
   with an ask; the next "4" still revises the checkpoint although the
   immediately preceding assistant turn was the ask. The checkpoint counts as
   open until it is confirmed, superseded, or invalidated (live annotation and
   history rebuild agree).
2. **A superseded checkpoint is history, not a gate.** After "actually can we do
   the 13th instead" the old block is superseded; the following "4pm" produces
   the corrected block instead of waiting for a confirmation of the stale one.
   The state carries `checkpoint_superseded_by_revision` durably; the
   contract, the runner, and the history rebuild honour it. A monthless
   ordinal is anchored to the checkpoint month in history rebuild as well.
3. **Bare numeric messages are the client's words.** "4", "31", "3:30", or a
   phone number typed alone were rejected as non-text and the ingress fell
   back to the ISO `received_at` timestamp, so the client "said" a date
   string. Direct text fields now keep numeric replies verbatim; timestamp
   shaped values and timestamp keys are never candidate text.
4. **No recovery line may repeat.** Two identical generic recovery lines in a
   row tripped the duplicate-visible-text critical check and fail-closed
   production at 20:33Z. Every recovery surface rotates its wording and never
   repeats the previous assistant line. The deterministic revision-ask packet is
   admitted by the control plane's receipt gate and by the structured-output
   contract (`double_check_revision_field`; revision reasons own the field
   they re-ask).

Proof: `scv-double-check-divergence-harness.js` v2 replays the whole live
sequence (checkpoint -> "Can we actually do 3 PM?" -> "2 or 4?" -> "4" ->
"actually can we do the 13th instead" -> "4pm" -> name -> "wait can i change
something" -> phone -> "looks good") through the real control plane: every
deterministic turn is one pass, no route-aware recovery, no repeat, no
template; `scv-media-only-inbound-harness.js` locks the numeric ingress.

## v142 addendum (2026-09-02, after the v141 live red-team)

1. **Identity revisions survive the controller's identity rebind.** The
   controller re-binds name/phone to its active-slot parser after every
   annotation pass; a client revising the name or number of a pending
   checkpoint ("the number is wrong its 4155550188") was rebound to the
   persisted number and the corrected block repeated the old one (v141 live
   case 15). The rebind now applies the checkpoint revision grammar shared
   with dm-authority first, and the revision boundary uses the latest pending
   checkpoint rather than only the immediately preceding assistant packet.
2. **A question-shaped resolved revision is still deterministic.** "Can we
   actually do 3 PM?" carries a question mark; the runner's question gate sent
   it to the model lane (15 s and a verifier loop live). A resolved revision of
   the open checkpoint is answered by the corrected block itself.
3. **Proof through the real seam.** `scv-double-check-divergence-harness.js`
   v3 replays the live sequence through the real control plane AND the real
   spawned runner (no stub candidate generator) for every deterministic turn;
   only the model-authored date turn uses a model stand-in, committed through
   the control plane. This is the seam that hid the v141 regression.

## v143 addendum (2026-09-03): generic information request at the open checkpoint, executed-checkpoint state, ready-identity rebase, await recovery gate

Live incident 2026-09-03 02:54Z to 04:52Z (Omar.system debug identity, v142). The client ran the whole funnel (reference post, form, September 9 at 2pm accepted) and received the four-field checkpoint at 03:02:00Z, then restarted the thread at 04:50:31Z with "Hi, can I please get more information?". v142 answered at 04:51:59Z (88 s) with "which one should i fix the date the time or the name and number?".

Root causes, highest layer first:

1. Route. The direct-info branch is guarded by the durable design-direction check, which reads the client-anchored reference from state. Once a reference post has been anchored, every later information request loses the direct-info route. At the open checkpoint the turn fell to `four_field_double_check_already_sent_wait_without_repeating`, the generic-info fast path was refused for that action, the model lane answered the information request, the verifier demanded the info-opener shape three times under the await route, and the loop exhausted.
2. Recovery. The await-stage route-aware recovery always produced the which-field revision ask, even when the live turn carried no revision evidence.
3. State. At 03:01Z the route locked `post_form_identity` before the gmail form match landed. The verifier reported `ready_booking_identity_requires_double_check` on pass 2 but nothing rebased; three passes burned (53 s) and the checkpoint shipped through the failure recovery with the plan still saying identity missing, so `double_check_sent` and the form identity never reached durable state (stage hint stayed `awaiting_form_identity_match` under a visible open checkpoint).
4. Design context. "Can we do September 5?" was recorded as `known_design_context`.

Laws:

- A self-contained information request while the four-field checkpoint is open (checkpoint sent, no revision intent, no invalidation, no media, no deposit claim, no price question) is a SIDE QUESTION: the contract keeps `await_double_check_confirmation` under `side_question_info_request_keep_checkpoint_open`, the generic-info fast path is admitted under exactly that action+reason (runner eligibility and control-plane receipt gate share one rule), and the packet is one explanation variant plus one resume line that hands the thread back to the pending confirmation. No greeting, no design question, no funnel or money words. The durable design-direction guard is not consulted for the side question. Verified in one deterministic pass; the checkpoint stays open and the next confirmation or revision behaves exactly as before.
- The await-stage route-aware recovery emits the which-field ask only when the live turn carries revision evidence (revision intent, invalidation, superseded checkpoint, or change/field vocabulary that is not an information request). An information request gets the deterministic side-question answer; anything else gets a rotating neutral nudge that keeps the checkpoint open.
- When the verifier reports `ready_booking_identity_requires_double_check` and the four fields are present but the checkpoint has not been sent, the plan rebases to DOUBLE_CHECK so the deterministic checkpoint authors the turn under its own action.
- When the adopted packet IS the four-field block (deterministic fixed booking checkpoint executor), the commit records `double_check_sent`, `name_phone_date_time_double_check_sent` and the displayed identity/date/time regardless of the plan action. The executed visible text is the truth.
- A scheduling proposal is never stored as design context.
- The fresh-info-opener greeting rule is state-grounded: once the four-field checkpoint has been sent the turn is never the first assistant turn, whatever the runner's bounded history window shows, so the greeting-free side-question answer is never rejected into the model lane and the client is never re-greeted mid-thread (guard contributed by a parallel session on 2026-09-03).

Versions: closed-transition contract v74, generic-info fast path v2, route-aware visible recovery v6, contract-harness lock v117, hard harness lock v159, divergence harness v4.

## v144 addendum (2026-09-03): date-only revision at the open checkpoint clears the sibling time in state

Live red-team on v143 (case 11, "actually can we do the 13th instead" after the checkpoint at 4pm): the closed-transition contract already treats a replaced date as invalidating its sibling time and routes to the time ask, but the durable time survived in state. The runner's funnel stage therefore still read "ready for the checkpoint" and authored the four-field block under the time-ask route (rejected: time cannot skip to double check), the model did the same, and the structured-output contract rejected every time re-ask as re-asking a known field, including the recovery packet. Three passes burned into the generic recovery ask (38 s); the next "4pm" then ran into the same wall (72 s, which-field ask).

Laws:
- A date-only revision at the open checkpoint clears the sibling time in state (`known_requested_time`, accepted offered time) so route, runner and contracts agree: ask the time for the new date, then the next time answer re-issues the corrected checkpoint deterministically. A revision that carries its own time keeps it.
- The runner never authors the four-field checkpoint under a post-form ask route (time, identity, availability); the controller's ask route wins.
- After a live-turn checkpoint invalidation or a superseded checkpoint, the locked post-form route owns the latched booking fields in the structured-output contract (v3), so a legitimate re-ask is never rejected as re-asking a known field.

Versions: structured-output contract v3, hard harness lock v160, divergence harness v5 (existing seq-11/rr-11 time-ask and seq-12/rr-12 checkpoint expectations now hold end to end).

## v145 addendum (2026-09-03): a resolved checkpoint revision outranks stochastic intent flags and lower heuristics

Live red-team on v144: "Can we actually do 3 PM?" right after the model-spot explanation got no reply at all (the placement-possibility semantic rule saw spot / there in the surrounding assistant text and rejected every corrected-checkpoint candidate into the terminal recovery), and "actually can we do the 13th instead" carried a stochastic decline flag and was swallowed by the decline branch into the generic recovery ask.

Laws:
- A live turn that revised or invalidated the open checkpoint, or that resolved to a booking date or time candidate, is a booking move. The decline branch never takes it, whatever the intent classifier said.
- The placement-possibility semantic rule yields to a live turn resolved to a booking time (as it already did for a resolved booking date) and to any checkpoint revision or invalidation.
- The executed-checkpoint state recording runs only after every adoption gate, immediately before the commit.

Versions: closed-transition contract v75, contract-harness lock v118, hard harness lock v161, divergence harness v6.

## v146 addendum (2026-09-03): ordinal-word days and the date answer before the form match

Owner red-team on v145 (the run that was accepted): "Can we do fifth of September?" right after the form link took 70 s. Two causes: the booking policy read only numeric days ("5th", "September 5"), so an ordinal WORD carried no calendar candidate and the turn left the booking lane; and every availability branch of the closed-transition contract required the gmail form match, which lands minutes after the client's message, so a date answer to the assistant's own "send me a couple dates" ask was routed to the tattoo lane and rejected twice as a dead end before the match arrived.

Laws:
- Ordinal words first through thirty-first (hyphenated or spaced) read as calendar days before every calendar scan (booking policy v5; the invariant fingerprint moved).
- A date answer to the assistant's date ask after the form link is an availability turn whether or not the form submission has been matched yet; the outside-window decline stays the deterministic packet with the earliest opening.

- The contextual calendar-day reply (dm-authority `extractContextualBookingDayReply`) also opens after the form link while the assistant's open question is the date, so "Can we do the fifth?" before the form match becomes the monthless-day month clarification route instead of a generic tattoo-lane model turn. Ordinal words expand inside that detector too. Before the form link a bare number stays a quantity.

Versions: booking policy v5, closed-transition contract v76, hard harness lock v162, booking policy harness v10, divergence harness v7, dm-authority contextual-day gate widened. GOLD-3 re-freezes on v146 after its live red-team.

## v147 addendum (2026-09-03): the date answer survives the classifier; one reply is one double-check object

v146 live red-team on production (16:36Z to 16:46Z, debug identity) found two drifts that the local suites and the GOLD-2 replays could not see because they run without the intent classifier and without the production history shape:

1. "Can we do fifth of September?" right after the form link: the contract routed the outside-window decline, but dm-authority carried no live date status before the form match (booking context began at the form match), so when the intent classifier labelled the turn a stand-alone question the route flipped to social, the model burned three verifier passes and the recovery line "what date would you like me to check?" went out (56 s).
2. That recovery line plus later ordinary replies ("...at 2pm", "send me your name and best number and i ll double check it") were fused by the four-field double-check detector's sliding window across turns into one "sent double-check"; the real four-field block at the identity turn was rejected as a duplicate, the model re-authored it, the executed block was not recorded (deterministic executor only), and the next three turns routed as "identity missing" through the model and the recovery line (68 s, 88 s).

Laws:
- The assistant's open date ask after the form link is booking context: dm-authority resolves the live date (status, phrase, iso) before the form match.
- A resolved live calendar proposal is a booking move whatever the classifier says about its surface shape: `latestTurnOwnsStandaloneConversation` yields to the booking policy's resolved date (contract v77).
- The outside-window date decline is authored before the intent classifier (runner pre-intent lane), so a classifier label can never flip it to the model lane.
- A double-check object is one assistant reply (same message id, or the assistant bubbles between two client turns); the detector never fuses bubbles across client turns (contract-harness lock v119).
- The executed four-field block persists the identity and the open checkpoint whichever executor produced it (control plane).
- The deterministic decline's closing question ("does september 10 (thursday) at 2pm work for you") is an assistant date ask even without a question mark (contract), and restating the offered day ("Yeah, we can do September 10") is acceptance of that slot, not a counter-proposal (dm-authority) — found by the GOLD-2 replay of the owner's conversation once booking context began before the form match.
- A bare confirmation of the open four-field checkpoint ("Yeah, perfect") confirms that checkpoint; it is never re-read as accepting the older offered slot, so the corrected time survives in durable state (dm-authority; latent since v145, caught by the same replay).

Versions: closed-transition contract v77, contract-harness lock v119, hard harness lock v163, divergence harness v8. GOLD-3 re-freezes on v147 after its live red-team.

## v148 addendum (2026-09-03): a volunteered placement or size carries its own obligation

v147 live red-team on production (18:07Z): the design turn "i'm thinking a small dagger on my inner forearm, black and grey" took 56 s. The verifier rightly demands that a volunteered placement/size be acknowledged and deferred to the appointment (placement and size are never DM intake fields), but nothing told the model so before its first pass; three passes failed (two missing the deferral, the third stripped to no visible bubble) and the bare recovery line "want me to send the application form?" went out.

Laws:
- A volunteered placement and/or size on an active tattoo turn puts `acknowledge_and_defer_placement_size` on the route (contract v78); the model instructions state it before the first pass: acknowledge the exact detail, say exact placement and sizing get dialed in together at the appointment, never ask or recommend, then continue the locked move.
- If the model lane is still exhausted, the form-offer recovery line itself acknowledges the detail and defers it before offering the form (route-aware recovery v7), so the client's own words are never dropped.

Versions: closed-transition contract v78, hard harness lock v164, route-aware recovery v7, divergence harness v9. GOLD-3 re-freezes on v148 after its live red-team.

## v149 addendum (2026-09-03, staged): a name that arrived as a field is authoritative

The owner's own v148 red-team printed "Name : Open file number" on the first four-field checkpoint and "Name : Open file" on the corrected one, with no user input touching the name. The value came from his form submission; two read paths then ran the UTTERANCE sanitizer over it, whose trailing "... and my number" stripper is right for a spoken sentence and wrong for a field. The same stripper would truncate a real name ending in Number, Cell or Mobile.

Laws:
- A name that arrived as a field (a form submission, durable state, or the Name line of a checkpoint we printed) is authoritative: reading it back applies hygiene only (whitespace, wrapping punctuation, length and letter validation) through `sanitizeStoredIdentityName`.
- Only a raw current-turn utterance goes through `sanitizeBookingIdentityName`, which keeps its frame and trailing-phone-word strippers unchanged.
- Both checkpoint builders must print the same name for the same stored value; the divergence harness replays the owner's exact sequence end to end.

Versions: closed-transition contract v79, hard harness lock v165, divergence harness v10. Staged only: production stays on v148 until the owner's open checkpoint is released.

## v150 addendum (2026-09-04): one honest model attempt on the volunteered-dimension form offer

v149 live red-team, case 02 ("i'm thinking a small dagger on my inner forearm, black and grey"): 44.6 s.
The model drafted a size/placement question, the deterministic stripper removed it, the non-authoring
guard demanded a re-author, and the same thing happened on the next pass. Three passes, then the
route-aware recovery line went out — the correct content, 30 seconds late.

Law: when the route is `offer_form` and the route carries `acknowledge_and_defer_placement_size`, the
model gets exactly one pass. Its recovery text for this route is already correct and verifier-clean,
so a second and third attempt buy nothing but latency. Every other route keeps the full budget.

Versions: control plane pass-budget guard, divergence harness v11. The name fix (v149) is unchanged.

## v152 addendum (2026-09-05): answer the time question, then the corrected checkpoint

Owner, 2026-09-05 (first fix of the v151 experiment round): "오후 5시가 가능할까요 하면 네 가능합니다 하고
더블 체크가 나와야지 바로 더블 체크가 나오더라구요". At the open four-field checkpoint, a client who asks
for a different time ("Can we do 3 PM?") got the corrected block as the whole reply. The block was right;
the question went unanswered.

Law: a resolved TIME revision of the open checkpoint (the new time is legal and differs from the committed
one, or the turn moved date and time together) is answered first in one short affirmative bubble that
names the new value in the block's own surface — `yes 3pm works` / `yes september 12 at 3pm works` — and
the corrected four-line block follows as its own bubble. One predicate
(`scv-checkpoint-revision-ack.js`) decides this for every producer of the checkpoint: the runner's fixed
lane, the control plane's deterministic recovery and the dm-authority canonicalizer, which keeps that
leading bubble and still strips any other prose around the block.

Never: the first checkpoint (nothing was revised), a date-only revision (the contract re-asks the time),
a too-early time (the decline lane), a name/phone revision (the corrected block is the answer), a bare
re-confirmation. The two-bubble reply is one checkpoint object for every detector; the next confirmation
still moves to the deposit handoff.

Versions: checkpoint-revision ack v1, divergence harness v12. Recovery Gold stays v151; behavioral GOLD-3
stays v148 (gold-a-08 / gold-b-06 re-recorded as declared divergences).

## v153 addendum (2026-09-05): a nominated image is the design; pre-checkpoint routes own their recovery line

Live, production v152, omar.system, 21:56Z. After "Can you also do black and gray?" the client sent an image
and, six seconds later, "I'm thinking of this one". Eighty seconds later the reply was "i see your message
nothing is changed on my side yet what should i take care of first?" — a line written for an open checkpoint,
sent to a client who had just handed over their reference.

Root cause, from the production log and the code: (1) when the image arrives first and the words arrive
seconds later, the coalesced live text is replaced by the vision description and the client's own words
vanished from state; (2) anchoring a visual as the design required creative-use language ("make this into a
piece in your style"), so "I'm thinking of this one" did not count and an image without tattoo words fell to
the non-tattoo host lead; (3) the model then asked a size/placement question three times (stripped each time,
~35 s); (4) `general_continue`, `design_intake` and `resolve_context` had no route-aware recovery line, so the
checkpoint-flavoured generic ask went out.

Laws:
- The client's own words on a media turn survive as `live_turn_client_selector_text`; the description remains
  the live text for every other reader.
- A current visual that the client nominates in plain words ("I'm thinking of this one", "something like
  this", "can you do this", bare "this one" with the image in the same turn) is design authority — the source
  never had to look like a finished tattoo. A screenshot, selfie, document or payment image keeps the
  contextual host lead. This runs through `clientAnchoredInspirationReference`, so the durable anchor,
  `independentDesignDirectionExists` and `formOfferEligible` all agree: the route is `offer_form`.
- Every pre-checkpoint route owns an answerable recovery line: resolve_context asks for the photo or reference
  (or a re-say), non-tattoo media asks which part of the image they mean, design_intake / tattoo_continue lead
  with an idea-reference-vibe question, social leads socially. The generic "nothing is changed on my side"
  ask is reserved for turns after a form, checkpoint or deposit exists.
- design_intake / general_continue / tattoo_continue get one re-author (budget 2): the route lock already
  forbids the size question, so a third identical attempt buys only latency.

Versions: contract-harness lock v120, hard harness lock v167, route-aware recovery v8, divergence harness v13.
Recovery Gold stays v151; behavioral GOLD-3 stays v148.

## v154 addendum (2026-09-06): the model's words ship; a repeated line is not an answer

Live, production v153, omar.system, 01:23–01:27Z. "Sure it's free?" waited 50 s and got the fixed price line;
"It's kinda expensive I thought it's free?" waited 81 s and got the identical line. An earlier question of
his was superseded by his next message and the merged reply jumped to the form offer.

Root cause, from the production log and the code: (1) "it's free" / "I thought it's free" / "expensive" were
not recognised as price questions, so no `answer_model_rate` obligation fired and the tattoo lane demanded
forward motion; (2) the model answered the price and appended a size question, the stripper deleted the
question, and the non-authoring guard rejected the WHOLE draft as not model-authored — every re-author
repeated the pattern until the budget ran out; (3) the deterministic price recovery line had one wording, so
consecutive failures sent the same sentence twice; (4) nothing stopped a line already sent from going out
again.

Laws:
- Price questions include the tattoo/spot as subject ("it's free?", "this is free", "I thought it was free")
  and cost concern ("expensive", "pricey", "afford"); "feel free", "free time/slot" and availability ("are you
  free tomorrow") are not (contract-harness lock v121).
- Answering the direct question the live turn demanded is forward motion: a price or exact-address answer
  satisfies the design/tattoo/social lead floor without a trailing question (contract v81).
- A draft whose only deterministic mutations are pure deletions (size/placement question, stage-regression
  sentence) keeps the model's remaining words and is judged by the normal verifiers; it is not sent back for
  re-authoring. Missing-content mutations still are.
- A client-visible line already sent in this thread is never accepted again in the conversational lanes
  (control-plane repeat gate on design_intake / tattoo_continue / social_continue / general_continue /
  resolve_context / offer_form / keep_consultation_in_dm / await_double_check_confirmation). Booking-state
  structures — checkpoint block, form link, deposit handoff/hold, form-permission clarification, post-form
  date/time/identity asks — legitimately re-ask the same required field after a non-answer and are exempt.
  Deterministic recovery lines rotate and skip what the thread already heard (route-aware recovery v9, three
  fact-identical price variants).
- The fixed info fast path yields to the model when a message of theirs arrived after our last reply attempt and never got an answer (turns already followed by a reply, delivered or attempted, do not count; the v143 side question at an open checkpoint stays on the fast path).

Versions: contract v81, contract-harness lock v121, hard harness lock v168, route-aware recovery v9, divergence
harness v14. Recovery Gold stays v151; behavioral GOLD-3 stays v148.


## v155 — the design is seen before the form (owner directive 2026-09-06 04:3xZ)

Incident (production v154, omar.system, 04:26Z): "Do you also do black and gray and or line work" was answered
with "yeah i can do black and gray and line work" + "if you want i can send the form". Owner: "무조건 디자인은
받아 … 디자인 상담을 해라는 게 아니라 얘가 뭘 원하는지 일단 한번 봐야 돼 바로 바로 폼으로 넘어가지 마라고".

Root cause, from the production log and the code: the anchored capability-question grammar did not know
"line work" and did not accept a list ("X and or Y"), so the turn was not a capability question; the
design-direction predicate then counted "black and gray" ALONE as a concrete design direction, promoted
the question into `known_design_context`, planned `offer_form` and let the packet flip
`form_offer_asked`. The closed-transition contract forbade a form offer only under `design_intake`.

Laws:
- A style / technique word alone (black and gray, line work, fine line, color, realism, blackwork …) says HOW,
  never WHAT. It is not a design direction and never opens the form. A design direction is a subject, an
  idea, a reference or a continuation of existing work (contract-harness lock v122).
- A question whose content is nothing but style terms and glue ("black and gray or color?", "do you do line
  work", "X and or Y") is a capability question: answer it, then pull one idea / reference (lock v122).
- The form is offered only under the `offer_form` plan and sent only under `send_form`. `design_intake`,
  `tattoo_continue`, `social_continue` and `general_continue` packets that offer or send the form are
  rejected (`closed_transition_form_before_design`, contract v82).
- The deterministic design-intake / tattoo recovery answers a pending capability question first, then pulls
  the idea (route-aware recovery v10).
- Stored design memory (`known_design_context`) is read through one shared reader: the strict detector, plus
  legacy style-only statements written by older builds (a thread already past the form must not fall back to
  design intake); a stored value that is itself a question or capability/scope text is v154 residue and is
  quarantined. Live promotion into design memory is strict (contract, control plane, runner).

Versions: contract v82, contract-harness lock v122 (self-test 290 checks), hard harness lock v169, route-aware
recovery v10, divergence harness v15. Recovery Gold stays v151; behavioral GOLD-3 stays v148.


## v156 — the price is a boundary, spoken only on a direct ask (owner directive 2026-09-06 15:5xZ)

Incident (production v155, omar.system, 15:33–15:36Z): after the form link, "I'm only available on weekends.
Also, is it free?" was answered with the rate (correct). The next turn, "So, oops, my budget is tight. How long
do you think it's gonna take?", re-stated the $150 rate. Owner: "가격은 진짜 직접적으로 딱 물어봤을 때만 얘기하고
가격은 숨겨야 돼 … 왜 150불이라는 걸 그 전 채팅에 얘기했는데 왜 또 얘기하는데 … 아트워크를 팔려면 개념 설명부터 하고
시장이 맞추는 거라고".

Root cause, from the production log and the code: the price-question detector accepted any sentence carrying a
money word ("budget") and, since v154, cost-concern words ("expensive", "afford"); the contract then made the
rate an OBLIGATION (`answer_model_rate`) and rejected every draft without it.

Laws:
- The rate is spoken only when the live turn (or an unanswered earlier turn) directly asks the price: "how
  much", "is it free", "what's your rate", "do i have to pay", "price?". Money words, a budget remark, a cost
  concern ("my budget is tight", "that's expensive") or a duration question never open the pricing lane
  (contract-harness lock v123).
- A cost concern gets one warm acknowledgement with no number, no re-quote and no discount; a duration
  question gets a time answer with no money (it depends on the piece, set at the appointment).
- A draft that states the model rate without a direct price question is rejected
  (`price_disclosed_without_direct_question`), so a rate already explained is never restated unasked.
- Runner prompt carries the PRICE BOUNDARY and DURATION laws.

Versions: contract v82 (unchanged), contract-harness lock v123, hard harness lock v170, route-aware recovery v10
(unchanged), divergence harness v16. Recovery Gold stays v151; behavioral GOLD-3 stays v148.


## v157 — the rate is spoken once per thread, then remembered (owner directive 2026-09-06 21:5xZ)

Incident (production v156, omar.system, 21:40–21:42Z): after the form link, "How much is it by the way?" was
answered with the rate (correct). "I thought it's free though" was answered with "nah not free" AND the $150 rate
again. Owner: "150불을 한 번만 알려주면 되지 뭘 몇 번을 여러 번 알려주네 … 컨텍스트 맥락이 없는 것 같거든 … 예술
작품은 예술작품 그 자체로 시장한테 맡겨야 돼".

Root cause: every direct price question created the `answer_model_rate` obligation, which the contract enforced
with the locked rate answer; nothing remembered that the rate had already been given in the thread.

Laws:
- Thread memory: `known_model_rate_disclosed` is set by the state reducer when a visible assistant event states
  the rate (and persists as a durable field); `modelRateAlreadyDisclosed` also reads the visible history.
- Once the rate was given, a later price question — even a direct one — carries
  `acknowledge_rate_already_given` instead of `answer_model_rate`: the reply is answered from memory with NO
  number ("nah it's not free — it's the model rate i mentioned earlier, that part stays the same"), then the
  current step continues. A draft that states the rate again is rejected (`price_restated_after_disclosure`,
  `closed_transition_rate_restated_after_disclosure`); a silent reply is rejected
  (`price_follow_up_requires_memory_answer`). The memory answer counts as forward motion.
- The runner pricing floor follows the shared detector and flips after disclosure (a restated rate is the
  fault). Deterministic recovery answers from memory (`RATE_ALREADY_GIVEN_LINES`) and never speaks the rate
  again in that thread. Prompt: PRICE ONCE law.

Versions: contract v83, contract-harness lock v124, hard harness lock v171, route-aware recovery v11, divergence
harness v17, durable structured state + `known_model_rate_disclosed`. Recovery Gold stays v151; behavioral GOLD-3
stays v148.


## v158 — form consent and a price question in one turn get one reply (owner directive 2026-09-07)

Incident (production v157, omar.system, 2026-09-07 01:15Z): after "want me to send the application form?" the
client wrote "Yeah, sure is it free?". The reply, 52 s later, was the price line only — no form. The debug ledger
shows the controller planned `tattoo_continue` with `answer_model_rate`, the runner treated the turn as form
consent, two drafts died between the layers (`after_reauthor_non_authoring_guard_requires_model_reauthor`,
`after_reauthor_form_link_missing_consent_source`), and the route-aware recovery emitted the rate alone.

Root cause: the shared `liveMixedFormConsentWithPriceQuestion` judged the price half with a private regex that
did not know "free", while the runner's copy used the shared price detector; the two layers disagreed on the
same text. `explicitFormConsentText` also dropped any consent carrying a question mark, so a compound consent
read back from history did not survive a follow-up turn.

Laws:
- One shared predicate judges compound consent in both layers: strong consent words + the shared direct-price
  detector, with negation, conditional ("if", "only if", "unless", "as long as") and questioning consent ("are
  you sure") excluded (contract-harness lock v125; the runner imports it).
- A price question that merely mentions the form ("Is the application form free?") is neither consent nor a
  link request.
- A compound consent read back from history stays explicit consent until the link is sent or a withdrawal
  arrives.
- The `send_form` plan carries the price obligation (`answer_model_rate`, or `acknowledge_rate_already_given`
  after disclosure): the reply must carry the link exactly once, the availability ask AND the price answer;
  price-only and link-only drafts are rejected (contract v84 repair-lock guidance).
- Deterministic send-form recovery already answers the price (or from memory) with the link and the
  availability ask; unchanged.

Versions: contract v84, contract-harness lock v125, hard harness lock v172, divergence harness v18. Recovery
Gold stays v151; behavioral GOLD-3 stays v148.


## v159 — a transcribed voice note is text, never an image (owner directive 2026-09-07 04:3xZ)

Incident (production v158, omar.system, 04:28Z): a voice note saying "Hi, can I please get more information?"
was transcribed (`authority_media_context_resolved voice: true`), yet the reply came 31 s later and read "I see
the image what part of it are you thinking about for the tattoo?". Owner: "원래 보이스 메시지 읽을 줄 알더만 …
답장이 좀 느리네 … 개쌉소리 하는데 이거 고쳐".

Root cause, from the production log and the code: the audio attachment made the turn count as media
(`hasLiveMedia`: media_urls / media_type), so the generic-info fast path was ineligible
(`live_turn_carries_media`) and the contract could not take the direct-info route; the turn went to the model
lane, which failed at generation, and the route-aware recovery answered with the image-part ask.

Laws:
- A resolved voice transcript ("sent a voice note saying: …") is the client's words. It is never media for the
  fast path or the contract (`liveTurnIsResolvedVoiceText`), never "non-tattoo media context"
  (`liveTurnIsVoiceNote`), and never an image for the recovery lines (recovery v12: the image-part ask only on a
  real image turn).
- A reply that claims to see an image/photo/reference or asks "what part of it" on a voice-note turn is
  rejected (`voice_note_answered_as_an_image`, lock v126).
- An unintelligible voice note keeps its own clarification path (unchanged).

Versions: contract v84 (unchanged), contract-harness lock v126, hard harness lock v173, route-aware recovery v12,
divergence harness v19, generic-info fast path (`liveTurnIsResolvedVoiceText`). Recovery Gold stays v151;
behavioral GOLD-3 stays v148.

## v160 — voice continuity: orthography is not a conflict, and a failed voice note is never silence (owner directive 2026-09-07)

Incident (production v159, omar.system, 05:59Z): after the typed opener, a voice note "Do you also do black and
gray?" got NO reply. Read-only replay of the same audio: both pinned ASR snapshots returned 200 — one wrote
"grey", the other "gray". v159 treated the spelling variants as conflicting transcripts, the adjudicator
rejected both, the turn was recorded as "sent a voice note that could not be understood", the forced recovery
re-read the raw transport placeholder ("sent a reference post"), drifted to an image/form draft, the verifier
correctly rejected it (`voice_note_answered_as_an_image`), and the loop ended in a terminal operator alert
instead of a visible clarification. (Investigation and code by Codex; fixture repair, invariants and release
by Claude.)

Laws:
- ASR candidate comparison normalizes bounded orthography only (whole-word grey→gray, colour→color). An
  agreeing pair adopts one exact ASR candidate verbatim; nothing composes a new transcript. Negation, numbers,
  amounts, dates, times, people, places and intent differences are never normalized and stay gated
  (adjudication or fail-closed).
- A voice note whose ASR failed is never fed to the intent classifier as if it were speech ("could not be
  understood" is a machine fallback, not the client's words).
- Final recovery reads the same authenticated enriched inbound turn as verification (same message id, history
  enrichment, control-event SHA binding). An unresolved voice turn takes the safe voice clarification ("sorry i
  couldnt hear that clearly can you send it again or type it here") before any route-aware image/form
  recovery, with `live_turn_is_voice_note` / `live_turn_voice_transcribe_failed` /
  `live_turn_voice_context_unresolved` set and media flags cleared; ingress identity and receipts are kept;
  prompt text or candidate flags alone cannot forge that proof.
- Non-secret ASR diagnostics (ok / reason / method / candidate count) are logged; never the transcript, the
  signed media URL or credentials.
- The v145 calendar fixtures of the divergence harness carry a fixed clock (`V145_CLOCK`) so September dates
  do not drift with the wall clock.

Versions: contract v84 (unchanged), contract-harness lock v126 (unchanged), hard harness lock v174, divergence
harness v20, voice-continuity harness (12 checks, in `test:oneshot`). Recovery Gold stays v151; behavioral
GOLD-3 stays v148.

## v161 addendum — a nominated object is the reference (2026-09-07)

Incident (production v160, omar.system, 2026-09-07 19:11–19:14Z). The client sent a picture of an aftercare
cream (vision: a product listing / tube of ointment). The host lead answered "That looks like aftercare ointment,
not the tattoo itself — if you meant a tattoo reference, send me the actual picture or tell me the vibe" (the
first filter is fine). The client then said "I mean I just want the after cream ointment as a reference" and the
reply was "Got you / that screenshot is just aftercare tho …". Owner law: "aftercare cream을 타투 디자인으로 할 수도
있잖아" — any object the client names as their reference IS the design direction; the image's file category
(product, screenshot, package, object) never outranks that decision.

Root cause (reproduced locally on the sealed v160). (1) The anchored-inspiration verifier only knew the
"isn't a tattoo reference" wording, so "is just aftercare", "not the tattoo itself" and "send me the actual
picture" passed after the nomination. (2) `clientAnchoredInspirationReference` required the tattoo lane latch
before it would read the nomination; when the latch was absent the turn was `design_intake`, the correct
affirmation + form offer was rejected as `closed_transition_form_before_design`, and the recovery line was the
generic "what are you thinking of getting?". (3) The nomination grammar only recognised sentence-initial "I
mean … / just …"; "I just want the X as a reference", "use the X as the design", "can you do X as the reference?"
and pointer + frame ("use that as a reference" right after the picture) were not nominations.

Laws:
- `textNominatesNamedObjectAsReference`: a reference frame ("as a/the/my reference | ref | inspo | design |
  tattoo | piece | idea | starting point | base | source | subject | motif", "is/that's the reference") plus a
  concrete lexical anchor (or, live only, a pointer to the adjacent picture). Evaluative questions ("is the cream
  a good reference?"), negations, withdrawals and hypotheticals fail closed; "can/could/would you do X as the
  reference?" counts as the request to do it.
- `liveNominatesPriorVisualObjectAsReference`: the nomination applies to the adjacent prior client picture
  (authoritative visual event), or one turn further back across a lightweight split (duplicate / short caption);
  a caption on the picture itself counts. It is itself the tattoo signal: `clientAnchoredInspirationReference`
  returns true before the lane-latch gate, so the non-tattoo host lead never fires again for that object and the
  plan is `offer_form` (or the already open form gate).
- Verifier: after a nomination, re-grading the object ("is just aftercare / a product / a screenshot", "not the
  tattoo itself", "not really a tattoo/design", "send me the actual/a different picture", "if you meant a tattoo
  reference", "hard to use as a reference") or asking for a resend is `anchored_inspiration_reference_cannot_reopen_design_interview`.
- Memory: the nomination sentence is readable design memory (`storedDesignContextIsDesign`); the control plane
  stores it as `known_design_context` when the anchored latch is set and no design memory exists yet.
- Recovery: an anchored nomination takes the reference acknowledgement line ("yeah we can use that as a starting
  point and make it custom in my style …") instead of a bare form ask.
- Boundaries preserved: a bare "this one" on a non-tattoo screenshot still gets the host lead once (v153); a
  nomination without any picture is not visual authority; a random share plus an apology gains no design authority.

Versions: contract-harness lock v127 (self-test 363), hard harness lock v175, divergence harness v21, route-aware
recovery v13. Contract v84 unchanged. Recovery Gold stays v151; behavioral GOLD-3 stays v148.

## v162 addendum — a cost objection holds the booking (2026-09-07)

Run card (RCC): goal = two production failures on v161 (21:15Z, 21:18Z) fixed structurally; source of truth =
Railway production logs (paged 500 rows at a time) + the sealed v161 tree; target = one release v162; allowed =
contract harness, closed-transition contract, recovery, runner, control plane, harnesses, this file; forbidden =
policy contracts, schema, model pins, the $150 rate, April tone, ManyChat, customer state; validation = contract
self-test, closed-transition harness, divergence harness executed paths, hard lock, gold guard, golden replays,
sealed full suite; stop = seal unchanged after tests, production readyz on the new fingerprint, fresh reset.

Incident 1 (21:15Z). After the form link and a Gmail-matched submission, "How much is it by the way?" (the first
price question of the thread) fell to the post-form recovery line "got it i have your form what date would you like
me to check?" — the model lane had errored and `routeAwareRecoveryText` honoured only
`acknowledge_rate_already_given`, never `answer_model_rate`; the rate arrived one turn late through the pending
question rule.

Incident 2 (21:18Z). "I thought it's free though. My budget is tight." was answered with the rate-memory line plus
"if you want a weekend spot, September 9th or 20th at 2pm are open". The turn derived `post_form_availability`
(form submitted, no date yet) whose contract demands a grounded availability move, so the verifier forced the slot
push; v156's "acknowledge without numbers, then continue the current step" had no objection lane.

Owner law: a cost objection is not a booking turn. Keep them as a potential client — one warm acknowledgement, ask
what budget or range they are working with, say the model spots / this rate are limited and only open right now
(honest scarcity, no amount), and shape the piece (size, detail, session length) around their number later. No
dates, no slots, no availability question, no form offer, no discount, no lower rate. When they answer with a
number, say it is workable and resume the step. (Archive check: the OmarAGI master logic carries the RCC method —
ICC lock, route lock, executor/verifier/adoption, "internally decompose step by step" — and PART 12 strategic
disclosure; it has no sales-objection law of its own, so the owner's statement is the source.)

Laws:
- `textExpressesBudgetObjection`: cost concern (budget, expensive, pricey, afford, too much, steep, broke, tight on
  money), "thought / figured / assumed / hoped … free / cheaper / less", "can't afford / swing / pay that", "out of my
  budget / range". Deposit-proof turns are excluded. `textStatesBudgetAmount`: a money-shaped number without a
  question ("around 300", "$250 max", "400 bucks"); it counts as a budget only when the studio's latest turn asked
  the budget, and then it is never read as a size.
- Route: `budget_objection_hold` (`cost_objection_holds_booking_motion`) wins ahead of every post-form availability
  branch unless the client names a day or accepts a slot. Its contract: no form offer/link, no discount/deal/payment
  plan, no dates/times/slots/availability question, a budget question and the limited-spot framing are required;
  price obligations still ride along (`acknowledge_rate_already_given` after disclosure, `answer_model_rate` before).
- Verifier (semantic, after the price rules so a number keeps its historical reason):
  `budget_objection_cannot_push_booking`, `budget_objection_requires_budget_question`,
  `budget_objection_requires_limited_spot_framing`, `stated_budget_cannot_trigger_discount`,
  `stated_budget_requires_fit_acknowledgement` (obligation `acknowledge_budget_fit`).
- Recovery (route-aware v14): the first price answer travels with every route ahead of the route's own line;
  `BUDGET_OBJECTION_LINES` for the hold; a budget-fit prefix when the client named a number. The liveness floor never
  falls open on the hold.
- Runner: the cost-objection law replaces v156's "then continue the current step"; the disclosed-rate route lock no
  longer continues the booking step on an objection.

Versions: contract-harness lock v128 (self-test 374), closed-transition contract v85, route-aware recovery v14,
hard harness lock v176, divergence harness v22 (445 checks). Recovery Gold stays v151; behavioral GOLD-3 stays v148.

## 2026-09-08 context-grounded client intent law

Social conversation stays social until the client supplies actual tattoo or offer interest. A question about why or
how the artist began tattooing is an artist-biography question, not a client tattoo signal. Answer it directly from
established facts and do not append a sales, design, form, booking, or “are you into tattoos” question. Tattoo words
inside that factual answer are permitted and must not be mistaken for client solicitation.

Correct ambiguous typed or transcribed domain words only when first-party evidence grounds the intended term. A
current “I saw your ad” statement or a recent explicit model-offer exchange can ground `motto`/`moto` as `model`;
a literal slogan question, a negative ad statement, quoted third-party speech, or an unrelated clause cannot. Keep
the raw inbound ledger unchanged and use the contextual interpretation only for routing and response validation.
When the client asks what the ad's model offer means, explain the model spot directly: the tattoo is built around
what the client wants and the finished piece remains in the artist's style. Do not ask for a screenshot or redundant
clarification, do not send the form without its existing consent gate, and do not mention the rate unless asked.

Versions for this law: contract-harness lock v129 (self-test 374), closed-transition contract v86,
route-aware recovery v14, hard harness lock v177, divergence harness v22 (445 checks), and
context-grounding harness v1. Recovery Gold remains v151 and behavioral GOLD-3 remains v148.
