# OS1 body / Fleet integration contract

## Scope and acceptance

Integrate the existing public Fleet 0.9.5 body into local OS1 0.9.20 build 68.
Preserve the RCC authority, current completion/focus repairs, user sessions,
credentials and working EXO services. Do not copy private routing code into the
client. Do not change SCV production, billing or access permissions.

The main `os1` must provide Fleet submit/wait/snapshot/agent and both native
UserPromptSubmit hooks, optional local EXO inference and idempotent installers.
Completion requires staged tests, installed checks, Air native execution for
both provider hooks, real two-node EXO inference, source publication and checked
R2 release/recovery metadata. Topology alone is not inference evidence.

## Failure boundaries and architecture

`native hook -> durable submit intent -> signed Fleet assignment -> selected
device -> existing RCC runTask -> verified result outbox -> Fleet receipt ->
foreground result adoption`

1. Intent/completion: old Fleet manufactured unsigned tickets and hardcoded
   Sonnet/medium or Luna/low. Replace only that adapter with existing `runTask`;
   retain explicit provider choice and all current verifier/capability gates.
2. Source/context: remote work requires a clean, reachable immutable Git
   revision. Validate GitHub identity, actual revision and symlink-resolved
   workspace containment. Never transfer credentials or silently discard dirt.
3. Execution: keep heartbeat separate from long work, keep a claimed-job lease,
   and persist completed output before network delivery. No replay may re-run a
   backend or fabricate completion. Internal provider execution bypasses hooks.
4. Verification: verify returned job/result identity and byte digest. Use durable
   server receipts for same-nonce submit replay and identical result completion.
   Unknown delivery is not a no-capacity result and cannot authorize local
   duplicate work. No global exactly-once side-effect guarantee is claimed.
5. Cost/latency: device placement is separate from model/effort selection. Reuse
   existing measured retry-inclusive RCC logic; do not add model calls to repair
   transport. Test deterministic invariants before bounded live provider probes.
6. Security/UX: background operation never activates backend apps. Preserve
   unrelated sibling hooks, per-device OAuth and native hook trust. Never edit a
   trust store to bypass approval. Public release excludes private router code.

Alternative rejected: wrapper dispatch to old `os1-fleet` would retain fake
tickets and two divergent executors. Rewriting private policy is unnecessary.

## Safe migration and rollback

Add durable submission receipts without deleting old nonces/jobs; old clients
remain compatible and ambiguous legacy requests fail closed. A replay with a
different objective is rejected. Keep completed result outbox entries until
server adoption. Capture local binary/config/hook/LaunchAgent and conversation
state before cutover, without copying auth caches. Stage build and fixtures
before idle cutover. Preserve sidecar executable for rollback until both Macs
pass. Restore only exact prior binaries/config/hooks if acceptance fails.

## Evidence policy

Record PASS/FAIL/UNKNOWN per named check, exact build/hashes/job/native IDs,
before/after state and all failed attempts. No passing check offsets another
hard failure. Hosted Codex/Claude inference is not pooled across Macs; explicit
EXO inference is a separate two-node local model lane. Native hook trust and
per-device login remain real OS/provider security boundaries.
