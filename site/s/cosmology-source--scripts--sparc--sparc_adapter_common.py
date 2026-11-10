from __future__ import annotations
import hashlib, importlib.util, json, math, sys, zipfile
from pathlib import Path
from typing import Any
import numpy as np
from scipy.optimize import minimize

G_KPC = 4.30091e-6
H0_KM_S_KPC = 73.0 / 1000.0

def sha256_bytes(data: bytes) -> str: return hashlib.sha256(data).hexdigest()
def sha256_file(path: Path) -> str: return sha256_bytes(path.read_bytes())
def canonical_sha(value: Any) -> str:
    return sha256_bytes(json.dumps(value,sort_keys=True,separators=(',',':')).encode())

def import_module(path: Path, name: str):
    spec=importlib.util.spec_from_file_location(name,path)
    if spec is None or spec.loader is None: raise RuntimeError(f'cannot import {path}')
    module=importlib.util.module_from_spec(spec); sys.modules[name]=module; spec.loader.exec_module(module); return module

def load_r2_hasher(r2_root: Path):
    path=(r2_root/'benchmark_replay_harness.py').resolve(); sys.path.insert(0,str(r2_root.resolve()))
    mod=import_module(path,'r2_benchmark_replay_harness_sparc_adapter')
    return path,mod.sample_ids_sha256

def load_operator(operator_repo: Path):
    sys.path.insert(0,str((operator_repo/'src').resolve()))
    from orthogonal_projection_term.kernels import gaussian_sigma_for_half_mass,plummer_3d_half_mass_radius,top_hat_radius_for_half_mass
    from orthogonal_projection_term.operators import augment
    from orthogonal_projection_term.radial import gaussian_3d_convolve,plummer_3d_convolve,top_hat_3d_convolve
    from orthogonal_projection_term.scoring import cumulative_mass
    return dict(gaussian_sigma_for_half_mass=gaussian_sigma_for_half_mass,plummer_3d_half_mass_radius=plummer_3d_half_mass_radius,top_hat_radius_for_half_mass=top_hat_radius_for_half_mass,augment=augment,gaussian_3d_convolve=gaussian_3d_convolve,plummer_3d_convolve=plummer_3d_convolve,top_hat_3d_convolve=top_hat_3d_convolve,cumulative_mass=cumulative_mass)

def load_catalog(path: Path) -> dict[str,dict[str,Any]]:
    out={}
    for line in path.read_text(encoding='utf-8').splitlines():
        p=line.split()
        if len(p)<18: continue
        try:
            row=dict(galaxy=p[0],T=int(p[1]),distance_mpc=float(p[2]),inclination_deg=float(p[5]),reff_kpc=float(p[9]),rdisk_kpc=float(p[11]),vflat_km_s=float(p[15]),quality=int(p[17]))
        except Exception: continue
        out[row['galaxy']]=row
    return out

def read_rotmod(zip_path: Path, galaxy: str) -> dict[str,np.ndarray]:
    member=f'{galaxy}_rotmod.dat'
    with zipfile.ZipFile(zip_path) as zf: raw=zf.read(member)
    rows=[]
    for line in raw.decode().splitlines():
        if not line.strip() or line.lstrip().startswith('#'): continue
        vals=[float(x) for x in line.split()]
        if len(vals)>=8: rows.append(vals[:8])
    a=np.asarray(rows,float)
    if a.shape[0]<8: raise RuntimeError(f'{galaxy}: too few rows')
    return dict(radius_kpc=a[:,0],vobs_km_s=a[:,1],err_km_s=a[:,2],vgas_km_s=a[:,3],vdisk_km_s=a[:,4],vbul_km_s=a[:,5],sb_disk=a[:,6],sb_bul=a[:,7],member_sha256=sha256_bytes(raw))

def eligible_names(catalog: dict[str,dict[str,Any]], zip_path: Path) -> list[str]:
    out=[]
    with zipfile.ZipFile(zip_path) as zf: members=set(zf.namelist())
    for name,row in catalog.items():
        if f'{name}_rotmod.dat' not in members: continue
        if not (row['quality']==1 and row['T']>=7 and 30<=row['inclination_deg']<=85 and row['rdisk_kpc']>0):
            continue
        try:
            d=read_rotmod(zip_path,name)
        except RuntimeError:
            continue
        bulgeless=bool(np.all(np.abs(d['vbul_km_s'])<=1e-12))
        if len(d['radius_kpc'])>=12 and bulgeless:
            out.append(name)
    return sorted(out,key=lambda x:hashlib.sha256(x.encode()).hexdigest())

def nfw_geometry(v200: float,c: float):
    r200=v200/(10*H0_KM_S_KPC); m200=v200*v200*r200/G_KPC; rs=r200/c
    fc=math.log1p(c)-c/(1+c); rho_s=m200/(4*math.pi*rs**3*fc)
    return r200,m200,rs,rho_s

def nfw_mass(r: np.ndarray,v200: float,c: float):
    r200,m200,rs,_=nfw_geometry(v200,c); x=np.asarray(r)/rs; fc=math.log1p(c)-c/(1+c)
    m=m200*(np.log1p(x)-x/(1+x))/fc
    return np.where(np.asarray(r)<=r200,m,m200)

def nfw_density(r: np.ndarray,v200: float,c: float):
    r200,_,rs,rho_s=nfw_geometry(v200,c); x=np.asarray(r)/rs
    rho=rho_s/np.maximum(x*(1+x)**2,1e-300)
    return np.where(np.asarray(r)<=r200,rho,0.0)

def signed_square(v): return np.sign(v)*v*v
def baryon_v2(d,ml_disk=0.5,ml_bulge=0.7):
    return signed_square(d['vgas_km_s'])+ml_disk*signed_square(d['vdisk_km_s'])+ml_bulge*signed_square(d['vbul_km_s'])
def velocity_from_mass(r,m): return np.sqrt(np.maximum(G_KPC*np.asarray(m)/np.maximum(np.asarray(r),1e-12),0))
def total_velocity(vbar2,vhalo): return np.sqrt(np.maximum(vbar2+vhalo*vhalo,0))
def chi2(pred,obs,err): return float(np.sum(((np.asarray(pred)-np.asarray(obs))/np.asarray(err))**2))

def fit_baseline(d,ml_disk=0.5,ml_bulge=0.7):
    r=d['radius_kpc']; vbar2=baryon_v2(d,ml_disk,ml_bulge); bounds=[(math.log10(15),math.log10(300)),(math.log10(0.5),math.log10(80))]
    def objective(theta):
        v,c=10**theta[0],10**theta[1]
        pred=total_velocity(vbar2,velocity_from_mass(r,nfw_mass(r,v,c)))
        return chi2(pred,d['vobs_km_s'],d['err_km_s'])
    best=(float('inf'),None)
    for lv in np.linspace(*bounds[0],49):
        for lc in np.linspace(*bounds[1],49):
            val=objective(np.array([lv,lc]))
            if val<best[0]: best=(val,np.array([lv,lc]))
    fit=minimize(objective,best[1],method='L-BFGS-B',bounds=bounds,options={'ftol':1e-14,'gtol':1e-10,'maxiter':2000,'maxls':100})
    theta=np.asarray(fit.x); v,c=10**theta[0],10**theta[1]; r200,m200,rs,rho_s=nfw_geometry(v,c)
    eps=1e-6; hits={'v200_lower':bool(abs(theta[0]-bounds[0][0])<eps),'v200_upper':bool(abs(theta[0]-bounds[0][1])<eps),'concentration_lower':bool(abs(theta[1]-bounds[1][0])<eps),'concentration_upper':bool(abs(theta[1]-bounds[1][1])<eps)}
    return dict(v200_km_s=float(v),concentration=float(c),r200_kpc=float(r200),m200_msun=float(m200),rs_kpc=float(rs),rho_s_msun_kpc3=float(rho_s),optimizer_success=bool(fit.success),optimizer_message=str(fit.message),boundary_hits=hits,vbar2=vbar2)

def build_state(zip_path: Path,catalog_row: dict[str,Any],eta_max: float,ops: dict[str,Any],points: int=3200):
    name=catalog_row['galaxy']; d=read_rotmod(zip_path,name); fit=fit_baseline(d)
    dmax=eta_max*catalog_row['rdisk_kpc']; r200=fit['r200_kpc']
    rmax=max(20*r200,r200+160*dmax,float(np.max(d['radius_kpc']))+160*dmax)
    grid=np.geomspace(1e-5,rmax,points); rho=nfw_density(grid,fit['v200_km_s'],fit['concentration']); cm=ops['cumulative_mass']; base_mass=cm(grid,rho)
    numeric_mass=np.interp(d['radius_kpc'],grid,base_mass); analytic=nfw_mass(d['radius_kpc'],fit['v200_km_s'],fit['concentration'])
    base_pred=total_velocity(fit['vbar2'],velocity_from_mass(d['radius_kpc'],numeric_mass)); base_score=chi2(base_pred,d['vobs_km_s'],d['err_km_s'])
    stable=fit['optimizer_success'] and not any(fit['boundary_hits'].values())
    return dict(name=name,meta=catalog_row,data=d,fit=fit,grid=grid,rho=rho,base_mass=base_mass,base_pred=base_pred,base_chi2=base_score,stable=stable,numeric_mass_relerr=float(np.max(np.abs(numeric_mass-analytic)/np.maximum(analytic,1e-300))))

def prepare_kernel(state,ops,kind: str,eta: float):
    scale=eta*state['meta']['rdisk_kpc']
    if kind=='plummer_3d': conv_arg=scale; conv=ops['plummer_3d_convolve'](state['grid'],state['rho'],conv_arg)
    else:
        rh=ops['plummer_3d_half_mass_radius'](scale)
        if kind=='gaussian_3d': conv_arg=ops['gaussian_sigma_for_half_mass'](rh); conv=ops['gaussian_3d_convolve'](state['grid'],state['rho'],conv_arg)
        elif kind=='top_hat_3d': conv_arg=ops['top_hat_radius_for_half_mass'](rh); conv=ops['top_hat_3d_convolve'](state['grid'],state['rho'],conv_arg)
        else: raise ValueError(kind)
    base_total=float(state['base_mass'][-1]); raw_conv_total=float(ops['cumulative_mass'](state['grid'],conv)[-1])
    if not np.isfinite(raw_conv_total) or raw_conv_total <= 0:
        raise RuntimeError(f'{state["name"]}: invalid convolved mass')
    raw_mass_leak=(raw_conv_total-base_total)/base_total
    mass_renormalization_factor=base_total/raw_conv_total
    conv=conv*mass_renormalization_factor
    conv_total=float(ops['cumulative_mass'](state['grid'],conv)[-1])
    conv_mass=ops['cumulative_mass'](state['grid'],conv)
    return dict(kernel=kind,eta=float(eta),d_kpc=float(scale),kernel_scale_kpc=float(conv_arg),conv_mass=conv_mass,raw_mass_leak_fraction=float(raw_mass_leak),mass_renormalization_factor=float(mass_renormalization_factor),mass_leak_fraction=float((conv_total-base_total)/base_total))

def evaluate_prepared_kernel(state,ops,prepared,f: float):
    mass=ops['augment'](state['base_mass'],prepared['conv_mass'],f); pred=total_velocity(state['fit']['vbar2'],velocity_from_mass(state['data']['radius_kpc'],np.interp(state['data']['radius_kpc'],state['grid'],mass)))
    score=chi2(pred,state['data']['vobs_km_s'],state['data']['err_km_s'])
    f0mass=ops['augment'](state['base_mass'],prepared['conv_mass'],0.0); f0pred=total_velocity(state['fit']['vbar2'],velocity_from_mass(state['data']['radius_kpc'],np.interp(state['data']['radius_kpc'],state['grid'],f0mass)))
    result={k:v for k,v in prepared.items() if k!='conv_mass'}
    result.update(f=float(f),chi2=float(score),delta_chi2=float(score-state['base_chi2']),chi2_per_point=float(score/len(state['data']['radius_kpc'])),residual_reduction_pct=float(-100*(score-state['base_chi2'])/state['base_chi2']),downlift=bool(score>state['base_chi2']),f0_max_abs=float(np.max(np.abs(f0pred-state['base_pred']))))
    return result

def evaluate_kernel(state,ops,kind: str,f: float,eta: float):
    return evaluate_prepared_kernel(state,ops,prepare_kernel(state,ops,kind,eta),f)

def state_summary(state):
    f={k:v for k,v in state['fit'].items() if k!='vbar2'}
    return dict(galaxy=state['name'],row_count=int(len(state['data']['radius_kpc'])),rdisk_kpc=float(state['meta']['rdisk_kpc']),baseline_chi2=float(state['base_chi2']),baseline_chi2_per_point=float(state['base_chi2']/len(state['data']['radius_kpc'])),baseline_fit=f,baseline_stable=bool(state['stable']),numeric_mass_max_relative_error=float(state['numeric_mass_relerr']),source_member_sha256=state['data']['member_sha256'])
