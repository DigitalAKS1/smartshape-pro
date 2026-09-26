# backend/tests/test_order_confirmation_creation.py
"""An order created with order_status='awaiting_confirmation' must not
commit any stock — its items sit outside compute_committed() until Confirm
runs (Task 4). mongomock — same pattern as tests/test_reorder_motion.py."""
import asyncio
import os
from datetime import datetime, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.order_routes as ordr


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(ordr, "db", d, raising=False)
    return d


def _run(coro):
    return asyncio.run(coro)


async def _setup_quotation_and_selection(db):
    await db.quotations.insert_one({
        "quotation_id": "q1", "quote_number": "Q-1", "school_id": "s1", "school_name": "DPS",
        "sales_person_email": "parul@ss.in", "grand_total": 1000,
    })
    await db.dies.insert_one({"die_id": "d1", "name": "Star", "code": "D-1", "type": "standard",
                              "stock_qty": 10, "reserved_qty": 0})
    await db.catalogue_selections.insert_one({"selection_id": "sel1", "quotation_id": "q1"})
    await db.catalogue_selection_items.insert_one({
        "catalogue_selection_id": "sel1", "die_id": "d1", "die_name": "Star",
        "die_code": "D-1", "die_type": "standard", "quantity": 3,
    })


def test_awaiting_confirmation_order_reserves_nothing(db):
    async def go():
        await _setup_quotation_and_selection(db)
        order, created = await ordr.create_order_for_quotation(
            "q1", created_by="system", source="catalogue_submit",
            order_status="awaiting_confirmation")
        assert created is True
        assert order["order_status"] == "awaiting_confirmation"

        items = await db.order_items.find({"order_id": order["order_id"]}, {"_id": 0}).to_list(10)
        assert len(items) == 1
        assert items[0]["status"] == "awaiting_confirmation"

        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 0, "an awaiting-confirmation order must not reserve stock"
        committed = await ordr.compute_committed("d1")
        assert committed == 0, "compute_committed() must not count an awaiting-confirmation line either"
    _run(go())


def test_default_order_status_is_unchanged_for_existing_callers(db):
    async def go():
        await _setup_quotation_and_selection(db)
        order, created = await ordr.create_order_for_quotation("q1", created_by="parul@ss.in", source="manual")
        assert order["order_status"] == "pending"
        items = await db.order_items.find({"order_id": order["order_id"]}, {"_id": 0}).to_list(10)
        assert items[0]["status"] == "on_hold", "manual creation must keep committing stock immediately"
    _run(go())
