# OS1 EXO cluster activity monitor

This product overlay adds a single Activity Monitor-style page to EXO 1.0.71.
The page is available at `http://127.0.0.1:52415/#/activity` from either Mac
and merges the two EXO nodes with OS1 Fleet assignment metadata.

It reports measured CPU, memory, GPU, temperature, system power/session energy,
disk throughput/free space, network throughput, EXO topology/work counts, OS1
executor readiness, queues, heartbeats, and recent sanitized placement receipts.
It does not expose prompts or model output and does not claim that arbitrary
macOS processes share one transparent memory or GPU address space.

## Pinned sources

- EXO upstream: `exo-explore/exo` tag `v1.0.71`
- Upstream commit: `fd707de30b42db4211d15da96b9052e1dc280ed1`
- Omar fork branch: `effacermonexistence/exo:os1/exo-wifi-roaming-monitor`
- Overlay commit: `fb174031378cd6ab1c1bf842a2958e4f250b84e2`
- Portable mail patches: `patches/0001-*` through `patches/0007-*`
- Prebuilt dashboard: `dashboard-build/` (no Node/npm needed on the target Mac)

On a packaged Pro runtime, the builder replaces only `exo.api.main` in a new
PyInstaller archive. Every other module is preserved byte-for-byte. On the
source-based Air runtime, the installer adds a reversible `.pth` overlay that
registers the read-only endpoint without replacing any EXO source. Both modes
keep the per-device peer-ID, follower/master, and bounded-retry repairs already
installed on each Mac. The signed `/Applications/EXO.app` is never modified.

## Install or recover one node

Run from the repository root on the target node:

```bash
products/os1-exo-monitor/install-activity-monitor.sh pro
# or
products/os1-exo-monitor/install-activity-monitor.sh air
```

The installer discovers the exact existing EXO LaunchAgent and whether it is a
packaged Pro or source-based Air runtime. It backs up every changed file,
switches only that EXO service, preserves event logs/models/credentials,
verifies peer identity, and waits for the two-node topology. On failure after
the switch it restores the prior plist, source overlay state, and service.

## R2 handoff between Macs

The reviewed product is also published as a small immutable package in the
private `omar-private-archive` bucket. The mutable
`os1-exo-monitor/latest.json` pointer is written only after the immutable
package, release manifest, and stable installer exist. On a Mac that has run
the standard bootstrap and completed its own Wrangler OAuth, synchronize with:

```bash
os1-exo-monitor-sync air
# use `pro` on the Pro; append `--verify-only` to download and verify only
```

The sync command downloads the pointer and package directly from R2, requires
the repository-pinned Wrangler 4.127.1, validates product/repository identity,
object-key shape, SHA-256, byte count, and every archive path, then invokes the
same reversible node installer. No Git checkout, pasted instruction block, or
credential transfer between Macs is required.

## Moving between Wi-Fi networks

Both nodes use their existing ZeroTier addresses, which are independent of
hotel Wi-Fi addresses. The installer adds `com.os1.exo-roaming`: a small local
guard that checks every 15 seconds. It waits while the peer is offline and gives
EXO time to reconnect. A persistent idle split can restart only the local EXO
service, after 90 seconds on Pro or 180 seconds on Air, at most twice per hour.
Loaded models and active or unknown tasks defer recovery. The Activity page
shows the current recovery state; no SSIDs or Wi-Fi credentials are stored.

An existing healthy Pro can install only the guard with its managed Python:
`python3.13 products/os1-exo-monitor/roaming_guard.py --install pro`.
The regular R2 installer includes the guard for Air and Pro.

Use release `exo171-roaming-v3` or later on Air. This incorporates its editable
source layout and wrapper-owned dashboard setting; v2 is superseded for Air
installation. Pro's already-verified v2 backend/guard bytes are unchanged.

Hotel captive portals still require that hotel's sign-in. Connectivity cannot
be guaranteed where Internet or all usable ZeroTier transport is blocked.
An inference running at the moment of disconnection may fail and need retry;
automatic reconnection does not migrate or resume an in-flight generation.

Tests simulate changing network, missing transport, stale topology, active
work, changed peer identity and restart backoff without changing real Wi-Fi.

## Convergence definition

The visible balance score is deterministic:

`100 - spread(0.35 CPU + 0.35 memory + 0.20 GPU + 0.10 queue pressure)`

It is shown only when both node samples are newer than 15 seconds. It is an
observed load-balance indicator, not a probability or optimality guarantee.
