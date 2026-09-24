# GitHub to Cloudflare R2 backup

## OS-1 Claudex

After an Apple-notarized release is activated, any Apple Silicon or Intel Mac
running macOS 13 or newer can install the public OS-1 release with:

```bash
curl -fsSL https://os1-route-gateway.omar-git-r2-backup.workers.dev/install.sh | bash
```

The installer downloads a SHA-256-pinned universal package, installs the
`Open OS-1 Codex.app` application (shown as **OS-1 Claudex**) and `os1` command, and installs the official
Codex CLI, Claude Code, and GitHub CLI when absent. Each person completes the
three providers' OAuth browser approvals on their own Mac; credentials are
never copied between computers.

### Explicit local beta without Apple notarization

For private testing before Apple signing, build a separate offline beta bundle:

```bash
OS1_RELEASE_MODE=development products/os1-mac-runtime/scripts/build-release.sh
products/os1-mac-runtime/scripts/make-beta-bundle.sh
```

Send the resulting `OS-1-0.9.0-macOS-beta.zip` to the other Mac. After
unzipping it, open Terminal, type `bash `, drag **Install OS-1 Beta.command**
into Terminal, and press Return. The command verifies the manifest SHA-256,
package identifier and version, exact file/directory allowlist, app and CLI
code integrity, and both `arm64` and `x86_64` slices before asking for the Mac
administrator password. It never disables Gatekeeper globally.

This is an explicit terminal beta path, not a seamless Finder installation.
The public curl/Finder path remains fail-closed until the package has Developer
ID signatures and Apple notarization.

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
thread; repeated Claude turns resume the same Claude session. Codex work is
created through the local Codex desktop protocol and registered in the desktop
task list, so the prompt, final answer, workspace, and continued turns remain
visible when the Codex backend is inspected. After the first turn in either
engine, the matching backend inspector is enabled in the header. Changing the
project folder resets both links to prevent a provider session from resuming in
the wrong workspace.

When the selected engine changes, OS-1 sends a bounded, visible completed-turn
handoff as untrusted context to the other engine. It does not claim to mirror
hidden reasoning, an in-progress provider turn, or provider-private runtime
state. The OS-1 index and visible transcript are stored only on the Mac, are
permission-restricted, capped, and expire after 30 days.

The equivalent CLI choices are `--provider auto`, `--provider codex`, and
`--provider claude`. Machine-readable desktop integration uses
`--output-format json`. Native sessions are resumed with
`--codex-session-id UUID` and `--claude-session-id UUID`; each JSON step returns
the actual provider `session_id` plus the allowlisted model/effort execution
action selected by the server. In Auto, the source-locked RCC v26 service
chooses the backend, an available Codex or Claude model, and its reasoning
effort. A manual provider choice pins only the backend; RCC still selects that
backend's model and effort. A bounded completed-turn handoff can be
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

On a Mac with only Codex installed, paste this as the **first Codex message**:

```text
이 Mac은 완전히 새 Mac이야. https://github.com/effacermonexistence/codex 의 main을 새 Mac 설정 원본으로 사용해. https://raw.githubusercontent.com/effacermonexistence/codex/main/scripts/bootstrap-new-mac.sh 를 내려받아 전체 내용을 확인하고 실행해. Git Command Line Tools, GitHub CLI, Codex/ChatGPT, Claude, Cloudflare Wrangler의 기기별 로그인이 필요하면 기존 연결을 먼저 확인하고 내가 브라우저나 macOS에서 승인할 단계만 알려줘. 승인 후 멈추지 말고 scripts/finish-new-mac.sh가 통과할 때까지 진행해. GitHub push 권한, 실제 Git 체크아웃, 정확한 Cloudflare 계정과 R2 버킷 및 MacBook Pro MDM 객체 읽기, Handy Fn/알림음, 검은 배경, Always On, Codex Q를 확인해. OS-1/EXO는 설치하지 마. 비밀번호나 인증 코드는 채팅에 요구하지 마.
```

This is one request, with only the unavoidable device-local browser/macOS
approvals. A brand-new Mac cannot inherit another Mac's OAuth or Keychain
entries. The agent must continue after bootstrap and run
`scripts/finish-new-mac.sh` before reporting success.

The durable setup lives in this public repository, not in a laptop or an AI
account's memory. On a new Mac, download and run the reviewed bootstrap:

```bash
curl -fsSL \
  https://raw.githubusercontent.com/effacermonexistence/codex/main/scripts/bootstrap-new-mac.sh \
  -o /tmp/omar-bootstrap-new-mac.sh
sed -n '1,400p' /tmp/omar-bootstrap-new-mac.sh
bash /tmp/omar-bootstrap-new-mac.sh
```

It installs the repository under `~/Documents/Codex/codex`, a verified Node.js
LTS toolchain, the repository-pinned pnpm and Wrangler versions, Codex CLI,
Claude Code, and GitHub CLI. It configures the official Cloudflare API MCP
endpoint for both Codex and Claude, then copies durable non-secret guidance to
`~/.codex/AGENTS.md` and `~/.claude/CLAUDE.md`. Existing instruction files are
backed up before they are replaced.

The same command also installs the SHA-256-pinned official Handy app and
Whisper Medium model; configures Fn transcription with Marimba start/stop
sounds; disables macOS's Fn emoji action; sets the desktop to pure `#000000`;
starts a login-session idle sleep/display sleep assertion; and sets Codex
follow-ups to queue mode. The Always On assertion applies while the user is
logged in and the lid is open. Handy microphone and Accessibility permissions
are approved in macOS on each device. Already-open Codex sessions need a
restart to pick up queue mode. The EXO app is not installed by this desktop
profile. The OS-1 installer currently configures EXO and requires macOS
administrator approval, so it is separate: run
`OMAR_INSTALL_OS1=1 ./scripts/bootstrap-new-mac.sh` only when OS-1/EXO
installation is requested.

OAuth credentials are intentionally not copied or committed. Sign in once per
new Mac to Codex/ChatGPT, GitHub, Claude, the Cloudflare MCP endpoint, and
Wrangler. Confirm that Wrangler is connected to Cloudflare Account ID
`d18c5d440fedbf100c4afd13b4b7a2c0` and can read
`omar-private-archive`. The private `omar-r2-device-setup` repository contains
the R2 device verification script and MacBook Pro MDM reference key; retrieve
and run that script after GitHub and Wrangler OAuth:

```bash
gh api repos/effacermonexistence/omar-r2-device-setup/contents/scripts/verify-r2-connection.sh --jq .content | base64 -D > /tmp/verify-r2-connection.sh
sed -n '1,160p' /tmp/verify-r2-connection.sh
bash /tmp/verify-r2-connection.sh
```

The GitHub-to-R2 workflow itself needs no laptop login because it uses GitHub
Actions OIDC. After OAuth approvals, confirm readiness with
`scripts/finish-new-mac.sh`. It verifies the actual Git checkout, authenticated
GitHub push access, exact Cloudflare account, R2 bucket and private MacBook Pro
MDM object, then runs `pnpm run doctor`.

On a completely fresh Mac, Codex has not yet received this repository's global
`AGENTS.md`. Start the first Codex request with the repository address, for
example: “`https://github.com/effacermonexistence/codex` 기준으로 새 맥 세팅해.”
After that first bootstrap, a bare “새 맥 세팅해” loads the installed guidance.

Once `codex/AGENTS.md` has been installed globally, the phrases `시스템 세팅해`,
`시스템 셋업해`, `새 맥 세팅해`, and `맥북 복구해` tell a new Codex task to
fetch, inspect, and execute this bootstrap immediately. Already-open Codex
sessions must be restarted because Codex loads global instructions once when a
session starts.

The bare or imperative phrases `레드팀`, `오마시스템 레드팀`, and
`시스템 점검` have a separate SCV Instagram meaning: verify the current
production release, perform a fresh code-locked Omar.system-only reset with
pause/snapshot/restore/audit/resume gates, and only then start the requested
test. The doctor command verifies that this persistent rule is present and that
the installed global guidance exactly matches the durable repository copy.
The same fresh exact-target reset is a mandatory completion gate after every
deployed SCV Instagram code, configuration, prompt, or system fix, without a
second reset request. Completion still requires timestamped pre/post recovery
points, a zero-residual audit, resumed workers, and healthy production.

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
the global Codex and Claude instructions. The active SCV Instagram release record
is `docs/scv-instagram-v164-custody.md`; the current recovery record (the owner-approved
recovery Gold, v151) is `docs/scv-instagram-v151-custody.md`. GOLD-3 remains
the separately frozen v148 behavioral reference in
`docs/scv-instagram-gold-3-2026-09-03.md`; GOLD-2 and the v138 to v150 release
records remain timestamped history.

## Restore on a new computer

Install Git, then run the new-Mac bootstrap above. It installs Node.js and the
repository's pinned Wrangler dependency. Restore with:

```bash
./scripts/restore-from-r2.sh <repository-name> [destination]
```

The script authenticates Wrangler when needed, downloads the latest manifest
and bundle, verifies its SHA-256 checksum and Git bundle structure, restores all
available branches and tags, and points `origin` back to GitHub.
