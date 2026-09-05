"""The whole chain the owner actually uses, end to end:

  Schools tab -> Start Sequence  (POST /drip/enroll-schools)
    -> the scheduler fires a physical_material step  (run_drip_executor)
      -> a QR-tracked mailer lands in Offline Mail   (mail_runs + mail_touches)
        -> and shows up in Today's Post Queue        (GET /mail-runs/today-queue)

Each hop is asserted separately so a break names its own layer instead of just
"drip marketing isn't linked to offline mail". mongomock.
"""
import asyncio
import os
from datetime import datetime, timedelta, timezone

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
    return d


def _run(coro):
    return asyncio.run(coro)


TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def _seed(db, delay_days=0):
    """A school with a postal address, and a one-step brochure sequence."""
    await db.schools.insert_one({
        "school_id": "s1", "school_name": "Delhi Public School",
        "address": "Sector 24, Rohini", "city": "Delhi", "pincode": "110085",
        "assigned_to": "parul@smartshape.in", "assigned_name": "Parul Kanchan",
        "is_deleted": False,
    })
    await db.users.insert_one({"email": "parul@smartshape.in", "name": "Parul Kanchan",
                               "is_active": True, "role": "sales"})
    await db.drip_sequences.insert_one({
        "sequence_id": "seq1", "name": "Principal Pitch", "is_active": True,
        "steps": [{
            "step_number": 1, "delay_days": delay_days,
            "message_type": "physical_material",
            "material_type": "catalogue",
            "material_name": "2026 Die Catalogue + Sample Kit",
            "message_template": "",
        }],
    })


# ── Hop 1: enrolling schools produces a real, runnable enrollment ───────────

def test_enrolling_a_school_creates_an_enrollment_the_executor_can_run(db):
    async def go():
        await _seed(db)
        out = await drip.enroll_schools(FakeRequest({"sequence_id": "seq1", "school_ids": ["s1"]}))
        assert out["enrolled"] == 1

        enr = await db.drip_enrollments.find_one({"sequence_id": "seq1"})
        assert enr["status"] == "active"
        # The executor looks the lead up by lead_id and CANCELS the enrollment if
        # it cannot find one, so a school enrolment must leave a real lead behind.
        assert enr.get("lead_id"), "enrollment has no lead_id — the executor will cancel it"
        lead = await db.leads.find_one({"lead_id": enr["lead_id"]})
        assert lead is not None, "enrollment points at a lead that does not exist"
        assert lead["school_id"] == "s1", "the lead must carry the school, or no mailer is possible"
    _run(go())


# ── Hop 2: the scheduler fires the physical step ────────────────────────────

def test_the_scheduler_fires_a_physical_step_and_advances_the_enrollment(db):
    async def go():
        await _seed(db)
        await drip.enroll_schools(FakeRequest({"sequence_id": "seq1", "school_ids": ["s1"]}))
        await sched.run_drip_executor()

        enr = await db.drip_enrollments.find_one({"sequence_id": "seq1"})
        assert enr["status"] != "cancelled", "the executor cancelled the enrollment"
        assert enr.get("current_step", 0) >= 1, "the step never fired"
        assert await db.physical_dispatches.count_documents({}) == 1
    _run(go())


def test_a_physical_step_fires_even_with_no_whatsapp_or_email_configured(db):
    # Posting a catalogue does not need a messaging provider. If the executor
    # were gated on one, every postal sequence would sit dormant forever.
    async def go():
        await _seed(db)
        assert await db.settings.count_documents({}) == 0
        await drip.enroll_schools(FakeRequest({"sequence_id": "seq1", "school_ids": ["s1"]}))
        await sched.run_drip_executor()
        assert await db.mail_touches.count_documents({}) == 1
    _run(go())


# ── Hop 3: it lands in Offline Mail, carrying its origin ────────────────────

def test_the_mailer_lands_in_offline_mail_linked_back_to_the_sequence(db):
    async def go():
        await _seed(db)
        await drip.enroll_schools(FakeRequest({"sequence_id": "seq1", "school_ids": ["s1"]}))
        await sched.run_drip_executor()

        run = await db.mail_runs.find_one({"is_drip_run": True}, {"_id": 0})
        assert run, "no mail run was created — nothing reaches Offline Mail"
        assert run["sequence_id"] == "seq1"
        assert run["sequence_name"] == "Principal Pitch", \
            "the run cannot say which sequence produced it"
        assert run["counts"]["sent"] == 1

        touch = await db.mail_touches.find_one({"school_id": "s1"}, {"_id": 0})
        assert touch, "no mailer for the school"
        assert touch["run_id"] == run["run_id"]
        assert touch["source"] == "drip"
        assert touch["sequence_id"] == "seq1"
        assert touch["enrollment_id"], "no back-link to the enrollment"
        assert touch["step_number"] == 1
        assert touch["qr_token"], "no QR token — the mailer is not trackable"
        assert touch["item_name"] == "2026 Die Catalogue + Sample Kit"
        assert touch["planned_date"] == TODAY
    _run(go())


def test_the_run_appears_in_the_offline_mail_list(db):
    async def go():
        await _seed(db)
        await drip.enroll_schools(FakeRequest({"sequence_id": "seq1", "school_ids": ["s1"]}))
        await sched.run_drip_executor()
        runs = await crm.get_mail_runs(FakeRequest())
        assert any(r.get("is_drip_run") for r in runs), \
            "drip runs are filtered out of the Offline Mail list"
    _run(go())


# ── Hop 4: it reaches the person who actually posts it ──────────────────────

def test_the_mailer_reaches_todays_post_queue(db):
    async def go():
        await _seed(db)
        await drip.enroll_schools(FakeRequest({"sequence_id": "seq1", "school_ids": ["s1"]}))
        await sched.run_drip_executor()

        queue = await crm.mail_today_queue(FakeRequest())
        assert queue["total"] == 1, "the drip mailer never reaches the posting queue"
        group = queue["groups"][0]
        assert group["is_drip_run"] is True
        assert group["sequence_name"] == "Principal Pitch", \
            "the queue cannot tell the poster which campaign this is"
    _run(go())


def test_the_printable_address_is_the_schools_real_address(db):
    async def go():
        await _seed(db)
        await drip.enroll_schools(FakeRequest({"sequence_id": "seq1", "school_ids": ["s1"]}))
        await sched.run_drip_executor()
        run = await db.mail_runs.find_one({"is_drip_run": True}, {"_id": 0})
        assert "s1" in run["school_ids"], \
            "the school is not on the run, so its address sheet and stickers are empty"
    _run(go())


# ── Not-yet-due steps must not post early ───────────────────────────────────

def test_a_step_that_is_not_due_yet_posts_nothing(db):
    async def go():
        await _seed(db, delay_days=7)
        await drip.enroll_schools(FakeRequest({"sequence_id": "seq1", "school_ids": ["s1"]}))
        await sched.run_drip_executor()
        assert await db.mail_touches.count_documents({}) == 0
        assert await db.mail_runs.count_documents({}) == 0
    _run(go())


# ── The hour-long silence between enrolling and anything appearing ──────────

def test_a_step_due_today_starts_immediately_instead_of_waiting_an_hour(db, monkeypatch):
    # The executor loops hourly. Enrolling schools into a sequence whose first
    # step is due today therefore left Offline Mail empty for up to 60 minutes
    # with nothing on screen to say a thing was pending — which is
    # indistinguishable from the feature being broken.
    fired = {"n": 0}
    real = sched.run_drip_executor

    async def counting():
        fired["n"] += 1
        await real()
    monkeypatch.setattr(sched, "run_drip_executor", counting)

    async def go():
        await _seed(db, delay_days=0)
        out = await drip.enroll_schools(FakeRequest({"sequence_id": "seq1", "school_ids": ["s1"]}))
        assert out["starting_now"] is True, \
            "the caller is not told the first step is going out now"
        await asyncio.sleep(0)          # let the kicked task run
        assert fired["n"] == 1, "enrolling did not kick the executor"
        assert await db.mail_touches.count_documents({}) == 1
    _run(go())


def test_a_later_first_step_does_not_kick_the_executor(db, monkeypatch):
    fired = {"n": 0}

    async def counting():
        fired["n"] += 1
    monkeypatch.setattr(sched, "run_drip_executor", counting)

    async def go():
        await _seed(db, delay_days=7)
        out = await drip.enroll_schools(FakeRequest({"sequence_id": "seq1", "school_ids": ["s1"]}))
        assert out["starting_now"] is False
        await asyncio.sleep(0)
        assert fired["n"] == 0, "nothing is due, so nothing should have been kicked"
    _run(go())
