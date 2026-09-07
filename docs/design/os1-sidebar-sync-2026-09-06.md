# OS1 sidebar synchronization repair

## Objective and boundary

OS1 remains the work surface; Codex/Claude tabs inspect native records. Pin,
unpin, order and selection must not diverge silently. No model calls for sidebar
operations, no focus theft, no authority escalation, no transcript rewrites.

## Observed divergence (five views)

- Intent/UX: OS1 saves only `pinnedAt`; native tabs ignore pins and promote the
  selected record to position zero. Neither sidebar supports explicit reordering.
- Identity/context: OS1 and native records have different stable IDs. Browsing a
  linked native record does not select its owning OS1 conversation.
- Execution: installed Codex schema provides `thread/section/move`, not the
  `isPinned` metadata patch described by current online docs. Use installed schema.
  Claude Desktop's `ccd_sidebar.set_pinned` exists only in an attended Claude app
  session, is not exposed to OS1, and has no explicit order argument. Do not bypass
  that gate or edit Claude's live metadata/LevelDB to simulate acknowledgement.
- Verification: current 'synchronized' wording covers transcript reads, not pins.
  Track local presentation separately from native mutation confirmation.
- Cost/performance: bounded metadata polling and deterministic mutations require
  zero inference. Do not repeatedly parse full transcripts for pin refresh.
- Security: no global-state file writes, auth-cache copying, undocumented IPC
  impersonation, TCC changes, or permission bypass. Native mutation errors remain
  visible; unsupported Claude writes cannot be advertised as synchronized.

## Architecture / minimal patch

Native metadata → stable native IDs + authoritative pin order → inspector rows.
OS1 conversation ID ↔ exact linked native ID maps pin actions, shared local order,
and selection. Selection never changes rank. Unlinked native records remain native
records (never guess associations by title or create fake conversation histories).
OS1 explicit pin order persists independently of activity times. In the inspector,
local intents on linked records overlay native metadata while pending; show this
state honestly. Codex writes use its installed app-server protocol followed by
independent persisted-state readback. Claude native writes remain unavailable until
an authorized attended integration is exposed; OS1-local organization still works.

## Acceptance and rollback

Test pinned-first order, equal timestamps, idempotence, move-before, unpin, provider
ID separation, restart, exact native readback, unavailable backend and concurrent
selection changes. Verify native Codex ordering with existing records read-only and
a no-op mutation preserving their exact order. Verify Claude pin membership from
actual metadata; label unknown order explicitly. Compare transcript hashes before
and after. No successful Claude write or full two-way parity claim without proof.
Install only when the current app has no active run; preserve all sessions/drafts.
Retain the prior signed build; rollback executable/resources only, never old chat
data over current state.

Reference: https://learn.chatgpt.com/docs/app-server (retrieved 2026-09-06), plus
installed generated protocol schemas and native sidebar implementation. This is a
metadata synchronization repair, not an LLM-routing/reasoning algorithm change.

## Additional failure boundaries found during implementation

- Claude subagent JSONL files inherit their parent session ID. The old recursive
  reader presented those as duplicate conversations. Accept only canonical
  `projects/<project>/<UUID>.jsonl` conversations; deduplicate stable IDs.
- Search filtering must never become the persisted ordering model. Reorder the
  full unfiltered pin list and then apply the search view.
- A backend ID first recorded during execution inherits an existing OS1 pin.
  Repeated identity events are no-ops. Ambiguous many-to-one links must not select
  or change an arbitrary owner's conversation.
- Rapid pin-A, pin-B-before-A, move-A-before-B has a dependency on the first
  pin-A write. Serialize accepted mutations in order; suppress obsolete receipts,
  not required predecessor writes. Failed intents remain retryable after restart.
- An unsupported Claude-local intent cannot permanently suppress later
  authoritative Codex changes. Stale Claude metadata must not undo that intent.

## Verification before installation

- Native application self-test: 33 sidebar checks, including exact metadata
  schema, canonical identity, search/order isolation, late binding, external
  metadata reconciliation and unsupported-provider reporting.
- Asynchronous queue: 4 checks for rapid pin/move, unpin/repin, failed backend,
  and restart persistence. Isolated fake backend; no inference/live writes.
- Actual-reader audit: 10 checks passed. Codex's 13 pinned records match the
  authoritative section-position order. Claude has 5 unique pinned records;
  manual order is explicitly unknown. A no-op Codex write was independently
  read back with the entire native pin order and transcript hash preserved.
- Headless rendered inspector inspected: selected second pin stays second;
  pin markers, current-session marker, transcript and controls do not overlap.
- These checks do not prove physical drag gesture behavior, live Codex window
  repaint timing, or Claude native write/order support. In particular, full
  Claude two-way parity remains unimplemented because the required authorized
  integration is not exposed to OS1. No higher-privilege bypass was attempted.

## Installed result

Installed local version 0.9.25/build 75 with the prior signing requirement intact.
Installed-build audit: 13 checks passed. Installed sidebar/native no-op readback:
10 checks passed. Restart audit: 5 checks passed, all 42 existing conversations
and their messages/drafts/sources/links preserved. No extra execution on launch.
Both the application and the single Fleet agent are running. This does not
promote a public release or change remote routing/configuration.

Private evidence and prior executable are retained under
`~/.os1/recovery/sidebar-sync-20260906-build75/`. This records a verified partial
delivery, not full Claude interoperability or unrestricted governance authority.
