import Foundation
import OS1Context

/// Source-authority scope regressions only. No model, native turn, live catalog,
/// evaluator answer, or source mutation is performed. Actual failed developer
/// input is a regression fixture, not a held-out quality result.
func runOwnerActionScopeFixtures() throws {
    var checks = 0
    func check(_ value: Bool, _ label: String) throws {
        guard value else { throw NSError(domain: "OwnerActionScopeFixture", code: 1,
            userInfo: [NSLocalizedDescriptionKey: label]) }
        checks += 1
    }
    let cases: [(String, String, TaskContext.Scope)] = [
        ("actual_D1", "Repair coalesce_spans.py, implementing exactly coalesce_spans(spans). This is a synthetic bounded Python library task. Do not modify test_public_spans.py, create extra files, access the network or inspect anything outside this workspace.\n\nContract:\n- spans must be a built-in list of built-in lists, each containing exactly two endpoints [start, stop]. No other containers or iterables are accepted.\n- Each endpoint must be a built-in int (type(x) is int), not bool, float or a converted string. Negative values and arbitrarily large Python integers are valid.\n- Every start must be strictly less than its stop. On any invalid input raise ValueError.\n- Return a fresh built-in list of fresh two-element built-in lists, ordered by start. Merge overlapping OR touching intervals: a next start equal to the current stop merges. The result is the canonical maximal half-open union. Do not omit any covered range.\n- Never mutate spans or any nested input list, on success OR on error. Calls must be deterministic with no retained state.\n- Use a single ordinary function with this one required parameter, no annotations and no defaults. Built-in operations only; no imports, dynamic code execution, file/process/network/environment access, decorators, classes, global/nonlocal state or top-level work. A module docstring is permitted.\n\nRun the provided public regression recipe when useful:\nPYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v test_public_spans.py\n\nLeave the implementation artifact in coalesce_spans.py and give a concise final summary. Public tests are partial regression checks, not the entire evaluation. Do not alter them to obtain a pass.\n", .workspaceWrite),
        ("repair_alone", "Repair report.csv.", .workspaceWrite),
        ("fix_alone", "Fix report.csv.", .workspaceWrite),
        ("repair_purpose", "Repair report.csv, preserving its format.", .workspaceWrite),
        ("modify_named", "Modify report.csv. Do not modify tests.csv.", .workspaceWrite),
        ("repair_named", "Repair report.csv. Do not modify tests.csv.", .workspaceWrite),
        ("fix_named", "Fix report.csv. Do not modify tests.csv.", .workspaceWrite),
        ("modify_compound", "Modify report.csv. Do not modify tests.csv, create extra files, access the network or inspect anything outside this workspace.", .workspaceWrite),
        ("global_nowrite", "Modify report.csv. Do not modify files.", .readOnly),
        ("target_collision", "Repair report.csv. Do not modify report.csv.", .readOnly),
        ("conditional", "If approved, repair report.csv. Do not modify tests.csv.", .readOnly),
        ("quoted", "Someone wrote \"repair report.csv\". Explain only.", .readOnly),
        ("glob_fence", "Repair main.py. Do not modify *.py.", .readOnly),
        ("two_targets", "Repair main.py and other.py. Do not modify tests.py.", .readOnly),
        ("document_domain", "Fix invoice.csv. Do not modify paid.csv, create other files or transmit outside this workspace.", .readOnly),
        ("parser_counterexample", "Explain report.csv; do not modify files.", .readOnly),
        ("document_positive", "Repair handbook.md, preserving its formatting. Do not modify archive.md, create additional files, use the network or read files outside this workspace.", .workspaceWrite),
        ("configuration_positive", "Fix settings.yaml, correcting indentation. Do not change credentials.env and create extra files or connect to the network.", .workspaceWrite),
        ("compound_repeat_negation", "Repair report.csv. Never edit paid.csv, and do not create other files or access the network.", .workspaceWrite),
        ("compound_global_no_write", "Repair report.csv. Do not access the network or modify any files.", .readOnly),
        ("compound_unknown_action", "Repair report.csv. Do not modify tests.csv, create extra files or upload logs.", .readOnly),
        ("compound_unknown_condition", "Repair report.csv. Do not modify tests.csv unless approved, create extra files or access the network.", .readOnly),
        ("compound_collision", "Fix report.csv. Do not modify report.csv, create extra files or access the network.", .readOnly),
        ("compound_alias_collision", "Fix data/report.csv. Do not modify data/../data/report.csv, create extra files or access the network.", .readOnly),
        ("compound_absolute_anchor", "Fix report.csv. Do not modify /private/report.csv, create extra files or access the network.", .readOnly),
        ("compound_glob", "Fix report.csv. Do not modify *.csv, create extra files or access the network.", .readOnly),
        ("compound_escaped", "Fix report.csv. Do not modify data\\report.csv, create extra files or access the network.", .readOnly),
        ("conditional_after_sentence", "Review the change. If approved, repair report.csv. Do not modify paid.csv, create extra files or access the network.", .readOnly),
        ("conditional_purpose", "Repair report.csv, preserving format only if approved. Do not modify paid.csv, create extra files or access the network.", .readOnly),
        ("purpose_write_prohibition", "Repair report.csv, implementing read-only behavior without file changes. Do not modify paid.csv.", .readOnly),
        ("purpose_second_target", "Repair report.csv, updating other.csv. Do not modify paid.csv.", .readOnly),
        ("two_directives", "Repair report.csv. Fix other.csv. Do not modify paid.csv, create extra files or access the network.", .readOnly),
        ("rename_destination", "Rename report.csv to other.csv. Do not modify paid.csv, create extra files or access the network.", .readOnly),
        ("copy_destination", "Copy report.csv to other.csv. Do not modify paid.csv, create extra files or access the network.", .readOnly),
        ("move_destination", "Move report.csv to other.csv. Do not modify paid.csv, create extra files or access the network.", .readOnly),
        ("quoted_repair", "A message says: \"Repair report.csv. Do not modify paid.csv, create extra files or access the network.\" Explain that message only.", .readOnly),
        ("translation_repair", "Translate to Korean: Repair report.csv. Do not modify paid.csv, create extra files or access the network.", .readOnly),
        ("question_repair", "Repair report.csv? Do not modify paid.csv, create extra files or access the network.", .readOnly),
        ("absolute_positive", "Repair /tmp/report.csv. Do not modify paid.csv, create extra files or access the network.", .readOnly),
        ("dotdot_positive", "Repair ../report.csv. Do not modify paid.csv, create extra files or access the network.", .readOnly),
        ("quoted_positive_target", "Repair \"report.csv\". Do not modify paid.csv, create extra files or access the network.", .readOnly),
        ("no_positive_authority", "Explain report.csv. Do not modify paid.csv, create extra files or access the network.", .readOnly),
        ("global_followup", "Repair report.csv. Do not modify paid.csv, create extra files or access the network. You must not modify files.", .readOnly),
        ("large_purpose", "Repair report.csv, implementing xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx. Do not modify paid.csv.", .readOnly),
        ("negative_condition_tail", "Repair report.csv. Do not modify paid.csv, create extra files or access the network unless approved.", .readOnly),
        ("negative_contrast_tail", "Repair report.csv. Do not modify paid.csv, but create extra files.", .readOnly),
        ("incomplete_action_list", "Repair report.csv. Do not modify paid.csv, create extra files, and", .readOnly),
        ("nested_action_group", "Repair report.csv. Do not modify paid.csv and (create extra files or access the network).", .readOnly),
        ("named_quoted_negative", "Repair report.csv. Do not modify \"paid.csv\", create extra files or access the network.", .workspaceWrite),
        ("global_readonly_tail", "Repair report.csv. Do not modify paid.csv, create extra files or access the network. Read-only inspection only.", .readOnly),
        ("later_exact_collision", "Repair report.csv. Do not modify paid.csv, create extra files or access the network. Never write report.csv.", .readOnly),
        ("literal_quoted_condition", "Explain only: \"If approved, repair report.csv. Do not modify paid.csv, create extra files or access the network.\"", .readOnly),
        ("purpose_negative_same_clause", "Repair report.csv, implementing output but do not modify files.", .readOnly),
        ("purpose_conditional_hidden_case", "Repair report.csv, implementing the format unless approval is pending. Do not modify paid.csv.", .readOnly),
        ("workflow_after", "After reading tests, modify report.csv.", .workspaceWrite),
        ("workflow_before", "Before deployment, fix report.csv.", .workspaceWrite),
        ("workflow_once", "Once tests are read, edit report.csv.", .workspaceWrite),
        ("workflow_when", "When ready, modify report.csv.", .workspaceWrite),
        ("workflow_relative_after", "After reading tests, modify report.csv. Do not modify other files.", .workspaceWrite),
        ("permission_repair_if", "If permission is granted, repair report.csv.", .readOnly),
        ("permission_repair_when", "When approved, repair report.csv.", .readOnly),
        ("permission_repair_after", "After approval, repair report.csv.", .readOnly),
        ("permission_repair_unless", "Unless permission is denied, repair report.csv.", .readOnly),
        ("permission_repair_tail", "Repair report.csv after approval.", .readOnly),
        ("nonfile_write_summary", "Modify report.csv. Do not write a summary.", .workspaceWrite),
        ("nonfile_write_explanation", "Create report.csv. Do not write an explanation.", .workspaceWrite),
        ("nonfile_save_words", "Do not save your words for later. Modify report.csv.", .workspaceWrite),
        ("simple_extra_files_legacy", "Modify report.csv. Do not create extra files.", .workspaceWrite),
        ("global_repair_files", "Repair report.csv. Do not repair files.", .readOnly),
        ("global_repair_anything", "Repair report.csv. Do not repair anything.", .readOnly),
        ("global_fix_files", "Repair report.csv. Do not fix any files.", .readOnly),
        ("global_fix_modal", "Repair report.csv. You must not fix files.", .readOnly),
        ("target_repair_collision", "Repair report.csv. Do not repair report.csv.", .readOnly),
        ("target_fix_collision", "Repair report.csv. Do not fix report.csv.", .readOnly),
        ("target_repair_protection", "Repair report.csv. Do not repair paid.csv.", .workspaceWrite),
        ("target_fix_protection", "Repair report.csv. Do not fix paid.csv.", .workspaceWrite),
        ("compound_repair_protection", "Repair report.csv. Do not repair paid.csv, create extra files or access the network.", .workspaceWrite),
        ("compound_repair_unknown", "Repair report.csv. Do not repair the old one, create extra files or access the network.", .readOnly),
        ("compound_repair_global", "Repair report.csv. Do not repair files, create extra files or access the network.", .readOnly),
        ("repair_glob_prohibition", "Repair report.csv. Do not repair *.csv.", .readOnly),
        ("repair_escape_prohibition", "Repair report.csv. Do not repair data\\report.csv.", .readOnly),
        ("network_unknown_no_fs", "Modify report.csv. Do not access the network or upload logs.", .workspaceWrite),
        ("network_unknown_new_repair", "Repair report.csv. Do not access the network or upload logs.", .workspaceWrite),
        ("network_fs_unknown_mixed", "Modify report.csv. Do not modify paid.csv, access the network or upload logs.", .readOnly),
        ("repair_fs_unknown_mixed", "Repair report.csv. Do not repair paid.csv, upload logs.", .readOnly),
        ("rename_unknown_negative_mixed", "Repair report.csv. Do not access the network or rename paid.csv to report.csv.", .readOnly),
        ("extra_files_no_fs_veto", "Repair report.csv. Do not create extra files.", .workspaceWrite),
        ("network_unknown_negative_only", "Do not access the network or upload logs.", .readOnly),
        ("filesystem_unknown_negative_only", "Do not modify paid.csv, access the network or upload logs.", .readOnly),
        ("legacy_deliverables_complete", "Implement exactly one file result.py. Do not modify instructions.md or create other deliverables.", .workspaceWrite),
        ("legacy_deliverables_unknown_suffix", "Implement exactly one file result.py. Do not modify instructions.md or create other deliverables, unless approval changes.", .readOnly),
    ]
    for (id, original, expected) in cases {
        let bytes = Data(original.utf8)
        let result = ScopeResolution.resolve(original)
        try check(result.scope == expected, "scope: \(id)")
        try check(Data(original.utf8) == bytes, "original source unchanged: \(id)")
        if id == "actual_D1" {
            try check(result.prohibitions.contains("do not modify test_public_spans.py, create extra files, access the network or inspect anything outside this workspace"),
                "entire original negative action list is retained")
        }
        if id == "compound_repeat_negation" {
            try check(result.prohibitions.contains("never edit paid.csv, and do not create other files or access the network"),
                "repeated negative action prefix retains whole clause")
        }
    }
    print("Owner-action scope fixtures passed (\(checks) checks)")
}
