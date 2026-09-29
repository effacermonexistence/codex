# Build 269 — quality floor (reference models)

Owner objective, 2026-09-29: using OS-1 must feel like using Claude Code or
Codex directly — no problems — and the result quality must match the newest
top model run at its strongest.

## What changes

- **Reference models.** Every model route OS-1 takes is a reference route:
  Codex `gpt-6-astra` (listed first by Codex, "Frontier intelligence for the
  most demanding work") and Claude Code `fable` (claude-fable-5-1, "Most
  capable for your hardest and longest-running work"). Work runs at maximum
  reasoning; a question runs at the provider's own default or above; a
  request for maximum (e.g. "최대 리즈닝", "제일 좋은 모델로") gets maximum.
  Ultra runs only when asked for ("울트라로 …"). Older or smaller models are no
  longer chosen to save time or tokens. Local exact arithmetic stays local.
- **No silent downgrade.** A retry goes to the other reference, never below an
  earlier attempt of the same model. When no reference route is available the
  task is refused ("no eligible route") instead of downgraded.
- **Client:** `Config/production.json` registers `cl_fable_xhigh` and
  `cl_fable_max`, so Claude Code's Fable at those levels is reported to the
  signed router. `TaskWorkflow.modelTier` ranks Fable with Astra as the top
  tier (it was ranked below Sonnet), so workflow stages keep it.

The routing policy itself is the private RCC policy v45 (server side); this
repository carries only the client catalog and the route-core pin.

## Rollout order

gateway (`os1-route-core`, validates actions against `production.json`) →
client build 269 → policy worker v45 (v44 kept for in-flight routes) →
policy bundle → route-core pin. Rolling back the route-core pin to the v44
bundle restores the previous routing; the client change is harmless under v44.
