# Queue context boundary — build84

## Observed incident and minimal design

Installed build83 returned two correct read-only conversational answers. Before
the second turn, native synchronization reimported OS1's own first request plus
the appended WorkspaceDiscovery directory hint as a new external user message.
The original request digest no longer matched. This is an ingestion boundary
error, not a reason to retry a model or weaken verification.

Put workspace hints in their own provider-envelope section BEFORE the current
user request. The current request remains verbatim and terminal, so the native
reader and deduplication agree. For existing native records only, recognize the
exact generated hint suffix and skip it only when its preceding request digest
already exists in OS1. Never hide unmatched direct-backend text, overwrite old
messages or alter native source files. Old already-imported duplicates remain
as evidence; no destructive transcript migration.

Acceptance: original request round-trip; structured hint separation; historical
own-request dedup; unmatched/quoted text preserved; cursor progression; installed
FIFO conversation continuity with no synthetic external question; composer,
queue/fork/parallel and installer preservation regression checks. Add the normal
primary Stop positive path to the deterministic suite alongside the actual UI
Stop observation from build83.

Five perspectives: intent = readable sequential conversation; continuity = same
request identity before/after native ingestion; capability = no new authority;
verification = exact text/digest fixtures plus live UI; cost = no retry/model
needed to repair envelope construction. No change to private routing decisions,
customer state, production services or credentials. Rollback preserves build83
binaries and never overwrites newer sessions.
