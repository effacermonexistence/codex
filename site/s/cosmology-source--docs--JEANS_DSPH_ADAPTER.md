# Dwarf-spheroidal spherical-Jeans equation adapter

## Result

The development calibration selected the safe baseline policy, `f = 0`. A separately frozen forced-nonzero diagnostic (`f = 0.05`, `eta = 0.03125`) slightly worsened the two heldout galaxies in aggregate.

**Result label:** `NO_ADAPTER_UPLIFT_SAFE_FLOOR_SELECTED`.

The adopted result is exact baseline preservation. The forced nonzero branch is
retained only as a non-adopted diagnostic; it is not an uplift, a detection, or
evidence for a new physical term.

## Equation placement

The baseline spherical Jeans equation is

$$
\frac{d(\nu\sigma_r^2)}{dr}+\frac{2\beta}{r}\nu\sigma_r^2
=-\nu\frac{G M_{\rm base}(<r)}{r^2},
$$

with

$$
M_{\rm base}=M_{\star,\mathrm{Plummer}}+M_{\mathrm{NFW}}.
$$

The shared adapter acts only on the three-dimensional NFW halo density:

$$
d_g=\eta r_{1/2,g},
\qquad
\rho_{h,\mathrm{aug}}=(1-f)\rho_{\mathrm{NFW}}+f(K_{d_g}*\rho_{\mathrm{NFW}}),
$$

$$
M_{\rm aug}(<r)=M_\star(<r)+4\pi\int_0^r\rho_{h,\mathrm{aug}}(r')r'^2dr'.
$$

The stellar tracer and stellar mass are not convolved. The spherical Jeans equation itself is unchanged.

## Data, split, and calibration

The public source is CDS/VizieR catalog `J/AJ/137/3100` from Walker et al. (2009). The run used membership-summary rows with `Mmb >= 0.95`, recovering the published sample sizes:

| Galaxy | Members | Role |
|---|---:|---|
| Sextans | 397 | development |
| Fornax | 2,279 | development |
| Sculptor | 1,349 | heldout |
| Carina | 746 | heldout |

The role split was fixed by sorting the four galaxy names by SHA-256 and assigning the first two to development. Development optimized only shared `f` and `eta` over a frozen grid. Each galaxy's NFW density scale, NFW radius scale, and constant anisotropy were baseline nuisance fits. Candidate evaluation reused the baseline nuisance values and did not refit them.

The safe policy allowed `f = 0`. The forced-nonzero policy was stored only so a nonzero term and matched controls could be diagnosed even when calibration rejected adoption.

## Development result

| Policy | `f` | `eta` | Macro chi-square/bin | Delta |
|---|---:|---:|---:|---:|
| baseline / safe optimum | 0.00 | 0.03125 | 0.432642367616 | 0.000000000000 |
| best forced nonzero | 0.05 | 0.03125 | 0.432783074926 | +0.000140707310 |

The nonzero candidate was already slightly worse on development data. Calibration therefore selected `f = 0`.

## Heldout result

| Kernel/policy | Baseline chi-square | Candidate chi-square | Raw delta | Residual reduction | Improved / worsened |
|---|---:|---:|---:|---:|---:|
| Safe Plummer (`f=0`) | 35.352826843 | 35.352826843 | +0.000000000 | 0.000000% | 0 / 0 |
| Forced Plummer | 35.352826843 | 35.354732150 | +0.001905307 | -0.005389% | 0 / 2 |
| Matched Gaussian | 35.352826843 | 35.353171229 | +0.000344386 | -0.000974% | 1 / 1 |
| Matched top-hat | 35.352826843 | 35.353085490 | +0.000258648 | -0.000732% | 1 / 1 |

The forced Plummer delta is deterministic but materially negligible and adverse. Both heldout galaxies moved in the unfavorable direction.

## Verification

- exact `f=0` recovery: maximum prediction difference `0.0 km/s`;
- raw finite-window mass leakage: below `0.2%`;
- post-renormalization leakage: at most `1e-12`;
- development replay: byte-identical;
- heldout replay: byte-identical;
- independent aggregate recomputation: `PASS`;
- no heldout row fallback;
- heldout identities and scores were not accessed before policy freeze.

Three pre-heldout failures are preserved in [`results/jeans_dsph_failure_ledger.json`](../results/jeans_dsph_failure_ledger.json). Each affected score was discarded and recomputed after repair.

## Proof boundary

The heldout boundary covers shared `f/eta`, not each galaxy's baseline nuisance fit. This is a public-data equation-adapter diagnostic, not clean end-to-end prediction or physical proof. The correct conclusion is negative: this implementation found no reason to adopt the orthogonal term in the spherical-Jeans lane.
