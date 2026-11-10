#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from astropy.io import fits

from xcop_hse_common import (
    ELIGIBLE_CLUSTERS,
    canonical_sha,
    cluster_paths,
    hash_order,
    sha256_file,
)

def sample_ids_sha256(sample_ids: list[str]) -> str:
    """Public reproduction of the frozen R2 sample-identity algorithm."""
    return hashlib.sha256("\n".join(sample_ids).encode("utf-8")).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--source-archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    ordered = hash_order(list(ELIGIBLE_CLUSTERS))
    development = ordered[:4]
    heldout = ordered[4:]
    if set(development) & set(heldout):
        raise RuntimeError("development/heldout overlap")

    source_receipts: dict[str, dict] = {}
    for name in ordered:
        paths = cluster_paths(args.source_root, name)
        with fits.open(paths["pressure"]) as hdul:
            pressure_rows = len(hdul["XRAY"].data)
            r500 = float(hdul["XRAY"].header["R500"])
        with fits.open(paths["density"]) as hdul:
            density_rows = len(hdul["DENSITY"].data)
        with fits.open(paths["mstar"]) as hdul:
            stellar_rows = len(hdul["MSTAR_SMOOTHED"].data)
        if pressure_rows < 8 or density_rows < 8 or stellar_rows < 8:
            raise RuntimeError(f"{name}: insufficient profile rows")
        source_receipts[name] = {
            "r500_kpc": r500,
            "pressure_rows": pressure_rows,
            "density_rows": density_rows,
            "stellar_rows": stellar_rows,
            "files": {
                key: {
                    "path": f"{name}/{path.name}",
                    "sha256": sha256_file(path),
                    "bytes": path.stat().st_size,
                }
                for key, path in paths.items()
            },
        }

    sample_ids = [
        *(f"XCOP_HSE_DEV:{name}" for name in development),
        *(f"XCOP_HSE_HELDOUT:{name}" for name in heldout),
    ]
    input_payload = {"sample_ids": sample_ids}
    sample_hash = sample_ids_sha256(sample_ids)
    output_payload = {"sample_ids_sha256": sample_hash}
    timestamp = datetime.now(timezone.utc).isoformat()
    output = {
        "schema_version": "xcop-hse-direct-formal-sample-lock-v1",
        "status": "LOCKED_BEFORE_SCIENTIFIC_SCORING",
        "timestamp_utc": timestamp,
        "dataset": "X-COP public profile release",
        "eligibility": (
            "official X-COP cluster with X-ray pressure, electron-density, hydrostatic "
            "NFW mass, gas-mass, and stellar-mass profile files; >=8 rows in required profiles"
        ),
        "split_rule": (
            "sort eligible cluster names by SHA256('XCOP-HSE-v1:'+name); first four "
            "development, remaining three heldout"
        ),
        "ordered_clusters": ordered,
        "development": development,
        "heldout": heldout,
        "overlap_count": 0,
        "source_archive": {
            "path": args.source_archive.name,
            "sha256": sha256_file(args.source_archive),
            "bytes": args.source_archive.stat().st_size,
            "download_url": "https://drive.switch.ch/index.php/s/j3WUOYXWgv9Jbnz/download",
        },
        "source_receipts": source_receipts,
        "visibility": {
            "source_profiles_and_schema_visible": True,
            "development_scores_visible_for_shared_policy_selection": True,
            "heldout_names_locked_before_scoring": True,
            "heldout_baseline_or_candidate_scores_visible_before_policy_freeze": False,
            "heldout_scores_accessed_by_this_script": False,
        },
        "sample_ids": sample_ids,
        "sample_ids_sha256": sample_hash,
        "sample_identity_receipt": {
            "algorithm": "sha256(newline_join(sample_ids))",
            "executed_source": "public reproduction in lock_xcop_sample.py",
            "input_sha256": canonical_sha(input_payload),
            "output_sha256": canonical_sha(output_payload),
            "timestamp_utc": timestamp,
            "outcome": "X-COP development and heldout identities reproduced",
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
