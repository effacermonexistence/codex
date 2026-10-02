#!/usr/bin/env python3
"""A standard-library-only ledger with persistent, never-reused integer IDs."""

import argparse
import csv
import datetime
import json
import os
from pathlib import Path
import re
import sys
import tempfile


class LedgerError(ValueError):
    """An input or database error that should exit with status 2."""


def valid_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise LedgerError("date must use YYYY-MM-DD")
    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        raise LedgerError("date does not exist: {}".format(value)) from None
    return value


def valid_month(value):
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}", value):
        raise LedgerError("month must use YYYY-MM")
    try:
        datetime.date.fromisoformat(value + "-01")
    except ValueError:
        raise LedgerError("month does not exist: {}".format(value)) from None
    return value


def integer(value):
    # int() alone also accepts underscores and non-ASCII digits.
    if not re.fullmatch(r"[+-]?[0-9]+", value.strip()):
        raise LedgerError("amount/id must be an integer")
    try:
        return int(value)
    except ValueError:
        raise LedgerError("amount/id must be an integer") from None


def valid_category(value):
    if not isinstance(value, str) or not value.strip():
        raise LedgerError("category must not be blank")
    return value


def argument_type(validator):
    def parse(value):
        try:
            return validator(value)
        except LedgerError as exc:
            raise argparse.ArgumentTypeError(str(exc)) from None
    return parse


def parser():
    result = argparse.ArgumentParser(description="JSON household ledger (amounts in won)")
    result.add_argument("--db", required=True, type=Path, help="JSON database path")
    commands = result.add_subparsers(dest="command", required=True)

    add = commands.add_parser("add", help="add a transaction; print its new ID")
    add.add_argument("date", type=argument_type(valid_date))
    add.add_argument("amount", type=argument_type(integer))
    add.add_argument("category", type=argument_type(valid_category))
    add.add_argument("memo", nargs="?", default="")

    listing = commands.add_parser("list", help="list matching transactions as TSV")
    listing.add_argument("--month", type=argument_type(valid_month))
    listing.add_argument("--category", type=argument_type(valid_category))

    delete = commands.add_parser("delete", help="delete a transaction")
    delete.add_argument("id", type=argument_type(integer))

    report = commands.add_parser("report", help="monthly category totals")
    report.add_argument("--month", required=True, type=argument_type(valid_month))

    importing = commands.add_parser("import", help="import date,amount,category,memo CSV")
    importing.add_argument("csv_path", type=Path)
    return result


def load_database(path):
    try:
        with path.open("r", encoding="utf-8") as handle:
            database = json.load(handle)
    except FileNotFoundError:
        return {"next_id": 1, "entries": []}, True
    except (json.JSONDecodeError, UnicodeError) as exc:
        raise LedgerError("invalid database: {}".format(exc)) from None

    # Fail without overwriting a corrupt database or guessing its previous IDs.
    if not isinstance(database, dict):
        raise LedgerError("invalid database: expected an object")
    next_id = database.get("next_id")
    entries = database.get("entries")
    if type(next_id) is not int or next_id < 1 or not isinstance(entries, list):
        raise LedgerError("invalid database: expected next_id and entries")
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise LedgerError("invalid database: entry must be an object")
        entry_id = entry.get("id")
        if type(entry_id) is not int or entry_id < 1 or entry_id in seen:
            raise LedgerError("invalid database: invalid or duplicate ID")
        if entry_id >= next_id:
            raise LedgerError("invalid database: next_id must exceed every existing ID")
        if type(entry.get("amount")) is not int or not isinstance(entry.get("memo"), str):
            raise LedgerError("invalid database: invalid amount or memo")
        try:
            valid_date(entry.get("date"))
            valid_category(entry.get("category"))
        except LedgerError as exc:
            raise LedgerError("invalid database: {}".format(exc)) from None
        seen.add(entry_id)
    return database, False


def save_database(path, database):
    """Replace only after a complete JSON write, leaving the old file on failure."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".ledger-", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(database, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def append_entry(database, date, amount, category, memo):
    entry_id = database["next_id"]
    database["entries"].append({
        "id": entry_id, "date": date, "amount": amount,
        "category": category, "memo": memo,
    })
    database["next_id"] += 1
    return entry_id


def tsv(value):
    """Keep every output record on one line, even for quoted multiline CSV."""
    return str(value).replace("\t", "\\t").replace("\r", "\\r").replace("\n", "\\n")


def import_csv(path, database):
    imported = skipped = 0
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle, strict=True)
        try:
            header = next(reader)
        except (StopIteration, csv.Error) as exc:
            raise LedgerError("CSV header must be date,amount,category,memo") from exc
        if header != ["date", "amount", "category", "memo"]:
            raise LedgerError("CSV header must be date,amount,category,memo")
        while True:
            start_line = reader.line_num + 1
            try:
                row = next(reader)
            except StopIteration:
                break
            except csv.Error as exc:
                skipped += 1
                print("line {}: invalid CSV: {}".format(start_line, exc), file=sys.stderr)
                continue
            try:
                if len(row) != 4:
                    raise LedgerError("expected 4 columns, got {}".format(len(row)))
                date = valid_date(row[0])
                amount = integer(row[1])
                category = valid_category(row[2])
            except LedgerError as exc:
                skipped += 1
                print("line {}: {}".format(start_line, exc), file=sys.stderr)
                continue
            append_entry(database, date, amount, category, row[3])
            imported += 1
    return imported, skipped


def run(args):
    database, is_new = load_database(args.db)
    entries = database["entries"]
    if args.command == "add":
        entry_id = append_entry(database, args.date, args.amount, args.category, args.memo)
        save_database(args.db, database)
        print(entry_id)
    elif args.command == "delete":
        for index, entry in enumerate(entries):
            if entry["id"] == args.id:
                del entries[index]
                save_database(args.db, database)
                break
        else:
            raise LedgerError("ID not found: {}".format(args.id))
    elif args.command == "import":
        imported, skipped = import_csv(args.csv_path, database)
        save_database(args.db, database)
        print("imported {} skipped {}".format(imported, skipped))
    elif args.command == "list":
        if is_new:
            save_database(args.db, database)
        for entry in sorted(entries, key=lambda item: (item["date"], item["id"])):
            if args.month is not None and not entry["date"].startswith(args.month + "-"):
                continue
            if args.category is not None and entry["category"] != args.category:
                continue
            print("\t".join(tsv(entry[key]) for key in ("id", "date", "amount", "category", "memo")))
    elif args.command == "report":
        if is_new:
            save_database(args.db, database)
        totals = {}
        for entry in entries:
            if entry["date"].startswith(args.month + "-"):
                category = entry["category"]
                totals[category] = totals.get(category, 0) + entry["amount"]
        for category, total in sorted(totals.items(), key=lambda item: (item[1], item[0])):
            print("{}\t{}".format(tsv(category), total))
        print("TOTAL\t{}".format(sum(totals.values())))


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        run(args)
    except (LedgerError, OSError, UnicodeError) as exc:
        print("error: {}".format(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
