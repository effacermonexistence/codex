#!/usr/bin/env bash
set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly runtime_root="$(cd "$script_dir/.." && pwd)"
readonly output_dir="${OS1_RELEASE_OUTPUT_DIR:-$runtime_root/release}"
readonly package_path="${OS1_BETA_SOURCE_PACKAGE:-$output_dir/OS-1-0.9.2.pkg}"
readonly manifest_path="${OS1_BETA_SOURCE_MANIFEST:-$output_dir/latest.json}"

case "$output_dir" in
  "$runtime_root"/release|/tmp/os1-release.*) ;;
  *) echo "Refusing unexpected beta output directory: $output_dir" >&2; exit 1 ;;
esac
[[ -f "$package_path" && ! -L "$package_path" ]]
[[ -f "$manifest_path" && ! -L "$manifest_path" ]]

readonly version="$(plutil -extract version raw -o - "$manifest_path")"
readonly expected_sha256="$(plutil -extract sha256 raw -o - "$manifest_path")"
readonly expected_size="$(plutil -extract size raw -o - "$manifest_path")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
[[ "$expected_sha256" =~ ^[0-9a-f]{64}$ ]]
[[ "$expected_size" =~ ^[0-9]+$ ]]
[[ "$(stat -f '%z' "$package_path")" == "$expected_size" ]]
printf '%s  %s\n' "$expected_sha256" "$package_path" | shasum -a 256 -c -

readonly staging_root="$(mktemp -d /tmp/os1-beta-bundle.XXXXXX)"
cleanup() {
  case "$staging_root" in /tmp/os1-beta-bundle.*) rm -rf "$staging_root" ;; esac
}
trap cleanup EXIT

readonly bundle_name="OS-1-${version}-macOS-beta"
readonly bundle_dir="$staging_root/$bundle_name"
readonly temporary_zip="$staging_root/$bundle_name.zip"
readonly final_zip="$output_dir/$bundle_name.zip"
mkdir -p "$bundle_dir"
install -m 0644 "$package_path" "$bundle_dir/OS-1.pkg"
install -m 0644 "$manifest_path" "$bundle_dir/latest.json"
install -m 0755 "$script_dir/install-os1.sh" "$bundle_dir/install-os1.sh"
install -m 0755 "$script_dir/install-local-beta.command" "$bundle_dir/Install OS-1 Beta.command"
printf '%s\n' \
  'OS-1 LOCAL MAC BETA' \
  '' \
  'This bundle is intentionally not Apple-notarized.' \
  'It verifies the package SHA-256, identifier, version, exact payload allowlist,' \
  'ad-hoc code integrity, and universal arm64/x86_64 binaries before installation.' \
  '' \
  'Install:' \
  '1. Open Terminal.' \
  '2. Type: bash ' \
  '3. Drag "Install OS-1 Beta.command" into Terminal.' \
  '4. Press Return and enter the Mac administrator password when requested.' \
  '' \
  'Each Mac user completes their own Codex, Claude, and GitHub OAuth logins.' \
  > "$bundle_dir/README.txt"

/usr/bin/ditto -c -k --norsrc --keepParent "$bundle_dir" "$temporary_zip"
mv -f "$temporary_zip" "$final_zip"
readonly zip_sha256="$(shasum -a 256 "$final_zip" | awk '{print $1}')"
printf '%s  %s\n' "$zip_sha256" "$(basename "$final_zip")" > "$final_zip.sha256"

echo "Beta bundle: $final_zip"
echo "Bundle SHA-256: $zip_sha256"
