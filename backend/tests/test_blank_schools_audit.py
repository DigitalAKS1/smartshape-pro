"""Read-only audit of blank (junk-import) schools. mongomock, no live DB.
Run: python -m pytest tests/test_blank_schools_audit.py -q
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest

import routes.crm_maintenance_routes as m


class _Req:
    """Minimal stand-in; get_current_user is monkeypatched so it's never read."""


@pytest.fixture()
def db(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(m, "db", d)
    # bypass auth: audit is admin-only, we assert logic not the gate here
    async def _fake_user(request):
        return {"email": "info@smartshape.in", "role": "admin"}
    monkeypatch.setattr(m, "get_current_user", _fake_user)
    return d


def _run(coro):
    return asyncio.run(coro)


def test_is_blank():
    assert m._is_blank({"school_name": ""})
    assert m._is_blank({"school_name": "   "})
    assert m._is_blank({})
    assert not m._is_blank({"school_name": "Delhi Public School"})


def test_audit_counts_blank_childless_vs_referenced(db):
    async def go():
        await db.schools.insert_many([
            {"school_id": "s_named", "school_name": "Real School", "created_by": "a@x"},
            {"school_id": "s_blank1", "school_name": "", "created_by": "care@x",
             "created_at": "2026-07-01T00:00:00"},
            {"school_id": "s_blank2", "school_name": "   ", "created_by": "care@x",
             "created_at": "2026-07-02T00:00:00"},
            {"school_id": "s_blank3", "school_name": "", "created_by": "care@x",
             "created_at": "2026-07-03T00:00:00"},
        ])
        # s_blank3 has a lead → NOT childless; s_blank1/2 are safe to delete.
        await db.leads.insert_one({"lead_id": "l1", "school_id": "s_blank3"})
        await db.contacts.insert_one({"contact_id": "c1", "school_id": "s_named"})

        res = await m.blank_schools_audit(_Req())
        assert res["total_schools"] == 4
        assert res["blank_schools"] == 3
        assert res["blank_childless"] == 2
        assert res["blank_with_children"] == 1
        assert res["children_breakdown"]["leads"] == 1
        assert res["by_creator"] == {"care@x": 3}
        assert res["created_at_earliest"] == "2026-07-01T00:00:00"
        assert res["created_at_latest"] == "2026-07-03T00:00:00"
        assert "s_blank3" in res["sample_with_children_ids"]
        assert set(res["sample_childless_ids"]) == {"s_blank1", "s_blank2"}

    _run(go())


def test_audit_ignores_soft_deleted(db):
    async def go():
        await db.schools.insert_many([
            {"school_id": "s1", "school_name": "", "created_by": "x"},
            {"school_id": "s2", "school_name": "", "created_by": "x", "is_deleted": True},
        ])
        res = await m.blank_schools_audit(_Req())
        assert res["total_schools"] == 1
        assert res["blank_schools"] == 1
    _run(go())
