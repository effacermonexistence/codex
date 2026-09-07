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
- Omar fork branch: `effacermonexistence/exo:os1/exo-cluster-activity-monitor`
- Overlay commit: `a229544390c4a131c80382e931fcc479f47ac814`
- Portable mail patch: `patches/0001-feat-add-two-node-OS1-activity-monitor.patch`

The runtime builder replaces only `exo.api.main` in the currently installed
PyInstaller archive. Every other module is preserved byte-for-byte, which keeps
the per-device peer-ID, follower/master, and bounded-retry repairs already
installed on each Mac. The signed `/Applications/EXO.app` is never modified.

## Install or recover one node

Run from the repository root on the target node:

```bash
products/os1-exo-monitor/install-activity-monitor.sh pro
# or
products/os1-exo-monitor/install-activity-monitor.sh air
```

The installer discovers the exact existing EXO LaunchAgent and executable,
builds a separate ad-hoc-signed runtime, backs up the plist, switches only that
service, preserves event logs/models/credentials, verifies peer identity, and
waits for the two-node topology. On failure after the switch it restores the
prior plist and service.

## Convergence definition

The visible balance score is deterministic:

`100 - spread(0.35 CPU + 0.35 memory + 0.20 GPU + 0.10 queue pressure)`

It is shown only when both node samples are newer than 15 seconds. It is an
observed load-balance indicator, not a probability or optimality guarantee.
