"""Phase 5 — engagement funnel dashboard. Aggregates pipeline funnel + channel
touches + brochure performance + hot signals + stuck deals. Admin sees all;
a rep is scoped to own leads. mongomock, direct-call."""
import asyncio
import os
from datetime import datetime, timezone, timedelta

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.crm_routes as crm

ADMIN = {"email": "admin@smartshape.in", "name": "Admin", "role": "admin", "roles": ["admin"]}
REP = {"email": "rep@x.in", "name": "Rep", "role": "sales_person", "roles": ["sales_person"]}


class FakeRequest:
    def __init__(self, params=None):
        self.query_params = params or {}


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)
    return d


def _as(monkeypatch, user):
    async def _fake(_r):
        return user
    monkeypatch.setattr(crm, "get_current_user", _fake)


def _iso(days_ago):
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


async def _seed(d):
    await d.leads.insert_many([
        {"lead_id": "L1", "stage": "new", "assigned_to": "rep@x.in", "expected_value": 1000,
         "company_name": "A", "last_activity_date": _iso(1)},
        {"lead_id": "L2", "stage": "quoted", "assigned_to": "rep@x.in", "expected_value": 5000,
         "company_name": "B", "last_activity_date": _iso(30)},   # stuck
        {"lead_id": "L3", "stage": "won", "assigned_to": "rep@x.in", "expected_value": 8000,
         "company_name": "C", "last_activity_date": _iso(2)},
        {"lead_id": "L4", "stage": "quoted", "assigned_to": "other@x.in", "expected_value": 9000,
         "company_name": "D", "last_activity_date": _iso(40)},   # other rep's, stuck
    ])
    # Won value is invoiced money now, not the estimate on the lead, so the win
    # needs the order behind it. expected_value stays deliberately different
    # from grand_total to prove which one the dashboard reports.
    await d.orders.insert_one({"order_id": "O1", "lead_id": "L3", "grand_total": 8000,
                               "status": "delivered", "is_deleted": False})
    await d.engagement_events.insert_many([
        {"channel": "whatsapp", "direction": "out", "lead_id": "L1", "at": _iso(2)},
        {"channel": "brochure", "direction": "out", "lead_id": "L2", "at": _iso(3)},
        {"channel": "brochure", "direction": "in", "lead_id": "L2", "at": _iso(2)},
        {"channel": "email", "direction": "out", "lead_id": "L4", "at": _iso(1)},  # other rep
    ])
    await d.brochure_shares.insert_many([
        {"share_id": "b1", "lead_id": "L2", "status": "opened", "created_at": _iso(3)},
        {"share_id": "b2", "lead_id": "L1", "status": "sent", "created_at": _iso(1)},
    ])
    await d.drip_enrollments.insert_one({"enrollment_id": "e1", "lead_id": "L1", "status": "active"})
    await d.crm_activities.insert_one(
        {"activity_id": "a1", "source": "brochure_open", "assigned_to": "rep@x.in", "created_at": _iso(2)})


def test_admin_sees_everything(db, monkeypatch):
    _as(monkeypatch, ADMIN)

    async def go():
        await _seed(db)
        res = await crm.engagement_dashboard(FakeRequest({"days": "60"}))
        fmap = {f["stage"]: f for f in res["funnel"]}
        assert fmap["quoted"]["count"] == 2 and fmap["won"]["count"] == 1
        assert res["totals"]["won_value"] == 8000          # from the order, not expected_value
        assert res["totals"]["won_unreconciled"] == 0      # every win has an order behind it
        assert res["touches_total"] == 4                    # all events
        broch = next(c for c in res["channels"] if c["channel"] == "brochure")
        assert broch["out"] == 1 and broch["in"] == 1
        assert res["brochures"] == {"shared": 2, "opened": 1, "open_rate": 50.0}
        assert res["sequences_active"] == 1
        assert res["hot_signals"] == 1
        assert len(res["stuck"]) == 2                        # both quoted+silent leads
        assert res["stuck"][0]["days_silent"] >= 14

    asyncio.run(go())


def test_rep_scoped_to_own(db, monkeypatch):
    _as(monkeypatch, REP)

    async def go():
        await _seed(db)
        res = await crm.engagement_dashboard(FakeRequest({"days": "60"}))
        fmap = {f["stage"]: f for f in res["funnel"]}
        assert fmap["quoted"]["count"] == 1                 # only own L2, not L4
        assert res["touches_total"] == 3                    # excludes L4's event
        assert len(res["stuck"]) == 1 and res["stuck"][0]["lead_id"] == "L2"

    asyncio.run(go())
