#!/usr/bin/env bash
set -euo pipefail

readonly repo_owner="effacermonexistence"
readonly repo_name="codex"
readonly repo_branch="main"
readonly node_version="24.20.0"
readonly pnpm_version="11.19.0"
readonly default_install_root="$HOME/Documents/Codex/codex"
readonly install_root="${OMAR_CODEX_HOME:-$default_install_root}"
readonly codex_config_dir="${OMAR_CODEX_CONFIG_DIR:-$HOME/.codex}"
readonly claude_config_dir="${OMAR_CLAUDE_CONFIG_DIR:-$HOME/.claude}"
readonly local_bin="$HOME/.local/bin"
readonly node_install_parent="$HOME/.local/share"
readonly node_install_root="$HOME/.local/share/node-v${node_version}"
readonly archive_url="https://github.com/${repo_owner}/${repo_name}/archive/refs/heads/${repo_branch}.tar.gz"

export PATH="$node_install_root/bin:$local_bin:$PATH"

bootstrap_tmp="$(mktemp -d)"
node_stage_dir=""
cleanup() {
  rm -rf "$bootstrap_tmp"
  if [[ -n "$node_stage_dir" && -d "$node_stage_dir" ]]; then
    rm -rf "$node_stage_dir"
  fi
}
trap cleanup EXIT

node_install_is_valid() {
  local candidate="$1"

  [[ -x "$candidate/bin/node" ]] &&
    [[ "$("$candidate/bin/node" --version 2>/dev/null)" == "v${node_version}" ]]
}

preserve_interrupted_node_path() {
  local source_path="$1"
  local reason="$2"
  local preserved_path
  local suffix=0

  preserved_path="${node_install_root}.${reason}.$(date -u +%Y%m%dT%H%M%SZ).$$"
  while [[ -e "$preserved_path" ]]; do
    suffix=$((suffix + 1))
    preserved_path="${node_install_root}.${reason}.$(date -u +%Y%m%dT%H%M%SZ).$$.${suffix}"
  done

  mv "$source_path" "$preserved_path"
  echo "Preserved interrupted Node.js install: $preserved_path"
}

echo "Downloading ${repo_owner}/${repo_name}..."
curl -fL --retry 3 --proto '=https' --tlsv1.2 \
  -o "$bootstrap_tmp/repository.tar.gz" "$archive_url"
tar -xzf "$bootstrap_tmp/repository.tar.gz" -C "$bootstrap_tmp"

mkdir -p "$install_root"
ditto "$bootstrap_tmp/${repo_name}-${repo_branch}" "$install_root"
chmod 0755 \
  "$install_root/scripts/bootstrap-new-mac.sh" \
  "$install_root/scripts/bootstrap-claude-code.sh" \
  "$install_root/scripts/install-os1-exo-monitor-from-r2.sh" \
  "$install_root/scripts/restore-from-r2.sh" \
  "$install_root/scripts/doctor.sh" \
  "$install_root/products/os1-mac-runtime/scripts/install-os1.sh"

mkdir -p "$node_install_parent"
for interrupted_path in \
  "$node_install_parent"/.node-v"${node_version}".install.*; do
  if [[ -e "$interrupted_path" ]]; then
    preserve_interrupted_node_path "$interrupted_path" "interrupted"
  fi
done

if ! node_install_is_valid "$node_install_root"; then
  case "$(uname -m)" in
    arm64)
      node_arch="arm64"
      # https://nodejs.org/dist/v24.20.0/SHASUMS256.txt
      node_sha256="40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8"
      ;;
    x86_64)
      node_arch="x64"
      # https://nodejs.org/dist/v24.20.0/SHASUMS256.txt
      node_sha256="9e5b2644cf107befb6aefca676b96d3296bc10138096f022ed378d6233ed81f4"
      ;;
    *)
      echo "Unsupported macOS architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac

  node_archive="node-v${node_version}-darwin-${node_arch}.tar.gz"
  curl -fL --retry 3 --proto '=https' --tlsv1.2 \
    -o "$bootstrap_tmp/node.tar.gz" \
    "https://nodejs.org/dist/v${node_version}/${node_archive}"
  printf '%s  %s\n' "$node_sha256" "$bootstrap_tmp/node.tar.gz" | \
    shasum -a 256 -c -

  node_stage_dir="$(
    mktemp -d "$node_install_parent/.node-v${node_version}.install.XXXXXX"
  )"
  tar -xzf "$bootstrap_tmp/node.tar.gz" \
    -C "$node_stage_dir" --strip-components=1

  if ! node_install_is_valid "$node_stage_dir"; then
    echo "Node.js staging verification failed at $node_stage_dir" >&2
    exit 1
  fi

  if [[ -e "$node_install_root" ]]; then
    preserve_interrupted_node_path "$node_install_root" "incomplete"
  fi

  # The staging directory and destination share a parent, so this rename is
  # atomic on the local filesystem after the staged runtime has been verified.
  mv "$node_stage_dir" "$node_install_root"
  node_stage_dir=""
fi

if ! node_install_is_valid "$node_install_root"; then
  echo "Node.js verification failed at $node_install_root" >&2
  exit 1
fi

installed_pnpm_version="$(pnpm --version 2>/dev/null || true)"
if [[ "$installed_pnpm_version" != "$pnpm_version" ]]; then
  "$node_install_root/bin/npm" install --global --prefix "$HOME/.local" \
    "pnpm@${pnpm_version}"
fi

codex_cli_is_usable() {
  local add_help
  local get_help
  local remove_help

  command -v codex >/dev/null 2>&1 || return 1
  codex --version >/dev/null 2>&1 || return 1
  add_help="$(codex mcp add --help 2>/dev/null)" || return 1
  get_help="$(codex mcp get --help 2>/dev/null)" || return 1
  remove_help="$(codex mcp remove --help 2>/dev/null)" || return 1
  [[ "$add_help" == *"--url"* ]] || return 1
  [[ "$get_help" == *"--json"* ]] || return 1
  [[ -n "$remove_help" ]]
}

if ! codex_cli_is_usable; then
  curl -fsSL --proto '=https' --tlsv1.2 \
    https://chatgpt.com/codex/install.sh \
    -o "$bootstrap_tmp/codex-install.sh"
  bash "$bootstrap_tmp/codex-install.sh"
  hash -r
fi

if ! codex_cli_is_usable; then
  echo "Codex CLI verification failed after installation" >&2
  exit 1
fi

"$install_root/scripts/bootstrap-claude-code.sh"
if [[ "${OMAR_SKIP_OS1:-0}" != "1" ]]; then
  "$node_install_root/bin/node" "$install_root/scripts/bootstrap-os1-release.mjs"
fi

pnpm --dir "$install_root" install --frozen-lockfile

cloudflare_mcp_is_current() {
  codex mcp get cloudflare-api --json 2>/dev/null | \
    "$node_install_root/bin/node" -e '
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        try {
          const server = JSON.parse(input);
          const valid =
            server.name === "cloudflare-api" &&
            server.enabled === true &&
            server.transport?.type === "streamable_http" &&
            server.transport?.url === "https://mcp.cloudflare.com/mcp";
          process.exit(valid ? 0 : 1);
        } catch {
          process.exit(1);
        }
      });
    '
}

if ! cloudflare_mcp_is_current; then
  codex mcp remove cloudflare-api >/dev/null 2>&1 || true
  codex mcp add cloudflare-api --url https://mcp.cloudflare.com/mcp
fi

if ! cloudflare_mcp_is_current; then
  echo "Codex Cloudflare MCP verification failed" >&2
  exit 1
fi

install_with_backup() {
  local source_file="$1"
  local destination_file="$2"
  local destination_dir
  local backup_file

  destination_dir="$(dirname "$destination_file")"
  mkdir -p "$destination_dir"

  if [[ -f "$destination_file" ]] && cmp -s "$source_file" "$destination_file"; then
    return
  fi

  if [[ -e "$destination_file" ]]; then
    backup_file="${destination_file}.before-omar-bootstrap.$(date -u +%Y%m%dT%H%M%SZ)"
    cp -p "$destination_file" "$backup_file"
    echo "Preserved existing file: $backup_file"
  fi

  install -m 0644 "$source_file" "$destination_file"
}

install_with_backup "$install_root/codex/AGENTS.md" "$codex_config_dir/AGENTS.md"
install_with_backup "$install_root/CLAUDE.md" "$claude_config_dir/CLAUDE.md"

install_executable_with_backup() {
  local source_file="$1"
  local destination_file="$2"
  local backup_file

  mkdir -p "$(dirname "$destination_file")"
  if [[ -f "$destination_file" ]] && cmp -s "$source_file" "$destination_file"; then
    chmod 0755 "$destination_file"
    return
  fi
  if [[ -e "$destination_file" ]]; then
    backup_file="${destination_file}.before-omar-bootstrap.$(date -u +%Y%m%dT%H%M%SZ)"
    cp -p "$destination_file" "$backup_file"
    echo "Preserved existing file: $backup_file"
  fi
  install -m 0755 "$source_file" "$destination_file"
}

install_executable_with_backup \
  "$install_root/scripts/install-os1-exo-monitor-from-r2.sh" \
  "$local_bin/os1-exo-monitor-sync"

if ! cmp -s "$install_root/codex/AGENTS.md" "$codex_config_dir/AGENTS.md"; then
  echo "Codex global instruction verification failed" >&2
  exit 1
fi

if ! cmp -s "$install_root/CLAUDE.md" "$claude_config_dir/CLAUDE.md"; then
  echo "Claude global instruction verification failed" >&2
  exit 1
fi

echo
echo "Installed durable setup at: $install_root"
echo "Installed Codex instructions: $codex_config_dir/AGENTS.md"
echo "Installed Claude instructions: $claude_config_dir/CLAUDE.md"
echo "Installed OS-1 CLODEX: /Applications/OS-1 CLODEX.app"
echo "Installed R2 EXO monitor sync: $local_bin/os1-exo-monitor-sync"
echo "Node.js: $(node --version)"
echo "pnpm: $(pnpm --version)"
echo "Codex CLI: $(codex --version)"
echo "Pinned Wrangler: $(pnpm --dir "$install_root" exec wrangler --version)"
echo "New Codex tasks now know the GitHub, R2, recovery, and completion-persistence procedures."
echo "Restart already-open Codex sessions to reload the global instructions."
echo
echo "One-time logins still required on each new Mac:"
echo "  First in this shell: export PATH=\"$node_install_root/bin:$local_bin:\$PATH\""
echo "  Codex/ChatGPT: run codex and choose Sign in with ChatGPT; sign in to the desktop app if used"
echo "  GitHub:        gh auth login --hostname github.com --git-protocol https --web"
echo "  Claude:        claude auth login"
echo "  Cloudflare:    codex mcp login cloudflare-api; claude mcp login cloudflare-api"
echo "  Wrangler:      cd \"$install_root\" && pnpm exec wrangler login --use-keyring"
echo
echo "No GitHub PAT, Cloudflare API token, or R2 secret is required by the backup workflow."
