# Corrective direct formal-source spherical-Jeans rerun

## Why this record exists

This record answers the canonical-equation question directly: the operator is
inserted into the three-dimensional NFW halo-density source of the unchanged
spherical Jeans equation. A superseded internal response-space prototype is
not part of the public benchmark record.

## Equation comparison

Baseline:

$$
\frac{d(\nu\sigma_r^2)}{dr}+\frac{2\beta}{r}\nu\sigma_r^2
=-\nu\frac{G M_{\rm base}(<r)}{r^2},
\qquad M_{\rm base}=M_\star+M_{\rm NFW}.
$$

Direct orthogonal density and mass:

$$
\rho_\perp(r)=f\left[(K_d*\rho_{\rm NFW})(r)-\rho_{\rm NFW}(r)\right],
$$

$$
M_\perp(<r)=4\pi\int_0^r\rho_\perp(r')r'^2dr'.
$$

Augmented equation:

$$
\frac{d(\nu\sigma_r^2)}{dr}+\frac{2\beta}{r}\nu\sigma_r^2
=-\nu\frac{G\left[M_{\rm base}(<r)+M_\perp(<r)\right]}{r^2}.
$$

Equivalently,
`rho_h,aug=(1-f)rho_NFW+f(K_d*rho_NFW)`. The operator acts on the
three-dimensional NFW halo density only. Stellar mass and tracer density are
not convolved. No response projection or free residual map is used.

## Development calibration

Carina, Fornax, Sculptor, and Sextans were development galaxies. The shared
search covered `f in {0, 0.05, ..., 1}` and
`eta in {0.03125, ..., 8}`, with `d_g=eta*r_half,g`.

- Safe optimum: `f=0`, `eta=0.03125`, exact baseline preservation.
- Best nonzero diagnostic: `f=0.05`, `eta=0.03125`.
- The nonzero diagnostic worsened the development macro score; only `1/4`
  development galaxies improved. It was frozen only to measure direct
  direction on the corrective evaluation set, not adopted.

## Corrective Draco / Ursa Minor evaluation

| Kernel | Baseline chi-square | Candidate chi-square | Raw delta | Residual reduction | Improved / worsened |
|---|---:|---:|---:|---:|---:|
| 3D Plummer | 22.835647795309 | 22.834488396426 | -0.001159398883 | 0.005077% | 2 / 0 |
| half-mass-matched 3D Gaussian | 22.835647795309 | 22.835485869669 | -0.000161925641 | 0.000709% | 2 / 0 |
| half-mass-matched 3D top-hat | 22.835647795309 | 22.835525851232 | -0.000121944077 | 0.000534% | 2 / 0 |
| safe Plummer (`f=0`) | 22.835647795309 | 22.835647795309 | 0 | 0% | 0 / 0 |

| Galaxy | Baseline | Plummer candidate | Delta |
|---|---:|---:|---:|
| Draco | 13.087048844286 | 13.086373170862 | -0.000675673424 |
| Ursa Minor | 9.748598951023 | 9.748115225564 | -0.000483725459 |

## Audit and replay

- OmarAGI R2 executed-source pre/post gates: PASS.
- Direct equation/source identity: PASS.
- Response-adapter callable absent: PASS.
- Exact `f=0` prediction recovery: PASS.
- Finite-grid mass-conservation gates: PASS.
- Arithmetic and object-identity audit: `61/61` checks PASS.
- Fresh-process replay preserved policy identity, delta signs, and direction
  counts. Floating-point outputs were numerically equivalent but not byte
  identical because the baseline L-BFGS-B fits shifted at sub-micro parameter
  scale.
- The packaged public evaluation replay reproduced all four aggregate raw deltas
  and direction counts exactly (`max raw-delta difference = 0`).

## Proof boundary

**Label:**
`CORRECT_FORMAL_SOURCE_DIRECTIONAL_DELTA_NEGATIVE_BUT_MATERIALITY_NOT_ESTABLISHED`.

Draco and Ursa Minor had already been exposed during a superseded internal
prototype, so this is a post-exposure corrective reproduction, not
fresh/unseen proof. The development-safe decision remained `f=0`; the nonzero
candidate is not adopted. The approximately `0.0051%` reduction is a small
forced-direction diagnostic, not material uplift, unique-kernel evidence, or a
physical/cosmological claim. Candidate nuisance parameters were not refit.
