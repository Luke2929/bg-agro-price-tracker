"""Build a newest-first FAMA CSV index with per-file Git commit information.

The file name is the archive survey date; commit time is a separate field.
Run after CSV changes are committed: python -m scripts.build_daily_index
"""

from dataclasses import dataclass
from datetime import date, datetime
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


def build_index(
    filenames: list[str],
    commit_info: dict[str, CommitInfo] | None = None,
) -> str:
    """Render actual CSV links in descending date order with Git metadata."""
    commits = commit_info if commit_info is not None else {}
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
            "| Name (newest survey date first) | Last commit message | Last commit date (MYT) |",
            "| --- | --- | --- |",
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
            lines.append(
                f"| [{filename}](data/daily/{filename}){label} "
                f"| {message} | {committed} |"
            )
    else:
        lines.append("No dated CSV files have been archived.")

    lines.extend([
        "",
        "> **Data note:** Survey date is taken from the CSV filename. "
        "Last commit message/date describe the most recent Git change to that "
        "file (MYT), **not** the original FAMA publication time or a guarantee "
        "that the day's observations are complete. GitHub's native file browser "
        "still uses its own ordering.",
        "",
        "[Open original CSV folder](data/daily/) · "
        "[Open BG Agro Dashboard](https://luke2929.github.io/bg-agro-price-tracker/)",
        "",
    ])
    return "\n".join(lines)


def main() -> None:
    content = build_index(archived_csv_names(ARCHIVE_DIR), latest_csv_commits())
    if not INDEX_FILE.exists() or INDEX_FILE.read_text(encoding="utf-8") != content:
        INDEX_FILE.write_text(content, encoding="utf-8")
        print(f"Updated {INDEX_FILE.name}")
    else:
        print(f"{INDEX_FILE.name} is already current")


if __name__ == "__main__":
    main()
