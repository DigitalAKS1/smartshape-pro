"""Phase 2: past purchases — history endpoint, manual CRUD, template and Excel/CSV import."""
import asyncio
import json
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.crm_routes as crm
import routes.past_purchase_routes as pp

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
REP = {"email": "rep@smartshape.in", "name": "Rep", "role": "sales",
       "module_permissions": {"leads": {"level": "read_write", "scope": "own"}}}
STRANGER = {"email": "x@smartshape.in", "name": "X", "role": "store"}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body

    async def body(self):
        return json.dumps(self._body).encode()


class FakeUpload:
    def __init__(self, text, filename="old.csv"):
        self._b = text.encode("utf-8")
        self.filename = filename

    async def read(self):
        return self._b


def _run(c):
    return asyncio.run(c)


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)
    monkeypatch.setattr(pp, "db", d)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)
    _run(d.schools.insert_many([
        {"school_id": "s1", "school_name": "Alpha Public School", "city": "Delhi", "assigned_to": REP["email"]},
        {"school_id": "s2", "school_name": "Beta School", "city": "Pune", "assigned_to": "other@x.in"},
    ]))
    _run(d.dies.insert_one({"die_id": "d1", "code": "SS-101", "name": "Rose", "type": "standard"}))
    return d


def _as(user, monkeypatch):
    async def _me(_request):
        return user
    monkeypatch.setattr(pp, "get_current_user", _me)


BODY = {"school_id": "s1", "purchase_date": "2023-03-05", "reference": "BILL-9",
        "amount": 15000, "notes": "Diwali order",
        "items": [{"die_id": "d1", "qty": 4}, {"name": "Big Machine", "item_type": "machine", "qty": 1}]}


# ── Manual CRUD + history ─────────────────────────────────────────────────────

def test_create_and_history(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    out = _run(pp.create_past_purchase(FakeRequest(BODY)))
    assert out["purchase_id"].startswith("pp_")
    assert out["items"][0] == {"die_id": "d1", "die_code": "SS-101", "name": "Rose", "item_type": "die", "qty": 4}
    assert out["items"][1]["die_id"] is None and out["items"][1]["item_type"] == "machine"
    h = _run(pp.get_purchase_history("s1", FakeRequest()))
    assert h["entries"][0]["number"] == "BILL-9"
    assert {i["name"] for i in h["items"]} == {"Rose", "Big Machine"}


def test_create_requires_school_access(db, monkeypatch):
    _as(REP, monkeypatch)
    with pytest.raises(HTTPException) as e:
        _run(pp.create_past_purchase(FakeRequest({**BODY, "school_id": "s2"})))
    assert e.value.status_code == 403
    _as(REP, monkeypatch)
    assert _run(pp.create_past_purchase(FakeRequest(BODY)))["school_id"] == "s1"


def test_create_validates(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    for bad in ({**BODY, "items": []},
                {**BODY, "purchase_date": "31-31-2023"},
                {**BODY, "items": [{"die_id": "d1", "qty": 0}]},
                {**BODY, "items": [{"die_id": "nope", "qty": 1}]},
                {**BODY, "school_id": "missing"}):
        with pytest.raises(HTTPException) as e:
            _run(pp.create_past_purchase(FakeRequest(bad)))
        assert e.value.status_code in (400, 404)


def test_create_recomputes_lifecycle(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    _run(pp.create_past_purchase(FakeRequest(BODY)))
    s = _run(db.schools.find_one({"school_id": "s1"}))
    assert s["account_status"] == "dormant" and s["order_count"] == 1


def test_update_items(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    pid = _run(pp.create_past_purchase(FakeRequest(BODY)))["purchase_id"]
    out = _run(pp.update_past_purchase(pid, FakeRequest({"items": [{"die_id": "d1", "qty": 9}], "reference": "B-10"})))
    assert out["items"] == [{"die_id": "d1", "die_code": "SS-101", "name": "Rose", "item_type": "die", "qty": 9}]
    assert out["reference"] == "B-10"


def test_delete_soft_and_admin_or_creator(db, monkeypatch):
    _as(REP, monkeypatch)
    pid = _run(pp.create_past_purchase(FakeRequest(BODY)))["purchase_id"]
    other_rep = {**REP, "email": "rep2@smartshape.in"}
    _run(db.schools.update_one({"school_id": "s1"}, {"$set": {"created_by": other_rep["email"]}}))
    _as(other_rep, monkeypatch)
    with pytest.raises(HTTPException) as e:
        _run(pp.delete_past_purchase(pid, FakeRequest()))
    assert e.value.status_code == 403
    _as(REP, monkeypatch)
    _run(pp.delete_past_purchase(pid, FakeRequest()))
    doc = _run(db.past_purchases.find_one({"purchase_id": pid}))
    assert doc["is_deleted"] is True
    s = _run(db.schools.find_one({"school_id": "s1"}))
    assert s["account_status"] == "prospect"


def test_manual_duplicate_returns_409(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    _run(pp.create_past_purchase(FakeRequest(BODY)))
    with pytest.raises(HTTPException) as e:
        _run(pp.create_past_purchase(FakeRequest(BODY)))
    assert e.value.status_code == 409


# ── Import ───────────────────────────────────────────────────────────────────

HEADER = "school_id,school_name,city,purchase_date,die_code,item_name,item_type,qty,reference,amount,notes"
CSV = "\n".join([
    HEADER,
    ",Alpha Public School,Delhi,05-03-2023,SS-101,,,4,BILL-1,15000,",
    ",alpha public school,Delhi,05-03-2023,,Big Machine,machine,1,BILL-1,,",
    "s2,,,2024-01-10, ss 101 ,,,2,INV-7,,repeat",
    ",Gamma School,,2024-01-10,SS-101,,,1,X,,",
    ",Beta School,Pune,2024-02-01,ZZ-999,,,3,INV-8,,",
    ",Beta School,Pune,not a date,SS-101,,,3,INV-9,,",
])


def _import(dry_run):
    return _run(pp.import_past_purchases(FakeRequest(), FakeUpload(CSV), dry_run=dry_run))


def test_parse_date_formats():
    assert pp.parse_date("2024-03-05") == "2024-03-05"
    assert pp.parse_date("05-03-2024") == "2024-03-05"
    assert pp.parse_date("05/03/2024") == "2024-03-05"
    assert pp.parse_date("45356") == "2024-03-05"
    assert pp.parse_date(45356) == "2024-03-05"
    assert pp.parse_date("2024-03-05 00:00:00") == "2024-03-05"
    assert pp.parse_date("garbage") is None and pp.parse_date("") is None


def test_groups_rows_per_school_date_reference(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    out = _import(False)
    assert out["groups"] == 3 and out["created"] == 3
    alpha = _run(db.past_purchases.find_one({"school_id": "s1"}))
    assert alpha["purchase_date"] == "2023-03-05" and alpha["reference"] == "BILL-1"
    assert alpha["amount"] == 15000 and alpha["source"] == "import"
    assert [i["name"] for i in alpha["items"]] == ["Rose", "Big Machine"]
    beta = _run(db.past_purchases.find_one({"school_id": "s2", "reference": "INV-7"}))
    assert beta["items"][0]["die_id"] == "d1"


def test_unknown_school_skipped_with_reason(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    out = _import(True)
    reasons = {s["row"]: s["reason"] for s in out["skipped"]}
    assert "school not found" in reasons[5].lower()
    assert "date" in reasons[7].lower()


def test_unknown_die_code_kept_as_text(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    _import(False)
    doc = _run(db.past_purchases.find_one({"reference": "INV-8"}))
    assert doc["items"] == [{"die_id": None, "die_code": "ZZ-999", "name": "ZZ-999", "item_type": "die", "qty": 3}]


def test_dry_run_writes_nothing(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    out = _import(True)
    assert out["groups"] == 3 and out["created"] == 0
    assert len(out["preview"]) == 3
    assert _run(db.past_purchases.count_documents({})) == 0


def test_reupload_creates_nothing(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    _import(False)
    out = _import(False)
    assert out["created"] == 0 and out["duplicates"] == 3
    assert _run(db.past_purchases.count_documents({})) == 3


def test_template_header(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    resp = _run(pp.past_purchase_template(FakeRequest()))
    assert resp.body.decode().splitlines()[0] == HEADER


def test_import_requires_admin_or_orders(db, monkeypatch):
    _as(REP, monkeypatch)
    with pytest.raises(HTTPException) as e:
        _import(True)
    assert e.value.status_code == 403
    _as({**STRANGER, "module_permissions": {"orders": {"level": "read_write"}}}, monkeypatch)
    assert _import(True)["groups"] == 3


# ── Final-review fixes ────────────────────────────────────────────────────────

READ_ONLY = {"email": "acc@smartshape.in", "name": "Acc", "role": "accounts",
             "module_permissions": {"leads": {"level": "read", "scope": "all"}}}


def test_read_only_crm_user_cannot_write(db, monkeypatch):
    _as(READ_ONLY, monkeypatch)
    assert _run(pp.get_purchase_history("s1", FakeRequest()))["entries"] == []
    with pytest.raises(HTTPException) as e:
        _run(pp.create_past_purchase(FakeRequest(BODY)))
    assert e.value.status_code == 403


def test_concurrent_duplicate_insert_returns_409(db, monkeypatch):
    from pymongo.errors import DuplicateKeyError
    _as(ADMIN, monkeypatch)
    _run(pp.create_past_purchase(FakeRequest(BODY)))

    async def _never(_key):
        return False
    monkeypatch.setattr(pp, "_dup_exists", _never)        # simulate the race: pre-check missed it
    _run(db.past_purchases.create_index("dedupe_key", unique=True))
    with pytest.raises(HTTPException) as e:
        _run(pp.create_past_purchase(FakeRequest(BODY)))
    assert e.value.status_code == 409


def test_reimport_recomputes_schools_left_stale(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    _import(False)
    # simulate an import that inserted but died before recomputing
    _run(db.schools.update_many({}, {"$set": {"account_status": "prospect", "order_count": 0}}))
    _import(False)
    s = _run(db.schools.find_one({"school_id": "s1"}))
    assert s["account_status"] == "dormant" and s["order_count"] == 1


def test_template_examples_cannot_match_a_real_school(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    body = _run(pp.past_purchase_template(FakeRequest())).body.decode()
    assert "Delhi Public School" not in body
    assert "EXAMPLE" in body


def test_typed_exact_die_code_links_to_inventory(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    out = _run(pp.create_past_purchase(FakeRequest({**BODY, "items": [{"name": "ss-101", "qty": 2}]})))
    assert out["items"][0]["die_id"] == "d1"


def test_future_date_rejected(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    with pytest.raises(HTTPException) as e:
        _run(pp.create_past_purchase(FakeRequest({**BODY, "purchase_date": "2099-01-01"})))
    assert e.value.status_code == 400
