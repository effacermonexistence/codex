# OS-1 Claude Code two-Mac context

This integration does not try to split Anthropic's hosted Claude model across
personal Macs. Instead, OS-1 runs a local, read-only EXO inference on the
two-node cluster before Claude Code handles each submitted prompt. The draft is
attached to Claude Code as untrusted context; Claude Code retains its normal
control over file edits, shell commands, deployments, and permissions.

`os1 configure-claude-exo` installs a user-scoped Claude Code
`UserPromptSubmit` hook. The OS-1 installer runs that command automatically on
new Macs. Existing Claude settings are backed up with a timestamp before the
hook is added.

The hook uses only the loopback EXO API at `127.0.0.1:52415`. It requires two
distinct connected nodes and creates a `Pipeline`/`MlxRing` instance with a
minimum node count of two. It deletes that exact temporary instance after the
draft completes or fails. There is no single-node fallback.

The hook is fail-open for Claude Code availability. It serializes local draft
inference so concurrent prompts cannot create overlapping EXO instances,
enforces a short local deadline, and opens a one-minute circuit breaker after a
cluster failure. If the local EXO service is not ready, it supplies no draft and
Claude Code continues normally. This changes only optional local context
generation; Claude Code's hosted model inference is not distributed across the
Macs. The hook does not store ZeroTier addresses, EXO peer IDs, model
credentials, or Cloudflare credentials in Claude Code settings.

Use `os1 exo-doctor` to confirm that the local EXO API currently sees the two
required nodes.
