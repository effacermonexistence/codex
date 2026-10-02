#!/usr/bin/env bash
# Publishes this Mac's OS-1 machine image to private R2 so another of the
# owner's Macs can install it with `os1-machine-sync pro|air`.
#
#   scripts/os1-machine-image/publish.sh [--source-role air|pro]
#
# Immutable parts and the manifest are written first; the mutable pointer
# os1-machine/latest.json is the final write. Every object is read back and
# compared before the script reports success. Requires a clean checkout whose
# HEAD is pushed (the image records that commit) and an existing Wrangler login.
set -Eeuo pipefail

task_fail() {
  echo "publish: $1" >&2
  exit 1
}
trap 'echo "publish: stopped at line $LINENO" >&2' ERR

readonly task_bucket="omar-private-archive"
readonly task_wrangler_version="4.127.1"
readonly task_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly task_root="$(cd "$task_script_dir/../.." && pwd)"
task_source_role="air"
if [[ "${1:-}" == "--source-role" ]]; then
  task_source_role="${2:-}"
fi
[[ "$task_source_role" == "air" || "$task_source_role" == "pro" ]] || task_fail "usage: publish.sh [--source-role air|pro]"

export PATH="$HOME/.local/share/node-v24.20.0/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
task_node="$HOME/.local/share/node-v24.20.0/bin/node"
[[ -x "$task_node" ]] || task_fail "Node.js 24.20.0 is missing"

[[ -z "$(git -C "$task_root" status --porcelain)" ]] || task_fail "the checkout has uncommitted changes"
task_commit="$(git -C "$task_root" rev-parse HEAD)"
git -C "$task_root" fetch --quiet origin
[[ -n "$(git -C "$task_root" branch -r --contains "$task_commit")" ]] || task_fail "HEAD $task_commit is not pushed"

task_wrangler="${OMAR_R2_WRANGLER:-$HOME/Library/Application Support/OS-1/tools/wrangler-$task_wrangler_version/node_modules/.bin/wrangler}"
[[ -x "$task_wrangler" ]] || task_fail "Wrangler $task_wrangler_version not found"
[[ "$("$task_wrangler" --version 2>/dev/null | head -1)" == "$task_wrangler_version" ]] || task_fail "Wrangler is not $task_wrangler_version"

# The helper that installs the image is part of the image.
task_helper="$HOME/.local/bin/os1-machine-sync"
if ! cmp -s "$task_root/scripts/os1-machine-sync.sh" "$task_helper"; then
  if [[ -e "$task_helper" ]]; then
    cp -p "$task_helper" "$task_helper.before-machine-image.$(date -u +%Y%m%dT%H%M%SZ)"
  fi
  install -m 0755 "$task_root/scripts/os1-machine-sync.sh" "$task_helper"
fi

task_out="$(mktemp -d "$HOME/.os1/machine-image-publish.XXXXXX")"
cleanup() {
  if [[ -d "$task_out" && "$task_out" == "$HOME/.os1/machine-image-publish."* ]]; then
    rm -rf "$task_out"
  fi
}
trap cleanup EXIT
rmdir "$task_out"
"$task_node" "$task_script_dir/build.mjs" --out "$task_out" --repository-commit "$task_commit" --source-role "$task_source_role"

# R2 requests from this network drop now and then ("fetch failed"): retry.
task_r2() {
  local task_verb="$1" task_key="$2" task_file="$3" task_attempt
  for task_attempt in 1 2 3 4 5 6; do
    if CI=true WRANGLER_SEND_METRICS=false "$task_wrangler" r2 object "$task_verb" "$task_bucket/$task_key" \
      --remote --file "$task_file" >/dev/null 2>"$task_out/r2.err"; then
      return 0
    fi
    echo "  $task_verb $task_key: attempt $task_attempt failed, retrying" >&2
    sleep $((task_attempt * 5))
  done
  tail -3 "$task_out/r2.err" >&2
  task_fail "$task_verb of $task_key failed 6 times"
}
task_put() { task_r2 put "$1" "$2"; }
task_get() { task_r2 get "$1" "$2"; }
task_plan_value() {
  /usr/bin/plutil -extract "$1" raw -o - "$task_out/upload-plan.json"
}
task_pointer_value() {
  /usr/bin/plutil -extract "$1" raw -o - "$task_out/latest.json"
}

task_parts="$(task_plan_value parts)"
task_index=0
while [[ "$task_index" -lt "$task_parts" ]]; do
  task_key="$(task_plan_value "parts.$task_index.key")"
  task_file="$task_out/$(task_plan_value "parts.$task_index.file")"
  echo "upload part $task_index: $task_key"
  task_put "$task_key" "$task_file"
  task_index=$((task_index + 1))
done
task_manifest_key="$(task_pointer_value image_manifest.key)"
task_release_prefix="$(dirname "$task_manifest_key")"
task_put "$task_manifest_key" "$task_out/os1-machine/IMAGE.json"
task_put "$task_release_prefix/latest.json" "$task_out/latest.json"
task_put "os1-machine/os1-machine-sync.sh" "$task_root/scripts/os1-machine-sync.sh"

# Read every immutable object back before the pointer moves.
mkdir "$task_out/readback"
task_index=0
while [[ "$task_index" -lt "$task_parts" ]]; do
  task_key="$(task_plan_value "parts.$task_index.key")"
  task_get "$task_key" "$task_out/readback/part"
  [[ "$(shasum -a 256 "$task_out/readback/part" | awk '{print $1}')" == "$(task_pointer_value "package.parts.$task_index.sha256")" ]] ||
    task_fail "readback of part $task_index does not match"
  rm -f "$task_out/readback/part"
  task_index=$((task_index + 1))
done
task_get "$task_manifest_key" "$task_out/readback/IMAGE.json"
cmp -s "$task_out/os1-machine/IMAGE.json" "$task_out/readback/IMAGE.json" || task_fail "manifest readback differs"
task_get "$task_release_prefix/latest.json" "$task_out/readback/release.json"
cmp -s "$task_out/latest.json" "$task_out/readback/release.json" || task_fail "release pointer readback differs"
task_get "os1-machine/os1-machine-sync.sh" "$task_out/readback/os1-machine-sync.sh"
cmp -s "$task_root/scripts/os1-machine-sync.sh" "$task_out/readback/os1-machine-sync.sh" || task_fail "installer readback differs"

task_put "os1-machine/latest.json" "$task_out/latest.json"
task_get "os1-machine/latest.json" "$task_out/readback/latest.json"
cmp -s "$task_out/latest.json" "$task_out/readback/latest.json" || task_fail "pointer readback differs"

echo "OS1_MACHINE_IMAGE_PUBLISHED"
echo "release_id=$(task_pointer_value release_id)"
echo "os1_build=$(task_pointer_value os1_build)"
echo "repository_commit=$task_commit"
echo "package_sha256=$(task_pointer_value package.sha256)"
echo "package_bytes=$(task_pointer_value package.bytes)"
echo "parts=$task_parts"
echo "pointer=$task_bucket/os1-machine/latest.json"
