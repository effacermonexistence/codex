from __future__ import annotations
import math
import numpy as np
from scipy.optimize import brentq

def plummer_3d_density(radius: np.ndarray, scale: float) -> np.ndarray:
    radius = np.asarray(radius, dtype=float)
    if scale <= 0:
        raise ValueError('scale must be positive')
    return 3.0 / (4.0 * math.pi * scale**3) * (1.0 + (radius / scale)**2) ** -2.5

def plummer_3d_half_mass_radius(scale: float) -> float:
    return float(scale / math.sqrt(2.0 ** (2.0 / 3.0) - 1.0))

def plummer_like_2d_half_mass_radius(scale: float) -> float:
    """Continuum half-mass radius for (1 + R^2 / scale^2)^(-3/2)."""
    if scale <= 0:
        raise ValueError('scale must be positive')
    return float(math.sqrt(3.0) * scale)

def gaussian_cumulative_mass(x: float) -> float:
    return float(math.erf(x / math.sqrt(2.0)) - math.sqrt(2.0 / math.pi) * x * math.exp(-0.5*x*x))

def gaussian_sigma_for_half_mass(r_half: float) -> float:
    ratio = brentq(lambda x: gaussian_cumulative_mass(x) - 0.5, 0.1, 10.0)
    return float(r_half / ratio)

def top_hat_radius_for_half_mass(r_half: float) -> float:
    return float(r_half * 2.0 ** (1.0 / 3.0))

def radial_grid_2d(radius_pixels: int, pixel_scale: float) -> np.ndarray:
    if radius_pixels < 1 or pixel_scale <= 0:
        raise ValueError('radius_pixels and pixel_scale must be positive')
    y, x = np.mgrid[-radius_pixels:radius_pixels+1, -radius_pixels:radius_pixels+1]
    return np.hypot(x, y) * pixel_scale

def kernel_half_mass_radius(kernel: np.ndarray, radii: np.ndarray) -> float:
    kernel = np.asarray(kernel, dtype=float)
    radii = np.asarray(radii, dtype=float)
    if kernel.shape != radii.shape or kernel.ndim != 2:
        raise ValueError('kernel and radii must be matching 2D arrays')
    if not np.all(np.isfinite(kernel)) or np.sum(kernel) <= 0:
        raise ValueError('kernel must be finite with positive total mass')
    order = np.argsort(radii.ravel())
    cumulative = np.cumsum(kernel.ravel()[order])
    index = int(np.searchsorted(cumulative, 0.5 * cumulative[-1], side='left'))
    return float(radii.ravel()[order[min(index, order.size - 1)]])

def plummer_like_2d_kernel(pixel_scale: float, scale: float, radius_pixels: int) -> np.ndarray:
    if scale <= 0:
        raise ValueError('scale must be positive')
    r = radial_grid_2d(radius_pixels, pixel_scale)
    kernel = (1.0 + (r / scale)**2) ** -1.5
    return kernel / np.sum(kernel)

def normalized_2d_kernel(kind: str, pixel_scale: float, target_half_mass: float, radius_pixels: int) -> np.ndarray:
    if target_half_mass <= 0:
        raise ValueError('target_half_mass must be positive')
    r = radial_grid_2d(radius_pixels, pixel_scale)
    if kind == 'plummer_like':
        scale = target_half_mass / math.sqrt(3.0)
        k = (1.0 + (r / scale)**2) ** -1.5
    elif kind == 'gaussian':
        sigma = target_half_mass / math.sqrt(2.0 * math.log(2.0))
        k = np.exp(-0.5 * (r / sigma)**2)
    elif kind == 'top_hat':
        k = (r <= math.sqrt(2.0) * target_half_mass).astype(float)
    else:
        raise ValueError(f'unknown 2D kernel: {kind}')
    return k / np.sum(k)
