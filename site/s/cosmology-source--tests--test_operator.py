import math
import numpy as np
from scipy.integrate import trapezoid
from orthogonal_projection_term.kernels import (
    kernel_half_mass_radius,
    normalized_2d_kernel,
    plummer_3d_density,
    plummer_3d_half_mass_radius,
    plummer_like_2d_half_mass_radius,
    plummer_like_2d_kernel,
    radial_grid_2d,
)
from orthogonal_projection_term.operators import augment

def test_f0_exact_recovery():
    base=np.array([1.,2.,3.]); conv=np.array([3.,2.,1.])
    assert np.array_equal(augment(base,conv,0.0),base)

def test_plummer_kernel_integrates_to_one():
    r=np.geomspace(1e-5,1e5,200000); k=plummer_3d_density(r,16.0)
    mass=trapezoid(4*np.pi*r*r*k,r)
    assert abs(mass-1.0)<2e-5

def test_plummer_half_mass_formula():
    d=16.0; rh=plummer_3d_half_mass_radius(d)
    enclosed=rh**3/(rh*rh+d*d)**1.5
    assert abs(enclosed-.5)<1e-12

def test_plummer_like_2d_continuum_half_mass_formula():
    d=16.0
    assert plummer_like_2d_half_mass_radius(d)==math.sqrt(3.0)*d

def test_2d_controls_match_discrete_plummer_half_mass():
    pixel_scale=.2; d=4.0; radius_pixels=160
    radii=radial_grid_2d(radius_pixels,pixel_scale)
    plummer=plummer_like_2d_kernel(pixel_scale,d,radius_pixels)
    target=kernel_half_mass_radius(plummer,radii)
    gaussian=normalized_2d_kernel('gaussian',pixel_scale,target,radius_pixels)
    top_hat=normalized_2d_kernel('top_hat',pixel_scale,target,radius_pixels)
    assert abs(kernel_half_mass_radius(gaussian,radii)-target)<=pixel_scale*math.sqrt(2)
    assert abs(kernel_half_mass_radius(top_hat,radii)-target)<=pixel_scale*math.sqrt(2)
    assert abs(float(plummer.sum())-1.0)<1e-12
    assert abs(float(gaussian.sum())-1.0)<1e-12
    assert abs(float(top_hat.sum())-1.0)<1e-12
