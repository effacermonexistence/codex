#!/bin/bash
set -Eeuo pipefail

TASK_ROLE="${1:-}"
if [[ "$TASK_ROLE" != "pro" && "$TASK_ROLE" != "air" ]]; then
  echo "usage: $0 pro|air" >&2
  exit 2
fi

TASK_USER_NAME="$(id -un)"
TASK_USER_HOME="$(dscl . -read "/Users/$TASK_USER_NAME" NFSHomeDirectory | awk '{print $2}')"
TASK_USER_UID="$(id -u)"
TASK_TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/os1-exo-activity.XXXXXX")"
TASK_SWITCHED=0
TASK_PLIST_BACKUP=""
TASK_PLIST=""

cleanup() {
  if [[ -d "$TASK_TEMP_ROOT" && "$TASK_TEMP_ROOT" == *os1-exo-activity.* ]]; then
    rm -rf "$TASK_TEMP_ROOT"
  fi
}

rollback() {
  local task_exit_code=$?
  if [[ "$TASK_SWITCHED" -eq 1 && -f "$TASK_PLIST_BACKUP" && -n "$TASK_PLIST" ]]; then
    launchctl bootout "gui/$TASK_USER_UID" "$TASK_PLIST" >/dev/null 2>&1 || true
    cp "$TASK_PLIST_BACKUP" "$TASK_PLIST"
    launchctl bootstrap "gui/$TASK_USER_UID" "$TASK_PLIST" >/dev/null 2>&1 || true
    echo "EXO activity monitor install failed; prior LaunchAgent restored." >&2
  fi
  cleanup
  exit "$task_exit_code"
}
trap rollback ERR
trap cleanup EXIT

if [[ "$TASK_ROLE" == "pro" ]]; then
  TASK_PLIST="$TASK_USER_HOME/Library/LaunchAgents/com.os1.exo-pro-stable.plist"
else
  for task_candidate in \
    "$TASK_USER_HOME/Library/LaunchAgents/com.os1.exo-air.plist" \
    "$TASK_USER_HOME/Library/LaunchAgents/com.os1.exo-air-stable.plist"
  do
    if [[ -f "$task_candidate" ]]; then
      TASK_PLIST="$task_candidate"
      break
    fi
  done
fi

if [[ ! -f "$TASK_PLIST" ]]; then
  echo "Exact EXO LaunchAgent for role $TASK_ROLE was not found." >&2
  exit 1
fi

TASK_LABEL="$(plutil -extract Label raw "$TASK_PLIST")"
TASK_BASE_EXECUTABLE="$(plutil -extract ProgramArguments.0 raw "$TASK_PLIST")"
if [[ ! -x "$TASK_BASE_EXECUTABLE" ]]; then
  echo "Configured EXO executable is missing: $TASK_BASE_EXECUTABLE" >&2
  exit 1
fi

TASK_OLD_NODE_ID="$(curl -fsS --max-time 5 http://127.0.0.1:52415/node_id 2>/dev/null | tr -d '"' || true)"
TASK_OVERLAY_COMMIT="a229544390c4a131c80382e931fcc479f47ac814"
TASK_SOURCE="$TASK_TEMP_ROOT/exo"
git clone --filter=blob:none --no-checkout https://github.com/effacermonexistence/exo.git "$TASK_SOURCE"
git -C "$TASK_SOURCE" checkout --detach "$TASK_OVERLAY_COMMIT"
[[ "$(git -C "$TASK_SOURCE" rev-parse HEAD)" == "$TASK_OVERLAY_COMMIT" ]]

npm --prefix "$TASK_SOURCE/dashboard" ci
npm --prefix "$TASK_SOURCE/dashboard" run build

uv venv --python 3.13 "$TASK_TEMP_ROOT/pyi"
uv pip install --python "$TASK_TEMP_ROOT/pyi/bin/python" pyinstaller==6.17.0
TASK_BOOTLOADER_SOURCE="$TASK_TEMP_ROOT/pyi/lib/python3.13/site-packages/PyInstaller/bootloader/Darwin-64bit/run"
TASK_BUILD="$TASK_TEMP_ROOT/runtime"
mkdir -p "$TASK_BUILD/bin" "$TASK_BUILD/dashboard"
lipo "$TASK_BOOTLOADER_SOURCE" -thin arm64 -output "$TASK_BUILD/bin/pyi-bootloader-arm64"
codesign --remove-signature "$TASK_BUILD/bin/pyi-bootloader-arm64"
"$TASK_TEMP_ROOT/pyi/bin/python" "$TASK_SOURCE/scripts/build_activity_runtime.py" \
  --base-executable "$TASK_BASE_EXECUTABLE" \
  --source-main "$TASK_SOURCE/src/exo/api/main.py" \
  --bootloader "$TASK_BUILD/bin/pyi-bootloader-arm64" \
  --output-executable "$TASK_BUILD/bin/exo" \
  --output-pyz "$TASK_BUILD/bin/PYZ.activity-monitor.pyz"
cp -R "$TASK_SOURCE/dashboard/build/." "$TASK_BUILD/dashboard/"

TASK_INTERNAL="$(dirname "$TASK_BASE_EXECUTABLE")/_internal"
if [[ ! -d "$TASK_INTERNAL" ]]; then
  TASK_INTERNAL="/Applications/EXO.app/Contents/Resources/exo/_internal"
fi
[[ -d "$TASK_INTERNAL" ]]
ln -s "$TASK_INTERNAL" "$TASK_BUILD/bin/_internal"
codesign --force --sign - "$TASK_BUILD/bin/exo"
codesign --verify --strict --verbose=2 "$TASK_BUILD/bin/exo"

TASK_RUNTIME="$TASK_USER_HOME/.os1/exo-1.0.71-activity-monitor-a2295443"
if [[ -e "$TASK_RUNTIME" ]]; then
  TASK_RUNTIME="$TASK_USER_HOME/.os1/exo-1.0.71-activity-monitor-a2295443-$(date -u +%Y%m%dT%H%M%SZ)"
fi
mv "$TASK_BUILD" "$TASK_RUNTIME"

TASK_RECOVERY="$TASK_USER_HOME/.os1/recovery/exo-activity-monitor-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$TASK_RECOVERY"
TASK_PLIST_BACKUP="$TASK_RECOVERY/$(basename "$TASK_PLIST").before"
cp "$TASK_PLIST" "$TASK_PLIST_BACKUP"

/usr/libexec/PlistBuddy -c "Set :ProgramArguments:0 $TASK_RUNTIME/bin/exo" "$TASK_PLIST"
if ! /usr/libexec/PlistBuddy -c "Set :EnvironmentVariables:EXO_DASHBOARD_DIR $TASK_RUNTIME/dashboard" "$TASK_PLIST"; then
  /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:EXO_DASHBOARD_DIR string $TASK_RUNTIME/dashboard" "$TASK_PLIST"
fi
if [[ -f "$TASK_USER_HOME/.local/bin/config.json" ]]; then
  if ! /usr/libexec/PlistBuddy -c "Set :EnvironmentVariables:OS1_CONFIG $TASK_USER_HOME/.local/bin/config.json" "$TASK_PLIST"; then
    /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:OS1_CONFIG string $TASK_USER_HOME/.local/bin/config.json" "$TASK_PLIST"
  fi
fi
TASK_OLD_PATH="$(plutil -extract EnvironmentVariables.PATH raw "$TASK_PLIST" 2>/dev/null || true)"
TASK_NEW_PATH="$TASK_RUNTIME/bin:${TASK_OLD_PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}"
if ! /usr/libexec/PlistBuddy -c "Set :EnvironmentVariables:PATH $TASK_NEW_PATH" "$TASK_PLIST"; then
  /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:PATH string $TASK_NEW_PATH" "$TASK_PLIST"
fi

TASK_SWITCHED=1
launchctl bootout "gui/$TASK_USER_UID" "$TASK_PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$TASK_USER_UID" "$TASK_PLIST"

for task_attempt in $(seq 1 90)
do
  if curl -fsS --max-time 3 http://127.0.0.1:52415/activity/local >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS --max-time 10 http://127.0.0.1:52415/activity/local >/dev/null

TASK_NEW_NODE_ID="$(curl -fsS --max-time 5 http://127.0.0.1:52415/node_id | tr -d '"')"
if [[ -n "$TASK_OLD_NODE_ID" && "$TASK_NEW_NODE_ID" != "$TASK_OLD_NODE_ID" ]]; then
  echo "EXO peer identity changed unexpectedly." >&2
  exit 1
fi

TASK_TOPOLOGY_NODES=0
for task_attempt in $(seq 1 180)
do
  TASK_TOPOLOGY_NODES="$(curl -fsS --max-time 3 http://127.0.0.1:52415/state/topology 2>/dev/null | jq '.nodes | length' || echo 0)"
  if [[ "$TASK_TOPOLOGY_NODES" -eq 2 ]]; then
    break
  fi
  sleep 1
done
[[ "$TASK_TOPOLOGY_NODES" -eq 2 ]]

TASK_SWITCHED=0
trap - ERR
echo "OS1_EXO_ACTIVITY_READY"
echo "role=$TASK_ROLE"
echo "service=$TASK_LABEL"
echo "node_id=$TASK_NEW_NODE_ID"
echo "topology_nodes=$TASK_TOPOLOGY_NODES"
echo "runtime=$TASK_RUNTIME"
echo "dashboard=http://127.0.0.1:52415/#/activity"
