"""send_whatsapp: the one door (D3). Sender resolution (D2), opt-out and consent (D10), the
number check, and exactly one wa_messages row per call.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_send.py -q
"""
import asyncio
import os
from datetime import timedelta

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest

import services.wa_send as ws
from services.wa_send import send_whatsapp, to_e164
from wa_fixtures import COMPANY, seed_instance, seed_wa

PARUL = "parul@smartshape.in"
KALPANA = "kalpana@smartshape.in"


def _run(coro):
    return asyncio.run(coro)


async def _contact(db, cid="c1", *, assigned_to="", school_id="s1", phone="9811111111", **extra):
    await db.contacts.insert_one({"contact_id": cid, "name": "Ritu", "phone": phone, "school_id": school_id,
                                  "assigned_to": assigned_to, "is_deleted": False, **extra})


async def _school(db, sid="s1", *, assigned_to="", wa_consent=False, **extra):
    await db.schools.insert_one({"school_id": sid, "school_name": "DPS", "assigned_to": assigned_to,
                                 "wa_consent": wa_consent, "is_deleted": False, **extra})


async def _row(db, message_id):
    return await db.wa_messages.find_one({"message_id": message_id}, {"_id": 0})


# ── D2: who sends ────────────────────────────────────────────────────────────

def test_owner_with_connected_number_sends_from_it(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        res = await send_whatsapp(db, to="9811111111", text="Hi", kind="dispatch", owner_email=PARUL)
        assert res["status"] == "sent" and res["instance_name"] == "rep_parul"
        assert wa_env.evo.sends[-1]["instance"] == "rep_parul"
        assert wa_env.evo.sends[-1]["token"] == "tok_rep_parul"
        row = await _row(db, res["message_id"])
        assert row["sent_via_owner_email"] == PARUL and row["used_company_fallback"] is False
    _run(go())


def test_owner_disconnected_falls_back_to_company_and_says_so(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "disconnected"})
        res = await send_whatsapp(db, to="9811111111", text="Hi", kind="dispatch", owner_email=PARUL)
        assert res["status"] == "sent" and res["instance_name"] == COMPANY
        row = await _row(db, res["message_id"])
        assert row["used_company_fallback"] is True and row["owner_email"] == PARUL
    _run(go())


def test_paused_owner_number_is_not_used(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "paused"})
        res = await send_whatsapp(db, to="9811111111", text="Hi", kind="dispatch", owner_email=PARUL)
        assert res["instance_name"] == COMPANY
    _run(go())


def test_no_owner_anywhere_uses_company(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        await _school(db)
        await _contact(db)
        res = await send_whatsapp(db, to="9811111111", text="Hi", kind="dispatch", contact_id="c1", school_id="s1")
        assert res["instance_name"] == COMPANY
    _run(go())


def test_owner_is_resolved_contact_first_then_school(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected", KALPANA: "connected"})
        await _school(db, assigned_to=KALPANA)
        await _contact(db, assigned_to="")                       # unowned contact at Kalpana's school
        await _contact(db, "c2", assigned_to=PARUL, phone="9822222222")
        r1 = await send_whatsapp(db, to="9811111111", text="Hi", kind="dispatch", contact_id="c1")
        r2 = await send_whatsapp(db, to="9822222222", text="Hi", kind="dispatch", contact_id="c2")
        assert r1["instance_name"] == "rep_kalpana" and r2["instance_name"] == "rep_parul"
    _run(go())


def test_channel_company_ignores_the_owner(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        res = await send_whatsapp(db, to="9811111111", text="x", kind="alert", owner_email=PARUL, channel="company")
        assert res["instance_name"] == COMPANY
    _run(go())


def test_explicit_instance_channel_is_never_silently_rerouted(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "disconnected"})
        res = await send_whatsapp(db, to="9811111111", text="x", kind="chat", channel="rep_parul")
        assert res["status"] == "skipped" and res["reason"] == "sender_not_connected"
        assert wa_env.evo.sends == []
    _run(go())


def test_official_channel_is_skipped_until_built(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        res = await send_whatsapp(db, to="9811111111", text="x", kind="campaign", channel="official")
        assert res == {**res, "status": "skipped", "reason": "official_channel_not_configured"}
    _run(go())


def test_company_down_and_no_owner_number_is_skipped_no_sender_not_failed(wa_env):   # RF3
    db = wa_env.db

    async def go():
        await seed_wa(db, company="disconnected")
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
        assert res["status"] == "skipped" and res["reason"] == "no_sender"
        row = await _row(db, res["message_id"])
        assert row["status"] == "skipped" and row["instance_name"] == ""
        assert await db.wa_instances.count_documents({"state": "paused"}) == 0   # a skip never pauses
    _run(go())


# ── RF4: one person, one key ─────────────────────────────────────────────────

@pytest.mark.parametrize("raw", ["+91 98111 11111", "9811111111", "098111 11111", "919811111111",
                                 "0091-98111-11111", "+91-98111-11111", " 98111-11111 "])
def test_phone_forms_normalise_to_one_e164(raw):
    assert to_e164(raw) == "919811111111"


@pytest.mark.parametrize("raw", ["011 2345 6789", "12345", "", None, "0000000000", "+91 1234567890"])
def test_non_mobile_numbers_normalise_to_empty(raw):
    assert to_e164(raw) == ""


def test_an_explicit_foreign_number_is_kept():
    assert to_e164("+1 415 555 0100") == "14155550100"


def test_a_landline_is_skipped_bad_phone_with_a_row(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        res = await send_whatsapp(db, to="011 2345 6789", text="x", kind="dispatch")
        assert res["status"] == "skipped" and res["reason"] == "bad_phone"
        assert (await _row(db, res["message_id"]))["to_raw"] == "011 2345 6789"
        assert wa_env.evo.calls == []
    _run(go())


def test_empty_message_is_skipped(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        res = await send_whatsapp(db, to="9811111111", text="  ", kind="dispatch")
        assert res["reason"] == "empty_message"
    _run(go())


def test_unknown_kind_is_a_programming_error(wa_env):
    with pytest.raises(ValueError):
        _run(send_whatsapp(wa_env.db, to="9811111111", text="x", kind="newsletter"))


# ── D10: opt-out and consent ─────────────────────────────────────────────────

def test_opted_out_contact_is_skipped_for_automations_but_a_manual_chat_goes(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await _contact(db, wa_opt_out=True)
        a = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch", contact_id="c1")
        b = await send_whatsapp(db, to="9811111111", text="x", kind="chat", contact_id="c1", typed_by=PARUL)
        assert (a["status"], a["reason"]) == ("skipped", "opt_out")
        assert b["status"] == "sent"
    _run(go())


def test_opted_out_school_blocks_its_contacts(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await _school(db, wa_opt_out=True)
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch", school_id="s1")
        assert res["reason"] == "opt_out"
    _run(go())


def test_an_opt_out_recorded_against_the_number_blocks_without_a_record(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await db.wa_opt_outs.insert_one({"phone_e164": "919811111111", "active": True})
        res = await send_whatsapp(db, to="+91 98111 11111", text="x", kind="intro")
        assert res["reason"] == "opt_out"
    _run(go())


def test_marketing_needs_consent_transactional_does_not(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await _school(db, wa_consent=False)
        await _contact(db)
        drip = await send_whatsapp(db, to="9811111111", text="x", kind="drip", contact_id="c1")
        disp = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch", contact_id="c1")
        assert (drip["status"], drip["reason"]) == ("skipped", "no_consent")
        assert disp["status"] == "sent"
    _run(go())


def test_school_consent_or_lead_consent_lets_marketing_through(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await _school(db, wa_consent=True)
        await _contact(db)
        await db.leads.insert_one({"lead_id": "L1", "school_id": "s9", "wa_consent": True, "is_deleted": False})
        a = await send_whatsapp(db, to="9811111111", text="x", kind="drip", contact_id="c1")
        b = await send_whatsapp(db, to="9822222222", text="x", kind="drip", lead_id="L1")
        assert a["status"] == "sent" and b["status"] == "sent"
    _run(go())


def test_consent_setting_off_lets_marketing_through(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await db.settings.insert_one({"type": "notifications", "require_wa_consent": False})
        res = await send_whatsapp(db, to="9811111111", text="x", kind="campaign")
        assert res["status"] == "sent"
    _run(go())


def test_enforce_consent_false_is_honoured(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        res = await send_whatsapp(db, to="9811111111", text="x", kind="greeting", enforce_consent=False)
        assert res["status"] == "sent"
    _run(go())


# ── number-exists check ──────────────────────────────────────────────────────

def test_not_on_whatsapp_is_skipped_and_cached_on_the_contact(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await _contact(db)
        wa_env.evo.not_on_whatsapp.add("919811111111")
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch", contact_id="c1")
        assert (res["status"], res["reason"]) == ("skipped", "not_on_whatsapp")
        c = await db.contacts.find_one({"contact_id": "c1"}, {"_id": 0})
        assert c["wa_number_exists"] is False and c["wa_number_checked_at"]
        assert wa_env.evo.sends == []
    _run(go())


def test_number_check_is_cached_for_30_days_then_rechecked(wa_env):
    db = wa_env.db

    def checks():
        return sum(1 for c in wa_env.evo.calls if c["path"].startswith("/chat/whatsappNumbers/"))

    async def go():
        await seed_wa(db)
        await send_whatsapp(db, to="9811111111", text="a", kind="dispatch")
        wa_env.clock["now"] += timedelta(days=29)
        await send_whatsapp(db, to="9811111111", text="b", kind="dispatch")
        assert checks() == 1
        wa_env.clock["now"] += timedelta(days=2)
        await send_whatsapp(db, to="9811111111", text="c", kind="dispatch")
        assert checks() == 2
    _run(go())


def test_a_manual_chat_skips_the_number_check(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await send_whatsapp(db, to="9811111111", text="a", kind="chat", typed_by=PARUL)
        assert not any(c["path"].startswith("/chat/whatsappNumbers/") for c in wa_env.evo.calls)
    _run(go())


def test_a_failed_number_check_does_not_block_the_send(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.evo.check_raises = True
        res = await send_whatsapp(db, to="9811111111", text="a", kind="dispatch")
        assert res["status"] == "sent"
        assert await db.wa_number_cache.count_documents({}) == 0
    _run(go())


# ── the row and the event ────────────────────────────────────────────────────

def test_sent_row_and_one_engagement_event(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        await _school(db, assigned_to=PARUL)
        await _contact(db, assigned_to=PARUL)
        res = await send_whatsapp(db, to="9811111111", text="Your kit shipped", kind="dispatch",
                                  contact_id="c1", school_id="s1", ref={"dispatch_id": "d1", "dedup_key": "disp:d1"})
        row = await _row(db, res["message_id"])
        assert row["status"] == "sent" and row["provider"] == "evolution"
        assert row["provider_msg_id"] == "PMID1" and row["to_jid"] == "919811111111@s.whatsapp.net"
        assert row["chat_id"] == "rep_parul:919811111111@s.whatsapp.net"
        assert row["sent_day"] == "2026-09-24" and [h["status"] for h in row["status_history"]] == ["sent"]
        assert row["ref"] == {"dispatch_id": "d1", "dedup_key": "disp:d1"}
        evs = await db.engagement_events.find({}, {"_id": 0}).to_list(None)
        assert len(evs) == 1 and evs[0]["dedup_key"] == "disp:d1" and evs[0]["channel"] == "whatsapp"
        assert evs[0]["contact_id"] == "c1" and evs[0]["meta"]["instance_name"] == "rep_parul"
    _run(go())


def test_a_manager_reply_records_who_typed_it(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        res = await send_whatsapp(db, to="9811111111", text="x", kind="chat", channel="rep_parul",
                                  typed_by="info@smartshape.in")
        row = await _row(db, res["message_id"])
        assert row["typed_by"] == "info@smartshape.in" and row["sent_via_owner_email"] == PARUL
    _run(go())


def test_an_evolution_failure_is_failed_with_reason_and_no_event(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.evo.fail_sends = True
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch", contact_id="c1")
        assert res["status"] == "failed" and "rejected" in res["reason"]
        assert (await _row(db, res["message_id"]))["fail_reason"]
        assert await db.engagement_events.count_documents({}) == 0
    _run(go())


def test_autosender_fallback_when_no_number_and_enabled(wa_env, monkeypatch):
    db = wa_env.db
    sent = []

    async def _fake_autosender(dbh, e164, text, file_url=None):
        sent.append((e164, text, file_url))
        return True
    monkeypatch.setattr(ws, "_send_via_autosender", _fake_autosender)

    async def go():
        await seed_wa(db, company=None, settings={"fallback_provider": "autosender"})
        await db.settings.insert_one({"type": "whatsapp", "username": "u", "password": "p"})
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
        assert res["status"] == "sent" and sent == [("919811111111", "x", None)]
        assert (await _row(db, res["message_id"]))["provider"] == "autosender"
    _run(go())


def test_autosender_is_not_used_when_the_setting_is_none(wa_env, monkeypatch):
    db = wa_env.db

    async def _boom(*a, **k):
        raise AssertionError("fallback used while fallback_provider is none")
    monkeypatch.setattr(ws, "_send_via_autosender", _boom)

    async def go():
        await seed_wa(db, company=None)
        await db.settings.insert_one({"type": "whatsapp", "username": "u", "password": "p"})
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
        assert res["reason"] == "no_sender"
    _run(go())


def test_media_goes_as_send_media_with_the_text_as_caption(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        att = {"attachment_id": "att1", "url": "https://app.smartshape.in/uploads/whatsapp/a.jpg",
               "attachment_type": "image", "content_type": "image/jpeg", "filename": "a.jpg", "size_bytes": 10}
        res = await send_whatsapp(db, to="9811111111", text="Diwali wishes", media=att, kind="dispatch")
        s = wa_env.evo.sends[-1]
        assert res["status"] == "sent" and s["mediatype"] == "image" and s["text"] == "Diwali wishes"
        row = await _row(db, res["message_id"])
        assert row["media"]["type"] == "image" and row["media"]["filename"] == "a.jpg"
    _run(go())
