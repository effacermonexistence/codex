# R2 handoff design

## Objective and acceptance

The two Macs must not exchange installation instructions through chat. GitHub
remains the reviewed source of truth, while the private
`omar-private-archive` bucket carries a small, versioned EXO monitor release.
A target Mac succeeds only after it downloads `latest.json`, verifies the
declared object path, byte count, and SHA-256, extracts a path-safe archive,
and lets the existing rollback-capable node installer pass its peer-ID and
two-node checks.

## Failure boundary and data flow

The Git bundle backup already preserves the repository, but it is too broad to
be a direct product handoff. The missing boundary is a product-specific,
machine-readable release pointer:

```text
reviewed GitHub main
  -> deterministic release inputs
  -> immutable R2 package path containing its SHA-256
  -> R2 latest.json (published last)
  -> target-side hash/size/path validation
  -> existing reversible EXO node installer
```

The release contains no tokens, OAuth caches, models, EXO event logs, prompts,
or user files. Wrangler continues to own authentication in its encrypted
per-device store.

## Five-view audit

- Intent/completion: R2 must carry an installable monitor release, not merely a
  repository backup receipt.
- Provenance/continuity: the pointer records the GitHub repository SHA, EXO
  overlay SHA, immutable object key, package digest, and byte count.
- Execution/capabilities: the target uses the repository-pinned Wrangler or the
  OS1-managed copy and never receives a copied credential.
- Output/verification: publication is not success until all three R2 objects
  are downloaded again and match local bytes; installation remains subject to
  the existing endpoint, peer identity, and two-node gates.
- Cost/latency: the approximately four-megabyte product is transferred instead
  of a full Git bundle; `latest.json` is fetched once per requested sync.
- Security/UX: immutable content is uploaded before the mutable pointer, archive
  paths are constrained to one directory, and the user can say “R2에서 EXO
  모니터 동기화” instead of relaying a command block.

## Alternatives and rollback

Using only the Git bundle was rejected because it requires repository recovery
and checkout logic on every node. A public R2 URL was rejected because the
bucket is private. A long-lived R2 key in the package was rejected because it
would copy credentials between Macs.

The target installer preserves the existing LaunchAgent and overlay files and
restores them on failure. R2 releases are immutable; rollback is performed by
pointing `latest.json` at a previously verified release, never by overwriting a
release object.
