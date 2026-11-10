#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from jeans_adapter_common import (
    GALAXIES,
    build_dispersion_profile,
    canonical_sha,
    hash_order,
    load_r2_hasher,
    read_member_catalog,
    sha256_file,
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source-dir", type=Path, required=True)
    ap.add_argument("--r2-root", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()
    ordered = hash_order(list(GALAXIES))
    if ordered != ["Sextans", "Fornax", "Sculptor", "Carina"]:
        raise RuntimeError(f"unexpected deterministic order: {ordered}")
    dev = ordered[:2]
    heldout = ordered[2:]
    profiles = {}
    sources = {}
    for name in ordered:
        meta = dict(GALAXIES[name])
        table = args.source_dir / str(meta["table"])
        member = read_member_catalog(table, meta)
        profiles[name] = build_dispersion_profile(member)
        sources[name] = {
            "path": str(table),
            "sha256": sha256_file(table),
            "member_count_mmb_ge_0_95": profiles[name]["member_count"],
        }
    r2_path, hasher = load_r2_hasher(args.r2_root)
    sample_ids = [f"WALKER2009_DSPH:{x}" for x in ordered]
    input_payload = {"sample_ids": sample_ids}
    sample_hash = hasher(sample_ids)
    output_payload = {"sample_ids_sha256": sample_hash}
    out = {
        "schema_version": "jeans-dsph-equation-adapter-sample-lock-v1",
        "status": "LOCKED_BEFORE_SCIENTIFIC_SCORING",
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "source_catalog": "CDS/VizieR J/AJ/137/3100 Walker et al. 2009",
        "membership_rule": "use unique summary row with Mmb >= 0.95",
        "velocity_rule": "weighted mean <HV> when present, otherwise row HV",
        "split_rule": "four galaxy names sorted by SHA256(name); first two dev, remaining two heldout",
        "ordered": ordered,
        "dev": dev,
        "heldout": heldout,
        "galaxy_meta": GALAXIES,
        "dispersion_profiles": profiles,
        "sources": sources,
        "source_readme": {
            "path": str(args.source_dir / "ReadMe"),
            "sha256": sha256_file(args.source_dir / "ReadMe"),
        },
        "prior_visibility": {
            "all_four_raw_catalogs": "public source available before split",
            "heldout_model_scores_visible_before_policy_freeze": False,
        },
        "r2_invocation": {
            "source_path": str(r2_path),
            "callable": "sample_ids_sha256",
            "arm": "manifest",
            "call_site": "lock_jeans_sample.py:main",
            "input_sha256": canonical_sha(input_payload),
            "output_sha256": canonical_sha(output_payload),
            "outcome": "dev/heldout galaxy identities and public-data profiles locked before scientific scoring",
            "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        },
        "sample_ids_sha256": sample_hash,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
