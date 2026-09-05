"""Phase 3: let the annuity exist.

The business sells a machine once and dies forever after. The CRM modelled the
first motion only, and the automatic paths collapsed everything onto whichever
deal happened to be open — so enrolling a school into a die-reorder campaign
attached itself to that school's open machine deal, and the reorder had nowhere
of its own to live.

Two halves here: deals keyed by deal type so both can be open at once, and a
reorder-due list derived from what each school has actually bought before.
mongomock.
"""
import asyncio
import json
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.crm_routes as crm
import routes.drip_routes as drip
import services.reorder as ro

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
    for mod in (crm, drip, ro):
        monkeypatch.setattr(mod, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")

    async def _me(_request):
        return ADMIN
    monkeypatch.setattr(crm, "get_current_user", _me)
    monkeypatch.setattr(drip, "get_current_user", _me)
    return d


def _run(coro):
    return asyncio.run(coro)


def _ago(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


async def _school(db, sid="s1", owner="parul@ss.in"):
    await db.schools.insert_one({"school_id": sid, "school_name": f"School {sid}",
                                 "assigned_to": owner, "assigned_name": "Parul",
                                 "is_deleted": False})


async def _order(db, oid, sid="s1", days_ago=10, total=25000, status="delivered"):
    await db.orders.insert_one({"order_id": oid, "school_id": sid, "grand_total": total,
                                "status": status, "is_deleted": False,
                                "created_at": _ago(days_ago)})


# ── A machine deal and a reorder must be able to coexist ────────────────────

def test_a_reorder_does_not_hijack_an_open_machine_deal(db):
    async def go():
        await _school(db)
        await db.leads.insert_one({
            "lead_id": "l_machine", "school_id": "s1", "stage": "negotiation",
            "deal_type": "New Machine", "expected_value": 400000, "is_deleted": False,
        })
        lid = await crm._upsert_direct_mail_lead("s1", "Reorder Dies", "parul@ss.in", _ago(0))
        assert lid != "l_machine", "the die reorder was attached to the machine deal"
        assert await db.leads.count_documents({"school_id": "s1"}) == 2
        machine = await db.leads.find_one({"lead_id": "l_machine"})
        assert machine["deal_type"] == "New Machine", "the machine deal was overwritten"
    _run(go())


def test_a_second_touch_of_the_same_deal_type_reuses_its_deal(db):
    async def go():
        await _school(db)
        first = await crm._upsert_direct_mail_lead("s1", "Reorder Dies", "parul@ss.in", _ago(0))
        again = await crm._upsert_direct_mail_lead("s1", "Reorder Dies", "parul@ss.in", _ago(0))
        assert first == again
        assert await db.leads.count_documents({"school_id": "s1"}) == 1
    _run(go())


def test_a_closed_deal_of_that_type_does_not_block_the_next_one(db):
    # A school that bought dies last term must be able to buy them again.
    async def go():
        await _school(db)
        await db.leads.insert_one({"lead_id": "l_old", "school_id": "s1", "stage": "won",
                                   "deal_type": "Reorder Dies", "is_deleted": False})
        lid = await crm._upsert_direct_mail_lead("s1", "Reorder Dies", "parul@ss.in", _ago(0))
        assert lid != "l_old"
    _run(go())


def test_an_untyped_touch_still_reuses_an_untyped_open_deal(db):
    # Existing behaviour for everything that never set a deal type.
    async def go():
        await _school(db)
        await db.leads.insert_one({"lead_id": "l_any", "school_id": "s1", "stage": "new",
                                   "deal_type": "", "is_deleted": False})
        lid = await crm._upsert_direct_mail_lead("s1", "", "parul@ss.in", _ago(0))
        assert lid == "l_any"
    _run(go())


def test_enrolling_a_reorder_sequence_does_not_touch_the_machine_deal(db):
    async def go():
        await _school(db)
        await db.leads.insert_one({
            "lead_id": "l_machine", "school_id": "s1", "stage": "demo",
            "deal_type": "New Machine", "is_deleted": False, "assigned_to": "parul@ss.in",
        })
        await db.drip_sequences.insert_one({
            "sequence_id": "seq_reorder", "name": "Termly die reminder",
            "deal_type": "Reorder Dies", "is_active": True,
            "steps": [{"step_number": 1, "delay_days": 30, "message_type": "whatsapp",
                       "message_template": "hi"}],
        })
        out = await drip.enroll_schools(FakeRequest(
            {"sequence_id": "seq_reorder", "school_ids": ["s1"]}))
        assert out["enrolled"] == 1
        enr = await db.drip_enrollments.find_one({"sequence_id": "seq_reorder"})
        assert enr["lead_id"] != "l_machine", \
            "a die-reorder campaign enrolled against the open machine deal"
        reorder = await db.leads.find_one({"lead_id": enr["lead_id"]})
        assert reorder["deal_type"] == "Reorder Dies"
    _run(go())


# ── Who is due to reorder, from what they have actually bought ──────────────

def test_a_school_that_buys_termly_becomes_due_when_the_term_has_passed(db):
    async def go():
        await _school(db)
        await _order(db, "o1", days_ago=370)
        await _order(db, "o2", days_ago=250)
        await _order(db, "o3", days_ago=130)      # ~120-day cadence
        rows = await ro.reorder_candidates(db)
        assert [r["school_id"] for r in rows] == ["s1"]
        assert rows[0]["cadence_days"] == 120
        assert rows[0]["days_since_last_order"] == 130
        assert rows[0]["days_overdue"] == 10
        assert rows[0]["confidence"] == "measured"
    _run(go())


def test_a_school_still_inside_its_usual_gap_is_not_due(db):
    async def go():
        await _school(db)
        await _order(db, "o1", days_ago=250)
        await _order(db, "o2", days_ago=130)
        await _order(db, "o3", days_ago=20)
        assert await ro.reorder_candidates(db) == []
    _run(go())


def test_one_order_only_falls_back_to_the_configured_interval_and_says_so(db):
    # With a single order there is no cadence to measure. Guessing silently
    # would be worse than saying the number is an assumption.
    async def go():
        await _school(db)
        await _order(db, "o1", days_ago=200)
        rows = await ro.reorder_candidates(db, default_interval_days=180)
        assert rows[0]["confidence"] == "assumed"
        assert rows[0]["cadence_days"] == 180
    _run(go())


def test_a_school_that_never_ordered_is_not_a_reorder_candidate(db):
    async def go():
        await _school(db)
        assert await ro.reorder_candidates(db) == []
    _run(go())


def test_cancelled_orders_do_not_shape_the_cadence(db):
    async def go():
        await _school(db)
        await _order(db, "o1", days_ago=400)
        await _order(db, "o2", days_ago=250, status="cancelled")
        await _order(db, "o3", days_ago=240)
        rows = await ro.reorder_candidates(db)
        # 400 -> 240 is a 160-day rhythm. Counting the cancelled order would
        # have read it as two short gaps and made the school look premature.
        assert rows[0]["cadence_days"] == 160
        assert rows[0]["days_overdue"] == 80
    _run(go())


def test_a_school_already_working_a_reorder_deal_is_not_listed_again(db):
    # The list is work to start, not work already under way.
    async def go():
        await _school(db)
        await _order(db, "o1", days_ago=400)
        await _order(db, "o2", days_ago=200)
        assert len(await ro.reorder_candidates(db)) == 1
        await db.leads.insert_one({"lead_id": "l1", "school_id": "s1", "stage": "contacted",
                                   "deal_type": "Reorder Dies", "is_deleted": False})
        assert await ro.reorder_candidates(db) == []
    _run(go())


def test_the_most_overdue_school_comes_first(db):
    async def go():
        for sid, last in (("s_a", 200), ("s_b", 400), ("s_c", 250)):
            await _school(db, sid)
            await _order(db, f"o1{sid}", sid=sid, days_ago=last + 120)
            await _order(db, f"o2{sid}", sid=sid, days_ago=last)
        rows = await ro.reorder_candidates(db)
        assert [r["school_id"] for r in rows] == ["s_b", "s_c", "s_a"]
    _run(go())


def test_the_list_carries_what_a_rep_needs_to_act(db):
    async def go():
        await _school(db)
        await _order(db, "o1", days_ago=400, total=30000)
        await _order(db, "o2", days_ago=200, total=25000)
        row = (await ro.reorder_candidates(db))[0]
        assert row["school_name"] == "School s1"
        assert row["assigned_to"] == "parul@ss.in"
        assert row["last_order_value"] == 25000
        assert row["lifetime_value"] == 55000
        assert row["order_count"] == 2
    _run(go())


# ── The endpoint ────────────────────────────────────────────────────────────

def test_the_endpoint_scopes_to_the_reps_own_accounts(db, monkeypatch):
    async def go():
        await _school(db, "s_mine", owner="parul@ss.in")
        await _school(db, "s_theirs", owner="amit@ss.in")
        for sid in ("s_mine", "s_theirs"):
            await _order(db, f"a{sid}", sid=sid, days_ago=400)
            await _order(db, f"b{sid}", sid=sid, days_ago=200)

        rows = await crm.reorder_due(FakeRequest())
        assert len(rows) == 2, "an admin sees every account"

        async def as_rep(_r):
            return {"email": "parul@ss.in", "role": "sales",
                    "module_permissions": {"leads": {"level": "read_write", "scope": "own"}}}
        monkeypatch.setattr(crm, "get_current_user", as_rep)
        rows = await crm.reorder_due(FakeRequest())
        assert [r["school_id"] for r in rows] == ["s_mine"]
    _run(go())
