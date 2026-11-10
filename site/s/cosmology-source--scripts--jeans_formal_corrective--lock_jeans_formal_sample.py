#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from jeans_formal_common import (
    FRESH_GALAXIES,
    build_dispersion_profile,
    canonical_sha,
    load_r2_hasher,
    read_spencer_multi_epoch_catalog,
    sha256_file,
)


DEV_NAMES = ["Carina", "Fornax", "Sculptor", "Sextans"]
HELDOUT_NAMES = ["Draco", "Ursa Minor"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--walker-v1-manifest", type=Path, required=True)
    ap.add_argument("--spencer-dir", type=Path, required=True)
    ap.add_argument("--mcconnachie-dir", type=Path, required=True)
    ap.add_argument("--r2-root", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()

    prior = json.loads(args.walker_v1_manifest.read_text())
    if prior.get("status") != "LOCKED_BEFORE_SCIENTIFIC_SCORING":
        raise RuntimeError("Walker v1 source manifest is not locked")
    if any(name not in prior["dispersion_profiles"] for name in DEV_NAMES):
        raise RuntimeError("Walker v1 manifest is missing a development galaxy")

    profiles = {name: prior["dispersion_profiles"][name] for name in DEV_NAMES}
    metadata = {name: prior["galaxy_meta"][name] for name in DEV_NAMES}
    sources: dict[str, dict] = {
        name: {
            "catalog": "CDS/VizieR J/AJ/137/3100 Walker et al. 2009",
            "profile_source": str(args.walker_v1_manifest),
            "profile_source_sha256": sha256_file(args.walker_v1_manifest),
            "original_source_receipt": prior["sources"][name],
            "prior_role": "previously inspected; development only in corrected direct-source run",
        }
        for name in DEV_NAMES
    }

    fresh_parse_receipts = {}
    for name in HELDOUT_NAMES:
        meta = dict(FRESH_GALAXIES[name])
        table = args.spencer_dir / str(meta["table"])
        member, parse_receipt = read_spencer_multi_epoch_catalog(table, meta)
        profile = build_dispersion_profile(member)
        profiles[name] = profile
        metadata[name] = meta
        fresh_parse_receipts[name] = parse_receipt
        sources[name] = {
            "catalog": "CDS/VizieR J/AJ/156/257 Spencer et al. 2018",
            "table_path": str(table),
            "table_sha256": sha256_file(table),
            "structural_catalog": "CDS/VizieR J/AJ/144/4 McConnachie 2012",
            "structural_readme_path": str(args.mcconnachie_dir / "ReadMe"),
            "structural_readme_sha256": sha256_file(args.mcconnachie_dir / "ReadMe"),
            "role": "post-exposure evaluation galaxy; identity previously exposed during a superseded internal prototype, not previously scored under the direct formal-source policy",
            "profile_member_count": profile["member_count"],
            "profile_bin_count": profile["bin_count"],
        }

    if set(DEV_NAMES) & set(HELDOUT_NAMES):
        raise RuntimeError("development/heldout galaxy overlap")
    r2_path, hasher = load_r2_hasher(args.r2_root)
    sample_ids = [
        *(f"WALKER2009_CORRECTIVE_DEV:{name}" for name in DEV_NAMES),
        *(f"SPENCER2018_CORRECTIVE_EVAL:{name}" for name in HELDOUT_NAMES),
    ]
    input_payload = {"sample_ids": sample_ids}
    sample_hash = hasher(sample_ids)
    output_payload = {"sample_ids_sha256": sample_hash}
    timestamp = datetime.now(timezone.utc).isoformat()
    out = {
        "schema_version": "jeans-formal-source-corrective-sample-lock-v1",
        "status": "LOCKED_FOR_CORRECTIVE_FORMAL_SOURCE_RERUN",
        "timestamp_utc": timestamp,
        "development": DEV_NAMES,
        "heldout": HELDOUT_NAMES,
        "overlap_count": 0,
        "split_rule": "all four Walker galaxies are development; Draco and Ursa Minor are post-exposure evaluation targets not previously scored under this direct formal-source policy",
        "galaxy_meta": metadata,
        "dispersion_profiles": profiles,
        "sources": sources,
        "fresh_heldout_parse_receipts": fresh_parse_receipts,
        "heldout_preprocessing": {
            "catalog_rows": "published multi-epoch member-star tables only",
            "per_star_velocity": "inverse-variance constant-velocity fit",
            "binary_candidate_exclusion": "exclude p_constant < 0.001 before radial profile construction",
            "profile": "same global planar-gradient removal and equal-count dispersion binning as Jeans-v1",
        },
        "visibility": {
            "development_scores_visible_for_policy_calibration": True,
            "heldout_public_catalog_visible": True,
            "heldout_baseline_or_candidate_scores_visible_before_policy_freeze": False,
            "heldout_model_scores_accessed_by_this_script": False,
        },
        "sample_ids": sample_ids,
        "sample_ids_sha256": sample_hash,
        "r2_invocation": {
            "source_path": str(r2_path),
            "callable": "sample_ids_sha256",
            "arm": "manifest",
            "call_site": "lock_jeans_formal_sample.py:main",
            "input_sha256": canonical_sha(input_payload),
            "output_sha256": canonical_sha(output_payload),
            "outcome": "development and corrective-evaluation galaxy identities plus source-derived profiles locked for direct formal-source rerun",
            "timestamp_utc": timestamp,
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
