"""End-to-end tests: every case runs `python3 ledger.py ...` in a subprocess."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

LEDGER = Path(__file__).resolve().parent.parent / "ledger.py"


class LedgerTestCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.db = self.dir / "ledger.json"

    def run_raw(self, *argv):
        return subprocess.run(
            [sys.executable, str(LEDGER), *argv],
            capture_output=True,
            text=True,
            encoding="utf-8",
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
            cwd=self.dir,
        )

    def run_cli(self, *args):
        return self.run_raw("--db", str(self.db), *args)

    def ok(self, *args):
        """Run a command that must succeed without stderr output; return stdout."""
        result = self.run_cli(*args)
        self.assertEqual((result.returncode, result.stderr), (0, ""), args)
        return result.stdout

    def invalid(self, *args):
        """Run a command that must fail with status 2 and a message; return stderr."""
        result = self.run_cli(*args)
        self.assertEqual(result.returncode, 2, (args, result.stdout, result.stderr))
        self.assertEqual(result.stdout, "", args)
        self.assertTrue(result.stderr.strip(), args)
        return result.stderr

    def ids(self, *args):
        return [line.split("\t")[0] for line in self.ok(*args).splitlines()]

    def write_csv(self, text, name="import.csv"):
        path = self.dir / name
        path.write_bytes(text.encode("utf-8"))
        return str(path)


class AddTest(LedgerTestCase):
    def test_prints_only_the_new_id_and_creates_the_database(self):
        self.db = self.dir / "new" / "dir" / "ledger.json"
        self.assertEqual(self.ok("add", "2024-03-05", "-12000", "식비", "점심"), "1\n")
        self.assertEqual(self.ok("add", "2024-03-06", "3000000", "월급"), "2\n")
        self.assertIsInstance(json.loads(self.db.read_text(encoding="utf-8")), dict)

    def test_rejects_invalid_input_without_creating_the_database(self):
        cases = [
            ("2024-02-30", "-100", "식비"),  # no such date
            ("2023-02-29", "-100", "식비"),  # not a leap year
            ("2024-13-01", "-100", "식비"),
            ("0000-01-01", "-100", "식비"),
            ("2024-1-5", "-100", "식비"),  # wrong format
            ("2024/01/05", "-100", "식비"),
            ("20240105", "-100", "식비"),
            ("2024-01-05", "12.5", "식비"),  # not an integer
            ("2024-01-05", "-12.5", "식비"),
            ("2024-01-05", "abc", "식비"),
            ("2024-01-05", "1e3", "식비"),
            ("2024-01-05", "1,000", "식비"),
            ("2024-01-05", "", "식비"),
            ("2024-01-05", "-100", ""),  # empty category
            ("2024-01-05", "-100", "   "),
        ]
        for case in cases:
            with self.subTest(case=case):
                self.invalid("add", *case)
        self.assertFalse(self.db.exists())

    def test_accepts_leap_day_signed_amounts_and_multi_word_memo(self):
        self.ok("add", "2024-02-29", "+500", "용돈")
        self.ok("add", "2024-02-29", "-0", "기타", "여러", "단어")
        self.assertEqual(
            self.ok("list"),
            "1\t2024-02-29\t500\t용돈\t\n2\t2024-02-29\t0\t기타\t여러 단어\n",
        )

    def test_tabs_and_newlines_in_text_become_spaces(self):
        self.ok("add", "2024-01-01", "-1", "a\tb", "one\ntwo\tthree")
        self.assertEqual(self.ok("list"), "1\t2024-01-01\t-1\ta b\tone two three\n")


class ListTest(LedgerTestCase):
    def setUp(self):
        super().setUp()
        for entry in [
            ("2024-03-05", "-12000", "식비", "점심"),  # 1
            ("2024-02-28", "-3000", "교통"),  # 2
            ("2024-03-01", "3000000", "월급", "3월 급여"),  # 3
            ("2024-03-05", "-4500", "카페"),  # 4
            ("2024-03-01", "-8000", "식비", "장보기"),  # 5
        ]:
            self.ok("add", *entry)

    def test_sorted_by_date_then_id(self):
        self.assertEqual(
            self.ok("list").splitlines(),
            [
                "2\t2024-02-28\t-3000\t교통\t",
                "3\t2024-03-01\t3000000\t월급\t3월 급여",
                "5\t2024-03-01\t-8000\t식비\t장보기",
                "1\t2024-03-05\t-12000\t식비\t점심",
                "4\t2024-03-05\t-4500\t카페\t",
            ],
        )

    def test_filters_by_month_and_category(self):
        self.assertEqual(self.ids("list", "--month", "2024-03"), ["3", "5", "1", "4"])
        self.assertEqual(self.ids("list", "--category", "식비"), ["5", "1"])
        self.assertEqual(self.ids("list", "--month", "2024-03", "--category", "카페"), ["4"])
        self.assertEqual(self.ids("list", "--month", "2024-02", "--category", "식비"), [])
        self.assertEqual(self.ids("list", "--month", "2025-03"), [])

    def test_invalid_month_is_rejected(self):
        for month in ("2024-13", "2024-00", "2024-3", "2024-03-01", "march"):
            with self.subTest(month=month):
                self.invalid("list", "--month", month)


class DeleteTest(LedgerTestCase):
    def setUp(self):
        super().setUp()
        for day in ("01", "02", "03"):
            self.ok("add", f"2024-01-{day}", "-1000", "식비")

    def test_removes_the_entry_silently(self):
        self.assertEqual(self.ok("delete", "2"), "")
        self.assertEqual(self.ids("list"), ["1", "3"])

    def test_unknown_or_malformed_id_is_rejected(self):
        for entry_id in ("4", "0", "-1", "abc", "1.0"):
            with self.subTest(entry_id=entry_id):
                self.invalid("delete", entry_id)
        self.ok("delete", "1")
        self.invalid("delete", "1")
        self.assertEqual(self.ids("list"), ["2", "3"])

    def test_ids_are_never_reused(self):
        self.ok("delete", "3")  # the highest id
        self.assertEqual(self.ok("add", "2024-01-04", "-1", "식비"), "4\n")
        for entry_id in ("1", "2", "4"):
            self.ok("delete", entry_id)
        self.assertEqual(self.ok("list"), "")
        self.assertEqual(self.ok("add", "2024-01-05", "-1", "식비"), "5\n")


class ReportTest(LedgerTestCase):
    def test_sums_per_category_sorted_by_sum_then_name(self):
        for entry in [
            ("2024-03-02", "-12000", "식비"),
            ("2024-03-20", "-8000", "식비"),
            ("2024-03-03", "-20000", "교통"),  # ties with 식비, so name order decides
            ("2024-03-05", "-4500", "카페"),
            ("2024-03-25", "3000000", "월급"),
            ("2024-02-29", "-999", "식비"),  # other months are excluded
            ("2024-04-01", "-999", "교통"),
        ]:
            self.ok("add", *entry)
        self.assertEqual(
            self.ok("report", "--month", "2024-03"),
            "교통\t-20000\n식비\t-20000\n카페\t-4500\n월급\t3000000\nTOTAL\t2955500\n",
        )

    def test_month_without_entries_reports_zero_total(self):
        self.ok("add", "2024-03-02", "-12000", "식비")
        self.assertEqual(self.ok("report", "--month", "2024-05"), "TOTAL\t0\n")

    def test_month_is_required_and_validated(self):
        self.invalid("report")
        for month in ("2024-13", "2024-3", "2024/03"):
            with self.subTest(month=month):
                self.invalid("report", "--month", month)


class ImportTest(LedgerTestCase):
    def run_import(self, csv_text):
        result = self.run_cli("import", self.write_csv(csv_text))
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout, result.stderr.splitlines()

    def test_skips_invalid_lines_using_csv_line_numbers(self):
        stdout, errors = self.run_import(
            "date,amount,category,memo\n"
            "2024-03-01,-12000,식비,점심\n"  # line 2: ok
            "2024-03-32,-5000,식비,no such day\n"  # line 3
            "2024/03/02,-5000,식비,slashes\n"  # line 4
            "2024-03-03,12.5,교통,decimal\n"  # line 5
            "2024-03-04,abc,교통,text\n"  # line 6
            "2024-03-05,-3000,,empty category\n"  # line 7
            "2024-03-06,-3000,   ,blank category\n"  # line 8
            '2024-03-07,2500000,월급,"3월, 보너스 포함"\n'  # line 9: ok
            "2024-03-08,-4500,카페\n"  # line 10: ok, no memo cell
        )
        self.assertEqual(stdout, "imported 3 skipped 6\n")
        self.assertEqual(
            [line.split(": ", 1)[0] for line in errors],
            ["line 3", "line 4", "line 5", "line 6", "line 7", "line 8"],
        )
        for line, word in zip(errors, ["date", "date", "amount", "amount", "category", "category"]):
            self.assertIn(word, line)
        self.assertEqual(
            self.ok("list"),
            "1\t2024-03-01\t-12000\t식비\t점심\n"
            "2\t2024-03-07\t2500000\t월급\t3월, 보너스 포함\n"
            "3\t2024-03-08\t-4500\t카페\t\n",
        )

    def test_reports_each_skipped_line_once_even_with_several_problems(self):
        stdout, errors = self.run_import("date,amount,category,memo\nbad,x,,\n,,,\n")
        self.assertEqual(stdout, "imported 0 skipped 2\n")
        self.assertEqual([line.split(": ", 1)[0] for line in errors], ["line 2", "line 3"])
        for line in errors:
            for word in ("date", "amount", "category"):
                self.assertIn(word, line)

    def test_line_numbers_count_physical_lines(self):
        stdout, errors = self.run_import(
            "date,amount,category,memo\n"
            '2024-03-01,-1000,식비,"two\nlines"\n'  # lines 2-3
            "\n"  # line 4: blank lines are ignored
            '2024-13-01,-1000,식비,"bad\nmonth"\n'  # lines 5-6: reported by first line
            "2024-03-02,x,식비,last\n"  # line 7
        )
        self.assertEqual(stdout, "imported 1 skipped 2\n")
        self.assertEqual([line.split(": ", 1)[0] for line in errors], ["line 5", "line 7"])
        self.assertEqual(self.ok("list"), "1\t2024-03-01\t-1000\t식비\ttwo lines\n")

    def test_handles_bom_and_crlf_and_continues_ids(self):
        self.ok("add", "2024-01-01", "-1", "기타")
        stdout, errors = self.run_import(
            "\ufeffdate,amount,category,memo\r\n"
            "2024-03-01,-1000,식비,a\r\n"
            "2024-03-0x,1,기타,b\r\n"
            "2024-03-02,2000,용돈,c\r\n"
        )
        self.assertEqual(stdout, "imported 2 skipped 1\n")
        self.assertEqual([line.split(": ", 1)[0] for line in errors], ["line 3"])
        self.assertEqual(self.ids("list"), ["1", "2", "3"])

    def test_header_only_imports_nothing(self):
        self.assertEqual(self.run_import("date,amount,category,memo\n"), ("imported 0 skipped 0\n", []))

    def test_rejects_missing_file_and_wrong_header(self):
        self.invalid("import", str(self.dir / "missing.csv"))
        self.invalid("import", self.write_csv("2024-03-01,-1000,식비,a\n"))
        self.invalid("import", self.write_csv("amount,date,category,memo\n-1000,2024-03-01,식비,a\n"))
        self.assertFalse(self.db.exists())


class CommandLineTest(LedgerTestCase):
    def test_unknown_or_missing_command_exits_2(self):
        self.invalid("frobnicate")
        self.invalid()

    def test_db_option_is_required(self):
        result = self.run_raw("list")
        self.assertEqual(result.returncode, 2)
        self.assertIn("--db", result.stderr)

    def test_db_option_may_follow_the_command(self):
        self.ok("add", "2024-01-01", "-1", "기타")
        result = self.run_raw("list", "--db", str(self.db))
        self.assertEqual((result.returncode, result.stdout), (0, "1\t2024-01-01\t-1\t기타\t\n"))

    def test_missing_or_empty_database_is_an_empty_ledger(self):
        self.assertEqual(self.ok("list"), "")
        self.assertEqual(self.ok("report", "--month", "2024-01"), "TOTAL\t0\n")
        self.assertTrue(self.db.exists())
        self.db.write_bytes(b"")
        self.assertEqual(self.ok("add", "2024-01-01", "-1", "기타"), "1\n")

    def test_corrupt_database_is_reported_and_left_untouched(self):
        self.db.write_text("{not json", encoding="utf-8")
        result = self.run_cli("add", "2024-01-01", "-1", "기타")
        self.assertEqual(result.returncode, 1)
        self.assertIn("not valid JSON", result.stderr)
        self.assertEqual(self.db.read_text(encoding="utf-8"), "{not json")


if __name__ == "__main__":
    unittest.main()
