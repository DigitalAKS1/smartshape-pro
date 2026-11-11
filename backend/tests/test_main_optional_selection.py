"""Phase 4: catalogue selection split into MAIN (as per quotation) and OPTIONAL extras.
Only main lines become the sales order; optional extras are flagged for the sales rep."""
import asyncio
import json
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.order_routes as orr
import routes.quotation_routes as qr


class FakeClient:
    host = "1.2.3.4"


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}
        self.client = FakeClient()

    async def json(self):
        return self._body


def _run(c):
    return asyncio.run(c)


def test_order_lines_skip_optional_and_removed():
    items = [
        {"die_id": "d1", "quantity": 2, "selection_kind": "main"},
        {"die_id": "d2", "quantity": 1},                                   # legacy row = main
        {"die_id": "d3", "quantity": 5, "selection_kind": "optional"},
        {"die_id": "d4", "quantity": 1, "status": "removed_by_admin"},
    ]
    assert [i["die_id"] for i in orr.order_lines_from_selection(items)] == ["d1", "d2"]


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(qr, "db", d)
    bells = []

    async def _bell(email, **kw):
        bells.append({"email": email, **kw})
        return "n"
    monkeypatch.setattr(qr, "notify_user", _bell, raising=False)
    _run(d.settings.insert_one({"type": "notifications", "auto_create_so_on_submit": False}))
    _run(d.quotations.insert_one({"quotation_id": "q1", "quote_number": "QT-1", "catalogue_token": "tok",
                                  "catalogue_status": "opened", "school_name": "Alpha",
                                  "sales_person_email": "rep@x.in"}))
    _run(d.dies.insert_many([
        {"die_id": "d1", "code": "S-1", "name": "Rose", "type": "standard"},
        {"die_id": "d2", "code": "S-2", "name": "Leaf", "type": "standard"},
    ]))
    return {"db": d, "bells": bells}


def test_submit_stores_kind_and_flags_optional(db):
    out = _run(qr.submit_catalogue_selection("tok", FakeRequest({"selections": [
        {"die_id": "d1", "quantity": 2, "kind": "main"},
        {"die_id": "d2", "quantity": 3, "kind": "optional"},
        {"die_id": "d1", "quantity": 1, "kind": "main"},
    ]})))
    assert out is not None
    rows = {(r["die_id"], r["selection_kind"]): r["quantity"]
            for r in _run(db["db"].catalogue_selection_items.find({}).to_list(10))}
    assert rows == {("d1", "main"): 3, ("d2", "optional"): 3}
    q = _run(db["db"].quotations.find_one({"quotation_id": "q1"}))
    assert q["catalogue_optional_count"] == 1
    assert any(b["email"] == "rep@x.in" and "optional" in b["title"].lower() for b in db["bells"])


def test_submit_without_kind_is_all_main_and_no_bell(db):
    _run(qr.submit_catalogue_selection("tok", FakeRequest({"selections": [{"die_id": "d1", "quantity": 1}]})))
    row = _run(db["db"].catalogue_selection_items.find_one({}))
    assert row["selection_kind"] == "main"
    assert db["bells"] == []
