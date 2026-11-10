from __future__ import annotations
import numpy as np

def augment(base: np.ndarray, convolved: np.ndarray, fraction: float) -> np.ndarray:
    """Return (1-f) * base + f * convolved with an exact f=0 floor."""
    base = np.asarray(base, dtype=float)
    convolved = np.asarray(convolved, dtype=float)
    if base.shape != convolved.shape:
        raise ValueError('base and convolved shapes differ')
    if not 0.0 <= fraction <= 1.0:
        raise ValueError('fraction must be in [0, 1]')
    if fraction == 0.0:
        return base.copy()
    return (1.0 - fraction) * base + fraction * convolved
