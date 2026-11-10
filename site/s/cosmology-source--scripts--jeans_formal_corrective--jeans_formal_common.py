#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path
from typing import Any, Callable

import numpy as np
from scipy.integrate import trapezoid
from scipy.optimize import minimize, minimize_scalar


G_KPC_KMS2_MSUN = 4.30091e-6
F_GRID = [0.0, 0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.75, 1.0]
ETA_GRID = [0.03125, 0.0625, 0.125, 0.25, 0.50, 1.0, 2.0, 4.0, 8.0]
RADIAL_GRID_POINTS = 900
RAW_MASS_LEAK_MAX = 0.02


GALAXIES: dict[str, dict[str, float | str]] = {
    "Carina": {
        "table": "table2.dat",
        "ra_deg": 15.0 * (6.0 + 41.0 / 60.0 + 37.0 / 3600.0),
        "dec_deg": -(50.0 + 58.0 / 60.0),
        "distance_kpc": 101.0,
        "rhalf_kpc": 0.241,
        "rhalf_err_kpc": 0.023,
        "global_sigma_kms": 6.6,
        "luminosity_lsun": 2.4e5,
    },
    "Fornax": {
        "table": "table3.dat",
        "ra_deg": 15.0 * (2.0 + 40.0 / 60.0 + 4.0 / 3600.0),
        "dec_deg": -(34.0 + 31.0 / 60.0),
        "distance_kpc": 138.0,
        "rhalf_kpc": 0.668,
        "rhalf_err_kpc": 0.034,
        "global_sigma_kms": 11.7,
        "luminosity_lsun": 1.4e7,
    },
    "Sculptor": {
        "table": "table4.dat",
        "ra_deg": 15.0 * (1.0 + 9.0 / 3600.0),
        "dec_deg": -(33.0 + 42.0 / 60.0 + 30.0 / 3600.0),
        "distance_kpc": 79.0,
        "rhalf_kpc": 0.260,
        "rhalf_err_kpc": 0.039,
        "global_sigma_kms": 9.2,
        "luminosity_lsun": 1.4e6,
    },
    "Sextans": {
        "table": "table5.dat",
        "ra_deg": 15.0 * (10.0 + 13.0 / 60.0 + 3.0 / 3600.0),
        "dec_deg": -(1.0 + 36.0 / 60.0 + 54.0 / 3600.0),
        "distance_kpc": 86.0,
        "rhalf_kpc": 0.682,
        "rhalf_err_kpc": 0.117,
        "global_sigma_kms": 7.9,
        "luminosity_lsun": 4.1e5,
    },
}


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
    return sorted(names, key=lambda x: hashlib.sha256(x.encode("utf-8")).hexdigest())


def _field(line: str, start: int, end: int) -> str:
    return line[start:end].strip()


def _float_or_none(text: str) -> float | None:
    try:
        return float(text) if text else None
    except ValueError:
        return None


def read_member_catalog(path: Path, meta: dict[str, Any]) -> dict[str, np.ndarray]:
    """Parse the one membership-summary row per star from Walker et al. (2009)."""
    rows: list[tuple[float, float, float, float, float]] = []
    for line in path.read_text(errors="replace").splitlines():
        # A valid membership-summary row can end exactly at byte 98 when no
        # weighted-mean columns follow; Mmb itself occupies bytes 94-98.
        if len(line) < 98:
            continue
        membership = _float_or_none(_field(line, 93, 98))
        if membership is None or membership < 0.95:
            continue
        rah = _float_or_none(_field(line, 23, 25))
        ram = _float_or_none(_field(line, 26, 28))
        ras = _float_or_none(_field(line, 29, 34))
        ded = _float_or_none(_field(line, 36, 38))
        dem = _float_or_none(_field(line, 39, 41))
        des = _float_or_none(_field(line, 42, 46))
        if None in (rah, ram, ras, ded, dem, des):
            continue
        sign = -1.0 if _field(line, 35, 36) == "-" else 1.0
        ra_deg = 15.0 * (rah + ram / 60.0 + ras / 3600.0)
        dec_deg = sign * (ded + dem / 60.0 + des / 3600.0)
        hv = _float_or_none(_field(line, 99, 104))
        hv_err = _float_or_none(_field(line, 105, 108))
        if hv is None or hv_err is None:
            hv = _float_or_none(_field(line, 59, 65))
            hv_err = _float_or_none(_field(line, 66, 70))
        if hv is None or hv_err is None or hv_err <= 0:
            continue
        rows.append((ra_deg, dec_deg, hv, hv_err, membership))
    if not rows:
        raise RuntimeError(f"no member rows parsed from {path}")
    arr = np.asarray(rows, dtype=float)
    ra0 = math.radians(float(meta["ra_deg"]))
    dec0 = math.radians(float(meta["dec_deg"]))
    ra = np.radians(arr[:, 0])
    dec = np.radians(arr[:, 1])
    dra = (ra - ra0 + math.pi) % (2.0 * math.pi) - math.pi
    x = float(meta["distance_kpc"]) * dra * math.cos(dec0)
    y = float(meta["distance_kpc"]) * (dec - dec0)
    radius = np.hypot(x, y)
    return {
        "x_kpc": x,
        "y_kpc": y,
        "radius_kpc": radius,
        "velocity_kms": arr[:, 2],
        "velocity_error_kms": arr[:, 3],
        "membership": arr[:, 4],
    }


def _intrinsic_dispersion(v: np.ndarray, e: np.ndarray) -> tuple[float, float, float]:
    """Heteroscedastic Gaussian MLE with deterministic profile-curvature error."""
    v = np.asarray(v, dtype=float)
    e = np.asarray(e, dtype=float)

    def nll(log_sigma: float) -> float:
        sigma2 = math.exp(2.0 * log_sigma)
        var = sigma2 + e * e
        w = 1.0 / var
        mu = float(np.sum(w * v) / np.sum(w))
        return float(0.5 * np.sum(np.log(var) + (v - mu) ** 2 / var))

    fit = minimize_scalar(
        nll,
        bounds=(math.log(0.05), math.log(50.0)),
        method="bounded",
        options={"xatol": 1e-10},
    )
    if not fit.success:
        raise RuntimeError("dispersion MLE failed")
    ls = float(fit.x)
    sigma = math.exp(ls)
    var = sigma * sigma + e * e
    w = 1.0 / var
    mu = float(np.sum(w * v) / np.sum(w))
    h = 1e-3
    curvature = max((nll(ls + h) - 2.0 * nll(ls) + nll(ls - h)) / (h * h), 1e-12)
    sigma_error = max(sigma / math.sqrt(curvature), 0.05)
    return sigma, sigma_error, mu


def build_dispersion_profile(member: dict[str, np.ndarray]) -> dict[str, Any]:
    """Remove one global planar velocity gradient, then form equal-count radial bins."""
    x = member["x_kpc"]
    y = member["y_kpc"]
    v = member["velocity_kms"]
    design = np.column_stack([np.ones_like(x), x, y])
    coeff, *_ = np.linalg.lstsq(design, v, rcond=None)
    residual = v - design @ coeff
    order = np.argsort(member["radius_kpc"])
    n = len(order)
    n_bins = int(min(20, max(8, round(math.sqrt(n) / 2.0))))
    groups = [g for g in np.array_split(order, n_bins) if len(g) >= 8]
    bins: list[dict[str, float | int]] = []
    for idx in groups:
        sigma, sigma_error, local_mean = _intrinsic_dispersion(
            residual[idx], member["velocity_error_kms"][idx]
        )
        bins.append(
            {
                "radius_kpc": float(np.median(member["radius_kpc"][idx])),
                "radius_min_kpc": float(np.min(member["radius_kpc"][idx])),
                "radius_max_kpc": float(np.max(member["radius_kpc"][idx])),
                "sigma_los_kms": sigma,
                "sigma_error_kms": sigma_error,
                "local_mean_residual_kms": local_mean,
                "member_count": int(len(idx)),
            }
        )
    if len(bins) < 8:
        raise RuntimeError("too few dispersion-profile bins")
    return {
        "member_count": int(n),
        "bin_count": int(len(bins)),
        "gradient_coefficients_kms": [float(z) for z in coeff],
        "gradient_method": "ordinary least squares v=intercept+gx*x+gy*y; residuals binned",
        "binning_method": "equal-count radial bins; n_bins=min(20,max(8,round(sqrt(N)/2)))",
        "dispersion_method": "heteroscedastic Gaussian MLE with profile-curvature uncertainty",
        "bins": bins,
    }


def load_r2_hasher(r2_root: Path) -> tuple[Path, Callable[[list[str]], str]]:
    r2_root = r2_root.resolve()
    source = r2_root / "benchmark_replay_harness.py"
    sys.path.insert(0, str(r2_root))
    try:
        spec = importlib.util.spec_from_file_location("r2_benchmark_replay_harness", source)
        if spec is None or spec.loader is None:
            raise RuntimeError("could not load R2 benchmark_replay_harness")
        mod = importlib.util.module_from_spec(spec)
        # Python 3.9 dataclasses resolve forward annotations through sys.modules.
        sys.modules[spec.name] = mod
        spec.loader.exec_module(mod)
    finally:
        if sys.path and sys.path[0] == str(r2_root):
            sys.path.pop(0)
    return source, mod.sample_ids_sha256


def load_orthogonal_modules(repo: Path) -> dict[str, Any]:
    src = (repo / "src").resolve()
    sys.path.insert(0, str(src))
    try:
        from orthogonal_projection_term.kernels import (  # type: ignore
            gaussian_sigma_for_half_mass,
            plummer_3d_half_mass_radius,
            top_hat_radius_for_half_mass,
        )
        from orthogonal_projection_term.operators import augment  # type: ignore
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
        "augment": augment,
        "cumulative_mass": cumulative_mass,
        "plummer_3d_convolve": plummer_3d_convolve,
        "gaussian_3d_convolve": gaussian_3d_convolve,
        "top_hat_3d_convolve": top_hat_3d_convolve,
        "plummer_3d_half_mass_radius": plummer_3d_half_mass_radius,
        "gaussian_sigma_for_half_mass": gaussian_sigma_for_half_mass,
        "top_hat_radius_for_half_mass": top_hat_radius_for_half_mass,
    }


def profile_arrays(profile: dict[str, Any]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    bins = profile["bins"]
    return (
        np.asarray([x["radius_kpc"] for x in bins], dtype=float),
        np.asarray([x["sigma_los_kms"] for x in bins], dtype=float),
        np.asarray([x["sigma_error_kms"] for x in bins], dtype=float),
    )


def radial_grid(meta: dict[str, Any], profile: dict[str, Any]) -> np.ndarray:
    radius, _, _ = profile_arrays(profile)
    a = float(meta["rhalf_kpc"])
    rmin = min(1e-4 * a, max(float(radius.min()) * 1e-3, 1e-6))
    rmax = max(500.0 * a, 30.0 * float(radius.max()), 80.0)
    return np.geomspace(rmin, rmax, RADIAL_GRID_POINTS)


def plummer_tracer_density(r: np.ndarray, a: float) -> np.ndarray:
    return 3.0 / (4.0 * math.pi * a**3) * (1.0 + (r / a) ** 2) ** -2.5


def plummer_surface_density(r: np.ndarray, a: float) -> np.ndarray:
    return 1.0 / (math.pi * a * a) * (1.0 + (r / a) ** 2) ** -2.0


def stellar_mass_profile(r: np.ndarray, mass: float, a: float) -> np.ndarray:
    return mass * r**3 / np.maximum((r * r + a * a) ** 1.5, 1e-300)


def nfw_density(r: np.ndarray, rho_s: float, r_s: float) -> np.ndarray:
    x = np.maximum(r / r_s, 1e-12)
    return rho_s / (x * (1.0 + x) ** 2)


def nfw_mass(r: np.ndarray, rho_s: float, r_s: float) -> np.ndarray:
    x = np.maximum(r / r_s, 1e-12)
    return 4.0 * math.pi * rho_s * r_s**3 * (np.log1p(x) - x / (1.0 + x))


def jeans_sigma_los(
    observed_r: np.ndarray,
    grid_r: np.ndarray,
    total_mass: np.ndarray,
    a: float,
    beta: float,
) -> np.ndarray:
    nu = plummer_tracer_density(grid_r, a)
    integrand = nu * G_KPC_KMS2_MSUN * total_mass * grid_r ** (2.0 * beta - 2.0)
    increments = 0.5 * (integrand[1:] + integrand[:-1]) * np.diff(grid_r)
    tail = np.concatenate([np.cumsum(increments[::-1])[::-1], [0.0]])
    radial_pressure = tail / np.maximum(grid_r ** (2.0 * beta), 1e-300)
    projected: list[float] = []
    for R in observed_r:
        zmax = math.sqrt(max(grid_r[-1] ** 2 - R**2, 1e-12))
        zmin = max(grid_r[0] * 0.1, zmax * 1e-10)
        z = np.concatenate([[0.0], np.geomspace(zmin, zmax, 520)])
        rr = np.sqrt(R * R + z * z)
        pressure = np.interp(np.log(rr), np.log(grid_r), radial_pressure)
        factor = 1.0 - beta * R * R / np.maximum(rr * rr, 1e-300)
        numerator = 2.0 * trapezoid(factor * pressure, z)
        sigma2 = numerator / plummer_surface_density(np.asarray([R]), a)[0]
        projected.append(math.sqrt(max(float(sigma2), 1e-12)))
    return np.asarray(projected, dtype=float)


def _score(prediction: np.ndarray, observed: np.ndarray, errors: np.ndarray) -> float:
    return float(np.sum(((prediction - observed) / errors) ** 2))


def _baseline_prediction(
    pars: np.ndarray,
    meta: dict[str, Any],
    profile: dict[str, Any],
    grid: np.ndarray,
) -> np.ndarray:
    log_rho, log_rs, beta = [float(x) for x in pars]
    rho_s = 10.0**log_rho
    r_s = 10.0**log_rs
    observed_r, _, _ = profile_arrays(profile)
    mstar = float(meta["luminosity_lsun"])
    total = stellar_mass_profile(grid, mstar, float(meta["rhalf_kpc"]))
    total += nfw_mass(grid, rho_s, r_s)
    return jeans_sigma_los(observed_r, grid, total, float(meta["rhalf_kpc"]), beta)


def fit_baseline(name: str, meta: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    grid = radial_grid(meta, profile)
    _, observed, errors = profile_arrays(profile)
    bounds = [(4.0, 12.0), (-2.0, 2.5), (-5.0, 0.95)]
    starts = [
        (7.0, -0.3, -0.5),
        (7.0, 0.3, 0.0),
        (7.0, 0.8, 0.5),
        (8.0, -0.3, 0.0),
        (8.0, 0.3, -0.5),
        (8.0, 0.8, 0.5),
        (9.0, -0.3, 0.5),
        (9.0, 0.3, 0.0),
        (9.0, 0.8, -0.5),
        (10.0, 0.3, 0.0),
    ]

    def objective(pars: np.ndarray) -> float:
        pred = _baseline_prediction(pars, meta, profile, grid)
        if not np.all(np.isfinite(pred)):
            return 1e100
        return _score(pred, observed, errors)

    fits = []
    for start in starts:
        result = minimize(
            objective,
            np.asarray(start, dtype=float),
            method="L-BFGS-B",
            bounds=bounds,
            options={"ftol": 1e-12, "gtol": 1e-8, "maxiter": 800, "maxls": 50},
        )
        fits.append(result)
    best = min(fits, key=lambda x: float(x.fun))
    pars = np.asarray(best.x, dtype=float)
    prediction = _baseline_prediction(pars, meta, profile, grid)
    boundary = {
        "log10_rho_s": bool(
            abs(pars[0] - bounds[0][0]) < 1e-4 or abs(pars[0] - bounds[0][1]) < 1e-4
        ),
        "log10_r_s": bool(
            abs(pars[1] - bounds[1][0]) < 1e-4 or abs(pars[1] - bounds[1][1]) < 1e-4
        ),
        "beta": bool(
            abs(pars[2] - bounds[2][0]) < 1e-4 or abs(pars[2] - bounds[2][1]) < 1e-4
        ),
    }
    stable = bool(
        best.success
        and np.all(np.isfinite(prediction))
        and not any(boundary.values())
    )
    return {
        "name": name,
        "meta": meta,
        "profile": profile,
        "grid_r": grid,
        "log10_rho_s": float(pars[0]),
        "log10_r_s_kpc": float(pars[1]),
        "beta": float(pars[2]),
        "rho_s_msun_kpc3": float(10.0 ** pars[0]),
        "r_s_kpc": float(10.0 ** pars[1]),
        "base_prediction_kms": prediction,
        "base_chi2": float(best.fun),
        "optimizer_success": bool(best.success),
        "optimizer_message": str(best.message),
        "optimizer_boundary_hits": boundary,
        "optimizer_start_count": len(starts),
        "stable": stable,
    }


def _halo_mass_from_density(ops: dict[str, Any], grid: np.ndarray, rho: np.ndarray) -> np.ndarray:
    return np.asarray(ops["cumulative_mass"](grid, rho), dtype=float)


def prepare_kernel(
    state: dict[str, Any],
    ops: dict[str, Any],
    kind: str,
    eta: float,
) -> dict[str, Any]:
    grid = state["grid_r"]
    rho_base = nfw_density(grid, state["rho_s_msun_kpc3"], state["r_s_kpc"])
    d = float(eta) * float(state["meta"]["rhalf_kpc"])
    if kind == "plummer_3d":
        rho_conv = ops["plummer_3d_convolve"](grid, rho_base, d)
        native_scale = d
    else:
        half_mass = ops["plummer_3d_half_mass_radius"](d)
        if kind == "gaussian_3d":
            native_scale = ops["gaussian_sigma_for_half_mass"](half_mass)
            rho_conv = ops["gaussian_3d_convolve"](grid, rho_base, native_scale, points=801)
        elif kind == "top_hat_3d":
            native_scale = ops["top_hat_radius_for_half_mass"](half_mass)
            rho_conv = ops["top_hat_3d_convolve"](grid, rho_base, native_scale, points=801)
        else:
            raise ValueError(f"unknown kernel {kind}")
    # Use the exact analytic NFW cumulative mass for the baseline arm.  This
    # keeps f=0 identical to the fitted Jeans baseline instead of introducing
    # a second quadrature approximation merely by entering the adapter path.
    m_base = nfw_mass(grid, state["rho_s_msun_kpc3"], state["r_s_kpc"])
    m_raw = _halo_mass_from_density(ops, grid, rho_conv)
    if m_raw[-1] <= 0:
        raise RuntimeError("convolved halo mass is not positive")
    raw_leak = float(m_raw[-1] / m_base[-1] - 1.0)
    factor = float(m_base[-1] / m_raw[-1])
    rho_conv_corrected = rho_conv * factor
    m_conv = _halo_mass_from_density(ops, grid, rho_conv_corrected)
    corrected_leak = float(m_conv[-1] / m_base[-1] - 1.0)
    return {
        "kind": kind,
        "eta": float(eta),
        "d_kpc": d,
        "native_scale_kpc": float(native_scale),
        "rho_base": rho_base,
        "rho_convolved": rho_conv_corrected,
        "mass_base": m_base,
        "mass_convolved": m_conv,
        "raw_mass_leak_fraction": raw_leak,
        "mass_renormalization_factor": factor,
        "mass_leak_fraction": corrected_leak,
    }


def evaluate_prepared(
    state: dict[str, Any],
    ops: dict[str, Any],
    prepared: dict[str, Any],
    f: float,
) -> dict[str, Any]:
    observed_r, observed, errors = profile_arrays(state["profile"])
    grid = state["grid_r"]
    halo_mass = ops["augment"](prepared["mass_base"], prepared["mass_convolved"], f)
    stellar = stellar_mass_profile(
        grid, float(state["meta"]["luminosity_lsun"]), float(state["meta"]["rhalf_kpc"])
    )
    total = stellar + halo_mass
    prediction = jeans_sigma_los(
        observed_r, grid, total, float(state["meta"]["rhalf_kpc"]), float(state["beta"])
    )
    chi2 = _score(prediction, observed, errors)
    if f == 0.0:
        f0_max_abs = float(np.max(np.abs(prediction - state["base_prediction_kms"])))
    else:
        exact0_mass = ops["augment"](prepared["mass_base"], prepared["mass_convolved"], 0.0)
        exact0 = jeans_sigma_los(
            observed_r,
            grid,
            stellar + exact0_mass,
            float(state["meta"]["rhalf_kpc"]),
            float(state["beta"]),
        )
        f0_max_abs = float(np.max(np.abs(exact0 - state["base_prediction_kms"])))
    delta = float(chi2 - state["base_chi2"])
    return {
        "kernel": prepared["kind"],
        "f": float(f),
        "eta": float(prepared["eta"]),
        "d_kpc": float(prepared["d_kpc"]),
        "native_scale_kpc": float(prepared["native_scale_kpc"]),
        "chi2": chi2,
        "delta_chi2": delta,
        "chi2_per_point": chi2 / len(observed_r),
        "residual_reduction_pct": float(-100.0 * delta / state["base_chi2"]),
        "downlift": bool(delta > 0.0),
        "prediction_kms": [float(x) for x in prediction],
        "raw_mass_leak_fraction": float(prepared["raw_mass_leak_fraction"]),
        "mass_renormalization_factor": float(prepared["mass_renormalization_factor"]),
        "mass_leak_fraction": float(prepared["mass_leak_fraction"]),
        "f0_max_abs_kms": f0_max_abs,
    }


def state_summary(state: dict[str, Any]) -> dict[str, Any]:
    radius, observed, errors = profile_arrays(state["profile"])
    return {
        "galaxy": state["name"],
        "member_count": state["profile"]["member_count"],
        "bin_count": len(radius),
        "rhalf_kpc": float(state["meta"]["rhalf_kpc"]),
        "baseline_parameters": {
            "log10_rho_s_msun_kpc3": float(state["log10_rho_s"]),
            "r_s_kpc": float(state["r_s_kpc"]),
            "beta": float(state["beta"]),
            "stellar_mass_msun_fixed_ml1": float(state["meta"]["luminosity_lsun"]),
        },
        "baseline_chi2": float(state["base_chi2"]),
        "baseline_chi2_per_point": float(state["base_chi2"] / len(radius)),
        "baseline_prediction_kms": [float(x) for x in state["base_prediction_kms"]],
        "observed_radius_kpc": [float(x) for x in radius],
        "observed_sigma_kms": [float(x) for x in observed],
        "observed_sigma_error_kms": [float(x) for x in errors],
        "optimizer_success": bool(state["optimizer_success"]),
        "optimizer_message": state["optimizer_message"],
        "optimizer_boundary_hits": state["optimizer_boundary_hits"],
        "baseline_stable": bool(state["stable"]),
    }


# Corrective run: the only candidate is the direct halo-density source insertion.
# No nuisance-tangent or response-space adapter is defined in this module.


FRESH_GALAXIES: dict[str, dict[str, float | str]] = {
    "Draco": {
        "table": "table3.dat",
        "ra_deg": 15.0 * (17.0 + 20.0 / 60.0 + 12.4 / 3600.0),
        "dec_deg": 57.0 + 54.0 / 60.0 + 55.0 / 3600.0,
        "distance_kpc": 76.0,
        "rhalf_kpc": 0.221,
        "rhalf_err_kpc": 0.019,
        "global_sigma_kms": 9.1,
        "luminosity_lsun": 2.9e5,
        "source_structural_row": "McConnachie 2012 VizieR J/AJ/144/4",
    },
    "Ursa Minor": {
        "table": "table4.dat",
        "ra_deg": 15.0 * (15.0 + 9.0 / 60.0 + 8.5 / 3600.0),
        "dec_deg": 67.0 + 13.0 / 60.0 + 21.0 / 3600.0,
        "distance_kpc": 76.0,
        "rhalf_kpc": 0.181,
        "rhalf_err_kpc": 0.027,
        "global_sigma_kms": 9.5,
        "luminosity_lsun": 2.9e5,
        "source_structural_row": "McConnachie 2012 VizieR J/AJ/144/4",
    },
}


def read_spencer_multi_epoch_catalog(
    path: Path,
    meta: dict[str, Any],
    *,
    binary_p_threshold: float = 1.0e-3,
) -> tuple[dict[str, np.ndarray], dict[str, Any]]:
    """Build one systemic-velocity row per published multi-epoch member star.

    Tables 3/4 of Spencer et al. (2018) contain only the multi-epoch member
    sample.  A constant-velocity inverse-variance fit is used per star.  Stars
    with a constant-velocity chi-square survival probability below the
    predeclared threshold are removed as velocity-variable binary candidates.
    """
    from scipy.stats import chi2 as chi2_distribution

    grouped: dict[str, list[tuple[float, float, float, float]]] = {}
    for line in path.read_text(errors="replace").splitlines():
        if len(line) < 62:
            continue
        star_id = _field(line, 0, 13)
        rah = _float_or_none(_field(line, 17, 19))
        ram = _float_or_none(_field(line, 20, 22))
        ras = _float_or_none(_field(line, 23, 28))
        ded = _float_or_none(_field(line, 29, 31))
        dem = _float_or_none(_field(line, 32, 34))
        des = _float_or_none(_field(line, 35, 40))
        rv = _float_or_none(_field(line, 51, 57))
        rv_error = _float_or_none(_field(line, 58, 62))
        if not star_id or None in (rah, ram, ras, ded, dem, des, rv, rv_error):
            continue
        if float(rv_error) <= 0.0:
            continue
        sign = -1.0 if _field(line, 28, 29) == "-" else 1.0
        ra_deg = 15.0 * (float(rah) + float(ram) / 60.0 + float(ras) / 3600.0)
        dec_deg = sign * (float(ded) + float(dem) / 60.0 + float(des) / 3600.0)
        grouped.setdefault(star_id, []).append(
            (ra_deg, dec_deg, float(rv), float(rv_error))
        )
    rows: list[tuple[float, float, float, float, float]] = []
    excluded: list[dict[str, Any]] = []
    observation_count = 0
    for star_id in sorted(grouped):
        obs = np.asarray(grouped[star_id], dtype=float)
        observation_count += len(obs)
        weights = 1.0 / np.maximum(obs[:, 3] ** 2, 1.0e-12)
        velocity = float(np.sum(weights * obs[:, 2]) / np.sum(weights))
        velocity_error = float(math.sqrt(1.0 / np.sum(weights)))
        chi2 = float(np.sum(((obs[:, 2] - velocity) / obs[:, 3]) ** 2))
        dof = max(len(obs) - 1, 1)
        p_constant = float(chi2_distribution.sf(chi2, dof))
        if p_constant < binary_p_threshold:
            excluded.append(
                {
                    "star_id": star_id,
                    "observation_count": int(len(obs)),
                    "constant_velocity_chi2": chi2,
                    "dof": int(dof),
                    "p_constant": p_constant,
                }
            )
            continue
        rows.append(
            (
                float(np.average(obs[:, 0], weights=weights)),
                float(np.average(obs[:, 1], weights=weights)),
                velocity,
                velocity_error,
                1.0,
            )
        )
    if not rows:
        raise RuntimeError(f"no non-variable member rows parsed from {path}")
    arr = np.asarray(rows, dtype=float)
    ra0 = math.radians(float(meta["ra_deg"]))
    dec0 = math.radians(float(meta["dec_deg"]))
    ra = np.radians(arr[:, 0])
    dec = np.radians(arr[:, 1])
    dra = (ra - ra0 + math.pi) % (2.0 * math.pi) - math.pi
    x = float(meta["distance_kpc"]) * dra * math.cos(dec0)
    y = float(meta["distance_kpc"]) * (dec - dec0)
    member = {
        "x_kpc": x,
        "y_kpc": y,
        "radius_kpc": np.hypot(x, y),
        "velocity_kms": arr[:, 2],
        "velocity_error_kms": arr[:, 3],
        "membership": arr[:, 4],
    }
    receipt = {
        "published_multi_epoch_star_count": int(len(grouped)),
        "published_velocity_observation_count": int(observation_count),
        "binary_candidate_p_threshold": float(binary_p_threshold),
        "binary_candidate_excluded_count": int(len(excluded)),
        "retained_systemic_velocity_count": int(len(rows)),
        "excluded_binary_candidates": excluded,
        "systemic_velocity_rule": "inverse-variance constant-velocity fit per star",
    }
    return member, receipt


