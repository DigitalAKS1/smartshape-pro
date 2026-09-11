"""PUT /drip/enrollments/{id}/resume must refuse a migration-cancelled
enrolment, not silently fire its stale step.

cancel_stale_drip_enrollments.py bulk-cancelled every enrolment the removed
duplicate executor (run_auto_reminders) had walked forward without ever
really delivering anything, and marked each with `cancel_reason` +
`status_before_cancel`. The owner's decision was "cancel all, re-enrol
deliberately" — so resuming one of those must not silently fire whatever
stale step it was frozen at. An ordinary cancelled enrolment (no
`cancel_reason`) is unaffected and keeps its existing resume behaviour.
mongomock.
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import routes.drip_routes as drip

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}


class FakeRequest:
    def __init__(self, body=None, params=None):
        self._body = body or {}
        self.query_params = params or {}

    async def json(self):
        return self._body


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(drip, "db", d, raising=False)

    async def _me(_request):
        return ADMIN
    monkeypatch.setattr(drip, "get_current_user", _me)
    return d


def _run(coro):
    return asyncio.run(coro)


def test_resume_refused_for_migration_cancelled_enrollment(db):
    async def go():
        await db.drip_enrollments.insert_one({
            "enrollment_id": "enr1", "lead_id": "lead1", "sequence_id": "seq1",
            "status": "cancelled", "current_step": 2,
            "next_step_at": "2020-01-01T00:00:00+00:00",
            "status_before_cancel": "active",
            "cancel_reason": "Consumed by a duplicate drip executor...",
            "cancelled_at": "2026-09-10T00:00:00+00:00",
        })

        with pytest.raises(HTTPException) as exc_info:
            await drip.resume_enrollment("enr1", FakeRequest())
        assert exc_info.value.status_code == 409

        # Untouched — still cancelled, no fields disturbed.
        enr = await db.drip_enrollments.find_one({"enrollment_id": "enr1"})
        assert enr["status"] == "cancelled"
        assert enr["cancel_reason"]
    _run(go())


def test_resume_still_works_for_an_ordinary_cancelled_enrollment(db):
    async def go():
        await db.drip_enrollments.insert_one({
            "enrollment_id": "enr2", "lead_id": "lead2", "sequence_id": "seq1",
            "status": "cancelled", "current_step": 0,
            "next_step_at": "2020-01-01T00:00:00+00:00",
        })

        out = await drip.resume_enrollment("enr2", FakeRequest())
        assert out["status"] == "active"

        enr = await db.drip_enrollments.find_one({"enrollment_id": "enr2"})
        assert enr["status"] == "active"
    _run(go())


def test_resume_still_works_for_a_paused_enrollment(db):
    async def go():
        await db.drip_enrollments.insert_one({
            "enrollment_id": "enr3", "lead_id": "lead3", "sequence_id": "seq1",
            "status": "paused", "current_step": 1,
            "next_step_at": "2020-01-01T00:00:00+00:00",
            "paused_reason": "3 consecutive send failures",
        })

        out = await drip.resume_enrollment("enr3", FakeRequest())
        assert out["status"] == "active"
        assert out["paused_reason"] == ""
    _run(go())
