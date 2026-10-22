import Foundation

/// Reviewed host adoption for *new* configured-Auto owner submissions.
/// Persisted nil/legacy requests never acquire this version on replay.
/// This enables intent transport, not a cheap-route quality certificate:
/// existing R0/checker/reference and native permission gates still decide.
public enum RCCRoutingIntentIngress {
    public static let enableRoutingIntentV2 = true

    public enum Failure: Error, Equatable {
        case unsupportedVersion
        case duplicateOption
        case hostCapabilityDisabled
        case nonAutoTask
        case recoveryOrChildTask
    }

    /// Called only when an owner creates a new submission. A persisted nil is
    /// never recomputed on retry, restart, recovery or delivery resume.
    public static func versionForNewSubmission(provider: String, request: String,
                                               hostEnabled: Bool = enableRoutingIntentV2) -> String? {
        guard hostEnabled, provider == "auto",
              RouteFanout.plan(request) == nil, !RouteFanout.requestsProviderFanout(request),
              !RouteAllIntent.recognizes(request),
              !RouteAllIntent.namesLocalRoute(request) else { return nil }
        return RCCRuntimeContract.RoutingIntentV2.version
    }

    /// The CLI parser calls this on the typed option. The same function is
    /// used by the fake App→CLI ingress fixture; free-form prompt text is not
    /// parsed for a migration marker.
    public static func acceptCLIOption(_ value: String, previous: String?) throws -> String {
        guard previous == nil else { throw Failure.duplicateOption }
        guard value == RCCRuntimeContract.RoutingIntentV2.version else { throw Failure.unsupportedVersion }
        return value
    }

    /// Validation is before metadata probes or Core submit. The marker is an
    /// immutable task field, not a feature flag or an instruction in the prompt.
    /// `recoveryOrChild` denotes task provenance, not read-only permission.
    /// A fresh read-only Auto task is eligible after reviewed host adoption.
    public static func validate(_ version: String?, mode: RCCRuntimeContract.Mode,
                                provider: String? = nil, recoveryOrChild: Bool = false,
                                hostEnabled: Bool = enableRoutingIntentV2) throws {
        guard let version else { return }
        guard version == RCCRuntimeContract.RoutingIntentV2.version else { throw Failure.unsupportedVersion }
        guard hostEnabled else { throw Failure.hostCapabilityDisabled }
        guard mode == .auto, provider == nil || provider == "auto" else { throw Failure.nonAutoTask }
        guard !recoveryOrChild else { throw Failure.recoveryOrChildTask }
    }

    /// Attach to the newly constructed immutable Core request only after
    /// host validation; all original request/source/policy hashes remain.
    public static func bindRequest(_ request: inout RCCRuntimeContract.Request,
                                   version: String?, provider: String,
                                   recoveryOrChild: Bool = false,
                                   hostEnabled: Bool = enableRoutingIntentV2) throws {
        try validate(version, mode: request.mode, provider: provider,
                     recoveryOrChild: recoveryOrChild, hostEnabled: hostEnabled)
        request.routingIntentPolicyVersion = version
    }

    /// The builder receives the request marker *and* an independently fixed
    /// host capability. Never derive enableRoutingIntentV2 from the marker.
    public static func bindCatalog(_ input: inout RCCNativeCatalogBuilder.Input,
                                   request: RCCRuntimeContract.Request,
                                   hostEnabled: Bool = enableRoutingIntentV2) throws {
        try validate(request.routingIntentPolicyVersion, mode: request.mode, hostEnabled: hostEnabled)
        input.routingIntentPolicyVersion = request.routingIntentPolicyVersion
        input.enableRoutingIntentV2 = hostEnabled
    }
}
