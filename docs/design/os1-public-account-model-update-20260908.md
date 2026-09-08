# Deliver the account-aware runtime to new downloads

Objective: website downloads and new-Mac bootstrap must deliver the verified
account-aware OS1 build95, not only update the owner's installed copy.

Observed boundary: live RCC page has two links to the stable gateway download;
stable is 0.9.1, while bootstrap pins 0.9.21/build70. The verified build95 beta is
only in private R2 custody. No valid Apple Developer ID signing identity or CI
distribution secrets were found. Preserve the stable channel and native trust.

Five views: intent (public acquisition must reach build95); source (fixed commit,
tag, ZIP and inner package hashes); runtime (native model discovery in the same
verified binary, per-device OAuth retained); verification (anonymous download,
unpack, trusted installer verify-only and installed binary equality); cost/UX
(reuse tested bytes, no new inference or unnecessary compilation); security
(beta clearly labeled, no private core or credentials published, no Gatekeeper
changes, no silent stable promotion).

Plan: publish the already verified universal ZIP as an immutable GitHub
prerelease and public R2 beta object. Update the bootstrap pin and stable
compatibility floor to the account-aware version. Update only the RCC landing
page's download links and installation description after confirming its deployed
source. Keep existing stable API clients and stable manifest unchanged.

Invariants: build95 ZIP SHA-256 stays
939e9de67a6e85970255f415ffcf229224c8abb2e3ee4ae3c2fa90648db3291b;
inner PKG SHA-256 stays
853a63c60d59e0dd91c100660b36638e8e1f9074e98b08e5e1eadd0b1a21ea4a.
No replacement of release assets/tags. No production Instagram/benchmark change,
no auth migration, no native trust bypass. Bootstrap must recheck the version
after download so a stable pointer race cannot install an older runtime.

Alternatives rejected: calling an unnotarized beta stable; browser Accept-header
magic on the stable download endpoint; stale source redeploy; copying owner's
authentication. Public beta remains explicit until real Apple distribution
credentials are available.

Acceptance: public release/tag/asset hashes verified; bootstrap rejects older
and moved/tampered releases; downloaded package passes the current installer's
verify-only gates; website's actual download links reach that same ZIP on desktop
and mobile; source, release and receipts retained in R2. Verify-only is not a
fresh-Mac OAuth/install test. Keep that boundary explicit in the report.

Rollback: revert bootstrap pin/floor and only the landing-page patch; retain old
release assets and the previous deployed image. Leave stable pointer and all
conversation/production state unchanged.

Verification (2026-09-08): GitHub prerelease `os1-v0.9.44-beta.1` resolves to
`b7d04dd0310e08aa820efff72db85712f382b4cb`. Anonymous download matches the pinned
ZIP hash above. The current bootstrap's live `--verify-only` passes, including
package allowlist, universal architectures and code integrity. Six local test
groups pass; the actual installer rejects five downgraded/contradictory manifest
fixtures without attempting installation.

RCC deployment `28ce0413-56d6-4c69-885c-106c658d2014` is successful. All 15 source
files were matched to the prior deployed container before changing only
`web/yc.html`. The public response exactly matches patched HTML SHA-256
`7a7184e4e9dbe5c15c1313aa037865210a92dbb858aea564ee6b2b6e31f99417`.
Desktop and 430px browser checks show the build95 link and beta warning; the
430px document has no horizontal overflow and clicking its primary link emits
an actual download event. This changes distribution links, not the native UI.
The new-Mac pin becomes authoritative only after this change is merged to main.
