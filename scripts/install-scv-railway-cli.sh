#!/usr/bin/env bash
# Explicit prerequisite installer; the restore wrapper does not run this silently.
# Digests from official railwayapp/cli GitHub release v5.45.10 assets.
set -euo pipefail
umask 077
version='5.45.10'
binary="$HOME/.railway/bin/railway"
if [[ -x "$binary" && "$("$binary" --version)" == "railway $version" ]]; then
  echo "Pinned Railway CLI already installed"
  exit 0
fi
[[ "$(uname -s)" == Darwin ]] || { echo 'This SCV desktop prerequisite is macOS-only' >&2; exit 1; }
case "$(uname -m)" in
 arm64) asset='railway-v5.45.10-aarch64-apple-darwin.tar.gz'; sha='e7da75a59c8097e3606bbbf851799e92d8a51c959fd62900fe6d94974909ad22'; bytes=6270140 ;;
 x86_64) asset='railway-v5.45.10-x86_64-apple-darwin.tar.gz'; sha='fb12c2628e8f125494f52b36da1d09d0ab7b9a3d7f4ae3e40775becc06ffae2e'; bytes=6805356 ;;
 *) echo 'Unsupported Mac architecture' >&2; exit 1 ;;
esac
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
curl -fL --proto '=https' --tlsv1.2 --retry 3 "https://github.com/railwayapp/cli/releases/download/v${version}/${asset}" -o "$tmp/railway.tar.gz"
[[ "$(wc -c < "$tmp/railway.tar.gz" | tr -d ' ')" == "$bytes" ]] || { echo 'Railway asset size mismatch' >&2; exit 1; }
printf '%s  %s\n' "$sha" "$tmp/railway.tar.gz" | shasum -a 256 -c -
python3 - "$tmp/railway.tar.gz" "$tmp/railway" <<'PY'
import pathlib,sys,tarfile
with tarfile.open(sys.argv[1]) as archive:
 members=archive.getmembers()
 if len(members)!=1 or not members[0].isfile() or members[0].name not in ('railway','./railway'):
  raise SystemExit('Unexpected Railway release archive inventory')
 pathlib.Path(sys.argv[2]).write_bytes(archive.extractfile(members[0]).read())
PY
chmod 0755 "$tmp/railway"
[[ "$("$tmp/railway" --version)" == "railway $version" ]] || { echo 'Railway executable version mismatch' >&2; exit 1; }
mkdir -p "$HOME/.railway/bin"
if [[ -e "$binary" ]]; then cp -p "$binary" "${binary}.before-scv.$(date -u +%Y%m%dT%H%M%SZ).$$"; fi
install -m 0755 "$tmp/railway" "${binary}.new.$$"
mv "${binary}.new.$$" "$binary"
echo 'Pinned Railway CLI installed without transferring authentication'
echo 'Run railway login only if existing railway whoami cannot use this device authentication'
