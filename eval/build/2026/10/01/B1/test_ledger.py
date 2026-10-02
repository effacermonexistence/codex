"""End-to-end tests of ledger.py's actual command-line and persisted JSON."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().with_name("ledger.py")


class LedgerCLITests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.db = self.directory / "ledger.json"

    def run_cli(self, *arguments, code=0):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--db", str(self.db), *arguments],
            capture_output=True, text=True, encoding="utf-8",
        )
        self.assertEqual(result.returncode, code, result.stderr)
        return result

    def add(self, entry_date="2026-10-01", amount="-1000", category="식비", *memo):
        return self.run_cli("add", entry_date, amount, category, *memo)

    def csv_file(self, text):
        path = self.directory / "entries.csv"
        path.write_text(text, encoding="utf-8")
        return str(path)

    def test_add_outputs_only_id_and_persists_values(self):
        result = self.add("2026-10-01", "-1000", "식비", "점심 식사")
        self.assertEqual(result.stdout, "1\n")
        self.assertEqual(result.stderr, "")
        database = json.loads(self.db.read_text(encoding="utf-8"))
        self.assertEqual(database["next_id"], 2)
        self.assertEqual(database["entries"], [{
            "id": 1, "date": "2026-10-01", "amount": -1000,
            "category": "식비", "memo": "점심 식사",
        }])

    def test_add_defaults_to_empty_memo_and_accepts_zero_and_income(self):
        self.add(amount="0")
        self.add(amount="+2000", category="급여")
        self.assertEqual(self.run_cli("list").stdout,
                         "1\t2026-10-01\t0\t식비\t\n2\t2026-10-01\t2000\t급여\t\n")

    def test_missing_database_is_created_by_list(self):
        result = self.run_cli("list")
        self.assertEqual(result.stdout, "")
        self.assertTrue(self.db.is_file())
        self.assertEqual(json.loads(self.db.read_text()), {"next_id": 1, "entries": []})

    def test_missing_database_parent_is_created(self):
        self.db = self.directory / "nested" / "ledger.json"
        self.assertEqual(self.add().stdout, "1\n")
        self.assertTrue(self.db.is_file())

    def test_list_sorts_dates_then_numeric_ids(self):
        self.add("2026-10-03", "1", "later")
        for index in range(2, 12):
            self.add("2026-10-01", str(index), "earlier")
        lines = self.run_cli("list").stdout.splitlines()
        self.assertEqual([int(line.split("\t")[0]) for line in lines], list(range(2, 12)) + [1])

    def test_list_month_category_and_combined_filters(self):
        self.add("2026-10-01", "-1", "식비", "a")
        self.add("2026-09-01", "-2", "식비", "b")
        self.add("2026-10-02", "-3", "교통", "c")
        self.assertEqual(self.run_cli("list", "--month", "2026-10").stdout,
                         "1\t2026-10-01\t-1\t식비\ta\n3\t2026-10-02\t-3\t교통\tc\n")
        self.assertEqual(self.run_cli("list", "--category", "식비").stdout,
                         "2\t2026-09-01\t-2\t식비\tb\n1\t2026-10-01\t-1\t식비\ta\n")
        self.assertEqual(self.run_cli("list", "--month", "2026-10", "--category", "식비").stdout,
                         "1\t2026-10-01\t-1\t식비\ta\n")
        self.assertEqual(self.run_cli("list", "--category", "unknown").stdout, "")

    def test_delete_is_silent_and_removes_only_requested_entry(self):
        self.add()
        self.add(category="교통")
        result = self.run_cli("delete", "1")
        self.assertEqual((result.stdout, result.stderr), ("", ""))
        self.assertEqual(self.run_cli("list").stdout, "2\t2026-10-01\t-1000\t교통\t\n")

    def test_deleted_highest_and_all_ids_are_never_reused(self):
        self.add()
        self.add()
        self.run_cli("delete", "2")
        self.assertEqual(self.add().stdout, "3\n")
        self.run_cli("delete", "1")
        self.run_cli("delete", "3")
        self.assertEqual(self.add().stdout, "4\n")

    def test_missing_id_errors_without_mutation(self):
        self.add()
        original = self.db.read_bytes()
        result = self.run_cli("delete", "99", code=2)
        self.assertEqual(result.stdout, "")
        self.assertIn("does not exist", result.stderr)
        self.assertEqual(self.db.read_bytes(), original)

    def test_report_sorts_sum_then_category_and_totals_only_month(self):
        self.add("2026-10-01", "-100", "B")
        self.add("2026-10-02", "-100", "A")
        self.add("2026-10-03", "-200", "C")
        self.add("2026-10-03", "50", "C")
        self.add("2026-10-04", "500", "급여")
        self.add("2026-09-01", "9999", "급여")
        self.assertEqual(self.run_cli("report", "--month", "2026-10").stdout,
                         "C\t-150\nA\t-100\nB\t-100\n급여\t500\nTOTAL\t150\n")

    def test_empty_report_is_total_zero_and_creates_database(self):
        self.assertEqual(self.run_cli("report", "--month", "2026-10").stdout, "TOTAL\t0\n")
        self.assertTrue(self.db.is_file())

    def test_invalid_dates_and_non_integer_amounts_return_two(self):
        bad_dates = ("2026-2-01", "20261001", "2026-02-29", "2026-04-31",
                     "2026-13-01", "0000-01-01", "2026-10-01extra")
        for value in bad_dates:
            with self.subTest(date=value):
                result = self.run_cli("add", value, "1", "식비", code=2)
                self.assertEqual(result.stdout, "")
                self.assertIn("invalid date", result.stderr)
        for value in ("1.5", "1e3", "abc", "", "1_000", "NaN"):
            with self.subTest(amount=value):
                result = self.run_cli("add", "2026-10-01", value, "식비", code=2)
                self.assertEqual(result.stdout, "")
                self.assertIn("invalid amount", result.stderr)
        self.assertFalse(self.db.exists())

    def test_leap_day_is_valid(self):
        self.assertEqual(self.add("2024-02-29").stdout, "1\n")

    def test_invalid_months_return_two(self):
        for month in ("2026-1", "202610", "2026-00", "2026-13", "0000-01"):
            for command in ("list", "report"):
                with self.subTest(month=month, command=command):
                    result = self.run_cli(command, "--month", month, code=2)
                    self.assertEqual(result.stdout, "")
                    self.assertIn("invalid month", result.stderr)

    def test_empty_categories_invalid_ids_and_unknown_commands(self):
        for category in ("", "  "):
            self.assertTrue(self.run_cli("add", "2026-10-01", "1", category, code=2).stderr)
        for entry_id in ("0", "-1", "1.0", "abc"):
            self.assertTrue(self.run_cli("delete", entry_id, code=2).stderr)
        self.assertTrue(self.run_cli("unknown", code=2).stderr)
        self.assertTrue(self.run_cli("report", code=2).stderr)
        self.assertTrue(self.run_cli(code=2).stderr)

    def test_db_argument_is_required(self):
        result = subprocess.run([sys.executable, str(SCRIPT), "list"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertIn("--db", result.stderr)

    def test_import_valid_and_invalid_rows_with_line_numbers(self):
        path = self.csv_file(
            "date,amount,category,memo\n"
            "2026-10-01,-1000,식비,점심\n"
            "2026-02-29,1,식비,bad date\n"
            "2026-10-02,1.5,식비,bad amount\n"
            "2026-10-02,1,   ,bad category\n"
            "2026-10-03,2000,급여,\n"
        )
        result = self.run_cli("import", path)
        self.assertEqual(result.stdout, "imported 2 skipped 3\n")
        self.assertEqual([line.split(":", 1)[0] for line in result.stderr.splitlines()],
                         ["line 3", "line 4", "line 5"])
        self.assertEqual(self.run_cli("list").stdout,
                         "1\t2026-10-01\t-1000\t식비\t점심\n2\t2026-10-03\t2000\t급여\t\n")
        self.assertEqual(self.add().stdout, "3\n")

    def test_import_uses_next_id_after_deletion(self):
        self.add()
        self.run_cli("delete", "1")
        result = self.run_cli("import", self.csv_file("date,amount,category,memo\n2026-10-01,1,A,\n"))
        self.assertEqual(result.stdout, "imported 1 skipped 0\n")
        self.assertTrue(self.run_cli("list").stdout.startswith("2\t"))

    def test_import_bom_quotes_commas_and_physical_line_numbers(self):
        path = self.csv_file(
            '\ufeffdate,amount,category,memo\n'
            '2026-10-01,-1,식비,"first, part\nsecond part"\n'
            '2026-10-02,no,식비,bad\n'
        )
        result = self.run_cli("import", path)
        self.assertEqual(result.stdout, "imported 1 skipped 1\n")
        self.assertTrue(result.stderr.startswith("line 4: "))
        entry = json.loads(self.db.read_text(encoding="utf-8"))["entries"][0]
        self.assertEqual(entry["memo"], "first, part\nsecond part")

    def test_import_skips_bad_field_counts_and_blank_rows(self):
        path = self.csv_file(
            "date,amount,category,memo\n"
            "2026-10-01,1,A\n"
            "2026-10-01,1,A,memo,extra\n"
            "\n"
            "2026-10-01,1,A,valid\n"
        )
        result = self.run_cli("import", path)
        self.assertEqual(result.stdout, "imported 1 skipped 3\n")
        self.assertEqual([line.split(":", 1)[0] for line in result.stderr.splitlines()],
                         ["line 2", "line 3", "line 4"])

    def test_import_skips_unparseable_csv_and_continues(self):
        path = self.csv_file(
            'date,amount,category,memo\n'
            '2026-10-01,1,A,"bad"trailing\n'
            '2026-10-02,2,B,valid\n'
        )
        result = self.run_cli("import", path)
        self.assertEqual(result.stdout, "imported 1 skipped 1\n")
        self.assertIn("line 2: invalid CSV:", result.stderr)
        self.assertEqual(self.run_cli("list").stdout, "1\t2026-10-02\t2\tB\tvalid\n")

    def test_import_unterminated_quote_is_skipped_not_fatal(self):
        path = self.csv_file(
            'date,amount,category,memo\n'
            '2026-10-01,1,A,valid\n'
            '2026-10-02,2,B,"unterminated\n'
        )
        result = self.run_cli("import", path)
        self.assertEqual(result.stdout, "imported 1 skipped 1\n")
        self.assertIn("line 3: invalid CSV:", result.stderr)

    def test_empty_and_invalid_header_errors_do_not_change_database(self):
        self.add()
        original = self.db.read_bytes()
        for content in ("", "date,amount,category\n", '"unterminated\n'):
            with self.subTest(content=content):
                result = self.run_cli("import", self.csv_file(content), code=2)
                self.assertEqual(result.stdout, "")
                self.assertIn("CSV header", result.stderr)
                self.assertEqual(self.db.read_bytes(), original)

    def test_header_only_and_all_invalid_imports_do_not_consume_ids(self):
        for content, expected in (
            ("date,amount,category,memo\n", "imported 0 skipped 0\n"),
            ("date,amount,category,memo\nbad,1,A,\n", "imported 0 skipped 1\n"),
        ):
            with self.subTest(content=content):
                result = self.run_cli("import", self.csv_file(content))
                self.assertEqual(result.stdout, expected)
        self.assertEqual(self.add().stdout, "1\n")

    def test_import_missing_file_is_error_and_does_not_create_database(self):
        result = self.run_cli("import", str(self.directory / "missing.csv"), code=2)
        self.assertEqual(result.stdout, "")
        self.assertTrue(result.stderr)
        self.assertFalse(self.db.exists())

    def test_corrupted_json_is_not_overwritten(self):
        self.db.write_text('{"broken":', encoding="utf-8")
        original = self.db.read_bytes()
        result = self.run_cli("add", "2026-10-01", "1", "A", code=2)
        self.assertEqual(result.stdout, "")
        self.assertIn("invalid database JSON", result.stderr)
        self.assertEqual(self.db.read_bytes(), original)

    def test_invalid_database_schema_is_not_overwritten(self):
        valid_entry = {"id": 1, "date": "2026-10-01", "amount": -1, "category": "A", "memo": ""}
        cases = [
            [], {}, {"next_id": True, "entries": []},
            {"next_id": 1, "entries": [valid_entry]},
            {"next_id": 2, "entries": [valid_entry, valid_entry]},
            {"next_id": 2, "entries": [{**valid_entry, "amount": True}]},
            {"next_id": 2, "entries": [{**valid_entry, "date": "2026-02-29"}]},
            {"next_id": 2, "entries": [{**valid_entry, "memo": None}]},
        ]
        for database in cases:
            with self.subTest(database=database):
                self.db.write_text(json.dumps(database), encoding="utf-8")
                original = self.db.read_bytes()
                result = self.run_cli("list", code=2)
                self.assertEqual(result.stdout, "")
                self.assertIn("invalid database", result.stderr)
                self.assertEqual(self.db.read_bytes(), original)

    def test_database_io_errors_return_two_without_traceback(self):
        self.db.mkdir()
        result = self.run_cli("list", code=2)
        self.assertEqual(result.stdout, "")
        self.assertTrue(result.stderr)
        self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
