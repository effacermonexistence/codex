"""Black-box regression tests for ledger.py using only the standard library."""

import csv
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import ledger


SCRIPT = Path(__file__).with_name("ledger.py").resolve()


class LedgerCLITests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.db = self.directory / "ledger.json"

    def run_cli(self, *arguments, code=0, db=None):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--db", str(db or self.db), *arguments],
            capture_output=True, text=True, cwd=self.directory, timeout=10,
        )
        self.assertEqual(result.returncode, code, result.stderr)
        if code == 0:
            self.assertNotIn("Traceback", result.stderr)
        else:
            self.assertEqual(result.stdout, "")
            self.assertTrue(result.stderr)
            self.assertNotIn("Traceback", result.stderr)
        return result

    def database(self):
        return json.loads(self.db.read_text(encoding="utf-8"))

    def write_csv(self, rows, name="input.csv"):
        path = self.directory / name
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(ledger.CSV_HEADER)
            writer.writerows(rows)
        return path

    def test_empty_list_creates_database(self):
        result = self.run_cli("list")
        self.assertEqual((result.stdout, result.stderr), ("", ""))
        self.assertEqual(self.database(), {"next_id": 1, "entries": []})

    def test_empty_report_creates_database(self):
        result = self.run_cli("report", "--month", "2026-10")
        self.assertEqual((result.stdout, result.stderr), ("TOTAL\t0\n", ""))
        self.assertEqual(self.database(), {"next_id": 1, "entries": []})

    def test_add_outputs_only_id_and_persists_integer_amount_and_memo(self):
        first = self.run_cli("add", "2026-10-01", "-3500", "식비", "점심 식사")
        second = self.run_cli("add", "2026-10-02", "+5000", "수입")
        third = self.run_cli("add", "2026-10-03", "0", "기타")
        self.assertEqual([first.stdout, second.stdout, third.stdout], ["1\n", "2\n", "3\n"])
        self.assertEqual([first.stderr, second.stderr, third.stderr], ["", "", ""])
        database = self.database()
        self.assertEqual(database["next_id"], 4)
        self.assertEqual(database["entries"][0], {
            "id": 1, "date": "2026-10-01", "amount": -3500,
            "category": "식비", "memo": "점심 식사",
        })
        self.assertEqual(database["entries"][1]["memo"], "")
        self.assertEqual(database["entries"][2]["amount"], 0)

    def test_ids_are_not_reused_after_deleting_all_entries(self):
        self.run_cli("add", "2026-10-01", "-1", "a")
        self.run_cli("add", "2026-10-01", "-2", "b")
        for entry_id in ("2", "1"):
            result = self.run_cli("delete", entry_id)
            self.assertEqual((result.stdout, result.stderr), ("", ""))
        self.assertEqual(self.database(), {"next_id": 3, "entries": []})
        self.assertEqual(self.run_cli("add", "2026-10-02", "9", "c").stdout, "3\n")

    def test_list_sorting_and_combined_filters(self):
        rows = [
            ["2026-10-03", "-10", "식비", "later"],
            ["2026-10-01", "-20", "교통", "early"],
            ["2026-10-01", "-30", "식비", "same date"],
            ["2026-09-30", "100", "식비", ""],
            ["2027-10-01", "200", "식비", "other year"],
        ]
        self.run_cli("import", str(self.write_csv(rows)))
        expected = (
            "4\t2026-09-30\t100\t식비\t\n"
            "2\t2026-10-01\t-20\t교통\tearly\n"
            "3\t2026-10-01\t-30\t식비\tsame date\n"
            "1\t2026-10-03\t-10\t식비\tlater\n"
            "5\t2027-10-01\t200\t식비\tother year\n"
        )
        self.assertEqual(self.run_cli("list").stdout, expected)
        self.assertEqual(self.run_cli("list", "--month", "2026-10").stdout,
                         "".join(expected.splitlines(keepends=True)[1:4]))
        self.assertEqual(self.run_cli("list", "--category", "교통").stdout,
                         "2\t2026-10-01\t-20\t교통\tearly\n")
        self.assertEqual(self.run_cli("list", "--month", "2026-10", "--category", "식비").stdout,
                         "3\t2026-10-01\t-30\t식비\tsame date\n1\t2026-10-03\t-10\t식비\tlater\n")
        self.assertEqual(self.run_cli("list", "--category", "없음").stdout, "")

    def test_report_aggregates_and_sorts_by_sum_then_category(self):
        rows = [
            ["2026-10-01", "-30", "b", ""],
            ["2026-10-02", "-50", "a", ""],
            ["2026-10-03", "20", "a", ""],
            ["2026-10-03", "100", "salary", ""],
            ["2026-10-03", "0", "zero", ""],
            ["2026-09-30", "999", "excluded", ""],
            ["2027-10-01", "999", "excluded", ""],
        ]
        self.run_cli("import", str(self.write_csv(rows)))
        result = self.run_cli("report", "--month", "2026-10")
        self.assertEqual(result.stdout, "a\t-30\nb\t-30\nzero\t0\nsalary\t100\nTOTAL\t40\n")
        self.assertEqual(self.run_cli("report", "--month", "2025-10").stdout, "TOTAL\t0\n")

    def test_import_skips_invalid_rows_reports_lines_and_preserves_id_sequence(self):
        self.run_cli("add", "2026-10-01", "1", "old")
        self.run_cli("delete", "1")
        path = self.write_csv([
            ["2026-10-02", "-500", "식비", "점심, 커피"],
            ["2026-2-03", "10", "bad", ""],
            ["2026-02-30", "10", "bad", ""],
            ["2026-10-03", "1.5", "bad", ""],
            ["2026-10-03", "10", " \t", ""],
            ["2026-10-04", "2000", "수입", ""],
            ["2026-10-04", "0", "기타", "기록"],
        ])
        result = self.run_cli("import", str(path))
        self.assertEqual(result.stdout, "imported 3 skipped 4\n")
        self.assertEqual(result.stderr, (
            "line 3: invalid date: expected a real date in YYYY-MM-DD format\n"
            "line 4: invalid date: expected a real date in YYYY-MM-DD format\n"
            "line 5: amount must be an integer\n"
            "line 6: category must not be blank\n"
        ))
        database = self.database()
        self.assertEqual([entry["id"] for entry in database["entries"]], [2, 3, 4])
        self.assertEqual(database["entries"][0]["memo"], "점심, 커피")
        self.assertEqual(database["next_id"], 5)
        self.assertEqual(self.run_cli("add", "2026-10-05", "1", "next").stdout, "5\n")

    def test_import_uses_physical_line_numbers_and_accepts_bom_and_crlf(self):
        path = self.directory / "multiline.csv"
        path.write_bytes((
            '\ufeffdate,amount,category,memo\r\n'
            '2026-10-01,1,a,"first\r\nsecond"\r\n'
            'bad,2,b,invalid\r\n'
            '2026-10-02,3,c,valid\r\n'
        ).encode("utf-8"))
        result = self.run_cli("import", str(path))
        self.assertEqual(result.stdout, "imported 2 skipped 1\n")
        self.assertEqual(result.stderr,
                         "line 4: invalid date: expected a real date in YYYY-MM-DD format\n")
        self.assertEqual(self.database()["entries"][0]["memo"], "first\r\nsecond")

    def test_import_all_invalid_rows_and_wrong_column_counts(self):
        path = self.write_csv([
            ["2026-10-01", "10", "a"],
            ["2026-10-01", "10", "a", "memo", "extra"],
            ["2026-10-01", "10", "", ""],
        ])
        result = self.run_cli("import", str(path))
        self.assertEqual(result.stdout, "imported 0 skipped 3\n")
        self.assertEqual([line.split(":", 1)[0] for line in result.stderr.splitlines()],
                         ["line 2", "line 3", "line 4"])
        self.assertEqual(self.database(), {"next_id": 1, "entries": []})

    def test_import_header_only(self):
        result = self.run_cli("import", str(self.write_csv([])))
        self.assertEqual((result.stdout, result.stderr), ("imported 0 skipped 0\n", ""))
        self.assertEqual(self.database(), {"next_id": 1, "entries": []})

    def test_invalid_dates_fail_without_creating_database(self):
        for value in ("2026-1-01", "2026-02-29", "2026-04-31", "2026-13-01", "0000-01-01", "not-a-date"):
            with self.subTest(date=value):
                result = self.run_cli("add", value, "1", "a", code=2)
                self.assertIn("invalid date", result.stderr)
                self.assertFalse(self.db.exists())

    def test_valid_leap_day(self):
        self.assertEqual(self.run_cli("add", "2024-02-29", "-1", "a").stdout, "1\n")

    def test_non_integer_amounts_fail_without_modifying_database(self):
        self.run_cli("add", "2026-10-01", "1", "a")
        before = self.db.read_bytes()
        for amount in ("1.5", "1e3", "abc", "", "1_000", "１２"):
            with self.subTest(amount=amount):
                result = self.run_cli("add", "2026-10-01", amount, "a", code=2)
                self.assertIn("amount must be an integer", result.stderr)
                self.assertEqual(self.db.read_bytes(), before)

    def test_empty_categories_are_rejected(self):
        for category in ("", " \t"):
            with self.subTest(category=category):
                result = self.run_cli("add", "2026-10-01", "1", category, code=2)
                self.assertIn("category must not be blank", result.stderr)
                self.assertFalse(self.db.exists())

    def test_invalid_months(self):
        for command in ("list", "report"):
            for month in ("2026-1", "2026-00", "2026-13", "0000-01", "2026-10-01"):
                with self.subTest(command=command, month=month):
                    result = self.run_cli(command, "--month", month, code=2)
                    self.assertIn("invalid month", result.stderr)
                    self.assertFalse(self.db.exists())

    def test_missing_and_invalid_ids_leave_database_unchanged(self):
        self.run_cli("add", "2026-10-01", "1", "a")
        before = self.db.read_bytes()
        for entry_id in ("2", "0", "-1", "1.5", "abc"):
            with self.subTest(id=entry_id):
                self.run_cli("delete", entry_id, code=2)
                self.assertEqual(self.db.read_bytes(), before)
        self.run_cli("delete", "1")
        before = self.db.read_bytes()
        self.run_cli("delete", "1", code=2)
        self.assertEqual(self.db.read_bytes(), before)

    def test_unknown_command_and_missing_arguments_exit_2(self):
        for arguments in (("unknown",), (), ("add", "2026-10-01"), ("delete",), ("report",)):
            with self.subTest(arguments=arguments):
                self.run_cli(*arguments, code=2)
                self.assertFalse(self.db.exists())
        result = subprocess.run([sys.executable, str(SCRIPT), "list"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertIn("--db", result.stderr)

    def test_help_exits_successfully_without_creating_database(self):
        result = self.run_cli("--help")
        self.assertIn("--db", result.stdout)
        self.assertFalse(self.db.exists())

    def test_missing_csv_and_bad_header_do_not_modify_database(self):
        self.run_cli("add", "2026-10-01", "1", "a")
        before = self.db.read_bytes()
        self.run_cli("import", str(self.directory / "missing.csv"), code=2)
        for contents in ("", "amount,date,category,memo\n", "date,amount,category\n"):
            with self.subTest(contents=contents):
                path = self.directory / "bad.csv"
                path.write_text(contents, encoding="utf-8")
                result = self.run_cli("import", str(path), code=2)
                self.assertIn("CSV header", result.stderr)
                self.assertEqual(self.db.read_bytes(), before)

    def test_malformed_csv_does_not_commit_partial_import(self):
        self.run_cli("add", "2026-10-01", "1", "a")
        before = self.db.read_bytes()
        path = self.directory / "malformed.csv"
        path.write_text('date,amount,category,memo\n2026-10-02,2,b,valid\n2026-10-03,3,c,"unclosed\n',
                        encoding="utf-8")
        self.run_cli("import", str(path), code=2)
        self.assertEqual(self.db.read_bytes(), before)

    def test_corrupt_database_is_not_overwritten(self):
        invalid_databases = [
            "not JSON",
            "[]",
            json.dumps({"next_id": 0, "entries": []}),
            json.dumps({"next_id": True, "entries": []}),
            json.dumps({"next_id": 1, "entries": "bad"}),
            json.dumps({"next_id": 2, "entries": [None]}),
        ]
        valid_entry = {"id": 1, "date": "2026-10-01", "amount": 1, "category": "a", "memo": ""}
        for update in ({"id": 2}, {"date": "2026-02-30"}, {"amount": True},
                       {"category": " "}, {"memo": None}):
            invalid_databases.append(json.dumps({"next_id": 2, "entries": [{**valid_entry, **update}]}))
        invalid_databases.append(json.dumps({"next_id": 2, "entries": [valid_entry, valid_entry]}))
        for contents in invalid_databases:
            with self.subTest(contents=contents):
                self.db.write_text(contents, encoding="utf-8")
                result = self.run_cli("add", "2026-10-02", "2", "b", code=2)
                self.assertIn("invalid database", result.stderr)
                self.assertEqual(self.db.read_text(encoding="utf-8"), contents)

    def test_database_paths_are_independent_and_can_contain_spaces(self):
        other = self.directory / "다른 가계부.json"
        self.assertEqual(self.run_cli("add", "2026-10-01", "1", "a").stdout, "1\n")
        self.assertEqual(self.run_cli("add", "2026-10-02", "2", "b", db=other).stdout, "1\n")
        self.assertEqual(self.run_cli("list", db=other).stdout, "1\t2026-10-02\t2\tb\t\n")
        self.assertEqual(len(self.database()["entries"]), 1)

    def test_read_commands_do_not_rewrite_existing_database(self):
        self.run_cli("add", "2026-10-01", "1", "a")
        before = self.db.read_bytes()
        modified = self.db.stat().st_mtime_ns
        self.run_cli("list")
        self.run_cli("report", "--month", "2026-10")
        self.assertEqual(self.db.read_bytes(), before)
        self.assertEqual(self.db.stat().st_mtime_ns, modified)

    def test_unusable_database_paths_exit_2_without_traceback(self):
        self.run_cli("list", db=self.directory, code=2)
        self.run_cli("add", "2026-10-01", "1", "a", db=self.directory / "missing" / "db.json", code=2)

    def test_atomic_save_failure_preserves_file_and_cleans_temporary_file(self):
        self.run_cli("add", "2026-10-01", "1", "a")
        before = self.db.read_bytes()
        with mock.patch.object(ledger.os, "replace", side_effect=OSError("simulated write failure")):
            with self.assertRaises(OSError):
                ledger.save_database(self.db, {"next_id": 9, "entries": []})
        self.assertEqual(self.db.read_bytes(), before)
        self.assertEqual(list(self.directory.glob(".ledger.json.*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
