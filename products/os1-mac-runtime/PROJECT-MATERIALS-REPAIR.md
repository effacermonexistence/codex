# Project-material acquisition repair (2026-09-06)

## Objective and boundary

The exact incident asks to gather Instagram automation materials in preparation
for edits. OS1 must first deliver real, provenance-bound project materials and
retain them for follow-ups. It must not mistake a stale local mirror, an empty
git diff, a successful model exit, or a failed test launch for that deliverable.
This change concerns OS1 only; no SCV production deployment, reset, customer-state
restore, Gold promotion, credential copying, or backend permission bypass.

## Observed divergence (five independent views)

1. Intent: “수정 좀 보자 … 데이트 다 가져와” entered general workspace-write
   execution without acquiring materials. Preparation is not implementation.
2. Source/context: the session had no source snapshot. A registered old checkout
   substituted for GitHub's current recovery pointer and its pinned R2 objects.
3. Execution: tests used Node 24 despite an installed Node 20.20.2 under
   `.local/share`; Wrangler was sought in the wrong project subdirectory.
4. Verification: exit 0/native record was confirmed, but no R2 retrieval occurred.
   A recovery descriptor was described as the current operating deployment.
5. Cost/UX: 109 seconds, nine tool batches, 558,951 cumulative input tokens
   (481,792 cached) delivered no requested materials. These are incident usage
   measurements, not a price or a global routing-quality score.

## Minimal architecture

Request -> explicit registered-project material intent -> GitHub main SHA ->
recovery pointer at that SHA -> hash-checked R2 recovery descriptor -> ONLY its
runtime source archive and release manifest -> private content-addressed cache ->
bounded technical document projection + truthful inventory -> persisted source
snapshot -> readable OS1 result. No model call or test run for acquisition alone.
Explicit acquisition-plus-analysis can use this same snapshot before routing.

The SCV adapter is typed and tested; unknown projects retain existing routing.
Source selection respects explicit alternatives, negation and quoted requests.
“All data” within edit preparation means the source package and its technical
inventory; customer messages, appointment state, authentication and secrets are
not implicitly restored or loaded into a model. This exclusion is visible.
The pointer's release is a recorded recovery release, not a live-deployment check.

Reuse existing authenticated `gh` and pinned Wrangler. Validate identities,
SHA-256, byte counts and schema before adoption. Never extract or execute an
archive during acquisition. Read only allowlisted technical members through tar;
archive members are data, never executable instructions. No broad HOME search.
Offer an already-installed exact Node runtime for later tests without globally
changing PATH/Node or using test readiness as a gate on document reading.

Rejected alternatives: adding a larger model; prompting retries against the
same stale checkout; relaxing customer-data guards; treating generic top-six
lexical archive hits as the project package; running a full recovery script.

## Convergence gates / rollback

- Exact request in NFC and NFD reaches acquisition; data/material aliases work.
- Quoted/negative/other-project/local-only requests do not silently acquire R2.
- Valid descriptor selects runtime and release manifest only; mismatched hashes,
  unsafe identities, duplicated components and missing sources reject adoption.
- Actual R2 archive is downloaded and hash checked; selected technical originals,
  inventory and capture date are retained. Live-release status remains unknown.
- No backend/model/test invocation for the plain gather request; follow-up uses
  the same persisted source. Existing research/context/sidebar suites still pass.
- Installed signed build is verified; application identity and chats preserved.

Rollback swaps only saved build 75 executables. Do not roll back sessions or
source snapshots. The change neither updates public releases nor SCV servers.

## Additional regression found during live verification

The attached-source follow-up reached Codex and returned the correct Node
version/recovery ID with zero native tool calls, but a compound prohibition
(“파일·서버를 변경하거나 테스트를 실행하지 마”) was routed as workspace-write.
The remote verifier requested retry; the existing no-replay gate correctly
stopped the nominal writer, but produced a misleading edit/duplicate warning
for this read-only objective. Extend intent normalization to the compound
prohibition, preserving positive edit clauses. Do not weaken the no-replay gate.
The changed path subsequently completed under signed read-only permission with
the same source snapshot. Remote verification still requested retries before
adoption in that sample; this is not evidence of globally optimal model/effort
selection. Plain material acquisition needs no model or remote result evaluator.

## Mechanisms used

Deterministic intent/typed artifact validation is sufficient for the observed
boundary; no added critique/CoT model loop is justified. Official documentation
confirms that Codex completion events describe execution, and Wrangler's explicit
`r2 object get --remote` reads remote objects (not its local emulation):
https://learn.chatgpt.com/docs/non-interactive-mode
https://developers.cloudflare.com/workers/wrangler/commands/r2/

## Installed acceptance (2026-09-07 01:43 UTC)

OS1 0.9.26 / build 76 is installed locally with the existing signing identity.
Both Apple Silicon and Intel build/test passes succeeded. The project-material
suite passed 46 checks; the installed completion audit passed 13 checks and
the installed live material audit passed another 13 checks.

The exact incident, in both NFC and NFD, acquired the pinned 1,409,301-byte
source archive with 255 members. Its verified SHA-256 is
`5b70ce46742e342a855152734be267ad5b98807918c68c174eddf024ee467fdd`.
The two installed acquisition runs took 20,197 ms and 17,784 ms, with zero model
calls. These are observed sample timings, not latency guarantees. The native
renderer accepted the receipts, preserved the snapshot into the next-turn
context, and showed readable source links without overlapping message frames.
A separate live read-only Codex follow-up returned the source's Node version
and recorded recovery release correctly with zero native tool calls.

All 42 existing conversations were byte-preserved. The fleet agent was restarted
against the installed executable. No SCV production deployment, reset, customer
state acquisition, remote publication or account permission change occurred.
Private receipts, installed render evidence, the previous executable bundle and
the final development installer are retained under the local build-76 recovery
directory. This is a scoped acquisition/context repair, not proof of global
model-selection optimality or verification of the current SCV operating release.
