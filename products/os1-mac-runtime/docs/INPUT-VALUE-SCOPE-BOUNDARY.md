# Input-value preservation is not a filesystem-wide ban

`ScopeResolution` previously treated a generic negative phrase applied to an
input list as a global file-write prohibition. An explicit file implementation
request therefore lost writer catalog rows even though its authenticated owner
scope permitted workspace writes.

The repair affects only the scope-analysis view. A closed input-value
immutability clause can be set aside for filesystem-global-negation detection
only beside one independently parsed, closed, relative-file edit. Supported
English/Korean value-type clauses remain verbatim prohibitions, and the worker
still receives the original request. This does not create write authority from
data labels, a code-output request, or an unknown target.

Explicit global read-only and file bans, input-file/path restrictions, mixed or
conditional clauses, root/traversal paths, ambiguous rename instructions, and
requests without an affirmative file edit keep the conservative behavior.
`requireReadOnly`, owner capability ceilings, native permissions and executable
admission are unchanged.

Pure regressions retain the existing scope/catalog suite and add English and
Korean value-boundary cases, normalization, adversarial controls, the natural
writer request shape, and the actual A3 code-output-only control. The full
catalog builder must emit writer rows/class without a registered contract for
the authorized writer, while an explicit hard read-only flag still emits only
read-only rows. No native/model call is required by these fixtures.

This is a classification repair, not proof that a native backend enforces its
ticket or that a workspace writer respects a one-file instruction. Those are
separate executed-path gates. It does not replay any previous task.
