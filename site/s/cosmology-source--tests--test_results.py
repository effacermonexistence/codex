import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def test_conceptual_origin_is_public_and_evidence_bounded():
    readme=(ROOT/'README.md').read_text()
    origin=(ROOT/'docs/CONCEPTUAL_ORIGIN.md').read_text().lower()
    boundaries=(ROOT/'docs/CLAIM_BOUNDARIES.md').read_text()
    assert 'docs/CONCEPTUAL_ORIGIN.md' in readme
    assert 'vision pro' in origin
    assert 'einstein-rosen' in origin
    assert 'not empirical evidence' in origin
    assert 'not derived' in origin
    assert 'plummer' in origin and 'not derived uniquely' in origin
    assert 'Vision Pro observation' in boundaries
def test_fresh_halo352_numbers():
    x=json.loads((ROOT/'results/sidm_halo352_fresh_3d.json').read_text())
    assert round(x['kernels']['plummer_3d']['residual_reduction_pct'],3)==41.000
    assert x['kernels']['gaussian_3d']['chi_total'] < x['kernels']['plummer_3d']['chi_total']
    assert x['kernels']['tophat_3d']['chi_total'] < x['kernels']['plummer_3d']['chi_total']
def test_hff_controls_are_not_hidden():
    x=json.loads((ROOT/'results/hff_six_cluster_transfer.json').read_text())
    assert x['summary']['plummer_improved']==6
    assert x['summary']['plummer_better_than_gaussian_clusters']==1
    assert x['summary']['plummer_better_than_tophat_clusters']==1
def test_sparc_shared_adapter_numbers_and_boundary():
    x=json.loads((ROOT/'results/sparc_rotation_curve_heldout.json').read_text())
    a=x['aggregates']['forced_plummer']
    assert round(a['raw_delta_chi2'],6)==-9.256213
    assert round(a['residual_reduction_pct'],3)==4.432
    assert a['improved_count']==5
    assert a['worsened_count']==1
    assert x['forced_nonzero_policy']['f']==1.0
    assert x['forced_nonzero_policy']['eta']==0.125
    assert x['claim_allowed'] is False
def test_sparc_generic_controls_are_visible():
    x=json.loads((ROOT/'results/sparc_rotation_curve_heldout.json').read_text())
    p=x['aggregates']['forced_plummer']['candidate_total_chi2']
    g=x['aggregates']['forced_gaussian']['candidate_total_chi2']
    t=x['aggregates']['forced_top_hat']['candidate_total_chi2']
    assert p < g and p < t
    assert x['aggregates']['forced_gaussian']['improved_count']==5
    assert x['aggregates']['forced_top_hat']['improved_count']==5
    stable=[row for row in x['rows'] if row['baseline_stable']]
    assert sum(
        row['forced_plummer']['delta_chi2'] < row['forced_gaussian']['delta_chi2']
        and row['forced_plummer']['delta_chi2'] < row['forced_top_hat']['delta_chi2']
        for row in stable
    )==3

def test_aggregate_specificity_boundary_is_machine_readable():
    x=json.loads((ROOT/'results/aggregate_specificity_audit.json').read_text())
    assert x['status']=='PASS'
    assert x['adoption_decision']['aggregate_directional_results_preserved'] is True
    assert x['adoption_decision']['aggregate_plummer_ranking_preserved_as_arithmetic'] is True
    assert x['adoption_decision']['plummer_specificity_claim'] is False
    assert x['sparc']['frozen_fraction']==1.0
    assert x['sparc']['plummer_beats_both_controls_count']==3
    assert x['sparc']['unit_count']==6
    assert x['sparc']['weight_concentration']['dominant_unit']=='NGC5585'
    assert x['sparc']['weight_concentration']['dominant_unit_fraction_of_aggregate_gaussian_advantage']>1.0
    assert x['xcop']['frozen_fraction']==1.0
    assert x['xcop']['plummer_beats_both_controls_count']==1
    assert x['xcop']['unit_count']==3
    assert x['xcop']['aggregate_advantage_concentration']['dominant_unit']=='A644'
    assert x['xcop']['aggregate_advantage_concentration']['dominant_unit_fraction_of_aggregate_gaussian_advantage']>1.0
def test_sparc_public_reproduction_check_is_bounded():
    x=json.loads((ROOT/'results/sparc_rotation_curve_public_reproduction_check.json').read_text())
    assert x['status']=='PASS'
    assert x['scope']=='PUBLIC_REPRODUCTION_NUMERICAL_PARITY_ONLY'
    assert 'not a new heldout run' in x['proof_boundary']
def test_jeans_calibration_selected_safe_floor():
    x=json.loads((ROOT/'results/jeans_dsph_heldout.json').read_text())
    assert x['safe_policy']['f']==0.0
    assert x['aggregates']['safe_plummer']['raw_delta_chi2']==0.0
    assert x['claim_allowed'] is False
def test_jeans_forced_nonzero_result_is_negative():
    x=json.loads((ROOT/'results/jeans_dsph_heldout.json').read_text())
    a=x['aggregates']['forced_plummer']
    assert round(a['raw_delta_chi2'],9)==0.001905307
    assert round(a['residual_reduction_pct'],6)==-0.005389
    assert a['improved_count']==0
    assert a['worsened_count']==2
    assert a['downlift'] is True
def test_jeans_replay_and_numerical_gates_passed():
    x=json.loads((ROOT/'results/jeans_dsph_verification.json').read_text())
    assert x['status']=='PASS'
    assert x['checks']['dev_replay_byte_identical'] is True
    assert x['checks']['heldout_replay_byte_identical'] is True
    assert x['checks']['all_f0_exact'] is True
    assert x['checks']['all_mass_corrections_within_gate'] is True
def test_public_registry_contains_only_canonical_jeans_records():
    registry=json.loads((ROOT/'results/experiment_registry.json').read_text())
    rows={row['record_id']:row for row in registry['records']}
    assert 'DSPH_JEANS_V2_RESPONSE_ORTHOGONAL_ADAPTER' not in rows
    assert rows['DSPH_SPHERICAL_JEANS_SHARED_ADAPTER']['method_relevance']=='CANONICAL_DIRECT_SOURCE_ADOPTED_POLICY_EXACT_BASELINE_FORCED_DIAGNOSTIC_NOT_ADOPTED'
    assert rows['DSPH_JEANS_DIRECT_FORMAL_SOURCE_CORRECTIVE']['method_relevance']=='CANONICAL_DIRECT_SOURCE_CORRECTIVE_POST_EXPOSURE'


def test_canonical_object_identity_audit_passes():
    x=json.loads((ROOT/'results/canonical_object_identity_audit.json').read_text())
    assert x['status']=='PASS'
    assert all(x['checks'].values())
    shared=x['canonical_public_records']['shared_adapter']
    direct=x['canonical_public_records']['direct_formal_source']
    assert shared['adopted_raw_delta_chi2']==0.0
    assert shared['adopted_downlift'] is False
    assert direct['response_projection_used'] is False
    assert direct['direct_nonzero_raw_delta_chi2']<0.0
    assert direct['improved_count']==2
    assert direct['worsened_count']==0
    assert direct['downlift'] is False


def test_jeans_corrective_direct_source_is_tiny_negative_direction():
    x=json.loads((ROOT/'results/jeans_dsph_formal_corrective_evaluation.json').read_text())
    a=x['aggregates']['direct_nonzero_plummer']
    assert x['response_projection_used'] is False
    assert x['proof_mode']=='POST_EXPOSURE_CORRECTIVE_FORMAL_SOURCE_REPRODUCTION'
    assert round(a['raw_delta_chi2'],12)==round(-0.0011593988829652346,12)
    assert round(a['residual_reduction_pct'],9)==round(0.005077144705320756,9)
    assert a['improved_count']==2 and a['worsened_count']==0
    assert x['claim_allowed'] is False

def test_jeans_corrective_safe_policy_and_audit_boundary():
    policy=json.loads((ROOT/'results/jeans_dsph_formal_corrective_frozen_policy.json').read_text())
    audit=json.loads((ROOT/'results/jeans_dsph_formal_corrective_audit.json').read_text())
    assert policy['safe_optimum']['f']==0.0
    assert policy['direct_nonzero_optimum']['f']==0.05
    assert policy['direct_nonzero_optimum']['eta']==0.03125
    assert audit['status']=='PASS'
    assert audit['audit_label']=='CORRECT_FORMAL_SOURCE_DIRECTIONAL_DELTA_NEGATIVE_BUT_MATERIALITY_NOT_ESTABLISHED'
    assert len(audit['checks'])==61 and all(x['pass'] for x in audit['checks'])

def test_jeans_corrective_public_reproduction_parity():
    x=json.loads((ROOT/'results/jeans_dsph_formal_corrective_public_reproduction_check.json').read_text())
    assert x['status']=='PASS_NUMERICAL_PARITY'
    assert x['scope']=='PUBLIC_REPRODUCTION_NUMERICAL_PARITY_ONLY'
    assert x['policy_identity_preserved'] is True
    assert x['direction_counts_preserved'] is True
    assert x['delta_signs_preserved'] is True
    assert x['max_raw_delta_chi2_difference']==0.0

def test_xcop_direct_hydrostatic_heldout_result():
    x=json.loads((ROOT/'results/xcop_hse_heldout.json').read_text())
    a=x['safe_aggregate']
    assert x['heldout']==['A644','A2029','A1795']
    assert x['overlap_count']==0
    assert x['safe_policy']['f']==1.0
    assert x['safe_policy']['eta']==0.01
    assert round(a['baseline_chi2_sum'],6)==145.095308
    assert round(a['augmented_chi2_sum'],6)==140.737785
    assert round(a['delta_chi2_sum'],6)==-4.357523
    assert a['improved_count']==3
    assert a['downlift_count']==0
    assert x['f0_recovery']['pass'] is True

def test_xcop_controls_and_audit_boundary():
    x=json.loads((ROOT/'results/xcop_hse_heldout.json').read_text())
    audit=json.loads((ROOT/'results/xcop_hse_adversarial_audit.json').read_text())
    p=x['safe_aggregate']['augmented_chi2_sum']
    g=x['generic_control_aggregates']['gaussian']['augmented_chi2_sum']
    t=x['generic_control_aggregates']['top_hat']['augmented_chi2_sum']
    assert p < g < t
    assert x['generic_control_aggregates']['gaussian']['improved_count']==3
    assert x['generic_control_aggregates']['top_hat']['improved_count']==3
    assert audit['status']=='PASS'
    assert audit['direct_formal_equation_label']=='PASS'
    assert audit['heldout_directional_label']=='DESCRIPTIVE_PASS_3_OF_3_NO_DOWNLIFT'
    assert audit['plummer_specificity_label']=='AGGREGATE_RANKING_ARITHMETICALLY_TRUE_PER_UNIT_SPECIFICITY_NOT_ESTABLISHED'
    assert audit['audit_authority']=='INTERNAL_SELF_AUDIT_NOT_INDEPENDENT_EXTERNAL_REVIEW'
    assert audit['aggregate_specificity_addendum']['plummer_beats_both_controls_count']==1

def test_xcop_public_summary_does_not_overclaim_audit_authority():
    x=json.loads((ROOT/'results/xcop_hse_result_summary.json').read_text())
    assert x['verification']['independent_audit']=='NOT_ESTABLISHED'
    assert x['verification']['adversarial_audit']=='INTERNAL_SELF_AUDIT_PASS'
    assert x['verification']['aggregate_specificity_audit']=='PASS_CONDITIONAL_DOWNGRADE'

def test_xcop_public_reproduction_numerical_parity():
    x=json.loads((ROOT/'results/xcop_hse_public_reproduction_check.json').read_text())
    assert x['status']=='PASS_NUMERICAL_PARITY'
    assert x['scope']=='PUBLIC_REPRODUCTION_NUMERICAL_PARITY_ONLY'
    assert x['policy_identity_preserved'] is True
    assert x['sample_identity_preserved'] is True
    assert x['heldout_identity_preserved'] is True
    assert x['direction_counts_preserved'] is True
    assert x['delta_signs_preserved'] is True
    assert x['public_replay_audit_status']=='PASS'
    assert x['public_replay_internal_byte_identical'] is True
    assert x['within_numerical_tolerance_1e_10'] is True
    assert max(x['max_absolute_differences'].values()) < 1e-10
