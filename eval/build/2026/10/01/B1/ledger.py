#!/usr/bin/env python3
"""A standard-library-only, JSON-backed household ledger CLI."""

import argparse
import csv
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from datetime import date


CSV_HEADER = ["date", "amount", "category", "memo"]


class LedgerError(Exception):
    """An input or storage error that should exit with status 2."""


def validate_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise LedgerError("invalid date: expected a real date in YYYY-MM-DD format")
    try:
        date.fromisoformat(value)
    except ValueError:
        raise LedgerError("invalid date: expected a real date in YYYY-MM-DD format") from None
    return value


def validate_month(value):
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}", value):
        raise LedgerError("invalid month: expected YYYY-MM")
    try:
        date.fromisoformat(value + "-01")
    except ValueError:
        raise LedgerError("invalid month: expected YYYY-MM") from None
    return value


def parse_integer(value, label):
    if not re.fullmatch(r"[+-]?[0-9]+", value):
        raise LedgerError(f"{label} must be an integer")
    try:
        return int(value)
    except ValueError:
        raise LedgerError(f"{label} must be an integer") from None


def make_entry(entry_date, amount, category, memo):
    validate_date(entry_date)
    amount = parse_integer(amount, "amount")
    if not category.strip():
        raise LedgerError("category must not be blank")
    return {"date": entry_date, "amount": amount, "category": category, "memo": memo}


def load_database(path):
    try:
        with path.open(encoding="utf-8") as handle:
            database = json.load(handle)
    except FileNotFoundError:
        return {"next_id": 1, "entries": []}, True
    except (json.JSONDecodeError, UnicodeError) as error:
        raise LedgerError(f"invalid database: {error}") from None

    if not isinstance(database, dict):
        raise LedgerError("invalid database: expected a JSON object")
    next_id = database.get("next_id")
    entries = database.get("entries")
    if type(next_id) is not int or next_id < 1 or not isinstance(entries, list):
        raise LedgerError("invalid database: expected a positive next_id and an entries list")

    seen_ids = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise LedgerError("invalid database: each entry must be an object")
        entry_id = entry.get("id")
        if type(entry_id) is not int or not 1 <= entry_id < next_id or entry_id in seen_ids:
            raise LedgerError("invalid database: duplicate or inconsistent entry id")
        seen_ids.add(entry_id)
        try:
            validate_date(entry.get("date"))
        except LedgerError as error:
            raise LedgerError(f"invalid database: {error}") from None
        if type(entry.get("amount")) is not int:
            raise LedgerError("invalid database: amount must be an integer")
        if not isinstance(entry.get("category"), str) or not entry["category"].strip():
            raise LedgerError("invalid database: category must not be blank")
        if not isinstance(entry.get("memo"), str):
            raise LedgerError("invalid database: memo must be a string")
    return database, False


def save_database(path, database):
    """Replace the file atomically so a failed write cannot truncate the ledger."""
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="\n", dir=path.parent,
            prefix=f".{path.name}.", suffix=".tmp", delete=False,
        ) as handle:
            temporary_path = Path(handle.name)
            json.dump(database, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def append_entry(database, entry):
    entry_id = database["next_id"]
    database["entries"].append({"id": entry_id, **entry})
    database["next_id"] += 1
    return entry_id


def import_csv(path, database):
    imported = skipped = 0
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle, strict=True)
        if next(reader, None) != CSV_HEADER:
            raise LedgerError("CSV header must be date,amount,category,memo")
        while True:
            # Use the record's physical starting line, including multiline CSV fields.
            line_number = reader.line_num + 1
            row = next(reader, None)
            if row is None:
                break
            try:
                if len(row) != 4:
                    raise LedgerError("expected four columns: date,amount,category,memo")
                entry = make_entry(*row)
            except LedgerError as error:
                print(f"line {line_number}: {error}", file=sys.stderr)
                skipped += 1
                continue
            append_entry(database, entry)
            imported += 1
    return imported, skipped


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path, help="JSON database path")
    commands = parser.add_subparsers(dest="command", required=True)

    add = commands.add_parser("add", help="add an income or expense")
    add.add_argument("date")
    add.add_argument("amount")
    add.add_argument("category")
    add.add_argument("memo", nargs="?", default="")

    listing = commands.add_parser("list", help="list entries sorted by date and id")
    listing.add_argument("--month")
    listing.add_argument("--category")

    delete = commands.add_parser("delete", help="delete an existing entry")
    delete.add_argument("id")

    report = commands.add_parser("report", help="report category totals for a month")
    report.add_argument("--month", required=True)

    importing = commands.add_parser("import", help="import date,amount,category,memo CSV")
    importing.add_argument("csv_path", type=Path)
    return parser


def execute(args):
    # Reject invalid command input before creating or modifying the database.
    entry = None
    entry_id = None
    if args.command == "add":
        entry = make_entry(args.date, args.amount, args.category, args.memo)
    elif args.command in ("list", "report") and args.month is not None:
        validate_month(args.month)
    elif args.command == "delete":
        entry_id = parse_integer(args.id, "id")

    database, is_new = load_database(args.db)

    if args.command == "add":
        entry_id = append_entry(database, entry)
        save_database(args.db, database)
        print(entry_id)
    elif args.command == "delete":
        remaining = [entry for entry in database["entries"] if entry["id"] != entry_id]
        if len(remaining) == len(database["entries"]):
            raise LedgerError(f"unknown id: {entry_id}")
        database["entries"] = remaining
        save_database(args.db, database)
    elif args.command == "import":
        imported, skipped = import_csv(args.csv_path, database)
        save_database(args.db, database)
        print(f"imported {imported} skipped {skipped}")
    else:
        if is_new:
            save_database(args.db, database)
        entries = database["entries"]
        if args.month is not None:
            entries = [entry for entry in entries if entry["date"].startswith(args.month + "-")]
        if args.command == "list":
            if args.category is not None:
                entries = [entry for entry in entries if entry["category"] == args.category]
            for entry in sorted(entries, key=lambda item: (item["date"], item["id"])):
                print("\t".join(str(entry[key]) for key in ("id", "date", "amount", "category", "memo")))
        else:
            totals = {}
            for entry in entries:
                totals[entry["category"]] = totals.get(entry["category"], 0) + entry["amount"]
            for category, total in sorted(totals.items(), key=lambda item: (item[1], item[0])):
                print(f"{category}\t{total}")
            print(f"TOTAL\t{sum(totals.values())}")


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        execute(args)
    except (LedgerError, OSError, UnicodeError, csv.Error) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
