"""Persist source-count verification for real FAMA daily CSV snapshots.

A successful FAMA control-count comparison proves a scrape matched the upstream
snapshot *at that time*, not that publication has finished or every state reports.
This audit is intentionally separate from the dashboard's health.json.
"""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path


SCHEMA = "bg-agro/fama-daily-fetch-audit/v1"


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_audit(path: Path) -> dict:
    """Read persisted evidence; refuse malformed files instead of assuming OK."""
    if not path.exists():
        return {"schema": SCHEMA, "dates": {}}
    document = json.loads(path.read_text(encoding="utf-8"))
    if (
        not isinstance(document, dict)
        or document.get("schema") != SCHEMA
        or not isinstance(document.get("dates"), dict)
    ):
        raise ValueError(f"Invalid FAMA audit manifest: {path}")
    return document


def persist_verified_fetches(
    audit_path: Path,
    out_dir: Path,
    table: list[dict],
    *,
    verified_at_utc: str | None = None,
    run_id: str | None = None,
) -> bool:
    """Record only completely successful per-date upstream snapshots.

    Existing evidence is retained for dates not checked by the current run.
    Identical source counts and archived CSV hashes do not create Git churn.
    All input evidence is validated before writing an atomic replacement.
    """
    import os

    document = load_audit(audit_path)
    dates = dict(document["dates"])
    checked_at = verified_at_utc or datetime.now(timezone.utc).isoformat(timespec="seconds")
    changes = False

    for item in table:
        survey_date = item["date"]
        expected = item["expected"]
        fetched = item["fetched"]
        rows = item["written"]
        preserved_fields = int(item.get("preserved_fields", 0))
        status = item["status"]
        if (
            not isinstance(expected, int)
            or isinstance(expected, bool)
            or expected <= 0
            or fetched != expected
            or status not in ("ok", "ok+archive")
        ):
            raise ValueError(f"Refusing to record unverified FAMA fetch: {survey_date}")

        csv_path = out_dir / f"{survey_date}.csv"
        if not csv_path.is_file():
            raise FileNotFoundError(csv_path)
        fingerprint = sha256_file(csv_path)
        evidence = {
            "expected": expected,
            "fetched": fetched,
            "archive_rows": rows,
            "preserved_fields": preserved_fields,
            "csv_sha256": fingerprint,
        }
        previous = dates.get(survey_date)
        if isinstance(previous, dict) and all(previous.get(k) == v for k, v in evidence.items()):
            continue

        dates[survey_date] = {
            **evidence,
            "verified_at_utc": checked_at,
            "run_id": str(run_id) if run_id else None,
        }
        changes = True

    if not changes:
        return False
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    document = {"schema": SCHEMA, "dates": dict(sorted(dates.items()))}
    temp_path = audit_path.with_suffix(audit_path.suffix + ".tmp")
    temp_path.write_text(
        json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    os.replace(temp_path, audit_path)
    return True
