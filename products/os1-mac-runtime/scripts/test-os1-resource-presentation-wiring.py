#!/usr/bin/env python3
"""Bounded source-wiring regression. Reads source only; invokes no provider/app."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
app_path = ROOT / "Sources/OS1App/OS1App.swift"
pure_path = ROOT / "Sources/OS1Context/RuntimeResourcePresentation.swift"
app = app_path.read_text()
pure = pure_path.read_text()
checks = []


def check(identifier, condition):
    checks.append({"id": identifier, "pass": bool(condition)})
    assert condition, identifier


receipt = app.split("private func rccCoreReceipt(", 1)[1].split("private func taskQualityReceiptStatus(", 1)[0]
status = app.split("private struct ProviderStatusView: View {", 1)[1].split("private struct FrontierMonitorView: View {", 1)[0]
sidebar = app.split("Label(os1Tr(\"제공자 상태\", \"Provider status\")", 1)[1].split("private struct ProviderStatusView: View {", 1)[0]
check("provider_button_opens_quota_status_not_news_only", "ProviderStatusView(store: store)" in sidebar)
check("news_is_preserved_separately", "FrontierMonitorView(store: store)" in status and '"Frontier news"' in status)
check("quota_uses_active_account_book", "BackendAccounts.load()" in status and "BackendAccounts.active(provider:" in status)
check("quota_matches_account_before_ranking", "snapshots.filter { $0.accountID == account }.max" in status)
check("shared_claude_requires_account_match", "claudeStore?.accountID == account" in status)
check("probe_binding_not_inferred_from_success", "backendAccountMatches ? backend?.quotaProbe : nil" in status)
check("no_global_accountless_rejection", "ClaudeQuotaBackoff" not in status and "lastAccountRejection" not in status)
check("status_only_loads_existing_metadata", "BackendHealth.load(" in status and "ClaudeQuotaStore.load(" in status)
check("status_has_no_provider_refresh", not any(word in status for word in [".observe(", ".refresh(", "refreshBackend", "Process(", "URLSession", "runner(", "runTask("]))
check("status_has_no_auth_or_cache_writes", not any(word in status for word in [".save(", ".write(", "auth login", "setenv("]))
check("clock_updates_age_without_reading_cache", "TimelineView(.periodic" in status and status.count("loadCachedObservations()") == 4)
check("active_account_changes_reload_local_cache", ".onReceive(NotificationCenter.default.publisher(for: BackendAccountsModel.changed))" in status)
check("disabled_codex_not_shown_as_available", '!store.appSettings.showCodex' in status and '? .disabled : backendAccountMatches' in status)
check("quota_displays_source_and_true_asof", "source.rawValue" in status and "value.observedAt" in status)
check("quota_preserves_window_scope", all(word in status for word in ["window.bucket", "window.model", "window.surface", "window.resetsAt"]))
check("quota_labels_retained_estimate", ".retainedEstimate" in status and "Conservative general-window estimate" in status)
check("resource_guard_validates_entire_core", "let boundCore = (try? RCCRuntimeContract.validate(core)) != nil" in receipt)
check("resource_guard_exact_task", "core.taskID == submission.id.uuidString.lowercased()" in receipt)
check("resource_guard_exact_request", "core.requestSHA256 == appSHA256Hex(submission.executionRequest)" in receipt)
check("resource_render_uses_only_bound_core_summary", 'let resourceText = boundCore ? "\\n" + RuntimeResourcePresentation.resources(core.resourceUsage).text : ""' in receipt)
check("resource_kept_on_local_and_fallback_receipt", "text: (localReceipt?.detail ?? note) + resourceText" in receipt)
check("resource_kept_on_verified_native_receipt", "+ disclosureText + resourceText" in receipt)
check("receipt_does_not_refresh_or_route", not any(word in receipt for word in ["Process(", "URLSession", "refreshBackend", "runTask("]))
check("formatter_has_no_io_or_process_calls", not any(word in pure for word in ["Data(contentsOf:", "FileManager.", "Process(", "URLSession", ".observe(", ".save(", ".write("]))
check("formatter_never_fills_unknown_with_zero", "?? 0" not in pure)
check("receipt_integration_tests_present", all(word in app for word in ["foreign task cannot borrow resource accounting", "foreign request cannot borrow resource accounting", "partial aggregate displayed explicitly unknown", "resource observations persist in existing receipt text"]))
print(json.dumps({"status": "PASS", "checks": checks, "source_sha256": {
    str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in [app_path, pure_path]
}, "provider_calls": 0, "model_calls": 0, "app_launches": 0}, sort_keys=True))
