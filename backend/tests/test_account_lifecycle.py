"""Phase 2: an account's life is not the same thing as a deal's life.

A school that bought a machine in 2024 is a Customer forever, whatever its deals
are doing. Whether it is still an ACTIVE customer is a question about orders, not
about pipeline stages — and until now there was no way to ask it, so "who has
gone quiet" was a hunch rather than a query.

Status is derived from order history and never typed, because a typed field
drifts the moment someone forgets to update it. mongomock.
"""
import asyncio
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import services.account_lifecycle as al


@pytest.fixture()
def db():
    return AsyncMongoMockClient()["smartshape_test"]


def _run(coro):
    return asyncio.run(coro)


def _days_ago(n):
    return (datetime.now(timezone.utc) - timedelta(days=n)).isoformat()


async def _school(db, sid="s1"):
    await db.schools.insert_one({"school_id": sid, "school_name": "DPS", "is_deleted": False})


async def _order(db, oid, sid="s1", total=1000, days_ago=1, status="delivered", deleted=False):
    await db.orders.insert_one({
        "order_id": oid, "school_id": sid, "grand_total": total,
        "status": status, "is_deleted": deleted, "created_at": _days_ago(days_ago),
    })


# ── The three states, derived ───────────────────────────────────────────────

def test_a_school_that_has_never_ordered_is_a_prospect(db):
    async def go():
        await _school(db)
        out = await al.recompute_school_lifecycle(db, "s1")
        assert out["account_status"] == "prospect"
        assert out["order_count"] == 0
        assert out["lifetime_value"] == 0
        assert out["first_order_at"] is None and out["last_order_at"] is None
    _run(go())


def test_a_school_that_ordered_recently_is_a_customer(db):
    async def go():
        await _school(db)
        await _order(db, "o1", days_ago=10, total=25000)
        out = await al.recompute_school_lifecycle(db, "s1")
        assert out["account_status"] == "customer"
        assert out["order_count"] == 1
        assert out["lifetime_value"] == 25000
    _run(go())


def test_a_customer_who_has_gone_quiet_is_dormant(db):
    async def go():
        await _school(db)
        await _order(db, "o1", days_ago=400)
        out = await al.recompute_school_lifecycle(db, "s1", dormant_after_days=180)
        assert out["account_status"] == "dormant"
        assert out["order_count"] == 1, "dormant is still a customer, just a quiet one"
    _run(go())


def test_how_long_counts_as_quiet_is_configurable(db):
    # Two school terms is not the same length everywhere, so this is a setting.
    async def go():
        await _school(db)
        await _order(db, "o1", days_ago=200)
        assert (await al.recompute_school_lifecycle(db, "s1", dormant_after_days=180))["account_status"] == "dormant"
        assert (await al.recompute_school_lifecycle(db, "s1", dormant_after_days=365))["account_status"] == "customer"
    _run(go())


def test_once_a_customer_always_a_customer_never_back_to_prospect(db):
    async def go():
        await _school(db)
        await _order(db, "o1", days_ago=900)
        out = await al.recompute_school_lifecycle(db, "s1", dormant_after_days=180)
        assert out["account_status"] == "dormant"
        assert out["account_status"] != "prospect", \
            "a school that has bought from you is never an unproven prospect again"
    _run(go())


# ── What counts as an order ─────────────────────────────────────────────────

def test_a_cancelled_order_does_not_make_a_customer(db):
    async def go():
        await _school(db)
        await _order(db, "o1", status="cancelled")
        out = await al.recompute_school_lifecycle(db, "s1")
        assert out["account_status"] == "prospect"
        assert out["lifetime_value"] == 0
    _run(go())


def test_a_deleted_order_does_not_count(db):
    async def go():
        await _school(db)
        await _order(db, "o1", deleted=True)
        assert (await al.recompute_school_lifecycle(db, "s1"))["account_status"] == "prospect"
    _run(go())


# ── The dates that make "who has gone quiet" a query ────────────────────────

def test_first_and_last_order_dates_bracket_the_relationship(db):
    async def go():
        await _school(db)
        await _order(db, "o1", days_ago=500, total=400000)
        await _order(db, "o2", days_ago=200, total=25000)
        await _order(db, "o3", days_ago=30, total=30000)
        out = await al.recompute_school_lifecycle(db, "s1")
        assert out["order_count"] == 3
        assert out["lifetime_value"] == 455000
        assert out["first_order_at"] < out["last_order_at"]
        assert out["days_since_last_order"] == 30
    _run(go())


def test_the_result_is_written_back_to_the_school(db):
    async def go():
        await _school(db)
        await _order(db, "o1", days_ago=5, total=1200)
        await al.recompute_school_lifecycle(db, "s1")
        school = await db.schools.find_one({"school_id": "s1"})
        assert school["account_status"] == "customer"
        assert school["lifetime_value"] == 1200
        assert school["order_count"] == 1
    _run(go())


def test_recomputing_is_safe_to_repeat(db):
    async def go():
        await _school(db)
        await _order(db, "o1", days_ago=5, total=1200)
        a = await al.recompute_school_lifecycle(db, "s1")
        b = await al.recompute_school_lifecycle(db, "s1")
        assert a == b
        assert (await db.schools.count_documents({})) == 1
    _run(go())


def test_a_school_that_no_longer_exists_is_skipped_quietly(db):
    async def go():
        out = await al.recompute_school_lifecycle(db, "ghost")
        assert out is None
    _run(go())


# ── Backfilling the existing data ───────────────────────────────────────────

def test_backfill_classifies_every_school_in_one_pass(db):
    async def go():
        await _school(db, "s_new")
        await _school(db, "s_live")
        await _school(db, "s_quiet")
        await _order(db, "o1", sid="s_live", days_ago=10)
        await _order(db, "o2", sid="s_quiet", days_ago=400)

        out = await al.backfill_all(db, dormant_after_days=180)
        assert out["scanned"] == 3
        got = {s["school_id"]: s.get("account_status")
               async for s in db.schools.find({}, {"_id": 0, "school_id": 1, "account_status": 1})}
        assert got == {"s_new": "prospect", "s_live": "customer", "s_quiet": "dormant"}
        assert out["by_status"] == {"prospect": 1, "customer": 1, "dormant": 1}
    _run(go())


def test_backfill_skips_deleted_schools(db):
    async def go():
        await _school(db, "s1")
        await db.schools.insert_one({"school_id": "s_gone", "is_deleted": True})
        out = await al.backfill_all(db)
        assert out["scanned"] == 1
    _run(go())


# ── The question this whole phase exists to answer ──────────────────────────

def test_customers_who_have_gone_quiet_are_now_one_query(db):
    async def go():
        await _school(db, "s_live")
        await _school(db, "s_quiet1")
        await _school(db, "s_quiet2")
        await _school(db, "s_never")
        await _order(db, "o1", sid="s_live", days_ago=20)
        await _order(db, "o2", sid="s_quiet1", days_ago=300)
        await _order(db, "o3", sid="s_quiet2", days_ago=500)
        await al.backfill_all(db, dormant_after_days=180)

        quiet = [s["school_id"] async for s in
                 db.schools.find({"account_status": "dormant"}, {"_id": 0, "school_id": 1})]
        assert sorted(quiet) == ["s_quiet1", "s_quiet2"], \
            "this list is the reason the phase exists — customers to win back"
    _run(go())


# ── The endpoint that fills in the history ──────────────────────────────────

class FakeRequest:
    def __init__(self, body=None, params=None):
        self._body = body or {}
        self.query_params = params or {}

    async def json(self):
        return self._body


def test_the_backfill_endpoint_runs_and_is_admin_only(monkeypatch):
    import rbac
    import routes.crm_routes as crm
    from fastapi import HTTPException

    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)
    monkeypatch.setattr(al, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")

    async def go():
        await d.schools.insert_one({"school_id": "s1", "school_name": "DPS", "is_deleted": False})
        await d.orders.insert_one({"order_id": "o1", "school_id": "s1", "grand_total": 5000,
                                   "status": "delivered", "is_deleted": False,
                                   "created_at": _days_ago(5)})

        async def as_rep(_r):
            return {"email": "parul@ss.in", "role": "sales"}
        monkeypatch.setattr(crm, "get_current_user", as_rep)
        with pytest.raises(HTTPException) as e:
            await crm.schools_backfill_lifecycle(FakeRequest())
        assert e.value.status_code == 403

        async def as_admin(_r):
            return {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
        monkeypatch.setattr(crm, "get_current_user", as_admin)
        out = await crm.schools_backfill_lifecycle(FakeRequest())
        assert out["ok"] is True
        assert out["scanned"] == 1
        assert (await d.schools.find_one({"school_id": "s1"}))["account_status"] == "customer"
    _run(go())
