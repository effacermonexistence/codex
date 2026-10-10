#!/usr/bin/env python3
"""Model-free source wiring regression for task/reference quality adoption.

This is a structural call-site gate, not a runtime quality proof or merge
approval. It only reads this checkout. Behavioral/hash/prose adversaries belong
to TaskQualityFixture.swift; real checker evidence stays in private custody.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
failures = []
checks = 0


def check(value, message):
    global checks
    checks += 1
    if not value:
        failures.append(message)


def load(relative):
    p = ROOT / relative
    if not p.is_file():
        failures.append('missing production source: ' + relative)
        return ''
    return p.read_text(encoding='utf-8')


def lexical(source, strings=False):
    """Preserve offsets while removing comments; optionally mask strings.

    Enough Swift lexical handling for nested comments and raw/multiline strings
    so a prose comment mentioning a quality call cannot satisfy wiring tests.
    """
    out = list(source)
    string_start = re.compile(r'(#{0,8})("""|")')
    i = 0
    while i < len(source):
        if source.startswith('//', i):
            end = source.find('\n', i)
            end = len(source) if end < 0 else end
            out[i:end] = ' ' * (end - i)
            i = end
        elif source.startswith('/*', i):
            start, depth = i, 1
            i += 2
            while i < len(source) and depth:
                if source.startswith('/*', i):
                    depth += 1
                    i += 2
                elif source.startswith('*/', i):
                    depth -= 1
                    i += 2
                else:
                    i += 1
            out[start:i] = ' ' * (i - start)
        else:
            match = string_start.match(source, i)
            if not match:
                i += 1
                continue
            hashes, quotes = match.groups()
            start = i
            i += len(hashes) + len(quotes)
            ending = quotes + hashes
            while i < len(source):
                if source.startswith(ending, i):
                    i += len(ending)
                    break
                if not hashes and source[i] == '\\':
                    i += 2
                else:
                    i += 1
            if strings:
                out[start:i] = ' ' * (i - start)
    return ''.join(out)


def function(source, name):
    masked = lexical(source, strings=True)
    found = re.search(r'\bfunc\s+' + re.escape(name) + r'\s*\(', masked)
    if not found:
        return ''
    opening = masked.find('{', found.end())
    if opening < 0:
        return ''
    depth = 1
    i = opening + 1
    while i < len(masked) and depth:
        depth += (masked[i] == '{') - (masked[i] == '}')
        i += 1
    return lexical(source[opening + 1:i - 1]) if depth == 0 else ''


def region(source, start, end):
    a = source.find(start)
    if a < 0:
        return ''
    b = source.find(end, a + len(start))
    return source[a:b] if b >= 0 else ''


main = load('Sources/OS1/main.swift')
runtime = load('Sources/OS1/TaskQualityRuntime.swift')
quality = load('Sources/OS1Context/TaskQuality.swift')
activity = load('Sources/OS1Context/RuntimeActivity.swift')
app = load('Sources/OS1App/OS1App.swift')
fixtures = load('Tests/OS1ContextTests/TaskQualityFixture.swift')
loop = function(main, 'runTaskWithOwnerPolicy')
resume = function(main, 'resumeDelivery')
local_gate = function(main, 'completionLocallyAdoptable')
printed = function(main, 'printRunSummary')
ui_receipt = function(app, 'executionReceipt')
runtime_evaluate = function(runtime, 'evaluateWithWitness')
code = lexical(loop, strings=True)

# A module existing (or a self-test mentioning it) does not establish use on
# the actual execution path. Pin pre-dispatch preparation and per-result use.
check(bool(loop), 'actual owner-policy execution loop must be inspectable')
prepare_match = re.search(r'\bPreparedTaskQuality\.prepare\s*\(', code)
dispatch_match = re.search(r'\bexecute\s*\(\s*ticket\s*:\s*ticket', code)
check(prepare_match is not None, 'owner-policy loop must prepare an exact task-quality contract')
check(prepare_match is not None and dispatch_match is not None and prepare_match.start() < dispatch_match.start(),
      'task-quality contract must be frozen before native result generation')
evaluation = re.search(r'\b(?:evaluateTaskQuality|evaluateQualityArtifact)\s*\(|\b\w+\??\.evaluateWithWitness\s*\(\s*artifact\s*:', code)
pending_pos = code.find('let pendingStep =')
outbox_pos = code.find('DeliveryOutbox().save(delivery)')
check(evaluation is not None, 'actual loop must evaluate the produced artifact, not leave an unused module')
check(evaluation is not None and pending_pos >= 0 and evaluation.start() < pending_pos,
      'quality evaluation must precede the pending step serialized into custody')
check(evaluation is not None and outbox_pos >= 0 and evaluation.start() < outbox_pos,
      'quality evaluation must precede the first outbox save/adoption delivery')
check('evaluateWithWitness' in lexical(function(runtime, 'evaluate'), strings=True)
      and '.assessment' in lexical(function(runtime, 'evaluate'), strings=True),
      'legacy evaluation wrapper must delegate to the same actual checker/witness and return its assessment')

# A known checker failure authorizes a bounded correction of the completed
# candidate. The exact witness and failed artifact must survive before the
# next native execution; continuation is not a generic writer replay.
correction = region(loop,
                    'if taskQuality.state == .mismatch, let preparedQuality, let witness = qualityWitness,',
                    'if route.status == "complete", !locallyAdoptable')
correction_code = lexical(correction, strings=True)
decision_match = re.search(r'\bTaskQualityCorrection\.decide\s*\(', correction_code)
correction_dispatch = re.search(r'\bclient\.post\s*\(', correction_code)
correction_continue = re.search(r'\bcontinue\b', correction_code)
decision_in_loop = re.search(r'\bTaskQualityCorrection\.decide\s*\(', code)
check(evaluation is not None and decision_in_loop is not None and evaluation.start() < decision_in_loop.start(),
      'actual produced-artifact witness must precede the correction decision')
check(re.search(r'TaskQualityCorrection\.decide\(\s*contract:\s*witness\.contract,\s*receipt:\s*witness\.receipt,\s*artifact:\s*witness\.artifact,\s*evaluation:\s*taskQuality', correction_code, re.S) is not None,
      'correction must consume the actual frozen checker contract/receipt/artifact, not a fabricated failure label')
check(decision_match is not None and correction_dispatch is not None and correction_continue is not None
      and decision_match.start() < correction_dispatch.start() < correction_continue.start()
      and 'correction.action == .correct || correction.action == .escalateReference' in correction_code,
      'continuation dispatch and loop continuation require a real approved correction decision first')
check(decision_in_loop is not None and outbox_pos >= 0 and outbox_pos < decision_in_loop.start(),
      'immutable failed artifact and pending step must enter delivery custody before any corrective dispatch')
preservation = re.search(r'var\s+preservedQualityFailure\s*=\s*deliveredStep.*?steps\.append\(preservedQualityFailure\).*?OS1RunAttemptRecorder\.current\?\.record\(preservedQualityFailure\)', correction_code, re.S)
check(preservation is not None and correction_dispatch is not None and preservation.end() < correction_dispatch.start()
      and 'preservedQualityFailure.revasDisposition = "quality_failure_preserved"' in lexical(correction),
      'rejected original step must remain explicitly preserved and recorded before corrective continuation')
check('qualityCorrectionBudget = correction.nextBudget' in correction_code
      and 'budget: qualityCorrectionBudget' in correction_code
      and 'qualityCorrectionPrepared = preparedQuality' in correction_code
      and 'continuation = nil' in correction_code,
      'correction must retain frozen checker/bounded budget and disable the generic writer replay handoff')
check('nativeSessions[ticket.provider] = execution.sessionID' in correction_code
      and re.search(r'providerSessionID:\s*OS1FullAccessContinuation\.sessionID\s*\?\?\s*\(nativeSessions\[ticket\.provider\]\s*\?\?\s*nil\)', code) is not None,
      'corrective native execution must resume the exact retained session rather than replacing completed work')
rebound = re.search(r'qualityCorrectionPrepared\?\.reboundForContinuation\(\s*contextSHA256:\s*attemptInputSHA256,\s*startTreeSHA256:\s*beforeHash\)', code)
rebind_code = lexical(function(runtime, 'reboundForContinuation'), strings=True)
check(rebound is not None and dispatch_match is not None and rebound.start() < dispatch_match.start()
      and 'contract.contextSHA256 = contextSHA256' in rebind_code
      and 'contract.startTreeSHA256 = startTreeSHA256' in rebind_code
      and 'checkerBytes: checkerBytes' in rebind_code and 'partialRegression: partialRegression' in rebind_code,
      'continuation must bind the new input/tree before native dispatch without replacing the frozen original checker')
check('TaskQualityCorrection.prompt(objective: objectiveRequest' in correction_code
      and 'failedCheckIDs: correction.failedCheckIDs' in correction_code
      and 'artifactSHA256: correction.failedArtifactSHA256' in correction_code
      and 'witness.failureDiagnostic' in correction_code,
      'correction instructions must preserve the original objective and only the actual bound failure diagnostics')
check('guard route.ticket?.permissionProfile == ticket.permissionProfile' in correction_code
      and 'step < config.maximumSteps' in correction_code,
      'corrective dispatch must preserve authorized scope and the existing bounded step budget')

# Retaining an old SID is insufficient if Auto can issue another provider's
# ticket. Pin the actual admitted tuple by excluding all others in the signed
# request, then check the returned ticket before the next native execution.
check('let correctionTuple = correction.action == .escalateReference ? reference! : (ticket.provider, model, effort)' in correction_code
      and 'let nextPreference = correctionTuple.0' in correction_code,
      'first correction must retain the actual provider/model/effort, reference escalation must be a distinct bounded action')
check(re.search(r'correctionCodexModels\s*=\s*correctionTuple\.0\s*==.*?codexCatalog\.models\s*\.filter\s*\{\s*\$0\.slug\s*==\s*correctionTuple\.1\s*&&\s*\$0\.supportedEfforts\.contains\(correctionTuple\.2\)\s*\}.*?supportedEfforts:\s*\[correctionTuple\.2\]', correction_code, re.S) is not None,
      'Codex correction capabilities must contain only the already available exact model and effort')
check(re.search(r'nextContext\?\.availableClaudeModels\s*=\s*correctionTuple\.0\s*==.*?claudeCatalog\s*\.filter\s*\{\s*\$0\.model\s*==\s*correctionTuple\.1\s*&&\s*\$0\.supportedEfforts\.contains\(correctionTuple\.2\)\s*\}.*?supportedEfforts:\s*\[correctionTuple\.2\]', correction_code, re.S) is not None,
      'Claude correction capabilities must contain only the already available exact model and effort')
check(re.search(r'StartExecutionRequest\(\s*task:\s*request\.task,\s*providerPreference:\s*nextPreference,.*?availableCodexModels:\s*correctionCodexModels,\s*executionContext:\s*nextContext', correction_code, re.S) is not None,
      'signed corrective route must bind the constrained tuple without rewriting the original routing objective')
check('sourceUTF8Bytes: existing.sourceUTF8Bytes' in correction_code
      and 'historyUTF8Bytes: existing.historyUTF8Bytes' in correction_code
      and 'governedDelegation: existing.governedDelegation' in correction_code,
      'tuple pinning must retain source/history/delegation metadata instead of reducing the envelope')
issued_tuple = re.search(r'guard\s+let\s+nextTicket\s*=\s*route\.ticket,.*?nextTicket\.provider\s*==\s*correctionTuple\.0,\s*profile\.model\s*==\s*correctionTuple\.1,\s*profile\.effort\s*==\s*correctionTuple\.2\s+else\s*\{\s*throw', correction_code, re.S)
check(issued_tuple is not None and correction_dispatch is not None and correction_continue is not None
      and correction_dispatch.start() < issued_tuple.start() < correction_continue.start(),
      'issued signed ticket must match the pinned provider/model/effort before corrective native execution')

# Native quality and the immutable raw artifact precede mechanical self-update.
# A version bump/commit/staging note must not alter the checked model artifact.
mechanical = region(loop,
                    'if route.status == "complete", locallyAdoptable, ParallelAgentRuntime.isolatedWriter == nil',
                    'try OwnerPolicyContext.snapshot?.verifyOriginal()')
mechanical_code = lexical(mechanical, strings=True)
mechanical_call = re.search(r'\bcompleteOS1SelfRepair\s*\(', code)
adoption_veto = re.search(r'guard\s+route\.status\s*!=\s*"complete"\s*\|\|\s*locallyAdoptable\s*\|\|\s*sourceRecoveryProvider\s*!=\s*nil\s+else', lexical(loop))
check(mechanical_call is not None and evaluation is not None and outbox_pos >= 0 and adoption_veto is not None
      and evaluation.start() < outbox_pos < adoption_veto.start() < mechanical_call.start(),
      'mechanical self-repair staging must follow quality evaluation, immutable outbox custody and the adoption veto')
check(len(re.findall(r'\bcompleteOS1SelfRepair\s*\(', code)) == 1 and bool(mechanical)
      and 'completeOS1SelfRepair' in mechanical_code,
      'no earlier single-turn self-repair staging may bypass the actual quality/adoption gate')
check('route.status == "complete", locallyAdoptable' in lexical(mechanical)
      and 'attemptFailure == nil' in mechanical_code,
      'mechanical staging requires actual remote and local adoption, never native exit alone')
check('.appendingOutput(' not in mechanical_code and 'execution =' not in mechanical_code,
      'mechanical staging must not rewrite raw model output, artifact identity or its producing workspace hash')
emit_signature = re.search(r'\bfunc\s+emit\s*\(([^{}]+)\)\s*\{', lexical(activity, strings=True))
emit_system_default = emit_signature is not None and re.search(
    r'publicTextOrigin:\s*PublicTextOrigin\s*=\s*\.systemStatus', emit_signature.group(1)) is not None
mechanical_origins = re.findall(r'publicTextOrigin:\s*\.(\w+)', mechanical_code)
check('RuntimeActivity.emit' in mechanical_code and emit_system_default
      and all(origin == 'systemStatus' for origin in mechanical_origins),
      'self-repair staging note must be separate OS-1 control telemetry, not attributed to the native model')
check('throw OS1Error.message' in mechanical_code,
      'mechanical staging failure must stop after retaining original result custody')

pending = region(loop, 'let pendingStep =', 'var delivery =')
check(re.search(r'\btaskQuality\s*:', lexical(pending, strings=True)) is not None,
      'the pending execution step must carry the observed task-quality assessment')
check('step: try JSONEncoder().encode(pendingStep)' in loop,
      'saved delivery custody must serialize the quality-bearing pending step')
check(re.search(r'\btaskQuality\s*:', lexical(region(loop, 'steps.append(RunStepSummary(', '\n    let adopted ='), strings=True)) is not None,
      'final execution step must retain quality instead of dropping it after remote verification')

# Remote completion cannot bypass a locally observed required failure. Missing
# quality may retain a visible execution-only result but cannot create parity.
check(re.search(r'if\s+taskQuality\.state\s*==\s*\.mismatch\s*\{\s*attemptFailure\s*=', code) is not None,
      'observed task-quality mismatch must become a real local result failure')
direct_quality_gate = re.search(r'let\s+locallyAdoptable\s*=\s*completionLocallyAdoptable\([^)]*\)\s*&&\s*taskQuality\.state\s*!=\s*\.mismatch', code, re.S) is not None
helper_quality_gate = (
    re.search(r'let\s+locallyAdoptable\s*=\s*completionLocallyAdoptable\([^)]*\btaskQuality\s*:\s*taskQuality', code, re.S) is not None
    and re.search(r'if\s+taskQuality\??\.state\s*==\s*\.mismatch\s*\{\s*return\s+false', lexical(local_gate, strings=True)) is not None
)
check(direct_quality_gate or helper_quality_gate,
      'actual local adoption result must reject task-quality mismatch')
check(re.search(r'let\s+revasDisposition\s*=\s*route\.status\s*==\s*"complete"\s*&&\s*locallyAdoptable', lexical(loop)) is not None,
      'remote complete must still depend on the quality-constrained local adoption result')
check(re.search(r'guard\s+record\.taskQuality\?\.state\s*!=\s*\.mismatch\s*,\s*step\.taskQuality\?\.state\s*!=\s*\.mismatch\s+else\s*\{', lexical(resume, strings=True)) is not None,
      'saved-result delivery must reject both stored mismatched assessments')
check('record.taskQuality == step.taskQuality' in resume and '$0.artifactSHA256 == record.resultSHA256' in resume,
      'saved-result quality must remain bound to the exact saved step/artifact')
check('taskQuality: step.taskQuality' in re.sub(r'\s+', ' ', resume),
      'saved-result reconstruction must preserve quality metadata for presentation')

# Optional legacy fields stay readable; no generic text assertion or reference
# model setting can manufacture an evidence receipt.
step = region(main, 'struct RunStepSummary: Codable', '\nstruct RunSummary:')
check(re.search(r'var\s+taskQuality\s*:\s*TaskQualityEvidence\.Evaluation\?', lexical(step, strings=True)) is not None,
      'runtime step needs an optional typed assessment, including legacy-unresolved absence')
check(re.search(r'case\s+taskQuality\s*=\s*"task_quality"', lexical(step)) is not None,
      'runtime assessment must survive the encoded saved-step interface')
check('taskQuality' in lexical(app, strings=True) and 'task_quality' in app,
      'app decoder must read the runtime assessment instead of inferring quality from prose')
check('unresolvedTaskQuality' in lexical(loop, strings=True),
      'missing exact checker must be explicitly execution-only/unresolved')
check('executionOnly' in runtime and '.observedCheckerReceipt' in runtime,
      'quality source must be checker observations, not native transport or a generated assertion')
check('contract.fullCoverage' in quality and 'reference.proofMode != .dev' in quality,
      'incomplete/dev reference evidence must not become production reference parity')
check('required_task_check_failed' in quality and 'below_reference_on_required_check' in quality,
      'required failure and below-reference regression must remain distinct blocking states')
check('referenceParityVerified' in quality and 'taskCompletionVerified' in quality,
      'execution, checked task completion, and reference parity are separate states')

# Both receipt surfaces must actually consume typed state. A status=complete
# label alone is execution custody, not a verified objective-quality statement.
check('taskQuality' in lexical(printed, strings=True), 'CLI result presentation must consume typed task quality')
check('taskQuality' in lexical(ui_receipt, strings=True), 'app receipt presentation must consume typed task quality')
check('.verificationUnavailable' in loop and 'taskQuality.taskCompletionVerified' in loop,
      'execution-only output cannot train a task-quality success as though it were verified')
check('taskCompletionVerified' in fixtures and 'referenceParityVerified' in fixtures,
      'behavioral fixtures must assert task-vs-reference separation')
check('mismatch' in fixtures and ('prose' in fixtures.lower() or 'model' in fixtures.lower()),
      'behavioral fixtures must cover mismatch and model-prose non-authority')

# Frozen checker execution cannot certify a workspace it changed itself. This
# source gate does not claim OS-level sandbox enforcement: it checks artifact
# custody and delegates detailed mutation/failure cases to behavioral tests.
runtime_code = lexical(runtime_evaluate, strings=True)
frozen_var = re.search(r'\b(\w+)\s*=\s*try\s+frozenCandidate\s*\(', runtime_code)
payload = re.search(r'TaskQualityCheckerInput\s*\((.*?)\)', runtime_code, re.S)
check(frozen_var is not None and payload is not None
      and re.search(r'\bworkspace\s*:\s*' + re.escape(frozen_var.group(1)) + r'\.path\b', payload.group(1)) is not None,
      'checker input must receive the actual frozen candidate path, never the live workspace')
check(frozen_var is not None and re.search(r'\bfrozenCandidate\s*\(\s*workspace\s*:\s*workspace\s*,\s*paths\s*:\s*envelope\.workspacePaths\s*,\s*into\s*:\s*runRoot', runtime_code) is not None,
      'checker must copy only the explicitly bounded declared artifact paths')
check('workspaceAfterHash' in runtime_evaluate and ('workspaceHash' in runtime_evaluate or 'observedStateHash' in runtime_evaluate),
      'checker path must recheck the producing workspace hash against the recorded artifact')
check(not re.search(r'\b(?:findExecutable|runTask|runWorkflowTask|runParallelAgentTask)\s*\(', lexical(runtime, strings=True)),
      'quality checker bridge must not invoke another provider or model workflow')

# A partial pre-existing test recipe may veto an observed regression, never
# certify an unmeasured task/reference floor. Freeze both test identities and
# the production workspace before model execution; check two separate copies.
prepare_code = lexical(function(runtime, 'prepare'), strings=True)
check(re.search(r'\bPreparedTaskQuality\.prepare\s*\([^;]*\bworkspace\s*:\s*observedWorkspace', code, re.S) is not None,
      'production preparation must bind the actual producing workspace')
check('PythonRegressionSnapshot.acquire' in prepare_code and 'workspace: workspace' in prepare_code,
      'partial recipe acquisition must occur in pre-dispatch preparation')
check('fullCoverage: false' in function(runtime, 'prepare') and 'referenceProfiles: []' in function(runtime, 'prepare')
      and 'reference: nil' in function(runtime, 'prepare'),
      'partial test observations must not synthesize full coverage or frontier parity')
check('snapshot.originalTests' in runtime_code and 'bytes.write' in runtime_code,
      'original pre-dispatch test bytes must be restored into the original-suite copy')
check('candidateSuite = try frozenCandidate' in runtime_code and 'candidateWorkspace: candidateSuite?.path' in runtime_code,
      'the candidate test suite must run against a separate copied artifact')
check('partial.original_unittest' in runtime and 'partial.candidate_unittest' in runtime
      and 'copiedPythonRegressionLaunch' in runtime_code,
      'both partial suites must produce observations through the bounded copied-artifact execution path')
check('captureDirectory: runRoot' in runtime_code,
      'constrained checker stdout/stderr must remain inside its allowed scratch boundary')
check('guard partialRegression != nil else { throw error }' in runtime_code
      and 'result = (127, Data(), Data(' in runtime_code
      and 'approvedDeveloperPythonRoot' in runtime,
      'an unavailable/non-approved selected Apple Python must preserve typed partial-unittest unverified evidence, not execute a fallback')
check('captureDirectory ?? FileManager.default.temporaryDirectory' in function(main, 'commandOutput'),
      'optional constrained capture must preserve the default for unrelated execution paths')
check('allowRegressionAcquisition: !qualityRegressionAcquisitionAttempted' in code
      and 'frozenQualityWorkspace == observedWorkspace ? frozenQualityRegression : nil' in code,
      'retry must reuse first test custody only for the same workspace, never reacquire model-rewritten tests')

if failures:
    for failure in failures:
        print('OS-1 task quality wiring: FAILED: ' + failure, file=sys.stderr)
    print(f'OS-1 task quality wiring: {checks - len(failures)}/{checks} structural checks passed', file=sys.stderr)
    sys.exit(1)
print(f'OS-1 task quality wiring: {checks} structural checks passed; no provider calls or live-state writes')
