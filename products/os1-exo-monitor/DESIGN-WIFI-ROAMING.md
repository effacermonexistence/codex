# Wi-Fi roaming recovery

Goal: the same two Macs retain their private ZeroTier addresses after changing
hotel Wi-Fi. No SSID, hotel IP, router rule, or copied credential is required.
ZeroTier negotiates the new transport; EXO already retries bootstrap every 5s
and the Activity page retries failed fetches. The missing boundary is EXO
remaining stale after private transport has recovered.

Add a per-user Python standard-library LaunchAgent. Every 15s it reads both EXO
states and fingerprints the default interface/gateway/current IP (only the hash
is retained). A healthy cluster never restarts just because Wi-Fi changed.
When the peer is unreachable it waits. Once the peer is reachable, a persistent
split gets 90s grace on Pro and 180s on Air; Pro therefore recovers first.
Restart only the exact local EXO service with SIGTERM and its existing
KeepAlive, and only when both APIs prove no live instances or inference tasks.
No restart if state is unknown. Limit to two attempts/hour, persisted across
guard restarts, with a five-minute minimum cooldown. Identity changes stop
automatic actions and surface attention_required.

Intent: travel requires automatic recovery, not a new VPN. Provenance: pinned
EXO overlay plus same R2 product bundle on both Macs. Runtime: fixed private
bootstrap and exact user services. Verification: simulate changed underlay,
offline/recovery, stale topology, busy/unknown state and capped retries, then
check installed Pro service and APIs for 90s. Cost: one light guard, bounded
HTTP calls, no LLM calls. Privacy: no SSID/password/prompts in its status.

The Activity endpoint reads a small allowlisted status JSON. Missing or stale
status is visibly unavailable. Do not switch the user's physical Wi-Fi during
verification; a real second-hotel/captive-portal test remains unperformed.
Hotel web login, unavailable Internet, and networks blocking all usable VPN
transport cannot be fixed by restarting EXO. R2 distributes the updated product
but cannot execute it on an Air without a working local agent.

Live validation found two additional boundaries: a restarted local API can
replay two nodes before both peers report fresh heartbeats, and macOS can
throttle a Background guard enough to stale the monitor. The installer now
waits up to 120s for fresh matching peer states before enrollment. The small
guard uses Interactive process scheduling for its UI-status cadence (no
continuous busy loop); failed underlay probes cannot override directly observed
healthy overlay APIs. Each private HTTP request has an 8s inactivity timeout.

Rollback: stop only com.os1.exo-roaming and restore its backed-up plist. EXO,
ZeroTier, models, peer identity and existing Fleet jobs remain unchanged.
