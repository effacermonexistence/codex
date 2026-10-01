"""End-to-end tests for the ledger CLI using only the standard library."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().with_name("ledger.py")


class LedgerCLITest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.db = self.directory / "ledger.json"

    def cli(self, *arguments, db=None):
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--db", str(db or self.db), *arguments],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=10,
            check=False,
        )

    def successful(self, *arguments, expected="", db=None):
        result = self.cli(*arguments, db=db)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, expected)
        self.assertEqual(result.stderr, "")
        return result

    def rejected(self, *arguments, db=None):
        result = self.cli(*arguments, db=db)
        self.assertEqual(result.returncode, 2, result)
        self.assertEqual(result.stdout, "")
        self.assertTrue(result.stderr.strip())
        self.assertNotIn("Traceback", result.stderr)
        return result

    def write_csv(self, text, name="entries.csv"):
        path = self.directory / name
        path.write_text(text, encoding="utf-8")
        return path

    def assert_json_db(self):
        self.assertTrue(self.db.is_file())
        with self.db.open(encoding="utf-8") as stream:
            json.load(stream)

    def test_add_creates_db_and_prints_only_id(self):
        self.successful("add", "2026-10-01", "-12000", "식비", expected="1\n")
        self.assert_json_db()
        self.successful("add", "2026-10-02", "3000000", "급여", "10월 급여", expected="2\n")
        self.successful(
            "list",
            expected="1\t2026-10-01\t-12000\t식비\t\n2\t2026-10-02\t3000000\t급여\t10월 급여\n",
        )

    def test_db_is_loaded_across_separate_processes(self):
        self.successful("add", "2026-09-30", "10", "기타", "첫 항목", expected="1\n")
        self.successful("add", "2026-10-01", "20", "기타", "두 번째", expected="2\n")
        self.assert_json_db()
        self.successful(
            "list", expected="1\t2026-09-30\t10\t기타\t첫 항목\n2\t2026-10-01\t20\t기타\t두 번째\n"
        )

    def test_db_paths_are_independent_and_support_spaces(self):
        other = self.directory / "other ledger.json"
        self.successful("add", "2026-10-01", "5", "A", expected="1\n")
        self.successful("add", "2026-10-01", "7", "B", expected="1\n", db=other)
        self.successful("list", expected="1\t2026-10-01\t5\tA\t\n")
        self.successful("list", expected="1\t2026-10-01\t7\tB\t\n", db=other)

    def test_list_sorts_by_date_then_numeric_id(self):
        self.successful("add", "2026-10-03", "-3", "C", "later", expected="1\n")
        for index in range(2, 12):
            self.successful("add", "2026-10-01", str(index), "C", expected=f"{index}\n")
        expected = "".join(f"{index}\t2026-10-01\t{index}\tC\t\n" for index in range(2, 12))
        expected += "1\t2026-10-03\t-3\tC\tlater\n"
        self.successful("list", expected=expected)

    def test_list_month_and_category_filters(self):
        entries = [
            ("2026-09-30", "-1", "식비", "9월"),
            ("2026-10-01", "-2", "식비", "10월"),
            ("2026-10-02", "-3", "교통", "버스"),
            ("2027-10-01", "-4", "식비", "다음 해"),
        ]
        for identifier, entry in enumerate(entries, start=1):
            self.successful("add", *entry, expected=f"{identifier}\n")
        self.successful(
            "list", "--month", "2026-10",
            expected="2\t2026-10-01\t-2\t식비\t10월\n3\t2026-10-02\t-3\t교통\t버스\n",
        )
        self.successful(
            "list", "--category", "식비",
            expected="1\t2026-09-30\t-1\t식비\t9월\n2\t2026-10-01\t-2\t식비\t10월\n4\t2027-10-01\t-4\t식비\t다음 해\n",
        )
        self.successful(
            "list", "--month", "2026-10", "--category", "식비",
            expected="2\t2026-10-01\t-2\t식비\t10월\n",
        )
        self.successful("list", "--category", "없는 카테고리")

    def test_delete_is_silent_and_does_not_reuse_ids(self):
        for identifier in range(1, 4):
            self.successful("add", "2026-10-01", str(identifier), "A", expected=f"{identifier}\n")
        self.successful("delete", "2")
        self.successful("add", "2026-10-01", "4", "A", expected="4\n")
        self.successful("delete", "4")
        self.successful("add", "2026-10-01", "5", "A", expected="5\n")
        self.successful(
            "list", expected="1\t2026-10-01\t1\tA\t\n3\t2026-10-01\t3\tA\t\n5\t2026-10-01\t5\tA\t\n"
        )

    def test_id_is_not_reused_after_all_entries_deleted(self):
        self.successful("add", "2026-10-01", "1", "A", expected="1\n")
        self.successful("delete", "1")
        self.successful("list")
        self.successful("add", "2026-10-01", "2", "A", expected="2\n")

    def test_delete_missing_id_is_error_without_modification(self):
        self.successful("add", "2026-10-01", "1", "A", expected="1\n")
        before = self.db.read_bytes()
        self.rejected("delete", "999")
        self.assertEqual(self.db.read_bytes(), before)
        self.successful("list", expected="1\t2026-10-01\t1\tA\t\n")

    def test_report_sums_sorts_and_excludes_other_months(self):
        entries = [
            ("2026-10-01", "-200", "식비"),
            ("2026-10-02", "50", "식비"),
            ("2026-10-01", "-150", "교통"),
            ("2026-10-03", "300", "급여"),
            ("2026-10-04", "-200", "A"),
            ("2026-10-05", "-200", "B"),
            ("2026-09-30", "99999", "급여"),
            ("2027-10-01", "99999", "급여"),
        ]
        for identifier, entry in enumerate(entries, start=1):
            self.successful("add", *entry, expected=f"{identifier}\n")
        self.successful(
            "report", "--month", "2026-10",
            expected="A\t-200\nB\t-200\n교통\t-150\n식비\t-150\n급여\t300\nTOTAL\t-400\n",
        )

    def test_empty_list_and_report_create_parseable_database(self):
        self.successful("list")
        self.assert_json_db()
        self.successful("report", "--month", "2026-10", expected="TOTAL\t0\n")
        self.assert_json_db()

    def test_empty_report_on_missing_database_creates_it(self):
        self.successful("report", "--month", "2026-10", expected="TOTAL\t0\n")
        self.assert_json_db()

    def test_leap_day_and_signed_integer_amounts(self):
        self.successful("add", "2024-02-29", "+0007", "A", expected="1\n")
        self.successful("add", "2000-02-29", "-0002", "A", expected="2\n")
        self.successful("add", "2026-10-01", "0", "A", expected="3\n")
        self.successful(
            "list", expected="2\t2000-02-29\t-2\tA\t\n1\t2024-02-29\t7\tA\t\n3\t2026-10-01\t0\tA\t\n"
        )

    def test_invalid_dates_rejected_without_creating_database(self):
        for value in [
            "2026-2-01", "26-02-01", "2026/02/01", "2026-02-30", "2023-02-29",
            "1900-02-29", "2026-13-01", "2026-00-01", "2026-01-00", "0000-01-01",
            "2026-10-01extra", " 2026-10-01", "２０２６-１０-０１",
        ]:
            with self.subTest(date=value):
                self.rejected("add", value, "1", "A")
                self.assertFalse(self.db.exists())

    def test_non_integer_amounts_rejected_without_creating_database(self):
        for value in ["1.0", "1e3", "1_000", "1,000", "", "+", "-", "１２", " 1", "1 "]:
            with self.subTest(amount=value):
                self.rejected("add", "2026-10-01", value, "A")
                self.assertFalse(self.db.exists())

    def test_empty_category_rejected(self):
        for category in ["", " ", "\t"]:
            with self.subTest(category=category):
                self.rejected("add", "2026-10-01", "1", category)
                self.assertFalse(self.db.exists())

    def test_invalid_months_and_missing_report_month(self):
        for month in ["2026-1", "2026/10", "2026-00", "2026-13", "0000-01", "２０２６-１０", "2026-10-01"]:
            for command in ["list", "report"]:
                with self.subTest(command=command, month=month):
                    self.rejected(command, "--month", month)
                    self.assertFalse(self.db.exists())
        self.rejected("report")
        self.assertFalse(self.db.exists())

    def test_unknown_command_and_malformed_arguments_exit_two(self):
        cases = [
            (), ("unknown",), ("add",), ("add", "2026-10-01", "1"),
            ("delete",), ("delete", "abc"), ("delete", "1.5"),
            ("list", "--bogus"), ("add", "2026-10-01", "1", "A", "memo", "extra"),
            ("import",),
        ]
        for arguments in cases:
            with self.subTest(arguments=arguments):
                self.rejected(*arguments)
                self.assertFalse(self.db.exists())

    def test_invalid_add_does_not_change_existing_db_or_consume_id(self):
        self.successful("add", "2026-10-01", "10", "A", expected="1\n")
        before = self.db.read_bytes()
        self.rejected("add", "2026-02-30", "20", "A")
        self.rejected("add", "2026-10-01", "20.5", "A")
        self.rejected("add", "2026-10-01", "20", " ")
        self.assertEqual(self.db.read_bytes(), before)
        self.successful("add", "2026-10-02", "30", "A", expected="2\n")

    def test_import_valid_csv_with_quotes_utf8_and_empty_memo(self):
        path = self.write_csv(
            'date,amount,category,memo\n'
            '2026-10-02,-3000,식비,"점심, 커피"\n'
            '2026-10-01,10000,용돈,\n'
            '2026-10-03,+5,기타,"그는 ""안녕""이라고 말했다"\n'
        )
        self.successful("import", str(path), expected="imported 3 skipped 0\n")
        self.assert_json_db()
        self.successful(
            "list", expected='2\t2026-10-01\t10000\t용돈\t\n1\t2026-10-02\t-3000\t식비\t점심, 커피\n3\t2026-10-03\t5\t기타\t그는 "안녕"이라고 말했다\n'
        )

    def test_import_skips_invalid_rows_and_reports_csv_line_numbers(self):
        path = self.write_csv(
            "date,amount,category,memo\n"
            "2026-10-01,-10,식비,valid\n"
            "2026-02-30,-20,식비,bad date\n"
            "2026/10/02,-20,식비,bad format\n"
            "2026-10-02,2.5,식비,bad amount\n"
            "2026-10-02,20,   ,blank category\n"
            "2026-10-03,30,급여,valid\n"
        )
        result = self.cli("import", str(path))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "imported 2 skipped 4\n")
        diagnostics = result.stderr.splitlines()
        self.assertEqual(len(diagnostics), 4)
        for line_number, diagnostic in zip([3, 4, 5, 6], diagnostics):
            self.assertRegex(diagnostic, rf"^line {line_number}: .+")
        self.successful(
            "list", expected="1\t2026-10-01\t-10\t식비\tvalid\n2\t2026-10-03\t30\t급여\tvalid\n"
        )
        self.successful("add", "2026-10-04", "1", "A", expected="3\n")

    def test_import_extends_existing_ids_after_deletion(self):
        self.successful("add", "2026-10-01", "1", "A", expected="1\n")
        self.successful("delete", "1")
        path = self.write_csv("date,amount,category,memo\n2026-10-02,2,A,new\n")
        self.successful("import", str(path), expected="imported 1 skipped 0\n")
        self.successful("list", expected="2\t2026-10-02\t2\tA\tnew\n")

    def test_import_accepts_utf8_bom_header(self):
        path = self.write_csv("\ufeffdate,amount,category,memo\n2026-10-01,1,A,한글\n")
        self.successful("import", str(path), expected="imported 1 skipped 0\n")
        self.successful("list", expected="1\t2026-10-01\t1\tA\t한글\n")

    def test_import_header_only_creates_json_database(self):
        path = self.write_csv("date,amount,category,memo\n")
        self.successful("import", str(path), expected="imported 0 skipped 0\n")
        self.assert_json_db()

    def test_import_rejects_wrong_header_without_modification(self):
        self.successful("add", "2026-10-01", "1", "A", expected="1\n")
        before = self.db.read_bytes()
        for header in [
            "date,amount,category", "amount,date,category,memo", "date,amount,category,note",
            "date,amount,category,memo,extra", "Date,amount,category,memo", "",
        ]:
            with self.subTest(header=header):
                text = header + "\n2026-10-01,1,A,memo\n" if header else ""
                path = self.write_csv(text)
                self.rejected("import", str(path))
                self.assertEqual(self.db.read_bytes(), before)

    def test_import_bad_column_counts_and_blank_rows_are_skipped(self):
        path = self.write_csv(
            "date,amount,category,memo\n"
            "2026-10-01,1,A\n"
            "2026-10-01,1,A,memo,extra\n"
            "\n"
            "2026-10-02,2,A,ok\n"
        )
        result = self.cli("import", str(path))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "imported 1 skipped 3\n")
        diagnostics = result.stderr.splitlines()
        self.assertEqual(len(diagnostics), 3)
        for line_number, diagnostic in zip([2, 3, 4], diagnostics):
            self.assertRegex(diagnostic, rf"^line {line_number}: .+")
        self.successful("list", expected="1\t2026-10-02\t2\tA\tok\n")

    def test_import_multiline_memo_uses_physical_record_start_line(self):
        path = self.write_csv(
            'date,amount,category,memo\n'
            '2026-10-01,1,A,"first line\nsecond line"\n'
            '2026-10-02,not-an-int,A,bad\n'
            '2026-02-30,3,A,bad date\n'
            '2026-10-03,4,A,last\n'
        )
        result = self.cli("import", str(path))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "imported 2 skipped 2\n")
        diagnostics = result.stderr.splitlines()
        self.assertEqual(len(diagnostics), 2)
        self.assertRegex(diagnostics[0], r"^line 4: .+")
        self.assertRegex(diagnostics[1], r"^line 5: .+")
        self.successful(
            "list", expected="1\t2026-10-01\t1\tA\tfirst line\\nsecond line\n2\t2026-10-03\t4\tA\tlast\n"
        )

    def test_control_characters_are_escaped_only_on_output(self):
        category = "A\tB\rC\nD\\t"
        memo = "메모\tCR\rLF\n원문\\n"
        display_category = "A\\tB\\rC\\nD\\t"
        display_memo = "메모\\tCR\\rLF\\n원문\\n"
        self.successful("add", "2026-10-01", "7", category, memo, expected="1\n")
        result = self.successful(
            "list", expected=f"1\t2026-10-01\t7\t{display_category}\t{display_memo}\n"
        )
        self.assertEqual(len(result.stdout.splitlines()), 1)
        self.assertEqual(len(result.stdout.rstrip("\n").split("\t")), 5)
        self.successful(
            "report", "--month", "2026-10", expected=f"{display_category}\t7\nTOTAL\t7\n"
        )
        with self.db.open(encoding="utf-8") as stream:
            stored = json.load(stream)

        def stored_strings(value):
            if isinstance(value, str):
                yield value
            elif isinstance(value, dict):
                for child in value.values():
                    yield from stored_strings(child)
            elif isinstance(value, list):
                for child in value:
                    yield from stored_strings(child)

        strings = list(stored_strings(stored))
        self.assertIn(category, strings)
        self.assertIn(memo, strings)

    def test_missing_import_file_is_error_without_creating_db(self):
        self.rejected("import", str(self.directory / "missing.csv"))
        self.assertFalse(self.db.exists())

    def test_malformed_json_is_not_silently_overwritten(self):
        self.db.write_text("not json\n", encoding="utf-8")
        before = self.db.read_bytes()
        self.rejected("list")
        self.rejected("add", "2026-10-01", "1", "A")
        self.assertEqual(self.db.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
