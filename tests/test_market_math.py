"""Shared Python/browser parity fixtures for the V3 market price contract."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scraper.market_math import (
    MatchedMarketComparator,
    market_average,
    product_key,
    valid_price,
)

CASES = json.loads(
    (Path(__file__).parent / "fixtures/market_math_v3.json").read_text(encoding="utf-8")
)["cases"]


def as_rows(case: dict) -> list[dict]:
    return [{
        "tarikh_harga": observation["date"],
        "negeri": observation.get("state", "PERAK"),
        "daerah": "KINTA",
        "lokasi": observation["market"],
        "sublevel": "1",
        "varieti": observation.get("product", "KACANG BENDI"),
        "gred": observation.get("grade", "A"),
        "unit": observation.get("unit", "Kilogram"),
        "peringkat": observation.get("level", "Runcit"),
        "harga": observation["price"],
    } for observation in case["observations"]]


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_python_matches_browser_reference_fixtures(case):
    rows = as_rows(case)
    if case["operation"] == "average":
        actual = market_average(rows)
    else:
        actual = MatchedMarketComparator(rows).compare(
            product_key(rows[0]), case["date"], case["days"],
            case.get("level", "Runcit"), case.get("state", "PERAK"),
        )
    expected = case["expected"]
    if expected is None:
        assert actual is None
        return
    assert actual is not None
    for key, value in expected.items():
        if isinstance(value, bool) or isinstance(value, str):
            assert actual[key] == value
        elif isinstance(value, (float, int)):
            assert actual[key] == pytest.approx(value, abs=1e-9)
        else:
            assert actual[key] == value


def test_invalid_prices_are_missing_not_zero():
    assert valid_price("") is None
    assert valid_price(None) is None
    assert valid_price("NaN") is None
    assert valid_price("-2") is None
    assert valid_price("3.45") == 3.45
