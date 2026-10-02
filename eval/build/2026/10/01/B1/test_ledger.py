"""Black-box regression tests for the standard-library ledger CLI."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().with_name("ledger.py")


class LedgerCLITest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.db = self.root / "ledger.json"

    def cli(self, *arguments, expected=0):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--db", str(self.db), *map(str, arguments)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
        self.assertEqual(
            result.returncode,
            expected,
            msg=f"arguments={arguments!r}\nstdout={result.stdout!r}\nstderr={result.stderr!r}",
        )
        return result

    def add(self, date="2026-10-01", amount="-1000", category="식비", memo=None):
        arguments = ["add", date, amount, category]
        if memo is not None:
            arguments.append(memo)
        result = self.cli(*arguments)
        self.assertEqual(result.stderr, "")
        self.assertRegex(result.stdout, r"^[1-9][0-9]*\n$")
        return int(result.stdout)

    def csv_file(self, contents, name="input.csv"):
        path = self.root / name
        with path.open("w", encoding="utf-8", newline="") as stream:
            stream.write(contents)
        return path

    def assert_input_error(self, *arguments):
        result = self.cli(*arguments, expected=2)
        self.assertEqual(result.stdout, "")
        self.assertTrue(result.stderr.strip())
        self.assertNotIn("Traceback", result.stderr)
        return result

    def test_add_creates_json_and_persists_across_processes(self):
        self.assertEqual(self.add(memo="점심 식사"), 1)
        self.assertTrue(self.db.is_file())
        with self.db.open(encoding="utf-8") as stream:
            json.load(stream)
        result = self.cli("list")
        self.assertEqual(result.stdout, "1\t2026-10-01\t-1000\t식비\t점심 식사\n")
        self.assertEqual(result.stderr, "")
        self.assertEqual(self.add(amount="2000", category="수입"), 2)

    def test_add_defaults_memo_to_empty_and_accepts_zero(self):
        self.assertEqual(self.add(amount="0"), 1)
        self.assertEqual(self.cli("list").stdout, "1\t2026-10-01\t0\t식비\t\n")

    def test_signed_integer_and_large_integer_are_exact(self):
        self.add(amount="+1000", category="수입")
        large = "123456789012345678901234567890"
        self.add(amount=large, category="수입")
        self.assertEqual(
            self.cli("report", "--month", "2026-10").stdout,
            f"수입\t{int(large) + 1000}\nTOTAL\t{int(large) + 1000}\n",
        )

    def test_list_missing_database_is_empty_and_initializes_json(self):
        result = self.cli("list")
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "")
        self.assertTrue(self.db.exists())
        with self.db.open(encoding="utf-8") as stream:
            json.load(stream)

    def test_list_sorts_by_date_then_id(self):
        self.add("2026-10-03", "-30", "식비", "third")
        self.add("2026-10-01", "-20", "식비", "first")
        self.add("2026-10-01", "-10", "교통", "second")
        self.assertEqual(
            self.cli("list").stdout,
            "2\t2026-10-01\t-20\t식비\tfirst\n"
            "3\t2026-10-01\t-10\t교통\tsecond\n"
            "1\t2026-10-03\t-30\t식비\tthird\n",
        )

    def test_tsv_control_characters_are_escaped_without_changing_stored_text(self):
        category = "food\tdrink\\extra"
        memo = "first\nsecond\rthird\tlast\\end"
        self.add(category=category, memo=memo)
        self.assertEqual(
            self.cli("list", "--category", category).stdout,
            "1\t2026-10-01\t-1000\tfood\\tdrink\\extra\t"
            "first\\nsecond\\rthird\\tlast\\end\n",
        )
        self.assertEqual(
            self.cli("report", "--month", "2026-10").stdout,
            "food\\tdrink\\extra\t-1000\nTOTAL\t-1000\n",
        )

    def test_plain_backslashes_in_memo_are_preserved(self):
        memo = r"C:\temp\ledger"
        self.add(memo=memo)
        self.assertEqual(
            self.cli("list").stdout,
            "1\t2026-10-01\t-1000\t식비\t" + memo + "\n",
        )

    def test_list_month_category_and_combined_filters(self):
        self.add("2026-09-30", "-5", "식비")
        self.add("2026-10-01", "-10", "식비")
        self.add("2026-10-02", "-20", "교통")
        self.add("2027-10-01", "-30", "식비")
        self.assertEqual(
            self.cli("list", "--month", "2026-10").stdout,
            "2\t2026-10-01\t-10\t식비\t\n3\t2026-10-02\t-20\t교통\t\n",
        )
        self.assertEqual(
            self.cli("list", "--category", "식비").stdout,
            "1\t2026-09-30\t-5\t식비\t\n"
            "2\t2026-10-01\t-10\t식비\t\n"
            "4\t2027-10-01\t-30\t식비\t\n",
        )
        self.assertEqual(
            self.cli("list", "--category", "식비", "--month", "2026-10").stdout,
            "2\t2026-10-01\t-10\t식비\t\n",
        )
        self.assertEqual(self.cli("list", "--category", "없는 항목").stdout, "")

    def test_delete_removes_only_selected_entry_and_never_reuses_ids(self):
        self.add(amount="-1")
        self.add(amount="-2")
        self.cli("delete", "2")
        self.assertEqual(self.add(amount="-3"), 3)
        self.cli("delete", "1")
        self.cli("delete", "3")
        self.assertEqual(self.cli("list").stdout, "")
        self.assertEqual(self.add(amount="-4"), 4)

    def test_delete_missing_or_invalid_id_is_error_without_mutation(self):
        self.add()
        before = self.db.read_bytes()
        for identifier in ("2", "0", "-1", "abc", "1.0"):
            with self.subTest(identifier=identifier):
                self.assert_input_error("delete", identifier)
                self.assertEqual(self.db.read_bytes(), before)

    def test_report_aggregates_and_sorts_by_total_then_category(self):
        for date, amount, category in (
            ("2026-10-01", "-700", "food"),
            ("2026-10-02", "-300", "food"),
            ("2026-10-03", "-500", "zeta"),
            ("2026-10-04", "-500", "alpha"),
            ("2026-10-05", "2000", "salary"),
            ("2026-09-30", "-9000", "other"),
        ):
            self.add(date, amount, category)
        self.assertEqual(
            self.cli("report", "--month", "2026-10").stdout,
            "food\t-1000\nalpha\t-500\nzeta\t-500\nsalary\t2000\nTOTAL\t0\n",
        )

    def test_empty_report_has_total_zero(self):
        self.assertEqual(self.cli("report", "--month", "2026-10").stdout, "TOTAL\t0\n")

    def test_leap_day_is_valid_only_in_leap_year(self):
        self.assertEqual(self.add("2024-02-29"), 1)
        before = self.db.read_bytes()
        self.assert_input_error("add", "2025-02-29", "1", "수입")
        self.assertEqual(self.db.read_bytes(), before)

    def test_invalid_date_format_and_nonexistent_dates(self):
        self.add()
        before = self.db.read_bytes()
        for date in (
            "2026-1-01", "2026-01-1", "26-01-01", "2026/10/01",
            "2026-13-01", "2026-00-01", "2026-04-31", "2026-10-00",
            "0000-01-01", "2026-10-01T00:00:00", " 2026-10-01",
        ):
            with self.subTest(date=date):
                self.assert_input_error("add", date, "1", "수입")
                self.assertEqual(self.db.read_bytes(), before)

    def test_invalid_integer_amounts(self):
        self.add()
        before = self.db.read_bytes()
        for amount in ("1.5", "1e3", "1,000", "abc", "", "--2", "NaN"):
            with self.subTest(amount=amount):
                self.assert_input_error("add", "2026-10-01", amount, "수입")
                self.assertEqual(self.db.read_bytes(), before)

    def test_empty_category_is_invalid(self):
        for category in ("", " ", "\t"):
            with self.subTest(category=category):
                self.assert_input_error("add", "2026-10-01", "1", category)

    def test_invalid_months_and_missing_report_month(self):
        for month in ("2026-1", "26-10", "2026-13", "2026-00", "0000-10", "2026/10"):
            for command in ("list", "report"):
                with self.subTest(month=month, command=command):
                    self.assert_input_error(command, "--month", month)
        self.assert_input_error("report")

    def test_unknown_command_missing_arguments_and_extra_arguments(self):
        for arguments in (
            ("unknown",), (), ("add",), ("delete",), ("import",),
            ("add", "2026-10-01", "1", "수입", "memo", "extra"),
        ):
            with self.subTest(arguments=arguments):
                self.assert_input_error(*arguments)

    def test_import_skips_bad_rows_and_reports_physical_line_numbers(self):
        source = self.csv_file(
            "date,amount,category,memo\n"
            "2026-10-01,-1200,식비,점심\n"
            "2026-02-30,-10,식비,invalid date\n"
            "2026-10-02,1.5,수입,invalid amount\n"
            "2026-10-03,-30,   ,empty category\n"
            "2026-10-04,2000,수입,급여\n"
        )
        result = self.cli("import", source)
        self.assertEqual(result.stdout, "imported 2 skipped 3\n")
        errors = result.stderr.splitlines()
        self.assertEqual(len(errors), 3)
        for message, line in zip(errors, (3, 4, 5)):
            self.assertRegex(message, rf"^line {line}: .+$")
        self.assertEqual(
            self.cli("list").stdout,
            "1\t2026-10-01\t-1200\t식비\t점심\n"
            "2\t2026-10-04\t2000\t수입\t급여\n",
        )
        self.assertEqual(self.add(), 3)

    def test_import_retains_quoted_commas_and_quotes(self):
        source = self.csv_file(
            'date,amount,category,memo\r\n'
            '2026-10-01,-100,"food,drink","say ""hello"", again"\r\n'
        )
        result = self.cli("import", source)
        self.assertEqual(result.stdout, "imported 1 skipped 0\n")
        self.assertEqual(result.stderr, "")
        self.assertEqual(
            self.cli("list").stdout,
            '1\t2026-10-01\t-100\tfood,drink\tsay "hello", again\n',
        )

    def test_import_multiline_record_does_not_shift_later_error_line(self):
        source = self.csv_file(
            'date,amount,category,memo\n'
            '2026-10-01,-100,food,"first line\nsecond line"\n'
            '2026-10-02,not-an-int,food,bad\n'
            '2026-10-03,-200,food,good\n'
        )
        result = self.cli("import", source)
        self.assertEqual(result.stdout, "imported 2 skipped 1\n")
        self.assertRegex(result.stderr, r"^line 4: .+\n$")
        self.assertEqual(self.cli("report", "--month", "2026-10").stdout,
                         "food\t-300\nTOTAL\t-300\n")

    def test_import_invalid_multiline_row_reports_record_start(self):
        source = self.csv_file(
            'date,amount,category,memo\n'
            'invalid,-100,food,"first line\nsecond line"\n'
            '2026-10-03,-200,food,good\n'
        )
        result = self.cli("import", source)
        self.assertEqual(result.stdout, "imported 1 skipped 1\n")
        self.assertRegex(result.stderr, r"^line 2: .+\n$")

    def test_import_bad_column_counts_and_blank_row_are_skipped(self):
        source = self.csv_file(
            "date,amount,category,memo\n"
            "2026-10-01,-1,food\n"
            "2026-10-01,-2,food,memo,extra\n"
            "\n"
            "2026-10-01,-3,food,\n"
        )
        result = self.cli("import", source)
        self.assertEqual(result.stdout, "imported 1 skipped 3\n")
        errors = result.stderr.splitlines()
        self.assertEqual(len(errors), 3)
        for message, line in zip(errors, (2, 3, 4)):
            self.assertRegex(message, rf"^line {line}: .+$")

    def test_import_recoverable_malformed_csv_is_skipped_then_continues(self):
        source = self.csv_file(
            'date,amount,category,memo\n'
            '2026-10-01,-1,"food"oops,bad\n'
            '2026-10-02,-2,food,good\n'
        )
        result = self.cli("import", source)
        self.assertEqual(result.stdout, "imported 1 skipped 1\n")
        self.assertRegex(result.stderr, r"^line 2: .+\n$")
        self.assertEqual(self.cli("list").stdout, "1\t2026-10-02\t-2\tfood\tgood\n")

    def test_import_unterminated_quote_is_skipped_without_traceback(self):
        source = self.csv_file(
            'date,amount,category,memo\n'
            '2026-10-01,-1,food,good\n'
            '2026-10-02,-2,food,"unterminated\n'
        )
        result = self.cli("import", source)
        self.assertEqual(result.stdout, "imported 1 skipped 1\n")
        self.assertRegex(result.stderr, r"^line 3: .+\n$")
        self.assertNotIn("Traceback", result.stderr)

    def test_import_ids_continue_after_deleted_entries_and_skip_bad_rows(self):
        self.add()
        self.cli("delete", "1")
        source = self.csv_file(
            "date,amount,category,memo\n"
            "bad,1,food,invalid\n"
            "2026-10-02,-2,food,valid\n"
        )
        self.cli("import", source)
        self.assertEqual(self.cli("list").stdout, "2\t2026-10-02\t-2\tfood\tvalid\n")
        self.assertEqual(self.add(), 3)

    def test_import_header_only_is_empty_success(self):
        result = self.cli("import", self.csv_file("date,amount,category,memo\n"))
        self.assertEqual(result.stdout, "imported 0 skipped 0\n")
        self.assertEqual(result.stderr, "")

    def test_import_accepts_utf8_bom(self):
        source = self.csv_file(
            "\ufeffdate,amount,category,memo\n2026-10-01,-500,식비,점심\n"
        )
        result = self.cli("import", source)
        self.assertEqual(result.stdout, "imported 1 skipped 0\n")
        self.assertEqual(result.stderr, "")
        self.assertEqual(self.cli("list").stdout, "1\t2026-10-01\t-500\t식비\t점심\n")

    def test_import_bad_header_and_missing_file_are_errors(self):
        for contents in (
            "", "amount,date,category,memo\n", "date,amount,category\n",
            "date,amount,category,memo,extra\n",
        ):
            with self.subTest(contents=contents):
                self.assert_input_error("import", self.csv_file(contents))
        self.assert_input_error("import", self.root / "missing.csv")

    def test_malformed_database_is_not_overwritten(self):
        self.db.write_text("{broken JSON", encoding="utf-8")
        before = self.db.read_bytes()
        self.assert_input_error("list")
        self.assertEqual(self.db.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
