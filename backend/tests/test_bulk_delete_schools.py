"""Guarded superadmin bulk-delete of schools (O20 + O19 execute step).

Reversible (snapshot_and_delete) + guarded (dry_run default true, confirm_count
must equal the id count). Uses mongomock_motor; wires the db handle into every
module under test so NOTHING touches the production database. Run with:
    python -m pytest tests/test_bulk_delete_schools.py -q
"""

import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import audit_backup
import cascade_delete
import routes.crm_maintenance_routes as maint


OWNER = {"email": "info@smartshape.in", "name": "Owner"}
NOT_OWNER = {"email": "admin@smartshape.in", "name": "Admin"}


def _run(coro):
    return asyncio.run(coro)


class FakeRequest:
    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(maint, "db", d)
    monkeypatch.setattr(audit_backup, "db", d)
    monkeypatch.setattr(cascade_delete, "db", d)
    return d


def _as_user(monkeypatch, user):
    async def _fake(_request):
        return user
    monkeypatch.setattr(maint, "get_current_user", _fake)


async def _seed(db):
    # Two blank schools that are junk (no name):
    #   b_childless — no children (safe to delete)
    #   b_withkids  — carries a lead (must NOT blind-delete)
    await db.schools.insert_one({"school_id": "b_childless", "school_name": ""})
    await db.schools.insert_one({"school_id": "b_withkids", "school_name": "  "})
    await db.leads.insert_one({"lead_id": "l1", "school_id": "b_withkids"})
    # A real, named school with a contact — must always survive.
    await db.schools.insert_one({"school_id": "real1", "school_name": "Springfield High"})
    await db.contacts.insert_one({"contact_id": "c1", "school_id": "real1"})


# ── dry-run writes nothing ─────────────────────────────────────────────────

def test_dry_run_returns_counts_and_deletes_nothing(monkeypatch, db):
    _as_user(monkeypatch, OWNER)

    async def go():
        await _seed(db)
        req = FakeRequest({"school_ids": ["b_childless", "b_withkids"], "dry_run": True})
        res = await maint.bulk_delete_schools(req)
        assert res["dry_run"] is True
        assert res["totals"]["schools"] == 2
        # per-school breakdown carries the blank flag + child counts
        by_id = {s["school_id"]: s for s in res["schools"]}
        assert by_id["b_childless"]["blank"] is True
        assert by_id["b_childless"]["children"]["leads"] == 0
        assert by_id["b_withkids"]["children"]["leads"] == 1
        # NOTHING removed
        assert await db.schools.count_documents({}) == 3
        assert await db.leads.count_documents({}) == 1
        assert await db.audit_backups.count_documents({}) == 0
    _run(go())


def test_dry_run_is_the_default(monkeypatch, db):
    _as_user(monkeypatch, OWNER)

    async def go():
        await _seed(db)
        req = FakeRequest({"school_ids": ["b_childless"]})  # no dry_run key
        res = await maint.bulk_delete_schools(req)
        assert res["dry_run"] is True
        assert await db.schools.count_documents({}) == 3
    _run(go())


# ── confirm_count guard ────────────────────────────────────────────────────

def test_confirm_count_mismatch_400_and_deletes_nothing(monkeypatch, db):
    _as_user(monkeypatch, OWNER)

    async def go():
        await _seed(db)
        req = FakeRequest({"school_ids": ["b_childless", "b_withkids"],
                           "dry_run": False, "confirm_count": 1})  # 1 != 2
        with pytest.raises(HTTPException) as exc:
            await maint.bulk_delete_schools(req)
        assert exc.value.status_code == 400
        assert "confirm_count" in exc.value.detail
        assert await db.schools.count_documents({}) == 3   # untouched
        assert await db.audit_backups.count_documents({}) == 0
    _run(go())


# ── real delete: snapshot then remove ──────────────────────────────────────

def test_real_delete_snapshots_then_removes(monkeypatch, db):
    _as_user(monkeypatch, OWNER)

    async def go():
        await _seed(db)
        req = FakeRequest({"school_ids": ["b_withkids"],
                           "dry_run": False, "confirm_count": 1, "reason": "junk"})
        res = await maint.bulk_delete_schools(req)
        assert res["deleted"] == 1
        assert len(res["backups"]) == 1
        assert res["total_docs"] >= 2               # school + lead
        assert res["recomputed"] is False           # no orders touched
        # school + its lead gone
        assert await db.schools.count_documents({"school_id": "b_withkids"}) == 0
        assert await db.leads.count_documents({"school_id": "b_withkids"}) == 0
        # everything is restorable from a complete backup manifest
        manifest = await db.audit_backups.find_one(
            {"backup_id": res["backups"][0], "kind": audit_backup.MANIFEST}, {"_id": 0})
        assert manifest and manifest["total"] == res["total_docs"]
        # the real school survives
        assert await db.schools.count_documents({"school_id": "real1"}) == 1
    _run(go())


# ── delete-blank-childless convenience ─────────────────────────────────────

def test_delete_blank_childless_skips_blanks_with_children(monkeypatch, db):
    _as_user(monkeypatch, OWNER)

    async def go():
        await _seed(db)
        # dry-run first: only the childless blank should be listed
        dry = await maint.delete_blank_childless_schools(FakeRequest({"dry_run": True}))
        listed = {s["school_id"] for s in dry["schools"]}
        assert listed == {"b_childless"}
        assert dry["totals"]["schools"] == 1

        # execute with the count the caller just saw
        res = await maint.delete_blank_childless_schools(
            FakeRequest({"dry_run": False, "confirm_count": 1}))
        assert res["deleted"] == 1
        # childless blank removed…
        assert await db.schools.count_documents({"school_id": "b_childless"}) == 0
        # …blank-with-children and the real school both survive
        assert await db.schools.count_documents({"school_id": "b_withkids"}) == 1
        assert await db.leads.count_documents({"school_id": "b_withkids"}) == 1
        assert await db.schools.count_documents({"school_id": "real1"}) == 1
    _run(go())


def test_delete_blank_childless_confirm_mismatch_400(monkeypatch, db):
    _as_user(monkeypatch, OWNER)

    async def go():
        await _seed(db)
        with pytest.raises(HTTPException) as exc:
            await maint.delete_blank_childless_schools(
                FakeRequest({"dry_run": False, "confirm_count": 5}))  # real count is 1
        assert exc.value.status_code == 400
        assert await db.schools.count_documents({}) == 3
    _run(go())


# ── superadmin gate ────────────────────────────────────────────────────────

def test_non_superadmin_forbidden_and_deletes_nothing(monkeypatch, db):
    _as_user(monkeypatch, NOT_OWNER)

    async def go():
        await _seed(db)
        req = FakeRequest({"school_ids": ["b_childless"], "dry_run": False, "confirm_count": 1})
        with pytest.raises(HTTPException) as exc:
            await maint.bulk_delete_schools(req)
        assert exc.value.status_code == 403
        assert await db.schools.count_documents({}) == 3

        with pytest.raises(HTTPException) as exc2:
            await maint.delete_blank_childless_schools(
                FakeRequest({"dry_run": False, "confirm_count": 1}))
        assert exc2.value.status_code == 403
        assert await db.schools.count_documents({}) == 3
    _run(go())
