#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, pathlib, re, sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
def close(a,b,tol=1e-10):
    if abs(a-b)>tol*max(1.0,abs(a),abs(b)): raise AssertionError(f'{a} != {b}')
def load(rel): return json.loads((ROOT/rel).read_text())
def verify_delta(base,aug,delta,reduction):
    close(aug-base,delta); close(100*(base-aug)/base,reduction)
def verify_conceptual_origin():
    readme=(ROOT/'README.md').read_text()
    origin=(ROOT/'docs/CONCEPTUAL_ORIGIN.md').read_text()
    operator=(ROOT/'docs/OPERATOR.md').read_text()
    boundaries=(ROOT/'docs/CLAIM_BOUNDARIES.md').read_text()
    lower=origin.lower()
    assert 'docs/CONCEPTUAL_ORIGIN.md' in readme
    assert 'vision pro' in lower
    assert 'einstein-rosen' in lower
    assert '10.1103/physrev.48.73' in lower
    assert 'not empirical evidence' in lower
    assert 'not derived' in lower and 'einstein-rosen' in lower
    assert 'not derived uniquely' in lower and 'plummer' in lower
    assert 'extra spatial' in lower and 'has been observed' in lower
    assert 'CONCEPTUAL_ORIGIN.md' in operator
    assert 'Vision Pro observation' in boundaries
def verify_sparc():
    held=load('results/sparc_rotation_curve_heldout.json')
    dev=load('results/sparc_rotation_curve_dev_grid.json')
    policy=load('results/sparc_rotation_curve_frozen_policy.json')
    sample=load('results/sparc_rotation_curve_sample_manifest.json')
    receipt=load('results/sparc_rotation_curve_run_receipt.json')
    verification=load('results/sparc_rotation_curve_verification.json')
    public_reproduction=load('results/sparc_rotation_curve_public_reproduction_check.json')
    assert not set(sample['dev']).intersection(sample['heldout'])
    assert held['heldout_names']==sample['heldout']
    assert held['forced_nonzero_policy']['f']==policy['forced_nonzero_optimum']['f']==1.0
    assert held['forced_nonzero_policy']['eta']==policy['forced_nonzero_optimum']['eta']==0.125
    assert dev['heldout_accessed'] is False
    stable=[row for row in held['rows'] if row['baseline_stable']]
    assert len(stable)==6
    mapping={
      'forced_plummer':'forced_plummer',
      'forced_gaussian':'forced_gaussian',
      'forced_top_hat':'forced_top_hat',
      'safe_plummer':'safe_plummer',
    }
    for aggregate_key,row_key in mapping.items():
        aggregate=held['aggregates'][aggregate_key]
        base=sum(row['baseline_chi2'] for row in stable)
        candidate=sum(row[row_key]['chi2'] for row in stable)
        verify_delta(base,candidate,aggregate['raw_delta_chi2'],aggregate['residual_reduction_pct'])
        close(base,aggregate['baseline_total_chi2'])
        close(candidate,aggregate['candidate_total_chi2'])
        assert aggregate['improved_count']==sum(row[row_key]['delta_chi2']<0 for row in stable)
        assert aggregate['worsened_count']==sum(row[row_key]['delta_chi2']>0 for row in stable)
        for row in stable:
            r=row[row_key]
            verify_delta(row['baseline_chi2'],r['chi2'],r['delta_chi2'],r['residual_reduction_pct'])
            assert r['f0_max_abs']==0.0
            assert abs(r['raw_mass_leak_fraction'])<=0.02
            assert abs(r['mass_leak_fraction'])<=1e-12
    plummer=held['aggregates']['forced_plummer']
    close(plummer['raw_delta_chi2'],-9.256213018221956)
    close(plummer['residual_reduction_pct'],4.432098539050158)
    assert plummer['improved_count']==5 and plummer['worsened_count']==1
    assert verification['status']=='PASS' and verification['byte_identical_replay'] is True
    assert verification['dev_heldout_overlap']==0
    assert receipt['heldout_aggregate']==plummer
    assert receipt['claim_boundary']==held['claim_boundary']
    assert public_reproduction['status']=='PASS'
    assert public_reproduction['scope']=='PUBLIC_REPRODUCTION_NUMERICAL_PARITY_ONLY'
    assert public_reproduction['heldout_numeric_match']['aggregate']==plummer
def verify_aggregate_specificity():
    audit=load('results/aggregate_specificity_audit.json')
    registry=load('results/experiment_registry.json')
    summary=load('results/xcop_hse_result_summary.json')
    xcop_self_audit=load('results/xcop_hse_adversarial_audit.json')
    assert audit['status']=='PASS'
    assert audit['adoption_decision']['aggregate_directional_results_preserved'] is True
    assert audit['adoption_decision']['aggregate_plummer_ranking_preserved_as_arithmetic'] is True
    assert audit['adoption_decision']['plummer_specificity_claim'] is False
    assert audit['r2_manifest_identity']['callable']=='sample_ids_sha256'
    assert audit['r2_manifest_identity']['audit_unit_ids_sha256']=='ad78c102841ada6185808f72f443e8aa1326706bdd8402ae644fa4dcf893f661'
    sparc=audit['sparc']; xcop=audit['xcop']
    assert sparc['frozen_fraction']==1.0 and sparc['fraction_grid_boundary_hit'] is True
    assert sparc['unit_count']==6 and sparc['plummer_beats_both_controls_count']==3
    assert sparc['aggregate']['plummer_best'] is True
    assert sparc['weight_concentration']['dominant_unit']=='NGC5585'
    assert sparc['weight_concentration']['dominant_unit_fraction_of_aggregate_gaussian_advantage']>1.0
    assert xcop['frozen_fraction']==1.0 and xcop['fraction_grid_boundary_hit'] is True
    assert xcop['unit_count']==3 and xcop['plummer_beats_both_controls_count']==1
    assert xcop['aggregate']['plummer_best'] is True
    assert xcop['aggregate_advantage_concentration']['dominant_unit']=='A644'
    assert xcop['aggregate_advantage_concentration']['dominant_unit_fraction_of_aggregate_gaussian_advantage']>1.0
    rows={row['record_id']:row for row in registry['records']}
    assert rows['SPARC_ROTATION_CURVE_SHARED_ADAPTER']['plummer_beats_both_controls_count']==3
    assert rows['SPARC_ROTATION_CURVE_SHARED_ADAPTER']['specificity_unit_count']==6
    assert rows['XCOP_HYDROSTATIC_DIRECT_FORMAL_SOURCE']['plummer_beats_both_controls_count']==1
    assert rows['XCOP_HYDROSTATIC_DIRECT_FORMAL_SOURCE']['specificity_unit_count']==3
    assert summary['verification']['independent_audit']=='NOT_ESTABLISHED'
    assert summary['verification']['adversarial_audit']=='INTERNAL_SELF_AUDIT_PASS'
    assert summary['aggregate_specificity']['plummer_beats_both_controls_count']==1
    assert xcop_self_audit['audit_authority']=='INTERNAL_SELF_AUDIT_NOT_INDEPENDENT_EXTERNAL_REVIEW'
    assert xcop_self_audit['aggregate_specificity_addendum']['plummer_beats_both_controls_count']==1
def verify_jeans():
    held=load('results/jeans_dsph_heldout.json')
    dev=load('results/jeans_dsph_dev_grid.json')
    policy=load('results/jeans_dsph_frozen_policy.json')
    sample=load('results/jeans_dsph_sample_manifest.json')
    receipt=load('results/jeans_dsph_run_receipt.json')
    verification=load('results/jeans_dsph_verification.json')
    failures=load('results/jeans_dsph_failure_ledger.json')
    assert not set(sample['dev']).intersection(sample['heldout'])
    assert sample['dev']==['Sextans','Fornax']
    assert sample['heldout']==['Sculptor','Carina']
    assert held['heldout_names']==sample['heldout']
    assert dev['heldout_accessed'] is False
    assert policy['heldout_scores_accessed'] is False
    assert held['safe_policy']['f']==policy['safe_optimum']['f']==0.0
    assert held['forced_nonzero_policy']['f']==policy['forced_nonzero_optimum']['f']==0.05
    assert held['forced_nonzero_policy']['eta']==policy['forced_nonzero_optimum']['eta']==0.03125
    assert sample['dispersion_profiles']['Carina']['member_count']==746
    assert sample['dispersion_profiles']['Fornax']['member_count']==2279
    assert sample['dispersion_profiles']['Sculptor']['member_count']==1349
    assert sample['dispersion_profiles']['Sextans']['member_count']==397
    rows=held['rows']
    assert len(rows)==2 and all(row['baseline_stable'] for row in rows)
    for key in ('safe_plummer','forced_plummer','forced_gaussian','forced_top_hat'):
        aggregate=held['aggregates'][key]
        base=sum(row['baseline_chi2'] for row in rows)
        candidate=sum(row[key]['chi2'] for row in rows)
        verify_delta(base,candidate,aggregate['raw_delta_chi2'],aggregate['residual_reduction_pct'])
        close(base,aggregate['baseline_total_chi2'])
        close(candidate,aggregate['candidate_total_chi2'])
        assert aggregate['improved_count']==sum(row[key]['delta_chi2']<0 for row in rows)
        assert aggregate['worsened_count']==sum(row[key]['delta_chi2']>0 for row in rows)
        for row in rows:
            result=row[key]
            verify_delta(row['baseline_chi2'],result['chi2'],result['delta_chi2'],result['residual_reduction_pct'])
            assert result['f0_max_abs_kms']==0.0
            assert abs(result['raw_mass_leak_fraction'])<=0.02
            assert abs(result['mass_leak_fraction'])<=1e-12
    safe=held['aggregates']['safe_plummer']
    forced=held['aggregates']['forced_plummer']
    close(safe['raw_delta_chi2'],0.0)
    close(forced['raw_delta_chi2'],0.00190530699818936)
    close(forced['residual_reduction_pct'],-0.005389404945401978)
    assert forced['improved_count']==0 and forced['worsened_count']==2
    assert verification['status']=='PASS'
    assert verification['checks']['dev_replay_byte_identical'] is True
    assert verification['checks']['heldout_replay_byte_identical'] is True
    assert receipt['status']=='COMPLETE_NEGATIVE_RESULT'
    assert receipt['result_label']=='NO_ADAPTER_UPLIFT_SAFE_FLOOR_SELECTED'
    assert receipt['heldout_aggregates']==held['aggregates']
    assert receipt['claim_boundary']==held['claim_boundary']
    assert len(failures['failures'])==3
def verify_jeans_formal_corrective():
    held=load('results/jeans_dsph_formal_corrective_evaluation.json')
    dev=load('results/jeans_dsph_formal_corrective_dev_grid.json')
    policy=load('results/jeans_dsph_formal_corrective_frozen_policy.json')
    sample=load('results/jeans_dsph_formal_corrective_sample_manifest.json')
    audit=load('results/jeans_dsph_formal_corrective_audit.json')
    replay=load('results/jeans_dsph_formal_corrective_replay_receipt.json')
    public_reproduction=load('results/jeans_dsph_formal_corrective_public_reproduction_check.json')
    assert sample['development']==['Carina','Fornax','Sculptor','Sextans']
    assert sample['heldout']==['Draco','Ursa Minor'] and sample['overlap_count']==0
    assert held['proof_mode']=='POST_EXPOSURE_CORRECTIVE_FORMAL_SOURCE_REPRODUCTION'
    assert held['claim_allowed'] is False and held['response_projection_used'] is False
    assert dev['response_projection_used'] is False
    assert policy['response_projection_used'] is False
    assert policy['status']=='FROZEN_BEFORE_CORRECTIVE_EVALUATION_SCORING'
    assert policy['safe_optimum']['f']==0.0
    assert policy['direct_nonzero_optimum']['f']==0.05
    assert policy['direct_nonzero_optimum']['eta']==0.03125
    for key in ('safe_plummer','direct_nonzero_plummer','direct_nonzero_gaussian','direct_nonzero_top_hat'):
        a=held['aggregates'][key]
        base=sum(row['baseline_chi2'] for row in held['rows'])
        cand=sum(row[key]['chi2'] for row in held['rows'])
        verify_delta(base,cand,a['raw_delta_chi2'],a['residual_reduction_pct'])
        close(base,a['baseline_total_chi2']); close(cand,a['candidate_total_chi2'])
        assert a['improved_count']==sum(row[key]['delta_chi2']<0 for row in held['rows'])
        assert a['worsened_count']==sum(row[key]['delta_chi2']>0 for row in held['rows'])
    p=held['aggregates']['direct_nonzero_plummer']
    close(p['raw_delta_chi2'],-0.0011593988829652346)
    close(p['residual_reduction_pct'],0.005077144705320756)
    assert p['improved_count']==2 and p['worsened_count']==0
    assert all(row['safe_plummer']['f0_max_abs_kms']==0.0 for row in held['rows'])
    assert audit['status']=='PASS' and len(audit['checks'])==61 and all(x['pass'] for x in audit['checks'])
    assert replay['status']=='PASS_NUMERICALLY_EQUIVALENT_NON_BYTE_IDENTICAL'
    assert replay['aggregate_direction_counts_preserved'] is True
    assert replay['aggregate_delta_signs_preserved'] is True
    assert public_reproduction['status']=='PASS_NUMERICAL_PARITY'
    assert public_reproduction['scope']=='PUBLIC_REPRODUCTION_NUMERICAL_PARITY_ONLY'
    assert public_reproduction['policy_identity_preserved'] is True
    assert public_reproduction['direction_counts_preserved'] is True
    assert public_reproduction['delta_signs_preserved'] is True
    close(public_reproduction['max_raw_delta_chi2_difference'],0.0)
def verify_canonical_object_identity():
    registry=load('results/experiment_registry.json')
    audit=load('results/canonical_object_identity_audit.json')
    rows={row['record_id']:row for row in registry['records']}
    assert audit['status']=='PASS' and all(audit['checks'].values())
    assert 'DSPH_JEANS_V2_RESPONSE_ORTHOGONAL_ADAPTER' not in rows
    assert rows['DSPH_SPHERICAL_JEANS_SHARED_ADAPTER']['method_relevance']=='CANONICAL_DIRECT_SOURCE_ADOPTED_POLICY_EXACT_BASELINE_FORCED_DIAGNOSTIC_NOT_ADOPTED'
    assert rows['DSPH_JEANS_DIRECT_FORMAL_SOURCE_CORRECTIVE']['method_relevance']=='CANONICAL_DIRECT_SOURCE_CORRECTIVE_POST_EXPOSURE'
    shared=audit['canonical_public_records']['shared_adapter']
    direct=audit['canonical_public_records']['direct_formal_source']
    assert shared['adopted_fraction']==0.0
    assert shared['adopted_raw_delta_chi2']==0.0
    assert shared['adopted_downlift'] is False
    assert direct['response_projection_used'] is False
    assert direct['direct_nonzero_raw_delta_chi2']<0.0
    assert direct['improved_count']==2 and direct['worsened_count']==0
    assert direct['downlift'] is False
def verify_xcop_hse():
    held=load('results/xcop_hse_heldout.json')
    policy=load('results/xcop_hse_frozen_policy.json')
    sample=load('results/xcop_hse_sample_manifest.json')
    audit=load('results/xcop_hse_adversarial_audit.json')
    summary=load('results/xcop_hse_result_summary.json')
    public_reproduction=load('results/xcop_hse_public_reproduction_check.json')
    assert sample['development']==['A2319','A85','ZW1215','A2142']
    assert sample['heldout']==['A644','A2029','A1795']
    assert sample['overlap_count']==0
    assert not set(sample['development']).intersection(sample['heldout'])
    assert held['heldout']==sample['heldout']
    assert held['overlap_count']==0
    assert policy['status']=='FROZEN_BEFORE_HELDOUT_SCORING'
    assert policy['heldout_rules']['parameter_update'] is False
    assert policy['heldout_rules']['row_level_fallback'] is False
    assert held['safe_policy']['f']==policy['safe_policy']['f']==1.0
    assert held['safe_policy']['eta']==policy['safe_policy']['eta']==0.01
    for rows,aggregate in [
        (held['safe_rows'],held['safe_aggregate']),
        (held['generic_control_rows']['gaussian'],held['generic_control_aggregates']['gaussian']),
        (held['generic_control_rows']['top_hat'],held['generic_control_aggregates']['top_hat']),
    ]:
        base=sum(row['baseline_chi2'] for row in rows)
        aug=sum(row['augmented_chi2'] for row in rows)
        delta=sum(row['delta_chi2'] for row in rows)
        close(base,aggregate['baseline_chi2_sum'])
        close(aug,aggregate['augmented_chi2_sum'])
        close(delta,aggregate['delta_chi2_sum'])
        close(aug-base,delta)
        assert aggregate['improved_count']==sum(row['delta_chi2']<0 for row in rows)
        assert aggregate['downlift_count']==sum(row['delta_chi2']>0 for row in rows)
        for row in rows:
            verify_delta(row['baseline_chi2'],row['augmented_chi2'],row['delta_chi2'],row['residual_reduction_pct'])
            assert abs(row['raw_mass_leak_fraction'])<=0.05
            assert abs(row['mass_leak_fraction'])<=1e-12
    primary=held['safe_aggregate']
    close(primary['baseline_chi2_sum'],145.09530814170438)
    close(primary['augmented_chi2_sum'],140.7377852116995)
    close(primary['delta_chi2_sum'],-4.357522930004862)
    assert primary['improved_count']==3 and primary['downlift_count']==0
    assert held['f0_recovery']['pass'] is True
    assert held['f0_recovery']['max_abs_mass_msun']==0.0
    assert held['f0_recovery']['max_abs_pressure_prediction_kev_cm3']==0.0
    assert held['safe_aggregate']['augmented_chi2_sum'] < held['generic_control_aggregates']['gaussian']['augmented_chi2_sum']
    assert held['generic_control_aggregates']['gaussian']['augmented_chi2_sum'] < held['generic_control_aggregates']['top_hat']['augmented_chi2_sum']
    assert audit['status']=='PASS'
    assert all(audit['checks'].values())
    assert audit['direct_formal_equation_label']=='PASS'
    assert audit['audit_authority']=='INTERNAL_SELF_AUDIT_NOT_INDEPENDENT_EXTERNAL_REVIEW'
    assert summary['verification']['deterministic_byte_identical_replay'] is True
    assert summary['verification']['independent_audit']=='NOT_ESTABLISHED'
    assert summary['verification']['adversarial_audit']=='INTERNAL_SELF_AUDIT_PASS'
    assert public_reproduction['status']=='PASS_NUMERICAL_PARITY'
    assert public_reproduction['scope']=='PUBLIC_REPRODUCTION_NUMERICAL_PARITY_ONLY'
    assert public_reproduction['policy_identity_preserved'] is True
    assert public_reproduction['sample_identity_preserved'] is True
    assert public_reproduction['heldout_identity_preserved'] is True
    assert public_reproduction['direction_counts_preserved'] is True
    assert public_reproduction['delta_signs_preserved'] is True
    assert public_reproduction['public_replay_audit_status']=='PASS'
    assert public_reproduction['public_replay_internal_byte_identical'] is True
    assert public_reproduction['within_numerical_tolerance_1e_10'] is True
    assert max(public_reproduction['max_absolute_differences'].values()) < 1e-10
def main():
    verify_conceptual_origin()
    hff=load('results/hff_six_cluster_transfer.json')
    for row in hff['rows']:
        for key in ('plummer_like_2d','gaussian_2d','top_hat_2d'):
            r=row[key]; verify_delta(row['baseline_mean_mse'],r['augmented_mean_mse'],r['raw_delta_mse'],r['residual_reduction_pct'])
    b2=load('results/as1063_b2_true_density.json'); verify_delta(b2['base_score']['chi_total'],b2['augmented_score']['chi_total'],b2['raw_delta_chi_total'],b2['residual_reduction_pct'])
    for rel in ('results/as1063_b2_matched_controls.json','results/sidm_halo000_3d.json','results/sidm_halo352_fresh_3d.json'):
        x=load(rel); base=x['base_chi_total']
        for r in x['kernels'].values(): verify_delta(base,r['chi_total'],r['raw_delta_chi_total'],r['residual_reduction_pct'])
    verify_sparc()
    verify_aggregate_specificity()
    verify_jeans()
    verify_jeans_formal_corrective()
    verify_canonical_object_identity()
    verify_xcop_hse()
    manifest=load('RELEASE_MANIFEST.json')
    forbidden=[re.compile('/'+'Users/'),re.compile(r'sk-(?:proj-)?[A-Za-z0-9_-]{16,}'),re.compile(r'BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY')]
    public_paths=[ROOT/rel for rel in manifest['files']]
    public_paths.append(ROOT/'RELEASE_MANIFEST.json')
    for p in public_paths:
        try: text=p.read_text()
        except UnicodeDecodeError: continue
        for pat in forbidden:
            if pat.search(text): raise AssertionError(f'forbidden content {pat.pattern!r} in {p.relative_to(ROOT)}')
    for rel,expected in manifest['files'].items():
        actual=hashlib.sha256((ROOT/rel).read_bytes()).hexdigest()
        if actual!=expected: raise AssertionError(f'hash mismatch: {rel}')
    print(json.dumps({'status':'PASS','arithmetic':'PASS','local_path_scan':'PASS','secret_scan':'PASS','manifest_files':len(manifest['files'])},indent=2))
    return 0
if __name__=='__main__': raise SystemExit(main())
