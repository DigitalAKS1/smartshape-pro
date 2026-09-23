"""D6: one endpoint, three group_by modes, and a CSV that matches the JSON."""
import asyncio
import csv
import io
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.crm_routes as crm
import rbac

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
REP = {"email": "parul@smartshape.in", "name": "Parul", "role": "sales"}


class FakeRequest:
    def __init__(self, body=None, params=None):
        self._body = body or {}
        self.query_params = params or {}

    async def json(self):
        return self._body


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")
    return d


def _as(monkeypatch, user):
    async def _me(_request):
        return user
    monkeypatch.setattr(crm, "get_current_user", _me)


def _run(coro):
    return asyncio.run(coro)


async def _seed(db):
    await db.schools.insert_many([
        {"school_id": "s1", "school_name": "DPS", "assigned_to": "parul@smartshape.in",
         "is_deleted": False},
        {"school_id": "s2", "school_name": "Lotus", "assigned_to": "bde@smartshape.in",
         "is_deleted": False},
    ])
    await db.contacts.insert_many([
        {"contact_id": "c1", "name": "R Sharma", "school_id": "s1",
         "assigned_to": "parul@smartshape.in"},
        {"contact_id": "c2", "name": "A Menon", "school_id": "s2",
         "assigned_to": "bde@smartshape.in"},
    ])
    await db.leads.insert_one({"lead_id": "l1", "contact_id": "c1", "school_id": "s1",
                               "contact_name": "R Sharma", "assigned_to": "parul@smartshape.in"})
    await db.drip_sequences.insert_many([
        {"sequence_id": "seq1", "name": "Principal Pitch"},
        {"sequence_id": "seq2", "name": "Quiz Engage"},
    ])
    # s1: one WhatsApp step sent, one post step VERIFIED sent.
    await db.drip_step_logs.insert_many([
        {"enrollment_id": "e1", "sequence_id": "seq1", "lead_id": "l1", "contact_id": "",
         "step_number": 1, "message_type": "whatsapp", "status": "sent",
         "fired_at": "2026-09-10T06:00:00+00:00"},
        {"enrollment_id": "e1", "sequence_id": "seq1", "lead_id": "l1", "contact_id": "",
         "step_number": 2, "message_type": "physical_material", "status": "sent",
         "fired_at": "2026-09-12T06:00:00+00:00"},
        # s2: one post step fired but NOT yet verified, and a failed email.
        {"enrollment_id": "e2", "sequence_id": "seq2", "lead_id": "", "contact_id": "c2",
         "step_number": 1, "message_type": "physical_material", "status": "sent",
         "fired_at": "2026-09-14T06:00:00+00:00"},
        {"enrollment_id": "e2", "sequence_id": "seq2", "lead_id": "", "contact_id": "c2",
         "step_number": 2, "message_type": "email", "status": "failed",
         "fired_at": "2026-09-15T06:00:00+00:00"},
    ])
    await db.mail_touches.insert_many([
        {"touch_id": "t1", "run_id": "r1", "school_id": "s1", "sequence_id": "seq1",
         "enrollment_id": "e1", "step_number": 2, "piece_type": "brochure",
         "verify_status": "sent", "posted_at": "2026-09-13T00:00:00+00:00",
         "planned_date": "2026-09-12", "owner": "parul@smartshape.in",
         "contact_ids": ["c1"], "recipient_names": ["R Sharma"],
         "responded": True, "interested": True},
        {"touch_id": "t2", "run_id": "r2", "school_id": "s2", "sequence_id": "seq2",
         "enrollment_id": "e2", "step_number": 1, "piece_type": "brochure",
         "verify_status": "pending", "posted_at": None, "planned_date": "2026-09-14",
         "owner": "bde@smartshape.in", "contact_ids": ["c2"],
         "recipient_names": ["A Menon"], "responded": False, "interested": False},
    ])


def test_group_by_school_splits_sent_from_merely_queued(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        out = await crm.marketing_sent_report(FakeRequest(params={"group_by": "school"}))
        by = {r["key"]: r for r in out["rows"]}
        assert by["s1"]["name"] == "DPS"
        assert by["s1"]["sent_by_channel"] == {"whatsapp": 1, "email": 0, "call": 0, "post": 1}
        assert by["s1"]["post"]["verified_sent"] == 1
        assert by["s1"]["last_sent_at"] == "2026-09-13"
        assert by["s1"]["responses"] == {"qr_scans": 1, "interest": 1}
        assert by["s1"]["sequences"] == ["Principal Pitch"]
        # s2 was reached only by post, and that post has NOT been verified yet.
        assert by["s2"]["post"]["pending"] == 1
        assert by["s2"]["post"]["verified_sent"] == 0
        assert by["s2"]["sent_by_channel"]["post"] == 0, \
            "queued is not sent - the piece is still on someone's desk"
        assert by["s2"]["sent_by_channel"]["email"] == 0, "a failed email is not a send"
    _run(go())


def test_verifying_moves_a_school_from_pending_to_verified_sent(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        await db.mail_touches.update_one({"touch_id": "t2"}, {"$set": {
            "verify_status": "sent", "posted_at": "2026-09-16T00:00:00+00:00"}})
        out = await crm.marketing_sent_report(FakeRequest(params={"group_by": "school"}))
        s2 = next(r for r in out["rows"] if r["key"] == "s2")
        assert s2["post"] == {"verified_sent": 1, "pending": 0, "not_sent": 0,
                              "needs_address": 0}
        assert s2["sent_by_channel"]["post"] == 1
        assert s2["last_sent_at"] == "2026-09-16"
    _run(go())


def test_the_three_modes_agree_on_their_totals(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        outs = {}
        for g in ("school", "contact", "sequence"):
            outs[g] = await crm.marketing_sent_report(FakeRequest(params={"group_by": g}))
        base = outs["school"]["totals"]
        for g in ("contact", "sequence"):
            assert outs[g]["totals"]["sent_by_channel"] == base["sent_by_channel"], g
            assert outs[g]["totals"]["post"] == base["post"], g
            assert outs[g]["totals"]["responses"] == base["responses"], g
    _run(go())


def test_group_by_contact_and_sequence_key_and_name(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        by_contact = await crm.marketing_sent_report(FakeRequest(params={"group_by": "contact"}))
        keys = {r["key"]: r["name"] for r in by_contact["rows"]}
        assert keys == {"c1": "R Sharma", "c2": "A Menon"}
        by_seq = await crm.marketing_sent_report(FakeRequest(params={"group_by": "sequence"}))
        keys = {r["key"]: r["name"] for r in by_seq["rows"]}
        assert keys == {"seq1": "Principal Pitch", "seq2": "Quiz Engage"}
    _run(go())


def test_date_sequence_owner_and_channel_filters(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        only_seq1 = await crm.marketing_sent_report(
            FakeRequest(params={"group_by": "school", "sequence_id": "seq1"}))
        assert [r["key"] for r in only_seq1["rows"]] == ["s1"]
        only_mine = await crm.marketing_sent_report(
            FakeRequest(params={"group_by": "school", "owner": "parul@smartshape.in"}))
        assert [r["key"] for r in only_mine["rows"]] == ["s1"]
        post_only = await crm.marketing_sent_report(
            FakeRequest(params={"group_by": "school", "channel": "post"}))
        assert all(r["sent_by_channel"]["whatsapp"] == 0 for r in post_only["rows"])
        # From 2026-09-14 only s2's piece (planned 09-14) is in window; s1's last
        # activity was the 09-13 posting.
        late = await crm.marketing_sent_report(
            FakeRequest(params={"group_by": "school", "from": "2026-09-14"}))
        assert [r["key"] for r in late["rows"]] == ["s2"]
        early = await crm.marketing_sent_report(
            FakeRequest(params={"group_by": "school", "to": "2026-09-13"}))
        assert [r["key"] for r in early["rows"]] == ["s1"]
    _run(go())


def test_a_rep_sees_only_her_schools(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, REP)
        out = await crm.marketing_sent_report(FakeRequest(params={"group_by": "school"}))
        assert [r["key"] for r in out["rows"]] == ["s1"]
    _run(go())


def test_a_bad_group_by_is_refused(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        with pytest.raises(crm.HTTPException) as e:
            await crm.marketing_sent_report(FakeRequest(params={"group_by": "planet"}))
        assert e.value.status_code == 400
    _run(go())


def test_csv_has_the_same_rows_as_json(db, monkeypatch):
    async def go():
        await _seed(db)
        _as(monkeypatch, ADMIN)
        js = await crm.marketing_sent_report(FakeRequest(params={"group_by": "school"}))
        resp = await crm.marketing_sent_report(
            FakeRequest(params={"group_by": "school", "format": "csv"}))
        body = b"".join([chunk async for chunk in resp.body_iterator]) \
            if hasattr(resp, "body_iterator") else resp.body
        text = body.decode("utf-8-sig") if isinstance(body, (bytes, bytearray)) else body
        rows = list(csv.DictReader(io.StringIO(text)))
        assert len(rows) == len(js["rows"])
        assert [r["key"] for r in rows] == [r["key"] for r in js["rows"]]
        first = rows[0]
        assert first["name"] == js["rows"][0]["name"]
        assert int(first["post"]) == js["rows"][0]["sent_by_channel"]["post"]
        assert int(first["qr_scans"]) == js["rows"][0]["responses"]["qr_scans"]
        assert "attachment" in resp.headers.get("content-disposition", "")
    _run(go())
