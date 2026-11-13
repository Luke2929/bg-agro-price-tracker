"""Verification manifest must not certify untested or altered CSVs."""

import json

import pytest

from scripts.daily_audit import SCHEMA, load_audit, persist_verified_fetches, sha256_file


def _row(**override):
    entry = {
        "date": "2026-11-13", "expected": 2, "fetched": 2,
        "written": 2, "preserved_fields": 0, "status": "ok",
    }
    entry.update(override)
    return entry


def test_verified_fetch_audit_is_atomic_and_idempotent(tmp_path):
    archive = tmp_path / "daily"
    archive.mkdir()
    csv_path = archive / "2026-11-13.csv"
    csv_path.write_text("priceid\n1\n2\n", encoding="utf-8")
    manifest = tmp_path / "fama_fetch_audit.json"

    assert persist_verified_fetches(
        manifest, archive, [_row()],
        verified_at_utc="2026-11-13T03:00:00+00:00", run_id="123",
    )
    saved = load_audit(manifest)
    verified = saved["dates"]["2026-11-13"]
    assert saved["schema"] == SCHEMA
    assert verified["csv_sha256"] == sha256_file(csv_path)
    assert verified["run_id"] == "123"
    first_content = manifest.read_bytes()
    assert not persist_verified_fetches(
        manifest, archive, [_row()],
        verified_at_utc="2026-11-13T04:00:00+00:00", run_id="456",
    )
    assert manifest.read_bytes() == first_content

    csv_path.write_text("priceid\n1\n2\n3\n", encoding="utf-8")
    assert persist_verified_fetches(
        manifest, archive, [_row(written=3, status="ok+archive")],
        verified_at_utc="2026-11-13T05:00:00+00:00",
    )
    assert load_audit(manifest)["dates"]["2026-11-13"]["archive_rows"] == 3


@pytest.mark.parametrize("bad", [
    _row(expected=5, fetched=2, status="MISMATCH"),
    _row(status="MISMATCH"),
    _row(expected=0, fetched=0),
])
def test_bad_fetch_cannot_be_marked_verified(tmp_path, bad):
    archive = tmp_path / "daily"
    archive.mkdir()
    (archive / "2026-11-13.csv").write_text("priceid\n1\n2\n", encoding="utf-8")
    manifest = tmp_path / "audit.json"
    with pytest.raises(ValueError):
        persist_verified_fetches(manifest, archive, [bad])
    assert not manifest.exists()


def test_refuses_corrupt_manifest(tmp_path):
    path = tmp_path / "audit.json"
    path.write_text(json.dumps({"dates": {"2026-11-13": {}}}), encoding="utf-8")
    with pytest.raises(ValueError):
        load_audit(path)
