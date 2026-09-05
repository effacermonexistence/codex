#!/usr/bin/env bash
set -euo pipefail

readonly gateway="https://os1-route-gateway.omar-git-r2-backup.workers.dev"
readonly local_bin="$HOME/.local/bin"
readonly gh_version="2.98.0"
readonly profile_file="$HOME/.zprofile"
readonly path_line='export PATH="$HOME/.local/bin:$PATH"'
readonly allow_unnotarized_beta="${OS1_ALLOW_UNNOTARIZED_BETA:-0}"
readonly beta_package_path="${OS1_BETA_PACKAGE_PATH:-}"
readonly beta_manifest_path="${OS1_BETA_MANIFEST_PATH:-}"
readonly skip_prerequisites="${OS1_SKIP_PREREQUISITES:-0}"
readonly skip_login="${OS1_SKIP_LOGIN:-0}"
readonly verify_only="${OS1_VERIFY_ONLY:-0}"

for os1_flag in "$allow_unnotarized_beta" "$skip_prerequisites" "$skip_login" "$verify_only"; do
  case "$os1_flag" in 0|1) ;; *) echo "OS-1 installer flags must be 0 or 1." >&2; exit 1 ;; esac
done

if [[ -n "$beta_package_path" || -n "$beta_manifest_path" ]]; then
  if [[ "$allow_unnotarized_beta" != "1" || -z "$beta_package_path" || -z "$beta_manifest_path" ]]; then
    echo "Local beta installation requires the beta flag, package, and manifest together." >&2
    exit 1
  fi
  case "$beta_package_path" in /*) ;; *) echo "The beta package path must be absolute." >&2; exit 1 ;; esac
  case "$beta_manifest_path" in /*) ;; *) echo "The beta manifest path must be absolute." >&2; exit 1 ;; esac
  if [[ ! -f "$beta_package_path" || -L "$beta_package_path" ||
        ! -f "$beta_manifest_path" || -L "$beta_manifest_path" ]]; then
    echo "The local beta package and manifest must be regular, non-symlink files." >&2
    exit 1
  fi
fi

verify_unnotarized_beta_package() {
  local package_path="$1"
  local manifest_version="$2"
  local expanded_root="$os1_tmp/expanded"
  local component_root="$expanded_root/OS-1-component.pkg"
  local payload_root="$component_root/Payload"
  local scripts_root="$component_root/Scripts"
  local package_info="$component_root/PackageInfo"
  local app_path="$payload_root/Applications/Open OS-1 Codex.app"
  local cli_path="$payload_root/usr/local/bin/os1"
  local bundled_cli_path="$app_path/Contents/Resources/os1"
  local app_config="$app_path/Contents/Resources/config.json"
  local system_config="$payload_root/Library/Application Support/OS-1/config.json"
  local relative_path
  local cli_archs
  local app_archs
  local cli_signature_details
  local bundled_cli_signature_details
  local app_signature_details
  local expanded_paths

  pkgutil --expand-full "$package_path" "$expanded_root" || {
    echo "OS-1 beta verification could not expand the package." >&2
    return 1
  }
  [[ -f "$expanded_root/Distribution" && -d "$component_root" ]] || {
    echo "OS-1 beta verification found an invalid package root." >&2
    return 1
  }
  [[ "$(find "$expanded_root" -mindepth 1 -maxdepth 1 -print | wc -l | tr -d ' ')" == "2" ]] || {
    echo "OS-1 beta verification found unexpected package components." >&2
    return 1
  }
  [[ -f "$component_root/Bom" && -f "$package_info" ]] || {
    echo "OS-1 beta verification found missing component metadata." >&2
    return 1
  }
  [[ "$(find "$component_root" -type f -print | wc -l | tr -d ' ')" == "15" ]] || {
    echo "OS-1 beta verification found an unexpected component file count." >&2
    return 1
  }
  [[ "$(find "$payload_root" -type f -print | wc -l | tr -d ' ')" == "12" ]] || {
    echo "OS-1 beta verification found an unexpected payload file count." >&2
    return 1
  }
  if [[ -n "$(find "$expanded_root" -type l -print -quit)" ]]; then
    echo "OS-1 beta verification refused a symbolic link." >&2
    return 1
  fi

  [[ "$(/usr/bin/xmllint --xpath 'string(/pkg-info/@identifier)' "$package_info")" == "com.omaragi.os1" &&
     "$(/usr/bin/xmllint --xpath 'string(/pkg-info/@version)' "$package_info")" == "$manifest_version" &&
     "$(/usr/bin/xmllint --xpath 'string(/pkg-info/@install-location)' "$package_info")" == "/" &&
     "$(/usr/bin/xmllint --xpath 'string(/pkg-info/@auth)' "$package_info")" == "root" &&
     "$(/usr/bin/xmllint --xpath 'count(/pkg-info/scripts/postinstall)' "$package_info")" == "1" ]] || {
    echo "OS-1 beta verification found invalid package metadata." >&2
    return 1
  }
  [[ "$(/usr/bin/xmllint --xpath 'count(//script)' "$expanded_root/Distribution")" == "0" &&
     "$(/usr/bin/xmllint --xpath 'string(/installer-gui-script/options/@require-scripts)' "$expanded_root/Distribution")" == "false" &&
     "$(/usr/bin/xmllint --xpath 'string(/installer-gui-script/options/@hostArchitectures)' "$expanded_root/Distribution")" == "x86_64,arm64" &&
     "$(/usr/bin/xmllint --xpath 'string(/installer-gui-script/pkg-ref[@id="com.omaragi.os1"][@version]/@version)' "$expanded_root/Distribution")" == "$manifest_version" ]] || {
    echo "OS-1 beta verification found an invalid distribution document." >&2
    return 1
  }
  if grep -Eiq 'https?://' "$expanded_root/Distribution"; then
    echo "OS-1 beta verification refused a remote package reference." >&2
    return 1
  fi

  while IFS= read -r payload_file; do
    relative_path="${payload_file#"$payload_root/"}"
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
      *) echo "OS-1 beta verification refused an unexpected payload file: $relative_path" >&2; return 1 ;;
    esac
  done < <(find "$payload_root" -type f -print | sort)

  while IFS= read -r payload_directory; do
    relative_path="${payload_directory#"$payload_root"}"
    case "$relative_path" in
      ""|\
      "/Applications"|\
      "/Applications/Open OS-1 Codex.app"|\
      "/Applications/Open OS-1 Codex.app/Contents"|\
      "/Applications/Open OS-1 Codex.app/Contents/MacOS"|\
      "/Applications/Open OS-1 Codex.app/Contents/Resources"|\
      "/Applications/Open OS-1 Codex.app/Contents/_CodeSignature"|\
      "/Library"|\
      "/Library/Application Support"|\
      "/Library/Application Support/OS-1"|\
      "/usr"|\
      "/usr/local"|\
      "/usr/local/bin") ;;
      *) echo "OS-1 beta verification refused an unexpected payload directory: $relative_path" >&2; return 1 ;;
    esac
  done < <(find "$payload_root" -type d -print | sort)

  while IFS= read -r component_directory; do
    relative_path="${component_directory#"$component_root"}"
    case "$relative_path" in
      ""|"/Payload"|"/Payload/"*|"/Scripts") ;;
      *) echo "OS-1 beta verification refused an unexpected component directory: $relative_path" >&2; return 1 ;;
    esac
  done < <(find "$component_root" -type d -print | sort)

  [[ "$(find "$scripts_root" -type f -print | wc -l | tr -d ' ')" == "1" &&
     -x "$scripts_root/postinstall" &&
     "$(/usr/bin/xmllint --xpath 'string(/pkg-info/scripts/postinstall/@file)' "$package_info")" == "./postinstall" ]] || {
    echo "OS-1 beta verification found an invalid installer script set." >&2
    return 1
  }
  [[ -x "$cli_path" && -x "$bundled_cli_path" && -x "$app_path/Contents/MacOS/OS1App" ]] || {
    echo "OS-1 beta verification found a missing executable." >&2
    return 1
  }
  cmp -s "$app_config" "$system_config" || {
    echo "OS-1 beta verification found inconsistent client configuration." >&2
    return 1
  }

  [[ "$(plutil -extract CFBundleIdentifier raw -o - "$app_path/Contents/Info.plist")" == "com.omaragi.os1" &&
     "$(plutil -extract CFBundleShortVersionString raw -o - "$app_path/Contents/Info.plist")" == "$manifest_version" ]] || {
    echo "OS-1 beta verification found invalid application metadata." >&2
    return 1
  }
  codesign --verify --strict "$cli_path" || return 1
  codesign --verify --strict "$bundled_cli_path" || return 1
  codesign --verify --deep --strict "$app_path" || return 1
  cli_signature_details="$(codesign -d --verbose=4 "$cli_path" 2>&1)"
  bundled_cli_signature_details="$(codesign -d --verbose=4 "$bundled_cli_path" 2>&1)"
  app_signature_details="$(codesign -d --verbose=4 "$app_path" 2>&1)"
  grep -Fqx 'Identifier=com.omaragi.os1.runtime' <<< "$cli_signature_details" || return 1
  grep -Fqx 'Identifier=com.omaragi.os1.runtime.bundled' <<< "$bundled_cli_signature_details" || return 1
  grep -Fqx 'Identifier=com.omaragi.os1' <<< "$app_signature_details" || return 1
  cli_archs="$(lipo -archs "$cli_path")"
  app_archs="$(lipo -archs "$app_path/Contents/MacOS/OS1App")"
  [[ "$cli_archs" == "x86_64 arm64" || "$cli_archs" == "arm64 x86_64" ]] || {
    echo "OS-1 beta verification found a non-universal CLI." >&2
    return 1
  }
  [[ "$app_archs" == "x86_64 arm64" || "$app_archs" == "arm64 x86_64" ]] || {
    echo "OS-1 beta verification found a non-universal application." >&2
    return 1
  }

  expanded_paths="$(find "$expanded_root" -print)"
  if grep -Eiq 'private-core|os1_local_core|darwin_routed_rcc|benchmark_priors|prompt_lineage|router_state|hinton_forward' <<< "$expanded_paths"; then
    echo "OS-1 beta verification found private route-core material." >&2
    return 1
  fi
  if grep -Eiq '"(routing_mode|local_core_path|private_core_path|policy_weights|routing_thresholds)"' "$app_config"; then
    echo "OS-1 beta verification found a forbidden client configuration key." >&2
    return 1
  fi
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "OS-1 requires macOS 13 or newer." >&2
  exit 1
fi
case "$(uname -m)" in arm64|x86_64) ;; *) echo "Unsupported Mac architecture." >&2; exit 1 ;; esac

os1_major="$(sw_vers -productVersion | cut -d. -f1)"
if (( os1_major < 13 )); then
  echo "OS-1 requires macOS 13 or newer." >&2
  exit 1
fi

os1_tmp="$(mktemp -d /tmp/os1-install.XXXXXX)"
cleanup() { rm -rf "$os1_tmp"; }
trap cleanup EXIT

if [[ -n "$beta_package_path" ]]; then
  cp "$beta_manifest_path" "$os1_tmp/latest.json" || exit 1
  cp "$beta_package_path" "$os1_tmp/OS-1.pkg" || exit 1
else
  curl -fL --retry 3 --proto '=https' --tlsv1.2 \
    -o "$os1_tmp/latest.json" "$gateway/v1/releases/latest" || exit 1
  curl -fL --retry 3 --proto '=https' --tlsv1.2 \
    -o "$os1_tmp/OS-1.pkg" "$gateway/v1/releases/download" || exit 1
fi
os1_version="$(plutil -extract version raw -o - "$os1_tmp/latest.json")" || exit 1
os1_sha256="$(plutil -extract sha256 raw -o - "$os1_tmp/latest.json")" || exit 1
os1_size="$(plutil -extract size raw -o - "$os1_tmp/latest.json")" || exit 1
os1_minimum_macos="$(plutil -extract minimum_macos raw -o - "$os1_tmp/latest.json")" || exit 1
os1_object_key="$(plutil -extract object_key raw -o - "$os1_tmp/latest.json")" || exit 1
if [[ ! "$os1_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ||
      ! "$os1_sha256" =~ ^[0-9a-f]{64}$ ||
      ! "$os1_size" =~ ^[0-9]+$ ||
      "$os1_minimum_macos" != "13.0" ||
      "$os1_object_key" != "os1/releases/${os1_version}/OS-1-${os1_version}.pkg" ]]; then
  echo "OS-1 refused an invalid release manifest." >&2
  exit 1
fi

if [[ "$(stat -f '%z' "$os1_tmp/OS-1.pkg")" != "$os1_size" ]]; then
  echo "OS-1 refused a package whose size disagrees with the manifest." >&2
  exit 1
fi
if ! printf '%s  %s\n' "$os1_sha256" "$os1_tmp/OS-1.pkg" | shasum -a 256 -c -; then
  echo "OS-1 refused a package whose SHA-256 disagrees with the manifest." >&2
  exit 1
fi
if pkgutil --check-signature "$os1_tmp/OS-1.pkg" >/dev/null 2>&1 &&
   spctl --assess --type install "$os1_tmp/OS-1.pkg" >/dev/null 2>&1; then
  echo "Verified Apple-signed and notarized OS-1 package."
elif [[ "$allow_unnotarized_beta" == "1" ]]; then
  echo "WARNING: installing an unnotarized OS-1 beta after local integrity verification." >&2
  if ! verify_unnotarized_beta_package "$os1_tmp/OS-1.pkg" "$os1_version"; then
    echo "OS-1 refused the unnotarized beta package." >&2
    exit 1
  fi
  echo "Verified OS-1 beta package structure, allowlist, code integrity, and architectures."
else
  echo "OS-1 refused a package that did not pass Apple signature and distribution assessment." >&2
  echo "For an explicitly accepted local beta, use the OS-1 beta bundle instead." >&2
  exit 1
fi

if [[ "$verify_only" == "1" ]]; then
  echo "OS-1 package verification succeeded; installation was not performed."
  exit 0
fi

mkdir -p "$local_bin" || exit 1
export PATH="$local_bin:/opt/homebrew/bin:/usr/local/bin:/Applications/ChatGPT.app/Contents/Resources:$PATH"
if [[ ! -f "$profile_file" ]] || ! grep -Fqx "$path_line" "$profile_file"; then
  printf '\n%s\n' "$path_line" >> "$profile_file" || exit 1
fi

if [[ "$skip_prerequisites" != "1" ]]; then
  if ! command -v codex >/dev/null 2>&1; then
    if ! curl -fsSL --proto '=https' --tlsv1.2 https://chatgpt.com/codex/install.sh | sh; then
      echo "OS-1 could not install the Codex prerequisite." >&2
      exit 1
    fi
  fi
  if ! command -v claude >/dev/null 2>&1; then
    if ! curl -fsSL --proto '=https' --tlsv1.2 https://claude.ai/install.sh | bash; then
      echo "OS-1 could not install the Claude prerequisite." >&2
      exit 1
    fi
  fi
  if ! command -v gh >/dev/null 2>&1; then
    case "$(uname -m)" in
      arm64) gh_arch="arm64"; gh_sha256="8cfb027cc5310675f2b830eac8f9865c1155a45ffcf9757f699fdd5a22046ca4" ;;
      x86_64) gh_arch="amd64"; gh_sha256="734c7bbd0bc56a3974500ee9aea74d60f0e5b89be09e92b9d9148939a3a1e0e6" ;;
    esac
    curl -fL --retry 3 --proto '=https' --tlsv1.2 \
      -o "$os1_tmp/gh.zip" \
      "https://github.com/cli/cli/releases/download/v${gh_version}/gh_${gh_version}_macOS_${gh_arch}.zip" || exit 1
    printf '%s  %s\n' "$gh_sha256" "$os1_tmp/gh.zip" | shasum -a 256 -c - || exit 1
    unzip -q "$os1_tmp/gh.zip" -d "$os1_tmp/gh" || exit 1
    install -m 0755 "$os1_tmp/gh/gh_${gh_version}_macOS_${gh_arch}/bin/gh" "$local_bin/gh" || exit 1
    codesign --verify "$local_bin/gh" || exit 1
  fi
fi

if ! sudo installer -pkg "$os1_tmp/OS-1.pkg" -target /; then
  echo "OS-1 installation failed." >&2
  exit 1
fi

/usr/local/bin/os1 configure-claude-exo
/usr/local/bin/os1 configure-codex-exo

if [[ "$skip_login" != "1" && -t 0 ]]; then
  gh auth status --hostname github.com >/dev/null 2>&1 || \
    gh auth login --hostname github.com --git-protocol https --web
  codex login status >/dev/null 2>&1 || codex login --device-auth
  claude auth status 2>/dev/null | grep -q '"loggedIn": true' || claude auth login
fi

echo "Installed Open OS-1 Codex $os1_version."
if gh auth status --hostname github.com >/dev/null 2>&1 && \
   codex login status >/dev/null 2>&1 && \
   claude auth status 2>/dev/null | grep -q '"loggedIn": true'; then
  /usr/local/bin/os1 register || exit 1
  /usr/local/bin/os1 doctor || exit 1
  /usr/local/bin/os1 configure-fleet-agent --role auto || exit 1
else
  echo "Finish the three one-time logins, then run: os1 register && os1 doctor && os1 configure-fleet-agent --role auto"
fi
