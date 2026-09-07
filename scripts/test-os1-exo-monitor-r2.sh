#!/usr/bin/env bash
set -Eeuo pipefail

readonly task_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly task_project_root="$(cd "$task_script_dir/.." && pwd)"
readonly task_release_id="test-release"
task_tmp="$(mktemp -d "${TMPDIR:-/tmp}/test-os1-exo-monitor-r2.XXXXXX")"
cleanup() {
  if [[ -d "$task_tmp" && "$task_tmp" == *test-os1-exo-monitor-r2.* ]]; then
    rm -rf "$task_tmp"
  fi
}
trap cleanup EXIT

mkdir -p "$task_tmp/stage/os1-exo-monitor" "$task_tmp/r2"
rsync -a \
  --exclude '.gitignore' \
  --exclude '__pycache__' \
  --exclude '.pytest_cache' \
  "$task_project_root/products/os1-exo-monitor/" \
  "$task_tmp/stage/os1-exo-monitor/"
COPYFILE_DISABLE=1 tar -czf "$task_tmp/package.tar.gz" \
  -C "$task_tmp/stage" os1-exo-monitor
task_sha256="$(shasum -a 256 "$task_tmp/package.tar.gz" | awk '{print $1}')"
task_bytes="$(/usr/bin/stat -f '%z' "$task_tmp/package.tar.gz")"
task_package_key="os1-exo-monitor/releases/$task_release_id/$task_sha256/os1-exo-monitor.tar.gz"
mkdir -p "$task_tmp/r2/$(dirname "$task_package_key")"
cp "$task_tmp/package.tar.gz" "$task_tmp/r2/$task_package_key"

node - "$task_tmp/r2/os1-exo-monitor-latest.json" <<JS
const fs = require("node:fs");
fs.writeFileSync(process.argv[2], JSON.stringify({
  schema: 1,
  product: "os1-exo-cluster-activity-monitor",
  bucket: "omar-private-archive",
  repository: "effacermonexistence/codex",
  repository_commit: "8781ff48bfad44df50576ea498822d38a497e0be",
  release_id: "$task_release_id",
  package: {key: "$task_package_key", sha256: "$task_sha256", bytes: $task_bytes},
  installer_path: "os1-exo-monitor/install-activity-monitor.sh"
}, null, 2) + "\n");
JS

task_mock_wrangler="$task_tmp/wrangler"
apply_mock() {
  local task_destination="$1"
  sed \
    -e "s|__FIXTURE_ROOT__|$task_tmp/r2|g" \
    "$task_project_root/scripts/testdata/mock-r2-wrangler.sh" > "$task_destination"
  chmod 0755 "$task_destination"
}
apply_mock "$task_mock_wrangler"

OMAR_R2_WRANGLER="$task_mock_wrangler" \
  "$task_project_root/scripts/install-os1-exo-monitor-from-r2.sh" air --verify-only \
  > "$task_tmp/valid.out"
grep -Fxq "OS1_EXO_ACTIVITY_R2_VERIFIED" "$task_tmp/valid.out"
grep -Fxq "package_sha256=$task_sha256" "$task_tmp/valid.out"

node - "$task_tmp/r2/os1-exo-monitor-latest.json" <<'JS'
const fs = require("node:fs");
const path = process.argv[2];
const value = JSON.parse(fs.readFileSync(path, "utf8"));
value.package.key = "git-bundles/effacermonexistence/codex/not-an-exo-release.bundle";
fs.writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
JS
if OMAR_R2_WRANGLER="$task_mock_wrangler" \
  "$task_project_root/scripts/install-os1-exo-monitor-from-r2.sh" air --verify-only \
  > "$task_tmp/invalid.out" 2>&1; then
  echo "invalid R2 package key was accepted" >&2
  exit 1
fi

echo "OS1_EXO_ACTIVITY_R2_TESTS_PASS"
