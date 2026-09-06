#!/usr/bin/env bash
set -euo pipefail

readonly script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly product_dir="$(cd "$script_dir/.." && pwd)"
readonly repository_root="$(cd "$product_dir/../.." && pwd)"
readonly private_core="$repository_root/products/os1-mac-runtime/.private-core"
readonly wrangler="$product_dir/node_modules/.bin/wrangler"
readonly stage="$(mktemp -d /tmp/os1-rcc-v26-private.XXXXXX)"
trap 'rm -rf "$stage"' EXIT

[[ -x "$wrangler" && -f "$private_core/os1_local_core.py" && -f "$private_core/pyproject.toml" ]]
/usr/bin/python3 "$private_core/os1_local_core.py" self-test >/dev/null

(
  cd "$private_core"
  uv run pywrangler sync
)

for name in \
  worker.py wrangler.jsonc os1_local_core.py os1_legacy_20260903.py os1_legacy_20260905_16.py \
  os1_legacy_20260905_17.py os1_legacy_20260906_18.py os1_legacy_20260906_19.py os1_legacy_20260906_21.py darwin_routed_rcc.py \
  OMAR_LUA_RCC_ENGINE_v26_CLEAN_CONSOLIDATED.txt \
  darwin_benchmark_priors.json darwin_prompt_lineage.json \
  darwin_router_state.json hinton_forward_forward_state.json; do
  install -m 0600 "$private_core/$name" "$stage/$name"
done
ditto "$private_core/python_modules" "$stage/python_modules"

(
  cd "$stage"
  "$wrangler" deploy --config wrangler.jsonc "$@"
)
