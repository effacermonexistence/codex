#!/usr/bin/env bash
set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly runtime_root="$(cd "$script_dir/.." && pwd)"
readonly repository_root="$(cd "$runtime_root/../.." && pwd)"
readonly version="${OS1_VERSION:-0.9.2}"
readonly release_mode="${OS1_RELEASE_MODE:-development}"
readonly output_dir="${OS1_RELEASE_OUTPUT_DIR:-$runtime_root/release}"
readonly stage_dir="$output_dir/stage"
readonly audit_dir="$output_dir/audit"
readonly component_pkg="$output_dir/OS-1-component.pkg"
readonly unsigned_pkg="$output_dir/OS-1-${version}-unsigned.pkg"
readonly final_pkg="$output_dir/OS-1-${version}.pkg"
readonly component_plist="$runtime_root/InstallerComponents.plist"
readonly arm64_build_dir="${OS1_ARM64_BUILD_DIR:-$runtime_root/.build-release-arm64}"
readonly x86_64_build_dir="${OS1_X86_64_BUILD_DIR:-$runtime_root/.build-release-x86_64}"
readonly skip_build="${OS1_SKIP_BUILD:-0}"
readonly codesign_identity="${OS1_CODESIGN_IDENTITY:--}"
readonly installer_identity="${OS1_INSTALLER_IDENTITY:-}"
readonly notary_profile="${OS1_NOTARY_PROFILE:-}"

case "$release_mode" in
  development) ;;
  distribution)
    if [[ "$codesign_identity" == "-" || -z "$codesign_identity" ||
          -z "$installer_identity" || -z "$notary_profile" ]]; then
      echo "Distribution mode requires application signing, installer signing, and notarization identities." >&2
      exit 1
    fi
    ;;
  *) echo "OS1_RELEASE_MODE must be development or distribution." >&2; exit 1 ;;
esac

case "$output_dir" in
  "$runtime_root"/release|/tmp/os1-release.*) ;;
  *) echo "Refusing unexpected release output: $output_dir" >&2; exit 1 ;;
esac

rm -rf "$output_dir"
mkdir -p \
  "$stage_dir/Applications/Open OS-1 Codex.app/Contents/MacOS" \
  "$stage_dir/Applications/Open OS-1 Codex.app/Contents/Resources" \
  "$stage_dir/usr/local/bin" \
  "$stage_dir/Library/Application Support/OS-1" \
  "$audit_dir"

if [[ "$skip_build" == "1" ]]; then
  [[ -x "$arm64_build_dir/arm64-apple-macosx/release/os1" ]]
  [[ -x "$arm64_build_dir/arm64-apple-macosx/release/OS1App" ]]
  [[ -x "$x86_64_build_dir/x86_64-apple-macosx/release/os1" ]]
  [[ -x "$x86_64_build_dir/x86_64-apple-macosx/release/OS1App" ]]
else
  swift build --package-path "$runtime_root" -c release \
    --triple arm64-apple-macosx13.0 \
    --build-path "$arm64_build_dir"
  swift build --package-path "$runtime_root" -c release \
    --triple x86_64-apple-macosx13.0 \
    --build-path "$x86_64_build_dir"
fi

lipo -create \
  "$arm64_build_dir/arm64-apple-macosx/release/os1" \
  "$x86_64_build_dir/x86_64-apple-macosx/release/os1" \
  -output "$stage_dir/usr/local/bin/os1"
install -m 0755 "$stage_dir/usr/local/bin/os1" \
  "$stage_dir/Applications/Open OS-1 Codex.app/Contents/Resources/os1"
lipo -create \
  "$arm64_build_dir/arm64-apple-macosx/release/OS1App" \
  "$x86_64_build_dir/x86_64-apple-macosx/release/OS1App" \
  -output "$stage_dir/Applications/Open OS-1 Codex.app/Contents/MacOS/OS1App"

install -m 0644 "$runtime_root/Resources/Info.plist" \
  "$stage_dir/Applications/Open OS-1 Codex.app/Contents/Info.plist"
for resource in OmarAGI.png Codex.png ClaudeCode.png Constellation.png OmarAGI.icns; do
  install -m 0644 "$runtime_root/Resources/$resource" \
    "$stage_dir/Applications/Open OS-1 Codex.app/Contents/Resources/$resource"
done
install -m 0644 "$runtime_root/Config/production.json" \
  "$stage_dir/Applications/Open OS-1 Codex.app/Contents/Resources/config.json"
install -m 0644 "$runtime_root/Config/production.json" \
  "$stage_dir/Library/Application Support/OS-1/config.json"

while IFS= read -r payload_file; do
  relative_path="${payload_file#"$stage_dir/"}"
  case "$relative_path" in
    "Applications/Open OS-1 Codex.app/Contents/MacOS/OS1App"|\
    "Applications/Open OS-1 Codex.app/Contents/Resources/os1"|\
    "Applications/Open OS-1 Codex.app/Contents/Resources/OmarAGI.png"|\
    "Applications/Open OS-1 Codex.app/Contents/Resources/Codex.png"|\
    "Applications/Open OS-1 Codex.app/Contents/Resources/ClaudeCode.png"|\
    "Applications/Open OS-1 Codex.app/Contents/Resources/Constellation.png"|\
    "Applications/Open OS-1 Codex.app/Contents/Resources/OmarAGI.icns"|\
    "Applications/Open OS-1 Codex.app/Contents/Resources/config.json"|\
    "Applications/Open OS-1 Codex.app/Contents/Info.plist"|\
    "usr/local/bin/os1"|\
    "Library/Application Support/OS-1/config.json") ;;
    *) echo "Refusing unexpected public payload file: $relative_path" >&2; exit 1 ;;
  esac
done < <(find "$stage_dir" \( -type f -o -type l \) -print | sort)

if find "$stage_dir" -type l -print -quit | grep -q .; then
  echo "Refusing symlinks in the public payload." >&2
  exit 1
fi
if find "$stage_dir" -print | grep -Eiq 'private-core|os1_local_core|darwin_routed_rcc|benchmark_priors|prompt_lineage|router_state|hinton_forward'; then
  echo "Refusing private route-core material in the public payload." >&2
  exit 1
fi

xattr -cr "$stage_dir"
codesign_options=(--force --sign "$codesign_identity" --options runtime)
if [[ "$release_mode" == "distribution" ]]; then
  codesign_options+=(--timestamp)
fi
codesign "${codesign_options[@]}" \
  --identifier com.omaragi.os1.runtime "$stage_dir/usr/local/bin/os1"
codesign "${codesign_options[@]}" \
  --identifier com.omaragi.os1.runtime.bundled \
  "$stage_dir/Applications/Open OS-1 Codex.app/Contents/Resources/os1"
codesign "${codesign_options[@]}" \
  --entitlements "$runtime_root/Resources/OS1.entitlements" \
  --identifier com.omaragi.os1 "$stage_dir/Applications/Open OS-1 Codex.app"
codesign --verify --strict --verbose=2 "$stage_dir/usr/local/bin/os1"
codesign --verify --deep --strict --verbose=2 "$stage_dir/Applications/Open OS-1 Codex.app"
lipo -archs "$stage_dir/usr/local/bin/os1" | grep -Eq '(^| )(x86_64 arm64|arm64 x86_64)($| )'
lipo -archs "$stage_dir/Applications/Open OS-1 Codex.app/Contents/MacOS/OS1App" | grep -Eq '(^| )(x86_64 arm64|arm64 x86_64)($| )'
[[ "$(plutil -extract CFBundleShortVersionString raw -o - "$stage_dir/Applications/Open OS-1 Codex.app/Contents/Info.plist")" == "$version" ]]
"$stage_dir/usr/local/bin/os1" self-test
"$stage_dir/Applications/Open OS-1 Codex.app/Contents/MacOS/OS1App" --self-test

COPYFILE_DISABLE=1 pkgbuild \
  --root "$stage_dir" \
  --component-plist "$component_plist" \
  --scripts "$runtime_root/InstallerScripts" \
  --identifier com.omaragi.os1 \
  --version "$version" \
  --install-location / \
  "$component_pkg"
productbuild --package "$component_pkg" "$unsigned_pkg"

if [[ "$release_mode" == "distribution" ]]; then
  productsign --sign "$installer_identity" "$unsigned_pkg" "$final_pkg"
  pkgutil --check-signature "$final_pkg"
  xcrun notarytool submit "$final_pkg" --keychain-profile "$notary_profile" --wait
  xcrun stapler staple "$final_pkg"
  xcrun stapler validate "$final_pkg"
  spctl --assess --type install --verbose=2 "$final_pkg"
else
  cp "$unsigned_pkg" "$final_pkg"
fi

payload_listing="$audit_dir/payload-files.txt"
pkgutil --payload-files "$final_pkg" > "$payload_listing"
grep -q 'usr/local/bin/os1' "$payload_listing"
grep -q 'Applications/Open OS-1 Codex.app' "$payload_listing"
if grep -Eiq 'private-core|os1_local_core|darwin_routed_rcc|benchmark_priors|prompt_lineage|router_state|hinton_forward' "$payload_listing"; then
  echo "Private route-core path found after packaging." >&2
  exit 1
fi

pkgutil --expand-full "$final_pkg" "$audit_dir/expanded"
expanded_payload="$audit_dir/expanded/OS-1-component.pkg/Payload"
while IFS= read -r payload_file; do
  relative_path="${payload_file#"$expanded_payload/"}"
  case "$relative_path" in
    "Applications/Open OS-1 Codex.app/Contents/MacOS/OS1App"|\
    "Applications/Open OS-1 Codex.app/Contents/Resources/os1"|\
    "Applications/Open OS-1 Codex.app/Contents/Resources/OmarAGI.png"|\
    "Applications/Open OS-1 Codex.app/Contents/Resources/Codex.png"|\
    "Applications/Open OS-1 Codex.app/Contents/Resources/ClaudeCode.png"|\
    "Applications/Open OS-1 Codex.app/Contents/Resources/Constellation.png"|\
    "Applications/Open OS-1 Codex.app/Contents/Resources/OmarAGI.icns"|\
    "Applications/Open OS-1 Codex.app/Contents/Resources/config.json"|\
    "Applications/Open OS-1 Codex.app/Contents/Info.plist"|\
    "Applications/Open OS-1 Codex.app/Contents/_CodeSignature/CodeResources"|\
    "usr/local/bin/os1"|\
    "Library/Application Support/OS-1/config.json") ;;
    *) echo "Refusing unexpected expanded payload file: $relative_path" >&2; exit 1 ;;
  esac
done < <(find "$expanded_payload" -type f -print | sort)
expanded_scripts="$audit_dir/expanded/OS-1-component.pkg/Scripts"
[[ "$(find "$expanded_scripts" -type f -print | wc -l | tr -d ' ')" == "1" ]]
[[ -f "$expanded_scripts/postinstall" ]]
node "$repository_root/products/os1-route-core/scripts/client-artifact-scan.mjs" \
  "$audit_dir/expanded"

readonly package_sha256="$(shasum -a 256 "$final_pkg" | awk '{print $1}')"
readonly package_size="$(stat -f '%z' "$final_pkg")"
printf '{"version":"%s","object_key":"os1/releases/%s/OS-1-%s.pkg","sha256":"%s","size":%s,"minimum_macos":"13.0"}\n' \
  "$version" "$version" "$version" "$package_sha256" "$package_size" \
  > "$output_dir/latest.json"

echo "Release package: $final_pkg"
echo "Release manifest: $output_dir/latest.json"
echo "Release mode: $release_mode"
echo "SHA-256: $package_sha256"
