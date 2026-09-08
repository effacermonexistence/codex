# Native Fleet acceptance

`node scripts/verify-native-fleet.mjs --self-test` runs deterministic verifier fixtures with no model calls.

On an already configured Mac, explicitly run:

```
node scripts/verify-native-fleet.mjs --run --role pro --revision EXACT_PUBLISHED_COMMIT
```

Use `air` on the Air. The role is checked against the current device's registered Fleet identity. This test makes two actual native model requests (one Codex, one Claude) using existing local OAuth and installed hooks. Their executor requests have no preferred device. A new private temporary checkout and local evidence are retained; installed runtimes, hooks, models, keys and user files are unchanged. No transcript or credential is uploaded by this script.

The final `acceptance.json` is PASS only when both native clients finish, each has exactly one matching fresh automatic hook receipt and submission intent, the correct revision/provider, a verified read-only adopted result with matching SHA-256 and source values, and an unchanged fixture. Timeout is not permission to rerun a remote job. Preserve the recorded job and reconcile it first. Run this script at most once per role for one acceptance run; do not automatically retry model calls.

If only the verifier was defective, `--verify-existing /absolute/private/temp/os1-native-fleet-proof-SUFFIX` checks its preserved terminal native events and same signed job results without calling either model again. It creates a separate `acceptance-reverified.json`, preserves the failed original, and checks the installed binary has not changed. It cannot turn a timeout, extra attempt, permission mismatch, changed source or missing native output into a pass.

This proves a finite clean-revision, standalone native CLI path. It does not prove desktop mouse/voice ingress, followup context transport, dirty/non-Git workspace portability, every future prompt, task speedup, or transparent CPU/GPU/RAM pooling. Both Macs need not be selected by any particular pair of small tasks: the scheduler chooses from their current resources, rather than forcing a 50/50 split.

References: [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Claude Code hooks](https://code.claude.com/docs/en/hooks). Hook context is a handoff mechanism, not exclusive native-process ownership.
