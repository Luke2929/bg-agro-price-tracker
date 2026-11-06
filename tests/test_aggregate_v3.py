"""Versioned V3 JSON contract tests (no network, no production writes)."""

from __future__ import annotations

import pytest

from scraper.aggregate_v3 import build_overview, build_history


def observation(priceid, day, market, price, *, variety="KACANG BENDI",
                grade="A", level="Borong", state="PERAK"):
    return {
        "priceid": str(priceid), "tarikh_harga": day,
        "negeri": state, "daerah": "KINTA", "lokasi": market,
        "sublevel": "20", "peringkat": level, "varieti": variety,
        "gred": grade, "unit": "Kilogram", "kategori": "Sayur-Sayuran",
        "harga": str(price),
    }


def test_v3_overview_uses_equal_markets_and_matching_history():
    rows = [
        observation(1, "2026-11-06", "A", "4"),
        observation(2, "2026-11-06", "A", "6"),
        observation(3, "2026-11-06", "B", "10"),
        observation(4, "2026-11-05", "A", "3"),
        observation(5, "2026-11-05", "B", "8"),
    ]
    result = build_overview(rows)
    national = next(p for p in result["prices"] if p["state"] == "")
    assert result["schema"] == "bg-agro/fama-overview/v3"
    assert result["latest_survey_rows"] == 3
    assert national["price"] == 7.5  # A=(4+6)/2, B=10, equal-market mean
    assert national["observations"] == 3
    assert national["markets"] == 2
    assert national["changes"]["1"]["previousDate"] == "2026-11-05"
    assert national["changes"]["1"]["previous"] == 5.5
    assert national["changes"]["1"]["current"] == 7.5
    assert national["changes"]["1"]["eligible"] is False
    assert national["changes"]["7"] is None
    assert national["changes"]["30"] is None
    assert [p["state"] for p in result["prices"]] == ["", "PERAK"]


def test_v3_never_fills_missing_prices_or_mixes_grades():
    rows = [
        observation(1, "2026-11-06", "A", "", grade="A"),
        observation(2, "2026-11-06", "B", "4", grade="B"),
        observation(3, "2026-11-05", "B", "2", grade="A"),
    ]
    result = build_overview(rows)
    assert result["latest_survey_rows"] == 2
    assert result["valid_latest_rows"] == 1
    assert len([p for p in result["prices"] if p["state"] == ""]) == 1
    latest = next(p for p in result["prices"] if p["state"] == "")
    assert latest["gred"] == "B"
    assert latest["changes"]["1"] is None  # prior B-market grade A is different


def test_v3_uses_current_date_of_redated_priceid_without_destroying_archive():
    older = observation(42, "2026-11-05", "A", "2")
    revised = observation(42, "2026-11-06", "A", "3")
    result = build_overview([older, revised])
    assert result["archived_rows"] == 2
    assert result["canonical_rows"] == 1
    assert result["superseded_rows"] == 1
    national = next(p for p in result["prices"] if p["state"] == "")
    assert national["price"] == 3
    assert national["changes"]["1"] is None


def test_v3_rejects_unavailable_survey_day():
    with pytest.raises(ValueError, match="not reported"):
        build_overview([observation(1, "2026-11-06", "A", "2")], "2026-11-04")


def test_v3_history_keeps_actual_dates_and_same_market_weighting():
    rows = [
        observation(1, "2026-09-01", "A", "4"),
        observation(2, "2026-09-01", "A", "6"),
        observation(3, "2026-09-01", "B", "10"),
        observation(4, "2026-11-06", "B", "20"),
    ]
    index, files = build_history(rows)
    assert index["schema"] == "bg-agro/fama-history-index/v3"
    assert len(index["products"]) == 1
    assert len(files) == 1
    history = next(iter(files.values()))
    assert history["schema"] == "bg-agro/fama-history/v3"
    national = [o for o in history["observations"] if not o["state"]]
    assert len(national) == 2  # No invented days between Sept and Nov
    assert national[0] == {
        "date": "2026-09-01", "level": "Borong", "state": "",
        "price": 7.5, "markets": 2, "observations": 3,
    }
    assert national[1]["price"] == 20


def test_v3_history_excludes_redated_prices_and_separates_grade():
    rows = [
        observation(42, "2026-11-05", "A", "999"),
        observation(42, "2026-11-06", "A", "4"),
        observation(43, "2026-11-06", "A", "7", grade="B"),
    ]
    index, files = build_history(rows)
    assert len(index["products"]) == 2
    histories = {item["gred"]: files[item["path"].removeprefix("history/")]
                 for item in index["products"]}
    assert [p["date"] for p in histories["A"]["observations"]] == ["2026-11-06", "2026-11-06"]
    assert {o["price"] for o in histories["A"]["observations"]} == {4}
    assert {o["price"] for o in histories["B"]["observations"]} == {7}
