"""Build a newest-first FAMA CSV index with per-file Git commit information.

The file name is the archive survey date; commit time is a separate field.
Run after CSV changes are committed: python -m scripts.build_daily_index
"""

from dataclasses import dataclass
from scripts.daily_audit import load_audit, sha256_file
from datetime import date, datetime
import json
from pathlib import Path
import re
import subprocess
from zoneinfo import ZoneInfo

REPO_ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_DIR = REPO_ROOT / "data" / "daily"
INDEX_FILE = REPO_ROOT / "DAILY_PRICE_INDEX.md"
CSV_DATE_NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})\.csv$")
MALAYSIA_TIME = ZoneInfo("Asia/Kuala_Lumpur")
COMMIT_URL = "https://github.com/Luke2929/bg-agro-price-tracker/commit/"


@dataclass(frozen=True)
class CommitInfo:
    sha: str
    timestamp: str
    subject: str


def archived_csv_names(archive_dir: Path) -> list[str]:
    """Return actual valid YYYY-MM-DD.csv files, newest survey date first."""
    filenames = []
    for path in archive_dir.iterdir():
        if not path.is_file():
            continue
        match = CSV_DATE_NAME.fullmatch(path.name)
        if match is None:
            continue
        try:
            date.fromisoformat(match.group(1))
        except ValueError:
            continue
        filenames.append(path.name)
    return sorted(filenames, reverse=True)


def parse_git_log(history: str) -> dict[str, CommitInfo]:
    """Keep the first (newest) Git commit affecting each archived CSV."""
    result: dict[str, CommitInfo] = {}
    current: CommitInfo | None = None
    for line in history.split("\n"):
        line = line.rstrip("\r")
        if line.startswith("COMMIT\t"):
            parts = line.split("\t", 3)
            if len(parts) == 4:
                _, sha, timestamp, subject = parts
                current = CommitInfo(sha=sha, timestamp=timestamp, subject=subject)
            else:
                current = None
        elif line.startswith("data/daily/") and current is not None:
            filename = line.removeprefix("data/daily/")
            if CSV_DATE_NAME.fullmatch(filename):
                result.setdefault(filename, current)
    return result


def latest_csv_commits(repo_root: Path = REPO_ROOT) -> dict[str, CommitInfo]:
    """Retrieve per-file last commits in a single local Git history pass."""
    completed = subprocess.run(
        [
            "git", "log",
            "--pretty=format:COMMIT%x09%H%x09%cI%x09%s",
            "--name-only",
            "--", "data/daily/",
        ],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=True,
    )
    return parse_git_log(completed.stdout)


def escape_markdown(text: str) -> str:
    """Keep commit subjects safe in a GitHub-flavored Markdown table link."""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("|", r"\|")
        .replace("[", r"\[")
        .replace("]", r"\]")
        .replace("\n", " ")
    )


def format_commit_time(timestamp: str) -> str:
    """Static MYT timestamp does not go stale like '4 minutes ago'."""
    committed = datetime.fromisoformat(timestamp)
    if committed.tzinfo is None:
        raise ValueError("Git commit timestamp must contain a timezone offset")
    return committed.astimezone(MALAYSIA_TIME).strftime("%Y-%m-%d %H:%M MYT")


def render_data_status(filename: str, record: dict | None, archive_dir: Path) -> str:
    """Report matched source snapshot only if the audited CSV is still identical."""
    if not isinstance(record, dict):
        return "⚪ Not audited"
    expected = record.get("expected")
    fetched = record.get("fetched")
    if (
        not isinstance(expected, int)
        or isinstance(expected, bool)
        or expected <= 0
        or fetched != expected
        or not isinstance(record.get("csv_sha256"), str)
    ):
        return "⚠️ Invalid audit"
    csv_path = archive_dir / filename
    if not csv_path.is_file() or sha256_file(csv_path) != record["csv_sha256"]:
        return "⚠️ Changed since check"

    run_id = record.get("run_id")
    title = f"FAMA {fetched:,}/{expected:,}"
    if isinstance(run_id, str) and run_id.isdigit():
        title = f"[{title}](https://github.com/Luke2929/bg-agro-price-tracker/actions/runs/{run_id})"
    try:
        checked = format_commit_time(record["verified_at_utc"])
    except (KeyError, TypeError, ValueError):
        return "⚠️ Invalid audit"

    # Source columns may be blank even with the correct upstream row count.
    if record.get("preserved_fields", 0) > 0:
        return f"⚠️ Source blanks; {title} · {checked}"
    archive_rows = record.get("archive_rows")
    retained = (
        f"; archive {archive_rows:,}"
        if isinstance(archive_rows, int) and archive_rows > expected
        else ""
    )
    return f"✅ Snapshot matched; {title}{retained} · {checked}"


HISTORICAL_SCHEMA = "bg-agro/fama-historical-log-evidence/v1"
TRUSTED_HISTORY_REPOS = {
    "Luke2929/bg-agro-price-tracker",
    "ipohbot-png/fama-price-tracker",
}


def load_historical_checks(path: Path) -> dict:
    """Read historical Actions logs, kept separate from current CSV SHA audits."""
    if not path.is_file():
        return {"schema": HISTORICAL_SCHEMA, "dates": {}}
    document = json.loads(path.read_text(encoding="utf-8"))
    if (
        not isinstance(document, dict)
        or document.get("schema") != HISTORICAL_SCHEMA
        or not isinstance(document.get("dates"), dict)
    ):
        raise ValueError(f"Invalid historical log evidence manifest: {path}")
    return document


def render_historical_status(record: dict | None) -> str:
    """Label *historical fetch evidence*, never claim present-file verification."""
    if not isinstance(record, dict):
        return "⚪ Not audited"

    source = record.get("source_repo")
    run_id = record.get("run_id")
    expected, fetched = record.get("expected"), record.get("fetched")
    if (
        source not in TRUSTED_HISTORY_REPOS
        or not isinstance(run_id, str)
        or not run_id.isdigit()
        or not isinstance(expected, int)
        or isinstance(expected, bool)
        or expected <= 0
        or fetched != expected
        or record.get("status") not in ("ok", "ok+archive")
    ):
        return "⚠️ Invalid historical evidence"

    try:
        date_myt = format_commit_time(record["log_at_utc"])
    except (TypeError, KeyError, ValueError):
        return "⚠️ Invalid historical evidence"

    repo_label = "Own Actions" if source == "Luke2929/bg-agro-price-tracker" else "Original project"
    link = f"https://github.com/{source}/actions/runs/{run_id}"
    return (
        f"📜 Historical match; "
        f"[FAMA {expected:,}/{fetched:,}]({link}) · "
        f"{date_myt} ({repo_label}; current CSV not rechecked)"
    )


def build_index(
    filenames: list[str],
    commit_info: dict[str, CommitInfo] | None = None,
    audit: dict | None = None,
    archive_dir: Path = ARCHIVE_DIR,
    historical_checks: dict | None = None,
) -> str:
    """Render actual CSV links in descending date order with Git metadata."""
    commits = commit_info if commit_info is not None else {}
    verified_dates = audit.get("dates", {}) if isinstance(audit, dict) else {}
    history = historical_checks.get("dates", {}) if isinstance(historical_checks, dict) else {}
    lines = [
        "# FAMA Daily CSV Index — Newest First",
        "",
        "Automatically generated from the CSV files actually present in "
        "[data/daily/](data/daily/). Most recent **survey dates** appear first.",
        "",
        f"**Archived CSV files:** {len(filenames)}",
        "",
    ]
    if filenames:
        lines.extend([
            f"**Latest archived survey date:** {filenames[0][:-4]}",
            "",
            "| Name (newest survey date first) | Last commit message | Last commit date (MYT) | Data status (FAMA snapshot) |",
            "| --- | --- | --- | --- |",
        ])
        for number, filename in enumerate(filenames):
            label = " **(Latest)**" if number == 0 else ""
            info = commits.get(filename)
            if info is None:
                message, committed = "—", "—"
            else:
                message = (
                    f"[{escape_markdown(info.subject)}]"
                    f"({COMMIT_URL}{info.sha})"
                )
                committed = format_commit_time(info.timestamp)
            survey_date = filename[:-4]
            if survey_date in verified_dates:
                status_text = render_data_status(filename, verified_dates.get(survey_date), archive_dir)
            else:
                status_text = render_historical_status(history.get(survey_date))
            lines.append(
                f"| [{filename}](data/daily/{filename}){label} "
                f"| {message} | {committed} | {status_text} |"
            )
    else:
        lines.append("No dated CSV files have been archived.")

    lines.extend([
        "",
        "> **Data note:** Survey date is taken from the CSV filename. "
        "Last commit message/date describe the most recent Git change to that "
        "file (MYT), **not** the original FAMA publication time or a guarantee "
        "that the day's observations are complete. **✅ Snapshot matched** means "
        "the scraper fetched the same number of unique, dated `priceid` records "
        "as FAMA\'s control query at the recorded check, and the archived CSV "
        "has not changed since. FAMA may add or correct rows later. "
        "**⚠️ Source blanks** means some source fields were empty and archived "
        "values were preserved; **⚪ Not audited** means no saved per-day verification "
        "evidence (especially older dates). **📜 Historical match** is evidence "
        "from a past successful GitHub Actions run that matched FAMA counts "
        "at that earlier time; it **does not verify the currently archived CSV**. "
        "Historical run records are stored separately in "
        "[data/fama_historical_checks.json](data/fama_historical_checks.json). "
        "A failed Actions run does not erase the "
        "previous valid audit; [review latest workflow runs]("
        "https://github.com/Luke2929/bg-agro-price-tracker/actions/workflows/scrape.yml) "
        "for job failures. GitHub\'s native file browser keeps its own ordering.",
        "",
        "[Open original CSV folder](data/daily/) · "
        "[Open BG Agro Dashboard](https://luke2929.github.io/bg-agro-price-tracker/)",
        "",
    ])
    return "\n".join(lines)


def main() -> None:
    audit = load_audit(REPO_ROOT / "data" / "fama_fetch_audit.json")
    historical = load_historical_checks(REPO_ROOT / "data" / "fama_historical_checks.json")
    content = build_index(
        archived_csv_names(ARCHIVE_DIR), latest_csv_commits(), audit,
        historical_checks=historical,
    )
    if not INDEX_FILE.exists() or INDEX_FILE.read_text(encoding="utf-8") != content:
        INDEX_FILE.write_text(content, encoding="utf-8")
        print(f"Updated {INDEX_FILE.name}")
    else:
        print(f"{INDEX_FILE.name} is already current")


if __name__ == "__main__":
    main()
