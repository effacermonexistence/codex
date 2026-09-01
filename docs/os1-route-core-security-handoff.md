# OS-1 route-core security engineering handoff

## Status

**FUNCTIONAL RELEASE CANDIDATE — deployed end to end; Developer ID signing and Apple notarization remain pending.**

This branch implements and deploys the public gateway, four private services,
private R2 result storage, universal Mac Runtime, GUI application, package
builder, public release download, and one-command installer. It does not claim
that OS-1 is unhackable or that black-box behavioral extraction is eliminated.

## Implemented architecture

```text
Universal Mac Runtime (Apple Silicon + Intel)
  │ authenticated task / signed result binding
  ▼
OS-1 Route Gateway (this package)
  ├── AUTH_SERVICE              identity + device binding
  ├── DEVICE_REGISTRY           registered P-256 public key
  ├── PRIVATE_ROUTE_CORE        private RCC/REVAS decision service
  ├── RESULT_EVALUATOR          independent artifact verification
  └── EXECUTIONS Durable Object nonce/sequence/result state
```

Production resources:

- gateway: `os1-route-gateway`;
- internal Workers: `os1-auth-service`, `os1-device-registry`,
  `os1-private-route-core`, and `os1-result-evaluator`;
- private artifacts: `os1-private-results`;
- public signed-hash release objects: `os1-public-releases`.

The gateway never receives internal reasoning from the private route service.
Its strict parser accepts only `status` or the minimal
`provider/action/permission_profile` decision. Any extra field fails closed.
The response builder accepts only an eight-field ticket or a complete marker.

### Cryptographic split

- Server tickets use Ed25519. Only the server private key signs; clients embed
  a public verification key.
- Result reports are signed by the device P-256 key. The signed bytes bind
  `execution_id`, `sequence`, `nonce`, `result_hash`, and `artifact_ref`.
- No symmetric signing secret is shipped to the client.
- Device signatures prove possession of the registered device key, not that a
  rooted client executed honestly. Independent server-side artifact evaluation
  is therefore mandatory.

### Result trust flow

1. Verify the server ticket signature and expiry.
2. Verify the authenticated device and its P-256 result signature.
3. Atomically claim the ticket nonce and sequence in a per-execution Durable
   Object.
4. Ask `RESULT_EVALUATOR` to fetch and verify the private artifact.
5. Compare the evaluator's verified hash with the client-bound hash using a
   timing-safe comparison.
6. Pass only the evaluator's bounded outcome to `PRIVATE_ROUTE_CORE`.
7. Persist the next ticket or completion response before returning it. An
   identical retry after finalization receives the exact stored response; a
   concurrent duplicate or changed replay fails.

## Red-team acceptance mapping

| Requirement | Implemented evidence | Remaining release blocker |
| --- | --- | --- |
| P1-1 delivery hygiene / T1 | Runtime delivers only the user's task to the selected local agent; the gateway emits only the eight ticket fields; the protected canary denylist is a secret. | Retain packet/process-capture evidence per production release. |
| P1-2 injection isolation / T4 | User content is explicitly untrusted data; private decisions and public egress use exact schemas. A deployed hidden-prompt exfiltration probe returned only the ticket schema. | Continue the injection corpus as policies evolve. |
| P1-3 opaque egress / T3 | One 197-byte fixed-shape error; bounded JSON; logs contain only event class/request ID. Nine deployed malformed/auth cases passed. | Success response size and latency normalization remain P2 work. |
| P1-4 result integrity / T5 | Secure Enclave P-256 signing, Ed25519 tickets, private R2 artifacts, independent evaluator, timing-safe hashes, and atomic nonce/sequence state are deployed. | A rooted owner can still fabricate client-observed output; cryptographic possession is not proof of honest execution. This is a documented structural residual risk. |
| P1-5 build hygiene / T7 | Universal app/CLI and package build passed exact-content and Mach-O cstring entropy scanning with zero findings. CI rebuilds both architectures and repeats the gate. | Developer ID signing/notarization awaits an Apple distribution identity. |
| P2-1 device binding | Secure Enclave non-extractable P-256 key on supported Macs; Keychain fallback on older Intel hardware; immutable device registry. | Apple attestation validation, user-visible device revocation, and DPoP/mTLS. |
| P2-2 asymmetric tickets | Deployed Ed25519 PKCS#8/SPKI split; only the raw public key is in the client config. | Rotation with overlapping public keys. |
| P2-3 atomic result submission | Deployed SQLite Durable Objects enforce sequence, nonce, result hash, and one stored response; live E2E passed. | Add sustained concurrency/load evidence. |
| P2-4 extraction resistance | None claimed. | Account/global budgets, distributed/Sybil detection, cost-bound identity and measured extraction-query threshold. |
| P2-5 side-channel normalization | Fixed error status/body and no diagnostic headers. | Success payload bucketing and measured response-time/size normalization. |

## Automated and live evidence in this branch

The test suite currently covers:

- strict request and internal service schemas;
- rejection of route-core over-disclosure;
- Ed25519 ticket tamper detection;
- bounded streaming JSON input without trusting `Content-Length`;
- one opaque fixed-shape error response;
- delivery canary failure behavior;
- nonce replay with altered result content;
- rejection of concurrent duplicates and cross-device stored-response replay;
- idempotent return of the stored next-step response after finalization; and
- release artifact scanning without echoing protected fragments.

CI regenerates bindings and type-checks/dry-bundles all five Workers. A macOS
job builds both architectures, creates the application and package, validates
code signatures and payloads, and runs the artifact scanner.

The live acceptance run completed this sequence on 2026-08-31:

1. generated and registered a Secure Enclave P-256 device key;
2. received and verified an Ed25519 server ticket;
3. executed Codex in a temporary Git workspace;
4. created and verified the requested file content;
5. uploaded the signed artifact to private R2;
6. completed server evaluation and atomic finalization; and
7. downloaded the public package and matched its manifest SHA-256 exactly.

## Private service contracts

### `PRIVATE_ROUTE_CORE`

The service must keep all RCC/REVAS material internally and return one of:

```json
{ "status": "complete" }
```

```json
{
  "status": "step",
  "provider": "codex",
  "action": "agent_run",
  "permission_profile": "workspace_write"
}
```

`action` is allowlisted to `agent_run`, `agent_run_efficient`, or
`agent_run_deep`. These are execution tiers carried inside the same eight-field
ticket, not extra rationale. The Mac runtime maps the selected tier to a
provider-specific model and reasoning-effort profile (`low`, `medium`, or
`xhigh`) while the private rule match, capacity ledger, weights, and decision
reason remain server-only.

Reasoning, scores, candidates, policy identifiers, thresholds, prompts,
versions, and future steps are prohibited. The gateway rejects rather than
redacts an over-broad response so a regression cannot become a silent leak.

### `RESULT_EVALUATOR`

The evaluator receives an R2 reference and expected SHA-256 hash, fetches the
artifact itself, and returns only a bounded outcome and its independently
verified hash. It must never accept a client `success` boolean or a client score
as authoritative.

## Client artifact gate

Run the gate only with explicit release paths:

```bash
pnpm --dir products/os1-route-core scan:client -- \
  /absolute/path/to/OS-1.app \
  /absolute/path/to/OS-1-update.pkg
```

High-entropy allowlisting uses SHA-256 fingerprints so an allowlist does not
need to contain a token verbatim. The allowlist must cover only intentionally
public material such as the ticket verification public key. Scanner findings
report fingerprints and offsets, never the matched protected string.

For a release, point `OS1_CLIENT_SCAN_POLICY_PATH` at a separately controlled
policy containing real protected prompt fingerprints and constants. Do not
commit that private policy to this repository.

## Release decision

The shell installation path is functional now. Finder double-click distribution
must not be described as production-signed until a Developer ID Installer and
Developer ID Application identity are used and the package is notarized and
stapled. Behavioral surrogate routing, client-output fabrication on an
owner-controlled Mac, and decision-boundary approximation remain structural
residual risks and must be measured and documented rather than marked resolved.
