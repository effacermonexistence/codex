# Backend focus: automatic GUI launch removed

## Scope

Automatic routing must not launch or reopen Codex/Claude windows. Explicit
owner-driven native-session reveal remains unchanged. No version bump,
installation, production restart, provider switch or model request was performed.
Pre-existing workspace changes were preserved.

## Change

`CodexDesktopTransport.ensureRunning` now accepts an existing Desktop owner
without GUI calls and rejects a missing owner before dispatch. Previously the
missing-owner branch ran `open -g -b`; background launch flags do not establish
that application-controlled startup handlers cannot activate a window. The
legacy `background_launch` value remains readable but no longer authorizes a
launch. Normal headless app-server execution remains unchanged. If a Desktop
writer conflict reaches this path while Desktop is unavailable, it now reports
unavailability rather than launching UI or replaying the task.

Claude automatic native-record publication already suppresses deep links;
regressions retain this behavior and explicit reveal for both providers.
This closes an identified automatic launch path, not proof of the exact cause
of every previously observed foreground change.

## Verification

- `swift build`: exit 0, all products.
- `OS1ContextTests`, `os1 self-test`, `os1 fleet-self-test`: exit 0.
- OS1App self-test, shell, composer, steering, sidebar-queue, queue-fork,
  parallel: each exit 0.
- Focus structural gate: 722 checks passed.
- Real socket transport regression: exit 0; checks running/missing owner
  behavior with zero launcher invocations, without provider calls.
- Passive foreground observation is recorded separately in
  `artifacts/backend-focus-repair/foreground.json`. It invokes the actual
  transport startup path, not a full provider turn or installed release.
- Full command receipts: `artifacts/backend-focus-repair/tests.json`.

The observer treats an already-frontmost backend as unobservable; OS-1 being
frontmost is observable for backend activation. No foreground manipulation is
used to manufacture a pass.

## Method source

ReAct (https://arxiv.org/abs/2210.03629), abstract inspected: interleave bounded
changes with external feedback. Here the evidence is source inspection,
compiled regression checks and native activation observations, not the paper
or a model's self-assessment.

## Delivery boundary

Source and local tests only. Installation and post-install real-routing
observation belong to OS-1's separately authorized release workflow.
