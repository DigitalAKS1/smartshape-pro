"""Enrolling CONTACTS in a drip (spec 2026-09-11, D5 / Sub-project 2).

  POST /drip/enroll           {sequence_id, lead_id} OR {sequence_id, contact_id}
  POST /drip/enroll-contacts  {sequence_id, contact_ids[]} OR {sequence_id, tag_id}
  GET  /drip/enrollments      ?contact_id=

and the one rule behind all of them: the same person never runs a sequence
twice — including a contact and the lead it is linked to (R3).

mongomock only; the executor kick is replaced, so nothing runs or sends.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_contact_drip_enrol.py -q
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.crm_routes as crm
import routes.drip_routes as drip
import scheduler as sched
import services.engagement as engagement

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
REP = {"email": "rep@smartshape.in", "name": "Rep", "role": "sales",
       "module_permissions": {"leads": {"level": "read_write", "scope": "own"}}}
READ_ONLY = {"email": "ro@smartshape.in", "name": "RO", "role": "sales",
             "module_permissions": {"leads": {"level": "read", "scope": "own"}}}
OTHER = "other.rep@smartshape.in"


class FakeRequest:
    def __init__(self, body=None, params=None):
        self._body = body or {}
        self.query_params = params or {}

    async def json(self):
        return self._body


@pytest.fixture()
def env(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    for mod in (crm, drip, sched, engagement):
        monkeypatch.setattr(mod, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)
    kicks = {"n": 0}

    async def _no_executor():
        kicks["n"] += 1       # counted, never run: enrolling must not send in a test
    monkeypatch.setattr(sched, "run_drip_executor", _no_executor)
    _as(ADMIN, monkeypatch)
    return d, kicks


def _as(user, monkeypatch):
    async def _me(_request):
        return user
    monkeypatch.setattr(drip, "get_current_user", _me)
    monkeypatch.setattr(crm, "get_current_user", _me)


def _run(coro):
    return asyncio.run(coro)


async def _seq(db, sid="seq1", delay=3):
    await db.drip_sequences.insert_one({
        "sequence_id": sid, "name": f"Seq {sid}", "is_active": True,
        "steps": [{"step_number": 1, "delay_days": delay, "message_type": "call_task",
                   "message_template": "Call {name}"}]})


async def _contact(db, cid, *, school="s1", owner=ADMIN["email"], tags=(), lead_id=None,
                   deleted=False, phone="98", email="x@y.in"):
    await db.contacts.insert_one({
        "contact_id": cid, "name": cid, "school_id": school, "assigned_to": owner,
        "tag_ids": list(tags), "lead_id": lead_id, "is_deleted": deleted,
        "phone": phone, "email": email})


async def _enrol(**body):
    return await drip.enroll_lead(FakeRequest(body))


async def _bulk(**body):
    return await drip.enroll_contacts(FakeRequest(body))


def _status(exc_info):
    return exc_info.value.status_code


# ── POST /drip/enroll with a contact ────────────────────────────────────────

def test_enrol_one_contact_writes_contact_and_school_and_no_lead(env):
    db, _ = env

    async def go():
        await _seq(db)
        await _contact(db, "c1")
        leads_before = await db.leads.count_documents({})
        enr = await _enrol(sequence_id="seq1", contact_id="c1")
        assert enr["contact_id"] == "c1" and enr["lead_id"] is None
        assert enr["school_id"] == "s1" and enr["status"] == "active"
        assert await db.leads.count_documents({}) == leads_before, "a lead was invented"
    _run(go())


def test_enrol_one_lead_still_works_and_stamps_its_school(env):
    db, _ = env

    async def go():
        await _seq(db)
        await db.leads.insert_one({"lead_id": "L1", "school_id": "s9"})
        enr = await _enrol(sequence_id="seq1", lead_id="L1")
        assert enr["lead_id"] == "L1" and enr["contact_id"] is None and enr["school_id"] == "s9"
    _run(go())


@pytest.mark.parametrize("body", [
    {"sequence_id": "seq1"},
    {"sequence_id": "seq1", "lead_id": "L1", "contact_id": "c1"},
    {"contact_id": "c1"},
])
def test_enrol_needs_exactly_one_of_lead_or_contact(env, body):
    db, _ = env

    async def go():
        await _seq(db)
        with pytest.raises(HTTPException) as e:
            await _enrol(**body)
        assert _status(e) == 400
    _run(go())


def test_enrol_a_deleted_or_unknown_contact_is_404(env):
    db, _ = env

    async def go():
        await _seq(db)
        await _contact(db, "c_del", deleted=True)
        for cid in ("c_del", "nobody"):
            with pytest.raises(HTTPException) as e:
                await _enrol(sequence_id="seq1", contact_id=cid)
            assert _status(e) == 404
    _run(go())


def test_a_rep_cannot_enrol_another_reps_contact(env, monkeypatch):
    db, _ = env
    _as(REP, monkeypatch)

    async def go():
        await _seq(db)
        await db.schools.insert_one({"school_id": "s_other", "assigned_to": OTHER})
        await _contact(db, "c_theirs", school="s_other", owner=OTHER)
        await _contact(db, "c_mine", school="s_other", owner=REP["email"])
        with pytest.raises(HTTPException) as e:
            await _enrol(sequence_id="seq1", contact_id="c_theirs")
        assert _status(e) == 403
        assert (await _enrol(sequence_id="seq1", contact_id="c_mine"))["contact_id"] == "c_mine"
    _run(go())


# ── The same person, never twice (R3) ───────────────────────────────────────

def test_the_same_contact_cannot_be_enrolled_twice_in_one_sequence(env):
    db, _ = env

    async def go():
        await _seq(db)
        await _seq(db, "seq2")
        await _contact(db, "c1")
        await _enrol(sequence_id="seq1", contact_id="c1")
        with pytest.raises(HTTPException) as e:
            await _enrol(sequence_id="seq1", contact_id="c1")
        assert _status(e) == 409
        # A different sequence is fine.
        assert (await _enrol(sequence_id="seq2", contact_id="c1"))["sequence_id"] == "seq2"
    _run(go())


def test_a_contact_whose_linked_lead_is_running_the_sequence_is_refused(env):
    db, _ = env

    async def go():
        await _seq(db)
        await db.leads.insert_one({"lead_id": "L1", "school_id": "s1", "contact_id": "c1"})
        await _contact(db, "c1", lead_id="L1")
        await _enrol(sequence_id="seq1", lead_id="L1")
        with pytest.raises(HTTPException) as e:
            await _enrol(sequence_id="seq1", contact_id="c1")
        assert _status(e) == 409
        assert "same person" in e.value.detail
    _run(go())


@pytest.mark.parametrize("link", ["contact_id", "converted_from_contact", "contact.lead_id"])
def test_a_lead_whose_contact_is_running_the_sequence_is_refused(env, link):
    db, _ = env

    async def go():
        await _seq(db)
        lead = {"lead_id": "L1", "school_id": "s1"}
        if link != "contact.lead_id":
            lead[link] = "c1"
        await db.leads.insert_one(lead)
        await _contact(db, "c1", lead_id="L1" if link == "contact.lead_id" else None)
        await _enrol(sequence_id="seq1", contact_id="c1")
        with pytest.raises(HTTPException) as e:
            await _enrol(sequence_id="seq1", lead_id="L1")
        assert _status(e) == 409
        assert "same person" in e.value.detail
    _run(go())


def test_a_cancelled_enrolment_does_not_block_re_enrolment(env):
    db, _ = env

    async def go():
        await _seq(db)
        await _contact(db, "c1")
        first = await _enrol(sequence_id="seq1", contact_id="c1")
        await drip.cancel_enrollment(first["enrollment_id"], FakeRequest())
        again = await _enrol(sequence_id="seq1", contact_id="c1")
        assert again["enrollment_id"] != first["enrollment_id"]
    _run(go())


def test_enrol_schools_skips_a_school_lead_whose_contact_is_already_running_it(env):
    db, _ = env

    async def go():
        await _seq(db)
        await db.schools.insert_one({"school_id": "s1", "school_name": "DPS", "is_deleted": False})
        await db.leads.insert_one({"lead_id": "L1", "school_id": "s1", "stage": "new",
                                   "contact_id": "c1", "is_deleted": False})
        await _contact(db, "c1", lead_id="L1")
        await _enrol(sequence_id="seq1", contact_id="c1")
        out = await drip.enroll_schools(FakeRequest({"sequence_id": "seq1", "school_ids": ["s1"]}))
        assert out["enrolled"] == 0 and out["skipped"] == 1
        assert await db.drip_enrollments.count_documents({"lead_id": "L1"}) == 0
    _run(go())


def test_auto_enrol_on_lead_creation_respects_a_contact_enrolment(env):
    db, _ = env

    async def go():
        await db.drip_sequences.insert_one({
            "sequence_id": "seq_auto", "name": "Auto", "is_active": True,
            "trigger": "lead_created", "filter_designation": "",
            "steps": [{"step_number": 1, "delay_days": 1, "message_type": "call_task",
                       "message_template": "x"}]})
        await _contact(db, "c1")
        await _enrol(sequence_id="seq_auto", contact_id="c1")
        lead = {"lead_id": "L_new", "contact_id": "c1", "designation": ""}
        await db.leads.insert_one(dict(lead))
        await crm._auto_enroll_lead(lead)
        assert await db.drip_enrollments.count_documents({"lead_id": "L_new"}) == 0
        # With no linked contact running it, the lead IS auto-enrolled (unchanged).
        lead2 = {"lead_id": "L_other", "designation": ""}
        await db.leads.insert_one(dict(lead2))
        await crm._auto_enroll_lead(lead2)
        assert await db.drip_enrollments.count_documents({"lead_id": "L_other"}) == 1
    _run(go())


def test_resume_is_refused_when_the_person_is_already_running_it_again(env):
    db, _ = env

    async def go():
        await _seq(db)
        await _contact(db, "c1")
        await db.drip_enrollments.insert_one({
            "enrollment_id": "denr_paused", "sequence_id": "seq1", "lead_id": None,
            "contact_id": "c1", "status": "paused", "current_step": 0})
        await _enrol(sequence_id="seq1", contact_id="c1")          # a fresh active one
        with pytest.raises(HTTPException) as e:
            await drip.resume_enrollment("denr_paused", FakeRequest())
        assert _status(e) == 409
    _run(go())


def test_resume_of_a_lone_paused_contact_enrolment_still_works(env):
    db, _ = env

    async def go():
        await _seq(db)
        await db.drip_enrollments.insert_one({
            "enrollment_id": "denr_paused", "sequence_id": "seq1", "lead_id": None,
            "contact_id": "c1", "status": "paused", "current_step": 0})
        out = await drip.resume_enrollment("denr_paused", FakeRequest())
        assert out["status"] == "active"
    _run(go())


# ── GET /drip/enrollments?contact_id= ───────────────────────────────────────

def test_list_enrollments_filters_by_contact(env):
    db, _ = env

    async def go():
        await _seq(db)
        await _contact(db, "c1")
        await _contact(db, "c2")
        await _enrol(sequence_id="seq1", contact_id="c1")
        await _enrol(sequence_id="seq1", contact_id="c2")
        rows = await drip.list_enrollments(FakeRequest(params={"contact_id": "c1"}))
        assert [r["contact_id"] for r in rows] == ["c1"]
    _run(go())


# ── POST /drip/enroll-contacts ──────────────────────────────────────────────

def test_bulk_enrols_by_ids_and_reports_every_count(env):
    db, kicks = env

    async def go():
        await _seq(db)
        await _contact(db, "c1")
        await _contact(db, "c2", phone="", email="")          # no channel
        await _contact(db, "c_del", deleted=True)
        await _contact(db, "c_dup")
        await _enrol(sequence_id="seq1", contact_id="c_dup")
        before_leads = await db.leads.count_documents({})
        out = await _bulk(sequence_id="seq1",
                          contact_ids=["c1", "c2", "c1", "c_del", "nobody", "c_dup"])
        assert out["requested"] == 5                           # deduped
        assert out["enrolled"] == 2
        assert out["skipped_duplicate"] == 1
        assert out["skipped_missing"] == 2                     # deleted + unknown
        assert out["skipped_not_visible"] == 0
        assert out["no_channel"] == 1
        rows = await db.drip_enrollments.find({"contact_id": {"$in": ["c1", "c2"]}},
                                              {"_id": 0}).to_list(None)
        assert {r["contact_id"] for r in rows} == {"c1", "c2"}
        assert all(r["lead_id"] is None and r["school_id"] == "s1" and r["status"] == "active"
                   for r in rows)
        assert await db.leads.count_documents({}) == before_leads, "a lead was invented"
        # delay 3 days -> nothing is due, nothing is kicked
        assert out["starting_now"] is False and kicks["n"] == 0
        # one audit entry for the whole batch
        logs = await db.activity_logs.find({"action": "drip_enroll_contacts"}).to_list(None)
        assert len(logs) == 1 and "enrolled=2" in logs[0]["details"]
    _run(go())


def test_bulk_by_tag_enrols_the_tagged_people_not_their_colleagues(env):
    db, _ = env

    async def go():
        await _seq(db)
        await db.tags.insert_one({"tag_id": "t_gslc", "name": "GSLC 2026"})
        await db.schools.insert_one({"school_id": "s1", "school_name": "DPS", "is_deleted": False})
        await _contact(db, "c_went", tags=["t_gslc"])
        await _contact(db, "c_went2", tags=["t_gslc"])
        await _contact(db, "c_colleague")              # same school, not at the event
        await _contact(db, "c_went_deleted", tags=["t_gslc"], deleted=True)
        out = await _bulk(sequence_id="seq1", tag_id="t_gslc")
        assert out["matched_by_tag"] == 2 and out["enrolled"] == 2
        got = {e["contact_id"] for e in await db.drip_enrollments.find({}).to_list(None)}
        assert got == {"c_went", "c_went2"}
    _run(go())


def test_bulk_by_a_tag_that_matches_nobody_says_so(env):
    db, _ = env

    async def go():
        await _seq(db)
        with pytest.raises(HTTPException) as e:
            await _bulk(sequence_id="seq1", tag_id="t_empty")
        assert _status(e) == 400
    _run(go())


def test_bulk_skips_a_contact_whose_linked_lead_is_running_the_sequence(env):
    db, _ = env

    async def go():
        await _seq(db)
        await db.leads.insert_one({"lead_id": "L1", "contact_id": "c_via_lead"})
        await db.leads.insert_one({"lead_id": "L2"})
        await _contact(db, "c_via_lead")               # linked only from the lead side
        await _contact(db, "c_via_contact", lead_id="L2")
        await _contact(db, "c_free")
        await _enrol(sequence_id="seq1", lead_id="L1")
        await _enrol(sequence_id="seq1", lead_id="L2")
        out = await _bulk(sequence_id="seq1", contact_ids=["c_via_lead", "c_via_contact", "c_free"])
        assert out["enrolled"] == 1 and out["skipped_duplicate"] == 2
        assert await db.drip_enrollments.count_documents({"contact_id": "c_free"}) == 1
    _run(go())


def test_bulk_for_a_rep_reaches_only_their_contacts(env, monkeypatch):
    db, _ = env
    _as(REP, monkeypatch)

    async def go():
        await _seq(db)
        await db.tags.insert_one({"tag_id": "t_gslc", "name": "GSLC"})
        await db.schools.insert_one({"school_id": "s_mine", "assigned_to": REP["email"],
                                     "is_deleted": False})
        await db.schools.insert_one({"school_id": "s_theirs", "assigned_to": OTHER,
                                     "is_deleted": False})
        await _contact(db, "c_own", school="s_theirs", owner=REP["email"], tags=["t_gslc"])
        await _contact(db, "c_at_my_school", school="s_mine", owner=OTHER, tags=["t_gslc"])
        await _contact(db, "c_theirs", school="s_theirs", owner=OTHER, tags=["t_gslc"])
        out = await _bulk(sequence_id="seq1", tag_id="t_gslc")
        assert out["requested"] == 3
        assert out["enrolled"] == 2 and out["skipped_not_visible"] == 1
        got = {e["contact_id"] for e in await db.drip_enrollments.find({}).to_list(None)}
        assert got == {"c_own", "c_at_my_school"}
    _run(go())


def test_bulk_is_refused_for_a_read_only_user(env, monkeypatch):
    db, _ = env
    _as(READ_ONLY, monkeypatch)

    async def go():
        await _seq(db)
        await _contact(db, "c1")
        with pytest.raises(HTTPException) as e:
            await _bulk(sequence_id="seq1", contact_ids=["c1"])
        assert _status(e) == 403
        assert await db.drip_enrollments.count_documents({}) == 0
    _run(go())


def test_bulk_caps_at_2000_contacts(env):
    db, _ = env

    async def go():
        await _seq(db)
        with pytest.raises(HTTPException) as e:
            await _bulk(sequence_id="seq1", contact_ids=[f"c{i}" for i in range(2001)])
        assert _status(e) == 400
        assert await db.drip_enrollments.count_documents({}) == 0
        # 2000 exactly is allowed (they just don't exist here).
        out = await _bulk(sequence_id="seq1", contact_ids=[f"c{i}" for i in range(2000)])
        assert out["requested"] == 2000 and out["skipped_missing"] == 2000
    _run(go())


@pytest.mark.parametrize("body", [
    {"contact_ids": ["c1"]},                                  # no sequence
    {"sequence_id": "seq1"},                                  # no audience
    {"sequence_id": "seq1", "contact_ids": "c1"},             # not a list
])
def test_bulk_rejects_bad_input(env, body):
    db, _ = env

    async def go():
        await _seq(db)
        with pytest.raises(HTTPException) as e:
            await _bulk(**body)
        assert _status(e) == 400
    _run(go())


def test_bulk_with_a_step_due_today_kicks_the_executor(env):
    db, kicks = env

    async def go():
        await _seq(db, delay=0)
        await _contact(db, "c1")
        out = await _bulk(sequence_id="seq1", contact_ids=["c1"])
        await asyncio.sleep(0)
        assert out["starting_now"] is True and kicks["n"] == 1
    _run(go())
