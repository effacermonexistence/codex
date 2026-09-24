#!/usr/bin/env bash
set -euo pipefail

readonly install_root="${OMAR_CODEX_HOME:-$HOME/Documents/Codex/codex}"
readonly repository_url='https://github.com/effacermonexistence/codex.git'
readonly private_helper_sha='707ba916813cfeff18b779888347a76cd130fe791fe2be37b0f467eb7067ef67'

export PATH="$HOME/.local/share/node-v24.20.0/bin:$HOME/.local/bin:$PATH"

if [[ ! -d "$install_root" ]]; then
  echo "Run the new-Mac bootstrap first: $install_root is missing." >&2
  exit 2
fi
if ! command -v git >/dev/null 2>&1 ||
   { [[ "$(command -v git)" == /usr/bin/git ]] && ! xcode-select -p >/dev/null 2>&1; } ||
   ! git --version >/dev/null 2>&1; then
  echo 'Git Command Line Tools are needed. Approve xcode-select --install, then rerun this script.' >&2
  exit 3
fi
if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  echo 'GitHub OAuth is needed: gh auth login --hostname github.com --git-protocol https --web' >&2
  exit 4
fi
if ! codex login status >/dev/null 2>&1; then
  echo 'Codex/ChatGPT sign-in is needed on this Mac.' >&2
  exit 5
fi
if ! claude auth status 2>/dev/null | grep -q '"loggedIn": true'; then
  echo 'Claude sign-in is needed: claude auth login' >&2
  exit 6
fi

repo_permission="$(gh api repos/effacermonexistence/codex --jq '.permissions.push' 2>/dev/null)" || {
  echo 'The GitHub login cannot read the source-of-truth repository.' >&2
  exit 7
}
if [[ "$repo_permission" != true ]]; then
  echo 'The current GitHub CLI login lacks push access to effacermonexistence/codex.' >&2
  exit 8
fi

# The first bootstrap can use a public archive if Apple's Git Command Line
# Tools are not installed yet. Preserve that archive before replacing it with
# a real checkout. Older bootstraps had no marker, so accept only directories
# that identify themselves as this exact source-of-truth bootstrap.
if [[ ! -d "$install_root/.git" ]]; then
  if [[ ! -f "$install_root/.omar-bootstrap-archive" ]] &&
     { [[ ! -f "$install_root/scripts/bootstrap-new-mac.sh" ]] ||
       ! grep -Fq 'readonly repo_owner="effacermonexistence"' "$install_root/scripts/bootstrap-new-mac.sh" ||
       ! grep -Fq 'readonly repo_name="codex"' "$install_root/scripts/bootstrap-new-mac.sh"; }; then
    echo "Refusing to replace an unrelated non-Git directory: $install_root" >&2
    exit 9
  fi
  checkout_stage="$(mktemp -d "$(dirname "$install_root")/.codex-checkout.XXXXXX")"
  rmdir "$checkout_stage"
  GIT_TERMINAL_PROMPT=0 git clone --depth 1 --branch main \
    "$repository_url" "$checkout_stage"
  backup_path="$install_root.before-git-checkout.$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$install_root" "$backup_path"
  if ! mv "$checkout_stage" "$install_root"; then
    mv "$backup_path" "$install_root"
    echo 'Could not install the Git checkout; restored the archive directory.' >&2
    exit 10
  fi
  pnpm --dir "$install_root" install --frozen-lockfile
  echo "Preserved the original bootstrap archive at: $backup_path"
fi

if [[ "$(git -C "$install_root" remote get-url origin)" != "$repository_url" ]]; then
  echo 'The local Git origin is not the source-of-truth repository.' >&2
  exit 11
fi
if [[ "$(git -C "$install_root" rev-parse --abbrev-ref HEAD)" != main ]]; then
  echo 'The local checkout is not on main.' >&2
  exit 12
fi

if ! (cd "$install_root" && pnpm exec wrangler whoami >/dev/null 2>&1); then
  echo 'Cloudflare OAuth is needed: pnpm exec wrangler login --use-keyring' >&2
  exit 13
fi

helper="$(mktemp)"
trap 'rm -f "$helper"' EXIT
gh api repos/effacermonexistence/omar-r2-device-setup/contents/scripts/verify-r2-connection.sh \
  --jq .content | base64 -D > "$helper"
printf '%s  %s\n' "$private_helper_sha" "$helper" | shasum -a 256 -c -
sed -n '1,160p' "$helper"
OMAR_CODEX_HOME="$install_root" bash "$helper"

if ! cmp -s "$install_root/codex/AGENTS.md" "${OMAR_CODEX_CONFIG_DIR:-$HOME/.codex}/AGENTS.md"; then
  echo 'Installed Codex guidance differs from the Git checkout; rerun bootstrap.' >&2
  exit 14
fi

(cd "$install_root" && pnpm run doctor)
echo 'New-Mac gates passed: GitHub checkout and login, Codex/Claude login, Mac profile, and correct R2 MDM access.'
