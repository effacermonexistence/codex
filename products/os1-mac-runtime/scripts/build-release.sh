#!/usr/bin/env bash
set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly runtime_root="$(cd "$script_dir/.." && pwd)"
readonly repository_root="$(cd "$runtime_root/../.." && pwd)"
readonly version="${OS1_VERSION:-0.3.4}"
readonly output_dir="${OS1_RELEASE_OUTPUT_DIR:-$runtime_root/release}"
readonly stage_dir="$output_dir/stage"
readonly component_pkg="$output_dir/OS-1-component.pkg"
readonly unsigned_pkg="$output_dir/OS-1-${version}-unsigned.pkg"
readonly final_pkg="$output_dir/OS-1-${version}.pkg"
readonly codesign_identity="${OS1_CODESIGN_IDENTITY:--}"
readonly installer_identity="${OS1_INSTALLER_IDENTITY:-}"

case "$output_dir" in
  "$runtime_root"/release|/tmp/os1-release.*) ;;
  *) echo "Refusing unexpected release output: $output_dir" >&2; exit 1 ;;
esac

rm -rf "$output_dir"
mkdir -p \
  "$stage_dir/Applications/Open OS-1 Codex.app/Contents/MacOS" \
  "$stage_dir/Applications/Open OS-1 Codex.app/Contents/Resources" \
  "$stage_dir/usr/local/bin" \
  "$stage_dir/Library/Application Support/OS-1"

swift build --package-path "$runtime_root" -c release \
  --triple arm64-apple-macosx13.0 \
  --build-path "$output_dir/build-arm64"
swift build --package-path "$runtime_root" -c release \
  --triple x86_64-apple-macosx13.0 \
  --build-path "$output_dir/build-x86_64"

lipo -create \
  "$output_dir/build-arm64/arm64-apple-macosx/release/os1" \
  "$output_dir/build-x86_64/x86_64-apple-macosx/release/os1" \
  -output "$stage_dir/usr/local/bin/os1"
install -m 0755 "$stage_dir/usr/local/bin/os1" \
  "$stage_dir/Applications/Open OS-1 Codex.app/Contents/Resources/os1"
lipo -create \
  "$output_dir/build-arm64/arm64-apple-macosx/release/OS1App" \
  "$output_dir/build-x86_64/x86_64-apple-macosx/release/OS1App" \
  -output "$stage_dir/Applications/Open OS-1 Codex.app/Contents/MacOS/OS1App"

install -m 0644 "$runtime_root/Resources/Info.plist" \
  "$stage_dir/Applications/Open OS-1 Codex.app/Contents/Info.plist"
install -m 0644 "$runtime_root/Config/production.json" \
  "$stage_dir/Applications/Open OS-1 Codex.app/Contents/Resources/config.json"
install -m 0644 "$runtime_root/Config/production.json" \
  "$stage_dir/Library/Application Support/OS-1/config.json"
xattr -cr "$stage_dir"

codesign --force --sign "$codesign_identity" --options runtime \
  --identifier com.omaragi.os1.runtime "$stage_dir/usr/local/bin/os1"
codesign --force --sign "$codesign_identity" --options runtime \
  --identifier com.omaragi.os1.runtime.bundled \
  "$stage_dir/Applications/Open OS-1 Codex.app/Contents/Resources/os1"
codesign --force --sign "$codesign_identity" --options runtime \
  --identifier com.omaragi.os1 "$stage_dir/Applications/Open OS-1 Codex.app"
codesign --verify --strict --verbose=2 "$stage_dir/usr/local/bin/os1"
codesign --verify --deep --strict --verbose=2 "$stage_dir/Applications/Open OS-1 Codex.app"
lipo -archs "$stage_dir/usr/local/bin/os1" | grep -q 'x86_64 arm64\|arm64 x86_64'
lipo -archs "$stage_dir/Applications/Open OS-1 Codex.app/Contents/MacOS/OS1App" | grep -q 'x86_64 arm64\|arm64 x86_64'
"$stage_dir/usr/local/bin/os1" self-test

COPYFILE_DISABLE=1 pkgbuild \
  --root "$stage_dir" \
  --identifier com.omaragi.os1 \
  --version "$version" \
  --install-location / \
  "$component_pkg"
productbuild --package "$component_pkg" "$unsigned_pkg"

if [[ -n "$installer_identity" ]]; then
  productsign --sign "$installer_identity" "$unsigned_pkg" "$final_pkg"
else
  cp "$unsigned_pkg" "$final_pkg"
fi

pkgutil --check-signature "$final_pkg" || [[ -z "$installer_identity" ]]
pkgutil --payload-files "$final_pkg" | grep -q 'usr/local/bin/os1'
pkgutil --payload-files "$final_pkg" | grep -q 'Applications/Open OS-1 Codex.app'

node "$repository_root/products/os1-route-core/scripts/client-artifact-scan.mjs" \
  "$stage_dir/usr/local/bin/os1" \
  "$stage_dir/Applications/Open OS-1 Codex.app" \
  "$stage_dir/Library/Application Support/OS-1/config.json"

readonly package_sha256="$(shasum -a 256 "$final_pkg" | awk '{print $1}')"
readonly package_size="$(stat -f '%z' "$final_pkg")"
printf '{"version":"%s","object_key":"os1/releases/%s/OS-1-%s.pkg","sha256":"%s","size":%s,"minimum_macos":"13.0"}\n' \
  "$version" "$version" "$version" "$package_sha256" "$package_size" \
  > "$output_dir/latest.json"

echo "Release package: $final_pkg"
echo "Release manifest: $output_dir/latest.json"
echo "SHA-256: $package_sha256"
