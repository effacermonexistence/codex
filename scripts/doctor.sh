#!/usr/bin/env bash
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
codex_config_dir="${OMAR_CODEX_CONFIG_DIR:-${HOME:?}/.codex}"
claude_config_dir="${OMAR_CLAUDE_CONFIG_DIR:-${HOME:?}/.claude}"
backup_bucket="omar-private-archive"
cloudflare_account_id="d18c5d440fedbf100c4afd13b4b7a2c0"
backup_worker_url="https://omar-git-r2-backup.omar-git-r2-backup.workers.dev/health"

if ! command -v node >/dev/null 2>&1; then
  codex_node_dir="${HOME:?}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
  if [[ -x "$codex_node_dir/node" ]]; then
    export PATH="$codex_node_dir:$PATH"
  fi
fi

json_output=0
strict=0
skip_cloudflare=0

for arg in "$@"; do
  case "$arg" in
    --) ;;
    --json) json_output=1 ;;
    --strict) strict=1 ;;
    --skip-cloudflare) skip_cloudflare=1 ;;
    -h|--help)
      cat <<'EOF'
Usage: scripts/doctor.sh [--strict] [--json] [--skip-cloudflare]

Checks whether Omar OS One Codex bootstrap, GitHub, Claude, Cloudflare R2,
and the local backup Worker project are ready on this Mac.
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

checks=()
failures=0
warnings=0

add_check() {
  local status="$1"
  local name="$2"
  local detail="$3"
  checks+=("$status"$'\t'"$name"$'\t'"$detail")
  case "$status" in
    fail) failures=$((failures + 1)) ;;
    warn) warnings=$((warnings + 1)) ;;
  esac
}

have_command() {
  command -v "$1" >/dev/null 2>&1
}

check_command() {
  local command_name="$1"
  local label="$2"
  if have_command "$command_name"; then
    add_check pass "$label" "$(command -v "$command_name")"
  else
    add_check fail "$label" "$command_name is not installed or not on PATH"
  fi
}

check_file() {
  local file_path="$1"
  local label="$2"
  if [[ -f "$file_path" ]]; then
    add_check pass "$label" "$file_path"
  else
    add_check fail "$label" "missing: $file_path"
  fi
}

check_file "$repo_root/package.json" "project package"
if [[ -d "$repo_root/.git" ]] &&
   [[ "$(git -C "$repo_root" remote get-url origin 2>/dev/null)" == "https://github.com/effacermonexistence/codex.git" ]]; then
  add_check pass "GitHub checkout" "local repository has the expected origin"
else
  add_check fail "GitHub checkout" "run scripts/finish-new-mac.sh after GitHub OAuth"
fi
check_file "$repo_root/wrangler.jsonc" "wrangler config"
check_file "$repo_root/codex/AGENTS.md" "durable Codex guidance"
check_file "$repo_root/CLAUDE.md" "durable Claude guidance"
check_file "$repo_root/claude/settings.json" "durable Claude settings"
check_file "$repo_root/claude/hooks/remote-backup-guard.mjs" "durable remote guard"
check_file "$codex_config_dir/AGENTS.md" "installed Codex guidance"
check_file "$claude_config_dir/CLAUDE.md" "installed Claude guidance"
check_file "$claude_config_dir/settings.json" "installed Claude settings"
check_file "$claude_config_dir/hooks/remote-backup-guard.mjs" "installed remote guard"

if [[ -f "$repo_root/codex/AGENTS.md" && -f "$codex_config_dir/AGENTS.md" ]]; then
  if cmp -s "$repo_root/codex/AGENTS.md" "$codex_config_dir/AGENTS.md"; then
    add_check pass "Codex guidance sync" "durable and installed AGENTS.md match"
  else
    add_check fail "Codex guidance sync" "installed AGENTS.md differs from the durable source"
  fi
fi

if [[ -f "$repo_root/codex/AGENTS.md" ]] &&
   grep -Fq '## Global completion persistence' "$repo_root/codex/AGENTS.md"; then
  add_check pass "completion persistence" "global completion rule is present"
else
  add_check fail "completion persistence" "global completion rule is missing"
fi

if [[ -f "$repo_root/codex/AGENTS.md" ]] &&
   grep -Fq 'Do not infer that GitHub is disconnected' "$repo_root/codex/AGENTS.md"; then
  add_check pass "connection discovery" "connector-first GitHub discovery rule is present"
else
  add_check fail "connection discovery" "connector-first GitHub discovery rule is missing"
fi

if [[ -f "$repo_root/codex/AGENTS.md" ]] &&
   grep -Fq '## SCV Instagram red-team and system-check phrases' "$repo_root/codex/AGENTS.md" &&
   grep -Fq 'Every authorized red-team or system-check run must begin with a fresh' "$repo_root/codex/AGENTS.md" &&
   grep -Fq 'Omar.system reset before accepting or generating the first test input' "$repo_root/codex/AGENTS.md" &&
   grep -Fq 'is deployed and verified, a fresh exact-target Omar.system reset through the' "$repo_root/codex/AGENTS.md" &&
   grep -Fq 'same gates is a mandatory default completion step' "$repo_root/codex/AGENTS.md"; then
  add_check pass "Omar.system reset default" "red-team phrases and every deployed SCV fix require a fresh exact-target reset"
else
  add_check fail "Omar.system reset default" "persistent pre-red-team or post-fix reset rule is missing"
fi

if [[ -f "$repo_root/CLAUDE.md" && -f "$claude_config_dir/CLAUDE.md" ]]; then
  if cmp -s "$repo_root/CLAUDE.md" "$claude_config_dir/CLAUDE.md"; then
    add_check pass "Claude guidance sync" "durable and installed CLAUDE.md match"
  else
    add_check fail "Claude guidance sync" "installed CLAUDE.md differs from the durable source"
  fi
fi

if [[ -f "$repo_root/claude/hooks/remote-backup-guard.mjs" && -f "$claude_config_dir/hooks/remote-backup-guard.mjs" ]]; then
  if cmp -s "$repo_root/claude/hooks/remote-backup-guard.mjs" "$claude_config_dir/hooks/remote-backup-guard.mjs"; then
    add_check pass "remote guard sync" "durable and installed hooks match"
  else
    add_check fail "remote guard sync" "installed remote guard differs from the durable source"
  fi
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  add_check pass "macOS host" "$(sw_vers -productVersion 2>/dev/null || uname -r)"
  handy_app="$HOME/Applications/Handy.app"
  if [[ ! -d "$handy_app" && -d /Applications/Handy.app ]]; then
    handy_app=/Applications/Handy.app
  fi
  if [[ -d "$handy_app" ]] &&
     [[ "$(plutil -extract CFBundleShortVersionString raw -o - "$handy_app/Contents/Info.plist" 2>/dev/null)" == "0.9.7" ]] &&
     codesign --verify --deep --strict "$handy_app" >/dev/null 2>&1 &&
     [[ "$(codesign -dv --verbose=2 "$handy_app" 2>&1)" == *"TeamIdentifier=UWFLB4GC25"* ]]; then
    add_check pass "Handy app" "$handy_app"
  else
    add_check fail "Handy app" "official signed Handy app is missing"
  fi
  handy_model="$HOME/Library/Application Support/com.pais.handy/models/whisper-medium-q4_1.bin"
  if [[ -f "$handy_model" ]] &&
     [[ "$(shasum -a 256 "$handy_model" | awk '{print $1}')" == "79283fc1f9fe12ca3248543fbd54b73292164d8df5a16e095e2bceeaaabddf57" ]]; then
    add_check pass "Handy speech model" "Whisper Medium hash matches"
  else
    add_check fail "Handy speech model" "Whisper Medium is missing or has a different hash"
  fi
  handy_settings="$HOME/Library/Application Support/com.pais.handy/settings_store.json"
  if [[ -f "$handy_settings" ]] && node - "$handy_settings" <<'NODE'
const fs = require('node:fs');
const s = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).settings;
process.exit(s?.bindings?.transcribe?.current_binding === 'fn' &&
  s.audio_feedback === true && s.sound_theme === 'marimba' &&
  s.selected_model === 'medium' ? 0 : 1);
NODE
  then
    add_check pass "Handy Fn and sound" "Fn transcription and Marimba feedback configured"
  else
    add_check fail "Handy Fn and sound" "run scripts/configure-new-mac.sh"
  fi
  if [[ "$(defaults read com.apple.HIToolbox AppleFnUsageType 2>/dev/null)" == "0" ]]; then
    add_check pass "Fn emoji action" "disabled"
  else
    add_check fail "Fn emoji action" "macOS still uses Fn/Globe for another action"
  fi
  if [[ "$(osascript -e 'tell application "System Events" to get picture of every desktop' 2>/dev/null)" == *"$HOME/Pictures/black-000000.png"* ]]; then
    add_check pass "black desktop" "pure black wallpaper selected"
  else
    add_check fail "black desktop" "pure black wallpaper is not selected"
  fi
  dock_apps="$(defaults export com.apple.dock - 2>/dev/null | plutil -extract persistent-apps raw -o - - 2>/dev/null || true)"
  dock_others="$(defaults export com.apple.dock - 2>/dev/null | plutil -extract persistent-others raw -o - - 2>/dev/null || true)"
  dock_recents="$(defaults read com.apple.dock show-recents 2>/dev/null || true)"
  if [[ "$dock_apps" == "0" && "$dock_others" == "0" && "$dock_recents" == "0" ]]; then
    add_check pass "empty Dock" "no pinned apps or folders; suggested and recent apps disabled"
  else
    add_check fail "empty Dock" "run scripts/configure-new-mac.sh"
  fi
  if launchctl print "gui/$(id -u)/com.effacermonexistence.always-on" 2>/dev/null | grep -F 'state = running' >/dev/null; then
    add_check pass "idle Always On" "caffeinate launch agent is running"
  else
    add_check fail "idle Always On" "caffeinate launch agent is not running"
  fi
  if [[ -f "$codex_config_dir/config.toml" ]] &&
     grep -Eq '^followUpQueueMode[[:space:]]*=[[:space:]]*"queue"' "$codex_config_dir/config.toml"; then
    add_check pass "Codex follow-up queue" "queue mode configured"
  else
    add_check fail "Codex follow-up queue" "queue mode is not configured"
  fi
else
  add_check warn "macOS host" "not macOS: $(uname -s)"
fi

check_command git "git"
check_command curl "curl"
check_command tar "tar"
check_command node "node"
check_command pnpm "pnpm"
check_command gh "GitHub CLI"
check_command claude "Claude Code"

if have_command gh; then
  if gh auth status >/dev/null 2>&1; then
    add_check pass "GitHub login" "gh is authenticated"
  else
    add_check warn "GitHub login" "run: gh auth login --hostname github.com --git-protocol https --web"
  fi
fi

if have_command claude; then
  if claude auth status 2>/dev/null | grep -q '"loggedIn": true'; then
    add_check pass "Claude login" "claude is authenticated"
  else
    add_check warn "Claude login" "run: claude auth login"
  fi

  claude_mcp_status="$(claude mcp get cloudflare-api 2>/dev/null || true)"
  if [[ "$claude_mcp_status" == *"Needs authentication"* ]]; then
    add_check warn "Cloudflare MCP" "run: claude mcp login cloudflare-api"
  elif [[ -n "$claude_mcp_status" ]]; then
    add_check pass "Cloudflare MCP" "cloudflare-api configured and authenticated"
  else
    add_check warn "Cloudflare MCP" "run: claude mcp add --transport http --scope user cloudflare-api https://mcp.cloudflare.com/mcp"
  fi
fi

if have_command pnpm; then
  if (cd "$repo_root" && pnpm exec wrangler --version >/dev/null 2>&1); then
    add_check pass "Wrangler CLI" "$(cd "$repo_root" && pnpm exec wrangler --version 2>/dev/null | head -1)"
  else
    add_check fail "Wrangler CLI" "run from $repo_root: pnpm install --frozen-lockfile"
  fi

  if [[ ! -f "$repo_root/worker-configuration.d.ts" ]]; then
    (cd "$repo_root" && pnpm run types >/dev/null 2>&1)
  fi

  if (cd "$repo_root" && pnpm run check >/dev/null 2>&1); then
    add_check pass "TypeScript check" "pnpm run check"
  else
    add_check fail "TypeScript check" "pnpm run check failed"
  fi
fi

if [[ "$skip_cloudflare" -eq 0 ]] && have_command pnpm; then
  if wrangler_identity="$(cd "$repo_root" && pnpm exec wrangler whoami 2>&1)"; then
    if [[ "$wrangler_identity" == *"$cloudflare_account_id"* ]]; then
      add_check pass "Cloudflare login" "Wrangler is connected to the expected account"
    else
      add_check fail "Cloudflare login" "Wrangler is connected to a different Cloudflare account"
    fi
  else
    add_check warn "Cloudflare login" "run from $repo_root: pnpm exec wrangler login"
  fi

  bucket_visible=0
  for attempt in 1 2; do
    if bucket_list="$(cd "$repo_root" && pnpm exec wrangler r2 bucket list 2>&1)" &&
       grep -Eq "^name:[[:space:]]+$backup_bucket$" <<< "$bucket_list"; then
      bucket_visible=1
      break
    fi
  done
  if [[ "$bucket_visible" -eq 1 ]]; then
    add_check pass "R2 bucket" "$backup_bucket is visible"
  else
    add_check warn "R2 bucket" "$backup_bucket is not visible from this login"
  fi

  if (cd "$repo_root" && pnpm exec wrangler r2 object get "$backup_bucket/git-bundles/effacermonexistence/codex/latest.json" --remote --pipe >/dev/null 2>&1); then
    add_check pass "R2 backup read" "$backup_bucket latest codex manifest is readable"
  else
    add_check warn "R2 backup read" "R2 manifest not readable from this login yet"
  fi

  if curl -fsS "$backup_worker_url" >/dev/null 2>&1; then
    add_check pass "backup Worker health" "$backup_worker_url"
  else
    add_check warn "backup Worker health" "$backup_worker_url did not return healthy"
  fi
fi

if [[ "$json_output" -eq 1 ]]; then
  printf '{"ok":%s,"failures":%d,"warnings":%d,"checks":[' \
    "$([[ "$failures" -eq 0 ]] && printf true || printf false)" \
    "$failures" \
    "$warnings"
  first=1
  for item in "${checks[@]}"; do
    IFS=$'\t' read -r status name detail <<<"$item"
    [[ "$first" -eq 0 ]] && printf ','
    first=0
    node -e 'process.stdout.write(JSON.stringify({status:process.argv[1],name:process.argv[2],detail:process.argv[3]}))' "$status" "$name" "$detail"
  done
  printf ']}\n'
else
  echo "Omar OS One Codex doctor"
  echo
  for item in "${checks[@]}"; do
    IFS=$'\t' read -r status name detail <<<"$item"
    case "$status" in
      pass) marker="PASS" ;;
      warn) marker="WARN" ;;
      fail) marker="FAIL" ;;
    esac
    printf '%-4s  %-24s %s\n' "$marker" "$name" "$detail"
  done
  echo
  printf 'Result: %d failure(s), %d warning(s)\n' "$failures" "$warnings"
fi

if [[ "$failures" -gt 0 ]]; then
  exit 1
fi
if [[ "$strict" -eq 1 && "$warnings" -gt 0 ]]; then
  exit 1
fi
