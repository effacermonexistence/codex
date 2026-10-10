# OS-1 local controller, staged first-run acquisition contract

This is the **future 0.9.295 integration contract**, not evidence that the
currently installed 0.9.294 package contains the sidecar. The OS-1 package
will contain nine small signed resource files, not the OpenClaw dependency
tree, Node/Ollama binaries, or Qwen model weights. An installed GUI launches
`provision-local-controller.sh --ensure` once per launch, nonblocking. Stock
macOS Bash fetches exact per-arch Node; the remaining installer is pinned
JavaScript executed by that Node. Python/Xcode CLT is not a consumer
prerequisite. The optional Python implementation remains a development
verification path. The
script locks the OS-1-owned state directory, fetches pinned public artifacts,
verifies their hashes and architecture, and marks `ready` only after the exact
Qwen model digest and OpenClaw activation contract pass. The owner never has
to paste a credential or run a second installer.

## Source → package → install → live → recovery

1. **Source**: `Resources/local-controller-sources.json` pins Node 24.20.0
   arm64/x86_64 official tarball SHA-256 values, Ollama 0.35.1 official
   universal archive SHA-256/byte count, OpenClaw 2026.9.9 npm SHA-512 and
   Qwen `qwen3.5:4b` model digest. The signed package/lock files pin the
   transitive npm graph. The setup/provision scripts and license notice are
   separate signed resources.
2. **Package**: `scripts/build-release.sh` stages exactly these nine resources
   and checks them both before and after pkg expansion. The 0.9.295 verifier
   requires 33 payload files / 36 component files and preserves older exact
   counts. The app itself remains a universal macOS executable. Downloaded
   native Node is selected per architecture; the Ollama archive's executable
   is universal. Nothing in `node_modules` is copied from this development Mac.
3. **Install**: Existing OS-1 installer validates package SHA, app signature,
   payload inventory and session/queue preservation. The installed GUI alone
   starts the provisioner. The provisioner inherits no shell/API/OAuth/cache
   environment and never reads another application's data. Its private
   `provision-status.json` reports `provisioning`, `ready`, or `blocked`.
4. **Live**: The local router is a candidate producer. `ready` means exact
   runtime identities and model digest were verified, **not** semantic
   correctness or flagship-quality parity. Host RCC/REVAS and signed native
   execution authority remain separate. Tools stay denied in the existing
   local-router config; an OpenClaw agent/execution plugin needs its own
   reviewed permission/profile contract and is not silently included here.
5. **Recovery**: Source Git bundle/R2 package retains this signed acquisition
   contract, not model weights. On a new Mac, the package repeats public
   first-run fetch and checks the same immutable hashes/digest. A mutable
   model tag is never enough. A failed, interrupted or incompatible install is
   `blocked`, never adopted as a fallback model. A subsequent GUI launch may
   resume acquisition under the same private file lock.

## Exact resource list

- `local-router-config.template.json`
- `local-controller-sources.json`
- `local-controller-package.json`
- `local-controller-package-lock.json`
- `local-controller-NOTICES.txt`
- `setup-os1-openclaw-local-router.py`
- `provision-local-controller.py`
- `provision-local-controller.sh` (stock-macOS first stage)
- `provision-local-controller.mjs` (pinned-Node continuation)

The first-run script stores an installed-package SBOM in
`~/.os1/local-router/recovery/installed-controller-sbom.json`: every installed
package in the pinned npm lock, version, declared license (or explicit
`UNKNOWN`), license-file hash when present, package-manifest hash and lock
integrity. It does not upgrade a missing declaration into a license fact.

## Verification boundaries

- Deterministic `test-local-controller-provisioning.py` checks source pins,
  lock integrity, archive traversal rejection, SBOM and exact package
  inventory without provider/model/network calls.
- Separate read-only official asset drills verify both Node architecture
  tarballs and the universal Ollama archive by actual bytes, extraction and
  Mach-O architecture. They do not install those binaries.
- Full 0.9.295 package staging, beta installer verification, installed-app
  startup, 3.3 GB model acquisition, restart recovery, R2 remote package
  restoration, x86_64 live execution and quality parity require integrated
  version bump and their own executed receipts. Do not report them as passed
  based on this source branch.
- The current 0.9.294 app, packaged runtime and public release remain
  unchanged until this branch is integrated and a separately verified
  installation occurs.
