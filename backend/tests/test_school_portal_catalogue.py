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


# ── Round 2 findings (Important): submit must validate what it's given ──────

def test_submitting_only_an_inactive_die_is_a_400(db):
    async def go():
        await _seed_dies(db)
        with pytest.raises(Exception) as exc:
            await sr.school_catalogue_submit(FakeRequest({"selections": [{"die_id": "d2", "quantity": 1}]}))
        assert exc.value.status_code == 400
        assert (await db.orders.count_documents({})) == 0, "no zero-item order should be created"
    _run(go())


def test_submitting_only_unknown_die_ids_is_a_400(db):
    async def go():
        await _seed_dies(db)
        with pytest.raises(Exception) as exc:
            await sr.school_catalogue_submit(FakeRequest({"selections": [{"die_id": "no-such-die", "quantity": 1}]}))
        assert exc.value.status_code == 400
        assert (await db.orders.count_documents({})) == 0
    _run(go())


def test_a_mix_of_valid_and_invalid_dies_keeps_only_the_valid_ones(db):
    async def go():
        await _seed_dies(db)
        await sr.school_catalogue_submit(FakeRequest({"selections": [
            {"die_id": "d1", "quantity": 2}, {"die_id": "d2", "quantity": 5}]}))
        items = await db.order_items.find({}, {"_id": 0}).to_list(10)
        assert len(items) == 1
        assert items[0]["die_id"] == "d1"
    _run(go())


def test_a_non_numeric_quantity_does_not_crash(db):
    async def go():
        await _seed_dies(db)
        resp = await sr.school_catalogue_submit(FakeRequest({"selections": [{"die_id": "d1", "quantity": "not-a-number"}]}))
        assert resp["order"]["order_id"]
        items = await db.order_items.find({}, {"_id": 0}).to_list(10)
        assert items[0]["quantity"] == 1, "an unparseable quantity falls back to 1, not a 500"
    _run(go())


# ── Round 2 finding (Important): reorder's placeholder quotation must not
# pollute the school's or a rep's real quotation lists ──────────────────────

def test_reorder_quotation_is_hidden_from_the_schools_quotes_tab(db):
    async def go():
        await _seed_dies(db)
        await db.quotations.insert_one({"quotation_id": "q_real", "school_id": "s1", "source": "manual"})
        await sr.school_catalogue_submit(FakeRequest({"selections": [{"die_id": "d1", "quantity": 1}]}))
        quots = await sr.school_quotations(FakeRequest())
        ids = {q["quotation_id"] for q in quots}
        assert ids == {"q_real"}
    _run(go())


def test_reorder_quotation_is_hidden_from_the_sales_quotations_list(db, monkeypatch):
    async def go():
        import routes.quotation_routes as qr
        monkeypatch.setattr(qr, "db", db, raising=False)

        async def _admin(_request):
            return {"email": "info@smartshape.in", "role": "admin"}
        monkeypatch.setattr(qr, "get_current_user", _admin)

        await _seed_dies(db)
        await db.quotations.insert_one({"quotation_id": "q_real", "school_id": "s1",
                                        "sales_person_email": "parul@ss.in", "source": "manual"})
        await sr.school_catalogue_submit(FakeRequest({"selections": [{"die_id": "d1", "quantity": 1}]}))

        quots = await qr.get_quotations(FakeRequest())
        ids = {q["quotation_id"] for q in quots}
        assert ids == {"q_real"}
    _run(go())
