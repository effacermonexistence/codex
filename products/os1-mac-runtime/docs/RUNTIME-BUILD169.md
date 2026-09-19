# Build169 — distinguish execution from rejected adoption

## Evidence and scope
Two read-only native Codex probes returned actual responses and verified native session records. Their remote adoption was rejected. Other recent persisted deliveries have complete status; this is not evidence that every OS1 task fails.

## Repair
The no-write-replay rejection path now emits a typed failure notice carrying the saved delivery ID, native session ID, actual output and non-secret verification diagnosis. Successful native persistence with a nonempty zero-exit response is classified as verification_rejected, not unknown execution. Missing persistence, empty output or nonzero exit remains effects_uncertain. The app's existing saved-result rendering and native-session binding consume this notice. Remote rejection is not converted into success and possible writes are not replayed.

## Validation
OS1ContextTests and Swift build passed before release staging. Regression cases exercise the production classification helper, encoded failure notice, native identity, output retention and readback requirement. Build168's writer-lease queue, acknowledged native activity and build167's Whisper model resolution remain included.

## Boundary
The remote verifier rejects the short acknowledgement probes under its review profile. This release does not weaken that verifier or claim those probes were adopted. Native Codex records are not ChatGPT web conversations. Installer and post-install evidence are recorded separately.

## Method
Observed state, bounded hypothesis, reversible patch, deterministic tests, installed checks. Prior research inspected: https://arxiv.org/abs/2310.01798. Paper and self-review are not runtime proof. No external task replay, credential migration or unrelated project modifications.
