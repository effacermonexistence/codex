# X-COP direct hydrostatic-equation lane

## Live object

This lane compares the canonical hydrostatic-equilibrium equation with the
same equation after a three-dimensional orthogonal redistribution is inserted
only into the reconstructed dark-halo density.

It corrects the earlier off-object failure mode in which a projected proxy or
response-space transformation could be mistaken for a direct equation
insertion.

## Baseline equation

The electron-pressure hydrostatic equation is

$$
\frac{dP_e}{dr}
=
-\mu m_p n_e(r)\frac{G M_{\mathrm{NFW,total}}(<r)}{r^2}.
$$

The published X-COP hydrostatic NFW profile is the baseline gravitating mass.

## Orthogonal-augmented equation

The dark-halo component is reconstructed as

$$
\rho_{\rm dm}(r)
=
\rho_{\mathrm{NFW,total}}(r)
-\rho_{\rm gas}(r)
-\rho_\star(r).
$$

The normalized three-dimensional Plummer kernel acts on this component only:

$$
\rho_{\rm dm,aug}(r)
=
(1-f)\rho_{\rm dm}(r)
+f(K_d*\rho_{\rm dm})(r).
$$

Equivalently, the mass correction is

$$
\Delta M_\perp(<r)
=
f\left[
M[K_d*\rho_{\rm dm}](<r)-M[\rho_{\rm dm}](<r)
\right],
$$

and the scored augmented equation is

$$
\frac{dP_e}{dr}
=
-\mu m_p n_e(r)
\frac{G\left[M_{\mathrm{NFW,total}}(<r)+\Delta M_\perp(<r)\right]}{r^2}.
$$

Gas, stars, electron-density data, and the pressure score are unchanged.
`f=0` recovers the baseline exactly.

## Source and eligibility

- Dataset: official X-COP public profile release.
- Release page: <https://dominiqueeckert.wixsite.com/xcop/data>
- Hydrostatic-mass paper:
  <https://doi.org/10.1051/0004-6361/201833323>
- Profile archive:
  <https://drive.switch.ch/index.php/s/j3WUOYXWgv9Jbnz/download>
- Archive SHA-256:
  `0edf5038b419b70d070b73b22f4801e27f318b0854db61eec52142c27c140d94`

Seven clusters contain every component required by the frozen reconstruction:
X-ray pressure, electron density, hydrostatic NFW mass, gas-mass profile, and
stellar-mass profile.

The fixed component-validity window is
`0.005 <= r/R500 <= 3.0`. The first preflight attempt stopped before producing
scores when extrapolated baryonic subtraction became nonphysical beyond this
shared support window. The repaired window was fixed across all eligible
clusters before development optimization; no equation, kernel, sample,
parameter grid, score, or matched control was changed.

## Development and heldout lock

The deterministic name-hash split is:

- Development: A2319, A85, ZW1215, A2142.
- Heldout: A644, A2029, A1795.
- Overlap: 0.
- Sample identity SHA-256:
  `8285acec7f246c2681deaaae007eb3f9f4e94cef33892d3fdd14e01171bd2538`.

The shared development grid was:

- `f in {0, .05, .10, .20, .30, .40, .50, .60, .75, 1.0}`
- `d/R500 in {.005, .01, .02, .04, .08, .16}`

The selected policy was `f=1.0`, `d=0.01 R500`. The fraction reached the
declared upper grid boundary. The grid was not widened after heldout scoring.

The public source was accessible during development. “Heldout” means no
heldout baseline or candidate score was executed before the shared policy was
frozen; it does not imply secret data.

## Score

The score is diagonal X-COP X-ray electron-pressure chi-square. A single
additive pressure-boundary nuisance is profiled analytically with the same
budget in both arms.

## Heldout result

| Cluster | Points | Baseline chi-square | Augmented chi-square | Raw delta | Residual reduction |
|---|---:|---:|---:|---:|---:|
| A644 | 12 | 46.162435 | 42.699543 | -3.462892 | 7.5015% |
| A2029 | 14 | 58.109244 | 58.053889 | -0.055354 | 0.0953% |
| A1795 | 13 | 40.823629 | 39.984353 | -0.839276 | 2.0559% |
| **Total** | **39** | **145.095308** | **140.737785** | **-4.357523** | **3.0032%** |

All three heldout clusters moved in the favorable direction. There was no
heldout row fallback and no heldout downlift.

## Matched generic controls

At the same frozen `f` and a half-mass-matched three-dimensional scale:

| Kernel | Augmented chi-square | Raw delta | Residual reduction | Improved |
|---|---:|---:|---:|---:|
| Plummer | 140.737785 | -4.357523 | 3.0032% | 3/3 |
| Gaussian | 142.042268 | -3.053040 | 2.1042% | 3/3 |
| Top-hat | 142.806793 | -2.288515 | 1.5773% | 3/3 |

Plummer is strongest in aggregate under this frozen comparison, but every
generic smoother also improves all three clusters. The result therefore does
not establish unique Plummer physics.

The aggregate ordering is not a per-cluster specificity result. Plummer beat
both matched controls on only 1/3 clusters. A644 supplied 144.57% of the total
Plummer-over-Gaussian aggregate advantage, while A2029 and A1795 net favored
Gaussian. The selected `f=1.0` is the full-smoothed-profile replacement
endpoint, not the legacy partial `f=0.30` mixture. The deterministic
recomputation is in
[`aggregate_specificity_audit.json`](../results/aggregate_specificity_audit.json).

## Verification

- Direct formal-equation insertion: PASS.
- Dark-halo-only object lock: PASS.
- True three-dimensional Plummer kernel: PASS.
- Exact `f=0` mass and pressure-prediction recovery: PASS.
- Corrected mass conservation: PASS.
- No heldout row fallback: PASS.
- Deterministic byte-identical replay: PASS.
- R2 source-authority pre-gate: PASS.
- Executed-source post-gate: PASS.
- Internal arithmetic self-audit: PASS.
- Internal execution-path adversarial self-audit: PASS.
- Independent external audit: not established in the stored result artifacts.

## Evidence and claim boundary

The X-COP hydrostatic NFW mass profiles were reconstructed from the same
thermodynamic profile family used in the pressure consistency score. This is
therefore a public-profile direct-equation diagnostic, not an independent raw
observational likelihood.

Supported:

> On three untouched X-COP cluster profiles, the development-frozen direct
> halo-only orthogonal insertion moved hydrostatic pressure chi-square from
> 145.0953 to 140.7378 (delta -4.3575; 3.00% residual reduction), with negative
> delta in 3/3 clusters and no heldout downlift.

Not supported:

- detection of a new source or physical law;
- proof that the term is required by the data;
- unique validation of Plummer geometry;
- independent raw-observational proof;
- a universal no-downlift guarantee.

## Reproduction

See [`scripts/xcop_hse/README.md`](../scripts/xcop_hse/README.md). Machine-readable
contracts, policy, rows, controls, and audit receipts are under
[`results/`](../results/).
