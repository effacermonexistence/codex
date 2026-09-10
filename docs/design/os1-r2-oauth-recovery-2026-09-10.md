# OS1 R2 OAuth recovery repair

## Objective and acceptance

The installed OS1 must execute the exact Korean request `야 알투 연결시켜`
as a bounded local control operation, verify the real `omar-private-archive`
bucket through the repository-pinned Wrangler, and return a verified local
receipt. If the saved Wrangler OAuth grant is absent or expired, OS1 may open
one official OAuth flow and must retry the same probe after authorization. It
must not dispatch a model, invent a connection result, expose credentials, or
replace a transport/permission failure with a login flow.

Acceptance checks are non-compensating:

1. The observed Wrangler 4.127.1 non-interactive authentication diagnostic is
   classified as `authentication`.
2. DNS, timeout, 403, and unknown-output fixtures retain their existing
   transport/permission/unavailable classifications.
3. The pinned Wrangler returns bucket `omar-private-archive` from the user's
   home directory after OAuth.
4. The built runtime processes the exact request with zero model calls and a
   persisted connection-check receipt.
5. The installed app repeats the exact request successfully after a cold
   restart while preserving all session bytes outside the new result.

## Evidence and five-view audit

- Intent/completion: the app returned an error instead of a verified R2
  connection, so the task failed.
- Context/provenance: session `C4601731-27C3-47E1-B48E-C3231DAB6411`
  preserved the exact request and marked the run `preflightOnly`; no context or
  model handoff caused the failure.
- Capability/execution: pinned Wrangler 4.127.1 exited 1 under OS1-style
  non-interactive execution and required `CLOUDFLARE_API_TOKEN`; the same OAuth
  flow subsequently authorized and the non-interactive bucket probe returned
  the correct bucket.
- Output/verification: `ConnectionFailure.classify` did not recognize that
  Wrangler diagnostic, so it emitted `.unavailable`, preventing the existing
  authenticated recovery branch from running.
- Cost/latency: the failure used no model tokens but forced a repeat user turn;
  the repair stays deterministic and performs at most one serialized OAuth
  flow followed by one verification probe.
- Security/UX: credentials remain owned by Wrangler/keychain; only the exact
  authentication diagnostic may trigger OAuth. Permission and transport
  failures remain non-login errors.

## Failure boundary and minimal architecture

```text
OS1 request recognizer
  -> pinned Wrangler bucket probe
  -> stderr classifier  [BROKEN: auth diagnostic became unavailable]
  -> serialized official OAuth (authentication only)
  -> same bucket probe
  -> local receipt
  -> OS1 conversation
```

The minimal repair adds the exact current Wrangler non-interactive token
diagnostic to the authentication classifier and an executable regression
fixture. The probe, lease, OAuth command, bucket-name verification, routing,
and receipt format remain unchanged.

## Rollback

Restore the pre-install app/CLI recovery point and revert the classifier/test
commit. No R2 objects, repository permissions, account identities, or user
session history are changed by this patch.
