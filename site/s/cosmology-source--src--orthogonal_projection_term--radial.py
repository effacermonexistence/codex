from __future__ import annotations
import math
import numpy as np
from scipy.integrate import trapezoid

def _interp_density(rp: np.ndarray, radii: np.ndarray, rho: np.ndarray) -> np.ndarray:
    lr = np.log(radii)
    lrho = np.log(np.maximum(rho, 1e-300))
    safe = np.maximum(rp, radii[0])
    out = np.exp(np.interp(np.log(safe), lr, lrho))
    out[rp > radii[-1]] = 0.0
    return out

def _local_grid(r: float, radii: np.ndarray, half_width: float, points: int) -> np.ndarray:
    lo = max(1e-8, r-half_width)
    hi = min(float(radii[-1]+half_width), r+half_width)
    return np.unique(np.concatenate([radii, np.linspace(lo, hi, points)]))

def plummer_3d_convolve(radii: np.ndarray, rho: np.ndarray, scale: float) -> np.ndarray:
    """Spherical convolution matching the frozen 3D implementation."""
    radii = np.asarray(radii, dtype=float); rho = np.asarray(rho, dtype=float)
    out = np.empty_like(radii)
    lr = np.log(radii); lrho = np.log(np.maximum(rho, 1e-300))
    for i, r in enumerate(radii):
        near = r + np.linspace(-30*scale, 30*scale, 121)
        rp = np.unique(np.concatenate([radii, near[near > 0]]))
        rho_p = np.exp(np.interp(np.log(rp), lr, lrho)); rho_p[rp > radii[-1]] = 0.0
        f1 = (1.0 + ((r-rp)/scale)**2) ** -1.5
        f2 = (1.0 + ((r+rp)/scale)**2) ** -1.5
        out[i] = trapezoid(rp*rho_p*(f1-f2), rp) / (2*r*scale)
    return out

def gaussian_3d_convolve(radii: np.ndarray, rho: np.ndarray, sigma: float, points: int = 1601) -> np.ndarray:
    radii = np.asarray(radii, dtype=float); rho = np.asarray(rho, dtype=float)
    out = np.empty_like(radii)
    for i, r in enumerate(radii):
        rp = _local_grid(float(r), radii, 10*sigma, points)
        rho_p = _interp_density(rp, radii, rho)
        em = np.exp(-0.5*((r-rp)/sigma)**2); ep = np.exp(-0.5*((r+rp)/sigma)**2)
        out[i] = trapezoid(rp*rho_p*(em-ep), rp) / (math.sqrt(2*math.pi)*sigma*r)
    return out

def top_hat_3d_convolve(radii: np.ndarray, rho: np.ndarray, radius: float, points: int = 1601) -> np.ndarray:
    radii = np.asarray(radii, dtype=float); rho = np.asarray(rho, dtype=float)
    out = np.empty_like(radii); kd = 3.0/(4.0*math.pi*radius**3)
    for i, r in enumerate(radii):
        rp = _local_grid(float(r), radii, radius, points)
        rho_p = _interp_density(rp, radii, rho)
        mu0 = (r*r+rp*rp-radius*radius)/(2*r*rp)
        angular = np.clip(1.0-mu0, 0.0, 2.0)
        out[i] = 2.0*math.pi*kd*trapezoid(rp*rp*rho_p*angular, rp)
    return out
