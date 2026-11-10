# Frozen orthogonal redistribution operator

The operator's author-confirmed conceptual provenance is documented in
[`CONCEPTUAL_ORIGIN.md`](CONCEPTUAL_ORIGIN.md). That provenance explains the
mixed-reality trigger and Einstein-Rosen topological inspiration; it is not a
derivation of this operator and is not empirical evidence for new physics.

## General form

For a selected object `X` (halo density, surface density, convergence, or a derived mass profile):

$$
\mathcal O_\perp[X] = f_\perp\big(\mathcal K_d[X]-X\big),
$$

$$
X_{\rm aug}=X+\mathcal O_\perp[X]=(1-f_\perp)X+f_\perp\mathcal K_d[X].
$$

Baseline recovery is exact at `f_perp = 0`; an identity-kernel limit also returns the baseline. In the infinite-domain continuum, a normalized kernel preserves the integrated source:

$$
\int \mathcal O_\perp[X] \, dV = 0.
$$

Finite grids leak at their boundaries. Every stored 3D result reports that leakage rather than treating the finite grid as an infinite domain.

The SPARC rotation-curve lane uses the same 3D kernel lineage but not the
legacy fixed `f = 0.30`, `d = 16 kpc` constants. It freezes a
galaxy-scaled adapter selected on development data:

$$
f=1.0,\qquad d_g=0.125R_{{\rm disk},g}.
$$

At `f=1.0`, the selected halo profile is fully replaced by its smoothed
counterpart. This is the endpoint of the same declared operator family, but it
is not the legacy partial `f=0.30` mixture. The X-COP development policy also
selected this endpoint with `d=0.01R500`.

Its finite-grid convolution is deterministically renormalized to the unchanged
halo mass, while the pre-renormalization leakage remains reported and gated.

## 3D Plummer kernel

The true three-dimensional Plummer density kernel used in the 3D lanes is

$$
K_d(r)=\frac{3}{4\pi d^3}\left(1+\frac{r^2}{d^2}\right)^{-5/2}.
$$

Its half-mass radius is

$$
r_{1/2}=\frac{d}{\sqrt{2^{2/3}-1}}.
$$

Gaussian and spherical top-hat controls are matched to this same 3D half-mass radius before scoring.

## 2D HFF map kernel

The HFF map-transfer lane used a normalized radial kernel proportional to

$$
P_d(R)\propto\left(1+\frac{R^2}{d^2}\right)^{-3/2}.
$$

It is labeled **Plummer-like 2D** in this repository. It is not the literal projection of the 3D `-5/2` density kernel (whose ideal projected exponent differs), so the 2D and 3D lanes are not presented as one identical physical kernel.

On an infinite two-dimensional domain, this `-3/2` kernel has

$$
R_{1/2}=\sqrt{3}\,d.
$$

The HFF control construction does not assume that continuum value after
discretization. It measures the Plummer-like kernel's discrete half-mass
radius on the actual pixel grid and finite support, then matches the
Gaussian and top-hat controls to that measured value before scoring.

## Interpretation

The operator is a redistribution/low-pass correction. The experiments test whether that correction reduces a frozen residual. The matched controls determine whether the effect is Plummer-specific or generic. Current controls support the generic interpretation.
