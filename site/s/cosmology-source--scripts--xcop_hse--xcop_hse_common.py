#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
from astropy.io import fits
from scipy.integrate import cumulative_trapezoid


# Direct formal lane:
#   dP_e/dr = -mu m_p n_e G M_tot(<r) / r^2
# and only the dark-halo density is augmented:
#   rho_dm,aug = (1-f) rho_dm + f (K_d * rho_dm).
MU_PARTICLE = 0.61
MU_ELECTRON = 1.17
M_PROTON_G = 1.67262192369e-24
KPC_CM = 3.085677581491367e21
MSUN_G = 1.988409870698051e33
KEV_ERG = 1.602176634e-9
G_CGS = 6.67430e-8

F_GRID = [0.0, 0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.75, 1.0]
ETA_GRID = [0.005, 0.010, 0.020, 0.040, 0.080, 0.160]
RADIAL_GRID_POINTS = 720
# The dark-halo component is reconstructed by subtracting the published gas and
# stellar profiles from the hydrostatic NFW gravitating profile.  Outside the
# shared component-support window, profile extrapolation can make that
# subtraction nonphysical even though no scored pressure datum lies there.
# The operator is therefore defined on a fixed pre-score window that is common
# to every eligible cluster; the baseline still uses the exact published NFW
# cumulative mass.  A free pressure-boundary constant absorbs the omitted
# integration constant below the inner window edge.
RADIAL_MIN_R500 = 0.005
RADIAL_MAX_R500 = 3.0
RAW_MASS_LEAK_MAX = 0.05
ELIGIBLE_CLUSTERS = ["A1795", "A2029", "A2142", "A2319", "A644", "A85", "ZW1215"]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def canonical_sha(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def hash_order(names: list[str]) -> list[str]:
    return sorted(names, key=lambda name: hashlib.sha256(f"XCOP-HSE-v1:{name}".encode()).hexdigest())


def load_orthogonal_modules(repo: Path) -> dict[str, Any]:
    src = (repo / "src").resolve()
    sys.path.insert(0, str(src))
    try:
        from orthogonal_projection_term.kernels import (  # type: ignore
            gaussian_sigma_for_half_mass,
            plummer_3d_half_mass_radius,
            top_hat_radius_for_half_mass,
        )
        from orthogonal_projection_term.radial import (  # type: ignore
            gaussian_3d_convolve,
            plummer_3d_convolve,
            top_hat_3d_convolve,
        )
        from orthogonal_projection_term.scoring import cumulative_mass  # type: ignore
    finally:
        if sys.path and sys.path[0] == str(src):
            sys.path.pop(0)
    return {
        "gaussian_sigma_for_half_mass": gaussian_sigma_for_half_mass,
        "plummer_3d_half_mass_radius": plummer_3d_half_mass_radius,
        "top_hat_radius_for_half_mass": top_hat_radius_for_half_mass,
        "gaussian_3d_convolve": gaussian_3d_convolve,
        "plummer_3d_convolve": plummer_3d_convolve,
        "top_hat_3d_convolve": top_hat_3d_convolve,
        "cumulative_mass": cumulative_mass,
    }


def cluster_paths(source_root: Path, name: str) -> dict[str, Path]:
    directory = source_root / name

    def one(pattern: str) -> Path:
        matches = sorted(directory.glob(pattern))
        if len(matches) != 1:
            raise RuntimeError(f"{name}: expected one {pattern}, found {len(matches)}")
        return matches[0]

    return {
        "pressure": one("*_pressure.fits"),
        "density": one("*_density_L1.fits"),
        "hydro_mass": one("*_hydro_mass.fits"),
        "fgas": one("*_fgas_profile.fits"),
        "mstar": one("*_mstar.fits"),
    }


def _log_profile(
    target: np.ndarray,
    radius: np.ndarray,
    value: np.ndarray,
    *,
    outer_constant: bool = False,
) -> np.ndarray:
    target = np.asarray(target, dtype=float)
    radius = np.asarray(radius, dtype=float)
    value = np.asarray(value, dtype=float)
    mask = np.isfinite(radius) & np.isfinite(value) & (radius > 0) & (value > 0)
    radius = radius[mask]
    value = value[mask]
    order = np.argsort(radius)
    radius = radius[order]
    value = value[order]
    if radius.size < 5:
        raise RuntimeError("profile has fewer than five usable points")
    log_r = np.log(radius)
    log_v = np.log(value)
    out = np.interp(np.log(target), log_r, log_v)
    slope_lo = float(np.polyfit(log_r[:5], log_v[:5], 1)[0])
    slope_hi = 0.0 if outer_constant else float(np.polyfit(log_r[-5:], log_v[-5:], 1)[0])
    low = target < radius[0]
    high = target > radius[-1]
    out[low] = log_v[0] + slope_lo * np.log(target[low] / radius[0])
    out[high] = log_v[-1] + slope_hi * np.log(target[high] / radius[-1])
    return np.exp(out)


def _published_nfw_normalization(hydro_path: Path) -> tuple[float, float, float, float]:
    with fits.open(hydro_path) as hdul:
        mass = hdul["HYDRO_MASS"].data
        params = hdul["PARAMS"].data
        models = np.char.strip(params["MODEL"].astype(str))
        index = int(np.where(models == "NFW")[0][0])
        r_s = float(params["RS"][index])
        c200 = float(params["C200"][index])
        radius = np.asarray(mass["RADIUS"], dtype=float)
        m_nfw = np.asarray(mass["M_NFW"], dtype=float)
    x = radius / r_s
    shape = np.log1p(x) - x / (1.0 + x)
    rho_s_samples = m_nfw / (4.0 * math.pi * r_s**3 * shape)
    rho_s = float(np.median(rho_s_samples[np.isfinite(rho_s_samples) & (rho_s_samples > 0)]))
    reconstructed = 4.0 * math.pi * rho_s * r_s**3 * shape
    max_relative_error = float(np.max(np.abs(reconstructed - m_nfw) / m_nfw))
    return r_s, c200, rho_s, max_relative_error


def build_cluster_state(source_root: Path, name: str, operator_repo: Path) -> dict[str, Any]:
    paths = cluster_paths(source_root, name)
    with fits.open(paths["pressure"]) as hdul:
        tab = hdul["XRAY"].data
        header = hdul["XRAY"].header
        r500 = float(header["R500"])
        p500 = float(header["P500"])
        observed_r = np.asarray(tab["RW_X"], dtype=float) * r500
        observed_p = np.asarray(tab["P_X"], dtype=float) * p500
        observed_e = np.asarray(tab["eP_X"], dtype=float) * p500
    with fits.open(paths["density"]) as hdul:
        tab = hdul["DENSITY"].data
        density_r = 0.5 * (
            np.asarray(tab["R_IN"], dtype=float) + np.asarray(tab["R_OUT"], dtype=float)
        )
        density_ne = np.asarray(tab["NE"], dtype=float)
    with fits.open(paths["mstar"]) as hdul:
        tab = hdul["MSTAR_SMOOTHED"].data
        stellar_r = np.asarray(tab["RADIUS"], dtype=float)
        stellar_m = np.maximum.accumulate(np.asarray(tab["MSTAR"], dtype=float))

    obs_mask = (
        np.isfinite(observed_r)
        & np.isfinite(observed_p)
        & np.isfinite(observed_e)
        & (observed_r > 0)
        & (observed_p > 0)
        & (observed_e > 0)
        & (observed_r >= density_r.min())
        & (observed_r <= density_r.max())
    )
    observed_r = observed_r[obs_mask]
    observed_p = observed_p[obs_mask]
    observed_e = observed_e[obs_mask]
    if observed_r.size < 8:
        raise RuntimeError(f"{name}: fewer than eight pressure points inside density support")

    grid = np.geomspace(RADIAL_MIN_R500 * r500, RADIAL_MAX_R500 * r500, RADIAL_GRID_POINTS)
    ne_grid = _log_profile(grid, density_r, density_ne)
    rho_gas = ne_grid * MU_ELECTRON * M_PROTON_G * KPC_CM**3 / MSUN_G

    mstar_grid = _log_profile(grid, stellar_r, stellar_m, outer_constant=True)
    d_mstar = np.gradient(mstar_grid, grid, edge_order=2)
    rho_star = np.maximum(d_mstar / (4.0 * math.pi * grid**2), 0.0)

    r_s, c200, rho_s, nfw_reconstruction_error = _published_nfw_normalization(paths["hydro_mass"])
    x = grid / r_s
    rho_total_nfw = rho_s / (x * (1.0 + x) ** 2)
    nfw_mass_exact = 4.0 * math.pi * rho_s * r_s**3 * (np.log1p(x) - x / (1.0 + x))
    rho_dm = rho_total_nfw - rho_gas - rho_star
    negative_fraction = float(np.mean(rho_dm <= 0))
    minimum_dm_to_total = float(np.min(rho_dm / rho_total_nfw))
    if negative_fraction > 0:
        raise RuntimeError(
            f"{name}: baryonic subtraction makes halo density nonpositive "
            f"(fraction={negative_fraction:.6g}, min_ratio={minimum_dm_to_total:.6g})"
        )

    modules = load_orthogonal_modules(operator_repo)
    dm_mass = modules["cumulative_mass"](grid, rho_dm)
    baseline = pressure_score_arrays(grid, ne_grid, nfw_mass_exact, observed_r, observed_p, observed_e)
    return {
        "name": name,
        "paths": {key: str(value) for key, value in paths.items()},
        "r500_kpc": r500,
        "grid_kpc": grid,
        "ne_cm3": ne_grid,
        "rho_gas_msun_kpc3": rho_gas,
        "rho_star_msun_kpc3": rho_star,
        "rho_dm_msun_kpc3": rho_dm,
        "dm_mass_msun": dm_mass,
        "baseline_mass_msun": nfw_mass_exact,
        "observed_r_kpc": observed_r,
        "observed_pressure_kev_cm3": observed_p,
        "observed_error_kev_cm3": observed_e,
        "baseline": baseline,
        "meta": {
            "pressure_points": int(observed_r.size),
            "nfw_r_s_kpc": r_s,
            "nfw_c200": c200,
            "nfw_rho_s_msun_kpc3": rho_s,
            "published_nfw_max_relative_reconstruction_error": nfw_reconstruction_error,
            "minimum_dm_to_total_density_ratio": minimum_dm_to_total,
            "baryonic_subtraction_negative_fraction": negative_fraction,
        },
        "modules": modules,
    }


def pressure_score_arrays(
    grid_kpc: np.ndarray,
    ne_cm3: np.ndarray,
    mass_msun: np.ndarray,
    observed_r_kpc: np.ndarray,
    observed_pressure_kev_cm3: np.ndarray,
    observed_error_kev_cm3: np.ndarray,
) -> dict[str, Any]:
    radius_cm = grid_kpc * KPC_CM
    mass_g = mass_msun * MSUN_G
    source_per_kpc = (
        MU_PARTICLE
        * M_PROTON_G
        * ne_cm3
        * G_CGS
        * mass_g
        / radius_cm**2
        * KPC_CM
        / KEV_ERG
    )
    integral = np.concatenate([[0.0], cumulative_trapezoid(source_per_kpc, grid_kpc)])
    shape = -np.interp(observed_r_kpc, grid_kpc, integral)
    weights = 1.0 / observed_error_kev_cm3**2
    boundary = float(np.sum(weights * (observed_pressure_kev_cm3 - shape)) / np.sum(weights))
    prediction = boundary + shape
    residual = (observed_pressure_kev_cm3 - prediction) / observed_error_kev_cm3
    chi2 = float(np.sum(residual**2))
    return {
        "chi2": chi2,
        "chi2_per_point": chi2 / observed_r_kpc.size,
        "boundary_pressure_kev_cm3": boundary,
        "prediction_kev_cm3": [float(value) for value in prediction],
        "source_integral_at_points_kev_cm3": [
            float(value) for value in np.interp(observed_r_kpc, grid_kpc, integral)
        ],
    }


def prepare_kernel(state: dict[str, Any], kind: str, eta: float) -> dict[str, Any]:
    modules = state["modules"]
    grid = state["grid_kpc"]
    rho_dm = state["rho_dm_msun_kpc3"]
    d_kpc = float(eta * state["r500_kpc"])
    r_half = float(modules["plummer_3d_half_mass_radius"](d_kpc))
    if kind == "plummer":
        native_scale = d_kpc
        convolved = modules["plummer_3d_convolve"](grid, rho_dm, native_scale)
    elif kind == "gaussian":
        native_scale = float(modules["gaussian_sigma_for_half_mass"](r_half))
        convolved = modules["gaussian_3d_convolve"](grid, rho_dm, native_scale, points=801)
    elif kind == "top_hat":
        native_scale = float(modules["top_hat_radius_for_half_mass"](r_half))
        convolved = modules["top_hat_3d_convolve"](grid, rho_dm, native_scale, points=801)
    else:
        raise ValueError(f"unknown kernel: {kind}")
    convolved = np.maximum(np.asarray(convolved, dtype=float), 0.0)
    raw_mass = modules["cumulative_mass"](grid, convolved)
    base_mass = state["dm_mass_msun"]
    raw_leak = float((raw_mass[-1] - base_mass[-1]) / base_mass[-1])
    if abs(raw_leak) > RAW_MASS_LEAK_MAX:
        raise RuntimeError(
            f"{state['name']} {kind} eta={eta}: raw finite-grid mass leak {raw_leak:.6g} "
            f"exceeds {RAW_MASS_LEAK_MAX}"
        )
    correction = float(base_mass[-1] / raw_mass[-1])
    convolved *= correction
    corrected_mass = modules["cumulative_mass"](grid, convolved)
    corrected_leak = float((corrected_mass[-1] - base_mass[-1]) / base_mass[-1])
    return {
        "kind": kind,
        "eta": float(eta),
        "d_kpc": d_kpc,
        "target_half_mass_kpc": r_half,
        "native_scale_kpc": native_scale,
        "convolved_dm_density": convolved,
        "convolved_dm_mass": corrected_mass,
        "raw_mass_leak_fraction": raw_leak,
        "mass_renormalization_factor": correction,
        "mass_leak_fraction": corrected_leak,
    }


def evaluate_prepared(state: dict[str, Any], prepared: dict[str, Any], fraction: float) -> dict[str, Any]:
    fraction = float(fraction)
    if not 0.0 <= fraction <= 1.0:
        raise ValueError("fraction must lie in [0,1]")
    if fraction == 0.0:
        augmented_mass = state["baseline_mass_msun"].copy()
    else:
        mass_delta = prepared["convolved_dm_mass"] - state["dm_mass_msun"]
        augmented_mass = state["baseline_mass_msun"] + fraction * mass_delta
    score = pressure_score_arrays(
        state["grid_kpc"],
        state["ne_cm3"],
        augmented_mass,
        state["observed_r_kpc"],
        state["observed_pressure_kev_cm3"],
        state["observed_error_kev_cm3"],
    )
    delta = float(score["chi2"] - state["baseline"]["chi2"])
    f0_max_abs_mass = 0.0
    f0_max_abs_prediction = 0.0
    if fraction == 0.0:
        f0_max_abs_mass = float(np.max(np.abs(augmented_mass - state["baseline_mass_msun"])))
        f0_max_abs_prediction = float(
            np.max(
                np.abs(
                    np.asarray(score["prediction_kev_cm3"])
                    - np.asarray(state["baseline"]["prediction_kev_cm3"])
                )
            )
        )
    return {
        "cluster": state["name"],
        "kernel": prepared["kind"],
        "f": fraction,
        "eta": float(prepared["eta"]),
        "d_kpc": float(prepared["d_kpc"]),
        "target_half_mass_kpc": float(prepared["target_half_mass_kpc"]),
        "native_scale_kpc": float(prepared["native_scale_kpc"]),
        "pressure_points": int(state["meta"]["pressure_points"]),
        "baseline_chi2": float(state["baseline"]["chi2"]),
        "baseline_chi2_per_point": float(state["baseline"]["chi2_per_point"]),
        "augmented_chi2": float(score["chi2"]),
        "augmented_chi2_per_point": float(score["chi2_per_point"]),
        "delta_chi2": delta,
        "residual_reduction_pct": float(-100.0 * delta / state["baseline"]["chi2"]),
        "downlift": bool(delta > 0.0),
        "boundary_pressure_kev_cm3": float(score["boundary_pressure_kev_cm3"]),
        "raw_mass_leak_fraction": float(prepared["raw_mass_leak_fraction"]),
        "mass_renormalization_factor": float(prepared["mass_renormalization_factor"]),
        "mass_leak_fraction": float(prepared["mass_leak_fraction"]),
        "f0_max_abs_mass_msun": f0_max_abs_mass,
        "f0_max_abs_prediction_kev_cm3": f0_max_abs_prediction,
        "prediction_kev_cm3": score["prediction_kev_cm3"],
    }


def state_summary(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "cluster": state["name"],
        "r500_kpc": float(state["r500_kpc"]),
        "pressure_points": int(state["meta"]["pressure_points"]),
        "baseline_chi2": float(state["baseline"]["chi2"]),
        "baseline_chi2_per_point": float(state["baseline"]["chi2_per_point"]),
        "baseline_boundary_pressure_kev_cm3": float(
            state["baseline"]["boundary_pressure_kev_cm3"]
        ),
        "nfw_r_s_kpc": float(state["meta"]["nfw_r_s_kpc"]),
        "nfw_c200": float(state["meta"]["nfw_c200"]),
        "nfw_rho_s_msun_kpc3": float(state["meta"]["nfw_rho_s_msun_kpc3"]),
        "published_nfw_max_relative_reconstruction_error": float(
            state["meta"]["published_nfw_max_relative_reconstruction_error"]
        ),
        "minimum_dm_to_total_density_ratio": float(
            state["meta"]["minimum_dm_to_total_density_ratio"]
        ),
        "baryonic_subtraction_negative_fraction": float(
            state["meta"]["baryonic_subtraction_negative_fraction"]
        ),
        "observed_r_kpc": [float(value) for value in state["observed_r_kpc"]],
        "observed_pressure_kev_cm3": [
            float(value) for value in state["observed_pressure_kev_cm3"]
        ],
        "observed_error_kev_cm3": [
            float(value) for value in state["observed_error_kev_cm3"]
        ],
        "baseline_prediction_kev_cm3": state["baseline"]["prediction_kev_cm3"],
    }


def aggregate_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        raise ValueError("no rows")
    return {
        "cluster_count": len(rows),
        "point_count": int(sum(row["pressure_points"] for row in rows)),
        "baseline_chi2_sum": float(sum(row["baseline_chi2"] for row in rows)),
        "augmented_chi2_sum": float(sum(row["augmented_chi2"] for row in rows)),
        "delta_chi2_sum": float(sum(row["delta_chi2"] for row in rows)),
        "macro_baseline_chi2_per_point": float(
            np.mean([row["baseline_chi2_per_point"] for row in rows])
        ),
        "macro_augmented_chi2_per_point": float(
            np.mean([row["augmented_chi2_per_point"] for row in rows])
        ),
        "macro_delta_chi2_per_point": float(
            np.mean(
                [
                    row["augmented_chi2_per_point"] - row["baseline_chi2_per_point"]
                    for row in rows
                ]
            )
        ),
        "improved_count": int(sum(row["delta_chi2"] < 0 for row in rows)),
        "neutral_count": int(sum(row["delta_chi2"] == 0 for row in rows)),
        "downlift_count": int(sum(row["delta_chi2"] > 0 for row in rows)),
        "max_abs_raw_mass_leak_fraction": float(
            max(abs(row["raw_mass_leak_fraction"]) for row in rows)
        ),
        "max_abs_corrected_mass_leak_fraction": float(
            max(abs(row["mass_leak_fraction"]) for row in rows)
        ),
    }
