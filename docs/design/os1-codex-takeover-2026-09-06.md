# OS1 Claude audit takeover — bounded repair contract

Objective: reliable Claude/Codex execution with OS1 owning input, progress,
results, source continuity and recovery. No mandatory backend window, no
automatic focus changes. This is OS1, not an SCV/customer-data reset.

## Custody / starting evidence

- Claude session f3855626-ade7-486f-86c3-b794c4b3acf6 stopped on its session
  limit after 22:29Z. Its worktree is `os1-redteam-fixes`, branch
  `os1/redteam-fixes-20260906`, baseline cb5054b plus four edited Swift files
  and a design note. Preserve those edits and the original dirty worktree.
- Installed app is still 0.9.22/build72. Changes are not installed yet.
- Prior synchronization report describes build24: validate against build72,
  which already reads turns back and supports explicit deep links. Do not
  reintroduce automatic Desktop opening to refresh its sidebar.
- Current GitHub CLI readback succeeds for the owner with push/admin access.
  Claude's environment/auth-failure assertions are historical, not current.
- Private audit root: /tmp/os1-claude-takeover.ExrAfE. No credentials included.

## Boundary map / five independent views

| View | Required convergence | Divergence to reproduce or rule out |
| --- | --- | --- |
| Intent | Real user request, original goal survives | Harness notification becomes a Fleet task |
| Source/context | Required terms, verified bytes, same source on follow-up | Orphan retrieval tests; unrelated hits; stale inherited retrieval |
| Execution | Feasible dispatch, scoped auth, no repeated effects | Unpublished revision; write retry; auth failure treated as model failure |
| Output/evidence | Durable candidate before validation; honest receipt | Paid candidate lost; same-process read called fresh-process proof |
| Cost/latency | No repeat failed tuple; recover existing answer | Quota restart forgets failure; rejected write runs again |
| UX/security | Background execution, cancel, readable output, stable identity | Fake focus test; voice overwrites edits; lost cancellation |

Record PASS/FAIL/UNKNOWN separately. Claude's suspected findings are leads,
not confirmed defects. Reproduce by narrow negative controls before changing
working code. Prior scenarios already covered remain regression baselines.

## Implementation sequence

1. Validate and retain Claude's hook/Fleet changes; wire orphan tests.
2. Confirm native persistence using a new read-only app-server after releasing
   the writer; explicit backend reveal remains user-only.
3. Preserve completed candidates before local/remote rejection, prevent automatic
   re-execution of dispatched writes, and carry fresh quota/retry observations.
4. Add typed local connection failures and one official login/resume path.
   Existing identities first; no auth-cache copy, global account switch,
   billing change or permission bypass. Connection check is not object retrieval.
5. Fix reproduced voice lifecycle/composer and cancellation gaps. Keep the
   user's Handy model/language settings unchanged.
6. Test actual installed build, code identity of app and service, source and
   backend readback, focus ownership and user-state preservation. Package,
   publish the OS1-only branch and verify a private recovery readback.

Alternatives rejected: wholesale rewrite; always foregrounding OS1; switching
models to bypass auth; broad filesystem scan; raising retries to hide failure;
equating receipt integrity with semantic correctness.

Rollback: retain build72 app/CLI and pre-change diff in private audit directory;
restore executable files only while idle. Never restore sessions.json over
new user conversations. Public download promotion and Apple notarization are
not implied by local installation.

References checked: OpenAI Codex App Server (thread/read, thread/turns/list,
thread/started), https://learn.chatgpt.com/docs/app-server; Cloudflare Wrangler
official command reference and installed pinned 4.127.1 help. Docs do not
prove Desktop renderer refresh; verify exact persisted records independently.

## Installed acceptance finding: Claude session quota

Build73's live Codex check passed; Claude emitted its actual API error
`You've hit your session limit` on four attempted model configurations.
The adapter discarded the structured `errors` field and misclassified quota
as answer failure. No successful Claude inference was observed. Raising effort
cannot repair this account-level condition.

Minimal follow-up: classify failed Claude protocol envelopes (including errors
arrays), preserve permission-denial precedence, and exclude the exhausted
Claude backend for this request. Auto may request a new signed Codex ticket
with the same permission and source. Explicit Claude stays explicit; dispatched
writes never replay. Successful explanations of quota errors are negative
controls and must not be blocked. No credential or billing changes. Verify
the real quota response once, then actual Auto completion through Codex and
zero repeated Claude configurations. Final replacement is build74; retain
the earlier executable as well as build72 for rollback.
