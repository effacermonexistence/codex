# Conceptual origin of the Orthogonal Projection Term

> **Status:** author-confirmed conceptual provenance. This document explains
> why the hypothesis was formulated. It is not empirical evidence that the
> hypothesis is physically true.

## 1. Perceptual trigger

The initial observation occurred in a fully immersive Vision Pro environment.
The rendered scene made nearby space appear open or empty, while an unrendered
physical wall still imposed a hard movement boundary.

That is ordinary mixed-reality behavior, not anomalous physics. Its value was
conceptual: the representation available to an observer can omit a boundary
that remains active in the larger system governing possible motion.

This produced the question behind the project:

> Can a visible or modeled field omit a constraint-bearing structure whose
> effects still appear in the accessible field?

## 2. From interface mismatch to geometric abstraction

The observation was abstracted into two related descriptions:

1. an observer-facing field containing what is rendered or represented; and
2. a constraint-bearing structure not explicitly represented in that field.

The second description was not assumed to be a literal hidden world. It was a
modeling device for asking whether a structured transformation of the
baseline field could reduce residual mismatch without freely inventing a new
residual map.

## 3. Why the Einstein-Rosen bridge was relevant

Einstein and Rosen's 1935 construction represented physical space through two
identical sheets connected by a bridge. That two-sheet/bridge topology offered
a useful geometric motif for relating a represented field to another
constraint-bearing description:

- Albert Einstein and Nathan Rosen, “The Particle Problem in the General
  Theory of Relativity,” *Physical Review* **48**, 73–77 (1935),
  [doi:10.1103/PhysRev.48.73](https://doi.org/10.1103/PhysRev.48.73).

Later black-hole/white-hole readings associated with bridge geometries were
part of the conceptual exploration, but this project did not adopt a literal
white-hole, wormhole, or hidden-sheet ontology. It had no observational basis
for doing so. Only the topological motif—linked descriptions with a boundary
not present in the observer-facing representation—was retained.

The Orthogonal Projection Term is **not derived** from the Einstein-Rosen
metric, the Einstein field equations, or a black-hole/white-hole solution.
Einstein-Rosen geometry is the inspiration layer; the operator below is a
separate mathematical hypothesis.

## 4. Translation into a testable operator

The geometric motif was converted into the bounded redistribution form

$$
\mathcal O_\perp[X]
=
f_\perp\left(\mathcal K_d[X]-X\right),
$$

with the augmented object

$$
X_{\mathrm{aug}}
=
X+\mathcal O_\perp[X]
=
(1-f_\perp)X+f_\perp\mathcal K_d[X].
$$

Here:

- `X` is the explicitly declared baseline object, such as halo density,
  surface density, convergence, or a derived mass profile;
- `K_d[X]` is a structured redistribution of that same object;
- `f_perp` controls how much of the redistributed representation is mixed
  into the baseline; and
- `d` sets the redistribution scale.

When the kernel is normalized on the full domain, the construction
redistributes the selected source rather than creating additional total
source. The exact baseline is recovered at `f_perp = 0`.

The word **orthogonal** labels a modeled correction channel that is absent from
the baseline representation. It is not a claim that an extra spatial
dimension or physically orthogonal sheet has been observed.

## 5. What the origin constrains

The conceptual origin motivated four design requirements:

1. **Baseline recovery:** setting the correction amplitude to zero must return
   the original equation exactly.
2. **Bounded structure:** the candidate must be an explicit transformation,
   not a free residual map that can absorb arbitrary error.
3. **Object identity:** every experiment must state exactly which source
   object receives the operator.
4. **Falsifiability:** frozen candidates must be compared with the baseline,
   matched generic controls, negative cases, and heldout data where available.

## 6. What the origin does not determine

The origin story does not determine:

- that the kernel must be Plummer;
- the values of `f_perp` or `d`;
- that any residual is cosmological rather than numerical, baryonic,
  model-product, or generic smoothing behavior;
- that a new source, hidden geometry, white hole, or modified-gravity term
  exists; or
- that a favorable delta is observational proof.

The Plummer kernel was one concrete normalized radial implementation. It was
not derived uniquely from Einstein-Rosen geometry. The matched-control results
in this repository show that Gaussian or top-hat redistribution frequently
reproduces or exceeds the same gains, so the current record does not establish
Plummer-specific physics.

## 7. From concept to benchmark program

The concept came first. RCC-style benchmark governance was applied later to
turn it into an auditable research program:

```text
baseline equation
→ explicit source object
→ frozen augmented equation
→ deterministic score
→ matched generic controls
→ replay and boundary checks
→ bounded public claim
```

The conceptual provenance establishes why this hypothesis was tested. The
stored equations, public-data provenance, executed paths, controls, and
negative results establish what the experiments actually support.

See:

- [`OPERATOR.md`](OPERATOR.md) for the exact operator and kernel lineage;
- [`EQUATION_INSERTIONS.md`](EQUATION_INSERTIONS.md) for equation-level
  placements;
- [`EXPERIMENT_REGISTRY.md`](EXPERIMENT_REGISTRY.md) for executed lanes and
  independence boundaries; and
- [`CLAIM_BOUNDARIES.md`](CLAIM_BOUNDARIES.md) for the permitted public
  interpretation.
