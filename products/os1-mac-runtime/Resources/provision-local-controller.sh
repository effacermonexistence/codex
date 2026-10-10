#!/bin/bash
# Stock-macOS, no-Xcode-CLT first stage. This fetches only the pinned Node
# runtime, then hands the signed resource contract to Node for the rest.
set -euo pipefail
[[ "$#" == 3 && "$1" == --ensure && "$2" == --resources ]] || {
  echo 'OS-1 local controller: invalid first-run invocation' >&2; exit 2;
}
readonly resources="$3"
[[ "$resources" == /* && -d "$resources" && ! -L "$resources" &&
   -f "$resources/provision-local-controller.mjs" &&
   -f "$resources/local-controller-sources.json" ]] || {
  echo 'OS-1 local controller: signed resource set is unavailable' >&2; exit 1;
}
readonly home="${HOME:?HOME is required}"
readonly root="$home/.os1/local-router"
readonly tools="$home/Library/Application Support/OS-1/tools"
readonly managed_node="$tools/node-v24.20.0/bin/node"
for owned in "$home/.os1" "$root" "$root/recovery" "$home/Library/Application Support/OS-1" \
             "$tools" "$tools/node-v24.20.0" "$managed_node"; do
  [[ ! -L "$owned" ]] || { echo 'OS-1 local controller: owner path is a symlink' >&2; exit 1; }
done
/bin/mkdir -p "$root/recovery" "$tools"
/bin/chmod 700 "$root" "$root/recovery" "$tools"
case "$(/usr/bin/uname -m)" in
    arm64)
      readonly arch=arm64
      readonly archive_sha=40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8
      readonly binary_sha=9d050fd455b56426e25d4d603c7c501cbb2630348e836cf221dcce748e90588a
      readonly archive_name=node-v24.20.0-darwin-arm64.tar.gz
      ;;
    x86_64)
      readonly arch=x86_64
      readonly archive_sha=9e5b2644cf107befb6aefca676b96d3296bc10138096f022ed378d6233ed81f4
      readonly binary_sha=bb37f3a05d1104a9ca2488718a32ff07f3d0725b7b7b6a04bb26a5af7213fe12
      readonly archive_name=node-v24.20.0-darwin-x64.tar.gz
      ;;
    *) echo 'OS-1 local controller: unsupported macOS architecture' >&2; exit 1 ;;
esac
readonly archive="$root/recovery/$archive_name"
  if [[ -e "$archive" ]]; then
    [[ -f "$archive" && ! -L "$archive" ]] || { echo 'OS-1 local controller: pinned Node cache is not a file' >&2; exit 1; }
  else
    /usr/bin/curl -fsSL --retry 2 --proto '=https' --tlsv1.2 \
      -o "$archive.partial.$$" "https://nodejs.org/dist/v24.20.0/$archive_name"
    printf '%s  %s\n' "$archive_sha" "$archive.partial.$$" | /usr/bin/shasum -a 256 -c - >/dev/null || {
      echo 'OS-1 local controller: downloaded Node archive digest mismatch' >&2; exit 1;
    }
    /bin/mv "$archive.partial.$$" "$archive"
    /bin/chmod 600 "$archive"
  fi
  printf '%s  %s\n' "$archive_sha" "$archive" | /usr/bin/shasum -a 256 -c - >/dev/null || {
    echo 'OS-1 local controller: Node archive digest mismatch' >&2; exit 1;
  }
  if [[ ! -x "$managed_node" ]]; then
    [[ ! -e "$tools/node-v24.20.0" && ! -L "$tools/node-v24.20.0" ]] || {
      echo 'OS-1 local controller: incomplete Node install preserved for recovery' >&2; exit 1;
    }
    stage="$(/usr/bin/mktemp -d "$tools/.node-v24.20.0.stage.XXXXXX")"
    /usr/bin/tar -xzf "$archive" -C "$stage" --strip-components=1
    printf '%s  %s\n' "$binary_sha" "$stage/bin/node" | /usr/bin/shasum -a 256 -c - >/dev/null || {
      echo 'OS-1 local controller: staged Node binary digest mismatch' >&2; exit 1;
    }
    [[ "$("$stage/bin/node" --version)" == v24.20.0 ]] || {
      echo 'OS-1 local controller: staged Node version mismatch' >&2; exit 1;
    }
    /bin/mv "$stage" "$tools/node-v24.20.0"
  fi
  printf '%s  %s\n' "$binary_sha" "$managed_node" | /usr/bin/shasum -a 256 -c - >/dev/null || {
    echo 'OS-1 local controller: installed Node binary digest mismatch' >&2; exit 1;
  }
readonly node="$managed_node"

# Drop every ambient credential/configuration variable before starting the
# JavaScript provisioner. Its private npm config files are empty and distinct.
exec /usr/bin/env -i HOME="$home" PATH="/usr/bin:/bin:/usr/sbin:/sbin" LANG=en_US.UTF-8 \
  "$node" "$resources/provision-local-controller.mjs" --ensure --resources "$resources"
