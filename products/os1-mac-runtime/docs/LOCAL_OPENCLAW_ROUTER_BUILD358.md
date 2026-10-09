# OS-1 local OpenClaw interpretation and planning — build 358

## Status and claim boundary

- Documented on **2026-10-09**; integration source is the OS-1 task-quality checkout.
- OpenClaw and the pinned local model have been installed and their identities checked.
- Source integration and deterministic tests exist. **Build 358 installation and live UI adoption remain pending at this document's capture point.** A compiled CLI or staged package does not establish an installed application.
- This integration replaces the production parallel **candidate planner** call with a local producer and adds one bounded owner-request interpretation pass. It does not replace the signed RCC execution router.
- It is not a consumer ChatGPT connection, a zero-drift guarantee, or measured equivalence to a frontier model's maximum reasoning output.
- Local inference consumes local compute, memory, energy and time. It does not spend a hosted model subscription allowance. Subsequent native execution still spends its actual provider allowance.

## Architecture

```text
Exact owner request + relevant bounded context + policy identity
                         |
                         v
Host deterministic fast paths
  - exact local response-liveness control: no LLM
  - explicit provider/payload fan-out: preserve named targets
                         |
                         v
One device-local interpretation candidate
  OpenClaw infer model run --local
    -> native loopback Ollama -> pinned Qwen model
  no agent turn / no tool execution / no hosted fallback
                         |
                         v
Closed JSON + hash + source-span admission
  accepted candidate / held uncertainty / rejected document
  syntactic admission is not semantic proof
                         |
                         v
OS-1 host retains original objective, prohibitions and authority
  optional local preparation DAG candidate
    -> existing draft/DAG/path/isolation/custody gates
                         |
                         v
Existing signed private RCC router
  actual model inventory + quality admission + quota observations
  -> signed provider / model / effort / execution ticket
                         |
                         v
Existing native Codex or Claude executor
  -> observed execution -> REVAS task/result adoption -> user
```

OpenClaw is the local **candidate-producing component**, not an unrestricted supervisor over OS-1 or the native backends. The model cannot grant permissions, sign profiles, assign provider credentials, or declare quality parity.

Dynamic routing and heuristic inference are separate dimensions: the host dynamically evaluates changing runtime facts, while any LLM interpretation remains fallible. Moving interpretation to a local model does not make its semantic inference exact.

## Pinned producer and local isolation

| Object | Checked identity / behavior |
|---|---|
| OpenClaw | `2026.9.9`, reported CLI `OpenClaw 2026.9.9 (bcfc888)` |
| Local model | `qwen3.5:4b` |
| Model SHA-256 | `d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04` |
| Model bytes | `3,324,173,934` bytes, approximately 3.324 GB decimal |
| Local machine observed | Apple M5, `17,179,869,184` bytes memory (16 GiB) |
| Ollama | Existing local installation/server reused; endpoint `http://127.0.0.1:11434` |
| Node | Existing `v24.20.0` runtime reused |
| OpenClaw entry SHA-256 | `aa8606ca0d62ff133ef5b7bd2323ec8ff3f8eb384404399cd5e742918d63b0a1` |
| Base config SHA-256 | `f437d3aa45b62ebf80eccc3b831a36ddb70b3154c6ac684d932d46a18b8b8f1b` |

The bridge uses an isolated private HOME/state/config/workspace and `env -i`; it does not inherit OpenAI/Anthropic keys, OAuth caches, native session IDs, ambient OpenClaw settings, or shell customization. The only configured model provider is local Ollama. The configured `ollama-local` string is a non-secret local placeholder, not an account credential.

Tools are denied with `tools.deny = ["*"]`, browser control is disabled, and no OpenClaw Gateway, channels or hosted fallback are started. The production bridge uses the official lean **`infer model run --local`** path rather than an agent execution path that bootstraps tools/workspaces/MCP.

The base model configuration uses bounded context/output settings (`num_ctx: 8192`, `num_predict: 512`, temperature zero, thinking off). These are actual configuration choices, not a claim that temperature zero removes semantic drift. A per-request temporary config supplies native Ollama JSON-format constraints without rewriting the pinned base config.

**Handy remains entirely outside this integration.** Its files, processes, audio, IPC, settings, LaunchAgents and recovery state are not accessed or changed.

## Policy delivery and authority

The local producer receives at most **4,000 characters** from the current host-loaded RCC routing/projection material. Its receipt records the projection hash and actual prompt hash. This is a bounded projection, **not** all 1.98 MB of the owner source and not a modification of model weights.

The authority original remains separately preserved. Host-side source confinement, exact request binding, signed model routing, execution verification and REVAS adoption continue to apply. A projection or a model's self-description is not proof that every source rule was semantically enforced.

The local request input is bound to exact raw request bytes, context bytes and policy identity. A request/context/policy change invalidates the host fingerprint. Managed native children do not recursively interpret or inherit a parent's interpretation as a new authority statement.

## Candidate contract

The interpretation document is a closed schema with these fields only:

```json
{
  "schema": 1,
  "request_sha256": "host-computed exact raw request SHA-256",
  "context_sha256": "host-computed exact context SHA-256",
  "intent": "answer_only | inspect | execute | mixed | uncertain",
  "needs_actions": "yes | no | unknown",
  "required_capabilities": ["answer | read | write | execute | network"],
  "evidence_spans": [
    {"start_utf8": 0, "end_utf8": 1, "supports": "intent | capability"}
  ],
  "ambiguities": []
}
```

The pipe-separated strings above document enums; a producer must select actual enum values. There is no `tasks` field in this interpretation contract. Preparation decomposition uses the existing separate bounded plan contract.

`LocalTaskInterpretation.admit` rejects extra/missing fields, unknown enums, duplicate JSON keys (including escaped aliases), malformed/fenced documents, output over 16 KiB, wrong request/context hashes, invalid UTF-8-boundary spans, invalid ambiguity lists, and inconsistent intent/action/capability combinations. Uncertainty is held rather than upgraded into execution authority.

`candidate_accepted` means **closed, hash-bound and internally consistent**, not “the model understood the request correctly.” The host must retain all owner authority and completion constraints. Provider, model, effort, permissions, workspace grants, quota facts and parity claims cannot be supplied through this document.

Per-request Ollama JSON-schema generation constrains syntax. It cannot distinguish a well-formed wrong interpretation from a well-formed correct interpretation. This distinction is demonstrated by the development observations below.

## Measured development observations — preserve failures

Evidence directory:

`/Users/LUA/.os1/recovery/openclaw-local-router-20261009/evidence`

1. The first recorded translation interpretation selected `answer_only/no` but capability `read`. The gate rejected it as `inconsistent_candidate`.
   - Captured report: `INTERPRET_TRANSLATE.json`.
   - Raw candidate/admission receipt: `/Users/LUA/.os1/local-router/receipts/89e5d72f-cd9e-49b7-be72-73ca7366d1e4.json`.
2. A subsequent response emitted a Markdown JSON fence. It was rejected as `invalid_json`; the rejected raw response was retained rather than converted into an accepted document.
   - Captured report: `INTERPRET_TRANSLATE_V2.json`.
   - Receipt: `/Users/LUA/.os1/local-router/receipts/8b503e64-6857-437e-9d0b-050905472fc8.json`.
3. Native per-request JSON-schema constraints then produced an admitted translation candidate with `answer_only/no/[answer]`.
   - Captured report: `INTERPRET_TRANSLATE_SCHEMA.json`.
   - This is one development observation, not held-out accuracy or output-quality proof.
4. At the document capture point, `SMALL_LOCAL_DEV_RESULTS.json` records the following additional local development rows:

| Case | Development expectation | Actual candidate | Schema admission | Measured elapsed seconds | Expectation met |
|---|---|---|---|---:|---|
| inspect | `inspect` | `answer_only` | `candidate_accepted` | 9.810 | no |
| write | `execute` | `answer_only` | `candidate_accepted` | 9.150 | no |
| uncertain | `uncertain` | `answer_only` | `candidate_accepted` | 9.090 | no |

These three inspected development cases **failed their semantic expectations despite successful schema admission**. Do not hide them, call them parity results, or treat zero hosted-token use as completion. Their receipts are individually recorded in that result file. If later iterations run new candidates, preserve these originals and label the new configuration/run separately rather than overwriting the historical result.

## Deterministic validation results

- Pure interpretation protocol fixtures: **78 checks passed**; no model calls. They cover schema, hashing, UTF-8 spans, uncertainty, duplicate keys and authority separation, not model classification accuracy.
- Host integration fixtures: **11 checks passed**; no model calls. `CLI_SELFTEST.log` records the result and the exact authority-separation scope.
- Existing native and parallel fixtures also retain their own logged results. Their pass does not prove this local model's semantics or an installed build 358.
- The setup verification receipt is `SETUP_VERIFY_FINAL.json`. Its scope is pinned package/config/model identity; it explicitly makes no inference or quality claim.

## Fast paths, fallback and falsifiers

- Exact response-liveness controls skip the local LLM and hosted calls entirely. They are labelled local controls, never ChatGPT responses.
- Explicit provider fan-out retains owner-selected targets; neither local interpretation nor missing ChatGPT transport can silently substitute another provider.
- A malformed/unavailable/uncertain local candidate preserves the original execution objective and valid baseline. It does not trigger a paid model call merely to repair local JSON formatting or optional presentation.
- The original native primary may still execute authorized work through existing RCC routing. “No paid planner retry” does not mean the requested final work is free.
- An invalid, overlapping or cyclic plan fails the existing plan/path/isolation gate. No generated ownership list grants authority by itself.
- A wrong local `answer_only` classification must not remove an explicitly requested action, stage, provider target, or necessary source inspection. Host tests must check this independently of the local model.
- If a schema-accepted output misclassifies a write/inspection request, it falsifies semantic correctness, not the closed-schema contract. The measured development failures are examples of exactly this boundary.
- If installation/source/config/model identity differs, stop local candidate production and preserve the original route; do not silently select another local or hosted model.
- A valid explicit owner change must be allowed. This gate must not create refusal/clarification paralysis or prevent a legitimate provider/criterion switch.

## Files and recovery contract

Implementation surfaces:

- `Sources/OS1/LocalRouterBridge.swift`: isolated lean local producer and raw-first receipts.
- `Sources/OS1Context/LocalTaskInterpretation.swift`: pure closed candidate admission.
- `Sources/OS1/main.swift`: one owner interpretation binding before workflow/planning decisions; existing signed router remains authoritative.
- `Sources/OS1/ParallelAgentCoordinator.swift`: production preparation candidate producer changed to local OpenClaw; existing plan/worker/adoption gates retained.
- `Tests/OS1ContextTests/LocalTaskInterpretationFixture.swift`: deterministic protocol fixtures.
- `Resources/local-router-config.template.json`: portable pinned local-only template.
- Repository `scripts/setup-os1-openclaw-local-router.py`: checked setup/verification/recovery helper.

Recovery preserves the scoped source, setup script, config template, package identity/integrity, activation manifest and exact public model digest. The model can be refetched from its public distribution on a new device and **must match the recorded digest** before enabling local inference. A mutable tag alone is insufficient.

The setup helper defaults to inspection. Explicit application is limited to dedicated private installation/state roots; it validates the selected already-installed local model, pinned OpenClaw archive integrity, config, and CLI identity. It does not automatically pull a model, run inference, start a Gateway, import OAuth/API-key caches, or change global native-agent settings.

Application packaging, installation, live runtime and remote recovery verification require separate actual receipts. This document does not manufacture them. Until the installer and runtime evidence are recorded, **build 358 remains pending, not complete**.

## Remaining independent requirement

Ordinary ChatGPT subscription execution is still a separate adapter. Local OpenClaw/Ollama interpretation is not that adapter, does not create a consumer subscription endpoint, and cannot turn restricted-app control into an authorized connection. This build must not relabel a Codex app-server turn, local inference result, or handoff as an automatically executed ChatGPT service response.

The current demonstrated result is a scoped local producer with preserved rejection/semantic-failure evidence and unchanged host/signed-router authority. Universal routing accuracy, zero drift, hosted quota elimination, frontier-quality parity, live installation and consumer ChatGPT execution require their own evidence and are not claimed here.

## Subsequent executed repair receipt

- Preserved the initial rejected candidates and the failed large-TaskSpec/anyOf experiments. No row was deleted or relabelled as success.
- Narrowed model generation to one closed `intent` field. Request/context/policy hashes and source spans are host-bound facts; coarse capability labels are definition-derived and never execution grants.
- Host answer-only suppression additionally requires the existing read-only, named-path, shell and bounded-conversation checks. A wrong local label cannot convert an explicit file/action request into a no-tool route.
- Three complete explicit English cases subsequently classified text/inspect/execute correctly in actual local calls. Their runtime receipts are in `SMALL_LOCAL_COMPLETE_TASK_RESULTS.json`. This is an internal development result, not held-out or universal accuracy proof.
- An underspecified missing-referent request was held as uncertain. Earlier short Korean requests still exhibited semantic failure/under-adoption; those records remain preserved.
- Additional complete Korean cases and release/install verification are pending; final external receipts govern those states.

### Final scoped activation limits

The three complete Korean development requests did **not** all pass: external inspection passed, translation was held uncertain, and file creation was mislabeled answer-only. These are retained in `SMALL_LOCAL_KOREAN_COMPLETE_RESULTS.json`. The local classifier is consequently **not qualified to replace host scope/model authority**. Host action/named-path checks veto answer-only use for file/command requests; uncertain and rejected candidates preserve the original execution. This installation must not be reported as error-free semantic routing.

The production generator now returns a single intent enum. The host constructs immutable source hashes and coarse definition-derived metadata, then runs the existing closed gate. The larger earlier generation experiments are still evidence, not erased history.
