#!/usr/bin/env bash
# ============================================================
# SCV RESTORE GOLDEN — one command hard rollback to the known-good state.
# Ben 2026-07-09: "무너져도 내가 시간 안 뺏기게" — if anything drifts, this
# restores EVERY sealed file to the golden snapshot and verifies the immutable
# drift firewall passes. Internal files only; external API/ManyChat untouched.
#
#   ./scv_restore_golden.sh          # restore sealed files to golden + verify
#   ./scv_restore_golden.sh --check  # verify only, change nothing (dry drift check)
#
# Golden reference = manifest.current_restore_ref (override: SCV_GOLDEN_REF=<ref>).
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

MANIFEST="SCV_GOLDEN_SNAPSHOT_MANIFEST.json"
GOLDEN_REF="${SCV_GOLDEN_REF:-$(node -p "require('./$MANIFEST').current_restore_ref")}"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

if ! git rev-parse "$GOLDEN_REF" >/dev/null 2>&1; then
  echo "❌ golden ref not found: $GOLDEN_REF" >&2; exit 1
fi

# Sealed files come straight from the manifest, so this always covers exactly what
# the firewall protects (no drift between this script and the seal). Written to a
# temp file (portable to macOS bash 3.2 which lacks `mapfile`).
SEALED_LIST=""
DRIFT_LIST=""
SEALED_LIST="$(mktemp)"
trap 'rm -f -- "${SEALED_LIST:-}" "${DRIFT_LIST:-}" 2>/dev/null || true' EXIT
node -e '
  const m = require("./'"$MANIFEST"'");
  const s = new Set([
    ...Object.keys(m.critical_file_sha256 || {}),
    ...Object.keys(m.critical_file_canonical_sha256 || {})
  ]);
  for (const f of s) console.log(f);
' > "$SEALED_LIST"

SEALED_COUNT=$(grep -c . "$SEALED_LIST" 2>/dev/null || true); SEALED_COUNT=${SEALED_COUNT:-0}
echo "golden ref : $GOLDEN_REF ($(git rev-parse --short "$GOLDEN_REF"))"
echo "sealed files: $SEALED_COUNT"

# Report which sealed files currently differ from golden.
DRIFT_LIST="$(mktemp)"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if ! git diff --quiet "$GOLDEN_REF" -- "$f" 2>/dev/null; then
    echo "$f" >> "$DRIFT_LIST"
  fi
done < "$SEALED_LIST"

DRIFT_COUNT=$(grep -c . "$DRIFT_LIST" 2>/dev/null || true); DRIFT_COUNT=${DRIFT_COUNT:-0}
if [ "$DRIFT_COUNT" -eq 0 ]; then
  echo "✅ no drift — every sealed file already matches golden"
else
  echo "⚠️  drifted sealed files ($DRIFT_COUNT):"
  sed 's/^/   - /' "$DRIFT_LIST"
  if [ "$CHECK_ONLY" -eq 1 ]; then
    echo "(--check: nothing restored)"; exit 2
  fi
  echo "restoring to golden…"
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    git checkout "$GOLDEN_REF" -- "$f"
    echo "   restored $f"
  done < "$DRIFT_LIST"
fi

echo "verifying immutable drift firewall…"
if node scv-immutable-drift-firewall.js >/dev/null 2>&1; then
  echo "✅ firewall PASS — tree is exactly golden"
else
  echo "❌ firewall FAIL after restore — investigate (seal/manifest itself may be off)" >&2
  node scv-immutable-drift-firewall.js 2>&1 | tail -3 >&2
  exit 1
fi
