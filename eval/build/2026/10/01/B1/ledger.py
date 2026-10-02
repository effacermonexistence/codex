#!/usr/bin/env python3
"""A standard-library-only household ledger backed by a JSON file."""

from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from datetime import date


class LedgerError(ValueError):
    """An input or storage error suitable for displaying without a traceback."""


def valid_date(value: str) -> str:
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise LedgerError("invalid date: expected YYYY-MM-DD")
    try:
        date.fromisoformat(value)
    except ValueError:
        raise LedgerError("invalid date: date does not exist") from None
    return value


def valid_month(value: str) -> str:
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}", value):
        raise LedgerError("invalid month: expected YYYY-MM")
    try:
        date(int(value[:4]), int(value[5:]), 1)
    except ValueError:
        raise LedgerError("invalid month: month does not exist") from None
    return value


def valid_amount(value: str) -> int:
    value = value.strip()
    if not re.fullmatch(r"[+-]?[0-9]+", value):
        raise LedgerError("invalid amount: expected an integer")
    try:
        return int(value)
    except ValueError:
        raise LedgerError("invalid amount: integer is too long") from None


def valid_category(value: str) -> str:
    value = value.strip()
    if not value:
        raise LedgerError("category must not be empty")
    return value


def valid_id(value: str) -> int:
    if not re.fullmatch(r"[0-9]+", value):
        raise LedgerError("invalid id: expected a positive integer")
    try:
        result = int(value)
    except ValueError:
        raise LedgerError("invalid id: integer is too long") from None
    if result < 1:
        raise LedgerError("invalid id: expected a positive integer")
    return result


def argument_type(validator):
    def parse(value):
        try:
            return validator(value)
        except LedgerError as exc:
            raise argparse.ArgumentTypeError(str(exc)) from None

    return parse


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path, help="ledger JSON path")
    commands = parser.add_subparsers(dest="command", required=True)

    add = commands.add_parser("add", help="add an entry")
    add.add_argument("date", type=argument_type(valid_date))
    add.add_argument("amount", type=argument_type(valid_amount))
    add.add_argument("category", type=argument_type(valid_category))
    add.add_argument("memo", nargs="?", default="")

    listing = commands.add_parser("list", help="list entries")
    listing.add_argument("--month", type=argument_type(valid_month))
    listing.add_argument("--category", type=argument_type(valid_category))

    delete = commands.add_parser("delete", help="delete an entry")
    delete.add_argument("id", type=argument_type(valid_id))

    report = commands.add_parser("report", help="report category totals")
    report.add_argument("--month", required=True, type=argument_type(valid_month))

    importing = commands.add_parser("import", help="import entries from CSV")
    importing.add_argument("csv_path", type=Path)
    return parser


def load_database(path: Path) -> dict:
    try:
        with path.open(encoding="utf-8") as source:
            database = json.load(source)
    except FileNotFoundError:
        return {"next_id": 1, "entries": []}
    except (json.JSONDecodeError, UnicodeError) as exc:
        raise LedgerError(f"invalid database JSON: {exc}") from None

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
        if type(entry_id) is not int or not 0 < entry_id < next_id or entry_id in seen:
            raise LedgerError("invalid database: duplicate or invalid entry id")
        if type(entry.get("amount")) is not int:
            raise LedgerError("invalid database: amount must be an integer")
        if any(not isinstance(entry.get(key), str) for key in ("date", "category", "memo")):
            raise LedgerError("invalid database: date, category and memo must be strings")
        try:
            valid_date(entry["date"])
            valid_category(entry["category"])
        except LedgerError as exc:
            raise LedgerError(f"invalid database: {exc}") from None
        seen.add(entry_id)
    return database


def save_database(path: Path, database: dict) -> None:
    """Replace the database atomically so failed writes do not truncate it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent,
            prefix=f".{path.name}.", suffix=".tmp", delete=False,
        ) as output:
            temporary = Path(output.name)
            json.dump(database, output, ensure_ascii=False, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def add_entry(database: dict, entry_date: str, amount: int, category: str, memo: str) -> int:
    entry_id = database["next_id"]
    database["entries"].append({
        "id": entry_id, "date": entry_date, "amount": amount,
        "category": category, "memo": memo,
    })
    database["next_id"] += 1
    return entry_id


def import_csv(database: dict, path: Path) -> tuple:
    imported = skipped = 0
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.reader(source, strict=True)
        try:
            header = next(reader)
        except (StopIteration, csv.Error):
            raise LedgerError("invalid CSV header: expected date,amount,category,memo") from None
        if header != ["date", "amount", "category", "memo"]:
            raise LedgerError("invalid CSV header: expected date,amount,category,memo")

        while True:
            line_number = reader.line_num + 1
            try:
                row = next(reader)
            except StopIteration:
                break
            except csv.Error as exc:
                skipped += 1
                print(f"line {line_number}: invalid CSV: {exc}", file=sys.stderr)
                continue

            try:
                if len(row) != 4:
                    raise LedgerError("expected 4 CSV fields")
                entry_date = valid_date(row[0])
                amount = valid_amount(row[1])
                category = valid_category(row[2])
            except LedgerError as exc:
                skipped += 1
                print(f"line {line_number}: {exc}", file=sys.stderr)
                continue
            add_entry(database, entry_date, amount, category, row[3])
            imported += 1
    return imported, skipped


def execute(args: argparse.Namespace) -> None:
    database = load_database(args.db)
    entries = database["entries"]
    result = []
    changed = False

    if args.command == "add":
        result.append(str(add_entry(database, args.date, args.amount, args.category, args.memo)))
        changed = True
    elif args.command == "delete":
        remaining = [entry for entry in entries if entry["id"] != args.id]
        if len(remaining) == len(entries):
            raise LedgerError(f"id {args.id} does not exist")
        database["entries"] = remaining
        changed = True
    elif args.command == "list":
        selected = (
            entry for entry in entries
            if (args.month is None or entry["date"].startswith(args.month + "-"))
            and (args.category is None or entry["category"] == args.category)
        )
        for entry in sorted(selected, key=lambda item: (item["date"], item["id"])):
            result.append("\t".join(str(entry[key]) for key in ("id", "date", "amount", "category", "memo")))
    elif args.command == "report":
        totals = {}
        for entry in entries:
            if entry["date"].startswith(args.month + "-"):
                category = entry["category"]
                totals[category] = totals.get(category, 0) + entry["amount"]
        for category, total in sorted(totals.items(), key=lambda item: (item[1], item[0])):
            result.append(f"{category}\t{total}")
        result.append(f"TOTAL\t{sum(totals.values())}")
    elif args.command == "import":
        imported, skipped = import_csv(database, args.csv_path)
        result.append(f"imported {imported} skipped {skipped}")
        changed = imported > 0

    if changed or not args.db.exists():
        save_database(args.db, database)
    for line in result:
        print(line)


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        execute(args)
    except (LedgerError, OSError, UnicodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
