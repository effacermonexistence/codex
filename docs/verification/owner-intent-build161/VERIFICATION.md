# OS1 owner-intent authority repair — build161

## Scope / source
OS1 local request parsing, preparation, remote route projection and pre-execution ticket gate. Existing current-task input remains unchanged for the backend; only the routing projection is changed. No website deployment, external messaging, customer state reset or failed-task replay is part of this repair.

## Failure mechanism
Previously, action vocabulary could grant permission inside a question or quoted example. Preparation used a separate raw text interpretation. Remote model selection received a different free-text objective, and the local read-only gate only covered selected objective labels. These are distinct boundaries, not one missing keyword.

## Repair
- Share a non-authorizing-text projection between scope, preparation and coarse objective classification. Preserve raw source in executor context.
- Add separated Korean deletion/modification request forms; preserve explicit prohibitions.
- Project the adopted scope into the remote routing objective without changing the executor's owner request.
- Require exact signed ticket permission equality before every backend iteration, including retries; reject unsupported full_access and unknown profiles.
- Do not silently elevate a signed read-only ticket or proceed with an underpowered write request.

## Executed verification
- Context suite: 220 task-context checks, plus project/source/workflow regression groups; captured log attached.
- Live route-only requests: 4/4 HTTP 200, expected read_only/workspace_write profiles matched. No backend/model generation was invoked by these probes. Nonzero end-to-end token savings are not claimed.
- Mutation control: weakening the read-only matcher in an isolated source copy causes the exact-ticket test to fail (exit 133). Production source unmodified by mutation.

## Method
Inspected intrinsic self-correction limitations and external-feedback guidance via the actual abstract of https://arxiv.org/abs/2310.01798. The adopted mechanism is external observations plus deterministic rejection tests, not self-explanation as evidence.

## Boundary
This is regression-tested enforcement and a bounded speech-act parser, not a proof of perfect natural-language intent recognition. Ambiguous/unrecognized authority remains read-only; permission mismatch stops before provider execution. The private remote classifier has not been replaced; its emitted permission is independently checked locally. No automatic escalation or external side-effect replay was added.

## Installation / publication
Build161 / 0.9.95 installed by the OS1 idle self-update path at 2026-09-19T04:40:48Z. All 11 staging gates and 9 installer gates passed. Sessions 93 → 93. Installed app and CLI SHA-256 match the staged artifacts (installation.json). App and fleet restarted. No failed owner request was replayed. The stage parent commit predates these uncommitted edits; exact source-file hashes are recorded rather than claiming parent HEAD alone identifies the build. GitHub/R2 publication is recorded separately in the delivery receipt.
