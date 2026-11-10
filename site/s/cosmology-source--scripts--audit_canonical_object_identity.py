#!/usr/bin/env python3
"""Verify the canonical Jeans source object and adopted no-downlift floor."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load(relative_path: str) -> dict:
    return json.loads((ROOT / relative_path).read_text(encoding="utf-8"))


def main() -> int:
    shared = load("results/jeans_dsph_heldout.json")
    direct = load("results/jeans_dsph_formal_corrective_evaluation.json")

    adopted = shared["aggregates"]["safe_plummer"]
    direct_plummer = direct["aggregates"]["direct_nonzero_plummer"]

    checks = {
        "shared_adapter_safe_fraction_is_zero": shared["safe_policy"]["f"] == 0.0,
        "shared_adapter_adopted_delta_is_zero": adopted["raw_delta_chi2"] == 0.0,
        "shared_adapter_adopted_downlift_is_false": adopted["downlift"] is False,
        "direct_source_response_projection_is_false": direct["response_projection_used"] is False,
        "direct_source_formula_names_rho_perp": "rho_perp=f*" in direct["formula"],
        "direct_source_formula_names_jeans_rhs": "Jeans RHS=" in direct["formula"],
        "direct_source_plummer_delta_is_negative": direct_plummer["raw_delta_chi2"] < 0.0,
        "direct_source_plummer_downlift_is_false": direct_plummer["downlift"] is False,
        "direct_source_both_rows_improve": (
            direct_plummer["improved_count"] == 2
            and direct_plummer["worsened_count"] == 0
        ),
    }
    passed = all(checks.values())
    output = {
        "schema_version": "canonical-object-identity-audit-v1",
        "status": "PASS" if passed else "FAIL",
        "checks": checks,
        "canonical_public_records": {
            "shared_adapter": {
                "result_file": "results/jeans_dsph_heldout.json",
                "adopted_fraction": shared["safe_policy"]["f"],
                "adopted_raw_delta_chi2": adopted["raw_delta_chi2"],
                "adopted_downlift": adopted["downlift"],
            },
            "direct_formal_source": {
                "result_file": "results/jeans_dsph_formal_corrective_evaluation.json",
                "operator_object": "three-dimensional NFW halo density only",
                "response_projection_used": direct["response_projection_used"],
                "direct_nonzero_raw_delta_chi2": direct_plummer["raw_delta_chi2"],
                "direct_nonzero_residual_reduction_pct": direct_plummer[
                    "residual_reduction_pct"
                ],
                "improved_count": direct_plummer["improved_count"],
                "worsened_count": direct_plummer["worsened_count"],
                "downlift": direct_plummer["downlift"],
            },
        },
        "public_boundary": (
            "The adopted shared-adapter result exactly preserves the baseline. "
            "The post-exposure direct-source diagnostic applies the operator to "
            "the canonical halo-density source and moves both row deltas negative."
        ),
    }
    out_path = ROOT / "results/canonical_object_identity_audit.json"
    out_path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    if not passed:
        raise SystemExit("canonical object identity audit failed")
    print(json.dumps({"status": "PASS", "output": str(out_path.relative_to(ROOT))}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
