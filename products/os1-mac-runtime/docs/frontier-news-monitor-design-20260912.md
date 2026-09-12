# OS1 frontier usage/news monitor design

## Objective and scope

OS1 should surface fresh, actionable changes from frontier providers—especially
OpenAI and Anthropic—without routing the notice through Codex or Claude, adding
the notice to a user's task context, or inventing a quota/reset deadline. The
monitor is informational: it never changes provider selection, credentials,
billing, or a running task. It reads public, first-party status endpoints and
persists only bounded metadata and links.

## Evidence-first boundary review

* Intent/completion: a new provider incident or usage-limit announcement must
  appear once in OS1 with provider, title, source URL, publication time, and a
  conservative signal type. A failed fetch is a visible `unavailable` state.
* Context/provenance: monitor items live in a separate state file and SwiftUI
  panel; they are not `ChatMessage`s and are never included in `sessionHandoff`.
* Runtime/capabilities: the service uses `URLSession` with a short timeout and
  official HTTPS JSON endpoints only. No provider token, CLI credential, or
  dashboard cookie is read.
* Output/verification: each item has a stable provider ID when supplied by the
  source, otherwise a SHA-256 fingerprint of provider/title/time/body. ETag and
  Last-Modified are retained; a 304 is a successful no-change poll.
* Tokens/cost/latency: polling performs no model call and sends no prompt. It
  is capped at one request per source per interval (default five minutes), with
  a bounded response body and a seven-day display window.
* Security/privacy/UX: only public source text is retained, HTML is not
  rendered as executable content, URLs are allow-listed by source, and new
  high-value notices are visually distinct from provider execution status.

## Dataflow

```text
official status JSON -> bounded parser -> classifier -> stable dedupe key
                                      |                  |
                                      +-> persisted state +-> OS1 monitor panel
```

Convergence is the explicit acceptance checklist: parser tests, classification
tests, stable dedupe, 304 handling, persistence round-trip, source allow-list,
and UI compilation all pass. Divergence is any duplicate item, a reset date
invented from missing text, an item entering a task transcript, a non-official
URL, or a network error reported as fresh data. A single passing source does not
compensate for another source's failed verification.

## Source policy

The initial sources are OpenAI's official newsroom RSS feed plus the public
Statuspage v2 incident feeds for OpenAI, Anthropic/Claude, Google Cloud, and
Cohere (filtered to AI-related incident titles). They are operational/news signals,
not proof of account-specific quota state. A provider's account quota remains
unknown unless OS1 receives a separately authenticated, user-authorized usage
response. The classifier therefore labels `reset` only when the source text
explicitly contains reset/quota/usage-limit language and leaves `resetAt` nil
unless an ISO timestamp is present in that same source item. Anthropic's
newsroom does not expose a stable public RSS endpoint at implementation time,
so only its verified status feed is enabled; the source list is extensible
without changing the execution path.

## Rollback

Deleting the monitor state file disables history but does not touch sessions,
provider links, credentials, or task data. Removing the monitor task from the
root view returns the pre-feature behavior. The parser and store are isolated
in `OS1Context`, so the existing execution path can be rebuilt independently.
