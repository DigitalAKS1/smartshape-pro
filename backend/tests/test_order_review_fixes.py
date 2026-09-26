# backend/tests/test_order_review_fixes.py
"""Fixes from the final whole-branch review of the order-confirmation plan
(docs/superpowers/plans/2026-09-25-school-item-order-confirmation-backend.md).
mongomock — same pattern as tests/test_reorder_motion.py.

Each test here reproduces one review finding and is written to fail against
the code as it stood at review time, then pass once that finding's fix lands.
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.order_routes as ordr
import tally_export

STORE = {"email": "store@ss.in", "role": "store",
         "module_permissions": {"orders": {"level": "read_write", "scope": "all"}}}
OWNER_REP = {"email": "parul@ss.in", "role": "sales_person",
             "module_permissions": {"orders": {"level": "read_write", "scope": "own"}}}
OTHER_REP = {"email": "amit@ss.in", "role": "sales_person",
             "module_permissions": {"orders": {"level": "read_write", "scope": "own"}}}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body

    async def body(self):
        import json as _json
        return _json.dumps(self._body).encode()


CURRENT_USER = {"user": STORE}


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(ordr, "db", d, raising=False)
    monkeypatch.setattr(tally_export, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")

    async def _me(_request):
        return CURRENT_USER["user"]
    monkeypatch.setattr(ordr, "get_current_user", _me)
    return d


def _run(coro):
    return asyncio.run(coro)


async def _pending_order(db, order_id="o1", owner="parul@ss.in"):
    await db.orders.insert_one({
        "order_id": order_id, "order_number": "ORD-1", "school_id": "s1",
        "sales_person_email": owner, "order_status": "pending",
        "grand_total": 1000, "total_items": 0,
    })


async def _awaiting_order(db, order_id="o1", die_id="d1", qty=3, stock=10, owner="parul@ss.in"):
    await db.dies.insert_one({"die_id": die_id, "name": "Star", "code": "D-1",
                              "type": "standard", "stock_qty": stock, "reserved_qty": 0})
    await db.orders.insert_one({
        "order_id": order_id, "order_number": "ORD-1", "school_id": "s1",
        "sales_person_email": owner, "order_status": "awaiting_confirmation",
        "quotation_id": "q1", "lead_id": "l1", "grand_total": 1000, "total_items": 1,
    })
    await db.order_items.insert_one({
        "order_item_id": f"{order_id}_i1", "order_id": order_id, "die_id": die_id,
        "die_name": "Star", "die_code": "D-1", "die_type": "standard",
        "quantity": qty, "status": "awaiting_confirmation",
    })


# ── Finding 1 (Critical): cancel/reopen/export ignore ownership ─────────────

def test_a_rep_cannot_cancel_another_reps_order(db):
    async def go():
        await _pending_order(db, owner="parul@ss.in")
        CURRENT_USER["user"] = OTHER_REP
        with pytest.raises(Exception) as exc:
            await ordr.cancel_order("o1", FakeRequest())
        assert exc.value.status_code == 403
    _run(go())


def test_the_owning_rep_can_cancel_their_own_order(db):
    async def go():
        await _pending_order(db, owner="parul@ss.in")
        CURRENT_USER["user"] = OWNER_REP
        resp = await ordr.cancel_order("o1", FakeRequest())
        assert resp["order_status"] == "cancelled"
    _run(go())


def test_a_rep_cannot_reopen_another_reps_order(db):
    async def go():
        await _pending_order(db, owner="parul@ss.in")
        await db.orders.update_one({"order_id": "o1"}, {"$set": {"order_status": "cancelled"}})
        CURRENT_USER["user"] = OTHER_REP
        with pytest.raises(Exception) as exc:
            await ordr.reopen_order("o1", FakeRequest())
        assert exc.value.status_code == 403
    _run(go())


def test_a_rep_cannot_export_another_reps_order(db):
    async def go():
        await _pending_order(db, owner="parul@ss.in")
        CURRENT_USER["user"] = OTHER_REP
        with pytest.raises(Exception) as exc:
            await ordr.export_order("o1", FakeRequest())
        assert exc.value.status_code == 403
    _run(go())


def test_bulk_export_silently_drops_orders_the_rep_does_not_own(db):
    async def go():
        await _pending_order(db, order_id="o_mine", owner="amit@ss.in")
        await _pending_order(db, order_id="o_theirs", owner="parul@ss.in")
        CURRENT_USER["user"] = OTHER_REP  # amit@ss.in
        from routes.order_routes import BulkExportInput
        resp = await ordr.export_orders_bulk(
            BulkExportInput(order_ids=["o_mine", "o_theirs"], format="json"), FakeRequest())
        import json as _json
        payload = _json.loads(resp.body)
        assert len(payload) == 1
    _run(go())


# ── Finding 2 (Important): Confirm/Reject race — atomic claim ───────────────

def test_confirm_uses_an_atomic_claim_not_a_stale_read(db, monkeypatch):
    """The vulnerable version reads the order, checks order_status in Python,
    THEN writes — two concurrent requests can both pass that in-memory check
    before either writes, double-reserving. The fix must instead do the status
    transition as a single atomic `update_one` filtered on the current
    order_status, so a second caller's write is rejected by the database
    itself even if its own earlier read was stale. Simulated here by handing
    confirm_order a stale in-memory read while the real document has already
    moved on — a correct, atomicity-based implementation must still refuse."""
    async def go():
        CURRENT_USER["user"] = STORE
        await _awaiting_order(db, qty=4, stock=10)

        # mongomock_motor hands back a fresh AsyncIOMotorCollection wrapper on
        # every `db.orders` access, so patching an instance is a no-op — the
        # class method is what production code actually calls.
        collection_cls = type(db.orders)
        real_find_one = collection_cls.find_one

        async def stale_find_one(self, *args, **kwargs):
            doc = await real_find_one(self, *args, **kwargs)
            if doc and doc.get("order_id") == "o1":
                doc = dict(doc)
                doc["order_status"] = "awaiting_confirmation"  # stale — real doc has moved on
            return doc

        # A concurrent request already confirmed this order for real.
        await db.orders.update_one({"order_id": "o1"}, {"$set": {"order_status": "pending"}})
        monkeypatch.setattr(collection_cls, "find_one", stale_find_one)

        with pytest.raises(Exception) as exc:
            await ordr.confirm_order("o1", FakeRequest())
        assert exc.value.status_code == 400
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 0, "must not reserve again off a stale read"
    _run(go())


# ── Finding 3 (Important): order creation with a committing status must reserve ──

def test_create_order_for_quotation_reserves_when_status_is_already_pending(db):
    async def go():
        CURRENT_USER["user"] = STORE
        await db.quotations.insert_one({
            "quotation_id": "q1", "quote_number": "Q-1", "school_id": "s1",
            "sales_person_email": "parul@ss.in", "grand_total": 1000,
        })
        await db.dies.insert_one({"die_id": "d1", "name": "Star", "code": "D-1",
                                  "type": "standard", "stock_qty": 10, "reserved_qty": 0})
        await db.catalogue_selections.insert_one({"selection_id": "sel1", "quotation_id": "q1"})
        await db.catalogue_selection_items.insert_one({
            "catalogue_selection_id": "sel1", "die_id": "d1", "die_name": "Star",
            "die_code": "D-1", "die_type": "standard", "quantity": 5,
        })
        # This is the auto_create_so_on_submit=False / manual-creation path: the
        # order is created directly at "pending" (not awaiting_confirmation), so
        # nothing will ever call Confirm for it — creation itself must reserve.
        order, created = await ordr.create_order_for_quotation(
            "q1", created_by="parul@ss.in", source="manual")
        assert order["order_status"] == "pending"
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 5, "a pending order must reserve at creation, not never"
    _run(go())


# ── Finding 4 (Important): Reject must undo won-lead/confirmed-quotation ────

def test_reject_frees_the_quotation_and_unlocks_the_lead(db):
    async def go():
        CURRENT_USER["user"] = STORE
        await _awaiting_order(db)
        await db.quotations.insert_one({"quotation_id": "q1", "quotation_status": "confirmed",
                                        "catalogue_status": "submitted"})
        await db.leads.insert_one({"lead_id": "l1", "is_locked": True, "stage": "won"})
        await ordr.reject_order("o1", FakeRequest({"reason": "Duplicate submission"}))
        quot = await db.quotations.find_one({"quotation_id": "q1"}, {"_id": 0})
        lead = await db.leads.find_one({"lead_id": "l1"}, {"_id": 0})
        assert quot["quotation_status"] == "sent"
        assert quot["catalogue_status"] != "submitted", "school must be able to resubmit"
        assert lead["is_locked"] is False
        assert lead["stage"] == "negotiation"
    _run(go())


# ── Finding 5 (Important): Cancel must not strand awaiting-confirmation lines ──

def test_cancel_refuses_an_awaiting_confirmation_order(db):
    async def go():
        CURRENT_USER["user"] = STORE
        await _awaiting_order(db)
        with pytest.raises(Exception) as exc:
            await ordr.cancel_order("o1", FakeRequest())
        assert exc.value.status_code == 400
        order = await db.orders.find_one({"order_id": "o1"}, {"_id": 0})
        assert order["order_status"] == "awaiting_confirmation", "must be untouched — use Reject instead"
    _run(go())


# ── Round 2 finding (Important): production-stage change must refuse an
# awaiting-confirmation order — it has no reserved stock, so moving it into
# production makes no sense and update_order_status already refuses it. ────

def test_production_stage_refuses_an_awaiting_confirmation_order(db):
    async def go():
        CURRENT_USER["user"] = STORE
        await _awaiting_order(db)
        with pytest.raises(Exception) as exc:
            await ordr.update_order_production_stage("o1", FakeRequest({"production_stage": "in_production"}))
        assert exc.value.status_code == 400
        order = await db.orders.find_one({"order_id": "o1"}, {"_id": 0})
        assert order.get("production_stage") is None, "must be untouched"
    _run(go())
