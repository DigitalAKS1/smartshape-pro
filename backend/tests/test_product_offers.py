"""Point 9: product offers — promotions tied to products with a discount %, shown on
catalogue pages and offered when quoting a package."""
import asyncio
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.promotions_routes as pr
import services.offers as of

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
STORE = {"email": "st@x.in", "name": "St", "role": "store"}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body


def _run(c):
    return asyncio.run(c)


def _d(days):
    return (datetime.now(timezone.utc) + timedelta(days=days)).strftime("%Y-%m-%d")


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(pr, "db", d)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)

    async def _me(_r):
        return ADMIN
    monkeypatch.setattr(pr, "get_current_user", _me)
    return d


def _promo(db, **kw):
    body = {"title": "Diwali", "discount_pct": 10, "is_active": True, **kw}
    return _run(pr.create_promotion(FakeRequest(body)))


def test_create_offer_with_scope_and_discount(db):
    p = _promo(db, categories=["flowers"], die_ids=["d9"], package_ids=["pkg1"], discount_pct="12.5")
    assert p["discount_pct"] == 12.5 and p["categories"] == ["flowers"] and p["package_ids"] == ["pkg1"]


def test_discount_bounds(db):
    for bad in (-5, 95, "abc"):
        with pytest.raises(HTTPException):
            _promo(db, discount_pct=bad)


def test_write_requires_crm_edit(db, monkeypatch):
    async def _st(_r):
        return STORE
    monkeypatch.setattr(pr, "get_current_user", _st)
    with pytest.raises(HTTPException) as e:
        _promo(db)
    assert e.value.status_code == 403


def test_active_offers_respect_dates_and_flag(db):
    _promo(db, title="Live", valid_from=_d(-1), valid_until=_d(5), categories=["flowers"])
    _promo(db, title="Expired", valid_until=_d(-1), categories=["flowers"])
    _promo(db, title="Future", valid_from=_d(3), categories=["flowers"])
    _promo(db, title="Off", is_active=False, categories=["flowers"])
    _promo(db, title="No discount", discount_pct=0, categories=["flowers"])
    assert [o["title"] for o in _run(of.active_offers(db))] == ["Live"]


def test_offers_by_die_best_discount_wins(db):
    _promo(db, title="Cat 10", discount_pct=10, categories=["flowers"])
    _promo(db, title="Die 15", discount_pct=15, die_ids=["d1"])
    _promo(db, title="Package only", discount_pct=30, package_ids=["pkg1"])
    dies = [{"die_id": "d1", "category": "flowers"}, {"die_id": "d2", "category": "flowers"},
            {"die_id": "d3", "category": "leaf"}]
    m = _run(of.offers_by_die(db, dies))
    assert m["d1"]["discount_pct"] == 15 and m["d1"]["title"] == "Die 15"
    assert m["d2"]["discount_pct"] == 10
    assert "d3" not in m                                   # package-only offers don't badge dies


def test_whole_range_offer_applies_to_every_die(db):
    _promo(db, title="All 5", discount_pct=5, applies_to_all=True)
    m = _run(of.offers_by_die(db, [{"die_id": "x", "category": "leaf"}]))
    assert m["x"]["discount_pct"] == 5


def test_package_offers_endpoint(db):
    _promo(db, title="Pkg", discount_pct=8, package_ids=["pkg1"])
    _promo(db, title="All", discount_pct=5, applies_to_all=True)
    _promo(db, title="Other pkg", discount_pct=20, package_ids=["pkg2"])
    out = _run(pr.offers_for_package("pkg1", FakeRequest()))
    assert [o["title"] for o in out] == ["Pkg", "All"]       # best first


def test_own_scope_rep_cannot_publish_offers(db, monkeypatch):
    rep = {"email": "r@x.in", "name": "R", "role": "sales",
           "module_permissions": {"leads": {"level": "read_write", "scope": "own"}}}
    async def _rep(_r):
        return rep
    monkeypatch.setattr(pr, "get_current_user", _rep)
    with pytest.raises(HTTPException) as e:
        _promo(db)
    assert e.value.status_code == 403
    manager = {**rep, "module_permissions": {"leads": {"level": "read_write", "scope": "all"}}}
    async def _mgr(_r):
        return manager
    monkeypatch.setattr(pr, "get_current_user", _mgr)
    assert _promo(db)["title"] == "Diwali"
