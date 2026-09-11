"""WhatsApp broadcast by tag — honest and safe (tag roll-up fix round).

POST /whatsapp/broadcast-by-tag sends to the tag roll-up's DEALS (D3: tagged
deals plus every live deal at a school the tag reaches). This pins what makes
that safe to press:

  * one message per PERSON — deals are merged by normalised phone (digits, last
    10; the CRM's `_norm_phone`), and an empty or short phone is skipped;
  * GET /whatsapp/broadcast-by-tag/preview reports exactly who the send would
    reach — {deals, unique_recipients, skipped_no_phone, capped_at, over_cap} —
    and sends nothing;
  * the recipient cap is stated in both the preview and the response;
  * every stage is included, won and lost too — the broadcast never filtered by
    stage, and the roll-up does not change that.

No real sends: `_send_wa_autosender` is replaced by a recorder in every test,
and httpx.AsyncClient is replaced by one that fails the test if it is touched.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_tag_broadcast.py -q
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import httpx
import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.crm_routes as crm
import routes.settings_routes as settings_mod

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
REP = {
    "email": "rep@smartshape.in", "name": "Rep", "role": "sales",
    "module_permissions": {"leads": {"level": "read_write", "scope": "own"}},
}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}
        self.query_params = {}

    async def json(self):
        return self._body


class _NoNetwork:
    def __init__(self, *a, **k):
        raise AssertionError("a test reached httpx.AsyncClient — nothing may leave the machine")


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)
    monkeypatch.setattr(settings_mod, "db", d)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)
    monkeypatch.setattr(httpx, "AsyncClient", _NoNetwork)
    return d


@pytest.fixture()
def sender(monkeypatch):
    """Records every send; the provider is never called."""
    calls = []

    async def _record(wa_settings, phone, message):
        calls.append({"phone": phone, "message": message})
        return True
    monkeypatch.setattr(settings_mod, "_send_wa_autosender", _record)
    return calls


def _as(user, monkeypatch):
    async def _me(_request):
        return user
    monkeypatch.setattr(settings_mod, "get_current_user", _me)


def _run(coro):
    return asyncio.run(coro)


async def _seed_common(db):
    await db.settings.insert_one({"type": "whatsapp", "username": "u", "password": "p"})
    await db.tags.insert_one({"tag_id": "t_gslc", "name": "GSLC 2026"})
    # The tag sits on one person; the school's deals are reached through her (D2 -> D3).
    await db.schools.insert_one({"school_id": "s1", "school_name": "DPS", "is_deleted": False})
    await db.contacts.insert_one({"contact_id": "c1", "school_id": "s1", "tag_ids": ["t_gslc"],
                                  "is_deleted": False})


async def _deal(db, lead_id, phone, *, school="s1", stage="new", created="2026-09-01", **extra):
    await db.leads.insert_one({
        "lead_id": lead_id, "school_id": school, "company_name": "DPS",
        "contact_name": f"Name {lead_id}", "contact_phone": phone, "stage": stage,
        "tag_ids": [], "is_deleted": False, "created_at": created, **extra})


def _preview(tag_id="t_gslc"):
    return settings_mod.whatsapp_broadcast_by_tag_preview(FakeRequest(), tag_id=tag_id)


def _send(tag_id="t_gslc"):
    return settings_mod.whatsapp_broadcast_by_tag(
        FakeRequest({"tag_id": tag_id, "message": "Hi {contact_name} at {school_name}"}))


# ── one message per person ───────────────────────────────────────────────────

def test_deals_sharing_a_phone_get_one_message_and_bad_phones_are_skipped(db, sender, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_common(db)
        # Three spellings of ONE Indian number -> one person.
        await _deal(db, "l_a", "+91 98765 43210", created="2026-09-01")
        await _deal(db, "l_b", "9876543210", created="2026-09-02")
        await _deal(db, "l_c", "098765-43210", created="2026-09-03")
        await _deal(db, "l_d", "9123456789")                      # a second person
        await _deal(db, "l_e", "")                                # no phone
        await _deal(db, "l_f", "12345")                           # too short to be a phone
        await _deal(db, "l_g", None)                              # missing entirely

        out = await _send()
        assert len(sender) == 2, "one send per unique normalised phone"
        assert sorted(c["phone"] for c in sender) == ["+91 98765 43210", "9123456789"]
        # The merged message is personalised from the OLDEST deal, so the preview
        # and the send always name the same person.
        assert any(c["message"] == "Hi Name l_a at DPS" for c in sender)
        assert out["deals"] == 7
        assert out["unique_recipients"] == 2
        assert out["skipped_no_phone"] == 3
        assert (out["sent"], out["failed"]) == (2, 0)
        assert out["capped_at"] is None and out["over_cap"] == 0

        logs = await db.whatsapp_logs.find({}, {"_id": 0}).to_list(None)
        assert len(logs) == 2
        merged = next(g for g in logs if g["phone"] == "+91 98765 43210")
        assert merged["lead_ids"] == ["l_a", "l_b", "l_c"]
    _run(go())


# ── the preview ──────────────────────────────────────────────────────────────

def test_preview_sends_nothing_and_matches_what_the_send_reports(db, sender, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_common(db)
        await _deal(db, "l_a", "9876543210")
        await _deal(db, "l_b", "+919876543210")
        await _deal(db, "l_c", "9123456789")
        await _deal(db, "l_d", "")

        preview = await _preview()
        assert sender == [], "the preview must not send"
        assert await db.whatsapp_logs.count_documents({}) == 0
        assert preview == {"deals": 4, "unique_recipients": 2, "skipped_no_phone": 1,
                           "capped_at": None, "over_cap": 0}

        out = await _send()
        assert {k: out[k] for k in preview} == preview
        assert len(sender) == preview["unique_recipients"]
    _run(go())


def test_preview_works_before_whatsapp_is_configured(db, sender, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await db.schools.insert_one({"school_id": "s1", "is_deleted": False})
        await db.contacts.insert_one({"contact_id": "c1", "school_id": "s1", "tag_ids": ["t_gslc"]})
        await _deal(db, "l_a", "9876543210")
        assert (await _preview())["unique_recipients"] == 1
        assert sender == []
    _run(go())


def test_preview_and_send_are_admin_only(db, sender, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        with pytest.raises(HTTPException) as e1:
            await _preview()
        with pytest.raises(HTTPException) as e2:
            await _send()
        assert e1.value.status_code == e2.value.status_code == 403
        assert sender == []
    _run(go())


def test_preview_without_a_tag_is_a_400(db, sender, monkeypatch):
    _as(ADMIN, monkeypatch)
    with pytest.raises(HTTPException) as exc:
        _run(_preview(tag_id="  "))
    assert exc.value.status_code == 400


# ── the cap is stated, never silent ──────────────────────────────────────────

def test_the_cap_is_reported_by_the_preview_and_the_response(db, sender, monkeypatch):
    _as(ADMIN, monkeypatch)
    monkeypatch.setattr(settings_mod, "BROADCAST_MAX_RECIPIENTS", 2)

    async def go():
        await _seed_common(db)
        for i, phone in enumerate(["9000000001", "9000000002", "9000000003"]):
            await _deal(db, f"l_{i}", phone, created=f"2026-09-0{i + 1}")

        preview = await _preview()
        assert preview["unique_recipients"] == 3
        assert (preview["capped_at"], preview["over_cap"]) == (2, 1)

        out = await _send()
        assert len(sender) == 2
        assert (out["capped_at"], out["over_cap"], out["sent"]) == (2, 1, 2)
    _run(go())


# ── stage semantics: unchanged, every stage ─────────────────────────────────

def test_won_and_lost_deals_are_still_messaged_as_before(db, sender, monkeypatch):
    """The old path was `db.leads.find({"tag_ids": tag})` — no stage filter —
    so a won or lost deal carrying the tag was messaged. The roll-up keeps that."""
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_common(db)
        await _deal(db, "l_won", "9000000001", stage="won")
        await _deal(db, "l_lost", "9000000002", stage="lost")
        await _deal(db, "l_open", "9000000003", stage="demo")
        out = await _send()
        assert out["unique_recipients"] == 3 and len(sender) == 3
    _run(go())


def test_deleted_deals_and_deals_outside_the_tag_are_not_messaged(db, sender, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_common(db)
        await _deal(db, "l_live", "9000000001")
        await _deal(db, "l_deleted", "9000000002", is_deleted=True)
        await _deal(db, "l_elsewhere", "9000000003", school="s_other")
        out = await _send()
        assert [c["phone"] for c in sender] == ["9000000001"]
        assert out["deals"] == 1
    _run(go())
