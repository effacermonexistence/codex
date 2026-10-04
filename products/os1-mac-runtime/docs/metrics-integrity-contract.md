# Operational metrics integrity (build 316)

## Measurement object

- Raw token count is normalized input + output. Cached input is already part
  of normalized input and is counted once. Claude input normalization adds
  fresh input, cache reads, and cache creation before that total is recorded.
- Price-weighted routing units are a heuristic, not raw tokens or a cash bill.
  Local Learning statistics use raw tokens; server route preferences are a
  separate object.
- Adoption means executed/delivered output passed the recorded adoption path.
  It is not proof that the owner's objective was fulfilled or the answer was
  correct. Current receipts lack independent objective-quality verdicts, so
  objective accuracy and clean off/on performance uplift remain unmeasured.
- One OS-1 attempt is not necessarily one model API call. Native aggregate
  usage can include multiple responses and tool cycles. Aggregate record count
  must not be presented as model call count.

## Arithmetic and cohorts

- Tokens per adopted receipt = sum of all eligible attempt tokens / adopted
  receipts. Failed and retried eligible attempts stay in the numerator. Any
  missing attempt usage makes this ratio unmeasured, never free.
- Eligible Learning outcomes are adopted, quality_failure, timeout and
  capability_failure. Quota and verification infrastructure outcomes are
  excluded by this route-sample definition. This is not all-account billing.
  The terminal-task cost view instead includes every recorded task attempt.
- Attempt seconds per adopted receipt include eligible failed/retried attempt
  durations. Missing duration disables this measure. Attempt timing excludes
  policy/route preparation and is not GUI-to-final-output latency.
- Token saving = 1 - candidate/base; delivery/adoption rate delta = candidate
  rate - baseline rate, expressed in percentage points; efficiency change is
  a relative ratio. Non-positive baselines leave ratios undefined.
- Retry-scope route comparisons are descriptive sequential observations, not
  independent paired baseline experiments. Weekly provider-specific trends
  may change with task/model/effort/context mix and do not establish causality.
- An unchanged heartbeat is not a new experiment or learning observation.
  Scenario projections are hypothetical and cannot become measured history.

## Feedback provenance

A neutral repeat, provider comparison, quoted instruction or conditional
failure must not automatically rewrite the preceding output into a quality
failure. Explicit correction/failure language is a bounded feedback detector,
not an independent objective verifier. Old outcome disagreements remain in
their original records; do not reconstruct historical owner intent or rewrite
past quality labels merely to make aggregate reports agree.

## Deterministic regression examples

These are synthetic fixtures, not production measurements or uplift proof:

1. Costs 10 and 1000; one adoption: cost/adoption = 1010, not 200.
2. Adopted cost 100 plus failed unknown cost: cost/adoption = unmeasured.
3. Adopted 1 second plus failed 100 seconds: time/adoption = 101 seconds.
4. Cache creation survives local construction/serialization/outcome revision;
   historical missing creation remains unknown. Public feedback keys do not
   expand the server contract.
5. Neutral `다시 읽고 그대로 답해`, provider-repeat instructions, quoted
   `not working`, and conditional failure do not establish rejection.
6. Negative, zero, missing and unmatched comparison cases preserve their
   proper sign or unavailable state; do not manufacture a positive improvement.

## Verification source boundary

Verify native usage -> signed aggregate -> local observation -> arithmetic ->
display. Preserve raw originals and separate fixtures from actual records.
Independent direct/native/off-on baselines were not generated for this audit;
no additional provider call is needed to check arithmetic or labels.

Primary documentation inspected for the normalization rule:
[Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
The [Codex App Server](https://learn.chatgpt.com/docs/app-server) documents usage
updates; native record identity is still required for a particular turn.
The repair method follows external feedback rather than trusting a fluent
self-explanation alone, informed by the inspected abstract of
[intrinsic self-correction limitations](https://arxiv.org/abs/2310.01798).
These sources do not certify application correctness; executed regressions
and runtime receipts must do that.
