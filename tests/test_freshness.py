"""Freshness checks distinguish survey dates from successful scraper runs."""

import csv
import json
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from scripts.check_freshness import assess_freshness, audit


MYT = ZoneInfo("Asia/Kuala_Lumpur")


@pytest.mark.parametrize(
    ("latest", "hour", "expected"),
    [
        ("2026-11-04", 10, ("current", 0)),
        ("2026-11-03", 10, ("pending", 1)),
        ("2026-11-03", 14, ("delayed", 1)),
        ("2026-11-02", 9, ("older", 2)),
    ],
)
def test_freshness_uses_malaysia_calendar(latest, hour, expected):
    now = datetime(2026, 11, 4, hour, 30, tzinfo=MYT)
    assert assess_freshness(latest, now) == expected


def test_freshness_handles_utc_boundary():
    now = datetime.fromisoformat("2026-11-03T17:00:00+00:00")
    assert assess_freshness("2026-11-04", now) == ("current", 0)


def test_audit_counts_only_latest_date(tmp_path):
    meta = tmp_path / "meta.json"
    meta.write_text(json.dumps({"window": {"max": "2026-11-03"}}), encoding="utf-8")
    daily = tmp_path / "daily"
    daily.mkdir()
    with (daily / "2026-11-03.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["tarikh_harga", "harga"])
        writer.writerow(["2026-11-03", "4.20"])
        writer.writerow(["2026-11-03", "5.10"])
    result = audit(meta, daily, datetime(2026, 11, 4, 15, tzinfo=MYT))
    assert result["latest_survey_rows"] == 2
    assert result["status"] == "delayed"


def test_audit_rejects_missing_price_file(tmp_path):
    meta = tmp_path / "meta.json"
    meta.write_text(json.dumps({"window": {"max": "2026-11-03"}}), encoding="utf-8")
    with pytest.raises(FileNotFoundError):
        audit(meta, tmp_path, datetime(2026, 11, 4, tzinfo=MYT))
