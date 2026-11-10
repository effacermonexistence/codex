#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from xcop_hse_common import (
    aggregate_rows,
    build_cluster_state,
    canonical_sha,
    evaluate_prepared,
    prepare_kernel,
    sha256_file,
    state_summary,
)


def evaluate_policy(
    states: dict[str, dict],
    names: list[str],
    policy: dict,
    kernel: str,
) -> tuple[list[dict], dict]:
    eta = float(policy["eta"])
    fraction = float(policy["f"])
    rows = []
    for name in names:
        prepared = prepare_kernel(states[name], kernel, eta)
        rows.append(evaluate_prepared(states[name], prepared, fraction))
    return rows, aggregate_rows(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample-lock", type=Path, required=True)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--operator-repo", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    lock = json.loads(args.sample_lock.read_text())
    policy = json.loads(args.policy.read_text())
    if policy.get("status") != "FROZEN_BEFORE_HELDOUT_SCORING":
        raise RuntimeError("policy not frozen")
    if policy["sample_ids_sha256"] != lock["sample_ids_sha256"]:
        raise RuntimeError("sample/policy mismatch")
    names = list(lock["heldout"])
    states = {
        name: build_cluster_state(args.source_root, name, args.operator_repo) for name in names
    }

    safe_rows, safe_aggregate = evaluate_policy(
        states, names, policy["safe_policy"], "plummer"
    )
    forced_rows, forced_aggregate = evaluate_policy(
        states, names, policy["forced_nonzero_diagnostic_policy"], "plummer"
    )
    control_rows = {}
    control_aggregates = {}
    for kernel in ("gaussian", "top_hat"):
        rows, aggregate = evaluate_policy(
            states, names, policy["forced_nonzero_diagnostic_policy"], kernel
        )
        control_rows[kernel] = rows
        control_aggregates[kernel] = aggregate

    f0_rows = []
    for name in names:
        prepared = prepare_kernel(
            states[name], "plummer", policy["forced_nonzero_diagnostic_policy"]["eta"]
        )
        f0_rows.append(evaluate_prepared(states[name], prepared, 0.0))
    max_f0_mass = max(row["f0_max_abs_mass_msun"] for row in f0_rows)
    max_f0_prediction = max(row["f0_max_abs_prediction_kev_cm3"] for row in f0_rows)

    output = {
        "schema_version": "xcop-hse-direct-formal-heldout-v1",
        "status": "HELDOUT_EXECUTED",
        "proof_mode": (
            "PUBLIC_XCOP_PROFILE_DEV_CALIBRATION_PLUS_UNTOUCHED_CLUSTER_HELDOUT_"
            "SHARED_OPERATOR_DIRECT_EQUATION_DIAGNOSTIC"
        ),
        "sample_lock_sha256": sha256_file(args.sample_lock),
        "policy_sha256": sha256_file(args.policy),
        "sample_ids_sha256": lock["sample_ids_sha256"],
        "development": lock["development"],
        "heldout": names,
        "overlap_count": 0,
        "equations": {
            "baseline": "dP_e/dr = -mu*m_p*n_e*G*M_NFW,total(<r)/r^2",
            "augmented": (
                "dP_e/dr = -mu*m_p*n_e*G*[M_NFW,total(<r) + "
                "f*(M[K_d*rho_dm]-M[rho_dm])]/r^2"
            ),
            "rho_dm_definition": "rho_NFW,total - rho_gas - rho_star",
            "kernel": "normalized 3D Plummer K_d",
            "component_lock": "orthogonal operator applied to dark-halo density only",
            "unchanged_components": ["electron-density data", "gas density", "stellar density"],
        },
        "score": (
            "X-COP X-ray electron-pressure diagonal chi2; one additive pressure-boundary "
            "nuisance analytically profiled with the same budget in each arm"
        ),
        "safe_policy": policy["safe_policy"],
        "safe_rows": safe_rows,
        "safe_aggregate": safe_aggregate,
        "forced_nonzero_policy": policy["forced_nonzero_diagnostic_policy"],
        "forced_nonzero_rows": forced_rows,
        "forced_nonzero_aggregate": forced_aggregate,
        "generic_control_rows": control_rows,
        "generic_control_aggregates": control_aggregates,
        "f0_recovery": {
            "max_abs_mass_msun": float(max_f0_mass),
            "max_abs_pressure_prediction_kev_cm3": float(max_f0_prediction),
            "pass": bool(max_f0_mass == 0.0 and max_f0_prediction == 0.0),
        },
        "cluster_states": {name: state_summary(states[name]) for name in names},
        "claim_boundary": (
            "heldout only for the shared f/eta rule; public profile diagnostic, not raw "
            "observational-likelihood proof, unique-kernel evidence, or a physical-law claim"
        ),
        "result_content_sha256": None,
    }
    content = dict(output)
    content["result_content_sha256"] = None
    output["result_content_sha256"] = canonical_sha(content)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
