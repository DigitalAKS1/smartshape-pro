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
    assert "403" in str(exc.value) or "own" in str(exc.value).lower()


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
