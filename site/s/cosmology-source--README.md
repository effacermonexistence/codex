# Orthogonal Projection Term — Cosmology Residual Benchmarks

**OmarAGI research record.** This repository preserves the equations, frozen insertions, public-data provenance, diagnostic scores, matched controls, and claim boundaries from an exploratory orthogonal redistribution-term program.

The object tested throughout the core lanes is:

$$
\mathcal O_\perp[X] = f_\perp\left(\mathcal K_d[X]-X\right),
\qquad
X_{\mathrm{aug}}=(1-f_\perp)X+f_\perp\mathcal K_d[X].
$$

It does **not** create mass by construction when the kernel is normalized on the full domain; it redistributes a selected component. The earlier fixed-scale lanes freeze `f_perp = 0.30` and `d = 16 kpc`. The SPARC lane freezes one development-selected equation adapter, `f = 1.0` and `d_g = 0.125 R_disk,g`, before heldout evaluation. Here `f = 1.0` is the full-smoothed-profile replacement endpoint of the declared operator family, not the earlier partial `f = 0.30` mixture. The first dwarf-spheroidal Jeans lane independently calibrates the same density-adapter grammar and selects the safe baseline, `f = 0`. The corrective formal-source record inserts the term directly into the spherical-Jeans halo-density source for Draco and Ursa Minor while preserving the post-exposure proof boundary.

The X-COP lane separately places the same three-dimensional redistribution
grammar directly into the hydrostatic-equilibrium mass source. Its
development-frozen shared policy is evaluated on three untouched cluster
identities with no row-level fallback. Its selected `f = 1.0` is likewise the
full-replacement endpoint, not the legacy partial mixture.

## Conceptual origin

The hypothesis did not begin as a fit to cosmology data. It began with an
ordinary mixed-reality observation in a fully immersive Vision Pro
environment: the rendered scene made nearby space appear open, while an
unrendered physical wall still constrained movement. That mismatch prompted a
structural question: can the field available to an observer omit a boundary
that remains active in the larger constraint system?

Einstein and Rosen's two-sheet bridge construction then supplied a geometric
motif, not a physical derivation. The project retained the abstraction of
linked descriptions and a constraint-bearing structure outside the baseline
representation. It did **not** infer that mixed reality reveals cosmology,
that a white hole or hidden sheet has been observed, or that the operator
follows from the Einstein-Rosen metric.

The motif was converted into the bounded, falsifiable redistribution operator
shown above. The later benchmark program tests that operator against public
data and matched generic controls. Its results—not the origin story—determine
the empirical status. See
[`docs/CONCEPTUAL_ORIGIN.md`](docs/CONCEPTUAL_ORIGIN.md) for the full
provenance and boundary.

## What the record shows

| Diagnostic | Frozen directional result | Matched-control result | Evidence boundary |
|---|---:|---|---|
| HFF public lens-model maps, 6 clusters | Negative residual delta in 6/6; Plummer-like reductions 4.96%–27.99% | Generic Gaussian/top-hat also improved 6/6 and beat Plummer-like in 5/6 | Generic low-pass/model-product effect |
| AS1063 true-density B2 | 19.857% residual reduction | Gaussian 19.011%; top-hat 18.681% | Plummer slightly best, but specificity unresolved |
| SIDM Concerto Halo000 | 29.366% residual reduction | Gaussian/top-hat about 29.44% | Direction pass; Plummer specificity fail |
| SIDM Concerto Halo352, fresh target | 41.000% residual reduction | Gaussian 42.129%; top-hat 42.581% | Direction pass; Plummer specificity fail |
| SPARC rotation curves, shared-adapter heldout | 208.845 → 199.589 χ²; 4.432% reduction; 5/6 stable galaxies improved | Gaussian 2.620%; top-hat 2.413%; Plummer best in aggregate but beat both controls per galaxy only 3/6 | `f=1` full-replacement boundary; aggregate advantage over Gaussian is entirely concentrated in NGC5585, where all kernels worsened; diagnostic, not specificity or clean predictive proof |
| Dwarf-spheroidal spherical Jeans, shared-adapter heldout | Adopted calibration selected `f=0` and recovered the exact baseline | Matched controls were retained only as non-adopted diagnostics | Adopted result: no downlift |
| Direct formal-source Jeans insertion, post-exposure | 22.835648 → 22.834488 χ²; +0.005077% residual reduction; 2/2 negative deltas | Gaussian +0.000709%; top-hat +0.000534% | Correct canonical equation object; post-exposure and materially small |
| X-COP direct hydrostatic-equation insertion, cluster heldout | 145.095308 → 140.737785 χ²; 3.0032% reduction; 3/3 negative deltas | Gaussian 2.1042%; top-hat 1.5773%; Plummer best in aggregate but beat both controls per cluster only 1/3 | `f=1` full-replacement boundary; A644 alone exceeds the total Plummer-over-Gaussian aggregate advantage; public-profile consistency diagnostic, not specificity or independent raw likelihood |
| N13-style development likelihood | raw delta chi-square -1.2543 | 20th percentile under null; baryonic countermodel absorbs residual | Favorable raw direction; development-only and not proof |
| H(z) background-fluid lane | raw delta chi-square -0.00874 | AIC and BIC worsen | Separate Program C term; no real uplift |

**Supported reading:** inserting a frozen redistribution term can move selected public model products, parametric profiles, or heldout shared-adapter residuals in the favorable direction under the stored metric. The adopted Jeans shared-adapter policy selected the exact baseline (`f=0`), so it produced no adopted downlift. The direct-source Jeans run placed the operator on the requested halo-density source and moved both post-exposure deltas slightly negative, although development still selected `f=0` and the aggregate reduction was only about 0.0051%. In the X-COP direct hydrostatic lane, the frozen shared insertion reduced aggregate heldout pressure chi-square by 3.0032% with 3/3 negative deltas, while matched generic smoothers also improved 3/3. The SPARC and X-COP Plummer aggregate rankings remain valid arithmetic, but per-unit comparisons (`3/6` and `1/3`) and dominant-unit concentration do not establish Plummer specificity.

**Not supported:** a new physical source, a Plummer-specific mechanism, a detection of hidden geometry, a replacement for GR/LambdaCDM, or an observational-likelihood improvement. In the strongest fresh 3D control, generic smoothers performed slightly better than Plummer.

## Why publish this

Scientific iteration is easier to audit when favorable deltas, neutral adopted outcomes, matched-control results, reused samples, and superseded interpretations remain distinguishable in one durable public record.

## Repository map

- [`docs/CONCEPTUAL_ORIGIN.md`](docs/CONCEPTUAL_ORIGIN.md) — the author-confirmed mixed-reality trigger, Einstein-Rosen topological inspiration, mathematical translation, and evidence boundary.
- [`docs/OPERATOR.md`](docs/OPERATOR.md) — exact 2D/3D operator definitions and kernel lineage.
- [`docs/EQUATION_INSERTIONS.md`](docs/EQUATION_INSERTIONS.md) — Poisson, lensing, halo-profile, Jeans, Friedmann, and Einstein-container placements.
- [`docs/EXPERIMENT_REGISTRY.md`](docs/EXPERIMENT_REGISTRY.md) — what was run and what is or is not independent.
- [`docs/SPARC_ROTATION_CURVE_ADAPTER.md`](docs/SPARC_ROTATION_CURVE_ADAPTER.md) — the full SPARC equation, sample lock, dev/heldout split, controls, row results, and audit boundary.
- [`docs/JEANS_DSPH_ADAPTER.md`](docs/JEANS_DSPH_ADAPTER.md) — the dwarf-spheroidal Jeans equation placement, adopted safe-floor result, non-adopted controls, and verification.
- [`docs/JEANS_DSPH_FORMAL_SOURCE_CORRECTIVE.md`](docs/JEANS_DSPH_FORMAL_SOURCE_CORRECTIVE.md) — the corrected direct Jeans-source insertion, post-exposure evaluation, matched controls, replay, and claim boundary.
- [`docs/XCOP_HYDROSTATIC_DIRECT_FORMAL.md`](docs/XCOP_HYDROSTATIC_DIRECT_FORMAL.md) — the direct hydrostatic-equilibrium source insertion, frozen cluster split, heldout result, matched controls, and audit boundary.
- [`docs/DATA_PROVENANCE.md`](docs/DATA_PROVENANCE.md) — external sources and checksums.
- [`docs/CLAIM_BOUNDARIES.md`](docs/CLAIM_BOUNDARIES.md) — exact public claim limits.
- [`results/`](results/) — sanitized machine-readable scores with upstream artifact hashes.
- [`results/canonical_object_identity_audit.json`](results/canonical_object_identity_audit.json) — deterministic receipt confirming that the public Jeans result uses the canonical halo-density source and that the adopted shared-adapter floor does not downlift.
- [`results/aggregate_specificity_audit.json`](results/aggregate_specificity_audit.json) — deterministic per-unit recomputation separating SPARC/X-COP aggregate kernel rankings from kernel-specific evidence and recording the `f=1` endpoint boundary.
- [`src/orthogonal_projection_term/`](src/orthogonal_projection_term/) — reusable operator, kernel, radial convolution, and scoring code.
- [`scripts/`](scripts/) — public-data reproduction adapters and integrity verifier.
- [`audits/RED_TEAM_FINDINGS.md`](audits/RED_TEAM_FINDINGS.md) — strongest adversarial findings.

## Verify the published record

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[test]'
python scripts/verify_published_results.py
pytest -q
```

To reproduce one HFF cluster after obtaining the public FITS maps, take
that cluster's frozen `d_arcsec` from
[`results/hff_six_cluster_transfer.json`](results/hff_six_cluster_transfer.json):

```bash
python scripts/reproduce_hff_transfer.py \
  --target CATS_kappa_best.fits \
  --reference GLAFIC_kappa_best.fits \
  --reference WILLIAMS_kappa_best.fits \
  --d-arcsec <stored-d-arcsec> \
  --output reproduced_cluster.json
```

The adapter WCS-resamples the reference maps, applies the frozen 60-arcsec
scoring mask, and half-mass-matches both generic controls to the discrete
finite Plummer-like kernel before scoring.

Large external FITS archives and simulation tables are not redistributed. Download instructions and source hashes are in [`docs/DATA_PROVENANCE.md`](docs/DATA_PROVENANCE.md).

The SPARC public-data reproduction path is documented in
[`scripts/sparc/README.md`](scripts/sparc/README.md). Its full development grid,
heldout rows, matched controls, verification receipt, and pre-heldout failures
are preserved under [`results/`](results/).

The dwarf-spheroidal Jeans path is documented in
[`scripts/jeans/README.md`](scripts/jeans/README.md). Its full development grid,
safe and forced policies, heldout rows, matched controls, verification receipt,
and pre-heldout failures are also preserved under [`results/`](results/).

The corrective direct-source path is documented in
[`scripts/jeans_formal_corrective/README.md`](scripts/jeans_formal_corrective/README.md). It records the direct canonical-equation insertion without upgrading the post-exposure result to fresh proof.

The X-COP direct hydrostatic-equation path is documented in
[`scripts/xcop_hse/README.md`](scripts/xcop_hse/README.md). It downloads the
official profile archive, reproduces the deterministic split, calibrates the
shared policy on four clusters, evaluates the frozen policy on three untouched
cluster identities, and reruns the arithmetic audit.

## License and citation

Code is released under the MIT License. Cite the repository using [`CITATION.cff`](CITATION.cff). Source datasets retain their original licenses and attribution requirements.
