# OS-1 machine image

Makes another of the owner's Macs run exactly the OS-1 setup of this one. The image is a byte-exact,
SHA-256-manifested copy of everything that decides what OS-1 does, published to private R2
(`omar-private-archive/os1-machine/`). Logins and per-Mac history are never part of it.

## Install or update a Mac

On the Mac to install (first time, from this repository's pushed commit):

```bash
curl -fsSL https://raw.githubusercontent.com/effacermonexistence/codex/<commit>/scripts/os1-machine-sync.sh -o /tmp/os1-machine-sync.sh && bash /tmp/os1-machine-sync.sh pro
```

Afterwards the helper is installed, so later updates are `os1-machine-sync pro` (`air` on the Air).
`--verify-only` changes nothing and reports `OS1_MACHINE_IMAGE_IDENTICAL n/n` or every difference.
The sync uses the Mac's existing Wrangler login (`wrangler login` once if it is signed out).

What happens: the pointer, each part (≤90 MiB) and the package are checked against their SHA-256 and
size; archive paths are checked; every file in the image is checked against `IMAGE.json`; then

1. everything except the app is installed file by file (atomic rename), each replaced or extra file
   preserved under `~/.os1/recovery/machine-sync-*/backup/`, the run journaled;
2. the OS-1 app, CLI and CLI config go through `install-local-verified.mjs`, the same installer OS-1's
   self-update uses (idle gate, signature and build check, eight self-tests, conversation
   preservation, fleet restart). A Mac without OS-1 gets a plain install with the same self-tests;
3. the fleet agent runs with this Mac's role (`--role pro|air`, the only intended per-Mac byte
   difference); a Mac already configured as the other role is refused unless `--change-role`;
4. the result is compared with the image again and must be identical.

A failure before the app is activated restores every journaled change. To undo a finished
installation: `node <image>/installer/install.mjs --rollback ~/.os1/recovery/machine-sync-…`.

## Contents

| Component | Paths (under the home folder) |
|---|---|
| os1-app | `Applications/OS-1 CLODEX.app`, `.local/bin/os1`, `.local/bin/config.json` |
| os1-helpers | `.local/bin/os1-exo-monitor-sync`, `.local/bin/os1-machine-sync` |
| os1-fleet-agent | `Library/LaunchAgents/com.os1.fleet-agent.plist` (role set per Mac) |
| os1-settings, os1-owner-policy, os1-policy-state | OS-1 `settings.json`, `.os1/owner-policy`, `backend-instructions`, `drift-policy`, `private-core` |
| os1-project-sources, os1-tools | `registered-sources`, `project-materials`, pinned npm 12.0.2 and wrangler 4.127.1 |
| claude-instructions, claude-config | `CLAUDE.md`, RCC engines, `omar-authority`, `settings.json`, hooks, skills, commands, user MCP servers |
| claude-code | the exact Claude Code version and `~/.local/bin/claude` |
| codex-instructions, codex-config | `AGENTS.md`, RCC engine, workflows, `config.toml`, `hooks.json`, keybindings |
| node | Node.js 24.20.0 |

Not copied, by design: Codex/Claude/GitHub/Cloudflare logins and OS-1 accounts, the OS-1 device key
(Secure Enclave), the local code-signing key, conversations, logs, fleet and recovery state, Codex
automations and Claude scheduled tasks (they would run twice), other LaunchAgents, EXO models (EXO has
`os1-exo-monitor-sync`). Vendor apps that update themselves (ChatGPT.app with the Codex CLI,
Claude.app) are compared and reported, not copied.

Paths in the fleet plist, Claude/Codex settings and the two instruction files follow the target's home
folder when it differs; everything else stays byte-identical. The owner policy pointer
(`active.json`) is compared without its certification time and Notes record ID, which every Mac
refreshes hourly from Apple Notes; OS-1 asks once for Notes access on a new Mac.

## Publish (on the source Mac)

```bash
scripts/os1-machine-image/publish.sh
```

Needs a clean, pushed checkout. A credential scan (private keys, provider/GitHub/npm/Slack/AWS/Google/
Meta tokens, JWTs, secret assignments, credential file names, also inside `.tar.gz` files) blocks the
image on any finding; reviewed exceptions are listed in `ALLOW` in `build.mjs` and in the manifest.

`node scripts/os1-machine-image/test.mjs` runs the end-to-end test in throwaway homes (local stand-in
bucket, other user name and role, conflicting files, rollback, injected failure, tampered part, scan).
