# Build394 — actual-constructor residency recovery

Build393 passed source/release/package checks and installed with sessions and queues preserved, but its first installed `rcc-warmup` terminated with SIGTRAP before a provider request. The crash report identifies `LocalRouterBridge.rccRuntimeConfiguration` and a nil forced unwrap. Runtime adoption of393 therefore failed; build/package/CI success is not product success.

The root cause was a new assumption that `agents.defaults.models` exists. It appears in the static template, but the **actual** `OpenClawAgentController.configBytes` constructor intentionally omits that optional map. No quality comparison or native test was sent through393. The prior verified392 binary is the recovery floor; current sessions, queues and memory are not rolled back.

Move scoped finite residency handling into a pure tested helper. Update only the existing private Qwen provider row and, only if present, the same model's agent override. Missing optional maps are valid and remain absent. Malformed present containers throw a bounded error rather than trapping, inventing a shape or touching unrelated providers/tools/global Ollama settings. Exercise the actual constructor and missing/valid/malformed override cases in the normal OS1Context regression suite.

Retain393's compact planner, selected-provider preparation, phase diagnostics and bounded read-pool repairs unchanged. Its failed warmup and all prior local-model/grammar tests remain preserved.394 requires both architectures, release/package checks, verified installation, an actual installed zero-provider-call warmup, then native/UI parallel and separately frozen quality comparisons before an operational success claim.

Taxonomy: existing unsupported-state transformation / execution enforcement failure. Template state was incorrectly promoted into actual producer configuration. No new foundational primitive and no model/auth/permission workaround.
