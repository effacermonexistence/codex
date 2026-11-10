#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from xcop_hse_common import aggregate_rows, canonical_sha, sha256_file


def close(a: float, b: float, tolerance: float = 1e-10) -> bool:
    return math.isclose(float(a), float(b), rel_tol=tolerance, abs_tol=tolerance)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--replay-result", type=Path, required=True)
    parser.add_argument("--common-code", type=Path, required=True)
    parser.add_argument("--output-json", type=Path, required=True)
    parser.add_argument("--output-md", type=Path, required=True)
    args = parser.parse_args()

    result = json.loads(args.result.read_text())
    replay = json.loads(args.replay_result.read_text())
    checks: dict[str, bool] = {}
    for label, key in (
        ("safe", "safe"),
        ("forced_nonzero", "forced_nonzero"),
    ):
        rows = result[f"{key}_rows"]
        recomputed = aggregate_rows(rows)
        saved = result[f"{key}_aggregate"]
        checks[f"{label}_arithmetic"] = all(
            close(recomputed[field], saved[field])
            if isinstance(saved[field], float)
            else recomputed[field] == saved[field]
            for field in recomputed
        )
        checks[f"{label}_row_delta_identity"] = all(
            close(row["augmented_chi2"] - row["baseline_chi2"], row["delta_chi2"])
            for row in rows
        )
        checks[f"{label}_percent_identity"] = all(
            close(
                -100.0 * row["delta_chi2"] / row["baseline_chi2"],
                row["residual_reduction_pct"],
            )
            for row in rows
        )
    for kernel in ("gaussian", "top_hat"):
        rows = result["generic_control_rows"][kernel]
        recomputed = aggregate_rows(rows)
        saved = result["generic_control_aggregates"][kernel]
        checks[f"{kernel}_arithmetic"] = all(
            close(recomputed[field], saved[field])
            if isinstance(saved[field], float)
            else recomputed[field] == saved[field]
            for field in recomputed
        )

    result_content = dict(result)
    claimed_hash = result_content.pop("result_content_sha256")
    result_content["result_content_sha256"] = None
    checks["content_hash"] = canonical_sha(result_content) == claimed_hash
    replay_content = dict(replay)
    replay_claimed = replay_content.pop("result_content_sha256")
    replay_content["result_content_sha256"] = None
    checks["replay_internal_hash"] = canonical_sha(replay_content) == replay_claimed
    checks["deterministic_replay"] = result == replay
    checks["f0_exact"] = bool(result["f0_recovery"]["pass"])
    checks["overlap_zero"] = int(result["overlap_count"]) == 0
    common_text = args.common_code.read_text()
    checks["direct_equation_present"] = (
        "dP_e/dr = -mu m_p n_e G M_tot(<r) / r^2" in common_text
        and "rho_dm,aug = (1-f) rho_dm + f (K_d * rho_dm)" in common_text
    )
    checks["no_total_profile_smoothing"] = "convolved_dm_density" in common_text
    passed = all(checks.values())
    audit = {
        "schema_version": "xcop-hse-direct-formal-independent-audit-v1",
        "status": "PASS" if passed else "FAIL",
        "checks": checks,
        "result_sha256": sha256_file(args.result),
        "replay_result_sha256": sha256_file(args.replay_result),
        "common_code_sha256": sha256_file(args.common_code),
        "safe_aggregate": result["safe_aggregate"],
        "forced_nonzero_aggregate": result["forced_nonzero_aggregate"],
        "generic_control_aggregates": result["generic_control_aggregates"],
        "claim_boundary": result["claim_boundary"],
    }
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(audit, indent=2, sort_keys=True) + "\n")
    lines = [
        "# X-COP direct hydrostatic-equation audit",
        "",
        f"**Verdict: {'PASS' if passed else 'FAIL'}**",
        "",
        "## Locked equations",
        "",
        f"- Baseline: `{result['equations']['baseline']}`",
        f"- Augmented: `{result['equations']['augmented']}`",
        f"- Object X: `{result['equations']['rho_dm_definition']}` only.",
        "- Gas and stellar components were not smoothed.",
        "",
        "## Verification",
        "",
    ]
    lines.extend(f"- {'PASS' if value else 'FAIL'} — `{key}`" for key, value in checks.items())
    lines.extend(
        [
            "",
            "## Claim boundary",
            "",
            result["claim_boundary"],
            "",
        ]
    )
    args.output_md.write_text("\n".join(lines))
    if not passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
