# SCV Booking Drift Forensic and Structural Repair — 2026-07-25

## Scope and proof boundary

This is an internal executed-source forensic and local regression receipt. It
does not claim a fresh visible Instagram delivery receipt or `STABLE_READY`.

Available evidence:

- April code/config snapshots under
  `SCV_HIGHWAY_FRESH__from__BEN_CRITICAL_FAST_BACKUP_20260422_232300`.
- The active v42 source tree and its Git history.
- Railway deployment metadata, health/stability surfaces, and retained
  production logs/receipts inspected on 2026-07-25.
- Deterministic local policy, state-transition, executed-path, and startup
  harnesses.

Retrieval limits:

- The original April runtime Git commit is not present in the April snapshot.
  The files were first imported into this repository by commit
  `da365329f799fb1d05024c6e43e32e862e4bbc6d`.
- The April model alias resolved to the Codex default and the exact backing
  model/version was not recorded.
- The exact August 15 candidate/verifier trace was no longer present after the
  debug-state purge/restart. Retained logs establish that no later outbound
  receipt existed in the inspected interval, but they do not prove the exact
  suppression branch.

## Conclusion

The direct tracked drift was a six-month maximum booking horizon plus a
`too_far` route introduced with the active v42 tree at commit
`69646bcd48d62252f26105f786158e74e6351093`.

Commit `42e67aa8803f9bdd62219628c5a54f2e95bc675e` removed that limit from the
parser/state path, but a contradictory rule remained in
`lua-dm-master-prompt-v17.txt`: the same live request was told both that legal
dates had no maximum horizon and that dates more than about six months out
should be rejected or moved closer.

The structural cause was duplicated booking authority across prompt prose,
date parsing, thread state, controller routing, transition verification, and
fallback generation. There was no single date-policy module and no deployment
gate covering legal far-future dates, ambiguous months, compound date/price
questions, timezone invariance, or empty output.

## April versus current

| Surface | April 20 snapshot | Current repaired path |
| --- | --- | --- |
| Model | Codex executable default alias; exact backing version unrecorded | `gpt-4.1-mini` explicitly configured in the inspected Railway environment |
| Model parameters | Not recorded | Current runner configuration is explicit; visible generation remains model-authored |
| Booking policy | Prompt/state-derived one-week floor; no independent exhaustive policy module | One canonical deterministic module, seven-day floor, no maximum horizon |
| Date parser | Host `Date` and narrow regex paths | LA calendar-date arithmetic, explicit ISO/named/numeric/relative parsing, year rollover, leap validation |
| Availability | Model could infer or invent availability from prompt/options | A legal date cannot be marked unavailable without exact external evidence; bounded-query absence is not closure |
| State | Regex/history-derived, duplicated date facts | Canonical policy version, fingerprint, ISO date, status, and availability source stamped into state |
| Verifier | Output shape and limited semantic checks | Recomputes the same canonical date decision from the live turn before adoption |
| Regression | Eight model-facing cases | 64 booking cases / 279 deterministic assertions plus 9,933 transition assertions |
| Deployment gate | No booking-family fail-closed gate | Booking regression is a mandatory startup child before workers start |
| Drift seal | Booking policy not separately hashed | Policy source, corpus, harness, prompt, parser, state, contract, package, and startup gate are hash sealed |

## Production failure evidence

The retained Omar.system delivery sequence showed:

1. Form progression and an assistant offer around August 1–3.
2. A reply claiming “August 27 works” and, in the same packet, that the date was
   not open.
3. After the client clarified “July 27” and asked whether it was free, the reply
   answered the price but replaced the legal client date with August 1–3.
4. No subsequent outbound receipt for the later August 15 turn was present in
   the inspected retained interval.

There is no calendar tool in the executed path that could have established
that July 27 or August 27 was closed. Those availability claims were generated
or inferred, not tool-verified.

## Competing hypotheses

| Hypothesis | Result | Evidence |
| --- | --- | --- |
| H1 — maximum-horizon rule rejected legal dates | Confirmed | `addMonths(now, 6)`, `maximum_booking_date_local`, and `too_far` first appear in recoverable active history at `69646b...`; the contradictory master-prompt rule survived the first code fix |
| H2 — stale assistant offer overrode a new client date | Confirmed | Retained visible delivery receipts replaced July 27 with earlier assistant options; state/controller code also carried offered-slot fields |
| H3 — parser/year/timezone drift | Confirmed structurally | April/current paths used host `Date` and narrow parsing; tests were not timezone-invariant |
| H4 — a calendar tool proved the requested date unavailable | Rejected | No calendar query/tool exists in the executed path inspected for this flow |
| H5 — model/prompt/config drift changed behavior | Supported, exact April model unresolved | April used an unpinned default; current uses an explicit model and a much larger prompt; tracked prompt authority contained conflicting rules |
| H6 — delivery/suppression alone caused the August 15 silence | Unresolved | No outbound receipt was retained, but the exact rejected candidate/control trace had been purged |
| H7 — regression coverage allowed the family through | Confirmed | The April suite had eight cases and omitted far-future, ambiguous-month, compound-question, timezone, and empty-output families |
| H8 — verifier rejection had no durable re-generation path | Historically confirmed; exact August 15 trace unavailable | The controller required the later verifier-feedback-loop repair; the current lifecycle now persists the same inbound for re-generation |

## Fixed state machine

```text
INBOUND
  -> CANONICAL_DATE_PARSE
       -> MISSING: preserve current funnel stage
       -> AMBIGUOUS/INVALID: ask only for the missing date dimension
       -> TOO_SOON: explain seven-day floor and keep one grounded legal move
       -> LEGAL: preserve the exact client date; never substitute a stale offer
  -> MISSING_TIME: ask or offer time
  -> MISSING_IDENTITY: collect only missing identity fields
  -> FOUR_FIELD_DOUBLE_CHECK: one canonical block
  -> CONFIRMED: deposit handoff
  -> VERIFIER
       -> ACCEPT: adopt exact packet
       -> REJECT: return typed reason to route/executor and regenerate
       -> EMPTY/TOOL/PROVIDER FAILURE: durable retry; never adopt silence
```

The language model authors natural visible wording. It does not decide the
seven-day floor, invent a maximum horizon, move the requested date, or convert
a bounded query miss into unavailability.

## Canonical invariants

- Timezone: `America/Los_Angeles`.
- Minimum lead time: seven calendar days.
- Maximum horizon: none.
- A named date without a year resolves to its next calendar occurrence.
- A bare day after a date question requires month clarification unless the
  immediate dialogue frame supplies that month.
- Ambiguous numeric dates require clarification.
- The latest explicit date in a correction owns the turn.
- A legal fully specified date preserves the exact client date.
- No exact external calendar evidence means no invented closure.
- A compound date plus price turn must satisfy both obligations.
- Empty visible output is always rejected.

Policy identity:

- Version:
  `scv-booking-policy-2026-07-25-v1-seven-day-floor-unbounded-future`
- Fingerprint:
  `92dc927073042e8ee255acd70ab2a8f70b350b56ce03cb880a32fa5509e27d2d`

## Regression and deployment gate

The canonical corpus contains 64 cases and currently performs 279
deterministic assertions across:

- day 6 / day 7 boundaries;
- legal far-future dates;
- July/August known failures;
- month ambiguity and numeric-order ambiguity;
- year rollover and leap dates;
- invalid dates;
- ISO, month-first, and day-first input;
- relative weekday/weekend phrases;
- voice-note wrappers;
- corrections containing stale and replacement dates;
- compound date plus price;
- timezone invariance across four host timezones;
- actual authority annotation;
- actual transition routing and verifier adoption;
- empty-reply rejection.

The production startup gate now runs:

1. canonical booking-policy regression;
2. executed-path booking harness;
3. OpenAI/provider resilience harness.

Any nonzero child result stops startup before workers begin. The immutable
manifest separately hashes every relevant policy, prompt, parser, state,
contract, harness, package, and startup file. The immutable seal hashes that
manifest, and the firewall hardcodes the seal hash.

## Rollback

After promotion, the exact restore reference is:

`scv-closed-contract-20260712-v34`

The restore script defaults to that immutable Git tag:

```bash
./scv_restore_golden.sh
```

An operator may explicitly select an older tag with `SCV_GOLDEN_REF`, but the
restored tree must pass the golden guard, immutable firewall, full local suite,
and startup gate before workers are started. Runtime state and secrets are
excluded from the code snapshot and must not be overwritten by rollback.

## Completion boundary

Structural local proof is complete only after the full suite, hash seal,
restore/isolation harness, Git commit/tag, Railway startup gate, and health
receipt all pass.

`STABLE_READY` still requires a fresh real inbound → adopted outbox →
ManyChat sendContent → visible Instagram DM receipt, plus clean live queue and
drift status. Local regression success cannot substitute for that external
receipt.
