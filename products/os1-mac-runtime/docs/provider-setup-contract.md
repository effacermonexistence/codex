# OS-1 provider setup — bounded implementation contract

Goal: make initial Codex/Claude connection simple inside the existing OS-1 app.
Source of truth: installed build338 source ab8a818, existing native account commands.
Target: existing accounts panel, welcome entry, native discovery and login reuse.
Allowed: provider discovery, status parsing, panel, focused fixtures, packaging/install receipt.
Forbidden: RCC route/executor semantics, model policy, session/queue rewrites, Handy, credentials, billing, competitor proprietary source.
Expected: detect installed CLIs; reuse valid native auth; missing installation opens the official setup guide; confirmed signed-out opens official provider flow; unverified status never starts OAuth. One connected agent is sufficient. GitHub is not a local-use prerequisite.
Validation: deterministic native-output fixtures, injected UI runner, compile, installed read-only discovery and actual account UI.
Stop: all in-scope states verified; any per-device authorization remains a user-only step.
Output receipt: build/source identity + install preservation receipt + native metadata; no secret data.

## Independently implemented references
- Conductor: https://www.conductor.build/docs/installation and /docs/reference/harnesses
- Superset: https://docs.superset.sh/install
- Emdash: https://emdash.com/docs/installation
- Claude status contract: https://code.claude.com/docs/en/cli-reference
- External feedback rather than generated self-certainty: https://arxiv.org/abs/2310.01798

The app does not copy auth caches or keys, perform inference to check login, bundle competitor executables, or silently rerun login after a failed status probe. Native sign-in is not proof that every model/effort is executable.
