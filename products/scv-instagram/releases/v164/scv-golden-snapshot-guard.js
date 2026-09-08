#!/usr/bin/env node
// ============================================================
// SCV GOLDEN SNAPSHOT GUARD — no silent drift after first full-run pass.
//
// The R2 tarball is the durable restoration object. This guard makes live boot
// prove that the critical files still match the locked manifest. Intentional
// evolution is allowed only by updating this manifest in the same change.
// ============================================================
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const SCV_GOLDEN_SNAPSHOT_LOCK_VERSION = 'scv-golden-snapshot-lock-2026-07-09-v1'
const MANIFEST_FILE = path.join(__dirname, 'SCV_GOLDEN_SNAPSHOT_MANIFEST.json')

function readManifest(root = __dirname) {
  const file = path.join(root, 'SCV_GOLDEN_SNAPSHOT_MANIFEST.json')
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function canonicalizeCriticalFile(rel, raw) {
  if (rel === 'scv-immutable-drift-firewall.js') {
    return raw.replace(
      /const SCV_EXPECTED_IMMUTABLE_DRIFT_SEAL_SHA256 = '[0-9a-f_]{10,}'/,
      "const SCV_EXPECTED_IMMUTABLE_DRIFT_SEAL_SHA256 = '__SCV_IMMUTABLE_SEAL_SHA256__'"
    )
  }
  return raw
}

function hashCriticalFile(file, rel) {
  const raw = fs.readFileSync(file, 'utf8')
  return crypto.createHash('sha256').update(canonicalizeCriticalFile(rel, raw)).digest('hex')
}

function runScvGoldenSnapshotGuard({ root = __dirname } = {}) {
  const manifest = readManifest(root)
  let checked = 0
  function ok(cond, label, detail = '') {
    if (!cond) throw new Error(`${label}${detail ? `:${detail}` : ''}`)
    checked++
  }

  ok(manifest.lock_version === SCV_GOLDEN_SNAPSHOT_LOCK_VERSION, 'golden_lock_version_mismatch', String(manifest.lock_version || ''))
  ok(manifest.artifact_id === 'scv-instagram-first-full-run-pass-20260709T064146Z-v1', 'golden_artifact_id_mismatch', String(manifest.artifact_id || ''))
  ok(manifest.sha256_tar_gz === '2ca4f079f9e85772c77ffc053902681b49fd3fd9d1c1bda41005d6260a4659bd', 'golden_tar_sha_mismatch', String(manifest.sha256_tar_gz || ''))
  ok(String(manifest.r2_uri || '').includes(manifest.artifact_id), 'golden_r2_uri_missing_artifact', String(manifest.r2_uri || ''))
  ok(manifest.secrets_included === false, 'golden_manifest_must_exclude_secrets')
  ok(manifest.runtime_state_included === false, 'golden_manifest_must_exclude_runtime_state')
  ok(/^scv-[a-z0-9._/-]+$/.test(String(manifest.current_restore_ref || '')), 'golden_current_restore_ref_invalid', String(manifest.current_restore_ref || ''))
  ok(manifest.closed_contract?.enumerated_transition_cases === 132, 'golden_closed_transition_cases_mismatch', String(manifest.closed_contract?.enumerated_transition_cases || ''))
  ok(manifest.closed_contract?.enumerated_flag_combinations === 3072, 'golden_closed_flag_combinations_mismatch', String(manifest.closed_contract?.enumerated_flag_combinations || ''))
  ok(manifest.closed_contract?.transition_assertions === 9936, 'golden_closed_transition_assertions_mismatch', String(manifest.closed_contract?.transition_assertions || ''))
  ok(manifest.closed_contract?.pricing_question_fail_closed_policy === 'current_turn_free_cost_charge_fee_price_rate_quote_estimate_pay_and_how_much_price_intents_route_direct_150_per_hour_plus_own_style_condition_availability_free_creative_freedom_and_tolerance_excluded_sales_value_defense_and_curiosity_deflection_rejected_exact_obligation_never_liveness_fail_open', 'golden_pricing_question_fail_closed_policy_mismatch', String(manifest.closed_contract?.pricing_question_fail_closed_policy || ''))
  ok(manifest.closed_contract?.model_authored_pricing_surface_policy === 'pricing_is_atomic_fact_authority_usd_150_per_hour_model_discount_artist_style_eligibility_policy_prose_copy_is_rejected_and_no_deterministic_conversational_price_sentence_may_ship', 'golden_model_authored_pricing_surface_policy_mismatch', String(manifest.closed_contract?.model_authored_pricing_surface_policy || ''))
  ok(manifest.closed_contract?.ingress_supersession_policy === 'authoritative_latest_message_id_immutable_ingress_clock_retry_timestamps_ignored', 'golden_ingress_supersession_policy_mismatch', String(manifest.closed_contract?.ingress_supersession_policy || ''))
  ok(manifest.closed_contract?.authoritative_latest_recovery_policy === 'uncommitted_latest_auto_recovered_from_superseded_quarantine', 'golden_authoritative_latest_recovery_policy_mismatch', String(manifest.closed_contract?.authoritative_latest_recovery_policy || ''))
  ok(manifest.closed_contract?.media_form_offer_repair_policy === 'vision_resolved_design_routes_model_authored_offer_once_no_unsolicited_link', 'golden_media_form_offer_repair_policy_mismatch', String(manifest.closed_contract?.media_form_offer_repair_policy || ''))
  ok(manifest.closed_contract?.packet_local_form_offer_media_authority_policy === 'form_offer_detection_requires_explicit_form_or_application_object_within_one_assistant_packet_and_design_authority_requires_verified_tattoo_reference_media_or_current_client_subject_required_element_subject_bounded_creative_freedom_or_bounded_requested_visual_fulfillment_chain_unanchored_non_tattoo_media_cannot_advance_booking', 'golden_packet_local_form_offer_media_authority_policy_mismatch', String(manifest.closed_contract?.packet_local_form_offer_media_authority_policy || ''))
  ok(manifest.closed_contract?.client_anchored_inspiration_authority_policy === 'explicit_current_client_subject_required_element_or_subject_bounded_creative_freedom_and_bounded_requested_visual_fulfillment_chain_own_design_intent_over_media_file_category_and_route_brief_customization_to_one_form_offer_random_stale_or_unanchored_non_tattoo_media_remains_contextual', 'golden_client_anchored_inspiration_authority_policy_mismatch', String(manifest.closed_contract?.client_anchored_inspiration_authority_policy || ''))
  ok(manifest.closed_contract?.requested_reference_chain_policy === 'prior_client_visual_pointer_plus_actual_reference_request_plus_either_enriched_visual_or_exact_client_delivery_selector_may_survive_one_bounded_correction_and_one_immediate_visual_selection_question_transport_shadow_proves_delivery_only_never_pixels_unrelated_turns_generic_apologies_multiple_assistant_packets_random_media_and_stale_images_never_gain_authority', 'golden_requested_reference_chain_policy_mismatch', String(manifest.closed_contract?.requested_reference_chain_policy || ''))
  ok(manifest.closed_contract?.transport_shadow_reference_policy === 'instagram_rendered_manychat_omitted_requested_media_may_be_recovered_only_by_exact_pointer_then_single_assistant_media_request_packet_then_client_delivery_selector_or_correction_shadow_proves_delivery_not_contents_generic_apology_plain_that_one_intervening_user_or_multiple_assistant_packets_denied_valid_chain_routes_once_to_form_offer_and_bad_missing_media_candidate_retries_through_verifier', 'golden_transport_shadow_reference_policy_mismatch', String(manifest.closed_contract?.transport_shadow_reference_policy || ''))
  ok(manifest.closed_contract?.contextual_visual_asr_selection_policy === 'mean_to_im_in_phonetic_repair_requires_immediately_adjacent_visual_evidence_and_concrete_lexical_overlap_never_phrase_only', 'golden_contextual_visual_asr_selection_policy_mismatch', String(manifest.closed_contract?.contextual_visual_asr_selection_policy || ''))
  ok(manifest.closed_contract?.contextual_booking_ellipsis_policy === 'immediate_latest_assistant_date_question_binds_one_bare_day_to_post_form_booking_missing_month_is_detected_noncalendar_dimensions_are_excluded_and_the_date_frame_cannot_be_downgraded_to_size_or_prematurely_confirmed_before_month', 'golden_contextual_booking_ellipsis_policy_mismatch', String(manifest.closed_contract?.contextual_booking_ellipsis_policy || ''))
  ok(manifest.closed_contract?.verifier_driven_slot_reroute_policy === 'strict_size_verifier_rejection_returns_reason_to_router_only_when_no_higher_authority_dialogue_slot_exists_immediate_post_form_date_question_keeps_date_route_and_requests_month_only_without_false_availability_confirmation', 'golden_verifier_driven_slot_reroute_policy_mismatch', String(manifest.closed_contract?.verifier_driven_slot_reroute_policy || ''))
  ok(manifest.closed_contract?.concrete_design_evidence_policy === 'tense_aspect_invariant_open_vocabulary_explicit_current_turn_subject_or_subject_bounded_creative_freedom_is_design_authority_generic_interest_unbounded_creative_freedom_placeholders_compliments_transport_labels_body_only_and_palette_only_are_denied', 'golden_concrete_design_evidence_policy_mismatch', String(manifest.closed_contract?.concrete_design_evidence_policy || ''))
  ok(manifest.closed_contract?.design_route_consistency_policy === 'controller_state_and_post_filter_share_one_open_vocabulary_design_evidence_gate', 'golden_design_route_consistency_policy_mismatch', String(manifest.closed_contract?.design_route_consistency_policy || ''))
  ok(manifest.closed_contract?.form_identity_adoption_policy === 'corroborated_identity_only_single_unclaimed_forbidden_debug_current_link_required_quoted_printable_decoded', 'golden_form_identity_adoption_policy_mismatch', String(manifest.closed_contract?.form_identity_adoption_policy || ''))
  ok(manifest.closed_contract?.booking_checkpoint_surface_policy === 'day_first_ordinal_month_four_line_double_check_amount_label_account_single_final_cta', 'golden_booking_checkpoint_surface_policy_mismatch', String(manifest.closed_contract?.booking_checkpoint_surface_policy || ''))
  ok(manifest.closed_contract?.post_form_day_availability_policy === 'explicit_saturday_sunday_or_weekend_answer_offers_matching_day_without_repeating_form_or_prompt', 'golden_post_form_day_availability_policy_mismatch', String(manifest.closed_contract?.post_form_day_availability_policy || ''))
  ok(manifest.closed_contract?.double_check_adoption_policy === 'controller_rewrites_any_valid_four_field_candidate_to_single_canonical_day_first_block_before_receipt', 'golden_double_check_adoption_policy_mismatch', String(manifest.closed_contract?.double_check_adoption_policy || ''))
  ok(manifest.closed_contract?.canonical_double_check_field_equivalence_policy === 'history_month_first_and_visible_day_first_are_same_slot_only_when_canonical_date_time_keys_match', 'golden_canonical_double_check_field_equivalence_policy_mismatch', String(manifest.closed_contract?.canonical_double_check_field_equivalence_policy || ''))
  ok(manifest.closed_contract?.post_filter_transition_adoption_policy === 'executed_packet_must_pass_locked_transition_after_all_deterministic_strips_before_runner_return', 'golden_post_filter_transition_adoption_policy_mismatch', String(manifest.closed_contract?.post_filter_transition_adoption_policy || ''))
  ok(manifest.closed_contract?.authority_evidence_route_policy === 'pass_one_media_asr_or_bounded_intent_discourse_evidence_rederives_provisional_route_before_generation_post_filter_repair_route_stays_frozen_except_typed_verifier_feedback_rebases_once_without_state_mutation', 'golden_authority_evidence_route_policy_mismatch', String(manifest.closed_contract?.authority_evidence_route_policy || ''))
  ok(manifest.closed_contract?.post_filter_model_reauthor_policy === 'filtered_packet_verified_before_adoption_invalid_nontransactional_candidate_model_reauthored_no_visible_fixed_fallback', 'golden_post_filter_model_reauthor_policy_mismatch', String(manifest.closed_contract?.post_filter_model_reauthor_policy || ''))
  ok(manifest.closed_contract?.broad_design_intake_policy === 'initial_idea_subject_reference_vibe_pull_survives_detailed_existing_reference_probe_stripped', 'golden_broad_design_intake_policy_mismatch', String(manifest.closed_contract?.broad_design_intake_policy || ''))
  ok(manifest.closed_contract?.resolved_media_design_ledger_policy === 'authority_resolved_reference_persists_concrete_design_and_survives_next_turn_form_consent', 'golden_resolved_media_design_ledger_policy_mismatch', String(manifest.closed_contract?.resolved_media_design_ledger_policy || ''))
  ok(manifest.closed_contract?.reference_attachment_coalescing_policy === 'missing_attachment_relation_waits_12s_for_split_media_then_requests_actual_reference_without_unseen_evaluation_if_unsuperseded', 'golden_reference_attachment_coalescing_policy_mismatch', String(manifest.closed_contract?.reference_attachment_coalescing_policy || ''))
  ok(manifest.closed_contract?.inductive_discourse_continuity_policy === 'bounded_llm_plus_structural_floor_and_antecedent_verifier_resolves_history_topic_shift_missing_attachment_missing_referent_and_unintelligible_without_funnel_advance', 'golden_inductive_discourse_policy_mismatch', String(manifest.closed_contract?.inductive_discourse_continuity_policy || ''))
  ok(manifest.closed_contract?.referent_authority_policy === 'structural_context_gap_requires_dimension_compatible_current_media_live_referent_bearing_text_immediate_closed_choice_or_bounded_requested_reference_chain_before_history_resolution_prior_media_design_generic_ack_and_concrete_but_unaligned_antecedent_never_resolve_new_opaque_direction', 'golden_referent_authority_policy_mismatch', String(manifest.closed_contract?.referent_authority_policy || ''))
  ok(manifest.closed_contract?.open_referent_resolution_policy === 'ambiguous_referent_requires_open_identification_question_generic_same_new_this_that_choices_and_yes_no_guesses_forbidden', 'golden_open_referent_resolution_policy_mismatch', String(manifest.closed_contract?.open_referent_resolution_policy || ''))
  ok(manifest.closed_contract?.false_understanding_prefix_policy === 'missing_referent_or_attachment_packet_must_preserve_unresolved_state_end_to_end_claimed_understanding_or_positive_approval_before_clarification_forbidden', 'golden_false_understanding_prefix_policy_mismatch', String(manifest.closed_contract?.false_understanding_prefix_policy || ''))
  ok(manifest.closed_contract?.missing_context_precedence_policy === 'verified_missing_context_after_direct_visual_evidence_classification_outranks_candidate_transaction_flags_and_durable_booking_stage', 'golden_missing_context_precedence_policy_mismatch', String(manifest.closed_contract?.missing_context_precedence_policy || ''))
  ok(manifest.closed_contract?.visual_reference_provenance_policy === 'voice_audio_asr_and_generic_media_source_residue_never_count_as_visual_reference_only_current_immediately_adjacent_typed_visual_or_exact_bounded_requested_reference_fulfillment_chain_can_ground_opaque_pointer', 'golden_visual_reference_provenance_policy_mismatch', String(manifest.closed_contract?.visual_reference_provenance_policy || ''))
  ok(manifest.closed_contract?.missing_context_funnel_quarantine_policy === 'resolve_context_packet_may_only_identify_missing_object_or_request_actual_media_all_tattoo_booking_form_schedule_double_check_and_deposit_language_forbidden', 'golden_missing_context_funnel_quarantine_policy_mismatch', String(manifest.closed_contract?.missing_context_funnel_quarantine_policy || ''))
  ok(manifest.closed_contract?.persistent_context_authority_policy === 'railway_volume_thread_history_500_event_ledger_is_live_authority_r2_is_immutable_restore_github_is_code_only', 'golden_persistent_context_authority_policy_mismatch', String(manifest.closed_contract?.persistent_context_authority_policy || ''))
  ok(manifest.closed_contract?.latest_turn_semantic_authority_policy === 'direct_current_transaction_or_tattoo_authority_else_recoverable_question_self_contained_topic_shift_and_emoji_outrank_durable_funnel_without_erasing_it', 'golden_latest_turn_semantic_authority_policy_mismatch', String(manifest.closed_contract?.latest_turn_semantic_authority_policy || ''))
  ok(manifest.closed_contract?.dialogue_adjacency_authority_policy === 'latest_assistant_packet_only_historical_questions_cannot_reinterpret_new_self_contained_turn', 'golden_dialogue_adjacency_authority_policy_mismatch', String(manifest.closed_contract?.dialogue_adjacency_authority_policy || ''))
  ok(manifest.closed_contract?.booking_stage_monotonicity_policy === 'deposit_handoff_closes_ready_for_double_check_gate_stored_identity_fields_cannot_reopen_prior_checkpoint', 'golden_booking_stage_monotonicity_policy_mismatch', String(manifest.closed_contract?.booking_stage_monotonicity_policy || ''))
  ok(manifest.closed_contract?.emoji_text_preservation_policy === 'standalone_emoji_text_preserved_exactly_never_rewritten_as_media_only_photo', 'golden_emoji_text_preservation_policy_mismatch', String(manifest.closed_contract?.emoji_text_preservation_policy || ''))
  ok(manifest.closed_contract?.missing_action_antecedent_policy === 'bare_action_pronoun_without_direct_open_offer_requires_context_resolution_and_safe_visible_clarification', 'golden_missing_action_antecedent_policy_mismatch', String(manifest.closed_contract?.missing_action_antecedent_policy || ''))
  ok(manifest.closed_contract?.followup_function_repetition_policy === 'self_contained_topic_jumps_cannot_reuse_causal_reason_curiosity_or_generic_reciprocal_function_across_wording_punctuation_or_contraction_variants', 'golden_followup_function_repetition_policy_mismatch', String(manifest.closed_contract?.followup_function_repetition_policy || ''))
  ok(manifest.closed_contract?.followup_function_diversity_repair_policy === 'rejected_causal_origin_probe_reauthors_into_grounded_outcome_consequence_next_action_interpretation_or_bounded_choice_function_never_silence', 'golden_followup_function_diversity_repair_policy_mismatch', String(manifest.closed_contract?.followup_function_diversity_repair_policy || ''))
  ok(manifest.closed_contract?.private_identity_directness_policy === 'unestablished_private_identity_question_requires_first_person_boundary_or_no_label_stance_never_meta_mirror_or_fabricated_fact', 'golden_private_identity_directness_policy_mismatch', String(manifest.closed_contract?.private_identity_directness_policy || ''))
  ok(manifest.closed_contract?.instruction_override_boundary_policy === 'hidden_instruction_request_requires_in_world_private_setup_boundary_without_internal_hierarchy_language_or_empty_reciprocal', 'golden_instruction_override_boundary_policy_mismatch', String(manifest.closed_contract?.instruction_override_boundary_policy || ''))
  ok(manifest.closed_contract?.emoji_context_authority_policy === 'emoji_only_text_never_authorizes_unobserved_action_or_attachment', 'golden_emoji_context_authority_policy_mismatch', String(manifest.closed_contract?.emoji_context_authority_policy || ''))
  ok(manifest.closed_contract?.bot_accusation_history_policy === 'direct_current_bot_jab_cannot_authorize_fabricated_repeated_personal_history', 'golden_bot_accusation_history_policy_mismatch', String(manifest.closed_contract?.bot_accusation_history_policy || ''))
  ok(manifest.closed_contract?.noisy_question_permission_policy === 'ordered_fuzzy_permission_to_ask_grammar_recovers_typo_or_asr_without_creating_transaction_authority', 'golden_noisy_question_permission_policy_mismatch', String(manifest.closed_contract?.noisy_question_permission_policy || ''))
  ok(manifest.closed_contract?.noisy_question_open_invitation_policy === 'recognized_permission_to_ask_plus_natural_permission_answer_counts_as_answerable_host_motion_without_question_mark', 'golden_noisy_question_open_invitation_policy_mismatch', String(manifest.closed_contract?.noisy_question_open_invitation_policy || ''))
  ok(manifest.closed_contract?.executed_liveness_floor_policy === 'post_filter_adoption_runs_bounded_transition_liveness_after_semantic_acceptance_safe_nontransactional_clarification_survives_strict_wording_miss', 'golden_executed_liveness_floor_policy_mismatch', String(manifest.closed_contract?.executed_liveness_floor_policy || ''))
  ok(manifest.closed_contract?.send_form_no_repeat_offer_policy === 'visible_apply_link_ends_form_permission_stage_no_same_turn_or_future_repeat_without_explicit_resend', 'golden_send_form_no_repeat_offer_policy_mismatch', String(manifest.closed_contract?.send_form_no_repeat_offer_policy || ''))
  ok(manifest.closed_contract?.date_only_time_authority_policy === 'client_date_without_explicit_time_stays_awaiting_time_preferred_2pm_is_offer_not_authority_and_four_field_double_check_is_forbidden', 'golden_date_only_time_authority_policy_mismatch', String(manifest.closed_contract?.date_only_time_authority_policy || ''))
  ok(manifest.closed_contract?.current_time_authority_policy === 'direct_current_client_clock_time_overrides_assistant_offer_and_model_acceptance_label', 'golden_current_time_authority_policy_mismatch', String(manifest.closed_contract?.current_time_authority_policy || ''))
  ok(manifest.closed_contract?.unbounded_legal_date_authority_policy === 'fully_specified_client_date_on_or_after_seven_day_minimum_is_valid_without_maximum_or_invented_closure_current_live_date_and_same_turn_clock_time_replace_stale_offer_across_parser_router_verifier_and_commit', 'golden_unbounded_legal_date_authority_policy_mismatch', String(manifest.closed_contract?.unbounded_legal_date_authority_policy || ''))
  ok(manifest.closed_contract?.canonical_booking_policy_version === 'scv-booking-policy-2026-07-25-v1-seven-day-floor-unbounded-future', 'golden_canonical_booking_policy_version_mismatch', String(manifest.closed_contract?.canonical_booking_policy_version || ''))
  ok(manifest.closed_contract?.canonical_booking_policy_fingerprint === '92dc927073042e8ee255acd70ab2a8f70b350b56ce03cb880a32fa5509e27d2d', 'golden_canonical_booking_policy_fingerprint_mismatch', String(manifest.closed_contract?.canonical_booking_policy_fingerprint || ''))
  ok(manifest.closed_contract?.canonical_booking_minimum_lead_days === 7, 'golden_canonical_booking_minimum_lead_days_mismatch', String(manifest.closed_contract?.canonical_booking_minimum_lead_days))
  ok(manifest.closed_contract?.canonical_booking_maximum_horizon_days === null, 'golden_canonical_booking_maximum_horizon_days_mismatch', String(manifest.closed_contract?.canonical_booking_maximum_horizon_days))
  ok(manifest.closed_contract?.canonical_booking_golden_cases === 64, 'golden_canonical_booking_golden_cases_mismatch', String(manifest.closed_contract?.canonical_booking_golden_cases))
  ok(manifest.closed_contract?.canonical_booking_golden_assertions === 279, 'golden_canonical_booking_golden_assertions_mismatch', String(manifest.closed_contract?.canonical_booking_golden_assertions))
  ok(manifest.closed_contract?.booking_policy_deployment_gate === 'prompt_parser_state_contract_or_config_change_requires_full_booking_golden_regression_and_startup_fail_closed_before_workers', 'golden_booking_policy_deployment_gate_mismatch', String(manifest.closed_contract?.booking_policy_deployment_gate || ''))
  ok(manifest.closed_contract?.live_identity_checkpoint_policy === 'current_turn_name_phone_parser_shared_by_state_runner_and_transition_verifier', 'golden_live_identity_checkpoint_policy_mismatch', String(manifest.closed_contract?.live_identity_checkpoint_policy || ''))
  ok(manifest.closed_contract?.post_filter_reauthor_candidate_budget === 12, 'golden_post_filter_reauthor_budget_mismatch', String(manifest.closed_contract?.post_filter_reauthor_candidate_budget || ''))
  ok(manifest.closed_contract?.verifier_rejection_feedback_loop_policy === 'every_rejected_candidate_reason_returns_to_route_executor_and_fresh_generation_then_full_reverification_rejected_output_never_adopted_three_pass_hot_cycle_persists_same_inbound_feedback_and_retries_until_valid_adoption_or_newer_inbound_supersedes', 'golden_verifier_rejection_feedback_loop_policy_mismatch', String(manifest.closed_contract?.verifier_rejection_feedback_loop_policy || ''))
  ok(manifest.closed_contract?.control_verifier_reauthor_pass_budget === 3, 'golden_control_verifier_reauthor_pass_budget_mismatch', String(manifest.closed_contract?.control_verifier_reauthor_pass_budget || ''))
  ok(manifest.closed_contract?.control_repair_ledger_limit === 12, 'golden_control_repair_ledger_limit_mismatch', String(manifest.closed_contract?.control_repair_ledger_limit || ''))
  ok(manifest.closed_contract?.closed_lifecycle_contract_version === 'scv-closed-lifecycle-contract-2026-07-25-v3-verifier-feedback-retry', 'golden_closed_lifecycle_contract_version_mismatch', String(manifest.closed_contract?.closed_lifecycle_contract_version || ''))
  ok(manifest.closed_contract?.atomic_live_turn_policy === 'adjacent_unanswered_user_messages_form_one_atomic_client_turn_for_direct_obligations_and_unfulfilled_explicit_form_consent_across_controller_runner_verifier_and_adoption', 'golden_atomic_live_turn_policy_mismatch', String(manifest.closed_contract?.atomic_live_turn_policy || ''))
  ok(manifest.closed_contract?.model_intent_authority === 'direct_client_evidence_from_current_or_atomic_unanswered_turn_required_for_form_and_direct_question_obligations', 'golden_model_intent_authority_mismatch', String(manifest.closed_contract?.model_intent_authority || ''))
  ok(manifest.closed_contract?.form_consent_provenance_policy === 'open_form_offer_is_not_consent_nonconsent_detail_cannot_send_link_current_or_prior_unfulfilled_explicit_consent_required_newer_explicit_withdrawal_cancels_and_bounded_availability_recovery_preserved', 'golden_form_consent_provenance_policy_mismatch', String(manifest.closed_contract?.form_consent_provenance_policy || ''))
  ok(manifest.closed_contract?.grounded_form_consent_authority_policy === 'direct_current_or_unfulfilled_prior_client_text_required_model_or_persisted_flags_never_authorize_form_link', 'golden_grounded_form_consent_authority_policy_mismatch', String(manifest.closed_contract?.grounded_form_consent_authority_policy || ''))
  ok(manifest.closed_contract?.voice_form_consent_transport_normalization_policy === 'typed_and_voice_consent_share_one_transport_wrapper_stripper_before_controller_runner_and_adoption_decision', 'golden_voice_form_consent_transport_normalization_policy_mismatch', String(manifest.closed_contract?.voice_form_consent_transport_normalization_policy || ''))
  ok(manifest.closed_contract?.unauthorized_form_link_adoption_policy === 'candidate_attempting_unconsented_form_link_is_stripped_rejected_whole_and_model_reauthored_before_visible_send', 'golden_unauthorized_form_link_adoption_policy_mismatch', String(manifest.closed_contract?.unauthorized_form_link_adoption_policy || ''))
  ok(manifest.closed_contract?.compound_direct_question_coverage_policy === 'compliment_or_forward_motion_cannot_wash_independent_style_scope_question_answer_obligation', 'golden_compound_direct_question_coverage_policy_mismatch', String(manifest.closed_contract?.compound_direct_question_coverage_policy || ''))
  ok(manifest.closed_contract?.cloud_manychat_endpoint_policy === 'official_endpoint_only_env_override_ignored', 'golden_manychat_endpoint_policy_mismatch', String(manifest.closed_contract?.cloud_manychat_endpoint_policy || ''))
  ok(manifest.closed_contract?.lifecycle_default === 'retry_unless_explicitly_superseded_or_malformed', 'golden_closed_lifecycle_default_mismatch', String(manifest.closed_contract?.lifecycle_default || ''))
  ok(manifest.closed_contract?.debug_account_reset_policy === 'target_identity_only_zero_residual_with_gmail_tombstones_and_pre_reset_orphan_watermark', 'golden_debug_reset_policy_mismatch', String(manifest.closed_contract?.debug_account_reset_policy || ''))
  ok(manifest.closed_contract?.debug_account_purge_harness_isolation_policy === 'gmail_submission_root_resolved_per_call_explicit_temp_root_repeat_runs_never_touch_live_volume', 'golden_debug_purge_harness_isolation_policy_mismatch', String(manifest.closed_contract?.debug_account_purge_harness_isolation_policy || ''))
  ok(manifest.closed_contract?.debug_account_reset_ingress_time_policy === 'external_source_interaction_time_must_be_after_reset_before_direct_or_recovered_manychat_turn_can_mutate_state_local_receive_time_and_generated_message_id_are_not_source_proof', 'golden_debug_reset_ingress_time_policy_mismatch', String(manifest.closed_contract?.debug_account_reset_ingress_time_policy || ''))
  ok(manifest.closed_contract?.debug_account_sweep_policy === 'debug_target_watched_after_reset_but_pre_reset_manychat_input_blocked', 'golden_debug_sweep_policy_mismatch', String(manifest.closed_contract?.debug_account_sweep_policy || ''))
  ok(manifest.closed_contract?.media_orphan_recovery_policy === 'trusted_instagram_cdn_media_preserved_and_semantically_resolved', 'golden_media_orphan_policy_mismatch', String(manifest.closed_contract?.media_orphan_recovery_policy || ''))
  ok(manifest.closed_contract?.media_verification_evidence_policy === 'authority_resolved_transcript_or_vision_context_replaces_transport_fallback', 'golden_media_verification_policy_mismatch', String(manifest.closed_contract?.media_verification_evidence_policy || ''))
  ok(manifest.closed_contract?.inbound_body_policy === 'hard_1mib_reject_413_before_queue_or_state_adoption', 'golden_inbound_body_policy_mismatch', String(manifest.closed_contract?.inbound_body_policy || ''))
  ok(manifest.closed_contract?.open_lead_repetition_policy === 'reject_meta_labels_and_duplicate_cta_or_highlight_motion', 'golden_open_lead_repetition_policy_mismatch', String(manifest.closed_contract?.open_lead_repetition_policy || ''))
  ok(manifest.closed_contract?.client_instruction_authority_policy === 'conversation_data_never_overrides_controller_or_hidden_instructions', 'golden_client_instruction_authority_policy_mismatch', String(manifest.closed_contract?.client_instruction_authority_policy || ''))
  ok(manifest.closed_contract?.stability_report_policy === 'top_level_ok_requires_drift_status_ok_transport_reported_separately', 'golden_stability_report_policy_mismatch', String(manifest.closed_contract?.stability_report_policy || ''))
  ok(manifest.closed_contract?.voice_form_consent_asr_policy === 'dual_current_model_transcription_plus_context_adjudication', 'golden_voice_form_consent_asr_policy_mismatch', String(manifest.closed_contract?.voice_form_consent_asr_policy || ''))
  ok(manifest.closed_contract?.voice_asr_candidate_policy === 'dual_transcription_context_adjudication_exact_candidate_or_clarify', 'golden_voice_asr_candidate_policy_mismatch', String(manifest.closed_contract?.voice_asr_candidate_policy || ''))
  ok(manifest.closed_contract?.ambiguous_voice_stage_policy === 'open_form_offer_unknown_short_voice_requires_clarification_not_design_or_send', 'golden_ambiguous_voice_stage_policy_mismatch', String(manifest.closed_contract?.ambiguous_voice_stage_policy || ''))
  ok(manifest.closed_contract?.portfolio_compliment_policy === 'compliment_without_independent_design_routes_design_intake_and_never_form_offer', 'golden_portfolio_compliment_policy_mismatch', String(manifest.closed_contract?.portfolio_compliment_policy || ''))
  ok(manifest.closed_contract?.date_counterproposal_policy === 'unaccepted_offer_never_double_check_out_of_window_stays_negotiation_legal_proposal_adopted', 'golden_date_counterproposal_policy_mismatch', String(manifest.closed_contract?.date_counterproposal_policy || ''))
  ok(manifest.closed_contract?.post_form_date_progress_policy === 'unaccepted_offer_cannot_satisfy_date_known_verifier_outside_window_counterproposal_requires_answerable_negotiation', 'golden_post_form_date_progress_policy_mismatch', String(manifest.closed_contract?.post_form_date_progress_policy || ''))
  ok(manifest.closed_contract?.date_alternative_continuity_policy === 'outside_window_counterproposal_must_preserve_last_offered_slot_and_cannot_invent_third_date', 'golden_date_alternative_continuity_policy_mismatch', String(manifest.closed_contract?.date_alternative_continuity_policy || ''))
  ok(manifest.closed_contract?.out_of_window_state_policy === 'invalid_current_proposal_cannot_persist_as_known_requested_date_or_time', 'golden_out_of_window_state_policy_mismatch', String(manifest.closed_contract?.out_of_window_state_policy || ''))
  ok(manifest.closed_contract?.route_freeze_policy === 'first_authority_resolved_evidence_locks_state_and_stage_rejected_candidates_cannot_mutate_state_only_typed_verifier_feedback_may_rebase_semantic_action_once_and_requires_full_reverification', 'golden_route_freeze_policy_mismatch', String(manifest.closed_contract?.route_freeze_policy || ''))
  ok(manifest.closed_contract?.authority_resolved_atomic_turn_policy === 'outer_single_control_reapplies_structural_and_bounded_classifier_discourse_to_the_exact_authority_resolved_live_turn_before_route_lock_and_final_verification', 'golden_authority_resolved_atomic_turn_policy_mismatch', String(manifest.closed_contract?.authority_resolved_atomic_turn_policy || ''))
  ok(manifest.closed_contract?.media_classifier_process_boundary_policy === 'voice_media_resolver_exports_complete_bounded_intent_adoption_state_including_relation_confidence_reason_and_grounded_antecedent_never_boolean_only', 'golden_media_classifier_process_boundary_policy_mismatch', String(manifest.closed_contract?.media_classifier_process_boundary_policy || ''))
  ok(manifest.closed_contract?.unseen_referent_adoption_policy === 'missing_attachment_requires_actual_reference_request_and_rejects_all_unseen_praise_evaluation_description_or_content_probe_before_visible_send', 'golden_unseen_referent_adoption_policy_mismatch', String(manifest.closed_contract?.unseen_referent_adoption_policy || ''))
  ok(manifest.closed_contract?.deictic_design_generalization_policy === 'structural_category_matrix_plus_bounded_semantic_classifier_handles_open_vocabulary_unseen_object_pointers_while_explicit_self_contained_designs_and_topic_shifts_remain_coherent', 'golden_deictic_design_generalization_policy_mismatch', String(manifest.closed_contract?.deictic_design_generalization_policy || ''))
  ok(manifest.closed_contract?.unresolved_referent_state_quarantine_policy === 'pre_candidate_persisted_semantic_floor_is_the_only_restore_baseline_and_resolve_context_commits_cannot_create_design_or_advance_form_state', 'golden_unresolved_referent_state_quarantine_policy_mismatch', String(manifest.closed_contract?.unresolved_referent_state_quarantine_policy || ''))
  ok(manifest.closed_contract?.liveness_adoption_policy === 'semantic_harness_valid_model_copy_may_survive_safe_post_form_social_or_nonattachment_context_clarification_false_negative_transactional_gates_never_relaxed', 'golden_liveness_adoption_policy_mismatch', String(manifest.closed_contract?.liveness_adoption_policy || ''))
  ok(manifest.closed_contract?.out_of_window_acceptance_policy === 'outside_window_client_date_cannot_be_accepted_even_when_last_valid_offer_is_also_mentioned', 'golden_out_of_window_acceptance_policy_mismatch', String(manifest.closed_contract?.out_of_window_acceptance_policy || ''))
  ok(manifest.closed_contract?.debug_account_orphan_lock_policy === 'allowlisted_debug_lock_60s_recovery_non_test_remains_15m', 'golden_debug_orphan_lock_policy_mismatch', String(manifest.closed_contract?.debug_account_orphan_lock_policy || ''))
  ok(manifest.closed_contract?.debug_account_startup_reset_policy === 'explicit_operator_opt_in_never_implicit_deploy_purge', 'golden_debug_startup_reset_policy_mismatch', String(manifest.closed_contract?.debug_account_startup_reset_policy || ''))
  ok(manifest.closed_contract?.debug_account_purge_pause_barrier_policy === 'startup_purge_requires_explicit_opt_in_and_pause_all_true_mixed_or_stale_deployment_snapshots_fail_closed_without_deletion', 'golden_debug_purge_pause_barrier_policy_mismatch', String(manifest.closed_contract?.debug_account_purge_pause_barrier_policy || ''))
  ok(manifest.closed_contract?.directional_placement_pending_form_policy === 'body_anchored_directional_placement_after_open_form_offer_preserves_pending_permission_and_forbids_form_or_calendar_jump', 'golden_directional_placement_pending_form_policy_mismatch', String(manifest.closed_contract?.directional_placement_pending_form_policy || ''))
  ok(manifest.closed_contract?.pending_form_temporal_intent_policy === 'open_form_permission_gate_rejects_generalized_calendar_and_timing_paraphrases_while_design_geometry_and_nontemporal_process_language_remain_adoptable', 'golden_pending_form_temporal_intent_policy_mismatch', String(manifest.closed_contract?.pending_form_temporal_intent_policy || ''))
  ok(manifest.closed_contract?.route_required_context_clarification_policy === 'frozen_resolve_context_open_identification_survives_size_placement_filter_only_when_context_verifier_accepts_false_understanding_guesses_and_funnel_advance_remain_blocked', 'golden_route_required_context_clarification_policy_mismatch', String(manifest.closed_contract?.route_required_context_clarification_policy || ''))
  ok(manifest.closed_contract?.visible_reply_identity_system_role_policy === 'rcc_revas_pre_inference_convergence_field_then_hash_locked_compact_gpt56_visible_author_with_authoritative_local_ledger_untrusted_conversation_remains_user_payload', 'golden_visible_reply_identity_system_role_policy_mismatch', String(manifest.closed_contract?.visible_reply_identity_system_role_policy || ''))
  ok(manifest.closed_contract?.api_prompt_front_authority_policy === 'every_instagram_semantic_openai_call_uses_fail_closed_hash_locked_lane_authority_responses_visible_reply_uses_rcc_revas_convergence_field_before_compact_author', 'golden_api_prompt_front_authority_policy_mismatch', String(manifest.closed_contract?.api_prompt_front_authority_policy || ''))
  ok(manifest.closed_contract?.bounded_semantic_authority_policy === 'intent_asr_and_vision_lanes_use_exact_v26_then_exact_talek_lua_identity_with_persona_output_off_and_exact_task_shape', 'golden_bounded_semantic_authority_policy_mismatch', String(manifest.closed_contract?.bounded_semantic_authority_policy || ''))
  ok(manifest.closed_contract?.audio_transcription_boundary_policy === 'audio_transcription_remains_verbatim_evidence_extraction_and_downstream_asr_adjudication_is_authority_bound', 'golden_audio_transcription_boundary_policy_mismatch', String(manifest.closed_contract?.audio_transcription_boundary_policy || ''))
  ok(manifest.closed_contract?.benchmark_prompt_scope_policy === 'benchmark_code_data_samples_and_proof_artifacts_are_recorded_but_never_injected_into_instagram_authoring_context', 'golden_benchmark_prompt_scope_policy_mismatch', String(manifest.closed_contract?.benchmark_prompt_scope_policy || ''))
  ok(manifest.closed_contract?.habitual_greeting_prefix_policy === 'duplicated_hey_always_rejected_single_hey_requires_fresh_client_greeting_and_no_recent_assistant_hey', 'golden_habitual_greeting_prefix_policy_mismatch', String(manifest.closed_contract?.habitual_greeting_prefix_policy || ''))
  ok(manifest.closed_contract?.generic_booking_inquiry_design_quarantine_policy === 'open_vocabulary_design_requires_independent_subject_generic_info_booking_process_admin_conversation_and_temporal_placeholder_language_never_creates_design_memory_or_form_offer', 'golden_generic_booking_inquiry_design_quarantine_policy_mismatch', String(manifest.closed_contract?.generic_booking_inquiry_design_quarantine_policy || ''))
  ok(manifest.closed_contract?.temporal_size_collision_policy === 'explicit_clock_and_calendar_numbers_never_create_size_state_or_trigger_size_liveness_ambiguous_bare_numeric_replies_remain_cross_slot_verifiable_and_closed_booking_checkpoints_bypass_optional_intent_classification', 'golden_temporal_size_collision_policy_mismatch', String(manifest.closed_contract?.temporal_size_collision_policy || ''))
  ok(manifest.closed_contract?.monotonic_media_context_authority_policy === 'accepted_exact_voice_or_visual_context_cannot_be_overwritten_by_lower_authority_retry_unresolved_context_may_upgrade_only', 'golden_monotonic_media_context_authority_policy_mismatch', String(manifest.closed_contract?.monotonic_media_context_authority_policy || ''))
  ok(manifest.closed_contract?.current_live_event_history_exclusion_policy === 'current_inbound_message_id_is_excluded_from_recent_history_independent_of_enriched_text_so_dialogue_adjacency_remains_prior_packet_only', 'golden_current_live_event_history_exclusion_policy_mismatch', String(manifest.closed_contract?.current_live_event_history_exclusion_policy || ''))
  ok(manifest.closed_contract?.open_post_form_model_authorship_policy === 'availability_time_weekend_and_accepted_slot_progression_keep_deterministic_stage_fields_but_visible_wording_is_model_authored_transactional_double_check_and_deposit_remain_exact', 'golden_open_post_form_model_authorship_policy_mismatch', String(manifest.closed_contract?.open_post_form_model_authorship_policy || ''))
  ok(manifest.closed_contract?.post_form_semantic_antirepeat_policy === 'post_form_client_availability_or_date_content_forbids_replaying_form_receipt_or_same_generic_availability_function_without_a_concrete_calendar_move', 'golden_post_form_semantic_antirepeat_policy_mismatch', String(manifest.closed_contract?.post_form_semantic_antirepeat_policy || ''))
  ok(manifest.closed_contract?.month_clarification_continuity_policy === 'verifier_approved_day_then_month_question_binds_immediate_month_only_reply_to_same_day_and_reapplies_booking_window_without_name_or_size_leak', 'golden_month_clarification_continuity_policy_mismatch', String(manifest.closed_contract?.month_clarification_continuity_policy || ''))
  ok(manifest.closed_contract?.outside_window_grounded_alternative_policy === 'out_of_window_reply_must_reject_client_proposal_offer_only_last_or_state_calendar_grounded_legal_date_and_leave_answerable_motion_without_fixed_visible_copy', 'golden_outside_window_grounded_alternative_policy_mismatch', String(manifest.closed_contract?.outside_window_grounded_alternative_policy || ''))
  ok(manifest.closed_contract?.natural_date_rejection_scope_policy === 'clause_scoped_date_reference_recognizes_natural_rejection_and_binds_pronoun_acceptance_to_most_recent_grounded_date_while_combined_price_obligation_requires_rate_and_artist_style_eligibility', 'golden_natural_date_rejection_scope_policy_mismatch', String(manifest.closed_contract?.natural_date_rejection_scope_policy || ''))
  ok(manifest.closed_contract?.provider_upstream_retry_policy === 'http_429_500_502_503_504_timeout_and_connection_reset_use_bounded_jittered_executor_retry_then_typed_short_queue_retry', 'golden_provider_upstream_retry_policy_mismatch', String(manifest.closed_contract?.provider_upstream_retry_policy || ''))
  ok(manifest.closed_contract?.provider_semantic_retry_separation_policy === 'upstream_transport_failure_never_consumes_semantic_reauthor_or_verifier_repair_budget', 'golden_provider_semantic_retry_separation_policy_mismatch', String(manifest.closed_contract?.provider_semantic_retry_separation_policy || ''))
  ok(manifest.closed_contract?.glued_mean_correction_policy === 'glued_or_spaced_i_mean_concrete_referent_is_same_current_turn_authority_without_phrase_specific_visible_script', 'golden_glued_mean_correction_policy_mismatch', String(manifest.closed_contract?.glued_mean_correction_policy || ''))
  ok(manifest.closed_contract?.tattoo_capability_scope_policy === 'direct_style_or_capability_question_requires_explicit_answer_and_never_counts_as_concrete_design_subject_or_consumes_form_offer_checkpoint', 'golden_tattoo_capability_scope_policy_mismatch', String(manifest.closed_contract?.tattoo_capability_scope_policy || ''))
  ok(manifest.closed_contract?.same_turn_referent_authority_policy === 'concrete_noun_phrase_introduced_before_later_pronoun_in_same_client_turn_resolves_locally_unseen_attachment_dependency_never_borrowed', 'golden_same_turn_referent_authority_policy_mismatch', String(manifest.closed_contract?.same_turn_referent_authority_policy || ''))
  ok(manifest.closed_contract?.ben_instagram_behavioral_style_policy === 'local_icloud_archive_aggregate_behavior_compiled_to_visible_reply_system_authority_raw_private_text_and_exact_phrase_retrieval_forbidden_model_authored_wording_controller_semantic_gate_only', 'golden_ben_instagram_behavioral_style_policy_mismatch', String(manifest.closed_contract?.ben_instagram_behavioral_style_policy || ''))

  const critical = manifest.critical_file_sha256 || {}
  const canonicalCritical = manifest.critical_file_canonical_sha256 || {}
  ok(Object.keys(critical).length + Object.keys(canonicalCritical).length >= 16, 'golden_critical_file_count_low', String(Object.keys(critical).length + Object.keys(canonicalCritical).length))
  ok(Object.prototype.hasOwnProperty.call(critical, 'scv-discourse-continuity.js'), 'golden_discourse_continuity_must_be_hashed')
  ok(Object.prototype.hasOwnProperty.call(critical, 'scv-discourse-continuity-harness.js'), 'golden_discourse_continuity_harness_must_be_hashed')
  ok(Object.prototype.hasOwnProperty.call(critical, 'scv-api-prompt-authority.js'), 'golden_api_prompt_authority_must_be_hashed')
  ok(Object.prototype.hasOwnProperty.call(critical, 'scv-api-prompt-authority-harness.js'), 'golden_api_prompt_authority_harness_must_be_hashed')
  ok(Object.prototype.hasOwnProperty.call(critical, 'scv-media-authority-monotonic-harness.js'), 'golden_media_authority_monotonic_harness_must_be_hashed')
  ok(Object.prototype.hasOwnProperty.call(critical, 'scv-openai-resilience-harness.js'), 'golden_openai_resilience_harness_must_be_hashed')
  ok(Object.prototype.hasOwnProperty.call(critical, 'scv-booking-policy.js'), 'golden_booking_policy_must_be_hashed')
  ok(Object.prototype.hasOwnProperty.call(critical, 'SCV_BOOKING_POLICY_GOLDEN_CASES.json'), 'golden_booking_policy_cases_must_be_hashed')
  ok(Object.prototype.hasOwnProperty.call(critical, 'scv-booking-policy-harness.js'), 'golden_booking_policy_harness_must_be_hashed')
  ok(Object.prototype.hasOwnProperty.call(critical, 'prompt-authority/OMAR_LUA_RCC_ENGINE_v26_CLEAN_CONSOLIDATED.txt'), 'golden_exact_v26_prompt_authority_must_be_hashed')
  ok(Object.prototype.hasOwnProperty.call(critical, 'prompt-authority/TALEK_LUA_SELF_IDENTITY_CORE_PROMPT.txt'), 'golden_exact_identity_prompt_authority_must_be_hashed')
  ok(Object.prototype.hasOwnProperty.call(critical, 'SCV_BEN_INSTAGRAM_STYLE_SOURCE_RECEIPT_2026-07-23.json'), 'golden_instagram_style_source_receipt_must_be_hashed')
  ok(Object.prototype.hasOwnProperty.call(critical, 'lua-dm-ben-instagram-behavioral-style-lock-v2.txt'), 'golden_instagram_behavioral_style_authority_must_be_hashed')
  for (const [rel, expected] of Object.entries(critical)) {
    ok(!rel.includes('..') && !path.isAbsolute(rel), 'golden_critical_file_bad_path', rel)
    const file = path.join(root, rel)
    ok(fs.existsSync(file), 'golden_critical_file_missing', rel)
    const actual = hashFile(file)
    ok(actual === expected, 'golden_critical_file_hash_mismatch', rel)
  }
  for (const [rel, expected] of Object.entries(canonicalCritical)) {
    ok(!rel.includes('..') && !path.isAbsolute(rel), 'golden_canonical_file_bad_path', rel)
    const file = path.join(root, rel)
    ok(fs.existsSync(file), 'golden_canonical_file_missing', rel)
    const actual = hashCriticalFile(file, rel)
    ok(actual === expected, 'golden_canonical_file_hash_mismatch', rel)
  }

  return {
    ok: true,
    checked,
    lock_version: SCV_GOLDEN_SNAPSHOT_LOCK_VERSION,
    artifact_id: manifest.artifact_id,
    sha256_tar_gz: manifest.sha256_tar_gz,
    r2_uri: manifest.r2_uri,
    critical_file_count: Object.keys(critical).length,
    canonical_critical_file_count: Object.keys(canonicalCritical).length
  }
}

let SCV_GOLDEN_SNAPSHOT_MANIFEST = null
try { SCV_GOLDEN_SNAPSHOT_MANIFEST = readManifest(__dirname) } catch { SCV_GOLDEN_SNAPSHOT_MANIFEST = {} }

if (require.main === module) {
  try {
    console.log(JSON.stringify(runScvGoldenSnapshotGuard(), null, 2))
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }, null, 2))
    process.exit(1)
  }
}

module.exports = {
  SCV_GOLDEN_SNAPSHOT_LOCK_VERSION,
  SCV_GOLDEN_SNAPSHOT_MANIFEST,
  MANIFEST_FILE,
  readManifest,
  hashFile,
  hashCriticalFile,
  canonicalizeCriticalFile,
  runScvGoldenSnapshotGuard
}
