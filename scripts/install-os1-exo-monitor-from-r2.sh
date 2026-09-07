#!/usr/bin/env bash
set -Eeuo pipefail

readonly task_bucket="omar-private-archive"
readonly task_pointer_key="os1-exo-monitor/latest.json"
readonly task_expected_product="os1-exo-cluster-activity-monitor"
readonly task_expected_repository="effacermonexistence/codex"
readonly task_wrangler_version="4.127.1"
readonly task_role="${1:-air}"
readonly task_mode="${2:-install}"

if [[ "$task_role" != "air" && "$task_role" != "pro" ]]; then
  echo "usage: $0 air|pro [--verify-only]" >&2
  exit 2
fi
if [[ "$task_mode" != "install" && "$task_mode" != "--verify-only" ]]; then
  echo "usage: $0 air|pro [--verify-only]" >&2
  exit 2
fi

task_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
task_project_root="$(cd "$task_script_dir/.." && pwd)"
task_tmp="$(mktemp -d "${TMPDIR:-/tmp}/os1-exo-monitor-r2.XXXXXX")"
cleanup() {
  if [[ -d "$task_tmp" && "$task_tmp" == *os1-exo-monitor-r2.* ]]; then
    rm -rf "$task_tmp"
  fi
}
trap cleanup EXIT

task_wrangler=""
task_candidates=(
  "${OMAR_R2_WRANGLER:-}"
  "$task_project_root/node_modules/.bin/wrangler"
  "$HOME/Library/Application Support/OS-1/tools/wrangler-$task_wrangler_version/node_modules/.bin/wrangler"
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
if [[ -z "$task_wrangler" ]]; then
  echo "Verified Wrangler $task_wrangler_version was not found. Run the standard new-Mac bootstrap first." >&2
  exit 1
fi

task_r2_get() {
  local task_key="$1"
  local task_destination="$2"
  if CI=true WRANGLER_SEND_METRICS=false "$task_wrangler" r2 object get \
    "$task_bucket/$task_key" --remote --file "$task_destination"; then
    return 0
  fi
  CI=true WRANGLER_SEND_METRICS=false "$task_wrangler" r2 object get \
    "$task_bucket/$task_key" --remote --profile pro-mdm --file "$task_destination"
}

task_pointer="$task_tmp/latest.json"
task_r2_get "$task_pointer_key" "$task_pointer"

task_json_value() {
  /usr/bin/plutil -extract "$1" raw -o - "$task_pointer"
}

task_schema="$(task_json_value schema)"
task_product="$(task_json_value product)"
task_manifest_bucket="$(task_json_value bucket)"
task_repository="$(task_json_value repository)"
task_repository_commit="$(task_json_value repository_commit)"
task_release_id="$(task_json_value release_id)"
task_package_key="$(task_json_value package.key)"
task_expected_sha256="$(task_json_value package.sha256)"
task_expected_bytes="$(task_json_value package.bytes)"
task_installer_path="$(task_json_value installer_path)"

[[ "$task_schema" == "1" ]]
[[ "$task_product" == "$task_expected_product" ]]
[[ "$task_manifest_bucket" == "$task_bucket" ]]
[[ "$task_repository" == "$task_expected_repository" ]]
[[ "$task_repository_commit" =~ ^[0-9a-f]{40}$ ]]
[[ "$task_release_id" =~ ^[A-Za-z0-9._-]+$ ]]
[[ "$task_package_key" == "os1-exo-monitor/releases/$task_release_id/$task_expected_sha256/os1-exo-monitor.tar.gz" ]]
[[ "$task_expected_sha256" =~ ^[0-9a-f]{64}$ ]]
[[ "$task_expected_bytes" =~ ^[0-9]+$ && "$task_expected_bytes" -gt 0 ]]
[[ "$task_installer_path" == "os1-exo-monitor/install-activity-monitor.sh" ]]

task_package="$task_tmp/os1-exo-monitor.tar.gz"
task_r2_get "$task_package_key" "$task_package"
task_actual_sha256="$(shasum -a 256 "$task_package" | awk '{print $1}')"
task_actual_bytes="$(/usr/bin/stat -f '%z' "$task_package")"
[[ "$task_actual_sha256" == "$task_expected_sha256" ]]
[[ "$task_actual_bytes" == "$task_expected_bytes" ]]

tar -tzf "$task_package" > "$task_tmp/archive-paths.txt"
while IFS= read -r task_archive_path; do
  [[ -n "$task_archive_path" ]]
  [[ "$task_archive_path" != /* ]]
  [[ "$task_archive_path" == os1-exo-monitor || "$task_archive_path" == os1-exo-monitor/* ]]
  [[ "/$task_archive_path/" != *"/../"* ]]
done < "$task_tmp/archive-paths.txt"

mkdir -p "$task_tmp/extracted"
tar -xzf "$task_package" -C "$task_tmp/extracted"
task_installer="$task_tmp/extracted/$task_installer_path"
[[ -f "$task_installer" ]]

echo "OS1_EXO_ACTIVITY_R2_VERIFIED"
echo "repository_commit=$task_repository_commit"
echo "release_id=$task_release_id"
echo "package_key=$task_package_key"
echo "package_sha256=$task_actual_sha256"
echo "package_bytes=$task_actual_bytes"

if [[ "$task_mode" == "--verify-only" ]]; then
  exit 0
fi

bash "$task_installer" "$task_role"
