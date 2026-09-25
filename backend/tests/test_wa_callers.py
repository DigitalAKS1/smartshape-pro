"""Every caller goes through send_whatsapp (D3) with the right kind, sender and consent rule.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_callers.py -q
"""
import asyncio
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest

import rbac
import routes.crm_routes as crm
import routes.school_routes as school
import routes.settings_routes as settings_mod
import routes.whatsapp_routes as wroutes
import scheduler as sched
from wa_fixtures import COMPANY, seed_wa

PARUL = "parul@smartshape.in"
ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
PAST = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}
        self.query_params = {}

    async def json(self):
        return self._body


@pytest.fixture()
def env(wa_env, monkeypatch):
    for mod in (crm, school, settings_mod, wroutes, sched):
        monkeypatch.setattr(mod, "db", wa_env.db, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)

    async def _me(_r):
        return ADMIN
    monkeypatch.setattr(settings_mod, "get_current_user", _me)
    return wa_env


def _run(coro):
    return asyncio.run(coro)


async def _kinds(db):
    return [(r["kind"], r["instance_name"], r["status"])
            for r in await db.wa_messages.find({}, {"_id": 0}).sort("created_at", 1).to_list(None)]


def test_the_queue_drains_only_due_scheduled_id_rows_with_the_right_kinds(env):
    db = env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        await db.whatsapp_scheduled.insert_many([
            {"scheduled_id": "q1", "campaign_id": "daily_digest", "status": "pending", "phone": "9811111111", "message": "digest"},
            {"scheduled_id": "q2", "campaign_id": "reminder", "status": "pending", "phone": "9822222222", "message": "remind"},
            {"scheduled_id": "q3", "campaign_id": "form_f1", "status": "pending", "phone": "9833333333", "message": "form"},
            {"scheduled_id": "q4", "campaign_id": "daily_digest", "status": "pending", "phone": "9844444444",
             "message": "later", "scheduled_at": future},
            {"scheduled_id": "q5", "campaign_id": "camp_1", "type": "campaign", "status": "pending", "phone": "9855555555", "message": ""},
            {"schedule_id": "g1", "status": "pending", "phone": "9866666666", "message": "greeting", "scheduled_at": PAST},
        ])
        await sched.process_wa_queue()
        assert await _kinds(db) == [("digest", COMPANY, "sent"), ("alert", COMPANY, "sent"), ("form", COMPANY, "sent")]
        st = {r.get("scheduled_id") or r.get("schedule_id"): r["status"]
              for r in await db.whatsapp_scheduled.find({}, {"_id": 0}).to_list(None)}
        assert st == {"q1": "sent", "q2": "sent", "q3": "sent", "q4": "pending", "q5": "pending", "g1": "pending"}
    _run(go())


def test_whatsapp_drip_steps_are_held_while_the_setting_is_off(env):
    db = env.db

    async def go():
        await seed_wa(db)                                   # drip_wa_enabled defaults to False
        await db.schools.insert_one({"school_id": "s1", "school_name": "DPS", "wa_consent": True, "is_deleted": False})
        await db.contacts.insert_one({"contact_id": "c1", "name": "Ritu", "phone": "9811111111", "school_id": "s1",
                                      "is_deleted": False})
        await db.drip_sequences.insert_one({"sequence_id": "seq1", "name": "S", "is_active": True, "steps": [
            {"step_number": 1, "delay_days": 0, "message_type": "whatsapp", "message_template": "Hi"}]})
        await db.drip_enrollments.insert_one({"enrollment_id": "e1", "sequence_id": "seq1", "contact_id": "c1",
                                              "lead_id": None, "school_id": "s1", "current_step": 0,
                                              "status": "active", "enrolled_at": PAST, "next_step_at": PAST})
        await sched.run_drip_executor()
        enr = await db.drip_enrollments.find_one({"enrollment_id": "e1"}, {"_id": 0})
        assert enr["current_step"] == 0 and enr["status"] == "active" and enr["next_step_at"] > PAST
        assert env.evo.sends == [] and await db.drip_step_logs.count_documents({}) == 0
    _run(go())


def test_fms_helper_reports_queued_as_accepted_and_keeps_its_signature(env):
    db = env.db

    async def go():
        await seed_wa(db)
        env.clock["now"] = datetime(2026, 9, 24, 15, 0, tzinfo=timezone.utc)      # 20:30 IST
        assert await sched._fms_send_wa("9811111111", "Stage done", kind="fms") == (True, "")
        assert await sched._fms_send_wa("9822222222", "Your task is overdue") == (True, "")
        assert await sched._fms_send_wa("011 2345 6789", "x") == (False, "bad_phone")
        assert [(k, s) for k, _, s in await _kinds(db)] == [("fms", "queued"), ("alert", "sent"), ("alert", "skipped")]
    _run(go())


def test_a_certificate_goes_as_a_pdf_from_the_company_number(env):
    db = env.db

    async def go():
        await seed_wa(db)
        ok, err = await sched._cert_send_one("whatsapp", {"item_id": "i1", "name": "Ritu", "phone": "9811111111",
                                                          "pdf_url": "/uploads/certificates/i1.pdf"},
                                             {"batch_id": "b1", "shared_values": {}})
        assert (ok, err) == (True, None)
        s = env.evo.sends[-1]
        assert s["instance"] == COMPANY and s["mediatype"] == "document" and s["media"].endswith("/uploads/certificates/i1.pdf")
    _run(go())


def test_intro_and_demo_go_from_the_lead_owner_and_log_the_real_result(env):
    db = env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        lead = {"lead_id": "L1", "school_id": "s1", "assigned_to": PARUL, "contact_phone": "9811111111"}
        assert await crm._send_intro_wa("9811111111", "Hello from SmartShape", lead=lead) is True
        assert await crm._send_demo_wa("9811111111", "Join here", lead=lead) is True
        assert [(k, i) for k, i, _ in await _kinds(db)] == [("intro", "rep_parul"), ("demo", "rep_parul")]
        logs = await db.whatsapp_logs.find({}, {"_id": 0}).to_list(None)
        assert [l["status"] for l in logs] == ["sent", "sent"] and all(l["wa_message_id"] for l in logs)
    _run(go())


def test_dispatch_whatsapp_goes_through_the_service(env):
    db = env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        lead = {"lead_id": "L1", "school_id": "s1", "assigned_to": PARUL, "contact_phone": "9811111111",
                "contact_name": "Ritu"}
        await crm._send_dispatch_wa(lead, {"courier_name": "Delhivery", "tracking_number": "T1",
                                           "material_type": "brochure"}, "disp1")
        row = await db.wa_messages.find_one({}, {"_id": 0})
        assert row["kind"] == "dispatch" and row["instance_name"] == "rep_parul"
        assert "delhivery.com/track/package/T1" in row["text"] and row["ref"]["dedup_key"] == "dispatch:disp1"
    _run(go())


def test_mailer_qr_alert_and_school_portal(env):
    db = env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        await db.schools.insert_one({"school_id": "s1", "school_name": "DPS", "phone": "9822222222",
                                     "assigned_to": PARUL, "is_deleted": False})
        await db.settings.insert_one({"type": "school_portal", "notify_whatsapp": True})
        await crm._wa_notify("9811111111", "New mailer lead")
        await school._wa_school("s1", "Your order shipped")
        assert [(k, i) for k, i, _ in await _kinds(db)] == [("alert", COMPANY), ("portal", "rep_parul")]
    _run(go())


def test_send_via_template_records_status_and_the_sender(env):
    db = env.db

    async def go():
        await seed_wa(db, settings={"hourly_cap": 1})
        a = await settings_mod.send_via_template(FakeRequest({"phone": "9811111111", "body": "Hi", "send_mode": "api"}))
        b = await settings_mod.send_via_template(FakeRequest({"phone": "9822222222", "body": "Hi", "send_mode": "api"}))
        assert (a["status"], a["instance_name"], b["status"]) == ("sent", COMPANY, "queued")
        assert a["wa_message_id"] and a["sent_by"] == ADMIN["email"]
    _run(go())


def test_tag_broadcast_is_not_consent_gated_but_the_preview_counts_it_and_refusals_are_reported(env):
    # Ruling 2 (Task 9): a broadcast is NOT consent-gated (CONSENT_KINDS = drip, greeting only);
    # the preview says how many recipients lack consent. An opt-out is still refused.
    db = env.db

    async def go():
        await seed_wa(db)
        await db.tags.insert_one({"tag_id": "t1", "name": "GSLC"})
        await db.schools.insert_many([
            {"school_id": "s1", "school_name": "DPS", "tag_ids": ["t1"], "wa_consent": False, "is_deleted": False},
            {"school_id": "s2", "school_name": "KV", "tag_ids": ["t1"], "wa_consent": False, "wa_opt_out": True,
             "is_deleted": False}])
        await db.leads.insert_many([
            {"lead_id": "L1", "school_id": "s1", "contact_name": "A", "contact_phone": "9811111111",
             "tag_ids": ["t1"], "is_deleted": False, "created_at": "2026-09-01"},
            {"lead_id": "L2", "school_id": "s2", "contact_name": "B", "contact_phone": "9822222222",
             "tag_ids": ["t1"], "is_deleted": False, "created_at": "2026-09-02"}])
        pre = await settings_mod.whatsapp_broadcast_by_tag_preview(FakeRequest(), tag_id="t1")
        assert (pre["unique_recipients"], pre["no_consent"]) == (2, 2)
        out = await settings_mod.whatsapp_broadcast_by_tag(FakeRequest({"tag_id": "t1", "message": "Hi {contact_name}"}))
        assert (out["sent"], out["queued"], out["skipped_policy"], out["failed"]) == (1, 0, 1, 0)
        rows = {r["lead_id"]: r for r in await db.wa_messages.find({}, {"_id": 0}).to_list(None)}
        assert (rows["L1"]["kind"], rows["L1"]["status"], rows["L1"]["instance_name"]) == ("broadcast", "sent", COMPANY)
        assert (rows["L2"]["status"], rows["L2"]["fail_reason"]) == ("skipped", "opt_out")
        assert [s["text"] for s in env.evo.sends] == ["Hi A"]
    _run(go())


def test_campaign_sends_each_contact_from_its_owner(env, monkeypatch):
    db = env.db

    async def _same(template, contact, campaign_name, ai_enabled):
        return template
    monkeypatch.setattr(wroutes, "personalize_message", _same)

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        await db.settings.insert_one({"type": "notifications", "require_wa_consent": False})
        await db.contacts.insert_many([
            {"contact_id": "c1", "name": "A", "phone": "9811111111", "assigned_to": PARUL},
            {"contact_id": "c2", "name": "B", "phone": "9822222222", "assigned_to": ""}])
        await db.whatsapp_campaigns.insert_one({"campaign_id": "camp1", "name": "Diwali", "status": "queued"})
        for sid, cid, ph in (("s1", "c1", "9811111111"), ("s2", "c2", "9822222222")):
            await db.whatsapp_scheduled.insert_one({"scheduled_id": sid, "campaign_id": "camp1", "contact_id": cid,
                                                    "phone": ph, "status": "pending", "type": "campaign",
                                                    "contact_snapshot": {}})
        await wroutes._send_campaign_background(campaign_id="camp1", sched_ids=["s1", "s2"], template="Happy Diwali",
                                                attachment_doc=None, ai_enabled=False)
        assert [(k, i) for k, i, _ in await _kinds(db)] == [("campaign", "rep_parul"), ("campaign", COMPANY)]
        camp = await db.whatsapp_campaigns.find_one({"campaign_id": "camp1"}, {"_id": 0})
        assert camp["sent_count"] == 2 and camp["status"] == "sent"
    _run(go())


def test_the_greeting_sender_does_not_whatsapp_while_greetings_are_off(env):
    db = env.db

    async def go():
        await seed_wa(db)
        today = datetime.now(sched.IST).strftime("%m-%d")
        await db.greeting_rules.insert_one({"rule_id": "gr1", "name": "Fest", "trigger": "fixed_date",
                                            "fixed_date": today, "is_active": True, "template_body": "Hi {name}"})
        await db.contacts.insert_one({"contact_id": "c1", "name": "Ritu", "phone": "9811111111"})
        await sched.run_greeting_sender()
        assert env.evo.sends == [] and await db.wa_messages.count_documents({}) == 0
    _run(go())


def test_the_old_senders_are_gone():
    for mod, names in ((sched, ("_send_wa", "_send_via_gupshup", "_send_via_360dialog", "_send_via_meta", "_wa_consent_ok")),
                       (settings_mod, ("_send_wa_autosender",))):
        for n in names:
            assert not hasattr(mod, n), f"{mod.__name__}.{n} still exists"
    import inspect
    for mod in (sched, settings_mod, crm, school, wroutes):
        assert "messageautosender.com" not in inspect.getsource(mod), mod.__name__
