"""B1: one posting, one record of truth (D4) and no school = flagged, not vanished (D2)."""
import asyncio
import os
from datetime import datetime, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.crm_routes as crm
import routes.drip_routes as drip
import scheduler as sched
import rbac

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}


class FakeRequest:
    def __init__(self, body=None, params=None):
        self._body = body or {}
        self.query_params = params or {}

    async def json(self):
        return self._body


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    for mod in (crm, drip, sched):
        monkeypatch.setattr(mod, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")

    async def _me(_request):
        return ADMIN
    monkeypatch.setattr(crm, "get_current_user", _me)
    monkeypatch.setattr(drip, "get_current_user", _me)

    async def _no_wa(*a, **k):
        raise AssertionError("test tried to send WhatsApp")

    def _no_smtp(*a, **k):
        raise AssertionError("test tried to send email")
    monkeypatch.setattr(sched, "_send_wa", _no_wa, raising=False)
    monkeypatch.setattr(sched, "_smtp_send", _no_smtp, raising=False)
    return d


def _run(coro):
    return asyncio.run(coro)


TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")


def test_a_fired_post_step_links_touch_and_dispatch_both_ways(db):
    async def go():
        await db.schools.insert_one({"school_id": "s1", "school_name": "DPS",
                                     "address": "Rohini", "is_deleted": False})
        dispatch_id = await crm.create_physical_from_drip(
            {"lead_id": "l1", "contact_id": "c1", "contact_name": "R Sharma",
             "company_name": "DPS", "school_id": "s1", "assigned_to": "parul@smartshape.in"},
            "catalogue", "Principal Pitch", material_name="2026 Catalogue",
            sequence_id="seq1", enrollment_id="e1", step_number=1, planned_date=TODAY)

        d = await db.physical_dispatches.find_one({"dispatch_id": dispatch_id}, {"_id": 0})
        t = await db.mail_touches.find_one({"school_id": "s1"}, {"_id": 0})
        assert t is not None
        assert d["touch_id"] == t["touch_id"], "dispatch does not point at its touch"
        assert dispatch_id in t["dispatch_ids"], "touch does not point back at its dispatch"
        assert d["enrollment_id"] == "e1" and d["step_number"] == 1
        assert "needs_dispatch" not in d, "needs_dispatch is derived (D4), not stored"
        assert t["contact_ids"] == ["c1"]
        assert t["recipient_names"] == ["R Sharma"]
    _run(go())


def test_three_contacts_at_one_school_make_one_touch_with_three_names(db):
    async def go():
        await db.schools.insert_one({"school_id": "s1", "school_name": "DPS", "is_deleted": False})
        for i, name in enumerate(["R Sharma", "K Verma", "A Menon"], start=1):
            await crm.create_physical_from_drip(
                {"lead_id": "", "contact_id": f"c{i}", "contact_name": name,
                 "company_name": "DPS", "school_id": "s1", "assigned_to": "parul@smartshape.in"},
                "catalogue", "Principal Pitch", material_name="2026 Catalogue",
                sequence_id="seq1", enrollment_id=f"e{i}", step_number=1, planned_date=TODAY)

        assert await db.mail_touches.count_documents({}) == 1, "D1: one envelope per school"
        t = await db.mail_touches.find_one({}, {"_id": 0})
        assert t["recipient_names"] == ["R Sharma", "K Verma", "A Menon"]
        assert t["contact_ids"] == ["c1", "c2", "c3"]
        assert len(t["dispatch_ids"]) == 3
        run = await db.mail_runs.find_one({}, {"_id": 0})
        assert run["counts"]["sent"] == 1, "one envelope, not three"
    _run(go())


def test_a_school_less_contact_still_gets_a_flagged_mailer(db):
    async def go():
        dispatch_id = await crm.create_physical_from_drip(
            {"lead_id": "", "contact_id": "c9", "contact_name": "No School",
             "company_name": "", "school_id": "", "assigned_to": "bde@smartshape.in"},
            "brochure", "Quiz Engage", material_name="Quiz flyer",
            sequence_id="seq2", enrollment_id="e9", step_number=1, planned_date=TODAY)

        t = await db.mail_touches.find_one({"contact_ids": "c9"}, {"_id": 0})
        assert t is not None, "D2: the mailer row must still be created"
        assert t["verify_status"] == "needs_address"
        assert t["school_id"] == ""
        d = await db.physical_dispatches.find_one({"dispatch_id": dispatch_id}, {"_id": 0})
        assert d["touch_id"] == t["touch_id"]
    _run(go())


def test_two_school_less_contacts_get_two_envelopes_not_one(db):
    async def go():
        for i in (1, 2):
            await crm.create_physical_from_drip(
                {"lead_id": "", "contact_id": f"cx{i}", "contact_name": f"Person {i}",
                 "company_name": "", "school_id": "", "assigned_to": "bde@smartshape.in"},
                "brochure", "Quiz Engage", material_name="Quiz flyer",
                sequence_id="seq2", enrollment_id=f"ex{i}", step_number=1, planned_date=TODAY)
        assert await db.mail_touches.count_documents({}) == 2, \
            "no school means no envelope to share — one per contact"
    _run(go())


def test_giving_the_contact_a_school_moves_the_touch_back_to_pending(db):
    async def go():
        await crm.create_physical_from_drip(
            {"lead_id": "", "contact_id": "c9", "contact_name": "No School",
             "company_name": "", "school_id": "", "assigned_to": "bde@smartshape.in"},
            "brochure", "Quiz Engage", material_name="Quiz flyer",
            sequence_id="seq2", enrollment_id="e9", step_number=1, planned_date=TODAY)
        await db.schools.insert_one({"school_id": "s5", "school_name": "Lotus",
                                     "address": "Noida", "is_deleted": False})
        await db.contacts.insert_one({"contact_id": "c9", "name": "No School", "school_id": "s5"})

        out = await crm.repair_needs_address_touches()
        assert out["repaired"] == 1
        t = await db.mail_touches.find_one({"contact_ids": "c9"}, {"_id": 0})
        assert t["verify_status"] == "pending"
        assert t["school_id"] == "s5"
        run = await db.mail_runs.find_one({"run_id": t["run_id"]}, {"_id": 0})
        assert "s5" in run["school_ids"]
    _run(go())


def test_run_counts_carry_needs_address_and_block_posted(db):
    async def go():
        await crm.create_physical_from_drip(
            {"lead_id": "", "contact_id": "c9", "contact_name": "No School",
             "company_name": "", "school_id": "", "assigned_to": "bde@smartshape.in"},
            "brochure", "Quiz Engage", sequence_id="seq2", enrollment_id="e9",
            step_number=1, planned_date=TODAY)
        t = await db.mail_touches.find_one({}, {"_id": 0})
        run = await crm._recompute_run_counts(t["run_id"])
        assert run["counts"]["needs_address"] == 1
        assert run["status"] == "planned", "a needs_address piece is not posted"
    _run(go())


def test_repair_is_callable_with_an_explicit_db(db):
    """The executor passes its own handle; the tests rely on the module default."""
    async def go():
        await crm.create_physical_from_drip(
            {"lead_id": "", "contact_id": "c7", "contact_name": "Later School",
             "company_name": "", "school_id": "", "assigned_to": "bde@smartshape.in"},
            "brochure", "Quiz Engage", sequence_id="seq2", enrollment_id="e7",
            step_number=1, planned_date=TODAY)
        await db.schools.insert_one({"school_id": "s8", "school_name": "Ryan",
                                     "is_deleted": False})
        await db.contacts.insert_one({"contact_id": "c7", "name": "Later School",
                                      "school_id": "s8"})
        out = await crm.repair_needs_address_touches(db)
        assert out["repaired"] == 1
    _run(go())


def test_dispatch_list_derives_needs_dispatch_from_its_touch(db):
    async def go():
        await db.schools.insert_one({"school_id": "s1", "school_name": "DPS",
                                     "is_deleted": False})
        linked = await crm.create_physical_from_drip(
            {"lead_id": "l1", "contact_id": "c1", "contact_name": "R Sharma",
             "company_name": "DPS", "school_id": "s1", "assigned_to": "parul@smartshape.in"},
            "catalogue", "Principal Pitch", sequence_id="seq1", enrollment_id="e1",
            step_number=1, planned_date=TODAY)
        # A hand-made dispatch has no touch — it is never "owed to the post office".
        await db.physical_dispatches.insert_one({
            "dispatch_id": "pd_manual", "lead_id": "l2", "lead_name": "Manual",
            "material_type": "brochure", "created_by": "info@smartshape.in",
            "sent_date": "2026-09-01", "created_at": "2026-09-01T00:00:00+00:00"})

        rows = await crm.get_physical_dispatches(FakeRequest())
        by_id = {r["dispatch_id"]: r for r in rows}
        assert by_id[linked]["needs_dispatch"] is True
        assert by_id[linked]["verify_status"] == "pending"
        assert by_id["pd_manual"]["needs_dispatch"] is False

        # Ticking the touch posted clears the derived flag and back-fills sent_date.
        await db.mail_touches.update_many({}, {"$set": {"verify_status": "sent",
                                                        "posted_at": "2026-09-20T00:00:00+00:00"}})
        rows = await crm.get_physical_dispatches(FakeRequest())
        row = {r["dispatch_id"]: r for r in rows}[linked]
        assert row["needs_dispatch"] is False
        assert row["sent_date"] == "2026-09-20"
    _run(go())
