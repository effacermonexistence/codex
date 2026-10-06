# USUNG private R2 recovery

This workflow seals **one fixed Git commit of `products/usung-corporate`**, preserves every committed photograph/video/source/verification file, and restores it into a new directory. The original media under `baseline/` stays in the package. Generated `public/locales/` is rebuilt from the committed 31 language dictionaries. No `.env`, OAuth cache, credentials, `node_modules`, `.git`, `.wrangler`, or other project is included.

## Requirements and coordinates

- Node.js 22 or newer; Python 3 standard library; Git.
- Repository-pinned Wrangler from `node_modules/.bin/wrangler` (currently 4.127.1). Existing per-device OAuth is used; credentials are never copied or packaged.
- Cloudflare account: `d18c5d440fedbf100c4afd13b4b7a2c0`.
- Private bucket: `omar-private-archive`.
- Immutable release root: `usung-corporate/releases/<UTC date>/<full source commit>/`.
- Current USUNG selector: `usung-corporate/latest.json`.
- Railway project/service/environment: `3ed80199-e7ca-4d74-8258-d7cde282d310` / `056dec14-c2b1-4dcb-b152-29782e2ac385` / `f496e79f-dd76-431e-8e7c-2c3b0fc78d90`.
- Railway build root: `/products/usung-corporate`; port `8080`; live health: `https://usungcorp.com/health`.

## Seal the corrected release locally

Finish media review, build, source commit, deployment and actual live verification first. Record the full commit SHA, literal `/health.release`, and actual Railway deployment UUID. Use a fresh output directory whose parent exists:

```sh
node recovery.mjs seal \
  --repo /absolute/path/to/codex \
  --commit FULL_40_CHARACTER_COMMIT_SHA \
  --release EXACT_HEALTH_RELEASE_STRING \
  --deployment ACTUAL_RAILWAY_DEPLOYMENT_UUID \
  --out /absolute/private/path/to/new-seal
```

The command uses `git archive` of that fixed product tree, produces `usung-corporate.tar.gz`, and rejects compressed packages above 300 MiB. It safely extracts the archive, inventories every regular file's relative path/bytes/mode/SHA256, copies these three recovery tools, splits the same archive into 16 MiB parts, records each index/key/bytes/SHA256 and the full archive hash, verifies their ordered combined hash, creates `manifest.json`, verifies the full inventory, builds the four routes in every language, starts the restored server on an unused local port, checks actual health/release/language count and the four HTTP routes, verifies local asset references and unchanged media, then stops that temporary server. `pre-upload-drill.json` records the result. Nothing is uploaded by `seal`.

`manifest.json` fixes the source commit, source ref, release, deployment, account/bucket, package key/bytes/SHA256, every source file, and the companion tool hashes. Its own SHA256 is carried by the final pointer, avoiding a circular manifest hash.

## Upload and verify before adopting latest

After the corrected release seal and local drill pass, publish the saved release:

```sh
node recovery.mjs publish \
  --repo /absolute/path/to/codex \
  --sealed /absolute/private/path/to/new-seal
```

The command checks the exact account and repository Wrangler pin. It uploads each small immutable part, downloads its **full bytes** again and verifies that part's bytes/SHA256. It streams the downloaded parts in manifest index order into the original full archive, verifies its whole bytes/SHA256, safely extracts it into a fresh directory, verifies **every file**, builds and serves the restored release, and runs the actual health/route drill. It then uploads/readbacks the fixed manifest, three tools and a separately hashed immutable verification receipt. Only then does it write `usung-corporate/latest.json`, download that pointer and verify its bytes. Existing immutable objects are reused only if their full downloaded hashes match; conflicting objects are never overwritten. No secret values or credential files are logged or stored.

Keep `manifest.json`, its SHA256, package SHA256, the exact R2 keys and the readback receipt with the production release record. A successful PUT alone is not the completion condition.

## Chunk transport and retry behavior

The package remains one ordinary gzip archive of the full fixed source tree, bounded to 300 MiB. Chunking changes **transport and R2 storage**, without changing the archive bytes, full SHA256, file inventory or restored source. This is separate immutable R2 objects, not an R2 multipart-upload transaction. In a chunked manifest, `package.key` names the reconstructed archive logically; it is **not a required full-size R2 object**. The physical stored objects are `package.parts`:

```json
{
  "transport": "immutable-object-parts-v1",
  "partBytes": 16777216,
  "parts": [
    {"index": 1, "key": "RELEASE_PREFIX/parts/part-00001.bin", "bytes": 16777216, "sha256": "PART_SHA256"}
  ]
}
```

The validator requires a contiguous index sequence, exact prefix/key names, exact nonfinal part sizes, a correctly sized final part and a sum matching whole package bytes. An optional `seal --part-bytes` accepts 1–16 MiB; 16 MiB is the default. The full-size archive is reconstructed locally only after each downloaded part matches its hash. New publication never sends a body larger than 16 MiB. Fetch and local verification remain compatible with older single-object packets. Existing large single objects may be reused after their full GET/hash verification, but a missing large single object cannot be newly PUT by this version; reseal it with chunk transport.

A transient small-object PUT/readback failure gets at most four attempts. Each retry first GETs that exact immutable key: a matching object is reused, a differing object stops publication, and only a confirmed absent object may be PUT. This covers unknown prior PUT outcomes without overwriting conflicting data. Authentication/permission errors and hash conflicts are not retried. The final mutable latest pointer is not blindly retried; an uncertain pointer write requires exact-key readback before repeating. Progress and retries go to stderr; stdout remains one JSON result suitable for a receipt.

The observed 286,913,926-byte v37 single PUT failed with `fetch failed` while its exact key stayed absent. Root verified a 16 MiB PUT and full GET readback with SHA256 `31bf5b7b093ad68c604d8135aae8cbecdbde22f4583758437c3801d7651e3b77`. This motivated smaller transport bodies; it did not change the accepted source archive or claim the earlier single upload succeeded.

## Fetch the latest saved USUNG release

This command only reads R2 and stages a fresh restored directory:

```sh
node recovery.mjs fetch \
  --repo /absolute/path/to/codex \
  --out /absolute/private/path/to/new-restoration
```

To restore an older exact release, use its recorded immutable manifest key and manifest hash:

```sh
node recovery.mjs fetch \
  --repo /absolute/path/to/codex \
  --manifest-key usung-corporate/releases/UTC_DATE/FULL_COMMIT/manifest.json \
  --manifest-sha RECORDED_64_CHARACTER_MANIFEST_SHA256 \
  --out /absolute/private/path/to/new-restoration
```

`fetch` checks the fixed manifest hash/identity. For chunked manifests it downloads/validates every part and streams them in order into the exact full archive; old single-object manifests are still supported. It verifies whole package bytes/hash and refuses unsafe archive entries or nonempty destinations, verifies all file hashes/modes, builds and serves the restored source, and saves a new `restore-drill.json`. The result is `new-restoration/restored/usung-corporate/`. It does not activate production.

To verify an already-downloaded packet without any R2 access:

```sh
node recovery.mjs verify \
  --manifest /absolute/path/to/manifest.json \
  --archive /absolute/path/to/usung-corporate.tar.gz \
  --stage /absolute/private/path/to/new-empty-stage \
  --receipt /absolute/private/path/to/new-restore-drill.json
```

## Future authorized rollback: product only

1. Save the currently running release as a distinct recoverable snapshot and retain its deployment identity.
2. Fetch the selected immutable manifest/hash and complete the clean restoration drill above.
3. In a new worktree based on the intended repository branch, replace **only** `products/usung-corporate` with the restored product tree. Preserve every other repository path. Stage and commit only that product directory. Do not use repository-wide reset/clean or replace the whole checkout.
4. Build from the restored product root and deploy that product to the exact Railway service/environment above. Record the new deployment UUID and the immutable source-recovery manifest used. A rollback deployment has a new UUID; it is not the old deployment ID.
5. Verify actual `usungcorp.com/health` release, all four routes, restored media hashes/range playback, favicon/language behavior and the requested visual result. Preserve a deployment/live-verification receipt. Local extraction/build does not establish a production rollback.

The generic `git-bundles/effacermonexistence/codex/latest.json` is a separate all-repository backup and can move when another branch is pushed. It is not the USUNG release selector. The exact USUNG recovery prefix and fixed manifest hash above avoid that branch ambiguity.
