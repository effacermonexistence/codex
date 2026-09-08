# Roaming v3 Air compatibility

This release supersedes v2 for installation on Air. It incorporates the Air
agent's source-layout corrections from branch
`fix/os1-exo-monitor-air-recovery-20260907` (commit `649cf87`). The dedicated
activity-dashboard setting survives the Air launch wrapper's own default.
The optional `.pth` overlay is activated only for EXO, not ordinary Python or
the standalone roaming guard. The editable source layout is accepted without
allowing Air to enter the Pro-only binary-rebuild path.

Pro's backend, dashboard and guard bytes are unchanged; its 92.34-second live
validation in VALIDATION-ROAMING-V2.md still applies to those bytes. V3 installation
compatibility is separately exercised with a simulated Air filesystem/service.
No credential transfer or live Air modification is claimed by these tests.

The suite covers conditional Python startup activation, the wrapper's dashboard
override, source-layout installation, Air packaged-runtime rejection, exact
guard enrollment order, failure before/after service switching, peer-identity
change, and missing fresh two-node evidence.

Validation result: 15/15 overlay and mocked-installer tests PASS, plus the
unchanged 21/21 roaming safety tests. Ruff, shell syntax, diff checks and the
R2 package fixture check pass. Compatibility commit:
`727d024f612aaf37a03a202de8467cb499504366`.

The same immutable R2 package supplies both Macs. Air runtime confirmation
still requires a fresh `roaming` field from Air's Activity API; an upload or
mock installer test alone is not installation proof. The existing follow-up
is gated on v3 and never dispatches the superseded v2 package to Air.
