"""Black-box regression tests for the ledger command-line interface.

Run with ``python3 -m unittest -v``.  Every test uses an isolated temporary
database and invokes the same public CLI that a user invokes.
"""

import csv
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


LEDGER = Path(__file__).resolve().with_name("ledger.py")


class LedgerCLITests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.directory = Path(self.temp_dir.name)
        self.db = self.directory / "ledger.json"

    def run_cli(self, *arguments):
        return subprocess.run(
            [sys.executable, str(LEDGER), "--db", str(self.db), *arguments],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=10,
        )

    def assert_success(self, *arguments, stdout=None):
        result = self.run_cli(*arguments)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        if stdout is not None:
            self.assertEqual(result.stdout, stdout)
        return result

    def assert_error(self, *arguments):
        result = self.run_cli(*arguments)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertTrue(result.stderr.strip(), "errors must be sent to stderr")
        self.assertEqual(result.stdout, "")
        return result

    def add(self, date, amount, category, memo=None, expected_id=None):
        arguments = ["add", date, str(amount), category]
        if memo is not None:
            arguments.append(memo)
        result = self.assert_success(*arguments)
        self.assertRegex(result.stdout, r"^[1-9][0-9]*\n$")
        identifier = int(result.stdout.strip())
        if expected_id is not None:
            self.assertEqual(identifier, expected_id)
        return identifier

    def write_csv(self, rows, filename="input.csv"):
        path = self.directory / filename
        with path.open("w", encoding="utf-8", newline="") as output:
            writer = csv.writer(output)
            writer.writerow(["date", "amount", "category", "memo"])
            writer.writerows(rows)
        return path

    def test_add_creates_database_and_prints_only_new_id(self):
        self.assertFalse(self.db.exists())
        self.add("2026-10-01", -12000, "식비", "점심", expected_id=1)
        self.assertTrue(self.db.is_file())
        self.assert_success(
            "list", stdout="1\t2026-10-01\t-12000\t식비\t점심\n"
        )

    def test_optional_memo_is_empty_and_zero_amount_is_allowed(self):
        self.add("2026-10-01", 0, "조정", expected_id=1)
        self.assert_success("list", stdout="1\t2026-10-01\t0\t조정\t\n")

    def test_income_negative_expense_and_unicode_are_preserved(self):
        self.add("2026-10-01", 2500000, "급여", "10월 급여", expected_id=1)
        self.add("2026-10-02", -24500, "외식 / 배달", "김밥, 두 줄", expected_id=2)
        self.assert_success(
            "list",
            stdout=(
                "1\t2026-10-01\t2500000\t급여\t10월 급여\n"
                "2\t2026-10-02\t-24500\t외식 / 배달\t김밥, 두 줄\n"
            ),
        )

    def test_list_sorts_by_date_then_id(self):
        self.add("2026-10-03", -3, "C", "later", expected_id=1)
        self.add("2026-10-01", -1, "A", "first", expected_id=2)
        self.add("2026-10-01", -2, "B", "second", expected_id=3)
        self.assert_success(
            "list",
            stdout=(
                "2\t2026-10-01\t-1\tA\tfirst\n"
                "3\t2026-10-01\t-2\tB\tsecond\n"
                "1\t2026-10-03\t-3\tC\tlater\n"
            ),
        )

    def test_list_filters_month_category_and_combination(self):
        self.add("2026-09-30", -1, "식비", expected_id=1)
        self.add("2026-10-01", -2, "식비", expected_id=2)
        self.add("2026-10-02", -3, "교통", expected_id=3)
        self.add("2027-10-01", -4, "식비", expected_id=4)
        self.assert_success(
            "list", "--month", "2026-10",
            stdout="2\t2026-10-01\t-2\t식비\t\n3\t2026-10-02\t-3\t교통\t\n",
        )
        self.assert_success(
            "list", "--category", "식비",
            stdout=(
                "1\t2026-09-30\t-1\t식비\t\n"
                "2\t2026-10-01\t-2\t식비\t\n"
                "4\t2027-10-01\t-4\t식비\t\n"
            ),
        )
        self.assert_success(
            "list", "--month", "2026-10", "--category", "식비",
            stdout="2\t2026-10-01\t-2\t식비\t\n",
        )
        self.assert_success("list", "--category", "없는 카테고리", stdout="")

    def test_delete_removes_only_requested_entry(self):
        self.add("2026-10-01", -1, "A", expected_id=1)
        self.add("2026-10-02", -2, "B", expected_id=2)
        self.assert_success("delete", "1", stdout="")
        self.assert_success("list", stdout="2\t2026-10-02\t-2\tB\t\n")

    def test_deleted_highest_id_is_never_reused_across_processes(self):
        self.add("2026-10-01", -1, "A", expected_id=1)
        self.add("2026-10-01", -2, "B", expected_id=2)
        self.assert_success("delete", "2", stdout="")
        self.add("2026-10-01", -3, "C", expected_id=3)

    def test_ids_continue_after_all_entries_are_deleted(self):
        self.add("2026-10-01", -1, "A", expected_id=1)
        self.assert_success("delete", "1", stdout="")
        self.assert_success("list", stdout="")
        self.add("2026-10-02", -2, "B", expected_id=2)
        self.assert_success("delete", "2", stdout="")
        path = self.write_csv([["2026-10-03", "-3", "C", ""]])
        self.assert_success("import", str(path), stdout="imported 1 skipped 0\n")
        self.assert_success("list", stdout="3\t2026-10-03\t-3\tC\t\n")

    def test_report_aggregates_and_sorts_sums_then_category(self):
        self.add("2026-10-01", -4, "B")
        self.add("2026-10-02", -6, "B")
        self.add("2026-10-03", -10, "A")
        self.add("2026-10-04", -30, "C")
        self.add("2026-10-05", 100, "급여")
        self.add("2026-09-30", -999, "이전 달")
        self.add("2027-10-01", -999, "다른 연도")
        self.assert_success(
            "report", "--month", "2026-10",
            stdout="C\t-30\nA\t-10\nB\t-10\n급여\t100\nTOTAL\t50\n",
        )

    def test_empty_database_and_empty_report(self):
        self.assert_success("list", stdout="")
        self.assertTrue(self.db.is_file())
        self.assert_success("report", "--month", "2026-10", stdout="TOTAL\t0\n")

    def test_valid_leap_day(self):
        self.add("2024-02-29", -1, "A", expected_id=1)

    def test_invalid_dates_fail_without_changing_database(self):
        self.add("2026-10-01", -1, "A", expected_id=1)
        before = self.db.read_bytes()
        for date in (
            "2026-2-01", "2026-02-1", "26-02-01", "2026/02/01",
            "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01",
            "2026-01-00", "0000-01-01", "2026-10-01suffix",
        ):
            with self.subTest(date=date):
                self.assert_error("add", date, "1", "A")
                self.assertEqual(self.db.read_bytes(), before)
        self.add("2026-10-02", -2, "B", expected_id=2)

    def test_noninteger_amounts_fail_without_changing_database(self):
        self.add("2026-10-01", -1, "A", expected_id=1)
        before = self.db.read_bytes()
        for amount in ("1.0", "1e3", "1,000", "NaN", "", "--1", "12won"):
            with self.subTest(amount=amount):
                self.assert_error("add", "2026-10-02", amount, "A")
                self.assertEqual(self.db.read_bytes(), before)
        self.add("2026-10-02", -2, "B", expected_id=2)

    def test_missing_and_invalid_ids_fail_without_changing_database(self):
        self.add("2026-10-01", -1, "A", expected_id=1)
        before = self.db.read_bytes()
        for identifier in ("2", "0", "-1", "nope", "1.0"):
            with self.subTest(identifier=identifier):
                self.assert_error("delete", identifier)
                self.assertEqual(self.db.read_bytes(), before)

    def test_unknown_command_and_missing_arguments_fail(self):
        for arguments in (
            ("unknown",), (), ("add",), ("delete",), ("report",), ("import",),
            ("add", "2026-10-01", "1"),
        ):
            with self.subTest(arguments=arguments):
                self.assert_error(*arguments)

    def test_invalid_months_fail(self):
        for command in ("list", "report"):
            for month in ("2026-1", "2026-00", "2026-13", "2026/10", "2026-10-01"):
                with self.subTest(command=command, month=month):
                    self.assert_error(command, "--month", month)

    def test_blank_add_categories_are_rejected_without_mutation(self):
        self.add("2026-10-01", -1, "A", expected_id=1)
        before = self.db.read_bytes()
        for category in ("", " ", "\t", "\n", " \t\r\n "):
            with self.subTest(category=category):
                self.assert_error("add", "2026-10-02", "1", category)
                self.assertEqual(self.db.read_bytes(), before)
        self.add("2026-10-02", -2, "B", expected_id=2)

    def test_invalid_input_does_not_create_missing_database(self):
        bad_header = self.directory / "bad-header.csv"
        bad_header.write_text("not,the,expected,header\n", encoding="utf-8")
        for arguments in (
            ("add", "2026-02-29", "1", "A"),
            ("add", "2026-10-01", "1.5", "A"),
            ("add", "2026-10-01", "1", " "),
            ("list", "--month", "2026-13"),
            ("report", "--month", "2026-1"),
            ("delete", "1"),
            ("unknown",),
            ("import", str(bad_header)),
            ("import", str(self.directory / "missing.csv")),
        ):
            with self.subTest(arguments=arguments):
                self.assert_error(*arguments)
                self.assertFalse(self.db.exists())

    def test_corrupted_json_is_not_replaced_or_reset(self):
        path = self.write_csv([["2026-10-02", "-2", "B", ""]])
        for payload in (b'{"entries": [', b'not JSON', b'\xff\xfe'):
            self.db.write_bytes(payload)
            for arguments in (
                ("list",),
                ("add", "2026-10-01", "-1", "A"),
                ("delete", "1"),
                ("report", "--month", "2026-10"),
                ("import", str(path)),
            ):
                with self.subTest(payload=payload, arguments=arguments):
                    self.assert_error(*arguments)
                    self.assertEqual(self.db.read_bytes(), payload)

    def test_invalid_next_id_and_boolean_entry_values_are_preserved(self):
        self.add("2026-10-01", -1, "A", expected_id=1)
        original = json.loads(self.db.read_text(encoding="utf-8"))
        invalid_databases = []
        for next_id in (0, -1, 1, True, "2", 2.5):
            database = json.loads(json.dumps(original))
            database["next_id"] = next_id
            invalid_databases.append((f"next_id={next_id!r}", database))
        for field in ("id", "amount"):
            database = json.loads(json.dumps(original))
            database["entries"][0][field] = True
            invalid_databases.append((f"boolean {field}", database))
        for description, database in invalid_databases:
            self.db.write_text(json.dumps(database), encoding="utf-8")
            before = self.db.read_bytes()
            for arguments in (
                ("list",), ("add", "2026-10-02", "-2", "B"), ("delete", "1"),
            ):
                with self.subTest(description=description, arguments=arguments):
                    self.assert_error(*arguments)
                    self.assertEqual(self.db.read_bytes(), before)

    def test_control_characters_do_not_break_output_lines_or_fields(self):
        category = "A\tB\nC\rD"
        memo = "m\tmore\nnext\rlast"
        self.add("2026-10-01", -10, category, memo, expected_id=1)
        expected = "1\t2026-10-01\t-10\tA\\tB\\nC\\rD\tm\\tmore\\nnext\\rlast\n"
        result = self.assert_success("list", stdout=expected)
        self.assertEqual(len(result.stdout.splitlines()), 1)
        self.assertEqual(len(result.stdout.rstrip("\n").split("\t")), 5)
        self.assert_success("list", "--category", category, stdout=expected)
        self.assert_success(
            "report", "--month", "2026-10",
            stdout="A\\tB\\nC\\rD\t-10\nTOTAL\t-10\n",
        )

    def test_import_valid_rows_and_quoted_comma_memo(self):
        self.add("2026-10-01", 100, "기존", expected_id=1)
        path = self.write_csv([
            ["2026-10-03", "-300", "식비", "점심, 커피"],
            ["2026-10-02", "2000", "수입", ""],
            ["2026-10-02", "0", "조정", "잔액 확인"],
        ])
        self.assert_success("import", str(path), stdout="imported 3 skipped 0\n")
        self.assert_success(
            "list",
            stdout=(
                "1\t2026-10-01\t100\t기존\t\n"
                "3\t2026-10-02\t2000\t수입\t\n"
                "4\t2026-10-02\t0\t조정\t잔액 확인\n"
                "2\t2026-10-03\t-300\t식비\t점심, 커피\n"
            ),
        )
        self.add("2026-10-04", -1, "후속", expected_id=5)

    def test_import_skips_invalid_rows_and_reports_physical_line_numbers(self):
        path = self.write_csv([
            ["2026-10-01", "-1", "A", "first"],
            ["2026-2-02", "-2", "A", "bad format"],
            ["2026-02-29", "-3", "A", "impossible date"],
            ["2026-10-02", "1.5", "A", "decimal"],
            ["2026-10-02", "-4", "", "empty category"],
            ["2026-10-02", "-5", "   ", "blank category"],
            ["2026-10-03", "-6", "B", "last"],
        ])
        result = self.run_cli("import", str(path))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "imported 2 skipped 5\n")
        errors = result.stderr.splitlines()
        self.assertEqual(len(errors), 5)
        for error, number in zip(errors, range(3, 8)):
            self.assertRegex(error, rf"^line {number}: .+")
        self.assert_success(
            "list", stdout="1\t2026-10-01\t-1\tA\tfirst\n2\t2026-10-03\t-6\tB\tlast\n"
        )
        self.add("2026-10-04", -1, "후속", expected_id=3)

    def test_first_invalid_csv_data_row_is_reported_as_line_two(self):
        path = self.write_csv([
            ["2026-02-29", "-1", "A", "invalid"],
            ["2026-10-01", "-2", "B", "valid"],
        ])
        result = self.run_cli("import", str(path))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "imported 1 skipped 1\n")
        self.assertRegex(result.stderr, r"^line 2: .+\n$")
        self.assert_success("list", stdout="1\t2026-10-01\t-2\tB\tvalid\n")

    def test_import_diagnostics_count_physical_lines_after_multiline_record(self):
        path = self.write_csv([
            ["2026-10-01", "-1", "A", "first\nsecond"],
            ["2026-10-02", "not-an-integer", "B", "invalid"],
            ["2026-10-03", "-3", "C", "last"],
        ])
        result = self.run_cli("import", str(path))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "imported 2 skipped 1\n")
        self.assertRegex(result.stderr, r"^line 4: .+\n$")
        self.add("2026-10-04", -4, "후속", expected_id=3)

    def test_import_skips_wrong_column_counts(self):
        path = self.write_csv([
            ["2026-10-01", "-1", "A", "first"],
            ["2026-10-02", "-2", "B"],
            ["2026-10-02", "-3", "B", "memo", "extra"],
            ["2026-10-03", "-4", "C", "last"],
        ])
        result = self.run_cli("import", str(path))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "imported 2 skipped 2\n")
        self.assertEqual(len(result.stderr.splitlines()), 2)
        self.assertRegex(result.stderr.splitlines()[0], r"^line 3: .+")
        self.assertRegex(result.stderr.splitlines()[1], r"^line 4: .+")
        self.assert_success(
            "list", stdout="1\t2026-10-01\t-1\tA\tfirst\n2\t2026-10-03\t-4\tC\tlast\n"
        )

    def test_import_skips_malformed_csv_and_continues_after_bad_record(self):
        path = self.directory / "malformed.csv"
        path.write_text(
            'date,amount,category,memo\n'
            '2026-10-01,-1,A,first\n'
            '2026-10-02,-2,B,"bad"junk\n'
            '2026-10-03,-3,C,last\n',
            encoding="utf-8",
        )
        result = self.run_cli("import", str(path))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "imported 2 skipped 1\n")
        self.assertEqual(len(result.stderr.splitlines()), 1)
        self.assertRegex(result.stderr, r"^line 3: .+\n$")
        self.assert_success(
            "list", stdout="1\t2026-10-01\t-1\tA\tfirst\n2\t2026-10-03\t-3\tC\tlast\n"
        )

    def test_import_unclosed_quote_is_reported_as_a_skipped_row(self):
        path = self.directory / "unclosed.csv"
        path.write_text(
            'date,amount,category,memo\n'
            '2026-10-01,-1,A,first\n'
            '2026-10-02,-2,B,"unterminated\n',
            encoding="utf-8",
        )
        result = self.run_cli("import", str(path))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "imported 1 skipped 1\n")
        self.assertRegex(result.stderr, r"^line 3: .+\n$")
        self.assert_success("list", stdout="1\t2026-10-01\t-1\tA\tfirst\n")

    def test_import_header_only_is_successful(self):
        path = self.write_csv([])
        self.assert_success("import", str(path), stdout="imported 0 skipped 0\n")
        self.assert_success("list", stdout="")

    def test_import_accepts_optional_utf8_bom(self):
        path = self.directory / "bom.csv"
        path.write_text(
            "date,amount,category,memo\n2026-10-01,-10,식비,점심\n",
            encoding="utf-8-sig",
        )
        self.assert_success("import", str(path), stdout="imported 1 skipped 0\n")
        self.assert_success("list", stdout="1\t2026-10-01\t-10\t식비\t점심\n")

    def test_bad_csv_header_or_missing_file_does_not_change_database(self):
        self.add("2026-10-01", -1, "A", expected_id=1)
        before = self.db.read_bytes()
        bad_header = self.directory / "bad-header.csv"
        bad_header.write_text("date,category,amount,memo\n2026-10-02,A,-2,memo\n", encoding="utf-8")
        self.assert_error("import", str(bad_header))
        self.assertEqual(self.db.read_bytes(), before)
        self.assert_error("import", str(self.directory / "does-not-exist.csv"))
        self.assertEqual(self.db.read_bytes(), before)
        self.add("2026-10-03", -3, "C", expected_id=2)


if __name__ == "__main__":
    unittest.main()
