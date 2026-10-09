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
loop = body(main, 'let sourceStep: OS1AttemptSourceStep =', 'let startData = Data(["os1-attempt-start-v1"')
check('ParallelAgentRuntime.isolatedWriter != nil' in loop and '.proceed(confined: false, carriesEarlierWriter: false)' in loop,
      'only a validated private isolated writer bypasses live-source attempt custody')
check('canonicalWorkspace == grant.workspace' in main and 'executionWorkspace != grant.workspace' in main,
      'isolated writer cannot rebind to the live source tree')
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
check('confinedPaths: confinedPaths, confinedEscalates: handBackEscalates,' in launch,
      'the protected paths reach the Claude arguments')
check('fullAccessProtectedPaths: fullAccessPaths' in launch,
      'the resumed launch receives the same source-only protected paths')
check('let handBackEscalates = OS1ChangeEscalation.available' in main, 'the launch knows whether a hand-back continues')
check('else if confined { arguments += ["--settings", OS1SourceConfinement.claudeSettings(protectedPaths: confinedPaths)] }' in main,
      'a confined launch carries the probed sandbox settings')
check('boundedShell: ticket.permissionProfile == "read_only", confinedPaths: Array(Set(confinedPaths + fullAccessPaths))' in main,
      'the result parser knows protected paths in both confined and source-only full-access launches')
parser_try = body(main, 'let parsed: ClaudePrintResult\n        do {', '\n        catch {')
parser_catch = body(main, '\n        catch {\n            let object = (try? JSONSerialization.jsonObject(with: resultData))',
                    '// A confined run that needs a change to OS-1 itself')
check('if !fullAccessPaths.isEmpty, raw.0 != 0' in parser_try
      and 'Full-access Claude continuation failed before a structured session result' in parser_try
      and 'NativeStepLabel.redactKeepingEnd' in parser_try
      and 'var rejection = interruptedExecution(' in parser_catch
      and 'sessionID: activeSessionID, publicProgress: progress' in parser_catch
      and 'throw rejection' in parser_catch,
      'non-JSON full-access diagnostics stay inside parse custody so interrupted output/native progress survives')
check('func confinedClaudeLaunchPaths(permissionProfile: String) -> [String] {\n    permissionProfile == "workspace_write" ? OS1SourceConfinement.activeRoots : []' in main,
      'only a write ticket is confined; the read-only lane keeps its own settings')

# 4. Only the explicit marker hands back; a denied write is the protection working.
check('os1ChangeRequired = handled.changeRequired' in main, 'the hand-back is the marker only')
check('protectedWriteDenied ||' not in main and '|| parsed.protectedWriteDenied' not in main,
      'a denied protected write never triggers a rerun')
check('let handsBack = (os1ChangeRequired || os1FullAccessRequired) && handBackEscalates' in main,
      'checks are relaxed only when a source repair or bounded full-access continuation follows')
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
check(re.search(r'os1HandBackDraft\(adopted: adoptedDraft,\s*rejectedAttempt: draftFailure == nil \? nil : draftAttempts\.last, cancelled: cancelled[,)]', task),
      'an adopted hand-back, or one REVAS did not adopt (build 327), escalates through the tested decision')
check(re.search(r'cancelled: cancelled,\s*persistedCorrectionIDs: ExecutionSteering\.currentSubmission', task),
      'a rejected, steered hand-back carries the corrections its steering persisted')
check('OS1SelfReference.continuesPendingOS1Change(prompt' in task and 'runOwnerRequest(pendingNote: pending)' in task,
      'a write request continues a pending OS-1 change only when it is about it; another task runs as itself')
check('objective: os1PendingRepairObjective(current, newMessage: prompt)' in task,
      'a retried repair is routed and verified against the recorded request, not the bare follow-up')
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
cont = task[task.index('func continueAsOS1Repair('):task.index("/// The owner's request as itself")]
check(cont.index('try? pendingStore.save(record)') < cont.index('let repair = try await runOS1Repair(repairPrompt, objective: objective)'),
      'the pending record is written before the repair starts')
check('if adopted, let recordID { pendingStore.remove(id: recordID) }' in cont, 'an adopted repair removes the record')
check('return mergedOS1Escalation(draft: draft, repair: repair' in cont, 'the owner sees both answers')
check('return appendingOS1RepairNote(draft, cancelled: true' in cont, 'a cancelled repair is said plainly and removes the record')
check('return os1RepairBlockedSummary(draft: draft, repairAnswer: answer,' in cont
      and 'note: os1RepairFailureNote(record: record, reason: reason, staged: staged)' in cont
      and 'persistedCorrectionIDs: steered)' in cont,
      'a failed repair shows its own answer and a precise note, never a complete turn')
retry = task[task.index('// A new write request in a conversation whose OS-1 repair did not'):task.index('return try await runOwnerRequest(pendingNote: nil)')]
check(task.index("/// The owner's request as itself") < task.index('// A new write request in a conversation whose OS-1 repair did not')
      < task.index('return try await runOwnerRequest(pendingNote: nil)'), 'the pending-repair decision runs before any draft')
check('var pending = pendingStore.load(id: recordID), pending.retryable()' in retry
      and '!ownerRequestRunsReadOnly(prompt, attachedSource: attached)' in retry,
      'a write request in a conversation with an unfinished repair continues it, before any draft runs')
check('os1PendingRepairRetryPlan(pending, root: root, contains:' in retry and 'restagePendingOS1Repair(pending, root: restageRoot, store: pendingStore)' in retry,
      'a repair whose commit is still in the source is staged again first, with no model call')
check('installed: { root, commit in gitCommitIsInstalled(commit, root: root) }' in retry and 'case .alreadyInstalled(let commit):' in retry,
      'a repair already in the installed build is dropped, never rebuilt')
check('pending = os1PendingRepairForRetry(pending, store: pendingStore)' in retry, 'a dead writer\'s record is stored interrupted first')
check('repairPrompt: os1PendingRepairPrompt(current, newMessage: prompt), objective: os1PendingRepairObjective(current, newMessage: prompt), existing: current)' in flat(retry),
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

# 10. The broad-sandbox escape resumes only the exact original native session,
# under the shared source lease, retaining a narrow OS-1 source write guard.
full_gate = body(main, 'func fullAccessHandBackDraft(', 'func fullAccessResumeArguments(')
check('guard !cancelled else { return nil }' in full_gate, 'a cancelled request never receives full-access continuation')
check(full_gate.count('$0.exitCode == 0') == 1 and 'step.exitCode == 0' in full_gate,
      'both adopted and rejected full-access hand-backs require successful backend exit')
check('step.provider == "claude"' in full_gate and 'step.os1SourceConfined' in full_gate
      and 'step.os1FullAccessRequired' in full_gate and '["retry", "rejected"].contains(step.revasDisposition)' in full_gate,
      'a REVAS-unadopted hand-back is accepted only from a delivered, protected Claude marker attempt')
check('UUID(uuidString: step.sessionID) != nil' in full_gate and 'UUID(uuidString: $0.sessionID) != nil' in full_gate,
      'full-access cannot substitute a fresh session for a missing native session ID')
check('!step.output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty' in full_gate,
      'an empty rejected hand-back is not treated as a blocked-step report')

full_handoff = task[task.index('if escalationAvailable, OS1FullAccessContinuation.sessionID == nil,'):
                    task.index('if escalationAvailable, !ExecutionCancellation.isCancelled, let handBack = os1HandBackDraft(')]
check('fullAccessHandBackDraft(adopted: adoptedDraft, rejectedAttempt: draftFailure == nil ? nil : draftAttempts.last' in full_handoff,
      'the full-access decision inspects a rejected delivery, not only REVAS-adopted output')
check('OS1FullAccessContinuation.$sessionID.withValue(native.sessionID)' in full_handoff
      and 'claudeSessionID: native.sessionID' in full_handoff,
      'the continuation carries the exact original Claude native session ID end to end')
check('providerPreference: "claude"' in full_handoff and 'codexSessionID: nil' in full_handoff and 'codexCapacity: 0' in full_handoff,
      'a full-access hand-back stays on Claude instead of switching backends')
check('OS1FullAccessContinuation.$protectedPaths.withValue(protected)' in full_handoff
      and 'sourceWriteGuardProfile(protectedPaths: protected)' in full_handoff,
      'source-only protection is validated and carried before launching a continuation')
check('heldOS1SourceRoot: nil' in full_handoff,
      'the resumed run cannot pretend that a caller already owns the source lease')
check('fullAccess: OS1FullAccessContinuation.sessionID != nil' in loop,
      'the resumed runtime requests the shared source lease instead of broad sandbox confinement')
check('guard resolvedScope == .workspaceWrite, let guardedRoot = OS1FullAccessContinuation.protectedPaths.first' in home
      and 'os1SharedLeaseRoot = guardedRoot' in home,
      'the full-access shared lease is bound to the exact source root even if normal project binding changes')
check('if OS1FullAccessContinuation.sessionID != nil && (ticket.provider != "claude" || ticket.permissionProfile != "workspace_write")' in main,
      'a remote route cannot convert the same-session continuation into another provider or read-only lane')
check('OS1FullAccessContinuation.sessionID != nil || workflowStage == .implementation || readOnlyReview ? 1 :' in main,
      'the full-access continuation has one attempt and cannot implicitly replay a rejected writer')
check('OS1FullAccessContinuation.sessionID == nil, quotaLimit > attemptLimit, !readOnlyReview' in main
      and 'if OS1FullAccessContinuation.sessionID == nil, expandedLimit > attemptLimit' in main,
      'quota and undispatched recovery cannot expand the single full-access attempt budget')
source_prepare = body(main, 'func prepareOS1AttemptSource(', '/// A signed ticket still has')
check('sharedLeaseRoot: sharedLeaseRoot, fullAccess: fullAccess, protectedPaths: protectedPaths' in flat(source_prepare),
      'the full-access flag reaches the tested attempt guard')
check('if !fullAccess, firstAttempt, state.claudeReroutesLeft > 0' in source_prepare,
      'a resumed full-access wait cannot reroute itself back into the broad sandbox')
check('os1FullAccessRequired = handled.fullAccessRequired && handBackEscalates && OS1FullAccessContinuation.sessionID == nil' in main,
      'a resumed backend cannot create a second full-access loop')
check('if OS1FullAccessContinuation.sessionID != nil && handled.fullAccessRequired {' in main
      and 'Full-access continuation still reported a blocked step' in main,
      'a repeated full-access marker fails explicitly instead of completing or re-running')
check('deliveredStep.os1FullAccessRequired = attemptConfined && execution.os1FullAccessRequired' in main,
      'the delivered attempt retains the full-access marker even if REVAS rejects it')
check('let adoptedRecord = revasDisposition == "adopted" && !execution.os1FullAccessRequired' in main,
      'a handed-back native session is not concurrently given to Claude Desktop before its resume')

native = body(main, 'let pinnedResumeID = OS1FullAccessContinuation.sessionID', 'let activeSessionID = requestedSessionID')
check('previousSessionID != pinnedResumeID' in native and 'desktopOwnsPrevious' in native
      and 'ticket.permissionProfile != "workspace_write"' in native,
      'native resume rejects wrong session, Desktop ownership and non-write tickets')
check('let requestedSessionID = pinnedResumeID ??' in native and 'let startsNewSession = pinnedResumeID == nil' in native,
      'full-access pins native identity and forces --resume rather than --session-id')
arguments = body(main, 'func claudeArguments(', 'func claudePermissionArguments(')
check('arguments += ["--resume", sessionID]' in arguments,
      'the actual Claude argument builder emits --resume for the continued session')
check('OS1SourceConfinement.claudeFullAccessSettings(protectedPaths: fullAccessProtectedPaths)' in arguments,
      'only the resumed source-protected branch disables Claude broad sandbox settings')
wrapper = body(main, 'func fullAccessResumeArguments(', 'func fullAccessContinuationPrompt(')
check('isExecutableFile(atPath: "/usr/bin/sandbox-exec")' in wrapper
      and 'OS1SourceConfinement.SourceGuardError.unavailable' in wrapper,
      'missing source-only guard fails closed instead of running unprotected')
check('try OS1SourceConfinement.sourceWriteGuardProfile(protectedPaths: protectedPaths), executable] + arguments' in wrapper,
      'the source-only guard wraps the actual Claude executable and its complete argument list')
check('let launch = try fullAccessPaths.isEmpty ? (claude, arguments) : fullAccessResumeArguments(' in main
      and re.search(r'do \{ raw = try commandOutput\(\s*launch\.0,\s*launch\.1,', main),
      'the guarded launch, not an unused wrapper, is the executed command')
check('providerSessionID: OS1FullAccessContinuation.sessionID ??' in main,
      'the pinned original identity reaches execute despite REVAS-native-session adoption rules')
check(full_handoff.index('let resumed =') < full_handoff.index('guard resumed.status == "complete"'),
      'continuation result is checked before joining the owner answer or source-repair hand-back')
check('if ExecutionCancellation.isCancelled {' in full_handoff
      and full_handoff.index('if ExecutionCancellation.isCancelled {') < full_handoff.index('adoptedDraft = mergedFullAccessContinuation'),
      'late cancellation after resumed execution blocks adoption and source repair')
check('if escalationAvailable, !ExecutionCancellation.isCancelled, let handBack = os1HandBackDraft(' in task,
      'source repair rechecks cancellation instead of using the earlier pre-resume snapshot')
check('let reason = resumed.workflowBlocker ?? resumed.status' in full_handoff
      and 'return fullAccessFailureSummary(draft: fullDraft, reason: reason, resumed: resumed.steps.last' in full_handoff
      and 'let reason = String(describing: error)' in full_handoff
      and 'return fullAccessFailureSummary(draft: fullDraft, reason: reason, resumed: resumeAttempts.last' in full_handoff,
      'both incomplete and thrown resumes return a visible precise blocked summary')
check('pendingRecordSaved: deferOS1Change(fullDraft, reason: reason))' in full_handoff
      and 'pendingRecordSaved: !resumeCancelled && deferOS1Change(fullDraft, reason: reason))' in full_handoff,
      'an OS-1 change behind an unfinished continuation is kept on record (never when cancelled)')
defer_os1 = body(task, 'func deferOS1Change(', 'if escalationAvailable, OS1FullAccessContinuation.sessionID == nil,')
check('guard confinedDraftRequiresOS1Change(fullDraft), let recordID else { return false }' in defer_os1
      and 'os1DeferredFullAccessRepair(store: pendingStore, recordID: recordID' in defer_os1
      and 'report: os1HandBackReport(fullDraft)' in defer_os1,
      'the deferred OS-1 change is written to the conversation\'s pending record with its report')
cancel_gate = task[task.index('let cancelled = ExecutionCancellation.isCancelled ||'):
                   task.index('if escalationAvailable, OS1FullAccessContinuation.sessionID == nil,\n               let fullDraft')]
check('ExecutionCancellation.isCancelled,\n               let cancelledHandBack = os1CancelledHandBackSummary(adopted: adoptedDraft)' in cancel_gate
      and 'return cancelledHandBack' in cancel_gate,
      'Stop after an adopted hand-back returns the cancelled note before either continuation is considered')
check('let report = os1HandBackReport(handBack)' in task,
      'the OS-1 repair prompt carries each attempt\'s report once')
failure = body(main, 'func fullAccessFailureSummary(', '/// A confined attempt (a HOME request')
check('RunSummary(status: "workflow_blocked"' in failure and 'workflowBlocker: blocked' in failure
      and 'Full-access continuation' in failure and '전체 권한 이어가기' in failure,
      'resume failure is surfaced in both languages and never reported as a complete turn')
check('if let continued = resumed?.output' in failure and 'Continuation result (not adopted)' in failure
      and 'if steps.isEmpty, let shown = draft.steps.last?.output' in failure
      and failure.count('PendingOS1Repair.bounded(') == 2 and 'workflowStage = "full-access-pending"' in failure,
      'resume failure shows the first report once (bounded, only when no kept answer) and the bounded continuation answer')
check('persistedCorrectionIDs: os1MergedCorrectionIDs(draft.persistedCorrectionIDs, persistedCorrectionIDs)' in failure,
      'failure retains steering corrections from both the first and resumed attempts')
check('resumed: resumed.steps.last, cancelled: true, persistedCorrectionIDs: resumed.persistedCorrectionIDs' in full_handoff
      and 'resumed: resumed.steps.last, persistedCorrectionIDs: resumed.persistedCorrectionIDs' in full_handoff
      and 'persistedCorrectionIDs: ExecutionSteering.currentSubmission.map { ExecutionSteering().persistedIDs($0) }' in full_handoff,
      'cancelled, incomplete and thrown continuations carry their actual persisted steering receipts')
merged = body(main, 'func mergedFullAccessContinuation(', 'func fullAccessFailureSummary(')
check('os1RejectedHandBackAnswer(draft)' in merged and 'First execution report (not adopted)' in merged,
      'successful continuation still shows the first report when REVAS did not adopt that report')
check('adoptedDraft = mergedFullAccessContinuation(draft: fullDraft, resumed: resumed)' in full_handoff,
      'the merged-report helper reaches the owner-visible answer, not only unit fixtures')
check('if OS1FullAccessContinuation.sessionID != nil, os1Source.watch?.changed() == true' in main
      and 'no self-update, install or replay was started' in main,
      'a detected protected-source mutation blocks continuation rather than claiming or installing it')
check(re.search(r'\bif\s+route\.status == "complete",\s*locallyAdoptable,\s*ParallelAgentRuntime\.isolatedWriter == nil,\s*OS1FullAccessContinuation\.sessionID == nil,\s*previewDeploymentTarget == nil', main)
      and re.search(r'\belse if\s+route\.status == "complete",\s*locallyAdoptable,\s*ParallelAgentRuntime\.isolatedWriter == nil,\s*OS1FullAccessContinuation\.sessionID == nil,\s*let os1SourceWatch', main),
      'full-access non-OS-1 work cannot enter either adopted OS-1 self-update finisher')
prompt = body(main, 'func fullAccessContinuationPrompt(', 'func fullAccessFailureSummary(')
check('Continue ONLY the non-OS-1 steps blocked' in prompt and 'SAME native session' in prompt
      and 'Do not restart the original request or repeat any completed' in prompt
      and 'Verify partial side effects before retrying' in prompt,
      'the handoff continues only blocked steps after side-effect inspection, never the whole request')
check('Original owner authorization and exact scope remain binding' in prompt
      and 'no new login approval, terms or purchase authority is granted' in prompt,
      'full access never replaces owner authorization or external consent')

guard_profile = body(confinement, 'public static func sourceWriteGuardProfile(', 'public static func fullAccessInstructions(')
check('guardedAncestors(of: protectedPaths).map { " (deny file-write-unlink (literal " + quoted($0) + "))" }' in guard_profile,
      'every ancestor of a protected path is undeletable and unrenameable under the source-only guard')
instructions = body(confinement, 'public static func fullAccessInstructions(', 'static let fileWriteTools')
check('swift build --disable-sandbox' in instructions and 'codex exec -s danger-full-access' in instructions
      and 'every child process still inherits the OS-1 source guard' in instructions
      and '샌드박스 해제 모드' in instructions,
      'the continuation tells nested-sandbox tools to use their own no-sandbox mode, in both languages')
fixture = (root / 'Tests/OS1ContextTests/OS1SourceConfinementFixture.swift').read_text()
check('process.standardInput = FileHandle.nullDevice' in fixture,
      'guarded fixture commands never read the terminal')
self_test = body(main, 'func fullAccessHandBackSelfTest()', 'func selfTest()')
check('OS1SourceLeaseDirectory.$override.withValue(' in self_test
      and 'try? FileManager.default.removeItem(at: lock.appendingPathExtension("writer-intent"))' in self_test,
      'the full-access self-test keeps its real leases out of ~/.os1/self-update and removes them')
print(f'OS-1 source confinement wiring: {checks} checks PASS')
