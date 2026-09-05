# OS-1 Codex and Claude Code two-Mac context

This integration does not try to split Anthropic's hosted Claude model across
personal Macs. Instead, OS-1 runs a local, read-only EXO inference on the
two-node cluster before Codex or Claude Code handles each submitted prompt. The
draft is attached as untrusted context; each hosted agent retains its normal
control over file edits, shell commands, deployments, and permissions.

`os1 configure-claude-exo` and `os1 configure-codex-exo` install user-scoped
`UserPromptSubmit` hooks. The OS-1 installer runs both commands automatically
on new Macs. Existing Claude and Codex hook settings are backed
up with a timestamp before their OS-1 entry is added. Codex requires its normal
one-time review and trust step for a non-managed hook.

The hook uses only the loopback EXO API at `127.0.0.1:52415`. It requires two
distinct connected nodes and creates a `Pipeline`/`MlxRing` instance with a
minimum node count of two. A successful small hook instance stays warm for the
next prompt. A failed or partial placement is removed immediately so stale
runners cannot accumulate. The production profile caps each draft at 256
tokens and gives EXO 60 seconds, with a separate 65-second host hook limit that
preserves cleanup headroom. There is no single-node fallback.

The hook is fail-open for Codex and Claude Code availability. It serializes local draft
inference so concurrent prompts cannot create overlapping EXO instances,
enforces a short local deadline, and opens a one-minute circuit breaker after a
cluster failure. If the local EXO service is not ready, it supplies no draft and
the hosted agent continues normally. This changes only optional local context
generation; Codex and Claude Code hosted inference is not distributed across
the Macs. The hook does not store ZeroTier addresses, EXO peer IDs, model
credentials, or Cloudflare credentials in Claude Code settings.

Use `os1 exo-doctor` to confirm that the local EXO API currently sees the two
required nodes.
