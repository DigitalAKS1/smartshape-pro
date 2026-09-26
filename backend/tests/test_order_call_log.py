# backend/tests/test_order_call_log.py
"""A call about a submitted selection is optional — never required to
Confirm/Edit/Reject — and lives in the same call_notes collection as contact
calls, keyed by order_id instead. mongomock — see test_reorder_motion.py."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.order_routes as ordr
import crm_contact_calls as cc

STORE = {"email": "store@ss.in", "role": "store", "name": "Store Team",
         "module_permissions": {"orders": {"level": "read_write", "scope": "all"}}}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(ordr, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")

    async def _me(_request):
        return STORE
    monkeypatch.setattr(ordr, "get_current_user", _me)
    return d


def _run(coro):
    return asyncio.run(coro)


def test_build_order_call_note_shape():
    order = {"order_id": "o1"}
    note = cc.build_order_call_note(order, STORE, "connected", "Confirmed qty with the school", "2026-09-25T00:00:00Z")
    assert note["order_id"] == "o1"
    assert note["contact_id"] is None
    assert note["lead_id"] is None
    assert note["outcome"] == "connected"
    assert note["created_by"] == "store@ss.in"


def test_logging_a_call_persists_and_lists(db):
    async def go():
        await db.orders.insert_one({"order_id": "o1", "sales_person_email": "parul@ss.in",
                                    "order_status": "awaiting_confirmation"})
        result = await ordr.log_order_call("o1", FakeRequest({"outcome": "connected", "content": "Will confirm 20 units"}))
        assert result["outcome"] == "connected"

        calls = await ordr.list_order_calls("o1", FakeRequest())
        assert len(calls) == 1
        assert calls[0]["content"] == "Will confirm 20 units"

        timeline = await db.order_timeline.find({"order_id": "o1"}, {"_id": 0}).to_list(10)
        assert any("Call logged" in t["note"] for t in timeline)
    _run(go())


def test_invalid_outcome_rejected(db):
    async def go():
        await db.orders.insert_one({"order_id": "o1", "sales_person_email": "parul@ss.in",
                                    "order_status": "awaiting_confirmation"})
        with pytest.raises(Exception) as exc:
            await ordr.log_order_call("o1", FakeRequest({"outcome": "not-a-real-outcome"}))
        assert "422" in str(exc.value)
    _run(go())


def test_call_logging_never_blocks_confirm(db):
    # No call needed at all — Confirm must work with zero calls logged.
    async def go():
        await db.dies.insert_one({"die_id": "d1", "name": "Star", "code": "D-1",
                                  "type": "standard", "stock_qty": 10, "reserved_qty": 0})
        await db.orders.insert_one({"order_id": "o1", "sales_person_email": "parul@ss.in",
                                    "order_status": "awaiting_confirmation", "total_items": 0})
        assert (await ordr.list_order_calls("o1", FakeRequest())) == []
        resp = await ordr.confirm_order("o1", FakeRequest())
        assert resp["message"] == "Order confirmed"
    _run(go())
