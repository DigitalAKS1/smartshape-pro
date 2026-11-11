"""Phase 3-4: opt-in reorder drip — schools due to reorder (app orders + old orders)
are enrolled daily into active sequences with trigger "reorder_due"."""
import asyncio
import json
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.crm_routes as crm
import routes.drip_routes as drip
import services.reorder_drip as rd

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body

    async def body(self):
        return json.dumps(self._body).encode()


def _run(c):
    return asyncio.run(c)


def _date_ago(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    for m in (crm, drip):
        monkeypatch.setattr(m, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)

    async def _me(_r):
        return ADMIN
    monkeypatch.setattr(drip, "get_current_user", _me)

    async def _noop(*a, **k):
        return None
    for name in ("get_cached", "set_cached", "invalidate"):
        monkeypatch.setattr(crm, name, _noop, raising=False)
    _run(d.schools.insert_many([
        {"school_id": "due", "school_name": "Due School", "assigned_to": "rep@x.in"},
        {"school_id": "fresh", "school_name": "Fresh School", "assigned_to": "rep@x.in"},
        {"school_id": "never", "school_name": "Never Bought"},
    ]))
    _run(d.past_purchases.insert_many([
        {"purchase_id": "p1", "school_id": "due", "purchase_date": _date_ago(400), "is_deleted": False, "items": []},
        {"purchase_id": "p2", "school_id": "fresh", "purchase_date": _date_ago(20), "is_deleted": False, "items": []},
    ]))
    return d


def _seq(db, trigger="reorder_due", active=True, sid="drip_r1", deal_type="Reorder Dies"):
    _run(db.drip_sequences.insert_one({
        "sequence_id": sid, "name": f"Reorder {sid}", "trigger": trigger, "is_active": active,
        "deal_type": deal_type, "steps": [{"day": 0, "delay_days": 0, "channel": "email", "message": "New dies!"}]}))


def test_enrolls_due_school_once(db):
    _seq(db)
    out = _run(rd.run_reorder_drip(db))
    assert out["enrolled"] == 1
    enr = _run(db.drip_enrollments.find_one({"school_id": "due"}))
    assert enr["sequence_id"] == "drip_r1" and enr["enrolled_by"] == "system:reorder_due"
    lead = _run(db.leads.find_one({"lead_id": enr["lead_id"]}))
    assert lead["deal_type"] == "Reorder Dies"
    assert _run(db.drip_enrollments.count_documents({"school_id": "fresh"})) == 0
    # second run: the open reorder deal (and the recent enrolment) keep it out
    assert _run(rd.run_reorder_drip(db))["enrolled"] == 0
    assert _run(db.drip_enrollments.count_documents({})) == 1


def test_recent_enrollment_blocks_reenroll_even_after_deal_closed(db):
    _seq(db)
    _run(rd.run_reorder_drip(db))
    _run(db.leads.update_many({}, {"$set": {"stage": "lost"}}))          # deal closed, school due again
    _run(db.drip_enrollments.update_many({}, {"$set": {"status": "completed"}}))
    assert _run(rd.run_reorder_drip(db))["enrolled"] == 0
    old = (datetime.now(timezone.utc) - timedelta(days=rd.REENROLL_AFTER_DAYS + 1)).isoformat()
    _run(db.drip_enrollments.update_many({}, {"$set": {"enrolled_at": old}}))
    assert _run(rd.run_reorder_drip(db))["enrolled"] == 1


def test_no_reorder_sequence_means_nothing_happens(db):
    _seq(db, trigger="manual")
    _seq(db, active=False, sid="drip_off")
    out = _run(rd.run_reorder_drip(db))
    assert out == {"sequences": 0, "due": 0, "enrolled": 0}
    assert _run(db.drip_enrollments.count_documents({})) == 0


def test_preview_counts_without_writing(db):
    _seq(db)
    out = _run(rd.run_reorder_drip(db, dry_run=True))
    assert out["sequences"] == 1 and out["due"] == 1 and out["enrolled"] == 0
    assert _run(db.drip_enrollments.count_documents({})) == 0


def test_sequence_accepts_deal_type(db):
    out = _run(drip.create_sequence(FakeRequest({"name": "Win back", "trigger": "reorder_due", "deal_type": "Reorder Dies",
                                                 "steps": [{"day": 0, "channel": "email", "message": "hi"}]})))
    assert out["deal_type"] == "Reorder Dies" and out["trigger"] == "reorder_due"
    out = _run(drip.update_sequence(out["sequence_id"], FakeRequest({"deal_type": "New Dies"})))
    assert out["deal_type"] == "New Dies"


def test_run_endpoint_admin_only(db, monkeypatch):
    _seq(db)
    assert _run(drip.reorder_drip_run(FakeRequest({"dry_run": True})))["due"] == 1

    async def _rep(_r):
        return {"email": "rep@x.in", "role": "sales", "module_permissions": {"leads": {"level": "read_write", "scope": "own"}}}
    monkeypatch.setattr(drip, "get_current_user", _rep)
    with pytest.raises(HTTPException) as e:
        _run(drip.reorder_drip_run(FakeRequest({})))
    assert e.value.status_code == 403
