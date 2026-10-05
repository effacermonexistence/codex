#!/usr/bin/env python3
"""Structural gate: a HOME write task's confinement from OS-1's live source is wired in.

Build 319 lets a write task whose folder contains OS-1's live tree (HOME) run
beside an OS-1 repair by launching its Claude backend unable to write that
tree, instead of holding the source lease. The owner's rule ("동일 소스에 동시에
수정하지 마라") then rests on a handful of call sites. The pure helpers have
behavioural self-tests (`os1 self-test`, OS1ContextTests), but a call site that
stopped passing their result — the launch dropping the protected paths, the
lease taken before routing again, the finisher run for every confined attempt,
the escalation losing its OS-1 binding — leaves every one of those green
(mutation-checked in review, 2026-10-04). This gate pins the call sites.

Source-level only: it runs no model, no backend and changes nothing.
"""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
main = (root / 'Sources/OS1/main.swift').read_text()
self_update = (root / 'Sources/OS1/SelfUpdateCommands.swift').read_text()
app = (root / 'Sources/OS1App/OS1App.swift').read_text()
confinement = (root / 'Sources/OS1Context/OS1SourceConfinement.swift').read_text()
checks = 0


def check(value, message):
    global checks
    if not value:
        print('OS-1 source confinement wiring: FAILED: ' + message, file=sys.stderr)
        sys.exit(1)
    checks += 1


def body(source, start, end):
    i = source.index(start)
    return source[i:source.index(end, i)]


def flat(text):
    return re.sub(r'\s+', ' ', text)


# 1. No lease before routing; the watch reads the tree only under a lease.
home = body(main, 'var os1Source = OS1AttemptSourceState()', 'let pinnedEvidence =')
check('acquireOS1SourceSharedLease' not in home, 'a HOME task takes no shared lease before routing')
check('os1SharedLeaseRoot = containedRoot' in home, 'a HOME task records the live root it must keep off')
check(re.search(r'os1SharedLeaseRoot = containedRoot\s*\}\s*else\s*\{[^}]*os1Source\.watch = OS1SourceWatch\.capture', home, re.S),
      'the task-start watch is read only when a caller already holds the lease')
check(main.count('OS1SourceWatch.capture(') == 1, 'no other unleased watch of the live tree')

# 2. Each attempt decides confinement or lease after routing, through the tested helper.
loop = body(main, 'let sourceStep = try await prepareOS1AttemptSource(', 'let startData = Data(["os1-attempt-start-v1"')
check('provider: ticket.provider' in loop and 'permissionProfile: ticket.permissionProfile' in loop
      and 'sharedLeaseRoot: os1SharedLeaseRoot' in loop and 'firstAttempt: steps.isEmpty' in loop
      and 'state: &os1Source' in loop, 'the attempt decision gets this ticket, the live root and the run state')
check('ticketFresh: { ticketValid(ticket, forAtLeast: 60) }' in loop, 'a ticket aged while waiting is replaced')
check('case .reroute(let preferClaude):' in loop and 'route = try await client.post("/v1/executions"' in loop
      and 'step -= 1' in loop and 'continue' in loop, 'a re-route asks the route core again without spending an attempt')
check('attemptConfined = confined' in loop and 'attemptCarriesEarlierWriter = carriesEarlierWriter' in loop,
      'the attempt records how it ran')
production = main.replace(body(main, 'func os1AttemptSourceSelfTest() async throws {', 'func selfTest() throws {'), '')
check('acquireOS1SourceSharedLease(' not in production and 'acquireWaiting: (String) throws -> ExclusiveHookLease = acquireOS1SourceSharedLease,' in production,
      'the shared lease is taken only inside prepareOS1AttemptSource')

# 3. The Claude launch reads that decision and confines the backend.
check('let confinedPaths = confinedClaudeLaunchPaths(permissionProfile: ticket.permissionProfile)' in main,
      'the Claude launch reads the per-attempt protected paths')
launch = flat(body(main, 'var arguments = try claudeArguments(\n            model: nativeModel.invocation,', 'if projectlessRead'))
check('confinedPaths: confinedPaths, confinedEscalates: handBackEscalates )' in launch,
      'the protected paths reach the Claude arguments')
check('let handBackEscalates = OS1ChangeEscalation.available' in main, 'the launch knows whether a hand-back continues')
check('if confined { arguments += ["--settings", OS1SourceConfinement.claudeSettings(protectedPaths: confinedPaths)] }' in main,
      'a confined launch carries the probed sandbox settings')
check(len(re.findall(r'confinedPaths: confinedPaths\)', main)) >= 1 and 'boundedShell: ticket.permissionProfile == "read_only", confinedPaths: confinedPaths)' in main,
      'the result parser knows the protected paths')
check('func confinedClaudeLaunchPaths(permissionProfile: String) -> [String] {\n    permissionProfile == "workspace_write" ? OS1SourceConfinement.activeRoots : []' in main,
      'only a write ticket is confined; the read-only lane keeps its own settings')

# 4. Only the explicit marker hands back; a denied write is the protection working.
check('os1ChangeRequired = handled.changeRequired' in main, 'the hand-back is the marker only')
check('protectedWriteDenied ||' not in main and '|| parsed.protectedWriteDenied' not in main,
      'a denied protected write never triggers a rerun')
check('let handsBack = os1ChangeRequired && handBackEscalates' in main, 'checks are relaxed only when a repair follows')
check('validateCandidate = {' in main and 'validateCandidate = os1ChangeRequired ? nil' not in main,
      'a handed-back answer is still validated')

# 5. The finisher never claims a repair's change for a confined attempt.
check(re.search(r'unboundOS1SourceChangeObserved\(confined: attemptConfined,\s*carriesEarlierWriter: attemptCarriesEarlierWriter, watch: os1Source\.watch\)', main),
      'the finisher distinguishes a confined attempt from one carrying an earlier writer')
check('os1SourceConfined: attemptConfined,' in main and 'os1ChangeRequired: attemptConfined && execution.os1ChangeRequired' in main,
      'the step records the confinement and the hand-back')

# 6. The escalation: once, bound to OS-1, told what the first run did.
task = body(main, 'func runTask(\n', '/// Measured 2026-10-01')
check('OS1ChangeEscalation.$available.withValue(escalationAvailable)' in task, 'the first run knows whether a hand-back continues')
check('OS1RunAttemptRecorder.$current.withValue(draftAttempts)' in task,
      'the first run records its last attempt, so a rejected hand-back is not lost')
check(re.search(r'os1HandBackDraft\(adopted: adoptedDraft,\s*rejectedAttempt: draftFailure == nil \? nil : draftAttempts\.last, cancelled: cancelled\)', task),
      'an adopted hand-back, or one REVAS did not adopt (build 327), escalates through the tested decision')
check('if let draftFailure { throw draftFailure }' in task, 'a rejected draft that did not hand back fails as before')
check('OS1RunAttemptRecorder.current?.reset()' in main and 'OS1RunAttemptRecorder.current?.record(deliveredStep)' in main
      and 'OS1RunAttemptRecorder.current?.settle(disposition: revasDisposition)' in main,
      'each attempt is recorded once delivered and settled by the REVAS verdict')
check(main.index('OS1RunAttemptRecorder.current?.settle(disposition: revasDisposition)')
      < main.index('reason: "remote_verification_not_adopted_no_write_replay"'),
      'the verdict is recorded before a rejected writer throws')
rerun = flat(task[task.index('func runOS1Repair('):task.index('/// OS-1\'s source tree the repair works in')])
check('OS1ChangeEscalation.$available.withValue(false)' in rerun, 'the repair never escalates again')
check('forcedProjectID: "os1-clodex"' in rerun, 'the repair is bound to OS-1')
check('codexSessionID: nil, claudeSessionID: nil' in rerun, 'the repair starts fresh native sessions')
check('PendingOS1RepairContext.$current.withValue(' in rerun, 'the repair runs with its pending record bound for OS-1\'s completion')
check('repairPrompt: os1RepairHandoffPrompt(request: prompt, corrections: corrections, draftReport: report)' in flat(task),
      'the repair gets the first run report and the owner corrections')
cont = task[task.index('func continueAsOS1Repair('):task.index('// A new write request in a conversation whose OS-1 repair did not')]
check(cont.index('try? pendingStore.save(record)') < cont.index('let repair = try await runOS1Repair(repairPrompt)'),
      'the pending record is written before the repair starts')
check('if adopted, let recordID { pendingStore.remove(id: recordID) }' in cont, 'an adopted repair removes the record')
check('return mergedOS1Escalation(draft: draft, repair: repair' in cont, 'the owner sees both answers')
check('return appendingOS1RepairNote(draft, cancelled: true' in cont, 'a cancelled repair is said plainly and removes the record')
check('return os1RepairBlockedSummary(draft: draft, repairAnswer: answer,' in cont
      and 'note: os1RepairFailureNote(record: record, reason: reason)' in cont,
      'a failed repair shows its own answer and a precise note, never a complete turn')
retry = task[task.index('// A new write request in a conversation whose OS-1 repair did not'):task.index('var adoptedDraft: RunSummary?')]
check('let pending = pendingStore.load(id: recordID), pending.retryable()' in retry
      and '!ownerRequestRunsReadOnly(prompt, attachedSource: attached)' in retry,
      'a write request in a conversation with an unfinished repair continues it, before any draft runs')
check('os1PendingRepairRetryPlan(pending, root: root, contains:' in retry and 'restagePendingOS1Repair(pending, root: restageRoot, store: pendingStore)' in retry,
      'a staging-only failure is staged again first, with no model call')
check('repairPrompt: os1PendingRepairPrompt(current, newMessage: prompt), existing: current)' in flat(retry),
      'otherwise the repair runs again (bound to OS-1) with the record and the new message')
check('ownerRequestRunsReadOnly(prompt, attachedSource: attachedSource != nil)' in main,
      'the run scope and the retry decision share one read-only predicate')
complete = body(self_update, 'func completeOS1SelfRepair(', 'private func applySelfUpdate(')
check('for attempt in 1...2 {' in complete and 'guard attempt == 1, selfRepairGateIsSelfTest(gate) else { break }' in complete,
      'a self-test staging failure is re-run once, nothing else is')
check('try? data.write(to: URL(fileURLWithPath: path), options: .atomic)' in complete,
      'a staging failure takes OS-1\'s version bump back')
check('record.state = .stagingFailed' in complete and 'binding.store.remove(id: binding.id)' in complete,
      'the pending record learns a staging failure and is removed once the install intent exists')
check('stays in the working tree, nothing was installed' not in complete, 'the failure states where the change actually is')

# 7. Reading the live tree never takes git's index lock.
fingerprint = body(self_update, 'static func fingerprint(root: String) -> String? {', 'return sha256Hex(data)')
check(fingerprint.count('"--no-optional-locks", "-C", root,') == 2, 'the source watch is read-only on the git index')

# 8. The app parks only what cannot run confined.
check('let confinable = next.provider != .codex && next.claudeCapacity > 0' in app
      and 'SourceWriteAdmission.parksBehindSourceWriter(access, confinable: confinable)' in app,
      'a HOME write pinned to Codex stays parked; one that can run on Claude is admitted')

# 9. The protected set and its self-test.
check('releaseCacheKey(runtimeRoot:' in confinement and 'SelfUpdate.releaseEntryRelativePath' in confinement,
      'the release output outside the tree is protected')
check('try await os1AttemptSourceSelfTest()' in main, '`os1 self-test` runs the per-attempt wiring on real leases')

print(f'OS-1 source confinement wiring: {checks} checks PASS')
