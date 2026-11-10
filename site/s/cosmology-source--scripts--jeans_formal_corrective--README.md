# Corrective direct formal-source spherical-Jeans lane

This folder preserves the exact scientific code used for the corrective run.
The run inserts the orthogonal redistribution term directly into the NFW halo
density source of the canonical spherical Jeans equation. It does **not** use
a nuisance-tangent response projection.

## Direct equation object

```text
rho_perp = f * (K_d * rho_NFW - rho_NFW)
M_perp(<r) = 4*pi*integral_0^r rho_perp(r') r'^2 dr'
Jeans RHS = -nu*G*(M_base(<r) + M_perp(<r))/r^2
```

The stellar mass/tracer is unchanged. Candidate nuisance parameters are not
refit; the fitted baseline state is frozen to isolate the direct insertion.

## Public numerical replay

The sanitized sample manifest contains the derived dispersion profiles, so the
corrective evaluation can be replayed without redistributing third-party raw
catalogs:

```bash
python scripts/jeans_formal_corrective/evaluate_jeans_formal_corrective.py \
  --manifest results/jeans_dsph_formal_corrective_sample_manifest.json \
  --policy results/jeans_dsph_formal_corrective_frozen_policy.json \
  --operator-repo . \
  --output /tmp/jeans_formal_corrective_replay.json

python scripts/jeans_formal_corrective/verify_corrective_result.py
```

Fresh-process L-BFGS-B baseline fits can differ at sub-micro parameter scale,
so replay is checked for policy identity, direction, counts, and tight numerical
parity rather than false byte identity.

## Boundary

Draco and Ursa Minor had already been exposed during a superseded internal
prototype. This is therefore a **post-exposure corrective formal-source
reproduction**, not fresh/unseen proof. Development selected the safe `f=0`
policy. The frozen nonzero direct diagnostic moved both evaluation deltas
negative, but the aggregate reduction was only about `0.0051%`; it is not
material uplift or physical evidence.
