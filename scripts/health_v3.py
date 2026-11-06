"""Write the last V3 *build* provenance (not a continuous scheduler heartbeat).

External backup scheduler health must be checked independently via the GitHub
Actions API. A static JSON generated on a successful build cannot prove that a
later cron fired, so no scheduled-run status is inferred here.
"""

from __future__ import annotations

import json
import os
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from scraper.aggregate_v3 import DEFAULT_OUTPUT, atomic_json


def build_health(overview: dict, *, trigger: str, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    age = (now.astimezone(ZoneInfo("Asia/Kuala_Lumpur")).date() -
           date.fromisoformat(overview["survey_date"])).days
    return {
        "schema": "bg-agro/fama-build-health/v3",
        "status": "ok" if age <= 2 else "warning",
        "checked_at_utc": now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "latest_survey_date": overview["survey_date"],
        "trigger": trigger,
        "changed_records": None,
        "build_note": "Static provenance for the last regenerated V3 JSON; not a live cron monitor",
    }


def main():
    overview = json.loads(DEFAULT_OUTPUT.read_text(encoding="utf-8"))
    output = DEFAULT_OUTPUT.parent / "health.json"
    data = build_health(overview, trigger=os.environ.get("GITHUB_EVENT_NAME", "manual-local"))
    atomic_json(output, data)
    print(json.dumps(data))


if __name__ == "__main__":
    main()
