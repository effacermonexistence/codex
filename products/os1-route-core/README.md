# OS-1 Route Gateway security boundary

This package is the public server gateway for the OS-1 step-ticket protocol. It
does **not** contain RCC/REVAS routing prompts, weights, thresholds, evaluation
rubrics, datasets, or policy logic.

The gateway accepts an authenticated user task, sends it to a separately
deployed private route service as explicitly untrusted data, and emits either:

- one Ed25519-signed eight-field execution ticket; or
- `{ "status": "complete" }`.

All failures use one opaque fixed-shape body. Extra fields from internal
services are rejected rather than silently removed.

Auto routing also accepts a coarse `capacity_plan` for the two installed
backends. The private route core combines that user preference with a rolling
seven-day per-principal usage ledger and protected specialist rules. Counts,
weights, rule matches, and rationale never cross the private service boundary;
the client still receives only the signed eight-field ticket.

The same private decision assigns an execution tier through the ticket's
existing `action` field. A current Mac runtime maps that tier to the configured
Codex or Claude model locally: normal turns preserve the account default,
capacity-relieved turns use an efficient profile, and protected specialist
rules use a deep profile. Concrete model aliases are deployment configuration;
rule terms, weights, match state, and reasoning remain private.

## Required private service bindings

| Binding | Required response |
| --- | --- |
| `AUTH_SERVICE` | `{ subject, device_id }` |
| `DEVICE_REGISTRY` | `{ subject, device_id, p256_public_jwk }` |
| `PRIVATE_ROUTE_CORE` | `{ status: "complete" }` or the minimal step decision |
| `RESULT_EVALUATOR` | `{ outcome, verified_artifact_hash }` |

The private route core, device registry, authentication service, and result
evaluator are separate internal Workers. The protected policy is stored only in
a Cloudflare secret; it is not present in the public repository, gateway
bundle, Mac application, package, or result artifact. The evaluator fetches the
artifact from private R2 storage and independently verifies its hash and
outcome. A client-provided success/fail claim is never accepted as a routing
input.

## Local verification

```bash
pnpm install --frozen-lockfile
pnpm --dir products/os1-route-core types
pnpm --dir products/os1-route-core check
pnpm --dir products/os1-route-core test
pnpm --dir products/os1-route-core deploy:dry-run
```

Real keys and protected canary fragments belong in Cloudflare secrets. Copy
`.dev.vars.example` to an ignored `.dev.vars` only for local development; never
commit it.

The deployed functional release candidate includes a universal Mac Runtime,
Secure Enclave device signing, private services, R2 artifact storage, a public
SHA-256-pinned package, and deployed red-team smoke tests. Developer ID package
signing and Apple notarization remain release-distribution work; the shell
installer is currently the supported installation path. See
[`docs/os1-route-core-security-handoff.md`](../../docs/os1-route-core-security-handoff.md).
