"""B2 backfill: dry-run writes NOTHING; --apply links, flags and un-stores."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

from migrations.link_dispatches_to_touches import link_dispatches_to_touches


@pytest.fixture()
def db():
    return AsyncMongoMockClient()["smartshape_test"]


def _run(coro):
    return asyncio.run(coro)


async def _seed(db):
    await db.schools.insert_one({"school_id": "s1", "school_name": "DPS", "is_deleted": False})
    await db.contacts.insert_one({"contact_id": "c9", "name": "No School", "school_id": ""})
    await db.mail_runs.insert_one({"run_id": "run_old", "name": "Drip - brochure - 2026-09-01",
                                   "is_drip_run": True, "send_date": "2026-09-01",
                                   "sequence_id": "seq1", "piece_type": "brochure",
                                   "school_ids": ["s1"], "counts": {"sent": 1}})
    # A dispatch that DOES have a matching touch (same lead, same day, same piece).
    await db.mail_touches.insert_one({
        "touch_id": "mt_old1", "run_id": "run_old", "school_id": "s1",
        "lead_id": "l1", "piece_type": "brochure", "verify_status": "pending",
        "planned_date": "2026-09-01", "sequence_id": "seq1",
        "enrollment_id": "e1", "step_number": 1, "created_at": "2026-09-01T06:00:00+00:00"})
    await db.physical_dispatches.insert_one({
        "dispatch_id": "pd_1", "lead_id": "l1", "lead_name": "R Sharma",
        "material_type": "brochure", "auto_from_drip": True, "needs_dispatch": True,
        "created_at": "2026-09-01T06:00:00+00:00"})
    # A school-less dispatch with NO touch at all - the 39-row production case.
    await db.physical_dispatches.insert_one({
        "dispatch_id": "pd_2", "lead_id": "", "contact_id": "c9", "lead_name": "No School",
        "material_type": "brochure", "material_name": "Quiz flyer",
        "auto_from_drip": True, "needs_dispatch": True,
        "created_at": "2026-09-02T06:00:00+00:00"})


def test_dry_run_writes_nothing(db):
    async def go():
        await _seed(db)
        out = await link_dispatches_to_touches(db, apply=False)
        assert out["total_dispatches_seen"] == 2
        assert out["linked"] == 1 and out["touches_created"] == 1
        d1 = await db.physical_dispatches.find_one({"dispatch_id": "pd_1"}, {"_id": 0})
        assert not d1.get("touch_id")
        assert d1.get("needs_dispatch") is True
        assert await db.mail_touches.count_documents({}) == 1
    _run(go())


def test_dry_run_leaves_every_collection_byte_identical(db):
    """Not just the two rows the other test samples - nothing at all may move."""
    async def go():
        await _seed(db)

        async def snapshot():
            out = {}
            for name in ("physical_dispatches", "mail_touches", "mail_runs",
                         "contacts", "schools"):
                rows = await db[name].find({}, {"_id": 0}).to_list(None)
                out[name] = sorted((repr(sorted(r.items(), key=lambda kv: kv[0]))
                                    for r in rows))
            return out

        before = await snapshot()
        await link_dispatches_to_touches(db, apply=False)
        assert await snapshot() == before, "a dry run wrote to the database"
    _run(go())


def test_apply_links_creates_and_unsets(db):
    async def go():
        await _seed(db)
        await link_dispatches_to_touches(db, apply=True)
        d1 = await db.physical_dispatches.find_one({"dispatch_id": "pd_1"}, {"_id": 0})
        assert d1["touch_id"] == "mt_old1"
        assert "needs_dispatch" not in d1
        t1 = await db.mail_touches.find_one({"touch_id": "mt_old1"}, {"_id": 0})
        assert "pd_1" in t1["dispatch_ids"]

        t2 = await db.mail_touches.find_one({"contact_ids": "c9"}, {"_id": 0})
        assert t2 is not None, "the school-less dispatch must become a visible flagged mailer"
        assert t2["verify_status"] == "needs_address"
        assert t2["recipient_names"] == ["No School"]
        d2 = await db.physical_dispatches.find_one({"dispatch_id": "pd_2"}, {"_id": 0})
        assert d2["touch_id"] == t2["touch_id"]
    _run(go())


def test_apply_is_idempotent(db):
    async def go():
        await _seed(db)
        await link_dispatches_to_touches(db, apply=True)
        second = await link_dispatches_to_touches(db, apply=True)
        assert second["linked"] == 0 and second["touches_created"] == 0
        assert second["marked_needs_address"] == 0
        assert second["unset_needs_dispatch"] == 0
        assert await db.mail_touches.count_documents({}) == 2
        # A third pass must also be a no-op, and must not spawn another run.
        third = await link_dispatches_to_touches(db, apply=True)
        assert third["linked"] == 0 and third["touches_created"] == 0
        assert await db.mail_touches.count_documents({}) == 2
        assert await db.mail_runs.count_documents({}) == 2
    _run(go())


def test_existing_school_less_touch_is_flagged_not_duplicated(db):
    async def go():
        await db.mail_touches.insert_one({
            "touch_id": "mt_blank", "run_id": "run_old", "school_id": "",
            "contact_ids": ["c9"], "piece_type": "brochure", "verify_status": "pending",
            "planned_date": "2026-09-02", "created_at": "2026-09-02T06:00:00+00:00"})
        out = await link_dispatches_to_touches(db, apply=True)
        assert out["marked_needs_address"] == 1
        t = await db.mail_touches.find_one({"touch_id": "mt_blank"}, {"_id": 0})
        assert t["verify_status"] == "needs_address"
    _run(go())


def test_a_sent_school_less_touch_is_never_reopened(db):
    async def go():
        await db.mail_touches.insert_one({
            "touch_id": "mt_done", "run_id": "run_old", "school_id": "",
            "contact_ids": ["c9"], "piece_type": "brochure", "verify_status": "sent",
            "posted_at": "2026-09-03T00:00:00+00:00",
            "planned_date": "2026-09-02", "created_at": "2026-09-02T06:00:00+00:00"})
        out = await link_dispatches_to_touches(db, apply=True)
        assert out["marked_needs_address"] == 0
        t = await db.mail_touches.find_one({"touch_id": "mt_done"}, {"_id": 0})
        assert t["verify_status"] == "sent", "a posted piece must never be re-opened"
    _run(go())


def test_a_dispatch_with_a_school_but_no_touch_is_skipped_not_guessed(db):
    async def go():
        await db.schools.insert_one({"school_id": "s2", "school_name": "Ryan",
                                     "is_deleted": False})
        await db.contacts.insert_one({"contact_id": "c4", "name": "Has School",
                                      "school_id": "s2"})
        await db.physical_dispatches.insert_one({
            "dispatch_id": "pd_9", "lead_id": "", "contact_id": "c4",
            "lead_name": "Has School", "material_type": "sample",
            "auto_from_drip": True, "created_at": "2026-09-05T06:00:00+00:00"})
        out = await link_dispatches_to_touches(db, apply=True)
        assert out["skipped_no_match"] == 1
        assert out["touches_created"] == 0
        d = await db.physical_dispatches.find_one({"dispatch_id": "pd_9"}, {"_id": 0})
        assert not d.get("touch_id"), "the migration must not invent a link"
    _run(go())


def test_enrollment_and_step_match_wins_over_the_day_heuristic(db):
    async def go():
        await db.mail_touches.insert_one({
            "touch_id": "mt_exact", "run_id": "run_old", "school_id": "s1",
            "lead_id": "l7", "piece_type": "brochure", "verify_status": "pending",
            "enrollment_id": "e7", "step_number": 2,
            "created_at": "2026-01-01T06:00:00+00:00"})
        await db.physical_dispatches.insert_one({
            "dispatch_id": "pd_7", "lead_id": "l7", "lead_name": "R Sharma",
            "material_type": "brochure", "auto_from_drip": True,
            "enrollment_id": "e7", "step_number": 2,
            "created_at": "2026-09-09T06:00:00+00:00"})
        out = await link_dispatches_to_touches(db, apply=True)
        assert out["linked"] == 1
        d = await db.physical_dispatches.find_one({"dispatch_id": "pd_7"}, {"_id": 0})
        assert d["touch_id"] == "mt_exact", "the exact join key must win"
    _run(go())
