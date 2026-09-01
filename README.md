# GitHub to Cloudflare R2 backup

## OS-1 Claudex

On any Apple Silicon or Intel Mac running macOS 13 or newer, install the public
OS-1 release with:

```bash
curl -fsSL https://os1-route-gateway.omar-git-r2-backup.workers.dev/install.sh | bash
```

The installer downloads a SHA-256-pinned universal package, installs the
`Open OS-1 Codex.app` application (shown as **OS-1 Claudex**) and `os1` command, and installs the official
Codex CLI, Claude Code, and GitHub CLI when absent. Each person completes the
three providers' OAuth browser approvals on their own Mac; credentials are
never copied between computers.

After installation:

```bash
os1 doctor
os1 run --workspace /path/to/project --prompt "Implement the requested change" --provider auto
```

The desktop app follows the same three-pane workflow as Codex:

1. Click the folder button in the upper-right and choose the project.
2. Choose **Auto**, **Codex**, or **Claude**. Auto lets RCC route the turn;
   either named engine forces that engine for the first governed step.
3. Enter a task in the bottom composer. Use `Command-Return` to send.

Each OS-1 session pair links one real persistent Codex task and one real
persistent Claude Code session. Repeated Codex turns resume the same Codex
thread; repeated Claude turns resume the same Claude session. After the first
turn in each engine, **Open Codex** and **Open Claude** appear in the header so
the native provider session can be opened directly. Changing the project folder
resets both links to prevent a provider session from resuming in the wrong
workspace.

When the selected engine changes, OS-1 sends a bounded, visible completed-turn
handoff as untrusted context to the other engine. It does not claim to mirror
hidden reasoning, an in-progress provider turn, or provider-private runtime
state. The OS-1 index and visible transcript are stored only on the Mac, are
permission-restricted, capped, and expire after 30 days.

The equivalent CLI choices are `--provider auto`, `--provider codex`, and
`--provider claude`. Machine-readable desktop integration uses
`--output-format json`. Native sessions are resumed with
`--codex-session-id UUID` and `--claude-session-id UUID`; each JSON step returns
the actual provider `session_id` plus an abstract standard, efficient, or deep
execution action. In Auto, RCC chooses both the backend and that model tier;
manual provider selection preserves the provider account's default model. A bounded completed-turn handoff can be
supplied with `--context-file` without sending that transcript to the routing
request.

The proprietary route policy is deployed only in the private Cloudflare
service. The Mac receives a short Ed25519-signed execution ticket and uploads a
device-signed result artifact to private R2 storage.

This project keeps every `effacermonexistence` GitHub repository mirrored as a
verified Git bundle in the private Cloudflare R2 bucket
`omar-private-archive`.

## Daily operator check

Run this first when Omar OS One Codex feels broken, newly installed, or moved
to another Mac:

```bash
cd ~/Documents/Codex/codex
pnpm run doctor
```

The doctor verifies the local project, installed Codex and Claude guidance,
GitHub CLI login, Claude login, Cloudflare MCP, Wrangler, TypeScript, R2
manifest access, and the backup Worker health endpoint. Use strict mode when a
handoff should fail on warnings too:

```bash
pnpm run doctor:strict
```

## New Mac: one bootstrap command

The durable setup lives in this public repository, not in a laptop or an AI
account's memory. On a new Mac, download and run the reviewed bootstrap:

```bash
curl -fsSL \
  https://raw.githubusercontent.com/effacermonexistence/codex/main/scripts/bootstrap-new-mac.sh \
  -o /tmp/omar-bootstrap-new-mac.sh
sed -n '1,260p' /tmp/omar-bootstrap-new-mac.sh
bash /tmp/omar-bootstrap-new-mac.sh
```

It installs the repository under `~/Documents/Codex/codex`, a verified Node.js
LTS toolchain, the repository-pinned pnpm and Wrangler versions, Codex CLI,
Claude Code, and GitHub CLI. It configures the official Cloudflare API MCP
endpoint for both Codex and Claude, then copies durable non-secret guidance to
`~/.codex/AGENTS.md` and `~/.claude/CLAUDE.md`. Existing instruction files are
backed up before they are replaced.

OAuth credentials are intentionally not copied or committed. Sign in once per
new Mac to Codex/ChatGPT, GitHub, Claude, the Cloudflare MCP endpoint, and
Wrangler. The GitHub-to-R2 workflow itself needs no laptop login because it
uses GitHub Actions OIDC. After bootstrap, confirm readiness with
`pnpm run doctor`.

Once `codex/AGENTS.md` has been installed globally, the phrases `시스템 세팅해`,
`시스템 셋업해`, `새 맥 세팅해`, and `맥북 복구해` tell a new Codex task to
fetch, inspect, and execute this bootstrap immediately. Already-open Codex
sessions must be restarted because Codex loads global instructions once when a
session starts.

The GitHub workflow uses GitHub Actions OIDC. No long-lived Cloudflare or R2
credential is stored in GitHub. The Worker accepts only tokens issued for
`effacermonexistence` repositories running
`.github/workflows/r2-git-backup.yml`, then streams each bundle to R2 with the
multipart API.

Backups run on every branch or tag push, weekly, and on manual dispatch. The
latest manifest is stored at:

```text
git-bundles/effacermonexistence/<repository>/latest.json
```

## Rebuild or redeploy the gateway

On a new computer, clone this repository and authenticate Wrangler with the
Cloudflare account that owns `omar-private-archive`, then run:

```bash
pnpm install --frozen-lockfile
pnpm run types
pnpm run check
pnpm run deploy
```

The GitHub workflows do not need Cloudflare access keys or repository secrets.
They obtain short-lived GitHub OIDC tokens for each upload request.

## Claude Code

Claude Code uses the authenticated GitHub CLI for repository operations and the
official Cloudflare API MCP server or Wrangler for R2 operations. On a new Mac:

```bash
./scripts/bootstrap-new-mac.sh
export PATH="$HOME/.local/share/node-v24.20.0/bin:$HOME/.local/bin:$PATH"
codex mcp login cloudflare-api
claude auth login
gh auth login --hostname github.com --git-protocol https --web
claude mcp login cloudflare-api
pnpm exec wrangler login --use-keyring
```

If Claude's browser approval was not completed by the command above, start
Claude Code in this repository and run `/mcp` once to authorize the
`cloudflare-api` server. No GitHub PAT or Cloudflare API token is committed.

Claude also installs a user-level SessionStart/Stop guard. For repositories
owned by `effacermonexistence` or `effacermonexistence-ship-it`, the guard
records the Git state at session start and prevents Claude from stopping after
it creates uncommitted or unpushed work. Question-only sessions and unrelated
repositories are not affected. A fork push is reported separately from the
upstream merge that triggers the GitHub Actions upload to R2.

Product-specific release and custody coordinates are deliberately kept out of
the global Codex and Claude instructions. The SCV Instagram v122 custody record
is documented in `docs/scv-instagram-v122-custody.md`.

## Restore on a new computer

Install Git, then run the new-Mac bootstrap above. It installs Node.js and the
repository's pinned Wrangler dependency. Restore with:

```bash
./scripts/restore-from-r2.sh <repository-name> [destination]
```

The script authenticates Wrangler when needed, downloads the latest manifest
and bundle, verifies its SHA-256 checksum and Git bundle structure, restores all
available branches and tags, and points `origin` back to GitHub.
