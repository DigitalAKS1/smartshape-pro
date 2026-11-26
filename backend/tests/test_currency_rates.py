"""Quotation currency system: editable INR rates per currency (Settings)."""
import asyncio, os
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")
import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient
import rbac
import routes.settings_routes as sr

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
REP = {"email": "r@x.in", "name": "R", "role": "sales"}


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
    monkeypatch.setattr(sr, "db", d)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)
    return d


def _as(u, monkeypatch):
    async def _me(_r):
        return u
    monkeypatch.setattr(sr, "get_current_user", _me)


REP_W = {**REP, "module_permissions": {"quotations": {"level": "read_write"}}}


def test_defaults_list(db, monkeypatch):
    _as(REP, monkeypatch)
    cur = {c["code"]: c for c in _run(sr.get_currency_rates(FakeRequest()))["currencies"]}
    assert cur["USD"]["rate"] > 0 and cur["USD"]["symbol"] == "$" and "INR" not in cur


def test_add_any_currency_and_update_rate(db, monkeypatch):
    _as(REP_W, monkeypatch)
    out = _run(sr.upsert_currency(FakeRequest({"code": "qar", "symbol": "ر.ق", "rate": "23.1", "name": "Qatari Riyal"})))
    q = {c["code"]: c for c in out["currencies"]}["QAR"]
    assert q["rate"] == 23.1 and q["symbol"] == "ر.ق" and q["name"] == "Qatari Riyal"
    out = _run(sr.upsert_currency(FakeRequest({"code": "QAR", "rate": 22.8})))
    q = {c["code"]: c for c in out["currencies"]}["QAR"]
    assert q["rate"] == 22.8 and q["symbol"] == "ر.ق"                  # symbol kept
    _run(sr.upsert_currency(FakeRequest({"code": "RUB", "symbol": "₽", "rate": 0.95})))
    codes = [c["code"] for c in _run(sr.get_currency_rates(FakeRequest()))["currencies"]]
    assert "QAR" in codes and "RUB" in codes and "USD" in codes


def test_bad_currency_rejected(db, monkeypatch):
    _as(REP_W, monkeypatch)
    for bad in ({"code": "US", "rate": 80}, {"code": "INR", "rate": 1}, {"code": "USD", "rate": 0},
                {"code": "USD", "rate": "abc"}, {"code": "ABC", "rate": 5}):     # new code needs a symbol
        with pytest.raises(HTTPException):
            _run(sr.upsert_currency(FakeRequest(bad)))


def test_read_only_user_cannot_change(db, monkeypatch):
    _as(REP, monkeypatch)
    with pytest.raises(HTTPException) as e:
        _run(sr.upsert_currency(FakeRequest({"code": "USD", "rate": 80})))
    assert e.value.status_code == 403
