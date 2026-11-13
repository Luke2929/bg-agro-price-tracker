"""Regression coverage for the newest-first daily CSV Markdown index."""

from scripts.build_daily_index import (
    CommitInfo,
    archived_csv_names,
    build_index,
    format_commit_time,
    parse_git_log,
    render_data_status,
)


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
    assert "| Last commit message | Last commit date (MYT) | Data status (FAMA snapshot) |" in markdown
    assert "⚪ Not audited" in markdown
    assert "2026-02-30" not in markdown
    assert "2026-11-14" not in markdown


def test_git_log_keeps_latest_per_file_and_renders_myt():
    sample = (
        "COMMIT\tbbbbbbbb\t2026-11-13T03:40:00+00:00\tdata: scrape 2026-11-13 03:40 UTC\n\n"
        "data/daily/2026-11-13.csv\n"
        "data/daily/2026-11-12.csv\n\n"
        "COMMIT\taaaaaaaa\t2026-11-12T11:15:00+00:00\tfix: adjust older prices\n\n"
        "data/daily/2026-11-12.csv\n"
        "data/daily/2026-11-11.csv\n"
    )
    info = parse_git_log(sample)
    assert info["2026-11-12.csv"].sha == "bbbbbbbb"
    assert info["2026-11-11.csv"].subject == "fix: adjust older prices"
    assert format_commit_time(info["2026-11-13.csv"].timestamp) == "2026-11-13 11:40 MYT"

    markdown = build_index(["2026-11-13.csv", "2026-11-12.csv"], info)
    assert "[data: scrape 2026-11-13 03:40 UTC]" in markdown
    assert "(https://github.com/Luke2929/bg-agro-price-tracker/commit/bbbbbbbb)" in markdown
    assert "| 2026-11-13 11:40 MYT |" in markdown
    assert markdown.index("2026-11-13.csv") < markdown.index("2026-11-12.csv")


def test_commit_message_escaped_for_markdown_table():
    info = {"2026-11-13.csv": CommitInfo(
        sha="0123",
        timestamp="2026-11-13T11:10:00+08:00",
        subject="feat: [sort] | safe & correct",
    )}
    markdown = build_index(["2026-11-13.csv"], info)
    assert r"feat: \[sort\] \| safe &amp; correct" in markdown
    assert "2026-11-13 11:10 MYT" in markdown


def test_empty_archive_does_not_invent_dates(tmp_path):
    assert archived_csv_names(tmp_path) == []
    markdown = build_index([])
    assert "No dated CSV files have been archived." in markdown
    assert "Latest archived survey date" not in markdown


def test_audit_requires_hash_match_and_source_control_counts(tmp_path):
    from scripts.daily_audit import sha256_file

    csv = tmp_path / "2026-11-13.csv"
    csv.write_text("priceid\n1\n2\n", encoding="utf-8")
    info = {
        "expected": 2, "fetched": 2, "archive_rows": 2,
        "preserved_fields": 0,
        "csv_sha256": sha256_file(csv),
        "run_id": "123",
        "verified_at_utc": "2026-11-13T03:17:00+00:00",
    }
    status = render_data_status(csv.name, info, tmp_path)
    assert "✅ Snapshot matched" in status
    assert "2/2" in status
    assert "2026-11-13 11:17 MYT" in status
    assert "/actions/runs/123" in status

    # A CSV can be silently replaced without a fresh upstream audit.
    csv.write_text("priceid\n1\n2\n3\n", encoding="utf-8")
    assert render_data_status(csv.name, info, tmp_path) == "⚠️ Changed since check"

    info["csv_sha256"] = sha256_file(csv)
    info["preserved_fields"] = 2
    assert "⚠️ Source blanks" in render_data_status(csv.name, info, tmp_path)

    info["expected"] = 4
    assert render_data_status(csv.name, info, tmp_path) == "⚠️ Invalid audit"


def test_unverified_archive_never_claims_complete(tmp_path):
    (tmp_path / "2026-07-01.csv").write_text("priceid\n1\n", encoding="utf-8")
    markdown = build_index(["2026-07-01.csv"], {}, {"dates": {}}, tmp_path)
    assert "⚪ Not audited" in markdown
    assert "| [2026-07-01.csv](data/daily/2026-07-01.csv) **(Latest)** | — | — | ⚪ Not audited |" in markdown
