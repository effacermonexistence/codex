# Claude native read-only workspace enforcement

## Observed defect and scope

A read-only native Claude execution ticket still exposed Bash. Provider permission
allow lists merge with existing user settings; a pre-existing broad Bash approval
could therefore approve a write command. The vendor Bash sandbox also normally
permits writes inside its current working directory. The actual owned build433
writer diagnostic changed its one authorized file while the selected ticket was
incorrectly read-only. That is a permission/parallel-lease integrity defect even
though the human's underlying file edit was authorized. Task classification is a
separate repair; this change does not edit its classifier.

Official documentation inspected for this repair:

- <https://code.claude.com/docs/en/settings>: list/approval merging.
- <https://code.claude.com/docs/en/sandboxing>: Bash-only coverage, default writable
  directories, excluded commands and strict sandbox options.

These documents explain a mechanism; source, actual OS canaries and later native
qualification—not documentation alone—establish the implemented boundary.

## Existing guard reused at the actual launch

`OS1SourceConfinement.readOnlyProtection` constructs one immutable per-attempt
protection from the actual existing workspace and known protected OS1 source
roots. A registered containing OS1 source root is resolved first, preserving
sibling source/admin protection even when the workspace is a project subfolder;
an OS1 root contained inside a broader workspace is the fallback. It canonicalizes paths, includes equivalent Data-volume aliases in both
directions, and reuses the existing `sourceWriteGuardProfile`, including ancestor
unlink protection. No second authority, scheduler or global settings is added.

Tool-enabled read-only Claude runs use that profile in the existing neutral
`fullAccessResumeArguments` wrapper. Despite its historical name, this helper
only prefixes `/usr/bin/sandbox-exec -p <profile>`; it adds no permission bypass,
continuation, model, authentication or tool flags. Inherited shell processes and
provider file tools remain inside the outer process filesystem guard. Inherited
global Bash approvals or vendor `excludedCommands` cannot remove this outer
profile.

The same paths are retained in vendor per-request settings, with file-tool
denies in both settings and CLI. However, a separate real-OS compatibility probe
found that outer sandbox-exec followed by inner sandbox-exec exits71 at
`sandbox_apply: Operation not permitted`; the inner child never starts. The
initial vendor-enabled draft is therefore not native-Bash-qualified and its
failed probe is preserved.

Under Root's explicit source-policy adoption, ONLY this immutable
outer-guard-bound settings function disables the redundant inner vendor Bash
sandbox. It adds no bypass permission, full-access flag, handback or global
settings change. The outer guard remains mandatory and fails closed if it
cannot be prepared/launched. Genuinely tool-free settings are unchanged. Read
tools, shell/local computation, provider-state IO, hook suppression and explicit
memory configuration keep their applicable permissions.

Retained inner filesystem/network keys and `failIfUnavailable`/
`allowUnsandboxedCommands` values are inactive while its sandbox is disabled;
they are not claimed as enforced. In particular, vendor allowed-domain and
local-binding network confinement is NOT supplied by the outer filesystem-only
guard. Existing owner/managed/tool permissions and task constraints remain
binding; no unrestricted network authorization is inferred. Current closed RCC
host/config/ticket schemas expose no vendor-network enforcement contract;
unsupported explicit network-policy fields are rejected before dispatch. A
future host requiring such enforcement must remain held unless an appropriate
supported enforcement path is implemented—it cannot silently use this profile.
No user/global settings, authentication caches or provider files are modified.

## Fail-closed boundaries

- A tool-enabled read-only argv without its immutable workspace protection is
  rejected before provider dispatch.
- An immutable read-only ticket cannot borrow write-confinement or full-access
  continuation authority, including a full-access handback marker.
- A missing/invalid workspace or protection path fails before dispatch.
- A guarded workspace/source path overlapping the provider's `.claude` or
  `.claude.json` state fails before dispatch. This compares verified logical and
  Data-volume home aliases even when the state file does not yet exist; an
  actual Data-root collision regression is retained. A HOME workspace is not silently
  weakened by adding a provider-state carve-out.
- The existing unguarded source-context lane remains possible only when it is
  actually tool-free: safe mode, empty tools, strict empty MCP configuration and
  no explicit memory MCP. A nonempty MCP configuration requires the guard.

The collision is reported as `read_only_provider_state_collision`; unavailable
protection as `read_only_workspace_guard_unavailable`. No alternate account,
write profile, hidden retry, or unsandboxed continuation is introduced.

## Outcome and evidence integrity

The existing before/after workspace fingerprints are reused; this patch adds no
recursive HOME/full-repository scan per answer. A usable, positively changed
fingerprint under a dispatched read-only ticket becomes typed
`read_only_workspace_changed_preserved`, `effects_uncertain`, and
`side_effects=confirmed`. Native output/receipts are retained, success/quality
adoption and handback are withdrawn, and the existing Core HOLD path prevents
blind replay. The delta is not automatically attributed to this attempt: a
concurrent writer could cause it.

Equal bounded hashes are not complete no-effect proof. Missing, malformed, empty
sentinel or partial/unreliable evidence stays unknown; it does not cause permanent
rejection of every valid read-only task. A private native-summary annotation
records the configured guard/profile digest, path count and fingerprint class,
with `vendor_network_sandbox_enforced=false` and `global_no_effects_proof=false`.
This is launch configuration and bounded
observation—not proof of all-world effects, pre-existing external services,
filesystem aliases not represented by the verified paths, or arbitrary outside
workspace activity.

The empty `.claude/.cc-writes` directory in the original diagnostic is consistent
with provider bookkeeping. The precise historical creator/syscall was not
captured; this document does not promote that inference into a verified event.

## Deterministic regression and remaining qualification

`scripts/test-claude-readonly-enforcement.py` compiles the actual extracted argv
and neutral-wrapper functions against current OS1Context objects. It exercises
canonical paths/aliases, provider-state collision, missing/foreign guard
rejection, strict settings, tool-free versus memory-MCP distinction, and exact
wrapper/profile binding and unsupported explicit network-contract rejection.
Private real-OS canaries first prove outer-only read/local compute
and separate provider-log writes work, then require EPERM plus unchanged data
for shell write, mkdir, rename, hardlink, Python write and protected-source write.
No provider/model/SDK/RPC is called. Raw denials and the earlier nested-sandbox
failure belong in private test receipts. These canaries do not execute the
Claude provider and do not themselves prove its native Bash integration works.

`RCCNativeAttemptOutcomeFixture` verifies positive-delta HOLD classification,
writer noninterference, equal/nonproof and unknown preservation. Existing main
argv self-tests now construct valid protection instead of testing the formerly
unprotected shape. All fixtures operate on private temporary state.

A source build or these canaries is not an installed-app/native-provider test.
Root must independently review the exact commit, integrate/reseal/build/install
under current user-task preservation gates, and authorize any new native
qualification separately. The earlier build433 CI voice-capture failure remains
recorded; this filesystem repair is not a waiver or claim that failure is fixed.
