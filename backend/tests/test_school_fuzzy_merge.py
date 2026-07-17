"""Fuzzy near-duplicate detection + field-by-field merge (folded into the
existing guarded Data Health merge). mongomock_motor, NO live DB.

Run:
    DB_NAME=smartshape_test python -m pytest tests/test_school_fuzzy_merge.py -q
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest

import routes.crm_maintenance_routes as m
import audit_backup as ab
import services.school_merge as sm

OWNER = {"email": "info@smartshape.in", "role": "admin", "name": "Owner"}


class _Req:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def db(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(m, "db", d)
    monkeypatch.setattr(ab, "db", d)

    async def _fake_user(request):
        return OWNER
    monkeypatch.setattr(m, "get_current_user", _fake_user)
    return d


async def _seed(d, docs):
    await d.schools.insert_many(docs)


# --------------------------------------------------------------------------- #
# pure scorer sanity (dependency-free)
# --------------------------------------------------------------------------- #

def test_scorer_high_for_near_dup_low_for_different():
    a = {"school_name": "St. Xavier's High School", "city": "Pune", "address": "MG Road"}
    b = {"school_name": "St Xaviers School", "city": "pune", "address": "M.G. Road"}
    c = {"school_name": "Delhi Public School", "city": "Mumbai", "address": "Link Rd"}
    assert sm.score_pair(a, b) >= 0.72
    assert sm.score_pair(a, c) < 0.72


# --------------------------------------------------------------------------- #
# fuzzy endpoint
# --------------------------------------------------------------------------- #

def test_fuzzy_finds_near_dup_excludes_exact_and_dismissed(db):
    async def go():
        await _seed(db, [
            {"school_id": "s1", "school_name": "St Xaviers School", "city": "Pune",
             "address": "MG Road", "is_deleted": False},
            {"school_id": "s2", "school_name": "St. Xavier's High School", "city": "Pune",
             "address": "M G Road", "is_deleted": False},
            # exact-name pair (same normalized name) -> must be EXCLUDED from fuzzy
            {"school_id": "e1", "school_name": "Green Valley", "city": "Goa", "is_deleted": False},
            {"school_id": "e2", "school_name": "Green Valley", "city": "Goa", "is_deleted": False},
            # clearly different
            {"school_id": "d1", "school_name": "Delhi Public School", "city": "Mumbai",
             "address": "Link", "is_deleted": False},
        ])
        res = await m.duplicate_schools_fuzzy(_Req())
        pairs = {frozenset((c["a"]["school_id"], c["b"]["school_id"])) for c in res["candidates"]}
        assert frozenset(("s1", "s2")) in pairs           # near-dup surfaced
        assert frozenset(("e1", "e2")) not in pairs        # exact-name excluded
        assert not any("d1" in p for p in pairs)           # different not matched
        c = next(c for c in res["candidates"]
                 if {c["a"]["school_id"], c["b"]["school_id"]} == {"s1", "s2"})
        assert set(c["a_children"]) == {"leads", "contacts", "quotations", "orders"}

        # dismiss the pair -> gone
        await m.dismiss_duplicate_pair(_Req({"a_id": "s1", "b_id": "s2"}))
        res2 = await m.duplicate_schools_fuzzy(_Req())
        pairs2 = {frozenset((c["a"]["school_id"], c["b"]["school_id"])) for c in res2["candidates"]}
        assert frozenset(("s1", "s2")) not in pairs2
    _run(go())


# --------------------------------------------------------------------------- #
# field-by-field merge
# --------------------------------------------------------------------------- #

def test_merge_field_choices_overwrite_survivor(db):
    async def go():
        await _seed(db, [
            {"school_id": "surv", "school_name": "Xaviers", "city": "OldCity",
             "assigned_to": "", "assigned_name": "", "is_deleted": False},
            {"school_id": "dup", "school_name": "St Xaviers High", "city": "NewCity",
             "assigned_to": "ravi@t", "assigned_name": "Ravi", "is_deleted": False},
        ])
        res = await m.merge_schools(_Req({
            "survivor_id": "surv", "merge_ids": ["dup"],
            "dry_run": False, "confirm": True, "reason": "test",
            "field_choices": {"city": "dup", "assigned_to": "dup"},
        }))
        assert "surv" == res["survivor_id"]
        surv = await db.schools.find_one({"school_id": "surv"})
        assert surv["city"] == "NewCity"                 # overwritten by choice
        assert surv["assigned_to"] == "ravi@t"           # owner pair carried
        assert surv["assigned_name"] == "Ravi"
        assert surv["school_name"] == "Xaviers"          # NOT chosen -> survivor kept
        assert await db.schools.find_one({"school_id": "dup"}) is None  # dup removed
    _run(go())


def test_merge_without_field_choices_is_fill_blank_only(db):
    async def go():
        await _seed(db, [
            {"school_id": "surv", "school_name": "Xaviers", "city": "Keep",
             "is_deleted": False},
            {"school_id": "dup", "school_name": "St Xaviers", "city": "Other",
             "email": "a@b.c", "is_deleted": False},
        ])
        await m.merge_schools(_Req({
            "survivor_id": "surv", "merge_ids": ["dup"],
            "dry_run": False, "confirm": True, "reason": "t",
        }))
        surv = await db.schools.find_one({"school_id": "surv"})
        assert surv["city"] == "Keep"        # non-blank survivor field untouched
        assert surv.get("email") == "a@b.c"  # blank survivor field filled from dup
    _run(go())
