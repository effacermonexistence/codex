# QM/GAR retrieval boundary repair

## Objective and incident

On installed OS1 0.9.40/build91, session
`AA28AC13-84ED-49F8-B482-A279FEFD1295` connected R2 successfully, then
`거기서 QM이랑 GAR 자료 가져와봐` failed before any backend call. The saved
message timestamps put the failure 42.751 seconds after submission.
The query inherited R2 but did not recognize the paired dictation alias GAR.
It consequently searched the generic mirror instead of the verified OPT/QMGR
research repository and separate experiment. Generic term extraction also
retained the source pronoun `거기서` as a required topic.

## Five-view acceptance map

| View | Observed divergence | Required check |
| --- | --- | --- |
| Intent | QM/GAR becomes generic retrieval | Bounded paired alias selects QMGR; original request unchanged |
| Source/context | R2 source preserved but research identity lost | Same 8 OPT original + 8 experimental sources; follow-up retains snapshot |
| Execution | Generic search fails after 42.751s | Direct verified retrieval, zero model calls for acquisition |
| Verification | Honest missing-source error, but wrong selection | Retain hash/size/relevance gates; no irrelevant fallback |
| Cost/latency | Unnecessary repository traversal | Record measured before/after time; no model-based query rewriting |
| Safety/UX | Ambiguous acronym globally replacing topics would misroute | GAR alone, identifiers, unrelated metrics, negation and source switches stay excluded |

## Minimal architecture

Original request + explicit recent source -> existing R2 source resolver ->
shared research-subject parser -> verified R2 research readback -> immutable
source snapshot -> OS1 answer / subsequent backend source context.

Recognize GAR only as a bounded acronym directly paired with QM/QoM/QAAM or
the expanded quantum-mechanics name through a short conjunction/separator.
Do not globally replace GAR, weaken relevance, use unrestricted fuzzy matching,
change routing tiers, or call a model merely to normalize an acronym. Share
subject recognition with output checks so the same intent does not diverge
between acquisition and presentation. Remove known source-pronoun grammar
from generic query terms without dropping real required topics. Add bounded
selection diagnostics containing hashes and classifications, not source text.

## Research used and limits

[Ragas](https://arxiv.org/abs/2309.15217) separates retrieval-context quality
from faithful generation; this repair likewise tests source selection apart
from a successful backend response. [Self-RAG](https://arxiv.org/abs/2310.11511)
motivates retaining relevance checks instead of passing unrelated retrieved
files onward. This is a deterministic engineering repair, not implementation
or training of either paper's model. CoT prompts cannot supply a missing source.

## Tests, rollout and rollback

Reproduce the saved request on build91; test paired aliases, Unicode NFC/NFD,
punctuation/case, standalone/embedded negative controls, inherited source and
source switches. Recheck generic all-topic/snippet gates and output contract.
Build and sign universal build92, preserve build91 app/CLI and all current
conversation data, install only when idle, then replay the exact request and
verify all 16 source identities, byte fingerprints and context continuation.
No provider authorization, TCC, private router, Fleet assignment, other Mac,
Instagram production or public download pointer changes. Rollback restores
only the previous app/CLI while idle, never old conversation data.

## Recorded validation

- Unmodified installed build91 reproduced the exact error in 43,252 ms using
  its bundled production configuration and the two-message R2 context.
- The deterministic fixture covers eight paired aliases, each in NFC and NFD,
  eight negative controls, six established spellings, source-pronoun removal,
  and the shared scientific output boundary, plus existing all-topic tests.
- The opt-in `verify-gar-retrieval.mjs` stores private evidence, verifies the
  exact request/snapshot/source identities and leaves OS1 conversations intact.
  `--baseline` expects this incident; `--retrieval-only` expects verified local
  acquisition; `--live` adds one bounded read-only continuation.
- Configuration must come from the installed app's `Contents/Resources/config.json`.
  The obsolete application-support configuration was rejected before execution
  in an initial harness setup attempt; it was not modified or used as a fallback.

Installed-build acquisition, follow-up and release audit results are recorded
in the private repair receipt, not inferred from unit tests or the baseline.
