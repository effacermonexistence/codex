# OS1 build170: execution-result adoption repair

## Scope
Repair the verified-backend-response → remote verifier → OS1 delivery path.
Do not replay existing write/deploy/send jobs. Preserve queues, sessions, and local credentials.

## Observed defects and repair
1. A receipt-only acknowledgement could be correctly executed and persisted but rejected as a review shorter than 80 characters. Private v30 recognizes a closed, compositional acknowledgement contract. Unknown obligations retain the ordinary review gate; empty, nonzero, unpersisted, exact-response and actual-change checks remain active. This is not a global waiver of verification.
2. The public route wrapper and result evaluator could bind different private engines. Both now bind v30; a public regression test checks binding equality.
3. A real probe against v30 still failed. Local `sourceRoutingTask` consumed only “Do not edit files” from a compound prohibition, leaving “, send messages, deploy, or invoke tools” detached from negation. English normalization now requires a complete sentence boundary; unsupported compound clauses remain intact. The executor's original prompt remains preserved.

## Executed regression evidence
- Private receipt contract: 7 tests pass (English/Korean output lengths, both review profiles, unknown obligations, real mutation, unsuccessful execution, exact contract, legacy policy).
- Disabling the receipt-contract branch causes that suite to fail.
- Extracted production Swift projection passes; restoring the old partial-match regex causes its assertion to fail.
- CLI self-test adds six compound/conditional English cases (including a filename with an extension), with and without source, while retaining existing single-clause and Korean tests.
- Result evaluator: 3 tests and TypeScript check pass.
- Public routing: 15 tests, 4 workerd integration checks, and TypeScript check pass.
- `swift test` has no test target in this executable package; canonical CLI/app self-tests are used instead.
- First packaging attempt correctly refused mismatched app170/CLI169 identities; the CLI release string is updated to170 before rebuilding.

## Remote deployment identities
- Private v30: 4a0f4882-d41f-42b7-bd27-6d279f9e183b
- Route wrapper: 9a647083-a515-47e4-a88d-23bb796371cf
- Result evaluator: 3e3c3e10-d96a-4fb0-95e1-5103e5cf0377
- Public policy bundle SHA-256: 439efb7e4fedb1261680c7c72632daef7eb1fe5ec5e8d5546f27d0f861dabdeb (R2 readback matched).
- Private source archive SHA-256: 0f7aa68babed7cae38b967ccb78399236a826e4043246896d321dde015d8fc5c (private R2 readback matched; source not included in this repository).

## Repair method
External execution receipts and deterministic checks, not self-critique, decide adoption. The inspected research on intrinsic self-correction limitations (https://arxiv.org/abs/2310.01798) motivated this evidence boundary, not a claim that the paper proves this implementation.

## Completion evidence
- build170 / 0.9.104 universal release built, signed, and installed; app and CLI identities match.
- Package SHA-256: c1ba4d585cb75f942209eaf0d0bcefa8faa8ec0184cce542dce2f9af4761d0c9.
- Rollback-capable installation receipt: ~/.os1/recovery/self-update-build170-2026-09-19T231415Z/install-receipt.json. Nine checks PASS, sessions 98 → 98, signer unchanged, queues preserved. Installed app re-opened; Fleet resumed.
- Fresh installed-CLI → actual Codex → native session persistence → remote verification → final delivery completed with one adopted result, exit 0. Native session: 01a0bbf3-88a8-72e0-9751-cc36a339b2b0. Recorded backend duration: 6663ms.
- Execution outbox: 7dc5ce2f-8885-4c2d-b905-42d87d379d21-1.json; remote response status `complete`. The pre-verification step retains `verification_pending` by design; final status comes from the returned response, not that earlier snapshot.
- The probe requested no edits, tools, deployment, or messaging. No existing failed mutation was automatically replayed.
- This verifies the observed false-rejection path, not every possible future task or a UI screenshot assertion. Private signed outbox payloads and credentials are excluded from publication.
