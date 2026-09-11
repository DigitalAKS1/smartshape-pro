"""cancel_stale_drip_enrollments — bulk-cancel drip enrolments the duplicate
executor faked its way through, so nobody gets a stale automated message.
mongomock.
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

from migrations.cancel_stale_drip_enrollments import cancel_stale_drip_enrollments


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def db():
    return AsyncMongoMockClient()["smartshape_test"]


def test_active_and_completed_are_both_cancelled_with_reason_and_prior_status(db):
    async def go():
        await db.drip_enrollments.insert_one({
            "enrollment_id": "e_active", "status": "active", "current_step": 1,
        })
        await db.drip_enrollments.insert_one({
            "enrollment_id": "e_done", "status": "completed", "current_step": 3,
            "completed_at": "2026-06-01T00:00:00+00:00",
        })
        result = await cancel_stale_drip_enrollments(db)
        assert result["cancelled_from_active"] == 1
        assert result["cancelled_from_completed"] == 1
        assert result["total_cancelled"] == 2

        active = await db.drip_enrollments.find_one({"enrollment_id": "e_active"})
        assert active["status"] == "cancelled"
        assert active["status_before_cancel"] == "active"
        assert active["cancel_reason"]
        assert active["cancelled_at"]

        done = await db.drip_enrollments.find_one({"enrollment_id": "e_done"})
        assert done["status"] == "cancelled"
        assert done["status_before_cancel"] == "completed"
        assert done["cancel_reason"]
        assert done["cancelled_at"]
        # The original completion timestamp is preserved, not overwritten.
        assert done["completed_at"] == "2026-06-01T00:00:00+00:00"
    _run(go())


def test_paused_is_also_cancelled_with_reason_and_prior_status(db):
    async def go():
        await db.drip_enrollments.insert_one({
            "enrollment_id": "e_paused", "status": "paused", "current_step": 2,
            "paused_reason": "3 consecutive send failures",
        })
        result = await cancel_stale_drip_enrollments(db)
        assert result["cancelled_from_paused"] == 1
        assert result["total_cancelled"] == 1

        paused = await db.drip_enrollments.find_one({"enrollment_id": "e_paused"})
        assert paused["status"] == "cancelled"
        assert paused["status_before_cancel"] == "paused"
        assert paused["cancel_reason"]
        assert paused["cancelled_at"]
    _run(go())


def test_an_already_cancelled_enrollment_is_untouched(db):
    async def go():
        await db.drip_enrollments.insert_one({
            "enrollment_id": "e_old_cancel", "status": "cancelled",
            "current_step": 1,
        })
        result = await cancel_stale_drip_enrollments(db)
        assert result["total_cancelled"] == 0

        doc = await db.drip_enrollments.find_one({"enrollment_id": "e_old_cancel"})
        assert doc["status"] == "cancelled"
        assert "status_before_cancel" not in doc
        assert "cancel_reason" not in doc
        assert "cancelled_at" not in doc
    _run(go())


def test_does_not_touch_whatsapp_logs(db):
    async def go():
        await db.drip_enrollments.insert_one({"enrollment_id": "e1", "status": "active"})
        await db.whatsapp_logs.insert_one({
            "log_id": "wl1", "status": "queued", "send_mode": "drip",
        })
        await cancel_stale_drip_enrollments(db)
        log = await db.whatsapp_logs.find_one({"log_id": "wl1"})
        assert log["status"] == "queued"
    _run(go())


def test_second_run_changes_nothing(db):
    async def go():
        await db.drip_enrollments.insert_one({"enrollment_id": "e1", "status": "active"})
        await db.drip_enrollments.insert_one({"enrollment_id": "e2", "status": "completed"})
        first = await cancel_stale_drip_enrollments(db)
        assert first["total_cancelled"] == 2
        second = await cancel_stale_drip_enrollments(db)
        assert second["total_cancelled"] == 0
        assert second["cancelled_from_active"] == 0
        assert second["cancelled_from_completed"] == 0
    _run(go())
