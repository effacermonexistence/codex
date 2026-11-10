# SPARC equation-adapter reproduction

This directory contains the byte-identical scientific executor files from the
2026-07-25 run plus two clearly labeled public-reproduction helpers.

## Executed-source files

| File | SHA-256 |
|---|---|
| `sparc_adapter_common.py` | `4609393861001e828d3e4c7c3b4443fd56e598c17378c54702765694559b2f9d` |
| `lock_sparc_sample_executed.py` | `8112104be9d1c6dad1237277c407a4da6049c208db394e9a3820d1fcfb9eabda` |
| `optimize_sparc_dev.py` | `7e184ec0843d31d6705f9923aa016cc085a16f8d9c1b457c99d7e46572517b3e` |
| `evaluate_sparc_heldout.py` | `e4f09595220bf1a02d9064c5a432f1b992718b008c9745f67ac3db6a4b4dad8e` |

The executed sample-lock script invoked an R2 content-addressing primitive that
is not redistributed here. The public helper independently verifies the same
ordered sample with SHA-256 over newline-joined `SPARC:<galaxy>` IDs. It is a
reproduction helper, not a retroactive R2 proof gate.

## Data download

```bash
mkdir -p data/sparc
curl -L 'https://zenodo.org/records/16284118/files/Rotmod_LTG.zip?download=1' \
  -o data/sparc/Rotmod_LTG.zip
curl -L 'https://zenodo.org/records/16284118/files/SPARC_Lelli2016c.mrt?download=1' \
  -o data/sparc/SPARC_Lelli2016c.mrt
shasum -a 256 data/sparc/Rotmod_LTG.zip data/sparc/SPARC_Lelli2016c.mrt
```

Expected SHA-256:

- `Rotmod_LTG.zip`: `0a80cc90714828cc28b7dd57923576714d209f2490328c087c4a4ad607faf588`
- `SPARC_Lelli2016c.mrt`: `5aa0501f6b0d881fa579030e315e7b5b6ef561a5bd3a07472f9929c7e5728243`

## Reproduce the dev grid and heldout evaluation

From the repository root, after `pip install -e .`:

```bash
mkdir -p reproduced/sparc
python scripts/sparc/prepare_public_reproduction.py \
  --catalog data/sparc/SPARC_Lelli2016c.mrt \
  --zip data/sparc/Rotmod_LTG.zip \
  --manifest results/sparc_rotation_curve_sample_manifest.json \
  --output reproduced/sparc/PUBLIC_INPUT_GATE.json

python scripts/sparc/optimize_sparc_dev.py \
  --manifest results/sparc_rotation_curve_sample_manifest.json \
  --zip data/sparc/Rotmod_LTG.zip \
  --operator-repo . \
  --post-gate reproduced/sparc/PUBLIC_INPUT_GATE.json \
  --output reproduced/sparc/DEV_OPTIMIZATION.json

python scripts/sparc/freeze_sparc_policy_public.py \
  --dev reproduced/sparc/DEV_OPTIMIZATION.json \
  --manifest results/sparc_rotation_curve_sample_manifest.json \
  --output reproduced/sparc/FROZEN_POLICY.json

python scripts/sparc/evaluate_sparc_heldout.py \
  --manifest results/sparc_rotation_curve_sample_manifest.json \
  --policy reproduced/sparc/FROZEN_POLICY.json \
  --zip data/sparc/Rotmod_LTG.zip \
  --operator-repo . \
  --output reproduced/sparc/HELDOUT_EVALUATION.json
```

The numerical rows and aggregates should match the published result within
floating-point tolerance. Artifact hashes will differ because the public
manifest/policy intentionally omit machine-local authority paths and timestamps.
The original heldout result and byte-identical replay hash are preserved in
`results/sparc_rotation_curve_run_receipt.json`.

This exact public sequence was also run before release. Its path-free parity
receipt is
[`results/sparc_rotation_curve_public_reproduction_check.json`](../../results/sparc_rotation_curve_public_reproduction_check.json).
