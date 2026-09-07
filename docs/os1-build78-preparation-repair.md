# OS1 build78: preparation, source identity and execution custody

## Incident and objective

2026-09-07, build77, conversation `2F9CB529-FEEB-4596-BF41-7732157EFAEB`:
`인스타그램 오토메이션 좀 손보자` became `other/read_only`, project
`workspace:lua`, zero attached sources. Codex medium, quota-exhausted Claude,
then Codex high consumed 313 seconds without preparing the operating source.
Both Codex native turns completed, but the provisional receipt said the native
execution record was unverified. No production edits are authorized by this fix.

## Failure boundaries and minimal architecture

Request → preparation intent + project → read-only live release identity →
matching immutable GitHub custody record → hash-checked R2 source → OS1-owned
context → concrete authorized edit/analysis → backend → separate native record
and objective-adoption statuses.

- Intent: recognize Korean `손보자/손봐` variants and negations. A bare work
  request prepares materials, never invents a behavior change or deploys.
- Context: main remains the source for project/recovery discovery. If production
  is ahead of main, inspect only upstream refs matching the observed release
  version; require release ID, manifest hash and content fingerprint agreement.
  Never pick the highest branch version, a public mirror, or a recovery Gold.
- Execution: keep issued tickets and user prohibitions intact. A concrete edit
  requests write scope before dispatch; a scope mismatch is not fixed by
  spending another model call. Quota-exhausted providers are excluded from all
  recovery selectors within that run.
- Verification/UI: native persistence and answer adoption are independent.
  Preserved rejected output remains provisional; independently checked native
  record information must not be erased by the rejection.
- Cost/latency: bare preparation makes zero model calls. A source/capability
  mismatch is reconciled before retry, not sent unchanged to a larger model.
- Safety: no SCV production writes, resets, customer snapshots, auth copies,
  permission bypass, Gold changes, or backend window activation.

## Alternatives and invariants

Do not just add `손보자` to a write-word list: no specific change is described.
Do not promote v159 records into main or change the recovery pointer to fix a
client-side selection bug. Do not turn verification off or treat exit 0 as
objective completion. Preserve existing sessions and native bindings.

## Acceptance and rollback

1. Exact NFC/NFD request and paraphrases produce local preparation, project
   `scv-instagram`, a verified source and useful next step; model calls = 0.
2. Live release, source archive descriptor, content fingerprint and manifest
   agree; mismatch/missing/ambiguous sources fail before model execution.
3. Negations, quoted examples, explanation-only and mixed edit/no-deploy scope
   retain their boundaries. Context survives follow-up and backend handoff.
4. A saved native-completed/rejected answer displays both facts, including
   model/effort; missing/tampered native output is not marked verified.
5. Quota → alternate → capability failure cannot route back to exhausted
   provider or repeat the identical mis-scoped execution.
6. Runtime/app tests, universal package, installed-build incident and state
   preservation checks pass. Same local signer, recoverable binary replacement.

Rollback: retain build77 app/CLI and session snapshot in a new private recovery
directory. Restore binaries only; never overwrite newer conversation state.

## Evidence methods

[Codex App Server](https://learn.chatgpt.com/docs/app-server) defines completed
turn status separately from tool effects and permission policy. This repair
uses actual native records and source hashes, not a model assertion of success.
[Huang et al.](https://arxiv.org/abs/2310.01798) motivates external feedback
instead of unchanged self-correction loops; no claim of implementing a trained
research method or universally optimal routing is made.
R2 acquisition uses the pinned official Wrangler remote-object command, per
[Cloudflare documentation](https://developers.cloudflare.com/workers/wrangler/commands/r2/).

## Verified local closeout, 2026-09-07

- Installed 0.9.27/build78, universal arm64+x86_64. Same designated signing
  requirement as build77. Package payload scan: 22 files, no findings.
- Exact installed incident: 17,515 ms, one local source-acquisition operation,
  zero model calls; decomposed Unicode variant: 16,719 ms, zero model calls.
- Source identity: operating v159; upstream custody commit
  cfd8d5770fe3086083e6d8292dae6860e81752cb; R2 archive SHA-256
  b142a094884d7e0e5a717927cbc63c7052cd13b5259fdd9c73353cae52a7ec2f;
  manifest SHA-256 d276dbb540ff1414159df423013eb8e34296f0bad43f0fb52435dea3e5568493.
- Installed acquisition/continuity/rendering: 32 checks passed, no failures.
  Installed app/runtime/parallel/native record/state checks: 13 passed.
  Runtime, context (13 groups), hook (8 groups), retrieval and Fleet tests pass.
- Two real read-only Codex follow-ups: both one-step adopted, same native
  session and source digest, public progress present, no backend reveal.
  Answers correctly distinguish v159, Node20.20.2, observed readiness and v151
  recovery baseline. Claude live execution was not exercised in this run;
  quota/recovery exclusion was checked with deterministic negative controls.
- Original incident receipt was rendered from the installed binary. Native
  answer readback is verified, objective remains unadopted; no chat bytes are
  rewritten. Receipt copy and display agree, overlap count zero.
- All 45 existing conversations/messages/pins/drafts/native bindings retained;
  previous app/CLI and installer evidence kept in the private local recovery
  directory. SCV production, customer data, Gold, accounts and permissions were
  not changed. This is a local repair, not a public website/release rollout or
  a claim of globally optimal routing.
