# SCV Instagram v210 own-voice custody (2026-10-01)

Build-lane release replacing v206 (via the same-day intermediates v207, v208 and v209). It does not promote Gold, change ManyChat or
lift the customer pause (`SCV_PAUSE_NON_TEST=1` stays: the single-release line requires it in production).

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v210` |
| content fingerprint | `4cf51a3c34893e29ccd247d1272693167b07fd0b8af02d655bdb6eed58ea49b4` |
| release manifest sha256 | `dcd630eb0e1dcd6ab409ad16145636022b393255d7fc55f56a4e9690c58b6fd0` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20261001T142330Z/v210/runtime/scv-instagram-single-20260914-v210-runtime.tar.gz` sha256 `77f45c1e0df44b2e3d292c4a0378403054bbe33623eef288f96459d7659ba690` (2098187 bytes) |

## What failed on v206 (owner red-team on a code-locked debug identity, 2026-09-23/24)

Established from the production thread and decision logs and by replaying the session on the deployed
v206 bytes:

1. **A picture became a request.** A chat screenshot sent with no tattoo context was stored as design
   authority, the funnel opened, and the exhausted-candidate recovery asked how to work it into a tattoo.
2. **A transport placeholder flipped the language.** The bare media placeholder was language-detected as
   English and a Korean thread got English replies.
3. **Money words read as a price question.** A severance-pay question and "I didn't ask whether it's
   free" matched the pricing detector and carried rate obligations on non-price turns.
4. **The bot's own form offer counted as booking progress.**
5. An explicit "shall we look at the form first" did not route to `send_form`.

## v207 — a picture is a referent, not a request (deployed, then superseded the same day)

`scv-instagram-single-20260914-v207` (fingerprint `7ee39e255fd6d010f25216a61c676520eb31479252ebc68544ac7aa6150ea83f`, deployment `972a6cdc-a549-4d3c-be0d-62939af4c97c`) put every
described non-tattoo picture behind one authority (`pictureCarriesTattooAuthority`), stopped a bare media
placeholder from changing the reply language, removed non-pricing money clauses before the pricing
detector, stopped counting the bot's own form offer as progress and routed an explicit form request.
On its deployed bytes: deterministic battery 25 cases all_ok True; real-provider no-send replay of
the session: 11/11 routes as expected, 0 English replies, 0 unsolicited form CTAs,
0 tattoo forcing, 0 unasked price on the checks it ran.

Reading the replies, not only the checks, showed what v207 still got wrong:

- the screenshot was answered "it is not showing yet, upload it again" although it had been described;
- a request for sample pictures got "I'll send sample drawings right away" — this chat sends text only;
- a complaint that the tattoo picture could not be seen through what the studio had sent (the form
  link) was read as a missing client attachment and answered with a request for the photo;
- a question about how many hours a piece takes at the hourly rate, asked after the form was sent, was
  claimed as a stand-alone social turn;
- the severance question got a drafted message for the client to send their employer.

The structural finding behind the first gap: production authors through the OpenAI Responses path, whose
instructions are the identity + engine + compact conversation prompt + the route lock. The v207 law line
was added to the legacy prompt builder, which that path does not send, and a plain lane without an
obligation carries no controller route lock — so the v207 picture guidance never reached the author. The
compact prompt only told it to ask for a missing attachment again.

## v208 — grounded media acts (deployed, then superseded the same day)

`scv-instagram-single-20260914-v208` (fingerprint `805119f0742088175c6fa50f1599d370f6bb7e152bd2fd0d8d5fabbd9a390efa`, deployment `38ac19ab-b352-4f25-b390-1eae6f1cac78`) added the changes below. On its
deployed bytes: deterministic battery 35 cases all_ok True; replay through `authorLiveTurn`: the screenshot was named and
connected to the complaint, the sample request was pointed to the feed and highlights, the form-link complaint was
answered ("the form page has no tattoo pictures"), 8 author calls. Two misses remained: the severance
question again got a drafted message ("just send it like this" + a formal request line), and the hours question
reached the tattoo lane but the design-intake gates refused every answer — a duration answer naturally says "time"
and "appointment", which the calendar detector read as scheduling, and it carried no design pull — so the turn fell to
a design ask that ignored the question.

Changes in v208:

- `scv-media-honesty.js` (new): a described picture is never answered as unseen; no promise to send
  pictures, samples or photos (outbound is text-only); no message drafted for the client to send to a
  third party on an off-topic question. The detectors run inside the existing hard re-author gate
  (never liveness-adopted) and, from v208, a detector's own instruction reaches the re-author lock
  instead of the generic wording template.
- `codex-dm-runner.js`: `productionVisibleRouteLock` is the exact lock `main()` hands the author, now
  including the picture guidance on a plain lane, a media-grounding block (you can see this picture; this
  chat sends text only; the form link has no pictures — the work is on the feed and highlights) and the
  owner's DURATION law for session-length questions. `authorLiveTurn` is the production turn as one
  function; `main()` is a thin shell around it, so a no-send probe executes the same path.
- `scv-discourse-continuity.js`: a turn pointing at what the studio sent, when the history holds the
  studio's link, keeps its referent instead of becoming a missing client attachment.
- `scv-closed-transition-contract.js`: a session-length question in a thread that has the tattoo lane (or
  names the session or rate) is not claimed as a stand-alone social turn; healing, longevity and travel
  time are excluded.
- `scv-contract-harness.js`: the reference-post host-lead instruction no longer steers a picture with no
  tattoo context toward "what to bring into the tattoo".
- `scv-media-honesty-harness.js` (new, 43 checks; 14 of them fail on the v207 code with the detector
  module present but unwired).

## v209 — the question owns its answer (deployed, then superseded the same day)

`scv-instagram-single-20260914-v209` (fingerprint `c8b6a95e5a11c424673951245d71c4d5ef00007fa46d970a86f9c26b713ae6dd`, deployment `92a4f1a1-7faa-4459-bb7a-a356777d0bed`): deterministic battery
42 cases all_ok True; replay through `authorLiveTurn`: 5 authored turns, 8 author calls, no recovery turn.
The hours question was answered (it depends on size and detail, exact hours set in consultation), the screenshot
was acknowledged as seen, and the form-link complaint was answered. The severance question was still answered by
coaching the client's wording to their employer ("for example … say it like that"), the third detector-only miss.

Changes in v209:

- `scv-closed-transition-contract.js`: a session-length question in the tattoo lane carries an
  `answer_session_duration` obligation; the answer is checked, it counts as the move for the design-intake
  and tattoo dead-end gates, it may not fail open, and a duration answer is not read as scheduling unless it
  makes an actual calendar move (date, clock time, availability, booking).
- `scv-media-honesty.js` v2: the drafted-message detector covers "just send it like this" and the formal
  request register of a draft (still only on a question about the client's job, pay, legal or tax matters).
- The duration guidance no longer says the time "gets set at the appointment" (the phrase the calendar
  detector refused); it says how long it takes is worked out in person.
- `scv-media-honesty-harness.js` grows to 53 checks.

## Change in v210 — the artist's own voice

- Prevention before detection: a question about the client's own job, pay or legal matters now carries an
  OWN VOICE block in the production route lock — answer as yourself (not something you would know; their
  employer or a labor office would), and do not coach their wording or write a line for them.
- `scv-media-honesty.js` v3: the coached-wording family ("say it like this", "for example … ask whether",
  "you could say") joins the detector as the backstop, still only on such a question.
- `scv-media-honesty-harness.js` grows to 58 checks.

## Executed verification

- Active deployment `445eecc9-bd76-4562-a4e7-758e191aa0e7`; 311 installed sealed-file hashes verified; 32 installed harnesses
- Regression ledger: 128 commands, all rc 0, on the final sealed bytes
- Deterministic battery on the DEPLOYED v210 bytes: 45 cases, all_ok True (the 13 v206, 12 v207,
  10 v208 and 7 v209 cases unchanged plus the v210 cases)
- No-send replay of the owner's red-team session on `gpt-5.4-nano-2026-03-17`, authored turns through
  `authorLiveTurn`: 11 turns, 7 author calls (cap 10), route matched 11/11,
  0 English replies to Korean, 0 unsolicited form CTAs, 0 tattoo forcing,
  0 unasked price mentions, 0 restated amounts, 0 described pictures denied,
  0 promises to send pictures, 0 attachment requests for the studio's own link,
  0 ghostwritten messages, 0 unanswered duration questions, 0 customer sends (model-authored turns: 5; recovery turns: 0)
- Fresh code-locked reset for both debug identities at `2026-10-01T14:23:28.243Z`: residual
  28 to 0, 10 workers paused and resumed, pre/post snapshots restore-drilled
  and R2 custody verified
- Runtime archive readback and cold restore: 311 files, 32 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20261001T142330Z/v210/v210-r2-manifest.json` sha256 `402553ad362b6ec2f195894eeb88f24db2cef456325b234cde892d97550d845d`; 12 evidence objects;
  the v207, v208 and v209 intermediate packages are kept under the same prefix
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 unchanged

## Known boundaries

- Customer traffic stays paused; only the two code-locked debug identities reach the bot.
- The replay runs the runner's path under a ten-call budget; the control plane's outer re-author passes
  are not replayed, and it is not live delivery, tone acceptance or a population claim.
- The detectors are bounded pattern families (English canonical and Korean render); a new phrasing of the
  same act can pass until it is observed.

## Sentinel alignment

v66/v210 Worker version `ed328c62-35a0-4c51-87c6-b80f25426228`, first v66 scheduled run `2026-10-01T14:30:12.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-10-01/20261001T143012000Z.json` sha256 `775b9b66c571cc93924a4ac7591d4d27c9aba86feae16b5a2abb047de445dfe0` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
