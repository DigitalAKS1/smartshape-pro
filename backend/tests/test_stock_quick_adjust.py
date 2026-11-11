"""Point 2: Store page inline +/- stock — POST /stock/quick-adjust."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.inventory_routes as inv

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
STORE = {"email": "st@smartshape.in", "name": "Store Guy", "role": "store",
         "module_permissions": {"store": {"level": "read_write"}}}
VIEWER = {"email": "v@smartshape.in", "name": "Viewer", "role": "sales",
          "module_permissions": {"store": {"level": "read"}}}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body


def _run(c):
    return asyncio.run(c)


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(inv, "db", d)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)
    _run(d.dies.insert_one({"die_id": "d1", "code": "S-1", "name": "Rose", "stock_qty": 5, "reserved_qty": 2}))
    return d


def _as(user, monkeypatch):
    async def _me(_r):
        return user
    monkeypatch.setattr(inv, "get_current_user", _me)


def test_plus_adds_and_logs_movement(db, monkeypatch):
    _as(STORE, monkeypatch)
    out = _run(inv.quick_adjust_stock(FakeRequest({"die_id": "d1", "delta": 3})))
    assert out["stock_qty"] == 8
    mv = _run(db.stock_movements.find_one({"die_id": "d1"}))
    assert mv["movement_type"] == "stock_in" and mv["quantity"] == 3
    assert mv["created_by"] == "st@smartshape.in" and "Store" in mv["notes"]


def test_minus_needs_reason(db, monkeypatch):
    _as(STORE, monkeypatch)
    with pytest.raises(HTTPException) as e:
        _run(inv.quick_adjust_stock(FakeRequest({"die_id": "d1", "delta": -1})))
    assert e.value.status_code == 400
    out = _run(inv.quick_adjust_stock(FakeRequest({"die_id": "d1", "delta": -2, "reason": "Damaged"})))
    assert out["stock_qty"] == 3
    mv = _run(db.stock_movements.find_one({"die_id": "d1"}))
    assert mv["movement_type"] == "stock_out" and mv["quantity"] == 2 and "Damaged" in mv["notes"]


def test_never_below_zero(db, monkeypatch):
    _as(STORE, monkeypatch)
    with pytest.raises(HTTPException) as e:
        _run(inv.quick_adjust_stock(FakeRequest({"die_id": "d1", "delta": -6, "reason": "Lost"})))
    assert e.value.status_code == 409
    assert _run(db.dies.find_one({"die_id": "d1"}))["stock_qty"] == 5
    assert _run(db.stock_movements.count_documents({})) == 0


def test_warns_when_going_below_reserved(db, monkeypatch):
    _as(STORE, monkeypatch)
    out = _run(inv.quick_adjust_stock(FakeRequest({"die_id": "d1", "delta": -4, "reason": "Sample"})))
    assert out["stock_qty"] == 1 and out["below_reserved"] is True


def test_bad_input(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    for body in ({"die_id": "d1", "delta": 0}, {"die_id": "d1", "delta": "x"}, {"die_id": "d1", "delta": 5000},
                 {"die_id": "nope", "delta": 1}):
        with pytest.raises(HTTPException) as e:
            _run(inv.quick_adjust_stock(FakeRequest(body)))
        assert e.value.status_code in (400, 404)


def test_read_only_store_user_forbidden(db, monkeypatch):
    _as(VIEWER, monkeypatch)
    with pytest.raises(HTTPException) as e:
        _run(inv.quick_adjust_stock(FakeRequest({"die_id": "d1", "delta": 1})))
    assert e.value.status_code == 403
