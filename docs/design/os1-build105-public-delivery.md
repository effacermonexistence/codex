# Build 105 delivery closure

Objective: deliver the locally verified OS1 0.9.48/build 105 through the public
beta download and trusted new-Mac bootstrap. Do not substitute user testing for
the completed native drift-feedback tests. Physical Air installation remains a
separate device-side verification, not something proved by an uploaded archive.

Observed divergence: installed build 105, public beta/bootstrap build 95, stable
gateway 0.9.1. No valid Apple distribution identity is available. Preserve the
stable channel; publish an explicitly unnotarized beta, not a notarized release.

Five views: objective (same installed/downloaded version); source continuity
(immutable source, package and ZIP hashes); execution (existing installer and
per-device authority); verification (anonymous readback, exact bytes, trusted
verify-only checks); cost (reuse tested universal binaries, zero inference).
Privacy: public package excludes private policy corpus, credentials and sessions.

Architecture: immutable verified package -> beta ZIP -> GitHub prerelease and R2
custody -> exact-source landing-page patch and main bootstrap pin -> device-local
installer. The bootstrap passes a minimum version/build to the installer so a
changed stable pointer cannot silently downgrade the selected runtime. The same
floor is rechecked inside the expanded package, not only mutable JSON metadata.

Patch: delivery scripts/pin/docs only; native executable bytes do not change.
Reuse the last verified RCC web source only after matching every file against
the currently deployed container. Do not redeploy stale or unknown server code.
No SCV production, customer-state, Gold, billing or permission changes.

Acceptance: immutable release identities and downloaded hashes agree; actual
public links and main bootstrap choose build 105; downgrade/tamper fixtures
reject; downloaded app and runtime equal the tested installation; R2 readback
matches. An unavailable Air host or device-only approval must be reported, never
represented as installed. Rollback restores only prior download links/pin; keep
all immutable releases and newer local conversations intact.
