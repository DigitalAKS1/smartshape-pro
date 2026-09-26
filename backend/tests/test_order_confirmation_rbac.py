# backend/tests/test_order_confirmation_rbac.py
"""Sales gets a scoped orders grant; ownership (not just module level) must
be enforced, or a rep with 'own' scope could act on anyone's order.
mongomock — same pattern as tests/test_reorder_motion.py."""
import asyncio
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
REP_OWN = {"email": "parul@ss.in", "role": "sales_person",
           "module_permissions": {"orders": {"level": "read_write", "scope": "own"}}}
OTHER_REP = {"email": "amit@ss.in", "role": "sales_person",
             "module_permissions": {"orders": {"level": "read_write", "scope": "own"}}}


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(ordr, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")
    return d


def _run(coro):
    return asyncio.run(coro)


def test_sales_person_gets_a_default_orders_grant():
    perms = rbac.default_permissions_for_role("sales_person")
    assert perms["orders"] == {"level": "read_write", "can_download": True, "scope": "own"}


def test_store_can_act_on_any_order(db):
    order = {"order_id": "o1", "sales_person_email": "parul@ss.in", "order_status": "awaiting_confirmation"}
    ordr._assert_can_act_on_order(STORE, order)  # must not raise


def test_owning_rep_can_act_on_their_own_order(db):
    order = {"order_id": "o1", "sales_person_email": "parul@ss.in", "order_status": "awaiting_confirmation"}
    ordr._assert_can_act_on_order(REP_OWN, order)  # must not raise


def test_a_different_rep_is_blocked(db):
    order = {"order_id": "o1", "sales_person_email": "parul@ss.in", "order_status": "awaiting_confirmation"}
    with pytest.raises(Exception) as exc:
        ordr._assert_can_act_on_order(OTHER_REP, order)
    assert exc.value.status_code == 403


class _FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body


def _as(monkeypatch, user):
    async def _me(_request):
        return user
    monkeypatch.setattr(ordr, "get_current_user", _me)


async def _awaiting_order_owned_by_parul(db):
    await db.dies.insert_one({"die_id": "d1", "name": "Star", "code": "D-1",
                              "type": "standard", "stock_qty": 10, "reserved_qty": 0})
    await db.orders.insert_one({
        "order_id": "o1", "order_number": "ORD-1", "school_id": "s1",
        "sales_person_email": "parul@ss.in", "order_status": "awaiting_confirmation",
        "grand_total": 1000, "total_items": 1,
    })
    await db.order_items.insert_one({
        "order_item_id": "o1_i1", "order_id": "o1", "die_id": "d1",
        "die_name": "Star", "die_code": "D-1", "die_type": "standard",
        "quantity": 3, "status": "awaiting_confirmation",
    })


def test_a_different_rep_cannot_confirm(db, monkeypatch):
    async def go():
        await _awaiting_order_owned_by_parul(db)
        _as(monkeypatch, OTHER_REP)
        with pytest.raises(Exception) as exc:
            await ordr.confirm_order("o1", _FakeRequest())
        assert exc.value.status_code == 403
    _run(go())


def test_a_different_rep_cannot_reject(db, monkeypatch):
    async def go():
        await _awaiting_order_owned_by_parul(db)
        _as(monkeypatch, OTHER_REP)
        with pytest.raises(Exception) as exc:
            await ordr.reject_order("o1", _FakeRequest({"reason": "no"}))
        assert exc.value.status_code == 403
    _run(go())


def test_a_different_rep_cannot_add_an_item(db, monkeypatch):
    async def go():
        await _awaiting_order_owned_by_parul(db)
        _as(monkeypatch, OTHER_REP)
        with pytest.raises(Exception) as exc:
            await ordr.add_order_item("o1", _FakeRequest({"die_id": "d1", "quantity": 1}))
        assert exc.value.status_code == 403
    _run(go())


def test_a_different_rep_cannot_change_an_items_qty(db, monkeypatch):
    async def go():
        await _awaiting_order_owned_by_parul(db)
        _as(monkeypatch, OTHER_REP)
        with pytest.raises(Exception) as exc:
            await ordr.update_order_item_qty("o1", "o1_i1", _FakeRequest({"quantity": 9}))
        assert exc.value.status_code == 403
    _run(go())


def test_a_different_rep_cannot_remove_an_item(db, monkeypatch):
    async def go():
        await _awaiting_order_owned_by_parul(db)
        _as(monkeypatch, OTHER_REP)
        with pytest.raises(Exception) as exc:
            await ordr.remove_order_item("o1", "o1_i1", _FakeRequest())
        assert exc.value.status_code == 403
    _run(go())


def test_a_different_rep_cannot_log_a_call(db, monkeypatch):
    async def go():
        await _awaiting_order_owned_by_parul(db)
        _as(monkeypatch, OTHER_REP)
        with pytest.raises(Exception) as exc:
            await ordr.log_order_call("o1", _FakeRequest({"outcome": "connected"}))
        assert exc.value.status_code == 403
    _run(go())


def test_the_owning_rep_can_confirm(db, monkeypatch):
    async def go():
        await _awaiting_order_owned_by_parul(db)
        _as(monkeypatch, REP_OWN)
        resp = await ordr.confirm_order("o1", _FakeRequest())
        assert resp["message"] == "Order confirmed"
    _run(go())


def test_order_creation_denormalizes_the_owning_reps_email(db):
    async def go():
        await db.quotations.insert_one({
            "quotation_id": "q1", "quote_number": "Q-1", "school_id": "s1",
            "sales_person_email": "parul@ss.in", "grand_total": 1000,
        })
        order, created = await ordr.create_order_for_quotation(
            "q1", created_by="system", source="catalogue_submit",
            order_status="awaiting_confirmation")
        assert created is True
        assert order["sales_person_email"] == "parul@ss.in"
    _run(go())
