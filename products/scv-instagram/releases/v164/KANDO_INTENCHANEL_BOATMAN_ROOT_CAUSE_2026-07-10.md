# KANDO_INTENCHANEL_BOATMAN — executed-path root cause

Date: 2026-07-10 (America/Los_Angeles)

Scope: contact/thread `1737076034`, Instagram username
`kando_intenchanel_boatman`. This is an evidence trace, not hidden model
chain-of-thought.

## Confirmed failure chain

1. A real inbound webhook entered the normal delayed reply lane.
2. Before that delayed reply became assistant history, the periodic ManyChat
   `last_input_text` sweep classified the same human turn as missed.
3. The sweep created a synthetic `manychat-orphan-*` message id and made it the
   newest thread state. The legitimate queued reply for the real message id then
   became stale.
4. At 18:19:33Z the hand-crown/logo design turn generated a valid form offer.
5. At 18:25:56Z the sweep re-ingested that same design turn and generated the same
   form offer again.
6. At 18:26:28Z the newest form-offer bubble was dropped as
   `duplicate_outbound_recent` because the old, already-doomed form offer still
   existed in outbox.
7. The old form offer was later stale-dropped. Result: neither copy reached the
   client.
8. Ben manually sent the form in Instagram. Manual Instagram outbound was not an
   assistant event in SCV thread history, so `form_link_sent` remained false.
9. The client's later `Sent` could not become a form-submission signal because the
   state gate required `form_link_sent=true`.
10. On `Ok what are next steps?`, the model candidate contained an acknowledgement
    plus a size question. The size/placement lock removed the question after the
    semantic verifier had already accepted the candidate. No verifier checked the
    actually adopted post-filter packet, so only a flat acknowledgement shipped.
11. The business question `why are you doing free tattoo work?` also overwrote the
    actual design context because `doing ... tattoo` was misclassified as a design
    subject shape.

## Failure family

State/authority divergence + false orphan recovery + stale duplicate collision +
post-filter adoption-gate ordering.

This was not one bad model sentence. Four deterministic runtime layers combined to
starve the form handoff and reopen consultation.

## Root repairs

- Durable `inbound-processing-receipts.ndjson` receipt after 3101 accepts a packet.
- Same-turn in-flight inbox fingerprint check, so the sweep cannot race an active
  real webhook merely because its message id differs.
- Recovery fingerprint uses thread + normalized text + a five-second provider-time
  window. A later repeated sentence is not suppressed by text alone.
- Pending duplicate detection ignores matching outbox packets that belong to an
  older message id than the latest thread state.
- `do/doing ... tattoo` no longer qualifies as a design subject shape.
- Explicit next-step request + known design requires the form-offer gate, not more
  consultation.
- Deterministic packet mutations are followed by semantic adoption verification.
  A dead-end packet is re-authored once with fresh model wording; a second invalid
  packet is rejected rather than silently shipped.

## Regression proof

Harness: `scv-kando-regression-harness.js`

Locked cases:

- active real webhook cannot be falsely orphan-recovered;
- adopted delayed turn cannot be falsely orphan-recovered;
- identical words at a later timestamp remain recoverable;
- stale pending packet cannot suppress the latest form offer;
- same-message duplicate protection remains active;
- business/process question cannot overwrite actual design context;
- post-filter flat acknowledgement is rejected on the KANDO next-step route.

Production safety state during repair: `SCV_PAUSE_ALL=1`. No unpause is authorized
by this repair.
