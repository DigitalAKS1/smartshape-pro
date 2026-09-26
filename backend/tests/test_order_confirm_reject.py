# backend/tests/test_order_confirm_reject.py
"""Confirm reserves stock and moves the order to 'pending'; Reject requires a
reason and moves it to 'cancelled' with nothing to release. Both must refuse
to act twice, and the generic status endpoint must refuse to touch an
awaiting-confirmation order at all. mongomock — see tests/test_reorder_motion.py."""
import asyncio
import json
import os
from datetime import datetime, timezone

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


async def _awaiting_order(db, order_id="o1", die_id="d1", qty=3, stock=10):
    await db.dies.insert_one({"die_id": die_id, "name": "Star", "code": "D-1",
                              "type": "standard", "stock_qty": stock, "reserved_qty": 0})
    await db.orders.insert_one({
        "order_id": order_id, "order_number": "ORD-1", "school_id": "s1",
        "sales_person_email": "parul@ss.in", "order_status": "awaiting_confirmation",
        "grand_total": 1000, "total_items": 1,
    })
    await db.order_items.insert_one({
        "order_item_id": f"{order_id}_i1", "order_id": order_id, "die_id": die_id,
        "die_name": "Star", "die_code": "D-1", "die_type": "standard",
        "quantity": qty, "status": "awaiting_confirmation",
    })


def test_confirm_reserves_stock_and_moves_to_pending(db):
    async def go():
        await _awaiting_order(db)
        resp = await ordr.confirm_order("o1", FakeRequest())
        assert resp["message"] == "Order confirmed"

        order = await db.orders.find_one({"order_id": "o1"}, {"_id": 0})
        assert order["order_status"] == "pending"
        item = await db.order_items.find_one({"order_item_id": "o1_i1"}, {"_id": 0})
        assert item["status"] == "on_hold"
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 3
    _run(go())


def test_two_orders_confirming_the_same_scarce_die_both_succeed_second_raises_alert(db):
    async def go():
        await _awaiting_order(db, order_id="o1", die_id="d1", qty=6, stock=10)
        await db.orders.insert_one({
            "order_id": "o2", "order_number": "ORD-2", "school_id": "s2",
            "sales_person_email": "amit@ss.in", "order_status": "awaiting_confirmation",
            "grand_total": 500, "total_items": 1,
        })
        await db.order_items.insert_one({
            "order_item_id": "o2_i1", "order_id": "o2", "die_id": "d1",
            "die_name": "Star", "die_code": "D-1", "die_type": "standard",
            "quantity": 6, "status": "awaiting_confirmation",
        })

        await ordr.confirm_order("o1", FakeRequest())
        assert (await db.purchase_alerts.count_documents({})) == 0, "first confirm fits in stock"

        await ordr.confirm_order("o2", FakeRequest())  # 6 + 6 = 12 > 10 in stock
        order2 = await db.orders.find_one({"order_id": "o2"}, {"_id": 0})
        assert order2["order_status"] == "pending", "second confirm still succeeds — it does not oversell silently, it alerts"
        alerts = await db.purchase_alerts.find({}, {"_id": 0}).to_list(10)
        assert len(alerts) == 1
        assert alerts[0]["shortage_qty"] == 2
    _run(go())


def test_confirming_twice_is_rejected(db):
    async def go():
        await _awaiting_order(db)
        await ordr.confirm_order("o1", FakeRequest())
        with pytest.raises(Exception) as exc:
            await ordr.confirm_order("o1", FakeRequest())
        assert "400" in str(exc.value) or "awaiting confirmation" in str(exc.value).lower()
    _run(go())


def test_confirming_an_order_with_no_items_still_succeeds(db):
    async def go():
        await db.orders.insert_one({
            "order_id": "o_empty", "order_number": "ORD-3", "school_id": "s3",
            "sales_person_email": "parul@ss.in", "order_status": "awaiting_confirmation",
            "grand_total": 0, "total_items": 0,
        })
        resp = await ordr.confirm_order("o_empty", FakeRequest())
        assert resp["items_reserved"] == 0
        order = await db.orders.find_one({"order_id": "o_empty"}, {"_id": 0})
        assert order["order_status"] == "pending"
    _run(go())


def test_reject_requires_a_reason(db):
    async def go():
        await _awaiting_order(db)
        with pytest.raises(Exception) as exc:
            await ordr.reject_order("o1", FakeRequest({"reason": "  "}))
        assert "400" in str(exc.value) or "reason" in str(exc.value).lower()
    _run(go())


def test_reject_cancels_and_releases_nothing(db):
    async def go():
        await _awaiting_order(db)
        resp = await ordr.reject_order("o1", FakeRequest({"reason": "Duplicate submission"}))
        assert resp["message"] == "Order rejected"

        order = await db.orders.find_one({"order_id": "o1"}, {"_id": 0})
        assert order["order_status"] == "cancelled"
        item = await db.order_items.find_one({"order_item_id": "o1_i1"}, {"_id": 0})
        assert item["status"] == "cancelled"
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 0, "nothing was reserved, so nothing to release"
    _run(go())


def test_generic_status_endpoint_refuses_an_awaiting_confirmation_order(db):
    async def go():
        await _awaiting_order(db)
        with pytest.raises(Exception) as exc:
            await ordr.update_order_status("o1", FakeRequest({"status": "confirmed"}))
        assert "400" in str(exc.value) or "confirm" in str(exc.value).lower()
        order = await db.orders.find_one({"order_id": "o1"}, {"_id": 0})
        assert order["order_status"] == "awaiting_confirmation", "must not have been changed"
    _run(go())
