"""C1: one shared Materials list (D3) behind both dropdowns."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import routes.crm_routes as crm
import rbac

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
REP = {"email": "parul@smartshape.in", "name": "Parul", "role": "sales",
       "module_permissions": {"leads": {"level": "read"}}}


class FakeRequest:
    def __init__(self, body=None, params=None):
        self._body = body or {}
        self.query_params = params or {}

    async def json(self):
        return self._body


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")
    return d


def _as(monkeypatch, user):
    async def _me(_request):
        return user
    monkeypatch.setattr(crm, "get_current_user", _me)


def _run(coro):
    return asyncio.run(coro)


def test_the_list_seeds_the_union_of_both_old_hardcoded_lists(db, monkeypatch):
    async def go():
        _as(monkeypatch, ADMIN)
        rows = await crm.get_mail_materials(FakeRequest())
        names = {r["piece_type"] for r in rows}
        # DripsTab.js:525-530 had brochure|sample|catalogue|kit|gift;
        # OfflineMail.js:15 had brochure|sample|newsletter|other.
        assert names == {"brochure", "sample", "catalogue", "kit",
                         "newsletter", "gift", "other"}
        assert all(r["active"] for r in rows)
        assert [r["name"] for r in rows] == sorted(r["name"] for r in rows)
    _run(go())


def test_seeding_is_idempotent(db, monkeypatch):
    async def go():
        _as(monkeypatch, ADMIN)
        await crm.get_mail_materials(FakeRequest())
        await crm.get_mail_materials(FakeRequest())
        assert await db.mail_materials.count_documents({}) == 7
    _run(go())


def test_a_renamed_seed_material_is_not_twinned_on_the_next_read(db, monkeypatch):
    """The seed is matched on `piece_type`, so renaming "Brochure" to the owner's
    own wording must not resurrect a second "Brochure" row on the next read."""
    async def go():
        _as(monkeypatch, ADMIN)
        rows = await crm.get_mail_materials(FakeRequest())
        broch = next(r for r in rows if r["piece_type"] == "brochure")
        await crm.update_mail_material(broch["material_id"],
                                       FakeRequest({"name": "School Brochure 2026"}))
        again = await crm.get_mail_materials(FakeRequest())
        assert len(again) == 7
        assert [r["piece_type"] for r in again].count("brochure") == 1
    _run(go())


def test_create_update_and_deactivate(db, monkeypatch):
    async def go():
        _as(monkeypatch, ADMIN)
        await crm.get_mail_materials(FakeRequest())
        made = await crm.create_mail_material(
            FakeRequest({"name": "2026 Die Catalogue", "piece_type": "catalogue"}))
        assert made["piece_type"] == "catalogue" and made["active"] is True

        edited = await crm.update_mail_material(
            made["material_id"], FakeRequest({"name": "2026 Die Catalogue v2"}))
        assert edited["name"] == "2026 Die Catalogue v2"
        assert edited["piece_type"] == "catalogue", "an un-sent field must not be wiped"

        out = await crm.delete_mail_material(made["material_id"], FakeRequest())
        assert out["material_id"] == made["material_id"]
        gone = await db.mail_materials.find_one({"material_id": made["material_id"]}, {"_id": 0})
        assert gone is not None, "deactivate, never delete - legacy steps still name it"
        assert gone["active"] is False

        active_only = await crm.get_mail_materials(FakeRequest())
        assert made["material_id"] not in [r["material_id"] for r in active_only]
        everything = await crm.get_mail_materials(FakeRequest(params={"include_inactive": "1"}))
        assert made["material_id"] in [r["material_id"] for r in everything]
        # The admin editor may ask with either spelling; both mean "show me the
        # retired ones too", so a retired material can be brought back.
        by_all = await crm.get_mail_materials(FakeRequest(params={"all": "1"}))
        assert made["material_id"] in [r["material_id"] for r in by_all]
    _run(go())


def test_a_retired_material_can_be_brought_back(db, monkeypatch):
    async def go():
        _as(monkeypatch, ADMIN)
        rows = await crm.get_mail_materials(FakeRequest())
        gift = next(r for r in rows if r["piece_type"] == "gift")
        await crm.delete_mail_material(gift["material_id"], FakeRequest())
        assert gift["material_id"] not in [
            r["material_id"] for r in await crm.get_mail_materials(FakeRequest())]
        back = await crm.update_mail_material(gift["material_id"],
                                              FakeRequest({"active": True}))
        assert back["active"] is True
        assert gift["material_id"] in [
            r["material_id"] for r in await crm.get_mail_materials(FakeRequest())]
    _run(go())


def test_a_blank_name_is_refused_and_a_duplicate_is_409(db, monkeypatch):
    async def go():
        _as(monkeypatch, ADMIN)
        await crm.get_mail_materials(FakeRequest())
        with pytest.raises(HTTPException) as e1:
            await crm.create_mail_material(FakeRequest({"name": "   "}))
        assert e1.value.status_code == 400
        with pytest.raises(HTTPException) as e2:
            await crm.create_mail_material(FakeRequest({"name": "brochure"}))
        assert e2.value.status_code == 409
    _run(go())


def test_updating_a_missing_material_is_404(db, monkeypatch):
    async def go():
        _as(monkeypatch, ADMIN)
        with pytest.raises(HTTPException) as e1:
            await crm.update_mail_material("mm_nope", FakeRequest({"name": "X"}))
        assert e1.value.status_code == 404
        with pytest.raises(HTTPException) as e2:
            await crm.delete_mail_material("mm_nope", FakeRequest())
        assert e2.value.status_code == 404
    _run(go())


def test_a_read_only_rep_can_list_but_not_write(db, monkeypatch):
    async def go():
        _as(monkeypatch, REP)
        rows = await crm.get_mail_materials(FakeRequest())
        assert len(rows) == 7
        with pytest.raises(HTTPException) as e:
            await crm.create_mail_material(FakeRequest({"name": "Sneaky", "piece_type": "other"}))
        assert e.value.status_code == 403
        with pytest.raises(HTTPException) as e2:
            await crm.delete_mail_material(rows[0]["material_id"], FakeRequest())
        assert e2.value.status_code == 403
    _run(go())


def test_a_broken_seed_never_crashes_startup(db, monkeypatch):
    """Execution rule: the seed is guarded like every other startup seed. If the
    database refuses the insert at boot, the app must still come up."""
    async def go():
        class _Boom:
            async def find_one(self, *a, **k):
                raise RuntimeError("mongo is having a day")

            def find(self, *a, **k):
                raise RuntimeError("mongo is having a day")

            async def insert_one(self, *a, **k):
                raise RuntimeError("mongo is having a day")

        class _DB:
            mail_materials = _Boom()

        monkeypatch.setattr(crm, "db", _DB(), raising=False)
        await crm._seed_materials()  # must not raise
    _run(go())
