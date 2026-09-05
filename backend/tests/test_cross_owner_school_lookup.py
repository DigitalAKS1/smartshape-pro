"""Cross-owner school lookup: a rep can find a school she doesn't own when
starting a lead or a quotation, the owner is told, and nothing is transferred.

A rep with `own` scope could not see another rep's school in either picker, so
her only way forward was Add New — which is the step that manufactures duplicate
schools. mongomock.
"""
import asyncio
import json
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import notify
import rbac
import routes.admin_routes as admin
import routes.crm_routes as crm

PARUL = {
    "email": "parul@ss.in", "name": "Parul Kanchan", "role": "sales",
    "module_permissions": {"leads": {"level": "read_write", "scope": "own"}},
}
AMIT = {
    "email": "amit@ss.in", "name": "Amit Rao", "role": "sales",
    "module_permissions": {"leads": {"level": "read_write", "scope": "own"}},
}
ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}


class FakeRequest:
    def __init__(self, body=None, params=None):
        self._body = body or {}
        self.query_params = params or {}

    async def json(self):
        return self._body

    async def body(self):
        return json.dumps(self._body).encode()


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    for mod in (crm, admin, notify):
        monkeypatch.setattr(mod, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")
    return d


def _as(user, monkeypatch):
    async def _me(_request):
        return user
    for mod in (crm, admin):
        monkeypatch.setattr(mod, "get_current_user", _me, raising=False)


def _run(coro):
    return asyncio.run(coro)


async def _seed(db):
    await db.users.insert_one({**AMIT, "is_active": True})
    await db.users.insert_one({**PARUL, "is_active": True})
    # Amit's school, fully populated — the detail must NOT leak to Parul.
    await db.schools.insert_one({
        "school_id": "s_dps", "school_name": "Delhi Public School", "city": "Rohini",
        "phone": "01127654321", "email": "info@dps.in", "address": "Sector 24",
        "school_strength": 1200, "assigned_to": "amit@ss.in", "assigned_name": "Amit Rao",
        "is_deleted": False,
    })
    await db.contacts.insert_one({"contact_id": "c1", "school_id": "s_dps",
                                  "name": "R Sharma", "phone": "9811111111",
                                  "assigned_to": "amit@ss.in", "is_deleted": False})
    # Parul's own school.
    await db.schools.insert_one({
        "school_id": "s_lotus", "school_name": "Lotus Valley", "city": "Noida",
        "assigned_to": "parul@ss.in", "assigned_name": "Parul Kanchan", "is_deleted": False,
    })
    # An unowned one — nobody to notify.
    await db.schools.insert_one({
        "school_id": "s_free", "school_name": "Ryan International", "city": "Gurgaon",
        "assigned_to": "", "is_deleted": False,
    })


# ── The gap this closes ─────────────────────────────────────────────────────

def test_the_plain_school_list_still_hides_other_reps_schools(db, monkeypatch):
    # Unchanged on purpose: the CRM Schools tab stays own-territory.
    _as(PARUL, monkeypatch)

    async def go():
        await _seed(db)
        names = {s["school_name"] for s in await crm.get_schools(FakeRequest())}
        assert "Delhi Public School" not in names
        assert "Lotus Valley" in names
    _run(go())


def test_lookup_finds_a_school_owned_by_someone_else(db, monkeypatch):
    _as(PARUL, monkeypatch)

    async def go():
        await _seed(db)
        rows = await crm.school_lookup(FakeRequest(params={"q": "delhi"}))
        assert [r["school_name"] for r in rows] == ["Delhi Public School"]
        assert rows[0]["assigned_name"] == "Amit Rao"
        assert rows[0]["is_mine"] is False
    _run(go())


def test_lookup_marks_the_users_own_schools(db, monkeypatch):
    _as(PARUL, monkeypatch)

    async def go():
        await _seed(db)
        rows = await crm.school_lookup(FakeRequest(params={"q": "lotus"}))
        assert rows[0]["is_mine"] is True
    _run(go())


def test_lookup_matches_on_city_too(db, monkeypatch):
    _as(PARUL, monkeypatch)

    async def go():
        await _seed(db)
        rows = await crm.school_lookup(FakeRequest(params={"q": "rohini"}))
        assert [r["school_id"] for r in rows] == ["s_dps"]
    _run(go())


# ── Owner scoping must still protect something ──────────────────────────────

def test_lookup_reveals_nothing_but_name_city_and_owner(db, monkeypatch):
    _as(PARUL, monkeypatch)

    async def go():
        await _seed(db)
        row = (await crm.school_lookup(FakeRequest(params={"q": "delhi"})))[0]
        assert set(row) == {"school_id", "school_name", "city", "assigned_to",
                            "assigned_name", "is_mine"}
        for leaked in ("phone", "email", "address", "school_strength"):
            assert leaked not in row
    _run(go())


def test_a_short_query_returns_nothing_so_the_list_cannot_be_enumerated(db, monkeypatch):
    _as(PARUL, monkeypatch)

    async def go():
        await _seed(db)
        assert await crm.school_lookup(FakeRequest(params={"q": ""})) == []
        assert await crm.school_lookup(FakeRequest(params={"q": "d"})) == []
    _run(go())


def test_a_read_only_rep_cannot_use_the_lookup(db, monkeypatch):
    _as({**PARUL, "module_permissions": {"leads": {"level": "read"}}}, monkeypatch)

    async def go():
        await _seed(db)
        with pytest.raises(HTTPException) as e:
            await crm.school_lookup(FakeRequest(params={"q": "delhi"}))
        assert e.value.status_code == 403
    _run(go())


# ── Telling the owner ───────────────────────────────────────────────────────

def test_creating_a_lead_on_another_reps_school_notifies_that_rep(db, monkeypatch):
    _as(PARUL, monkeypatch)

    async def go():
        await _seed(db)
        await crm.create_lead(FakeRequest({
            "school_id": "s_dps", "contact_name": "R Sharma", "contact_phone": "9811111111",
        }))
        note = await db.notifications.find_one({"assigned_to": "amit@ss.in"})
        assert note, "the owner was not told"
        assert "Delhi Public School" in note["body"]
        assert "Parul Kanchan" in note["body"] or note["from_name"] == "Parul Kanchan"
        assert note["ref_id"] == "s_dps"
    _run(go())


def test_the_notification_lands_where_the_bell_actually_reads(db, monkeypatch):
    # db.notifications is what GET /notifications reads; db.crm_notifications is
    # a collection nothing displays.
    _as(PARUL, monkeypatch)

    async def go():
        await _seed(db)
        await crm.create_lead(FakeRequest({"school_id": "s_dps", "contact_name": "X"}))
        _as(AMIT, monkeypatch)
        bell = await admin.get_notifications(FakeRequest())
        assert len(bell) == 1
        assert bell[0]["ref_id"] == "s_dps"
    _run(go())


def test_working_on_your_own_school_notifies_nobody(db, monkeypatch):
    _as(PARUL, monkeypatch)

    async def go():
        await _seed(db)
        await crm.create_lead(FakeRequest({"school_id": "s_lotus", "contact_name": "X"}))
        assert await db.notifications.count_documents({}) == 0
    _run(go())


def test_an_unowned_school_notifies_nobody(db, monkeypatch):
    _as(PARUL, monkeypatch)

    async def go():
        await _seed(db)
        await crm.create_lead(FakeRequest({"school_id": "s_free", "contact_name": "X"}))
        assert await db.notifications.count_documents({}) == 0
    _run(go())


def test_the_school_stays_with_its_owner(db, monkeypatch):
    _as(PARUL, monkeypatch)

    async def go():
        await _seed(db)
        await crm.create_lead(FakeRequest({"school_id": "s_dps", "contact_name": "X"}))
        school = await db.schools.find_one({"school_id": "s_dps"})
        assert school["assigned_to"] == "amit@ss.in", "using a school must not take it"
    _run(go())


# ── Auto Sync ───────────────────────────────────────────────────────────────

def test_auto_sync_off_silences_the_bell(db, monkeypatch):
    _as(PARUL, monkeypatch)

    async def go():
        await _seed(db)
        await db.users.update_one({"email": "amit@ss.in"},
                                  {"$set": {"notify_on_cross_owner": False}})
        await crm.create_lead(FakeRequest({"school_id": "s_dps", "contact_name": "X"}))
        assert await db.notifications.count_documents({}) == 0
    _run(go())


def test_auto_sync_defaults_on_for_a_user_who_has_never_set_it(db, monkeypatch):
    _as(PARUL, monkeypatch)

    async def go():
        await _seed(db)   # Amit has no notify_on_cross_owner field at all
        await crm.create_lead(FakeRequest({"school_id": "s_dps", "contact_name": "X"}))
        assert await db.notifications.count_documents({}) == 1
    _run(go())


# ── After the fact, the school is hers to work on ───────────────────────────

def test_a_lead_started_on_another_reps_school_is_assigned_to_that_rep(db, monkeypatch):
    """Territory wins: the account owner keeps the lead.

    _apply_owner gives a new lead the SCHOOL's owner, not its creator. So the
    lead Parul starts on Amit's school belongs to Amit — which is the model
    working, and exactly why he has to be told it appeared.
    """
    _as(PARUL, monkeypatch)

    async def go():
        await _seed(db)
        await crm.create_lead(FakeRequest({"school_id": "s_dps", "contact_name": "X"}))
        lead = await db.leads.find_one({"school_id": "s_dps"})
        assert lead["assigned_to"] == "amit@ss.in"
        assert lead["created_by"] == "parul@ss.in"
        note = await db.notifications.find_one({"assigned_to": "amit@ss.in"})
        assert "assigned to you" in note["body"],             "the owner must be told the lead landed on his plate, not just that it exists"
    _run(go())


def test_a_quotation_alone_also_brings_the_school_into_her_list(db, monkeypatch):
    # Quotations carry school_id, so the own-scope rule must treat them like
    # leads or the two pickers behave differently for no reason.
    _as(PARUL, monkeypatch)

    async def go():
        await _seed(db)
        await db.quotations.insert_one({
            "quotation_id": "q1", "school_id": "s_dps",
            "created_by": "parul@ss.in", "is_deleted": False,
        })
        names = {s["school_name"] for s in await crm.get_schools(FakeRequest())}
        assert "Delhi Public School" in names
    _run(go())


# ── Auto Sync is the user's own switch ──────────────────────────────────────

def test_a_user_can_silence_their_own_cross_owner_bell(db, monkeypatch):
    _as(AMIT, monkeypatch)

    async def go():
        await _seed(db)
        out = await admin.update_my_preferences(
            FakeRequest({"notify_on_cross_owner": False}))
        assert out["notify_on_cross_owner"] is False
        stored = await db.users.find_one({"email": "amit@ss.in"})
        assert stored["notify_on_cross_owner"] is False

        # and it takes effect
        _as(PARUL, monkeypatch)
        await crm.create_lead(FakeRequest({"school_id": "s_dps", "contact_name": "X"}))
        assert await db.notifications.count_documents({}) == 0
    _run(go())


def test_turning_it_back_on_restores_the_bell(db, monkeypatch):
    _as(AMIT, monkeypatch)

    async def go():
        await _seed(db)
        await admin.update_my_preferences(FakeRequest({"notify_on_cross_owner": False}))
        await admin.update_my_preferences(FakeRequest({"notify_on_cross_owner": True}))
        _as(PARUL, monkeypatch)
        await crm.create_lead(FakeRequest({"school_id": "s_dps", "contact_name": "X"}))
        assert await db.notifications.count_documents({}) == 1
    _run(go())


def test_an_unknown_preference_is_rejected_rather_than_silently_stored(db, monkeypatch):
    _as(AMIT, monkeypatch)

    async def go():
        await _seed(db)
        with pytest.raises(HTTPException) as e:
            await admin.update_my_preferences(FakeRequest({"make_me_admin": True}))
        assert e.value.status_code == 400
        stored = await db.users.find_one({"email": "amit@ss.in"})
        assert "make_me_admin" not in stored
    _run(go())


# ── The redirected notification writers ─────────────────────────────────────

def test_notify_user_dedups_while_unread(db):
    async def go():
        first = await notify.notify_user("amit@ss.in", type="drip_stalled",
                                         title="t", dedup_key="k1")
        again = await notify.notify_user("amit@ss.in", type="drip_stalled",
                                         title="t", dedup_key="k1")
        assert first == again
        assert await db.notifications.count_documents({}) == 1
        # once read, the same situation may raise its hand again
        await db.notifications.update_many({}, {"$set": {"is_read": True}})
        await notify.notify_user("amit@ss.in", type="drip_stalled", title="t", dedup_key="k1")
        assert await db.notifications.count_documents({}) == 2
    _run(go())


def test_notify_user_writes_nothing_without_a_recipient(db):
    async def go():
        assert await notify.notify_user("", type="x", title="t") is None
        assert await db.notifications.count_documents({}) == 0
    _run(go())
