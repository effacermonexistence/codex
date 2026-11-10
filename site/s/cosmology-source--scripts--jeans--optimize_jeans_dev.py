#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from jeans_adapter_common import (
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
    ops = load_orthogonal_modules(args.operator_repo)
    states = [
        fit_baseline(
            name,
            dict(manifest["galaxy_meta"][name]),
            manifest["dispersion_profiles"][name],
        )
        for name in manifest["dev"]
    ]
    stable = [state for state in states if state["stable"]]
    if len(stable) != len(states):
        raise RuntimeError("all two dev baselines must be stable")
    base_macro = sum(
        state["base_chi2"] / state["profile"]["bin_count"] for state in stable
    ) / len(stable)
    policies = []
    for eta in ETA_GRID:
        prepared = {
            state["name"]: prepare_kernel(state, ops, "plummer_3d", eta) for state in stable
        }
        for f in F_GRID:
            rows = []
            valid = True
            for state in stable:
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
            policies.append(
                {
                    "f": f,
                    "eta": eta,
                    "valid": valid,
                    "dev_macro_chi2_per_point": macro,
                    "dev_macro_delta_chi2_per_point": macro - base_macro,
                    "dev_improved_count": sum(x["delta_chi2"] < 0 for x in rows),
                    "dev_worsened_count": sum(x["delta_chi2"] > 0 for x in rows),
                    "rows": rows,
                }
            )
    valid = [x for x in policies if x["valid"]]
    safe = min(valid, key=lambda x: (x["dev_macro_chi2_per_point"], x["f"], x["eta"]))
    forced = min(
        (x for x in valid if x["f"] > 0),
        key=lambda x: (x["dev_macro_chi2_per_point"], x["f"], x["eta"]),
    )
    out = {
        "schema_version": "jeans-dsph-equation-adapter-dev-v1",
        "proof_mode": "PUBLIC_DATA_DEVELOPMENT_ARTIFACT",
        "claim_allowed": False,
        "formula": "d_g=eta*rhalf_g; rho_h,aug=(1-f)rho_NFW+f(K_d*rho_NFW); frozen baseline enters spherical Jeans equation",
        "objective": "minimize macro mean chi2-per-bin over dev galaxies",
        "grids": {"f": F_GRID, "eta": ETA_GRID},
        "dev_names": manifest["dev"],
        "heldout_accessed": False,
        "baseline_macro_chi2_per_point": base_macro,
        "state_summaries": [state_summary(state) for state in states],
        "safe_optimum": compact_policy(safe),
        "forced_nonzero_optimum": compact_policy(forced),
        "policy_rows": policies,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
