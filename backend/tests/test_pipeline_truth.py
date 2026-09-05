"""Phase 1 of the CRM roadmap: make the pipeline numbers mean something.

Two things were being reported as fact that were not:

  * "Won value" summed `expected_value` — a figure a rep typed while the deal
    was still a guess — so the number never reconciled with what was invoiced,
    and "what is a demo worth?" had no answer.
  * "Open pipeline value" counted brand-new unqualified enquiries at full rupee
    value, so a QR scan inflated the forecast the day it arrived.

mongomock.
"""
import asyncio
import json
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.crm_routes as crm

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
    monkeypatch.setattr(crm, "db", d)

    async def _me(_request):
        return ADMIN
    monkeypatch.setattr(crm, "get_current_user", _me)
    return d


def _run(coro):
    return asyncio.run(coro)


# ── Won value must be the money that was actually invoiced ──────────────────

def test_won_value_reads_the_order_not_the_reps_guess(db):
    async def go():
        await db.leads.insert_one({
            "lead_id": "l1", "school_id": "s1", "stage": "won",
            "expected_value": 100000, "is_deleted": False,
        })
        await db.orders.insert_one({
            "order_id": "o1", "lead_id": "l1", "grand_total": 425000,
            "status": "delivered", "is_deleted": False,
        })
        omap = await crm._build_order_map(["l1"])
        lead = await db.leads.find_one({"lead_id": "l1"}, {"_id": 0})
        assert crm.resolve_won_value(lead, omap) == 425000
    _run(go())


def test_several_orders_on_one_deal_are_summed(db):
    # A machine and a first die set can ship as two orders against one win.
    async def go():
        await db.leads.insert_one({"lead_id": "l1", "stage": "won", "expected_value": 0})
        for oid, total in (("o1", 400000), ("o2", 25000)):
            await db.orders.insert_one({"order_id": oid, "lead_id": "l1",
                                        "grand_total": total, "status": "confirmed"})
        omap = await crm._build_order_map(["l1"])
        lead = await db.leads.find_one({"lead_id": "l1"}, {"_id": 0})
        assert crm.resolve_won_value(lead, omap) == 425000
    _run(go())


def test_a_cancelled_order_is_not_revenue(db):
    async def go():
        await db.leads.insert_one({"lead_id": "l1", "stage": "won", "expected_value": 0})
        await db.orders.insert_one({"order_id": "o1", "lead_id": "l1",
                                    "grand_total": 400000, "status": "confirmed"})
        await db.orders.insert_one({"order_id": "o2", "lead_id": "l1",
                                    "grand_total": 999999, "status": "cancelled"})
        omap = await crm._build_order_map(["l1"])
        lead = await db.leads.find_one({"lead_id": "l1"}, {"_id": 0})
        assert crm.resolve_won_value(lead, omap) == 400000
    _run(go())


def test_a_deleted_order_is_not_revenue(db):
    async def go():
        await db.leads.insert_one({"lead_id": "l1", "stage": "won", "expected_value": 0})
        await db.orders.insert_one({"order_id": "o1", "lead_id": "l1", "grand_total": 400000,
                                    "status": "confirmed", "is_deleted": True})
        omap = await crm._build_order_map(["l1"])
        lead = await db.leads.find_one({"lead_id": "l1"}, {"_id": 0})
        assert crm.resolve_won_value(lead, omap) == 0
    _run(go())


def test_a_won_deal_with_no_order_is_reported_as_zero_not_as_the_guess(db):
    # Silently substituting expected_value is how the number stopped
    # reconciling. Zero plus a flag is the honest answer.
    async def go():
        await db.leads.insert_one({"lead_id": "l1", "stage": "won", "expected_value": 750000})
        omap = await crm._build_order_map(["l1"])
        lead = await db.leads.find_one({"lead_id": "l1"}, {"_id": 0})
        assert crm.resolve_won_value(lead, omap) == 0
        assert crm.is_unreconciled_win(lead, omap) is True
    _run(go())


def test_a_won_deal_with_an_order_is_reconciled(db):
    async def go():
        await db.leads.insert_one({"lead_id": "l1", "stage": "won", "expected_value": 0})
        await db.orders.insert_one({"order_id": "o1", "lead_id": "l1",
                                    "grand_total": 1, "status": "confirmed"})
        omap = await crm._build_order_map(["l1"])
        lead = await db.leads.find_one({"lead_id": "l1"}, {"_id": 0})
        assert crm.is_unreconciled_win(lead, omap) is False
    _run(go())


def test_an_open_deal_is_never_called_unreconciled(db):
    async def go():
        await db.leads.insert_one({"lead_id": "l1", "stage": "negotiation", "expected_value": 5})
        omap = await crm._build_order_map(["l1"])
        lead = await db.leads.find_one({"lead_id": "l1"}, {"_id": 0})
        assert crm.is_unreconciled_win(lead, omap) is False
    _run(go())


# ── The dashboard reports invoiced money, and says what it couldn't match ───

def test_the_dashboard_won_total_is_invoiced_money(db):
    async def go():
        await db.leads.insert_one({"lead_id": "l1", "stage": "won", "expected_value": 100000,
                                   "assigned_to": "parul@ss.in", "is_deleted": False})
        await db.orders.insert_one({"order_id": "o1", "lead_id": "l1", "grand_total": 425000,
                                    "status": "delivered", "is_deleted": False})
        out = await crm.engagement_dashboard(FakeRequest(params={"days": "365"}))
        assert out["totals"]["won_value"] == 425000, "the dashboard still reports the guess"
        assert out["totals"]["won_count"] == 1
    _run(go())


def test_the_dashboard_names_how_many_wins_it_could_not_match_to_an_order(db):
    async def go():
        await db.leads.insert_one({"lead_id": "l1", "stage": "won", "expected_value": 100000,
                                   "is_deleted": False})
        await db.leads.insert_one({"lead_id": "l2", "stage": "won", "expected_value": 200000,
                                   "is_deleted": False})
        await db.orders.insert_one({"order_id": "o1", "lead_id": "l1", "grand_total": 425000,
                                    "status": "delivered", "is_deleted": False})
        out = await crm.engagement_dashboard(FakeRequest(params={"days": "365"}))
        assert out["totals"]["won_value"] == 425000
        assert out["totals"]["won_unreconciled"] == 1, \
            "a win with no order must be visible, not quietly worth nothing"
    _run(go())


# ── An enquiry is not a forecast ────────────────────────────────────────────

def test_the_forecast_separates_unqualified_enquiries_from_real_deals(db):
    async def go():
        # `new` is an enquiry nobody has spoken to yet.
        await db.leads.insert_one({"lead_id": "l_new", "stage": "new", "expected_value": 500000})
        await db.leads.insert_one({"lead_id": "l_neg", "stage": "negotiation",
                                   "expected_value": 100000})
        out = await crm.leads_forecast(FakeRequest())
        assert out["qualified_value"] == 100000, \
            "an enquiry nobody has contacted is inflating the pipeline"
        assert out["unqualified_count"] == 1
        assert out["unqualified_value"] == 500000
        # the all-in total stays available for anyone who wants it
        assert out["total_value"] == 600000
    _run(go())


def test_the_weighted_forecast_ignores_unqualified_enquiries(db):
    async def go():
        await db.leads.insert_one({"lead_id": "l_new", "stage": "new", "expected_value": 1000000})
        await db.leads.insert_one({"lead_id": "l_neg", "stage": "negotiation",
                                   "expected_value": 100000})
        out = await crm.leads_forecast(FakeRequest())
        # negotiation is 70% by default; new would have added 10% of 1,000,000
        assert out["qualified_weighted"] == 70000
    _run(go())


def test_a_pipeline_of_only_enquiries_forecasts_nothing(db):
    async def go():
        await db.leads.insert_one({"lead_id": "l1", "stage": "new", "expected_value": 900000})
        out = await crm.leads_forecast(FakeRequest())
        assert out["qualified_value"] == 0
        assert out["qualified_weighted"] == 0
        assert out["unqualified_count"] == 1
    _run(go())


def test_the_per_stage_breakdown_is_unchanged(db):
    # The stage table is used for the funnel view and must keep every stage.
    async def go():
        await db.leads.insert_one({"lead_id": "l1", "stage": "new", "expected_value": 10})
        out = await crm.leads_forecast(FakeRequest())
        assert out["by_stage"]["new"]["count"] == 1
        assert out["by_stage"]["new"]["value"] == 10
    _run(go())
