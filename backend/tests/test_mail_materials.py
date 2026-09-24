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
        # Its own piece type, not the seeded `catalogue`: two ACTIVE materials
        # may not share one (see the fix-round tests below).
        made = await crm.create_mail_material(
            FakeRequest({"name": "2026 Die Catalogue", "piece_type": "die_catalogue"}))
        assert made["piece_type"] == "die_catalogue" and made["active"] is True

        edited = await crm.update_mail_material(
            made["material_id"], FakeRequest({"name": "2026 Die Catalogue v2"}))
        assert edited["name"] == "2026 Die Catalogue v2"
        assert edited["piece_type"] == "die_catalogue", "an un-sent field must not be wiped"

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


def test_a_step_with_a_legacy_material_value_still_fires(db, monkeypatch):
    """D3: `material_type: "poster"` is not in the catalogue and never will be —
    it must still produce a mailer, not a crash or a silent skip."""
    async def go():
        _as(monkeypatch, ADMIN)
        await db.schools.insert_one({"school_id": "s1", "school_name": "DPS",
                                     "is_deleted": False})
        await crm.create_physical_from_drip(
            {"lead_id": "l1", "contact_name": "R Sharma", "company_name": "DPS",
             "school_id": "s1", "assigned_to": "parul@smartshape.in"},
            "poster", "Legacy plan", material_name="Old poster",
            sequence_id="seqL", enrollment_id="eL", step_number=1,
            planned_date="2026-09-01")
        t = await db.mail_touches.find_one({"school_id": "s1"}, {"_id": 0})
        assert t is not None and t["piece_type"] == "poster"
        assert t["item_name"] == "Old poster"
        # And the catalogue is not polluted by it: a free-text value stays free
        # text, it does not quietly become a seventh-and-a-half material.
        assert await db.mail_materials.count_documents({"piece_type": "poster"}) == 0
    _run(go())


# ── Fix round 1 ──────────────────────────────────────────────────────────────

def test_two_active_materials_may_not_share_a_piece_type(db, monkeypatch):
    """`piece_type` is the identity — it is what a step's `material_type` and a
    run's `piece_type` store. Two active rows sharing one would offer the same
    stored value twice under two labels, and no report could tell them apart."""
    async def go():
        _as(monkeypatch, ADMIN)
        await crm.get_mail_materials(FakeRequest())
        with pytest.raises(HTTPException) as e:
            await crm.create_mail_material(
                FakeRequest({"name": "2026 Die Catalogue", "piece_type": "catalogue"}))
        assert e.value.status_code == 409
        assert "catalogue" in e.value.detail
    _run(go())


def test_a_retired_row_may_keep_its_piece_type_but_not_come_back_onto_a_taken_one(db, monkeypatch):
    async def go():
        _as(monkeypatch, ADMIN)
        rows = await crm.get_mail_materials(FakeRequest())
        gift = next(r for r in rows if r["piece_type"] == "gift")
        await crm.delete_mail_material(gift["material_id"], FakeRequest())
        # With `gift` retired the type is free again.
        made = await crm.create_mail_material(
            FakeRequest({"name": "Diwali Gift", "piece_type": "gift"}))
        assert made["piece_type"] == "gift"
        # Bringing the old one back would now make two active `gift` rows.
        with pytest.raises(HTTPException) as e:
            await crm.update_mail_material(gift["material_id"], FakeRequest({"active": True}))
        assert e.value.status_code == 409
    _run(go())


def test_renaming_onto_another_materials_name_is_refused(db, monkeypatch):
    async def go():
        _as(monkeypatch, ADMIN)
        rows = await crm.get_mail_materials(FakeRequest())
        gift = next(r for r in rows if r["piece_type"] == "gift")
        with pytest.raises(HTTPException) as e:
            await crm.update_mail_material(gift["material_id"], FakeRequest({"name": "brochure"}))
        assert e.value.status_code == 409
        # Renaming a material to what it is already called is not a clash.
        same = await crm.update_mail_material(gift["material_id"], FakeRequest({"name": "Gift"}))
        assert same["name"] == "Gift"
    _run(go())


def test_changing_a_piece_type_onto_a_taken_one_is_refused(db, monkeypatch):
    async def go():
        _as(monkeypatch, ADMIN)
        rows = await crm.get_mail_materials(FakeRequest())
        gift = next(r for r in rows if r["piece_type"] == "gift")
        with pytest.raises(HTTPException) as e:
            await crm.update_mail_material(gift["material_id"],
                                           FakeRequest({"piece_type": "brochure"}))
        assert e.value.status_code == 409
    _run(go())


def test_a_name_clash_with_a_retired_row_says_so_and_points_at_restore(db, monkeypatch):
    async def go():
        _as(monkeypatch, ADMIN)
        rows = await crm.get_mail_materials(FakeRequest())
        gift = next(r for r in rows if r["piece_type"] == "gift")
        await crm.delete_mail_material(gift["material_id"], FakeRequest())
        with pytest.raises(HTTPException) as e:
            await crm.create_mail_material(FakeRequest({"name": "Gift", "piece_type": "present"}))
        assert e.value.status_code == 409
        assert "(retired)" in e.value.detail and "restore" in e.value.detail.lower()
    _run(go())


def test_a_plain_read_does_not_re_seed(db, monkeypatch):
    """Seeding belongs to startup. A list read that re-seeded would resurrect a
    material the owner had deliberately removed rows for."""
    async def go():
        _as(monkeypatch, ADMIN)
        await crm.get_mail_materials(FakeRequest())
        rows = await crm.get_mail_materials(FakeRequest())
        gift = next(r for r in rows if r["piece_type"] == "gift")
        await db.mail_materials.delete_one({"material_id": gift["material_id"]})
        again = await crm.get_mail_materials(FakeRequest())
        assert len(again) == 6
        assert "gift" not in {r["piece_type"] for r in again}
    _run(go())


def test_the_seed_is_an_upsert_so_a_double_run_writes_one_row_each(db, monkeypatch):
    async def go():
        await crm._seed_materials()
        await crm._seed_materials()
        assert await db.mail_materials.count_documents({}) == 7
        assert await db.mail_materials.count_documents({"piece_type": "brochure"}) == 1
    _run(go())


def test_a_post_step_with_no_material_is_refused_where_it_is_authored(db, monkeypatch):
    """The whole point of fix 1: a blank `material_type` used to become a
    brochure at fire time, silently posting the wrong item."""
    import routes.drip_routes as drip
    with pytest.raises(HTTPException) as e:
        drip._normalise_steps([{"message_type": "physical_material",
                                "material_type": "", "material_name": "Something"}])
    assert e.value.status_code == 400
    assert "pick a material" in e.value.detail.lower()
    # A non-post step with no material is untouched.
    ok = drip._normalise_steps([{"message_type": "whatsapp", "message_template": "hi"}])
    assert ok[0]["material_type"] == ""


def test_a_legacy_material_type_is_compared_case_insensitively(db, monkeypatch):
    """So "Poster" typed by hand matches a `poster` material rather than
    becoming a second, invisible piece type."""
    import routes.drip_routes as drip
    out = drip._normalise_steps([{"message_type": "physical_material",
                                  "material_type": "  Poster  "}])
    assert out[0]["material_type"] == "poster"


def test_a_blank_material_at_fire_time_still_posts_but_warns(db, monkeypatch, caplog):
    """Legacy rows only. The send is not lost, but it stops being silent."""
    async def go():
        await db.schools.insert_one({"school_id": "s9", "school_name": "DPS",
                                     "is_deleted": False})
        with caplog.at_level("WARNING"):
            await crm.create_physical_from_drip(
                {"lead_id": "l9", "contact_name": "R Sharma", "company_name": "DPS",
                 "school_id": "s9", "assigned_to": "parul@smartshape.in"},
                "", "Legacy plan", sequence_id="seqOld", enrollment_id="eOld",
                step_number=2)
        t = await db.mail_touches.find_one({"school_id": "s9"}, {"_id": 0})
        assert t["piece_type"] == "brochure"
        assert any("no material_type" in r.getMessage() for r in caplog.records)
    _run(go())
