# backend/tests/test_order_confirmation_edit_selection.py
"""Sales/Store can add/remove/change items on an awaiting-confirmation order
BEFORE confirming — same UI as editing a live order — but none of it may
reserve stock yet. Existing pending/confirmed-order editing must be
byte-for-byte unchanged (regression). mongomock — see test_reorder_motion.py."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.order_routes as ordr

STORE = {"email": "store@ss.in", "role": "store",
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


async def _die(db, die_id="d1", stock=10):
    await db.dies.insert_one({"die_id": die_id, "name": "Star", "code": "D-1",
                              "type": "standard", "stock_qty": stock, "reserved_qty": 0})


async def _order(db, order_id, status):
    await db.orders.insert_one({"order_id": order_id, "order_number": "ORD-1", "school_id": "s1",
                                "sales_person_email": "parul@ss.in", "order_status": status,
                                "grand_total": 0, "total_items": 0})


# ── New behaviour: awaiting-confirmation orders can be edited without reserving ──

def test_adding_an_item_to_an_awaiting_order_does_not_reserve(db):
    async def go():
        await _die(db)
        await _order(db, "o1", "awaiting_confirmation")
        await ordr.add_order_item("o1", FakeRequest({"die_id": "d1", "quantity": 4}))
        item = await db.order_items.find_one({"order_id": "o1"}, {"_id": 0})
        assert item["status"] == "awaiting_confirmation"
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 0
    _run(go())


def test_changing_qty_on_an_awaiting_order_does_not_touch_reservation(db):
    async def go():
        await _die(db)
        await _order(db, "o1", "awaiting_confirmation")
        await ordr.add_order_item("o1", FakeRequest({"die_id": "d1", "quantity": 4}))
        item = await db.order_items.find_one({"order_id": "o1"}, {"_id": 0})
        await ordr.update_order_item_qty("o1", item["order_item_id"], FakeRequest({"quantity": 9}))
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 0
    _run(go())


def test_removing_an_item_from_an_awaiting_order_releases_nothing(db):
    async def go():
        await _die(db)
        await _order(db, "o1", "awaiting_confirmation")
        await ordr.add_order_item("o1", FakeRequest({"die_id": "d1", "quantity": 4}))
        item = await db.order_items.find_one({"order_id": "o1"}, {"_id": 0})
        await ordr.remove_order_item("o1", item["order_item_id"], FakeRequest())
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 0
    _run(go())


def test_reconcile_on_an_awaiting_order_does_not_reserve(db):
    async def go():
        await _die(db)
        await _order(db, "o1", "awaiting_confirmation")
        summary = await ordr.reconcile_order_to_selection("o1", {"d1": 5})
        assert summary["added"] == 1
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 0
        item = await db.order_items.find_one({"order_id": "o1"}, {"_id": 0})
        assert item["status"] == "awaiting_confirmation"
    _run(go())


# ── Regression: existing pending/confirmed editing is unchanged ─────────────

def test_adding_an_item_to_a_pending_order_still_reserves_immediately(db):
    async def go():
        await _die(db)
        await _order(db, "o1", "pending")
        await ordr.add_order_item("o1", FakeRequest({"die_id": "d1", "quantity": 4}))
        item = await db.order_items.find_one({"order_id": "o1"}, {"_id": 0})
        assert item["status"] == "on_hold"
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 4
    _run(go())


def test_removing_an_item_from_a_pending_order_still_releases(db):
    async def go():
        await _die(db)
        await _order(db, "o1", "pending")
        await ordr.add_order_item("o1", FakeRequest({"die_id": "d1", "quantity": 4}))
        item = await db.order_items.find_one({"order_id": "o1"}, {"_id": 0})
        await ordr.remove_order_item("o1", item["order_item_id"], FakeRequest())
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 0
    _run(go())


def test_reconcile_on_a_pending_order_still_reserves(db):
    async def go():
        await _die(db)
        await _order(db, "o1", "pending")
        await ordr.reconcile_order_to_selection("o1", {"d1": 5})
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 5
    _run(go())
