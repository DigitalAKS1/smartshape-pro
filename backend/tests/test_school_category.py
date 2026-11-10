"""School Category (Phase 1): school create/update, import alias + canonicalisation,
email + WhatsApp audience filters.

Harness: mongomock_motor, route functions called directly.
"""
import asyncio
import json
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import field_registry as fr
import import_engine as ie
import routes.crm_routes as crm
import routes.email_routes as email
import routes.lookup_routes as lk
import routes.whatsapp_routes as wa

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body

    async def body(self):
        return json.dumps(self._body).encode()


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    for mod in (crm, email, lk, wa):
        monkeypatch.setattr(mod, "db", d, raising=False)

    async def _me(_request):
        return ADMIN
    for mod in (crm, lk):
        monkeypatch.setattr(mod, "get_current_user", _me)

    async def _noop(*a, **k):
        return None
    for name in ("get_cached", "set_cached", "invalidate"):
        monkeypatch.setattr(crm, name, _noop, raising=False)
    return d


def test_create_school_with_category(db):
    out = _run(crm.create_school(FakeRequest({"school_name": "Alpha", "school_category": "k-12 school"})))
    sid = out.get("school_id") or out.get("school", {}).get("school_id")
    s = _run(db.schools.find_one({"school_id": sid}))
    assert s["school_category"] == "K-12 School"


def test_update_school_category(db):
    _run(db.schools.insert_one({"school_id": "s1", "school_name": "Beta", "assigned_to": ADMIN["email"]}))
    _run(crm.update_school("s1", FakeRequest({"school_category": "navodaya"})))
    s = _run(db.schools.find_one({"school_id": "s1"}))
    assert s["school_category"] == "Navodaya"


def test_category_alias_maps_to_school_category(db):
    _run(fr.seed_field_definitions(db))
    mapping = _run(ie.propose_mapping(db, ["Category", "School Type"]))
    by_src = {m["source"]: m["key"] for m in mapping}
    assert by_src["Category"] == "school_category"
    assert by_src["School Type"] == "school_type"


def test_import_canonicalises_school_category(db):
    _run(ie.commit_row(db, {"school_name": "Gamma School", "school_category": "navodaya"},
                       ADMIN, create_leads=False))
    s = _run(db.schools.find_one({"school_name": "Gamma School"}))
    assert s["school_category"] == "Navodaya"


async def _two_schools(db):
    await db.schools.insert_many([
        {"school_id": "nv", "school_name": "NV", "school_category": "Navodaya"},
        {"school_id": "ps", "school_name": "PS", "school_category": "Pre School"},
    ])
    await db.contacts.insert_many([
        {"contact_id": "c_nv", "school_id": "nv", "name": "N", "email": "n@x.in", "phone": "9000000001"},
        {"contact_id": "c_ps", "school_id": "ps", "name": "P", "email": "p@x.in", "phone": "9000000002"},
    ])


def test_email_audience_filters_by_category(db):
    _run(_two_schools(db))
    got = _run(email._resolve_audience({"school_categories": ["Navodaya"]}, ADMIN))
    assert [c["contact_id"] for c in got] == ["c_nv"]


def test_wa_audience_filters_by_category(db):
    _run(_two_schools(db))
    got = _run(wa._resolve_audience({"school_categories": ["Navodaya"]}))
    assert [c["contact_id"] for c in got] == ["c_nv"]


def test_audience_options_lists_categories(db, monkeypatch):
    async def _me(_request):
        return ADMIN
    monkeypatch.setattr(email, "get_current_user", _me)
    _run(_two_schools(db))
    out = _run(email.email_audience_options(FakeRequest()))
    assert out["school_categories"] == ["Navodaya", "Pre School"]
