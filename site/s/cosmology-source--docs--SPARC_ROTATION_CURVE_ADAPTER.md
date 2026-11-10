# SPARC rotation-curve equation adapter

## Status

**Evidence class:** `PUBLIC_DATA_DEV_OPTIMIZATION_PLUS_HELDOUT_SHARED_ADAPTER_DIAGNOSTIC`

The shared adapter parameters were selected on 14 development galaxies and
frozen before seven heldout galaxies were evaluated. One heldout galaxy was
excluded from the aggregate because its baseline NFW nuisance fit hit a bound,
leaving 105 rotation-curve points from six baseline-stable heldout galaxies.
Each galaxy, including each heldout galaxy, still received its own NFW baseline
nuisance fit. This is therefore a heldout test of the **shared adapter rule**, not
a clean end-to-end predictive test and not physical-law proof.

## Public data

The lane uses the SPARC v1 galaxy sample and Newtonian mass-model rotation
curves from Lelli, McGaugh & Schombert (2016), *The Astronomical Journal* 152,
157, DOI [`10.3847/0004-6256/152/6/157`](https://doi.org/10.3847/0004-6256/152/6/157).
The exact source bytes are identified in [`DATA_PROVENANCE.md`](DATA_PROVENANCE.md).
Third-party source files are not committed.

## Baseline equation

For each galaxy, fixed stellar mass-to-light coefficients of 0.5 for the disk
and 0.7 for the bulge were used:

$$
V_{\rm bar}^2(R)=V_{\rm gas}|V_{\rm gas}|
+0.5V_{\rm disk}|V_{\rm disk}|
+0.7V_{\rm bulge}|V_{\rm bulge}|.
$$

The selected sample is bulgeless, so the bulge contribution is zero. A
per-galaxy NFW halo was fitted with free $V_{200}$ and concentration $c$:

$$
V_{\rm base}^2(R)=V_{\rm bar}^2(R)
+\frac{G M_{\rm NFW}(<R;V_{200},c)}{R}.
$$

A baseline was considered stable only if the optimizer succeeded and neither
$V_{200}$ nor $c$ hit its allowed bounds.

## Equation-adapted orthogonal term

The operator acts only on the fitted three-dimensional NFW halo density. The
scale is tied to each galaxy's disk scale length:

$$
d_g=\eta R_{{\rm disk},g},
$$

$$
\rho_{{\rm aug},g}=(1-f)\rho_{{\rm NFW},g}
+f\left(K_{d_g}*\rho_{{\rm NFW},g}\right),
$$

$$
V_{\rm aug}^2(R)=V_{\rm bar}^2(R)
+\frac{G M_{\rm aug}(<R)}{R}.
$$

The three-dimensional Plummer kernel is

$$
K_d(r)=\frac{3}{4\pi d^3}\left(1+\frac{r^2}{d^2}\right)^{-5/2}.
$$

The finite-grid convolution was deterministically rescaled to the unchanged
halo mass before augmentation. The uncorrected finite-window leakage was still
retained and required to remain below 2%.

## Sample lock

Eligibility was fixed before scientific scoring:

- SPARC quality flag `Q = 1`;
- Hubble type `T >= 7`;
- inclination from 30 to 85 degrees;
- bulgeless mass model;
- at least 12 rotation-curve rows;
- positive disk scale length.

Twenty-one galaxies passed. They were ordered by `SHA256(galaxy name)`; the
first 14 were development and the final seven heldout. NGC3109 had a prior
visible exploratory score and fell in the development set. Heldout score
visibility before policy freeze was false. The ordered sample-ID hash is
`d5bb9bb18b9bbbcea0d2e31aee592d275b0aa596d32be2ed145c2494c9a3b3b5`.

The full split, catalog metadata, and source-member hashes are in
[`sparc_rotation_curve_sample_manifest.json`](../results/sparc_rotation_curve_sample_manifest.json).

## Development and freeze

The dev objective was the macro mean chi-square per point across baseline-stable
galaxies. The expanded grid was:

- $f \in \{0,0.05,0.10,0.20,0.30,0.40,0.50,0.60,0.75,1.0\}$;
- $\eta \in \{0.03125,0.0625,0.125,0.25,0.5,1,2,4,8\}$.

Eleven of 14 development baselines were stable. The shared optimum was

$$f=1.0,\qquad \eta=0.125.$$

`eta = 0.125` is interior to the expanded grid. `f = 1.0` is the physical
fraction boundary and was not extended beyond one. Under this candidate,
macro chi-square per point moved from 1.0010746505 to 0.9316796428
(delta -0.0693950078), with 9/11 improved and 2/11 worsened.

The complete 90-policy grid with per-galaxy rows is preserved in
[`sparc_rotation_curve_dev_grid.json`](../results/sparc_rotation_curve_dev_grid.json).

## Heldout result

| Kernel | Baseline total $\chi^2$ | Candidate total $\chi^2$ | Raw $\Delta\chi^2$ | Residual reduction | Improved / worsened |
|---|---:|---:|---:|---:|---:|
| Plummer 3D | 208.844928 | 199.588715 | -9.256213 | 4.432% | 5 / 1 |
| Gaussian 3D | 208.844928 | 203.372901 | -5.472027 | 2.620% | 5 / 1 |
| Top-hat 3D | 208.844928 | 203.805247 | -5.039681 | 2.413% | 5 / 1 |

Gaussian and top-hat controls were matched to the Plummer kernel's 3D
half-mass radius and used the same frozen $f$ and $\eta$; they received no
control-specific tuning. Plummer was better in aggregate by 3.784186 chi-square
versus Gaussian and 4.216532 versus top-hat in this lane. All three kernels
improved 5/6 stable galaxies, so generic low-pass redistribution remains a live
explanation. The one-sided 5/6 equal-sign-null value is 0.109375; no
confirmatory significance claim is made.

That aggregate rank is not a per-galaxy specificity result. Plummer beat both
matched controls on only 3/6 stable galaxies. NGC5585 supplied 75.58% of the
aggregate baseline chi-square and 103.24% of the total
Plummer-over-Gaussian aggregate advantage. All three kernels worsened NGC5585;
Plummer simply worsened it less, while the remaining galaxies net favored
Gaussian. The selected `f=1.0` is the full-smoothed-profile replacement
endpoint of the declared operator family, not the earlier partial `f=0.30`
mixture. The deterministic per-unit receipt is
[`aggregate_specificity_audit.json`](../results/aggregate_specificity_audit.json).

### Heldout galaxy rows

| Galaxy | $R_{\rm disk}$ kpc | $d$ kpc | Baseline $\chi^2$ | Plummer $\chi^2$ | $\Delta\chi^2$ | Reduction |
|---|---:|---:|---:|---:|---:|---:|
| UGC00731 | 2.300 | 0.28750 | 3.395909 | 2.781993 | -0.613917 | 18.08% |
| NGC5585 | 1.530 | 0.19125 | 157.838322 | 160.027760 | +2.189439 | -1.39% |
| F574-1 | 4.460 | 0.55750 | 19.724808 | 12.339378 | -7.385431 | 37.44% |
| UGC05721 | 0.380 | 0.04750 | 20.237618 | 17.934212 | -2.303406 | 11.38% |
| UGC06446 | 1.490 | 0.18625 | 3.220346 | 2.910741 | -0.309606 | 9.61% |
| DDO064 | 0.690 | — | 6.649968 | excluded | — | baseline fit hit a bound |
| UGC12632 | 2.420 | 0.30250 | 4.427925 | 3.594632 | -0.833293 | 18.82% |

## Executed-path verification

- dev/heldout overlap: 0;
- frozen policy preceded heldout evaluation;
- `f = 0` maximum prediction difference: 0;
- deterministic heldout replay: byte-identical;
- heldout artifact and replay SHA-256:
  `ab92c3142a9498fcbe1583f225bbbc2d463442e65a81e565ba85f9e4cbe1d13b`;
- independent aggregate recomputation: pass, maximum discrepancy
  $5.7\times10^{-14}$;
- maximum raw finite-grid mass leakage: 0.0053465 (0.535%);
- maximum post-renormalization leakage: $3.204\times10^{-15}$;
- operator tests: 8/8 pass;
- R2 selected-source pre/post executed-path gates: pass.
- public download-and-rerun path: numerically matched the stored development
  optimum and all heldout/control aggregates within $10^{-12}$; see
  [`sparc_rotation_curve_public_reproduction_check.json`](../results/sparc_rotation_curve_public_reproduction_check.json).

The original scientific executor code is published byte-for-byte under
[`scripts/sparc/`](../scripts/sparc/). The public helper is explicitly separated
from the non-redistributed R2 proof authority.

## Preserved failure and revision history

Four pre-heldout issues are retained rather than erased:

1. a loader-order bug attempted to read an ineligible short curve before the
   metadata filter; it was repaired before scientific scoring;
2. the initial finite-grid integration violated the numerical mass gate; the
   radial grid was increased from 1600 to 3200 points and one deterministic
   mass renormalization was introduced, while raw leakage remained visible and
   hard-gated;
3. NumPy boolean fields prevented JSON serialization after dev computation;
   only native-boolean conversion changed;
4. the first dev optimum hit the original `f` upper and `eta` lower grid edges;
   the development grid was expanded before heldout access, without changing
   the equation, kernel, objective, or sample.

See [`sparc_rotation_curve_failure_ledger.json`](../results/sparc_rotation_curve_failure_ledger.json).

## Claim boundary

### Supported

The frozen galaxy-scaled density adapter reduced aggregate heldout residuals
under this implementation and selected score. Plummer was the best of the
three frozen matched kernels in aggregate on the six stable heldout galaxies;
that arithmetic ordering is conditional and is not adopted as kernel-specific
evidence because the per-galaxy count was 3/6 and the aggregate advantage was
concentrated in one adverse row.

### Not established

- a new physical source or law;
- clean end-to-end prediction, because per-galaxy NFW nuisance parameters were
  fitted on each heldout rotation curve;
- confirmatory statistical significance;
- universal Plummer specificity;
- replacement or falsification of NFW, baryonic models, GR, or LambdaCDM.

The exact result class remains a public-data shared-adapter diagnostic.
