#!/usr/bin/env python3
"""A standard-library-only household ledger backed by a JSON file."""

import argparse
import csv
import datetime
import json
import os
from pathlib import Path
import re
import sys
import tempfile


class LedgerError(Exception):
    """An error suitable for a short CLI diagnostic."""


def parse_date(value):
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise argparse.ArgumentTypeError("date must be YYYY-MM-DD")
    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError("date does not exist") from None
    return value


def parse_month(value):
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}", value):
        raise argparse.ArgumentTypeError("month must be YYYY-MM")
    try:
        datetime.date(int(value[:4]), int(value[5:]), 1)
    except ValueError:
        raise argparse.ArgumentTypeError("month does not exist") from None
    return value


def parse_amount(value):
    if not re.fullmatch(r"[+-]?[0-9]+", value):
        raise argparse.ArgumentTypeError("amount must be an integer")
    try:
        return int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("amount must be an integer") from None


def parse_category(value):
    category = value.strip()
    if not category:
        raise argparse.ArgumentTypeError("category must not be blank")
    return category


def parse_id(value):
    try:
        entry_id = parse_amount(value)
    except argparse.ArgumentTypeError:
        raise argparse.ArgumentTypeError("id must be a positive integer") from None
    if entry_id < 1:
        raise argparse.ArgumentTypeError("id must be a positive integer")
    return entry_id


def tsv_text(value):
    """Keep embedded control characters from splitting TSV rows or fields."""
    return value.replace("\t", "\\t").replace("\r", "\\r").replace("\n", "\\n")


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path, help="JSON database path")
    commands = parser.add_subparsers(dest="command", required=True)

    add = commands.add_parser("add", help="add an entry")
    add.add_argument("date", type=parse_date)
    add.add_argument("amount", type=parse_amount)
    add.add_argument("category", type=parse_category)
    add.add_argument("memo", nargs="?", default="")

    listing = commands.add_parser("list", help="list entries")
    listing.add_argument("--month", type=parse_month)
    listing.add_argument("--category", type=parse_category)

    delete = commands.add_parser("delete", help="delete an entry")
    delete.add_argument("id", type=parse_id)

    report = commands.add_parser("report", help="report category totals for a month")
    report.add_argument("--month", required=True, type=parse_month)

    importing = commands.add_parser("import", help="import CSV entries")
    importing.add_argument("csv_path", type=Path)
    return parser


def validate_database(data):
    """Reject corruption instead of silently replacing or repairing saved data."""
    if not isinstance(data, dict):
        raise LedgerError("invalid database: expected a JSON object")
    next_id = data.get("next_id")
    entries = data.get("entries")
    if type(next_id) is not int or next_id < 1 or not isinstance(entries, list):
        raise LedgerError("invalid database: expected next_id and entries")

    ids = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise LedgerError("invalid database: entry must be an object")
        entry_id = entry.get("id")
        if type(entry_id) is not int or entry_id < 1 or entry_id in ids:
            raise LedgerError("invalid database: invalid or duplicate id")
        if type(entry.get("amount")) is not int:
            raise LedgerError("invalid database: amount must be an integer")
        if any(not isinstance(entry.get(field), str)
               for field in ("date", "category", "memo")):
            raise LedgerError("invalid database: entry text fields must be strings")
        try:
            parse_date(entry["date"])
            parse_category(entry["category"])
        except argparse.ArgumentTypeError as error:
            raise LedgerError("invalid database: {}".format(error)) from None
        ids.add(entry_id)
    if ids and next_id <= max(ids):
        raise LedgerError("invalid database: next_id must exceed all existing ids")


def load_database(path):
    try:
        with path.open("r", encoding="utf-8") as source:
            data = json.load(source)
    except FileNotFoundError:
        return {"next_id": 1, "entries": []}, True
    except (ValueError, UnicodeError) as error:
        raise LedgerError("invalid database: {}".format(error)) from None
    validate_database(data)
    return data, False


def save_database(path, data):
    """Write in the same directory and atomically replace the previous file."""
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=str(path.parent),
            prefix=".ledger-", suffix=".tmp", delete=False
        ) as destination:
            temporary_path = Path(destination.name)
            json.dump(data, destination, ensure_ascii=False, indent=2)
            destination.write("\n")
            destination.flush()
            os.fsync(destination.fileno())
        os.replace(str(temporary_path), str(path))
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def add_entry(data, date, amount, category, memo):
    entry_id = data["next_id"]
    data["entries"].append({
        "id": entry_id, "date": date, "amount": amount,
        "category": category, "memo": memo,
    })
    data["next_id"] += 1
    return entry_id


def import_csv(path, data):
    imported = skipped = 0
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.reader(source, strict=True)
        if next(reader, None) != ["date", "amount", "category", "memo"]:
            raise LedgerError("CSV header must be date,amount,category,memo")
        while True:
            # line_num counts physical lines consumed, including quoted newlines.
            line_number = reader.line_num + 1
            row = next(reader, None)
            if row is None:
                break
            try:
                if len(row) != 4:
                    raise argparse.ArgumentTypeError("expected 4 CSV fields")
                date = parse_date(row[0])
                amount = parse_amount(row[1])
                category = parse_category(row[2])
            except argparse.ArgumentTypeError as error:
                print("line {}: {}".format(line_number, error), file=sys.stderr)
                skipped += 1
                continue
            add_entry(data, date, amount, category, row[3])
            imported += 1
    return imported, skipped


def execute(args):
    data, missing = load_database(args.db)
    if args.command == "add":
        entry_id = add_entry(data, args.date, args.amount, args.category, args.memo)
        save_database(args.db, data)
        print(entry_id)
    elif args.command == "delete":
        for index, entry in enumerate(data["entries"]):
            if entry["id"] == args.id:
                del data["entries"][index]
                save_database(args.db, data)
                break
        else:
            raise LedgerError("id {} does not exist".format(args.id))
    elif args.command == "list":
        if missing:
            save_database(args.db, data)
        entries = sorted(data["entries"], key=lambda entry: (entry["date"], entry["id"]))
        for entry in entries:
            if args.month is not None and entry["date"][:7] != args.month:
                continue
            if args.category is not None and entry["category"] != args.category:
                continue
            print("{}\t{}\t{}\t{}\t{}".format(
                entry["id"], entry["date"], entry["amount"],
                tsv_text(entry["category"]), tsv_text(entry["memo"]),
            ))
    elif args.command == "report":
        if missing:
            save_database(args.db, data)
        totals = {}
        for entry in data["entries"]:
            if entry["date"][:7] == args.month:
                category = entry["category"]
                totals[category] = totals.get(category, 0) + entry["amount"]
        for category, total in sorted(totals.items(), key=lambda pair: (pair[1], pair[0])):
            print("{}\t{}".format(tsv_text(category), total))
        print("TOTAL\t{}".format(sum(totals.values())))
    elif args.command == "import":
        imported, skipped = import_csv(args.csv_path, data)
        save_database(args.db, data)
        print("imported {} skipped {}".format(imported, skipped))


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        execute(args)
    except (LedgerError, OSError, UnicodeError, csv.Error, ValueError) as error:
        print("error: {}".format(error), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
