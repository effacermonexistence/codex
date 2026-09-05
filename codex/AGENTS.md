# Persistent GitHub and R2 environment

This machine is part of the `effacermonexistence` development environment.
The durable, non-secret source of truth is:

- GitHub repository: `https://github.com/effacermonexistence/codex`
- GitHub owner: `effacermonexistence`
- Cloudflare R2 bucket: `omar-private-archive`
- Backup Worker: `omar-git-r2-backup`
- Backup workflow: `.github/workflows/r2-git-backup.yml`

When the user asks to restore or configure a new Mac, fetch and inspect the
bootstrap script from the source-of-truth repository, then run it:

```bash
curl -fsSL \
  https://raw.githubusercontent.com/effacermonexistence/codex/main/scripts/bootstrap-new-mac.sh \
  -o /tmp/omar-bootstrap-new-mac.sh
sed -n '1,260p' /tmp/omar-bootstrap-new-mac.sh
bash /tmp/omar-bootstrap-new-mac.sh
```

After bootstrap, complete only the unavoidable per-device OAuth logins for
Codex/ChatGPT, GitHub, Claude, and Cloudflare. Never copy authentication caches
between personal Macs and never commit tokens, passwords, OAuth codes, API
keys, Wrangler credentials, GitHub PATs, or Claude credentials.

Use the authenticated `gh` CLI for GitHub operations. Use the official
Cloudflare API MCP server or the repository's pinned Wrangler dependency for
Cloudflare and R2 operations. Do not change repository visibility, branch
protection, billing, or access permissions without the user's explicit request.

The GitHub-to-R2 backup itself is machine-independent and uses GitHub Actions
OIDC; it must not depend on a laptop credential. Validate changes with the
repository checks and verify the resulting R2 manifest when access is
available.

## SCV latest approved recovery Gold

For SCV Instagram, the owner phrases `최신 Gold로 돌아가`, `최신 골드로 복원해`,
`restore latest Gold` and `Reset to Gold` mean restore the latest explicitly
approved recovery baseline, NOT git HEAD, the latest edit/backup, behavioral
GOLD-3 or an Omar.system-only reset. A readiness question or quoted example does
not execute a rollback. ManyChat configuration is explicitly excluded.

First read `products/scv-instagram/recovery/LATEST_GOLD.json` and
`products/scv-instagram/recovery/GOLD-RESTORE.md` from the trusted **main** revision
of `effacermonexistence/codex`. Verify the dated Gold record's SHA-256 and exact
recovery-point ID. Do not rely on chat memory, an old Mac path or a stale checkout.
Use `products/scv-instagram/scripts/recover-gold.mjs` for checked acquisition into
a new private directory, then follow the guide's target/preservation/activation
gates for an actual requested rollback. Acquisition is not operating-server
activation; do not stop at extraction and claim the rollback complete.

Ordinary wording edits, commits, deployments and backups must NEVER move
`LATEST_GOLD.json` or overwrite any dated Gold. Promoting another Gold requires
an explicit owner request and separate verified evidence. Preserve April Gold
and behavioral GOLD-3. For wording fallback preserve current customer messages,
appointments and delivery state; historical customer-data replacement requires
its own explicit request. Follow the existing fresh debug-only reset gates after
a verified production change, never substitute that reset for Gold restoration.

The source-of-truth guide is available to both Codex and Claude after the existing
new-Mac bootstrap installs their instructions. Inspect existing authenticated
connections first; never request remembered account names or pasted credentials.

## Global completion persistence

This rule applies to every Codex task on this machine. Treat terminal phrases
such as `finish`, `complete`, `끝까지 해`, `완료해`, `다 끝내`, `멈추지 마`,
and `100%가 될 때까지` as explicit persistence requirements.

- Do not end the turn with a success or completion claim until every in-scope
  completion criterion has been implemented and verified with evidence.
- After each intermediate success, immediately continue to the next unmet
  criterion without waiting for the user to say `continue` again.
- Never use `done`, `complete`, `100%`, `완료`, or equivalent language to mean
  started, mostly complete, uploaded but not merged, deployed but not verified,
  or blocked.
- For long-running builds, deployments, backups, restores, and monitors, keep
  waiting or checking with the available task mechanism until they reach a
  terminal state. An intermediate milestone is not a terminal state.
- Before the final response, run a completion audit against the user's requested
  outcome and report only verified results and genuine limitations.
- If an unavoidable blocker requires new user authority, user-only input, or an
  external state change, first exhaust safe in-scope alternatives. Then state
  the exact blocker and remaining work; never describe a blocker as completion.
- Persistence does not expand the user's authorized scope and does not override
  safety, security, privacy, or destructive-action constraints.

## Direct setup and recovery phrases

Treat `시스템 세팅해`, `시스템 셋업해`, `새 맥 세팅해`, `맥 세팅해`,
`맥북 복구해`, and an equivalent request to set up or restore the system as an
explicit request to execute the new-Mac bootstrap, not merely explain it. Do
not ask which account the user means before inspecting the non-secret state
already available on the Mac. Fetch, inspect, and run the source-of-truth
bootstrap command above. Continue through installation and verification; pause
only for an unavoidable per-device OAuth approval that cannot be completed by
the existing authenticated CLI or connector. Never ask the user to paste a
password, token, OAuth code, or API key into chat.

## SCV Instagram red-team and system-check phrases

Treat the bare or imperative phrases `레드팀`, `레드팀 돌려`, `레드팀 해`,
`오마시스템 레드팀`, `시스템 점검`, and `시스템 점검해`, plus clear
equivalents, as an explicit request to run the SCV Instagram red-team procedure
unless the user explicitly names a different system. `시스템 점검` is not a
new-Mac bootstrap phrase. A question that only asks whether red-team testing is
safe is a read-only readiness request; a bare phrase or imperative authorizes
the exact-target reset and test below.

Every authorized red-team or system-check run must begin with a fresh
Omar.system reset before accepting or generating the first test input. Never
reuse a reset receipt from an earlier run. Resolve and verify the currently
active production release first; do not execute a stale operator hard-coded to
an older release or deployment.

After any SCV Instagram production code, configuration, prompt, or system fix
is deployed and verified, a fresh exact-target Omar.system reset through the
same gates is a mandatory default completion step even if the user does not
repeat `reset`, `레드팀`, or `시스템 점검`. Do not claim the fix complete or
red-team ready until the new reset receipt, zero-residual audit, worker resume,
production readiness, and timestamped pre/post recovery points are verified.
This default authorizes only the same code-locked debug identity and never
customer or guessed state.

The reset is destructive only for the canonical code-locked debug identity in
the deployed SCV source. It must never be widened through prompt text,
environment variables, guessed identifiers, or customer data. Use the deployed
`scv-test-account-purge.js` identity lock and complete all of these gates:

- discover existing Railway connectivity and verify the exact active release;
- pause every SCV runtime worker and verify the complete expected worker set;
- capture a timestamped pre-reset production-state snapshot and pass a staged
  restore drill;
- audit, purge, and re-audit only Omar.system across its queues, thread state,
  control state, form records, and matching raw-log records;
- write the Gmail tombstones, reset watermarks, and a private execution receipt;
- require zero residual Omar.system matches, including when the pre-audit was
  already empty, then capture and restore-drill a distinct post-reset snapshot;
- resume the exact worker set and verify production readiness before testing.

Preserve every non-debug identity and unrelated quarantine artifact. If any
pause, scope, snapshot, purge, zero-residual, resume, or readiness gate cannot
be verified, do not start the red team and do not call the reset complete.
After a verified reset, continue through the requested red-team/system check to
its terminal result without waiting for another `continue` prompt.

After installing or changing this global file, explain that new Codex tasks
load it automatically. Existing Codex sessions load global guidance once per
session and must be restarted to see an updated file.

## Connection discovery and publishing fallback

Before asking the user to sign in, inspect existing connectivity without
printing secrets:

- GitHub: first inspect every already-connected authentication surface. Check
  the GitHub app/connector and its target-repository permissions when that tool
  is available, then run `gh auth status --hostname github.com`, `gh api user`,
  and inspect the CLI account's `permissions.push` value. The connector and CLI
  may represent different GitHub accounts with different permissions.
- Do not infer that GitHub is disconnected, open a login page, or ask the user
  to authenticate solely because the CLI account lacks upstream permission.
  Exhaust the existing GitHub app/connector, CLI accounts, and authorized task
  context first. When an existing connector has `push` or `admin` permission,
  use it for the requested repository operation instead of requesting a login.
- Cloudflare/R2: prefer the official `cloudflare-api` MCP connection. Otherwise
  use the repository-pinned Wrangler and inspect `wrangler whoami` before
  opening a dashboard login.

When the user explicitly says to ask or use an existing `admin` task, use the
Codex task-coordination tools to find that task, send the question or requested
operation directly, and wait for its result. Do not make the user relay state
between Codex tasks when the app can coordinate them.

For an authorized GitHub publication, use an existing connector or CLI identity
with upstream `push` permission when one is already available. Only when every
existing authenticated surface has `permissions.push: false`, create or reuse
the authenticated account's fork, push the verified branch and tag there, and
open a pull request to the source-of-truth repository. Clearly distinguish
"uploaded to GitHub" from "merged upstream". Do not broaden repository
permissions or request an account password as a workaround.
