# SCV v24 UltraQA evidence — 2026-07-15

## Locked object and claim boundary

The locked object is the `omar.system` Instagram booking path:

`inbound -> single controller -> model-authored conversational move -> form link -> real Squarespace submission -> Gmail adoption -> date/time authority -> exact four-field double-check -> one deposit handoff -> visible Instagram receipt`.

The earlier two-replay acceptance was invalid and is explicitly retracted. Ben's
final acceptance gate is stricter: after an Omar-only reset before every run, the
real path must reach the visible deposit handoff **three times consecutively**.
Any failure resets the streak to zero.

**Bounded verdict: 100% PASS for the corrected finite v24 verification scope
below.** Every enumerated internal route, generated time-authority case,
clean-source restore test, and all three newly executed consecutive acceptance
runs passed without an intervening failure. This is not a claim that Instagram,
ManyChat, Gmail, Railway, or OpenAI can never have a future outage.

Global all-account `STABLE_READY` is not claimed: non-test accounts remain intentionally paused and the persistent volume still contains an older paused backlog. The live `/stability` surface correctly remains red instead of hiding that state.

## Scenario matrix

| ID | Scenario | Expected signal | Result | Evidence / cleanup |
|---|---|---|---|---|
| UQ-01 | Exact stochastic info-opener authority run | Every adopted packet retains visible host motion; no canned fallback | PASS 50/50 | 50 unique packets, 0 fixed-fallback hits, max 2 bounded re-author passes |
| UQ-02 | Broad first design-intake question | Survives funnel filter and leads the client | PASS | `test:oneshot`, `test:runner-semantic-repair` |
| UQ-03 | Detailed existing-reference interrogation | Rejected and model re-authored; no scripted patch | PASS | post-filter verifier regressions |
| UQ-04 | Closed booking controller | No illegal state/intent transition | PASS | 120 transitions, 3,072 flag combinations, 9,744 assertions |
| UQ-05 | Date-only post-form turn | Must ask/offer time; cannot emit double-check | PASS | 400 generated date-only cases, 0 synthetic-time leaks |
| UQ-06 | Client time counterproposal after stale offer | Current client time must win | PASS | 100 generated explicit-time cases, 0 stale-offer wins; live 1pm counterproposal |
| UQ-07 | Current-turn name + phone | Exact four-field verifier must use the same parser as route/state | PASS after defect found and fixed | exact live regression plus fixed-script/closed-transition harnesses |
| UQ-08 | Malformed/oversized inbound | Reject before queue/state adoption | PASS | `test:inbound-body-guard`, 20 checks |
| UQ-09 | Repeat form/double-check/deposit | One-shot checkpoints only | PASS | `test:oneshot`, 133 checks; both live paths sent link/double-check/deposit once |
| UQ-10 | Stale/reset debug state | Omar-only purge, zero residual target state, non-target preserved | PASS | final purge deployment `54f1825c-1162-40d1-be3d-94bd069bcf26`: 29 deleted, 0 remaining |
| UQ-11 | Restart and drift seal | Same sealed artifact boots; drift guard fails closed | PASS | current deployment `84d06372-7753-4699-ab92-c28f6765acec`; firewall 98, golden guard 234, persistent namespace 23 |
| UQ-12 | Live booking replay A | Real media/form/Gmail/date/time/double-check/deposit visible | PASS | Safari transcript + Gmail match score 140 + ManyChat/Instagram visible receipt |
| UQ-13 | Live booking replay B | Independent wording plus stale-offer override completes | PASS | Safari transcript + Gmail match score 140 + visible 1pm double-check/deposit |
| UQ-14 | Clean R2 restore | Downloaded source archive reproduces full suite | PASS | remote-download SHA match; 114 files; all 39 commands exit 0 |
| UQ-15 | Dirty/runtime-state isolation | No secrets or runtime conversation state in source snapshot | PASS | filename/content secret guard; runtime state excluded; R2 manifest records exclusions |
| UQ-16 | Corrected acceptance gate: three consecutive new full-funnel runs | Each reset run must reach real form -> Gmail -> four fields -> confirmation -> visible deposit; any failure resets streak | PASS 3/3 consecutively | Replay Nine, Ten, Eleven; three Gmail matches at score 140; 21/21 visible transcript assertions |

## Failures found by live E2E and repaired

### 1. Post-filter liveness split

The old path approved raw model output and only later applied funnel filters. A valid reply could lose its only lead motion after approval and become passive or empty. The repair filters first, verifies the exact packet that would ship, and asks the model to re-author under the already-frozen route. No visible canned CTA is appended.

### 2. Date-only time synthesis

The outer controller correctly held a date-only submission at `POST_FORM_TIME`, but the runner rebuilt booking fields with the preferred `2pm` value and could emit a premature four-field checkpoint. `2pm` is now only an explicit offer. It is not client authority until the client states a time or accepts that exact offer.

### 3. Stale offer beating a direct counterproposal

After the assistant offered `2pm`, a direct client turn such as `1pm works better for me` could be mislabeled as acceptance because the old detector keyed on `works`. A current explicit client clock time now outranks every stale assistant offer and model acceptance flag.

### 4. Current-turn identity split exposed during live replay

The route recognized `live_turn_name_candidate` and `live_turn_phone_candidate`, but the post-filter transition verifier compared only persisted `known_*` fields. The same turn could therefore route correctly and then be rejected as `four_field_double_check_missing`, producing silence. Duplicate parsers could also retain text such as `i used ... and` inside the name.

Repair:

- added one authoritative parser in `scv-booking-identity.js`;
- both `dm-authority.js` and `codex-dm-runner.js` use it;
- the closed-transition verifier now consumes the same sanitized live candidates;
- the exact failed live sentence is a permanent regression case.

## Deterministic and generated verification

Final local source run and clean R2-restored run both executed the complete `npm test` chain: **39 commands, exit 0 in both copies**.

Key locked counts:

- contract harness: 111 checks;
- critical routes: 32 checks;
- delivery pacing: 31 checks;
- closed transition contract: 120 transitions, 3,072 flag combinations, **9,744 assertions**;
- time-authority fuzz: **500 cases** — 400 date-only, 100 explicit-time, 0 synthetic-time leaks, 0 stale-offer wins;
- closed lifecycle: 24 checks across 11 failure classes;
- single controller: 63 checks;
- runner semantic repair: 115 checks;
- fixed-script gate: 68 checks;
- one-shot checkpoint lock: 133 checks;
- Gmail/form adoption: 54 checks;
- test-account purge: 25 checks;
- immutable drift firewall: 98 checks;
- golden snapshot guard: 234 checks;
- snapshot isolation: 29 checks.

The full chain also covers syntax, transport ownership, final sender payload, outbox adoption/order, post shares, first-tattoo tolerance, reaction inputs, orphan recovery, Kando regression, missed inbound recovery, stale backlog holds, approved config, coalescing, media, recovery window, persistence, ManyChat sweep, suppression, malformed body handling, and restore isolation.

## Real Safari E2E receipts

Passes A and B below were valid exploratory E2E evidence, but two passes were
not sufficient for final acceptance. Their earlier acceptance verdict was
withdrawn. The authoritative acceptance streak is the separate three-run block
that follows them.

### Pass A — real image and preferred-time acceptance

Fresh Omar-only reset, then:

1. custom tattoo opener;
2. actual snake reference image;
3. model-authored response and one form offer;
4. consent -> exact `https://www.effacermonexistence.com/apply` link once;
5. real Squarespace submission: `Omar System Replay Seven`, phone ending `0177`, Sunday/August 23 availability;
6. Gmail reader recorded the submission and matched it with score 140 / margin 140 using `handle_exact + after_link_45m + fresh_10m`;
7. date-only `August 23` -> assistant explicitly offered `2pm`, with no premature double-check;
8. client accepted `2pm` -> visible exact block:

```text
Name : Omar System Replay Seven
Phone Number : 4155550177
Appointment date : 23rd of August
Time : 2pm

can you double check this just to make sure
```

9. client confirmed -> one visible `$100` Zelle deposit handoff.

### Pass B — independent wording and client counterproposal

Fresh Omar-only reset, then:

1. tattoo-info opener;
2. text design: black-and-gray raven, shoulder, around five inches, creative freedom;
3. model-authored lead and one form offer;
4. consent -> exact form URL once;
5. real Squarespace submission: `Omar System Replay Eight`, phone ending `0178`, Saturday/August 29 availability;
6. Gmail reader recorded and matched it with score 140 / margin 140;
7. date-only `August 29` -> assistant offered `2pm`;
8. client counterproposed `1pm works better for me`;
9. visible exact block used the **current client time, 1pm**, not stale 2pm:

```text
Name : Omar System Replay Eight
Phone Number : 4155550178
Appointment date : 29th of August
Time : 1pm

can you double check this just to make sure
```

10. client confirmed -> one visible `$100` Zelle deposit handoff.

Both passes proved the executed path through Safari/Instagram, ManyChat delivery, the real public form, Gmail adoption, downstream four-field use, and visible deposit motion. They were not local-only simulations.

### Authoritative acceptance streak — 3/3 consecutive

No code or prompt change occurred during this streak. Before each run,
`SCV_PURGE_TEST_ACCOUNT_ON_STARTUP=1` was enabled for one deployment, the purge
reported `remaining_count: 0`, the flag was disabled, and a new successful
runtime deployment started. A failure at any point would have reset the count.

#### Consecutive run 1/3 — PASS

- Reset baseline: final state from deployment `84d06372-7753-4699-ab92-c28f6765acec`.
- Design: black-and-gray moth, upper arm, palm size.
- Real form: `Omar System Replay Nine`, phone ending `0179`.
- Gmail: recorded and matched at score 140 / margin 140.
- Date-only `5th of September` correctly produced a `2pm` offer.
- Client accepted `2pm`.
- Visible four-field block used `5th of September / 2pm`.
- Client confirmed; the `$100` Zelle deposit handoff appeared visibly.

#### Consecutive run 2/3 — PASS

- Independent reset: purge deployment `8b59b162-7a25-49c0-9842-3392862ded94` deleted 28 target artifacts, 0 remaining; runtime `b9bb9762-a868-43ed-8722-1d90ff352918`.
- Design: fine-line peony on ribs with creative freedom.
- Real form: `Omar System Replay Ten`, phone ending `0180`.
- Gmail: recorded and matched at score 140 / margin 140.
- Assistant offered `2pm`; client counterproposed `3:30pm`.
- Visible four-field block used the current client authority: `6th of September / 3:30pm`.
- Client confirmed; the `$100` Zelle deposit handoff appeared visibly.

#### Consecutive run 3/3 — PASS

- Independent reset: purge deployment `536d6d9a-9aa2-4c5b-acfa-baa9bf401857` deleted 27 target artifacts, 0 remaining; runtime `25457b88-c417-4bd5-b3b4-ec132bfda78d`.
- Design: red-and-black abstract dragon for the calf.
- Real form: `Omar System Replay Eleven`, phone ending `0181`.
- Gmail: recorded and matched at score 140 / margin 140.
- Date-only `12th of September` correctly produced a `2pm` offer.
- Client accepted `2pm`.
- Visible four-field block used `12th of September / 2pm`.
- Client confirmed; the `$100` Zelle deposit handoff appeared visibly.

Machine assertions over the three independently captured Safari transcripts:
**21/21 PASS**. Each transcript contained its unique name, phone, appointment
date, authoritative time, double-check line, `$100` deposit line, and Zelle
address. There was no failed or interrupted run between Replay Nine and Replay
Eleven.

## Deployment, reset, and current runtime

- v24 code deployment: `7c9a419c-726e-4bc7-8ebd-141010e8142d` — SUCCESS.
- Between live passes, Omar-only purge: `eb729462-2a3f-4d21-ab08-d51a6923516d` — 31 target artifacts deleted, 0 remaining.
- Runtime used for Pass B: `c4dde159-c188-4274-a4e9-433ee1918676` — SUCCESS.
- Final post-streak Omar-only purge: `8b5d4894-f0c3-459e-9c47-de453ae408ec` — 27 deleted, 0 remaining.
- Final purge-off runtime: `dda3a5f6-0229-4f74-b4cb-6e024f890630` — SUCCESS.
- Current `/health`: transport-only mode, immutable firewall green 98/98, golden guard 234/234, persistent `prod` namespace, v61 contract, v56 hard harness, single controller v3.
- Current operation flags: `SCV_PAUSE_ALL=0`, `SCV_PAUSE_NON_TEST=1`, Omar.system fast target only, delay multiplier 0, force-zero 1, purge-on-startup 0.

## Snapshot and restore receipts

R2 source artifact:

`omar-r2:omar-active-vault/artifacts/scv-instagram/2026-07-15/scv-closed-contract-20260712-v24/`

Files:

- `scv-closed-contract-20260712-v24-source.tar.gz`
- `scv-closed-contract-20260712-v24-source.tar.gz.sha256`
- `scv-closed-contract-20260712-v24-source-manifest.json`

Archive SHA-256:

`43e6917211a0643886988489df7c8f8888168bb7da89ce1d93e41f7e04cc5c7e`

The R2 object was downloaded into a new `/tmp` tree, its SHA matched byte-for-byte, 114 source/lock files were extracted, and the complete 39-command suite passed from that clean tree. Secrets, environment files, runtime state, and this self-referential proof receipt were excluded from the source tar; the receipt is uploaded separately after the Git commit.

Immutable chain at runtime:

- manifest SHA-256: `75943abfab53aa8b48d5674cff477a1deacf3110487366ac26b1e01ab42fdd7a`;
- seal SHA-256: `5e642ad7a29cb62e747903e309a90d6b1dd58ff5cc34b67c01313a3f79326c24`;
- protected set: 59 critical files + 1 canonicalized firewall file.

## Residual boundary

`/stability` remains intentionally red because the persistent production namespace contains an older paused backlog (47 inbox, 9 reactbox, 24 human-agent holds, 1 failed outbox at final check). `outbox=0`, current transport is healthy, and non-test accounts are paused, so this backlog was not blindly sent or deleted during Omar testing. Clearing or adjudicating that historical backlog is a separate production reopening object.

## Final verdict

**ULTRAQA COMPLETE for the corrected locked Omar.system v24 object: 16/16
scenario rows PASS, the authoritative live acceptance streak is 3/3
consecutive visible full-funnel completions through deposit, no unresolved
internal defect, and the clean R2 restore passed.**

Corrected proof publication:

- Git tag: `scv-closed-contract-20260712-v24-three-consecutive`
- R2 path: `omar-active-vault/artifacts/scv-instagram/2026-07-15/scv-closed-contract-20260712-v24-three-consecutive/`
