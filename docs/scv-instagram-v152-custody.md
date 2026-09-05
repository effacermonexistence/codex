# SCV Instagram v152 custody record (2026-09-05)

First fix of the owner's v151 experiment round. The owner tests live one detail at a time; each fix is a
separate small release branched from the approved v151 recovery Gold, gold-guarded against v151, and
reversible to v151 at any time. This record lists the exact objects, what was verified, and where the
sandbox stopped.

## Active release

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260905-v152` |
| content fingerprint | `46d222d1c413b518078aec1b05b36f92979355814623cfacbf5aedd429583a67` |
| release manifest sha256 | `95365181be58a0edc10517a861534cab877ea8d03581a970552e20835ac91fa1` |
| sealed files | 255 (v151's 254 + `scv-checkpoint-revision-ack.js`) |
| base | `scv-instagram-single-20260904-v151` = recovery Gold `scv-instagram-recovery-gold-20260905T054647Z-v151` (unchanged) |
| staging deployment | `71585126-39a6-4ba2-bfc3-367b451ffa8a` |
| production deployment | `130e7d78-3f7b-46bc-b9b8-e1c7f94cd71e` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260905T202220Z/v152/scv-instagram-single-20260905T202220Z-v152-time-revision-acknowledged-before-corrected-block.tar.gz` sha256 `bf78fec66e4e21e58a96225e7e055ac19b4df1adf17ad1bff02fa6bb0974fe22` (1415866 bytes, readback byte-identical) |

## What v152 changes

Owner, 2026-09-05: "오후 5시가 가능할까요 하면 네 가능합니다 하고 더블 체크가 나와야지 바로 더블 체크가 나오더라구요 … 그거 고쳐".

At the open four-field checkpoint, a client who asked for a different time ("Can we do 3 PM?") received the
corrected block as the whole reply; the question itself went unanswered. v152 answers first, then re-issues
the block:

```
yes 3pm works
Name : …
Phone Number : …
Appointment date : 12th of September
Time : 3pm

can you double check this just to make sure
```

- One predicate (`scv-checkpoint-revision-ack.js`, ack v1) decides it for every producer of the checkpoint:
  the runner's fixed lane, the control plane's deterministic recovery, and the dm-authority canonicalizer
  (which keeps that leading bubble and still strips any other prose). The model lane gets the same rule as
  route guidance for its fallback.
- It fires only for a resolved time revision of an OPEN checkpoint whose new time is legal (or a date+time
  move: `yes september 12 at 3pm works`). Never for the first checkpoint, a date-only revision (the contract
  re-asks the time), a too-early time (the decline lane), a name/phone revision, or a bare re-confirmation.
- The two-bubble reply is one checkpoint object for every detector; the client's next confirmation still
  moves straight to the deposit handoff (golden replay gold-b-07 unchanged).

Files: `codex-dm-runner.js`, `scv-deterministic-recovery.js`, `dm-authority.js`, new
`scv-checkpoint-revision-ack.js`, `scv-double-check-divergence-harness.js` (v12, 369 checks),
`SCV_DESIGN_INTENT_LOCK.md` (v152 addendum). No prompt, policy, schema, model or April-tone file changed.

## Verification

- Gold guard (`gold-v152/gate/scv-gold-guard.sh`, baseline = the v151 runtime materialized from R2 and
  fingerprint-verified): candidate diff = exactly the six declared files, no undeclared change.
- Full local suite on the candidate: 105 of 111 steps pass; the 6 that fail do so only because this sandbox
  forbids binding a local TCP port (`listen EPERM 127.0.0.1`): `test:single-control-transport`,
  `test:final-sender-payload`, `test:outbox-adoption`, `test:inbound-post-share`,
  `test:heart-reaction-inbound`, `test:inbox-transport-timeout`. The same commands fail identically on the
  untouched v151 tree. Zero real failures. `test:single-release` on the sealed tree: 20 of 22 sub-steps
  pass, the other 2 are the same port-binding harnesses.
- Golden conversation replays against the GOLD-3 fixtures: gold-a 17 turns (16 exact), gold-b 7 turns
  (6 exact); the only non-exact turns are the two declared divergences (`gold-a-08-actually-3pm`,
  `gold-b-06`), whose new output is the two-bubble reply above. The untouched v151 tree replays 17/17 and
  7/7 exact, so every difference is this change.
- Divergence harness v12: 369/369, including the exact live control-plane path, the runner lane, the
  canonicalizer, the bare first checkpoint and the boundary cases.

### What did not run here, and why

- The staging isolated container suites (Part B) and any Omar.system reset need `railway ssh`; this session's
  sandbox blocks that. Part B is `v152-private-archive/staging-isolated-suites.sh`; it re-runs the full suite
  inside the staging container, where the six port-binding harnesses can bind.

## Golds

- Recovery Gold stays `scv-instagram-recovery-gold-20260905T054647Z-v151` (pointer, record and R2 objects
  untouched). Rolling back = redeploy the v151 sealed runtime and verify fingerprint `d60dfc9f…`.
- Behavioral GOLD-3 stays v148; the two golden turns above are declared divergences, not a new gold.

## Boundaries

- No customer state was touched; the release changes code only.
- No claim of Instagram-visible delivery is made here; readiness and fingerprint are what was verified.

## Hand-over reset

Fresh Omar.system reset on production deployment `130e7d78-3f7b-46bc-b9b8-e1c7f94cd71e` after the v152 deploy: post-reset snapshot `20260905T215157Z` (sha `78f3d4a54533a23f8790343aaa1b471834bf591669ec1884ecb6a5bdadb0fb4d`), pre-reset snapshot `20260905T215151Z` (sha `1dcecc4865cbfa42766553ac4a0676e8a3ac5b3246abd316122348bfbd5dd981`), receipt sha `b2ac9f230a05e10634f12bbd488f010f57f79849ef43358f9b49209ca18e378b`; all three read back byte-identical from R2 `scv-instagram-automation/timestamped-snapshots/omar-system-reset/20260905T215157Z/`. The debug identity (omar.system / 1537753982) is the only scope the operator may purge; residual 0; every worker resumed.

## Drift sentinel

`scv-instagram-drift-sentinel` v15 (Worker version `6b749925-d569-4837-b37c-cadcd2a495d1`) pins the running release v152 (fingerprint `46d222d1…`, manifest `95365181…`) separately from the current recovery point, which stays the v151 Gold; GOLD-3 (v148) pins are unchanged. First passing scheduled run: `pending`.
