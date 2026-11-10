#!/usr/bin/env python3
"""Faithful single-cluster adapter for the frozen HFF map-transfer diagnostic.

Supply one target-team convergence map, one or more reference-team maps,
and the frozen angular kernel scale recorded for that cluster. Reference
maps are resampled onto the target WCS. Gaussian and top-hat controls are
matched to the discrete half-mass radius of the finite Plummer-like kernel
before any score is evaluated.
"""
from __future__ import annotations
import argparse, hashlib, json, math
from pathlib import Path
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from scipy.ndimage import map_coordinates
from scipy.signal import fftconvolve
from orthogonal_projection_term.kernels import (
    kernel_half_mass_radius,
    normalized_2d_kernel,
    plummer_like_2d_kernel,
    radial_grid_2d,
)
from orthogonal_projection_term.operators import augment

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()

def load(path: Path):
    with fits.open(path, memmap=True) as hdul:
        data = np.squeeze(np.asarray(hdul[0].data, dtype=float))
        header = hdul[0].header.copy()
    if data.ndim != 2:
        raise ValueError(f'expected a 2D FITS map, got {data.shape}')
    return data, WCS(header).celestial, header

def pixel_scale_arcsec(header) -> float:
    matrix = np.asarray(WCS(header).celestial.pixel_scale_matrix, dtype=float)
    scales = np.sqrt(np.sum(matrix * matrix, axis=0)) * 3600.0
    good = scales[np.isfinite(scales) & (scales > 0)]
    if good.size == 0:
        raise ValueError('missing celestial pixel scale')
    return float(np.median(good))

def resample_to(src, src_wcs, dst_wcs, dst_shape):
    yy, xx = np.mgrid[0:dst_shape[0], 0:dst_shape[1]]
    ra, dec = dst_wcs.pixel_to_world_values(xx, yy)
    sx, sy = src_wcs.world_to_pixel_values(ra, dec)
    return map_coordinates(
        src,
        [np.asarray(sy), np.asarray(sx)],
        order=1,
        mode='constant',
        cval=np.nan,
    )

def fit_mask(shape, wcs, header, radius_arcsec):
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    ra, dec = wcs.pixel_to_world_values(xx, yy)
    ra0 = float(header.get('CRVAL1', wcs.wcs.crval[0]))
    dec0 = float(header.get('CRVAL2', wcs.wcs.crval[1]))
    dx = (np.asarray(ra) - ra0) * np.cos(np.deg2rad(dec0)) * 3600.0
    dy = (np.asarray(dec) - dec0) * 3600.0
    return np.hypot(dx, dy) <= radius_arcsec

def score(target, references, mask):
    per_reference = {}
    valid_pixels = {}
    for label, reference in references.items():
        valid = mask & np.isfinite(target) & np.isfinite(reference)
        if not np.any(valid):
            raise ValueError(f'no overlapping valid pixels for {label}')
        per_reference[label] = float(np.mean((target[valid] - reference[valid])**2))
        valid_pixels[label] = int(np.sum(valid))
    return {
        'mean_mse': float(np.mean(list(per_reference.values()))),
        'per_reference_mse': per_reference,
        'valid_pixels': valid_pixels,
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--target', type=Path, required=True)
    parser.add_argument('--reference', type=Path, action='append', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument(
        '--d-arcsec',
        type=float,
        required=True,
        help='Frozen angular scale for this cluster; use the stored d_arcsec value.',
    )
    parser.add_argument('--f', type=float, default=.30)
    parser.add_argument('--fit-radius-arcsec', type=float, default=60.0)
    args = parser.parse_args()
    if args.d_arcsec <= 0 or args.fit_radius_arcsec <= 0:
        raise ValueError('angular scales must be positive')

    target, target_wcs, target_header = load(args.target)
    pixel_scale = pixel_scale_arcsec(target_header)
    mask = fit_mask(
        target.shape,
        target_wcs,
        target_header,
        args.fit_radius_arcsec,
    ) & np.isfinite(target)

    references = {}
    reference_meta = []
    for index, path in enumerate(args.reference, start=1):
        src, src_wcs, _ = load(path)
        label = f'reference_{index}'
        references[label] = resample_to(src, src_wcs, target_wcs, target.shape)
        reference_meta.append({
            'label': label,
            'filename': path.name,
            'sha256': sha256_file(path),
        })

    radius_pixels = max(2, int(math.ceil(8.0 * args.d_arcsec / pixel_scale)))
    radii = radial_grid_2d(radius_pixels, pixel_scale)
    plummer = plummer_like_2d_kernel(pixel_scale, args.d_arcsec, radius_pixels)
    target_half_mass = kernel_half_mass_radius(plummer, radii)
    gaussian = normalized_2d_kernel(
        'gaussian', pixel_scale, target_half_mass, radius_pixels
    )
    top_hat = normalized_2d_kernel(
        'top_hat', pixel_scale, target_half_mass, radius_pixels
    )
    kernels = {
        'plummer_like_2d': plummer,
        'gaussian_2d': gaussian,
        'top_hat_2d': top_hat,
    }

    baseline = score(target, references, mask)
    f0_recovery = augment(target, fftconvolve(target, plummer, mode='same'), 0.0)
    records = {}
    for name, kernel in kernels.items():
        convolved = fftconvolve(target, kernel, mode='same')
        augmented = augment(target, convolved, args.f)
        replay = augment(target, fftconvolve(target, kernel, mode='same'), args.f)
        augmented_score = score(augmented, references, mask)
        delta = augmented_score['mean_mse'] - baseline['mean_mse']
        records[name] = {
            'kernel_sum': float(np.sum(kernel)),
            'kernel_half_mass_arcsec': kernel_half_mass_radius(kernel, radii),
            'augmented_score': augmented_score,
            'raw_delta_mse': float(delta),
            'residual_reduction_pct': float(
                100.0 * (-delta) / baseline['mean_mse']
            ),
            'downlift': bool(delta > 0),
            'deterministic_replay_max_abs_error': float(
                np.nanmax(np.abs(replay - augmented))
            ),
        }

    result = {
        'evidence_class': 'PUBLIC_LENS_MODEL_PRODUCT_DIAGNOSTIC',
        'operator': 'kappa_aug=(1-f)kappa_target+f(P_d*kappa_target)',
        'kernel_lineage': 'Plummer-like 2D exponent -3/2',
        'f_perp': args.f,
        'd_arcsec': args.d_arcsec,
        'fit_radius_arcsec': args.fit_radius_arcsec,
        'pixel_scale_arcsec': pixel_scale,
        'optimizer': 'none',
        'fallback': 'none',
        'target': {
            'filename': args.target.name,
            'sha256': sha256_file(args.target),
        },
        'references': reference_meta,
        'matching': {
            'criterion': 'discrete finite-kernel half-mass radius before scoring',
            'support_radius_pixels': radius_pixels,
            'target_half_mass_arcsec': target_half_mass,
        },
        'baseline_score': baseline,
        'f0_recovery_max_abs_error': float(
            np.nanmax(np.abs(f0_recovery - target))
        ),
        'kernels': records,
        'boundary': [
            'Public map-product consistency diagnostic, not observational likelihood.',
            'Reference maps are WCS-resampled to the target grid before scoring.',
            'The fit mask is frozen before kernel scores are evaluated.',
            'Negative delta alone does not establish kernel-specific physics.',
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, indent=2, sort_keys=True) + '\n',
        encoding='utf-8',
    )
    print(args.output)
if __name__=='__main__': main()
