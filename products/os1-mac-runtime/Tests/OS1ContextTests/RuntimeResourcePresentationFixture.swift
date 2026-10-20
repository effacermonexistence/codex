import Foundation
import OS1Context

/// Pure synthetic values only: no live account, cache, filesystem, model,
/// native process, auth/config update or provider probe.
func runRuntimeResourcePresentationFixtures() throws {
    typealias P = RuntimeResourcePresentation
    var count = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "Runtime resource presentation: " + message); count += 1
    }
    func usage(total: Int? = 23, local: Int? = 3, native: Int? = 20, complete: Bool = true,
               issues: [String] = []) throws -> RCCRuntimeContract.ResourceUsageSummary {
        var fields: [String: Any] = ["schema": 1, "accounting_complete": complete,
            "total_tokens_observed": total.map { $0 as Any } ?? NSNull(),
            "local_tokens_observed": local.map { $0 as Any } ?? NSNull(),
            "native_tokens_observed": native.map { $0 as Any } ?? NSNull(),
            "local_calls_started": 1, "local_calls_settled": 1, "local_worker_attempts": 1,
            "native_attempts": 2, "plan_model_calls": 0, "issues": issues,
            "quota_savings": "not_measured", "cash_cost": "not_measured",
            "accounting_scope": "observed_attempts_as_of_snapshot_not_future_cost"]
        if total == 0 && local == 0 && native == 0 {
            fields["local_calls_started"] = 0; fields["local_calls_settled"] = 0
            fields["native_attempts"] = 0; fields["local_worker_attempts"] = 0
        }
        return try JSONDecoder().decode(RCCRuntimeContract.ResourceUsageSummary.self,
            from: JSONSerialization.data(withJSONObject: fields))
    }
    let complete = P.resources(try usage())
    check(complete.state == .complete && complete.total == 23 && complete.local == 3 && complete.native == 20,
          "complete aggregate displays only supplied totals, not re-added cache/reasoning")
    check(complete.nativeAttempts == 2 && complete.localCalls == 1, "actual attempt counters survive projection")
    check(complete.text.contains("23") && complete.text.contains("20"), "complete text exposes observed totals")
    check(complete.text.contains("not measured") || complete.text.contains("미측정"), "subscription/cash stay unmeasured")
    let zero = P.resources(try usage(total: 0, local: 0, native: 0))
    check(zero.state == .complete && zero.total == 0 && zero.nativeAttempts == 0, "complete zero is a measured zero")
    let partial = P.resources(try usage(total: nil, local: 0, native: nil, complete: false, issues: ["native_missing"]))
    check(partial.state == .partial && partial.total == nil && partial.local == nil && partial.native == nil,
          "partial empty-row zero cannot imply zero task usage")
    let missing = P.resources(nil)
    check(missing.state == .unavailable && missing.total == nil, "legacy missing measurement is unknown")
    check(P.resources(try usage(total: 23, complete: false)).state == .invalid, "partial cannot claim a complete total")
    check(P.resources(try usage(total: 99)).state == .invalid, "sum mismatch rejected")
    check(P.resources(try usage(local: -1)).state == .invalid, "negative counts rejected")
    check(P.resources(try usage(issues: ["missing"])).state == .invalid, "complete plus issues rejected")
    var fabricated = try usage(); fabricated.cashCost = "0"
    check(P.resources(fabricated).state == .invalid, "cash zero cannot be fabricated")
    fabricated = try usage(); fabricated.quotaSavings = "50%"
    check(P.resources(fabricated).state == .invalid, "token count does not establish quota savings")
    fabricated = try usage(); fabricated.planModelCalls = 1
    check(P.resources(fabricated).state == .invalid, "unsupported planner accounting does not masquerade as complete")

    let now = Date(timeIntervalSince1970: 1_792_500_000)
    let account = "fixture.active"
    func snapshot(age: TimeInterval = 30, used: Double = 20, reset: Date? = nil,
                  accountID: String = account, source: BackendHealth.QuotaSnapshot.Source = .codexNative,
                  bucket: String = "codex.primary", model: String? = nil, surface: String? = nil) -> BackendHealth.QuotaSnapshot {
        .init(accountID: accountID, observedAt: now.addingTimeInterval(-age), source: source,
              windows: [.init(bucket: bucket, usedPercent: used, resetsAt: reset ?? now.addingTimeInterval(3_600),
                              model: model, surface: surface)])
    }
    func project(_ observation: BackendHealth.QuotaSnapshot?, provider: String = "codex",
                 state: BackendHealth.State? = .usable, probe: BackendHealth.QuotaProbe? = nil,
                 rejection: Date? = nil) -> P.Quota {
        P.quota(provider: provider, accountID: account, connectionState: state,
                snapshot: observation, probe: probe, rejectedAt: rejection, now: now)
    }
    let fresh = project(snapshot())
    check(fresh.basis == .fresh && fresh.windows.first?.observedRemainingPercent == 80, "fresh provider observation preserved")
    check(fresh.source == .codexNative && fresh.observedAt == now.addingTimeInterval(-30), "source and true observation time survive")
    check(fresh.windows.first?.bucket == "codex.primary" && fresh.windows.first?.resetsAt == now.addingTimeInterval(3_600),
          "bucket and window reset retained")
    check(fresh.generalRemainingEstimate == 80, "fresh estimate uses existing policy without cost conversion")
    let retained = project(snapshot(age: 245))
    check(retained.basis == .retainedEstimate && retained.observedAt == now.addingTimeInterval(-245), "retention is labeled, not stamped as new")
    check(abs((retained.generalRemainingEstimate ?? 0) - (80 - 2 * 245.0 / 60)) < 1e-8,
          "retained dispatch estimate reflects existing bounded discount")
    check(retained.windows.first?.observedRemainingPercent == 80, "historical observation differs from discounted estimate")
    let lowRetained = project(snapshot(age: 300, used: 91))
    check(lowRetained.generalRemainingEstimate == nil, "retained below-floor capacity does not become positive")
    let exhausted = project(snapshot(used: 100))
    check(exhausted.windows.first?.observedRemainingPercent == 0 && exhausted.generalRemainingEstimate == 0,
          "observed zero distinct from missing")
    let ok = BackendHealth.QuotaProbe(outcome: .ok, attemptedAt: now.addingTimeInterval(-5), nextEligibleAt: now.addingTimeInterval(120))
    let noRows = project(nil, probe: ok)
    check(noRows.basis == .unknown && noRows.windows.isEmpty && noRows.generalRemainingEstimate == nil,
          "successful probe without rows remains unknown, not zero or usable quota")
    check(noRows.probeOutcome == .ok && noRows.probeAttemptedAt == ok.attemptedAt, "probe outcome kept separate from measurement")
    check(project(snapshot(age: 601)).unknownReason == .stale && project(snapshot(age: 601)).windows.isEmpty,
          "expired observation does not expose current percent")
    check(project(snapshot(age: -1)).unknownReason == .futureObservation, "future observation unknown")
    check(project(snapshot(reset: now)).unknownReason == .resetCrossed, "reset equality invalidates old epoch")
    let foreign = project(snapshot(accountID: "fixture.other"))
    check(foreign.unknownReason == .accountMismatch && foreign.source == nil && foreign.observedAt == nil && foreign.windows.isEmpty,
          "foreign account cannot lend quota or reveal source metadata")
    check(project(snapshot(used: 101)).unknownReason == .malformed, "malformed percentage rejected")
    check(project(snapshot(bucket: "")).unknownReason == .malformed, "empty bucket rejected")
    check(project(snapshot(source: .claudeNative)).unknownReason == .malformed, "provider/source mismatch rejected")
    check(project(snapshot(), state: .loggedOut).unknownReason == .connectionUnavailable, "explicit sign-out prevents current quota display")
    check(project(snapshot(), state: .disabled).unknownReason == .connectionUnavailable, "disabled provider not advertised as available")
    check(project(snapshot(), state: nil).basis == .fresh && project(snapshot(), state: nil).connectionState == nil,
          "an account-bound observation does not invent connection status")
    check(project(snapshot(), rejection: now.addingTimeInterval(-10)).unknownReason == .rejected,
          "newer known quota rejection supersedes observation")
    check(project(snapshot(), rejection: now.addingTimeInterval(-60)).basis == .fresh, "newer observation may supersede older rejection")
    let scoped = project(snapshot(model: "fixture-model", surface: "codex"))
    check(scoped.windows.first?.model == "fixture-model" && scoped.windows.first?.surface == "codex" && scoped.generalRemainingEstimate == nil,
          "model/surface scope retained without inventing a general pool balance")
    let futureProbe = BackendHealth.QuotaProbe(outcome: .ok, attemptedAt: now.addingTimeInterval(1), nextEligibleAt: now.addingTimeInterval(120))
    check(project(snapshot(), probe: futureProbe).probeOutcome == nil, "future probe metadata not accepted")
    print("Runtime resource/quota presentation: \(count) checks PASS; synthetic values only; filesystem/provider/model calls 0")
}
