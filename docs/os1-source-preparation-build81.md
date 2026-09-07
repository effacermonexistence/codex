# OS1 source preparation recovery — build 81

## Failure boundary

Build 79's unified backend result recovery does not cover an exception before
dispatch. The reported SCV preparation stopped while resolving custody of the
observed operating release: production was ahead of GitHub/R2 publication.
The exact source already existed on the producing Mac. A model switch would
not establish source identity, and removing the hash guard would select the
wrong release.

Another defect was found in the exact request: “수정해야 되니까 준비해라” was
classified as a modification rather than a reason to prepare. Future-tense
preparation clauses now remain preparation; explicit edit imperatives survive.

## Implemented path

1. Observe the active release through the existing read-only readiness probe.
2. For a preparation request without an explicit remote source, look only in
   OS1's registered-source namespace for that exact manifest hash.
3. Verify the manifest bytes against the live hash, release ID and content
   fingerprint, and verify every source member's bytes/size against that
   manifest. Reject unlisted/duplicate/unsafe paths, links, devices, sparse
   files, PAX path/size/link overrides and truncated/oversized archives.
4. Return the same immutable source snapshot and OS1-owned task context used
   by remote acquisition. Either backend receives this source on follow-up.
5. Otherwise use existing exact GitHub/R2 acquisition. Corrupt local cache is
   rejected but cannot prevent independently verified remote acquisition.
6. If acquisition cannot finish, return `source_pending` with observed release,
   original objective, reason and next step. The app persists it, pauses its
   dependent queue and never marks it complete. An arriving registered source
   allows one preflight-only preparation retry per manifest identity. The
   budget survives restart; cancellation, explicit remote selection and
   mutation requests prevent automatic retries.

No whole-home scan, guessed release path, model-generated source identity,
background app reveal, production change or Gold-pointer modification occurs.

## Source-producer contract

An authorized source-producing backend can register an already-created,
explicitly selected runtime SOURCE package:

```sh
os1 source-register scv-instagram /absolute/runtime-source.tar.gz
```

This performs a live check and full member verification before storing bytes
under `Library/Application Support/OS-1/registered-sources/scv-instagram/`.
The namespace is addressed by the exact live manifest digest, not release
recency. A staged registration becomes visible atomically after readback.
This command does not deploy, upload to R2, move recovery pointers, or acquire
customer-state archives. Register before handing preparation back to OS1;
remote release publication remains a separate task.

macOS AppleDouble and bounded timestamp/provenance PAX metadata are stripped
into a portable source-only archive. Actual source bytes and executable intent
are preserved; special permission bits are rejected. The original archive is
unchanged. Both input and registered archive hashes are reported explicitly.

Receipts use `registered_source_retrieval`, `r2_verified=false`, no bucket or
fabricated GitHub commit, and `live-manifest-registered-source-v1`. User-facing
prose says “registered local original”, never “downloaded from R2”. Explicit
R2 requests cannot silently use the local path. Unknown recovery baseline stays
unknown; an existing separately recorded baseline is preserved.

An installed follow-up exposed a further boundary: asking whether the attached
source came from R2 was mistaken for a new remote acquisition. Provenance
questions now reuse an already-verified snapshot; fresh acquisition, source
switch and connection imperatives remain distinct. The footer says “Source
attached” instead of falsely labelling every transport as R2.

## Method and limits

The objective, source continuity, execution, receipt/UI, cost and security
perspectives each have independent tests; one passing test does not compensate
for a failed source hash or lost objective.

The retrieval/generation separation is informed by
[Corrective RAG](https://arxiv.org/abs/2401.15884); returning observations to the
executor follows the action/feedback principle in
[ReAct](https://arxiv.org/abs/2210.03629). These are bounded engineering uses,
not claims to implement their trained algorithms, hidden CoT or backpropagation.

Registration is not an R2 publication or a guarantee that future unpublished
releases will already be available on a new Mac. If neither registered nor
remote verified bytes exist, OS1 retains a pending acquisition rather than
inventing success. Backend responses, source preparation and production
deployment remain distinct completion conditions.

## Verification and rollback

Deterministic archive/intent tests, manager persistence and bounded retry tests,
existing execution/context regressions, and the installed read-only incident
replay are required. Build 79 app/CLI are backed up before replacement; the
stable signing requirement and all conversations/pins/drafts must be retained.
Rollback replaces binaries only, never current session state.
