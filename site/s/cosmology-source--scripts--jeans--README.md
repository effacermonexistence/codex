# Dwarf-spheroidal spherical-Jeans adapter

These four scripts are the task-local adapter used for the public-data Jeans diagnostic:

1. `lock_jeans_sample.py`
2. `optimize_jeans_dev.py`
3. `evaluate_jeans_heldout.py`
4. `jeans_adapter_common.py`

The external OmarAGI R2 authority tree is not redistributed. The selected R2 callable was used to lock sample identity; the public scientific implementation is fully visible here. The published machine-readable manifest already contains the locked dispersion profiles, so arithmetic and result verification do not require the raw catalogs.

## External data

Catalog: CDS/VizieR `J/AJ/137/3100`

```bash
mkdir -p external/jeans_dsph
cd external/jeans_dsph
curl -L 'https://cdsarc.cds.unistra.fr/ftp/J/AJ/137/3100/ReadMe' -o ReadMe
curl -L 'https://cdsarc.cds.unistra.fr/ftp/J/AJ/137/3100/table2.dat' -o table2.dat
curl -L 'https://cdsarc.cds.unistra.fr/ftp/J/AJ/137/3100/table3.dat' -o table3.dat
curl -L 'https://cdsarc.cds.unistra.fr/ftp/J/AJ/137/3100/table4.dat' -o table4.dat
curl -L 'https://cdsarc.cds.unistra.fr/ftp/J/AJ/137/3100/table5.dat' -o table5.dat
```

Expected SHA-256 values are listed in [`docs/DATA_PROVENANCE.md`](../../docs/DATA_PROVENANCE.md).

## Execution boundary

The original run used a content-addressed R2 `sample_ids_sha256` callable and mandatory pre/post execution receipts. This repository does not redistribute that private authority source and does not imply that all R2 modules executed. The lane is explicitly `TASK_LOCAL_ADAPTER_OVER_R2_PRIMITIVES`.

For public review, use:

```bash
python scripts/verify_published_results.py
pytest -q
```

The complete development grid, frozen policy, heldout rows, controls, verification, and failure ledger are under `results/`.
