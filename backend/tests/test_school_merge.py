"""Phase 4b — guarded school dedup/merge (name-collision, different school_id).

mongomock_motor, NO live DB. Python 3.14: asyncio.run per test (no implicit loop).

Run:
    DB_NAME=smartshape_test python -m pytest tests/test_school_merge.py -q
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException

import routes.crm_maintenance_routes as m
import audit_backup as ab


OWNER = {"email": "info@smartshape.in", "role": "admin", "name": "Owner"}
NOBODY = {"email": "sales@smartshape.in", "role": "sales_person", "name": "Rep"}


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


def _as(monkeypatch, user):
    async def _u(request):
        return user
    monkeypatch.setattr(m, "get_current_user", _u)


# ===========================================================================
# _norm_school_name — the grouping key
# ===========================================================================

def test_norm_school_name_case_whitespace_mojibake():
    a = m._norm_school_name("St. Xavier's High School")
    b = m._norm_school_name("ST. XAVIERâ€™S  HIGH SCHOOL ")   # case + ws + mojibake
    assert a == b == "st. xavier's high school"
    assert m._norm_school_name("") == ""
    assert m._norm_school_name(None) == ""


# ===========================================================================
# 1. duplicate-schools (read-only)
# ===========================================================================

async def _seed_dupes(db):
    await db.schools.insert_many([
        {"school_id": "sch_a", "school_name": "St. Xavier's High School", "city": "Delhi",
         "created_at": "2026-01-01"},
        {"school_id": "sch_b", "school_name": "ST. XAVIERâ€™S  HIGH SCHOOL", "city": "",
         "created_at": "2026-02-01"},
        # a genuinely unique school — must NOT appear
        {"school_id": "sch_solo", "school_name": "Delhi Public School"},
        # blank name — excluded from merge grouping
        {"school_id": "sch_blank", "school_name": "  "},
        # soft-deleted duplicate — excluded
        {"school_id": "sch_del", "school_name": "St. Xavier's High School",
         "is_deleted": True},
    ])
    # children so ordering / counts are exercised
    await db.leads.insert_many([
        {"lead_id": "l1", "school_id": "sch_a"},
        {"lead_id": "l2", "school_id": "sch_b"},
        {"lead_id": "l3", "school_id": "sch_b"},
    ])
    await db.contacts.insert_one({"contact_id": "c1", "school_id": "sch_a"})


def test_duplicate_schools_groups_only_same_name_diff_id(db):
    async def go():
        await _seed_dupes(db)
        res = await m.duplicate_schools(_Req())
        assert res["group_count"] == 1
        grp = res["groups"][0]
        assert grp["normalized_name"] == "st. xavier's high school"
        ids = {s["school_id"] for s in grp["schools"]}
        assert ids == {"sch_a", "sch_b"}          # solo/blank/deleted excluded
        # children summed: sch_a (1 lead + 1 contact) + sch_b (2 leads) = 4
        assert grp["total_children"] == 4
        # sorted within group by child count desc -> sch_a(2) before sch_b(2)? both 2;
        # just assert both present with correct per-school children
        by_id = {s["school_id"]: s for s in grp["schools"]}
        assert by_id["sch_b"]["children"]["leads"] == 2
        assert by_id["sch_a"]["children"]["contacts"] == 1
    _run(go())


def test_duplicate_schools_writes_nothing(db):
    async def go():
        await _seed_dupes(db)
        before = (await db.schools.count_documents({}),
                  await db.audit_backups.count_documents({}))
        await m.duplicate_schools(_Req())
        after = (await db.schools.count_documents({}),
                 await db.audit_backups.count_documents({}))
        assert before == after
    _run(go())


# ===========================================================================
# 2. merge — validation, dry-run, real, idempotency, RBAC
# ===========================================================================

async def _seed_merge(db):
    await db.schools.insert_many([
        {"school_id": "surv", "school_name": "St. Xavier's High School", "city": "",
         "phone": "919000000001"},
        {"school_id": "dup1", "school_name": "St Xaviers", "city": "Delhi",
         "phone": "919000000002"},
        {"school_id": "dup2", "school_name": "St Xaviers", "city": "Noida"},
    ])
    await db.leads.insert_many([
        {"lead_id": "L_s", "school_id": "surv"},
        {"lead_id": "L_d1", "school_id": "dup1"},
        {"lead_id": "L_d2a", "school_id": "dup2"},
        {"lead_id": "L_d2b", "school_id": "dup2"},
    ])
    await db.contacts.insert_one({"contact_id": "C_d1", "school_id": "dup1"})
    await db.quotations.insert_one({"quotation_id": "Q_d2", "school_id": "dup2"})
    await db.orders.insert_one({"order_id": "O_d1", "school_id": "dup1"})
    # a collection linked via lead_id, NOT school_id — must be left alone
    await db.tasks.insert_one({"task_id": "T1", "lead_id": "L_d1"})


def test_merge_validation_errors(db):
    async def go():
        await _seed_merge(db)
        # missing survivor
        with pytest.raises(HTTPException) as e1:
            await m.merge_schools(_Req({"survivor_id": "", "merge_ids": ["dup1"]}))
        assert e1.value.status_code == 400
        # survivor in merge_ids
        with pytest.raises(HTTPException) as e2:
            await m.merge_schools(_Req({"survivor_id": "surv", "merge_ids": ["surv"]}))
        assert e2.value.status_code == 400
        # unknown merge id
        with pytest.raises(HTTPException) as e3:
            await m.merge_schools(_Req({"survivor_id": "surv", "merge_ids": ["ghost"]}))
        assert e3.value.status_code == 400
        # unknown survivor
        with pytest.raises(HTTPException) as e4:
            await m.merge_schools(_Req({"survivor_id": "ghost", "merge_ids": ["dup1"]}))
        assert e4.value.status_code == 400
    _run(go())


def test_merge_dry_run_moves_nothing(db):
    async def go():
        await _seed_merge(db)
        res = await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1", "dup2"], "dry_run": True}))
        assert res["dry_run"] is True
        assert res["per_merge_moves"]["dup1"] == {"leads": 1, "contacts": 1, "orders": 1}
        assert res["per_merge_moves"]["dup2"] == {"leads": 2, "quotations": 1}
        assert res["survivor_children_after"]["leads"] == 4   # 1 + 1 + 2
        # nothing mutated
        assert await db.schools.count_documents({}) == 3
        assert await db.leads.count_documents({"school_id": "dup2"}) == 2
        assert await db.audit_backups.count_documents({}) == 0
    _run(go())


def test_merge_requires_confirm(db):
    async def go():
        await _seed_merge(db)
        with pytest.raises(HTTPException) as e:
            await m.merge_schools(_Req(
                {"survivor_id": "surv", "merge_ids": ["dup1"],
                 "dry_run": False, "confirm": False}))
        assert e.value.status_code == 400
        assert await db.schools.count_documents({}) == 3  # untouched
    _run(go())


def test_merge_real_reassigns_and_removes_duplicates(db):
    async def go():
        await _seed_merge(db)
        res = await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1", "dup2"],
             "dry_run": False, "confirm": True, "reason": "dedup"}))

        # duplicates removed, survivor stays
        assert await db.schools.count_documents({"school_id": "dup1"}) == 0
        assert await db.schools.count_documents({"school_id": "dup2"}) == 0
        assert await db.schools.count_documents({"school_id": "surv"}) == 1

        # all children reassigned to survivor
        assert await db.leads.count_documents({"school_id": "surv"}) == 4
        assert await db.leads.count_documents({"school_id": "dup1"}) == 0
        assert await db.contacts.count_documents({"school_id": "surv"}) == 1
        assert await db.quotations.count_documents({"school_id": "surv"}) == 1
        assert await db.orders.count_documents({"school_id": "surv"}) == 1

        # lead_id-linked task untouched (still points at its lead)
        assert await db.tasks.count_documents({"lead_id": "L_d1"}) == 1

        # only-blank survivor field filled from a merge doc (city was "")
        surv = await db.schools.find_one({"school_id": "surv"}, {"_id": 0})
        assert surv["city"] == "Delhi"           # from dup1
        assert surv["phone"] == "919000000001"   # NOT overwritten (already set)

        # three pre-images: dup school shells, the CHILD docs (original school_id),
        # and the removal bundle — see Vivek finding 5 (reversibility).
        assert "preimage_backup_id" in res and "removed_backup_id" in res
        assert "child_preimage_backup_id" in res
        assert len(res["backups"]) == 3
        removed = await db.audit_backups.find_one(
            {"backup_id": res["removed_backup_id"], "kind": ab.MANIFEST})
        assert removed is not None and removed["counts"].get("schools") == 2
        assert set(res["merged"]) == {"dup1", "dup2"}
    _run(go())


def test_merge_rerun_is_noop(db):
    async def go():
        await _seed_merge(db)
        await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1", "dup2"],
             "dry_run": False, "confirm": True}))
        # re-run dry with the same (now-gone) ids -> both merge docs missing -> 400
        with pytest.raises(HTTPException) as e:
            await m.merge_schools(_Req(
                {"survivor_id": "surv", "merge_ids": ["dup1", "dup2"], "dry_run": True}))
        assert e.value.status_code == 400
        # and a fresh merge of survivor into a NEW empty dup moves 0 children
        await db.schools.insert_one({"school_id": "dup3", "school_name": "St Xaviers"})
        res = await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup3"], "dry_run": True}))
        assert res["per_merge_moves"]["dup3"] == {}
    _run(go())


def test_merge_non_superadmin_forbidden(db, monkeypatch):
    async def go():
        await _seed_merge(db)
        _as(monkeypatch, NOBODY)
        with pytest.raises(HTTPException) as e:
            await m.merge_schools(_Req(
                {"survivor_id": "surv", "merge_ids": ["dup1"],
                 "dry_run": False, "confirm": True}))
        assert e.value.status_code == 403
        assert await db.schools.count_documents({}) == 3  # nothing touched
    _run(go())


def test_duplicate_schools_non_superadmin_forbidden(db, monkeypatch):
    async def go():
        await _seed_dupes(db)
        _as(monkeypatch, NOBODY)
        with pytest.raises(HTTPException) as e:
            await m.duplicate_schools(_Req())
        assert e.value.status_code == 403
    _run(go())
