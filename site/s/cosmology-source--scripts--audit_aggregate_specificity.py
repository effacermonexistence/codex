#!/usr/bin/env python3
"""Audit aggregate kernel rankings against per-unit rankings and weight concentration."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AUDIT_UNIT_IDS = (
    "SPARC:UGC00731",
    "SPARC:NGC5585",
    "SPARC:F574-1",
    "SPARC:UGC05721",
    "SPARC:UGC06446",
    "SPARC:UGC12632",
    "XCOP:A644",
    "XCOP:A2029",
    "XCOP:A1795",
)


def load(relative_path: str) -> dict:
    return json.loads((ROOT / relative_path).read_text())


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_r2_callable(source_path: Path):
    source_directory = str(source_path.parent)
    if source_directory not in sys.path:
        sys.path.insert(0, source_directory)
    spec = importlib.util.spec_from_file_location(
        "r2_benchmark_replay_harness_aggregate_audit", source_path
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load R2 source: {source_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.sample_ids_sha256


def sparc_audit(heldout: dict, policy: dict) -> dict:
    rows = [row for row in heldout["rows"] if row["baseline_stable"]]
    per_unit = []
    for row in rows:
        p = row["forced_plummer"]["delta_chi2"]
        g = row["forced_gaussian"]["delta_chi2"]
        t = row["forced_top_hat"]["delta_chi2"]
        per_unit.append(
            {
                "unit": row["galaxy"],
                "baseline_chi2": row["baseline_chi2"],
                "plummer_delta_chi2": p,
                "gaussian_delta_chi2": g,
                "top_hat_delta_chi2": t,
                "plummer_beats_both_controls": p < g and p < t,
            }
        )

    aggregates = heldout["aggregates"]
    p_total = aggregates["forced_plummer"]["raw_delta_chi2"]
    g_total = aggregates["forced_gaussian"]["raw_delta_chi2"]
    t_total = aggregates["forced_top_hat"]["raw_delta_chi2"]
    dominant = max(per_unit, key=lambda row: row["baseline_chi2"])
    dominant_g_advantage = (
        dominant["gaussian_delta_chi2"] - dominant["plummer_delta_chi2"]
    )
    aggregate_g_advantage = g_total - p_total
    return {
        "frozen_fraction": policy["safe_optimum"]["f"],
        "fraction_grid_boundary_hit": policy["safe_optimum"]["f"] == 1.0,
        "operator_boundary_interpretation": (
            "f=1 is the full-smoothed-profile replacement endpoint of the "
            "declared operator family, not the legacy partial f=0.30 mixture."
        ),
        "unit_count": len(per_unit),
        "plummer_beats_both_controls_count": sum(
            row["plummer_beats_both_controls"] for row in per_unit
        ),
        "per_unit": per_unit,
        "aggregate": {
            "plummer_delta_chi2": p_total,
            "gaussian_delta_chi2": g_total,
            "top_hat_delta_chi2": t_total,
            "plummer_best": p_total < g_total and p_total < t_total,
        },
        "weight_concentration": {
            "dominant_unit": dominant["unit"],
            "dominant_baseline_chi2_fraction": (
                dominant["baseline_chi2"]
                / aggregates["forced_plummer"]["baseline_total_chi2"]
            ),
            "aggregate_plummer_advantage_over_gaussian": aggregate_g_advantage,
            "dominant_unit_plummer_advantage_over_gaussian": dominant_g_advantage,
            "dominant_unit_fraction_of_aggregate_gaussian_advantage": (
                dominant_g_advantage / aggregate_g_advantage
            ),
        },
        "claim_classification": (
            "AGGREGATE_RANKING_ARITHMETICALLY_TRUE_PER_UNIT_SPECIFICITY_NOT_ESTABLISHED"
        ),
    }


def xcop_audit(heldout: dict, policy: dict) -> dict:
    gaussian_rows = {
        row["cluster"]: row for row in heldout["generic_control_rows"]["gaussian"]
    }
    top_hat_rows = {
        row["cluster"]: row for row in heldout["generic_control_rows"]["top_hat"]
    }
    per_unit = []
    for row in heldout["safe_rows"]:
        unit = row["cluster"]
        p = row["delta_chi2"]
        g = gaussian_rows[unit]["delta_chi2"]
        t = top_hat_rows[unit]["delta_chi2"]
        per_unit.append(
            {
                "unit": unit,
                "baseline_chi2": row["baseline_chi2"],
                "plummer_delta_chi2": p,
                "gaussian_delta_chi2": g,
                "top_hat_delta_chi2": t,
                "plummer_beats_both_controls": p < g and p < t,
            }
        )

    p_total = heldout["safe_aggregate"]["delta_chi2_sum"]
    g_total = heldout["generic_control_aggregates"]["gaussian"]["delta_chi2_sum"]
    t_total = heldout["generic_control_aggregates"]["top_hat"]["delta_chi2_sum"]
    dominant_advantage = max(
        per_unit,
        key=lambda row: row["gaussian_delta_chi2"] - row["plummer_delta_chi2"],
    )
    dominant_g_advantage = (
        dominant_advantage["gaussian_delta_chi2"]
        - dominant_advantage["plummer_delta_chi2"]
    )
    aggregate_g_advantage = g_total - p_total
    return {
        "frozen_fraction": policy["safe_policy"]["f"],
        "fraction_grid_boundary_hit": policy["safe_policy"]["f"] == 1.0,
        "operator_boundary_interpretation": (
            "f=1 is the full-smoothed-profile replacement endpoint of the "
            "declared operator family, not the legacy partial f=0.30 mixture."
        ),
        "unit_count": len(per_unit),
        "plummer_beats_both_controls_count": sum(
            row["plummer_beats_both_controls"] for row in per_unit
        ),
        "per_unit": per_unit,
        "aggregate": {
            "plummer_delta_chi2": p_total,
            "gaussian_delta_chi2": g_total,
            "top_hat_delta_chi2": t_total,
            "plummer_best": p_total < g_total and p_total < t_total,
        },
        "aggregate_advantage_concentration": {
            "dominant_unit": dominant_advantage["unit"],
            "aggregate_plummer_advantage_over_gaussian": aggregate_g_advantage,
            "dominant_unit_plummer_advantage_over_gaussian": dominant_g_advantage,
            "dominant_unit_fraction_of_aggregate_gaussian_advantage": (
                dominant_g_advantage / aggregate_g_advantage
            ),
        },
        "claim_classification": (
            "AGGREGATE_RANKING_ARITHMETICALLY_TRUE_PER_UNIT_SPECIFICITY_NOT_ESTABLISHED"
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--r2-source", required=True, type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "results/aggregate_specificity_audit.json",
    )
    args = parser.parse_args()

    sparc_heldout = load("results/sparc_rotation_curve_heldout.json")
    sparc_policy = load("results/sparc_rotation_curve_frozen_policy.json")
    xcop_heldout = load("results/xcop_hse_heldout.json")
    xcop_policy = load("results/xcop_hse_frozen_policy.json")

    sparc = sparc_audit(sparc_heldout, sparc_policy)
    xcop = xcop_audit(xcop_heldout, xcop_policy)

    assert sparc["frozen_fraction"] == 1.0
    assert sparc["plummer_beats_both_controls_count"] == 3
    assert xcop["frozen_fraction"] == 1.0
    assert xcop["plummer_beats_both_controls_count"] == 1
    assert sparc["aggregate"]["plummer_best"] is True
    assert xcop["aggregate"]["plummer_best"] is True
    assert (
        sparc["weight_concentration"][
            "dominant_unit_fraction_of_aggregate_gaussian_advantage"
        ]
        > 1.0
    )
    assert (
        xcop["aggregate_advantage_concentration"][
            "dominant_unit_fraction_of_aggregate_gaussian_advantage"
        ]
        > 1.0
    )

    sample_ids_sha256 = load_r2_callable(args.r2_source)
    unit_identity_hash = sample_ids_sha256(list(AUDIT_UNIT_IDS))
    source_files = (
        "results/sparc_rotation_curve_heldout.json",
        "results/sparc_rotation_curve_frozen_policy.json",
        "results/xcop_hse_heldout.json",
        "results/xcop_hse_frozen_policy.json",
    )
    result = {
        "schema_version": "aggregate-specificity-audit-v1",
        "status": "PASS",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "audit_scope": (
            "Separate aggregate kernel ranking from per-unit kernel ranking and "
            "record the f=1 operator-boundary condition."
        ),
        "r2_manifest_identity": {
            "callable": "sample_ids_sha256",
            "audit_unit_ids": list(AUDIT_UNIT_IDS),
            "audit_unit_ids_sha256": unit_identity_hash,
            "source_sha256": sha256(args.r2_source),
        },
        "source_files": {path: sha256(ROOT / path) for path in source_files},
        "sparc": sparc,
        "xcop": xcop,
        "adoption_decision": {
            "aggregate_directional_results_preserved": True,
            "aggregate_plummer_ranking_preserved_as_arithmetic": True,
            "plummer_specificity_claim": False,
            "public_surface_requires_per_unit_counts": True,
            "public_surface_requires_f1_boundary": True,
            "xcop_prior_adversarial_audit_authority": (
                "INTERNAL_SELF_AUDIT_NOT_INDEPENDENT_EXTERNAL_REVIEW"
            ),
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"status": "PASS", "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
