"""Phase 3-1: catalogue links tell the school which dies it already ordered."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.quotation_routes as qr
import routes.school_routes as sr


def _run(c):
    return asyncio.run(c)


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(qr, "db", d)
    monkeypatch.setattr(sr, "db", d)
    _run(d.dies.insert_many([
        {"die_id": "d1", "code": "SS-1", "name": "Rose", "is_active": True, "stock_qty": 5},
        {"die_id": "d2", "code": "SS-2", "name": "Leaf", "is_active": True, "stock_qty": 5},
    ]))
    _run(d.past_purchases.insert_one({
        "purchase_id": "p1", "school_id": "s1", "purchase_date": "2024-03-05", "is_deleted": False,
        "items": [{"die_id": "d1", "die_code": "SS-1", "name": "Rose", "item_type": "die", "qty": 4}]}))
    return d


def test_catalogue_link_returns_owned(db):
    _run(db.quotations.insert_one({"quotation_id": "q1", "school_id": "s1", "catalogue_token": "tok",
                                   "catalogue_status": "sent"}))
    out = _run(qr.get_catalogue("tok"))
    assert out["owned"] == {"d1": {"qty": 4, "last_date": "2024-03-05", "times": 1}}


def test_catalogue_without_school_has_empty_owned(db):
    _run(db.quotations.insert_one({"quotation_id": "q2", "catalogue_token": "t2", "catalogue_status": "sent"}))
    assert _run(qr.get_catalogue("t2"))["owned"] == {}


def test_school_portal_catalogue_returns_owned(db, monkeypatch):
    async def _school(_req):
        return {"school_id": "s1", "school_name": "Alpha"}
    monkeypatch.setattr(sr, "get_current_school", _school)
    out = _run(sr.school_catalogue(object()))
    assert out["owned"]["d1"]["qty"] == 4


def test_catalogue_pages_carry_offer_badges(db, monkeypatch):
    _run(db.dies.update_one({"die_id": "d1"}, {"$set": {"category": "flowers"}}))
    _run(db.promotions.insert_one({"promo_id": "p", "title": "Spring", "discount_pct": 10, "is_active": True,
                                   "categories": ["flowers"]}))
    _run(db.quotations.insert_one({"quotation_id": "q3", "school_id": "s1", "catalogue_token": "t3",
                                   "catalogue_status": "sent"}))
    assert _run(qr.get_catalogue("t3"))["offers"]["d1"]["discount_pct"] == 10

    async def _school(_req):
        return {"school_id": "s1", "school_name": "Alpha"}
    monkeypatch.setattr(sr, "get_current_school", _school)
    assert _run(sr.school_catalogue(object()))["offers"]["d1"]["title"] == "Spring"
