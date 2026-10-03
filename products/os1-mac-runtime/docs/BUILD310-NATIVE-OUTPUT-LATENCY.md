# Build 310 — native output relay

Scope: OS-1-added transport/render latency, not provider inference time. No permission, billing, domain/DNS, Handy, session-reset or final-adoption changes.

Observed baseline (local traces, 2026-10-03): pre-dispatch 2.5–5.5 s; post-native completion 1.5–2.3 s. These wall-clock stages are separate from native inference/tool/owner-wait time. A final status was waiting for remote artifact upload and verification. Public streaming existed but used a 100 ms file poll and rebuilt/replaced all rich transcript history on each text delta.

Changes:
- Observe the private activity directory with filesystem events (atomic inode replacements). Deduplicate, drain at child exit; retain polling only if event registration fails.
- Publish bound native final public text before persisted-record and remote-delivery verification. It stays visibly unverified; the signed ticket, private outbox custody, native record, local verifiers and remote REVAS gate are unchanged.
- Cache immutable transcript history by the complete render input, session, expansion and waiting state. Re-render/replace only the live suffix. Final/history/source disclosures still use the existing rich renderer.
- Consume Claude public results once by bound session and result count; a retained final must not mask a later steered turn. Wrong-session/error payloads do not enter the public final relay.
- Ordinary deep code explanations no longer silently add a paid Claude reviewer. Explicit cross-model review remains available; historical measured review cases remain historical evidence, not universal necessity.
- Parallelize independent gateway registration and capability probes, retaining both checks.
- Add local source/receipt/applied/AppKit-draw timestamps with no text, prompt, credentials or commands in the diagnostic log. Receipt time is not provider-internal generation time.

Deterministic validation: 30 atomic Unicode/public-output updates; actual child writes output and remains alive for 1.5 s; observer receives before exit. Corruption/oversize rejection, final-read races and duplicate prevention. 100-message transcript/40 deltas preserves exact display content/role/pending label, builds history once, invalidates on expansion and completion. Explicit/absent/negated review tests.

Development measurements: relay maximum 0.81 ms; warm live suffix maximum 1.54 ms on this Mac. These are local fixtures, not a universal latency guarantee. Installed/native/UI measurements belong to the separate execution receipt. Policy freshness and signed routing still require their actual checks; their network/Notes latency is not claimed eliminated.

Repair method: inspected ReAct (https://arxiv.org/abs/2210.03629) and intrinsic-self-correction limitations (https://arxiv.org/abs/2310.01798), abstract scope. Used observed traces, bounded local changes, deterministic verification and runtime observation rather than an extra model call to rewrite presentation.
