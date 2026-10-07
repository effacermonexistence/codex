#!/usr/bin/env python3
"""Scoped admission wiring regression, no provider or owner-state access."""
from pathlib import Path
import re
import subprocess
import tempfile
root=Path(__file__).resolve().parent.parent
app=(root/'Sources/OS1App/OS1App.swift').read_text()
settings=(root/'Sources/OS1Context/Localization.swift').read_text()
core=(root/'Sources/OS1Context/RunAdmission.swift').read_text()
def part(start,end):
 i=app.index(start);return app[i:app.index(end,i)]

# A textual switch spelling stopped matching the production implementation
# before this feature. Exercise the actual pure admission function instead,
# and prove the check rejects an injected hidden ceiling for nil/unlimited.
probe='''
for pressure in [RunAdmission.MemoryPressure.normal, .unknown] {
    for count in [0, 1, 4, 64, 1000] {
        let result = RunAdmission.decide(limit: nil, activeRuns: count, memoryPressure: pressure)
        if !result.admitted || result.reason != nil { exit(19) }
    }
}
if RunAdmission.decide(limit: 2, activeRuns: 2, memoryPressure: .normal).admitted { exit(20) }
if RunAdmission.decide(limit: nil, activeRuns: 4, memoryPressure: .warning).admitted { exit(21) }
if RunAdmission.decide(limit: nil, activeRuns: 1, memoryPressure: .critical).admitted { exit(22) }
'''
def admission_probe(source):
 with tempfile.TemporaryDirectory(prefix='os1-admission-wiring-') as tmp:
  script=Path(tmp)/'probe.swift'
  script.write_text(source+'\n'+probe)
  return subprocess.run(['/usr/bin/swift', str(script)], capture_output=True, text=True, timeout=90)
actual=admission_probe(core)
assert actual.returncode==0, 'Actual unlimited admission failed: '+actual.stderr
marker='if memoryPressure == .critical, occupied >= 1 {'
assert core.count(marker)==1, 'Admission mutation anchor changed; inspect the production function'
mutant=core.replace(marker, 'if limit == nil, occupied >= 4 { reason = .slotLimit } else '+marker, 1)
mutated=admission_probe(mutant)
assert mutated.returncode==19, 'Hidden unlimited-cap mutant was not specifically rejected: '+mutated.stderr
checks={
 'single_pure_admission_call':app.count('RunAdmission.decide(')==1,
 'all_production_cap_guards_removed':not re.search(r'activeRuns\.count\s*(?:<|>=)\s*(?:store\.)?maximumConcurrentSessions',app),
 'no_hidden_cap_for_nil':actual.returncode==0 and mutated.returncode==19,
 'source_wait_count_excluded':'waitingForSourceRuns: waitingForSourceRunCount' in app,
 'fixtures_have_normal_sampler':'storageRoot == nil ? { RunMemoryPressure.current() } : { .normal }' in app,
 'queue_pressure_checked_each_iteration':'refreshRunAdmissionPressure()\n            let decision = runAdmission' in part('    private func runNextQueuedSubmissionIfNeeded(', '    func togglePin('),
 'same_queue_snapshot_passed':'start(next, admission: decision)' in app,
 'blocked_direct_start_preserves_id':'var held = submission; held.admissionDeferred = true' in app and 'queuedSubmissions.insert(held, at: index)' in app,
 'deferred_failure_match_requires_id':'next.admissionDeferred == true && session.lastFailure != nil' in app,
 'readbacks_only_for_matching_failure':'next.readOnlyReconciliation == true && next.recoveryParentID == session.lastFailure?.id' in app,
 'registered_source_budget_after_admission':part('    func resumeRegisteredSourcePreparations(', '    /// A backend that comes back').index('let admission = runAdmission') < part('    func resumeRegisteredSourcePreparations(', '    /// A backend that comes back').index('retry.sourceRetryIdentity'),
 'registered_source_uses_snapshot':'start(retry, admission: admission)' in part('    func resumeRegisteredSourcePreparations(', '    /// A backend that comes back'),
 'memory_recovery_tick':'resumeAdmissionWaiters()' in part('    func runMaintenanceTick()', '    /// The lasting conditions'),
 'idle_tick_no_save':'func resumeAdmissionWaiters() { runNextQueuedSubmissionIfNeeded(persistIdle: false) }' in app,
 'other_callers_keep_save':'if changed || persistIdle { save() }' in app and 'private func runNextQueuedSubmissionIfNeeded(persistIdle: Bool = true)' in app,
 'resume_persist_fixture':'a resumed queue stays resumed across a restart even when no slot was free' in app,
 'source_wait_wakes_without_progress_edit':'if waitingForSourceRunCount > before { runNextQueuedSubmissionIfNeeded() }' in app,
 'optional_picker':'Text(os1Tr("제한 없음", "Unlimited")).tag(Int?.none)' in app,
 'migration_semantics_version':'parallelRunLimitVersion' in settings,
 'eight_actual_session_starts':'many.started.count == 8' in app,
 'parallel_fixture_wired':'try await unlimitedRunAdmissionSelfTest()' in app,
 'kernel_pressure_adapter':'sysctlbyname(sysctlName' in core and 'kern.memorystatus_vm_pressure_level' in core,
}
failed=[name for name,value in checks.items() if not value]
assert not failed, 'Run admission wiring missing: '+', '.join(failed)
print(f'Run admission wiring: {len(checks)} checks PASS; no live/model access')
