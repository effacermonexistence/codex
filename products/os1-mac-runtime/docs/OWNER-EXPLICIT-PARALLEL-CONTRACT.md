# Owner-explicit source partition (bounded read-only grammar)

`deriveExplicitParallelOwnerContract(request, {scope, maxNodes: 4})` is a pure
source extractor in `local-plan-proposal.mjs`. Core supplies its current
effective scope. This helper never classifies the owner's filesystem authority,
selects a model/effort, grants execution, grades an answer, or repairs model
output. Existing V2/P1 proposal decoding and host schema remain unchanged.

The supported owner form has an unquoted imperative common prefix declaring
independent parallel work and naming every unit, followed by two to four
unindented one-letter or one-digit labelled sections (`A —`, `X:`, `2)`, etc.).
Every explicit prefix enumeration must match all section labels in source
order. Each section has a nonempty body. The returned frozen value contains the
exact prefix, exact sections including headers/whitespace, UTF-16 and UTF-8
source spans, original request SHA, stable ordinal IDs and an ordered-collection
descriptor. Concatenating prefix and sections reconstructs the original request
byte-for-byte. No source strings are rewritten or normalized in the result.

Unknown forms return `null`: absent/negated parallel intent, dependent or serial
prefix, unresolved prefix approval/authority conditions, recognized cross-unit
completion/result dependencies, missing/duplicate/conflicting labels, quoted/reporting/data prefix,
fenced or blockquoted input, an ambiguous/mixed filesystem mutation, more than
the host's two-to-four node bound, or any effective scope other than read-only.
These conservative gates are not a universal natural-language parser. Returning
null preserves the existing exact whole-request route, not permission to invent
another partition. A prose claim of independence is supplied intent, not proof
that arbitrary hidden dependencies cannot exist.

Core must derive this contract from its actual current owner request, execute
ALL supported owner units with original materials/constraints, and collect raw
results in owner order once. A local model may suggest exact supported tuple
hints but cannot remove, merge, duplicate, rewrite, reorder or grant an owner
unit. Omitted/ambiguous/unmatched hints remain null; current catalog, quota,
scope, resource and ticket checks remain Core's authority. The original full
owner request stays bound to every child: source partition identity is not
semantic extraction of every constraint or an excuse to drop the original
objective. It does not require an extra integration model or finalizer.

The observed developer failure had a single proposed node despite an explicit
two-unit owner instruction; the actual final output did contain both requested
parts. This repair targets plan/topology coverage, not a proven lost answer.
Derived cross-domain/negative tests are development fixtures, not new natural
failures, held-out parity evidence, or proof of actual parallel execution.

The first source candidate's independent review exposed approval conditions and
known-label result dependencies that the initial extraction had not rejected.
That candidate is preserved as unapproved history. The follow-up refuses those
recognized forms instead of minting an unconditional independent graph. It does
not claim to decide arbitrary natural-language conditions or dependencies.
