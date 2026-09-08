#!/usr/bin/env bash
set -Eeuo pipefail

readonly task_bucket="omar-private-archive"
readonly task_product="os1-exo-cluster-activity-monitor"
readonly task_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly task_project_root="$(cd "$task_script_dir/.." && pwd)"
readonly task_product_root="$task_project_root/products/os1-exo-monitor"
readonly task_wrangler="$task_project_root/node_modules/.bin/wrangler"
readonly task_release_id="$(node -p "JSON.parse(require('fs').readFileSync('$task_product_root/manifest.json')).release_id")"
readonly task_overlay_commit="$(node -p "JSON.parse(require('fs').readFileSync('$task_product_root/manifest.json')).overlay_commit")"
[[ "$task_release_id" =~ ^[A-Za-z0-9._-]+$ && "$task_overlay_commit" =~ ^[0-9a-f]{40}$ ]]

[[ -x "$task_wrangler" ]]
[[ "$("$task_wrangler" --version 2>/dev/null | head -1)" == "4.127.1" ]]
[[ "$(git -C "$task_project_root" symbolic-ref --short HEAD)" == "main" ]]
[[ -z "$(git -C "$task_project_root" status --porcelain)" ]]
task_repository_commit="$(git -C "$task_project_root" rev-parse HEAD)"
[[ "$task_repository_commit" =~ ^[0-9a-f]{40}$ ]]

task_tmp="$(mktemp -d "${TMPDIR:-/tmp}/publish-os1-exo-monitor.XXXXXX")"
cleanup() {
  if [[ -d "$task_tmp" && "$task_tmp" == *publish-os1-exo-monitor.* ]]; then
    rm -rf "$task_tmp"
  fi
}
trap cleanup EXIT

git -C "$task_project_root" archive --format=tar --prefix=os1-exo-monitor/ \
  HEAD:products/os1-exo-monitor | gzip -n > "$task_tmp/os1-exo-monitor.tar.gz"

task_package_sha256="$(shasum -a 256 "$task_tmp/os1-exo-monitor.tar.gz" | awk '{print $1}')"
task_package_bytes="$(/usr/bin/stat -f '%z' "$task_tmp/os1-exo-monitor.tar.gz")"
task_package_key="os1-exo-monitor/releases/$task_release_id/$task_package_sha256/os1-exo-monitor.tar.gz"
task_release_manifest_key="os1-exo-monitor/releases/$task_release_id/$task_package_sha256/manifest.json"
task_installer_key="os1-exo-monitor/install-from-r2.sh"
task_pointer_key="os1-exo-monitor/latest.json"

node - "$task_tmp/latest.json" <<JS
const fs = require("node:fs");
const destination = process.argv[2];
const value = {
  schema: 1,
  product: "$task_product",
  bucket: "$task_bucket",
  repository: "effacermonexistence/codex",
  repository_commit: "$task_repository_commit",
  overlay_repository: "effacermonexistence/exo",
  overlay_commit: "$task_overlay_commit",
  release_id: "$task_release_id",
  package: {
    key: "$task_package_key",
    sha256: "$task_package_sha256",
    bytes: Number("$task_package_bytes")
  },
  installer_path: "os1-exo-monitor/install-activity-monitor.sh",
  r2_installer_key: "$task_installer_key",
  dashboard_path: "/#/activity",
  published_at: new Date().toISOString()
};
fs.writeFileSync(destination, JSON.stringify(value, null, 2) + "\n");
JS

task_put() {
  local task_key="$1"
  local task_file="$2"
  CI=true WRANGLER_SEND_METRICS=false "$task_wrangler" r2 object put \
    "$task_bucket/$task_key" --remote --file "$task_file"
}
task_get() {
  local task_key="$1"
  local task_file="$2"
  CI=true WRANGLER_SEND_METRICS=false "$task_wrangler" r2 object get \
    "$task_bucket/$task_key" --remote --file "$task_file"
}

# Publish immutable bytes first. The mutable pointer is always the final write.
task_put "$task_package_key" "$task_tmp/os1-exo-monitor.tar.gz"
task_put "$task_release_manifest_key" "$task_tmp/latest.json"
task_put "$task_installer_key" "$task_script_dir/install-os1-exo-monitor-from-r2.sh"
task_put "$task_pointer_key" "$task_tmp/latest.json"

task_get "$task_package_key" "$task_tmp/readback.tar.gz"
task_get "$task_release_manifest_key" "$task_tmp/readback-release.json"
task_get "$task_installer_key" "$task_tmp/readback-installer.sh"
task_get "$task_pointer_key" "$task_tmp/readback-latest.json"
[[ "$(shasum -a 256 "$task_tmp/readback.tar.gz" | awk '{print $1}')" == "$task_package_sha256" ]]
cmp -s "$task_tmp/latest.json" "$task_tmp/readback-release.json"
cmp -s "$task_script_dir/install-os1-exo-monitor-from-r2.sh" "$task_tmp/readback-installer.sh"
cmp -s "$task_tmp/latest.json" "$task_tmp/readback-latest.json"

echo "OS1_EXO_ACTIVITY_R2_PUBLISHED"
echo "repository_commit=$task_repository_commit"
echo "release_id=$task_release_id"
echo "package_key=$task_package_key"
echo "package_sha256=$task_package_sha256"
echo "package_bytes=$task_package_bytes"
echo "pointer_key=$task_pointer_key"
echo "installer_key=$task_installer_key"
