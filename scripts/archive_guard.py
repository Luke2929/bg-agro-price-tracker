"""Validate FAMA's 17-field raw CSV contract and guard against lost history.

This module never rewrites source data. In GitHub Actions we compare the working
archive to ``HEAD`` *before* committing a scrape. Legitimate FAMA corrections can
change values, but an older priceid may never silently disappear from a daily
archive, nor may a historical CSV file be deleted.

Usage:

    python -m scripts.archive_guard --against-ref HEAD
    python -m scripts.archive_guard --data-dir /path/to/data/daily
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from io import StringIO
from pathlib import Path
import re
import subprocess

from scraper.scrape import CSV_COLUMNS

ROOT = Path(__file__).resolve().parents[1]
DAY_FILE = re.compile(r"^\d{4}-\d{2}-\d{2}\.csv$")


class ArchiveIntegrityError(ValueError):
    """Source archive is malformed or an older observation was dropped."""


@dataclass(frozen=True)
class ArchiveSummary:
    files: int
    rows: int
    first_date: str
    last_date: str


def _run_git(repo_root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=repo_root, text=True, capture_output=True, check=False,
    )
    if result.returncode:
        raise ArchiveIntegrityError(
            f"git {' '.join(args)} failed: {result.stderr.strip()}"
        )
    return result.stdout


def _checked_date(filename: str) -> str:
    if not DAY_FILE.fullmatch(filename):
        raise ArchiveIntegrityError(f"Unexpected archive filename: {filename}")
    stem = filename[:-4]
    try:
        date.fromisoformat(stem)
    except ValueError as exc:
        raise ArchiveIntegrityError(f"Invalid archive date: {filename}") from exc
    return stem


def _read_ids(reader: csv.DictReader, source: str, expected_date: str) -> tuple[int, set[str]]:
    if reader.fieldnames != CSV_COLUMNS:
        raise ArchiveIntegrityError(
            f"{source}: expected 17 original FAMA fields in order, "
            f"got {reader.fieldnames!r}"
        )

    count = 0
    seen: set[str] = set()
    for line, row in enumerate(reader, start=2):
        if None in row:
            raise ArchiveIntegrityError(f"{source}:{line}: extra CSV columns")
        priceid = (row.get("priceid") or "").strip()
        if not priceid:
            raise ArchiveIntegrityError(f"{source}:{line}: empty priceid")
        if priceid in seen:
            raise ArchiveIntegrityError(f"{source}:{line}: duplicate priceid {priceid}")
        if row.get("tarikh_harga") != expected_date:
            raise ArchiveIntegrityError(
                f"{source}:{line}: survey date {row.get('tarikh_harga')!r} "
                f"does not match {expected_date}"
            )
        for field in ("harga", "average14"):
            value = (row.get(field) or "").strip()
            if value:
                try:
                    valid = Decimal(value)
                except InvalidOperation as exc:
                    raise ArchiveIntegrityError(
                        f"{source}:{line}: invalid {field}={value!r}"
                    ) from exc
                if not valid.is_finite():
                    raise ArchiveIntegrityError(
                        f"{source}:{line}: non-finite {field}={value!r}"
                    )
        seen.add(priceid)
        count += 1
    return count, seen


def audit_archive(data_dir: Path) -> ArchiveSummary:
    """Streaming CSV check, allowing legitimate blank prices and missing dates."""
    data_dir = Path(data_dir)
    files = sorted(data_dir.glob("*.csv"))
    if not files:
        raise ArchiveIntegrityError(f"No FAMA daily CSVs in {data_dir}")
    total = 0
    dates: list[str] = []
    for path in files:
        survey_date = _checked_date(path.name)
        with path.open(encoding="utf-8", newline="") as handle:
            count, _ = _read_ids(csv.DictReader(handle), str(path), survey_date)
        if not count:
            raise ArchiveIntegrityError(f"{path}: empty daily CSV")
        total += count
        dates.append(survey_date)
    return ArchiveSummary(len(files), total, dates[0], dates[-1])


def assert_preserved(data_dir: Path, repo_root: Path, against_ref: str) -> int:
    """Assert every baseline CSV and priceid survives an in-progress scrape.

    Only modified baseline files need their previous rows inspected; for all
    other files, tracking the existing paths suffices. No remote/network calls.
    """
    data_dir = Path(data_dir).resolve()
    repo_root = Path(repo_root).resolve()
    rel_dir = data_dir.relative_to(repo_root).as_posix()
    previous = set(_run_git(repo_root, "ls-tree", "-r", "--name-only", against_ref, "--", rel_dir).splitlines())
    if not previous:
        raise ArchiveIntegrityError(f"No baseline archive files in {against_ref}:{rel_dir}")
    missing_files = sorted(path for path in previous if not (repo_root / path).is_file())
    if missing_files:
        raise ArchiveIntegrityError(f"Historical CSV deleted: {missing_files[:5]}")

    changed = set(_run_git(repo_root, "diff", "--name-only", against_ref, "--", rel_dir).splitlines())
    compared = 0
    for rel_path in sorted(previous & changed):
        survey_date = _checked_date(Path(rel_path).name)
        old_data = _run_git(repo_root, "show", f"{against_ref}:{rel_path}")
        _, old_ids = _read_ids(csv.DictReader(StringIO(old_data)), f"{against_ref}:{rel_path}", survey_date)
        with (repo_root / rel_path).open(encoding="utf-8", newline="") as handle:
            _, current_ids = _read_ids(csv.DictReader(handle), rel_path, survey_date)
        missing_ids = old_ids - current_ids
        if missing_ids:
            raise ArchiveIntegrityError(
                f"{rel_path}: {len(missing_ids)} historical priceid(s) were removed, "
                f"for example {sorted(missing_ids)[:5]}"
            )
        compared += 1
    return compared


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Audit original FAMA archive before publishing")
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data/daily")
    parser.add_argument("--against-ref", default=None, help="Git ref whose archive must be preserved")
    args = parser.parse_args(argv)
    summary = audit_archive(args.data_dir)
    print(
        "FAMA original archive verified: "
        f"{summary.files} files, {summary.rows:,} rows, "
        f"{summary.first_date} .. {summary.last_date}"
    )
    if args.against_ref:
        changed = assert_preserved(args.data_dir, ROOT, args.against_ref)
        print(f"Preservation against {args.against_ref}: {changed} historical CSV(s) checked, none lost")


if __name__ == "__main__":
    main()
