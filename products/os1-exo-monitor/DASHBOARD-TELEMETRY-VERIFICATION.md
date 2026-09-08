# Dashboard sensor-validity verification

Source: `effacermonexistence/exo` at
`0f340ce530d0df5fcb646bbad02e7eac7f01830c`, followed by
`patches/0007-fix-require-valid-activity-sensors.patch` (`git apply`).

No runtime source, model, identity, authentication, or Pro configuration is
modified by this frontend patch. The included dashboard build is generated
from that exact patched source. The pinned npm lockfile is unchanged:
SHA-256 `335cc38b91abc47571e8818f084823a524546163de3f81b6770d27ba079af667`.

## Contract

- Missing legacy `sensor_status` does not establish a measurement. Its former
  zero GPU/power/temperature values display as `Unavailable`.
- Available EXO macmon measurements must contain finite, bounded numeric
  fields, valid timestamps and an age no greater than 15 seconds. Cached
  responses continue aging even when a peer stops responding.
- Real measured zero remains zero. Missing intervals are gaps in graphs, not
  invented zeros or lines connecting across missing samples.
- Cluster GPU average and power total require all displayed node values.
  Balance requires exactly two fresh nodes with valid sensor data and fresh
  queue data. Missing or stale inputs never produce a convergence score.
- Energy is labeled sampled energy; coverage uses `sampled_duration_seconds`,
  never process uptime. Unavailable or first-interval energy remains unknown.

## Reproduction

From the patched source's `dashboard` directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
node --test tests/activity-telemetry.test.mjs
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler src/lib/utils/activityTelemetry.ts
OS1_TEST_PLAYWRIGHT_MODULE=/path/to/existing/playwright node tests/activity-dashboard-browser.test.mjs
```

Build used Node 24.19.0 and npm 10.9.2. Eight deterministic telemetry tests
passed. Two built-dashboard browser scenarios passed (legacy peer unavailable;
both peers reporting measured zero), with zero JavaScript errors and only GET
requests. All browser network data is synthetic and intercepted; neither real
EXO endpoint is exercised by those browser fixtures. The unavailable-state
preview was visually inspected for labels, graphs, balance, and layout.

Full `svelte-check` reports 15 errors and 6 warnings in 9 unrelated pre-existing
files. An untouched checkout of the pinned source with the same lockfile and
dependencies reports the identical 15 errors and 6 warnings. No diagnostic
points at the activity page or the new helper. The focused strict TypeScript
check and production Vite build pass; a globally clean dashboard typecheck is
not claimed.

This verifies frontend behavior, not live sensor availability. An unavailable
Pro sensor must remain unavailable until that node supplies actual telemetry.
