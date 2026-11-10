#!/usr/bin/env python3
from __future__ import annotations
import argparse,hashlib,json
from pathlib import Path
from sparc_adapter_common import build_state,evaluate_kernel,load_operator,state_summary

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def aggregate(rows,key):
 stable=[r for r in rows if r['baseline_stable']]
 n=sum(r['row_count'] for r in stable); base=sum(r['baseline_chi2'] for r in stable); cand=sum(r[key]['chi2'] for r in stable)
 return {'stable_galaxy_count':len(stable),'data_point_count':n,'baseline_total_chi2':base,'candidate_total_chi2':cand,'raw_delta_chi2':cand-base,'residual_reduction_pct':-100*(cand-base)/base,'baseline_macro_chi2_per_point':sum(r['baseline_chi2_per_point'] for r in stable)/len(stable),'candidate_macro_chi2_per_point':sum(r[key]['chi2_per_point'] for r in stable)/len(stable),'macro_delta_chi2_per_point':sum(r[key]['chi2_per_point']-r['baseline_chi2_per_point'] for r in stable)/len(stable),'improved_count':sum(r[key]['delta_chi2']<0 for r in stable),'worsened_count':sum(r[key]['delta_chi2']>0 for r in stable),'neutral_count':sum(r[key]['delta_chi2']==0 for r in stable),'downlift':cand>base}

def main():
 ap=argparse.ArgumentParser(); ap.add_argument('--manifest',type=Path,required=True); ap.add_argument('--policy',type=Path,required=True); ap.add_argument('--zip',type=Path,required=True); ap.add_argument('--operator-repo',type=Path,required=True); ap.add_argument('--output',type=Path,required=True); a=ap.parse_args()
 m=json.loads(a.manifest.read_text()); pol=json.loads(a.policy.read_text()); ops=load_operator(a.operator_repo)
 safe=pol['safe_optimum']; forced=pol['forced_nonzero_optimum']; eta_max=max(safe['eta'],forced['eta'])
 rows=[]
 for name in m['heldout']:
  s=build_state(a.zip,m['catalog_rows'][name],eta_max,ops); base=state_summary(s); base['baseline_stable']=s['stable']
  if s['stable']:
   base['safe_plummer']=evaluate_kernel(s,ops,'plummer_3d',safe['f'],safe['eta']) if safe['f']>0 else {'kernel':'plummer_3d','f':0.0,'eta':safe['eta'],'d_kpc':safe['eta']*s['meta']['rdisk_kpc'],'chi2':s['base_chi2'],'delta_chi2':0.0,'chi2_per_point':s['base_chi2']/len(s['data']['radius_kpc']),'residual_reduction_pct':0.0,'downlift':False,'raw_mass_leak_fraction':0.0,'mass_renormalization_factor':1.0,'mass_leak_fraction':0.0,'f0_max_abs':0.0}
   base['forced_plummer']=evaluate_kernel(s,ops,'plummer_3d',forced['f'],forced['eta'])
   base['forced_gaussian']=evaluate_kernel(s,ops,'gaussian_3d',forced['f'],forced['eta'])
   base['forced_top_hat']=evaluate_kernel(s,ops,'top_hat_3d',forced['f'],forced['eta'])
  rows.append(base)
 for r in rows:
  if r['baseline_stable']:
   for k in ('safe_plummer','forced_plummer','forced_gaussian','forced_top_hat'):
    if abs(r[k]['raw_mass_leak_fraction'])>0.02 or abs(r[k]['mass_leak_fraction'])>1e-12 or r[k]['f0_max_abs']>1e-12: raise RuntimeError(f'numerical gate fail {r["galaxy"]} {k}')
 out={'schema_version':'sparc-equation-adapter-heldout-v1','proof_mode':'PUBLIC_DATA_HELDOUT_ADAPTER_POLICY_WITH_PER_GALAXY_BASELINE_NUISANCE_FIT','claim_allowed':False,'sample_manifest_sha256':sha(a.manifest),'frozen_policy_sha256':sha(a.policy),'heldout_names':m['heldout'],'dev_names_accessed':False,'safe_policy':safe,'forced_nonzero_policy':forced,'rows':rows,'aggregates':{k:aggregate(rows,k) for k in ('safe_plummer','forced_plummer','forced_gaussian','forced_top_hat')},'claim_boundary':'Held-out for shared adapter f/eta only. Per-galaxy NFW baseline nuisance parameters are fitted on each held-out rotation curve. Not a clean predictive or physical proof.'}
 a.output.write_text(json.dumps(out,indent=2,sort_keys=True)+'\n')
if __name__=='__main__': main()
