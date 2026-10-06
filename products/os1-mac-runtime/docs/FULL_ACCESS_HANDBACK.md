# HOME sandbox-blocked step handback

Scope: OS-1 full-access handback only. Base `385d60ab0e3cea2e62274da6700b4ffb8be4b5c9` (build328), captured from the requested live tree HEAD before creating a new worktree. Branch: `os1/full-access-handback`.

No version change, package/stage/apply/install/restart, model invocation or Explyt installation is part of this branch. Claude owns the build329 UI work and later build330 integration.

## Actual route

1. HOME non-OS1 Claude write attempts retain the existing broad sandbox with OS-1 source/admin/release exclusions.
2. A final standalone `[OS1_FULL_ACCESS_REQUIRED]` line asks to continue a normal non-OS1 step blocked by that sandbox. Denial alone, an inline quoted marker, nonzero exit, cancellation, another provider, missing native session, or unverified delivery does not authorize continuation.
3. The same adopted/rejected-delivered handback boundary as build327 is applied: a genuine exit0 answer that reached REVAS may hand back even if REVAS did not adopt it. Policy/source/contract violations remain failures.
4. OS-1 performs one required continuation before OS1_CHANGE_REQUIRED repair handling. It pins the original Claude UUID, requests the Claude write lane, suppresses intermediate Desktop publication, refuses a pre-existing Desktop writer, and never substitutes a new native session for this handback.
5. The resumed attempt waits for the actual OS-1 source shared lease. It cannot reroute into a broad-confined Claude attempt while waiting; a stale ticket is refreshed without changing the continuation authority.
6. Claude's broad sandbox is disabled for this attempt only. Existing Edit denies remain. A separate `/usr/bin/sandbox-exec` source-only profile allows default operations and denies `file-write*` solely for the existing literal OS-1 protected paths. The wrapper fails closed; it never silently launches Claude without this guard. The same runner retains stdin steering, cwd, environment handling, streaming and lifecycle hooks.
7. The continuation receives the original request and prior available report, with a specific instruction to continue only blocked non-OS1 steps, inspect partial effects, and never repeat completed edits/sends/payments/installs/mounts/deploys/pushes. Owner OAuth, approvals, terms and payment authority remain separate.
8. The resumed result must independently pass ordinary contracts/REVAS. A second full-access marker does not create another loop. Quota and predispatch recovery cannot expand the one-attempt limit or substitute another backend. Late cancellation is checked before adopting the merge or starting an OS1 repair.
9. If both markers were present, initial and resumed reports/flags survive; OS1 repair follows only successful non-OS1 continuation. No source-watch auto-finisher/version/install is permitted inside full-access continuation. Unexpected source change blocks with unresolved writer attribution, rather than falsely claiming this task authored it.
10. Failure/cancellation returns a visible workflow-blocked answer with precise cause, first report (even when unadopted), available resumed result, and consumed steering receipt IDs. Governance adopted state stays false until the required continuation succeeds.

## Protection boundary

Turning off `sandbox.enabled` does NOT preserve Claude's sandbox.filesystem.denyWrite enforcement. A shared lease is scheduling/coordination, not filesystem security. This is why the narrow source-only launch guard remains.

The guard covers the wrapped process and inheriting children. Arbitrary pre-existing LaunchServices/XPC services do not automatically inherit it. No-workaround instructions and source-change observation remain binding; global immunity is not claimed. Normal macOS permissions and user approvals may still block a requested install or launch, and that is reported rather than treated as sandbox success.

## Modified surfaces

- `Sources/OS1Context/OS1SourceConfinement.swift`: new marker and scoped detection, bilingual instructions, source-only profile, per-attempt settings and shared-lease choice.
- `Sources/OS1/main.swift`: transient in-process flags, one-hop exact-session orchestration, guarded runner, failure/adoption/cancellation handling, deterministic runtime regression.
- `Tests/OS1ContextTests/OS1SourceConfinementFixture.swift`: marker/profile/settings and actual temporary protected/unprotected filesystem operations.
- `scripts/test-os1-source-confinement-wiring.py`: call-site checks and mutation-sensitive continuation gates.

Transient authority flags are not added to artifact/session CodingKeys. Saved sessions, queues and credentials are not rewritten by this feature work.

## Research actually inspected

- ReAct: https://arxiv.org/html/2210.03629v3 — action/observation feedback can revise execution plans.
- Intrinsic self-correction limitations: https://arxiv.org/html/2310.01798v2 — generated self-correction is not sufficient external evidence.
- Claude CLI: https://code.claude.com/docs/en/cli-reference — same-session `--resume` and per-session `--settings`.
- Claude sandbox: https://code.claude.com/docs/en/sandboxing — broad sandbox/unsandboxed-command behavior.
- Claude permissions: https://code.claude.com/docs/en/permissions — file-tool denies are not a replacement for arbitrary subprocess filesystem containment.

These inform the bounded observed-marker -> narrow execution -> real fixture feedback -> adoption/failure path. Papers or source inspection are not provider execution proof.

## Integration handoff

Claude should fetch this branch and merge/cherry-pick its verified commit only after the separately owned build329 changes. Resolve `main.swift` against both changes without dropping exact-session pin, combined source guard paths, marker flags, source-lease handling or cancellation/adoption guards. Version bump and installation belong to Claude's build330 integration, not this branch.

Final executed test receipt, commit and R2 manifest are reported after the frozen validation run. No paid model end-to-end execution is claimed.
