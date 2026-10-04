# Build313 — verified startup transport and warm execution ledgers

Goal: reduce actual GUI submission-to-native dispatch overhead while preserving fresh owner policy, authenticated identity, signed ticket/lease, current inventory and final adoption. Backend inference duration is separate. No global constant network/Notes latency claim.

Measured prior private route:901ms, including owner-budget469ms and newly created per-execution route object315ms; algorithm-only local measurement is not a remote latency claim. Thin hot-path changes:

- Critical startup request1: old strict parsers reject it; no reduced-field downgrade. Server verifies source-bound feedback/model support before returning a signedv2 ACK. ACK binds actual model/effort and executor contractSHA. Separate client capabilityGET is removed, not its gate. Positive server capability metadata is scoped to binding+policy, max60s; failure/backward-clock/policy change cannot grant acceptance. Actual route's policy/model checks still run.
- New warm RoutePoolState and ExecutionPoolState, fixed startup-v1 name, permanent execution-ID-keyed rows and explicit-ID RPCs. All legacy objects and data remain untouched. Cross-ID/identity, concurrent claims, lease expiry, token fencing, retry and replay tests retained. No dynamic per-execution tables or quota/authorization bypass.
- Codex metadata uses a bounded fixed-whitelist batch with a single response collector, not concurrent calls to an unsafe reader. Claude unpaid auth+empty-tools initialization overlap; both gates remain mandatory. Native tool/execution setup remains request-scoped.
- GUI submission timestamp is carried to runtime diagnostics, so native history ingestion and process launch are included rather than hidden before the timer.

Rejected optimizations: Notes full-properties query was slower; DB/date-only hybrid lacked a fresh API identity witness; packed getd is unsupported. The live ID/date/ID Notes index, hash/tie/capture-race checks remain authoritative. No policy text, credential, Handy, billing, purchase or Railway/DNS changes.

Protocol regressions: v1 bytes unchanged; v2 field stripping/tampering/schema/model/contract mismatch fail closed before provider/R2 writes. Public125 unit + legacy23 SQLite + pool47 checks; private61 unit +12 SQLite groups; native CLI startup16 and metadata43 checks. Installation and measured runtime outcomes are separate receipts, not inferred from these tests.

Repair method uses actual state -> hypothesis -> reversible change -> deterministic and runtime verification, not fluent self-correction. Sources inspected: ReAct https://arxiv.org/abs/2210.03629 and intrinsic self-correction limitations https://arxiv.org/abs/2310.01798 (abstract scope), native protocol https://learn.chatgpt.com/docs/app-server. No inference call merely for optional presentation repair.
