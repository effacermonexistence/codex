# GitHub to R2 infrastructure

This repository is the source of truth for the automatic GitHub-to-R2 backup.

- GitHub owner: `effacermonexistence`.
- Cloudflare R2 bucket: `omar-private-archive`.
- Worker: `omar-git-r2-backup`.
- Worker endpoint: `https://omar-git-r2-backup.omar-git-r2-backup.workers.dev`.
- GitHub workflow path: `.github/workflows/r2-git-backup.yml`.
- Use the authenticated `gh` CLI for GitHub operations.
- Use the `cloudflare-api` MCP server or `pnpm exec wrangler` for Cloudflare and R2 operations.
- Never commit API tokens, OAuth tokens, Wrangler credential files, or GitHub PATs.
- Never change repository visibility, branch protection, or billing settings unless the user explicitly requests it.

Before deploying Worker changes:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run types
pnpm run check
pnpm run deploy:dry-run
```

Restore a repository:

```bash
./scripts/restore-from-r2.sh <repository-name> [destination]
```

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

## Remote completion contract

For an authorized change/build/fix request in a Git repository owned by
`effacermonexistence` or `effacermonexistence-ship-it`, the local filesystem is
only a working area. Do not report the work as complete while the resulting
change exists only on this Mac.

Before finishing a turn that changed such a repository:

1. Review `git status` and the complete diff, run the repository checks, and
   scan the staged change for secrets and authentication caches.
2. Commit the verified change on a dedicated branch.
3. Inspect `gh auth status`, the authenticated GitHub user, and the upstream
   repository's `permissions.push` value.
4. Push directly to the upstream repository when permitted. Otherwise push to
   the authenticated user's fork and create or update an upstream pull request.
5. For an upstream push, wait for `.github/workflows/r2-git-backup.yml` and
   verify that `omar-private-archive` has a manifest for the pushed SHA. For a
   fork-only push, clearly report that GitHub upload succeeded but R2 remains
   pending until the upstream pull request is merged; never claim that R2 is
   current before its manifest proves it.

Do not commit or push for read-only questions, diagnosis-only requests, or a
turn that made no repository change. Never add ignored credentials, local
authentication caches, or unrelated user changes just to satisfy this
contract. The installed SessionStart/Stop hook enforces only changes made
during the current Claude session and only for the two trusted GitHub owners.

Treat `시스템 세팅해`, `시스템 셋업해`, `새 맥 세팅해`, and `맥북 복구해`
as direct authorization to fetch, inspect, and run
`scripts/bootstrap-new-mac.sh`. Inspect `gh` and Cloudflare/Wrangler connection
state before asking the user to sign in. Never ask the user to paste passwords,
tokens, OAuth codes, or API keys. If the authenticated GitHub account cannot
push upstream, use its fork and open a pull request without claiming that the
upstream branch was merged.
