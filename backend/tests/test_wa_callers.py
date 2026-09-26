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


# ── Fix round 1 ───────────────────────────────────────────────────────────────

AT_2000_IST = datetime(2026, 9, 24, 14, 30, tzinfo=timezone.utc)      # Thu 24 Sep, 20:00 IST
NEXT_1000_IST = datetime(2026, 9, 25, 4, 30, tzinfo=timezone.utc)     # Fri 25 Sep, 10:00 IST


def _ago(**kw):
    return (datetime.now(timezone.utc) - timedelta(**kw)).isoformat()


def test_a_scheduled_message_ignores_business_hours_but_a_system_one_does_not(env):
    # fix 1: a person picked the time of a `scheduled` message - it goes at 20:00 IST like a chat
    db = env.db

    async def go():
        import services.wa_send as ws
        await seed_wa(db)
        env.clock["now"] = AT_2000_IST
        a = await ws.send_whatsapp(db, to="9811111111", text="At 8 pm as asked", kind="scheduled",
                                   enforce_consent=False)
        b = await ws.send_whatsapp(db, to="9822222222", text="Form stage", kind="form", enforce_consent=False)
        assert (a["status"], b["status"], b["reason"]) == ("sent", "queued", "quiet_hours")
        # the opt-out still applies to a scheduled message
        await db.wa_opt_outs.insert_one({"phone_e164": "919833333333", "active": True})
        c = await ws.send_whatsapp(db, to="9833333333", text="x", kind="scheduled", enforce_consent=False)
        assert (c["status"], c["reason"]) == ("skipped", "opt_out")
    _run(go())


def test_an_unknown_campaign_row_is_a_system_message_and_does_not_bypass_hours(env):
    db = env.db

    async def go():
        await seed_wa(db)
        env.clock["now"] = AT_2000_IST
        assert sched._queue_kind({"campaign_id": "mystery_42"}) == "form"
        assert sched._queue_kind({"campaign_id": None}) == "form"
        await db.whatsapp_scheduled.insert_one({"scheduled_id": "q1", "campaign_id": "mystery_42",
                                                "status": "pending", "phone": "9811111111", "message": "hi"})
        await sched.process_wa_queue()
        row = await db.wa_messages.find_one({}, {"_id": 0})
        assert (row["kind"], row["status"], row["queue_reason"]) == ("form", "queued", "quiet_hours")
        assert env.evo.sends == []
    _run(go())


def test_the_legacy_backlog_expires_once_and_the_seven_day_floor_holds_after(env):
    # fix 2: the first pass after deploy expires pending rows older than 24 h (never sent), once;
    # afterwards anything created more than 7 days ago is expired, never sent.
    db = env.db

    async def go():
        await seed_wa(db)
        future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        await db.whatsapp_scheduled.insert_many([
            {"scheduled_id": "old_c", "campaign_id": "daily_digest", "status": "pending", "phone": "9811111111",
             "message": "stale digest", "created_at": _ago(days=2)},
            {"schedule_id": "old_s", "status": "pending", "phone": "9822222222", "message": "stale",
             "scheduled_at": _ago(days=3), "created_at": _ago(days=4)},
            {"scheduled_id": "old_camp", "campaign_id": "camp_x", "type": "campaign", "status": "pending",
             "phone": "9833333333", "message": "", "queued_at": _ago(days=2)},
            {"schedule_id": "later", "status": "pending", "phone": "9844444444", "message": "for Saturday",
             "scheduled_at": future, "created_at": _ago(days=3)},
            {"scheduled_id": "fresh", "campaign_id": "daily_digest", "status": "pending", "phone": "9855555555",
             "message": "today", "created_at": _ago(hours=1)},
        ])
        await sched.process_wa_queue()
        st = {(r.get("scheduled_id") or r.get("schedule_id")): r["status"]
              for r in await db.whatsapp_scheduled.find({}, {"_id": 0}).to_list(None)}
        assert st == {"old_c": "expired", "old_s": "expired", "old_camp": "expired", "later": "pending",
                      "fresh": "sent"}
        marker = await db.settings.find_one({"type": "wa_queue_migrated"}, {"_id": 0})
        assert marker["expired"] == 3
        assert [s["text"] for s in env.evo.sends] == ["today"]

        # The migration does not run again: a 2-day-old row inserted now is sent...
        await db.whatsapp_scheduled.insert_many([
            {"scheduled_id": "two_days", "campaign_id": "daily_digest", "status": "pending", "phone": "9866666666",
             "message": "two days", "created_at": _ago(days=2)},
            # ...but the permanent floor expires one created more than 7 days ago.
            {"scheduled_id": "eight_days", "campaign_id": "daily_digest", "status": "pending",
             "phone": "9877777777", "message": "eight days", "created_at": _ago(days=8)}])
        await sched.process_wa_queue()
        st = {r["scheduled_id"]: r["status"] for r in await db.whatsapp_scheduled.find(
            {"scheduled_id": {"$in": ["two_days", "eight_days"]}}, {"_id": 0}).to_list(None)}
        assert st == {"two_days": "sent", "eight_days": "expired"}
        assert "eight days" not in [s["text"] for s in env.evo.sends]
    _run(go())


def test_a_row_stuck_sending_goes_back_to_pending_then_fails_after_three_claims(env):
    db = env.db

    async def go():
        await seed_wa(db)
        await db.settings.insert_one({"type": "wa_queue_migrated"})
        await db.whatsapp_scheduled.insert_many([
            {"scheduled_id": "s1", "campaign_id": "reminder", "status": "sending", "claimed_at": _ago(minutes=20),
             "claim_count": 1, "phone": "9811111111", "message": "retry me"},
            {"scheduled_id": "s2", "campaign_id": "reminder", "status": "sending", "claimed_at": _ago(minutes=20),
             "claim_count": 3, "phone": "9822222222", "message": "give up"},
            {"scheduled_id": "s3", "campaign_id": "reminder", "status": "sending", "claimed_at": _ago(minutes=2),
             "claim_count": 1, "phone": "9833333333", "message": "still running"},
        ])
        await sched.process_wa_queue()
        st = {r["scheduled_id"]: r["status"] for r in await db.whatsapp_scheduled.find({}, {"_id": 0}).to_list(None)}
        assert st == {"s1": "sent", "s2": "failed", "s3": "sending"}
        assert [s["text"] for s in env.evo.sends] == ["retry me"]
    _run(go())


def test_a_drip_whatsapp_step_with_no_number_to_send_from_is_held_not_closed(env):
    # fix 3: no_sender / sender_not_connected hold the step an hour; other refusals still close it
    db = env.db

    async def go():
        await seed_wa(db, company=None, settings={"drip_wa_enabled": True})     # no number at all
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
        assert enr["current_step"] == 0 and enr["status"] == "active" and not enr.get("step_fail_count")
        assert enr["next_step_at"] > _ago(minutes=-50)            # pushed about an hour ahead
        assert await db.drip_step_logs.count_documents({}) == 0
        assert (await db.wa_messages.find_one({}, {"_id": 0}))["fail_reason"] == "no_sender"
    _run(go())


def test_a_queued_campaign_row_is_settled_on_its_scheduled_row_when_the_drainer_sends_it(env, monkeypatch):
    # fix 4
    db = env.db

    async def _same(template, contact, campaign_name, ai_enabled):
        return template
    monkeypatch.setattr(wroutes, "personalize_message", _same)

    async def go():
        import services.wa_send as ws
        await seed_wa(db)
        env.clock["now"] = AT_2000_IST                                  # outside business hours
        await db.whatsapp_campaigns.insert_one({"campaign_id": "camp1", "name": "Diwali", "status": "queued"})
        await db.whatsapp_scheduled.insert_one({"scheduled_id": "s1", "campaign_id": "camp1", "contact_id": "c1",
                                                "phone": "9811111111", "status": "pending", "type": "campaign",
                                                "contact_snapshot": {}})
        await wroutes._send_campaign_background(campaign_id="camp1", sched_ids=["s1"], template="Happy Diwali",
                                                attachment_doc=None, ai_enabled=False)
        row = await db.whatsapp_scheduled.find_one({"scheduled_id": "s1"}, {"_id": 0})
        msg = await db.wa_messages.find_one({}, {"_id": 0})
        assert (row["status"], row["wa_msg_id"]) == ("queued", msg["message_id"])
        assert msg["ref"]["scheduled_id"] == "s1"
        camp = await db.whatsapp_campaigns.find_one({"campaign_id": "camp1"}, {"_id": 0})
        assert (camp["status"], camp["sent_count"], camp["queued_count"]) == ("queued", 0, 1)

        env.clock["now"] = NEXT_1000_IST
        await ws.run_wa_queue_pass(db, budget_s=5)
        row = await db.whatsapp_scheduled.find_one({"scheduled_id": "s1"}, {"_id": 0})
        assert row["status"] == "sent" and row["wa_message_id"] == "PMID1" and row["sent_at"]
        camp = await db.whatsapp_campaigns.find_one({"campaign_id": "camp1"}, {"_id": 0})
        assert (camp["status"], camp["sent_count"], camp["queued_count"]) == ("sent", 1, 0)
    _run(go())


def test_an_fms_customer_message_goes_from_the_flow_owners_number(env):
    # fix 5: the flow's lead/school reach _fms_send_wa, so the owner resolves (D2)
    db = env.db

    async def go():
        import fms_actions
        await seed_wa(db, reps={PARUL: "connected"})
        await db.leads.insert_one({"lead_id": "L1", "school_id": "s1", "assigned_to": PARUL})
        flow = {"flow_id": "f1", "customer_phone": "9811111111", "customer_name": "Ritu", "title": "Order",
                "lead_id": "L1", "school_id": "s1"}
        await fms_actions._exec_send_message(
            {"params": {"template": "Your order moved to {stage}", "channels": ["whatsapp"], "to": "customer"}},
            flow, {"label": "Packing"})
        row = await db.wa_messages.find_one({}, {"_id": 0})
        assert (row["kind"], row["instance_name"], row["lead_id"]) == ("fms", "rep_parul", "L1")
    _run(go())


# ── Fix round 2 ───────────────────────────────────────────────────────────────

def test_the_seven_day_floor_judges_a_scheduled_row_by_its_due_time(env):
    db = env.db

    async def go():
        await seed_wa(db)
        await db.settings.insert_one({"type": "wa_queue_migrated"})          # one-time step already done
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        await db.whatsapp_scheduled.insert_many([
            {"schedule_id": "ahead", "status": "pending", "phone": "9811111111", "message": "next week",
             "created_at": _ago(days=10), "scheduled_at": tomorrow},
            {"schedule_id": "missed", "status": "pending", "phone": "9822222222", "message": "long gone",
             "created_at": _ago(days=12), "scheduled_at": _ago(days=8)},
            {"scheduled_id": "no_due", "campaign_id": "reminder", "status": "pending", "phone": "9833333333",
             "message": "old reminder", "created_at": _ago(days=8)},
        ])
        assert await sched.expire_stale_wa_rows(db) == 2
        st = {(r.get("scheduled_id") or r.get("schedule_id")): r["status"]
              for r in await db.whatsapp_scheduled.find({}, {"_id": 0}).to_list(None)}
        assert st == {"ahead": "pending", "missed": "expired", "no_due": "expired"}
    _run(go())


def test_the_migration_marker_is_written_only_after_the_expiry_succeeds(env, monkeypatch):
    db = env.db

    async def go():
        await db.whatsapp_scheduled.insert_one({"scheduled_id": "old", "campaign_id": "daily_digest",
                                                "status": "pending", "phone": "9811111111", "message": "x",
                                                "created_at": _ago(days=2)})
        # A crash while the expiry runs (here: building its query) must leave no marker behind.
        real = sched._older_than
        calls = {"n": 0}

        def _boom(cutoff):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("crash mid-migration")
            return real(cutoff)
        monkeypatch.setattr(sched, "_older_than", _boom)
        try:
            await sched.expire_legacy_wa_backlog(db)
        except RuntimeError:
            pass
        assert await db.settings.find_one({"type": "wa_queue_migrated"}) is None     # will retry
        assert await sched.expire_legacy_wa_backlog(db) == 1
        assert (await db.settings.find_one({"type": "wa_queue_migrated"}, {"_id": 0}))["expired"] == 1
        assert await sched.expire_legacy_wa_backlog(db) == 0                        # once only
    _run(go())


# ── Final review fix wave ─────────────────────────────────────────────────────

def test_a_queued_queue_row_is_settled_on_its_scheduled_row_when_the_drainer_sends_it(env):
    # I-1: process_wa_queue hands a form auto-reply to the door at 20:00 IST -> queued; when the
    # wa_messages drainer sends it next morning, whatsapp_scheduled must say `sent` too.
    db = env.db

    async def go():
        import services.wa_send as ws
        await seed_wa(db)
        env.clock["now"] = AT_2000_IST
        await db.whatsapp_scheduled.insert_one({"scheduled_id": "q1", "campaign_id": "form_f1", "status": "pending",
                                                "phone": "9811111111", "message": "Thanks for your response"})
        await sched.process_wa_queue()
        row = await db.whatsapp_scheduled.find_one({"scheduled_id": "q1"}, {"_id": 0})
        msg = await db.wa_messages.find_one({}, {"_id": 0})
        assert (row["status"], row["wa_msg_id"], msg["status"]) == ("queued", msg["message_id"], "queued")
        assert msg["ref"] == {"scheduled_id": "q1", "campaign_id": "form_f1", "writeback": "whatsapp_scheduled"}

        env.clock["now"] = NEXT_1000_IST
        await ws.run_wa_queue_pass(db, budget_s=5)
        row = await db.whatsapp_scheduled.find_one({"scheduled_id": "q1"}, {"_id": 0})
        assert (row["status"], row["wa_message_id"], row["error"]) == ("sent", "PMID1", "")
        assert row["sent_at"] == NEXT_1000_IST.isoformat()
        assert await db.whatsapp_campaigns.count_documents({}) == 0      # no campaign was invented
    _run(go())


class _StopLoop(Exception):
    pass


async def _one_admin_pass(monkeypatch, db):
    """One iteration of admin_routes.run_auto_reminders (an endless loop that sleeps 60 s)."""
    import routes.admin_routes as admin
    monkeypatch.setattr(admin, "db", db, raising=False)

    async def _noop(*a, **k):
        pass
    monkeypatch.setattr(admin, "_push", _noop)
    monkeypatch.setattr(admin, "_push_admins", _noop)

    async def _stop(_seconds):
        raise _StopLoop()
    monkeypatch.setattr(admin.asyncio, "sleep", _stop)
    with pytest.raises(_StopLoop):
        await admin.run_auto_reminders()


def test_a_queued_admin_greeting_row_its_greeting_log_and_its_log_entry_are_settled_by_the_drainer(env, monkeypatch):
    # I-1, the schedule_id path: run_auto_reminders queues a greeting at 20:00 IST; the drainer's
    # send next morning settles whatsapp_scheduled (by schedule_id), greeting_logs and whatsapp_logs.
    # M-5: a demo-seed schedule_id row is never handed to the door.
    db = env.db

    async def go():
        import services.wa_send as ws
        await seed_wa(db)
        await db.settings.insert_one({"type": "notifications", "require_wa_consent": False})
        env.clock["now"] = AT_2000_IST
        await db.greeting_logs.insert_one({"log_id": "glog1", "rule_id": "gr1", "contact_id": "c1", "year": 2026,
                                           "phone": "9811111111", "message": "Happy Diwali", "status": "queued"})
        await db.whatsapp_scheduled.insert_many([
            {"schedule_id": "greet_1", "phone": "9811111111", "message": "Happy Diwali", "status": "pending",
             "scheduled_at": PAST, "rule_id": "gr1", "contact_id": "c1", "created_by": "system"},
            {"schedule_id": "demo_1", "phone": "9822222222", "message": "demo", "status": "pending",
             "scheduled_at": PAST, "created_by": "system", "is_demo": True}])
        await _one_admin_pass(monkeypatch, db)
        row = await db.whatsapp_scheduled.find_one({"schedule_id": "greet_1"}, {"_id": 0})
        msg = await db.wa_messages.find_one({}, {"_id": 0})
        assert (row["status"], msg["kind"], msg["status"]) == ("queued", "greeting", "queued")
        assert msg["ref"] == {"schedule_id": "greet_1", "rule_id": "gr1", "writeback": "whatsapp_scheduled"}
        assert (await db.greeting_logs.find_one({"log_id": "glog1"}, {"_id": 0}))["status"] == "queued"
        assert (await db.whatsapp_scheduled.find_one({"schedule_id": "demo_1"}, {"_id": 0}))["status"] == "pending"
        assert await db.wa_messages.count_documents({}) == 1

        env.clock["now"] = NEXT_1000_IST
        await ws.run_wa_queue_pass(db, budget_s=5)
        row = await db.whatsapp_scheduled.find_one({"schedule_id": "greet_1"}, {"_id": 0})
        assert (row["status"], row["wa_message_id"], row["wa_msg_id"]) == ("sent", "PMID1", msg["message_id"])
        glog = await db.greeting_logs.find_one({"log_id": "glog1"}, {"_id": 0})
        assert (glog["status"], glog["wa_msg_id"]) == ("sent", msg["message_id"])
        wlog = await db.whatsapp_logs.find_one({"wa_message_id": msg["message_id"]}, {"_id": 0})
        assert wlog["status"] == "sent" and wlog["send_mode"] == "scheduled"
        assert [s["text"] for s in env.evo.sends] == ["Happy Diwali"]
    _run(go())


def test_a_demo_seed_queue_row_is_never_sent(env):
    # M-5: demo_routes seeds `type: drip, is_demo: True` rows with fake numbers
    db = env.db

    async def go():
        await seed_wa(db)
        await db.settings.insert_one({"type": "wa_queue_migrated"})          # one-time expiry already done
        await db.whatsapp_scheduled.insert_many([
            {"scheduled_id": "demo", "campaign_id": None, "type": "drip", "is_demo": True, "status": "pending",
             "phone": "9811111111", "message": "demo drip", "queued_at": _ago(days=2)},     # inside the 7-day floor
            {"scheduled_id": "real", "campaign_id": "daily_digest", "status": "pending",
             "phone": "9822222222", "message": "real digest"}])
        await sched.process_wa_queue()
        st = {r["scheduled_id"]: r["status"] for r in await db.whatsapp_scheduled.find({}, {"_id": 0}).to_list(None)}
        assert st == {"demo": "pending", "real": "sent"}
        assert [s["text"] for s in env.evo.sends] == ["real digest"]
    _run(go())


def test_a_drip_step_log_carries_the_wa_messages_id(env):
    # M-4: the step log keeps the key to the message's real outcome (a queued row may still end
    # skipped/failed in the drainer; the evidence is on wa_messages)
    db = env.db

    async def go():
        await seed_wa(db, settings={"drip_wa_enabled": True})
        await db.schools.insert_one({"school_id": "s1", "school_name": "DPS", "wa_consent": True, "is_deleted": False})
        await db.contacts.insert_one({"contact_id": "c1", "name": "Ritu", "phone": "9811111111", "school_id": "s1",
                                      "is_deleted": False})
        await db.drip_sequences.insert_one({"sequence_id": "seq1", "name": "S", "is_active": True, "steps": [
            {"step_number": 1, "delay_days": 0, "message_type": "whatsapp", "message_template": "Hi {name}"}]})
        await db.drip_enrollments.insert_one({"enrollment_id": "e1", "sequence_id": "seq1", "contact_id": "c1",
                                              "lead_id": None, "school_id": "s1", "current_step": 0,
                                              "status": "active", "enrolled_at": PAST, "next_step_at": PAST})
        await sched.run_drip_executor()
        msg = await db.wa_messages.find_one({}, {"_id": 0})
        step_log = await db.drip_step_logs.find_one({"enrollment_id": "e1"}, {"_id": 0})
        assert msg["status"] == "sent" and msg["ref"]["dedup_key"] == "drip:e1:1"
        assert (step_log["status"], step_log["wa_message_id"]) == ("sent", msg["message_id"])
    _run(go())
