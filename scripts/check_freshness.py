"""Audit the most recent FAMA survey date without changing archived prices.

GitHub Actions can succeed even if FAMA has not published today's observations.
This check reports that distinction in the job log and Step Summary. A delayed
survey raises an Actions warning, not a failed deployment: weekends, holidays,
and irregular market surveys may legitimately have no new observations.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

MYT = ZoneInfo("Asia/Kuala_Lumpur")
ROOT = Path(__file__).resolve().parents[1]


def assess_freshness(latest: str, now: datetime) -> tuple[str, int]:
    """Return (status, calendar days behind in MYT).

    Current means at least one survey dated today, NOT a complete nationwide
    survey. Missing today's data is not automatically a scraper failure.
    """
    surveyed = date.fromisoformat(latest)
    local_now = now.astimezone(MYT)
    days_behind = (local_now.date() - surveyed).days
    if days_behind <= 0:
        return "current", max(days_behind, 0)
    if days_behind == 1 and local_now.hour < 14:
        return "pending", days_behind
    if days_behind == 1:
        return "delayed", days_behind
    return "older", days_behind


def audit(meta_path: Path, daily_dir: Path, now: datetime) -> dict:
    with meta_path.open(encoding="utf-8") as handle:
        meta = json.load(handle)
    latest = meta["window"]["max"]
    if not isinstance(latest, str):
        raise ValueError("Dashboard metadata has no latest survey date")
    status, lag = assess_freshness(latest, now)
    latest_file = daily_dir / f"{latest}.csv"
    if not latest_file.is_file():
        raise FileNotFoundError(f"Latest FAMA survey CSV is missing: {latest_file}")
    with latest_file.open(newline="", encoding="utf-8-sig") as handle:
        rows = sum(1 for row in csv.DictReader(handle) if row["tarikh_harga"] == latest)
    local_now = now.astimezone(MYT)
    return {
        "checked_at_myt": local_now.strftime("%Y-%m-%d %H:%M:%S MYT"),
        "latest_survey": latest,
        "latest_survey_rows": rows,
        "days_behind": lag,
        "status": status,
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Check freshness of archived FAMA prices")
    parser.add_argument("--meta", type=Path, default=ROOT / "site/data/meta.json")
    parser.add_argument("--daily-dir", type=Path, default=ROOT / "data/daily")
    args = parser.parse_args(argv)
    result = audit(args.meta, args.daily_dir, datetime.now(MYT))
    print("FAMA data freshness audit:")
    for key, value in result.items():
        print(f"  {key}: {value}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n### FAMA data freshness (MYT)\n\n")
            handle.write("| Last checked | Latest survey | Rows on latest date | Status |\n")
            handle.write("| --- | --- | ---: | --- |\n")
            handle.write(
                f"| {result['checked_at_myt']} | {result['latest_survey']} | "
                f"{result['latest_survey_rows']:,} | {result['status']} |\n"
            )
            handle.write("\nA current date does not guarantee every market has reported.\n")
    if result["status"] in {"delayed", "older"}:
        print(
            "::warning title=FAMA survey not current::"
            f"Latest archived survey is {result['latest_survey']} "
            f"({result['days_behind']} calendar day(s) behind MYT). "
            "FAMA may not have published new raw observations yet."
        )


if __name__ == "__main__":
    main()
