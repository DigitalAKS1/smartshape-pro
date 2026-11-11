"""Phase 2: purchase history service — merges real orders + past purchases, and feeds
account lifecycle + reorder-due."""
import asyncio
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import services.purchase_history as ph
import services.account_lifecycle as al
import services.reorder as ro


def _run(c):
    return asyncio.run(c)


def _ago(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _date_ago(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")


@pytest.fixture()
def db():
    d = AsyncMongoMockClient()["smartshape_test"]
    _run(d.schools.insert_one({"school_id": "s1", "school_name": "Alpha"}))
    return d


async def _order(db, oid, days_ago=10, total=1000, **status):
    await db.orders.insert_one({"order_id": oid, "order_number": f"ORD-{oid}", "school_id": "s1",
                                "grand_total": total, "created_at": _ago(days_ago),
                                "is_deleted": False, **status})


async def _past(db, pid, days_ago=400, items=None, amount=0, deleted=False):
    await db.past_purchases.insert_one({
        "purchase_id": pid, "school_id": "s1", "purchase_date": _date_ago(days_ago),
        "reference": f"BILL-{pid}", "amount": amount, "is_deleted": deleted,
        "items": items or [{"die_id": "d1", "die_code": "SS-1", "name": "Rose", "item_type": "die", "qty": 2}],
    })


def test_cancelled_by_order_status_excluded(db):
    _run(_order(db, "o1", order_status="cancelled"))
    _run(_order(db, "o2", order_status="delivered"))
    ev = _run(ph.revenue_events(db, ["s1"]))
    assert len(ev["s1"]) == 1


def test_legacy_status_cancelled_excluded(db):
    _run(_order(db, "o1", status="cancelled"))
    assert _run(ph.revenue_events(db, ["s1"])).get("s1", []) == []


def test_past_purchase_is_revenue_event(db):
    _run(_past(db, "p1", amount=5000))
    _run(_past(db, "p2", deleted=True))
    ev = _run(ph.revenue_events(db, ["s1"]))["s1"]
    assert len(ev) == 1
    assert ev[0]["amount"] == 5000 and ev[0]["source"] == "past"
    assert ev[0]["at"].endswith("T00:00:00+00:00")


def test_history_merges_orders_and_past_newest_first(db):
    _run(_order(db, "o1", days_ago=5, order_status="delivered"))
    _run(db.order_items.insert_one({"order_id": "o1", "die_id": "d1", "die_code": "SS-1",
                                    "die_name": "Rose", "die_type": "standard", "quantity": 3}))
    _run(_order(db, "o2", days_ago=3, order_status="cancelled"))
    _run(_past(db, "p1", days_ago=400))
    h = _run(ph.school_purchase_history(db, "s1"))
    kinds = [e["kind"] for e in h["entries"]]
    assert kinds == ["order", "past"]
    assert h["entries"][0]["number"] == "ORD-o1"
    assert h["entries"][0]["items"][0]["qty"] == 3


def test_item_summary_totals_by_die(db):
    _run(_order(db, "o1", days_ago=5, order_status="delivered"))
    _run(db.order_items.insert_one({"order_id": "o1", "die_id": "d1", "die_code": "SS-1",
                                    "die_name": "Rose", "die_type": "standard", "quantity": 3}))
    _run(_past(db, "p1", days_ago=400))
    _run(_past(db, "p2", days_ago=300, items=[{"die_id": None, "die_code": "", "name": "Big Machine",
                                               "item_type": "machine", "qty": 1}]))
    items = {i["name"]: i for i in _run(ph.school_purchase_history(db, "s1"))["items"]}
    assert items["Rose"]["total_qty"] == 5 and items["Rose"]["times"] == 2
    assert items["Rose"]["last_date"] == _date_ago(5)
    assert items["Big Machine"]["item_type"] == "machine"


def test_lifecycle_counts_past_purchase(db):
    _run(_past(db, "p1", days_ago=400, amount=12000))
    out = _run(al.recompute_school_lifecycle(db, "s1"))
    assert out["account_status"] == "dormant"
    assert out["order_count"] == 1 and out["lifetime_value"] == 12000


def test_reorder_includes_past_purchase_only_school(db):
    _run(_past(db, "p1", days_ago=400))
    _run(_past(db, "p2", days_ago=200))
    rows = _run(ro.reorder_candidates(db))
    assert [r["school_id"] for r in rows] == ["s1"]
    assert rows[0]["order_count"] == 2 and rows[0]["confidence"] == "measured"


def test_removed_order_items_not_owned(db):
    _run(_order(db, "o1", days_ago=5, order_status="delivered"))
    _run(db.order_items.insert_many([
        {"order_id": "o1", "die_id": "dA", "die_code": "A", "die_name": "Old A", "quantity": 2, "status": "removed"},
        {"order_id": "o1", "die_id": "dB", "die_code": "B", "die_name": "New B", "quantity": 2, "status": "dispatched"},
    ]))
    names = [i["name"] for i in _run(ph.school_purchase_history(db, "s1"))["items"]]
    assert names == ["New B"]


def test_order_without_created_at_still_counts(db):
    _run(db.orders.insert_one({"order_id": "o9", "school_id": "s1", "grand_total": 700,
                               "order_status": "delivered", "is_deleted": False}))
    out = _run(al.recompute_school_lifecycle(db, "s1"))
    assert out["account_status"] == "customer"
    assert out["order_count"] == 1 and out["lifetime_value"] == 700


def test_owned_by_die_only_inventory_items(db):
    _run(_order(db, "o1", days_ago=5, order_status="delivered"))
    _run(db.order_items.insert_one({"order_id": "o1", "die_id": "d1", "die_code": "SS-1",
                                    "die_name": "Rose", "die_type": "standard", "quantity": 3}))
    _run(_past(db, "p1", days_ago=400))
    _run(_past(db, "p2", days_ago=300, items=[{"die_id": None, "die_code": "", "name": "Big Machine",
                                               "item_type": "machine", "qty": 1}]))
    owned = _run(ph.owned_by_die(db, "s1"))
    assert owned == {"d1": {"qty": 5, "last_date": _date_ago(5), "times": 2}}
    assert _run(ph.owned_by_die(db, "")) == {}
