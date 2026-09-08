# OS1 automatic approval review — build 87

## Objective and observed boundary

For eligible Codex backend actions, route approval prompts to Codex automatic
review instead of repeatedly interrupting the OS1 user. Preserve the assigned
`read_only` or `workspace_write` sandbox and never convert automatic review into
blanket consent or a provider-safety bypass.

The correlated Instagram recovery incident did not stop on a user approval. It
ended after an ad-hoc remote recovery sequence involving secret recovery,
chroot/runtime reconstruction and a custom no-egress executable. The provider
returned `misalignment_policy_violation`. OS1 build86 correctly classifies that
terminal event, but its Codex protocol parameters combine
`approvalPolicy=never` with `approvalsReviewer=auto_review`. Official OpenAI
documentation says automatic review applies to interactive approval policies;
with `never`, there is nothing for the reviewer to review.

## Five-view audit

| View | Divergence | Acceptance check |
| --- | --- | --- |
| User experience | `never` disables automatic review despite the reviewer field | Thread and turn wire parameters use `on-request` and `auto_review` |
| Intent/completion | Repeated consent must not replace completion | Ordinary authorized work proceeds inside the signed ticket scope |
| Capability | Broad recovery probes can look unrelated to the stated Instagram edit | Executor prefers existing reviewed operator scripts and least-privilege checks |
| Verification | A residual approval request could be mistaken for permission | OS1 still rejects unresolved client-bound approvals; no unconditional accept |
| Cost/latency | Safety failures and retries waste model calls | Safety denial remains terminal and cannot switch provider as a bypass |
| Security | A model choice must not widen filesystem/network authority | Existing sandbox profile, roots, auth and managed requirements are unchanged |

## Minimal architecture

```text
OS1 signed execution ticket
  -> read_only or workspace_write sandbox
  -> approvalPolicy=on-request
  -> approvalsReviewer=auto_review
       -> eligible action accepted: execution continues
       -> reviewer denial: safe alternative or one accurate terminal notice
       -> provider safety enforcement: terminal safety_blocked, no bypass
       -> human-only/auth/OS boundary: remains explicit
```

This change does not auto-accept client approval RPCs. If the app-server still
sends an approval request to OS1 after automatic review, the non-interactive
client rejects it and records the exact turn. That fallback prevents a protocol
failure from becoming implied consent.

## Implementation and verification

- Define the Codex approval policy and reviewer once in `OS1Context` and use the
  same values for thread start/resume and turn start.
- Tell both backends to use reviewed repository operator paths for recovery and
  production work instead of inventing credential export, sandbox, chroot,
  network-control or safety-control mechanisms merely as proof.
- Update deterministic stdio protocol fixtures to assert the new wire pair and
  the unchanged rejection fallback.
- Keep the build86 safety-denial tests: a real denial remains typed, terminal,
  non-retriable and distinct from a successful answer quoting an error.
- Re-run runtime, context, queue, steering and installed-artifact checks; preserve
  sessions and the build86 recovery package before installing build87.

Verified on the installed build87 artifact:

- both arm64 and x86_64 slices built and the stable local signing requirement
  was preserved;
- release self-tests passed for runtime, app, queue, parallel execution,
  queue/fork, composer, live steering, context, hooks, retrieval and Fleet;
- the package scan examined 22 files and found no embedded secret material;
- the rollback-aware installer preserved all 55 conversations and their
  messages, pins, drafts and Codex/Claude native bindings;
- the post-install audit passed 14 of 14 checks with zero model calls and no
  session-store byte changes.

Rollback is the existing build86 recovery package. Session files, credentials
and OS trust databases are never rolled back or copied.

## Claim boundary

This repairs automatic approval routing and removes one avoidable source of
provider-safety false positives. It cannot disable OpenAI safety enforcement,
guarantee that every future task is accepted, or authorize credentials, account
changes, customer-state mutation or operating-system controls that the signed
task did not authorize.

Official references:

- https://learn.chatgpt.com/docs/sandboxing/auto-review
- https://developers.openai.com/api/docs/models/gpt-daybreak-blue-latest
