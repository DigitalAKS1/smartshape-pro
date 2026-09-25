"""C-1 regression: snapshot_and_delete must merge duplicate-collection plan entries.

Needs a real local Mongo (DB_NAME=smartshape_test, MONGO_URL=mongodb://localhost:27017).
Motor is event-loop-bound, so the client is built inside the test's own event loop
(via the pytest-asyncio fixture) rather than imported at module scope.
"""
import os
import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient

_DB_NAME = os.getenv("DB_NAME", "smartshape_test")
assert _DB_NAME.endswith("_test") or _DB_NAME == "mtt_ci", f"refusing non-test DB: {_DB_NAME}"
_MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")

import audit_backup as ab

_COLL = "cascade_merge_test_rows"


@pytest_asyncio.fixture
async def dbh(monkeypatch):
    client = AsyncIOMotorClient(_MONGO_URL)
    dbh = client[_DB_NAME]
    monkeypatch.setattr(ab, "db", dbh)

    async def _clean():
        await dbh[_COLL].delete_many({})
        await dbh.audit_backups.delete_many({"root_id": "merge_test_root"})

    await _clean()
    yield dbh
    await _clean()
    client.close()


@pytest.mark.asyncio
async def test_duplicate_collection_entries_are_merged_and_fully_backed_up(dbh):
    # Row A matches only query 1 (lead_id), row B matches only query 2 (contact_id),
    # row C matches BOTH (a converted contact's row carrying both ids).
    await dbh[_COLL].insert_many([
        {"row_id": "A", "lead_id": "l1"},
        {"row_id": "B", "contact_id": "c1"},
        {"row_id": "C", "lead_id": "l1", "contact_id": "c1"},
        {"row_id": "D", "lead_id": "other"},  # must survive untouched
    ])

    plan = [
        (_COLL, {"lead_id": "l1"}),
        (_COLL, {"contact_id": "c1"}),
    ]

    result = await ab.snapshot_and_delete(
        plan, root_type="contact", root_id="merge_test_root", root_label="Merge Test",
        deleted_by="tester@x.com", reason="unit test")

    # 1) both queries' rows backed up, 3) counts accurate, 4) row C stored ONCE
    assert result["counts"][_COLL] == 3
    assert result["total"] == 3

    chunks = await dbh.audit_backups.find(
        {"backup_id": result["backup_id"], "kind": ab.CHUNK}, {"_id": 0}).to_list(100)
    all_docs = []
    for ch in chunks:
        all_docs.extend(ch["docs"])
    row_ids = sorted(d["row_id"] for d in all_docs)
    assert row_ids == ["A", "B", "C"]          # no duplicate of C
    assert len(all_docs) == 3                   # exactly once each

    # 2) both sets of rows actually deleted; unrelated row D survives
    remaining = await dbh[_COLL].find({}, {"_id": 0}).to_list(100)
    assert sorted(r["row_id"] for r in remaining) == ["D"]

    manifest = await dbh.audit_backups.find_one(
        {"backup_id": result["backup_id"], "kind": ab.MANIFEST}, {"_id": 0})
    assert manifest["counts"][_COLL] == 3
    assert manifest["total"] == 3


@pytest.mark.asyncio
async def test_merge_plan_helper_combines_and_preserves_single_queries():
    plan = [
        ("a", {"x": 1}),
        ("b", {"y": 1}),
        ("a", {"x": 2}),
    ]
    merged = ab._merge_plan(plan)
    merged_dict = dict(merged)
    assert merged_dict["b"] == {"y": 1}
    assert merged_dict["a"] == {"$or": [{"x": 1}, {"x": 2}]}
    assert len(merged) == 2   # one entry per collection


@pytest.mark.asyncio
async def test_preview_counts_merges_duplicate_collections(dbh):
    """preview_counts must count the union, not overwrite, for duplicate collection entries."""
    # Same setup as test_duplicate_collection_entries_are_merged_and_fully_backed_up
    await dbh[_COLL].insert_many([
        {"row_id": "A", "lead_id": "l1"},
        {"row_id": "B", "contact_id": "c1"},
        {"row_id": "C", "lead_id": "l1", "contact_id": "c1"},
        {"row_id": "D", "lead_id": "other"},  # must not be counted
    ])

    plan = [
        (_COLL, {"lead_id": "l1"}),
        (_COLL, {"contact_id": "c1"}),
    ]

    # preview_counts should return 3 (union of A, B, C), not 2 or 1
    preview = await ab.preview_counts(plan)
    assert preview[_COLL] == 3, f"expected union count 3, got {preview.get(_COLL)}"

    # Verify this matches what snapshot_and_delete reports
    result = await ab.snapshot_and_delete(
        plan, root_type="contact", root_id="preview_test_root", root_label="Preview Test",
        deleted_by="tester@x.com", reason="unit test")
    assert result["counts"][_COLL] == 3, f"snapshot_and_delete count mismatch: {result['counts']}"
    assert preview[_COLL] == result["counts"][_COLL], "preview and delete counts differ"
