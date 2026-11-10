# X-COP direct hydrostatic-equation reproduction

This adapter reproduces the public-data equation comparison recorded in
[`docs/XCOP_HYDROSTATIC_DIRECT_FORMAL.md`](../../docs/XCOP_HYDROSTATIC_DIRECT_FORMAL.md).

The operator acts only on reconstructed three-dimensional dark-halo density:

```text
rho_dm = rho_NFW,total - rho_gas - rho_star
rho_dm,aug = (1-f)*rho_dm + f*(K_d * rho_dm)
```

The canonical hydrostatic equation is otherwise unchanged. It does not smooth
total convergence, projected mass, gas, or stars.

## Obtain the public X-COP profiles

```bash
mkdir -p external/xcop
curl -L \
  https://drive.switch.ch/index.php/s/j3WUOYXWgv9Jbnz/download \
  -o external/xcop/xcop_allfiles_download
echo "0edf5038b419b70d070b73b22f4801e27f318b0854db61eec52142c27c140d94  external/xcop/xcop_allfiles_download" \
  | shasum -a 256 -c -
mkdir -p external/xcop/extracted
tar -xzf external/xcop/xcop_allfiles_download \
  -C external/xcop/extracted
```

The archive is not redistributed by this repository.

## Reproduce the frozen workflow

From the repository root:

```bash
python scripts/xcop_hse/lock_xcop_sample.py \
  --source-root external/xcop/extracted \
  --source-archive external/xcop/xcop_allfiles_download \
  --output reproduced/xcop_hse_sample_manifest.json

python scripts/xcop_hse/optimize_xcop_dev.py \
  --sample-lock reproduced/xcop_hse_sample_manifest.json \
  --source-root external/xcop/extracted \
  --operator-repo . \
  --output reproduced/xcop_hse_dev_grid.json

python scripts/xcop_hse/freeze_xcop_policy.py \
  --sample-lock reproduced/xcop_hse_sample_manifest.json \
  --dev-results reproduced/xcop_hse_dev_grid.json \
  --output reproduced/xcop_hse_frozen_policy.json

python scripts/xcop_hse/evaluate_xcop_heldout.py \
  --sample-lock reproduced/xcop_hse_sample_manifest.json \
  --policy reproduced/xcop_hse_frozen_policy.json \
  --source-root external/xcop/extracted \
  --operator-repo . \
  --output reproduced/xcop_hse_heldout.json

python scripts/xcop_hse/evaluate_xcop_heldout.py \
  --sample-lock reproduced/xcop_hse_sample_manifest.json \
  --policy reproduced/xcop_hse_frozen_policy.json \
  --source-root external/xcop/extracted \
  --operator-repo . \
  --output reproduced/xcop_hse_heldout_replay.json

python scripts/xcop_hse/audit_xcop_run.py \
  --result reproduced/xcop_hse_heldout.json \
  --replay-result reproduced/xcop_hse_heldout_replay.json \
  --common-code scripts/xcop_hse/xcop_hse_common.py \
  --output-json reproduced/xcop_hse_audit.json \
  --output-md reproduced/xcop_hse_audit.md
```

The public adapter reproduces the scientific execution and arithmetic. The
original run additionally passed OmarAGI R2 source-authority and
executed-source gates; the sanitized receipts are preserved in the result
summary and adversarial audit rather than requiring private R2 source code.

## Expected heldout result

```text
A644   delta chi-square = -3.462892
A2029  delta chi-square = -0.055354
A1795  delta chi-square = -0.839276
total  delta chi-square = -4.357523
```

Aggregate residual reduction is `3.0032%`, with 3/3 heldout clusters moving in
the favorable direction and no heldout row fallback.

The sanitized public workflow was rerun from the downloaded archive and
reproduced the published policy, split, direction counts, and aggregate values
to within `2e-12`. The machine-readable numerical-parity receipt is
[`results/xcop_hse_public_reproduction_check.json`](../../results/xcop_hse_public_reproduction_check.json).
