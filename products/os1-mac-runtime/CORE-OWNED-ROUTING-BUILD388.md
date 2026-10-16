# Core-owned routing: measured follow-up, build388

## Executed evidence, not a completed-product claim

Build387 was installed with all 14 installer checks passing. Sessions263,
messages3974 and failure-held UI queue7 were preserved; private paging backup
and restore drill preserved19470 files/168922902bytes. The old dead owner was
restored through installed386's health-only startup after checking every Core
parent terminal, then retired by the normal native quiescence receipt. No
pending user task was replayed.

The real smoke found two problems that fixtures alone did not establish:

1. A new model-assisted intent task entered the same Core task, but its30s
   bound expired before output. Ollama measured5.30s model load,17.44s prefill
   (4914 tokens), and only67 generated tokens before cancellation. No worker
   dispatched; original request remains held.
2. A grammar-recognized local-only `1+1` request returned `2` in actual OS1 UI,
   and the real tree displayed coordinator plus one local worker. However its
   unnecessary planner call took about70s:11508 input/212 output tokens;
   Ollama prefill51.74s plus generation16.92s. The worker itself used61 input/
   2 output tokens and0.778s. The extra conversation/handoff context was real,
   not a verified duplicate of owner policy; it was not removed.

Private task/evidence pointers:
- intent timeout: `bc7f84e4-cd0e-41aa-a2e9-96c2dcb2451a`
- grammar/UI test: `50b31a48-b1f7-4ce1-91f5-8e65682c89ae`
- `~/.os1/evaluations/routing-order-20261016/core387-actual-observations.json`

## Small repair

- Keep the complete bound owner policy and every recipient/source/permission
  gate. The intent allowance becomes60s, still capped by remaining task time.
- A source-admitted, read-only, tiered explicit-route diagnostic whose payloads
  all exactly match the existing arithmetic verifier needs no model to choose
  its already-fixed DAG. A pure function creates the same agent nodes; all
  requested workers still execute. Existing host model/effort/quota/permission
  binding, reservations, cancellation and receipt/task verification remain.
- Non-exact/free-text/writing/material-bearing/unbound/legacy requests abstain
  from that optimization and keep the existing planner path.
- The policy hash check still runs before either planning path. Skipping a
  model call does not skip policy admission.

No9B promotion, policy truncation, blind provider retry, hidden quota downgrade,
new coordinator, invented worker or ChatGPT routing is introduced.

## Public-package scan follow-up

CI387 failed on three exact Swift compiler-type fingerprints. Local binaries
contained those same publicly demangled types in `__objc_classname`, whereas
CI's entropy pass reported them through its CString path. Their immutable
public source/type/hash provenance is recorded in the scan policy. Only those
three exact hashes are admitted; thresholds, canonical scanner, sections,
forbidden paths and unknown-token detection are unchanged. Mutation/canary
regressions remain mandatory. Local zero findings was not CI parity evidence.

## Remaining gates

Source tests, universal release, new installation and actual model/UI trials
must be recorded from their executed receipts. This document does not claim
those results in advance. Public/flagship quality parity is not established by
arithmetic smoke. OhMyBug submission was blocked by payment_required($0); no
review ID/attestation or merge approval exists.
