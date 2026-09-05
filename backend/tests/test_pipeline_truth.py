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


# ── Whose day is it: the biggest deal, or the best one? ─────────────────────

def test_needs_attention_ranks_by_value_discounted_by_fit(db):
    """A rep works down this list. Sorting by raw deal value alone puts the
    loudest number on top even when that kind of school almost never buys.

    Expected value — what it is worth times how often schools like it convert —
    is a real quantity, and it is the one a rep should spend the morning on.
    """
    async def go():
        # A small deal at a school type that converts, and a big one that doesn't.
        await db.schools.insert_one({"school_id": "s_good", "fit_rate": 60.0, "is_deleted": False})
        await db.schools.insert_one({"school_id": "s_bad", "fit_rate": 2.0, "is_deleted": False})
        await db.leads.insert_many([
            {"lead_id": "l_good", "school_id": "s_good", "stage": "negotiation",
             "expected_value": 100000, "last_activity_date": "2020-01-01", "is_deleted": False},
            {"lead_id": "l_bad", "school_id": "s_bad", "stage": "negotiation",
             "expected_value": 900000, "last_activity_date": "2020-01-01", "is_deleted": False},
        ])
        rows = await crm.leads_needs_attention(FakeRequest())
        assert [r["lead_id"] for r in rows] == ["l_good", "l_bad"], \
            "the loud deal outranked the likely one"
        assert rows[0]["expected_value"] == 60000      # 100,000 x 60%
        assert rows[0]["fit_rate"] == 60.0
    _run(go())


def test_a_deal_with_no_fit_score_is_ranked_on_its_value_not_buried(db):
    # "We have no evidence about this kind of school" must not read as "worthless".
    async def go():
        await db.schools.insert_one({"school_id": "s_known", "fit_rate": 10.0, "is_deleted": False})
        await db.schools.insert_one({"school_id": "s_unknown", "is_deleted": False})
        await db.leads.insert_many([
            {"lead_id": "l_known", "school_id": "s_known", "stage": "demo",
             "expected_value": 100000, "last_activity_date": "2020-01-01", "is_deleted": False},
            {"lead_id": "l_unknown", "school_id": "s_unknown", "stage": "demo",
             "expected_value": 50000, "last_activity_date": "2020-01-01", "is_deleted": False},
        ])
        rows = await crm.leads_needs_attention(FakeRequest())
        by = {r["lead_id"]: r for r in rows}
        assert by["l_unknown"]["fit_rate"] is None
        assert by["l_unknown"]["expected_value"] == 50000   # its own value, undiscounted
        assert [r["lead_id"] for r in rows] == ["l_unknown", "l_known"]  # 50,000 > 10,000
    _run(go())


def test_two_equal_deals_are_broken_by_which_has_been_silent_longest(db):
    async def go():
        await db.schools.insert_one({"school_id": "s1", "fit_rate": 50.0, "is_deleted": False})
        await db.leads.insert_many([
            {"lead_id": "l_fresh", "school_id": "s1", "stage": "demo", "expected_value": 100000,
             "last_activity_date": "2026-09-01", "is_deleted": False},
            {"lead_id": "l_stale", "school_id": "s1", "stage": "demo", "expected_value": 100000,
             "last_activity_date": "2020-01-01", "is_deleted": False},
        ])
        rows = await crm.leads_needs_attention(FakeRequest())
        assert [r["lead_id"] for r in rows] == ["l_stale", "l_fresh"]
    _run(go())


def test_the_row_still_carries_the_real_deal_value(db):
    # Discounting is for ordering. The money on screen must stay the money.
    async def go():
        await db.schools.insert_one({"school_id": "s1", "fit_rate": 25.0, "is_deleted": False})
        await db.leads.insert_one({"lead_id": "l1", "school_id": "s1", "stage": "demo",
                                   "expected_value": 80000, "last_activity_date": "2020-01-01",
                                   "is_deleted": False})
        row = (await crm.leads_needs_attention(FakeRequest()))[0]
        assert row["deal_value"] == 80000
        assert row["expected_value"] == 20000
    _run(go())


# ── Retiring a stage must not abandon what is in it ─────────────────────────

def test_leads_stranded_in_a_retired_stage_can_be_found(db):
    async def go():
        await db.leads.insert_many([
            {"lead_id": "l1", "stage": "retention", "company_name": "DPS",
             "last_activity_date": "2025-01-01", "is_deleted": False},
            {"lead_id": "l2", "stage": "resell", "company_name": "Lotus",
             "last_activity_date": "2025-06-01", "is_deleted": False},
            {"lead_id": "l3", "stage": "demo", "company_name": "Ryan",
             "last_activity_date": "2026-01-01", "is_deleted": False},
        ])
        out = await crm.retired_stage_leads(FakeRequest())
        assert out["total"] == 2
        assert out["by_stage"] == {"retention": 1, "resell": 1}
        assert {l["lead_id"] for l in out["leads"]} == {"l1", "l2"}
    _run(go())


def test_nothing_stranded_reports_cleanly(db):
    async def go():
        await db.leads.insert_one({"lead_id": "l1", "stage": "demo", "is_deleted": False})
        out = await crm.retired_stage_leads(FakeRequest())
        assert out == {"total": 0, "by_stage": {}, "leads": []}
    _run(go())


def test_a_deleted_lead_is_not_reported_as_stranded(db):
    async def go():
        await db.leads.insert_one({"lead_id": "l1", "stage": "retention", "is_deleted": True})
        assert (await crm.retired_stage_leads(FakeRequest()))["total"] == 0
    _run(go())
