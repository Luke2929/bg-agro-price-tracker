"""No-network checks for BG Agro V3's original-history safety gate."""

from __future__ import annotations

import csv
from pathlib import Path
import subprocess

import pytest

from scraper.scrape import CSV_COLUMNS
from scripts.archive_guard import (
    ArchiveIntegrityError,
    assert_preserved,
    audit_archive,
)


def _write_day(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for row in rows:
            writer.writerow({**dict.fromkeys(CSV_COLUMNS, ""), **row})


def _row(priceid: str, date: str = "2026-11-06", **fields) -> dict:
    return {"priceid": priceid, "tarikh_harga": date, **fields}


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)


def _versioned_archive(tmp_path: Path) -> Path:
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "config", "user.email", "archive-test@example.invalid")
    _git(tmp_path, "config", "user.name", "Archive test")
    daily = tmp_path / "data/daily"
    _write_day(daily / "2026-11-06.csv", [
        _row("100", harga="2.30"),
        _row("101", harga="", average14="4.20"),
    ])
    _git(tmp_path, "add", "data/daily")
    _git(tmp_path, "commit", "-qm", "baseline archive")
    return daily


def test_full_archive_audit_allows_blank_price_and_non_reported_days(tmp_path):
    daily = tmp_path / "data/daily"
    _write_day(daily / "2026-11-04.csv", [_row("1", date="2026-11-04", harga="")])
    _write_day(daily / "2026-11-06.csv", [_row("2", harga="0.50")])

    result = audit_archive(daily)
    assert (result.files, result.rows, result.first_date, result.last_date) == (
        2, 2, "2026-11-04", "2026-11-06",
    )


@pytest.mark.parametrize("rows,part", [
    ([_row("1", date="2026-11-05")], "does not match"),
    ([_row("1"), _row("1")], "duplicate priceid"),
    ([_row("")], "empty priceid"),
    ([_row("1", harga="NaN")], "non-finite"),
    ([_row("1", harga="bad")], "invalid harga"),
])
def test_archive_rejects_malformed_rows(tmp_path, rows, part):
    daily = tmp_path / "data/daily"
    _write_day(daily / "2026-11-06.csv", rows)
    with pytest.raises(ArchiveIntegrityError, match=part):
        audit_archive(daily)


def test_archive_rejects_missing_header_field(tmp_path):
    daily = tmp_path / "data/daily"
    daily.mkdir(parents=True)
    (daily / "2026-11-06.csv").write_text("priceid,tarikh_harga\n1,2026-11-06\n")
    with pytest.raises(ArchiveIntegrityError, match="17 original FAMA fields"):
        audit_archive(daily)


def test_archive_rejects_non_date_filename(tmp_path):
    daily = tmp_path / "data/daily"
    _write_day(daily / "latest.csv", [_row("1")])
    with pytest.raises(ArchiveIntegrityError, match="Unexpected archive filename"):
        audit_archive(daily)


def test_preservation_allows_additions_and_price_corrections(tmp_path):
    daily = _versioned_archive(tmp_path)
    _write_day(daily / "2026-11-06.csv", [
        _row("100", harga="2.50"),
        _row("101", harga="", average14="4.20"),
        _row("102", harga="1.00"),
    ])
    _write_day(daily / "2026-11-07.csv", [_row("103", date="2026-11-07", harga="1")])

    assert audit_archive(daily).rows == 4
    assert assert_preserved(daily, tmp_path, "HEAD") == 1


def test_preservation_rejects_missing_historical_priceid(tmp_path):
    daily = _versioned_archive(tmp_path)
    _write_day(daily / "2026-11-06.csv", [_row("101", average14="4.20")])
    with pytest.raises(ArchiveIntegrityError, match="historical priceid"):
        assert_preserved(daily, tmp_path, "HEAD")


def test_preservation_rejects_deleted_historical_csv(tmp_path):
    daily = _versioned_archive(tmp_path)
    (daily / "2026-11-06.csv").unlink()
    with pytest.raises(ArchiveIntegrityError, match="Historical CSV deleted"):
        assert_preserved(daily, tmp_path, "HEAD")
