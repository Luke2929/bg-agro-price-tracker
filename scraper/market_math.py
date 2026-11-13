"""V3 reference implementation of the Dashboard's matched-market Algorithm V2.

Do not substitute legacy row-weighted ``site/data/series`` averages for these
values. This module deliberately mirrors the browser comparison contract so
both implementations can be validated against the same versioned fixtures
before any generated JSON API is migrated.
"""

from __future__ import annotations

from datetime import date, timedelta
import math
import re


DECIMAL_PRICE = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:e[+-]?[0-9]+)?", re.I)
SOURCE_REVIEW_RATIO = 10
MARKET_REVIEW_RATIO = 2
MARKET_REVIEW_POINTS = 10


def _text(value: object) -> str:
    return "" if value is None else str(value)


def valid_price(raw: object) -> float | None:
    """Return a finite, nonnegative survey price or None for missing values."""
    value = _text(raw).strip()
    if not DECIMAL_PRICE.fullmatch(value):
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    return number if math.isfinite(number) and number >= 0 else None


def source_price_needs_review(row: dict, price: float) -> bool:
    reference = valid_price(row.get("average14"))
    return reference is not None and reference > 0 and price >= reference * SOURCE_REVIEW_RATIO


def market_needs_review(now: float, before: float, now_total: float,
                        before_total: float, percent: float) -> bool:
    """Detect one large market movement materially affecting the headline."""
    if now == before or max(now, before) < min(now, before) * MARKET_REVIEW_RATIO:
        return False
    remaining_before = before_total - before
    if remaining_before <= 0:
        return True
    without_market = (now_total - now - remaining_before) / remaining_before * 100
    return abs(percent - without_market) >= MARKET_REVIEW_POINTS


def product_key(row: dict) -> str:
    return "||".join(
        _text(row.get(key)).strip().replace("%", "%25").replace("|", "%7C")
        for key in ("varieti", "gred", "unit")
    )


def market_key(row: dict) -> tuple[str, ...]:
    return tuple(_text(row.get(key)).strip() for key in ("negeri", "daerah", "lokasi", "sublevel"))


def market_average(rows: list[dict]) -> dict | None:
    """One equal vote per market; repeated observations average within market."""
    markets: dict[tuple[str, ...], list[float]] = {}
    count = 0
    review = False
    for row in rows:
        price = valid_price(row.get("harga"))
        if price is None:
            continue
        bucket = markets.setdefault(market_key(row), [0.0, 0.0])
        bucket[0] += price
        bucket[1] += 1
        count += 1
        review = review or source_price_needs_review(row, price)
    if not markets:
        return None
    value = sum(total / n for total, n in markets.values()) / len(markets)
    return {"mean": value, "n": count, "markets": len(markets), **({"review": True} if review else {})}


class MatchedMarketComparator:
    """Market-price comparison with the exact browser baseline semantics."""

    def __init__(self, rows: list[dict]):
        self.days: dict[tuple[str, str], dict[str, dict[tuple[str, ...], list[float]]]] = {}
        self.observed: set[str] = set()
        for row in rows:
            price = valid_price(row.get("harga"))
            day = _text(row.get("tarikh_harga"))
            level = _text(row.get("peringkat")).strip()
            if price is None or not day or level not in ("Ladang", "Borong", "Runcit"):
                continue
            self.observed.add(day)
            by_product = self.days.setdefault((day, level), {})
            by_market = by_product.setdefault(product_key(row), {})
            bucket = by_market.setdefault(market_key(row), [0.0, 0.0, False])
            bucket[0] += price
            bucket[1] += 1
            bucket[2] = bucket[2] or source_price_needs_review(row, price)
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
        filtered = {
            product: {market: bucket for market, bucket in markets.items()
                      if market[0] == state}
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
            pairs = []
            source_review = False
            for market, (now_sum, now_count, now_review) in current.items():
                old = previous.get(market)
                if old is None or not now_count or not old[1]:
                    continue
                now = now_sum / now_count
                before = old[0] / old[1]
                now_total += now
                old_total += before
                pairs.append((now, before))
                source_review = source_review or now_review or old[2]
            matched = len(pairs)
            if not matched:
                continue
            current_mean = now_total / matched
            previous_mean = old_total / matched
            if previous_mean <= 0:
                continue
            difference = current_mean - previous_mean
            raw_percent = difference / previous_mean * 100
            percent = 0.0 if abs(raw_percent) < 0.05 else raw_percent
            reasons = ["source-price"] if source_review else []
            if matched >= 3 and any(
                market_needs_review(now, before, now_total, old_total, raw_percent)
                for now, before in pairs
            ):
                reasons.append("market-impact")
            current_coverage = matched / len(current)
            previous_coverage = matched / len(previous)
            return {
                "current": current_mean,
                "previous": previous_mean,
                "rmDifference": difference,
                "rawPercent": raw_percent,
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
                **({"reviewReasons": reasons} if reasons else {}),
            }
        return None
