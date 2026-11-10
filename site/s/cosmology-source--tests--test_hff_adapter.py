import json
import subprocess
import sys
from pathlib import Path
import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

ROOT=Path(__file__).resolve().parents[1]

def write_map(path, data):
    w=WCS(naxis=2)
    w.wcs.crpix=[64.5,64.5]
    w.wcs.cdelt=np.array([-1.0/3600.0,1.0/3600.0])
    w.wcs.crval=[150.0,2.0]
    w.wcs.ctype=['RA---TAN','DEC--TAN']
    fits.PrimaryHDU(data=np.asarray(data,dtype=float),header=w.to_header()).writeto(path)

def test_hff_adapter_executes_with_wcs_and_matched_controls(tmp_path):
    yy,xx=np.mgrid[0:128,0:128]
    radius=np.hypot(xx-63.5,yy-63.5)
    target=np.exp(-0.5*(radius/9.0)**2)
    ref_a=np.exp(-0.5*(radius/10.0)**2)
    ref_b=np.exp(-0.5*(radius/11.0)**2)
    target_path=tmp_path/'target.fits'
    ref_a_path=tmp_path/'ref_a.fits'
    ref_b_path=tmp_path/'ref_b.fits'
    output_path=tmp_path/'result.json'
    write_map(target_path,target)
    write_map(ref_a_path,ref_a)
    write_map(ref_b_path,ref_b)
    subprocess.run([
        sys.executable,
        str(ROOT/'scripts/reproduce_hff_transfer.py'),
        '--target',str(target_path),
        '--reference',str(ref_a_path),
        '--reference',str(ref_b_path),
        '--d-arcsec','2.0',
        '--fit-radius-arcsec','40.0',
        '--output',str(output_path),
    ],check=True)
    result=json.loads(output_path.read_text())
    assert result['f0_recovery_max_abs_error']==0.0
    assert result['optimizer']=='none'
    assert result['fallback']=='none'
    target_half=result['matching']['target_half_mass_arcsec']
    for record in result['kernels'].values():
        assert abs(record['kernel_sum']-1.0)<1e-12
        assert abs(record['kernel_half_mass_arcsec']-target_half)<=2**0.5
        assert record['deterministic_replay_max_abs_error']==0.0
