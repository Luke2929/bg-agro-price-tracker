"""Read-only V3 integration contract check; never edits source data."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from scraper.aggregate_v3 import DEFAULT_OUTPUT
from scraper.aggregate import DEFAULT_DAILY_DIR


def validate(overview_path: Path, history_index_path: Path, history_dir: Path,
             daily_dir: Path) -> dict:
    overview = json.loads(overview_path.read_text(encoding="utf-8"))
    index = json.loads(history_index_path.read_text(encoding="utf-8"))
    if overview.get("schema") != "bg-agro/fama-overview/v3":
        raise ValueError("Unexpected overview schema")
    if index.get("schema") != "bg-agro/fama-history-index/v3":
        raise ValueError("Unexpected history-index schema")
    files = sorted(p.stem for p in daily_dir.glob("*.csv"))
    if not files or overview["survey_date"] != files[-1]:
        raise ValueError("Published survey date disagrees with archived CSV")
    if overview["first_archived_date"] != files[0]:
        raise ValueError("Historical start date disagrees with archive")
    if overview["canonical_rows"] + overview["superseded_rows"] != overview["archived_rows"]:
        raise ValueError("Revision count does not reconcile")
    if overview["valid_latest_rows"] > overview["latest_survey_rows"]:
        raise ValueError("Impossible survey row count")
    if not overview.get("prices"):
        raise ValueError("Missing all current FAMA prices")
    for quote in overview["prices"]:
        if quote["date"] != overview["survey_date"]:
            raise ValueError("A stale price was presented as latest survey")
        if quote["price"] < 0 or quote["markets"] <= 0:
            raise ValueError("Invalid survey price or market count")
        if quote["observations"] < quote["markets"]:
            raise ValueError("Market count exceeds original record count")
        for change in quote["changes"].values():
            if change is not None:
                if change["currentDate"] != overview["survey_date"]:
                    raise ValueError("Comparison current date mismatch")
                if change["previousDate"] >= change["currentDate"]:
                    raise ValueError("Comparison does not precede current date")
                if change["eligible"] and change["markets"] < 3:
                    raise ValueError("Low-market comparison marked eligible")
    products = index.get("products", [])
    if not products:
        raise ValueError("No history products")
    history_keys = set()
    history_files = set()
    for product in products:
        key = product["product_key"]
        if key in history_keys:
            raise ValueError("Duplicate product key in history index")
        history_keys.add(key)
        path = product["path"]
        if not path.startswith("history/") or not path.endswith(".json"):
            raise ValueError("Invalid product history path")
        filename = path.removeprefix("history/")
        history_files.add(filename)
        history = json.loads((history_dir / filename).read_text(encoding="utf-8"))
        if history.get("schema") != "bg-agro/fama-history/v3" or history.get("product_key") != key:
            raise ValueError("Product history schema or key mismatch")
        for point in history["observations"]:
            if not files[0] <= point["date"] <= files[-1]:
                raise ValueError("Product history has impossible survey date")
            if point["markets"] < 1 or point["observations"] < point["markets"]:
                raise ValueError("Invalid history market weights")
    if history_files != {path.name for path in history_dir.glob("*.json")}:
        raise ValueError("Unexpected/missing generated history JSON file")
    if not {p["product_key"] for p in overview["prices"]} <= history_keys:
        raise ValueError("Latest price missing from history index")
    return {"survey_date": overview["survey_date"], "raw_rows": overview["archived_rows"],
            "quotes": len(overview["prices"]), "products": len(products),
            "history_files": len(history_files)}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Validate V3 generated price contracts")
    parser.add_argument("--overview", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--history-index", type=Path, default=DEFAULT_OUTPUT.parent / "history-index.json")
    parser.add_argument("--history-dir", type=Path, default=DEFAULT_OUTPUT.parent / "history")
    parser.add_argument("--daily-dir", type=Path, default=DEFAULT_DAILY_DIR)
    args = parser.parse_args(argv)
    print(json.dumps(validate(args.overview, args.history_index, args.history_dir, args.daily_dir)))


if __name__ == "__main__":
    main()
