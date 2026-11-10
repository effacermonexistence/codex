#!/usr/bin/env python3
from __future__ import annotations
import argparse,json,math
from pathlib import Path
from sparc_adapter_common import build_state,evaluate_prepared_kernel,load_operator,prepare_kernel,state_summary
F_GRID=[0.0,0.05,0.10,0.20,0.30,0.40,0.50,0.60,0.75,1.0]
ETA_GRID=[0.03125,0.0625,0.125,0.25,0.5,1.0,2.0,4.0,8.0]

def main():
 ap=argparse.ArgumentParser(); ap.add_argument('--manifest',type=Path,required=True); ap.add_argument('--zip',type=Path,required=True); ap.add_argument('--operator-repo',type=Path,required=True); ap.add_argument('--post-gate',type=Path,required=True); ap.add_argument('--output',type=Path,required=True); a=ap.parse_args()
 gate=json.loads(a.post_gate.read_text());
 if gate.get('status')!='PASS' or gate.get('phase')!='post': raise RuntimeError('post gate required before dev scoring')
 m=json.loads(a.manifest.read_text()); ops=load_operator(a.operator_repo); states=[]
 for name in m['dev']: states.append(build_state(a.zip,m['catalog_rows'][name],max(ETA_GRID),ops))
 stable=[s for s in states if s['stable']]
 if len(stable)<5: raise RuntimeError(f'too few stable dev baselines: {len(stable)}')
 base_macro=sum(s['base_chi2']/len(s['data']['radius_kpc']) for s in stable)/len(stable)
 policies=[]
 for eta in ETA_GRID:
  cached={s['name']:prepare_kernel(s,ops,'plummer_3d',eta) for s in stable}
  # f=0 is exact baseline and does not require convolution.
  for f in F_GRID:
   rows=[]; valid=True
   for s in stable:
    if f==0:
     row={'galaxy':s['name'],'chi2':s['base_chi2'],'delta_chi2':0.0,'chi2_per_point':s['base_chi2']/len(s['data']['radius_kpc']),'residual_reduction_pct':0.0,'downlift':False,'raw_mass_leak_fraction':0.0,'mass_renormalization_factor':1.0,'mass_leak_fraction':0.0,'f0_max_abs':0.0,'d_kpc':eta*s['meta']['rdisk_kpc']}
    else:
     row=evaluate_prepared_kernel(s,ops,cached[s['name']],f); row['galaxy']=s['name']
     if abs(row['raw_mass_leak_fraction'])>0.02 or abs(row['mass_leak_fraction'])>1e-12 or row['f0_max_abs']>1e-12: valid=False
    rows.append(row)
   macro=sum(x['chi2_per_point'] for x in rows)/len(rows); delta=macro-base_macro
   policies.append({'f':f,'eta':eta,'valid':valid,'dev_macro_chi2_per_point':macro,'dev_macro_delta_chi2_per_point':delta,'dev_improved_count':sum(x['delta_chi2']<0 for x in rows),'dev_worsened_count':sum(x['delta_chi2']>0 for x in rows),'rows':rows})
 valid=[p for p in policies if p['valid']]
 safe=min(valid,key=lambda p:(p['dev_macro_chi2_per_point'],p['f'],p['eta']))
 nonzero=min((p for p in valid if p['f']>0),key=lambda p:(p['dev_macro_chi2_per_point'],p['f'],p['eta']))
 out={'schema_version':'sparc-equation-adapter-dev-v1','proof_mode':'PUBLIC_DATA_DEVELOPMENT_ARTIFACT','objective':'minimize macro mean chi2-per-point over stable dev baselines','formula':'d_g=eta*Rdisk_g; rho_aug=(1-f)rho_NFW+f(K_d*rho_NFW)','grids':{'f':F_GRID,'eta':ETA_GRID},'dev_names':m['dev'],'heldout_accessed':False,'baseline_stable_count':len(stable),'baseline_unstable_count':len(states)-len(stable),'baseline_macro_chi2_per_point':base_macro,'state_summaries':[state_summary(s) for s in states],'safe_optimum':{k:v for k,v in safe.items() if k!='rows'},'forced_nonzero_optimum':{k:v for k,v in nonzero.items() if k!='rows'},'policy_rows':policies,'claim_allowed':False}
 a.output.write_text(json.dumps(out,indent=2,sort_keys=True)+'\n')
if __name__=='__main__': main()
