"""Build a versioned BG Agro V3 overview without changing legacy JSON APIs.

The original CSV archive remains authoritative. Only canonical (latest-dated)
versions of repeated FAMA price IDs enter calculations. This module uses the
same matched-market semantics as the browser and publishes a new, separate
``site/data/v3/overview.json`` contract for a staged frontend migration.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path

from .aggregate import DEFAULT_DAILY_DIR, canonicalize_rows, read_rows, LEVELS
from .market_math import (
    MatchedMarketComparator, market_average, market_key, product_key,
    source_price_needs_review, valid_price,
)

DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "site/data/v3/overview.json"
LOOKBACK_DAYS = 38  # 30D target + up to 7 older calendar days


def build_overview(archived_rows: list[dict], survey_date: str | None = None) -> dict:
    """Create accurate latest-day national/state snapshots and comparisons.

    Missing price readings and missing survey days are never estimated. The
    result includes *only* products actually surveyed on ``survey_date``;
    consumers must not claim absent products had a same-day quote.
    """
    canonical, _ = canonicalize_rows(archived_rows)
    observed_dates = sorted({r.get("tarikh_harga", "") for r in canonical if r.get("tarikh_harga")})
    if not observed_dates:
        raise ValueError("The canonical archive has no survey dates")
    latest_date = survey_date or observed_dates[-1]
    if latest_date not in observed_dates:
        raise ValueError(f"Survey date not reported in archive: {latest_date}")

    cutoff = (date.fromisoformat(latest_date) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    recent = [
        r for r in canonical
        if cutoff <= (r.get("tarikh_harga") or "") <= latest_date
    ]
    comparator = MatchedMarketComparator(recent)

    # A national group and a state group each vote their distinct markets
    # equally; both are derived from actual rows, not averaged state averages.
    groups: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    product_labels: dict[str, dict] = {}
    categories: dict[str, Counter] = defaultdict(Counter)
    raw_latest = 0
    for row in recent:
        if row.get("tarikh_harga") != latest_date:
            continue
        raw_latest += 1
        price = valid_price(row.get("harga"))
        level = (row.get("peringkat") or "").strip()
        variety = (row.get("varieti") or "").strip()
        state = (row.get("negeri") or "").strip()
        if price is None or level not in LEVELS or not variety:
            continue
        product = product_key(row)
        product_labels.setdefault(product, {
            "varieti": variety,
            "gred": (row.get("gred") or "").strip(),
            "unit": (row.get("unit") or "").strip(),
        })
        categories[product][(row.get("kategori") or "").strip()] += 1
        groups[(product, level, "")].append(row)
        if state:
            groups[(product, level, state)].append(row)

    output = []
    for (product, level, state), rows in sorted(groups.items()):
        average = market_average(rows)
        if average is None:
            continue
        changes = {
            str(period): comparator.compare(product, latest_date, period, level, state)
            for period in (1, 7, 30)
        }
        category = categories[product].most_common(1)[0][0] if categories[product] else ""
        output.append({
            "product_key": product,
            **product_labels[product],
            "kategori": category,
            "level": level,
            "state": state,  # empty string is All Malaysia; never a reported state
            "date": latest_date,
            "price": average["mean"],
            "observations": average["n"],
            "markets": average["markets"],
            "changes": changes,
            **({"priceReview": True} if average.get("review") else {}),
        })

    return {
        "schema": "bg-agro/fama-overview/v3",
        "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "survey_date": latest_date,
        "first_archived_date": observed_dates[0],
        "archived_rows": len(archived_rows),
        "canonical_rows": len(canonical),
        "superseded_rows": len(archived_rows) - len(canonical),
        "latest_survey_rows": raw_latest,
        "valid_latest_rows": sum(1 for r in recent if r.get("tarikh_harga") == latest_date
                                 and valid_price(r.get("harga")) is not None),
        "levels": list(LEVELS),
        "states": sorted({r["state"] for r in output if r["state"]}),
        "prices": output,
        "source": "FAMA AMI — https://www.fama.gov.my/harga-pasaran-terkini",
        "note": "Survey observations; same-market changes only. Missing data is not estimated.",
    }


def build_history(archived_rows: list[dict]) -> tuple[dict, dict[str, dict]]:
    """Full observed history, by product/grade/unit, with equal market votes.

    This derived contract is additive. It never changes or discards an archived
    source CSV and never invents dates, prices, or location observations.
    """
    canonical, _superseded = canonicalize_rows(archived_rows)
    # Bucket prices by actual market; multiple observations within one location
    # first average together before locations receive one vote apiece.
    buckets: dict[str, dict[tuple[str, str, str], dict[tuple[str, ...], list[float]]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    labels: dict[str, dict] = {}
    review_groups = set()
    for row in canonical:
        day = (row.get("tarikh_harga") or "").strip()
        level = (row.get("peringkat") or "").strip()
        variety = (row.get("varieti") or "").strip()
        price = valid_price(row.get("harga"))
        if not day or level not in LEVELS or not variety or price is None:
            continue
        key = product_key(row)
        labels.setdefault(key, {
            "varieti": variety, "gred": (row.get("gred") or "").strip(),
            "unit": (row.get("unit") or "").strip(),
            "kategori": (row.get("kategori") or "").strip(),
        })
        market = market_key(row)
        # National counts all distinct surveyed markets; state-level breakdown
        # uses precisely the same observations, not the mean of state means.
        state = (row.get("negeri") or "").strip()
        for scope in ("", state) if state else ("",):
            scope_key = (day, level, scope)
            group = buckets[key][scope_key]
            entry = group.setdefault(market, [0.0, 0.0])
            entry[0] += price
            entry[1] += 1
            if source_price_needs_review(row, price):
                review_groups.add((key, scope_key))

    manifest_items = []
    files: dict[str, dict] = {}
    for key, by_day in sorted(buckets.items()):
        name = hashlib.sha256(key.encode("utf-8")).hexdigest()[:20] + ".json"
        if name in files:
            raise ValueError("Unexpected product history filename collision")
        observations = []
        for (day, level, state), markets in sorted(by_day.items()):
            if not markets:
                continue
            count = sum(int(pair[1]) for pair in markets.values())
            mean = sum(pair[0] / pair[1] for pair in markets.values()) / len(markets)
            observations.append({
                "date": day, "level": level, "state": state,
                "price": mean, "markets": len(markets), "observations": count,
                **({"priceReview": True} if (key, (day, level, state)) in review_groups else {}),
            })
        item = {"product_key": key, **labels[key], "path": "history/" + name}
        manifest_items.append(item)
        files[name] = {"schema": "bg-agro/fama-history/v3", **item,
                       "observations": observations}
    return ({"schema": "bg-agro/fama-history-index/v3", "products": manifest_items}, files)


def atomic_json(output: Path, data: dict) -> None:
    """Never expose a partially written generated JSON contract."""
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".json.tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    temporary.replace(output)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Build BG Agro V3 comparable-market overview")
    parser.add_argument("--daily-dir", type=Path, default=DEFAULT_DAILY_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--history-dir", type=Path, default=None,
                        help="Also write per-product V3 history and manifest")
    parser.add_argument("--date", default=None)
    args = parser.parse_args(argv)
    archived = read_rows(args.daily_dir)
    data = build_overview(archived, args.date)
    atomic_json(args.output, data)
    if args.history_dir:
        index, files = build_history(archived)
        args.history_dir.mkdir(parents=True, exist_ok=True)
        for filename, history in files.items():
            atomic_json(args.history_dir / filename, history)
        atomic_json(args.history_dir.parent / "history-index.json", index)
    print(json.dumps({
        "schema": data["schema"], "date": data["survey_date"],
        "raw": data["archived_rows"], "canonical": data["canonical_rows"],
        "quotes": len(data["prices"]), "output": str(args.output),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
