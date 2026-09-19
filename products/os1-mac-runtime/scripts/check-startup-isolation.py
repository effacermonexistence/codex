#!/usr/bin/env python3
"""Structural regression gate; runtime first-window timing remains separate."""
from pathlib import Path
import sys
p = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'Sources/OS1App/OS1App.swift'
s = p.read_text()
load = s[s.index('    private func load()'):s.index('    private func save()')]
repair = s[s.index('    private func scheduleNativeProvenanceRepair()'):s.index('    nonisolated fileprivate static func readBoundNativeRecords(')]
assert 'readBoundNativeRecords(' not in load, 'Native archive scan blocks startup load'
assert 'scheduleNativeProvenanceRepair()' in s[s.index('        load()'):s.index('        load()')+100]
assert 'Task.detached(priority: .background)' in repair
assert repair.index('Task.detached') < repair.index('Self.readBoundNativeRecords') < repair.index('await MainActor.run')
assert '!self.isSessionRunning(snapshot.id)' in repair
assert '$0.nativeSessionID == outcome.binding.nativeSessionID' in repair
assert 'repairManagedImports(&self.sessions[index]' in repair
assert 'self.sessions[index] = snapshot' not in repair
print('Startup archive isolation: 8 checks PASS (structural; no model calls)')

maintenance = s[s.index('    func runMaintenanceTick()'):s.index('    func releaseRestartHolds(')]
assert maintenance.index('install-maintenance.pid') < maintenance.index('resumeBackendRecoveries()')
assert 'kill(pid, 0) == 0 { return }' in maintenance
print('Installer maintenance lease: 2 checks PASS')
