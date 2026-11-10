#!/usr/bin/env python3
from __future__ import annotations
import ast, json, math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def load(rel): return json.loads((ROOT/rel).read_text())
def close(a,b,tol=1e-10):
    if not math.isclose(float(a),float(b),rel_tol=tol,abs_tol=tol):
        raise AssertionError(f"{a} != {b}")
def main():
    ev=load('results/jeans_dsph_formal_corrective_evaluation.json')
    dev=load('results/jeans_dsph_formal_corrective_dev_grid.json')
    policy=load('results/jeans_dsph_formal_corrective_frozen_policy.json')
    audit=load('results/jeans_dsph_formal_corrective_audit.json')
    replay=load('results/jeans_dsph_formal_corrective_replay_receipt.json')
    assert ev['response_projection_used'] is False
    assert dev['response_projection_used'] is False
    assert policy['response_projection_used'] is False
    assert ev['proof_mode']=='POST_EXPOSURE_CORRECTIVE_FORMAL_SOURCE_REPRODUCTION'
    assert ev['claim_allowed'] is False
    assert policy['status']=='FROZEN_BEFORE_CORRECTIVE_EVALUATION_SCORING'
    assert policy['safe_optimum']['f']==0.0
    assert policy['direct_nonzero_optimum']['f']==0.05
    assert policy['direct_nonzero_optimum']['eta']==0.03125
    assert len(ev['rows'])==2 and ev['evaluation_names']==['Draco','Ursa Minor']
    for key in ('safe_plummer','direct_nonzero_plummer','direct_nonzero_gaussian','direct_nonzero_top_hat'):
        a=ev['aggregates'][key]
        base=sum(r['baseline_chi2'] for r in ev['rows'])
        cand=sum(r[key]['chi2'] for r in ev['rows'])
        close(a['baseline_total_chi2'],base)
        close(a['candidate_total_chi2'],cand)
        close(a['raw_delta_chi2'],cand-base)
        close(a['residual_reduction_pct'],-100*(cand-base)/base)
        assert a['improved_count']==sum(r[key]['delta_chi2']<0 for r in ev['rows'])
        assert a['worsened_count']==sum(r[key]['delta_chi2']>0 for r in ev['rows'])
    p=ev['aggregates']['direct_nonzero_plummer']
    close(p['raw_delta_chi2'],-0.0011593988829652346)
    close(p['residual_reduction_pct'],0.005077144705320756)
    assert p['improved_count']==2 and p['worsened_count']==0
    assert all(r['direct_nonzero_plummer']['delta_chi2']<0 for r in ev['rows'])
    assert all(r['safe_plummer']['f0_max_abs_kms']==0.0 for r in ev['rows'])
    assert audit['status']=='PASS' and len(audit['checks'])==61 and all(x['pass'] for x in audit['checks'])
    assert replay['status']=='PASS_NUMERICALLY_EQUIVALENT_NON_BYTE_IDENTICAL'
    assert replay['safe_policy_identity']['original']==replay['safe_policy_identity']['replay']==[0.0,0.03125]
    assert replay['direct_policy_identity']['original']==replay['direct_policy_identity']['replay']==[0.05,0.03125]
    source=(ROOT/'scripts/jeans_formal_corrective/jeans_formal_common.py').read_text()
    fn={n.name for n in ast.walk(ast.parse(source)) if isinstance(n,ast.FunctionDef)}
    assert not fn.intersection({'delta_sigma_perp','baseline_jacobian','prepare_response_adapter','evaluate_response_adapter'})
    print(json.dumps({'status':'PASS','label':audit['audit_label'],'checks':61},indent=2))
if __name__=='__main__': main()
