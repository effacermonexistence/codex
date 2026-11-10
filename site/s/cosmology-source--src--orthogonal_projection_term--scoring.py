from __future__ import annotations
import numpy as np

def cumulative_mass(radii: np.ndarray, rho: np.ndarray) -> np.ndarray:
    radii = np.asarray(radii, dtype=float); rho = np.asarray(rho, dtype=float)
    integ = 4.0*np.pi*radii*radii*rho
    increments = 0.5*(integ[1:]+integ[:-1])*np.diff(radii)
    return np.concatenate([[0.0], np.cumsum(increments)])

def weighted_log_mse(radii: np.ndarray, candidate: np.ndarray, reference: np.ndarray, r_min: float = 3.0, r_max: float = 800.0) -> dict[str, float]:
    radii = np.asarray(radii, dtype=float); candidate = np.asarray(candidate, dtype=float); reference = np.asarray(reference, dtype=float)
    mask = (radii >= r_min) & (radii <= r_max)
    mc = cumulative_mass(radii, candidate); mr = cumulative_mass(radii, reference)
    eps_rho = np.percentile(reference[mask], 5)*1e-6 + 1e-300
    eps_m = np.percentile(mr[mask], 5)*1e-6 + 1e-300
    dr = np.log10(np.maximum(candidate[mask], eps_rho))-np.log10(np.maximum(reference[mask], eps_rho))
    dm = np.log10(np.maximum(mc[mask], eps_m))-np.log10(np.maximum(mr[mask], eps_m))
    chi_rho = float(np.mean(dr*dr)); chi_mass = float(np.mean(dm*dm))
    return {'chi_rho_log_mse': chi_rho, 'chi_mass_log_mse': chi_mass, 'chi_total': 0.35*chi_rho+0.65*chi_mass}
