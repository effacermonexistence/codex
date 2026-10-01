#!/usr/bin/env python3
"""Household ledger (가계부) command-line tool.

    python3 ledger.py --db <path> <command> [arguments]

Commands:
    add <YYYY-MM-DD> <amount> <category> [memo]   print the new id
    list [--month YYYY-MM] [--category NAME]      id, date, amount, category, memo
    delete <id>
    report --month YYYY-MM                        per-category sums, then TOTAL
    import <csv>                                  header: date,amount,category,memo

The ledger lives in the --db JSON file, which is created when missing. Amounts
are whole won and expenses are negative. Ids start at 1 and are never reused.
Invalid input exits with status 2 and a message on stderr; an unreadable or
corrupted database exits with status 1 and is left untouched.
"""

from __future__ import annotations

import argparse
import contextlib
import csv
import datetime
import io
import json
import os
import re
import stat
import sys
import tempfile

EXIT_DATABASE = 1
EXIT_INVALID = 2

CSV_HEADER = ("date", "amount", "category", "memo")

_DATE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
_MONTH = re.compile(r"[0-9]{4}-[0-9]{2}")
_INTEGER = re.compile(r"[+-]?[0-9]+")
# Tabs and line breaks (everything str.splitlines() splits on) would break the
# one-entry-per-line, tab-separated output, so text fields store them as spaces.
_BREAKS = re.compile(r"[\t\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]+")


class LedgerError(Exception):
    """A user-facing failure: printed to stderr, then exit with ``status``."""

    def __init__(self, message: str, status: int = EXIT_INVALID):
        super().__init__(message)
        self.status = status


# Field parsers return the normalised value or raise ValueError with a reason
# that serves both `error: <reason>` and the import's `line N: <reason>`.


def _is_real_date(year: str, month: str, day: str = "01") -> bool:
    try:
        datetime.date(int(year), int(month), int(day))
    except ValueError:
        return False
    return True


def parse_date(text: str) -> str:
    value = text.strip()
    if not _DATE.fullmatch(value):
        raise ValueError(f"invalid date {text!r} (expected YYYY-MM-DD)")
    if not _is_real_date(value[:4], value[5:7], value[8:]):
        raise ValueError(f"invalid date {text!r} (no such date)")
    return value


def parse_month(text: str) -> str:
    value = text.strip()
    if not (_MONTH.fullmatch(value) and _is_real_date(value[:4], value[5:])):
        raise ValueError(f"invalid month {text!r} (expected YYYY-MM)")
    return value


def parse_amount(text: str) -> int:
    value = text.strip()
    if not _INTEGER.fullmatch(value):
        raise ValueError(f"amount {text!r} is not an integer")
    return int(value)


def parse_id(text: str) -> int:
    value = text.strip()
    if not _INTEGER.fullmatch(value):
        raise ValueError(f"invalid id {text!r} (expected an integer)")
    return int(value)


def clean_text(text: str) -> str:
    try:
        text.encode("utf-8")
    except UnicodeEncodeError:
        raise ValueError(f"{text!r} is not valid UTF-8 text") from None
    return _BREAKS.sub(" ", text).strip()


def parse_category(text: str) -> str:
    value = clean_text(text)
    if not value:
        raise ValueError("category is empty")
    return value


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _valid_entry(item) -> bool:
    try:
        return (
            _is_int(item["id"])
            and item["id"] > 0
            and parse_date(item["date"]) == item["date"]
            and _is_int(item["amount"])
            and parse_category(item["category"]) == item["category"]
            and isinstance(item.get("memo", ""), str)
        )
    except (AttributeError, KeyError, TypeError, ValueError):
        return False


# Database: {"next_id": <int>, "entries": [{"id", "date", "amount", "category", "memo"}]}


def load_db(path: str) -> dict:
    """Return the ledger stored at ``path``, creating an empty one if it is missing."""
    try:
        with open(path, encoding="utf-8-sig") as f:
            text = f.read()
    except FileNotFoundError:
        db = {"next_id": 1, "entries": []}
        save_db(path, db)
        return db
    except (OSError, UnicodeDecodeError) as exc:
        raise LedgerError(f"cannot read database {path}: {exc}", EXIT_DATABASE) from None
    if not text.strip():  # an empty placeholder file is an empty ledger
        return {"next_id": 1, "entries": []}
    try:
        data = json.loads(text)
    except ValueError as exc:
        raise LedgerError(f"database {path} is not valid JSON: {exc}", EXIT_DATABASE) from None
    if isinstance(data, list):  # a bare list of entries is accepted as well
        data = {"entries": data}
    entries = data.get("entries", []) if isinstance(data, dict) else None
    next_id = data.get("next_id", 1) if isinstance(data, dict) else None
    if not isinstance(entries, list) or not _is_int(next_id):
        raise LedgerError(f"database {path} is corrupted: unexpected structure", EXIT_DATABASE)
    seen = set()
    for number, item in enumerate(entries, 1):
        if not _valid_entry(item) or item["id"] in seen:
            raise LedgerError(f"database {path} is corrupted: entry #{number} is invalid", EXIT_DATABASE)
        seen.add(item["id"])
        item.setdefault("memo", "")
    # Never hand out an id at or below one already used, even if next_id was edited.
    data["next_id"] = max([next_id, 1, *(entry_id + 1 for entry_id in seen)])
    data["entries"] = entries
    return data


def save_db(path: str, db: dict) -> None:
    """Replace the database atomically so a failed write never truncates it."""
    target = os.path.realpath(path)  # keep a symlinked --db pointing at its file
    directory = os.path.dirname(target)
    try:
        os.makedirs(directory, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".ledger-", suffix=".tmp", dir=directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(db, f, ensure_ascii=False, indent=2)
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())
            if os.path.exists(target):
                os.chmod(tmp, stat.S_IMODE(os.stat(target).st_mode))
            os.replace(tmp, target)
        except BaseException:
            with contextlib.suppress(OSError):
                os.unlink(tmp)
            raise
    except OSError as exc:
        raise LedgerError(f"cannot write database {path}: {exc}", EXIT_DATABASE) from None


def add_entry(db: dict, date: str, amount: int, category: str, memo: str) -> int:
    entry_id = db["next_id"]
    db["entries"].append(
        {"id": entry_id, "date": date, "amount": amount, "category": category, "memo": memo}
    )
    db["next_id"] = entry_id + 1
    return entry_id


# Commands


def cmd_add(args) -> None:
    try:
        date = parse_date(args.date)
        amount = parse_amount(args.amount)
        category = parse_category(args.category)
        memo = clean_text(" ".join(args.memo))
    except ValueError as exc:
        raise LedgerError(str(exc)) from None
    db = load_db(args.db)
    entry_id = add_entry(db, date, amount, category, memo)
    save_db(args.db, db)
    print(entry_id)


def cmd_list(args) -> None:
    try:
        month = None if args.month is None else parse_month(args.month)
        category = None if args.category is None else clean_text(args.category)
    except ValueError as exc:
        raise LedgerError(str(exc)) from None
    entries = [
        entry
        for entry in load_db(args.db)["entries"]
        if (month is None or entry["date"][:7] == month)
        and (category is None or entry["category"] == category)
    ]
    entries.sort(key=lambda entry: (entry["date"], entry["id"]))
    for e in entries:
        print(f"{e['id']}\t{e['date']}\t{e['amount']}\t{e['category']}\t{e['memo']}")


def cmd_delete(args) -> None:
    try:
        entry_id = parse_id(args.id)
    except ValueError as exc:
        raise LedgerError(str(exc)) from None
    db = load_db(args.db)
    remaining = [entry for entry in db["entries"] if entry["id"] != entry_id]
    if len(remaining) == len(db["entries"]):
        raise LedgerError(f"no entry with id {entry_id}")
    db["entries"] = remaining  # next_id is kept, so the id is never reused
    save_db(args.db, db)


def cmd_report(args) -> None:
    try:
        month = parse_month(args.month)
    except ValueError as exc:
        raise LedgerError(str(exc)) from None
    sums = {}
    for entry in load_db(args.db)["entries"]:
        if entry["date"][:7] == month:
            sums[entry["category"]] = sums.get(entry["category"], 0) + entry["amount"]
    for category, total in sorted(sums.items(), key=lambda item: (item[1], item[0])):
        print(f"{category}\t{total}")
    print(f"TOTAL\t{sum(sums.values())}")


def read_csv_rows(path: str) -> list:
    """Return (line number, fields) for every data row; the header is line 1.

    Line numbers are physical file lines, so a quoted field spanning several
    lines shifts the rows after it. Empty lines are ignored.
    """
    try:
        with open(path, encoding="utf-8-sig", newline="") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError) as exc:
        raise LedgerError(f"cannot read CSV file {path}: {exc}") from None
    reader = csv.reader(io.StringIO(text, newline=""))
    rows = []
    header_seen = False
    last_line = 0
    try:
        for fields in reader:
            line_number, last_line = last_line + 1, reader.line_num
            if not fields:  # an empty line; a row of empty cells is still validated
                continue
            if header_seen:
                rows.append((line_number, fields))
                continue
            names = [field.strip().lower() for field in fields]
            while names and not names[-1]:
                names.pop()
            if tuple(names) not in (CSV_HEADER, CSV_HEADER[:3]):
                raise LedgerError(
                    f"CSV file {path} must start with the header {','.join(CSV_HEADER)}"
                )
            header_seen = True
    except csv.Error as exc:
        raise LedgerError(f"cannot parse CSV file {path} at line {reader.line_num}: {exc}") from None
    return rows


def parse_csv_row(fields: list) -> tuple:
    """Validate one data row, reporting every problem in a single reason."""
    padded = fields + [""] * (3 - len(fields))
    values, problems = [], []
    for parse, raw in zip((parse_date, parse_amount, parse_category), padded):
        try:
            values.append(parse(raw))
        except ValueError as exc:
            problems.append(str(exc))
    if problems:
        raise ValueError("; ".join(problems))
    # The memo is the last column: keep unquoted commas, drop trailing empty cells.
    memo = fields[3:]
    while memo and not memo[-1].strip():
        memo.pop()
    return (*values, clean_text(",".join(memo)))


def cmd_import(args) -> None:
    rows = read_csv_rows(args.csv_path)
    db = load_db(args.db)
    imported = skipped = 0
    for line_number, fields in rows:
        try:
            date, amount, category, memo = parse_csv_row(fields)
        except ValueError as exc:
            print(f"line {line_number}: {exc}", file=sys.stderr)
            skipped += 1
            continue
        add_entry(db, date, amount, category, memo)
        imported += 1
    if imported:
        save_db(args.db, db)
    print(f"imported {imported} skipped {skipped}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ledger.py",
        usage="%(prog)s --db PATH <command> [arguments]",
        description="Household ledger stored in a JSON file.",
    )
    parser.add_argument("--db", metavar="PATH", help="ledger JSON file (created if missing)")
    # --db may also follow the command; SUPPRESS keeps a value given before it.
    db_after = argparse.ArgumentParser(add_help=False)
    db_after.add_argument("--db", metavar="PATH", default=argparse.SUPPRESS, help=argparse.SUPPRESS)
    commands = parser.add_subparsers(
        dest="command", metavar="<command>", prog="ledger.py", required=True
    )

    add = commands.add_parser("add", parents=[db_after], help="add an entry and print its id")
    add.add_argument("date", help="YYYY-MM-DD")
    add.add_argument("amount", help="whole won; negative for expenses")
    add.add_argument("category")
    add.add_argument("memo", nargs="*", help="optional memo")
    add.set_defaults(run=cmd_add)

    list_ = commands.add_parser("list", parents=[db_after], help="list entries by date")
    list_.add_argument("--month", metavar="YYYY-MM")
    list_.add_argument("--category", metavar="NAME")
    list_.set_defaults(run=cmd_list)

    delete = commands.add_parser("delete", parents=[db_after], help="delete an entry by id")
    delete.add_argument("id")
    delete.set_defaults(run=cmd_delete)

    report = commands.add_parser(
        "report", parents=[db_after], help="per-category totals for one month"
    )
    report.add_argument("--month", metavar="YYYY-MM", required=True)
    report.set_defaults(run=cmd_report)

    import_ = commands.add_parser(
        "import", parents=[db_after], help="import entries from a CSV file"
    )
    import_.add_argument(
        "csv_path", metavar="CSV", help="CSV file with the header date,amount,category,memo"
    )
    import_.set_defaults(run=cmd_import)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)  # usage errors exit with status 2
    if not args.db:
        parser.error("the following arguments are required: --db")
    try:
        args.run(args)
    except LedgerError as exc:
        print(f"{parser.prog}: error: {exc}", file=sys.stderr)
        return exc.status
    return 0


if __name__ == "__main__":
    try:
        status = main()
        sys.stdout.flush()
    except BrokenPipeError:  # output cut short, e.g. `list | head`: stop quietly
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        status = 1
    sys.exit(status)
