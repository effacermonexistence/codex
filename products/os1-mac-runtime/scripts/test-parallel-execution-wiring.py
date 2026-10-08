#!/usr/bin/env python3
"""Source-boundary assertions supplement executed process/window fixtures.
No native model, provider call, live session store, or installer is invoked.
"""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
main = (root / 'Sources/OS1/main.swift').read_text()
app = (root / 'Sources/OS1App/OS1App.swift').read_text()
windows = (root / 'Sources/OS1App/AgentTaskInspectorWindows.swift').read_text()
checks = 0
def check(condition, label):
    global checks
    assert condition, label
    checks += 1
cli = main[main.rindex('            case "run":'):]
check('--parallel-write-grant' in cli and 'validateChildGrant(' in cli, 'writer capability validated at real CLI entry')
check(cli.index('validateChildGrant(') < cli.index('runTask(prompt:'), 'grant before model dispatch')
check(cli.index('summary = try await ParallelAgentRuntime.$isolatedWriter') < cli.index('ParallelAgentRuntime.shouldPlan(prompt,'), 'child cannot recursively plan')
check('runConcurrentRouteFanout(fanout, originalPrompt: prompt' in cli, 'owner explicit fan-out uses concurrent process scheduler')
check('!RouteFanout.requestsProviderFanout(prompt)' in cli, 'unresolved explicit roster never becomes preparation research')
check('ParallelAgentRuntime.isolatedWriter != nil || ConcurrentRouteFanoutRuntime.child' in main, 'child bypasses repair/review/workflow wrapper')
check('canonicalWorkspace == grant.workspace' in main and 'executionWorkspace != grant.workspace' in main, 'exact clone retained through native workspace')
check('ParallelAgentRuntime.isolatedWriter == nil, OS1FullAccessContinuation.sessionID == nil, previewDeploymentTarget == nil, TaskWorkflow.permitsSelfUpdate' in main, 'writer cannot automatically stage/install itself')
check('ticket.permissionProfile == "read_only", RouteFanout.isSafeFanoutPayload(objectivePrompt ?? prompt)' in main, 'fanout verified ticket precedes native execution')
check('ParallelAgentRuntime.isolatedWriter != nil || ConcurrentRouteFanoutRuntime.child || OS1FullAccessContinuation' in main, 'worker side effects never implicitly replayed in retry loop')
check('AgentTaskInspectorWindows.shared.toggle' in app and 'openAgentTaskInspectorSessionIDs.contains' in app, 'real session marker uses keyed windows')
check('try await inspectorWindowSelfTest()' in app, 'real production window fixture wired')
update = windows[windows.index('    func update('):windows.index('    func close(')]
check('makeKeyAndOrderFront' not in update and 'activate(' not in update, 'passive telemetry never steals focus')
check('ConcurrentRouteFanoutRuntime.child ? TaskContext.Scope.readOnly' in main, 'all fanout surfaces receive read-only scope')
check('ticket.provider == expected.gatewayPreference, executedSurface == expected' in main, 'exact surface checked before paid dispatch')
check('ParallelAgentRuntime.isolatedWriter == nil, !ConcurrentRouteFanoutRuntime.child, OS1FullAccessContinuation.sessionID == nil, quotaLimit' in main, 'quota never expands child retry budget')
check(main.index('var originalProjectLease: ExclusiveHookLease?') < main.index('var os1SourceLease: ExclusiveHookLease?'), 'generic original writer locks before OS-1 source custody')
check('ParallelAgentRuntime.originalProjectLeaseRoot != identity' in main, 'parent primary never reacquires own lease')
print(f'Parallel execution wiring: {checks} checks PASS; structural checks only, provider calls 0')
