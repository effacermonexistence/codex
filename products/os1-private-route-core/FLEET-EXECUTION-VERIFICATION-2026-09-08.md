# Native Fleet execution verification — 2026-09-08 UTC

Objective: supported native Codex and Claude Code prompts are automatically
assigned by `os1-fleet-objective-v1`, run on the selected Mac, and returned as
verified results. Connectivity or an Activity dashboard alone is not execution
acceptance. This is whole-job placement, not transparent pooling of macOS RAM,
GPU memory or provider-hosted model inference.

## Installed and activated boundary

Pro remains on OS1 0.9.35/build 86. This repair did not replace either Mac's
runtime, hooks, trust approvals, credentials, EXO services, model files, or user
workspaces. The private service retains prior adapters for previously issued
tickets; the immutable new policy applies to new requests.

- New policy bundle: `os1/policies/95e354aa31cc8c07b3ecc3f5be268a8e3aa1ef5b9b85bdb34d397190e0592e40.json`
  in `omar-active-vault`; 4,569 bytes, SHA-256 equals its filename.
- Private RCC version: `67519a67-b43c-4f23-bb3c-68741686c402`.
- Private route version: `3192e32f-5292-4366-9a46-5afc64a9d178`.
- Executor contracts, execution profiles and maximum steps are unchanged.
- The route deployment used the actual previously deployed JavaScript with
  only the policy pointer changed. It did not overwrite other production
  changes with a possibly stale source checkout.

Two reproduced boundaries were repaired: valid precise source-value answers
were rejected, and a bounded prohibition could misclassify a read-only request
from an older client as a write task. Private implementation, tests and recovery
sources remain in private R2 custody, not in this repository or client packages.

## Actual execution evidence

| Entry path | Executor | Provider | Job | Result |
| --- | --- | --- | --- | --- |
| Native prompt hook, no preferred device | Pro | Codex | `7a35c897-2fc8-4a2f-a56c-d292ad220b9c` | One attempt, exit 0, read-only, verified/adopted |
| Native prompt hook, no preferred device | Pro | Claude | `a92bcef0-cac9-4a91-a8b5-2bca9c748a05` | One attempt, exit 0, read-only, verified/adopted |
| Explicit Air Fleet execution | Air | Codex | `c795607b-19a8-48f8-b069-d187f3f89eda` | One attempt, exit 0, read-only, verified/adopted |
| Explicit Air Fleet execution | Air | Claude | `779fa18a-b5c9-4dca-b8e5-3b17b8b01155` | One attempt, exit 0, read-only, verified/adopted |

Both providers returned the real monitor manifest values. Codex returned the
independently checked file digest
`579e9de29801991d2c39dfb3f4a790787a4e173b283f5f48b7017611965fe267`.
The checkout was published revision `37bf4e9781194dabc7129de18430b5346804daf5`.
Explicit-Air probes prove Air execution, not automatic selection from an Air
foreground. The native unpinned probes selected Pro under its higher available
headroom; deterministic placement regressions cover selecting Air for both
providers when Air has more usable headroom. No synthetic machine pressure or
false heartbeat was used to manufacture an Air selection.

The 92.789-second stability run sampled both machines 19 times, approximately
every five seconds. Pro Fleet PID 39903/runs 1 stayed unchanged. Both device
identities and ZeroTier IPs matched, all observed heartbeat ages were under
30 seconds, and the two EXO APIs agreed on the same two peer IDs throughout.

## Acceptance boundary and remaining limitations

- Native automatic routing requires a clean, published GitHub checkout and a
  standalone prompt. Dirty, unpublished, projectless or conversation-dependent
  work is not universally routed; it can continue locally. This task's original
  `r2` directory itself is not a Git checkout.
- The current hook gives wait/adoption instructions; it is not a hard OS-level
  interception of every native tool. A foreground Claude probe did a local
  verification Read before awaiting its receipt. Do not claim strict zero
  duplicate reads or universally enforced exactly-once execution.
- The bounded read-only Claude lane intentionally has no Bash. Shell-required
  Claude-pinned work can be capability-blocked; permission guards were not
  disabled and providers were not silently swapped.
- Provider flags in a heartbeat indicate installed executables, not proof of
  authentication. The actual execution probes above, not flags alone, are the
  readiness evidence.
- Earlier uncertain Air job `6883ebf7-caa5-41bb-b7f7-d91f42631f63` was preserved
  and not replayed. Its receipt is failed/uncertain; a subsequent diagnostic did
  not locate matching detailed records. The successful new read-only job does
  not retroactively certify that older job's side effects.
- Air native foreground hooks, actual Wi-Fi roaming, arbitrary write-task
  integration and every application/session type are not certified by these
  read-only probes. GPU/RAM pooling is not provided by this feature.

Rollback pointers and allowlisted private recovery source are recorded under
`omar-private-archive/os1/fleet-repairs/`. Do not distribute authentication
caches or private policy source to either client as a setup shortcut.
