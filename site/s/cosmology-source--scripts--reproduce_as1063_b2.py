#!/usr/bin/env python3
"""Reproduce the AS1063 halo-only B2 diagnostic from an extracted public model directory."""
from __future__ import annotations
import argparse, json, math, re
from pathlib import Path
import numpy as np
from orthogonal_projection_term.operators import augment
from orthogonal_projection_term.radial import plummer_3d_convolve
from orthogonal_projection_term.scoring import weighted_log_mse

G_KPC=4.30091e-6
def blocks(path):
    text=path.read_text(errors='replace'); out={}
    for m in re.finditer(r'^potential\s+(\S+)([\s\S]*?)\n\s*end',text,flags=re.M):
        vals={'label':m.group(1)}
        for key in ['profile','core_radius_kpc','cut_radius_kpc','v_disp','X-ray']:
            mm=re.search(r'^\s*'+re.escape(key)+r'\s+([-+0-9.eE]+)',m.group(2),flags=re.M)
            if mm: vals[key]=float(mm.group(1))
        out[m.group(1)]=vals
    return out
def dpie(r,sigma,a,s):
    a=max(a,1e-6); s=max(s,a*1.0001); pref=sigma**2/(2*math.pi*G_KPC)*(s+a)/(s*s-a*a)
    return np.maximum(pref*(1/(r*r+a*a)-1/(r*r+s*s)),0)
def density(path,labels,r):
    p=blocks(path); total=np.zeros_like(r)
    for label in labels:
        q=p[label]
        if q.get('profile')!=81.0 or 'X-ray' in q: raise RuntimeError(f'invalid halo component {label}')
        total+=dpie(r,q['v_disp'],q['core_radius_kpc'],q['cut_radius_kpc'])
    return total
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--model-dir',type=Path,required=True); ap.add_argument('--output',type=Path,required=True); ap.add_argument('--f',type=float,default=.30); ap.add_argument('--d-kpc',type=float,default=16.0); a=ap.parse_args()
    r=np.geomspace(.05,4000,500); base=density(a.model_dir/'Model_no_bspline'/'bestopt.par',['O1','O2'],r); ref=density(a.model_dir/'Model_bspline_4x4'/'bestopt.par',['O2','O3'],r)
    base_score=weighted_log_mse(r,base,ref); aug=augment(base,plummer_3d_convolve(r,base,a.d_kpc),a.f); score=weighted_log_mse(r,aug,ref); delta=score['chi_total']-base_score['chi_total']
    out={'f_perp':a.f,'d_kpc':a.d_kpc,'base_score':base_score,'augmented_score':score,'raw_delta_chi_total':delta,'residual_reduction_pct':100*(-delta)/base_score['chi_total'],'boundary':'public model-component diagnostic, not observational likelihood'}
    a.output.write_text(json.dumps(out,indent=2,sort_keys=True)+'\n'); print(a.output)
if __name__=='__main__': main()
