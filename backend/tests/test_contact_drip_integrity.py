"""Contact-keyed drip enrolments (D5) survive the clean-up code, go away with
their contact, and show up everywhere a lead-keyed one does.

  * POST /admin/db-integrity (the orphan sweep) must NOT delete a contact-only
    enrolment. It used to call anything whose `lead_id` pointed at no lead an
    orphan and DELETE it — a contact-only enrolment has no lead at all. An
    enrolment is an orphan only when EVERY id it carries points at nothing.
  * Deleting a contact / school takes its contact-keyed enrolments with it,
    the same way a lead's go: archived (soft delete) -> cancelled with a
    reason; owner-only cascade -> snapshotted then deleted.
  * The sequence deliveries drill-down, the school's drips card, the school
    360 feed and the contact's own activity show contact-only rows with a real
    school / owner / name instead of blanks (or a KeyError).

mongomock only; nothing sends.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_contact_drip_integrity.py -q
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import audit_backup
import cascade_delete
import rbac
import routes.admin_routes as admin
import routes.crm_routes as crm
import routes.drip_routes as drip
import scheduler as sched
import services.engagement as engagement

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}


class FakeRequest:
    def __init__(self, body=None, params=None):
        self._body = body or {}
        self.query_params = params or {}

    async def json(self):
        return self._body

    async def body(self):
        return b""


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    for mod in (crm, drip, sched, engagement, admin, cascade_delete, audit_backup):
        monkeypatch.setattr(mod, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)

    async def _me(_request):
        return ADMIN
    for mod in (crm, drip, admin):
        monkeypatch.setattr(mod, "get_current_user", _me, raising=False)

    async def _no_executor():
        raise AssertionError("the drip executor must not run in this test")
    monkeypatch.setattr(sched, "run_drip_executor", _no_executor)
    return d


def _run(coro):
    return asyncio.run(coro)


def _enr(eid, *, lead_id=None, contact_id=None, school_id="s1", status="active", **extra):
    doc = {"enrollment_id": eid, "sequence_id": "seq1", "lead_id": lead_id,
           "contact_id": contact_id, "school_id": school_id, "status": status,
           "current_step": 0, "enrolled_at": "2026-09-01T00:00:00+00:00",
           "next_step_at": "2026-09-20T00:00:00+00:00"}
    doc.update(extra)
    return doc


async def _base(db):
    await db.schools.insert_one({"school_id": "s1", "school_name": "Delhi Public School",
                                 "assigned_to": "vivek@smartshape.in", "is_deleted": False})
    await db.contacts.insert_one({"contact_id": "c_live", "name": "Ritu Sharma",
                                  "designation": "Principal", "school_id": "s1",
                                  "assigned_to": "parul@smartshape.in", "is_deleted": False})
    await db.contacts.insert_one({"contact_id": "c_deleted", "name": "Gone", "school_id": "s1",
                                  "is_deleted": True})
    await db.leads.insert_one({"lead_id": "L_live", "school_id": "s1", "contact_name": "Anil",
                               "company_name": "DPS", "assigned_to": "parul@smartshape.in",
                               "is_deleted": False})
    await db.drip_sequences.insert_one({
        "sequence_id": "seq1", "name": "GSLC follow-up", "is_active": True,
        "steps": [{"step_number": 1, "delay_days": 0, "message_type": "call_task",
                   "message_template": "x"},
                  {"step_number": 2, "delay_days": 5, "message_type": "email",
                   "message_template": "y"}]})


# ── The data-loss risk: the admin orphan sweep ──────────────────────────────

def test_the_orphan_sweep_keeps_contact_only_enrolments(db):
    async def go():
        await _base(db)
        await db.drip_enrollments.insert_many([
            _enr("keep_contact_only", contact_id="c_live"),
            # blank-string lead_id: the OLD sweep matched this ("" is $nin and
            # $ne None) and deleted a live person's enrolment.
            _enr("keep_blank_lead", lead_id="", contact_id="c_live"),
            _enr("keep_lead", lead_id="L_live"),
            _enr("keep_dead_lead_live_contact", lead_id="L_gone", contact_id="c_live"),
            _enr("keep_live_lead_dead_contact", lead_id="L_live", contact_id="c_deleted"),
            _enr("keep_no_ids_at_all"),                     # malformed: executor cancels it
            _enr("orphan_dead_lead", lead_id="L_gone"),
            _enr("orphan_dead_contact", contact_id="c_deleted"),
            _enr("orphan_missing_contact", contact_id="c_never_existed"),
            _enr("orphan_both_dead", lead_id="L_gone", contact_id="c_never_existed"),
        ])
        report = await admin.run_db_integrity(FakeRequest())
        left = {e["enrollment_id"] for e in await db.drip_enrollments.find({}).to_list(None)}
        assert left == {"keep_contact_only", "keep_blank_lead", "keep_lead",
                        "keep_dead_lead_live_contact", "keep_live_lead_dead_contact",
                        "keep_no_ids_at_all"}
        assert report["found"]["drip_enrollments_orphan"] == 4
    _run(go())


def test_the_orphan_sweep_keeps_a_contact_drips_task_and_dispatch(db):
    async def go():
        await _base(db)
        await db.tasks.insert_many([
            {"task_id": "t_contact_drip", "lead_id": None, "contact_id": "c_live"},
            {"task_id": "t_contact_blank", "lead_id": "", "contact_id": "c_live"},
            {"task_id": "t_orphan", "lead_id": "L_gone"},
            {"task_id": "t_live", "lead_id": "L_live"},
        ])
        await db.physical_dispatches.insert_many([
            {"dispatch_id": "pd_contact", "lead_id": None, "contact_id": "c_live"},
            {"dispatch_id": "pd_orphan", "lead_id": "L_gone"},
        ])
        await admin.run_db_integrity(FakeRequest())
        tasks = {t["task_id"] for t in await db.tasks.find({}).to_list(None)}
        assert tasks == {"t_contact_drip", "t_contact_blank", "t_live"}
        disp = {d["dispatch_id"] for d in await db.physical_dispatches.find({}).to_list(None)}
        assert disp == {"pd_contact"}
    _run(go())


# ── Deleting the contact / school ───────────────────────────────────────────

def test_archiving_a_contact_cancels_its_sequences_with_a_reason(db):
    async def go():
        await _base(db)
        await db.contacts.insert_one({"contact_id": "c_other", "school_id": "s1",
                                      "is_deleted": False})
        await db.drip_enrollments.insert_many([
            _enr("e_active", contact_id="c_live"),
            _enr("e_paused", contact_id="c_live", status="paused"),
            _enr("e_done", contact_id="c_live", status="completed"),
            _enr("e_other", contact_id="c_other"),
            _enr("e_lead", lead_id="L_live"),
        ])
        await crm.delete_contact("c_live", FakeRequest())
        by_id = {e["enrollment_id"]: e for e in await db.drip_enrollments.find({}, {"_id": 0}).to_list(None)}
        assert len(by_id) == 5, "archiving must not delete enrolment history"
        for eid in ("e_active", "e_paused"):
            assert by_id[eid]["status"] == "cancelled"
            assert by_id[eid]["cancel_reason"] and by_id[eid]["cancelled_at"]
        assert by_id["e_done"]["status"] == "completed"
        assert by_id["e_other"]["status"] == "active"
        assert by_id["e_lead"]["status"] == "active"
    _run(go())


def test_an_archived_contacts_enrolment_cannot_be_resumed_and_says_why(db):
    from fastapi import HTTPException

    async def go():
        await _base(db)
        await db.drip_enrollments.insert_one(_enr("e_active", contact_id="c_live"))
        await crm.delete_contact("c_live", FakeRequest())
        with pytest.raises(HTTPException) as e:
            await drip.resume_enrollment("e_active", FakeRequest())
        assert e.value.status_code == 409
        assert "contact was deleted" in e.value.detail
        assert "in bulk" not in e.value.detail
    _run(go())


def test_the_owner_cascade_on_a_contact_deletes_its_enrolments_after_a_backup(db):
    async def go():
        await _base(db)
        await db.contacts.insert_one({"contact_id": "c_other", "school_id": "s1",
                                      "is_deleted": False})
        await db.drip_enrollments.insert_many([
            _enr("e_mine", contact_id="c_live"),
            _enr("e_other", contact_id="c_other"),
            _enr("e_lead", lead_id="L_live"),
        ])
        await db.physical_dispatches.insert_one({"dispatch_id": "pd1", "lead_id": None,
                                                 "contact_id": "c_live"})
        out = await crm.cascade_delete_contact("c_live", FakeRequest())
        left = {e["enrollment_id"] for e in await db.drip_enrollments.find({}).to_list(None)}
        assert left == {"e_other", "e_lead"}
        assert await db.physical_dispatches.count_documents({}) == 0
        assert out["counts"].get("drip_enrollments") == 1
        # restorable: the enrolment is in the backup
        chunks = await db.audit_backups.find({"backup_id": out["backup_id"],
                                              "collection": "drip_enrollments"}).to_list(None)
        assert [d["enrollment_id"] for c in chunks for d in c["docs"]] == ["e_mine"]
    _run(go())


def test_the_school_cascade_takes_contact_only_enrolments_too(db):
    async def go():
        await _base(db)
        await db.schools.insert_one({"school_id": "s2", "school_name": "Other"})
        await db.contacts.insert_one({"contact_id": "c_s2", "school_id": "s2"})
        await db.drip_enrollments.insert_many([
            _enr("e_contact", contact_id="c_live"),
            _enr("e_lead", lead_id="L_live"),
            # contact moved away / gone, but the enrolment is stamped with s1
            _enr("e_stamped", contact_id="c_vanished", school_id="s1"),
            _enr("e_s2", contact_id="c_s2", school_id="s2"),
        ])
        school = await db.schools.find_one({"school_id": "s1"}, {"_id": 0})
        plan, _, _ = await cascade_delete.build_school_plan(school)
        await audit_backup.snapshot_and_delete(plan, root_type="school", root_id="s1",
                                               root_label="DPS", deleted_by="t")
        left = {e["enrollment_id"] for e in await db.drip_enrollments.find({}).to_list(None)}
        assert left == {"e_s2"}
    _run(go())


# ── Showing contact-only enrolments ─────────────────────────────────────────

def test_sequence_deliveries_show_a_contact_only_row_with_its_school_and_owner(db):
    async def go():
        await _base(db)
        await db.drip_enrollments.insert_many([
            _enr("e_contact", contact_id="c_live"),
            _enr("e_lead", lead_id="L_live"),
        ])
        out = await drip.sequence_deliveries("seq1", FakeRequest())
        rows = [r for r in out["rows"] if r["enrollment_id"] == "e_contact"]
        assert len(rows) == 2                                  # one per step
        for r in rows:
            assert r["contact_id"] == "c_live" and r["lead_id"] is None
            assert r["school_id"] == "s1" and r["school_name"] == "Delhi Public School"
            assert r["owner"] == "parul@smartshape.in"
        lead_rows = [r for r in out["rows"] if r["enrollment_id"] == "e_lead"]
        assert lead_rows[0]["owner"] == "parul@smartshape.in"
        assert lead_rows[0]["school_name"] == "Delhi Public School"
    _run(go())


def test_sequence_deliveries_survive_a_vanished_contact(db):
    async def go():
        await _base(db)
        await db.drip_enrollments.insert_one(_enr("e_gone", contact_id="c_never", school_id="s1"))
        out = await drip.sequence_deliveries("seq1", FakeRequest())
        assert {r["school_name"] for r in out["rows"]} == {"Delhi Public School"}
    _run(go())


def test_school_drips_lists_contact_only_enrolments_with_the_persons_name(db):
    async def go():
        await _base(db)
        await db.drip_enrollments.insert_many([
            _enr("e_contact", contact_id="c_live"),
            _enr("e_lead", lead_id="L_live"),
            _enr("e_elsewhere", contact_id="c_x", school_id="s_other"),
        ])
        out = await drip.school_drips("s1", FakeRequest())
        by_id = {r["enrollment_id"]: r for r in out["rows"]}
        assert set(by_id) == {"e_contact", "e_lead"}
        assert by_id["e_contact"]["recipient_kind"] == "contact"
        assert by_id["e_contact"]["recipient_name"] == "Ritu Sharma"
        assert by_id["e_contact"]["owner"] == "parul@smartshape.in"
        assert by_id["e_lead"]["recipient_kind"] == "lead"
        assert out["active"] == 2
    _run(go())


def test_school_drips_for_a_school_with_only_contact_enrolments(db):
    # Before D5 a school with no leads returned nothing at all.
    async def go():
        await db.schools.insert_one({"school_id": "s9", "school_name": "No Deals Yet"})
        await db.contacts.insert_one({"contact_id": "c9", "name": "P", "school_id": "s9"})
        await db.drip_sequences.insert_one({"sequence_id": "seq1", "name": "S", "steps": []})
        await db.drip_enrollments.insert_one(_enr("e9", contact_id="c9", school_id="s9"))
        out = await drip.school_drips("s9", FakeRequest())
        assert [r["enrollment_id"] for r in out["rows"]] == ["e9"]
    _run(go())


def test_the_school_360_feed_includes_contact_enrolments(db):
    async def go():
        await _base(db)
        await db.drip_enrollments.insert_many([
            _enr("e_contact", contact_id="c_live"),
            _enr("e_lead", lead_id="L_live"),
        ])
        profile = await crm.get_school_profile("s1", FakeRequest())
        drips = [c for c in profile["communications"] if c["channel"] == "drip"]
        assert len(drips) == 2
        assert all(d["label"] == "GSLC follow-up" for d in drips)
    _run(go())


def test_the_school_360_shows_a_contact_drips_posted_material(db):
    async def go():
        await _base(db)
        await db.physical_dispatches.insert_one({"dispatch_id": "pd1", "lead_id": None,
                                                 "contact_id": "c_live", "sent_date": ""})
        profile = await crm.get_school_profile("s1", FakeRequest())
        assert [d["dispatch_id"] for d in profile["dispatches"]] == ["pd1"]
    _run(go())


def test_contact_activity_includes_its_own_and_its_leads_enrolments(db):
    async def go():
        await _base(db)
        await db.contacts.update_one({"contact_id": "c_live"}, {"$set": {"lead_id": "L_live"}})
        await db.drip_enrollments.insert_many([
            _enr("e_contact", contact_id="c_live"),
            _enr("e_lead", lead_id="L_live", enrolled_at="2026-09-02T00:00:00+00:00"),
            _enr("e_someone_else", contact_id="c_other"),
        ])
        items = await crm.get_contact_activity("c_live", FakeRequest())
        drips = [i for i in items if i["type"] == "drip"]
        assert len(drips) == 2
    _run(go())


def test_contact_activity_for_an_unconverted_contact_still_shows_its_drip(db):
    async def go():
        await _base(db)
        await db.drip_enrollments.insert_one(_enr("e_contact", contact_id="c_live"))
        items = await crm.get_contact_activity("c_live", FakeRequest())
        assert [i["label"] for i in items if i["type"] == "drip"] == ["GSLC follow-up"]
    _run(go())
