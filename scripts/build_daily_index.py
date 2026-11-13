"""Build a clickable newest-first index from archived FAMA daily CSV filenames.

This is an archive navigation page, not a completeness or freshness audit.
Run with: python -m scripts.build_daily_index
"""

from datetime import date
from pathlib import Path
import re

REPO_ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_DIR = REPO_ROOT / "data" / "daily"
INDEX_FILE = REPO_ROOT / "DAILY_PRICE_INDEX.md"
CSV_DATE_NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})\.csv$")


def archived_csv_names(archive_dir: Path) -> list[str]:
    """Return actual valid YYYY-MM-DD.csv files, newest first."""
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


def build_index(filenames: list[str]) -> str:
    """Render GitHub-relative links, with no invented or missing dates."""
    lines = [
        "# FAMA Daily CSV Index — Newest First",
        "",
        "Automatically generated from the CSV files actually present in "
        "[\`data/daily/\`](data/daily/). The most recent archived survey date appears first.",
        "",
        f"**Archived CSV files:** {len(filenames)}",
        "",
    ]
    if filenames:
        lines.extend([
            f"**Latest archived survey date:** {filenames[0][:-4]}",
            "",
            "| Survey date (YYYY-MM-DD) | Open original CSV |",
            "| --- | --- |",
        ])
        for number, filename in enumerate(filenames):
            survey_date = filename[:-4]
            label = " **(Latest)**" if number == 0 else ""
            lines.append(
                f"| {survey_date}{label} | "
                f"[{filename}](data/daily/{filename}) |"
            )
    else:
        lines.append("No dated CSV files have been archived.")

    lines.extend([
        "",
        "> **Data note:** Dates identify archived FAMA survey records, not the time "
        "the file was downloaded. A listed CSV is not a guarantee that FAMA "
        "has published complete observations for that date.",
        "",
        "[Open original CSV folder](data/daily/) · "
        "[Open BG Agro Dashboard](https://luke2929.github.io/bg-agro-price-tracker/)",
        "",
    ])
    return "\n".join(lines)


def main() -> None:
    content = build_index(archived_csv_names(ARCHIVE_DIR))
    if not INDEX_FILE.exists() or INDEX_FILE.read_text(encoding="utf-8") != content:
        INDEX_FILE.write_text(content, encoding="utf-8")
        print(f"Updated {INDEX_FILE.name}")
    else:
        print(f"{INDEX_FILE.name} is already current")


if __name__ == "__main__":
    main()
