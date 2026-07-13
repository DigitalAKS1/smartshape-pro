"""Ownership scoping: a record's *creator* must lose access once it is assigned
to someone else, so reassigning a school truly removes it from the old owner.

Uses mongomock_motor (in-memory async Mongo) and patches the `db` handle in the
module under test, so NOTHING here touches the production database. Run with:
    python -m pytest tests/test_owner_scoping.py -q
"""

import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest

import routes.crm_routes as crm


AMIT = "amit@smartshape.in"     # creator
PARUL = "parul@smartshape.in"   # new owner


# ── pure predicates ───────────────────────────────────────────────────────────

def test_owns_assigned_to_me():
    assert crm._owns({"assigned_to": AMIT, "created_by": "someone"}, AMIT)


def test_owns_created_by_me_while_unassigned():
    for blank in ({"assigned_to": ""}, {"assigned_to": None}, {}):
        doc = {"created_by": AMIT, **blank}
        assert crm._owns(doc, AMIT), f"unassigned {blank!r} should belong to creator"


def test_owns_creator_loses_access_once_assigned_to_other():
    # The core fix: Amit created it, but it now belongs to Parul.
    doc = {"created_by": AMIT, "assigned_to": PARUL}
    assert not crm._owns(doc, AMIT)
    assert crm._owns(doc, PARUL)


# ── query-level scoping through the real route helpers ──────────────────────────

@pytest.fixture()
def db(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)
    return d


def _run(coro):
    return asyncio.run(coro)


def test_owner_clause_matches_owns_on_same_docs(db):
    """_owner_clause (Mongo) and _owns (in-memory) must agree row-for-row."""
    docs = [
        {"assigned_to": AMIT, "created_by": "x"},
        {"assigned_to": "", "created_by": AMIT},
        {"assigned_to": None, "created_by": AMIT},
        {"created_by": AMIT},
        {"assigned_to": PARUL, "created_by": AMIT},
        {"assigned_to": PARUL, "created_by": "x"},
    ]

    async def go():
        await db.probe.insert_many([{**d, "_i": i} for i, d in enumerate(docs)])
        cur = db.probe.find(crm._owner_clause(AMIT), {"_id": 0, "_i": 1})
        got = sorted([r["_i"] async for r in cur])
        want = sorted([i for i, d in enumerate(docs) if crm._owns(d, AMIT)])
        assert got == want

    _run(go())


def test_owned_school_ids_excludes_reassigned(db):
    async def go():
        # Amit created both; one stays his, one is reassigned to Parul.
        await db.schools.insert_many([
            {"school_id": "s_keep", "created_by": AMIT, "assigned_to": AMIT},
            {"school_id": "s_gone", "created_by": AMIT, "assigned_to": PARUL},
            {"school_id": "s_blank", "created_by": AMIT},  # never assigned
        ])
        amit_ids = set(await crm._owned_school_ids(AMIT))
        parul_ids = set(await crm._owned_school_ids(PARUL))
        assert amit_ids == {"s_keep", "s_blank"}
        assert parul_ids == {"s_gone"}
    _run(go())


def test_user_can_access_school_creator_locked_out(db):
    async def go():
        sales = {"role": "sales", "email": AMIT, "name": "Amit"}
        reassigned = {"school_id": "s1", "created_by": AMIT, "assigned_to": PARUL}
        unassigned = {"school_id": "s2", "created_by": AMIT}
        assert await crm._user_can_access_school(sales, unassigned) is True
        assert await crm._user_can_access_school(sales, reassigned) is False
    _run(go())


def test_user_can_mutate_contact_creator_locked_out(db):
    async def go():
        sales = {"role": "sales", "email": AMIT, "name": "Amit"}
        # No owned school backs it, so the only path is creator/assignee.
        reassigned = {"contact_id": "c1", "created_by": AMIT,
                      "assigned_to": PARUL, "school_id": "orphan"}
        unassigned = {"contact_id": "c2", "created_by": AMIT, "school_id": "orphan"}
        assert await crm._user_can_mutate_contact(sales, unassigned) is True
        assert await crm._user_can_mutate_contact(sales, reassigned) is False
    _run(go())
