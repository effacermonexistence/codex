# Build 312 — native delegation startup and adoption

Continuation of build311. The cached native read result was rejected because the bounded Korean prohibited list `파일 변경·웹·브라우저·구매·외부 전송·서브에이전트 금지` leaked the mutation word into both scope classifiers. Source-locked RCC v56 reproduced `workspace_write / executed_change / REQUESTED_CHANGE_NOT_OBSERVED` for unchanged correct output. v57 consumes the whole prohibited list and records `read_only / executed_review / REVIEW_EXECUTION_RECORDED`. Positive edits outside a prohibited list still need actual change; nonzero/empty/unverified/refused/wrong-exact responses still fail.

- Swift parser: bounded action vocabulary, shared final negation, singleton/list variants and separators, preserved native prohibitions.
- Private v57 policy: corresponding parser repair; exact source-locked v56 and prior adapters remain available byte-identically for issued routes.
- Private worker: source-derived policy identities with lazy legacy loading. Avoid eagerly importing 38 old adapters for a current route. Full prior worker harness 140/140.
- Route core: cache only already hash-verified immutable policy content per R2 binding/hash, bounded eight entries, independent returned clones, no failed acquisition cache, size/config/namespace checks retained.
- Owner policy: live bulk ID/date reads plus ID-list race guard instead of lazy per-note property calls. Existing source/hash/tie/concurrent-capture checks retained. No stale policy TTL or credential cache introduced.

Known test-contract correction: the two older public private-adapter tests already failed against deployed v56. They conflated execution receipt `pass` with semantic source truth. Their stated invariants now check the specific `EXACT_RESPONSE_VERIFIED` / `RECEIPT_EXECUTION_RECORDED` reason rather than misclassifying unrelated review-execution receipts. The verifier was not altered for those cases; original baseline logs are preserved privately.

Private source was acquired from R2 archive e2b281f2e206f2b05e2f3ebb55d86610c40d668b2bdfb8f49051f2d7cd32eb94. v57 bundle e11806fbf3d13d8935f8609bbb0a2a5c57dea0392b8aa50d2de9678536f71dac uses the same execution profiles/contracts. Public repo contains tests, loader, pin and this provenance, not private RCC source or credentials.

A preliminary rollout omitted a prior capability identity; it was immediately rolled back to the confirmed v56 deployment before completing the full compatibility map and 140-case worker harness. Final runtime/version/backup/timing/GUI adoption receipts are separate; do not infer successful deployment or subsecond startup merely from this document.

Method: cached failed output -> deterministic classifier/verifier reproduction -> smallest source-specific repair -> counterexamples and old-policy compatibility -> deployment/GUI/runtime observation. Research inspected: ReAct (https://arxiv.org/abs/2210.03629), intrinsic-self-correction limits (https://arxiv.org/abs/2310.01798), abstract scope; native streaming protocol https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server. No model call merely to pad an existing answer.

## Installed build312 live observation

Both actual Codex and Auto-selected Claude executions reached remote `complete`, GUI `REVAS adopted` and verified native persistence in one provider attempt. Each OS-1 output matched its actual native final. Claude's own final included explanation after the marker; this is output-preservation evidence, not exact-marker-only semantic proof. Actual source-to-AppKit-draw maximums were 58.003 ms (Codex) and 52.970 ms (Claude). Native-final publication delta was 1 ms and 0 ms respectively. Existing 209 baseline sessions survived; the installed runtime retained 210 sessions. Existing queued work was not replayed.

Predispatch took 2549 ms (Codex) and 2098 ms (Auto/Claude), separately from provider work and relay/render. Those measurements do not meet a global 1000 ms startup target. No auth, source freshness, lease, permissions or final-adoption gate was removed to manufacture a subsecond result.

## Server-only capability roundtrip repair

The private capability endpoint previously fetched the same pinned adapter response twice to check feedback and model metadata. It now obtains both from one fresh validated response and seeds only the existing 60-second per-binding/per-policy learning-schema cache. Capability checks themselves remain fresh; failure is not cached. Actual route/model validation remains independent and mandatory. No runtime rebuild or new policy identity is needed for this transport-only repair. Added call-count, expiry, old-schema, wrong-policy, expanded-response, failed-probe and binding-isolation regressions; TypeScript check, 38 unit tests and 6/6 workerd integration checks pass. Deployment and post-change timings require separate runtime receipts.
