#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, math
from pathlib import Path
import numpy as np
from orthogonal_projection_term.kernels import plummer_3d_half_mass_radius, gaussian_sigma_for_half_mass, top_hat_radius_for_half_mass
from orthogonal_projection_term.operators import augment
from orthogonal_projection_term.radial import plummer_3d_convolve, gaussian_3d_convolve, top_hat_3d_convolve
from orthogonal_projection_term.scoring import cumulative_mass, weighted_log_mse

G_KPC=4.30091e-6; NFW_XMAX=2.16258; BETA=4.0

def load_row(path: Path, cdm_id: int, sidm_id: int):
    names=path.read_text().splitlines()[0].lstrip('#').split(); data=np.loadtxt(path)
    rows=data[(data[:,0]==cdm_id)&(data[:,1]==sidm_id)]
    if len(rows)!=1: raise RuntimeError(f'expected one row, found {len(rows)}')
    return {k:float(v) for k,v in zip(names,rows[0])}

def nfw(r, vmax, rmax):
    rs=rmax/NFW_XMAX; x=NFW_XMAX; mf=math.log1p(x)-x/(1+x)
    rho_s=vmax*vmax*rmax/(G_KPC*4*math.pi*rs**3*mf)
    return rho_s/((r/rs)*(1+r/rs)**2)

def sidm(r,row):
    trans=(r**BETA+row['rc1']**BETA)**(1/BETA)
    return row['rhoss1']/((trans/row['rss1'])*(1+r/row['rss1'])**2)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--table',type=Path,required=True); ap.add_argument('--cdm-id',type=int,default=1); ap.add_argument('--sidm-id',type=int,default=1); ap.add_argument('--output',type=Path,required=True); ap.add_argument('--f',type=float,default=.30); ap.add_argument('--d-kpc',type=float,default=16.0); a=ap.parse_args()
    row=load_row(a.table,a.cdm_id,a.sidm_id); r=np.geomspace(0.05,4000.0,500)
    base=nfw(r,row['cdmVmaxz0'],row['cdmRmaxz0']); ref=sidm(r,row); base_score=weighted_log_mse(r,base,ref)
    rh=plummer_3d_half_mass_radius(a.d_kpc); gs=gaussian_sigma_for_half_mass(rh); tr=top_hat_radius_for_half_mass(rh)
    conv={'plummer_3d':plummer_3d_convolve(r,base,a.d_kpc),'gaussian_3d':gaussian_3d_convolve(r,base,gs),'top_hat_3d':top_hat_3d_convolve(r,base,tr)}
    kernels={}
    for name,value in conv.items():
        score=weighted_log_mse(r,augment(base,value,a.f),ref); delta=score['chi_total']-base_score['chi_total']
        kernels[name]={'score':score,'raw_delta_chi_total':delta,'residual_reduction_pct':100*(-delta)/base_score['chi_total']}
    out={'source_table':a.table.name,'target_ids':{'cdmID':a.cdm_id,'vd100id':a.sidm_id},'f_perp':a.f,'d_kpc':a.d_kpc,'base_score':base_score,'kernels':kernels}
    a.output.write_text(json.dumps(out,indent=2,sort_keys=True)+'\n'); print(a.output)
if __name__=='__main__': main()
