#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from jeans_formal_common import (
    ETA_GRID,
    F_GRID,
    RAW_MASS_LEAK_MAX,
    evaluate_prepared,
    fit_baseline,
    load_orthogonal_modules,
    prepare_kernel,
    state_summary,
)


def compact_policy(row: dict) -> dict:
    return {k: v for k, v in row.items() if k != "rows"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", type=Path, required=True)
    ap.add_argument("--operator-repo", type=Path, required=True)
    ap.add_argument("--post-gate", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()

    gate = json.loads(args.post_gate.read_text())
    if gate.get("status") != "PASS" or gate.get("phase") != "post":
        raise RuntimeError("post executed-source gate required before scientific scoring")
    manifest = json.loads(args.manifest.read_text())
    if manifest.get("status") != "LOCKED_FOR_CORRECTIVE_FORMAL_SOURCE_RERUN":
        raise RuntimeError("corrective formal-source sample lock required")

    ops = load_orthogonal_modules(args.operator_repo)
    states = [
        fit_baseline(name, dict(manifest["galaxy_meta"][name]), manifest["dispersion_profiles"][name])
        for name in manifest["development"]
    ]
    if not all(state["stable"] for state in states):
        raise RuntimeError("all development baselines must be stable")

    base_macro = sum(state["base_chi2"] / state["profile"]["bin_count"] for state in states) / len(states)
    policies: list[dict] = []
    for eta in ETA_GRID:
        prepared = {state["name"]: prepare_kernel(state, ops, "plummer_3d", eta) for state in states}
        for f in F_GRID:
            rows = []
            valid = True
            for state in states:
                result = evaluate_prepared(state, ops, prepared[state["name"]], f)
                result["galaxy"] = state["name"]
                if (
                    abs(result["raw_mass_leak_fraction"]) > RAW_MASS_LEAK_MAX
                    or abs(result["mass_leak_fraction"]) > 1e-12
                    or result["f0_max_abs_kms"] > 1e-9
                ):
                    valid = False
                rows.append(result)
            macro = sum(x["chi2_per_point"] for x in rows) / len(rows)
            policies.append({
                "f": float(f),
                "eta": float(eta),
                "valid": bool(valid),
                "dev_macro_chi2_per_point": float(macro),
                "dev_macro_delta_chi2_per_point": float(macro - base_macro),
                "dev_improved_count": sum(x["delta_chi2"] < 0 for x in rows),
                "dev_worsened_count": sum(x["delta_chi2"] > 0 for x in rows),
                "rows": rows,
            })

    valid = [x for x in policies if x["valid"]]
    safe = min(valid, key=lambda x: (x["dev_macro_chi2_per_point"], x["f"], x["eta"]))
    direct_nonzero = min(
        (x for x in valid if x["f"] > 0.0),
        key=lambda x: (x["dev_macro_chi2_per_point"], x["f"], x["eta"]),
    )
    out = {
        "schema_version": "jeans-formal-source-corrective-dev-v1",
        "proof_mode": "POST_EXPOSURE_CORRECTIVE_DEVELOPMENT_ARTIFACT",
        "claim_allowed": False,
        "formula": "rho_perp=f*(K_d*rho_NFW-rho_NFW); M_perp=4*pi*integral(rho_perp*r^2 dr); Jeans RHS=-nu*G*(M_base+M_perp)/r^2",
        "response_projection_used": False,
        "objective": "minimize macro mean chi2-per-bin over four development galaxies",
        "grids": {"f": F_GRID, "eta": ETA_GRID},
        "development_names": manifest["development"],
        "corrective_evaluation_scores_accessed": False,
        "baseline_macro_chi2_per_point": float(base_macro),
        "state_summaries": [state_summary(state) for state in states],
        "safe_optimum": compact_policy(safe),
        "direct_nonzero_optimum": compact_policy(direct_nonzero),
        "policy_rows": policies,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
