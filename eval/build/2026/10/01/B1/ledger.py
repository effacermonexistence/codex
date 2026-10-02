#!/usr/bin/env python3
"""Standard-library-only household ledger with JSON persistence."""

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
    """Invalid user input or unusable ledger data."""


def validate_date(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise LedgerError("날짜는 YYYY-MM-DD 형식이어야 합니다")
    try:
        datetime.date.fromisoformat(value)
    except ValueError as exc:
        raise LedgerError("존재하지 않는 날짜입니다") from exc
    return value


def validate_month(value):
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}", value):
        raise LedgerError("월은 YYYY-MM 형식이어야 합니다")
    try:
        datetime.date(int(value[:4]), int(value[5:]), 1)
    except ValueError as exc:
        raise LedgerError("존재하지 않는 월입니다") from exc
    return value


def parse_amount(value):
    if not re.fullmatch(r"[+-]?[0-9]+", value.strip()):
        raise LedgerError("금액은 정수여야 합니다")
    try:
        return int(value)
    except ValueError as exc:
        raise LedgerError("금액은 정수여야 합니다") from exc


def validate_category(value):
    if not isinstance(value, str) or not value.strip():
        raise LedgerError("카테고리는 빈칸일 수 없습니다")
    return value


def parse_id(value):
    if not re.fullmatch(r"[0-9]+", value):
        raise LedgerError("id는 양의 정수여야 합니다")
    try:
        result = int(value)
    except ValueError as exc:
        raise LedgerError("id는 양의 정수여야 합니다") from exc
    if result < 1:
        raise LedgerError("id는 양의 정수여야 합니다")
    return result


def load_database(path):
    try:
        with path.open("r", encoding="utf-8") as handle:
            database = json.load(handle)
    except FileNotFoundError:
        return {"next_id": 1, "entries": []}, False
    except (ValueError, UnicodeError) as exc:
        raise LedgerError("DB가 올바른 UTF-8 JSON 파일이 아닙니다") from exc

    if not isinstance(database, dict):
        raise LedgerError("잘못된 DB: JSON 객체가 필요합니다")
    next_id = database.get("next_id")
    entries = database.get("entries")
    if type(next_id) is not int or next_id < 1 or not isinstance(entries, list):
        raise LedgerError("잘못된 DB: next_id와 entries를 확인하세요")
    seen_ids = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise LedgerError("잘못된 DB: 항목은 JSON 객체여야 합니다")
        entry_id = entry.get("id")
        if type(entry_id) is not int or entry_id < 1 or entry_id in seen_ids:
            raise LedgerError("잘못된 DB: id는 중복 없는 양의 정수여야 합니다")
        if type(entry.get("amount")) is not int or not isinstance(entry.get("memo"), str):
            raise LedgerError("잘못된 DB: amount는 정수, memo는 문자열이어야 합니다")
        try:
            validate_date(entry.get("date"))
            validate_category(entry.get("category"))
        except LedgerError as exc:
            raise LedgerError(f"잘못된 DB: {exc}") from exc
        seen_ids.add(entry_id)
    if seen_ids and next_id <= max(seen_ids):
        raise LedgerError("잘못된 DB: next_id가 기존 id보다 커야 합니다")
    return database, True


def save_database(path, database):
    """Replace the database only after a complete file has been written."""
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent,
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
            try:
                temporary_path.unlink()
            except FileNotFoundError:
                pass


def append_entry(database, date, amount, category, memo):
    entry_id = database["next_id"]
    database["entries"].append({
        "id": entry_id,
        "date": date,
        "amount": amount,
        "category": category,
        "memo": memo,
    })
    database["next_id"] += 1
    return entry_id


def import_csv(path, database):
    imported = 0
    warnings = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle, strict=True)
        try:
            header = next(reader)
        except StopIteration as exc:
            raise LedgerError("CSV 헤더가 없습니다") from exc
        except csv.Error as exc:
            raise LedgerError(f"CSV 헤더 오류: {exc}") from exc
        if header != ["date", "amount", "category", "memo"]:
            raise LedgerError("CSV 헤더는 date,amount,category,memo여야 합니다")
        while True:
            line_number = reader.line_num + 1
            try:
                row = next(reader)
            except StopIteration:
                break
            except csv.Error as exc:
                warnings.append(f"line {line_number}: CSV 형식 오류: {exc}")
                continue
            try:
                if len(row) != 4:
                    raise LedgerError("CSV 열은 date,amount,category,memo의 4개여야 합니다")
                date = validate_date(row[0])
                amount = parse_amount(row[1])
                category = validate_category(row[2])
            except LedgerError as exc:
                warnings.append(f"line {line_number}: {exc}")
                continue
            append_entry(database, date, amount, category, row[3])
            imported += 1
    return imported, warnings


def display_field(value):
    """Keep a list record on one line, even for multiline CSV fields."""
    return value.replace("\t", r"\t").replace("\r", r"\r").replace("\n", r"\n")


def build_parser():
    parser = argparse.ArgumentParser(description="JSON 파일에 저장하는 가계부")
    parser.add_argument("--db", required=True, type=Path, help="가계부 JSON 파일 경로")
    commands = parser.add_subparsers(dest="command", required=True)

    add = commands.add_parser("add", help="항목 추가")
    add.add_argument("date")
    add.add_argument("amount")
    add.add_argument("category")
    add.add_argument("memo", nargs="?", default="")

    listing = commands.add_parser("list", help="항목 조회")
    listing.add_argument("--month")
    listing.add_argument("--category")

    delete = commands.add_parser("delete", help="id로 항목 삭제")
    delete.add_argument("id")

    report = commands.add_parser("report", help="월별 카테고리 합계")
    report.add_argument("--month", required=True)

    importing = commands.add_parser("import", help="CSV 가져오기")
    importing.add_argument("csv_path", type=Path)
    return parser


def execute(args):
    # Validate arguments before creating or modifying the database.
    if args.command == "add":
        validate_date(args.date)
        amount = parse_amount(args.amount)
        validate_category(args.category)
    elif args.command in ("list", "report") and args.month is not None:
        validate_month(args.month)
    elif args.command == "delete":
        entry_id = parse_id(args.id)

    database, exists = load_database(args.db)
    output = []
    warnings = []
    changed = False

    if args.command == "add":
        new_id = append_entry(database, args.date, amount, args.category, args.memo)
        output.append(str(new_id))
        changed = True
    elif args.command == "list":
        entries = sorted(database["entries"], key=lambda entry: (entry["date"], entry["id"]))
        for entry in entries:
            if args.month is not None and entry["date"][:7] != args.month:
                continue
            if args.category is not None and entry["category"] != args.category:
                continue
            output.append("\t".join((
                str(entry["id"]), entry["date"], str(entry["amount"]),
                display_field(entry["category"]), display_field(entry["memo"]),
            )))
    elif args.command == "delete":
        for index, entry in enumerate(database["entries"]):
            if entry["id"] == entry_id:
                del database["entries"][index]
                changed = True
                break
        else:
            raise LedgerError(f"없는 id입니다: {entry_id}")
    elif args.command == "report":
        totals = {}
        for entry in database["entries"]:
            if entry["date"][:7] == args.month:
                category = entry["category"]
                totals[category] = totals.get(category, 0) + entry["amount"]
        for category, total in sorted(totals.items(), key=lambda item: (item[1], item[0])):
            output.append(f"{display_field(category)}\t{total}")
        output.append(f"TOTAL\t{sum(totals.values())}")
    elif args.command == "import":
        imported, warnings = import_csv(args.csv_path, database)
        changed = imported > 0
        output.append(f"imported {imported} skipped {len(warnings)}")

    if changed or not exists:
        save_database(args.db, database)
    for warning in warnings:
        print(warning, file=sys.stderr)
    for line in output:
        print(line)


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        execute(args)
    except (LedgerError, OSError, UnicodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
