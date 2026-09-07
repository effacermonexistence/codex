# OS1 unified execution custody — build79

## Product objective

The user works in OS1. Codex and Claude are execution adapters, not places the user must visit to relay an unfinished request. Preserve the original objective, attached sources, native identities, pending work and measured usage through a bounded recovery.

## Observed failure boundaries

- A successful-looking final answer could tell the user to open another backend without delivering the task. General output validation did not consistently reject this deferral.
- Claude error result variants do not necessarily contain `result`. Parsing that success-only field first obscured session/turn-limit and execution failures.
- Eligible alternate requests retained original source/context but not interrupted public progress.
- After a dispatched writer stopped, the app required a manual readback click. That readback appended an internal prompt as a USER message and changed the task objective. Readback success could clear the original failure.

## Repair

```text
OS1 objective + source + history
  -> signed provider/permission ticket
  -> backend adapter + public progress custody
  -> local completion gate + server verification
       adopted                         -> same OS1 conversation
       safe incomplete/capability stop -> bounded alternate, same objective
       uncertain write                 -> one automatic read-only state review
       denial/auth/budget/cancel        -> retain exact boundary, no silent bypass
```

1. Check Claude terminal subtype and session identity before requiring a final result. Preserve denial precedence, explicit budget limits and public partial text; private thinking, tool arguments and raw authentication errors are not added to recovery context.
2. Detect actual manual backend redirection for executable requests. Exclude explicit handoff-document requests, diagnostic quotations, code blocks and negated redirections. A local rejection remains rejected even if the remote verifier returns complete; an eligible alternate needs a fresh signed ticket.
3. Include an explicitly untrusted, bounded public-progress checkpoint in safe alternate input. Record its actual input size and lineage, not a fabricated free retry.
4. Automatically inspect uncertain writes once inside the same OS1 conversation. This is a separate, signed read-only phase with at most two provider attempts. It adds no USER turn, retains the original objective ID and failure across restart, and does not unpause dependent tasks. Failure of that inspection never recurses. Other conversations remain independent.
5. Show OS1-owned execution/recovery progress. Preserve backend identities in detailed records and explicit inspection; automatic execution does not reveal a backend app.

## Hard boundaries

Readback is not original-task completion. An unchanged local diff does not prove a remote deployment never happened. A model's assertion that replay is safe is not independent evidence. No automatic second writer is admitted after uncertain effects; policy/auth denials, cancellation and configured budget caps are not routed around. Explicit provider pins remain binding. This change does not claim universal model optimality or that every arbitrary external failure can be resolved without an owner decision.

## Verification

Executable fixtures cover result-less errors, failed-session binding, manual handoff positives/negatives, bounded checkpoint transport, one automatic review, no repeated writer, retained sources/partial output, no synthetic user message, objective preservation even when a returned review context has a different objective, review failure, restart during review, dependency isolation and foreground isolation. Installed verification must run these tests on the packaged app/runtime, preserve signing identity and all existing conversations, and record exact counts in the local release evidence.

No SCV production, customer state, Gold recovery baseline, ManyChat or service permissions are changed by this repair.

## Evidence-first design references

- [Claude result lifecycle](https://code.claude.com/docs/en/agent-sdk/agent-loop): error variants have session/usage but no success-only result field.
- [Claude headless lifecycle](https://code.claude.com/docs/en/headless): startup hooks and initialization can precede the first turn.
- [Codex app-server lifecycle](https://learn.chatgpt.com/docs/app-server): bind execution, cancellation and persistence to actual thread/turn/item identities.
- [External-feedback limitations](https://arxiv.org/abs/2310.01798): use executable verification rather than treating self-correction prompts as correctness guarantees.

These references informed the error/state boundaries, not a claim that a research algorithm was implemented by adding a prompt.
