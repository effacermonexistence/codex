#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from xcop_hse_common import canonical_sha, sha256_file


def compact(candidate: dict) -> dict:
    return {
        "f": float(candidate["f"]),
        "eta": float(candidate["eta"]),
        "development_objective_macro_chi2_per_point": float(
            candidate["objective_macro_chi2_per_point"]
        ),
        "development_delta_macro_chi2_per_point": float(
            candidate["aggregate"]["macro_delta_chi2_per_point"]
        ),
        "development_improved_count": int(candidate["aggregate"]["improved_count"]),
        "development_downlift_count": int(candidate["aggregate"]["downlift_count"]),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dev-results", type=Path, required=True)
    parser.add_argument("--sample-lock", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    dev = json.loads(args.dev_results.read_text())
    lock = json.loads(args.sample_lock.read_text())
    if dev.get("status") != "DEVELOPMENT_GRID_COMPLETE":
        raise RuntimeError("development grid incomplete")
    if dev["sample_lock_sha256"] != lock["sample_ids_sha256"]:
        raise RuntimeError("sample lock mismatch")
    safe = compact(dev["safe_best"])
    forced = compact(dev["forced_nonzero_best"])
    timestamp = datetime.now(timezone.utc).isoformat()
    payload = {
        "schema_version": "xcop-hse-direct-formal-frozen-policy-v1",
        "status": "FROZEN_BEFORE_HELDOUT_SCORING",
        "timestamp_utc": timestamp,
        "development": lock["development"],
        "heldout": lock["heldout"],
        "sample_ids_sha256": lock["sample_ids_sha256"],
        "sample_lock_file_sha256": sha256_file(args.sample_lock),
        "development_results_sha256": sha256_file(args.dev_results),
        "safe_policy": safe,
        "forced_nonzero_diagnostic_policy": forced,
        "selection_rule": (
            "minimize unweighted development-cluster macro mean pressure chi2 per point; "
            "safe policy may choose f=0; forced diagnostic requires f>0"
        ),
        "heldout_rules": {
            "parameter_update": False,
            "cluster_exclusion": False,
            "row_level_fallback": False,
            "score_visibility_before_freeze": False,
            "same_pressure_boundary_nuisance_budget_per_arm": True,
        },
        "generic_controls": (
            "heldout forced-policy scale only; 3D Gaussian and 3D top-hat matched "
            "to the Plummer 3D half-mass radius"
        ),
    }
    payload["policy_content_sha256"] = canonical_sha(payload)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
