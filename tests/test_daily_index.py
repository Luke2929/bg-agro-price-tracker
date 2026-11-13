"""Regression coverage for the newest-first daily CSV Markdown index."""

from scripts.build_daily_index import archived_csv_names, build_index


def test_daily_index_orders_existing_files_newest_first(tmp_path):
    for name in [
        "2026-11-11.csv",
        "2026-11-13.csv",
        "2026-11-12.csv",
        "2026-02-30.csv",
        "notes.csv",
        "2026-11-14.csv.bak",
    ]:
        (tmp_path / name).write_text("test", encoding="utf-8")
    (tmp_path / "2026-11-15.csv").mkdir()

    names = archived_csv_names(tmp_path)
    assert names == [
        "2026-11-13.csv",
        "2026-11-12.csv",
        "2026-11-11.csv",
    ]

    markdown = build_index(names)
    assert "**Archived CSV files:** 3" in markdown
    assert "**Latest archived survey date:** 2026-11-13" in markdown
    assert "[2026-11-13.csv](data/daily/2026-11-13.csv)" in markdown
    assert markdown.index("2026-11-13.csv") < markdown.index("2026-11-12.csv")
    assert markdown.index("2026-11-12.csv") < markdown.index("2026-11-11.csv")
    assert "2026-02-30" not in markdown
    assert "2026-11-14" not in markdown


def test_empty_archive_does_not_invent_dates(tmp_path):
    assert archived_csv_names(tmp_path) == []
    markdown = build_index([])
    assert "No dated CSV files have been archived." in markdown
    assert "Latest archived survey date" not in markdown
