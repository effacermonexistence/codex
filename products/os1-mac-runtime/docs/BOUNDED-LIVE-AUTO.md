# Bounded live Auto — build 431 source integration

This is an execution policy, not a quality certificate. The pre-existing covered-live/FULL verifier policy remains separate.

## Actual path

Sealed `LocalRouterBridge` configuration enables `bounded_auto`. The same OpenClaw Core calls its existing tools-free local planner with current catalog and RCC policy. The planner sees lossless candidate profiles/tuples, tools, scopes, accounts/pools and timestamped quota; unknown performance/cost stays unknown. Current source uses at most one 30s/1536-token proposal, 4 read-only nodes or 3 read-only preparation nodes.

Core independently checks task/request/policy/catalog identity, candidate support, explicit model/effort/provider constraints, current availability/quota, scope, graph, final ownership and budgets. Invalid, late, oversized or unsupported proposals restore the existing original host route before dispatch. FULL task contracts, class certificates, registered verifier paths and explicit maximum-effort constraints are not downgraded by this policy.

For ordinary read-only tasks, the accepted graph and supported candidate hints execute through the existing scheduler. For host-authorized writers, the local plan contains read-only preparation only; Core adds exactly one writer with the byte-exact original request and all original materials. Its separate finalizer tuple hint is independently checked as a writable candidate, never translated from a read-only row.

Dependencies receive bounded, source-marked untrusted outputs with exact parent node/attempt/candidate/config/status/output hash and native receipt location. Unknown receipt hashes remain explicitly unknown. Plan text, original objective, source fingerprint and host context are not rewritten. Oversized/missing parent evidence is retained and not truncated or replayed.

Execution-only choices are recorded as unmeasured, never certified or parity verified. Supported pre-dispatch failures may rebind only the same node through the same current eligibility rule. Unknown post-dispatch effects remain held without replay. The existing scheduler owns leases, overlap, cancellation, retries and once-only integration.

## UI

The existing cards/tree/child windows consume exact-attempt private native-display observations. Selected settings remain distinct from source-observed settings. Missing, ambiguous, old or foreign observations remain unknown. Current authenticated status polling also refreshes display data at the same Core revision, without extra RPC or scheduler.

## Evidence boundary

Pure SQLite/transport fixtures are not native execution or installed UI proof. Source integration and build identity do not prove general flagship quality, quota savings, trained optimal routing or zero drift. Installation and real App-owned model/parallel/writer/resource evidence are separate completion gates. Older scored development comparisons remain frozen and are not reused as fresh proof.
