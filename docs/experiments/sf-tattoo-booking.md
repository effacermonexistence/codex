# SF tattoo booking — reversible experiment

Production remains unchanged. Do not deploy this branch until the owner approves the preview.

## Preserved production: R2 BACKUP #1

- Repository: https://github.com/effacermonexistence/codex
- Production URL: https://www.effacermonexistence.com
- Railway project: `febcfbd0-5760-401f-be17-d283c4754676`
- Service: `aa748c60-829e-4cd1-9368-cbf9b2dfa938`
- Environment: `653318b0-512d-4e9a-b3a4-606885a00936`
- Deployment: `4d1afef7-3ecf-4e09-9276-977c0d1d1375`, SUCCESS
- Release: `chapter-title-hierarchy-20261109T001725Z-67c2f744248c`
- Image: `sha256:f8f147d2c06b3c7b161274155136c1468e2fae3366fe6dc5acfdcc6c2f85ddb0`
- Preserved source commit: `759e3ea5c98b9bee9fd58bdaba02a9673e113b6c`
- Annotated tag: `r2-backup-001`; tag object `60de4f5fd1e5d7bff7300c352568a4f7fe672e9d`
- Backup branch: `backup/r2-backup-001`
- Source tree: `f0af2044659f8d0427f3e4ccd49070a7e523fb1d`

**Provenance:** the original production deployment was a Railway CLI upload with no Git source association or recorded historical commit SHA. The commit above was created for this backup from the exact running deployment's source. It is not a historical deployment commit. All 907 source and media files were independently hashed before and after read-only SSH capture; the source was stable. Regenerable `node_modules` and environment credentials were not captured. Existing production configuration and secrets remain in the same Railway service and were not changed.

The new backup tag and branch were pushed atomically without force and read back from GitHub before any experiment edits. No existing tag was overwritten. This source snapshot is an isolated root on the backup branch; the repository's unrelated `main` branch was not changed.

## R2 recovery identity

- Cloudflare account: `d18c5d440fedbf100c4afd13b4b7a2c0`
- Private bucket: `omar-private-archive`
- Manifest key: `effacer-site/r2-backup-001/20261110T005519Z-477f5fec62/manifest.json`
- Manifest SHA-256: `2dcca12f6439bca3522c5e6ff550108ca69f21cb5df5b365e23ecd51bb4d66e1`
- Full source archive: 500,383,887 bytes in 96 ordered parts
- Archive SHA-256: `6b63d9eabbe27ebe5c70e5dde67733ad04b9884b3d150f5be79c30fa44acb42d`
- Completion receipt: same prefix + `/phase1-verification.json`

Every part and manifest was downloaded from R2 and verified. The reassembled archive was actually extracted into a new directory; all 907 file hashes, byte counts and permission modes matched. Frozen dependency installation and the normal production build passed in that restored directory. The restored server started successfully and matched original health, release, APPLY and artwork-list responses. The captured baseline also matched all 154 live HTML routes byte for byte. These were local restoration drills; production was not redeployed.

Never replace or delete this tag, branch, manifest or archive objects. Use a new backup identity for another baseline.

## Experiment

Branch: `experiment/sf-tattoo-booking`, based on the backup commit above.

The existing `/apply` booking form has no appointment-specific heading. A small heading and city line are added immediately above the existing form:

> Tattoo Appointments
>
> San Francisco, California

The original Gilda Display heading family, PT Serif body role, 1rem body size, left-aligned form column, artwork, navigation, animations and booking schema remain. The new heading is 1.25rem, regular weight. The two requested English strings are explicitly marked `lang="en" translate="no"`; existing translations and translation status remain identical in all 31 supported languages. No client-side JavaScript, booking backend, gallery, homepage, footer or Instagram changes.

Runtime files changed:

1. `scripts/apply-appearance.cjs` — insert one semantic appointment introduction before the existing form mount.
2. `content/apply-appearance/style.css` — narrowly scoped typography and spacing for the new introduction.
3. `site/s/apply-appearance-5fe46a912fc929f9.css` — the corresponding compiled stylesheet; older assets retained.

Supporting additions: this document and `scripts/restore-r2-backup-001.py`.

## Preview and validation

On the development Mac while the preview servers run:

- Before/after, with mobile and desktop controls: http://127.0.0.1:4203/preview
- Experiment: http://127.0.0.1:4202/apply
- Preserved original: http://127.0.0.1:4201/apply

Validation performed:

- Frozen dependency install, `pnpm run build`, `node --check scripts/apply-appearance.cjs`, and `git diff --check` pass.
- All 154 HTML routes checked; all other 153 pages and all 154 footer responses are byte-identical. Removing only the new appointment section and replacing the new stylesheet reference reproduces the original APPLY response exactly, including its copy, scripts, form configuration and backend wiring.
- The same original-content comparison passes for `/apply` in all 31 supported languages, without changing translation/fallback status.
- Browser layouts checked at widths 320, 390, 767, 768 and 1440px. The new two-line introduction fits without horizontal overflow; form controls and footer do not overlap it. Existing required fields, file chooser and submit control remain enabled. Input interaction and native invalid/valid email checks pass.
- Before/after mobile and desktop screenshots captured through the Browser skill.
- No booking, file upload, email, Instagram action or production deployment was performed.

Existing full-suite limitation: `pnpm run check` fails before running because the captured production artifact omits `scripts/archive-viewport.mjs`, imported by its existing check script. Running the unmodified baseline check produces the same missing-module error. This pre-existing packaging issue was not changed for this experiment. There is no separate TypeScript configuration or type-check command.

## Exact rollback procedure

No rollback is required now: production is still the preserved version.

### Restore locally from R2 (read-only cloud operation)

Using the existing authenticated, repository-pinned Wrangler project, run the supplied helper. The destination must not exist. The helper pins the manifest hash, verifies every part and the complete archive, extracts only safe file paths, and verifies all 907 files and modes. It never deploys or overwrites the destination.

```sh
python3 scripts/restore-r2-backup-001.py \
  --destination /tmp/effacer-r2-backup-001-restored \
  --cache /tmp/effacer-r2-backup-001-cache \
  --wrangler-project /Users/lua/Documents/Codex/codex
cd /tmp/effacer-r2-backup-001-restored
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
node server.js 4204
```

Verify `/healthz`, `/apply`, `/continuous-render`, and that `/os1-delivery-proof.txt` returns the exact release above. Stop this local server before deployment. This restore/build/start procedure was tested successfully against the verified R2 readback.

### Alternative: restore exact Git source in a fresh folder

```sh
git clone --single-branch --branch r2-backup-001 \
  https://github.com/effacermonexistence/codex.git \
  /tmp/effacer-r2-backup-001-git
cd /tmp/effacer-r2-backup-001-git
test "$(git rev-parse HEAD)" = 759e3ea5c98b9bee9fd58bdaba02a9673e113b6c
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
```

### Return production to the baseline, only after an authorized rollback

From the verified restored folder, target the same existing service and environment so existing configuration and secret bindings remain intact:

```sh
RAILWAY_HTTP_TIMEOUT=600 /Users/lua/.railway/bin/railway up \
  --project febcfbd0-5760-401f-be17-d283c4754676 \
  --service aa748c60-829e-4cd1-9368-cbf9b2dfa938 \
  --environment 653318b0-512d-4e9a-b3a4-606885a00936 \
  --detach --message restore-r2-backup-001
```

Wait for the new deployment to reach SUCCESS. Confirm the footer build guard passes, `/healthz` reports `{"ok":true}`, `/os1-delivery-proof.txt` matches the preserved release, and the page responses match the restored local server. A newly built rollback may have a different Railway deployment ID and image digest; its source must still match the pinned backup. Never move the backup tag to that new deployment.
