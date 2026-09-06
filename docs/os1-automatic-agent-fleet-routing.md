# OS-1 automatic Codex and Claude fleet routing

## Objective and acceptance

Every trusted Codex or Claude Code `UserPromptSubmit` hook should submit an
immutable Git workspace task to the existing OS-1 Fleet objective. The selected
Pro or Air agent executes the task, and the foreground agent receives a job id
and an exact command that waits for the signed result. Success requires:

- the same `os1-fleet-objective-v1` selects the executor from fresh CPU, memory,
  queue, capability, and availability heartbeats;
- the foreground hook returns quickly after enqueue instead of running a second
  provider synchronously;
- the selected background agent actually claims and executes the task;
- the foreground agent waits for the signed result before editing the same task;
- executor-created Codex and Claude sessions never recursively enqueue jobs;
- dirty, non-Git, or unpublished work fails open to normal local execution;
- a node is not considered verified merely because a provider executable is
  present; installed-node acceptance includes a real no-change provider run;
- the existing hook command text remains unchanged so an already-reviewed Codex
  hook does not acquire a new trust hash.

## Dataflow

`Codex/Claude prompt -> existing UserPromptSubmit command -> signed Fleet submit
-> objective placement -> selected Pro/Air agent -> Codex/Claude executor ->
signed result -> foreground fleet-wait -> verification/integration`

## Boundary and invariants

The broken boundary is between the installed prompt hook and Fleet submission:
the hook currently runs an optional EXO draft but never calls the working Fleet
objective. Fleet submission and execution already pass independently.

The hook must not copy credentials, uncommitted files, or authentication caches.
It only sends the prompt plus GitHub repository, committed revision, and subpath.
It must not claim that hosted model inference, arbitrary macOS processes, RAM, or
GPU memory are transparently pooled. EXO remains the explicit distributed local
inference profile.

## Minimal intervention

1. Split Fleet submission from Fleet result waiting and add `fleet-wait`.
2. Reuse the existing `exo-codex-hook` and `exo-claude-hook` command entrypoints,
   but make them enqueue the corresponding Fleet profile first.
3. Return model-visible context that requires the foreground agent to wait for
   and adopt/verify the selected executor result rather than duplicate it.
4. Detect executor checkout paths and fail open there to prevent recursion.
5. Preserve the prior EXO draft as a fallback only when safe immutable Fleet
   submission is unavailable.
6. Let the background agent wait for the existing per-device `gh` keychain
   credential during heavy load; never copy that token into its service file.
7. Read the ZeroTier address through the native interface API so heartbeat
   liveness does not depend on spawning `ifconfig` under host load.
8. Run the user-requested Fleet executor as a standard LaunchAgent so macOS
   does not indefinitely defer it as inefficient background work under load.

## Alternatives and rollback

A synchronous hook that waits for the full remote task was rejected because it
can exceed host hook deadlines. Replacing `codex` or `claude` executables with
wrappers was rejected because it risks recursion and breaks native sessions.

Rollback is the prior runtime binary plus its unchanged hook files. The server
Fleet schema and objective need no migration for this client-only bridge.
