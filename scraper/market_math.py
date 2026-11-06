"""V3 reference implementation of the Dashboard's matched-market Algorithm V2.

Do not substitute legacy row-weighted ``site/data/series`` averages for these
values. This module deliberately mirrors the browser comparison contract so
both implementations can be validated against the same versioned fixtures
before any generated JSON API is migrated.
"""

from __future__ import annotations

from datetime import date, timedelta
import math


def _text(value: object) -> str:
    return "" if value is None else str(value)


def valid_price(raw: object) -> float | None:
    """Return a finite, nonnegative survey price or None for missing values."""
    value = _text(raw).strip()
    if not value:
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    return number if math.isfinite(number) and number >= 0 else None


def product_key(row: dict) -> str:
    return "||".join(_text(row.get(key)) for key in ("varieti", "gred", "unit"))


def market_key(row: dict) -> str:
    return "||".join(_text(row.get(key)) for key in ("negeri", "daerah", "lokasi", "sublevel"))


def market_average(rows: list[dict]) -> dict | None:
    """One equal vote per market; repeated observations average within market."""
    markets: dict[str, list[float]] = {}
    count = 0
    for row in rows:
        price = valid_price(row.get("harga"))
        if price is None:
            continue
        bucket = markets.setdefault(market_key(row), [0.0, 0.0])
        bucket[0] += price
        bucket[1] += 1
        count += 1
    if not markets:
        return None
    value = sum(total / n for total, n in markets.values()) / len(markets)
    return {"mean": value, "n": count, "markets": len(markets)}


class MatchedMarketComparator:
    """Market-price comparison with the exact browser baseline semantics."""

    def __init__(self, rows: list[dict]):
        self.days: dict[tuple[str, str], dict[str, dict[str, list[float]]]] = {}
        self.observed: set[str] = set()
        for row in rows:
            price = valid_price(row.get("harga"))
            day = _text(row.get("tarikh_harga"))
            level = _text(row.get("peringkat"))
            if price is None or not day or not level:
                continue
            self.observed.add(day)
            by_product = self.days.setdefault((day, level), {})
            by_market = by_product.setdefault(product_key(row), {})
            bucket = by_market.setdefault(market_key(row), [0.0, 0.0])
            bucket[0] += price
            bucket[1] += 1
        self.observed_desc = sorted(self.observed, reverse=True)
        self._cache: dict[tuple[str, str, str], dict] = {}

    def day_groups(self, day: str, level: str, state: str = "") -> dict:
        cache_key = (day, level, state)
        if cache_key in self._cache:
            return self._cache[cache_key]
        source = self.days.get((day, level), {})
        if not state:
            self._cache[cache_key] = source
            return source
        prefix = state + "||"
        filtered = {
            product: {market: bucket for market, bucket in markets.items()
                      if market.startswith(prefix)}
            for product, markets in source.items()
        }
        filtered = {product: markets for product, markets in filtered.items() if markets}
        self._cache[cache_key] = filtered
        return filtered

    def compare(
        self, product: str, day: str, days: int, level: str, state: str = ""
    ) -> dict | None:
        if days not in (1, 7, 30) or not day or not level:
            return None
        current = self.day_groups(day, level, state).get(product)
        if not current:
            return None

        target = date.fromisoformat(day) - timedelta(days=days)
        earliest = target - timedelta(days={1: 6, 7: 4, 30: 7}[days])
        for previous_day in self.observed_desc:
            if not earliest.isoformat() <= previous_day <= target.isoformat():
                continue
            previous = self.day_groups(previous_day, level, state).get(product)
            if not previous:
                continue
            now_total = 0.0
            old_total = 0.0
            matched = 0
            for market, (now_sum, now_count) in current.items():
                old = previous.get(market)
                if old is None or not now_count or not old[1]:
                    continue
                now_total += now_sum / now_count
                old_total += old[0] / old[1]
                matched += 1
            if not matched:
                continue
            current_mean = now_total / matched
            previous_mean = old_total / matched
            if previous_mean <= 0:
                continue
            difference = current_mean - previous_mean
            raw_percent = difference / previous_mean * 100
            percent = 0.0 if abs(raw_percent) < 0.05 else raw_percent
            current_coverage = matched / len(current)
            previous_coverage = matched / len(previous)
            return {
                "current": current_mean,
                "previous": previous_mean,
                "rmDifference": difference,
                "percent": percent,
                "markets": matched,
                "currentDate": day,
                "previousDate": previous_day,
                "days": days,
                "actualDays": (date.fromisoformat(day) - date.fromisoformat(previous_day)).days,
                "currentMarkets": len(current),
                "previousMarkets": len(previous),
                "currentCoverage": current_coverage,
                "previousCoverage": previous_coverage,
                "eligible": matched >= 3 and current_coverage >= 0.5 and previous_coverage >= 0.5,
            }
        return None
