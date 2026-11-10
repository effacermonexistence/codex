#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from jeans_adapter_common import (
    RAW_MASS_LEAK_MAX,
    evaluate_prepared,
    fit_baseline,
    load_orthogonal_modules,
    prepare_kernel,
    state_summary,
)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def aggregate(rows: list[dict], key: str) -> dict:
    stable = [x for x in rows if x["baseline_stable"]]
    base = sum(x["baseline_chi2"] for x in stable)
    candidate = sum(x[key]["chi2"] for x in stable)
    delta = candidate - base
    return {
        "stable_galaxy_count": len(stable),
        "data_bin_count": sum(x["bin_count"] for x in stable),
        "baseline_total_chi2": base,
        "candidate_total_chi2": candidate,
        "raw_delta_chi2": delta,
        "residual_reduction_pct": -100.0 * delta / base,
        "baseline_macro_chi2_per_bin": sum(
            x["baseline_chi2_per_point"] for x in stable
        )
        / len(stable),
        "candidate_macro_chi2_per_bin": sum(x[key]["chi2_per_point"] for x in stable)
        / len(stable),
        "macro_delta_chi2_per_bin": sum(
            x[key]["chi2_per_point"] - x["baseline_chi2_per_point"] for x in stable
        )
        / len(stable),
        "improved_count": sum(x[key]["delta_chi2"] < 0 for x in stable),
        "worsened_count": sum(x[key]["delta_chi2"] > 0 for x in stable),
        "neutral_count": sum(x[key]["delta_chi2"] == 0 for x in stable),
        "downlift": candidate > base,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", type=Path, required=True)
    ap.add_argument("--policy", type=Path, required=True)
    ap.add_argument("--operator-repo", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()
    manifest = json.loads(args.manifest.read_text())
    policy = json.loads(args.policy.read_text())
    safe = policy["safe_optimum"]
    forced = policy["forced_nonzero_optimum"]
    ops = load_orthogonal_modules(args.operator_repo)
    rows = []
    for name in manifest["heldout"]:
        state = fit_baseline(
            name,
            dict(manifest["galaxy_meta"][name]),
            manifest["dispersion_profiles"][name],
        )
        row = state_summary(state)
        if state["stable"]:
            for label, kind, selected in (
                ("safe_plummer", "plummer_3d", safe),
                ("forced_plummer", "plummer_3d", forced),
                ("forced_gaussian", "gaussian_3d", forced),
                ("forced_top_hat", "top_hat_3d", forced),
            ):
                prepared = prepare_kernel(state, ops, kind, selected["eta"])
                result = evaluate_prepared(state, ops, prepared, selected["f"])
                if (
                    abs(result["raw_mass_leak_fraction"]) > RAW_MASS_LEAK_MAX
                    or abs(result["mass_leak_fraction"]) > 1e-12
                    or result["f0_max_abs_kms"] > 1e-9
                ):
                    raise RuntimeError(f"numerical gate failed for {name} {label}: {result}")
                row[label] = result
        rows.append(row)
    keys = ("safe_plummer", "forced_plummer", "forced_gaussian", "forced_top_hat")
    out = {
        "schema_version": "jeans-dsph-equation-adapter-heldout-v1",
        "proof_mode": "PUBLIC_DATA_HELDOUT_SHARED_ADAPTER_WITH_PER_GALAXY_BASELINE_NUISANCE_FIT",
        "claim_allowed": False,
        "sample_manifest_sha256": sha(args.manifest),
        "frozen_policy_sha256": sha(args.policy),
        "dev_names_accessed": False,
        "heldout_names": manifest["heldout"],
        "safe_policy": safe,
        "forced_nonzero_policy": forced,
        "rows": rows,
        "aggregates": {key: aggregate(rows, key) for key in keys},
        "claim_boundary": "Heldout for shared f/eta only. Each heldout galaxy fits its own NFW+constant-beta baseline nuisance parameters. This is a public-data equation-adapter diagnostic, not clean predictive or physical proof.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
