"""Regression coverage for the newest-first daily CSV Markdown index."""

from scripts.build_daily_index import (
    CommitInfo,
    archived_csv_names,
    build_index,
    format_commit_time,
    parse_git_log,
    render_data_status,
    render_historical_status,
    load_historical_checks,
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



def test_historical_control_match_is_not_current_csv_verification(tmp_path):
    log_entry = {
        "source_repo": "ipohbot-png/fama-price-tracker",
        "run_id": "39150661545",
        "expected": 63,
        "fetched": 63,
        "status": "ok+archive",
        "log_at_utc": "2026-10-18T17:41:21.9092894Z",
    }
    result = render_historical_status(log_entry)
    assert "📜 Historical match" in result
    assert "current CSV not rechecked" in result
    assert "FAMA 63/63" in result
    assert "2026-10-19 01:41 MYT" in result
    assert "ipohbot-png/fama-price-tracker/actions/runs/39150661545" in result

    # This is a historical source-control match, not proof of today's CSV.
    md = build_index(
        ["2026-09-20.csv"], {}, {"dates": {}}, tmp_path,
        {"dates": {"2026-09-20": log_entry}},
    )
    row = next(line for line in md.splitlines() if "2026-09-20.csv](data/daily/" in line)
    assert "Historical match" in row
    assert "Snapshot matched" not in row


def test_live_audit_supersedes_historical_evidence(tmp_path):
    from scripts.daily_audit import sha256_file

    csv = tmp_path / "2026-10-14.csv"
    csv.write_text("priceid\n1\n2\n", encoding="utf-8")
    live = {"dates": {"2026-10-14": {
        "expected": 2, "fetched": 2, "archive_rows": 2,
        "preserved_fields": 0, "csv_sha256": sha256_file(csv),
        "verified_at_utc": "2026-11-13T04:11:57+00:00", "run_id": "12345",
    }}}
    history = {"dates": {"2026-10-14": {
        "source_repo": "Luke2929/bg-agro-price-tracker",
        "run_id": "41166427506", "expected": 5202, "fetched": 5202,
        "log_at_utc": "2026-10-31T03:56:59Z", "status": "ok",
    }}}
    md = build_index(["2026-10-14.csv"], {}, live, tmp_path, history)
    row = next(line for line in md.splitlines() if "2026-10-14.csv](data/daily/" in line)
    assert "✅ Snapshot matched" in row
    assert "Historical match" not in row


def test_invalid_historical_log_evidence_cannot_claim_match():
    record = {
        "source_repo": "ipohbot-png/fama-price-tracker",
        "run_id": "1", "expected": 100, "fetched": 99,
        "status": "MISMATCH", "log_at_utc": "2026-10-01T00:00:00Z",
    }
    assert render_historical_status(record) == "⚠️ Invalid historical evidence"
    assert render_historical_status(None) == "⚪ Not audited"


def test_historical_log_loader_checks_schema(tmp_path):
    import json
    path = tmp_path / "history.json"
    path.write_text(json.dumps({"schema": "other", "dates": {}}), encoding="utf-8")
    import pytest
    with pytest.raises(ValueError):
        load_historical_checks(path)
