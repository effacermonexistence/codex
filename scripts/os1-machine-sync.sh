#!/usr/bin/env bash
# Makes this Mac's OS-1 setup identical to the latest OS-1 machine image the
# owner published to private R2, or reports how it differs (--verify-only).
#
#   os1-machine-sync air|pro [--verify-only]
#
# Trusted pointer: omar-private-archive/os1-machine/latest.json. Every part,
# the package and every installed file are checked against SHA-256 values
# before and after installation. Logins, device keys, conversations and logs
# are not part of the image and are never changed. Uses this Mac's existing
# Wrangler login; never asks for or copies a credential.
#
# macOS /bin/bash is 3.2, where `set -e` does not stop on a failed [[ ]] test:
# every check below therefore ends in `|| task_fail`.
set -Eeuo pipefail

task_fail() {
  echo "os1-machine-sync: $1 — nothing was installed." >&2
  exit 1
}
trap 'echo "os1-machine-sync: stopped at line $LINENO" >&2' ERR

readonly task_bucket="omar-private-archive"
readonly task_pointer_key="os1-machine/latest.json"
readonly task_expected_product="os1-machine-image"
readonly task_expected_repository="effacermonexistence/codex"
readonly task_wrangler_version="4.127.1"
readonly task_role="${1:-}"
readonly task_mode="${2:-install}"

if [[ "$task_role" != "air" && "$task_role" != "pro" ]] ||
   [[ "$task_mode" != "install" && "$task_mode" != "--verify-only" ]]; then
  echo "usage: os1-machine-sync air|pro [--verify-only]" >&2
  exit 2
fi
[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] || task_fail "this image is for Apple silicon Macs"

export PATH="$HOME/.local/share/node-v24.20.0/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

task_tmp="$(mktemp -d "${TMPDIR:-/tmp}/os1-machine-sync.XXXXXX")"
cleanup() {
  if [[ -d "$task_tmp" && "$task_tmp" == *os1-machine-sync.* ]]; then
    rm -rf "$task_tmp"
  fi
}
trap cleanup EXIT

task_wrangler=""
task_r2_get() {
  local task_key="$1"
  local task_destination="$2"
  if [[ -n "${OS1_MACHINE_SYNC_TEST_BUCKET_DIR:-}" ]]; then
    # Test-only local bucket; never set in normal use.
    cp "$OS1_MACHINE_SYNC_TEST_BUCKET_DIR/$task_key" "$task_destination"
    return
  fi
  # Large R2 transfers drop now and then ("fetch failed"): retry with backoff.
  local task_attempt
  for task_attempt in 1 2 3 4 5 6; do
    if CI=true WRANGLER_SEND_METRICS=false "$task_wrangler" r2 object get \
      "$task_bucket/$task_key" --remote --file "$task_destination" >/dev/null 2>"$task_tmp/wrangler.err"; then
      return 0
    fi
    if CI=true WRANGLER_SEND_METRICS=false "$task_wrangler" r2 object get \
      "$task_bucket/$task_key" --remote --profile pro-mdm --file "$task_destination" >/dev/null 2>>"$task_tmp/wrangler.err"; then
      return 0
    fi
    sleep $((task_attempt * 3))
  done
  echo "R2 download failed for $task_key. Wrangler said:" >&2
  tail -5 "$task_tmp/wrangler.err" >&2
  task_fail "R2 download failed (if Wrangler is signed out on this Mac, run: wrangler login)"
}

if [[ -z "${OS1_MACHINE_SYNC_TEST_BUCKET_DIR:-}" ]]; then
  task_candidates=(
    "${OMAR_R2_WRANGLER:-}"
    "$HOME/Library/Application Support/OS-1/tools/wrangler-$task_wrangler_version/node_modules/.bin/wrangler"
    "$HOME/Documents/Codex/codex/node_modules/.bin/wrangler"
  )
  if command -v wrangler >/dev/null 2>&1; then
    task_candidates+=("$(command -v wrangler)")
  fi
  for task_candidate in "${task_candidates[@]}"; do
    if [[ -n "$task_candidate" && -x "$task_candidate" ]] &&
       "$task_candidate" --version 2>/dev/null | grep -Fxq "$task_wrangler_version"; then
      task_wrangler="$task_candidate"
      break
    fi
  done
  [[ -n "$task_wrangler" ]] || task_fail "Wrangler $task_wrangler_version was not found (it needs Node.js); run the new-Mac bootstrap first"
fi

task_pointer="$task_tmp/latest.json"
task_r2_get "$task_pointer_key" "$task_pointer"
task_value() {
  /usr/bin/plutil -extract "$1" raw -o - "$task_pointer" 2>/dev/null || task_fail "pointer has no $1"
}

[[ "$(task_value schema)" == "1" ]] || task_fail "unsupported pointer schema"
[[ "$(task_value product)" == "$task_expected_product" ]] || task_fail "pointer names another product"
[[ "$(task_value bucket)" == "$task_bucket" ]] || task_fail "pointer names another bucket"
[[ "$(task_value repository)" == "$task_expected_repository" ]] || task_fail "pointer names another repository"
task_commit="$(task_value repository_commit)"
task_release_id="$(task_value release_id)"
task_package_sha256="$(task_value package.sha256)"
task_package_bytes="$(task_value package.bytes)"
task_manifest_key="$(task_value image_manifest.key)"
task_manifest_sha256="$(task_value image_manifest.sha256)"
[[ "$task_commit" =~ ^[0-9a-f]{40}$ ]] || task_fail "invalid repository commit"
[[ "$task_release_id" =~ ^[A-Za-z0-9._-]+$ ]] || task_fail "invalid release id"
[[ "$task_package_sha256" =~ ^[0-9a-f]{64}$ ]] || task_fail "invalid package digest"
[[ "$task_package_bytes" =~ ^[0-9]+$ && "$task_package_bytes" -gt 0 ]] || task_fail "invalid package size"
[[ "$task_manifest_key" == "os1-machine/releases/$task_release_id/$task_package_sha256/IMAGE.json" ]] || task_fail "unexpected manifest key"
[[ "$task_manifest_sha256" =~ ^[0-9a-f]{64}$ ]] || task_fail "invalid manifest digest"
[[ "$(task_value installer_path)" == "os1-machine/installer/install.mjs" ]] || task_fail "unexpected installer path"
[[ "$(task_value node_path)" == "os1-machine/payload/.local/share/node-v24.20.0/bin/node" ]] || task_fail "unexpected runtime path"

task_parts="$(task_value package.parts)"
[[ "$task_parts" =~ ^[0-9]+$ && "$task_parts" -gt 0 && "$task_parts" -lt 100 ]] || task_fail "invalid part count"
echo "OS-1 machine image $task_release_id (build $(task_value os1_build)): downloading $task_parts part(s), $task_package_bytes bytes"
task_package="$task_tmp/package.tar.gz"
: > "$task_package"
task_index=0
while [[ "$task_index" -lt "$task_parts" ]]; do
  task_part_key="$(task_value "package.parts.$task_index.key")"
  task_part_sha256="$(task_value "package.parts.$task_index.sha256")"
  task_part_bytes="$(task_value "package.parts.$task_index.bytes")"
  [[ "$task_part_key" == "os1-machine/releases/$task_release_id/$task_package_sha256/package.tar.gz.part-$(printf '%03d' "$task_index")" ]] ||
    task_fail "unexpected part key $task_part_key"
  task_part="$task_tmp/part-$task_index"
  task_r2_get "$task_part_key" "$task_part"
  [[ "$(shasum -a 256 "$task_part" | awk '{print $1}')" == "$task_part_sha256" ]] || task_fail "part $task_index failed its SHA-256 check"
  [[ "$(/usr/bin/stat -f '%z' "$task_part")" == "$task_part_bytes" ]] || task_fail "part $task_index has the wrong size"
  cat "$task_part" >> "$task_package"
  rm -f "$task_part"
  task_index=$((task_index + 1))
done
[[ "$(shasum -a 256 "$task_package" | awk '{print $1}')" == "$task_package_sha256" ]] || task_fail "package failed its SHA-256 check"
[[ "$(/usr/bin/stat -f '%z' "$task_package")" == "$task_package_bytes" ]] || task_fail "package has the wrong size"

/usr/bin/tar -tzf "$task_package" > "$task_tmp/archive-paths.txt"
while IFS= read -r task_archive_path; do
  [[ -n "$task_archive_path" && "$task_archive_path" != /* ]] || task_fail "archive holds an absolute or empty path"
  [[ "$task_archive_path" == os1-machine || "$task_archive_path" == os1-machine/* ]] || task_fail "archive path outside os1-machine/"
  [[ "/$task_archive_path/" != *"/../"* ]] || task_fail "archive path climbs out of its folder"
done < "$task_tmp/archive-paths.txt"

mkdir -p "$task_tmp/extracted"
/usr/bin/tar -xzf "$task_package" -C "$task_tmp/extracted"
rm -f "$task_package"
task_image="$task_tmp/extracted/os1-machine"
[[ "$(shasum -a 256 "$task_image/IMAGE.json" | awk '{print $1}')" == "$task_manifest_sha256" ]] || task_fail "image manifest failed its SHA-256 check"
task_node="$task_tmp/extracted/$(task_value node_path)"
[[ -x "$task_node" ]] || task_fail "image runtime is missing"

echo "OS1_MACHINE_IMAGE_R2_VERIFIED"
echo "release_id=$task_release_id"
echo "repository_commit=$task_commit"
echo "package_sha256=$task_package_sha256"
echo "package_bytes=$task_package_bytes"

task_status=0
if [[ "$task_mode" == "--verify-only" ]]; then
  "$task_node" "$task_image/installer/install.mjs" --image "$task_image" --role "$task_role" --verify-only || task_status=$?
else
  "$task_node" "$task_image/installer/install.mjs" --image "$task_image" --role "$task_role" || task_status=$?
fi
exit "$task_status"
