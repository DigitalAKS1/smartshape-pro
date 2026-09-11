"""The drip executor runs a CONTACT-keyed enrolment (spec 2026-09-11, D5), and a
lead-keyed one exactly as before.

An enrolment now carries `lead_id` OR `contact_id`. `run_drip_executor` turns it
into a recipient through `services.drip_recipient.resolve_drip_recipient` — the
one place that rule lives — and every step branch (email / whatsapp / call_task
/ physical_material) reads that recipient. Before D5 a contact-only enrolment
raised KeyError on `enr["lead_id"]` every hour forever (swallowed by the
executor's blanket except, so it never advanced and never said why).

No outward side effects: mongomock for every db handle the executor reaches,
SMTP and the WhatsApp sender replaced by recorders, `notify_user` (bell + push)
replaced, and the real smtplib / httpx entry points booby-trapped so anything
that slips past the stubs fails the test instead of sending.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_contact_drip_executor.py -q
"""
import asyncio
import os
import smtplib
from datetime import datetime, timedelta, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import httpx
import pytest
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.crm_routes as crm
import routes.drip_routes as drip
import scheduler as sched
import services.engagement as engagement
from services.drip_recipient import RECIPIENT_GONE_REASON, resolve_drip_recipient

OWNER = "parul@smartshape.in"
SCHOOL_OWNER = "vivek@smartshape.in"


@pytest.fixture()
def env(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    for mod in (crm, drip, sched, engagement):
        monkeypatch.setattr(mod, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)

    sent = {"email": [], "wa": [], "notify": [], "errors": []}

    def _fake_smtp(sender_email, app_password, sender_name, to_email, subject, body,
                   body_html=None, reply_to=None):
        sent["email"].append({"to": to_email, "subject": subject, "body": body})

    async def _fake_wa(cfg, to_phone, message):
        if sent.get("wa_raises"):
            raise RuntimeError("provider rejected the message")
        sent["wa"].append({"to": to_phone, "text": message})

    async def _fake_notify(email, **kw):
        sent["notify"].append({"email": email, **kw})
        return "n1"

    monkeypatch.setattr(sched, "_smtp_send", _fake_smtp)
    monkeypatch.setattr(sched, "_send_wa", _fake_wa)
    monkeypatch.setattr(sched, "notify_user", _fake_notify)

    # Anything that gets past the stubs must fail loudly, never send.
    def _no_network(*a, **k):
        raise AssertionError("a test tried to reach the network")
    monkeypatch.setattr(smtplib, "SMTP", _no_network)
    monkeypatch.setattr(smtplib, "SMTP_SSL", _no_network)
    monkeypatch.setattr(httpx.AsyncClient, "post", _no_network)

    # The executor swallows every exception per enrolment and only logs it —
    # so "did not crash" has to be asserted on the log, not on a raise.
    real_error = sched.log.error

    def _capture(msg, *a, **k):
        sent["errors"].append(str(msg))
        real_error(msg, *a, **k)
    monkeypatch.setattr(sched.log, "error", _capture)
    return d, sent


def _run(coro):
    return asyncio.run(coro)


NOW = datetime.now(timezone.utc)
PAST = (NOW - timedelta(minutes=5)).isoformat()


async def _providers(db):
    await db.settings.insert_one({"type": "email", "sender_email": "hello@smartshape.in",
                                  "gmail_app_password": "x", "sender_name": "SmartShape"})
    await db.settings.insert_one({"type": "whatsapp_provider", "provider": "meta", "api_key": "k"})


async def _school(db, *, wa_consent=False):
    await db.schools.insert_one({
        "school_id": "s1", "school_name": "Delhi Public School", "address": "Rohini",
        "assigned_to": SCHOOL_OWNER, "assigned_name": "Vivek", "wa_consent": wa_consent,
        "is_deleted": False})


async def _contact(db, *, cid="c1", assigned_to=OWNER, assigned_name="Parul",
                   phone="9811111111", email="r.sharma@dps.in", deleted=False):
    await db.contacts.insert_one({
        "contact_id": cid, "name": "Ritu Sharma", "phone": phone, "email": email,
        "company": "DPS (typed by hand)", "school_id": "s1", "designation": "Principal",
        "assigned_to": assigned_to, "assigned_name": assigned_name, "is_deleted": deleted})


async def _seq(db, msg_type, template="Hello {name} from {school_name}", **extra):
    step = {"step_number": 1, "delay_days": 0, "message_type": msg_type,
            "message_template": template, **extra}
    await db.drip_sequences.insert_one({"sequence_id": "seq1", "name": "GSLC follow-up",
                                        "is_active": True, "steps": [step]})


async def _enrol(db, *, lead_id=None, contact_id=None, eid="denr_1"):
    await db.drip_enrollments.insert_one({
        "enrollment_id": eid, "sequence_id": "seq1", "lead_id": lead_id,
        "contact_id": contact_id, "school_id": "s1", "current_step": 0,
        "status": "active", "enrolled_at": PAST, "next_step_at": PAST,
        "last_step_at": None, "completed_at": None, "enrolled_by": "test"})


async def _enr(db, eid="denr_1"):
    return await db.drip_enrollments.find_one({"enrollment_id": eid}, {"_id": 0})


# ── The resolver ────────────────────────────────────────────────────────────

def test_resolver_reads_a_contact_with_its_schools_name_and_lead_shaped_aliases(env):
    db, _ = env

    async def go():
        await _school(db)
        await _contact(db)
        rec = await resolve_drip_recipient(db, {"contact_id": "c1", "lead_id": None})
        assert rec["name"] == rec["contact_name"] == "Ritu Sharma"
        assert rec["phone"] == rec["contact_phone"] == "9811111111"
        assert rec["email"] == rec["contact_email"] == "r.sharma@dps.in"
        # The school's real name, not the free-typed `company`.
        assert rec["company"] == rec["company_name"] == "Delhi Public School"
        assert rec["school_id"] == "s1"
        assert rec["assigned_to"] == OWNER
        assert rec["lead_id"] is None and rec["contact_id"] == "c1"
        # No consent on a contact -> key left unset so the school decides.
        assert "wa_consent" not in rec
    _run(go())


def test_resolver_prefers_a_live_lead_and_falls_back_to_the_contact(env):
    db, _ = env

    async def go():
        await _school(db)
        await _contact(db)
        await db.leads.insert_one({"lead_id": "L1", "contact_name": "Lead Person",
                                   "company_name": "DPS", "school_id": "s1", "is_deleted": False})
        rec = await resolve_drip_recipient(db, {"lead_id": "L1", "contact_id": "c1"})
        assert rec["lead_id"] == "L1" and rec["contact_name"] == "Lead Person"
        # A deleted lead is not a recipient; the contact takes over.
        await db.leads.update_one({"lead_id": "L1"}, {"$set": {"is_deleted": True}})
        rec = await resolve_drip_recipient(db, {"lead_id": "L1", "contact_id": "c1"})
        assert rec["contact_id"] == "c1" and rec["contact_name"] == "Ritu Sharma"
    _run(go())


def test_resolver_returns_none_when_nobody_is_left(env):
    db, _ = env

    async def go():
        await _contact(db, deleted=True)
        assert await resolve_drip_recipient(db, {"contact_id": "c1"}) is None
        assert await resolve_drip_recipient(db, {"lead_id": "gone", "contact_id": "gone"}) is None
        assert await resolve_drip_recipient(db, {}) is None
        assert await resolve_drip_recipient(db, {"lead_id": "", "contact_id": ""}) is None
    _run(go())


def test_an_unowned_contact_falls_back_to_the_schools_sales_agent(env):
    db, _ = env

    async def go():
        await _school(db)
        await _contact(db, assigned_to="", assigned_name="")
        rec = await resolve_drip_recipient(db, {"contact_id": "c1"})
        assert rec["assigned_to"] == SCHOOL_OWNER and rec["assigned_name"] == "Vivek"
    _run(go())


# ── Each step type on a contact-only enrolment ──────────────────────────────

def test_contact_only_email_step_goes_to_the_contacts_address(env):
    db, sent = env

    async def go():
        await _providers(db)
        await _school(db)
        await _contact(db)
        await _seq(db, "email")
        await _enrol(db, contact_id="c1")
        await sched.run_drip_executor()

        assert sent["errors"] == [], sent["errors"]
        assert sent["email"] == [{"to": "r.sharma@dps.in", "subject": "GSLC follow-up",
                                  "body": "Hello Ritu from Delhi Public School"}]
        enr = await _enr(db)
        assert enr["status"] == "completed" and enr["current_step"] == 1
        log = await db.drip_step_logs.find_one({"enrollment_id": "denr_1"}, {"_id": 0})
        assert log["status"] == "sent" and log["contact_id"] == "c1" and log["lead_id"] is None
        ev = await db.engagement_events.find_one({}, {"_id": 0})
        assert ev["contact_id"] == "c1" and ev["lead_id"] == "" and ev["school_id"] == "s1"
    _run(go())


def test_contact_only_whatsapp_uses_the_schools_consent(env):
    db, sent = env

    async def go():
        await _providers(db)
        await _school(db, wa_consent=True)
        await _contact(db)
        await _seq(db, "whatsapp")
        await _enrol(db, contact_id="c1")
        await sched.run_drip_executor()

        assert sent["errors"] == []
        assert sent["wa"] == [{"to": "9811111111", "text": "Hello Ritu from Delhi Public School"}]
        assert (await _enr(db))["status"] == "completed"
    _run(go())


def test_contact_only_whatsapp_without_consent_is_skipped_not_sent(env):
    db, sent = env

    async def go():
        await _providers(db)
        await _school(db, wa_consent=False)
        await _contact(db)
        await _seq(db, "whatsapp")
        await _enrol(db, contact_id="c1")
        await sched.run_drip_executor()

        assert sent["errors"] == []
        assert sent["wa"] == [], "sent a marketing WhatsApp with no consent on record"
        log = await db.drip_step_logs.find_one({"enrollment_id": "denr_1"}, {"_id": 0})
        assert log["status"] == "skipped"
        # A refusal is not a failure: the sequence moves on.
        assert (await _enr(db))["status"] == "completed"
    _run(go())


def test_contact_only_call_task_lands_on_the_owner_and_names_the_person(env):
    db, sent = env

    async def go():
        await _school(db)
        await _contact(db)
        await _seq(db, "call_task", template="Call {name} about the catalogue")
        await _enrol(db, contact_id="c1")
        await sched.run_drip_executor()

        assert sent["errors"] == []
        act = await db.crm_activities.find_one({"source": "drip"}, {"_id": 0})
        assert act["school_id"] == "s1"
        assert act["school_name"] == "Delhi Public School"
        assert act["assigned_to"] == OWNER and act["assigned_name"] == "Parul"
        assert act["contact_id"] == "c1" and act["contact_name"] == "Ritu Sharma"
        assert act["notes"] == "Call Ritu about the catalogue"
    _run(go())


def test_contact_only_physical_step_posts_to_the_school_and_carries_the_contact(env):
    db, sent = env

    async def go():
        await _school(db)
        await _contact(db)
        await _seq(db, "physical_material", template="", material_type="catalogue",
                   material_name="2026 Die Catalogue")
        await _enrol(db, contact_id="c1")
        await sched.run_drip_executor()

        assert sent["errors"] == []
        disp = await db.physical_dispatches.find_one({}, {"_id": 0})
        assert disp["lead_id"] is None and disp["contact_id"] == "c1"
        assert disp["lead_name"] == "Ritu Sharma"
        task = await db.tasks.find_one({}, {"_id": 0})
        assert task["contact_id"] == "c1" and task["assigned_to"] == OWNER
        assert "Delhi Public School" in task["title"]
        touch = await db.mail_touches.find_one({"school_id": "s1"}, {"_id": 0})
        assert touch and touch["contact_id"] == "c1" and touch["enrollment_id"] == "denr_1"
        assert (await _enr(db))["status"] == "completed"
    _run(go())


def test_a_contact_with_no_phone_or_email_still_gets_call_and_post_steps(env):
    db, sent = env

    async def go():
        await _providers(db)
        await _school(db, wa_consent=True)
        await _contact(db, phone="", email="")
        await _seq(db, "call_task")
        await _enrol(db, contact_id="c1")
        await sched.run_drip_executor()
        assert sent["errors"] == []
        assert await db.crm_activities.count_documents({"contact_id": "c1"}) == 1
    _run(go())


def test_a_failing_contact_whatsapp_pauses_and_tells_the_owner_about_the_contact(env):
    db, sent = env
    sent["wa_raises"] = True

    async def go():
        await _providers(db)
        await _school(db, wa_consent=True)
        await _contact(db)
        await _seq(db, "whatsapp")
        await _enrol(db, contact_id="c1")
        for _ in range(sched.DRIP_MAX_STEP_FAILURES):
            await db.drip_enrollments.update_one({"enrollment_id": "denr_1"},
                                                 {"$set": {"next_step_at": PAST}})
            await sched.run_drip_executor()

        assert sent["errors"] == []
        enr = await _enr(db)
        assert enr["status"] == "paused"
        assert len(sent["notify"]) == 1
        note = sent["notify"][0]
        assert note["email"] == OWNER
        assert note["ref_type"] == "contact" and note["ref_id"] == "c1"
    _run(go())


# ── Nobody left to send to ──────────────────────────────────────────────────

def test_a_deleted_contact_cancels_the_enrolment_with_a_reason_not_a_crash(env):
    db, sent = env

    async def go():
        await _providers(db)
        await _school(db, wa_consent=True)
        await _contact(db, deleted=True)
        await _seq(db, "whatsapp")
        await _enrol(db, contact_id="c1")
        await sched.run_drip_executor()

        assert sent["errors"] == []
        assert sent["wa"] == [] and sent["email"] == []
        enr = await _enr(db)
        assert enr["status"] == "cancelled"
        assert enr["cancel_reason"] == RECIPIENT_GONE_REASON
        assert enr["cancelled_at"] and enr["completed_at"]
    _run(go())


def test_vanished_lead_and_contact_cancel_with_a_reason(env):
    db, sent = env

    async def go():
        await _seq(db, "email")
        await _enrol(db, lead_id="gone_lead", contact_id="gone_contact")
        await _enrol(db, eid="denr_2")               # carries neither id
        await sched.run_drip_executor()

        assert sent["errors"] == []
        for eid in ("denr_1", "denr_2"):
            enr = await _enr(db, eid)
            assert enr["status"] == "cancelled", eid
            assert enr["cancel_reason"] == RECIPIENT_GONE_REASON
    _run(go())


def test_a_legacy_enrolment_with_no_contact_id_key_at_all_does_not_crash(env):
    # Pre-D5 documents have no `contact_id` field, and a hand-inserted one may
    # have no `lead_id` either.
    db, sent = env

    async def go():
        await _seq(db, "email")
        await db.drip_enrollments.insert_one({
            "enrollment_id": "denr_old", "sequence_id": "seq1", "current_step": 0,
            "status": "active", "enrolled_at": PAST, "next_step_at": PAST})
        await sched.run_drip_executor()
        assert sent["errors"] == []
        assert (await _enr(db, "denr_old"))["status"] == "cancelled"
    _run(go())


# ── Regression: a lead-keyed enrolment behaves exactly as before ────────────

async def _lead(db, **over):
    doc = {"lead_id": "L1", "contact_name": "Anil Kapoor", "contact_phone": "9899999999",
           "contact_email": "anil@dps.in", "company_name": "DPS Rohini", "school_id": "s1",
           "assigned_to": OWNER, "assigned_name": "Parul", "contact_id": "c_linked",
           "stage": "new", "is_deleted": False}
    doc.update(over)
    await db.leads.insert_one(doc)


def test_lead_keyed_email_reads_the_lead_exactly_as_before(env):
    db, sent = env

    async def go():
        await _providers(db)
        await _school(db)
        await _lead(db)
        await _seq(db, "email")
        await _enrol(db, lead_id="L1")
        await sched.run_drip_executor()

        assert sent["errors"] == []
        # Lead's own contact_email and company_name — not the school's name.
        assert sent["email"] == [{"to": "anil@dps.in", "subject": "GSLC follow-up",
                                  "body": "Hello Anil from DPS Rohini"}]
        log = await db.drip_step_logs.find_one({}, {"_id": 0})
        assert log["lead_id"] == "L1" and log["status"] == "sent"
        ev = await db.engagement_events.find_one({}, {"_id": 0})
        assert ev["lead_id"] == "L1" and ev["contact_id"] == "c_linked"
        assert (await _enr(db))["status"] == "completed"
    _run(go())


def test_lead_keyed_whatsapp_uses_the_leads_own_consent_and_phone(env):
    db, sent = env

    async def go():
        await _providers(db)
        await _school(db, wa_consent=False)
        await _lead(db, wa_consent=True)
        await _seq(db, "whatsapp")
        await _enrol(db, lead_id="L1")
        await sched.run_drip_executor()
        assert sent["errors"] == []
        assert sent["wa"] == [{"to": "9899999999", "text": "Hello Anil from DPS Rohini"}]
    _run(go())


def test_lead_keyed_call_task_has_the_same_shape_as_before(env):
    db, sent = env

    async def go():
        await _school(db)
        await _lead(db)
        await _seq(db, "call_task", template="Ring them")
        await _enrol(db, lead_id="L1")
        await sched.run_drip_executor()
        assert sent["errors"] == []
        act = await db.crm_activities.find_one({"source": "drip"}, {"_id": 0})
        assert act["school_name"] == "DPS Rohini" and act["assigned_to"] == OWNER
        # No new keys on a lead-keyed call task.
        assert set(act) == {"activity_id", "school_id", "school_name", "activity_type",
                            "channel", "title", "notes", "due_date", "assigned_to",
                            "assigned_name", "status", "source", "created_by",
                            "created_at", "done_at"}
    _run(go())


def test_lead_keyed_physical_step_writes_no_contact_id(env):
    db, sent = env

    async def go():
        await _school(db)
        await _lead(db)
        await _seq(db, "physical_material", template="", material_type="brochure")
        await _enrol(db, lead_id="L1")
        await sched.run_drip_executor()
        assert sent["errors"] == []
        disp = await db.physical_dispatches.find_one({}, {"_id": 0})
        assert disp["lead_id"] == "L1" and "contact_id" not in disp
        assert "contact_id" not in (await db.tasks.find_one({}, {"_id": 0}))
        assert "contact_id" not in (await db.mail_touches.find_one({}, {"_id": 0}))
    _run(go())


def test_lead_keyed_failure_still_notifies_about_the_lead(env):
    db, sent = env
    sent["wa_raises"] = True

    async def go():
        await _providers(db)
        await _school(db)
        await _lead(db, wa_consent=True)
        await _seq(db, "whatsapp")
        await _enrol(db, lead_id="L1")
        for _ in range(sched.DRIP_MAX_STEP_FAILURES):
            await db.drip_enrollments.update_one({"enrollment_id": "denr_1"},
                                                 {"$set": {"next_step_at": PAST}})
            await sched.run_drip_executor()
        assert (await _enr(db))["status"] == "paused"
        assert sent["notify"][0]["ref_type"] == "lead"
        assert sent["notify"][0]["ref_id"] == "L1"
    _run(go())


def test_a_lead_keyed_enrolment_whose_lead_is_gone_is_cancelled_as_before(env):
    db, sent = env

    async def go():
        await _seq(db, "email")
        await _enrol(db, lead_id="L_missing")
        await sched.run_drip_executor()
        assert sent["errors"] == []
        enr = await _enr(db)
        assert enr["status"] == "cancelled" and enr["completed_at"]
        # New: it now says why.
        assert enr["cancel_reason"] == RECIPIENT_GONE_REASON
    _run(go())
