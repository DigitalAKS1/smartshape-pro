# backend/tests/test_school_portal_catalogue.py
"""The School Portal's real item-picker: a school browses active, visible
dies and submits a selection, which becomes an awaiting_confirmation order —
reusing create_order_for_quotation (no stock reserved yet, sales_person_email
denormalized from the school's assigned rep) rather than a parallel path.
mongomock — see tests/test_reorder_motion.py."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.school_routes as sr
import routes.order_routes as ordr


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}
        self.cookies = {}
        self.headers = {}

    async def json(self):
        return self._body


SCHOOL = {"school_id": "s1", "school_name": "Delhi Public School", "assigned_to": "parul@ss.in"}


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(sr, "db", d, raising=False)
    monkeypatch.setattr(ordr, "db", d, raising=False)

    async def _me(_request):
        return SCHOOL
    monkeypatch.setattr(sr, "get_current_school", _me)
    return d


def _run(coro):
    return asyncio.run(coro)


async def _seed_dies(db):
    await db.dies.insert_one({"die_id": "d1", "name": "Star", "code": "D-1", "type": "standard",
                              "is_active": True, "stock_qty": 10, "reserved_qty": 0})
    await db.dies.insert_one({"die_id": "d2", "name": "Heart", "code": "D-2", "type": "standard",
                              "is_active": False, "stock_qty": 10, "reserved_qty": 0})  # inactive — hidden


def test_catalogue_lists_only_active_dies(db):
    async def go():
        await _seed_dies(db)
        resp = await sr.school_catalogue(FakeRequest())
        codes = {d["code"] for d in resp["dies"]}
        assert codes == {"D-1"}
        assert resp["school_name"] == "Delhi Public School"
    _run(go())


def test_submitting_a_selection_creates_an_awaiting_confirmation_order(db):
    async def go():
        await _seed_dies(db)
        resp = await sr.school_catalogue_submit(FakeRequest({"selections": [{"die_id": "d1", "quantity": 4}]}))
        assert resp["order"]["order_id"]

        order = await db.orders.find_one({"order_id": resp["order"]["order_id"]}, {"_id": 0})
        assert order["order_status"] == "awaiting_confirmation"
        assert order["sales_person_email"] == "parul@ss.in"
        assert order["school_id"] == "s1"

        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 0, "nothing reserved before Confirm"

        items = await db.order_items.find({"order_id": order["order_id"]}, {"_id": 0}).to_list(10)
        assert items[0]["quantity"] == 4
        assert items[0]["status"] == "awaiting_confirmation"
    _run(go())


def test_submitting_with_nothing_selected_is_a_400(db):
    async def go():
        await _seed_dies(db)
        with pytest.raises(Exception) as exc:
            await sr.school_catalogue_submit(FakeRequest({"selections": []}))
        assert exc.value.status_code == 400
    _run(go())


def test_duplicate_die_ids_are_summed(db):
    async def go():
        await _seed_dies(db)
        await sr.school_catalogue_submit(FakeRequest({"selections": [
            {"die_id": "d1", "quantity": 2}, {"die_id": "d1", "quantity": 3}]}))
        items = await db.order_items.find({}, {"_id": 0}).to_list(10)
        assert len(items) == 1
        assert items[0]["quantity"] == 5
    _run(go())
