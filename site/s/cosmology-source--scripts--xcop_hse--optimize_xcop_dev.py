#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from xcop_hse_common import (
    ETA_GRID,
    F_GRID,
    aggregate_rows,
    build_cluster_state,
    evaluate_prepared,
    prepare_kernel,
    state_summary,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample-lock", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--operator-repo", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    lock = json.loads(args.sample_lock.read_text())
    if lock.get("status") != "LOCKED_BEFORE_SCIENTIFIC_SCORING":
        raise RuntimeError("sample lock is not frozen")
    names = list(lock["development"])
    states = {
        name: build_cluster_state(args.source_root, name, args.operator_repo) for name in names
    }

    candidates: list[dict] = []
    for eta in ETA_GRID:
        prepared = {name: prepare_kernel(states[name], "plummer", eta) for name in names}
        for fraction in F_GRID:
            rows = [evaluate_prepared(states[name], prepared[name], fraction) for name in names]
            aggregate = aggregate_rows(rows)
            candidates.append(
                {
                    "f": float(fraction),
                    "eta": float(eta),
                    "objective_macro_chi2_per_point": aggregate[
                        "macro_augmented_chi2_per_point"
                    ],
                    "aggregate": aggregate,
                    "rows": rows,
                }
            )

    def key(row: dict) -> tuple[float, float, float]:
        return (
            float(row["objective_macro_chi2_per_point"]),
            float(row["f"]),
            float(row["eta"]),
        )

    safe_best = min(candidates, key=key)
    forced_best = min((row for row in candidates if row["f"] > 0), key=key)
    baseline_macro = float(
        np.mean([state["baseline"]["chi2_per_point"] for state in states.values()])
    )
    output = {
        "schema_version": "xcop-hse-direct-formal-dev-grid-v1",
        "status": "DEVELOPMENT_GRID_COMPLETE",
        "sample_lock_sha256": lock["sample_ids_sha256"],
        "development": names,
        "equations": {
            "baseline": "dP_e/dr = -mu*m_p*n_e*G*M_NFW,total(<r)/r^2",
            "augmented": (
                "dP_e/dr = -mu*m_p*n_e*G*[M_NFW,total(<r) + "
                "f*(M[K_d*rho_dm]-M[rho_dm])]/r^2"
            ),
            "operator_object": (
                "rho_dm = rho_NFW,total - rho_gas - rho_star; gas and stellar "
                "components remain unchanged"
            ),
        },
        "score": (
            "diagonal X-ray electron-pressure chi2 after analytically profiling one "
            "additive pressure-boundary nuisance in each arm"
        ),
        "baseline_macro_chi2_per_point": baseline_macro,
        "safe_best": safe_best,
        "forced_nonzero_best": forced_best,
        "cluster_states": {name: state_summary(states[name]) for name in names},
        "candidate_count": len(candidates),
        "candidates": candidates,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
