#!/bin/bash
set -Eeuo pipefail

TASK_ROLE="${1:-}"
if [[ "$TASK_ROLE" != "pro" && "$TASK_ROLE" != "air" ]]; then
  echo "usage: $0 pro|air" >&2
  exit 2
fi

TASK_PRODUCT_ROOT="$(cd "$(dirname "$0")" && pwd)"
TASK_DASHBOARD_SOURCE="$TASK_PRODUCT_ROOT/dashboard-build"
TASK_OVERLAY_SOURCE="$TASK_PRODUCT_ROOT/os1_exo_activity_overlay.py"
TASK_BOOTSTRAP_SOURCE="$TASK_PRODUCT_ROOT/os1_exo_activity_bootstrap.pth"
for task_required in "$TASK_DASHBOARD_SOURCE/index.html" "$TASK_OVERLAY_SOURCE" "$TASK_BOOTSTRAP_SOURCE"
do
  [[ -e "$task_required" ]] || { echo "missing product artifact: $task_required" >&2; exit 1; }
done

TASK_USER_NAME="$(id -un)"
TASK_USER_HOME="$(dscl . -read "/Users/$TASK_USER_NAME" NFSHomeDirectory | awk '{print $2}')"
TASK_USER_UID="$(id -u)"
TASK_TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/os1-exo-activity.XXXXXX")"
TASK_SWITCHED=0
TASK_PLIST=""
TASK_PLIST_BACKUP=""
TASK_SOURCE_MODE=0
TASK_OVERLAY_DEST=""
TASK_BOOTSTRAP_DEST=""
TASK_OVERLAY_BACKUP=""
TASK_BOOTSTRAP_BACKUP=""
TASK_OVERLAY_EXISTED=0
TASK_BOOTSTRAP_EXISTED=0

cleanup() {
  if [[ -d "$TASK_TEMP_ROOT" && "$TASK_TEMP_ROOT" == *os1-exo-activity.* ]]; then
    rm -rf "$TASK_TEMP_ROOT"
  fi
}

restore_source_overlay() {
  if [[ "$TASK_SOURCE_MODE" -ne 1 ]]; then
    return
  fi
  if [[ "$TASK_OVERLAY_EXISTED" -eq 1 && -f "$TASK_OVERLAY_BACKUP" ]]; then
    cp "$TASK_OVERLAY_BACKUP" "$TASK_OVERLAY_DEST"
  elif [[ -n "$TASK_OVERLAY_DEST" && -f "$TASK_OVERLAY_DEST" ]]; then
    unlink "$TASK_OVERLAY_DEST"
  fi
  if [[ "$TASK_BOOTSTRAP_EXISTED" -eq 1 && -f "$TASK_BOOTSTRAP_BACKUP" ]]; then
    cp "$TASK_BOOTSTRAP_BACKUP" "$TASK_BOOTSTRAP_DEST"
  elif [[ -n "$TASK_BOOTSTRAP_DEST" && -f "$TASK_BOOTSTRAP_DEST" ]]; then
    unlink "$TASK_BOOTSTRAP_DEST"
  fi
}

rollback() {
  local task_exit_code=$?
  if [[ "$TASK_SWITCHED" -eq 1 && -f "$TASK_PLIST_BACKUP" && -n "$TASK_PLIST" ]]; then
    launchctl bootout "gui/$TASK_USER_UID" "$TASK_PLIST" >/dev/null 2>&1 || true
    restore_source_overlay
    cp "$TASK_PLIST_BACKUP" "$TASK_PLIST"
    launchctl bootstrap "gui/$TASK_USER_UID" "$TASK_PLIST" >/dev/null 2>&1 || true
    echo "EXO activity monitor install failed; prior service restored." >&2
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
[[ -f "$TASK_PLIST" ]] || { echo "exact EXO LaunchAgent not found for $TASK_ROLE" >&2; exit 1; }

TASK_LABEL="$(plutil -extract Label raw "$TASK_PLIST")"
TASK_BASE_EXECUTABLE="$(plutil -extract ProgramArguments.0 raw "$TASK_PLIST")"
[[ -x "$TASK_BASE_EXECUTABLE" ]] || { echo "configured EXO executable is missing" >&2; exit 1; }
TASK_OLD_NODE_ID="$(curl -fsS --max-time 5 http://127.0.0.1:52415/node_id 2>/dev/null | tr -d '"' || true)"
TASK_RELEASE_ID="c3c0b2be"
TASK_RUNTIME="$TASK_USER_HOME/.os1/exo-1.0.71-activity-monitor-$TASK_RELEASE_ID"
if [[ -e "$TASK_RUNTIME" ]]; then
  TASK_RUNTIME="$TASK_RUNTIME-$(date -u +%Y%m%dT%H%M%SZ)"
fi
mkdir -p "$TASK_RUNTIME/dashboard"
cp -R "$TASK_DASHBOARD_SOURCE/." "$TASK_RUNTIME/dashboard/"

TASK_RECOVERY="$TASK_USER_HOME/.os1/recovery/exo-activity-monitor-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$TASK_RECOVERY"
TASK_PLIST_BACKUP="$TASK_RECOVERY/$(basename "$TASK_PLIST").before"
cp "$TASK_PLIST" "$TASK_PLIST_BACKUP"

if [[ "$(basename "$TASK_BASE_EXECUTABLE")" == "run-air.sh" ]]; then
  TASK_SOURCE_MODE=1
  TASK_SOURCE_ROOT="$(dirname "$TASK_BASE_EXECUTABLE")"
  TASK_PYTHON=""
  for task_candidate in \
    "$TASK_SOURCE_ROOT/runtime-venv/bin/python" \
    "$(dirname "$TASK_SOURCE_ROOT")/runtime-venv/bin/python"
  do
    if [[ -x "$task_candidate" ]]; then
      TASK_PYTHON="$task_candidate"
      break
    fi
  done
  [[ -n "$TASK_PYTHON" ]] || { echo "Air EXO runtime Python was not found" >&2; exit 1; }
  TASK_SITE_PACKAGES="$("$TASK_PYTHON" -c 'import site; print(site.getsitepackages()[0])')"
  [[ -d "$TASK_SITE_PACKAGES/exo/api" ]] || { echo "Air EXO source package was not found" >&2; exit 1; }

  TASK_OVERLAY_DEST="$TASK_SITE_PACKAGES/os1_exo_activity_overlay.py"
  TASK_BOOTSTRAP_DEST="$TASK_SITE_PACKAGES/os1_exo_activity_bootstrap.pth"
  TASK_OVERLAY_BACKUP="$TASK_RECOVERY/os1_exo_activity_overlay.py.before"
  TASK_BOOTSTRAP_BACKUP="$TASK_RECOVERY/os1_exo_activity_bootstrap.pth.before"
  if [[ -f "$TASK_OVERLAY_DEST" ]]; then
    TASK_OVERLAY_EXISTED=1
    cp "$TASK_OVERLAY_DEST" "$TASK_OVERLAY_BACKUP"
  fi
  if [[ -f "$TASK_BOOTSTRAP_DEST" ]]; then
    TASK_BOOTSTRAP_EXISTED=1
    cp "$TASK_BOOTSTRAP_DEST" "$TASK_BOOTSTRAP_BACKUP"
  fi
  cp "$TASK_OVERLAY_SOURCE" "$TASK_OVERLAY_DEST.new"
  mv "$TASK_OVERLAY_DEST.new" "$TASK_OVERLAY_DEST"
  cp "$TASK_BOOTSTRAP_SOURCE" "$TASK_BOOTSTRAP_DEST.new"
  mv "$TASK_BOOTSTRAP_DEST.new" "$TASK_BOOTSTRAP_DEST"
  TASK_NEW_EXECUTABLE="$TASK_BASE_EXECUTABLE"
else
  TASK_EXO_COMMIT="c3c0b2bea196ceed8d9feda9036c58e4d7a424fd"
  TASK_SOURCE="$TASK_TEMP_ROOT/exo"
  git clone --filter=blob:none --no-checkout https://github.com/effacermonexistence/exo.git "$TASK_SOURCE"
  git -C "$TASK_SOURCE" checkout --detach "$TASK_EXO_COMMIT"
  [[ "$(git -C "$TASK_SOURCE" rev-parse HEAD)" == "$TASK_EXO_COMMIT" ]]

  TASK_UV="$(command -v uv || true)"
  [[ -n "$TASK_UV" ]] || TASK_UV="$TASK_USER_HOME/.local/bin/uv"
  [[ -x "$TASK_UV" ]] || { echo "uv is required to rebuild the packaged Pro runtime" >&2; exit 1; }
  "$TASK_UV" venv --python 3.13 "$TASK_TEMP_ROOT/pyi"
  "$TASK_UV" pip install --python "$TASK_TEMP_ROOT/pyi/bin/python" pyinstaller==6.17.0
  TASK_BOOTLOADER="$TASK_TEMP_ROOT/pyi/lib/python3.13/site-packages/PyInstaller/bootloader/Darwin-64bit/run"
  lipo "$TASK_BOOTLOADER" -thin arm64 -output "$TASK_RUNTIME/pyi-bootloader-arm64"
  codesign --remove-signature "$TASK_RUNTIME/pyi-bootloader-arm64"
  mkdir -p "$TASK_RUNTIME/bin"
  TASK_PACKAGE_BASE="$TASK_BASE_EXECUTABLE"
  if [[ "$TASK_PACKAGE_BASE" == *activity-monitor* ]]; then
    for task_candidate in \
      "$TASK_USER_HOME/.os1/exo-1.0.71-persistent-runtime-r6/bin/exo" \
      "/Applications/EXO.app/Contents/Resources/exo/exo"
    do
      if [[ -x "$task_candidate" ]]; then
        TASK_PACKAGE_BASE="$task_candidate"
        break
      fi
    done
  fi
  "$TASK_TEMP_ROOT/pyi/bin/python" "$TASK_SOURCE/scripts/build_activity_runtime.py" \
    --base-executable "$TASK_PACKAGE_BASE" \
    --source-main "$TASK_SOURCE/src/exo/api/main.py" \
    --bootloader "$TASK_RUNTIME/pyi-bootloader-arm64" \
    --output-executable "$TASK_RUNTIME/bin/exo" \
    --output-pyz "$TASK_RUNTIME/bin/PYZ.activity-monitor.pyz"
  TASK_INTERNAL="$(dirname "$TASK_BASE_EXECUTABLE")/_internal"
  [[ -d "$TASK_INTERNAL" ]] || TASK_INTERNAL="/Applications/EXO.app/Contents/Resources/exo/_internal"
  [[ -d "$TASK_INTERNAL" ]]
  ln -s "$TASK_INTERNAL" "$TASK_RUNTIME/bin/_internal"
  codesign --force --sign - "$TASK_RUNTIME/bin/exo"
  codesign --verify --strict --verbose=2 "$TASK_RUNTIME/bin/exo"
  TASK_NEW_EXECUTABLE="$TASK_RUNTIME/bin/exo"
  /usr/libexec/PlistBuddy -c "Set :ProgramArguments:0 $TASK_NEW_EXECUTABLE" "$TASK_PLIST"
fi

if ! /usr/libexec/PlistBuddy -c "Set :EnvironmentVariables:EXO_DASHBOARD_DIR $TASK_RUNTIME/dashboard" "$TASK_PLIST"; then
  /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:EXO_DASHBOARD_DIR string $TASK_RUNTIME/dashboard" "$TASK_PLIST"
fi
if [[ -f "$TASK_USER_HOME/.local/bin/config.json" ]]; then
  if ! /usr/libexec/PlistBuddy -c "Set :EnvironmentVariables:OS1_CONFIG $TASK_USER_HOME/.local/bin/config.json" "$TASK_PLIST"; then
    /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:OS1_CONFIG string $TASK_USER_HOME/.local/bin/config.json" "$TASK_PLIST"
  fi
fi

TASK_SWITCHED=1
launchctl bootout "gui/$TASK_USER_UID" "$TASK_PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$TASK_USER_UID" "$TASK_PLIST"

for task_attempt in $(seq 1 90)
do
  curl -fsS --max-time 3 http://127.0.0.1:52415/activity/local >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS --max-time 10 http://127.0.0.1:52415/activity/local >/dev/null
TASK_NEW_NODE_ID="$(curl -fsS --max-time 5 http://127.0.0.1:52415/node_id | tr -d '"')"
if [[ -n "$TASK_OLD_NODE_ID" && "$TASK_NEW_NODE_ID" != "$TASK_OLD_NODE_ID" ]]; then
  echo "EXO peer identity changed unexpectedly" >&2
  exit 1
fi

TASK_TOPOLOGY_NODES=0
for task_attempt in $(seq 1 180)
do
  TASK_TOPOLOGY_NODES="$(curl -fsS --max-time 3 http://127.0.0.1:52415/state/topology 2>/dev/null | jq '.nodes | length' || echo 0)"
  [[ "$TASK_TOPOLOGY_NODES" -eq 2 ]] && break
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
