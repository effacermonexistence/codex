# P7 offline fit / calibration assessment (code-only)

This adds an **offline producer and recomputing artifact verifier**, not a runtime
predictor, forecast, selector registration, admission path or quality certificate.
No production module imports it. The existing DEV loader/predictor and route stay
unchanged; the App's sealed resource inventory is deliberately not extended.

## Smallest estimable baseline

`Resources/openclaw-os1-bridge/offline-route-calibration.mjs` fits two separate
Bernoulli MLEs per exact pre-outcome feature stratum and exact reference/routed
model+effort+account+instructions+tools+native-harness pair:

- reference matching (`sum(match) / n`);
- actual routed task success (`sum(success) / n`).

Both-wrong matching remains matching **and failed task success**. `accepted_B`
counts final baseline-correct/final-wrong cases separately. No model-name prior,
embedding, pretrained weight, smoothing, inferred label or remote call is used.
This finite-stratum statistical baseline does not generalize beyond its observed
strata. A small encoder or regression model is a later, separately tested choice.

The training model's identity depends only on training cases and preregistered
policy, not calibration labels. A separate assessment measures the frozen
training estimate against independently designated calibration cases: observed
fraction, Brier score, signed bias and a one-sided bounded-sum lower bound.
It does **not** turn the training MLE into a certified per-task probability or
perform an isotonic/Platt probability transform.

For K training-frozen strata and two binary labels, the implemented radius is
`sqrt(log(2*K/alpha)/(2*n))`; lower bound is `max(0, calibration_mean-radius)`.
This follows by applying the independent [0,1] bounded-sum one-sided tail bound
`exp(-2*n*epsilon^2)` and allocating `alpha/(2*K)` to each label/stratum event.
The bound concerns the assumed sampling distribution, not the correctness of
rights, labels, execution-time chronology or any future individual answer.
Independence/stationarity/representativeness need actual external review; a
source hash for that review does not prove those assumptions.

Actual primary research inspected for this implementation:

- [BEST-Route Algorithm 1 and section 4.2](https://arxiv.org/html/2506.22716v1):
  separate predicted match, quality threshold and cost selection. No upstream
  engine code or weights copied; its published results are not OS-1 results.
- [Loper and Regier, section 1 equation (1), section 2](https://arxiv.org/html/2503.17594v1):
  the independent bounded-sum Hoeffding tail used in the derivation above.
  The original 1963 publisher PDF returned 403 and the RPI copy timed out; this
  document does not claim that original PDF was inspected.
- [Intrinsic self-correction study abstract](https://arxiv.org/abs/2310.01798):
  source-backed external checks, not fluent self-critique, are the chosen gate.

## Explicit contract, no statistical defaults

Input kind is `os1_offline_calibration_input_v2`. Top-level keys are exactly:
`schema, kind, data_mode, operation, now_ms, fit_lock, policy, assignment,
evidence, samples, sources`.

`data_mode` is `synthetic_fixture` or `actual_evidence`; neither creates trust.
`operation` is `fit` or `assess`. The pure producer has no implicit clock.

Policy must explicitly fix algorithm/version, feature schema, reference
identity, regime, source-backed independence review, statistical minimum counts,
minimum match/success lower bounds, maximum Brier/bias, familywise alpha,
maximum calibration accepted_B (zero), OOD rule and time/expiry bindings.
No production acceptance thresholds are supplied by this code. The permissive
thresholds in the synthetic fixtures are test premises only.

The assignment binds exact original run-card hashes/case IDs, its own original
source bytes and the preregistered policy. Training assignment may deliberately
use development observations, retaining `original_split=development` and the
original proof mode. It does not relabel DEV as clean/calibration/heldout. `used_for_fit` is true
only for training cases and false for calibration cases. The
assignment and statistical policy freeze before calibration collection.

Evidence bundles use the existing `evaluateFrozenRouteEvidence` join, retaining
its native exact-attempt, selected/ACK/observed tuple, task/source, pre-score
final-lock, independent grade and normalized P3 resource checks. Its existing
scientific-precheck blockers are retained in the report, not treated as P8
acceptance. Source rights, actual origin, independent complete labels, disjoint
lineage and source bytes are separately required by this producer.

Before invoking the existing join, a metadata-only preflight checks policy,
assignment, original run-card splits and operation. Any heldout assignment or
source-card heldout split is rejected; `fit` rejects any non-training role or
non-development source-card split. Rejection returns no joined runs, case
statistics, fit, model, calibration counts or grade-derived metrics. Changing
forbidden labels does not change that rejection except its full-input hash.
Syntactic parsing/hashing is not a claim of OS-level secrecy or proof about
what a historical producer could access.

Each sample supplies the current host pre-outcome feature/task projection,
per-arm exact harness/binary/instruction identities and source-backed task and
feature bindings. The task projection is read-only and fully hash-bound; there
is no fabricated host metadata adapter from incomplete native catalog rows.
`source_fingerprint` and `source_snapshot_sha256` are not silently equated:
an explicit task-binding source links the projection to the original case.
A sample also requires one source-bound `offline_native_execution_window_v1`
per arm: exact task/node/attempt/outcome, tuple and normalized native identifiers,
source-observed Unix start/end times, original native receipt hash and matching
canonical witness bytes. Feature-capture witness bytes include their timestamp,
not just the feature values.

P3 `routing-outcome-capture.mjs` sets `provenance.observed_at_ms=now_ms` when
reading a settled adapter receipt. It is capture/observation time, **not native
generation start, classification time or necessarily final-lock time**. The
producer does not manufacture an execution interval from that value, a duration
counter or a notification timestamp. The new explicit witness must satisfy:

- policy/card freeze and feature capture are no later than execution start;
- start <= end <= pre-score final lock < independent grade;
- P3 receipt observation is no earlier than execution end, no later than the
  input's current time, and available by fit freeze (training) or assessment
  time (calibration);
- calibration execution is after the fitted-model freeze.

A receipt may be captured retrospectively after final-lock/grade while still
meeting its phase cutoff; capture is not silently equated to any earlier event.
The normalized `execution_id` may be an adapter-envelope identity, not a provider
execution ID. Exact namespace/provenance is retained. Missing intervals fail
insufficient, not an invented time. These are source-consistency checks, not
independent authentication of timestamp assertions or hidden historical access.

Source payloads are bounded supplied UTF-8 captures with verified SHA-256 values;
provider originality and source authenticity require separate review.
Source byte integrity is not independent source authenticity.

Resource scope is intentionally bounded to **one native parent attempt per arm**
(including native children through existing P3 accounting), plus explicitly
measured disjoint routing/verification/integration/other host overheads. Native
reasoning/cache/children are not added a second time. Host retries are rejected,
not dropped. Unknown totals or overheads fail closed. These observed native-token
means are not subscription quota, cash, or automatically comparable tokenizers.
A future whole-task/multiple-host-attempt accounting adapter must preserve each
failed attempt and prove disjointness before broadening this scope.

## Two stages and separate P8

1. `fit`: accepts training-designated cases only. Returns the fitted model and
   content hash. It must not receive calibration or labelled heldout data.
2. Persist/freeze that model externally. An assessment requires a matching
   source-backed `offline_training_model_lock_v1` witness, with the model/policy
   hashes and timestamp before the calibration run-card freeze. A timestamp
   assertion is consistency evidence, not proof of a hidden historical event.
3. `assess` executes in separate phases, not merely a final-report filter:
   - metadata/source verification and source-backed lock shape/time preflight;
   - **TRAIN-only** evidence joins, source/window validation, minimum counts and
     frozen model-identity derivation;
   - exact source-backed fit-lock hash verification;
   - only then **CALIBRATION** outcome/grade joins and statistical assessment.
   Missing/malformed/late locks reject before any outcome join. A valid-shaped
   wrong model hash may return TRAIN-only reconstruction, never calibration
   labels/counters/cases/statistics. Full source-manifest publication also waits
   for lock acceptance. Changing or making calibration labels opaque must not
   change that rejection except its input hash. Negative calibration statistics
   are retained only when an accepted frozen model legitimately unlocked that
   phase, not as an oracle preview of an invalid assessment.
   An original source card must have one assigned role. Mixed-role cards are
   explicitly unsupported: the producer will not slice/re-hash a frozen card to
   bypass the phase boundary.
4. P8 fresh/heldout evaluation and root-reviewed protected promotion remain
   separate. P7 rejects labelled heldout input. It cannot mint an accepted
   holdout, live registration, forecast, or authorization flag.

`verifyOfflineRouteCalibrationArtifact(artifact, input)` recomputes the original
analysis and quarantines altered values, source/policy changes or authorization
injection. This is an **offline verifier**, not the production artifact loader.
There is no portable trust capability obtainable by setting a JSON field.

## Explicit bounded capacity, not a lowered confidence target

This v2 offline contract retains a 128-case total ceiling, with at most 32 cases
per original run card and eight original cards. It does not retrospectively
split/re-hash a historical frozen run to bypass the inherited join budget.
The separate offline copy/parser budget is 300,000 JSON nodes, depth 32,
8,192 array items/sources, 262,144 bytes per string/source and 8 MiB serialized
input. The unchanged production `frozenRouteData` budget still applies inside
each existing join: 30,000 nodes, depth 24, 8,192-byte strings. An explicit
precheck names these inherited join capacity limits before invoking it.

Regressions exercise 60 total cases, a full 128-case input across four original
32-case cards, and a 262,144-byte supplied source through the CLI. Overflow
returns named `oc_capacity_*` diagnostics rather than a generic bad-data verdict.
No production loader budget was widened.

Statistical policy capacity is checked before any label join, using the most
optimistic single-stratum/all-success case. For a positive target t < 1,
`ceil(log(2/alpha)/(2*(1-t)^2))` calibration rows are necessary; target 1 is not
attainable at finite n under this bound. With alpha=.05 and target .95, this
requires **738 calibration rows**, but the 128 total case limit with minimum
training count 2 permits at most **126**. The output is
`unsupported_policy_capacity`, with those exact requirements and no fitted or
assessed model. It does not silently lower the target, alpha, confidence bound
or minimum count. Supporting such policies requires a future separately
reviewed higher-capacity offline join/data contract; P7 cannot currently qualify
them. A capacity pass is only a necessary condition, not statistical acceptance.

The v1/09593 candidate was not adopted. The initial v2/d831 candidate also
remains unadopted: its missing-lock path incorrectly joined calibration data
before rejecting. The corrected v2 phase ordering prevents that execution, not
just its display. Both commits, source reports and old test logs remain
historical records. V2 rejects the old v1 input contract.

## CLI and inspection of existing evidence

`node products/os1-mac-runtime/scripts/offline-route-calibration.mjs \
  produce /absolute/input.json EXPECTED_INPUT_BYTE_SHA256 /absolute/private/report.json`

The input is explicit, owned, regular, non-executable, non-writable by others,
single-link, stable-read, hash-pinned UTF-8 JSON. Symlinks, duplicate keys and
non-finite numbers are rejected. The output directory must be private/canonical;
output is exclusive mode 0600 and never overwrites an input or prior result.
Exit 0 is a produced offline analysis, **not promotion**; exit 2 is insufficient
evidence or an unsupported statistical-policy capacity; exit 1 is file/CLI failure.

`inspect` instead of `produce` reads legacy/source data without fitting or
translating it. It reports observed row/case identifiers and missing contract
fields, preserving original proof labels. This is the only operation used on
the existing historical P6 n2 component report in this code-only issue. That
report was not assigned to training, fitted, calibrated or promoted.

## Validation boundary

Run `node --test scripts/fixtures/openclaw-rcc-offline-route-calibration.test.mjs`
from the runtime directory. All positive fitting data are explicitly synthetic.
They exercise derived non-constant MLEs, calibration error/lower bounds,
both-wrong versus success, accepted_B, chronology/fit freeze, rights, source
hashes, task/tuple/feature bindings, split overlap, missing costs, retries,
artifact mutation, parser/custody corruption and attempted proof upgrades.
They also reject the old impossible calibration capture at1050 before its
feature capture1900/card freeze2000/execution end2040, and verify forbidden-sheet
label noninterference before any join. They establish code contracts only. Current real training/calibration efficacy,
frontier/max parity, quota savings and runtime installation are unmeasured.
