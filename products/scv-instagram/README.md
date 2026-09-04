# SCV Instagram public source mirror

This directory contains a **sanitized, non-deployable public source mirror** of
the SCV Instagram v122 runtime. It exists so the source shape, contracts, and
recovery tooling can live in the public `effacermonexistence/codex` repository
without publishing customer-derived identifiers or message content. It is not
the running private v151 source and must not be deployed as though it were.

The current private v151 recovery coordinates are mirrored without credentials
in `recovery/LATEST.json` and documented in
`../../docs/scv-instagram-v151-custody.md`. The exact source archive and current
state remain hash-bound in the private R2 bucket.

## Two-layer custody

The exact operational release is `scv-instagram-single-20260829-v122` with
fingerprint
`89b128ce7161698e017251938b5ccd78953bf066dc546de6adf637fcb45739d1`.
It is not public-Git eligible. The exact application archive and cold-recovery
kit are stored in the access-restricted `omar-private-archive` R2 bucket:

- application SHA-256:
  `5b354d78a4c4d19e9013694c6931e75fa56954d88c21a29a2db23980ca526190`
- cold-recovery SHA-256:
  `4dbe8262bc1bddd2902e854c405ea9ebb650c10656a143303a6e52decac5fb24`
- custody manifest:
  `provenance/private-custody/SCV_V122_PRIVATE_CUSTODY_MANIFEST.json`

Both R2 objects were downloaded again after upload and matched their source
hashes. R2 public development URLs are disabled and no custom domain is
attached to either custody bucket.

## Public mirror identity

The checked-in derivative is
`scv-instagram-public-sanitized-20260831-v1`.

| Property | Locked value |
| --- | --- |
| Status | `public-source-mirror-only` |
| Deployment allowed | `false` |
| Descriptor SHA-256 | `280b13b8fe0d1b9e0d8473f20b403ffa88b7b34d778a50338e081333af1acff7` |
| Content fingerprint | `7521b2b785fcae44bccefbe9d28089519af01898b3ef7c0b8a8ee2989cce155e` |
| Descriptor inventory | 229 files, 5,231,797 bytes |
| Physical runtime | 230 regular files, 5,271,707 bytes |
| Node | `20.20.2` |

Production Railway IDs are replaced with inert UUIDs. Production and staging
namespaces explicitly contain `public-sanitized-do-not-deploy`. Do not deploy
this tree or compare its fingerprint to production readiness.

## Sanitization

The sanitizer removed or replaced:

- customer Instagram usernames, phone-shaped inbound content, message IDs,
  contact IDs, and thread IDs;
- production-derived customer incident excerpts;
- personal Mac and CloudDocs paths; and
- operational payment/business email addresses.

Three production-derived documents are replaced by public summaries. The exact
source remains only in restricted R2 custody. The transformation is
reproducible with `scripts/sanitize-public-mirror.mjs`, but it requires access
to the private source artifact.

## Verification

Use Node `20.20.2` exactly and run from the repository root:

```bash
node products/scv-instagram/scripts/verify-public-mirror.mjs
```

The verifier locks provenance, the sanitizer, the R2 custody manifest, the
descriptor, all 229 inventory hashes, the complete 230-file runtime surface,
neutralized deployment IDs, and the no-customer-data/no-private-path policy.
It rejects symlinks, hardlinks, special files, mutable runtime directories,
credential files, private-key markers, credential-shaped values, non-placeholder
email addresses, and unredacted local paths. It performs a second full runtime
walk before reporting success.

The CI workflow also syntax-checks every JavaScript file. Full behavioral and
live restoration tests belong to the exact private R2 artifact, not this
sanitized derivative.
