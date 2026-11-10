# Experiment registry and independence map

The registry contains **twelve experimental records**, not twelve independent confirmations.

| Record | Stored units | Independence status | Result class |
|---|---:|---|---|
| N13 development chain | 5 clusters / one reused likelihood | Development-only | M1 within null; M2 absorbs residual |
| Program C H(z) | 31 H(z) rows | Separate dataset, different term | No real uplift |
| Program EA weak-field/lensing | 5 clusters | Same N13 sample | Same-sample diagnostic |
| Canonical equation channels | 6 named channels | Overlapping objectives; not 6 datasets | Placement/channel audit |
| AS1063 true-density B2 | 1 public model pair | Model-component diagnostic | Directional reduction; specificity unresolved |
| HFF map transfer | 6 clusters | Six targets, shared teams/systematics | Generic low-pass effect |
| SIDM Concerto Halo000 | 1 public simulation-parametric target | New target | Direction pass; specificity fail |
| SIDM Concerto Halo352 | 1 score-blind fresh target | New target | Direction pass; specificity fail |
| SPARC rotation-curve adapter | 14 dev / 7 heldout; 6 stable heldout | New public-data domain; shared adapter held out, per-galaxy nuisances fitted | 4.432% aggregate heldout reduction; `f=1` endpoint; Plummer beats both controls per unit 3/6 |
| Dwarf-spheroidal spherical-Jeans adapter | 2 dev / 2 heldout | New public-data domain; shared adapter held out, per-galaxy nuisances fitted | Adopted safe policy selected `f=0`; only the unadopted forced diagnostic slightly worsened both heldout galaxies |
| Direct formal-source Jeans insertion | 4 dev / 2 post-exposure evaluation | Draco/Ursa Minor identities were previously exposed; direct-source scores were new but not fresh/unseen | Correct canonical object: both deltas negative, aggregate reduction 0.005077%; dev-safe policy remained `f=0`; materiality not established |
| X-COP direct hydrostatic-equation insertion | 4 dev / 3 untouched-cluster heldout | New public-profile domain; shared `f/eta` frozen, cluster identities untouched by score before freeze | 145.095308 → 140.737785 chi-square; 3.0032% reduction; `f=1` endpoint; Plummer beats both controls per unit 1/3 |

## Development chain

The initial five-cluster likelihood was reused across M0/M1/M2/M3, Program EA, and several canonical-channel views. Renaming an objective or slicing channels does not create a new empirical unit. The public registry keeps those related rows together.

## Direction versus specificity

Two questions are deliberately separated:

1. **Directional:** did the frozen augmented profile reduce the chosen residual?
2. **Specificity:** did the Plummer kernel beat half-mass-matched Gaussian and top-hat controls under the frozen comparison rule?

The strongest fresh 3D run passed the first question and failed the second. Therefore the current durable result is a generic redistribution effect under the selected diagnostic, not Plummer-specific evidence.

## SPARC shared-adapter lane

SPARC adds a new observational domain and freezes one shared `f/eta` policy after development before evaluating the heldout galaxy identities. This is stronger than replaying the same development rows, but the heldout boundary does not cover each galaxy's baseline NFW nuisance fit. One of seven heldout baselines hit a bound and is retained as an excluded row. The valid public label is `PUBLIC_DATA_DEV_OPTIMIZATION_PLUS_HELDOUT_SHARED_ADAPTER_DIAGNOSTIC`.

The selected fraction was `f=1.0`, the full-smoothed-profile replacement
endpoint rather than the legacy partial `f=0.30` mixture. Plummer ranked first
in aggregate, but beat both matched controls on only 3/6 stable galaxies.
NGC5585 alone contributed 103.24% of the total Plummer-over-Gaussian aggregate
advantage; all kernels worsened that galaxy and the other rows net favored
Gaussian. The aggregate ordering is preserved as arithmetic but is not
classified as kernel-specific evidence.

## Dwarf-spheroidal Jeans lane

The Walker et al. public stellar-velocity catalogs add another equation and
data domain. Sextans and Fornax calibrated a shared `f/eta` grid; Sculptor and
Carina were held out from shared-policy selection. Calibration selected
`f=0`, so the adopted policy exactly preserved the baseline and produced no
adopted downlift. A separately frozen forced-nonzero branch was retained only
as a non-adopted diagnostic. As in SPARC, each heldout object's own baseline
NFW and anisotropy nuisances were fitted, so the lane is not clean end-to-end
prediction.

## Direct formal-source Jeans lane

This lane inserts `rho_perp=f(K_d*rho_NFW-rho_NFW)` into the halo-density
source of the unchanged Jeans equation. Carina, Fornax, Sculptor, and Sextans
calibrated the direct shared `f/eta` grid; the safe optimum was `f=0`. The best
frozen nonzero diagnostic (`f=0.05`, `eta=0.03125`) moved Draco and Ursa Minor
from `22.835647795309` to `22.834488396426` chi-square
(`delta=-0.001159398883`, `0.005077%`, 2/0 direction). Because those galaxy
identities had already been exposed during an earlier superseded internal
prototype, the result remains
`POST_EXPOSURE_CORRECTIVE_FORMAL_SOURCE_REPRODUCTION`, not a new independent
validation.

## X-COP direct hydrostatic-equation lane

Seven official X-COP public cluster profiles contained every component required
for the direct equation comparison. A deterministic name-hash split assigned
four clusters to development and three cluster identities to heldout. The
shared grid selected `f=1.0`, `d=0.01 R500` before any heldout baseline or
candidate score was executed.

On A644, A2029, and A1795, the direct dark-halo-only insertion changed aggregate
pressure chi-square from `145.095308` to `140.737785`
(`delta=-4.357523`, `3.0032%`) with 3/3 negative deltas and no row-level
fallback. Half-mass-matched Gaussian and top-hat controls also improved all
three clusters, although Plummer was strongest in aggregate. The lane is
therefore a heldout shared-operator **public-profile consistency diagnostic**,
not an independent raw-observational likelihood or a Plummer-specific physical
validation.

The selected `f=1.0` is the full-replacement endpoint. Per cluster, Plummer
beat both matched controls on only 1/3 rows. A644 supplied 144.57% of the total
Plummer-over-Gaussian aggregate advantage; A2029 and A1795 net favored
Gaussian. This aggregate-masking result is recorded in
[`aggregate_specificity_audit.json`](../results/aggregate_specificity_audit.json).
