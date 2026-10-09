#!/usr/bin/env bash
set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
readonly runtime_root="$(cd "$script_dir/.." && pwd -P)"
readonly repository_root="$(cd "$runtime_root/../.." && pwd -P)"
readonly source_key="$(printf '%s' "$runtime_root" | shasum -a 256 | cut -c1-20)"
readonly source_commit="$(git --no-optional-locks -C "$repository_root" rev-parse HEAD)"
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'Release source has no exact Git commit.' >&2; exit 1; }
readonly source_origin="$(git --no-optional-locks -C "$repository_root" remote get-url origin)"
case "$source_origin" in
  https://github.com/effacermonexistence/codex|https://github.com/effacermonexistence/codex.git|git@github.com:effacermonexistence/codex.git|ssh://git@github.com/effacermonexistence/codex.git) ;;
  *) echo 'Release source repository identity does not match effacermonexistence/codex.' >&2; exit 1 ;;
esac
source_tree_is_clean() {
  python3 - "$repository_root" "$HOME/Library/Caches/OS-1/releases/$source_key" <<'PY'
import pathlib, subprocess, sys
root=pathlib.Path(sys.argv[1]); generated="products/os1-mac-runtime/release"
result=subprocess.run(["git","--no-optional-locks","-C",str(root),"status","--porcelain=v1","-z","--untracked-files=all"],capture_output=True,check=True)
parts=result.stdout.split(b"\0"); clean=True; i=0
while i < len(parts):
    entry=parts[i]; i+=1
    if not entry: continue
    code=entry[:2]; path=entry[3:].decode("utf-8","surrogateescape")
    if b"R" in code or b"C" in code:
        i+=1  # A rename/copy is source mutation, never a generated-link exemption.
        clean=False; continue
    link=root/generated
    if path==generated and link.is_symlink() and link.resolve()==pathlib.Path(sys.argv[2]).resolve(): continue
    clean=False
print("1" if clean else "0")
PY
}
# Capture before tests/builds and before release/ is rewritten. Dirty automatic
# self-repairs are stamped only by their later post-commit install outcome.
readonly source_input_clean="$(source_tree_is_clean)"
python3 "$script_dir/check-startup-isolation.py"
python3 "$script_dir/test-task-quality-wiring.py"
python3 "$script_dir/test-memory-paging-wiring.py"
python3 "$script_dir/test-codex-audio-tap-wiring.py"
python3 "$script_dir/test-voice-send-ui-wiring.py"
python3 "$script_dir/test-browser-dictation-wiring.py"
node "$script_dir/test-memory-paging-recovery.mjs"
python3 "$script_dir/test-backend-window-focus.py"
python3 "$script_dir/test-os1-source-confinement-wiring.py"
python3 "$script_dir/test-owner-policy-sync.py"
# The bundle's own Info.plist is the single source of truth for the release
# version. A hardcoded default silently diverged from it and the identity
# check below then refused to package — every build since 0.9.57 produced no
# pkg, and the CI job failed for the same reason.
readonly version="${OS1_VERSION:-$(plutil -extract CFBundleShortVersionString raw -o - "$runtime_root/Resources/Info.plist")}"
readonly release_mode="${OS1_RELEASE_MODE:-development}"
# File Provider can reattach FinderInfo after xattr -c, invalidating signing.
# Keep generated release payloads outside synchronized Documents; retain the
# checkout's established release/ entry point for self-update consumers.
readonly release_entry="$runtime_root/release"
readonly output_dir="${OS1_RELEASE_OUTPUT_DIR:-$HOME/Library/Caches/OS-1/releases/$source_key}"
readonly stage_dir="$output_dir/stage"
readonly audit_dir="$output_dir/audit"
readonly component_pkg="$output_dir/OS-1-component.pkg"
readonly unsigned_pkg="$output_dir/OS-1-${version}-unsigned.pkg"
readonly final_pkg="$output_dir/OS-1-${version}.pkg"
readonly arm64_build_dir="${OS1_ARM64_BUILD_DIR:-$runtime_root/.build-release-arm64}"
readonly x86_64_build_dir="${OS1_X86_64_BUILD_DIR:-$runtime_root/.build-release-x86_64}"
readonly skip_build="${OS1_SKIP_BUILD:-0}"
local_identity='-'
signing_state_dir="$HOME/Library/Application Support/OS-1/build-signing"
identity_file="$signing_state_dir/identity-sha1"
keychain_path_file="$signing_state_dir/keychain-path"
keychain_password_file="$signing_state_dir/keychain-password"
codesign_keychain_options=()
if [[ "$release_mode" == development && -f "$identity_file" ]]; then
  local_identity=$(tr -d '\n' < "$identity_file")
  [[ "$local_identity" =~ ^[A-Fa-f0-9]{40}$ ]] || { echo 'Invalid saved local signer.' >&2; exit 1; }
  if [[ -f "$keychain_path_file" || -f "$keychain_password_file" ]]; then
    [[ -f "$keychain_path_file" && -f "$keychain_password_file" ]] || {
      echo 'Incomplete saved local signer keychain state.' >&2; exit 1;
    }
    signing_keychain=$(tr -d '\n' < "$keychain_path_file")
    case "$signing_keychain" in
      "$HOME"/Library/Keychains/*.keychain-db) ;;
      *) echo 'Refusing unexpected local signer keychain path.' >&2; exit 1 ;;
    esac
    [[ -f "$signing_keychain" ]] || { echo 'Saved local signer keychain is unavailable.' >&2; exit 1; }
    signing_keychain_password=$(cat "$keychain_password_file")
    security unlock-keychain -p "$signing_keychain_password" "$signing_keychain"
    codesign_keychain_options=(--keychain "$signing_keychain")
  fi
fi
readonly codesign_identity="${OS1_CODESIGN_IDENTITY:-$local_identity}"
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
  "$runtime_root"/release|"$HOME/Library/Caches/OS-1/releases/$source_key"|/tmp/os1-release.*) ;;
  *) echo "Refusing unexpected release output: $output_dir" >&2; exit 1 ;;
esac

if [[ -z "${OS1_RELEASE_OUTPUT_DIR:-}" ]]; then
  if [[ -e "$release_entry" || -L "$release_entry" ]]; then
    rm -rf "$release_entry"
  fi
  mkdir -p "$(dirname "$output_dir")"
  ln -s "$output_dir" "$release_entry"
fi

rm -rf "$output_dir"
mkdir -p \
  "$stage_dir/Applications/OS-1 CLODEX.app/Contents/MacOS" \
  "$stage_dir/Applications/OS-1 CLODEX.app/Contents/Resources" \
  "$stage_dir/usr/local/bin" \
  "$stage_dir/Library/Application Support/OS-1" \
  "$audit_dir"

if [[ "$skip_build" == "1" ]]; then
  [[ -x "$arm64_build_dir/arm64-apple-macosx/release/os1" ]]
  [[ -x "$arm64_build_dir/arm64-apple-macosx/release/OS1App" ]]
  [[ -x "$x86_64_build_dir/x86_64-apple-macosx/release/os1" ]]
  [[ -x "$x86_64_build_dir/x86_64-apple-macosx/release/OS1App" ]]
  [[ -x "$arm64_build_dir/arm64-apple-macosx/release/OS1Checkout" ]]
  [[ -x "$x86_64_build_dir/x86_64-apple-macosx/release/OS1Checkout" ]]
else
  swift build --package-path "$runtime_root" -c release \
    --triple arm64-apple-macosx13.0 \
    --build-path "$arm64_build_dir"
  swift build --package-path "$runtime_root" -c release \
    --triple x86_64-apple-macosx13.0 \
    --build-path "$x86_64_build_dir"
  node "$script_dir/configure-swiftmath-resources.mjs" \
    "$arm64_build_dir/arm64-apple-macosx" "$x86_64_build_dir/x86_64-apple-macosx"
  swift build --package-path "$runtime_root" -c release --triple arm64-apple-macosx13.0 --build-path "$arm64_build_dir"
  swift build --package-path "$runtime_root" -c release --triple x86_64-apple-macosx13.0 --build-path "$x86_64_build_dir"
fi

for build in "$arm64_build_dir/arm64-apple-macosx" "$x86_64_build_dir/x86_64-apple-macosx"; do
  grep -q 'OS1 portable resources' "$(dirname "$build")/checkouts/SwiftMath/Sources/SwiftMath/MathRender/MTFont.swift" || {
    echo "Math resource accessor is not portable; rebuild without OS1_SKIP_BUILD." >&2; exit 1;
  }
done

lipo -create \
  "$arm64_build_dir/arm64-apple-macosx/release/os1" \
  "$x86_64_build_dir/x86_64-apple-macosx/release/os1" \
  -output "$stage_dir/usr/local/bin/os1"
install -m 0755 "$stage_dir/usr/local/bin/os1" \
  "$stage_dir/Applications/OS-1 CLODEX.app/Contents/Resources/os1"
install -m 0755 "$script_dir/sync-owner-policy.py" \
  "$stage_dir/Applications/OS-1 CLODEX.app/Contents/Resources/sync-owner-policy.py"
lipo -create \
  "$arm64_build_dir/arm64-apple-macosx/release/OS1App" \
  "$x86_64_build_dir/x86_64-apple-macosx/release/OS1App" \
  -output "$stage_dir/Applications/OS-1 CLODEX.app/Contents/MacOS/OS1App"
# OS-1 Checkout: the owner-approved checkout helper, a separate app so the
# browser Automation permission the owner grants it is not inherited by
# backends (they are OS-1's children, not the helper's).
readonly checkout_app="$stage_dir/Applications/OS-1 CLODEX.app/Contents/Helpers/OS-1 Checkout.app"
mkdir -p "$checkout_app/Contents/MacOS"
lipo -create \
  "$arm64_build_dir/arm64-apple-macosx/release/OS1Checkout" \
  "$x86_64_build_dir/x86_64-apple-macosx/release/OS1Checkout" \
  -output "$checkout_app/Contents/MacOS/OS1Checkout"
install -m 0644 "$runtime_root/Resources/OS1Checkout-Info.plist" "$checkout_app/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string "$version" "$checkout_app/Contents/Info.plist"
plutil -replace CFBundleVersion -string "$(plutil -extract CFBundleVersion raw -o - "$runtime_root/Resources/Info.plist")" \
  "$checkout_app/Contents/Info.plist"

install -m 0644 "$runtime_root/Resources/Info.plist" \
  "$stage_dir/Applications/OS-1 CLODEX.app/Contents/Info.plist"
readonly staged_info="$stage_dir/Applications/OS-1 CLODEX.app/Contents/Info.plist"
for key in OS1SourceCommit OS1SourceRoot OS1SourceRepository OS1SourceTreeClean; do
  plutil -remove "$key" "$staged_info" 2>/dev/null || true
done
if [[ "$source_input_clean" == "1" ]]; then
  [[ "$(git --no-optional-locks -C "$repository_root" rev-parse HEAD)" == "$source_commit" && "$(source_tree_is_clean)" == "1" ]] || {
    echo 'Clean release source changed during the build; refusing a false source identity.' >&2; exit 1;
  }
  plutil -insert OS1SourceCommit -string "$source_commit" "$staged_info"
  plutil -insert OS1SourceRoot -string "$repository_root" "$staged_info"
  plutil -insert OS1SourceRepository -string effacermonexistence/codex "$staged_info"
  plutil -insert OS1SourceTreeClean -bool true "$staged_info"
fi
for resource in OmarAGI.png Codex.png ClaudeCode.png Constellation.png CodexDictationCapture.html consumer-chatgpt-driver.mjs; do
  install -m 0644 "$runtime_root/Resources/$resource" \
    "$stage_dir/Applications/OS-1 CLODEX.app/Contents/Resources/$resource"
done
swift "$script_dir/build-brand-icon.swift" "$runtime_root/Resources/OmarAGI.png" "$audit_dir/OmarAGI.iconset"
iconutil -c icns "$audit_dir/OmarAGI.iconset" -o "$stage_dir/Applications/OS-1 CLODEX.app/Contents/Resources/OmarAGI.icns"
install -m 0644 "$runtime_root/Config/production.json" \
  "$stage_dir/Applications/OS-1 CLODEX.app/Contents/Resources/config.json"
install -m 0644 "$runtime_root/Config/production.json" \
  "$stage_dir/Library/Application Support/OS-1/config.json"

readonly math_bundle="$stage_dir/Applications/OS-1 CLODEX.app/Contents/Resources/SwiftMath_SwiftMath.bundle"
readonly math_source="$arm64_build_dir/arm64-apple-macosx/release/SwiftMath_SwiftMath.bundle"
mkdir -p "$math_bundle/mathFonts.bundle"
install -m 0644 "$math_source/Info.plist" "$math_bundle/Info.plist"
for font_resource in latinmodern-math.otf latinmodern-math.plist LICENSE GUST-FONT-LICENSE.txt; do
  install -m 0644 "$math_source/mathFonts.bundle/$font_resource" "$math_bundle/mathFonts.bundle/$font_resource"
done
install -m 0644 "$arm64_build_dir/checkouts/SwiftMath/LICENSE" "$math_bundle/SwiftMath-LICENSE.txt"

while IFS= read -r payload_file; do
  relative_path="${payload_file#"$stage_dir/"}"
  case "$relative_path" in
    "Applications/OS-1 CLODEX.app/Contents/MacOS/OS1App"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/os1"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/sync-owner-policy.py"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/OmarAGI.png"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/Codex.png"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/ClaudeCode.png"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/Constellation.png"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/CodexDictationCapture.html"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/consumer-chatgpt-driver.mjs"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/OmarAGI.icns"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/config.json"|\
    "Applications/OS-1 CLODEX.app/Contents/Info.plist"|\
    "Applications/OS-1 CLODEX.app/Contents/Helpers/OS-1 Checkout.app/Contents/MacOS/OS1Checkout"|\
    "Applications/OS-1 CLODEX.app/Contents/Helpers/OS-1 Checkout.app/Contents/Info.plist"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/SwiftMath_SwiftMath.bundle/Info.plist"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/SwiftMath_SwiftMath.bundle/SwiftMath-LICENSE.txt"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/SwiftMath_SwiftMath.bundle/mathFonts.bundle/latinmodern-math.otf"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/SwiftMath_SwiftMath.bundle/mathFonts.bundle/latinmodern-math.plist"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/SwiftMath_SwiftMath.bundle/mathFonts.bundle/LICENSE"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/SwiftMath_SwiftMath.bundle/mathFonts.bundle/GUST-FONT-LICENSE.txt"|\
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
# Under `set -u` an empty array expands to an unbound-variable error on the
# CI runner (no signing keychain), so guard the expansion.
codesign_options=(--force --sign "$codesign_identity" ${codesign_keychain_options[@]+"${codesign_keychain_options[@]}"} --options runtime)
if [[ "$release_mode" == "distribution" ]]; then
  codesign_options+=(--timestamp)
else
  codesign_options+=(--timestamp=none)
fi
codesign "${codesign_options[@]}" \
  --identifier com.omaragi.os1.runtime "$stage_dir/usr/local/bin/os1"
codesign "${codesign_options[@]}" \
  --identifier com.omaragi.os1.runtime.bundled \
  "$stage_dir/Applications/OS-1 CLODEX.app/Contents/Resources/os1"
# Inside-out: the nested helper is signed before the bundle that seals it.
codesign "${codesign_options[@]}" \
  --entitlements "$runtime_root/Resources/OS1Checkout.entitlements" \
  --identifier com.omaragi.os1.checkout "$checkout_app"
codesign "${codesign_options[@]}" \
  --entitlements "$runtime_root/Resources/OS1.entitlements" \
  --identifier com.omaragi.os1 "$stage_dir/Applications/OS-1 CLODEX.app"
codesign --verify --strict --verbose=2 "$stage_dir/usr/local/bin/os1"
codesign --verify --deep --strict --verbose=2 "$stage_dir/Applications/OS-1 CLODEX.app"
lipo -archs "$stage_dir/usr/local/bin/os1" | grep -Eq '(^| )(x86_64 arm64|arm64 x86_64)($| )'
lipo -archs "$stage_dir/Applications/OS-1 CLODEX.app/Contents/MacOS/OS1App" | grep -Eq '(^| )(x86_64 arm64|arm64 x86_64)($| )'
codesign --verify --strict --verbose=2 "$checkout_app"
lipo -archs "$checkout_app/Contents/MacOS/OS1Checkout" | grep -Eq '(^| )(x86_64 arm64|arm64 x86_64)($| )'
[[ "$(plutil -extract CFBundleShortVersionString raw -o - "$checkout_app/Contents/Info.plist")" == "$version" ]]
[[ "$(plutil -extract CFBundleIdentifier raw -o - "$checkout_app/Contents/Info.plist")" == "com.omaragi.os1.checkout" ]]
codesign -d --entitlements :- "$checkout_app" 2>/dev/null | grep -q 'com.apple.security.automation.apple-events' || {
  echo "OS-1 Checkout lacks the Apple Events entitlement." >&2; exit 1;
}
[[ "$(plutil -extract CFBundleShortVersionString raw -o - "$stage_dir/Applications/OS-1 CLODEX.app/Contents/Info.plist")" == "$version" ]]
runtime_version="$("$stage_dir/usr/local/bin/os1" version)"
bundle_build="$(plutil -extract CFBundleVersion raw -o - "$stage_dir/Applications/OS-1 CLODEX.app/Contents/Info.plist")"
[[ "$runtime_version" == "OS-1 Runtime $version ("*"build$bundle_build)" ]] || {
  echo "Runtime and application release identities differ; refuse packaging." >&2; exit 1;
}
[[ "$("$stage_dir/Applications/OS-1 CLODEX.app/Contents/Resources/os1" version)" == "$runtime_version" ]]
"$stage_dir/usr/local/bin/os1" self-test
"$stage_dir/Applications/OS-1 CLODEX.app/Contents/MacOS/OS1App" --self-test
"$stage_dir/Applications/OS-1 CLODEX.app/Contents/MacOS/OS1App" --self-test-sidebar-queue
"$stage_dir/Applications/OS-1 CLODEX.app/Contents/MacOS/OS1App" --self-test-queue-fork
"$stage_dir/Applications/OS-1 CLODEX.app/Contents/MacOS/OS1App" --self-test-composer
"$stage_dir/Applications/OS-1 CLODEX.app/Contents/MacOS/OS1App" --self-test-steering
"$checkout_app/Contents/MacOS/OS1Checkout" --self-test
"$arm64_build_dir/arm64-apple-macosx/release/OS1ContextTests"
"$arm64_build_dir/arm64-apple-macosx/release/FrontierMonitorTests"
"$arm64_build_dir/arm64-apple-macosx/release/OS1HookSupportTests"
"$arm64_build_dir/arm64-apple-macosx/release/RetrievalRelevanceTests"
OS1_CONFIG="$stage_dir/Library/Application Support/OS-1/config.json" "$stage_dir/usr/local/bin/os1" fleet-self-test

COPYFILE_DISABLE=1 pkgbuild \
  --root "$stage_dir" \
  --component-plist "$runtime_root/InstallerComponents.plist" \
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
grep -q 'Applications/OS-1 CLODEX.app' "$payload_listing"
if grep -Eiq 'private-core|os1_local_core|darwin_routed_rcc|benchmark_priors|prompt_lineage|router_state|hinton_forward' "$payload_listing"; then
  echo "Private route-core path found after packaging." >&2
  exit 1
fi

pkgutil --expand-full "$final_pkg" "$audit_dir/expanded"
expanded_payload="$audit_dir/expanded/OS-1-component.pkg/Payload"
[[ "$(/usr/bin/xmllint --xpath 'count(/pkg-info/relocate/bundle)' "$audit_dir/expanded/OS-1-component.pkg/PackageInfo")" == "0" ]] || {
  echo "Refusing a relocatable application package." >&2; exit 1;
}
while IFS= read -r payload_file; do
  relative_path="${payload_file#"$expanded_payload/"}"
  case "$relative_path" in
    "Applications/OS-1 CLODEX.app/Contents/MacOS/OS1App"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/os1"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/sync-owner-policy.py"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/OmarAGI.png"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/Codex.png"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/ClaudeCode.png"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/Constellation.png"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/CodexDictationCapture.html"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/consumer-chatgpt-driver.mjs"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/OmarAGI.icns"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/config.json"|\
    "Applications/OS-1 CLODEX.app/Contents/Info.plist"|\
    "Applications/OS-1 CLODEX.app/Contents/Helpers/OS-1 Checkout.app/Contents/MacOS/OS1Checkout"|\
    "Applications/OS-1 CLODEX.app/Contents/Helpers/OS-1 Checkout.app/Contents/Info.plist"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/SwiftMath_SwiftMath.bundle/Info.plist"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/SwiftMath_SwiftMath.bundle/SwiftMath-LICENSE.txt"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/SwiftMath_SwiftMath.bundle/mathFonts.bundle/latinmodern-math.otf"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/SwiftMath_SwiftMath.bundle/mathFonts.bundle/latinmodern-math.plist"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/SwiftMath_SwiftMath.bundle/mathFonts.bundle/LICENSE"|\
    "Applications/OS-1 CLODEX.app/Contents/Resources/SwiftMath_SwiftMath.bundle/mathFonts.bundle/GUST-FONT-LICENSE.txt"|\
    "Applications/OS-1 CLODEX.app/Contents/_CodeSignature/CodeResources"|\
    "Applications/OS-1 CLODEX.app/Contents/Helpers/OS-1 Checkout.app/Contents/_CodeSignature/CodeResources"|\
    "usr/local/bin/os1"|\
    "Library/Application Support/OS-1/config.json") ;;
    *) echo "Refusing unexpected expanded payload file: $relative_path" >&2; exit 1 ;;
  esac
done < <(find "$expanded_payload" -type f -print | sort)
expanded_scripts="$audit_dir/expanded/OS-1-component.pkg/Scripts"
[[ "$(find "$expanded_scripts" -type f -print | wc -l | tr -d ' ')" == "1" ]]
[[ -f "$expanded_scripts/postinstall" ]]
# The exact public producing Git identity is release metadata, not a secret.
# Keep the canonical scanner intact; only this clean build's verified commit
# token receives a fingerprint exception. Other high-entropy values still fail.
readonly scan_policy="$audit_dir/source-bound-scan-policy.json"
python3 - "$repository_root/products/os1-route-core/security/client-artifact-scan-policy.json" "$scan_policy" "$source_commit" "$source_input_clean" "$repository_root" <<'PYSCAN'
import hashlib,json,pathlib,re,sys
policy=json.loads(pathlib.Path(sys.argv[1]).read_text()); commit=sys.argv[3]
if sys.argv[4]=='1':
    if re.fullmatch(r'[0-9a-f]{40}',commit) is None: raise SystemExit('Invalid source commit for release scan')
    root=str(pathlib.Path(sys.argv[5]).resolve())
    if not root.startswith(str(pathlib.Path.home())+'/'): raise SystemExit('Source root outside approved HOME')
    for token in [commit,root]:
        fingerprint=hashlib.sha256(token.encode()).hexdigest()
        if fingerprint not in policy['entropy']['allowedTokenSha256']: policy['entropy']['allowedTokenSha256'].append(fingerprint)
pathlib.Path(sys.argv[2]).write_text(json.dumps(policy,sort_keys=True))
PYSCAN
OS1_CLIENT_SCAN_POLICY_PATH="$scan_policy" node "$repository_root/products/os1-route-core/scripts/client-artifact-scan.mjs" \
  "$audit_dir/expanded"

readonly package_sha256="$(shasum -a 256 "$final_pkg" | awk '{print $1}')"
readonly package_size="$(stat -f '%z' "$final_pkg")"
printf '{"version":"%s","object_key":"os1/releases/%s/OS-1-%s.pkg","sha256":"%s","size":%s,"minimum_macos":"13.0"}\n' \
  "$version" "$version" "$version" "$package_sha256" "$package_size" \
  > "$output_dir/latest.json"

# Exercise the exact beta installer before publishing a development artifact.
if [[ "$release_mode" == "development" ]]; then
  python3 "$runtime_root/scripts/test-beta-owner-policy.py" "$final_pkg" "$output_dir/latest.json"
fi

echo "Release package: $final_pkg"
echo "Release manifest: $output_dir/latest.json"
echo "Release mode: $release_mode"
echo "SHA-256: $package_sha256"
