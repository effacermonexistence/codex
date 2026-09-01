#!/usr/bin/env bash
set -euo pipefail

readonly repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

pnpm install --frozen-lockfile
for os1_worker in \
  os1-auth-service \
  os1-device-registry \
  os1-result-evaluator \
  os1-route-core \
  os1-private-route-core
do
  pnpm --dir "products/$os1_worker" types
  pnpm --dir "products/$os1_worker" check
  pnpm --dir "products/$os1_worker" deploy:dry-run
done
pnpm --dir products/os1-route-core test
pnpm --dir products/os1-private-route-core test

for os1_worker in \
  os1-auth-service \
  os1-device-registry \
  os1-result-evaluator \
  os1-route-core \
  os1-private-route-core
do
  pnpm --dir "products/$os1_worker" exec wrangler deploy
done

pnpm --dir products/os1-route-core redteam:deployed
echo "OS-1 Workers deployed and smoke-tested."
