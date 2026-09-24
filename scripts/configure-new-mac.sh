#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This setup requires macOS." >&2
  exit 1
fi

readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly handy_version="0.9.7"
readonly handy_team="UWFLB4GC25"
readonly handy_model_sha="79283fc1f9fe12ca3248543fbd54b73292164d8df5a16e095e2bceeaaabddf57"
readonly handy_model_url="https://blob.handy.computer/whisper-medium-q4_1.bin"
readonly handy_model="$HOME/Library/Application Support/com.pais.handy/models/whisper-medium-q4_1.bin"
readonly handy_settings="$HOME/Library/Application Support/com.pais.handy/settings_store.json"
readonly codex_config="${OMAR_CODEX_CONFIG_DIR:-$HOME/.codex}/config.toml"
readonly wallpaper="$HOME/Pictures/black-000000.png"
readonly agent_label="com.effacermonexistence.always-on"
readonly agent_file="$HOME/Library/LaunchAgents/$agent_label.plist"

export PATH="$HOME/.local/share/node-v24.20.0/bin:$HOME/.local/bin:$PATH"

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

has_handy() {
  local candidate="$1"
  local signature
  [[ -d "$candidate" ]] || return 1
  [[ "$(plutil -extract CFBundleShortVersionString raw -o - "$candidate/Contents/Info.plist" 2>/dev/null)" == "$handy_version" ]] || return 1
  codesign --verify --deep --strict "$candidate" >/dev/null 2>&1 || return 1
  signature="$(codesign -dv --verbose=2 "$candidate" 2>&1)" || return 1
  [[ "$signature" == *"TeamIdentifier=$handy_team"* ]]
}

handy_app=""
for candidate in "$HOME/Applications/Handy.app" /Applications/Handy.app; do
  if has_handy "$candidate"; then
    handy_app="$candidate"
    break
  fi
done

if [[ -z "$handy_app" ]]; then
  case "$(uname -m)" in
    arm64)
      handy_archive="Handy_aarch64.app.tar.gz"
      handy_sha="77c053f25ae62ab464f02e85fdff57bb27802b36bdede8c932124726e5b6dbfb"
      ;;
    x86_64)
      handy_archive="Handy_x64.app.tar.gz"
      handy_sha="e1a0355f8517270a4a9189ce50c7863b356258bac70cc83ce642727f5175f29f"
      ;;
    *) echo "Unsupported Mac architecture: $(uname -m)" >&2; exit 1 ;;
  esac
  curl -fL --retry 3 --proto '=https' --tlsv1.2 \
    -o "$work_dir/$handy_archive" \
    "https://github.com/cjpais/Handy/releases/download/v$handy_version/$handy_archive"
  printf '%s  %s\n' "$handy_sha" "$work_dir/$handy_archive" | shasum -a 256 -c -
  mkdir -p "$work_dir/handy-stage" "$HOME/Applications"
  tar -xzf "$work_dir/$handy_archive" -C "$work_dir/handy-stage"
  has_handy "$work_dir/handy-stage/Handy.app" || {
    echo "Handy signature or version verification failed." >&2
    exit 1
  }
  handy_app="$HOME/Applications/Handy.app"
  if [[ -e "$handy_app" ]]; then
    mv "$handy_app" "$handy_app.before-omar-bootstrap.$(date -u +%Y%m%dT%H%M%SZ)"
  fi
  ditto "$work_dir/handy-stage/Handy.app" "$handy_app"
  has_handy "$handy_app" || {
    echo "Installed Handy verification failed." >&2
    exit 1
  }
fi

mkdir -p "$(dirname "$handy_model")"
if [[ ! -f "$handy_model" ]] ||
   [[ "$(shasum -a 256 "$handy_model" | awk '{print $1}')" != "$handy_model_sha" ]]; then
  curl -fL --retry 3 --proto '=https' --tlsv1.2 \
    -o "$work_dir/whisper-medium-q4_1.bin" "$handy_model_url"
  printf '%s  %s\n' "$handy_model_sha" "$work_dir/whisper-medium-q4_1.bin" | shasum -a 256 -c -
  install -m 0644 "$work_dir/whisper-medium-q4_1.bin" "$handy_model"
fi

# Handy 0.9.7 fills omitted fields with its own defaults. Keep existing device
# and user choices, including microphones, history and any post-processing keys.
if [[ -f "$handy_settings" ]] &&
   ! node - "$handy_settings" <<'NODE'
const fs = require('node:fs');
const s = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).settings;
process.exit(s?.bindings?.transcribe?.current_binding === 'fn' &&
  s.shortcut_activation === 'hold_or_toggle' &&
  s.audio_feedback === true && s.sound_theme === 'marimba' &&
  s.autostart_enabled === true && s.selected_model === 'medium' ? 0 : 1);
NODE
then
  osascript -e 'tell application id "com.pais.handy" to quit' >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -f '/Handy.app/Contents/MacOS/handy$' >/dev/null || break
    sleep 1
  done
  if pgrep -f '/Handy.app/Contents/MacOS/handy$' >/dev/null; then
    echo "Handy is still running; close it before changing its settings." >&2
    exit 1
  fi
fi
node - "$handy_settings" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const file = process.argv[2];
let store = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
store.settings ??= {};
const settings = store.settings;
settings.bindings ??= {};
settings.bindings.transcribe ??= {
  id: 'transcribe', name: 'Transcribe',
  description: 'Converts your speech into text.',
  default_binding: 'option+space',
};
settings.bindings.transcribe.current_binding = 'fn';
settings.shortcut_activation = 'hold_or_toggle';
settings.audio_feedback = true;
settings.audio_feedback_volume = 1.0;
settings.sound_theme = 'marimba';
settings.autostart_enabled = true;
settings.selected_model = 'medium';
settings.selected_language = 'auto';
settings.onboarding_completed = true;
const desired = JSON.stringify(store, null, 2) + '\n';
fs.mkdirSync(path.dirname(file), { recursive: true });
if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== desired) {
  const temp = `${file}.omar-bootstrap-${process.pid}`;
  fs.writeFileSync(temp, desired, { mode: 0o600 });
  fs.renameSync(temp, file);
}
NODE

# Keep Globe/Fn available to Handy while disabling macOS's emoji action.
defaults write com.apple.HIToolbox AppleFnUsageType -int 0
if [[ "$(defaults read com.apple.HIToolbox AppleFnUsageType)" != "0" ]]; then
  echo "Fn/Globe macOS preference verification failed." >&2
  exit 1
fi

mkdir -p "$(dirname "$wallpaper")"
if [[ ! -f "$wallpaper" ]] ||
   ! cmp -s "$repo_root/assets/mac/black-000000.png" "$wallpaper"; then
  install -m 0644 "$repo_root/assets/mac/black-000000.png" "$wallpaper"
fi
current_wallpaper="$(osascript -e 'tell application "System Events" to get picture of every desktop' 2>/dev/null || true)"
if [[ "$current_wallpaper" != *"$wallpaper"* ]]; then
  osascript - "$wallpaper" <<'APPLESCRIPT'
on run argv
  tell application "System Events"
    set picture of every desktop to (POSIX file (item 1 of argv))
  end tell
end run
APPLESCRIPT
fi

# Clear the removable Dock shortcuts, including the Downloads stack. Finder,
# Trash, and icons for running apps remain under macOS control.
dock_item_count() {
  defaults export com.apple.dock - 2>/dev/null |
    plutil -extract "$1" raw -o - - 2>/dev/null || printf 'missing'
}

if [[ "$(dock_item_count persistent-apps)" != "0" ||
      "$(dock_item_count persistent-others)" != "0" ||
      "$(defaults read com.apple.dock show-recents 2>/dev/null || true)" != "0" ]]; then
  dock_backup="$HOME/Library/Preferences/com.apple.dock.before-omar-bootstrap.$(date -u +%Y%m%dT%H%M%SZ).$$.plist"
  defaults export com.apple.dock "$dock_backup"
  echo "Preserved existing Dock settings: $dock_backup"
  defaults write com.apple.dock persistent-apps -array
  defaults write com.apple.dock persistent-others -array
  defaults write com.apple.dock show-recents -bool false
  killall Dock >/dev/null 2>&1 || true
fi
if [[ "$(dock_item_count persistent-apps)" != "0" ||
      "$(dock_item_count persistent-others)" != "0" ||
      "$(defaults read com.apple.dock show-recents 2>/dev/null || true)" != "0" ]]; then
  echo "Dock verification failed: removable items or recent apps remain." >&2
  exit 1
fi

mkdir -p "$(dirname "$agent_file")"
if [[ ! -f "$agent_file" ]] ||
   ! cmp -s "$repo_root/assets/mac/$agent_label.plist" "$agent_file"; then
  install -m 0644 "$repo_root/assets/mac/$agent_label.plist" "$agent_file"
  launchctl bootout "gui/$(id -u)/$agent_label" >/dev/null 2>&1 || true
fi
if ! launchctl print "gui/$(id -u)/$agent_label" >/dev/null 2>&1; then
  launchctl bootstrap "gui/$(id -u)" "$agent_file"
fi
launchctl kickstart "gui/$(id -u)/$agent_label"

node - "$codex_config" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const file = process.argv[2];
let content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const section = /^\[desktop\]\s*$/m;
if (section.test(content)) {
  const start = content.search(section);
  const next = content.slice(start + 1).search(/^\[/m);
  const end = next < 0 ? content.length : start + 1 + next;
  let block = content.slice(start, end);
  if (/^followUpQueueMode\s*=/m.test(block)) {
    block = block.replace(/^followUpQueueMode\s*=.*$/m, 'followUpQueueMode = "queue"');
  } else {
    block = block.replace(/^\[desktop\]\s*$/m, '[desktop]\nfollowUpQueueMode = "queue"');
  }
  content = content.slice(0, start) + block + content.slice(end);
} else {
  content = `${content.trimEnd()}\n\n[desktop]\nfollowUpQueueMode = "queue"\n`;
}
fs.mkdirSync(path.dirname(file), { recursive: true });
if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) {
  const temp = `${file}.omar-bootstrap-${process.pid}`;
  fs.writeFileSync(temp, content, { mode: 0o600 });
  fs.renameSync(temp, file);
}
NODE

open -a "$handy_app"

[[ "$(shasum -a 256 "$handy_model" | awk '{print $1}')" == "$handy_model_sha" ]]
[[ "$(osascript -e 'tell application "System Events" to get picture of every desktop')" == *"$wallpaper"* ]]
agent_status="$(launchctl print "gui/$(id -u)/$agent_label")"
[[ "$agent_status" == *'state = running'* ]]
node - "$handy_settings" "$codex_config" <<'NODE'
const fs = require('node:fs');
const [handy, codex] = process.argv.slice(2);
const s = JSON.parse(fs.readFileSync(handy, 'utf8')).settings;
if (s.bindings?.transcribe?.current_binding !== 'fn' ||
    s.audio_feedback !== true || s.sound_theme !== 'marimba' ||
    s.selected_model !== 'medium' || s.autostart_enabled !== true) process.exit(1);
if (!/^followUpQueueMode\s*=\s*"queue"\s*$/m.test(fs.readFileSync(codex, 'utf8'))) process.exit(1);
NODE

echo "Mac defaults ready: Handy Fn + sound + medium model, emoji off, pure black wallpaper, idle Always On, Codex queue."
echo "Dock ready: no pinned apps or folders; suggested and recent apps disabled."
echo "Approve Handy microphone/Accessibility prompts on this Mac if macOS shows them; restart an already-open Codex app to load queue mode."
